export type Role = "EMPLOYEE" | "MANAGER" | "ADMIN";
export type Principal = {
  userId: string;
  employeeId: string;
  name: string;
  email: string;
  roles: Role[];
  departmentIds: string[];
  mustChangePassword: boolean;
};
export class AccessError extends Error {
  constructor(
    public status: 401 | 403,
    message = status === 401 ? "로그인이 필요합니다." : "접근 권한이 없습니다.",
  ) {
    super(message);
  }
}
export function authorize(
  principal: Principal | null,
  role?: Role,
  allowPasswordChange = false,
): Principal {
  if (!principal) throw new AccessError(401);
  if (principal.mustChangePassword && !allowPasswordChange)
    throw new AccessError(403, "비밀번호 변경이 필요합니다.");
  if (role && !principal.roles.includes(role)) throw new AccessError(403);
  return principal;
}
export function assertEmployeeScope(
  p: Principal,
  target: { employeeId: string; departmentId: string | null },
) {
  if (p.roles.includes("ADMIN") || p.employeeId === target.employeeId) return;
  if (
    p.roles.includes("MANAGER") &&
    target.departmentId &&
    p.departmentIds.includes(target.departmentId)
  )
    return;
  throw new AccessError(403);
}
