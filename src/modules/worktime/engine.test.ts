import { describe, expect, it } from "vitest";
import { calculate, aggregate, midnight, type DayContext } from "./engine";
import type { Event } from "@/modules/attendance/domain";
const at = (s: string) => new Date(`${s}+09:00`);
const events = (...pairs: [Event["eventType"], string][]): Event[] => pairs.map(([eventType, time], i) => ({ id: String(i), eventType, occurredAt: at(time), source: "PC" }));
const day = (date = "2026-11-13", extra: Partial<DayContext> = {}): DayContext => ({ date, policyId: "p1", policyVersion: 1, requiredMinutes: 480, holiday: false, halfDay: false, requiredBreakMinutes:60, ...extra });
const normal = events(["CLOCK_IN", "2026-11-13T09:00:00"], ["BREAK_START", "2026-11-13T12:00:00"], ["BREAK_END", "2026-11-13T13:00:00"], ["CLOCK_OUT", "2026-11-13T18:00:00"]);
const run = (e: (Event & { verificationStatus?: string })[] = normal, days = [day()], nightEndHour: number | undefined = 6) => calculate({ events: e, asOf: at("2027-01-02T12:00:00"), days, nightEndHour });
describe("근로시간 계산 엔진", () => {
  it("정확히 실근로 480분·휴게 60분이며 자동 휴게 차감하지 않는다", () => {
    const r = run(); expect(r.actualWorkMinutes).toBe(480); expect(r.breakMinutes).toBe(60); expect(r.segments.every(s => s.isOvertime === false)).toBe(true);
    expect(run(events(["CLOCK_IN", "2026-11-13T09:00:00"], ["CLOCK_OUT", "2026-11-13T18:00:00"])).actualWorkMinutes).toBe(540);
  });
  it("다중 휴게 후 누적 8시간에서 정확히 연장을 나눈다", () => {
    const r = run(events(["CLOCK_IN", "2026-11-13T09:00:00"], ["BREAK_START", "2026-11-13T12:00:00"], ["BREAK_END", "2026-11-13T12:30:00"], ["BREAK_START", "2026-11-13T15:00:00"], ["BREAK_END", "2026-11-13T15:30:00"], ["CLOCK_OUT", "2026-11-13T19:00:00"]));
    expect(r.actualWorkMinutes).toBe(540); expect(r.breakMinutes).toBe(60);
    const ot = r.segments.filter(s => s.isOvertime); expect(ot[0].startedAt).toEqual(at("2026-11-13T18:00:00")); expect(ot.reduce((n,s) => n+s.durationMinutes,0)).toBe(60);
    expect(r.unresolvedReasons).toContain("OVERTIME_APPROVAL_UNDECIDED");
  });
  it("22시·자정·야간 종료를 분할하고 휴일 플래그를 독립 유지한다", () => {
    const r = run(events(["CLOCK_IN", "2026-11-13T21:00:00"], ["CLOCK_OUT", "2026-11-14T07:00:00"]), [day(), day("2026-11-14", { holiday: true })]);
    expect(r.workDate).toBe("2026-11-13");
    expect(r.segments.map(s => s.durationMinutes)).toEqual([60,120,300,60,60]);
    expect(r.segments.map(s => s.isNight)).toEqual([false,true,true,true,false]);
    expect(r.segments.filter(s => s.isHolidayWork).reduce((n,s) => n+s.durationMinutes,0)).toBe(420);
    expect(r.segments.reduce((n,s) => n+s.durationMinutes,0)).toBe(r.actualWorkMinutes);
  });
  it.each(["2026-11-30", "2026-12-31"])("%s 자정 넘김 시 근무일을 유지한다", date => {
    const end = date === "2026-11-30" ? "2026-12-01" : "2027-01-01";
    const r = run(events(["CLOCK_IN", `${date}T23:00:00`], ["CLOCK_OUT", `${end}T01:00:00`]), [day(date), day(end)]);
    expect(r.workDate).toBe(date); expect(r.actualWorkMinutes).toBe(120);
  });
  it("열린 근무와 열린 휴게를 기준 시각까지 잠정 계산한다", () => {
    const e = events(["CLOCK_IN", "2026-11-13T09:00:00"]);
    const r = calculate({ events:e, asOf:at("2026-11-13T10:00:00"), days:[day()], nightEndHour:6 });
    expect(r.actualWorkMinutes).toBe(60); expect(r.provisional).toBe(true);
    const b = calculate({ events:[...e,...events(["BREAK_START", "2026-11-13T09:30:00"]).map(x => ({...x,id:"break"}))], asOf:at("2026-11-13T10:00:00"), days:[day()], nightEndHour:6 });
    expect(b.breakMinutes).toBe(30); expect(b.actualWorkMinutes).toBe(30); expect(b.unresolvedReasons).toContain("OPEN_BREAK");
  });
  it("거부 이벤트를 제외하고 밀리초를 보존한다", () => {
    const r = run([...events(["CLOCK_IN", "2026-11-13T09:00:00.000"]), { ...normal[1], verificationStatus:"REJECTED" }, { ...events(["CLOCK_OUT", "2026-11-13T09:00:00.001"])[0], id:"end" }]);
    expect(r.actualWorkMinutes).toBe(1/60000);
  });
  it("반차·정책 변경·휴일 누락과 야간 종료 미정을 false로 치환하지 않는다", () => {
    const half = run(normal,[day(undefined,{halfDay:true, requiredMinutes:240})]); expect(half.actualWorkMinutes).toBe(480); expect(half.segments.every(s=>s.isOvertime===null)).toBe(true);
    const missing = run(normal,[day(undefined,{holiday:null})]); expect(missing.segments[0].isHolidayWork).toBeNull();
    const night = calculate({events:normal,asOf:at("2026-11-13T18:00:00"),days:[day()]}); expect(night.segments[0].isNight).toBeNull();
    const changed = run(events(["CLOCK_IN","2026-11-13T23:00:00"],["CLOCK_OUT","2026-11-14T01:00:00"]),[day(),day("2026-11-14",{policyId:"p2"})]); expect(changed.segments.at(-1)?.isOvertime).toBeNull();
  });
  it.each([
    events(["CLOCK_OUT","2026-11-13T18:00:00"]),
    events(["CLOCK_IN","2026-11-13T09:00:00"],["CLOCK_OUT","2026-11-13T08:00:00"]),
    events(["CLOCK_IN","2026-11-13T09:00:00"],["CLOCK_IN","2026-11-13T10:00:00"]),
  ].map(e => ({ e })))("비정상 이벤트 $e를 거부한다", ({ e }) => expect(()=>run(e)).toThrow());
  it("중복 ID·미래 이벤트·잘못된 야간 시각을 거부한다",()=>{
    expect(()=>run(normal.map(e=>({...e,id:"same"})))).toThrow();
    expect(()=>calculate({events:normal,asOf:at("2026-11-13T08:00:00"),days:[day()]})).toThrow();
    expect(()=>run(normal,[day()],24)).toThrow();
  });
  it("휴게 의무 미충족은 기록하고 실근로에서 자동 차감하지 않는다",()=>{const r=run(events(["CLOCK_IN","2026-11-13T09:00:00"],["CLOCK_OUT","2026-11-13T17:00:00"]));expect(r.actualWorkMinutes).toBe(480);expect(r.requiredBreakMinutes).toBe(60);expect(r.unresolvedReasons).toContain("BREAK_REQUIREMENT_UNMET");});
  it("동일 입력의 결과가 같고 입력을 수정하지 않는다",()=>{const before=JSON.stringify(normal);expect(run()).toEqual(run());expect(JSON.stringify(normal)).toBe(before);});
});
describe("기간 집계",()=>{
  const periods=[{key:"nov",start:midnight("2026-11-01"),end:midnight("2026-12-01")},{key:"dec",start:midnight("2026-12-01"),end:midnight("2027-01-01")}];
  const calculation=run(events(["CLOCK_IN","2026-11-30T23:00:00"],["CLOCK_OUT","2026-12-01T01:00:00"]),[day("2026-11-30"),day("2026-12-01")]);
  const session={id:"s",workDate:"2026-11-30",calculationVersion:2,calculation};
  it("출근일 귀속과 실제 시각 배분을 구분한다",()=>{expect(aggregate([session],periods,"WORK_DATE").map(p=>p.actualWorkMinutes)).toEqual([120,0]);expect(aggregate([session],periods,"ACTUAL_TIME").map(p=>p.actualWorkMinutes)).toEqual([60,60]);});
  it("최신 버전만 집계하고 동일 버전 중복을 거부한다",()=>{expect(aggregate([{...session,id:"old",calculationVersion:1},session],periods,"WORK_DATE")[0].actualWorkMinutes).toBe(120);expect(()=>aggregate([session,session],periods,"WORK_DATE")).toThrow();});
  it("미확정 분류 합계를 null로 유지한다",()=>{const c=run(normal,[day(undefined,{holiday:null})]);expect(aggregate([{...session,calculation:c,workDate:"2026-11-13"}],periods,"WORK_DATE")[0].holidayMinutes).toBeNull();});
  it.each([3120,3120+1/60000])("52시간 경계 %s분을 실제 시간으로 판정한다",minutes=>{const c=run();c.segments=[{...c.segments[0],startedAt:midnight("2026-11-13"),endedAt:new Date(midnight("2026-11-13").getTime()+minutes*60000),durationMinutes:minutes}];expect(aggregate([{...session,calculation:c,workDate:"2026-11-13"}],periods,"WORK_DATE")[0].exceeds52Hours).toBe(minutes>3120);});
});
