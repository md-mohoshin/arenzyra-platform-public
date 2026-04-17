import Link from "next/link";

const sections = [
  {
    title: "Platform Use",
    body:
      "Arenzyra provides tournament management, live match control, and broadcast production tools for esports organizers, operators, and staff. Access to the platform must be used only for legitimate event operations and authorized administrative workflows.",
  },
  {
    title: "Accounts and Access",
    body:
      "You are responsible for maintaining the confidentiality of account credentials, ensuring that team members use role-appropriate access, and promptly reporting unauthorized access or suspected compromise to your organization administrator.",
  },
  {
    title: "Broadcast Data and Content",
    body:
      "Match results, player information, sponsor assets, overlays, widgets, and production graphics uploaded or generated through Arenzyra remain your responsibility. You must have the necessary rights to use all tournament, team, player, and sponsor materials within broadcasts and related content.",
  },
  {
    title: "Service Availability",
    body:
      "We aim to maintain reliable platform availability for live esports operations, but uninterrupted service cannot be guaranteed. Planned maintenance, infrastructure issues, or third-party service interruptions may affect access to dashboards, widgets, or real-time production features.",
  },
  {
    title: "Acceptable Conduct",
    body:
      "You agree not to misuse the platform, interfere with tournament operations, attempt unauthorized access, distribute harmful code, or use Arenzyra in ways that could disrupt broadcast integrity, competitive fairness, or other users' access to the service.",
  },
  {
    title: "Liability",
    body:
      "Arenzyra is provided on an as-available basis. To the maximum extent permitted by law, liability for indirect, incidental, or consequential damages arising from use of the platform, including event disruption or broadcast interruption, is limited.",
  },
];

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-black px-6 py-16 text-white">
      <div className="mx-auto max-w-4xl">
        <div className="rounded-[2rem] border border-white/10 bg-[#0b0f14] p-8 shadow-2xl shadow-black/30 sm:p-10">
          <div className="flex flex-col gap-8">
            <div className="space-y-4 border-b border-white/10 pb-8">
              <div className="text-sm font-semibold tracking-[0.35em] text-white">
                Arenzyra
              </div>
              <div className="space-y-3">
                <h1 className="text-4xl font-bold">Terms &amp; Conditions</h1>
                <p className="max-w-3xl text-sm leading-7 text-white/65 sm:text-base">
                  These terms govern access to Arenzyra, an esports tournament
                  production platform used for tournament operations, live match
                  control, and broadcast-ready overlay delivery.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.24em] text-white/40">
                <span>Esports Operations</span>
                <span className="h-1 w-1 rounded-full bg-white/20" />
                <span>Broadcast Production</span>
                <span className="h-1 w-1 rounded-full bg-white/20" />
                <span>Platform Access</span>
              </div>
            </div>

            <div className="grid gap-4">
              {sections.map((section) => (
                <section
                  key={section.title}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
                >
                  <h2 className="text-lg font-semibold text-white">
                    {section.title}
                  </h2>
                  <p className="mt-3 text-sm leading-7 text-white/65 sm:text-base">
                    {section.body}
                  </p>
                </section>
              ))}
            </div>

            <div className="flex flex-col gap-4 border-t border-white/10 pt-6 text-sm text-white/55 sm:flex-row sm:items-center sm:justify-between">
              <p>
                If you have questions regarding platform access or legal terms,
                contact your tournament administrator.
              </p>
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-white transition hover:border-white/20 hover:bg-white/10"
              >
                Back to Login
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
