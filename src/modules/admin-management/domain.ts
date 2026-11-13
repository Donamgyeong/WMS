import { isIP } from "node:net";
export class ConfigurationError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const fail = (message: string): never => { throw new ConfigurationError(400, message); };
export function text(value: unknown, label: string, optional = false): string {
  if (optional && (value === null || value === undefined || value === "")) return "";
  if (typeof value !== "string" || !value.trim() || value.trim().length > 254) return fail(`${label}을 확인하세요.`);
  return value.trim();
}
export function date(value: unknown, optional = false): string | null {
  if (optional && !value) return null;
  const v = text(value, "날짜");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v) return fail("날짜를 확인하세요.");
  return v;
}
export function period(from: unknown, to: unknown) {
  const effectiveFrom = date(from)!, effectiveTo = date(to, true);
  if (effectiveTo && effectiveFrom >= effectiveTo) fail("종료일은 시작일 이후여야 합니다.");
  return { effectiveFrom, effectiveTo };
}
export function password(value: unknown) {
  if (typeof value !== "string" || value.length < 12 || value.length > 128) return fail("임시 비밀번호는 12~128자여야 합니다.");
  return value;
}
export function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100 || value.some(v => typeof v !== "string" || !v || v.length > 254)) return fail("선택값을 확인하세요.");
  return [...new Set(value)];
}
export function networks(value: unknown) {
  return strings(value).map(v => {
    const [ip, prefix, extra] = v.split("/");
    const family = isIP(ip);
    if (!family || extra !== undefined || !/^\d+$/.test(prefix ?? "") || Number(prefix) > (family === 4 ? 32 : 128)) return fail("IPv4/IPv6 CIDR을 확인하세요.");
    return v;
  });
}
export function assertHierarchy(id: string, parentId: string | null, departments: { id: string; parentId: string | null }[]) {
  const seen = new Set([id]);
  for (let next = parentId; next;) {
    if (seen.has(next)) fail("부서 계층이 순환할 수 없습니다.");
    seen.add(next);
    const parent = departments.find(d => d.id === next);
    if (!parent) fail("상위 부서를 찾을 수 없습니다.");
    next = parent!.parentId;
  }
}
