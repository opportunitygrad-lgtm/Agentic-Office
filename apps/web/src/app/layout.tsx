import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { ShellDTO, SystemHealthDTO } from "@aibos/shared";
import { AppShell } from "@/components/shell/AppShell";
import { THEME_SCRIPT } from "@/components/shell/ThemeToggle";
import { apiTry } from "@/lib/api";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "AI Business OS", template: "%s · AI Business OS" },
  description: "Multi-company AI Business Operating System — command centre",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0c10" },
  ],
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [shell, health] = await Promise.all([
    apiTry<ShellDTO>("/v1/shell"),
    apiTry<SystemHealthDTO>("/health"),
  ]);
  return (
    <html
      lang="en-GB"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <AppShell shell={shell} health={health}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
