import "server-only";
import { currentPrincipal } from "@/modules/identity/service";
import { authorize, AccessError } from "@/modules/identity/domain";
import { isTrustedOrigin } from "@/modules/identity/origins";
import { AttendanceError, parseInput } from "./domain";
import { getAttendance, recordAttendance } from "./service";
export async function attendanceHttp(request: Request) {
  const responseHeaders = { "Cache-Control": "no-store" };
  try {
    const principal = authorize(await currentPrincipal(request.headers));
    if (request.method === "GET") return Response.json(await getAttendance(principal.employeeId), { headers: responseHeaders });
    if (!isTrustedOrigin(request.headers.get("origin")) || request.headers.get("sec-fetch-site") === "cross-site") throw new AttendanceError(403, "허용되지 않은 출처입니다.");
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new AttendanceError(415, "JSON 요청이 필요합니다.");
    let body: unknown;
    try { body = await request.json(); } catch { throw new AttendanceError(400, "잘못된 JSON입니다."); }
    const result = await recordAttendance(principal.employeeId, parseInput(body), request.headers);
    return Response.json(result, { status: result.replayed ? 200 : 201, headers: responseHeaders });
  } catch (error) {
    if (error instanceof AttendanceError || error instanceof AccessError) return Response.json({ error: error.message }, { status: error.status, headers: responseHeaders });
    console.error("Attendance request failed", error);
    return Response.json({ error: "기록을 처리하지 못했습니다. 같은 요청으로 다시 시도하세요." }, { status: 500, headers: responseHeaders });
  }
}
