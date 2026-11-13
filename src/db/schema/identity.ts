import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  boolean,
  timestamp,
  primaryKey,
  pgEnum,
  index,
  unique,
  integer,
  bigint,
  date,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
const time = (name: string) => timestamp(name, { withTimezone: true });
export const user = pgTable("auth_users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
});
export const session = pgTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    expiresAt: time("expires_at").notNull(),
    createdAt: time("created_at").notNull().defaultNow(),
    updatedAt: time("updated_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("auth_sessions_user_idx").on(t.userId)],
);
export const account = pgTable(
  "auth_accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: time("access_token_expires_at"),
    refreshTokenExpiresAt: time("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: time("created_at").notNull().defaultNow(),
    updatedAt: time("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("auth_account_provider_unique").on(t.providerId, t.accountId),
    index("auth_accounts_user_idx").on(t.userId),
  ],
);
export const verification = pgTable("auth_verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: time("expires_at").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
});
export const rateLimit = pgTable("auth_rate_limits", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});
export const roleEnum = pgEnum("employee_role", [
  "EMPLOYEE",
  "MANAGER",
  "ADMIN",
]);
export const departments = pgTable("departments", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  parentId: text("parent_id").references((): AnyPgColumn => departments.id),
  managerId: text("manager_id").references((): AnyPgColumn => employees.id),
}, (t) => [check("department_not_self_parent", sql`${t.parentId} IS DISTINCT FROM ${t.id}`)]);
export const employees = pgTable("employees", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id),
  departmentId: text("department_id").references(() => departments.id),
  employeeNo: text("employee_no").unique(),
  name: text("name"),
  hiredAt: date("hired_at"),
  terminatedAt: date("terminated_at"),
  active: boolean("active").notNull().default(true),
  mustChangePassword: boolean("must_change_password").notNull().default(true),
});
export const employeeRoles = pgTable(
  "employee_roles",
  {
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    role: roleEnum("role").notNull(),
  },
  (t) => [primaryKey({ columns: [t.employeeId, t.role] })],
);
export const managedDepartments = pgTable(
  "managed_departments",
  {
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id),
    departmentId: text("department_id")
      .notNull()
      .references(() => departments.id),
  },
  (t) => [primaryKey({ columns: [t.employeeId, t.departmentId] })],
);
