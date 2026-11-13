import { currentPrincipal } from "@/modules/identity/service";
import { authorize, AccessError } from "@/modules/identity/domain";
import { getDashboard } from "@/modules/dashboard/service";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const principal = authorize(await currentPrincipal(request.headers));
    return Response.json(await getDashboard(principal), { headers });
  } catch (error) {
    if (error instanceof AccessError) return Response.json({ error: error.message }, { status: error.status, headers });
    console.error("Dashboard request failed", error);
    return Response.json({ error: "대시보드를 불러오지 못했습니다. 다시 시도하세요." }, { status: 500, headers });
  }
}
