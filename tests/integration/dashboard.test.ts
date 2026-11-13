import { beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { testPool, seed } from "../fixtures";
import { seedAttendance } from "../attendance-fixtures";
import type { Principal } from "../../src/modules/identity/domain";
const pool = testPool();
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { getDashboard } = await import("../../src/modules/dashboard/service");
const principal: Principal = { userId: "employee", employeeId: "employee", name: "직원", email: "employee@example.com", roles: ["EMPLOYEE"], departmentIds: [], mustChangePassword: false };
beforeEach(async () => {
  await seed(pool); await seedAttendance(pool);
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-13T18:00:00+09:00"));
});
afterAll(async () => { await pool.end(); await (globalThis as unknown as { wmsPool?: import("pg").Pool }).wmsPool?.end(); });
import { afterEach } from "vitest";
afterEach(() => vi.useRealTimers());
describe("개인 대시보드 실제 DB 조회", () => {
  it("기록이 없으면 예시 없이 빈 상태를 반환한다", async () => {
    const result = await getDashboard(principal);
    expect(result.daily).toHaveLength(7); expect(result.totalMinutes).toBe(0);
    expect(result.upcoming).toEqual([]); expect(result.missing).toEqual([]);
    expect(result.provisional).toBe(false);
  });
  it("실근로·휴게·미종료·일정을 본인 범위로 조회한다", async () => {
    await pool.query("insert into work_sessions(id,employee_id,work_date,clock_in_at,clock_out_at,calculation_version,work_policy_id,input_snapshot,status) values('s','employee','2026-11-12','2026-11-12T09:00:00+09',null,1,'standard','{}','UNRESOLVED')");
    for (const [id, type, at] of [["in", "CLOCK_IN", "09:00"], ["bs", "BREAK_START", "12:00"], ["be", "BREAK_END", "13:00"]]) {
      await pool.query("insert into attendance_events(id,employee_id,work_session_id,event_type,occurred_at,source,verification_status,verification_evidence,request_id) values($1,'employee','s',$2,$3,'PC','ACCEPTED','{}',$1)", [id, type, `2026-11-12T${at}:00+09:00`]);
    }
    await pool.query("insert into work_schedules(id,employee_id,work_date,day_type,is_work_scheduled) values('own','employee','2026-11-14','DAY_OFF',false),('other','admin','2026-11-14','WORKDAY',true)");
    await pool.query("insert into leave_records(id,employee_id,leave_type,start_at,end_at,approved_status) values('approved','employee','HALF_DAY','2026-11-16T09:00:00+09','2026-11-16T13:00:00+09','APPROVED'),('pending','employee','HALF_DAY','2026-11-17T09:00:00+09','2026-11-17T13:00:00+09','PENDING')");
    const result = await getDashboard(principal);
    expect(result.totalMinutes).toBe(32 * 60);
    expect(result.daily.find(d => d.date === '2026-11-12')?.minutes).toBe(14 * 60);
    expect(result.provisional).toBe(true); expect(result.missing).toEqual([{ id: 's', date: '2026-11-12' }]);
    expect(result.upcoming.map(d => d.id)).toEqual(['schedule-own', 'leave-approved']);
    expect(JSON.stringify(result)).not.toMatch(/payroll|hourlyWage|password/);
  });
  it("비밀번호 변경이 필요한 사용자의 조회를 차단한다", async () => {
    await expect(getDashboard({ ...principal, mustChangePassword: true })).rejects.toMatchObject({ status: 403 });
  });
});
