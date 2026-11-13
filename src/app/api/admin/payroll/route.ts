import { protectedResponse } from "@/modules/identity/service";
export const GET = (request: Request) => protectedResponse(request, "ADMIN");
