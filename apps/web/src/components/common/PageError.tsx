import { redirect } from "next/navigation";
import { ApiError } from "@/lib/api";
import { ApiOffline } from "./ApiOffline";
import { Unauthorised } from "./Unauthorised";

/** Maps API failures to the right page state. 401 → sign-in, 403 → unauthorised. */
export function PageError({ error }: { error: unknown }) {
  if (error instanceof ApiError) {
    if (error.status === 401)
      redirect(error.code === "account_disabled" ? "/account-disabled" : "/login");
    if (error.status === 403) return <Unauthorised />;
    if (error.status === 404)
      return (
        <Unauthorised
          title="Not found"
          message="This item doesn't exist or isn't available to you."
        />
      );
    return <ApiOffline detail={error.message} />;
  }
  return <ApiOffline detail={error instanceof Error ? error.message : undefined} />;
}
