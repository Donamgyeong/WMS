import { webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createAttendanceRequestId } from "./request-id";
import { parseInput } from "./domain";

afterEach(() => vi.unstubAllGlobals());

it("uses native randomUUID when available", () => {
  const randomUUID = vi.fn(() => "794ac066-fb11-4604-8b12-044070db24d7");
  vi.stubGlobal("crypto", { randomUUID });
  expect(createAttendanceRequestId()).toBe("794ac066-fb11-4604-8b12-044070db24d7");
  expect(randomUUID).toHaveBeenCalledOnce();
});

it("generates distinct valid v4 request IDs without randomUUID", () => {
  vi.stubGlobal("crypto", { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
  const ids = Array.from({ length: 100 }, () => createAttendanceRequestId());
  expect(new Set(ids).size).toBe(ids.length);
  for (const requestId of ids) {
    expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(parseInput({ eventType: "CLOCK_IN", requestId, workplaceId: "office" }).requestId).toBe(requestId);
  }
});

it("shows an actionable error if browser crypto is unavailable", () => {
  vi.stubGlobal("crypto", undefined);
  expect(() => createAttendanceRequestId()).toThrow("최신 브라우저");
});
