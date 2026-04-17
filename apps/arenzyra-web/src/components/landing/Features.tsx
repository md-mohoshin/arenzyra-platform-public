import {
  Blocks,
  LayoutGrid,
  ShieldCheck,
  Swords,
  Trophy,
} from "lucide-react";

const features = [
  {
    title: "Tournament Management",
    description: "Create tournaments, stages, groups and matches.",
    icon: Trophy,
    eyebrow: "Operations",
  },
  {
    title: "Live Match Control",
    description: "Real-time control panel for kills, knocks and placements.",
    icon: Swords,
    eyebrow: "Real-time",
  },
  {
    title: "Broadcast Widgets",
    description: "OBS-ready overlays and widgets.",
    icon: LayoutGrid,
    eyebrow: "Broadcast",
  },
  {
    title: "Multi Organization",
    description: "Role-based access for tournament organizers.",
    icon: ShieldCheck,
    eyebrow: "Access",
  },
];

export function Features() {
  return (
    <section id="features" className="scroll-mt-24 py-16">
      <div className="mx-auto max-w-[1400px] px-6">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.28em] text-white/55">
            <Blocks className="h-3.5 w-3.5 text-cyan-400" />
            Core platform
          </div>
          <h2 className="mt-6 text-2xl font-semibold text-white">
            Built for tournament operators, admins, and production crews.
          </h2>
          <p className="mt-4 max-w-2xl text-gray-400">
            Arenzyra centralizes bracket operations, live match updates, and
            broadcast delivery in one system designed for esports events.
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {features.map((feature) => {
            const Icon = feature.icon;

            return (
              <div
                key={feature.title}
                className="rounded-xl border border-white/10 bg-[#111827] p-6 transition duration-200 hover:-translate-y-1 hover:border-cyan-400/40"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.26em] text-white/45">
                      {feature.eyebrow}
                    </div>
                    <h3 className="mt-4 text-xl font-semibold text-white">
                      {feature.title}
                    </h3>
                  </div>
                  <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/10 p-3">
                    <Icon className="h-5 w-5 text-cyan-300" />
                  </div>
                </div>
                <p className="mt-4 text-gray-400">{feature.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
