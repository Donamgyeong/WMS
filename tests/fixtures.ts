import { Pool } from "pg";
import { hashPassword } from "better-auth/crypto";
export const initialPassword = "Initial-password-123!";
export const changedPassword = "Changed-password-456!";
export function testPool() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith("_test"))
    throw new Error(
      "TEST_DATABASE_URL must point to a dedicated database ending in _test",
    );
  return new Pool({ connectionString: url });
}
export async function seed(pool: Pool) {
  await pool.query(
    "TRUNCATE work_policies, workplaces, auth_rate_limits, managed_departments, employee_roles, employees, departments, auth_sessions, auth_accounts, auth_verifications, auth_users CASCADE",
  );
  const hash = await hashPassword(initialPassword);
  await pool.query(
    "INSERT INTO departments (id,name) VALUES ('d1','개발'),('d2','운영')",
  );
  for (const [id, role, mustChange] of [
    ["employee", "EMPLOYEE", false],
    ["manager", "MANAGER", false],
    ["admin", "ADMIN", false],
    ["new", "EMPLOYEE", true],
  ] as const) {
    await pool.query(
      "INSERT INTO auth_users (id,name,email) VALUES ($1,$1,$2)",
      [id, `${id}@example.com`],
    );
    await pool.query(
      "INSERT INTO auth_accounts (id,account_id,provider_id,user_id,password) VALUES ($1,$1,'credential',$1,$2)",
      [id, hash],
    );
    await pool.query(
      "INSERT INTO employees (id,user_id,department_id,must_change_password) VALUES ($1,$1,'d1',$2)",
      [id, mustChange],
    );
    await pool.query(
      "INSERT INTO employee_roles (employee_id,role) VALUES ($1,$2)",
      [id, role],
    );
  }
  await pool.query(
    "INSERT INTO managed_departments (employee_id,department_id) VALUES ('manager','d1')",
  );
}
