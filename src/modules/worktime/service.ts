import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { employees, workSessions, workSegments } from "@/db/schema";
import { calculate, aggregate, midnight, dayAfter, WorktimeError, type Calculation, type AggregateSession, type Period } from "./engine";
import { loadInput, type Tx } from "./repository";
import { authorize, assertEmployeeScope, type Principal } from "@/modules/identity/domain";
export type Range = { from: string; to: string; nightEndHour?: number };
function sourceRange(employeeId: string, range: Range) {
  return and(eq(workSessions.employeeId, employeeId), eq(workSessions.calculationVersion, 1), sql`${workSessions.workDate} >= ${range.from}::date and ${workSessions.workDate} < ${range.to}::date`);
}
async function lock(tx: Tx, employeeId: string) {
  const rows = await tx.select().from(employees).where(eq(employees.id, employeeId)).for("update");
  if (!rows.length) throw new WorktimeError(404, "직원이 없습니다.");
  return rows[0];
}
function evaluate(input: Awaited<ReturnType<typeof loadInput>>, nightEndHour?: number) {
  const result = calculate({ ...input, nightEndHour });
  if (input.evidence.corrections.length) result.unresolvedReasons.push("CORRECTION_REPLAY_PENDING");
  if (input.evidence.calendars.some(c => c.calendar.timezone !== "Asia/Seoul")) result.unresolvedReasons.push("CALENDAR_TIMEZONE_UNSUPPORTED");
  return result;
}
export async function recalculate(principal: Principal, employeeId: string, range: Range) {
  authorize(principal, "ADMIN");
  return getDb().transaction(async tx => {
    await lock(tx, employeeId);
    const sources = await tx.select().from(workSessions).where(sourceRange(employeeId, range)).orderBy(asc(workSessions.workDate));
    const [max] = await tx.select({ version: sql<number>`coalesce(max(${workSessions.calculationVersion}),1)::int` }).from(workSessions).where(eq(workSessions.employeeId, employeeId));
    const version = max.version + 1;
    const output: { sessionId: string; calculationVersion: number; replayed: boolean; unresolvedReasons: string[] }[] = [];
    for (const source of sources) {
      if (!source.clockOutAt) throw new WorktimeError(409, "열린 세션은 조회 시 잠정 계산하며 저장 재계산할 수 없습니다.");
      const input = await loadInput(tx, source, source.clockOutAt);
      const calculation = evaluate(input, range.nightEndHour);
      const basis = { sourceSessionId: source.id, eventIds: input.events.map(e => e.id), engineVersion: calculation.engineVersion, events: input.events, days: input.days, evidence: input.evidence, asOf: input.asOf, nightEndHour: range.nightEndHour ?? null };
      const fingerprint = createHash("sha256").update(JSON.stringify(basis)).digest("hex");
      const [previous] = await tx.select().from(workSessions).where(and(eq(workSessions.employeeId, employeeId), eq(workSessions.workDate, source.workDate))).orderBy(desc(workSessions.calculationVersion)).limit(1);
      const snapshot = previous?.inputSnapshot as { fingerprint?: string; calculation?: Calculation };
      if (snapshot?.fingerprint === fingerprint) { output.push({ sessionId: previous.id, calculationVersion: previous.calculationVersion, replayed: true, unresolvedReasons: calculation.unresolvedReasons }); continue; }
      const id = randomUUID();
      await tx.insert(workSessions).values({ id, employeeId, workDate: source.workDate, clockInAt: source.clockInAt, clockOutAt: source.clockOutAt, actualWorkMinutes: String(calculation.actualWorkMinutes), breakMinutes: String(calculation.breakMinutes), requiredWorkMinutes: calculation.requiredWorkMinutes === null ? null : String(calculation.requiredWorkMinutes), calculationVersion: version, workPolicyId: input.days[0]?.policyId ?? source.workPolicyId, inputSnapshot: { ...basis, fingerprint, calculation }, status: calculation.unresolvedReasons.length ? "UNRESOLVED" : "COMPLETE" });
      if (calculation.segments.length) await tx.insert(workSegments).values(calculation.segments.map(segment => ({ ...segment, durationMinutes: String(segment.durationMinutes), id: randomUUID(), employeeId, workSessionId: id, calculationVersion: version, appliedMultiplier: null })));
      output.push({ sessionId: id, calculationVersion: version, replayed: false, unresolvedReasons: calculation.unresolvedReasons });
    }
    return { employeeId, sessions: output };
  });
}
function restore(value: Calculation): Calculation {
  return { ...value, segments: value.segments.map(s => ({ ...s, startedAt: new Date(s.startedAt), endedAt: new Date(s.endedAt) })) };
}
export async function getWorktime(principal: Principal, employeeId: string, range: Range & { basis: "WORK_DATE" | "ACTUAL_TIME"; weekStartsOn?: number }) {
  authorize(principal);
  return getDb().transaction(async tx => {
    const employee = await lock(tx, employeeId);
    assertEmployeeScope(principal, { employeeId, departmentId: employee.departmentId });
    const now = new Date();
    const sources = await tx.select().from(workSessions).where(and(eq(workSessions.employeeId, employeeId), eq(workSessions.calculationVersion, 1), range.basis === "WORK_DATE" ? sql`${workSessions.workDate} >= ${range.from}::date and ${workSessions.workDate} < ${range.to}::date` : sql`${workSessions.clockInAt} < ${midnight(range.to)} and coalesce(${workSessions.clockOutAt}, ${now}) >= ${midnight(range.from)}`)).orderBy(asc(workSessions.workDate));
    const selected: AggregateSession[] = [];
    for (const source of sources) {
      const [latest] = await tx.select().from(workSessions).where(and(eq(workSessions.employeeId, employeeId), eq(workSessions.workDate, source.workDate))).orderBy(desc(workSessions.calculationVersion)).limit(1);
      const snapshot = latest?.inputSnapshot as { calculation?: Calculation; nightEndHour?: number | null };
      const useStored = Boolean(source.clockOutAt && snapshot?.calculation && (snapshot.nightEndHour ?? undefined) === range.nightEndHour);
      const calculation = useStored ? restore(snapshot.calculation!) : evaluate(await loadInput(tx, source, now), range.nightEndHour);
      selected.push({ id: useStored ? latest.id : source.id, workDate: source.workDate, calculationVersion: useStored ? latest.calculationVersion : 1, calculation });
    }
    const daily: Period[] = [], weekly = new Map<string, Period>(), monthly = new Map<string, Period>();
    for (let day = range.from; day < range.to; day = dayAfter(day)) {
      daily.push({ key: day, start: midnight(day), end: midnight(dayAfter(day)) });
      const month = day.slice(0, 7);
      const start = midnight(`${month}-01`);
      const [year, m] = month.split("-").map(Number);
      const end = midnight(`${m === 12 ? year + 1 : year}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`);
      monthly.set(month, { key: month, start, end });
      if (range.weekStartsOn !== undefined) {
        const date = midnight(day);
        const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
        const start = new Date(date.getTime() - ((weekday - range.weekStartsOn + 7) % 7) * 86400000);
        weekly.set(start.toISOString(), { key: start.toISOString(), start, end: new Date(start.getTime() + 7 * 86400000) });
      }
    }
    // Clip buckets to the requested range; partial buckets never claim a full-week total.
    const clip = (periods: Period[]) => periods.map(p => ({ ...p, start: new Date(Math.max(p.start.getTime(), midnight(range.from).getTime())), end: new Date(Math.min(p.end.getTime(), midnight(range.to).getTime())) }));
    return { employeeId, basis: range.basis, from: range.from, to: range.to, asOf: now, sessions: selected, daily: aggregate(selected, daily, range.basis), weekly: range.weekStartsOn === undefined ? null : aggregate(selected, clip([...weekly.values()]), range.basis).map(p => ({ ...p, partial: p.end.getTime() - p.start.getTime() !== 7 * 86400000, alertPolicy: "UNDECIDED" })), monthly: aggregate(selected, clip([...monthly.values()]), range.basis), weeklyUnresolvedReason: range.weekStartsOn === undefined ? "WEEK_START_UNDECIDED" : null };
  });
}
