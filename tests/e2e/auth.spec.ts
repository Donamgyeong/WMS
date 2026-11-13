import { test, expect } from "@playwright/test";
import { testPool, seed, initialPassword, changedPassword } from "../fixtures";
const pool = testPool();
test.beforeEach(async () => {
  await seed(pool);
});
test.afterAll(async () => {
  await pool.end();
});
async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("회사 이메일").fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(initialPassword);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
}
test("로그인·새로고침·직접 경로 차단·로그아웃", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login$/);
  await login(page, "employee@example.com");
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("오늘도, 나의 속도로.");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("오늘도, 나의 속도로.");
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/me\?denied=1$/);
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("접근 권한이 없습니다.");
  expect((await page.request.get("/api/admin/payroll")).status()).toBe(403);
  await page.locator("summary").click();
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get("/api/me")).status()).toBe(401);
});
test("초기 비밀번호 변경을 완료해야 업무 화면에 진입한다", async ({ page }) => {
  await login(page, "new@example.com");
  await expect(page).toHaveURL(/\/change-password$/);
  await page.getByLabel("현재 비밀번호").fill(initialPassword);
  await page
    .getByLabel("새 비밀번호 (12~128자)", { exact: true })
    .fill(changedPassword);
  await page.getByLabel("새 비밀번호 확인").fill(changedPassword);
  await page
    .getByRole("button", { name: "비밀번호 변경", exact: true })
    .click();
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("오늘도, 나의 속도로.");
});
test("부서장과 관리자의 접근 범위를 구분한다", async ({ page }) => {
  await login(page, "manager@example.com");
  await expect(page).toHaveURL(/\/me$/);
  await page.locator("summary").click();
  await page.getByRole("link", { name: "부서 관리" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("우리 부서의 오늘");
  expect((await page.request.get("/api/admin/payroll")).status()).toBe(403);
  await page.goto("/me");
  await page.locator("summary").click();
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await login(page, "admin@example.com");
  await expect(page).toHaveURL(/\/me$/);
  await page.locator("summary").click();
  await page.getByRole("link", { name: "관리자", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("전체 운영 현황");
  expect((await page.request.get("/api/admin/payroll")).status()).toBe(200);
});

for (const width of [1440, 390, 320]) {
  test(`직원 대시보드 ${width}px 레이아웃과 예시 버튼`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await login(page, "employee@example.com");
    await expect(page).toHaveURL(/\/me$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("오늘도, 나의 속도로.");
    await expect(page.getByRole("button", { name: "출근하기", exact: true })).toBeDisabled();
    await expect(page.getByLabel("요일별 실제 근로시간 예시").getByRole("listitem")).toHaveCount(7);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const work = await page.getByRole("region", { name: "출퇴근·휴게 기록", exact: true }).locator("..").boundingBox();
    const week = await page.getByRole("region", { name: "이번 주 근로시간 · 예시" }).boundingBox();
    const attention = await page.getByRole("region", { name: "확인할 사항" }).boundingBox();
    if (width < 768) {
      expect(attention!.y).toBeGreaterThan(work!.y + work!.height);
      expect(week!.y).toBeGreaterThan(attention!.y + attention!.height);
    } else {
      expect(week!.y).toBe(work!.y);
      expect(week!.x).toBeGreaterThan(work!.x);
    }
    const writes: string[] = [];
    page.on("request", request => { if (request.method() === "POST") writes.push(request.url()); });
    for (const name of ["11월 10일 퇴근 기록 누락 · 상세 보기 →"]) {
      await page.getByRole("button", { name, exact: true }).click();
      await expect(page.getByRole("status")).toContainText("실제 근태 기록을 저장하지 않습니다.");
      await page.getByRole("button", { name: "닫기", exact: true }).click();
      await expect(page.getByRole("status")).toHaveCount(0);
    }
    expect(writes).toEqual([]);
    await page.getByRole("link", { name: "내 근태", exact: true }).click();
    await expect(page).toHaveURL(/#today-records$/);
    await page.screenshot({ path: `test-results/dashboard-${width}.png`, fullPage: true });
  });
}

for (const javaScriptEnabled of [true, false]) {
  test(`로그인 POST와 URL 자격증명 비노출 (JavaScript ${javaScriptEnabled ? "켜짐" : "꺼짐"})`, async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled });
    const page = await context.newPage();
    const requests: import("@playwright/test").Request[] = [];
    page.on("request", request => requests.push(request));
    try {
      await page.goto("http://localhost:3002/login");
      await expect(page.locator("form")).toHaveAttribute("method", "post");
      await page.getByLabel("회사 이메일").fill("employee@example.com");
      await page.getByLabel("비밀번호", { exact: true }).fill("wrong-password-123");
      await page.getByRole("button", { name: "로그인", exact: true }).click();
      await expect(page).toHaveURL(/\/login\?error=credentials$/);
      await expect(page.getByRole("main").getByRole("alert")).toHaveText("이메일 또는 비밀번호를 확인하세요.");
      await page.getByLabel("회사 이메일").fill("employee@example.com");
      await page.getByLabel("비밀번호", { exact: true }).fill(initialPassword);
      await page.getByRole("button", { name: "로그인", exact: true }).click();
      await expect(page).toHaveURL(/\/me$/);
      expect((await page.request.get("http://localhost:3002/api/me")).status()).toBe(200);
      await page.goto("http://localhost:3002/login");
      await expect(page).toHaveURL(/\/me$/);
      const submissions = requests.filter(request => new URL(request.url()).pathname === "/api/session/login");
      expect(submissions).toHaveLength(2);
      for (const request of submissions) {
        expect(request.method()).toBe("POST");
        expect(new URL(request.url()).search).toBe("");
        expect(new URLSearchParams(request.postData()!).get("email")).toBe("employee@example.com");
      }
      for (const request of requests) {
        const url = new URL(request.url());
        for (const key of ["email", "password", "id", "pw"]) expect(url.searchParams.has(key)).toBe(false);
      }
      await page.goto("http://localhost:3002/change-password");
      await page.getByLabel("현재 비밀번호").fill(initialPassword);
      await page.getByLabel("새 비밀번호 (12~128자)", { exact: true }).fill(changedPassword);
      await page.getByLabel("새 비밀번호 확인").fill(changedPassword);
      await page.getByRole("button", { name: "비밀번호 변경", exact: true }).click();
      await expect(page).toHaveURL(/\/me$/);
      await page.locator("summary").click();
      await page.getByRole("button", { name: "로그아웃", exact: true }).click();
      await expect(page).toHaveURL(/\/login$/);
      expect((await page.request.get("http://localhost:3002/api/me")).status()).toBe(401);
      for (const request of requests) {
        expect(new URL(request.url()).searchParams.has("currentPassword")).toBe(false);
        expect(new URL(request.url()).searchParams.has("newPassword")).toBe(false);
      }
    } finally { await context.close(); }
  });
}
