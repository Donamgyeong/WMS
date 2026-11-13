export type ManagementRow = { id: string; cells: string[]; employeeId?: string; workDate?: string; calculationId?: string; dailyMinutes?: (number | null)[] };
export type ManagementSection = { title: string; columns: string[]; rows: ManagementRow[] };
export type ManagementData = {
  asOf: string; from: string; to: string;
  employees: { id: string; name: string; departmentId: string | null; department: string }[];
  departments: { id: string; name: string }[];
  sections: ManagementSection[]; unavailable: string[];
};
export type ManagementQuery = { from: string; to: string; employeeId?: string; workDate?: string; calculationId?: string };
