import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ConfigurationEditor, type Action } from "./editor";

it.each<Action>(["department.save", "employee.create", "employee.save", "workplace.save", "policy.create", "policy.assign"])("%s 편집기에 중복 제목과 수동 새로고침을 표시하지 않는다", action => {
  const html = renderToStaticMarkup(createElement(ConfigurationEditor, { request: { action }, onSaved: async () => {} }));
  expect(html).not.toMatch(/<h[1-6]\b/);
  expect(html).not.toContain("편집 데이터 새로고침");
  expect(html).not.toContain("ws-config-toolbar");
  if (action === "employee.save") {
    expect(html).toContain("정보·권한");
    expect(html).toContain("계정 상태");
    expect(html).toContain('aria-pressed="true"');
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(2);
    expect(html).toContain("계정 활성 상태 변경");
    expect(html).toContain("임시 비밀번호 재설정");
  }
});
