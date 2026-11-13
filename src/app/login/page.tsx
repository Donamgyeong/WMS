import { LoginForm } from "@/modules/identity/forms";
export default function Login() {
  return (
    <main className="auth-card">
      <p className="eyebrow">WMS · 근태 관리</p>
      <h1>로그인</h1>
      <p>발급받은 회사 계정으로 로그인하세요.</p>
      <LoginForm />
    </main>
  );
}
