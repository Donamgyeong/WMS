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
  await expect(page.getByRole("heading")).toHaveText("employee님");
  await page.reload();
  await expect(page.getByRole("heading")).toHaveText("employee님");
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/me\?denied=1$/);
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("접근 권한이 없습니다.");
  expect((await page.request.get("/api/admin/payroll")).status()).toBe(403);
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
  await expect(page.getByRole("heading")).toHaveText("new님");
});
test("부서장과 관리자의 접근 범위를 구분한다", async ({ page }) => {
  await login(page, "manager@example.com");
  await expect(page).toHaveURL(/\/me$/);
  await page.getByRole("link", { name: "부서 관리" }).click();
  await expect(page.getByRole("heading")).toHaveText("부서 관리");
  expect((await page.request.get("/api/admin/payroll")).status()).toBe(403);
  await page.goto("/me");
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await login(page, "admin@example.com");
  await expect(page).toHaveURL(/\/me$/);
  await page.getByRole("link", { name: "관리자", exact: true }).click();
  await expect(page.getByRole("heading")).toHaveText("관리자");
  expect((await page.request.get("/api/admin/payroll")).status()).toBe(200);
});
