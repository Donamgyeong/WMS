"use client";
import { useEffect, useRef, useState } from "react";
import type { Place } from "./place-search";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
type Props = { latitude: string; longitude: string; disabled: boolean; onChange: (latitude: string, longitude: string) => void };
export function LocationPicker({ latitude, longitude, disabled, onChange }: Props) {
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false), [searched, setSearched] = useState(false), [searchError, setSearchError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function search() {
    if (disabled || searching || query.trim().length < 2) return;
    request.current?.abort();
    const active = new AbortController(); request.current = active;
    setSearching(true); setSearchError(""); setPlaces([]); setSearched(false);
    try {
      const response = await fetch(`/api/admin/places?q=${encodeURIComponent(query.trim())}`, { cache: "no-store", signal: active.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (!active.signal.aborted) { setPlaces(result.places); setSearched(true); }
    } catch (e) { if (!active.signal.aborted) setSearchError(e instanceof Error ? e.message : "검색에 실패했습니다."); }
    finally { if (!active.signal.aborted) setSearching(false); }
  }
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const marker = useRef<Leaflet.Marker | null>(null);
  const circle = useRef<Leaflet.Circle | null>(null);
  const library = useRef<typeof Leaflet | null>(null);
  const callback = useRef(onChange), locked = useRef(disabled);
  const [ready, setReady] = useState(false), [error, setError] = useState("");
  const [tileError, setTileError] = useState(false), [locating, setLocating] = useState(false);
  useEffect(() => { callback.current = onChange; locked.current = disabled; }, [onChange, disabled]);
  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | undefined;
    void import("leaflet").then(L => {
      if (cancelled || !container.current) return;
      library.current = L;
      const instance = L.map(container.current, { scrollWheelZoom: false }).setView([37.5665, 126.9780], 16);
      map.current = instance;
      instance.zoomControl.setPosition("topright");
      instance.zoomControl.getContainer()?.setAttribute("aria-label", "지도 확대·축소");
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
      }).on("tileerror", () => { if (!cancelled) setTileError(true); }).addTo(instance);
      instance.on("click", (e: Leaflet.LeafletMouseEvent) => {
        if (!locked.current) callback.current(e.latlng.lat.toFixed(7), e.latlng.wrap().lng.toFixed(7));
      });
      observer = new ResizeObserver(() => instance.invalidateSize()); observer.observe(container.current);
      setReady(true);
    }).catch(() => { if (!cancelled) setError("지도를 불러오지 못했습니다. 편집을 다시 열어주세요."); });
    return () => { cancelled = true; observer?.disconnect(); map.current?.remove(); map.current = null; marker.current = null; circle.current = null; };
  }, []);
  const selected = latitude !== "" && longitude !== "" && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude));
  useEffect(() => {
    const L = library.current, instance = map.current;
    if (!ready || !L || !instance) return;
    if (!selected) { marker.current?.remove(); circle.current?.remove(); marker.current = null; circle.current = null; return; }
    const point: Leaflet.LatLngExpression = [Number(latitude), Number(longitude)];
    if (!marker.current) {
      marker.current = L.marker(point, { draggable: !disabled, title: "근무지 위치 (드래그로 이동)", icon: L.divIcon({ className: "ws-map-marker", html: '<span aria-hidden="true"></span>', iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(instance);
      marker.current.on("dragend", () => {
        const point = marker.current!.getLatLng().wrap();
        if (!locked.current) callback.current(point.lat.toFixed(7), point.lng.toFixed(7));
      });
      circle.current = L.circle(point, { radius: 100, color: "#243e73", fillColor: "#243e73", fillOpacity: .12, weight: 2, interactive: false }).addTo(instance);
    } else { marker.current.setLatLng(point); circle.current?.setLatLng(point); }
    instance.panTo(point, { animate: false });
    if (disabled) marker.current.dragging?.disable(); else marker.current.dragging?.enable();
  }, [ready, selected, latitude, longitude, disabled]);
  function locate() {
    if (!navigator.geolocation) { setError("현재 위치를 사용할 수 없는 브라우저입니다."); return; }
    setLocating(true); setError("");
    navigator.geolocation.getCurrentPosition(position => {
      setLocating(false);
      if (map.current && !locked.current) callback.current(position.coords.latitude.toFixed(7), position.coords.longitude.toFixed(7));
    }, () => { setLocating(false); setError("현재 위치를 가져오지 못했습니다. 위치 권한을 확인하거나 지도에서 선택하세요."); }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
  }
  return <section className="ws-location-picker" aria-label="근무지 위치 선택">
    <div className="ws-location-heading"><h3>근무지 위치</h3><button type="button" disabled={disabled || locating || !ready} onClick={locate}>{locating ? "위치 확인 중…" : "현재 위치로 이동"}</button></div>
    <p>지도를 클릭하거나 마커를 옮겨 위치를 선택하세요. 원은 허용 반경 100m입니다.</p>
    <div className="ws-place-search">
      <label>장소명·주소 검색<input type="search" value={query} maxLength={100} placeholder="예: 서울시청, 테헤란로 152" onChange={e => { request.current?.abort(); setSearching(false); setQuery(e.target.value); setPlaces([]); setSearched(false); setSearchError(""); }} onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void search(); } }} /></label>
      <button type="button" disabled={disabled || searching || !ready || query.trim().length < 2} onClick={() => void search()}>{searching ? "검색 중…" : "장소 검색"}</button>
    </div>
    {searchError && <p role="alert">{searchError}</p>}
    {searched && !places.length && <p role="status">검색 결과가 없습니다. 다른 장소명이나 주소로 검색하세요.</p>}
    {places.length > 0 && <ul className="ws-place-results" aria-label="장소 검색 결과">{places.map(place => <li key={place.id}><button type="button" disabled={disabled || !ready} onClick={() => { onChange(place.latitude, place.longitude); map.current?.setView([Number(place.latitude), Number(place.longitude)], 17); setPlaces([]); setSearched(false); }}><strong>{place.name}</strong><span>{place.address}</span></button></li>)}</ul>}
    <p className="ws-place-credit">장소 검색: Photon · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a></p>
    <div ref={container} className="ws-location-map" role="region" aria-label="근무지 지도" />
    {!ready && !error && <p role="status">지도를 불러오는 중입니다.</p>}
    {tileError && <p role="alert">지도 배경을 불러오지 못했습니다. 네트워크 연결을 확인하세요.</p>}
    {error && <p role="alert">{error}</p>}
    <div className="ws-location-result"><output aria-label="선택 위치">{selected ? `위도 ${latitude} · 경도 ${longitude}` : "아직 위치를 선택하지 않았습니다."}</output><button type="button" disabled={disabled || !ready} onClick={() => { const point = map.current?.getCenter().wrap(); if (point) onChange(point.lat.toFixed(7), point.lng.toFixed(7)); }}>지도 중심 선택</button></div>
  </section>;
}
