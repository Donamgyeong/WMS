import { beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { testPool, seed, initialPassword } from "../fixtures";
import { seedAttendance } from "../attendance-fixtures";
import type { Principal } from "../../src/modules/identity/domain";
const pool = testPool();
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.BETTER_AUTH_URL = "http://localhost:3002";
process.env.BETTER_AUTH_SECRET = "test-only-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
const { recalculate, getWorktime } = await import("../../src/modules/worktime/service");
const { getAttendance } = await import("../../src/modules/attendance/service");
const { worktimeHttp } = await import("../../src/modules/worktime/http");
const { POST: authPost } = await import("../../src/app/api/auth/[...all]/route");
const principal = (role: "ADMIN" | "EMPLOYEE" | "MANAGER" = "ADMIN"): Principal => ({ employeeId: role.toLowerCase(), userId: role.toLowerCase(), roles:[role], name:role,email:`${role.toLowerCase()}@example.com`,departmentIds:role==="MANAGER"?["d1"]:[],mustChangePassword:false });
const range={from:"2026-11-13",to:"2026-11-14",nightEndHour:6};
async function source(id="source", date="2026-11-13", endDate=date) {
  await pool.query("insert into work_sessions(id,employee_id,work_date,clock_in_at,clock_out_at,calculation_version,work_policy_id,input_snapshot,status) values($1,'employee',$2,$3,$4,1,'standard','{}','UNRESOLVED')",[id,date,`${date}T09:00:00+09:00`,`${endDate}T19:00:00+09:00`]);
  for(const [i,type,time] of [[0,"CLOCK_IN",`${date}T09:00:00+09:00`],[1,"BREAK_START",`${date}T12:00:00+09:00`],[2,"BREAK_END",`${date}T13:00:00+09:00`],[3,"CLOCK_OUT",`${endDate}T19:00:00+09:00`]] as const) await pool.query("insert into attendance_events(id,employee_id,work_session_id,event_type,occurred_at,source,verification_status,verification_evidence,request_id) values($1,'employee',$2,$3,$4,'PC','ACCEPTED','{}',$1)",[`${id}-${i}`,id,type,time]);
  await pool.query("insert into work_schedules(id,employee_id,work_date,day_type,is_work_scheduled) values($1,'employee',$2,'WORKDAY',true)",[id,date]);
}
beforeEach(async()=>{await seed(pool);await seedAttendance(pool);await pool.query("TRUNCATE holiday_calendars CASCADE");await source();});
afterAll(async()=>{await pool.end();await (globalThis as unknown as {wmsPool?:import("pg").Pool}).wmsPool?.end();});
describe("근로시간 재계산·조회 DB 통합",()=>{
  it("파생 버전·근로 구간·근거를 저장하고 원본 이벤트는 그대로 보존한다",async()=>{
    const r=await recalculate(principal(),"employee",range);expect(r.sessions[0].calculationVersion).toBe(2);
    const {rows}=await pool.query("select * from work_segments order by started_at");expect(rows).toHaveLength(3);expect(rows.reduce((n,s)=>n+Number(s.duration_minutes),0)).toBe(540);expect(rows.at(-1).is_overtime).toBe(true);expect(rows.every(s=>s.applied_multiplier===null)).toBe(true);
    const {rows:[s]}=await pool.query("select * from work_sessions where calculation_version=2");expect(s.status).toBe("UNRESOLVED");expect(s.input_snapshot.eventIds).toHaveLength(4);expect(s.input_snapshot.calculation.unresolvedReasons).toContain("OVERTIME_APPROVAL_UNDECIDED");
    expect((await pool.query("select count(*)::int as n from attendance_events where work_session_id='source'")).rows[0].n).toBe(4);
    await expect(pool.query("update attendance_events set source='MOBILE' where id='source-0'")).rejects.toThrow(/append-only/);
  });
  it("동일 재계산과 동시 실행은 버전을 늘리지 않는다",async()=>{
    const replies=await Promise.all([recalculate(principal(),"employee",range),recalculate(principal(),"employee",range)]);
    expect(replies.map(r=>r.sessions[0].replayed).sort()).toEqual([false,true]);expect((await pool.query("select * from work_sessions")).rowCount).toBe(2);
  });
  it("정책 입력 변경은 새 버전을 만들며 이전 근거와 구간을 보존한다",async()=>{
    await recalculate(principal(),"employee",range);
    await pool.query("update work_schedules set day_type='HOLIDAY' where id='source'");
    const r=await recalculate(principal(),"employee",range);expect(r.sessions[0].calculationVersion).toBe(3);
    expect((await pool.query("select * from work_segments where calculation_version=2")).rowCount).toBe(3);
    const report=await getWorktime(principal("EMPLOYEE"),"employee",{...range,basis:"WORK_DATE"});expect(report.sessions).toHaveLength(1);expect(report.sessions[0].calculationVersion).toBe(3);expect(report.daily[0].actualWorkMinutes).toBe(540);expect(report.daily[0].holidayMinutes).toBe(540);
  });
  it("정책 배정 변경 후 새 세션의 정책 참조도 실제 적용 정책을 가리킨다",async()=>{
    await recalculate(principal(),"employee",range);
    await pool.query("insert into work_policies(id,name,version,effective_from) values('revised','개정',1,'2026-01-01')");
    await pool.query("update employee_policy_assignments set work_policy_id='revised' where employee_id='employee'");
    const r=await recalculate(principal(),"employee",range);expect(r.sessions[0].calculationVersion).toBe(3);
    const {rows:[s]}=await pool.query("select work_policy_id,input_snapshot from work_sessions where calculation_version=3");expect(s.work_policy_id).toBe("revised");expect(s.input_snapshot.days[0].policyId).toBe("revised");
  });
  it("재계산 이후 출퇴근 상태는 원본 세션을 재생한다",async()=>{
    await recalculate(principal(),"employee",range);
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-11-13T20:00:00+09:00"));
    try { const status=await getAttendance("employee");expect(status.sessionId).toBe("source");expect(status.events).toHaveLength(4);expect(status.state).toBe("FINISHED"); } finally { vi.useRealTimers(); }
    const {rows}=await pool.query("select * from work_sessions where calculation_version=1");expect(rows[0].id).toBe("source");
  });
  it("열린 세션 저장 재계산은 전체 트랜잭션을 롤백하며 조회는 잠정 계산한다",async()=>{
    await pool.query("insert into work_sessions(id,employee_id,work_date,clock_in_at,calculation_version,work_policy_id,input_snapshot,status) values('open','employee','2026-11-14','2026-11-14T09:00:00+09:00',1,'standard','{}','OPEN')");
    await expect(recalculate(principal(),"employee",{...range,to:"2026-11-15"})).rejects.toThrow(/열린 세션/);expect((await pool.query("select * from work_sessions where calculation_version>1")).rowCount).toBe(0);
    const r=await getWorktime(principal(),"employee",{from:"2026-11-14",to:"2026-11-15",basis:"WORK_DATE"});expect(r.sessions[0].calculation.provisional).toBe(true);expect(r.sessions[0].calculation.unresolvedReasons).toContain("MISSING_CLOCK_IN");
  });
  it("반차와 야간 종료·휴일 입력 누락을 NULL과 사유로 보존한다",async()=>{
    await pool.query("delete from work_schedules");
    await pool.query("insert into leave_records(id,employee_id,leave_type,start_at,end_at,approved_status) values('half','employee','HALF_DAY','2026-11-13T09:00:00+09:00','2026-11-13T13:00:00+09:00','APPROVED')");
    await recalculate(principal(),"employee",{from:range.from,to:range.to});
    const {rows}=await pool.query("select * from work_segments");expect(rows.every(s=>s.is_overtime===null && s.is_night===null && s.is_holiday_work===null)).toBe(true);
    const r=await getWorktime(principal(),"employee",{from:range.from,to:range.to,basis:"WORK_DATE"});expect(r.daily[0].actualWorkMinutes).toBe(540);expect(r.sessions[0].calculation.requiredWorkMinutes).toBe(240);expect(r.sessions[0].calculation.requiredBreakMinutes).toBeNull();expect(r.daily[0].overtimeMinutes).toBeNull();expect(r.weekly).toBeNull();
  });
  it("구간 중복 및 생성된 세션 근거 변경을 DB가 차단한다",async()=>{
    await recalculate(principal(),"employee",range);
    await expect(pool.query("insert into work_segments select 'duplicate',work_session_id,employee_id,started_at,ended_at,duration_minutes,is_overtime,is_night,is_holiday_work,applied_multiplier,calculation_version,unresolved_reasons from work_segments limit 1")).rejects.toThrow(/overlap|exclusion|conflict/i);
    await expect(pool.query("update work_sessions set input_snapshot='{}' where calculation_version=2")).rejects.toThrow(/new calculation version/);
  });
  it("관리자만 재계산하고 조회는 본인·담당 부서로 제한한다",async()=>{
    await expect(recalculate(principal("EMPLOYEE"),"employee",range)).rejects.toThrow(/권한/);
    const manager=principal("MANAGER");expect((await getWorktime(manager,"employee",{...range,basis:"WORK_DATE"})).daily[0].actualWorkMinutes).toBe(540);
    await pool.query("update employees set department_id='d2' where id='employee'");
    await expect(getWorktime(manager,"employee",{...range,basis:"WORK_DATE"})).rejects.toThrow(/권한/);
    await expect(getWorktime(principal("EMPLOYEE"),"admin",{...range,basis:"WORK_DATE"})).rejects.toThrow(/권한/);
  });
  it("주·월 부분 집계와 주 시작일을 명시하고 임금 필드는 반환하지 않는다",async()=>{
    const r=await getWorktime(principal("EMPLOYEE"),"employee",{...range,basis:"ACTUAL_TIME",weekStartsOn:1});
    expect(r.weekly?.[0].partial).toBe(true);expect(r.monthly[0].actualWorkMinutes).toBe(540);expect(r.weekly?.[0].alertPolicy).toBe("UNDECIDED");expect(JSON.stringify(r)).not.toMatch(/appliedMultiplier|hourlyRate|payroll|grossAmount/);
  });
  it("자정·월 경계에서 출근일 귀속과 실제 시각 배분이 다르다",async()=>{
    await source("month-end","2026-11-30","2026-12-01");
    const period={from:"2026-12-01",to:"2026-12-02",nightEndHour:6};
    const byDate=await getWorktime(principal(),"employee",{...period,basis:"WORK_DATE"});expect(byDate.daily[0].actualWorkMinutes).toBe(0);
    const byTime=await getWorktime(principal(),"employee",{...period,basis:"ACTUAL_TIME"});expect(byTime.daily[0].actualWorkMinutes).toBe(19*60);expect(byTime.sessions[0].workDate).toBe("2026-11-30");
    await recalculate(principal(),"employee",{from:"2026-11-30",to:"2026-12-01",nightEndHour:6});
    const stored=await getWorktime(principal(),"employee",{...period,basis:"ACTUAL_TIME"});expect(stored.daily[0].actualWorkMinutes).toBe(19*60);expect(stored.sessions[0].calculationVersion).toBe(2);
  });
  it("직원 캘린더와 적용 기간을 사용하고 지원하지 않는 시간대는 미확정이다",async()=>{
    await pool.query("delete from work_schedules");
    await pool.query("insert into holiday_calendars(id,name,timezone) values('k','한국','Asia/Seoul'),('u','미국','America/New_York')");
    await pool.query("insert into employee_calendar_assignments(id,employee_id,calendar_id,effective_from,effective_to) values('k','employee','k','2026-01-01','2026-11-14')");
    await pool.query("insert into holidays(id,calendar_id,holiday_date,name,holiday_type,source) values('holiday','k','2026-11-13','회사휴일','COMPANY','MANUAL')");
    const r=await getWorktime(principal(),"employee",{...range,basis:"WORK_DATE"});expect(r.daily[0].holidayMinutes).toBe(540);
    await pool.query("delete from employee_calendar_assignments");
    await pool.query("insert into employee_calendar_assignments(id,employee_id,calendar_id,effective_from) values('u','employee','u','2026-01-01')");
    const unsupported=await getWorktime(principal(),"employee",{...range,basis:"WORK_DATE"});expect(unsupported.daily[0].holidayMinutes).toBeNull();expect(unsupported.daily[0].unresolvedReasons).toContain("CALENDAR_TIMEZONE_UNSUPPORTED");
  });
  it("승인 정정이 있으면 원본 재생 결과를 확정하지 않는다",async()=>{
    await pool.query("insert into attendance_corrections(id,employee_id,event_id,requested_change,reason,status,approved_by) values('correction','employee','source-0','{}','test','APPROVED','admin')");
    const r=await recalculate(principal(),"employee",range);expect(r.sessions[0].unresolvedReasons).toContain("CORRECTION_REPLAY_PENDING");
  });
});
async function cookie(role="employee") {
  const r=await authPost(new Request("http://localhost:3002/api/auth/sign-in/email",{method:"POST",headers:{origin:"http://localhost:3002","content-type":"application/json"},body:JSON.stringify({email:`${role}@example.com`,password:initialPassword})}));
  expect(r.status).toBe(200);return r.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");
}
describe("근로시간 API 계약",()=>{
  it("인증·입력 검증·캐시 금지와 본인 조회",async()=>{
    const base="http://localhost:3002/api/worktime?from=2026-11-13&to=2026-11-14&basis=WORK_DATE";
    expect((await worktimeHttp(new Request(base))).status).toBe(401);
    const headers={cookie:await cookie()};
    const r=await worktimeHttp(new Request(base,{headers}));expect(r.status).toBe(200);expect(r.headers.get("cache-control")).toBe("no-store");expect((await r.json()).daily[0].actualWorkMinutes).toBe(540);
    for(const url of [base.replace("2026-11-13","2026-02-30"),base.replace("basis=WORK_DATE","basis=bad"),base+"&nightEndHour=24",base+"&weekStartsOn=7",base+"&from=2026-11-12",base+"&extra=1",base.replace("to=2026-11-14","to=2026-11-12")]) expect((await worktimeHttp(new Request(url,{headers}))).status).toBe(400);
    expect((await worktimeHttp(new Request(base+"&employeeId=admin",{headers}))).status).toBe(403);
  });
  it("관리자 재계산 API의 역할·Origin·JSON 검증",async()=>{
    const url="http://localhost:3002/api/admin/worktime/recalculate";
    const request=(c:string,origin="http://localhost:3002",type="application/json")=>new Request(url,{method:"POST",headers:{cookie:c,origin,"content-type":type},body:JSON.stringify({...range,employeeId:"employee"})});
    expect((await worktimeHttp(request(await cookie()))).status).toBe(403);
    const c=await cookie("admin");expect((await worktimeHttp(request(c,"https://evil.example"))).status).toBe(403);expect((await worktimeHttp(request(c,undefined,"text/plain"))).status).toBe(415);
    const r=await worktimeHttp(request(c));expect(r.status).toBe(200);expect((await r.json()).sessions[0].calculationVersion).toBe(2);
  });
});
