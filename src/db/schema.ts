// Domain tables will be added with reviewed migrations from ERD v1.2.
// Payroll tables must use this separate schema and administrator-only APIs.
import { pgSchema } from "drizzle-orm/pg-core";
export const payroll = pgSchema("payroll");
