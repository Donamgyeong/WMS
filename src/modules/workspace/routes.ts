export const teamRoutes = [
  { path: "/team", key: "team", title: "우리 부서의 오늘", label: "부서 현황" },
  { path: "/team/attendance", key: "team-attendance", title: "부서원 근태 조회", label: "부서원 근태" },
  { path: "/team/attendance/detail", key: "team-detail", title: "부서원 근태 상세", label: "근태 상세" },
  { path: "/team/calendar", key: "team-calendar", title: "부서 일정", label: "부서 일정" },
] as const;
export const adminRoutes = [
  { path: "/admin", key: "admin", title: "전체 운영 현황", label: "운영 현황" },
  { path: "/admin/attendance", key: "admin-attendance", title: "전체 근태 관리", label: "근태 관리" },
  { path: "/admin/organization", key: "admin-organization", title: "조직·권한 관리", label: "조직·권한" },
  { path: "/admin/settings", key: "admin-settings", title: "근무 설정", label: "근무 설정" },
  { path: "/admin/calendar", key: "admin-calendar", title: "휴일·개인 일정", label: "휴일" },
  { path: "/admin/contracts", key: "admin-contracts", title: "시급·계약 관리", label: "시급·계약" },
  { path: "/admin/settlements", key: "admin-settlements", title: "정산 목록·상세", label: "임금·정산" },
] as const;
export type WorkspaceRoute = (typeof teamRoutes)[number] | (typeof adminRoutes)[number];
