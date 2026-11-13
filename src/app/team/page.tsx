import Link from "next/link";
import { requirePage } from "@/modules/identity/service";
export default async function Team() {
  const p = await requirePage("MANAGER");
  return (
    <main>
      <h1>부서 관리</h1>
      <p>담당 부서: {p.departmentIds.length}개</p>
      <p>부서 근태 기능은 후속 구현 예정입니다.</p>
      <Link href="/me">내 계정</Link>
    </main>
  );
}
