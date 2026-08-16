import type { Metadata } from "next";
import "./globals.css";
import { NavBar } from "@/components/NavBar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { isAuthEnabled } from "@/lib/auth/session";

// Deliberately using the system font stack rather than next/font/google:
// this app is local-first and should render identically with no network
// access at all, including on first run before any package fetch.

export const metadata: Metadata = {
  title: "Carera's Cash Flow",
  description: "A calm, local-first household finance dashboard.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ErrorBoundary>
          <NavBar authEnabled={isAuthEnabled()} />
          <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6">
            {children}
          </main>
        </ErrorBoundary>
      </body>
    </html>
  );
}
