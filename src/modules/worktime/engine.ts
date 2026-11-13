import { nextState, workDate, type Event, type State } from "@/modules/attendance/domain";

export const ENGINE_VERSION = "worktime-v1";
const MINUTE = 60_000;
export type Segment = {
  startedAt: Date; endedAt: Date; durationMinutes: number;
  isOvertime: boolean | null; isNight: boolean | null; isHolidayWork: boolean | null;
  unresolvedReasons: string[];
};
export type DayContext = {
  date: string; policyId: string | null; policyVersion: number | null;
  requiredMinutes: number | null; requiredBreakMinutes?: number | null; overtimeThresholdMinutes?: number | null; holiday: boolean | null; halfDay: boolean;
};
export type CalculationInput = {
  events: (Event & { verificationStatus?: string })[]; asOf: Date;
  days: DayContext[]; nightEndHour?: number;
};
export class WorktimeError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function midnight(day: string) { return new Date(`${day}T00:00:00+09:00`); }
// Asia/Seoul has a fixed +09:00 offset for the supported contemporary attendance dates.
export function dayAfter(day: string) { return workDate(new Date(midnight(day).getTime() + 86_400_000)); }
export function calculate(input: CalculationInput) {
  if (!Number.isFinite(input.asOf.getTime())) throw new WorktimeError(400, "잘못된 계산 기준 시각입니다.");
  if (input.nightEndHour !== undefined && (!Number.isInteger(input.nightEndHour) || input.nightEndHour < 0 || input.nightEndHour > 22)) throw new WorktimeError(400, "야간 종료 시각은 0~22 정수여야 합니다.");
  const events = input.events.filter(e => e.verificationStatus === undefined || e.verificationStatus === "ACCEPTED");
  const ids = new Set<string>();
  let state: State = "NOT_STARTED";
  let previous: Date | undefined;
  let breakMs = 0, workMs = 0;
  const intervals: { start: Date; end: Date }[] = [];
  const reasons = new Set<string>();
  const add = (end: Date) => {
    if (!previous) return;
    const ms = end.getTime() - previous.getTime();
    if (state === "WORKING" && ms > 0) { intervals.push({ start: previous, end }); workMs += ms; }
    if (state === "ON_BREAK") breakMs += ms;
  };
  for (const event of events) {
    if (ids.has(event.id)) throw new WorktimeError(422, "중복 원본 이벤트입니다.");
    ids.add(event.id);
    if (!Number.isFinite(event.occurredAt.getTime()) || event.occurredAt > input.asOf || (previous && event.occurredAt <= previous)) throw new WorktimeError(422, "이벤트 시각 또는 순서를 확인하세요.");
    add(event.occurredAt);
    try { state = nextState(state, event.eventType); }
    catch { throw new WorktimeError(422, "누락되거나 비정상 순서인 이벤트입니다."); }
    previous = event.occurredAt;
  }
  if (state !== "FINISHED") { add(input.asOf); reasons.add(events.length ? "OPEN_SESSION" : "MISSING_CLOCK_IN"); }
  if (state === "ON_BREAK") reasons.add("OPEN_BREAK");
  const originDay = events[0] ? workDate(events[0].occurredAt) : null;
  const origin = input.days.find(d => d.date === originDay);
  const requiredBreakMinutes = origin?.halfDay ? null : origin?.requiredBreakMinutes ?? null;
  if (state === "FINISHED" && requiredBreakMinutes !== null && breakMs < requiredBreakMinutes * MINUTE) reasons.add("BREAK_REQUIREMENT_UNMET");
  let accumulatedMs = 0;
  const segments: Segment[] = [];
  for (const interval of intervals) {
    let cursor = interval.start.getTime();
    while (cursor < interval.end.getTime()) {
      const day = workDate(new Date(cursor));
      const context = input.days.find(d => d.date === day);
      const startOfDay = midnight(day).getTime();
      const endOfDay = midnight(dayAfter(day)).getTime();
      const issues: string[] = [];
      const samePolicy = origin?.policyId != null && context?.policyId === origin.policyId && context.policyVersion === origin.policyVersion;
      const halfDay = Boolean(origin?.halfDay || context?.halfDay);
      const threshold = origin?.overtimeThresholdMinutes === undefined ? origin?.requiredMinutes : origin.overtimeThresholdMinutes;
      let overtime: boolean | null = null;
      if (threshold == null || !samePolicy) issues.push("POLICY_BOUNDARY_OR_MISSING");
      else if (halfDay) issues.push("HALF_DAY_OVERTIME");
      else overtime = accumulatedMs >= threshold * MINUTE;
      if (halfDay) issues.push("HALF_DAY_BREAK");
      if (context?.holiday == null) issues.push("HOLIDAY_CLASSIFICATION");
      const hour = (cursor - startOfDay) / 3_600_000;
      let night: boolean | null;
      if (hour >= 22) night = true;
      else if (input.nightEndHour === undefined) { night = null; issues.push("NIGHT_END_UNDECIDED"); }
      else night = hour < input.nightEndHour;
      const boundaries = [interval.end.getTime(), endOfDay, startOfDay + 22 * 3_600_000];
      if (input.nightEndHour !== undefined) boundaries.push(startOfDay + input.nightEndHour * 3_600_000);
      if (threshold != null && samePolicy && !halfDay && accumulatedMs < threshold * MINUTE) boundaries.push(cursor + threshold * MINUTE - accumulatedMs);
      const end = Math.min(...boundaries.filter(n => n > cursor));
      if (overtime) issues.push("OVERTIME_APPROVAL_UNDECIDED");
      issues.forEach(r => reasons.add(r));
      segments.push({ startedAt: new Date(cursor), endedAt: new Date(end), durationMinutes: (end - cursor) / MINUTE, isOvertime: overtime, isNight: night, isHolidayWork: context?.holiday ?? null, unresolvedReasons: issues });
      accumulatedMs += end - cursor;
      cursor = end;
    }
  }
  return { engineVersion: ENGINE_VERSION, state, workDate: originDay, actualWorkMinutes: workMs / MINUTE, breakMinutes: breakMs / MINUTE, requiredWorkMinutes: origin?.requiredMinutes ?? null, requiredBreakMinutes, segments, unresolvedReasons: [...reasons].sort(), provisional: state !== "FINISHED" };
}
export type Calculation = ReturnType<typeof calculate>;
export type AggregateSession = { id: string; workDate: string; calculationVersion: number; calculation: Calculation };
export type Period = { key: string; start: Date; end: Date };
export function aggregate(sessions: AggregateSession[], periods: Period[], basis: "WORK_DATE" | "ACTUAL_TIME") {
  const latest = new Map<string, AggregateSession>();
  for (const s of sessions) {
    const old = latest.get(s.workDate);
    if (old?.calculationVersion === s.calculationVersion) throw new WorktimeError(422, "동일 근무일·버전이 중복되었습니다.");
    if (!old || old.calculationVersion < s.calculationVersion) latest.set(s.workDate, s);
  }
  return periods.map(period => {
    if (!(period.start < period.end)) throw new WorktimeError(400, "집계 기간을 확인하세요.");
    let actualMs = 0, overtimeMs = 0, nightMs = 0, holidayMs = 0;
    let overtimeKnown = true, nightKnown = true, holidayKnown = true;
    const unresolved = new Set<string>();
    const selected: string[] = [];
    for (const session of latest.values()) {
      let included = false;
      for (const segment of session.calculation.segments) {
        const ms = basis === "WORK_DATE"
          ? (midnight(session.workDate) >= period.start && midnight(session.workDate) < period.end ? segment.endedAt.getTime() - segment.startedAt.getTime() : 0)
          : Math.max(0, Math.min(segment.endedAt.getTime(), period.end.getTime()) - Math.max(segment.startedAt.getTime(), period.start.getTime()));
        if (!ms) continue;
        included = true; actualMs += ms;
        if (segment.isOvertime === null) overtimeKnown = false; else if (segment.isOvertime) overtimeMs += ms;
        if (segment.isNight === null) nightKnown = false; else if (segment.isNight) nightMs += ms;
        if (segment.isHolidayWork === null) holidayKnown = false; else if (segment.isHolidayWork) holidayMs += ms;
      }
      // Include empty/missing sessions on their work date as well.
      if (included || (midnight(session.workDate) >= period.start && midnight(session.workDate) < period.end)) {
        selected.push(session.id);
        session.calculation.unresolvedReasons.forEach(r => unresolved.add(r));
      }
    }
    return { key: period.key, start: period.start, end: period.end, actualWorkMinutes: actualMs / MINUTE, overtimeMinutes: overtimeKnown ? overtimeMs / MINUTE : null, nightMinutes: nightKnown ? nightMs / MINUTE : null, holidayMinutes: holidayKnown ? holidayMs / MINUTE : null, exceeds52Hours: actualMs > 3120 * MINUTE, sessionIds: selected, unresolvedReasons: [...unresolved].sort() };
  });
}
