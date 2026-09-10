import { Suspense } from "react";
import LoginForm from "./login-form";

export const metadata = { title: "Sign in — Catalyst" };

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-grid-head px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-sm bg-brand text-lg font-bold text-white">
            C
          </div>
          <h1 className="text-lg font-semibold text-slate-900">
            Catalyst IT Solutions
          </h1>
          <p className="text-sm text-slate-500">Task &amp; Bug Tracking</p>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
