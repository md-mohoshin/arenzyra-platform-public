const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const SCHEMELESS_LOOPBACK_ASSET_RE =
  /^(localhost|127\.0\.0\.1|\[::1\]|::1)(?::\d+)?(\/.*)$/i;

export function normalizePublicAssetUrl(value?: string | null): string | null {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('/')) {
    return trimmed;
  }

  const schemelessLoopback = SCHEMELESS_LOOPBACK_ASSET_RE.exec(trimmed);
  if (schemelessLoopback) {
    return schemelessLoopback[2] ?? null;
  }

  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }
    if (LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return parsed.toString();
  } catch {
    return trimmed;
  }
}
