import { consumeLoginAttempt } from "@/modules/identity/throttle";
import { getAuth } from "@/modules/identity/auth";
import { currentPrincipal } from "@/modules/identity/service";
import { getDb } from "@/db";
import { employees } from "@/db/schema";
import { eq } from "drizzle-orm";
export const runtime = "nodejs";
const allowed = new Set([
  "/sign-in/email",
  "/sign-out",
  "/get-session",
  "/change-password",
]);
async function handle(request: Request) {
  if (request.method === "POST") {
    const origin =
      process.env.BETTER_AUTH_URL &&
      new URL(process.env.BETTER_AUTH_URL).origin;
    if (
      !origin ||
      request.headers.get("origin") !== origin ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      return Response.json(
        { error: "허용되지 않은 출처입니다." },
        { status: 403 },
      );
    if (
      !request.headers
        .get("content-type")
        ?.split(";")[0]
        .trim()
        .toLowerCase()
        .match(/^application\/json$/)
    )
      return Response.json(
        { error: "JSON 요청이 필요합니다." },
        { status: 415 },
      );
  }
  const path = new URL(request.url).pathname.slice("/api/auth".length);
  if (!allowed.has(path))
    return Response.json({ error: "Not found" }, { status: 404 });
  if (
    request.method === "POST" &&
    (path === "/sign-in/email" || path === "/change-password")
  ) {
    let body;
    try {
      body = await request.clone().json();
    } catch {
      return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
    if (path === "/sign-in/email") {
      if (
        typeof body.email !== "string" ||
        body.email.length > 254 ||
        typeof body.password !== "string" ||
        body.password.length > 128
      )
        return Response.json({ error: "잘못된 요청입니다." }, { status: 400 });
      if (body.callbackURL !== undefined) {
        try {
          const url = new URL(body.callbackURL, process.env.BETTER_AUTH_URL);
          if (url.origin !== new URL(process.env.BETTER_AUTH_URL!).origin)
            throw new Error();
        } catch {
          return Response.json(
            { error: "허용되지 않은 이동 경로입니다." },
            { status: 400 },
          );
        }
      }
      if (!(await consumeLoginAttempt(body.email)))
        return Response.json(
          { error: "잠시 후 다시 시도하세요." },
          { status: 429, headers: { "Retry-After": "60" } },
        );
    } else {
      if (body.currentPassword === body.newPassword)
        return Response.json(
          { error: "다른 비밀번호를 입력하세요." },
          { status: 400 },
        );
      request = new Request(request.url, {
        method: request.method,
        headers: new Headers(request.headers),
        body: JSON.stringify({ ...body, revokeOtherSessions: true }),
      });
    }
  }
  let principal;
  if (path === "/change-password" || path === "/get-session") {
    principal = await currentPrincipal(request.headers);
    if (!principal)
      return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  const response = await getAuth().handler(request);
  if (
    path === "/change-password" &&
    request.method === "POST" &&
    response.ok &&
    principal
  ) {
    await getDb()
      .update(employees)
      .set({ mustChangePassword: false })
      .where(eq(employees.id, principal.employeeId));
  }
  if (path === "/sign-in/email" && !response.ok && response.status !== 429)
    return Response.json(
      { error: "이메일 또는 비밀번호를 확인하세요." },
      { status: 401 },
    );
  return response;
}
export const GET = handle;
export const POST = handle;
