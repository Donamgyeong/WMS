import "server-only";
import { notFound } from "next/navigation";
import { requirePage } from "@/modules/identity/service";
import { adminRoutes, teamRoutes } from "./routes";
import { WorkspaceScreen } from "./screen";
export async function WorkspacePage({ area, segments = [] }: { area: "team" | "admin"; segments?: string[] }) {
  const principal = await requirePage(area === "admin" ? "ADMIN" : "MANAGER");
  const path = `/${[area, ...segments].join("/")}`;
  const route = (area === "admin" ? adminRoutes : teamRoutes).find(r => r.path === path);
  if (!route) notFound();
  return <WorkspaceScreen key={route.key} area={area} route={route} name={principal.name} />;
}
