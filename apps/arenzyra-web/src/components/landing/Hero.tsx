import Link from "next/link";
import {
  Activity,
  LayoutTemplate,
  Radio,
  ShieldCheck,
  Trophy,
  Zap,
} from "lucide-react";

const heroStats = [
  {
    label: "Tournament ops",
    value: "Stages, groups, brackets",
    icon: Trophy,
  },
  {
    label: "Live control",
    value: "Kills, knocks, placements",
    icon: Activity,
  },
  {
    label: "Broadcast output",
    value: "OBS-ready widgets",
    icon: LayoutTemplate,
  },
];

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-[#0b0f14] to-[#05070a]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.15),transparent_34%),radial-gradient(circle_at_80%_12%,rgba(59,130,246,0.14),transparent_26%),radial-gradient(circle_at_70%_80%,rgba(245,165,36,0.08),transparent_20%)]" />

      <div className="relative mx-auto grid max-w-[1400px] grid-cols-1 items-center gap-12 px-6 py-20 lg:grid-cols-2">
        <div className="space-y-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.28em] text-white/60">
            <Radio className="h-3.5 w-3.5 text-cyan-400" />
            Live esports production
          </div>

          <div className="space-y-5">
            <h1 className="text-5xl font-bold tracking-[0.18em] text-white sm:text-6xl">
              Arenzyra
            </h1>
            <p className="text-2xl font-semibold text-white sm:text-3xl">
              Professional Esports Tournament Production Platform
            </p>
            <p className="max-w-2xl text-lg text-gray-400">
              Run tournaments, control matches, and generate broadcast-ready
              overlays in real time.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/apply"
              prefetch={false}
              className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-950/40 transition hover:brightness-110"
            >
              Apply as Organizer
            </Link>
            <Link
              href="/login"
              prefetch={false}
              className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/5 px-6 py-3 text-sm font-semibold text-white transition hover:border-white/20 hover:bg-white/10"
            >
              Login
            </Link>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {heroStats.map((item) => {
              const Icon = item.icon;

              return (
                <div
                  key={item.label}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                >
                  <Icon className="h-5 w-5 text-cyan-400" />
                  <div className="mt-4 text-sm font-semibold text-white">
                    {item.label}
                  </div>
                  <div className="mt-1 text-sm text-gray-400">{item.value}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="relative w-full max-w-[620px] lg:justify-self-end">
          <div className="absolute -inset-6 rounded-[2rem] bg-cyan-500/10 blur-3xl" />

          <div className="relative overflow-hidden rounded-xl border border-white/10 bg-[#111827] shadow-2xl shadow-black/40">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
              </div>
              <div className="text-xs uppercase tracking-[0.28em] text-white/45">
                Arenzyra Control Panel Preview
              </div>
            </div>

            <div className="space-y-5 p-6">
              <div className="grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-2xl border border-white/10 bg-black/25 p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs uppercase tracking-[0.24em] text-white/45">
                        Match live
                      </div>
                      <div className="mt-2 text-xl font-semibold text-white">
                        Finals - Arena 01
                      </div>
                    </div>
                    <div className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-200">
                      On Air
                    </div>
                  </div>

                  <div className="mt-6 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-white/8 bg-white/5 p-3">
                      <div className="text-xs uppercase tracking-[0.22em] text-white/45">
                        Teams
                      </div>
                      <div className="mt-2 text-2xl font-semibold text-white">
                        16
                      </div>
                    </div>
                    <div className="rounded-xl border border-white/8 bg-white/5 p-3">
                      <div className="text-xs uppercase tracking-[0.22em] text-white/45">
                        Feed
                      </div>
                      <div className="mt-2 text-2xl font-semibold text-white">
                        Live
                      </div>
                    </div>
                    <div className="rounded-xl border border-white/8 bg-white/5 p-3">
                      <div className="text-xs uppercase tracking-[0.22em] text-white/45">
                        Delay
                      </div>
                      <div className="mt-2 text-2xl font-semibold text-white">
                        2.4s
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(34,211,238,0.14),rgba(17,24,39,0.2))] p-5">
                  <div className="flex items-center gap-3">
                    <div className="rounded-xl bg-cyan-500/12 p-2 text-cyan-300">
                      <Zap className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.24em] text-white/45">
                        Real-time control
                      </div>
                      <div className="mt-1 font-semibold text-white">
                        Operator console synced
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 space-y-3">
                    {[
                      "Kills routed to broadcast feed",
                      "Placements update standings instantly",
                      "Widget states mirrored to overlays",
                    ].map((item) => (
                      <div
                        key={item}
                        className="flex items-center gap-3 rounded-xl border border-white/8 bg-black/20 px-3 py-3 text-sm text-gray-300"
                      >
                        <ShieldCheck className="h-4 w-4 shrink-0 text-cyan-400" />
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-[0.92fr_1.08fr]">
                <div className="rounded-2xl border border-white/10 bg-black/25 p-5">
                  <div className="text-xs uppercase tracking-[0.24em] text-white/45">
                    Sponsor rotation
                  </div>
                  <div className="mt-4 grid gap-3">
                    {["Main Stream Intro", "Break Sequence", "Standings Bumper"].map(
                      (slot) => (
                        <div
                          key={slot}
                          className="rounded-xl border border-white/8 bg-white/5 px-4 py-3 text-sm text-white/80"
                        >
                          {slot}
                        </div>
                      ),
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/25 p-5">
                  <div className="flex items-center justify-between">
                    <div className="text-xs uppercase tracking-[0.24em] text-white/45">
                      Live standings
                    </div>
                    <div className="text-xs font-medium text-cyan-300">
                      Updated now
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    {[
                      { team: "Apex Vector", place: "P1", points: 74 },
                      { team: "Nova Rift", place: "P2", points: 68 },
                      { team: "Pulse Eight", place: "P3", points: 61 },
                    ].map((row) => (
                      <div
                        key={row.team}
                        className="grid grid-cols-[auto_1fr_auto] items-center gap-4 rounded-xl border border-white/8 bg-white/5 px-4 py-3"
                      >
                        <div className="rounded-full bg-cyan-500/15 px-3 py-1 text-xs font-semibold text-cyan-300">
                          {row.place}
                        </div>
                        <div className="font-medium text-white">{row.team}</div>
                        <div className="text-sm text-gray-400">{row.points} pts</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
