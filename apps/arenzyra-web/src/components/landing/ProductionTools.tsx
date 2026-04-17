import {
  BadgePercent,
  BarChart3,
  Captions,
  Crosshair,
  TableProperties,
} from "lucide-react";

const productionTools = [
  {
    title: "Sponsor Rotation",
    description: "Schedule sponsor assets between maps, rounds, and breaks.",
    icon: BadgePercent,
  },
  {
    title: "Live Standings",
    description: "Push updated rankings to desk talent and stream overlays.",
    icon: TableProperties,
  },
  {
    title: "Player Statistics",
    description: "Surface kill leaders, team performance, and match summaries.",
    icon: BarChart3,
  },
  {
    title: "Lower Third Graphics",
    description: "Trigger player and segment identifiers without leaving control.",
    icon: Captions,
  },
  {
    title: "Kill Feed Widgets",
    description: "Drive in-broadcast moments with clean, low-latency event feeds.",
    icon: Crosshair,
  },
];

export function ProductionTools() {
  return (
    <section id="production" className="scroll-mt-24 py-16">
      <div className="mx-auto max-w-[1400px] px-6">
        <div className="max-w-3xl">
          <div className="text-sm font-medium uppercase tracking-[0.32em] text-cyan-300/80">
            Production Tools
          </div>
          <h2 className="mt-4 text-2xl font-semibold text-white">
            Broadcast controls built for live esports workflows.
          </h2>
          <p className="mt-4 text-gray-400">
            Support the stream team with purpose-built modules for on-air
            graphics, sponsor delivery, and live data presentation.
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {productionTools.map((tool) => {
            const Icon = tool.icon;

            return (
              <div
                key={tool.title}
                className="rounded-xl border border-white/10 bg-[#111827] p-6 transition duration-200 hover:border-cyan-400/40"
              >
                <div className="flex items-center gap-4">
                  <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/10 p-3">
                    <Icon className="h-5 w-5 text-cyan-300" />
                  </div>
                  <div className="text-xs uppercase tracking-[0.26em] text-white/40">
                    Production
                  </div>
                </div>
                <h3 className="mt-6 text-lg font-semibold text-white">
                  {tool.title}
                </h3>
                <p className="mt-3 text-sm text-gray-400">{tool.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
