import {
  LayoutDashboard,
  Layers2,
  ListTree,
  MonitorPlay,
} from "lucide-react";

const previews = [
  {
    title: "Control Panel",
    description: "Drive live state updates from a focused match operations view.",
    icon: MonitorPlay,
  },
  {
    title: "Results System",
    description: "Publish placements, points, and outcomes with minimal delay.",
    icon: ListTree,
  },
  {
    title: "Tournament Dashboard",
    description: "Track formats, rounds, and scheduling across the full event.",
    icon: LayoutDashboard,
  },
  {
    title: "Broadcast Widgets",
    description: "Feed overlays, scorebugs, and standings directly into stream scenes.",
    icon: Layers2,
  },
];

export function Preview() {
  return (
    <section id="widgets" className="scroll-mt-24 py-16">
      <div className="mx-auto max-w-[1400px] px-6">
        <div className="max-w-3xl">
          <div className="text-sm font-medium uppercase tracking-[0.32em] text-cyan-300/80">
            Platform Preview
          </div>
          <h2 className="mt-4 text-2xl font-semibold text-white">
            Platform Preview
          </h2>
          <p className="mt-4 text-gray-400">
            Every surface is designed to keep operators synchronized with the
            show, from results entry to live widget output.
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {previews.map((item) => {
            const Icon = item.icon;

            return (
              <div
                key={item.title}
                className="rounded-xl border border-white/10 bg-[#111827] p-6 transition duration-200 hover:border-cyan-400/40"
              >
                <div className="flex items-center justify-between">
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <Icon className="h-5 w-5 text-cyan-300" />
                  </div>
                  <div className="text-xs uppercase tracking-[0.24em] text-white/40">
                    Preview
                  </div>
                </div>

                <h3 className="mt-6 text-lg font-semibold text-white">
                  {item.title}
                </h3>
                <p className="mt-3 text-sm text-gray-400">{item.description}</p>

                <div className="mt-6 space-y-2">
                  <div className="h-2 w-16 rounded-full bg-cyan-400/60" />
                  <div className="h-12 rounded-xl border border-white/8 bg-black/20" />
                  <div className="grid grid-cols-2 gap-2">
                    <div className="h-10 rounded-xl border border-white/8 bg-white/5" />
                    <div className="h-10 rounded-xl border border-white/8 bg-white/5" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
