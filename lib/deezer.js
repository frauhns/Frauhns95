// Deezer API helper. Key facts it works around:
//  - Deezer answers HTTP 200 with { error: { code, ... } } for quota / not-found / etc.
//  - Quota is ~50 requests / 5 s *per IP*, and Cloudflare Workers share egress IPs, so code 4 happens at random.
//  - Preview URLs are signed and expire, so never rely on an old one.

export const DEEZER = "https://api.deezer.com";
const TIMEOUT_MS = 7000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class DeezerError extends Error {
  constructor(message, { code, retryable } = {}) {
    super(message);
    this.code = code;
    this.retryable = !!retryable;
  }
}

// GET a Deezer API path and return parsed JSON. Throws DeezerError after `tries` attempts.
export async function deezerJson(path, tries = 3) {
  let last = new DeezerError("Deezer unreachable", { retryable: true });

  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${DEEZER}${path}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (res.status >= 500 || res.status === 429) {
        last = new DeezerError(`Deezer HTTP ${res.status}`, { retryable: true });
      } else if (!res.ok) {
        throw new DeezerError(`Deezer HTTP ${res.status}`, { retryable: false });
      } else {
        const data = await res.json();
        if (data && data.error) {
          const code = data.error.code;
          const quota = code === 4 || /quota/i.test(data.error.message || "");
          last = new DeezerError(data.error.message || data.error.type || "Deezer error", {
            code,
            retryable: quota,
          });
          if (!quota) throw last; // not-found, bad id, etc: retrying will not help
        } else {
          return data;
        }
      }
    } catch (err) {
      if (err instanceof DeezerError && !err.retryable) throw err;
      if (err instanceof DeezerError) last = err;
      else last = new DeezerError(err?.message || "Deezer network error", { retryable: true });
    }
    if (i < tries - 1) await sleep(500 * (i + 1));
  }
  throw last;
}

export function isDeezerHost(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && /(^|\.)(dzcdn\.net|deezer\.com)$/i.test(u.hostname);
  } catch (_) {
    return false;
  }
}
