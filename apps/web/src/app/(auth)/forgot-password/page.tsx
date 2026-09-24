import { AuthHeading } from "@/components/auth/AuthForm";
import { ForgotPasswordForm } from "@/components/auth/PasswordFlows";

export const metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <AuthHeading
        title="Reset your password"
        subtitle="Enter your work email and we'll send a single-use reset link."
      />
      <ForgotPasswordForm />
    </>
  );
}
