import { Suspense } from "react";
import LoginForm from "./login-form";
import AndroidAppButton from "@/components/AndroidAppButton";

export const metadata = { title: "Sign in — Catalyst" };

/**
 * Sign-in only. There is no self sign-up: admins create accounts on Admin → Users
 * (the GoTrue admin API), and public sign-up is switched off in Supabase Auth too
 * (disable_signup), so the anon key can't create accounts either.
 */
export default function LoginPage() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-brand-soft via-white to-grid-head px-4 py-10">
      {/* soft brand glow behind the card */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-brand/10 blur-3xl"
      />

      <main className="relative w-full max-w-sm">
        <div className="rounded-2xl border border-grid-line bg-white/95 p-6 shadow-xl shadow-slate-900/5 sm:p-8">
          <img
            src="/brand/logo-wordmark.png"
            alt="Catalyst IT Solutions"
            className="mx-auto h-auto w-56 max-w-full select-none"
          />
          <div className="mt-6 text-center">
            <h1 className="text-xl font-semibold text-slate-900">Welcome back</h1>
            <p className="mt-1 text-sm text-slate-500">Sign in to Task &amp; Bug Tracking</p>
          </div>
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>

        <p className="mt-5 text-center text-xs leading-relaxed text-slate-500">
          Accounts are created by your admin.
          <br />
          Forgot your password? Ask your admin to reset it.
        </p>
        <div className="mt-4 text-center">
          <AndroidAppButton variant="link" />
        </div>
      </main>

      <footer className="relative mt-10 text-[11px] text-slate-400">© Catalyst IT Solutions</footer>
    </div>
  );
}
