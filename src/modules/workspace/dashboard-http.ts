import "server-only";
import { currentPrincipal } from "@/modules/identity/service";
import { authorize, AccessError } from "@/modules/identity/domain";
import { getOverview } from "./dashboard-service";
export async function overviewHttp(request: Request, area: "team" | "admin") {
  const headers = { "Cache-Control": "no-store" };
  try {
    const principal = authorize(await currentPrincipal(request.headers), area === "admin" ? "ADMIN" : "MANAGER");
    return Response.json(await getOverview(principal, area), { headers });
  } catch (error) {
    if (error instanceof AccessError) return Response.json({ error: error.message }, { status: error.status, headers });
    console.error("Workspace overview failed", error);
    return Response.json({ error: "현황을 불러오지 못했습니다. 다시 시도하세요." }, { status: 500, headers });
  }
}
