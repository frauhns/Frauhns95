// Pure helpers shared by functions/api/lyrics.js (server) and script.js (browser, via dynamic import).
// No DOM, no fetch, no Workers APIs in here, so it can be unit-tested in plain Node.

const NOISE_WORDS =
  "remaster(?:ed)?|re-?master(?:ed)?|mono|stereo|version|edit|mix|remix|live|acoustic|demo|bonus|deluxe|explicit|clean|radio|single|album|original|extended|instrumental|from|soundtrack|anniversary|reissue|\\d{4}";
const NOISE_RE = new RegExp(`\\b(?:${NOISE_WORDS})\\b`, "i");

export function fold(str) {
  return String(str ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/['’`´]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// "Song (feat. X) - 2011 Remaster" -> "Song"
export function cleanTitle(title) {
  let t = String(title ?? "");
  t = t.replace(/[\(\[][^\)\]]*[\)\]]/g, (m) => (/feat|ft\.|with|remaster|version|edit|mix|live|deluxe|explicit|bonus|mono|stereo|from|soundtrack|\d{4}/i.test(m) ? " " : m));
  const dash = t.split(/\s+[-–—]\s+/);
  if (dash.length > 1 && dash.slice(1).some((p) => NOISE_RE.test(p) || /feat|ft\./i.test(p))) t = dash[0];
  t = t.replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i, "");
  return t.replace(/\s+/g, " ").trim();
}

export function primaryArtist(artist) {
  return String(artist ?? "")
    .split(/\s*[,;]\s*|\s+\/\s+|\s+x\s+|\s+(?:feat\.?|ft\.?|featuring)\s+/i)[0]
    .trim();
}

function uniq(list) {
  return [...new Set(list.filter(Boolean))];
}

export function titleVariants(title) {
  const raw = String(title ?? "").trim();
  const clean = cleanTitle(raw);
  const noParens = raw.replace(/\s*[\(\[][^\)\]]*[\)\]]/g, "").trim();
  return uniq([raw, clean, noParens]);
}

export function artistVariants(artist) {
  const raw = String(artist ?? "").trim();
  return uniq([raw, primaryArtist(raw)]);
}

function tokens(s) {
  return fold(s).split(" ").filter(Boolean);
}

function overlap(a, b) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const t of A) if (B.has(t)) hit++;
  return hit / Math.min(A.size, B.size);
}

export function titleScore(wanted, candidate) {
  const w = fold(cleanTitle(wanted));
  const c = fold(cleanTitle(candidate));
  if (!w || !c) return 0;
  if (w === c) return 1;
  if (fold(wanted) === fold(candidate)) return 1;
  if (w.includes(c) || c.includes(w)) return 0.85;
  const o = overlap(w, c);
  return o >= 0.8 ? 0.7 : o * 0.5;
}

export function artistScore(wanted, candidate) {
  const w = fold(wanted);
  const c = fold(candidate);
  if (!w || !c) return 0;
  if (w === c) return 1;
  if (fold(primaryArtist(wanted)) === fold(primaryArtist(candidate))) return 0.95;
  if (w.includes(c) || c.includes(w)) return 0.85;
  return overlap(w, c) * 0.8;
}

export const MAX_DURATION_DIFF = 30; // seconds; further off than this is a different recording

export function hasSynced(r) {
  return !!(r && typeof r.syncedLyrics === "string" && /\[\d{1,3}:\d{2}/.test(r.syncedLyrics));
}

export function hasPlain(r) {
  return !!(r && typeof r.plainLyrics === "string" && r.plainLyrics.trim().length > 20);
}

// Best candidate that has lyrics. Synced beats plain when the match quality is similar.
// Returns { record, score, synced } or null.
export function pickBest(candidates, { artist, title, duration }) {
  const want = Number(duration) > 0 ? Number(duration) : null;
  let best = null;

  for (const r of candidates || []) {
    const synced = hasSynced(r);
    if (!synced && !hasPlain(r)) continue;

    const t = titleScore(title, r.trackName ?? r.name);
    const a = artistScore(artist, r.artistName);
    if (t < 0.7 || a < 0.5) continue;

    let d = 6; // duration unknown on either side: neutral
    if (want && Number(r.duration) > 0) {
      const diff = Math.abs(Number(r.duration) - want);
      if (diff > MAX_DURATION_DIFF) continue;
      d = diff <= 1 ? 20 : diff <= 3 ? 15 : diff <= 8 ? 8 : diff <= 15 ? 3 : 0;
    }

    const score = t * 50 + a * 30 + d + (synced ? 15 : 0);
    if (!best || score > best.score) best = { record: r, score, synced };
  }
  return best;
}

// Unsynced lyrics -> pseudo-timed lines spread evenly over the track, so something sensible shows.
export function spreadPlain(plain, durationSec) {
  const lines = String(plain ?? "").split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter(Boolean);
  const total = Number(durationSec) > 0 ? Number(durationSec) : lines.length * 4;
  return lines.map((text, i) => ({ time: (i / lines.length) * total, text }));
}

// LRC -> [{ time, text }] sorted by time. Handles multiple stamps per line, 1-3 digit minutes,
// 1-3 digit fractions, [mm:ss:xx] and skips [ar:] style metadata tags.
export function parseLrc(lrcText) {
  const out = [];
  const stamp = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

  for (const rawLine of String(lrcText ?? "").split(/\r?\n/)) {
    const stamps = [...rawLine.matchAll(stamp)];
    if (!stamps.length) continue;
    const text = rawLine.replace(stamp, "").replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, "").trim().toLowerCase();
    if (!text) continue;
    for (const m of stamps) {
      const frac = m[3] ? parseInt(m[3].padEnd(3, "0").slice(0, 3), 10) / 1000 : 0;
      out.push({ time: parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + frac, text });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}
