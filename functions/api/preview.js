export async function onRequest(context) {
  try {
    const requestUrl = new URL(context.request.url);
    const id = requestUrl.searchParams.get("id");

    if (!id || !/^\d+$/.test(id)) {
      return new Response("Invalid track ID", { status: 400 });
    }

    const deezerRes = await fetch(`https://api.deezer.com/track/${id}`, {
      headers: { "Cache-Control": "no-cache" },
    });

    if (!deezerRes.ok) {
      return new Response("Deezer track lookup failed", { status: 502 });
    }

    const track = await deezerRes.json();

    if (!track.preview) {
      return new Response("No preview available", { status: 404 });
    }

    const range = context.request.headers.get("Range");
    const upstreamHeaders = new Headers();
    if (range) upstreamHeaders.set("Range", range);

    const audioRes = await fetch(track.preview, {
      headers: upstreamHeaders,
    });

    if (!audioRes.ok) {
      return new Response("Preview fetch failed", { status: audioRes.status });
    }

    const headers = new Headers();
    const contentType = audioRes.headers.get("Content-Type");
    const contentLength = audioRes.headers.get("Content-Length");
    const contentRange = audioRes.headers.get("Content-Range");
    const acceptRanges = audioRes.headers.get("Accept-Ranges");

    headers.set("Content-Type", contentType || "audio/mpeg");
    headers.set("Cache-Control", "no-store");
    headers.set("Accept-Ranges", acceptRanges || "bytes");

    if (contentLength) headers.set("Content-Length", contentLength);
    if (contentRange) headers.set("Content-Range", contentRange);

    return new Response(audioRes.body, {
      status: audioRes.status,
      headers,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
