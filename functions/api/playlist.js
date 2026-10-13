const PLAYLIST_ID = "15656484663";
const FRESH_S = 60;          // serve cached copy without hitting Deezer
const STALE_S = 60 * 60 * 24; // keep last good copy for outages

function json(body, status = 200, cache = "no-store") {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": cache },
  });
}

async function fetchPlaylist() {
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(`https://api.deezer.com/playlist/${PLAYLIST_ID}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data && !data.error && data.tracks && Array.isArray(data.tracks.data)) return data;
      }
    } catch (_) {}
    await new Promise(r => setTimeout(r, 250));
  }
  return null;
}

export async function onRequest(context) {
  const cache = caches.default;
  const cacheKey = new Request(new URL("/api/playlist", context.request.url).toString());

  try {
    const cached = await cache.match(cacheKey);
    const age = cached ? (Date.now() - Number(cached.headers.get("X-Cached-At") || 0)) / 1000 : Infinity;

    if (cached && age < FRESH_S) return cached;

    const data = await fetchPlaylist();

    // Deezer down or rate-limited: serve last good copy instead of breaking the player.
    if (!data) {
      if (cached) return cached;
      return json({ error: "Deezer unavailable" }, 502);
    }

    const tracks = data.tracks.data
      .filter(track => track && track.id && track.readable !== false)
      .map(track => ({
        id: track.id,
        name: track.title,
        artist: track.artist?.name ?? "",
        album: track.album?.title ?? "",
        cover: track.album?.cover_medium ?? "",
        url: track.link,
        preview: track.preview,
        duration: track.duration,
      }));

    const body = JSON.stringify({ tracks });
    const toStore = new Response(body, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${STALE_S}`,
        "X-Cached-At": String(Date.now()),
      },
    });
    context.waitUntil(cache.put(cacheKey, toStore));

    return new Response(body, {
      headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${FRESH_S}` },
    });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
