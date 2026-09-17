function parseOrigin(value: string): URL | undefined {
  if (!/^https?:\/\/[^/?#\\\s@*]+$/i.test(value)) return;
  try {
    const url = new URL(value);
    if (url.hostname && !url.username && !url.password) return url;
  } catch { return; }
}

export function validateAllowedOrigins(origins: string[]): Set<string> {
  return new Set(origins.map(value => {
    const origin = parseOrigin(value);
    if (!origin) throw new Error('ALLOWED_ORIGINS must contain only HTTP(S) origins without paths, credentials, or wildcards');
    return origin.origin;
  }));
}

export function isOriginAllowed(value: string | undefined, host: string | undefined, allowedOrigins: ReadonlySet<string>): boolean {
  if (value === undefined) return true;
  const origin = parseOrigin(value);
  return !!origin && (origin.host === host || allowedOrigins.has(origin.origin));
}
