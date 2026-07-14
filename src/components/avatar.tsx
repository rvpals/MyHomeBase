// Reusable avatar: renders the uploaded image when one exists, otherwise an
// initials circle. Pure presentation — the image src is just a URL built
// from `userId`; no fetching or business logic here.

type Size = "sm" | "md";

export interface AvatarProps {
  userId: number;
  avatarMimeType?: string;
  /** Text to derive the fallback initial from — typically the user's full name. */
  fallbackText: string;
  size?: Size;
  className?: string;
  /** Cache-busting key (e.g. the user's `updatedAt`) — pass it so a just-changed image isn't served stale from the browser cache. */
  version?: string;
}

const sizeClasses: Record<Size, string> = {
  sm: "h-6 w-6 text-[11px]",
  md: "h-10 w-10 text-sm",
};

export function Avatar({
  userId,
  avatarMimeType,
  fallbackText,
  size = "sm",
  className = "",
  version,
}: AvatarProps) {
  if (avatarMimeType) {
    const src = version
      ? `/api/users/${userId}/avatar?v=${encodeURIComponent(version)}`
      : `/api/users/${userId}/avatar`;
    return (
      // eslint-disable-next-line @next/next/no-img-element -- avatar bytes are served from our own DB-backed route, not a static asset next/image can optimize.
      <img
        src={src}
        alt=""
        className={`shrink-0 rounded-full object-cover ${sizeClasses[size]} ${className}`}
      />
    );
  }

  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-brass-soft font-semibold text-brass-dark ${sizeClasses[size]} ${className}`}
    >
      {fallbackText.charAt(0).toUpperCase()}
    </span>
  );
}
