// DEEZER API HELPER (USED BY PREVIEW PROXY ONLY)

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

// GET DEEZER JSON, RETRY ON QUOTA/5XX
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
          if (!quota) throw last;
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
