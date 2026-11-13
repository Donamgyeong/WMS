import { beforeEach, afterEach, afterAll, describe, expect, it, vi } from "vitest";
import { testPool, seed } from "../fixtures";
import { seedAttendance } from "../attendance-fixtures";
import type { Principal } from "../../src/modules/identity/domain";
const pool = testPool();
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { getOverview } = await import("../../src/modules/workspace/dashboard-service");
const principal = (admin = false): Principal => ({ userId: admin ? "admin" : "manager", employeeId: admin ? "admin" : "manager", name: "사용자", email: "user@example.com", roles: [admin ? "ADMIN" : "MANAGER"], departmentIds: admin ? [] : ["d1"], mustChangePassword: false });
beforeEach(async () => {
  await seed(pool); await seedAttendance(pool);
  await pool.query("TRUNCATE payroll.payroll_periods CASCADE");
  await pool.query("update employees set department_id='d2' where id='admin'");
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-13T18:00:00+09:00"));
});
afterEach(() => vi.useRealTimers());
afterAll(async () => { await pool.end(); await (globalThis as unknown as { wmsPool?: import("pg").Pool }).wmsPool?.end(); });
describe("부서장·관리자 실제 대시보드", () => {
  it("부서장은 담당 부서만 조회하고 임금 필드는 제공하지 않는다", async () => {
    const result = await getOverview(principal(), "team");
    expect(result.employees.map(e => e.id).sort()).toEqual(["employee", "manager", "new"]);
    expect(result.departments).toEqual([{ id: "d1", name: "개발" }]);
    expect(result.to).toBe("2026-11-15"); expect(result).not.toHaveProperty("settlements");
    expect(result.employees.every(e => e.weekMinutes === 0 && e.state === "NOT_STARTED")).toBe(true);
  });
  it("담당 부서가 없으면 빈 목록이며 관리자 겸직이어도 team 범위를 넓히지 않는다", async () => {
    expect((await getOverview({ ...principal(), departmentIds: [] }, "team")).employees).toEqual([]);
    const dual = await getOverview({ ...principal(), roles: ["ADMIN", "MANAGER"] }, "team");
    expect(dual.employees.some(e => e.id === "admin")).toBe(false); expect(dual).not.toHaveProperty("settlements");
  });
  it("관리자는 전체 재직자와 미배정 직원을 조회하고 비활성 직원은 제외한다", async () => {
    await pool.query("update employees set department_id=null where id='employee'");
    await pool.query("update employees set active=false where id='new'");
    const result = await getOverview(principal(true), "admin");
    expect(result.employees).toHaveLength(3); expect(result.employees.find(e => e.id === "employee")?.department).toBe("부서 미배정");
    expect(result.settlements).toEqual([]);
  });
  it("진행 중 근무·실제 휴게·미종료 기록과 승인 휴가를 집계한다", async () => {
    await pool.query("insert into work_sessions(id,employee_id,work_date,clock_in_at,calculation_version,work_policy_id,input_snapshot,status) values('s','employee','2026-11-12','2026-11-12T09:00:00+09',1,'standard','{}','OPEN')");
    for (const [id, type, time] of [["in", "CLOCK_IN", "09:00"], ["bs", "BREAK_START", "12:00"], ["be", "BREAK_END", "13:00"]]) await pool.query("insert into attendance_events(id,employee_id,work_session_id,event_type,occurred_at,source,verification_status,verification_evidence,request_id) values($1,'employee','s',$2,$3,'PC','ACCEPTED','{}',$1)", [id, type, `2026-11-12T${time}:00+09`]);
    await pool.query("insert into leave_records(id,employee_id,leave_type,start_at,end_at,approved_status) values('leave','employee','HALF_DAY','2026-11-13T09:00:00+09','2026-11-13T13:00:00+09','APPROVED')");
    const row = (await getOverview(principal(), "team")).employees.find(e => e.id === "employee")!;
    expect(row.weekMinutes).toBe(32 * 60); expect(row.todayMinutes).toBe(18 * 60);
    expect(row.state).toBe("WORKING"); expect(row.provisional).toBe(true); expect(row.onLeave).toBe(true); expect(row.missingDates).toEqual(["2026-11-12"]);
  });
  it("社員・部서장의 관리자 조회와 비밀번호 미변경 계정을 차단한다", async () => {
    await expect(getOverview(principal(), "admin")).rejects.toMatchObject({ status: 403 });
    await expect(getOverview({ ...principal(), roles: ["EMPLOYEE"] }, "team")).rejects.toMatchObject({ status: 403 });
    await expect(getOverview({ ...principal(true), mustChangePassword: true }, "admin")).rejects.toMatchObject({ status: 403 });
  });
  it("정산은 직원별 최신 버전만 합산하고 미확정은 NULL을 유지한다", async () => {
    await pool.query("insert into payroll.payroll_periods(id,period_start,period_end) values('p','2026-11-01','2026-12-01')");
    await pool.query("insert into payroll.compensation_contracts(id,employee_id,effective_from,allocation_policy,allowance_comparison_policy,fixed_overtime_allowance) values('contract','employee','2026-01-01','TEST_ONLY','TEST_ONLY',100)");
    for (const version of [1, 2]) await pool.query("insert into payroll.payroll_calculations(id,payroll_period_id,employee_id,contract_id,regular_minutes,overtime_minutes,night_overtime_minutes,included_overtime_minutes,payable_overtime_minutes,regular_pay,additional_overtime_pay,total_calculated_pay,calculation_version,status,unresolved_reasons,input_snapshot) values($1,'p','employee','contract',480,0,0,0,0,100.1001,0.2002,100.3003,$2,'CALCULATED','[]','{}')", [`calc-${version}`, version]);
    let period = (await getOverview(principal(true), "admin")).settlements![0];
    expect(period.calculations).toBe(1); expect(period.totalPay).toBe("100.3003"); expect(period.additionalPay).toBe("0.2002");
    await pool.query("insert into payroll.payroll_calculations(id,payroll_period_id,employee_id,contract_id,regular_minutes,overtime_minutes,night_overtime_minutes,included_overtime_minutes,regular_pay,calculation_version,status,unresolved_reasons,input_snapshot) values('calc-3','p','employee','contract',480,0,0,0,100.10,3,'UNRESOLVED','[\"POLICY_UNDECIDED\"]','{}')");
    period = (await getOverview(principal(true), "admin")).settlements![0];
    expect(period.unresolved).toBe(1); expect(period.totalPay).toBeNull(); expect(period.additionalPay).toBeNull();
  });
});
