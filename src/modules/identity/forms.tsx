"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "./client";
export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const result = await authClient.signIn.email({
        email: String(data.get("email")).trim().toLowerCase(),
        password: String(data.get("password")),
        rememberMe: false,
      });
      if (result.error)
        setError(
          result.error.status === 429
            ? "시도가 많습니다. 잠시 후 다시 시도하세요."
            : "이메일 또는 비밀번호를 확인하세요.",
        );
      else {
        router.replace("/me");
        router.refresh();
      }
    } catch {
      setError("연결할 수 없습니다. 다시 시도하세요.");
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <label>
        회사 이메일
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          maxLength={254}
        />
      </label>
      <label>
        비밀번호
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button disabled={pending}>{pending ? "로그인 중…" : "로그인"}</button>
    </form>
  );
}
export function LogoutButton() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          try {
            const result = await authClient.signOut();
            if (result.error) setError("로그아웃하지 못했습니다.");
            else {
              router.replace("/login");
              router.refresh();
            }
          } catch {
            setError("연결할 수 없습니다.");
          } finally {
            setPending(false);
          }
        }}
      >
        로그아웃
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
export function PasswordForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const currentPassword = String(data.get("currentPassword"));
    const newPassword = String(data.get("newPassword"));
    if (newPassword !== data.get("confirmPassword")) {
      setError("새 비밀번호가 일치하지 않습니다.");
      return;
    }
    if (currentPassword === newPassword) {
      setError("기존 비밀번호와 다른 비밀번호를 입력하세요.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (result.error)
        setError("현재 비밀번호와 새 비밀번호 조건을 확인하세요.");
      else {
        router.replace("/me");
        router.refresh();
      }
    } catch {
      setError("연결할 수 없습니다.");
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <label>
        현재 비밀번호
        <input
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
        />
      </label>
      <label>
        새 비밀번호 (12~128자)
        <input
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
        />
      </label>
      <label>
        새 비밀번호 확인
        <input
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button disabled={pending}>
        {pending ? "변경 중…" : "비밀번호 변경"}
      </button>
      <LogoutButton />
    </form>
  );
}
