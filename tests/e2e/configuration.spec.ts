import { test, expect, type Page } from "@playwright/test";
import { testPool, seed, initialPassword } from "../fixtures";
import { seedAttendance } from "../attendance-fixtures";
const pool = testPool();
test.beforeEach(async () => {
  // A closing page can still have a read transaction in flight when TRUNCATE starts.
  try { await seed(pool); } catch (e) { if ((e as { code?: string }).code !== "40P01") throw e; await seed(pool); }
  await seedAttendance(pool);
});
test.afterAll(async () => { await pool.end(); });
async function login(page: Page, role = "admin") {
  await page.goto("/login"); await page.getByLabel("회사 이메일").fill(`${role}@example.com`);
  await page.getByLabel("비밀번호", { exact: true }).fill(initialPassword);
  await page.getByRole("button", { name: "로그인", exact: true }).click(); await expect(page).toHaveURL(/\/me$/);
}
test("관리자가 부서·직원을 등록하고 근무지와 정책을 편집한다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await login(page); await page.goto("/admin/organization");
  await page.getByRole("region", { name: "부서 정보", exact: true }).getByRole("button", { name: "추가", exact: true }).click();
  const editor = page.getByRole("region", { name: "관리 데이터 편집", exact: true });
  await editor.getByLabel("부서명", { exact: true }).fill("신규 부서");
  await editor.getByRole("button", { name: "변경 저장" }).click();
  await expect(editor.getByRole("status").filter({ hasText: "저장했습니다" })).toContainText("저장했습니다");
  await page.getByRole("button", { name: "닫기", exact: true }).click();
    await page.getByRole("region", { name: "직원 목록", exact: true }).getByRole("button", { name: "추가", exact: true }).click();
  await editor.getByLabel("직원 이름").fill("신규 직원"); await editor.getByLabel("직원 이메일").fill("new-ui@example.com");
  await editor.getByLabel("임시 비밀번호", { exact: true }).fill(initialPassword);
  await editor.getByRole("button", { name: "변경 저장" }).click();
  await expect(editor.getByRole("status").filter({ hasText: "저장했습니다" })).toContainText("저장했습니다");
  await expect(page.getByRole("region", { name: "직원 목록", exact: true })).toContainText("신규 직원");
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("region", { name: "직원 목록", exact: true }).getByRole("button", { name: "admin 수정", exact: true }).click();
  await editor.getByRole("button", { name: "계정 활성 상태 변경", exact: true }).click();
  await editor.getByLabel("변경할 계정 상태").selectOption("false");
  await editor.getByRole("button", { name: "변경 저장" }).click();
  await expect(editor.getByRole("alert")).toContainText("마지막 활성 관리자");
  await page.goto("/admin/settings");
  await page.getByRole("region", { name: "근무지·접속 검증", exact: true }).getByRole("button", { name: "추가", exact: true }).click();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("region", { name: "근무지·접속 검증", exact: true }).getByRole("button", { name: /수정$/ }).first().click();
  await editor.getByLabel("근무지명", { exact: true }).fill("변경 본사");
  await editor.getByLabel("허용 CIDR (한 줄에 하나)").fill("127.0.0.0/8\n::1/128");
  await editor.getByRole("button", { name: "변경 저장" }).click();
  await expect(editor.getByRole("status").filter({ hasText: "저장했습니다" })).toContainText("저장했습니다");
  await expect(page.getByRole("region", { name: "근무지·접속 검증", exact: true })).toContainText("변경 본사");
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("region", { name: "근무 정책", exact: true }).getByRole("button", { name: /수정$/ }).first().click();
  await editor.getByLabel("정책명", { exact: true }).fill("기본");
  const start = new Date(Date.now()+86400000*3).toISOString().slice(0,10);
  await editor.getByLabel("적용 시작일").fill(start);
  await editor.getByRole("button", { name: "변경 저장" }).click();
  await expect(editor.getByRole("status").filter({ hasText: "저장했습니다" })).toContainText("저장했습니다");
  expect((await pool.query("select version from work_policies where name='기본' order by version desc limit 1")).rows[0].version).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/configuration-mobile.png", fullPage: true });
});
test("권한·출처·JSON·충돌을 API에서 차단한다", async ({ page }) => {
  await login(page);
  const url = "/api/admin/configuration";
  const data = await (await page.request.get(url)).json();
  expect((await page.request.post(url, { data: {}, headers: { Origin: "https://evil.example" } })).status()).toBe(403);
  expect((await page.request.post(url, { data: "{", headers: { Origin: "http://localhost:3002", "Content-Type": "application/json" } })).status()).toBe(400);
  const saved = await page.request.post(url, { data: { action: "department.save", name: "API 부서", revision: data.revision }, headers: { Origin: "http://localhost:3002" } });
  expect(saved.status()).toBe(200);
  expect((await page.request.post(url, { data: { action: "department.save", name: "충돌", revision: data.revision }, headers: { Origin: "http://localhost:3002" } })).status()).toBe(409);
  await page.context().clearCookies();
  expect((await page.request.get(url)).status()).toBe(401);
  await login(page, "manager"); expect((await page.request.get(url)).status()).toBe(403);
  expect((await page.request.post(url, { data: {}, headers: { Origin: "http://localhost:3002" } })).status()).toBe(403);
});
for (const width of [1440, 390, 320]) {
  test(`편집 폼 ${width}px 간격·버튼·한국어 역할`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await login(page); await page.goto("/admin/organization");
  await page.getByRole("region", { name: "부서 정보", exact: true }).getByRole("button", { name: "추가", exact: true }).click();
    const editor = page.getByRole("region", { name: "관리 데이터 편집", exact: true });
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    await page.getByRole("region", { name: "직원 목록", exact: true }).getByRole("button", { name: "추가", exact: true }).click();
    await expect(editor.getByRole("heading")).toHaveCount(0);
    await expect(editor.getByRole("button", { name: "편집 데이터 새로고침" })).toHaveCount(0);
    await expect(editor.getByLabel("관리 작업")).toHaveCount(0);
    const roles = editor.getByRole("group", { name: "역할", exact: true });
    const managed = editor.getByRole("group", { name: "부서장 담당 부서", exact: true });
    await expect(managed.getByRole("checkbox").first()).toBeDisabled();
    await roles.getByRole("checkbox", { name: "부서장", exact: true }).check();
    await expect(managed.getByRole("checkbox").first()).toBeEnabled();
    await managed.getByRole("checkbox").first().check();
    await roles.getByRole("checkbox", { name: "부서장", exact: true }).uncheck();
    await expect(managed.getByRole("checkbox").first()).not.toBeChecked();
    await expect(managed.getByRole("checkbox").first()).toBeDisabled();
    const roleBox = await roles.boundingBox(), managedBox = await managed.boundingBox();
    expect(managedBox!.y).toBeGreaterThanOrEqual(roleBox!.y + roleBox!.height);
    for (const label of await roles.locator("label").all()) {
      const box = await label.boundingBox(), checkbox = await label.getByRole("checkbox").boundingBox();
      expect(Math.abs(box!.y + box!.height / 2 - checkbox!.y - checkbox!.height / 2)).toBeLessThanOrEqual(1);
    }
    await expect(editor.getByRole("checkbox", { name: "직원", exact: true })).toBeChecked();
    await expect(editor.getByRole("checkbox", { name: "부서장", exact: true })).toBeVisible();
    await expect(editor.getByRole("checkbox", { name: "관리자", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "직원 목록", exact: true })).toContainText("부서장");
    const name = await editor.getByLabel("직원 이름").boundingBox(), email = await editor.getByLabel("직원 이메일").boundingBox();
    if (width >= 768) { expect(email!.y).toBe(name!.y); expect(email!.x).toBeGreaterThan(name!.x + name!.width); }
    else { expect(email!.x).toBe(name!.x); expect(email!.y).toBeGreaterThan(name!.y + name!.height); }
    const button = editor.getByRole("button", { name: "변경 저장" });
    expect(await button.evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgb(36, 62, 115)");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/configuration-organization-${width}.png`, fullPage: true });
    await page.goto("/admin/settings");
  await page.getByRole("region", { name: "근무지·접속 검증", exact: true }).getByRole("button", { name: "추가", exact: true }).click();
    await expect(editor.getByRole("heading")).toHaveCount(0);
    await expect(editor.getByRole("button", { name: "편집 데이터 새로고침" })).toHaveCount(0);
    await expect(editor.getByLabel("관리 작업")).toHaveCount(0);
    await expect(editor.getByRole("region", { name: "근무지 지도", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await editor.locator(".leaflet-tile-loaded").first().waitFor({ timeout: 15000 });
    await page.screenshot({ path: `test-results/configuration-settings-${width}.png`, fullPage: true });
  });
}

test("조직·권한은 기간 없이 현재 직원·부서를 검색한다", async ({ page }) => {
  await login(page); await page.goto("/admin/organization");
  await expect(page.getByLabel("시작일", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("종료일", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "기간 조회", exact: true })).toHaveCount(0);
  await expect(page.getByText(/최대 366일/)).toHaveCount(0);
  const records = page.getByRole("region", { name: "직원 목록", exact: true });
  await expect(records).toContainText("employee");
  await page.getByRole("searchbox", { name: "이름·내용 검색" }).fill("없는직원");
  await expect(records).toContainText("조회 결과가 없습니다.");
  await page.getByRole("searchbox", { name: "이름·내용 검색" }).fill("");
  await page.getByRole("button", { name: "다시 조회", exact: true }).click();
  await expect(records).toContainText("employee");
  await page.goto("/admin/attendance");
  await expect(page.getByLabel("시작일", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "기간 조회", exact: true })).toBeVisible();
});

test("목록 검색과 편집을 분리하고 닫기·Escape로 목록에 복귀한다", async ({ page }) => {
  await login(page); await page.goto("/admin/organization");
  const modal = page.getByRole("dialog");
  await expect(modal).not.toBeVisible();
  await expect(page.getByRole("region", { name: "관리 데이터 편집", exact: true })).toHaveCount(0);
  await page.getByRole("searchbox", { name: "이름·내용 검색" }).fill("employee");
  const launch = page.getByRole("region", { name: "부서 정보", exact: true }).getByRole("button", { name: "추가", exact: true });
  await launch.click(); await expect(modal).toBeVisible();
  await expect(modal.getByLabel("부서명", { exact: true })).toBeVisible();
  await modal.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(modal).not.toBeVisible(); await expect(launch).toBeFocused();
  await expect(page.getByRole("searchbox", { name: "이름·내용 검색" })).toHaveValue("employee");
  await launch.click(); await page.keyboard.press("Escape");
  await expect(modal).not.toBeVisible();
});
test("지도 클릭·마커 이동·현재 위치로 근무지 좌표를 저장한다", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 37.5, longitude: 127.0 });
  // Stable local tile fixture keeps map interaction independent of the tile service.
  await page.route("https://tile.openstreetmap.org/**", route => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64") }));
  await login(page); await page.goto("/admin/settings");
  await page.getByRole("region", { name: "근무지·접속 검증", exact: true }).getByRole("button", { name: "추가", exact: true }).click();
  const editor = page.getByRole("region", { name: "관리 데이터 편집", exact: true });
  const map = editor.getByRole("region", { name: "근무지 지도", exact: true });
  const save = editor.getByRole("button", { name: "변경 저장", exact: true });
  await expect(save).toBeDisabled();
  await expect(editor.getByRole("button", { name: "지도 중심 선택", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("region", { name: "근무지·접속 검증", exact: true }).getByRole("button", { name: /수정$/ }).first().click();
  const output = editor.getByLabel("선택 위치", { exact: true });
  await expect(output).toContainText("37.5665000");
  await map.click({ position: { x: 150, y: 160 } });
  await expect(output).not.toContainText("37.5665000");
  const before = await output.textContent();
  const marker = map.getByTitle("근무지 위치 (드래그로 이동)");
  const box = await marker.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down(); await page.mouse.move(box!.x + 75, box!.y + 50, { steps: 10 }); await page.mouse.up();
  await expect(output).not.toHaveText(before!);
  await editor.getByRole("button", { name: "현재 위치로 이동", exact: true }).click();
  await expect(output).toContainText("위도 37.5000000 · 경도 127.0000000");
  await save.click(); await expect(editor.getByRole("status").filter({ hasText: "저장했습니다" })).toContainText("저장했습니다");
  const saved = (await pool.query("select latitude::text,longitude::text,gps_radius_meters from workplaces where id='office'")).rows[0];
  expect(saved).toEqual({ latitude: "37.5000000", longitude: "127.0000000", gps_radius_meters: 100 });
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("region", { name: "근무지·접속 검증", exact: true }).getByRole("button", { name: /수정$/ }).first().click();
  await expect(output).toContainText("37.5000000");
});
test("장소명 검색·결과 선택·빈 결과·실패 및 Enter 검색", async ({ page }) => {
  await login(page); await page.goto("/admin/settings");
  await page.getByRole("region", { name: "근무지·접속 검증", exact: true }).getByRole("button", { name: "추가", exact: true }).click();
  const editor = page.getByRole("region", { name: "관리 데이터 편집", exact: true });
  const placeInput = editor.getByRole("searchbox", { name: "장소명·주소 검색" });
  let calls = 0;
  await page.route("**/api/admin/places?*", async route => {
    calls++;
    const q = new URL(route.request().url()).searchParams.get("q");
    await route.fulfill({ status: q === "오류" ? 502 : 200, json: q === "오류" ? { error: "검색 연결 오류" } : { places: q === "없음" ? [] : [{ id: "1", name: "서울시청", address: "서울특별시 중구 세종대로 110", latitude: "37.5663000", longitude: "126.9779000" }] } });
  });
  await expect(editor.getByRole("button", { name: "지도 중심 선택" })).toBeEnabled();
  await placeInput.fill("서울시청"); expect(calls).toBe(0);
  await placeInput.press("Enter");
  const results = editor.getByRole("list", { name: "장소 검색 결과" });
  await expect(results).toContainText("서울특별시 중구 세종대로 110");
  await results.getByRole("button", { name: /서울시청/ }).click();
  await expect(editor.getByLabel("선택 위치", { exact: true })).toContainText("37.5663000");
  await expect(editor.getByRole("button", { name: "변경 저장" })).toBeEnabled();
  await expect(editor.getByRole("status").filter({ hasText: "저장했습니다" })).toHaveCount(0);
  await placeInput.fill("없음"); await editor.getByRole("button", { name: "장소 검색", exact: true }).click();
  await expect(editor.getByText(/검색 결과가 없습니다/)).toBeVisible();
  await placeInput.fill("오류"); await placeInput.press("Enter");
  await expect(editor.getByRole("alert").filter({ hasText: "검색 연결 오류" })).toBeVisible();
  await expect(editor.getByLabel("선택 위치", { exact: true })).toContainText("37.5663000");
});

test("장소 검색 API는 관리자만 접근하고 검색어를 검증한다", async ({ page }) => {
  const url = "/api/admin/places?q=서울시청";
  expect((await page.request.get(url)).status()).toBe(401);
  await login(page, "employee"); expect((await page.request.get(url)).status()).toBe(403);
  await page.context().clearCookies(); await login(page, "admin");
  expect((await page.request.get("/api/admin/places?q=x")).status()).toBe(400);
});

test("패널별 추가와 행별 수정은 해당 대상을 바로 연다", async ({ page }) => {
  await login(page); await page.goto("/admin/organization");
  await expect(page.getByRole("button", { name: "조직·권한 편집", exact: true })).toHaveCount(0);
  const editor = page.getByRole("region", { name: "관리 데이터 편집", exact: true });
  const close = () => page.getByRole("button", { name: "닫기", exact: true }).click();
  const departments = page.getByRole("region", { name: "부서 정보", exact: true });
  await departments.getByRole("button", { name: /수정$/ }).first().click();
  const original = await editor.getByLabel("부서명", { exact: true }).inputValue();
  expect(original).not.toBe("");
  await expect(editor.getByLabel("편집 대상")).toHaveCount(0);
  await editor.getByLabel("부서명", { exact: true }).fill("패널 수정 부서");
  await editor.getByRole("button", { name: "변경 저장" }).click();
  await expect(editor.getByRole("status")).toContainText("저장했습니다");
  await close(); await expect(departments).toContainText("패널 수정 부서");
  await departments.getByRole("button", { name: "추가", exact: true }).click();
  await expect(editor.getByLabel("부서명", { exact: true })).toHaveValue("");
  await close();
  await page.getByRole("region", { name: "직원 목록", exact: true }).getByRole("button", { name: "employee 수정", exact: true }).click();
  await expect(editor.getByLabel("직원 이름")).toHaveValue("employee");
  await editor.getByLabel("직원 이름").fill("수정 직원");
  await editor.getByRole("button", { name: "변경 저장" }).click();
  await expect(editor.getByRole("status")).toContainText("저장했습니다");
  await close();
  await expect(page.getByRole("region", { name: "직원 목록", exact: true })).toContainText("수정 직원");
  await page.goto("/admin/settings");
  await expect(page.getByRole("button", { name: "근무 설정 편집", exact: true })).toHaveCount(0);
  for (const title of ["근무 정책", "근무지·접속 검증", "정책 적용 이력"]) {
    await expect(page.getByRole("region", { name: title, exact: true }).getByRole("button", { name: "추가", exact: true })).toBeVisible();
  }
  const assignments = page.getByRole("region", { name: "정책 적용 이력", exact: true });
  await assignments.getByRole("row").filter({ hasText: "수정 직원" }).getByRole("button", { name: /수정$/ }).first().click();
  await expect(editor.getByLabel("정책 배정 직원")).toHaveValue("employee");
  await expect(editor.getByLabel("배정 정책")).toHaveValue("standard");
  await expect(editor.getByLabel("적용 시작일")).toHaveValue("");
  await close();
  await assignments.getByRole("button", { name: "추가", exact: true }).click();
  await expect(editor.getByLabel("정책 배정 직원")).toHaveValue("");
});

test("부서장 역할을 해제해 저장하면 담당 부서 배정도 제거된다", async ({ page }) => {
  await login(page); await page.goto("/admin/organization");
  await page.getByRole("region", { name: "직원 목록", exact: true }).getByRole("button", { name: "manager 수정", exact: true }).click();
  const editor = page.getByRole("region", { name: "관리 데이터 편집", exact: true });
  await expect(editor.getByLabel("관리 작업")).toHaveCount(0);
  const roles = editor.getByRole("group", { name: "역할", exact: true });
  const managed = editor.getByRole("group", { name: "부서장 담당 부서", exact: true });
  await expect(roles.getByRole("checkbox", { name: "부서장", exact: true })).toBeChecked();
  await expect(managed.getByRole("checkbox").first()).toBeEnabled();
  await roles.getByRole("checkbox", { name: "부서장", exact: true }).uncheck();
  await expect(managed.getByRole("checkbox").first()).toBeDisabled();
  await editor.getByRole("button", { name: "변경 저장" }).click();
  await expect(editor.getByRole("status")).toContainText("저장했습니다");
  expect((await pool.query("select * from managed_departments where employee_id='manager'")).rowCount).toBe(0);
  await editor.getByRole("button", { name: "임시 비밀번호 재설정", exact: true }).click();
  await expect(editor.getByLabel("임시 비밀번호", { exact: true })).toBeVisible();
});

for (const width of [1440, 390, 320]) {
  test(`직원 수정 탭 구분과 전환 ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await login(page); await page.goto("/admin/organization");
    await page.getByRole("region", { name: "직원 목록", exact: true }).getByRole("button", { name: "employee 수정", exact: true }).click();
    const editor = page.getByRole("region", { name: "관리 데이터 편집", exact: true });
    const group = editor.getByRole("group", { name: "직원 수정 항목" });
    const modes = group.getByRole("button");
    const firstBox = await modes.first().boundingBox();
    for (const button of await modes.all()) {
      const box = await button.boundingBox();
      expect(box!.y).toBe(firstBox!.y);
      expect(box!.height).toBeGreaterThanOrEqual(42);
      expect(Math.abs(box!.width - firstBox!.width)).toBeLessThanOrEqual(1);
    }
    for (const [label, field] of [["계정 활성 상태 변경", "변경할 계정 상태"], ["임시 비밀번호 재설정", "임시 비밀번호"], ["직원 정보·권한 수정", "직원 이름"]]) {
      const button = group.getByRole("button", { name: label, exact: true });
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await expect(group.locator('[aria-pressed="true"]')).toHaveCount(1);
      expect(await button.evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgb(36, 62, 115)");
      await expect(editor.getByLabel(field, { exact: true })).toBeVisible();
    }
    await modes.first().focus();
    await page.keyboard.press("Tab");
    await expect(modes.nth(1)).toBeFocused();
    expect(await modes.nth(1).evaluate(el => getComputedStyle(el).outlineStyle)).toBe("solid");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/employee-tabs-${width}.png`, fullPage: true });
  });
}
