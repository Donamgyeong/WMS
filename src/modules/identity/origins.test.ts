import { afterEach, describe, expect, it, vi } from "vitest";
import { isTrustedOrigin, trustedOrigins } from "./origins";

afterEach(() => vi.unstubAllEnvs());
describe("인증 origin 허용 목록", () => {
  it("기존 주소와 macmini의 정확한 origin을 허용한다", () => {
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3001");
    expect(trustedOrigins()).toEqual(["http://localhost:3001", "http://macmini:3001"]);
    expect(isTrustedOrigin("http://localhost:3001")).toBe(true);
    expect(isTrustedOrigin("http://macmini:3001")).toBe(true);
  });
  it("외부 주소, 다른 포트, 위장 주소와 누락된 origin은 거부한다", () => {
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3001");
    for (const origin of [null, "null", "https://evil.example", "http://macmini:3002", "http://macmini:3001.evil.example", "http://macmini:3001/"]) {
      expect(isTrustedOrigin(origin)).toBe(false);
    }
  });
});
