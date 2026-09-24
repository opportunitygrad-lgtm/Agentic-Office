import Link from "next/link";
import { AuthHeading, FormAlert } from "@/components/auth/AuthForm";
import { ResetPasswordForm } from "@/components/auth/PasswordFlows";
import type { SearchParams } from "@/lib/api";

export const metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const token = (await searchParams).token;
  return (
    <>
      <AuthHeading
        title="Choose a new password"
        subtitle="Reset links work once and expire after 60 minutes."
      />
      {typeof token === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(token) ? (
        <ResetPasswordForm token={token} />
      ) : (
        <FormAlert>
          This reset link is invalid or has expired.{" "}
          <Link href="/forgot-password" className="font-semibold underline">
            Request a new link
          </Link>
        </FormAlert>
      )}
    </>
  );
}
