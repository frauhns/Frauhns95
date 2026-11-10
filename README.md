# Frauhns95

Personal desktop site, Win95-styled. Draggable windows, taskbar, start menu, music player, blog reader, theme switcher.

**Live:** https://frauhns.pages.dev

## Stack

HTML/CSS/JS, no frameworks. Cloudflare Pages Functions (`functions/`) for posts, offsets and the preview proxy. Workers KV backs posts/offsets.

## Local run

Open `index.html`. No build step.

For `/api/*` routes:

```
npm install
npx wrangler dev
```

### KV setup

`posts` + `offsets` live in KV namespace `F95_KV`. Nothing else is stored in KV.

```
npx wrangler kv namespace create F95_KV
```

Add id to `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "F95_KV"
id = "<your-namespace-id>"
```

Seed data (local `posts.json`/`offsets.json`, not in repo):

```
npx wrangler kv key put --binding=F95_KV "posts" --path=posts.json
npx wrangler kv key put --binding=F95_KV "offsets" --path=offsets.json
```

Re-run `put` on content changes.

## Music player

- Playlist and track previews come from Deezer straight in the visitor's browser (JSONP, no CORS), so it uses their IP and not Cloudflare's.
- Lyrics come straight from lrclib in the browser. `lib/lyrics-match.js` handles title/artist matching and LRC parsing.
- `/api/preview` is only a backup audio proxy, used when the direct Deezer URLs fail.
- `npm test` runs offline tests.

## License

Personal project. Not licensed for reuse.
