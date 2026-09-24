export function BrandMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="9" className="fill-accent" />
      <path
        d="M9 21.5 16 9l7 12.5"
        fill="none"
        stroke="white"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="9" r="2.4" fill="white" />
      <circle cx="9" cy="21.5" r="2.4" fill="white" opacity="0.85" />
      <circle cx="23" cy="21.5" r="2.4" fill="white" opacity="0.85" />
      <path
        d="M11.5 21.5h9"
        stroke="white"
        strokeWidth="2.4"
        strokeLinecap="round"
        opacity="0.55"
      />
    </svg>
  );
}
