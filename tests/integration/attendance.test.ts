import { beforeEach, afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { testPool, seed, initialPassword } from "../fixtures";
import { seedAttendance } from "../attendance-fixtures";
const pool = testPool();
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.BETTER_AUTH_URL = "http://localhost:3002";
process.env.BETTER_AUTH_SECRET = "test-only-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
const { POST: authPost } = await import("../../src/app/api/auth/[...all]/route");
const { attendanceHttp } = await import("../../src/modules/attendance/http");
let cookie = "";
const origin = "http://localhost:3002";
const input = (eventType = "CLOCK_IN", extra = {}) => ({ eventType, requestId: randomUUID(), workplaceId: "office", ...extra });
async function send(body: unknown, headers: Record<string, string> = {}) {
  return attendanceHttp(new Request(`${origin}/api/attendance/events`, { method: "POST", headers: { origin, cookie, "content-type": "application/json", "x-forwarded-for": "127.0.0.1", ...headers }, body: JSON.stringify(body) }));
}
async function status() { return attendanceHttp(new Request(`${origin}/api/attendance/status`, { headers: { cookie } })); }
beforeEach(async () => {
  await seed(pool); await seedAttendance(pool);
  const response = await authPost(new Request(`${origin}/api/auth/sign-in/email`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email: "employee@example.com", password: initialPassword }) }));
  cookie = response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  expect(response.status).toBe(200);
});
afterAll(async () => { await pool.end(); await (globalThis as unknown as { wmsPool?: import("pg").Pool }).wmsPool?.end(); });
describe("근태 기록 API와 DB", () => {
  it("출근·다중 휴게·퇴근, 원본 보존과 스냅샷", async () => {
    for (const type of ["CLOCK_IN", "BREAK_START", "BREAK_END", "BREAK_START", "BREAK_END", "CLOCK_OUT"]) expect((await send(input(type))).status).toBe(201);
    const response = await status();
    const value = await response.json();
    expect(value.state).toBe("FINISHED"); expect(value.events).toHaveLength(6);
    expect(JSON.stringify(value)).not.toMatch(/hourlyRate|grossAmount|payroll/);
    const { rows } = await pool.query("select * from work_sessions");
    expect(Number(rows[0].actual_work_minutes)).toBeGreaterThan(0);
    expect(rows[0].input_snapshot.eventIds).toHaveLength(6);
    expect(rows[0].status).toBe("UNRESOLVED");
    await expect(pool.query("UPDATE attendance_events SET source='MOBILE'")).rejects.toThrow(/append-only/);
    expect((await send(input())).status).toBe(409);
  });
  it("동일 요청 재전송·다른 내용 충돌·동시 출근", async () => {
    const body = input();
    const replies = await Promise.all([send(body), send(body), send(input())]);
    expect(replies.map(r => r.status).sort()).toEqual([200, 201, 409]);
    expect((await send({ ...body, eventType: "CLOCK_OUT" })).status).toBe(409);
    expect((await pool.query("select * from attendance_events")).rowCount).toBe(1);
  });
  it("휴게 중 퇴근·출근 전 휴게를 거부한다", async () => {
    expect((await send(input("BREAK_START"))).status).toBe(409);
    await send(input()); await send(input("BREAK_START"));
    expect((await send(input("CLOCK_OUT"))).status).toBe(409);
    expect((await (await status()).json()).state).toBe("ON_BREAK");
  });
  it("거부 이벤트 보존·재시도와 집계 제외", async () => {
    const body = input();
    expect((await send(body, { "x-forwarded-for": "192.0.2.1" })).status).toBe(403);
    expect((await send(body, { "x-forwarded-for": "192.0.2.1" })).status).toBe(403);
    expect((await pool.query("select * from attendance_events where verification_status='REJECTED'")).rowCount).toBe(1);
    expect((await (await status()).json()).state).toBe("NOT_STARTED");
  });
  it("GPS 100m 안팎·위치 누락·헤더 IPv6 검증", async () => {
    const mobile = { "x-attendance-device": "MOBILE" };
    expect((await send(input(), mobile)).status).toBe(400);
    expect((await send(input("CLOCK_IN", { location: { latitude: 37.57, longitude: 126.978, accuracy: 5 } }), mobile)).status).toBe(403);
    expect((await send(input("CLOCK_IN", { location: { latitude: 37.5665, longitude: 126.978, accuracy: 5 } }), mobile)).status).toBe(201);
    expect((await send(input("CLOCK_OUT"), { "x-forwarded-for": "::1" })).status).toBe(201);
  });
  it("인증·출처·타인 및 시각 주입 차단", async () => {
    expect((await send(input(), { cookie: "" })).status).toBe(401);
    expect((await send(input(), { origin: "https://evil.example" })).status).toBe(403);
    expect((await send(input("CLOCK_IN", { employeeId: "admin" }))).status).toBe(400);
    expect((await send(input("CLOCK_IN", { occurredAt: "2000-01-01" }))).status).toBe(400);
    expect((await send(input(), { "x-forwarded-for": "invalid" })).status).toBe(400);
  });
  it("정책 누락은 원본·세션 모두 롤백한다", async () => {
    await pool.query("DELETE FROM employee_policy_assignments WHERE employee_id='employee'");
    expect((await send(input())).status).toBe(422);
    expect((await pool.query("select * from attendance_events")).rowCount).toBe(0);
    expect((await pool.query("select * from work_sessions")).rowCount).toBe(0);
  });
  it("이전 날짜에 출근한 열린 세션으로 휴게와 퇴근을 연결한다", async () => {
    const at = new Date(Date.now() - 36 * 3600000);
    const { workDate } = await import("../../src/modules/attendance/domain");
    await pool.query("insert into work_sessions(id,employee_id,work_date,clock_in_at,calculation_version,work_policy_id,input_snapshot,status,required_work_minutes) values('overnight','employee',$1,$2,1,'standard','{}','OPEN',480)", [workDate(at), at]);
    await pool.query("insert into attendance_events(id,employee_id,work_session_id,event_type,occurred_at,source,workplace_id,verification_status,verification_evidence,request_id) values('old','employee','overnight','CLOCK_IN',$1,'PC','office','ACCEPTED','{}','old-request')", [at]);
    expect((await (await status()).json()).needsReview).toBe(true);
    for (const type of ["BREAK_START", "BREAK_END", "CLOCK_OUT"]) expect((await send(input(type))).status).toBe(201);
    const { rows } = await pool.query("select * from work_sessions");
    expect(rows).toHaveLength(1); expect(workDate(rows[0].work_date)).toBe(workDate(at));
    expect((await pool.query("select * from attendance_events where work_session_id='overnight'")).rowCount).toBe(4);
    expect((await (await status()).json()).state).toBe("FINISHED");
    expect((await send(input())).status).toBe(201);
    expect((await pool.query("select * from work_sessions")).rowCount).toBe(2);
  });
  it("CLI 근무지·정책 배정", async () => {
    const { spawn } = await import("node:child_process");
    const run = (args: string[]) => new Promise<number | null>(resolve => {
      const child = spawn(process.execPath, ["--import", "tsx", "scripts/attendance-setup.ts", ...args], { env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL }, stdio: "ignore" });
      child.on("close", resolve);
    });
    expect(await run(["workplace", "branch", "지점", "37", "127", "192.0.2.0/24"])).toBe(0);
    expect(await run(["workplace", "bad", "잘못된 좌표", "91", "127"])).not.toBe(0);
    await pool.query("DELETE FROM employee_policy_assignments WHERE employee_id='employee'");
    expect(await run(["assign", "employee@example.com", "2026-01-01"])).not.toBe(0);
    const future = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    expect(await run(["assign", "employee@example.com", future])).toBe(0);
    expect((await pool.query("select effective_from::text from employee_policy_assignments where employee_id='employee'")).rows[0].effective_from).toBe(future);
  });
});
