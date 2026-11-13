export const eventTypes = ["CLOCK_IN", "CLOCK_OUT", "BREAK_START", "BREAK_END"] as const;
export type EventType = typeof eventTypes[number];
export type State = "NOT_STARTED" | "WORKING" | "ON_BREAK" | "FINISHED";
export type Event = { id: string; eventType: EventType; occurredAt: Date; source: "PC" | "MOBILE" };
export class AttendanceError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function nextState(state: State, type: EventType): State {
  if (state === "NOT_STARTED" && type === "CLOCK_IN") return "WORKING";
  if (state === "WORKING" && type === "BREAK_START") return "ON_BREAK";
  if (state === "ON_BREAK" && type === "BREAK_END") return "WORKING";
  if (state === "WORKING" && type === "CLOCK_OUT") return "FINISHED";
  throw new AttendanceError(409, "현재 상태에서 기록할 수 없습니다. 휴게 중이면 휴게를 먼저 종료하세요.");
}
export function workDate(at: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}
export type Input = { eventType: EventType; requestId: string; workplaceId: string; location?: { latitude: number; longitude: number; accuracy: number } };
export function parseInput(value: unknown): Input {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AttendanceError(400, "잘못된 요청입니다.");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !["eventType", "requestId", "workplaceId", "location"].includes(k)) || !eventTypes.includes(v.eventType as EventType) || typeof v.requestId !== "string" || !/^[\w-]{8,100}$/.test(v.requestId) || typeof v.workplaceId !== "string" || !v.workplaceId.length || v.workplaceId.length > 100) throw new AttendanceError(400, "기록 종류·요청 ID·근무지를 확인하세요.");
  if (v.location !== undefined) {
    const p = v.location as Input["location"];
    if (!p || ![p.latitude, p.longitude, p.accuracy].every(n => typeof n === "number" && Number.isFinite(n)) || Math.abs(p.latitude) > 90 || Math.abs(p.longitude) > 180 || p.accuracy < 0) throw new AttendanceError(400, "위치 정보가 올바르지 않습니다.");
  }
  const location = v.location as Input["location"];
  return { eventType: v.eventType as EventType, requestId: v.requestId, workplaceId: v.workplaceId,
    ...(location ? { location: { latitude: location.latitude, longitude: location.longitude, accuracy: location.accuracy } } : {}) } as Input;
}
