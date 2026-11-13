import { overviewHttp } from "@/modules/workspace/dashboard-http";
export const GET = (request: Request) => overviewHttp(request, "admin");
