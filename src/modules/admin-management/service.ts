import { createHash, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, eq, sql } from "drizzle-orm";
import * as s from "@/db/schema";
import { authorize, type Principal, type Role } from "@/modules/identity/domain";
import { ConfigurationError, fail, text, date, period, password, strings, networks, assertHierarchy } from "./domain";
export type ConfigurationActor = Principal | "DATABASE_OPERATOR";
type Db = ReturnType<typeof import("@/db").getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
async function snapshot(db: Db | Tx) {
  const departments = await db.select().from(s.departments).orderBy(s.departments.id);
  const people = await db.select({ id: s.employees.id, userId: s.employees.userId, name: s.user.name, email: s.user.email, employeeNo: s.employees.employeeNo, departmentId: s.employees.departmentId, hiredAt: s.employees.hiredAt, terminatedAt: s.employees.terminatedAt, active: s.employees.active, mustChangePassword: s.employees.mustChangePassword }).from(s.employees).innerJoin(s.user, eq(s.user.id, s.employees.userId)).orderBy(s.employees.id);
  const roles = await db.select().from(s.employeeRoles).orderBy(s.employeeRoles.employeeId, s.employeeRoles.role);
  const managed = await db.select().from(s.managedDepartments).orderBy(s.managedDepartments.employeeId, s.managedDepartments.departmentId);
  const workplaces = await db.select().from(s.workplaces).orderBy(s.workplaces.id);
  const ranges = await db.select().from(s.workplaceIpRanges).orderBy(s.workplaceIpRanges.id);
  const policies = await db.select().from(s.workPolicies).orderBy(s.workPolicies.id);
  const assignments = await db.select().from(s.employeePolicyAssignments).orderBy(s.employeePolicyAssignments.id);
  const data = { departments, people, roles, managed, workplaces, ranges, policies, assignments };
  const credentials = await db.select({ id: s.account.id, updatedAt: s.account.updatedAt }).from(s.account).orderBy(s.account.id);
  return { ...data, revision: createHash("sha256").update(JSON.stringify({ data, credentials })).digest("hex") };
}
export type Configuration = Awaited<ReturnType<typeof snapshot>>;
// A department designation and its authorization scope are changed together.
async function designateManager(tx: Tx, departmentId: string, managerId: string | null) {
  const previous = await tx.select().from(s.managedDepartments).where(eq(s.managedDepartments.departmentId, departmentId));
  await tx.delete(s.managedDepartments).where(eq(s.managedDepartments.departmentId, departmentId));
  await tx.update(s.departments).set({ managerId }).where(eq(s.departments.id, departmentId));
  if (managerId) {
    await tx.insert(s.employeeRoles).values({ employeeId: managerId, role: "MANAGER" }).onConflictDoNothing();
    await tx.insert(s.managedDepartments).values({ employeeId: managerId, departmentId });
  }
  for (const employeeId of new Set([...previous.map(p => p.employeeId), ...(managerId ? [managerId] : [])])) {
    const remaining = await tx.select().from(s.managedDepartments).where(eq(s.managedDepartments.employeeId, employeeId));
    if (!remaining.length) {
      await tx.delete(s.employeeRoles).where(and(eq(s.employeeRoles.employeeId, employeeId), eq(s.employeeRoles.role, "MANAGER")));
      const roles = await tx.select().from(s.employeeRoles).where(eq(s.employeeRoles.employeeId, employeeId));
      if (!roles.length) await tx.insert(s.employeeRoles).values({ employeeId, role: "EMPLOYEE" });
    }
    const [person] = await tx.select().from(s.employees).where(eq(s.employees.id, employeeId));
    if (person) await tx.delete(s.session).where(eq(s.session.userId, person.userId));
  }
}
export async function getConfiguration(db: Db, actor: ConfigurationActor) {
  if (actor !== "DATABASE_OPERATOR") authorize(actor, "ADMIN");
  return db.transaction(async tx => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`);
    return snapshot(tx);
  });
}
export async function changeConfiguration(db: Db, actor: ConfigurationActor, input: unknown) {
  if (actor !== "DATABASE_OPERATOR") authorize(actor, "ADMIN");
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("잘못된 요청입니다.");
  const b = input as Record<string, unknown>;
  const action = text(b.action, "작업");
  // Hash before taking locks; never return or log the temporary password.
  const hash = action === "employee.create" || action === "password.reset" ? await hashPassword(password(b.password)) : undefined;
  return db.transaction(async tx => {
    // Also serializes legacy CLI writes and protects the last-admin count and hierarchy.
    await tx.execute(sql`LOCK TABLE departments, employees, employee_roles, managed_departments, auth_users, auth_accounts, auth_sessions, work_policies, employee_policy_assignments, workplaces, workplace_ip_ranges IN SHARE ROW EXCLUSIVE MODE`);
    const data = await snapshot(tx);
    const current = actor === "DATABASE_OPERATOR" ? undefined : data.people.find(p => p.id === actor.employeeId);
    if (actor !== "DATABASE_OPERATOR" && (!current?.active || current.mustChangePassword || !data.roles.some(r => r.employeeId === actor.employeeId && r.role === "ADMIN"))) throw new ConfigurationError(403, "관리자 권한이 필요합니다.");
    if (b.revision !== data.revision) throw new ConfigurationError(409, "다른 변경이 있습니다. 최신 데이터를 다시 불러온 뒤 저장하세요.");
    const id = b.id ? text(b.id, "대상") : actor === "DATABASE_OPERATOR" && b.newId ? text(b.newId, "신규 ID") : randomUUID();
    const person = () => { const p = data.people.find(p => p.id === id); if (!p) throw new ConfigurationError(404, "직원을 찾을 수 없습니다."); return p; };
    const department = (value: unknown) => { const v = text(value, "부서", true) || null; if (v && !data.departments.some(d => d.id === v)) fail("부서를 찾을 수 없습니다."); return v; };
    if (action === "department.save") {
      if (b.id && !data.departments.some(d => d.id === id)) throw new ConfigurationError(404, "부서를 찾을 수 없습니다.");
      const parentId = department(b.parentId), managerId = text(b.managerId, "부서장", true) || null;
      assertHierarchy(id, parentId, data.departments);
      if (managerId && !data.people.some(p => p.id === managerId && p.active)) fail("활성 직원을 부서장으로 선택하세요.");
      const values = { name: text(b.name, "부서명"), parentId, managerId };
      if (b.id) await tx.update(s.departments).set(values).where(eq(s.departments.id, id)); else await tx.insert(s.departments).values({ id, ...values });
      await designateManager(tx, id, managerId);
    } else if (action === "employee.create" || action === "employee.save") {
      const hiredAt = date(b.hiredAt, true), terminatedAt = date(b.terminatedAt, true);
      if (hiredAt && terminatedAt && hiredAt > terminatedAt) fail("퇴사일은 입사일 이후여야 합니다.");
      const values = { name: text(b.name, "이름"), employeeNo: text(b.employeeNo, "사번", true) || null, departmentId: department(b.departmentId), hiredAt, terminatedAt };
      if (action === "employee.create") {
        const email = text(b.email, "이메일").toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("이메일을 확인하세요.");
        const userId = randomUUID();
        await tx.insert(s.user).values({ id: userId, name: values.name, email });
        await tx.insert(s.account).values({ id: randomUUID(), userId, accountId: userId, providerId: "credential", password: hash });
        await tx.insert(s.employees).values({ id, userId, ...values, mustChangePassword: true });
      } else {
        const p = person();
        await tx.update(s.employees).set(values).where(eq(s.employees.id, id));
        await tx.update(s.user).set({ name: values.name, updatedAt: new Date() }).where(eq(s.user.id, p.userId));
      }
      const roles = strings(b.roles) as Role[], managed = strings(b.departmentIds);
      if (!roles.length || roles.some(r => !["ADMIN", "MANAGER", "EMPLOYEE"].includes(r))) fail("역할을 선택하세요.");
      if (roles.includes("MANAGER") ? !managed.length : managed.length > 0) fail("부서장 역할과 담당 부서를 함께 설정하세요.");
      managed.forEach(department);
      if (managed.length && action === "employee.save" && !person().active) fail("활성 직원만 부서장으로 지정할 수 있습니다.");
      if (action === "employee.save") {
        const p = person();
        if (p.active && data.roles.some(r => r.employeeId === id && r.role === "ADMIN") && !roles.includes("ADMIN") && !data.people.some(other => other.id !== id && other.active && data.roles.some(r => r.employeeId === other.id && r.role === "ADMIN"))) fail("마지막 활성 관리자의 권한을 제거할 수 없습니다.");
        await tx.delete(s.employeeRoles).where(eq(s.employeeRoles.employeeId, id));
        await tx.delete(s.managedDepartments).where(eq(s.managedDepartments.employeeId, id));
        await tx.delete(s.session).where(eq(s.session.userId, p.userId));
        // Clear designations no longer backed by manager scope.
        for (const d of data.departments.filter(d => d.managerId === id && (!roles.includes("MANAGER") || !managed.includes(d.id)))) await tx.update(s.departments).set({ managerId: null }).where(eq(s.departments.id, d.id));
      }
      await tx.insert(s.employeeRoles).values(roles.map(role => ({ employeeId: id, role })));
      for (const departmentId of managed) await designateManager(tx, departmentId, id);
    } else if (action === "employee.status" || action === "password.reset") {
      const p = person();
      if (action === "employee.status") {
        if (typeof b.active !== "boolean") fail("계정 상태를 확인하세요.");
        if (!b.active && data.roles.some(r => r.employeeId === id && r.role === "ADMIN") && !data.people.some(other => other.id !== id && other.active && data.roles.some(r => r.employeeId === other.id && r.role === "ADMIN"))) fail("마지막 활성 관리자를 비활성화할 수 없습니다.");
        await tx.update(s.employees).set({ active: b.active as boolean }).where(eq(s.employees.id, id));
        if (!b.active) await tx.update(s.departments).set({ managerId: null }).where(eq(s.departments.managerId, id));
      } else {
        const updated = await tx.update(s.account).set({ password: hash, updatedAt: new Date() }).where(and(eq(s.account.userId, p.userId), eq(s.account.providerId, "credential"))).returning({ id: s.account.id });
        if (!updated.length) fail("비밀번호 계정이 없습니다.");
        await tx.update(s.employees).set({ mustChangePassword: true }).where(eq(s.employees.id, id));
      }
      await tx.delete(s.session).where(eq(s.session.userId, p.userId));
    } else if (action === "workplace.save") {
      if (b.id && !data.workplaces.some(w => w.id === id)) throw new ConfigurationError(404, "근무지를 찾을 수 없습니다.");
      const latitude = Number(b.latitude), longitude = Number(b.longitude);
      if (b.latitude === "" || b.longitude === "" || b.latitude == null || b.longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) fail("위도·경도를 확인하세요.");
      const values = { name: text(b.name, "근무지명"), latitude: String(latitude), longitude: String(longitude), gpsRadiusMeters: 100 };
      if (b.id) await tx.update(s.workplaces).set(values).where(eq(s.workplaces.id, id)); else await tx.insert(s.workplaces).values({ id, ...values });
      await tx.delete(s.workplaceIpRanges).where(eq(s.workplaceIpRanges.workplaceId, id));
      // PostgreSQL cidr validates host bits and canonicalizes IPv6.
      for (const ipNetwork of networks(b.networks)) await tx.insert(s.workplaceIpRanges).values({ id: randomUUID(), workplaceId: id, ipNetwork });
    } else if (action === "policy.create") {
      const bounds = period(b.effectiveFrom, b.effectiveTo);
      const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
      if (bounds.effectiveFrom <= today) fail("새 정책은 내일 이후부터 적용할 수 있습니다.");
      const name = text(b.name, "정책명");
      const version = Math.max(0, ...data.policies.filter(p => p.name === name).map(p => p.version)) + 1;
      const previous = data.policies.filter(p => p.name === name && (!p.effectiveTo || p.effectiveTo > bounds.effectiveFrom));
      for (const p of previous) {
        if (p.effectiveFrom >= bounds.effectiveFrom) fail("후속 정책 버전과 기간이 겹칩니다.");
        const affected = data.assignments.filter(a => a.workPolicyId === p.id && (!a.effectiveTo || a.effectiveTo > bounds.effectiveFrom));
        if (affected.some(a => a.effectiveFrom >= bounds.effectiveFrom)) fail("예약 배정이 있습니다. 다른 정책명으로 생성하거나 적용일을 조정하세요.");
        if (affected.some(a => bounds.effectiveTo && (!a.effectiveTo || a.effectiveTo > bounds.effectiveTo))) fail("새 버전 종료일이 기존 배정 종료일보다 빠릅니다. 종료일을 비우거나 이후 날짜로 설정하세요.");
        await tx.update(s.workPolicies).set({ effectiveTo: bounds.effectiveFrom }).where(eq(s.workPolicies.id, p.id));
        for (const a of affected) await tx.update(s.employeePolicyAssignments).set({ effectiveTo: bounds.effectiveFrom }).where(eq(s.employeePolicyAssignments.id, a.id));
      }
      await tx.insert(s.workPolicies).values({ id, name, version, ...bounds });
      for (const p of previous) for (const a of data.assignments.filter(a => a.workPolicyId === p.id && a.effectiveFrom < bounds.effectiveFrom && (!a.effectiveTo || a.effectiveTo > bounds.effectiveFrom))) {
        await tx.insert(s.employeePolicyAssignments).values({ id: randomUUID(), employeeId: a.employeeId, workPolicyId: id, effectiveFrom: bounds.effectiveFrom, effectiveTo: a.effectiveTo });
      }
    } else if (action === "policy.assign") {
      const employeeId = text(b.employeeId, "직원"), workPolicyId = text(b.workPolicyId, "정책");
      if (!data.people.some(p => p.id === employeeId && p.active)) fail("활성 직원을 선택하세요.");
      const bounds = period(b.effectiveFrom, b.effectiveTo), policy = data.policies.find(p => p.id === workPolicyId);
      const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
      if (bounds.effectiveFrom <= today) fail("정책 배정은 내일 이후부터 적용할 수 있습니다.");
      if (!policy || bounds.effectiveFrom < policy.effectiveFrom || (policy.effectiveTo && (!bounds.effectiveTo || bounds.effectiveTo > policy.effectiveTo))) fail("배정 기간은 정책 유효 기간 안에 있어야 합니다.");
      const existing = data.assignments.filter(a => a.employeeId === employeeId);
      for (const a of existing) {
        if (a.effectiveFrom < bounds.effectiveFrom && (!a.effectiveTo || a.effectiveTo > bounds.effectiveFrom)) await tx.update(s.employeePolicyAssignments).set({ effectiveTo: bounds.effectiveFrom }).where(eq(s.employeePolicyAssignments.id, a.id));
        else if ((!a.effectiveTo || a.effectiveTo > bounds.effectiveFrom) && (!bounds.effectiveTo || a.effectiveFrom < bounds.effectiveTo)) fail("기존 배정과 기간이 겹칩니다. 시작일과 종료일을 확인하세요.");
      }
      await tx.insert(s.employeePolicyAssignments).values({ id, employeeId, workPolicyId, ...bounds });
    } else fail("지원하지 않는 작업입니다.");
    return { id };
  });
}
