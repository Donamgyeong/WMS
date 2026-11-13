import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { ConfigurationError } from "./domain";
export type Place = { id: string; name: string; address: string; latitude: string; longitude: string };
const cache = new Map<string, { until: number; places: Place[] }>();
export async function searchPlaces(raw: string | null): Promise<Place[]> {
  const query = raw?.trim().replace(/\s+/g, " ") ?? "";
  if (query.length < 2 || query.length > 100) throw new ConfigurationError(400, "장소명·주소를 2~100자로 입력하세요.");
  const endpoint = process.env.PHOTON_SEARCH_URL || "https://photon.komoot.io/api/";
  const key = `${endpoint}:${query.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.places;
  const now = Date.now();
  // Shared across app processes; never send bursts to the upstream service.
  const limit = await getDb().execute(sql`
    INSERT INTO auth_rate_limits(id,key,count,last_request) VALUES('place-search:global','place-search:global',1,${now})
    ON CONFLICT(key) DO UPDATE SET last_request=${now}
    WHERE auth_rate_limits.last_request <= ${now - 1000}
    RETURNING id
  `);
  if (!limit.rows.length) throw new ConfigurationError(429, "검색 요청이 많습니다. 잠시 후 다시 검색하세요.");
  try {
    const url = new URL(endpoint); url.searchParams.set("q", query); url.searchParams.set("limit", "5");
    const response = await fetch(url, { headers: { "User-Agent": "WMS-Workplace-Search/1.0", Accept: "application/json" }, signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!response.ok) throw new Error("upstream");
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("features" in body) || !Array.isArray(body.features)) throw new Error("format");
    const places: Place[] = [];
    for (const feature of body.features.slice(0, 5)) {
      const coordinates = feature?.geometry?.coordinates, p = feature?.properties;
      if (feature?.geometry?.type !== "Point" || !Array.isArray(coordinates) || typeof coordinates[0] !== "number" || typeof coordinates[1] !== "number" || !Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1]) || Math.abs(coordinates[0]) > 180 || Math.abs(coordinates[1]) > 90 || !p || typeof p !== "object") continue;
      const words = (keys: string[]) => [...new Set(keys.map(k => p[k]).filter((v): v is string => typeof v === "string" && v.length > 0))].join(" ").slice(0, 500);
      const address = words(["country", "state", "city", "district", "street", "housenumber"]);
      const name = typeof p.name === "string" && p.name ? p.name.slice(0, 254) : address;
      if (name) places.push({ id: `${places.length}`, name, address, latitude: coordinates[1].toFixed(7), longitude: coordinates[0].toFixed(7) });
    }
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(key, { until: Date.now() + 3600000, places });
    return places;
  } catch { throw new ConfigurationError(502, "장소 검색을 불러오지 못했습니다. 잠시 후 다시 시도하거나 지도에서 직접 선택하세요."); }
}
