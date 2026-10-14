import { useState } from "react";
import { post } from "../lib/api";
import { queryClient, useMe } from "../lib/queries";
import { Button, Field, Input } from "../components/ui";

export function AuthPage() {
  const { data: me } = useMe();
  const canRegister = !!me?.registrationOpen;
  const [mode, setMode] = useState<"login" | "register">(canRegister ? "register" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "register") await post("/auth/register", { email, password, displayName: name });
      else await post("/auth/login", { email, password });
      await queryClient.invalidateQueries();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="/icons/icon.svg" alt="" className="mx-auto mb-4 size-12 rounded-2xl" />
          <h1 className="font-display text-3xl font-semibold tracking-tight">Margin</h1>
          <p className="mt-2 text-sm text-muted">Your modules, your materials, your voice — in one calm place.</p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-soft">
          <h2 className="font-display text-xl font-semibold">{mode === "register" ? "Create your account" : "Welcome back"}</h2>
          {mode === "register" && (
            <Field label="What should I call you?" htmlFor="name">
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoComplete="given-name" />
            </Field>
          )}
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </Field>
          <Field label="Password" htmlFor="password" hint={mode === "register" ? "At least 10 characters. A short phrase works well." : undefined}>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === "register" ? 10 : 1}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
            />
          </Field>
          {error && (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
            {mode === "register" ? "Create account" : "Sign in"}
          </Button>
          {canRegister && (
            <button type="button" className="w-full text-center text-sm text-muted hover:text-ink" onClick={() => setMode(mode === "login" ? "register" : "login")}>
              {mode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}
            </button>
          )}
        </form>
        <p className="mt-6 text-center text-xs text-faint">Your data stays on this server. Nothing is shared without your say-so.</p>
      </div>
    </div>
  );
}
