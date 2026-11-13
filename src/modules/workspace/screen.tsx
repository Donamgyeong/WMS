"use client";
import { Suspense } from "react";
import Link from "next/link";
import { LogoutButton } from "@/modules/identity/forms";
import { adminRoutes, teamRoutes, type WorkspaceRoute } from "./routes";
import { WorkspaceDashboard } from "./dashboard";
import { WorkspaceManagement } from "./management";
import "./design.css";
import "./workspace.css";

export function WorkspaceScreen({ area, route, name }: {
  area: "team" | "admin"; route: WorkspaceRoute; name: string;
}) {
  const routes = area === "admin" ? adminRoutes : teamRoutes;
  return <div className="workspace-design">
    <header className="ws-header">
      <Link href="/me" className="ws-logo">WMS</Link>
      <nav aria-label={`${area === "admin" ? "관리자" : "부서장"} 메뉴`}>
        {routes.filter(r => r.key !== "team-detail").map(r => <Link key={r.path} href={r.path} aria-current={r.key === route.key || (route.key === "team-detail" && r.key === "team-attendance") ? "page" : undefined}>{r.label}</Link>)}
      </nav>
      <details className="ws-account"><summary>{area === "admin" ? "관리자" : "부서장"} · {name}</summary><div><Link href="/me">내 근태</Link><Link href="/change-password">비밀번호 변경</Link><LogoutButton /></div></details>
    </header>
    <main className="ws-main">
      {route.key === "team" || route.key === "admin" ? <WorkspaceDashboard area={area} /> : <Suspense fallback={<p>화면을 불러오는 중입니다.</p>}><WorkspaceManagement key={route.key} area={area} route={route} /></Suspense>}
    </main>
    {area === "admin" && <nav className="ws-payroll-links" aria-label="임금·정산 하위 메뉴"><Link href="/admin/contracts">시급·계약 관리</Link><Link href="/admin/settlements">정산 목록·상세</Link></nav>}
  </div>;
}
