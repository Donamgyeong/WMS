import Link from "next/link";
import { requirePage } from "@/modules/identity/service";
export default async function Admin() {
  await requirePage("ADMIN");
  return (
    <main>
      <h1>관리자</h1>
      <p>
        관리자 권한이 확인되었습니다. 계정 발급·비활성화는 운영 CLI에서
        수행합니다.
      </p>
      <Link href="/me">내 계정</Link>
    </main>
  );
}
