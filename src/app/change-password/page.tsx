import { requirePage } from "@/modules/identity/service";
import { PasswordForm } from "@/modules/identity/forms";
export default async function ChangePassword() {
  await requirePage(undefined, true);
  return (
    <main className="auth-card">
      <h1>비밀번호 변경</h1>
      <p>처음 로그인한 계정은 비밀번호를 변경해야 합니다.</p>
      <PasswordForm />
    </main>
  );
}
