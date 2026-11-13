// DB operator CLI; no public setup endpoint.
import { config } from "dotenv";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { workplaces, workplaceIpRanges, workPolicies, employeePolicyAssignments, employees, user } from "../src/db/schema";
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
async function main() {
const [command, ...args] = process.argv.slice(2);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);
try {
  if (command === "workplace") {
    const [id, name, rawLat, rawLon, ...networks] = args;
    const latitude = Number(rawLat), longitude = Number(rawLon);
    if (!id || !name || !rawLat || !rawLon || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error("workplace ID NAME LATITUDE LONGITUDE [CIDR ...]");
    await db.transaction(async tx => {
      await tx.insert(workplaces).values({ id, name, latitude: String(latitude), longitude: String(longitude), gpsRadiusMeters: 100 });
      for (const ipNetwork of networks) await tx.insert(workplaceIpRanges).values({ id: randomUUID(), workplaceId: id, ipNetwork });
    });
    console.log("근무지 등록 완료 (GPS 반경 100m)");
  } else if (command === "assign") {
    const [email, from] = args;
    if (!email || !/^\d{4}-\d{2}-\d{2}$/.test(from ?? "") || Number.isNaN(Date.parse(from))) throw new Error("assign EMAIL YYYY-MM-DD");
    await db.transaction(async tx => {
      const [employee] = await tx.select({ id: employees.id }).from(employees).innerJoin(user, eq(employees.userId, user.id)).where(eq(user.email, email.trim().toLowerCase()));
      if (!employee) throw new Error("직원을 찾을 수 없습니다.");
      // Each assignment owns its immutable policy basis; no changes to existing assignments.
      const id = randomUUID();
      await tx.insert(workPolicies).values({ id, name: `기본 근무 ${id}`, version: 1, effectiveFrom: from });
      await tx.insert(employeePolicyAssignments).values({ id: randomUUID(), employeeId: employee.id, workPolicyId: id, effectiveFrom: from });
    });
    console.log("기본 근무정책 배정 완료 (미정 정책 유지)");
  } else throw new Error("Usage: tsx scripts/attendance-setup.ts workplace ID NAME LAT LON [CIDR ...] | assign EMAIL YYYY-MM-DD");
} finally { await pool.end(); }

}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
