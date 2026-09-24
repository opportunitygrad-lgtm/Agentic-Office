import { AuthHeading } from "@/components/auth/AuthForm";
import { LoginForm } from "@/components/auth/LoginForm";
import { apiTry, type SearchParams } from "@/lib/api";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const status = await apiTry<{ bootstrapRequired: boolean }>("/v1/auth/status");
  return (
    <>
      <AuthHeading title="Sign in" subtitle="Welcome back. Use your work email to continue." />
      <LoginForm
        next={typeof sp.next === "string" ? sp.next : undefined}
        expired={sp.expired === "1"}
        bootstrapRequired={status?.bootstrapRequired}
      />
    </>
  );
}
