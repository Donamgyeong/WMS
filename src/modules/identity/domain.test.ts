import { describe, it, expect } from "vitest";
import { authorize, assertEmployeeScope, type Principal } from "./domain";
const employee: Principal = {
  userId: "u",
  employeeId: "e",
  name: "직원",
  email: "e@example.com",
  roles: ["EMPLOYEE"],
  departmentIds: [],
  mustChangePassword: false,
};
describe("서버 접근 범위", () => {
  it("로그인이 필요하다", () =>
    expect(() => authorize(null)).toThrow("로그인이 필요"));
  it("초기 비밀번호 변경 전에는 업무 접근을 차단한다", () => {
    expect(() => authorize({ ...employee, mustChangePassword: true })).toThrow(
      "비밀번호 변경",
    );
    expect(
      authorize({ ...employee, mustChangePassword: true }, undefined, true),
    ).toBeTruthy();
  });
  it("직원과 부서장의 임금 접근을 차단한다", () => {
    for (const roles of [["EMPLOYEE"], ["MANAGER"]] as Principal["roles"][])
      expect(() => authorize({ ...employee, roles }, "ADMIN")).toThrow(
        "접근 권한",
      );
  });
  it("관리자를 허용한다", () =>
    expect(authorize({ ...employee, roles: ["ADMIN"] }, "ADMIN")).toBeTruthy());
  it("직원은 본인만 조회한다", () => {
    expect(() =>
      assertEmployeeScope(employee, { employeeId: "e", departmentId: null }),
    ).not.toThrow();
    expect(() =>
      assertEmployeeScope(employee, { employeeId: "other", departmentId: "d" }),
    ).toThrow();
  });
  it("부서장은 담당 부서만 조회한다", () => {
    const manager = {
      ...employee,
      roles: ["MANAGER"] as Principal["roles"],
      departmentIds: ["d"],
    };
    expect(() =>
      assertEmployeeScope(manager, { employeeId: "other", departmentId: "d" }),
    ).not.toThrow();
    expect(() =>
      assertEmployeeScope(manager, { employeeId: "other", departmentId: "x" }),
    ).toThrow();
  });
});
