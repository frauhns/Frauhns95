import { deezerJson, isDeezerHost } from "../../lib/deezer.js";

// BACKUP AUDIO PROXY FOR DEEZER PREVIEWS (BROWSER TRIES DEEZER DIRECTLY FIRST)

const AUDIO_TIMEOUT_MS = 9000;
const MIN_BYTES = 8 * 1024;
const MAX_BYTES = 8 * 1024 * 1024;
const EDGE_TTL_S = 60 * 60 * 24;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// DOWNLOAD + VALIDATE AUDIO, ARRAYBUFFER OR NULL
async function downloadAudio(url) {
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(AUDIO_TIMEOUT_MS) });
      if (res.status === 403 || res.status === 404 || res.status === 410) return null;
      if (res.ok) {
        const type = (res.headers.get("Content-Type") || "").toLowerCase();
        if (type.startsWith("text/") || type.includes("json") || type.includes("html")) return null;
        const buf = await res.arrayBuffer();
        if (buf.byteLength >= MIN_BYTES && buf.byteLength <= MAX_BYTES) return buf;
        return null;
      }
    } catch (_) {
      /* RETRY */
    }
    await sleep(250);
  }
  return null;
}

async function freshPreviewUrl(id) {
  try {
    const track = await deezerJson(`/track/${id}`);
    return track?.preview || null;
  } catch (_) {
    return null;
  }
}

// SAME SONG UNDER ANOTHER ID
async function alternatePreviewUrl(id) {
  try {
    const track = await deezerJson(`/track/${id}`, 2);
    if (!track?.title || !track?.artist?.name) return null;
    const q = `artist:"${track.artist.name}" track:"${track.title}"`;
    const found = await deezerJson(`/search?q=${encodeURIComponent(q)}&limit=10`, 2);
    const want = Number(track.duration) || 0;
    const hit = (found?.data || []).find(
      (t) => t?.preview && (!want || Math.abs(Number(t.duration) - want) <= 3)
    );
    return hit?.preview || null;
  } catch (_) {
    return null;
  }
}

async function getAudio(id, hint, refresh) {
  // 1 URL FROM PAGE
  if (!refresh && hint && isDeezerHost(hint)) {
    const buf = await downloadAudio(hint);
    if (buf) return buf;
  }
  // 2 FRESH URL
  const fresh = await freshPreviewUrl(id);
  if (fresh) {
    const buf = await downloadAudio(fresh);
    if (buf) return buf;
  }
  // 3 ALTERNATE RELEASE
  const alt = await alternatePreviewUrl(id);
  if (alt) {
    const buf = await downloadAudio(alt);
    if (buf) return buf;
  }
  return null;
}

// RANGE HEADER -> {start,end} | "invalid" | null
function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start;
  let end;
  if (m[1] === "") {
    const n = parseInt(m[2], 10);
    if (!n) return "invalid";
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = parseInt(m[1], 10);
    end = m[2] === "" ? size - 1 : Math.min(parseInt(m[2], 10), size - 1);
  }
  if (start >= size || start > end) return "invalid";
  return { start, end };
}

function serve(buf, request) {
  const size = buf.byteLength;
  const base = {
    "Content-Type": "audio/mpeg",
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=86400",
    "X-Content-Type-Options": "nosniff",
  };
  const head = request.method === "HEAD";
  const range = parseRange(request.headers.get("Range"), size);

  if (range === "invalid") {
    return new Response(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${size}` } });
  }
  if (range) {
    const { start, end } = range;
    return new Response(head ? null : buf.slice(start, end + 1), {
      status: 206,
      headers: { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(head ? null : buf, { status: 200, headers: { ...base, "Content-Length": String(size) } });
}

export async function onRequest(context) {
  const { request } = context;
  if (request.method !== "GET" && request.method !== "HEAD") return jsonError("Method not allowed", 405);

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id || !/^\d+$/.test(id)) return jsonError("Invalid track ID", 400);

    const hint = url.searchParams.get("hint") || "";
    const refresh = url.searchParams.get("refresh") === "1";

    // EDGE CACHE, BEST EFFORT
    let cache = null;
    let cacheKey = null;
    try {
      cache = caches.default;
      cacheKey = new Request(`${url.origin}/__preview-cache/${id}`);
    } catch (_) {}

    if (cache && !refresh) {
      try {
        const hit = await cache.match(cacheKey);
        if (hit) {
          const buf = await hit.arrayBuffer();
          if (buf.byteLength >= MIN_BYTES) return serve(buf, request);
        }
      } catch (_) {}
    }

    const buf = await getAudio(id, hint, refresh);
    if (!buf) return jsonError("No playable preview available", 502);

    if (cache) {
      context.waitUntil(
        cache
          .put(cacheKey, new Response(buf, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": `public, max-age=${EDGE_TTL_S}` } }))
          .catch(() => {})
      );
    }
    return serve(buf, request);
  } catch (err) {
    return jsonError(err?.message || "Preview failed", 502);
  }
}
