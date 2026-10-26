import "server-only";

/**
 * Google service-account auth and REST calls for the app monitor (migration 0056), without
 * Google client libraries: the key's private key signs an RS256 JWT with WebCrypto, which is
 * exchanged for an access token (valid 1 h, reused for 55 min within this Worker isolate).
 */

export type ServiceAccountKey = {
  type: "service_account";
  client_email: string;
  private_key: string;
  private_key_id?: string;
  project_id?: string;
};

const SCOPES = [
  "https://www.googleapis.com/auth/androidpublisher",
  "https://www.googleapis.com/auth/playdeveloperreporting",
].join(" ");
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const tokens = new Map<string, { token: string; expires: number }>();

export class GoogleError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Google's reason, e.g. SERVICE_DISABLED or PERMISSION_DENIED. */
    readonly reason: string | null = null,
  ) {
    super(message);
  }
}

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const b64urlText = (s: string) => b64url(new TextEncoder().encode(s));

async function signJwt(key: ServiceAccountKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", ...(key.private_key_id ? { kid: key.private_key_id } : {}) };
  const claims = { iss: key.client_email, scope: SCOPES, aud: TOKEN_URL, iat: now, exp: now + 3600 };
  const input = `${b64urlText(JSON.stringify(header))}.${b64urlText(JSON.stringify(claims))}`;
  const pem = key.private_key.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(input));
  return `${input}.${b64url(sig)}`;
}

export async function accessToken(key: ServiceAccountKey): Promise<string> {
  const cached = tokens.get(key.client_email);
  if (cached && cached.expires > Date.now()) return cached.token;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: await signJwt(key),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string; error?: string };
  if (!res.ok || !data.access_token) {
    throw new GoogleError(`Google refused the key: ${data.error_description ?? data.error ?? res.status}`, res.status, "AUTH");
  }
  tokens.set(key.client_email, { token: data.access_token, expires: Date.now() + 55 * 60_000 });
  return data.access_token;
}

/** One Google REST call. Network errors and 5xx/429 are retried twice; other errors throw GoogleError. */
export async function gcall<T>(
  token: string,
  url: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    let res: Response;
    try {
      res = await fetch(url, {
        method: init.method ?? (init.body === undefined ? "GET" : "POST"),
        headers: { Authorization: `Bearer ${token}`, ...(init.body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      last = e;
      continue;
    }
    if (res.status === 204) return {} as T;
    const data = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; status?: string; details?: { reason?: string }[] };
    };
    if (res.ok) return data as T;
    const reason = data.error?.details?.find((d) => d.reason)?.reason ?? data.error?.status ?? null;
    const err = new GoogleError(data.error?.message ?? `HTTP ${res.status}`, res.status, reason);
    if (res.status === 429 || res.status >= 500) {
      last = err;
      continue;
    }
    throw err;
  }
  throw last instanceof GoogleError ? last : new GoogleError(`network: ${String(last)}`, 0, "NETWORK");
}

/** A plain reason for a person ("the Reporting API is not enabled in project X", ...). */
export function explainGoogleError(e: unknown): string {
  if (!(e instanceof GoogleError)) return String(e instanceof Error ? e.message : e);
  if (e.reason === "SERVICE_DISABLED" || /has not been used|is disabled/i.test(e.message)) {
    return `API not enabled in the key's Cloud project: ${e.message}`;
  }
  if (e.status === 401 || e.status === 403) return `permission denied (${e.status}): ${e.message}`;
  if (e.status === 404) return `not found for this key (404): ${e.message}`;
  return e.message;
}
