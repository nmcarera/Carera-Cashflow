import { Suspense } from "react";
import { LoginForm } from "@/components/auth/LoginForm";

export const metadata = { title: "Log in — Carera's Cash Flow" };
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center px-4">
      <h1 className="text-2xl font-semibold tracking-tight mb-1">Carera&apos;s Cash Flow</h1>
      <p className="text-muted mb-6">Enter the household password to continue.</p>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
