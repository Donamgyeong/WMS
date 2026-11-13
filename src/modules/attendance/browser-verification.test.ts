import { expect, it, vi } from "vitest";
import { attendanceLocation, isMobileDevice } from "./browser-verification";

it("모바일 UA, Client Hints, 데스크톱 모드 iPad를 감지한다", () => {
  for (const userAgent of ["iPhone", "Android", "iPad"]) expect(isMobileDevice({ userAgent, maxTouchPoints: 1 })).toBe(true);
  expect(isMobileDevice({ userAgent: "Mozilla Macintosh", maxTouchPoints: 5 })).toBe(true);
  expect(isMobileDevice({ userAgent: "Desktop", maxTouchPoints: 0, userAgentData: { mobile: true } })).toBe(true);
  expect(isMobileDevice({ userAgent: "Windows", maxTouchPoints: 10 })).toBe(false);
  expect(isMobileDevice({ userAgent: "Macintosh", maxTouchPoints: 0 })).toBe(false);
});
it("위치 API를 호출하여 새 GPS 좌표를 얻는다", async () => {
  const getCurrentPosition = vi.fn(success => success({ coords: { latitude: 37.5, longitude: 127, accuracy: 5 } }));
  const location = await attendanceLocation({ geolocation: { getCurrentPosition } as unknown as Geolocation }, true);
  expect(location).toEqual({ latitude: 37.5, longitude: 127, accuracy: 5 });
  expect(getCurrentPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
});
it("HTTP에서는 위치 API를 호출하지 않고 HTTPS 접속을 안내한다", async () => {
  const getCurrentPosition = vi.fn();
  await expect(attendanceLocation({ geolocation: { getCurrentPosition } as unknown as Geolocation }, false)).rejects.toThrow("HTTPS");
  expect(getCurrentPosition).not.toHaveBeenCalled();
});
for (const [code, message] of [[1, "위치 권한이 차단"], [2, "위치 서비스를 켜고"], [3, "시간이 초과"]] as const) {
  it(`위치 오류 ${code}의 복구 방법을 안내한다`, async () => {
    const getCurrentPosition = vi.fn((_success, failure) => failure({ code }));
    await expect(attendanceLocation({ geolocation: { getCurrentPosition } as unknown as Geolocation }, true)).rejects.toThrow(message);
  });
}
