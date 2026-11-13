export const roleLabels: Record<string, string> = {
  EMPLOYEE: "직원",
  MANAGER: "부서장",
  ADMIN: "관리자",
};
export const roleLabel = (role: string) => roleLabels[role] ?? role;
