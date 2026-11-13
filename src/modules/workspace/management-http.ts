import "server-only";
import { currentPrincipal } from "@/modules/identity/service";
import { authorize, AccessError } from "@/modules/identity/domain";
import { WorktimeError } from "@/modules/worktime/engine";
import { getManagement } from "./management-service";
import { ManagementError, parseManagementQuery } from "./management-domain";
export async function managementHttp(request: Request, area: "team" | "admin", key: string) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const principal = authorize(await currentPrincipal(request.headers), area === "admin" ? "ADMIN" : "MANAGER");
    return Response.json(await getManagement(principal, area, key, parseManagementQuery(new URL(request.url).searchParams)), { headers });
  } catch (error) {
    if (error instanceof AccessError || error instanceof ManagementError || error instanceof WorktimeError) return Response.json({ error: error.message }, { status: error.status, headers });
    console.error("Management query failed", error);
    return Response.json({ error: "관리 데이터를 불러오지 못했습니다. 다시 시도하세요." }, { status: 500, headers });
  }
}
