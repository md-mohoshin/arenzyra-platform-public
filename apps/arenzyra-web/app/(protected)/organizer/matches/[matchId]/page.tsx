"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function MatchRedirectPage() {
  const params = useParams<{ matchId: string }>();
  const router = useRouter();
  const matchId = params?.matchId ?? null;

  useEffect(() => {
    if (!matchId) return;
    router.replace(`/organizer/matches/${matchId}/control`);
  }, [matchId, router]);

  return null;
}
