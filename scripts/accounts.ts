import { config } from "dotenv";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { randomUUID } from "node:crypto";
import * as schema from "../src/db/schema";
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
const [command, rawEmail, name, rolesInput = "EMPLOYEE", departmentName] =
  process.argv.slice(2);
const email = rawEmail?.trim().toLowerCase();
const roles = rolesInput.split(",") as ("EMPLOYEE" | "MANAGER" | "ADMIN")[];
if (
  !email ||
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
  !["create", "disable", "roles"].includes(command) ||
  roles.some((r) => !["EMPLOYEE", "MANAGER", "ADMIN"].includes(r))
)
  throw new Error(
    "Usage: accounts create EMAIL NAME ROLE[,ROLE] [DEPARTMENT] | disable EMAIL | roles EMAIL NAME ROLE[,ROLE] [DEPARTMENT]",
  );
async function readPassword() {
  if (!process.stdin.isTTY) {
    let value = "";
    for await (const chunk of process.stdin) value += chunk;
    return value.replace(/\r?\n$/, "");
  }
  process.stdout.write("임시 비밀번호 (12~128자, 화면에 표시되지 않음): ");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return await new Promise<string>((resolve, reject) => {
    let value = "";
    const done = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("data", listener);
      process.stdout.write("\n");
    };
    const listener = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\u0003") {
          done();
          reject(new Error("취소됨"));
          return;
        }
        if (char === "\r" || char === "\n") {
          done();
          resolve(value);
          return;
        }
        if (char === "\u007f") value = value.slice(0, -1);
        else value += char;
      }
    };
    process.stdin.on("data", listener);
  });
}
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });
  try {
    if (command === "create") {
      if (!name || (roles.includes("MANAGER") && !departmentName))
        throw new Error("이름 및 부서장 담당 부서가 필요합니다.");
      const password = await readPassword();
      if (password.length < 12 || password.length > 128)
        throw new Error("비밀번호는 12~128자여야 합니다.");
      const passwordHash = await hashPassword(password);
      await db.transaction(async (tx) => {
        const userId = randomUUID();
        const employeeId = randomUUID();
        let departmentId: string | undefined;
        if (departmentName) {
          await tx
            .insert(schema.departments)
            .values({ id: randomUUID(), name: departmentName })
            .onConflictDoNothing();
          departmentId = (
            await tx
              .select()
              .from(schema.departments)
              .where(eq(schema.departments.name, departmentName))
          )[0].id;
        }
        await tx.insert(schema.user).values({ id: userId, email, name });
        await tx
          .insert(schema.account)
          .values({
            id: randomUUID(),
            userId,
            accountId: userId,
            providerId: "credential",
            password: passwordHash,
          });
        await tx
          .insert(schema.employees)
          .values({ id: employeeId, userId, departmentId });
        await tx
          .insert(schema.employeeRoles)
          .values([...new Set(roles)].map((role) => ({ employeeId, role })));
        if (roles.includes("MANAGER") && departmentId)
          await tx
            .insert(schema.managedDepartments)
            .values({ employeeId, departmentId });
      });
    } else {
      await db.transaction(async (tx) => {
        const [u] = await tx
          .select()
          .from(schema.user)
          .where(eq(schema.user.email, email));
        if (!u) throw new Error("계정을 찾을 수 없습니다.");
        const [employee] = await tx
          .select()
          .from(schema.employees)
          .where(eq(schema.employees.userId, u.id));
        if (!employee) throw new Error("직원을 찾을 수 없습니다.");
        if (command === "disable")
          await tx
            .update(schema.employees)
            .set({ active: false })
            .where(eq(schema.employees.id, employee.id));
        else {
          if (roles.includes("MANAGER") && !departmentName)
            throw new Error("부서장 담당 부서가 필요합니다.");
          await tx
            .delete(schema.employeeRoles)
            .where(eq(schema.employeeRoles.employeeId, employee.id));
          await tx
            .delete(schema.managedDepartments)
            .where(eq(schema.managedDepartments.employeeId, employee.id));
          await tx
            .insert(schema.employeeRoles)
            .values(
              [...new Set(roles)].map((role) => ({
                employeeId: employee.id,
                role,
              })),
            );
          if (departmentName && roles.includes("MANAGER")) {
            const [department] = await tx
              .select()
              .from(schema.departments)
              .where(eq(schema.departments.name, departmentName));
            if (!department) throw new Error("부서를 찾을 수 없습니다.");
            await tx
              .insert(schema.managedDepartments)
              .values({ employeeId: employee.id, departmentId: department.id });
          }
        }
        await tx.delete(schema.session).where(eq(schema.session.userId, u.id));
      });
    }
    console.log("계정 작업이 완료되었습니다.");
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    "계정 작업에 실패했습니다. 입력·중복 계정·DB 연결을 확인하세요.",
  );
  process.exitCode = 1;
});
