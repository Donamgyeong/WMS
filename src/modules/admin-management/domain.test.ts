import { describe, expect, it } from "vitest";
import { assertHierarchy, date, networks, password, period } from "./domain";
describe("관리 입력 검증", () => {
  it("실제 날짜와 기간만 허용한다", () => {
    expect(() => date("2026-02-30")).toThrow();
    expect(() => period("2026-11-14", "2026-11-14")).toThrow();
    expect(period("2026-11-14", "")).toEqual({ effectiveFrom: "2026-11-14", effectiveTo: null });
  });
  it("상위 부서의 간접 순환을 차단한다", () => {
    expect(() => assertHierarchy("a", "c", [{ id: "b", parentId: "a" }, { id: "c", parentId: "b" }])).toThrow();
  });
  it("CIDR과 비밀번호 길이를 검증한다", () => {
    expect(networks(["127.0.0.0/8", "::1/128"])).toHaveLength(2);
    for (const v of ["127.0.0.1", "::/129", "1.2.3.4/-1"]) expect(() => networks([v])).toThrow();
    expect(() => password("short")).toThrow();
  });
});
