import type { ManagementQuery } from "./management-types";
export class ManagementError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function parseManagementQuery(params: URLSearchParams): ManagementQuery {
  const allowed = ["from", "to", "employeeId", "workDate", "calculationId"];
  if ([...params.keys()].some(k => !allowed.includes(k) || params.getAll(k).length !== 1)) throw new ManagementError(400, "조회 조건을 확인하세요.");
  function date(key: string, required = true) {
    const value = params.get(key);
    if (!value && !required) return undefined;
    if (!value || !/^20\d\d-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new ManagementError(400, "날짜를 확인하세요.");
    return value;
  }
  const from = date("from")!, to = date("to")!;
  if (from >= to || Date.parse(to) - Date.parse(from) > 366 * 86400000) throw new ManagementError(400, "시작일 포함·종료일 제외, 최대 366일로 조회하세요.");
  const id = (key: string) => { const value = params.get(key); if (value !== null && (!value.trim() || value.length > 100)) throw new ManagementError(400, "조회 대상을 확인하세요."); return value ?? undefined; };
  const workDate = date("workDate", false);
  if (workDate && (workDate < from || workDate >= to)) throw new ManagementError(400, "선택 근무일이 조회 기간을 벗어났습니다.");
  return { from, to, employeeId: id("employeeId"), workDate, calculationId: id("calculationId") };
}
