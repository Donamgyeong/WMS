import { describe, expect, it } from "vitest";
import { dashboardRange, duration } from "./domain";
describe("개인 대시보드 표시 범위", () => {
  it("서울 자정과 월요일을 기준으로 연도를 넘는 주를 계산한다", () => {
    expect(dashboardRange(new Date("2026-12-31T15:00:00Z"))).toEqual({ today: "2027-01-01", from: "2026-12-28", to: "2027-01-04", upcomingTo: "2027-01-15" });
  });
  it("일요일은 앞선 월요일에 포함하고 다음 월요일은 새 주로 표시한다", () => {
    expect(dashboardRange(new Date("2026-11-15T14:59:59Z")).from).toBe("2026-11-09");
    expect(dashboardRange(new Date("2026-11-15T15:00:00Z")).from).toBe("2026-11-16");
  });
  it("분 미만은 표시만 생략하고 0시간을 명시한다", () => {
    expect(duration(0)).toBe("0시간 0분");
    expect(duration(500.9)).toBe("8시간 20분");
  });
});
