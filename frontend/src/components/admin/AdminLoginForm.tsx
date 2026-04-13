import type { FormEvent } from "react";

type AdminLoginFormProps = {
  username: string;
  password: string;
  loginError: string;
  isLoggingIn: boolean;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function AdminLoginForm({
  username,
  password,
  loginError,
  isLoggingIn,
  onUsernameChange,
  onPasswordChange,
  onSubmit,
}: AdminLoginFormProps) {
  return (
    <div className="mx-auto mt-16 max-w-sm rounded-xl bg-white p-6 shadow-sm sm:p-8">
      <h1 className="mb-2 text-xl font-bold">관리자 로그인</h1>
      <p className="mb-6 text-sm text-gray-500">
        등록, 수정, 삭제를 위해 로그인하세요.
      </p>
      {loginError && <p className="mb-4 text-sm text-red-600">{loginError}</p>}
      <form onSubmit={onSubmit} className="space-y-4">
        <input
          type="text"
          placeholder="아이디"
          value={username}
          onChange={(event) => onUsernameChange(event.target.value)}
          className="w-full rounded border px-3 py-2"
        />
        <input
          type="password"
          placeholder="비밀번호"
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
          className="w-full rounded border px-3 py-2"
        />
        <button
          disabled={isLoggingIn}
          className="w-full rounded bg-rose-600 py-2 text-white hover:bg-rose-700 disabled:opacity-50"
        >
          {isLoggingIn ? "로그인 중..." : "로그인"}
        </button>
      </form>
    </div>
  );
}
