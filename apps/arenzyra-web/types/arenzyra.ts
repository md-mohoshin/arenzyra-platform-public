export type AuthUser = {
  id: string;
  email: string | null;
  name: string | null;
  role: "SUPER_ADMIN" | "ADMIN" | "REFEREE" | "ORGANIZER";
  organizationId?: string | null;
  actingOrgId?: string | null;
  actingOrgName?: string | null;
  actingRole?: "SUPER_ADMIN" | "ADMIN" | "REFEREE" | "ORGANIZER" | null;
  actorRole?: "SUPER_ADMIN" | "ADMIN" | "REFEREE" | "ORGANIZER" | null;
  realRole?: "SUPER_ADMIN" | "ADMIN" | "REFEREE" | "ORGANIZER" | null;
  isImpersonating?: boolean;
};

export type AuthResponse = {
  access_token?: string;
  accessToken?: string;
  refresh_token?: string;
  refreshToken?: string;
  user: AuthUser;
  organization?: {
    id: string;
    name: string | null;
  } | null;
};
