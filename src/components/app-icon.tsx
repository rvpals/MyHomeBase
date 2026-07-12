import type { SVGProps } from "react";

// The application's mark: a coin badge (finance) holding a house (home) with a
// dollar sign (finance) and a sparkle accent (AI). Also the source for
// src/app/icon.svg — keep both in sync if this design changes. Unlike the static
// favicon file, this version uses the live theme's brass color via CSS variables.
export function AppIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" role="img" aria-label="MyHomeBase" {...props}>
      <circle cx="16" cy="16" r="15" fill="var(--brass)" />
      <path d="M16 7L26 17H6Z" fill="#FFFFFF" />
      <rect x="8" y="17" width="16" height="10" rx="1" fill="#FFFFFF" />
      <path
        d="M16 19V25.6M18.3 20C17.9 19.3 17 19 16 19C14.6 19 13.4 19.7 13.4 20.7C13.4 21.7 14.6 22 16 22.2C17.4 22.4 18.6 22.8 18.6 23.9C18.6 25 17.4 25.6 16 25.6C15 25.6 14.1 25.3 13.6 24.7"
        fill="none"
        stroke="var(--brass)"
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M23 5.5L24 7.5L26 8.5L24 9.5L23 11.5L22 9.5L20 8.5L22 7.5Z" fill="#FFFFFF" />
    </svg>
  );
}
