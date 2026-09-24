import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto mt-16 max-w-md text-center">
      <p className="font-mono text-sm text-fg-faint">404</p>
      <h1 className="mt-2 text-xl font-semibold">Page not found</h1>
      <p className="mt-1 text-[13.5px] text-fg-muted">
        This area of the operating system doesn&apos;t exist yet.
      </p>
      <Link
        href="/"
        className="focus-ring mt-5 inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-sm font-medium text-white"
      >
        Back to Command Centre
      </Link>
    </div>
  );
}
