// Trusted local database-operator CLI; uses the same validation and transactions as the web UI.
import { config } from "dotenv";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../src/db/schema";
import { getConfiguration, changeConfiguration } from "../src/modules/admin-management/service";
config({ path: ".env.local", quiet: true }); config({ path: ".env", quiet: true });
async function main() {
  const [command, ...args] = process.argv.slice(2);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema }); const actor = "DATABASE_OPERATOR" as const;
  try {
    let data = await getConfiguration(db, actor);
    if (command === "workplace") {
      const [id, name, latitude, longitude, ...networks] = args;
      // Keep the historical CLI's caller-supplied workplace ID for setup scripts.
      if (!id || data.workplaces.some(w => w.id === id)) throw new Error("새 근무지 ID가 필요합니다.");
      await changeConfiguration(db, actor, { action: "workplace.save", newId: id, name, latitude, longitude, networks, revision: data.revision });
      console.log("근무지 등록 완료 (GPS 반경 100m)");
    } else if (command === "assign") {
      const [email, effectiveFrom] = args;
      const employee = data.people.find(p => p.email === email?.trim().toLowerCase());
      if (!employee) throw new Error("직원을 찾을 수 없습니다.");
      const created = await changeConfiguration(db, actor, { action: "policy.create", name: `기본 근무 ${crypto.randomUUID()}`, effectiveFrom, revision: data.revision });
      data = await getConfiguration(db, actor);
      await changeConfiguration(db, actor, { action: "policy.assign", employeeId: employee.id, workPolicyId: created.id, effectiveFrom, revision: data.revision });
      console.log("기본 근무정책 배정 완료 (미정 정책 유지)");
    } else throw new Error("Usage: tsx scripts/attendance-setup.ts workplace ID NAME LAT LON [CIDR ...] | assign EMAIL YYYY-MM-DD (내일 이후)");
  } finally { await pool.end(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "설정에 실패했습니다."); process.exitCode = 1; });
