import { describe, expect, it } from "vitest";
import { nextState, parseInput, workDate, type Event, type EventType, type State } from "./domain";
import { summarize } from "@/modules/worktime/domain";
const event = (eventType: EventType, at: string): Event => ({ id: at, eventType, occurredAt: new Date(at), source: "PC" });
describe("근태 상태와 시간", () => {
  it("출근·다중 휴게·퇴근과 실제 시간", () => {
    const events = [event("CLOCK_IN", "2026-11-13T00:00:00Z"), event("BREAK_START", "2026-11-13T03:00:00Z"), event("BREAK_END", "2026-11-13T03:30:00Z"), event("BREAK_START", "2026-11-13T06:00:00Z"), event("BREAK_END", "2026-11-13T06:30:00Z"), event("CLOCK_OUT", "2026-11-13T09:00:00Z")];
    expect(summarize(events, new Date("2026-11-14"))).toEqual({ state: "FINISHED", actualWorkMinutes: 480, breakMinutes: 60 });
  });
  it("자정·월말·연말을 넘는 휴게를 정확히 제외한다", () => {
    for (const start of ["2026-11-13T14:00:00Z", "2026-11-30T14:00:00Z", "2026-12-31T14:00:00Z"]) {
      const t = new Date(start).getTime();
      const events = [event("CLOCK_IN", start), event("BREAK_START", new Date(t + 30 * 60000).toISOString()), event("BREAK_END", new Date(t + 90 * 60000).toISOString()), event("CLOCK_OUT", new Date(t + 180 * 60000).toISOString())];
      expect(summarize(events, new Date(t + 240 * 60000))).toMatchObject({ actualWorkMinutes: 120, breakMinutes: 60 });
      expect(workDate(events[0].occurredAt)).toBe(start.slice(0, 10));
    }
  });
  it("미종료 휴게는 실근로에 포함하지 않고 초 단위 값을 반올림하지 않는다", () => {
    const events = [event("CLOCK_IN", "2026-11-13T00:00:00Z"), event("BREAK_START", "2026-11-13T00:00:30Z")];
    expect(summarize(events, new Date("2026-11-13T00:01:15Z"))).toEqual({ state: "ON_BREAK", actualWorkMinutes: 0.5, breakMinutes: 0.75 });
  });
  it("허용한 전이 이외에는 거절한다", () => {
    const allowed = new Set(["NOT_STARTED:CLOCK_IN", "WORKING:BREAK_START", "WORKING:CLOCK_OUT", "ON_BREAK:BREAK_END"]);
    for (const state of ["NOT_STARTED", "WORKING", "ON_BREAK", "FINISHED"] as State[]) for (const type of ["CLOCK_IN", "CLOCK_OUT", "BREAK_START", "BREAK_END"] as EventType[]) {
      if (allowed.has(`${state}:${type}`)) expect(() => nextState(state, type)).not.toThrow();
      else expect(() => nextState(state, type)).toThrow();
    }
  });
  it("직원·시각 주입, 잘못된 좌표와 비정상 요청 ID 거절", () => {
    const input = { eventType: "CLOCK_IN", requestId: "request-123", workplaceId: "office" };
    expect(parseInput(input)).toEqual(input);
    for (const extra of [{ employeeId: "other" }, { occurredAt: "2026-01-01" }, { requestId: "x" }, { location: { latitude: 91, longitude: 0, accuracy: 1 } }, { location: { latitude: 0, longitude: 0, accuracy: -1 } }]) expect(() => parseInput({ ...input, ...extra })).toThrow();
  });
});
