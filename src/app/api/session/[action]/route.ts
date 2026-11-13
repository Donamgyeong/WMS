import { isTrustedOrigin } from "@/modules/identity/origins";
import { handleAuthRequest } from "@/modules/identity/http";
export const runtime = "nodejs";
const paths: Record<string, string> = {
  login: "/sign-in/email",
  password: "/change-password",
  logout: "/sign-out",
};
function redirectTo(path: string, cookies: string[] = []) {
  const headers = new Headers({
    Location: path,
    "Cache-Control": "no-store",
    "Referrer-Policy": "same-origin",
  });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}
export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  const { action } = await context.params;
  if (!Object.hasOwn(paths, action)) return new Response(null, { status: 404 });
  const failurePage = action === "password" ? "/change-password" : "/login";
  const baseURL = process.env.BETTER_AUTH_URL;
  if (
    !baseURL ||
    !isTrustedOrigin(request.headers.get("origin")) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    return redirectTo(`${failurePage}?error=origin`);
  try {
    const data = await request.formData();
    let body: Record<string, unknown> = {};
    if (action === "login")
      body = {
        email: String(data.get("email") ?? "")
          .trim()
          .toLowerCase(),
        password: String(data.get("password") ?? ""),
        rememberMe: false,
      };
    if (action === "password") {
      if (data.get("newPassword") !== data.get("confirmPassword"))
        return redirectTo(`${failurePage}?error=mismatch`);
      body = {
        currentPassword: data.get("currentPassword"),
        newPassword: data.get("newPassword"),
        revokeOtherSessions: true,
      };
    }
    const headers = new Headers(request.headers);
    headers.set("Content-Type", "application/json");
    headers.delete("Content-Length");
    const response = await handleAuthRequest(
      new Request(new URL(`/api/auth${paths[action]}`, baseURL), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
    );
    if (!response.ok) {
      const code =
        response.status === 429
          ? "limited"
          : response.status === 403
            ? "origin"
            : action === "password"
              ? "password"
              : "credentials";
      return redirectTo(`${failurePage}?error=${code}`);
    }
    return redirectTo(
      action === "logout" ? "/login" : "/me",
      response.headers.getSetCookie(),
    );
  } catch {
    return redirectTo(`${failurePage}?error=unavailable`);
  }
}
