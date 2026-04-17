import TournamentOverviewClient from "./TournamentOverviewClient";

export default async function TournamentOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TournamentOverviewClient tournamentId={id} />;
}
