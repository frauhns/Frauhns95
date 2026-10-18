import { deezerJson } from "../../lib/deezer.js";

const PLAYLIST_ID = "15656484663";
const FRESH_S = 60;                 // browsers/edge may reuse this long
const KV_KEY = "playlist:v2";       // last known-good copy, survives Deezer outages and cold edges
const KV_REWRITE_S = 60 * 60 * 6;  // KV has a small daily write budget; only rewrite when changed or old

function json(body, status = 200, cache = "no-store") {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cache },
  });
}

function mapTrack(t) {
  return {
    id: t.id,
    name: t.title,
    artist: t.artist?.name ?? "",
    album: t.album?.title ?? "",
    cover: t.album?.cover_medium ?? t.album?.cover_big ?? t.album?.cover ?? "",
    url: t.link,
    preview: t.preview || "",
    duration: t.duration,
  };
}

async function fetchTracks() {
  const pl = await deezerJson(`/playlist/${PLAYLIST_ID}`);
  const all = Array.isArray(pl?.tracks?.data) ? [...pl.tracks.data] : [];
  const total = Number(pl?.nb_tracks) || all.length;

  // The embedded list can be truncated on big playlists; page through the rest.
  for (let guard = 0; all.length < total && guard < 20; guard++) {
    let page;
    try {
      page = await deezerJson(`/playlist/${PLAYLIST_ID}/tracks?index=${all.length}&limit=100`);
    } catch (_) {
      break; // keep what we have rather than failing the whole player
    }
    if (!Array.isArray(page?.data) || !page.data.length) break;
    all.push(...page.data);
  }

  const seen = new Set();
  return all
    .filter((t) => t && t.id && !seen.has(t.id) && seen.add(t.id))
    .map(mapTrack);
}

export async function onRequest(context) {
  const kv = context.env?.SITE_KV;

  try {
    const tracks = await fetchTracks();
    if (!tracks.length) throw new Error("empty playlist");

    if (kv) {
      context.waitUntil(
        (async () => {
          try {
            const prev = await kv.get(KV_KEY, "json");
            const sig = (list) => list.map((t) => t.id).join(",");
            const stale = !prev || Date.now() - (prev.at || 0) > KV_REWRITE_S * 1000;
            if (stale || sig(prev.tracks || []) !== sig(tracks)) {
              await kv.put(KV_KEY, JSON.stringify({ at: Date.now(), tracks }));
            }
          } catch (_) {}
        })()
      );
    }

    return json({ tracks }, 200, `public, max-age=${FRESH_S}, stale-while-revalidate=300`);
  } catch (err) {
    // Deezer is down / rate limited: serve the last good copy instead of breaking the player.
    if (kv) {
      try {
        const prev = await kv.get(KV_KEY, "json");
        if (prev?.tracks?.length) return json({ tracks: prev.tracks, stale: true }, 200, "no-store");
      } catch (_) {}
    }
    return json({ error: err?.message || "Deezer unavailable" }, 502);
  }
}
