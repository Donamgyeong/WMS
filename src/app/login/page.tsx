import { LoginForm } from "@/modules/identity/forms";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { currentPrincipal } from "@/modules/identity/service";
const messages: Record<string, string> = {
  credentials: "이메일 또는 비밀번호를 확인하세요.",
  limited: "시도가 많습니다. 잠시 후 다시 시도하세요.",
  origin: "접속 주소를 확인한 뒤 다시 로그인하세요.",
  unavailable: "로그인할 수 없습니다. 잠시 후 다시 시도하세요.",
};
export const metadata = { referrer: "same-origin" as const };
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  if (Object.keys(params).some((key) => key !== "error")) redirect("/login");
  const principal = await currentPrincipal(await headers());
  if (principal)
    redirect(principal.mustChangePassword ? "/change-password" : "/me");
  const error =
    typeof params.error === "string" ? messages[params.error] : undefined;
  return (
    <main className="auth-card">
      <p className="eyebrow">WMS · 근태 관리</p>
      <h1>로그인</h1>
      <p>발급받은 회사 계정으로 로그인하세요.</p>
      <LoginForm error={error} />
    </main>
  );
}
