import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { employees, employeeRoles, managedDepartments } from "@/db/schema";
import { getAuth } from "./auth";
import { AccessError, authorize, type Principal, type Role } from "./domain";
export async function currentPrincipal(
  requestHeaders: Headers,
): Promise<Principal | null> {
  const authSession = await getAuth().api.getSession({
    headers: requestHeaders,
  });
  if (!authSession) return null;
  const db = getDb();
  const [employee] = await db
    .select()
    .from(employees)
    .where(eq(employees.userId, authSession.user.id));
  if (!employee?.active) return null;
  const roles = await db
    .select()
    .from(employeeRoles)
    .where(eq(employeeRoles.employeeId, employee.id));
  const departments = await db
    .select()
    .from(managedDepartments)
    .where(eq(managedDepartments.employeeId, employee.id));
  return {
    userId: authSession.user.id,
    employeeId: employee.id,
    name: authSession.user.name,
    email: authSession.user.email,
    roles: roles.map((r) => r.role),
    departmentIds: departments.map((d) => d.departmentId),
    mustChangePassword: employee.mustChangePassword,
  };
}
export async function requirePage(role?: Role, allowPasswordChange = false) {
  const p = await currentPrincipal(await headers());
  if (!p) redirect("/login");
  if (p.mustChangePassword && !allowPasswordChange)
    redirect("/change-password");
  try {
    return authorize(p, role, allowPasswordChange);
  } catch (e) {
    if (e instanceof AccessError) redirect("/me?denied=1");
    throw e;
  }
}
export async function protectedResponse(request: Request, role?: Role) {
  try {
    const p = authorize(await currentPrincipal(request.headers), role);
    return Response.json(
      {
        employeeId: p.employeeId,
        name: p.name,
        email: p.email,
        roles: p.roles,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    if (e instanceof AccessError)
      return Response.json(
        { error: e.message },
        { status: e.status, headers: { "Cache-Control": "no-store" } },
      );
    throw e;
  }
}
