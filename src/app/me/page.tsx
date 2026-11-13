import Link from "next/link";
import { requirePage } from "@/modules/identity/service";
import { LogoutButton } from "@/modules/identity/forms";
import { EmployeeDashboard } from "@/modules/dashboard/dashboard";

export default async function Me({ searchParams }: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const p = await requirePage();
  const query = await searchParams;
  return <EmployeeDashboard name={p.name} denied={Boolean(query.denied)} account={<>
    <span>{p.email}</span>
    {p.roles.includes("MANAGER") && <Link href="/team">부서 관리</Link>}
    {p.roles.includes("ADMIN") && <Link href="/admin">관리자</Link>}
    <Link href="/change-password">비밀번호 변경</Link>
    <LogoutButton />
  </>} />;
}
