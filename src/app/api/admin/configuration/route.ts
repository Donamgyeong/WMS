import { getDb } from "@/db";
import { currentPrincipal } from "@/modules/identity/service";
import { AccessError, authorize } from "@/modules/identity/domain";
import { isTrustedOrigin } from "@/modules/identity/origins";
import { getConfiguration, changeConfiguration } from "@/modules/admin-management/service";
import { ConfigurationError } from "@/modules/admin-management/domain";
const headers = { "Cache-Control": "no-store" };
async function handle(request: Request, write: boolean) {
  try {
    const actor = authorize(await currentPrincipal(request.headers), "ADMIN");
    if (!write) return Response.json(await getConfiguration(getDb(), actor), { headers });
    if (!isTrustedOrigin(request.headers.get("origin")) || request.headers.get("sec-fetch-site") === "cross-site") throw new ConfigurationError(403, "허용되지 않은 출처입니다.");
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new ConfigurationError(415, "JSON 요청이 필요합니다.");
    const raw = await request.text();
    if (raw.length > 20000) throw new ConfigurationError(413, "요청이 너무 큽니다.");
    let body: unknown;
    try { body = JSON.parse(raw); } catch { throw new ConfigurationError(400, "잘못된 JSON 요청입니다."); }
    return Response.json(await changeConfiguration(getDb(), actor, body), { headers });
  } catch (error) {
    if (error instanceof AccessError || error instanceof ConfigurationError) return Response.json({ error: error.message }, { status: error.status, headers });
    const cause = error as { code?: string; cause?: { code?: string } };
    if (["23505", "23503", "23514", "23P01", "22P02"].includes(cause.code ?? cause.cause?.code ?? "")) return Response.json({ error: "중복 값, 참조 대상, CIDR 또는 적용 기간을 확인하세요." }, { status: 409, headers });
    return Response.json({ error: "저장하지 못했습니다. 다시 시도하세요." }, { status: 500, headers });
  }
}
export const GET = (request: Request) => handle(request, false);
export const POST = (request: Request) => handle(request, true);
