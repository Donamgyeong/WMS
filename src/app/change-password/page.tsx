import { requirePage } from "@/modules/identity/service";
import { PasswordForm } from "@/modules/identity/forms";
export default async function ChangePassword({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const messages: Record<string, string> = {
    mismatch: "새 비밀번호가 일치하지 않습니다.",
    password: "현재 비밀번호와 새 비밀번호 조건을 확인하세요.",
    origin: "접속 주소를 확인한 뒤 다시 시도하세요.",
    unavailable: "변경할 수 없습니다. 잠시 후 다시 시도하세요.",
  };
  await requirePage(undefined, true);
  return (
    <main className="auth-card">
      <h1>비밀번호 변경</h1>
      <p>처음 로그인한 계정은 비밀번호를 변경해야 합니다.</p>
      <PasswordForm error={error ? messages[error] : undefined} />
    </main>
  );
}
