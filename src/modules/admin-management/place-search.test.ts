import { afterEach, describe, expect, it, vi } from "vitest";
const execute = vi.hoisted(() => vi.fn());
vi.mock("@/db", () => ({ getDb: () => ({ execute }) }));
import { searchPlaces } from "./place-search";
afterEach(() => { vi.unstubAllGlobals(); execute.mockReset(); });
const feature = { geometry: { type: "Point", coordinates: [126.9779, 37.5663] }, properties: { name: "서울시청", city: "서울특별시", street: "세종대로", housenumber: "110" } };
describe("장소 검색 서비스", () => {
  it("잘못된 검색어는 외부 호출 전에 차단한다", async () => {
    await expect(searchPlaces(" ")).rejects.toMatchObject({ status: 400 });
    await expect(searchPlaces("x".repeat(101))).rejects.toMatchObject({ status: 400 });
    expect(execute).not.toHaveBeenCalled();
  });
  it("검색 좌표·주소를 변환하고 같은 검색은 캐시한다", async () => {
    execute.mockResolvedValue({ rows: [{ id: "limit" }] });
    const fetcher = vi.fn().mockResolvedValue(Response.json({ features: [feature, { ...feature, geometry: { type: "Point", coordinates: [200, 100] } }] }));
    vi.stubGlobal("fetch", fetcher);
    const result = await searchPlaces("서울시청");
    expect(result).toEqual([{ id: "0", name: "서울시청", address: "서울특별시 세종대로 110", latitude: "37.5663000", longitude: "126.9779000" }]);
    expect(await searchPlaces(" 서울시청 ")).toEqual(result);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(execute).toHaveBeenCalledTimes(1);
  });
  it("호출 제한 시 외부 요청을 보내지 않는다", async () => {
    execute.mockResolvedValue({ rows: [] });
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(searchPlaces("제한 검색")).rejects.toMatchObject({ status: 429 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("외부 오류·응답 오류는 재시도 가능한 오류로 제공한다", async () => {
    execute.mockResolvedValue({ rows: [{ id: "limit" }] });
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValueOnce(Response.json({ bad: true }));
    vi.stubGlobal("fetch", fetcher);
    await expect(searchPlaces("서비스 오류")).rejects.toMatchObject({ status: 502 });
    await expect(searchPlaces("형식 오류")).rejects.toMatchObject({ status: 502 });
  });
  it("빈 결과를 성공으로 반환한다", async () => {
    execute.mockResolvedValue({ rows: [{ id: "limit" }] });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ features: [] })));
    expect(await searchPlaces("없는 장소")).toEqual([]);
  });
});
