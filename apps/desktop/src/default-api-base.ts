export const DEFAULT_LOCAL_API_BASE = "http://localhost:3000";
export const DEFAULT_PRODUCTION_API_BASE = "https://api.arenzyra.com";

export const DEFAULT_RENDERER_API_BASE =
  import.meta.env.VITE_API_BASE_URL?.trim() ||
  (import.meta.env.DEV ? DEFAULT_LOCAL_API_BASE : DEFAULT_PRODUCTION_API_BASE);
