import { nextState, type Event, type State } from "@/modules/attendance/domain";
// Keep millisecond precision. Display formatting never changes stored elapsed time.
export function summarize(events: Event[], now: Date) {
  let state: State = "NOT_STARTED";
  let workMs = 0, breakMs = 0;
  let previous: Date | undefined;
  for (const event of events) {
    if (previous) {
      const delta = event.occurredAt.getTime() - previous.getTime();
      if (delta < 0) throw new Error("이벤트 시각 역전");
      if (state === "WORKING") workMs += delta;
      if (state === "ON_BREAK") breakMs += delta;
    }
    state = nextState(state, event.eventType);
    previous = event.occurredAt;
  }
  if (previous) {
    const delta = Math.max(0, now.getTime() - previous.getTime());
    if (state === "WORKING") workMs += delta;
    if (state === "ON_BREAK") breakMs += delta;
  }
  return { state, actualWorkMinutes: workMs / 60000, breakMinutes: breakMs / 60000 };
}
