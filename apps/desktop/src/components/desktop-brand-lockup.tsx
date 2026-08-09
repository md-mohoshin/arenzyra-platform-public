import arenzyraMark from "../assets/arenzyra-mark.png";

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
        <img className="desktop-brand-lockup__mark-image" src={arenzyraMark} alt="" />
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
