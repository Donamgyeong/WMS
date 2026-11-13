import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { employees, user, departments, workSessions, leaveRecords, payrollPeriods, payrollCalculations } from "@/db/schema";
import { authorize, type Principal } from "@/modules/identity/domain";
import { getAttendance } from "@/modules/attendance/service";
import { getWorktime } from "@/modules/worktime/service";
import { midnight, dayAfter } from "@/modules/worktime/engine";
import { dashboardRange } from "@/modules/dashboard/domain";
import type { Overview } from "./dashboard-types";

export async function getOverview(principal: Principal, area: "team" | "admin"): Promise<Overview> {
  authorize(principal, area === "admin" ? "ADMIN" : "MANAGER");
  const db = getDb(), range = dashboardRange(new Date());
  // Scope is applied in SQL before any employee attendance is loaded, even for dual-role users.
  const scope = area === "team" ? (principal.departmentIds.length ? inArray(employees.departmentId, principal.departmentIds) : sql`false`) : undefined;
  const people = await db.select({ id: employees.id, name: sql<string>`coalesce(${employees.name}, ${user.name})`, departmentId: employees.departmentId, department: departments.name }).from(employees).innerJoin(user, eq(user.id, employees.userId)).leftJoin(departments, eq(departments.id, employees.departmentId)).where(and(eq(employees.active, true), scope)).orderBy(asc(user.name), asc(employees.id));
  const departmentList = await db.select({ id: departments.id, name: departments.name }).from(departments).where(area === "team" ? (principal.departmentIds.length ? inArray(departments.id, principal.departmentIds) : sql`false`) : undefined).orderBy(asc(departments.name));
  const ids = people.map(p => p.id);
  const [missing, leaves] = ids.length ? await Promise.all([
    db.select({ employeeId: workSessions.employeeId, date: workSessions.workDate }).from(workSessions).where(and(inArray(workSessions.employeeId, ids), eq(workSessions.calculationVersion, 1), isNull(workSessions.clockOutAt), sql`${workSessions.workDate} < ${range.today}::date`)).orderBy(asc(workSessions.workDate)),
    db.select({ employeeId: leaveRecords.employeeId }).from(leaveRecords).where(and(inArray(leaveRecords.employeeId, ids), eq(leaveRecords.approvedStatus, "APPROVED"), sql`${leaveRecords.startAt} < ${midnight(dayAfter(range.today))} and ${leaveRecords.endAt} > ${midnight(range.today)}`)),
  ]) : [[], []];
  const rows: Overview["employees"] = [];
  // Bound database concurrency: each existing service owns a transaction/employee lock.
  for (const person of people) {
    const attendance = await getAttendance(person.id);
    const report = await getWorktime(principal, person.id, { from: range.from, to: range.to, basis: "ACTUAL_TIME" });
    rows.push({ ...person, department: person.department ?? "부서 미배정", state: attendance.state, todayMinutes: report.daily.find(d => d.key === range.today)?.actualWorkMinutes ?? 0, weekMinutes: report.daily.reduce((n, d) => n + d.actualWorkMinutes, 0), provisional: report.sessions.some(s => s.calculation.provisional), missingDates: missing.filter(m => m.employeeId === person.id).map(m => m.date), onLeave: leaves.some(l => l.employeeId === person.id), unresolved: report.sessions.some(s => s.calculation.unresolvedReasons.some(r => r !== "OPEN_SESSION")) });
  }
  const result: Overview = { area, today: range.today, from: range.from, to: new Date(new Date(`${range.to}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10), asOf: new Date().toISOString(), departments: departmentList, employees: rows };
  // Payroll is queried and serialized exclusively after the ADMIN guard above.
  if (area === "admin") {
    const periods = await db.select().from(payrollPeriods).orderBy(desc(payrollPeriods.periodStart)).limit(6);
    result.settlements = [];
    for (const period of periods) {
      const calculations = await db.selectDistinctOn([payrollCalculations.employeeId]).from(payrollCalculations).where(eq(payrollCalculations.payrollPeriodId, period.id)).orderBy(asc(payrollCalculations.employeeId), desc(payrollCalculations.calculationVersion));
      const sum = (key: "additionalOvertimePay" | "totalCalculatedPay") => {
        if (!calculations.length || calculations.some(c => c[key] === null || c.status === "UNRESOLVED")) return null;
        // PostgreSQL numeric has no fixed scale; preserve every stored decimal place.
        const scale = Math.max(2, ...calculations.map(c => c[key]!.split(".")[1]?.length ?? 0));
        const factor = BigInt(10) ** BigInt(scale);
        const units = calculations.reduce((n, c) => { const [whole, fraction = ""] = c[key]!.split("."); return n + BigInt(whole) * factor + BigInt(fraction.padEnd(scale, "0")); }, BigInt(0));
        return `${units / factor}.${String(units % factor).padStart(scale, "0")}`;
      };
      result.settlements.push({ id: period.id, from: period.periodStart, to: period.periodEnd, status: period.status, calculations: calculations.length, unresolved: calculations.filter(c => c.status === "UNRESOLVED").length, additionalPay: sum("additionalOvertimePay"), totalPay: sum("totalCalculatedPay") });
    }
  }
  return result;
}
