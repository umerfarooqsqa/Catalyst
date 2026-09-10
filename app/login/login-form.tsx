"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, Input, Label } from "@/components/ui";

const DEMO = [
  ["admin@catalyst.test", "Admin"],
  ["qa@catalyst.test", "QA"],
  ["deva@catalyst.test", "Android"],
  ["devw@catalyst.test", "iOS"],
  ["viewer@catalyst.test", "Viewer"],
];

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = params.get("redirect") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showDemo, setShowDemo] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName || email } },
        });
        if (error) throw error;
      }
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      router.replace(redirectTo);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <form onSubmit={submit} className="space-y-3">
        {mode === "signup" && (
          <div>
            <Label htmlFor="fullName">Full name</Label>
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </div>
        )}
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {error ? (
          <p className="rounded-sm bg-red-50 px-3 py-2 text-[13px] text-red-700">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={busy} className="w-full justify-center">
          {busy
            ? "Please wait…"
            : mode === "signup"
              ? "Create account & sign in"
              : "Sign in"}
        </Button>
      </form>

      <button
        onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        className="mt-3 w-full text-center text-xs text-slate-500 hover:text-slate-700"
      >
        {mode === "signin"
          ? "Need an account? Sign up"
          : "Have an account? Sign in"}
      </button>

      <div className="mt-4 border-t border-grid-line pt-3">
        <button
          onClick={() => setShowDemo((s) => !s)}
          className="text-xs font-medium text-slate-500 hover:text-slate-700"
        >
          {showDemo ? "Hide" : "Show"} demo accounts
        </button>
        {showDemo ? (
          <div className="mt-2">
            <p className="mb-2 text-xs text-slate-500">
              Password <span className="kbd">Passw0rd!</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {DEMO.map(([addr, label]) => (
                <button
                  key={addr}
                  onClick={() => {
                    setEmail(addr);
                    setPassword("Passw0rd!");
                    setMode("signin");
                  }}
                  className="rounded-sm border border-grid-line bg-grid-head px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
