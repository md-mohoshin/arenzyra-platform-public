const DEFAULT_ALLOWED_CORS_ORIGINS = [
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'http://localhost:3005',
  'http://127.0.0.1:3005',
  'http://192.168.0.129:3001',
  'https://arenzyra.com',
  'https://www.arenzyra.com',
];

function splitOriginList(value?: string | null): string[] {
  const trimmed = value?.trim();
  if (!trimmed) {
    return [];
  }

  return trimmed
    .split(/[,\r\n\t ]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function normalizeCorsOrigin(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const withProtocol = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${
      parsed.port ? `:${parsed.port}` : ''
    }`;
  } catch {
    return null;
  }
}

export function buildAllowedCorsOrigins(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const envOrigins = [
    ...splitOriginList(env.WEB_APP_ORIGIN),
    ...splitOriginList(env.FRONTEND_ORIGIN),
  ];

  return Array.from(
    new Set(
      [...DEFAULT_ALLOWED_CORS_ORIGINS, ...envOrigins]
        .map((origin) => normalizeCorsOrigin(origin))
        .filter((origin): origin is string => Boolean(origin)),
    ),
  );
}

export function isAllowedCorsOrigin(
  origin?: string | null,
  allowedOrigins: readonly string[] = buildAllowedCorsOrigins(),
): boolean {
  if (!origin) {
    return true;
  }

  const normalizedOrigin = normalizeCorsOrigin(origin);
  return normalizedOrigin !== null && allowedOrigins.includes(normalizedOrigin);
}
