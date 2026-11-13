import { config } from "dotenv";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../src/db/schema";
import { getConfiguration, changeConfiguration } from "../src/modules/admin-management/service";
config({ path: ".env.local", quiet: true }); config({ path: ".env", quiet: true });
async function readPassword() {
  if (!process.stdin.isTTY) {
    let value = ""; for await (const chunk of process.stdin) value += chunk;
    return value.replace(/\r?\n$/, "");
  }
  process.stdout.write("임시 비밀번호 (12~128자, 화면에 표시되지 않음): ");
  process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding("utf8");
  return new Promise<string>((resolve, reject) => {
    let value = "";
    const done = () => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off("data", listener); process.stdout.write("\n"); };
    const listener = (chunk: string) => { for (const c of chunk) {
      if (c === "\u0003") { done(); reject(new Error("취소됨")); return; }
      if (c === "\r" || c === "\n") { done(); resolve(value); return; }
      if (c === "\u007f") value = value.slice(0, -1); else value += c;
    } };
    process.stdin.on("data", listener);
  });
}
async function main() {
  const [command, rawEmail, name, rolesInput = "EMPLOYEE", departmentName] = process.argv.slice(2);
  if (!["create", "disable", "roles"].includes(command) || !rawEmail) throw new Error("Usage: accounts create EMAIL NAME ROLE[,ROLE] [DEPARTMENT] | disable EMAIL | roles EMAIL NAME ROLE[,ROLE] [DEPARTMENT]");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });
  try {
    const actor = "DATABASE_OPERATOR" as const;
    let data = await getConfiguration(db, actor);
    const email = rawEmail.trim().toLowerCase();
    let department = data.departments.find(d => d.name === departmentName);
    if (command === "create" && departmentName && !department) {
      await changeConfiguration(db, actor, { action: "department.save", name: departmentName, revision: data.revision });
      data = await getConfiguration(db, actor); department = data.departments.find(d => d.name === departmentName);
    }
    const person = data.people.find(p => p.email === email);
    if (command !== "create" && !person) throw new Error("계정을 찾을 수 없습니다.");
    const roles = rolesInput.split(",");
    const body = command === "disable" ? { action: "employee.status", id: person!.id, active: false } : {
      action: command === "create" ? "employee.create" : "employee.save", id: person?.id,
      email, name: command === "create" ? name : person!.name,
      employeeNo: person?.employeeNo, departmentId: command === "create" ? department?.id : person!.departmentId,
      hiredAt: person?.hiredAt, terminatedAt: person?.terminatedAt,
      roles, departmentIds: roles.includes("MANAGER") && department ? [department.id] : [],
      ...(command === "create" ? { password: await readPassword() } : {}),
    };
    await changeConfiguration(db, actor, { ...body, revision: data.revision });
    console.log("계정 작업이 완료되었습니다.");
  } finally { await pool.end(); }
}
main().catch(() => { console.error("계정 작업에 실패했습니다. 입력·권한·중복 계정·DB 연결을 확인하세요."); process.exitCode = 1; });
