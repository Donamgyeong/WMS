import { currentPrincipal } from "@/modules/identity/service";
import { AccessError, authorize } from "@/modules/identity/domain";
import { ConfigurationError } from "@/modules/admin-management/domain";
import { searchPlaces } from "@/modules/admin-management/place-search";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    authorize(await currentPrincipal(request.headers), "ADMIN");
    return Response.json({ places: await searchPlaces(new URL(request.url).searchParams.get("q")) }, { headers });
  } catch (e) {
    if (e instanceof AccessError || e instanceof ConfigurationError) return Response.json({ error: e.message }, { status: e.status, headers: { ...headers, ...(e.status === 429 ? { "Retry-After": "1" } : {}) } });
    return Response.json({ error: "검색에 실패했습니다. 다시 시도하세요." }, { status: 500, headers });
  }
}
