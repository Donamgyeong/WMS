import { test, expect } from "@playwright/test";
import { testPool, seed, initialPassword } from "../fixtures";
import { seedAttendance } from "../attendance-fixtures";
const pool = testPool();
test.beforeEach(async () => { await seed(pool); await seedAttendance(pool); });
test.afterAll(async () => { await pool.end(); });
async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("회사 이메일").fill("employee@example.com");
  await page.getByLabel("비밀번호", { exact: true }).fill(initialPassword);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/me$/);
}
for (const withoutRandomUUID of [false, true]) {
test(`PC 출근·다중 휴게·퇴근과 새로고침 (randomUUID 미지원: ${withoutRandomUUID})`, async ({ page }) => {
  if (withoutRandomUUID) await page.addInitScript(() => { Object.defineProperty(Crypto.prototype, "randomUUID", { value: undefined, configurable: true }); });
  await login(page);
  const panel = page.getByRole("region", { name: "출퇴근·휴게 기록" });
  await expect(panel.getByText("출근 전", { exact: true })).toBeVisible();
  for (const name of ["출근하기", "휴게 시작", "휴게 종료", "휴게 시작", "휴게 종료", "퇴근하기"]) {
    await panel.getByRole("button", { name, exact: true }).click();
    await expect(panel.getByRole("status")).toHaveText("기록했습니다.");
  }
  await expect(panel.getByText("퇴근 완료", { exact: true })).toBeVisible();
  await page.reload();
  await expect(panel.getByText("퇴근 완료", { exact: true })).toBeVisible();
  await expect(panel.getByRole("listitem")).toHaveCount(6);
  expect((await pool.query("select * from attendance_events where verification_status='ACCEPTED'")).rowCount).toBe(6);
});
}
test("모바일 GPS 100m 안과 밖", async ({ browser }) => {
  const context = await browser.newContext({ userAgent: "Mozilla/5.0 iPhone Mobile", permissions: ["geolocation"], geolocation: { latitude: 37.57, longitude: 126.978 } });
  const page = await context.newPage();
  try {
    await login(page);
    const panel = page.getByRole("region", { name: "출퇴근·휴게 기록" });
    await panel.getByRole("button", { name: "출근하기", exact: true }).click();
    await expect(panel.getByRole("alert")).toContainText("근무지 검증에 실패");
    await context.setGeolocation({ latitude: 37.5665, longitude: 126.978 });
    await panel.getByRole("button", { name: "출근하기", exact: true }).click();
    await expect(panel.getByText("근무 중", { exact: true })).toBeVisible();
    expect((await pool.query("select * from attendance_events where source='MOBILE'")).rowCount).toBe(2);
  } finally { await context.close(); }
});
test("randomUUID 미지원 환경에서 응답 유실 후 같은 요청 ID로 재시도", async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(Crypto.prototype, "randomUUID", { value: undefined, configurable: true }); });
  await login(page);
  let first = true;
  await page.route("**/api/attendance/events", async route => {
    if (!first) return route.continue();
    first = false;
    await route.fetch(); // Server committed; client did not receive the response.
    await route.abort("failed");
  });
  const panel = page.getByRole("region", { name: "출퇴근·휴게 기록" });
  await panel.getByRole("button", { name: "출근하기", exact: true }).click();
  await panel.getByRole("button", { name: "같은 요청으로 다시 시도" }).click();
  await expect(panel.getByText("근무 중", { exact: true })).toBeVisible();
  expect((await pool.query("select * from attendance_events")).rowCount).toBe(1);
});
