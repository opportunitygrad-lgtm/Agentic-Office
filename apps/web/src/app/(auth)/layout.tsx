import { ScrollText, ShieldCheck, Users } from "lucide-react";
import { BrandMark } from "@/components/shell/Brand";

const POINTS = [
  {
    icon: Users,
    title: "Company isolation",
    text: "People and agents only see the companies they are authorised for.",
  },
  {
    icon: ShieldCheck,
    title: "Human approval authority",
    text: "Sensitive agent actions wait for someone with the right authority.",
  },
  {
    icon: ScrollText,
    title: "Every action audited",
    text: "Sign-ins, decisions and permission changes are recorded.",
  },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="relative hidden overflow-hidden border-r border-line bg-surface lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          className="dot-grid pointer-events-none absolute inset-0 opacity-70"
          aria-hidden="true"
        />
        <div className="relative flex items-center gap-3">
          <BrandMark className="size-9" />
          <div className="leading-tight">
            <p className="text-[15px] font-semibold tracking-tight">AI Business OS</p>
            <p className="text-[12px] text-fg-faint">Multi-company command</p>
          </div>
        </div>
        <div className="relative max-w-md">
          <h1 className="text-[30px] font-semibold leading-tight tracking-tight">
            The operating system for your AI workforce.
          </h1>
          <ul className="mt-8 space-y-5">
            {POINTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span>
                  <span className="block text-[14px] font-semibold">{title}</span>
                  <span className="block text-[13px] text-fg-muted">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-[12px] text-fg-faint">
          Private system · authorised personnel only
        </p>
      </aside>
      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <BrandMark className="size-8" />
            <p className="text-[15px] font-semibold tracking-tight">AI Business OS</p>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
