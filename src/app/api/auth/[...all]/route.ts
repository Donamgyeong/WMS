import { handleAuthRequest } from "@/modules/identity/http";
export const runtime = "nodejs";
export const GET = handleAuthRequest;
export const POST = handleAuthRequest;
