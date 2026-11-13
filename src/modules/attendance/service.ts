import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { attendanceEvents, employees, workSessions, workPolicies, employeePolicyAssignments, workplaces, workplaceIpRanges } from "@/db/schema";
import { AttendanceError, nextState, workDate, type Input } from "./domain";
import { summarize } from "@/modules/worktime/domain";
import { distanceMeters, GPS_RADIUS_METERS, requestDevice, requestIp } from "@/modules/workplace/domain";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
async function status(db: Db | Tx, employeeId: string, now: Date) {
  const [session] = await db.select().from(workSessions).where(and(eq(workSessions.employeeId, employeeId), eq(workSessions.calculationVersion, 1))).orderBy(desc(workSessions.workDate), desc(workSessions.calculationVersion)).limit(1);
  // An open session survives midnight; a completed session is shown only on its work date.
  const selected = session && (session.clockOutAt === null || session.workDate === workDate(now) || workDate(session.clockOutAt) === workDate(now)) ? session : undefined;
  const events = selected ? await db.select().from(attendanceEvents).where(and(eq(attendanceEvents.employeeId, employeeId), eq(attendanceEvents.workSessionId, selected.id), eq(attendanceEvents.verificationStatus, "ACCEPTED"))).orderBy(asc(attendanceEvents.occurredAt), asc(attendanceEvents.recordedAt)) : [];
  return { ...summarize(events, now), canStartNewSession: Boolean(selected?.clockOutAt && selected.workDate !== workDate(now)), workDate: selected?.workDate ?? workDate(now), clockInAt: selected?.clockInAt ?? null, sessionId: selected?.id ?? null, events, serverNow: now.toISOString(), needsReview: Boolean(selected && !selected.clockOutAt && selected.workDate !== workDate(now)) };
}
export async function getAttendance(employeeId: string) {
  return getDb().transaction(async tx => {
    await tx.execute(sql`select id from employees where id=${employeeId} for share`);
    return { ...await status(tx, employeeId, new Date()), workplaces: await tx.select({ id: workplaces.id, name: workplaces.name }).from(workplaces).orderBy(asc(workplaces.name)) };
  });
}
export async function recordAttendance(employeeId: string, input: Input, headers: Headers) {
  const source = requestDevice(headers);
  const ip = source === "PC" ? requestIp(headers) : null;
  if (source === "MOBILE" && !input.location) throw new AttendanceError(400, "GPS 위치 정보가 필요합니다.");
  const outcome = await getDb().transaction(async tx => {
    // Existing employee row is the lock even before the first session exists.
    const [employee] = await tx.select().from(employees).where(eq(employees.id, employeeId)).for("update");
    if (!employee?.active) throw new AttendanceError(403, "비활성 계정입니다.");
    const [lastEvent] = await tx.select({ at: attendanceEvents.occurredAt }).from(attendanceEvents).where(eq(attendanceEvents.employeeId, employeeId)).orderBy(desc(attendanceEvents.occurredAt)).limit(1);
    // Millisecond timestamps must remain strictly ordered even for very fast requests.
    const now = new Date(Math.max(Date.now(), lastEvent ? lastEvent.at.getTime() + 1 : 0));
    const [existing] = await tx.select().from(attendanceEvents).where(and(eq(attendanceEvents.employeeId, employeeId), eq(attendanceEvents.requestId, input.requestId)));
    if (existing) {
      const evidence = existing.verificationEvidence as { input?: Input };
      if (existing.source !== source || JSON.stringify(evidence.input) !== JSON.stringify(input)) throw new AttendanceError(409, "동일한 요청 ID에 다른 내용을 사용할 수 없습니다.");
      return { rejected: existing.verificationStatus !== "ACCEPTED", eventId: existing.id, replayed: true };
    }
    const [place] = await tx.select().from(workplaces).where(eq(workplaces.id, input.workplaceId));
    if (!place) throw new AttendanceError(422, "등록된 근무지를 선택하세요.");
    let accepted: boolean;
    let distance: number | null = null;
    if (source === "PC") {
      const matches = await tx.select({ id: workplaceIpRanges.id }).from(workplaceIpRanges).where(and(eq(workplaceIpRanges.workplaceId, place.id), sql`${ip}::inet <<= ${workplaceIpRanges.ipNetwork}`));
      accepted = matches.length > 0;
    } else {
      distance = distanceMeters(input.location!, { latitude: Number(place.latitude), longitude: Number(place.longitude) });
      accepted = distance <= GPS_RADIUS_METERS;
    }
    const eventId = randomUUID();
    const evidence = { input, ip, distanceMeters: distance, radiusMeters: source === "MOBILE" ? GPS_RADIUS_METERS : null };
    if (!accepted) {
      await tx.insert(attendanceEvents).values({ id: eventId, employeeId, eventType: input.eventType, occurredAt: now, source, workplaceId: place.id, verificationStatus: "REJECTED", verificationEvidence: evidence, requestId: input.requestId });
      return { rejected: true, eventId, replayed: false };
    }
    const current = await status(tx, employeeId, now);
    const next = nextState(input.eventType === "CLOCK_IN" && current.canStartNewSession ? "NOT_STARTED" : current.state, input.eventType);
    let sessionId = current.sessionId;
    if (input.eventType === "CLOCK_IN") {
      const day = workDate(now);
      const [policy] = await tx.select({ policy: workPolicies }).from(employeePolicyAssignments).innerJoin(workPolicies, eq(employeePolicyAssignments.workPolicyId, workPolicies.id)).where(and(eq(employeePolicyAssignments.employeeId, employeeId), sql`${employeePolicyAssignments.effectiveFrom} <= ${day}::date and (${employeePolicyAssignments.effectiveTo} is null or ${employeePolicyAssignments.effectiveTo} > ${day}::date)`, sql`${workPolicies.effectiveFrom} <= ${day}::date and (${workPolicies.effectiveTo} is null or ${workPolicies.effectiveTo} > ${day}::date)`));
      if (!policy) throw new AttendanceError(422, "적용된 근무정책이 없습니다. 관리자에게 문의하세요.");
      sessionId = randomUUID();
      await tx.insert(workSessions).values({ id: sessionId, employeeId, workDate: day, clockInAt: now, calculationVersion: 1, workPolicyId: policy.policy.id, inputSnapshot: { eventIds: [eventId], policyId: policy.policy.id, policyVersion: policy.policy.version, engineVersion: "attendance-v1", unresolved: ["WORK_CLASSIFICATION"] }, status: "OPEN", requiredWorkMinutes: String(policy.policy.dailyWorkMinutes) });
    }
    if (!sessionId) throw new AttendanceError(409, "출근 기록이 없습니다.");
    await tx.insert(attendanceEvents).values({ id: eventId, employeeId, workSessionId: sessionId, eventType: input.eventType, occurredAt: now, source, workplaceId: place.id, verificationStatus: "ACCEPTED", verificationEvidence: evidence, requestId: input.requestId });
    const result = await status(tx, employeeId, now);
    const [session] = await tx.select().from(workSessions).where(eq(workSessions.id, sessionId));
    await tx.update(workSessions).set({ clockOutAt: next === "FINISHED" ? now : null, actualWorkMinutes: String(result.actualWorkMinutes), breakMinutes: String(result.breakMinutes), status: next === "FINISHED" ? "UNRESOLVED" : "OPEN", inputSnapshot: { ...(session.inputSnapshot as object), eventIds: result.events.map(e => e.id) } }).where(eq(workSessions.id, sessionId));
    return { rejected: false, eventId, replayed: false };
  });
  if (outcome.rejected) throw new AttendanceError(403, source === "PC"
    ? `근무지 검증에 실패했습니다. 서버에서 확인한 접속 IP: ${ip}. 선택한 근무지의 허용 IP와 프록시 설정을 확인하세요.`
    : "근무지 검증에 실패했습니다. GPS 100m 범위를 확인하세요.");
  return outcome;
}
