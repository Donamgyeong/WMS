type DeviceNavigator = Pick<Navigator, "userAgent" | "maxTouchPoints"> & {
  userAgentData?: { mobile: boolean };
};

export function isMobileDevice(nav: DeviceNavigator): boolean {
  return nav.userAgentData?.mobile === true || /Android|iPhone|iPad|Mobile/i.test(nav.userAgent)
    || (/Macintosh|MacIntel/i.test(nav.userAgent) && nav.maxTouchPoints > 1);
}

export async function attendanceLocation(nav: Pick<Navigator, "geolocation">, secure: boolean) {
  if (!secure) throw new Error("모바일 위치 권한은 HTTPS 접속에서만 요청할 수 있습니다. HTTPS 주소로 다시 접속하세요. (개발용 localhost 제외)");
  if (!nav.geolocation) throw new Error("위치를 지원하는 브라우저로 접속하세요. 앱 내 브라우저라면 Safari 또는 Chrome에서 여세요.");
  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    nav.geolocation.getCurrentPosition(resolve, error => {
      const messages: Record<number, string> = {
        1: "위치 권한이 차단되었습니다. 브라우저의 사이트 설정과 기기 설정에서 위치 접근을 허용한 뒤 다시 시도하세요.",
        2: "현재 위치를 확인할 수 없습니다. 기기의 위치 서비스를 켜고 다시 시도하세요.",
        3: "위치 확인 시간이 초과되었습니다. GPS 수신이 가능한 곳에서 다시 시도하세요.",
      };
      reject(new Error(messages[error.code] ?? "위치를 가져오지 못했습니다. 위치 권한과 기기 설정을 확인하세요."));
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
  return { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy };
}
