export function LoginForm({ error }: { error?: string }) {
  return (
    <form method="post" action="/api/session/login">
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
      <button type="submit">로그인</button>
    </form>
  );
}
export function LogoutButton() {
  return (
    <form method="post" action="/api/session/logout">
      <button type="submit">로그아웃</button>
    </form>
  );
}
export function PasswordForm({ error }: { error?: string }) {
  return (
    <>
      <form method="post" action="/api/session/password">
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
        <button type="submit">비밀번호 변경</button>
      </form>
      <LogoutButton />
    </>
  );
}
