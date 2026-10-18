import Link from "next/link";

export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 6h16M4 12h10M4 18h6" />
      <path d="M16 16l2 2 4-4" className="stroke-mint" />
    </svg>
  );
}

export function Logo({ label = "DataCleanse", href = "/files" }: { label?: string; href?: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2.5 text-lg font-semibold text-ink no-underline"
    >
      <LogoMark />
      {label}
    </Link>
  );
}
