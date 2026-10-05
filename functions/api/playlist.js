export async function onRequest(context) {
  try {
    const res = await fetch(`https://api.deezer.com/playlist/15656484663`);
    const data = await res.json();

    if (data.error) {
      return new Response(JSON.stringify({ error: data.error }), { status: 500 });
    }

    const tracks = data.tracks.data.map(track => ({
      id: track.id,
      name: track.title,
      artist: track.artist.name,
      album: track.album.title,
      cover: track.album.cover_medium,
      url: track.link,
      preview: track.preview,
      duration: track.duration,
    }));

    return new Response(JSON.stringify({ tracks }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}