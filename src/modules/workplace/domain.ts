import { isIP } from "node:net";
import { AttendanceError } from "@/modules/attendance/domain";
export function requestDevice(headers: Headers): "PC" | "MOBILE" {
  const explicit = headers.get("x-attendance-device");
  if (explicit) {
    if (explicit !== "PC" && explicit !== "MOBILE") throw new AttendanceError(400, "기기 헤더가 올바르지 않습니다.");
    return explicit;
  }
  return headers.get("sec-ch-ua-mobile") === "?1" || /Android|iPhone|iPad|Mobile/i.test(headers.get("user-agent") ?? "") ? "MOBILE" : "PC";
}
export function requestIp(headers: Headers) {
  const ip = (headers.get("x-forwarded-for")?.split(",")[0] ?? headers.get("x-real-ip") ?? "").trim();
  if (!isIP(ip)) throw new AttendanceError(400, "클라이언트 IP 헤더가 필요합니다.");
  // Node/proxies may expose IPv4 peers as IPv4-mapped IPv6. PostgreSQL
  // treats those as IPv6, so they do not match an IPv4 CIDR without conversion.
  if (isIP(ip) === 6) {
    const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
    const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(canonical);
    if (mapped) {
      const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
      return [high >> 8, high & 255, low >> 8, low & 255].join(".");
    }
  }
  return ip;
}
export function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = Math.PI / 180;
  const dlat = (b.latitude - a.latitude) * rad, dlon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dlon / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
export const GPS_RADIUS_METERS = 100;
