export type OverviewEmployee = {
  id: string; name: string; departmentId: string | null; department: string;
  state: string; todayMinutes: number; weekMinutes: number; provisional: boolean;
  missingDates: string[]; onLeave: boolean; unresolved: boolean;
};
export type Overview = {
  area: "team" | "admin"; today: string; from: string; to: string; asOf: string;
  departments: { id: string; name: string }[]; employees: OverviewEmployee[];
  settlements?: { id: string; from: string; to: string; status: string; calculations: number; unresolved: number; additionalPay: string | null; totalPay: string | null }[];
};
