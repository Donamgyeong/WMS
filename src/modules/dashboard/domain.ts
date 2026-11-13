import { workDate } from "@/modules/attendance/domain";

export function dashboardRange(now: Date) {
  const today = workDate(now);
  const date = new Date(`${today}T00:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  const from = new Date(date.getTime() - offset * 86400000).toISOString().slice(0, 10);
  const to = new Date(new Date(`${from}T00:00:00Z`).getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const upcomingTo = new Date(date.getTime() + 14 * 86400000).toISOString().slice(0, 10);
  return { today, from, to, upcomingTo };
}
export function duration(minutes: number) {
  return `${Math.floor(minutes / 60)}시간 ${Math.floor(minutes % 60)}분`;
}
export type DashboardData = {
  today: string; from: string; to: string; asOf: string;
  daily: { date: string; minutes: number }[]; totalMinutes: number; provisional: boolean;
  missing: { id: string; date: string }[];
  upcoming: { id: string; date: string; label: string }[];
};
