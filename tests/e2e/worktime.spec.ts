import { test, expect } from "@playwright/test";
import { testPool, seed, initialPassword } from "../fixtures";
import { seedAttendance } from "../attendance-fixtures";
const pool=testPool();
test.beforeEach(async()=>{await seed(pool);await seedAttendance(pool);});
test.afterAll(async()=>{await pool.end();});
async function login(page:import("@playwright/test").Page,role:string) {
  await page.goto("/login");await page.getByLabel("회사 이메일").fill(`${role}@example.com`);await page.getByLabel("비밀번호",{exact:true}).fill(initialPassword);await page.getByRole("button",{name:"로그인",exact:true}).click();await expect(page).toHaveURL(/\/me$/);
}
test("실제 브라우저 세션으로 기록→잠정 조회→퇴근→관리자 재계산→기존 상태 유지",async({browser})=>{
  const context=await browser.newContext();const page=await context.newPage();
  const adminContext=await browser.newContext();const admin=await adminContext.newPage();
  try {
    await login(page,"employee");
    const panel=page.getByRole("region",{name:"출퇴근·휴게 기록"});
    await panel.getByRole("button",{name:"출근하기",exact:true}).click();await expect(panel.getByText("근무 중",{exact:true})).toBeVisible();
    const {rows:[source]}=await pool.query("select work_date::text as day from work_sessions where employee_id='employee' and calculation_version=1");
    const tomorrow=new Date(`${source.day}T00:00:00Z`);tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
    const params=new URLSearchParams({from:source.day,to:tomorrow.toISOString().slice(0,10),basis:"WORK_DATE",nightEndHour:"6",weekStartsOn:"1"});
    const url=`/api/worktime?${params}`;
    const open=await page.request.get(url);expect(open.status()).toBe(200);expect((await open.json()).sessions[0].calculation.provisional).toBe(true);
    await panel.getByRole("button",{name:"퇴근하기",exact:true}).click();await expect(panel.getByText("퇴근 완료",{exact:true})).toBeVisible();
    const body={employeeId:"employee",from:source.day,to:tomorrow.toISOString().slice(0,10),nightEndHour:6};
    const request={data:body,headers:{origin:"http://localhost:3002"}};
    expect((await page.request.post("/api/admin/worktime/recalculate",request)).status()).toBe(403);
    await login(admin,"admin");
    for(const replayed of [false,true]) {
      const r=await admin.request.post("/api/admin/worktime/recalculate",request);expect(r.status()).toBe(200);expect((await r.json()).sessions[0].replayed).toBe(replayed);
    }
    const result=await page.request.get(url);expect(result.status()).toBe(200);const report=await result.json();expect(report.sessions[0].calculationVersion).toBe(2);expect(report.sessions[0].calculation.provisional).toBe(false);expect(report.daily[0].actualWorkMinutes).toBeGreaterThan(0);expect(JSON.stringify(report)).not.toMatch(/payroll|hourlyRate|grossAmount/);
    await page.reload();await expect(panel.getByText("퇴근 완료",{exact:true})).toBeVisible();await expect(panel.getByRole("listitem")).toHaveCount(2);
    expect((await page.request.get(url+"&employeeId=admin")).status()).toBe(403);
  }finally{await context.close();await adminContext.close();}
});
