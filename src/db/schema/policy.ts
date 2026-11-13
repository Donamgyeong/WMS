import { sql } from "drizzle-orm";
import { pgTable, text, integer, time, numeric, jsonb, check, unique } from "drizzle-orm/pg-core";
import { id, employeeId, effective } from "./common";
export const workPolicies = pgTable("work_policies", {
 id: id(), name: text("name").notNull(), version: integer("version").notNull(),
 clockInFrom: time("clock_in_from").notNull().default("08:00"), clockInTo: time("clock_in_to").notNull().default("10:00"),
 dailyWorkMinutes: integer("daily_work_minutes").notNull().default(480), breakMinutes: integer("break_minutes").notNull().default(60), halfDayWorkMinutes: integer("half_day_work_minutes").notNull().default(240), halfDayBreakMinutes: integer("half_day_break_minutes"),
 regularMultiplier: numeric("regular_multiplier").notNull().default("1.0"), overtimeMultiplier: numeric("overtime_multiplier").notNull().default("1.5"), nightOvertimeMultiplier: numeric("night_overtime_multiplier").notNull().default("2.0"), holidayMultiplier: numeric("holiday_multiplier"),
 unresolvedPolicies: jsonb("unresolved_policies").$type<string[]>().notNull().default(sql`'["ALLOCATION", "ALLOWANCE_COMPARISON", "HALF_DAY", "OVERTIME_APPROVAL", "HOLIDAY", "CORRECTION_APPROVAL", "WEEKLY_ALERT", "ROUNDING", "TAX"]'::jsonb`),
 ...effective(),
}, t => [unique("policy_name_version").on(t.name,t.version), check("policy_values", sql`${t.version}>0 AND ${t.dailyWorkMinutes}>=0 AND ${t.breakMinutes}>=0 AND ${t.halfDayWorkMinutes}>=0 AND (${t.halfDayBreakMinutes} IS NULL OR ${t.halfDayBreakMinutes}>=0) AND ${t.clockInFrom}<=${t.clockInTo} AND ${t.regularMultiplier}>0 AND ${t.overtimeMultiplier}>0 AND ${t.nightOvertimeMultiplier}>0 AND (${t.holidayMultiplier} IS NULL OR ${t.holidayMultiplier}>0)`)]);
export const employeePolicyAssignments = pgTable("employee_policy_assignments", { id:id(), employeeId:employeeId(), workPolicyId:text("work_policy_id").notNull().references(()=>workPolicies.id), ...effective() });
