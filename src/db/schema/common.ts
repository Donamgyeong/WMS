import { text, timestamp, numeric, integer, date } from "drizzle-orm/pg-core";
import { employees } from "./identity";
export const id = () => text("id").primaryKey();
export const employeeId = () => text("employee_id").notNull().references(() => employees.id);
export const instant = (name: string) => timestamp(name, { withTimezone: true });
export const minutes = (name: string) => numeric(name);
export const money = (name: string) => numeric(name);
export const effective = () => ({ effectiveFrom: date("effective_from").notNull(), effectiveTo: date("effective_to") });
export const version = () => integer("calculation_version").notNull();
