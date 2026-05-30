import { useId } from "react";

type DesktopBrandLockupSize = "sm" | "md";
type DesktopBrandLockupMode = "full" | "mark";

type DesktopBrandLockupProps = {
  size?: DesktopBrandLockupSize;
  mode?: DesktopBrandLockupMode;
  subtitle?: string | null;
  eyebrow?: string | null;
  className?: string;
};

function joinClasses(...values: Array<string | null | undefined | false>) {
  return values.filter(Boolean).join(" ");
}

export function DesktopBrandLockup({
  size = "md",
  mode = "full",
  subtitle = "Observer tooling for live production teams.",
  eyebrow = "Arenzyra",
  className,
}: DesktopBrandLockupProps) {
  const gradientId = useId();

  return (
    <div
      className={joinClasses(
        "desktop-brand-lockup",
        size === "sm" ? "desktop-brand-lockup--sm" : "desktop-brand-lockup--md",
        mode === "mark" ? "desktop-brand-lockup--mark-only" : null,
        className,
      )}
      aria-label="Arenzyra"
    >
      <div className="desktop-brand-lockup__mark" aria-hidden="true">
        <svg
          className="desktop-brand-lockup__mark-svg"
          viewBox="0 0 64 64"
          fill="none"
        >
          <defs>
            <linearGradient id={gradientId} x1="12" y1="10" x2="50" y2="52">
              <stop offset="0%" stopColor="#ecfeff" />
              <stop offset="38%" stopColor="#7dd3fc" />
              <stop offset="100%" stopColor="#5eead4" />
            </linearGradient>
          </defs>
          <path
            d="M32 5.5 53.5 18v28L32 58.5 10.5 46V18L32 5.5Z"
            fill="rgba(5, 15, 22, 0.92)"
            stroke="rgba(137, 183, 214, 0.28)"
            strokeWidth="1.5"
          />
          <path
            d="M32 12 18.5 43h8.3l2.25-5.85h6l2.25 5.85h8.2L32 12Zm0 8.9 2.95 8.45h-5.9L32 20.9Z"
            fill={`url(#${gradientId})`}
          />
          <path
            d="M17 17.5c4.8-4.1 9.6-6.15 15-6.15 7.65 0 14.15 3 18.9 8.9"
            stroke="rgba(255,255,255,0.16)"
            strokeLinecap="round"
          />
        </svg>
      </div>

      {mode === "full" ? (
        <div className="desktop-brand-lockup__copy">
          {eyebrow ? (
            <span className="desktop-brand-lockup__eyebrow">{eyebrow}</span>
          ) : null}
          <strong className="desktop-brand-lockup__title">Arenzyra</strong>
          {subtitle ? (
            <span className="desktop-brand-lockup__subtitle">{subtitle}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
