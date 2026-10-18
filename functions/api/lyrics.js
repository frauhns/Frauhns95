import {
  artistVariants,
  titleVariants,
  cleanTitle,
  primaryArtist,
  fold,
  pickBest,
  titleScore,
  artistScore,
} from "../../lib/lyrics-match.js";

const LRCLIB = "https://lrclib.net/api";
const UA = "Frauhns95/2.0 (https://frauhns.pages.dev)";
const TIMEOUT_MS = 6000;
const FOUND_TTL_S = 60 * 60 * 24 * 7;  // KV: good lyrics
const MISS_TTL_S = 60 * 60 * 6;        // KV: confirmed "not on lrclib" (so new uploads get picked up)

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

function reply(body, status, cache) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, "Cache-Control": cache },
  });
}

// One lrclib call. Never throws. `transient` = "could not get a real answer" (timeout, network, 5xx, 429),
// as opposed to a definitive 404/empty answer.
async function lrc(path, params) {
  const url = `${LRCLIB}/${path}?${new URLSearchParams(params)}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, "Lrclib-Client": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 404) return { data: null, transient: false };
      if (res.ok) {
        try {
          return { data: await res.json(), transient: false };
        } catch (_) {
          /* malformed body, treat as transient and retry */
        }
      } else if (res.status < 500 && res.status !== 429) {
        return { data: null, transient: false }; // other 4xx: will not improve by retrying
      }
    } catch (_) {
      /* timeout / network */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return { data: null, transient: true };
}

async function sha1(text) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Only songs that are really in the playlist may be written to KV. The endpoint is public, so without this
// anyone could fill the store (and burn the daily write budget) with made-up artist/title pairs.
async function isPlaylistSong(kv, artist, title) {
  if (!kv) return false;
  try {
    const pl = await kv.get("playlist:v2", "json");
    const a = fold(artist);
    const t = fold(title);
    return !!pl?.tracks?.some((x) => fold(x.name) === t && fold(x.artist) === a);
  } catch (_) {
    return false;
  }
}

function toList(data) {
  if (!data) return [];
  return Array.isArray(data) ? data : [data];
}

async function findLyrics({ artist, title, album, duration }) {
  const want = { artist, title, duration };
  const pool = [];
  let transient = false;

  const run = async (jobs) => {
    const results = await Promise.all(jobs);
    for (const r of results) {
      if (r.transient) transient = true;
      pool.push(...toList(r.data));
    }
    return pickBest(pool, want);
  };

  const cTitle = cleanTitle(title);
  const pArtist = primaryArtist(artist);

  // Stage 1: the most likely hits, in parallel.
  const stage1 = [
    lrc("search", { track_name: title, artist_name: artist }),
    lrc("search", { q: `${pArtist} ${cTitle}` }),
  ];
  if (Number(duration) > 0) {
    stage1.push(
      lrc("get", {
        track_name: title,
        artist_name: artist,
        ...(album ? { album_name: album } : {}),
        duration: String(Math.round(duration)),
      })
    );
  }
  let best = await run(stage1);

  // Stage 2: looser variants (cleaned titles, primary artist only, title-only).
  if (!best) {
    const jobs = [];
    const seen = new Set();
    for (const t of titleVariants(title)) {
      for (const a of artistVariants(artist)) {
        const key = `${fold(t)}|${fold(a)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        jobs.push(lrc("search", { track_name: t, artist_name: a }));
      }
    }
    jobs.push(lrc("search", { track_name: cTitle }));
    jobs.push(lrc("search", { q: cTitle }));
    if (Number(duration) > 0) {
      jobs.push(
        lrc("get", { track_name: cTitle, artist_name: pArtist, duration: String(Math.round(duration)) })
      );
    }
    best = await run(jobs.slice(0, 8));
  }

  if (best) {
    const r = best.record;
    return {
      found: {
        ...(best.synced ? { syncedLyrics: r.syncedLyrics } : { plainLyrics: r.plainLyrics }),
        match: { trackName: r.trackName ?? r.name, artistName: r.artistName, duration: r.duration },
      },
    };
  }

  const instrumental = pool.some(
    (r) => r && r.instrumental === true && titleScore(title, r.trackName ?? r.name) >= 0.85 && artistScore(artist, r.artistName) >= 0.5
  );
  if (instrumental) return { instrumental: true };

  return { transient };
}

export async function onRequest(context) {
  const { searchParams } = new URL(context.request.url);
  const artist = (searchParams.get("artist") || "").trim();
  const title = (searchParams.get("title") || "").trim();
  const album = (searchParams.get("album") || "").trim();
  const duration = parseInt(searchParams.get("duration") || "", 10) || 0;

  if (!artist || !title) return reply({ error: "missing artist or title" }, 400, "no-store");

  const kv = context.env?.SITE_KV;
  const cacheKey = `lyrics:v2:${await sha1(`${fold(artist)}|${fold(title)}`)}`;

  // Durable cache first. KV failures must never break the request.
  if (kv) {
    try {
      const hit = await kv.get(cacheKey, "json");
      if (hit) {
        if (hit.syncedLyrics || hit.plainLyrics || hit.instrumental) return reply(hit, 200, "public, max-age=3600");
        if (hit.notFound) return reply({ error: "not_found", notFound: true }, 404, "public, max-age=300");
      }
    } catch (_) {}
  }

  let result;
  try {
    result = await findLyrics({ artist, title, album, duration });
  } catch (err) {
    return reply({ error: "lookup failed", retryable: true }, 503, "no-store");
  }

  const save = async (value, ttl) => {
    if (await isPlaylistSong(kv, artist, title)) await kv.put(cacheKey, JSON.stringify(value), { expirationTtl: ttl });
  };
  const saveLater = (value, ttl) => {
    if (kv) context.waitUntil(save(value, ttl).catch(() => {}));
  };

  if (result.found) {
    const body = { ...result.found };
    saveLater(body, FOUND_TTL_S);
    return reply(body, 200, "public, max-age=3600");
  }

  if (result.instrumental) {
    const body = { instrumental: true };
    saveLater(body, FOUND_TTL_S);
    return reply(body, 200, "public, max-age=3600");
  }

  if (result.transient) {
    // lrclib hiccup: tell the client to retry; never cache this.
    return reply({ error: "lyrics provider unavailable", retryable: true }, 503, "no-store");
  }

  saveLater({ notFound: true }, MISS_TTL_S);
  return reply({ error: "not_found", notFound: true }, 404, "public, max-age=300");
}
