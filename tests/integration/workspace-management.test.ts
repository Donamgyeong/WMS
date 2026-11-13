import { beforeEach, afterAll, describe, expect, it } from "vitest";
import { testPool, seed } from "../fixtures";
import { seedAttendance } from "../attendance-fixtures";
import type { Principal } from "../../src/modules/identity/domain";
const pool = testPool();
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { getManagement } = await import("../../src/modules/workspace/management-service");
const { recalculate } = await import("../../src/modules/worktime/service");
const query = { from: "2026-11-01", to: "2026-12-01" };
const manager: Principal = { userId: "manager", employeeId: "manager", name: "부서장", email: "manager@example.com", roles: ["MANAGER"], departmentIds: ["d1"], mustChangePassword: false };
const admin: Principal = { ...manager, userId: "admin", employeeId: "admin", roles: ["ADMIN"], departmentIds: [] };
beforeEach(async () => {
  await seed(pool); await seedAttendance(pool);
  await pool.query("TRUNCATE payroll.payroll_periods, holiday_calendars CASCADE");
  await pool.query("update employees set department_id='d2' where id='admin'");
});
afterAll(async () => { await pool.end(); await (globalThis as unknown as { wmsPool?: import("pg").Pool }).wmsPool?.end(); });
async function attendance() {
  await pool.query("insert into work_sessions(id,employee_id,work_date,clock_in_at,clock_out_at,work_policy_id,calculation_version,input_snapshot,status) values('source','employee','2026-11-12','2026-11-12T09:00:00+09','2026-11-12T18:00:00+09','standard',1,'{}','UNRESOLVED')");
  for (const [id, type, time] of [["in", "CLOCK_IN", "09:00"], ["bs", "BREAK_START", "12:00"], ["be", "BREAK_END", "13:00"], ["out", "CLOCK_OUT", "18:00"]]) await pool.query("insert into attendance_events(id,employee_id,work_session_id,event_type,occurred_at,source,verification_status,verification_evidence,request_id) values($1,'employee','source',$2,$3,'PC','ACCEPTED','{\"private_ip\":\"sensitive\"}',$1)", [id, type, `2026-11-12T${time}:00+09`]);
  await pool.query("insert into attendance_corrections(id,employee_id,event_id,requested_change,reason) values('correction','employee','out','{\"occurredAt\":\"2026-11-12T18:01:00+09:00\"}','시간 확인')");
}
describe("하위 관리 화면 실제 데이터", () => {
  it("직원 선택 시에만 일별 집계를 제공하고 그래프에 원본 분 단위를 전달한다", async () => {
    await attendance();
    for (const area of ["team", "admin"] as const) {
      const principal = area === "team" ? manager : admin;
      const all = await getManagement(principal, area, `${area}-attendance`, query);
      expect(all.sections.some(s => s.title === "일별 집계")).toBe(false);
      const selected = await getManagement(principal, area, `${area}-attendance`, { ...query, employeeId: "employee" });
      const daily = selected.sections.find(s => s.title === "일별 집계")!;
      expect(daily.rows).toHaveLength(30);
      expect(daily.rows.every(r => r.employeeId === "employee")).toBe(true);
      expect(daily.rows.find(r => r.workDate === "2026-11-12")?.dailyMinutes?.[0]).toBe(480);
    }
  });

  it("모든 하위 화면을 빈 데이터에서도 조회하고 예시를 포함하지 않는다", async () => {
    for (const key of ["team-attendance", "team-detail", "team-calendar", "admin-attendance", "admin-organization", "admin-settings", "admin-calendar", "admin-contracts", "admin-settlements"]) {
      const area = key.startsWith("team") ? "team" : "admin";
      const result = await getManagement(area === "team" ? manager : admin, area, key, query);
      expect(result.sections.length).toBeGreaterThan(0); expect(result.unavailable.length).toBeGreaterThan(0);
      expect(JSON.stringify(result)).not.toMatch(/김직원|12,000원|기획 시안/);
    }
  });
  it("직원·부서장·겸직자의 권한 우회와 타부서 직접 조회를 차단한다", async () => {
    await expect(getManagement(manager, "admin", "admin-contracts", query)).rejects.toMatchObject({ status: 403 });
    await expect(getManagement({ ...manager, roles: ["EMPLOYEE"] }, "team", "team-calendar", query)).rejects.toMatchObject({ status: 403 });
    await expect(getManagement({ ...manager, roles: ["ADMIN", "MANAGER"] }, "team", "team-detail", { ...query, employeeId: "admin", workDate: "2026-11-12" })).rejects.toMatchObject({ status: 403 });
    expect((await getManagement({ ...manager, departmentIds: [] }, "team", "team-calendar", query)).employees).toEqual([]);
    await expect(getManagement(manager, "team", "admin-contracts", query)).rejects.toMatchObject({ status: 404 });
  });
  it("원본·정정·근로 구간·재계산 버전을 조회하고 검증 증거를 노출하지 않는다", async () => {
    await attendance();
    const result = await getManagement(manager, "team", "team-detail", { ...query, employeeId: "employee", workDate: "2026-11-12" });
    expect(result.sections.find(s => s.title === "원본 이벤트")?.rows).toHaveLength(4);
    expect(result.sections.find(s => s.title === "정정 이력")?.rows[0].cells).toContain("시간 확인");
    expect(result.sections.find(s => s.title === "근무일별 기록")?.rows[0].cells).toContain("8시간 0분");
    expect(result.sections.find(s => s.title === "근로 구간")?.rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toMatch(/private_ip|sensitive|verificationEvidence|hourlyRate|additionalOvertimePay/);
    await recalculate(admin, "employee", { from: "2026-11-12", to: "2026-11-13" });
    const after = await getManagement(admin, "admin", "admin-attendance", { ...query, employeeId: "employee", workDate: "2026-11-12" });
    expect(after.sections.find(s => s.title === "계산 버전 이력")?.rows).toHaveLength(2);
    expect(after.sections.find(s => s.title === "원본 이벤트")?.rows).toHaveLength(4);
  });
  it("세션에 연결되지 않은 검증 거부 원본도 선택 근무일에서 조회한다", async () => {
    await attendance();
    await pool.query("insert into attendance_events(id,employee_id,event_type,occurred_at,source,verification_status,verification_evidence,request_id) values('rejected','employee','CLOCK_IN','2026-11-12T08:50:00+09','PC','REJECTED','{\"private_ip\":\"sensitive\"}','rejected')");
    const result = await getManagement(manager, "team", "team-detail", { ...query, employeeId: "employee", workDate: "2026-11-12" });
    const events = result.sections.find(s => s.title === "원본 이벤트")!.rows;
    expect(events).toHaveLength(5);
    expect(events.find(e => e.id === "rejected")?.cells).toContain("REJECTED");
    expect(JSON.stringify(result)).not.toMatch(/private_ip|sensitive/);
  });
  it("일정·휴가·배정 유효 기간을 지키고 타부서 캘린더를 제외한다", async () => {
    await pool.query("insert into holiday_calendars(id,name,timezone) values('own','담당 캘린더','Asia/Seoul'),('other','타부서 전용','Asia/Seoul')");
    await pool.query("insert into employee_calendar_assignments(id,employee_id,calendar_id,effective_from,effective_to) values('a','employee','own','2026-11-10','2026-11-20'),('b','admin','other','2026-01-01',null)");
    await pool.query("insert into holidays(id,calendar_id,holiday_date,name,holiday_type,source) values('h1','own','2026-11-12','담당 휴일','COMPANY','manual'),('h2','own','2026-11-20','배정 종료 후','COMPANY','manual'),('h3','other','2026-11-12','비공개 휴일','COMPANY','manual')");
    await pool.query("insert into work_schedules(id,employee_id,work_date,day_type,is_work_scheduled) values('s1','employee','2026-11-14','DAY_OFF',false),('s2','admin','2026-11-14','WORKDAY',true)");
    const result = await getManagement(manager, "team", "team-calendar", query);
    expect(result.sections.find(s => s.title === "휴일 목록")?.rows.map(r => r.cells[1])).toEqual(["담당 휴일"]);
    expect(result.sections.find(s => s.title === "직원별 근무·휴무")?.rows).toHaveLength(1);
    const all = await getManagement(admin, "admin", "admin-calendar", query);
    expect(all.sections.find(s => s.title === "휴일 목록")?.rows).toHaveLength(3);
  });
  it("조직·정책·근무지·IP·정책 배정은 실제 저장값을 조회한다", async () => {
    const settings = await getManagement(admin, "admin", "admin-settings", query);
    expect(settings.sections.find(s => s.title === "근무지·접속 검증")?.rows[0].cells.join(' ')).toContain('127.0.0.0/8');
    expect(settings.sections.find(s => s.title === "정책 적용 이력")?.rows).toHaveLength(4);
    const org = await getManagement(admin, "admin", "admin-organization", query);
    expect(org.sections.find(s => s.title === "직원 목록")?.rows.find(r => r.id === "manager")?.cells).toContain("부서장");
  });
  it("시급·계약 이력 및 정산 최신 버전·근거·조정·미확정 값을 유지한다", async () => {
    await pool.query("insert into payroll.hourly_rate_histories(id,employee_id,hourly_rate,effective_from,effective_to) values('old','employee',11000,'2025-01-01','2026-01-01'),('rate','employee',12000,'2026-01-01',null)");
    await pool.query("insert into payroll.compensation_contracts(id,employee_id,effective_from) values('contract','employee','2026-01-01')");
    await pool.query("insert into payroll.payroll_periods(id,period_start,period_end) values('p','2026-11-01','2026-12-01')");
    for (const version of [1,2]) await pool.query("insert into payroll.payroll_calculations(id,payroll_period_id,employee_id,contract_id,regular_minutes,overtime_minutes,night_overtime_minutes,included_overtime_minutes,regular_pay,calculation_version,status,unresolved_reasons,input_snapshot) values($1,'p','employee','contract',480,1200,0,960,96000,$2,'UNRESOLVED','[\"ALLOCATION\"]','{\"source\":\"stored\"}')", [`c${version}`, version]);
    await pool.query("insert into payroll.payroll_line_items(id,payroll_calculation_id,duration_minutes,hourly_rate,basis_snapshot) values('line','c2',480,12000,'{\"record\":\"evidence\"}')");
    await pool.query("insert into payroll.payroll_adjustments(id,payroll_calculation_id,amount,reason,created_by) values('adjust','c2',100,'별도 이력','admin')");
    const contracts = await getManagement(admin, "admin", "admin-contracts", query);
    expect(contracts.sections.find(s => s.title === "시급 이력")?.rows).toHaveLength(2);
    expect(contracts.sections.find(s => s.title === "계약 이력")?.rows[0].cells).toContain("UNDECIDED");
    const result = await getManagement(admin, "admin", "admin-settlements", { ...query, calculationId: "c2" });
    const latest = result.sections.find(s => s.title === "정산 목록 · 직원별 최신 버전")!.rows;
    expect(latest).toHaveLength(1); expect(latest[0].cells[3]).toBe("2"); expect(latest[0].cells[7]).toBe("미확정");
    expect(result.sections.find(s => s.title === "정산 버전 이력")?.rows).toHaveLength(2);
    expect(result.sections.find(s => s.title === "계산 근거")?.rows).toHaveLength(1);
    expect(result.sections.find(s => s.title === "별도 조정 이력")?.rows[0].cells).toContain("별도 이력");
    await expect(getManagement(admin, "admin", "admin-settlements", { ...query, employeeId: "admin", calculationId: "c2" })).rejects.toMatchObject({ status: 404 });
  });
});
