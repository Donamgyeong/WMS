import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { attendanceEvents, attendanceCorrections, employeePolicyAssignments, workPolicies, employeeCalendarAssignments, holidayCalendars, holidays, workSchedules, leaveRecords, workSessions } from "@/db/schema";
import { dayAfter, midnight, type DayContext } from "./engine";
export type Db = ReturnType<typeof getDb>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export async function loadInput(tx: Tx, source: typeof workSessions.$inferSelect, asOf: Date) {
  const events = await tx.select().from(attendanceEvents).where(and(eq(attendanceEvents.employeeId, source.employeeId), eq(attendanceEvents.workSessionId, source.id), eq(attendanceEvents.verificationStatus, "ACCEPTED"))).orderBy(asc(attendanceEvents.occurredAt), asc(attendanceEvents.recordedAt));
  const assignments = await tx.select({ assignment: employeePolicyAssignments, policy: workPolicies }).from(employeePolicyAssignments).innerJoin(workPolicies, eq(employeePolicyAssignments.workPolicyId, workPolicies.id)).where(eq(employeePolicyAssignments.employeeId, source.employeeId)).orderBy(asc(employeePolicyAssignments.id));
  const calendars = await tx.select({ assignment: employeeCalendarAssignments, calendar: holidayCalendars }).from(employeeCalendarAssignments).innerJoin(holidayCalendars, eq(employeeCalendarAssignments.calendarId, holidayCalendars.id)).where(eq(employeeCalendarAssignments.employeeId, source.employeeId)).orderBy(asc(employeeCalendarAssignments.id));
  const calendarHolidays = calendars.length ? await tx.select().from(holidays).where(sql`${holidays.calendarId} in (${sql.join(calendars.map(c => sql`${c.calendar.id}`), sql`, `)})`).orderBy(asc(holidays.id)) : [];
  const schedules = await tx.select().from(workSchedules).where(eq(workSchedules.employeeId, source.employeeId)).orderBy(asc(workSchedules.id));
  const leaves = await tx.select().from(leaveRecords).where(and(eq(leaveRecords.employeeId, source.employeeId), eq(leaveRecords.approvedStatus, "APPROVED"))).orderBy(asc(leaveRecords.id));
  const corrections = await tx.select().from(attendanceCorrections).where(and(eq(attendanceCorrections.employeeId, source.employeeId), eq(attendanceCorrections.status, "APPROVED"))).orderBy(asc(attendanceCorrections.id));
  const active = (entry: { effectiveFrom: string; effectiveTo: string | null }, day: string) => entry.effectiveFrom <= day && (!entry.effectiveTo || entry.effectiveTo > day);
  const days: DayContext[] = [];
  const end = source.clockOutAt ?? asOf;
  for (let day = source.workDate; midnight(day) <= end; day = dayAfter(day)) {
    const policy = assignments.filter(p => active(p.assignment, day) && active(p.policy, day));
    const schedule = schedules.find(s => s.workDate === day);
    const assigned = calendars.filter(c => active(c.assignment, day));
    const unsupportedTimezone = assigned.some(c => c.calendar.timezone !== "Asia/Seoul");
    const holiday = assigned.some(c => c.calendar.timezone === "Asia/Seoul" && calendarHolidays.some(h => h.calendarId === c.calendar.id && h.holidayDate === day));
    const dayLeaves = leaves.filter(l => l.startAt < midnight(dayAfter(day)) && l.endAt > midnight(day));
    const leave = dayLeaves.length > 0;
    const knownHalfDay = dayLeaves.length === 1 && dayLeaves[0].leaveType === "HALF_DAY";
    days.push({ date: day, policyId: policy.length === 1 ? policy[0].policy.id : null, policyVersion: policy.length === 1 ? policy[0].policy.version : null, requiredMinutes: schedule?.requiredWorkMinutes ?? (policy.length === 1 ? (leave ? (knownHalfDay ? policy[0].policy.halfDayWorkMinutes : null) : policy[0].policy.dailyWorkMinutes) : null), requiredBreakMinutes: policy.length === 1 && !leave ? policy[0].policy.breakMinutes : null, overtimeThresholdMinutes: policy.length === 1 ? policy[0].policy.dailyWorkMinutes : null, holiday: holiday || schedule?.dayType === "HOLIDAY" ? true : unsupportedTimezone ? null : schedule ? false : assigned.length ? false : null, halfDay: leave });
  }
  return { events, asOf: end, days, evidence: { assignments, calendars, calendarHolidays, schedules, leaves, corrections: corrections.filter(c => events.some(e => e.id === c.eventId)) } };
}
