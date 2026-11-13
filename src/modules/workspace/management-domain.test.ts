import { describe, it, expect } from "vitest";
import { parseManagementQuery } from "./management-domain";
const params = (rest = "") => new URLSearchParams(`from=2026-11-01&to=2026-12-01${rest}`);
describe("관리 화면 조회 입력", () => {
  it("날짜 범위와 선택 대상을 파싱한다", () => {
    expect(parseManagementQuery(params("&employeeId=e&workDate=2026-11-13"))).toEqual({ from: "2026-11-01", to: "2026-12-01", employeeId: "e", workDate: "2026-11-13", calculationId: undefined });
  });
  it.each(["from=2026-02-30&to=2026-03-01", "from=2026-12-01&to=2026-11-01", "from=2026-01-01&to=2027-01-03", "from=2026-11-01&to=2026-12-01&from=2026-10-01", "from=2026-11-01&to=2026-12-01&employeeId=", "from=2026-11-01&to=2026-12-01&role=ADMIN", "from=2026-11-01&to=2026-12-01&workDate=2026-12-02"])("잘못된 조건을 거부한다: %s", input => {
    expect(() => parseManagementQuery(new URLSearchParams(input))).toThrow();
  });
});
