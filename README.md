# Frauhns95

Personal desktop site, Win95-styled. Draggable windows, taskbar, start menu, music player, blog reader, theme switcher.

**Live:** https://frauhns.pages.dev

## Stack

HTML/CSS/JS, no frameworks. Cloudflare Pages Functions (`functions/`) for playlist, lyrics, posts, offsets APIs. Cloudflare Workers KV backs posts/offsets.

## Local run

Open `index.html`. No build step.

For `/api/*` routes:

```
npm install
npx wrangler dev
```

### KV setup

`posts` + `offsets` live in KV namespace `SITE_KV`, not static json.

```
npx wrangler kv namespace create SITE_KV
```

Add id to `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "SITE_KV"
id = "<your-namespace-id>"
```

Seed data (local `posts.json`/`offsets.json`, not in repo):

```
npx wrangler kv key put --binding=SITE_KV "posts" --path=posts.json
npx wrangler kv key put --binding=SITE_KV "offsets" --path=offsets.json
```

Re-run `put` on content changes.

## Music player reliability notes

- `lib/lyrics-match.js` is shared by `functions/api/lyrics.js` and the browser. It normalizes titles/artists
  (remaster/feat/live suffixes), scores lrclib candidates by title, artist and duration, and parses LRC.
- `/api/lyrics` answers 404 only when lrclib really has nothing. Provider outages return 503 (never cached),
  and the page retries, then asks lrclib directly from the browser, before showing "tap to retry".
- `/api/preview` downloads and validates the whole clip, then serves 200/206/416 itself. It uses the page's
  preview URL as a hint, falls back to a fresh Deezer lookup, then a Deezer search for the same song.
- `/api/playlist` pages through big playlists and keeps a last-good copy in KV (`playlist:v2`).
  Lyrics are cached in KV as `lyrics:v2:*`. These keys do not touch `posts` / `offsets`.
- `npm test` runs offline tests against mocked Deezer and lrclib.

## License

Personal project. Not licensed for reuse.
