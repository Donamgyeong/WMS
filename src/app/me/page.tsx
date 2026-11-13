import Link from "next/link";
import { requirePage } from "@/modules/identity/service";
import { LogoutButton } from "@/modules/identity/forms";
export default async function Me({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const p = await requirePage();
  const query = await searchParams;
  return (
    <main>
      <p className="eyebrow">WMS · 내 계정</p>
      <h1>{p.name}님</h1>
      {query.denied && <p role="alert">접근 권한이 없습니다.</p>}
      <p>{p.email}</p>
      <p>역할: {p.roles.join(", ")}</p>
      <nav>
        {p.roles.includes("MANAGER") && <Link href="/team">부서 관리</Link>}
        {p.roles.includes("ADMIN") && <Link href="/admin">관리자</Link>}
        <Link href="/change-password">비밀번호 변경</Link>
      </nav>
      <LogoutButton />
    </main>
  );
}
