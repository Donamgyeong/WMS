import type { Pool } from "pg";
export async function seedAttendance(pool: Pool) {
  await pool.query("TRUNCATE work_policies, workplaces CASCADE");
  await pool.query("INSERT INTO workplaces(id,name,latitude,longitude,gps_radius_meters) VALUES('office','본사',37.5665,126.9780,100)");
  await pool.query("INSERT INTO workplace_ip_ranges(id,workplace_id,ip_network) VALUES('office-ip','office','127.0.0.0/8'),('v6','office','::1/128')");
  await pool.query("INSERT INTO work_policies(id,name,version,effective_from) VALUES('standard','기본',1,'2020-01-01')");
  await pool.query("INSERT INTO employee_policy_assignments(id,employee_id,work_policy_id,effective_from) SELECT id,id,'standard','2020-01-01' FROM employees");
}
