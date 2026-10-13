const FETCH_TIMEOUT_MS = 8000;
const LOOKUP_TTL_S = 120;

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function fetchWithRetry(url, init = {}, tries = 2) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (res.status < 500 && res.status !== 429) return res;
      lastErr = new Error(`upstream ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise(r => setTimeout(r, 200 * (i + 1)));
  }
  throw lastErr;
}

// Deezer returns HTTP 200 with { error } body on quota/not-found, so check body too.
async function lookupPreviewUrl(id, context) {
  const cache = caches.default;
  const cacheKey = new Request(`https://preview-lookup.internal/${id}`);

  const cached = await cache.match(cacheKey);
  if (cached) {
    const url = await cached.text();
    if (url) return url;
  }

  const res = await fetchWithRetry(`https://api.deezer.com/track/${id}`);
  if (!res.ok) throw new Error("Deezer track lookup failed");

  const track = await res.json();
  if (track.error) throw new Error(`Deezer error: ${track.error.message || track.error.type || "unknown"}`);
  if (!track.preview) return null;

  context.waitUntil(
    cache.put(
      cacheKey,
      new Response(track.preview, { headers: { "Cache-Control": `max-age=${LOOKUP_TTL_S}` } })
    )
  );
  return track.preview;
}

async function fetchAudio(previewUrl, range) {
  const headers = new Headers();
  if (range) headers.set("Range", range);
  return fetchWithRetry(previewUrl, { headers });
}

export async function onRequest(context) {
  try {
    const requestUrl = new URL(context.request.url);
    const id = requestUrl.searchParams.get("id");

    if (!id || !/^\d+$/.test(id)) return jsonError("Invalid track ID", 400);

    const range = context.request.headers.get("Range");

    let previewUrl = await lookupPreviewUrl(id, context);
    if (!previewUrl) return jsonError("No preview available", 404);

    let audioRes = await fetchAudio(previewUrl, range);

    // Signed preview URLs expire; drop cached lookup and retry once with a fresh one.
    if (audioRes.status === 403 || audioRes.status === 404) {
      await caches.default.delete(new Request(`https://preview-lookup.internal/${id}`));
      const res = await fetchWithRetry(`https://api.deezer.com/track/${id}`);
      const track = res.ok ? await res.json() : null;
      if (!track || track.error || !track.preview) return jsonError("Preview fetch failed", 502);
      previewUrl = track.preview;
      audioRes = await fetchAudio(previewUrl, range);
    }

    if (!audioRes.ok && audioRes.status !== 206) {
      return jsonError("Preview fetch failed", audioRes.status === 404 ? 404 : 502);
    }

    const headers = new Headers();
    headers.set("Content-Type", audioRes.headers.get("Content-Type") || "audio/mpeg");
    headers.set("Accept-Ranges", audioRes.headers.get("Accept-Ranges") || "bytes");
    headers.set("Cache-Control", "private, max-age=300");

    const contentLength = audioRes.headers.get("Content-Length");
    const contentRange = audioRes.headers.get("Content-Range");
    if (contentLength) headers.set("Content-Length", contentLength);
    if (contentRange) headers.set("Content-Range", contentRange);

    return new Response(audioRes.body, { status: audioRes.status, headers });
  } catch (err) {
    return jsonError(err.message, 502);
  }
}
