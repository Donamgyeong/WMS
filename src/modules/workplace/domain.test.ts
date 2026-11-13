import { expect, it } from "vitest";
import { distanceMeters, GPS_RADIUS_METERS, requestDevice, requestIp } from "./domain";
it("명시적 기기 헤더 우선, UA 폴백과 형식 오류", () => {
  expect(requestDevice(new Headers({ "x-attendance-device": "MOBILE", "user-agent": "Desktop" }))).toBe("MOBILE");
  expect(requestDevice(new Headers({ "user-agent": "iPhone" }))).toBe("MOBILE");
  expect(requestDevice(new Headers())).toBe("PC");
  expect(() => requestDevice(new Headers({ "x-attendance-device": "unknown" }))).toThrow();
});
it("전달 헤더의 첫 IP를 신뢰하고 IPv4·IPv6 형식을 검사한다", () => {
  expect(requestIp(new Headers({ "x-forwarded-for": "192.0.2.1, 10.0.0.1", "x-real-ip": "10.0.0.2" }))).toBe("192.0.2.1");
  expect(requestIp(new Headers({ "x-real-ip": "::1" }))).toBe("::1");
  expect(() => requestIp(new Headers())).toThrow();
  expect(() => requestIp(new Headers({ "x-forwarded-for": "invalid" }))).toThrow();
});
it("GPS 100m 경계 안·경계·밖과 날짜 변경선 거리", () => {
  const origin = { latitude: 0, longitude: 0 };
  const longitude = 100 / 6371008.8 * 180 / Math.PI;
  expect(distanceMeters(origin, { latitude: 0, longitude })).toBeCloseTo(100, 8);
  expect(distanceMeters(origin, { latitude: 0, longitude: longitude * .999 })).toBeLessThan(GPS_RADIUS_METERS);
  expect(distanceMeters(origin, { latitude: 0, longitude: longitude * 1.001 })).toBeGreaterThan(GPS_RADIUS_METERS);
  expect(distanceMeters({ latitude: 0, longitude: 179.9999 }, { latitude: 0, longitude: -179.9999 })).toBeLessThan(25);
});

it("IPv4-mapped IPv6를 IPv4 CIDR과 비교 가능한 주소로 정규화한다", () => {
  for (const ip of ["::ffff:192.168.0.10", "::FFFF:c0a8:a", "0:0:0:0:0:ffff:c0a8:000a"]) {
    expect(requestIp(new Headers({ "x-forwarded-for": ip }))).toBe("192.168.0.10");
  }
  expect(requestIp(new Headers({ "x-real-ip": "::ffff:127.0.0.1" }))).toBe("127.0.0.1");
  expect(requestIp(new Headers({ "x-real-ip": "2001:db8::1" }))).toBe("2001:db8::1");
});
