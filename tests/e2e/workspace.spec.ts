import { test, expect, type Page } from "@playwright/test";
import { testPool, seed, initialPassword } from "../fixtures";
import { seedAttendance } from "../attendance-fixtures";
import { adminRoutes, teamRoutes } from "../../src/modules/workspace/routes";
const pool = testPool();
test.beforeEach(async () => { await seed(pool); await seedAttendance(pool); await pool.query("TRUNCATE payroll.payroll_periods, holiday_calendars CASCADE"); });
test.afterAll(async () => { await pool.end(); });
async function login(page: Page, role: string) {
  await page.goto("/login");
  await page.getByLabel("회사 이메일").fill(`${role}@example.com`);
  await page.getByLabel("비밀번호", { exact: true }).fill(initialPassword);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/me$/);
}
for (const width of [1440, 1024, 390, 320]) {
  for (const area of ["team", "admin"] as const) {
    test(`${area} 전체 화면 ${width}px 실제 데이터 렌더링과 메뉴 이동`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await login(page, area === "admin" ? "admin" : "manager");
      const routes = area === "admin" ? adminRoutes : teamRoutes;
      for (const route of routes) {
        await page.goto(route.path);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(route.title);
        await expect(page.getByText(/실제 DB 조회/)).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (route.key !== area) await expect(page.getByRole("region", { name: "미구현 기능", exact: true })).toBeVisible();
        await expect(page.getByText(/기획 시안|김직원|12,000원/)).toHaveCount(0);
        await page.screenshot({ path: `test-results/workspace/${route.key}-${width}.png`, fullPage: true });
      }
      await page.getByRole("navigation", { name: area === "admin" ? "관리자 메뉴" : "부서장 메뉴" }).getByRole("link").first().click();
      await expect(page).toHaveURL(new RegExp(`/${area}$`));
      await expect(page.getByText(/실제 DB 조회/)).toBeVisible();
    });
  }
}
test("부서원 실제 기록 검색·선택·원본 및 상세 페이지", async ({ page }) => {
  await pool.query("insert into work_sessions(id,employee_id,work_date,clock_in_at,clock_out_at,calculation_version,work_policy_id,input_snapshot,status) values('s','employee','2026-11-12','2026-11-12T09:00:00+09','2026-11-12T18:00:00+09',1,'standard','{}','UNRESOLVED')");
  for (const [id, type, time] of [["in", "CLOCK_IN", "09:00"], ["bs", "BREAK_START", "12:00"], ["be", "BREAK_END", "13:00"], ["out", "CLOCK_OUT", "18:00"]]) await pool.query("insert into attendance_events(id,employee_id,work_session_id,event_type,occurred_at,source,verification_status,verification_evidence,request_id) values($1,'employee','s',$2,$3,'PC','ACCEPTED','{}',$1)", [id, type, `2026-11-12T${time}:00+09`]);
  await login(page, "manager"); await page.goto("/team/attendance");
  await expect(page.getByText(/실제 DB 조회/)).toBeVisible();
  await page.getByLabel("시작일", { exact: true }).fill("2026-11-01");
  await page.getByLabel("종료일", { exact: true }).fill("2026-12-01");
  await page.getByRole("button", { name: "기간 조회" }).click();
  const records = page.getByRole("region", { name: "근무일별 기록", exact: true });
  await expect(records).toContainText("8시간 0분");
  await page.getByRole("searchbox", { name: "이름·내용 검색" }).fill("없는직원");
  await expect(records).toContainText("조회 결과가 없습니다.");
  await page.getByRole("searchbox", { name: "이름·내용 검색" }).fill("");
  await records.getByRole("button", { name: /employee.*2026-11-12 선택/ }).click();
  const events = page.getByRole("region", { name: "원본 이벤트", exact: true });
  await expect(events.getByRole("row")).toHaveCount(5);
  await page.getByRole("link", { name: "근태 상세 페이지 →" }).click();
  await expect(page).toHaveURL(/employeeId=employee/);
  await expect(events.getByRole("row")).toHaveCount(5);
  await expect(page.getByRole("region", { name: "정정 이력", exact: true })).toContainText("조회 결과가 없습니다.");
});
test("관리자 실제 정책·조직·계약 조회와 조회 오류", async ({ page }) => {
  await login(page, "admin"); await page.goto("/admin/settings");
  await expect(page.getByRole("region", { name: "근무지·접속 검증", exact: true })).toContainText("127.0.0.0/8");
  await page.goto("/admin/organization");
  await expect(page.getByRole("region", { name: "직원 목록", exact: true })).toContainText("부서장");
  await page.goto("/admin/contracts");
  await expect(page.getByRole("region", { name: "미등록 항목", exact: true })).toContainText("기준일 유효 계약 없음");
  await page.getByLabel("시작일", { exact: true }).fill("2027-01-01");
  await page.getByRole("button", { name: "기간 조회" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("최대 366일");
});
test("직원은 모든 관리 화면·데이터 API 접근이 차단된다", async ({ page }) => {
  await login(page, "employee");
  for (const route of [...teamRoutes, ...adminRoutes]) {
    expect((await page.request.get(route.path)).url()).toContain("/me?denied=1");
    const area = route.key.startsWith("team") ? "team" : "admin";
    if (route.key !== area) expect((await page.request.get(`/api/${area}/management/${route.key}?from=2026-11-01&to=2026-12-01`)).status()).toBe(403);
  }
});
test("부서장 타부서·임금·검증 비밀 접근 차단", async ({ page }) => {
  await pool.query("update employees set department_id='d2' where id='admin'");
  await login(page, "manager");
  for (const key of ["team-attendance", "team-detail", "team-calendar"]) {
    const response = await page.request.get(`/api/team/management/${key}?from=2026-11-01&to=2026-12-01`);
    expect(response.status()).toBe(200); expect(response.headers()['cache-control']).toBe('no-store');
    const result = await response.json();
    expect(result.employees.some((e: { id: string }) => e.id === 'admin')).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/hourlyRate|payroll|password|verificationEvidence/);
    expect((await page.request.get(`/api/team/management/${key}?from=2026-11-01&to=2026-12-01&employeeId=admin`)).status()).toBe(403);
  }
  for (const route of adminRoutes.filter(r => r.key !== 'admin')) expect((await page.request.get(`/api/admin/management/${route.key}?from=2026-11-01&to=2026-12-01`)).status()).toBe(403);
  await page.context().clearCookies();
  expect((await page.request.get('/api/team/management/team-calendar?from=2026-11-01&to=2026-12-01')).status()).toBe(401);
});
test("실제 대시보드 검색·필터와 미확정 정산", async ({ page }) => {
  await pool.query("update employees set department_id='d2' where id='admin'");
  await pool.query("insert into payroll.payroll_periods(id,period_start,period_end) values('pending-period','2026-11-01','2026-12-01')");
  await login(page, "admin"); await page.goto("/admin");
  await expect(page.getByRole("region", { name: "임금·정산 현황", exact: true })).toContainText("추가 지급액 미확정 · 총액 미확정");
  const list = page.getByRole("region", { name: "직원별 근무 현황" });
  await page.getByRole("combobox", { name: "부서", exact: true }).selectOption("d2");
  await expect(list.getByRole("rowheader")).toHaveCount(1);
});
test("관리자 종료 근무일 재계산을 실제 API에 연결한다", async ({ page }) => {
  await pool.query("insert into work_sessions(id,employee_id,work_date,clock_in_at,clock_out_at,calculation_version,work_policy_id,input_snapshot,status) values('s','employee','2026-11-12','2026-11-12T09:00:00+09','2026-11-12T10:00:00+09',1,'standard','{}','UNRESOLVED')");
  for (const [id,type,time] of [["in","CLOCK_IN","09:00"],["out","CLOCK_OUT","10:00"]]) await pool.query("insert into attendance_events(id,employee_id,work_session_id,event_type,occurred_at,source,verification_status,verification_evidence,request_id) values($1,'employee','s',$2,$3,'PC','ACCEPTED','{}',$1)",[id,type,`2026-11-12T${time}:00+09`]);
  await login(page, "admin"); await page.goto('/admin/attendance?employeeId=employee&workDate=2026-11-12');
  await expect(page.getByText(/실제 DB 조회/)).toBeVisible();
  await page.getByRole('button', { name: '선택 근무일 재계산' }).click();
  await expect(page.getByRole('status')).toContainText('재계산을 완료했습니다.');
  await expect(page.getByRole('region', { name: '계산 버전 이력', exact: true }).getByRole('row')).toHaveCount(3);
  expect((await pool.query("select count(*)::int as n from attendance_events where work_session_id='s'")).rows[0].n).toBe(2);
});
test("관리자 저장된 정산을 선택하면 근거와 미확정 금액을 표시한다", async ({ page }) => {
  await pool.query("insert into payroll.payroll_periods(id,period_start,period_end) values('p','2026-11-01','2026-12-01')");
  await pool.query("insert into payroll.compensation_contracts(id,employee_id,effective_from) values('contract','employee','2026-01-01')");
  await pool.query("insert into payroll.payroll_calculations(id,payroll_period_id,employee_id,contract_id,regular_minutes,overtime_minutes,night_overtime_minutes,included_overtime_minutes,regular_pay,calculation_version,status,unresolved_reasons,input_snapshot) values('c','p','employee','contract',480,1200,0,960,96000,1,'UNRESOLVED','[\"ALLOCATION\"]','{\"basis\":\"stored\"}')");
  await login(page, "admin"); await page.goto('/admin/settlements');
  const list = page.getByRole('region', { name: '정산 목록 · 직원별 최신 버전', exact: true });
  await expect(list).toContainText('미확정');
  await list.getByRole('button', { name: /employee.*정산 선택/ }).click();
  await expect(page.getByRole('region', { name: '선택 정산', exact: true })).toContainText('stored');
  await expect(page.getByRole('region', { name: '계산 근거', exact: true })).toContainText('조회 결과가 없습니다.');
  await expect(page.getByRole('region', { name: '미구현 기능', exact: true })).toContainText('Excel');
});

for (const area of ["team", "admin"] as const) {
  test(`${area} 일별 집계는 직원 선택 시에만 막대그래프로 표시한다`, async ({ page }) => {
    await login(page, area === "admin" ? "admin" : "manager");
    await page.goto(`/${area}/attendance`);
    await expect(page.getByText(/실제 DB 조회/)).toBeVisible();
    const chart = page.getByRole("region", { name: "일별 집계", exact: true });
    await expect(chart).toHaveCount(0);
    await page.getByLabel("직원", { exact: true }).selectOption("employee");
    await expect(chart).toBeVisible();
    await expect(chart.getByRole("table")).toHaveCount(0);
    await expect(chart.getByRole("list", { name: "일별 근로시간 막대그래프" })).toBeVisible();
    await expect(chart).toContainText("실근로");
    await chart.getByRole("button", { name: /근태 상세 선택/ }).first().click();
    await expect(page.getByRole("heading", { name: /선택 근무일/ })).toBeVisible();
    await expect(page.getByRole("region", { name: "원본 이벤트", exact: true })).toBeVisible();
    await page.getByLabel("직원", { exact: true }).selectOption("");
    await expect(page.getByText(/실제 DB 조회/)).toBeVisible();
    await expect(chart).toHaveCount(0);
  });
}

for (const width of [1440, 1024, 390, 320]) {
  test(`관리자 네비게이션 세로 정렬 ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page, "admin");
    await page.goto("/admin");
    const header = page.locator(".ws-header");
    const logo = await header.getByRole("link", { name: "WMS", exact: true }).boundingBox();
    const account = header.locator("summary");
    const accountBox = await account.boundingBox();
    expect(logo).not.toBeNull(); expect(accountBox).not.toBeNull();
    expect(Math.abs(logo!.y + logo!.height / 2 - accountBox!.y - accountBox!.height / 2)).toBeLessThanOrEqual(1);
    const links = header.getByRole("navigation").getByRole("link");
    const first = await links.first().boundingBox();
    for (const link of await links.all()) {
      const box = await link.boundingBox();
      expect(Math.abs(box!.y + box!.height / 2 - first!.y - first!.height / 2)).toBeLessThanOrEqual(1);
      if (width >= 768) expect(Math.abs(box!.y + box!.height / 2 - logo!.y - logo!.height / 2)).toBeLessThanOrEqual(1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await account.click();
    await expect(header.getByRole("link", { name: "비밀번호 변경" })).toBeVisible();
    const menu = await header.locator(".ws-account > div").boundingBox();
    expect(menu!.y).toBeGreaterThanOrEqual(accountBox!.y + accountBox!.height);
  });
}
