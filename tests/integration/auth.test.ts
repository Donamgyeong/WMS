import { spawnSync } from "node:child_process";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { testPool, seed, initialPassword, changedPassword } from "../fixtures";
const pool = testPool();
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.BETTER_AUTH_SECRET =
  "test-only-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
process.env.BETTER_AUTH_URL = "http://localhost:3002";
const { POST, GET } = await import("../../src/app/api/auth/[...all]/route");
const { protectedResponse } =
  await import("../../src/modules/identity/service");
const { consumeLoginAttempt } =
  await import("../../src/modules/identity/throttle");
const origin = "http://localhost:3002";
async function post(
  path: string,
  body: unknown = {},
  cookie = "",
  requestOrigin = origin,
) {
  return POST(
    new Request(`${origin}/api/auth${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: requestOrigin,
        cookie,
      },
      body: JSON.stringify(body),
    }),
  );
}
async function login(
  email = "employee@example.com",
  password = initialPassword,
) {
  const response = await post("/sign-in/email", { email, password });
  expect(response.status).toBe(200);
  return response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}
function request(cookie = "") {
  return new Request(`${origin}/api/me`, { headers: { cookie } });
}
beforeAll(async () => {
  await pool.query("SELECT 1");
});
beforeEach(async () => {
  await seed(pool);
});
afterAll(async () => {
  await pool.end();
  const globalDb = globalThis as unknown as { wmsPool?: import("pg").Pool };
  await globalDb.wmsPool?.end();
});
describe("인증 DB/API", () => {
  it("공개 가입과 미인증 접근을 차단한다", async () => {
    expect(
      (
        await post("/sign-up/email", {
          email: "x@example.com",
          name: "x",
          password: initialPassword,
        })
      ).status,
    ).toBe(404);
    expect((await protectedResponse(request())).status).toBe(401);
  });
  it("로그인, 최소 사용자 응답, 로그아웃 후 재사용 차단", async () => {
    const cookie = await login();
    expect(cookie).toContain("session_token");
    const response = await protectedResponse(request(cookie));
    expect(response.status).toBe(200);
    expect(Object.keys(await response.json()).sort()).toEqual([
      "email",
      "employeeId",
      "name",
      "roles",
    ]);
    expect((await post("/sign-out", {}, cookie)).status).toBe(200);
    expect((await protectedResponse(request(cookie))).status).toBe(401);
  });
  it("없는 계정과 잘못된 비밀번호 응답이 같다", async () => {
    const a = await post("/sign-in/email", {
      email: "missing@example.com",
      password: initialPassword,
    });
    const b = await post("/sign-in/email", {
      email: "employee@example.com",
      password: "wrong",
    });
    expect(a.status).toBe(401);
    expect(await a.json()).toEqual(await b.json());
  });
  it("역할 및 비활성 상태 변경을 기존 세션에 즉시 반영한다", async () => {
    const cookie = await login();
    expect((await protectedResponse(request(cookie), "ADMIN")).status).toBe(
      403,
    );
    await pool.query(
      "UPDATE employee_roles SET role='ADMIN' WHERE employee_id='employee'",
    );
    expect((await protectedResponse(request(cookie), "ADMIN")).status).toBe(
      200,
    );
    await pool.query("UPDATE employees SET active=false WHERE id='employee'");
    expect((await protectedResponse(request(cookie))).status).toBe(401);
    expect(
      (
        await post("/sign-in/email", {
          email: "employee@example.com",
          password: initialPassword,
        })
      ).status,
    ).toBe(401);
  });
  it("세션 만료와 부서장의 임금 접근을 차단한다", async () => {
    const cookie = await login("manager@example.com");
    expect((await protectedResponse(request(cookie), "ADMIN")).status).toBe(
      403,
    );
    expect((await protectedResponse(request(cookie), "MANAGER")).status).toBe(
      200,
    );
    await pool.query(
      "UPDATE auth_sessions SET expires_at=now()-interval '1 minute'",
    );
    expect((await protectedResponse(request(cookie))).status).toBe(401);
  });
  it("초기 비밀번호 변경 후 접근과 이전 비밀번호 차단", async () => {
    const cookie = await login("new@example.com");
    expect((await protectedResponse(request(cookie))).status).toBe(403);
    expect(
      (
        await post(
          "/change-password",
          { currentPassword: initialPassword, newPassword: initialPassword },
          cookie,
        )
      ).status,
    ).toBe(400);
    const changed = await post(
      "/change-password",
      {
        currentPassword: initialPassword,
        newPassword: changedPassword,
        revokeOtherSessions: true,
      },
      cookie,
    );
    expect(changed.status).toBe(200);
    const newCookie = changed.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    expect((await protectedResponse(request(cookie))).status).toBe(401);
    expect((await protectedResponse(request(newCookie))).status).toBe(200);
    expect(
      (
        await post("/sign-in/email", {
          email: "new@example.com",
          password: initialPassword,
        })
      ).status,
    ).toBe(401);
    await login("new@example.com", changedPassword);
  });
  it("다른 출처 요청과 외부 리다이렉트를 차단한다", async () => {
    const cookie = await login();
    expect(
      (await post("/sign-out", {}, cookie, "https://evil.example")).status,
    ).toBe(403);
    expect(
      (
        await post("/sign-in/email", {
          email: "employee@example.com",
          password: initialPassword,
          callbackURL: "https://evil.example",
        })
      ).status,
    ).not.toBe(200);
  });
  it("계정별 제한은 병렬 요청에도 5회만 허용한다", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        consumeLoginAttempt("limited@example.com"),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(5);
    const response = await post("/sign-in/email", {
      email: "limited@example.com",
      password: initialPassword,
    });
    expect(response.status).toBe(429);
  });
  it("쿠키에 HttpOnly와 SameSite를 설정한다", async () => {
    const r = await post("/sign-in/email", {
      email: "admin@example.com",
      password: initialPassword,
    });
    expect(r.headers.get("set-cookie")).toMatch(/httponly/i);
    expect(r.headers.get("set-cookie")).toMatch(/samesite=lax/i);
  });
  it("세션은 브라우저 유지 옵션과 무관하게 8시간 후 만료된다", async () => {
    await login();
    const { rows } = await pool.query(
      "SELECT extract(epoch from (expires_at - created_at)) AS seconds FROM auth_sessions",
    );
    expect(Number(rows[0].seconds)).toBeGreaterThan(28790);
    expect(Number(rows[0].seconds)).toBeLessThan(28810);
  });
  it("잘못된 JSON 및 Origin 없는 변경 요청을 거부한다", async () => {
    expect((await post("/sign-in/email", null)).status).toBe(400);
    expect(
      (
        await POST(
          new Request(`${origin}/api/auth/sign-out`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          }),
        )
      ).status,
    ).toBe(403);
  });
  it("CLI 계정 발급·중복 차단·역할 변경·비활성화를 검증한다", async () => {
    const run = (args: string[], input?: string) =>
      spawnSync(
        process.execPath,
        ["--import", "tsx", "scripts/accounts.ts", ...args],
        {
          env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
          input,
          encoding: "utf8",
        },
      );
    expect(
      run(
        ["create", "cli@example.com", "CLI", "MANAGER", "개발"],
        initialPassword,
      ).status,
    ).toBe(0);
    expect(
      run(["create", "cli@example.com", "CLI", "EMPLOYEE"], initialPassword)
        .status,
    ).not.toBe(0);
    const cookie = await login("cli@example.com");
    expect(run(["roles", "cli@example.com", "CLI", "ADMIN"]).status).toBe(0);
    expect((await protectedResponse(request(cookie))).status).toBe(401);
    expect(run(["disable", "cli@example.com"]).status).toBe(0);
    expect(
      (
        await post("/sign-in/email", {
          email: "cli@example.com",
          password: initialPassword,
        })
      ).status,
    ).toBe(401);
  });
  it("활성 사용자만 세션을 조회한다", async () => {
    const cookie = await login();
    const response = await GET(
      new Request(`${origin}/api/auth/get-session`, { headers: { cookie } }),
    );
    expect(response.status).toBe(200);
    await pool.query("UPDATE employees SET active=false WHERE id='employee'");
    expect(
      (
        await GET(
          new Request(`${origin}/api/auth/get-session`, {
            headers: { cookie },
          }),
        )
      ).status,
    ).toBe(401);
  });
});
