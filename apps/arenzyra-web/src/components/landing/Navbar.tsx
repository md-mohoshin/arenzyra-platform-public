import Link from "next/link";

const navLinks = [
  { href: "#features", label: "Features" },
  { href: "#production", label: "Production" },
  { href: "#widgets", label: "Widgets" },
];

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/5 bg-black/20 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-6">
        <Link
          href="/"
          className="text-sm font-semibold tracking-[0.35em] text-white sm:text-base"
        >
          Arenzyra
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm text-white/60 transition hover:text-white"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href="/apply"
            prefetch={false}
            className="rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:brightness-110"
          >
            Apply
          </Link>
          <Link
            href="/login"
            prefetch={false}
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:border-white/20 hover:bg-white/10"
          >
            Login
          </Link>
        </div>
      </div>
    </header>
  );
}
