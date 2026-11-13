import { managementHttp } from "@/modules/workspace/management-http";
export async function GET(request: Request, { params }: { params: Promise<{ view: string }> }) {
  return managementHttp(request, "team", (await params).view);
}
