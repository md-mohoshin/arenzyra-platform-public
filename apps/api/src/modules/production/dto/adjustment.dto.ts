export interface AdminAdjustmentDto {
  matchId?: string | null;
  teamId: string;
  pointsDelta: number | string;
  reason?: string | null;
  createdById?: string | null;
}

export interface PcobBindDto {
  pcobSessionId: string;
}
