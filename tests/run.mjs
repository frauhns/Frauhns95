// Offline tests: mocks Deezer + lrclib. Run with: node tests/run.mjs
import assert from "node:assert/strict";
import { parseLrc, cleanTitle, pickBest, primaryArtist, spreadPlain } from "../lib/lyrics-match.js";
import { onRequest as lyrics } from "../functions/api/lyrics.js";
import { onRequest as preview } from "../functions/api/preview.js";
import { onRequest as playlist } from "../functions/api/playlist.js";

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log("  ok  ", name); }
  catch (e) { console.error("  FAIL", name, "\n", e); process.exitCode = 1; }
};
const ctx = (url, init = {}, env = {}) => ({
  request: new Request(url, init), env, waitUntil: () => {},
});
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
const realFetch = globalThis.fetch;
const mockFetch = (fn) => (globalThis.fetch = async (u, i) => fn(String(u), i));
const sleepless = () => { globalThis.setTimeout = ((orig) => (f, ms, ...a) => orig(f, Math.min(ms || 0, 5), ...a))(globalThis.setTimeout); };
sleepless();

console.log("lyrics-match");
await test("cleanTitle strips remaster/feat noise", () => {
  assert.equal(cleanTitle("Song (feat. X) - 2011 Remaster"), "Song");
  assert.equal(cleanTitle("Bohemian Rhapsody - Remastered 2011"), "Bohemian Rhapsody");
  assert.equal(cleanTitle("Title - Radio Edit"), "Title");
  assert.equal(cleanTitle("Heroes (Live)"), "Heroes");
  assert.equal(cleanTitle("(Sittin' On) The Dock of the Bay"), "(Sittin' On) The Dock of the Bay");
});
await test("primaryArtist", () => {
  assert.equal(primaryArtist("Daft Punk, Pharrell Williams"), "Daft Punk");
  assert.equal(primaryArtist("Simon & Garfunkel"), "Simon & Garfunkel");
  assert.equal(primaryArtist("Earth, Wind & Fire"), "Earth");
  assert.equal(primaryArtist("AC/DC"), "AC/DC");
  assert.equal(primaryArtist("Malcolm X"), "Malcolm X");
  assert.equal(primaryArtist("Drake feat. Rihanna"), "Drake");
});
await test("parseLrc: multi-stamp, 1-digit min, [mm:ss:xx], metadata, crlf", () => {
  const l = parseLrc("[ar:X]\r\n[00:10.50]Hello\r\n[00:20.00][01:05.5]Chorus line\r\n[1:30:25]Old fmt\r\n[00:40.00]\r\n[100:01.000]Long");
  assert.deepEqual(l.map(x => [x.time, x.text]), [[10.5,"hello"],[20,"chorus line"],[65.5,"chorus line"],[90.25,"old fmt"],[6001,"long"]]);
});
await test("pickBest: prefers right duration, rejects wrong song & far duration", () => {
  const mk = (t,a,d,s=true)=>({trackName:t,artistName:a,duration:d,syncedLyrics:s?"[00:01.00]x":null});
  const r = pickBest([mk("Other","Y",200),mk("Song","Artist",300),mk("Song","Artist",212)], {artist:"Artist",title:"Song - 2011 Remaster",duration:213});
  assert.equal(r.record.duration, 212);
  assert.equal(pickBest([mk("Song","Artist",300)], {artist:"Artist",title:"Song",duration:213}), null);
  assert.equal(pickBest([mk("Song","Artist",213,false)], {artist:"Artist",title:"Song",duration:213}), null);
});

await test("pickBest: '&' vs 'and' artist, plain-only fallback, synced preferred, 20s-off cut still accepted", () => {
  const rec = (o) => ({ trackName: "Song", artistName: "Simon and Garfunkel", duration: 200, ...o });
  const plain = "line one of the song\nline two of the song";
  let r = pickBest([rec({ plainLyrics: plain })], { artist: "Simon & Garfunkel", title: "Song", duration: 200 });
  assert.equal(r.synced, false);
  r = pickBest([rec({ plainLyrics: plain }), rec({ syncedLyrics: "[00:01.00]x" })], { artist: "Simon & Garfunkel", title: "Song", duration: 200 });
  assert.equal(r.synced, true);
  assert.ok(pickBest([rec({ syncedLyrics: "[00:01.00]x", duration: 220 })], { artist: "Simon & Garfunkel", title: "Song", duration: 200 }));
  assert.equal(pickBest([rec({ syncedLyrics: "[00:01.00]x", duration: 300 })], { artist: "Simon & Garfunkel", title: "Song", duration: 200 }), null);
});
await test("spreadPlain spreads lines across duration", () => {
  const l = spreadPlain("a\nb\nc\nd", 200);
  assert.deepEqual(l.map((x) => x.time), [0, 50, 100, 150]);
});

console.log("lyrics api");
const LRC = "[00:01.00]hi\n[00:05.00]there";
await test("finds via search when exact get 404s (title has remaster suffix)", async () => {
  mockFetch((u) => {
    if (u.includes("/api/get")) return new Response("{}", { status: 404 });
    if (u.includes("/api/search")) return J([{ trackName: "Yellow", artistName: "Coldplay", duration: 267, syncedLyrics: LRC }]);
  });
  const r = await lyrics(ctx("https://x/api/lyrics?artist=Coldplay&title=" + encodeURIComponent("Yellow - Remastered 2011") + "&duration=266"));
  assert.equal(r.status, 200); assert.ok((await r.json()).syncedLyrics);
});
await test("lrclib 500s -> 503 retryable (NOT a 404 'no lyrics')", async () => {
  mockFetch(() => new Response("boom", { status: 502 }));
  const r = await lyrics(ctx("https://x/api/lyrics?artist=A&title=B&duration=100"));
  assert.equal(r.status, 503); assert.equal((await r.json()).retryable, true);
  assert.equal(r.headers.get("Cache-Control"), "no-store");
});
await test("timeouts/network errors -> 503", async () => {
  mockFetch(() => { throw new Error("net"); });
  const r = await lyrics(ctx("https://x/api/lyrics?artist=A&title=B"));
  assert.equal(r.status, 503);
});
await test("genuinely absent -> 404 notFound", async () => {
  mockFetch((u) => u.includes("/get") ? new Response("{}", { status: 404 }) : J([]));
  const r = await lyrics(ctx("https://x/api/lyrics?artist=A&title=B&duration=100"));
  assert.equal(r.status, 404); assert.equal((await r.json()).notFound, true);
});
await test("API returns plainLyrics when lrclib has no synced version", async () => {
  mockFetch((u) => u.includes("/get") ? new Response("{}", { status: 404 }) : J([{ trackName: "B", artistName: "A", duration: 100, syncedLyrics: null, plainLyrics: "some plain lyrics line\nanother plain lyrics line" }]));
  const b = await (await lyrics(ctx("https://x/api/lyrics?artist=A&title=B&duration=100"))).json();
  assert.ok(b.plainLyrics && !b.syncedLyrics);
});
await test("sends User-Agent to lrclib", async () => {
  let ua; mockFetch((u, i) => { ua = i.headers["User-Agent"]; return J([]); });
  await lyrics(ctx("https://x/api/lyrics?artist=A&title=B"));
  assert.match(ua, /Frauhns95/);
});
await test("KV hit skips network; KV miss stores", async () => {
  const kv = new Map(); const env = { SITE_KV: { get: async (k) => kv.has(k) ? JSON.parse(kv.get(k)) : null, put: async (k, v) => kv.set(k, v) } };
  let calls = 0; mockFetch(() => { calls++; return J([{ trackName: "B", artistName: "A", duration: 100, syncedLyrics: LRC }]); });
  const c1 = ctx("https://x/api/lyrics?artist=A&title=B&duration=100", {}, env);
  const pending = []; c1.waitUntil = (p) => pending.push(p);
  assert.equal((await lyrics(c1)).status, 200); await Promise.all(pending);
  const before = calls;
  assert.equal((await lyrics(ctx("https://x/api/lyrics?artist=A&title=B&duration=100", {}, env))).status, 200);
  assert.equal(calls, before);
});
await test("400 on missing params", async () => assert.equal((await lyrics(ctx("https://x/api/lyrics?artist=A"))).status, 400));

console.log("preview api");
const AUDIO = new Uint8Array(40000).map((_, i) => i % 251);
const audioRes = () => new Response(AUDIO.slice(), { headers: { "Content-Type": "audio/mpeg" } });
await test("serves full 200 + correct headers", async () => {
  mockFetch((u) => u.includes("dzcdn.net") ? audioRes() : J({}));
  const r = await preview(ctx("https://x/api/preview?id=1&hint=" + encodeURIComponent("https://cdnt-preview.dzcdn.net/a.mp3")));
  assert.equal(r.status, 200); assert.equal(r.headers.get("Accept-Ranges"), "bytes");
  assert.equal((await r.arrayBuffer()).byteLength, 40000);
});
await test("Range: bytes=0-1 -> 206 with exact Content-Range (Safari probe)", async () => {
  mockFetch((u) => u.includes("dzcdn.net") ? audioRes() : J({}));
  const r = await preview(ctx("https://x/api/preview?id=1&hint=" + encodeURIComponent("https://cdnt-preview.dzcdn.net/a.mp3"), { headers: { Range: "bytes=0-1" } }));
  assert.equal(r.status, 206); assert.equal(r.headers.get("Content-Range"), "bytes 0-1/40000");
  assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [0, 1]);
});
await test("open-ended + suffix ranges, 416 on bad range", async () => {
  mockFetch((u) => u.includes("dzcdn.net") ? audioRes() : J({}));
  const h = "https://x/api/preview?id=1&hint=" + encodeURIComponent("https://cdnt-preview.dzcdn.net/a.mp3");
  let r = await preview(ctx(h, { headers: { Range: "bytes=39990-" } })); assert.equal(r.headers.get("Content-Range"), "bytes 39990-39999/40000");
  r = await preview(ctx(h, { headers: { Range: "bytes=-10" } })); assert.equal(r.headers.get("Content-Range"), "bytes 39990-39999/40000");
  r = await preview(ctx(h, { headers: { Range: "bytes=99999-" } })); assert.equal(r.status, 416);
});
await test("expired hint (403) -> re-resolves fresh URL from Deezer", async () => {
  mockFetch((u) => {
    if (u.includes("old.dzcdn.net")) return new Response("", { status: 403 });
    if (u.includes("/track/7")) return J({ id: 7, preview: "https://new.dzcdn.net/ok.mp3" });
    if (u.includes("new.dzcdn.net")) return audioRes();
  });
  const r = await preview(ctx("https://x/api/preview?id=7&hint=" + encodeURIComponent("https://old.dzcdn.net/x.mp3")));
  assert.equal(r.status, 200);
});
await test("Deezer quota error (HTTP 200 + error body) is retried", async () => {
  let n = 0;
  mockFetch((u) => {
    if (u.includes("/track/8")) return ++n < 3 ? J({ error: { code: 4, message: "Quota limit exceeded" } }) : J({ preview: "https://p.dzcdn.net/ok.mp3" });
    if (u.includes("p.dzcdn.net")) return audioRes();
  });
  const r = await preview(ctx("https://x/api/preview?id=8"));
  assert.equal(r.status, 200); assert.equal(n, 3);
});
await test("upstream returns HTML/tiny body -> rejected, falls to alternate via search", async () => {
  mockFetch((u) => {
    if (u.includes("bad.dzcdn.net")) return new Response("<html>", { headers: { "Content-Type": "text/html" } });
    if (u.includes("/track/9")) return J({ id: 9, title: "T", artist: { name: "A" }, duration: 200, preview: "https://bad.dzcdn.net/x" });
    if (u.includes("/search")) return J({ data: [{ preview: "https://alt.dzcdn.net/y.mp3", duration: 201 }] });
    if (u.includes("alt.dzcdn.net")) return audioRes();
  });
  assert.equal((await preview(ctx("https://x/api/preview?id=9"))).status, 200);
});
await test("hint to non-Deezer host is ignored (no SSRF)", async () => {
  const seen = [];
  mockFetch((u) => { seen.push(u); if (u.includes("/track/5")) return J({ preview: "https://z.dzcdn.net/a.mp3" }); if (u.includes("dzcdn")) return audioRes(); });
  await preview(ctx("https://x/api/preview?id=5&hint=" + encodeURIComponent("https://evil.example/a.mp3")));
  assert.ok(!seen.some(u => u.includes("evil.example")));
});
await test("everything fails -> 502 json, bad id -> 400", async () => {
  mockFetch(() => new Response("", { status: 500 }));
  assert.equal((await preview(ctx("https://x/api/preview?id=3"))).status, 502);
  assert.equal((await preview(ctx("https://x/api/preview?id=abc"))).status, 400);
});

console.log("playlist api");
const trk = (i) => ({ id: i, title: "T" + i, link: "l", preview: "p", duration: 100, artist: { name: "A" }, album: { title: "Al", cover_medium: "c" } });
await test("pages through truncated playlists, dedupes", async () => {
  mockFetch((u) => {
    if (u.includes("/tracks?index=2")) return J({ data: [trk(3), trk(2)] });
    if (u.includes("/playlist/")) return J({ nb_tracks: 3, tracks: { data: [trk(1), trk(2)] } });
  });
  const b = await (await playlist(ctx("https://x/api/playlist"))).json();
  assert.deepEqual(b.tracks.map(t => t.id), [1, 2, 3]);
});
await test("Deezer down -> serves KV last-good copy", async () => {
  mockFetch(() => new Response("", { status: 503 }));
  const env = { SITE_KV: { get: async () => ({ at: 1, tracks: [{ id: 1, name: "x" }] }), put: async () => {} } };
  const r = await playlist(ctx("https://x/api/playlist", {}, env));
  assert.equal(r.status, 200); assert.equal((await r.json()).stale, true);
});
await test("Deezer down, no KV -> 502", async () => {
  mockFetch(() => new Response("", { status: 503 }));
  assert.equal((await playlist(ctx("https://x/api/playlist"))).status, 502);
});

globalThis.fetch = realFetch;
console.log(`\n${passed} passed`);
