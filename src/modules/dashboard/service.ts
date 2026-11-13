import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { workSessions, workSchedules, leaveRecords, holidays, holidayCalendars, employeeCalendarAssignments } from "@/db/schema";
import { authorize, type Principal } from "@/modules/identity/domain";
import { getWorktime } from "@/modules/worktime/service";
import { midnight } from "@/modules/worktime/engine";
import { workDate } from "@/modules/attendance/domain";
import { dashboardRange, type DashboardData } from "./domain";

export async function getDashboard(principal: Principal): Promise<DashboardData> {
  authorize(principal);
  const range = dashboardRange(new Date());
  const db = getDb(), employeeId = principal.employeeId;
  const report = await getWorktime(principal, employeeId, { from: range.from, to: range.to, basis: "ACTUAL_TIME" });
  const [missing, schedules, leaves, calendarDays] = await Promise.all([
    db.select({ id: workSessions.id, date: workSessions.workDate }).from(workSessions).where(and(eq(workSessions.employeeId, employeeId), eq(workSessions.calculationVersion, 1), isNull(workSessions.clockOutAt), sql`${workSessions.workDate} < ${range.today}::date`)).orderBy(asc(workSessions.workDate)),
    db.select().from(workSchedules).where(and(eq(workSchedules.employeeId, employeeId), sql`${workSchedules.workDate} >= ${range.today}::date and ${workSchedules.workDate} < ${range.upcomingTo}::date`)),
    db.select().from(leaveRecords).where(and(eq(leaveRecords.employeeId, employeeId), eq(leaveRecords.approvedStatus, "APPROVED"), sql`${leaveRecords.endAt} > ${midnight(range.today)} and ${leaveRecords.startAt} < ${midnight(range.upcomingTo)}`)),
    db.select({ id: holidays.id, date: holidays.holidayDate, label: holidays.name }).from(employeeCalendarAssignments).innerJoin(holidayCalendars, eq(holidayCalendars.id, employeeCalendarAssignments.calendarId)).innerJoin(holidays, eq(holidays.calendarId, employeeCalendarAssignments.calendarId)).where(and(eq(employeeCalendarAssignments.employeeId, employeeId), eq(holidayCalendars.timezone, "Asia/Seoul"), sql`${holidays.holidayDate} >= ${range.today}::date and ${holidays.holidayDate} < ${range.upcomingTo}::date and ${holidays.holidayDate} >= ${employeeCalendarAssignments.effectiveFrom} and (${employeeCalendarAssignments.effectiveTo} is null or ${holidays.holidayDate} < ${employeeCalendarAssignments.effectiveTo})`)),
  ]);
  const labels = { WORKDAY: "근무일", DAY_OFF: "휴무일", HOLIDAY: "휴일" };
  const upcoming = [
    ...schedules.map(s => ({ id: `schedule-${s.id}`, date: s.workDate, label: `${labels[s.dayType]} · ${s.isWorkScheduled ? "근무 예정" : "근무 예정 없음"}` })),
    ...leaves.map(l => ({ id: `leave-${l.id}`, date: workDate(l.startAt) < range.today ? range.today : workDate(l.startAt), label: `${l.leaveType === "HALF_DAY" ? "반차" : "휴가"} · 승인됨 (${workDate(l.startAt)}~${workDate(new Date(l.endAt.getTime() - 1))})` })),
    ...new Map(calendarDays.map(h => [h.id, { ...h, id: `holiday-${h.id}`, label: `휴일 · ${h.label}` }])).values(),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return { today: range.today, from: range.from, to: range.to, asOf: report.asOf.toISOString(), daily: report.daily.map(d => ({ date: d.key, minutes: d.actualWorkMinutes })), totalMinutes: report.daily.reduce((n, d) => n + d.actualWorkMinutes, 0), provisional: report.sessions.some(s => s.calculation.provisional), missing, upcoming };
}
