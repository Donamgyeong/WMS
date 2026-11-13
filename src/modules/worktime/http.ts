import "server-only";
import { currentPrincipal } from "@/modules/identity/service";
import { authorize, AccessError } from "@/modules/identity/domain";
import { isTrustedOrigin } from "@/modules/identity/origins";
import { getWorktime, recalculate } from "./service";
import { midnight, WorktimeError } from "./engine";
function parse(value: unknown, read: boolean) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorktimeError(400, "잘못된 입력입니다.");
  const v = value as Record<string, unknown>;
  const allowed = read ? ["from", "to", "basis", "weekStartsOn", "nightEndHour", "employeeId"] : ["from", "to", "nightEndHour", "employeeId"];
  if (Object.keys(v).some(k => !allowed.includes(k))) throw new WorktimeError(400, "허용되지 않은 입력입니다.");
  for (const key of ["from", "to"]) {
    if (typeof v[key] !== "string" || !/^20\d\d-\d{2}-\d{2}$/.test(v[key] as string) || !Number.isFinite(midnight(v[key] as string).getTime()) || new Date(`${v[key]}T00:00:00Z`).toISOString().slice(0, 10) !== v[key]) throw new WorktimeError(400, "날짜를 확인하세요.");
  }
  const from = v.from as string, to = v.to as string;
  if (from >= to || midnight(to).getTime() - midnight(from).getTime() > 366 * 86400000) throw new WorktimeError(400, "집계 기간은 시작일 포함·종료일 제외, 최대 366일입니다.");
  if (v.employeeId !== undefined && (typeof v.employeeId !== "string" || !v.employeeId.length || v.employeeId.length > 100)) throw new WorktimeError(400, "직원 ID를 확인하세요.");
  const integer = (key: string, max: number) => {
    if (v[key] === undefined) return undefined;
    if ((typeof v[key] !== "string" && typeof v[key] !== "number") || !/^\d+$/.test(String(v[key]))) throw new WorktimeError(400, `${key} 값을 확인하세요.`);
    const n = Number(v[key]);
    if (!Number.isInteger(n) || n < 0 || n > max) throw new WorktimeError(400, `${key} 값을 확인하세요.`);
    return n;
  };
  if (read && v.basis !== "WORK_DATE" && v.basis !== "ACTUAL_TIME") throw new WorktimeError(400, "집계 기준을 명시하세요.");
  return { from, to, employeeId: v.employeeId as string | undefined, basis: v.basis as "WORK_DATE" | "ACTUAL_TIME", weekStartsOn: integer("weekStartsOn", 6), nightEndHour: integer("nightEndHour", 22) };
}
export async function worktimeHttp(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const p = authorize(await currentPrincipal(request.headers));
    if (request.method === "GET") {
      const params = new URL(request.url).searchParams;
      if ([...params.keys()].some(k => params.getAll(k).length > 1)) throw new WorktimeError(400, "중복 파라미터입니다.");
      const range = parse(Object.fromEntries(params), true);
      return Response.json(await getWorktime(p, range.employeeId ?? p.employeeId, range), { headers });
    }
    authorize(p, "ADMIN");
    if (!isTrustedOrigin(request.headers.get("origin")) || request.headers.get("sec-fetch-site") === "cross-site") throw new WorktimeError(403, "허용되지 않은 출처입니다.");
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new WorktimeError(415, "JSON 요청이 필요합니다.");
    let body: unknown;
    try { body = await request.json(); } catch { throw new WorktimeError(400, "잘못된 JSON입니다."); }
    const range = parse(body, false);
    if (!range.employeeId) throw new WorktimeError(400, "재계산 대상 직원이 필요합니다.");
    return Response.json(await recalculate(p, range.employeeId, range), { headers });
  } catch (e) {
    if (e instanceof WorktimeError || e instanceof AccessError) return Response.json({ error: e.message }, { status: e.status, headers });
    console.error("Worktime request failed", e);
    return Response.json({ error: "근로시간 계산에 실패했습니다." }, { status: 500, headers });
  }
}
