// WINDOW MANAGER
(() => {
    const desktopEl = document.querySelector(".desktop");
    const tasklistEl = document.querySelector(".tasklist");
    const APPS = ["about", "blog", "tech", "theme", "projects", "playlist"];

    const state = {};
    let topZ = 0;
    let activeApp = null;

    function clamp(val, min, max) {
        return Math.min(Math.max(val, min), max);
    }

    // CLAMP WIN SIZE TO DESKTOP
    function clampToDesktop(win, left, top) {
        const dRect = desktopEl.getBoundingClientRect();
        const wRect = win.getBoundingClientRect();
        const maxLeft = dRect.width - wRect.width;
        const maxTop = dRect.height - wRect.height;
        return {
            left: clamp(left, 0, Math.max(0, maxLeft)),
            top: clamp(top, 0, Math.max(0, maxTop))
        };
    }

    // RECLAMP WIN
    function reclamp(win) {
        const left = parseFloat(win.style.left) || 0;
        const top = parseFloat(win.style.top) || 0;
        const c = clampToDesktop(win, left, top);
        win.style.left = `${c.left}px`;
        win.style.top = `${c.top}px`;
    }

    // RANDOM WIN POS
    function randomizePosition(win) {
        const dRect = desktopEl.getBoundingClientRect();
        const wRect = win.getBoundingClientRect();
        const maxLeft = Math.max(0, dRect.width - wRect.width);
        const maxTop = Math.max(0, dRect.height - wRect.height);
        win.style.left = `${Math.random() * maxLeft}px`;
        win.style.top = `${Math.random() * maxTop}px`;
    }

    APPS.forEach(name => {
        state[name] = {
            win: document.querySelector(`.window.${name}`),
            task: document.querySelector(`.${name}-task`),
            launcher: document.querySelector(`.${name}-launcher`),
            open: false,
            minimized: false,
            z: 0
        };
    });

    // ACTIVE WINDOW
    function setActive(name) {
        activeApp = name;
        APPS.forEach(n => {
            const s = state[n];
            s.win.classList.toggle("active", n === name);
            s.task.classList.toggle("active", n === name);
        });
    }

    function clearActive() {
        activeApp = null;
        APPS.forEach(n => {
            state[n].win.classList.remove("active");
            state[n].task.classList.remove("active");
        });
    }

    function focusApp(name) {
        const s = state[name];
        if (!s.open || s.minimized) return;
        topZ += 1;
        s.z = topZ;
        s.win.style.zIndex = topZ;
        setActive(name);
    }

    // Z-INDEX FALLBACK
    function fallbackFocus() {
        let best = null;
        APPS.forEach(n => {
            const s = state[n];
            if (s.open && !s.minimized && (!best || s.z > state[best].z)) best = n;
        });
        if (best) focusApp(best);
        else clearActive();
    }

    function openApp(name) {
        const s = state[name];
        s.open = true;
        s.minimized = false;
        s.win.classList.add("open");
        s.task.classList.add("open");
        // TASK ORDER VIA LAUNCH
        if (tasklistEl) tasklistEl.appendChild(s.task);
        randomizePosition(s.win);
        focusApp(name);
    }

    function closeApp(name) {
        const s = state[name];
        const wasActive = activeApp === name;
        s.open = false;
        s.minimized = false;
        s.win.classList.remove("open", "active");
        s.task.classList.remove("open", "active");
        if (wasActive) { activeApp = null; fallbackFocus(); }
        document.dispatchEvent(new CustomEvent("wm:closed", { detail: { app: name } }));
    }

    function minimizeApp(name) {
        const s = state[name];
        const wasActive = activeApp === name;
        s.minimized = true;
        s.win.classList.remove("open", "active");
        s.task.classList.remove("active");
        if (wasActive) { activeApp = null; fallbackFocus(); }
    }

    function restoreApp(name) {
        const s = state[name];
        s.minimized = false;
        s.win.classList.add("open");
        reclamp(s.win); // RECLAMP WINDOW
        focusApp(name);
    }

    function clearLauncherArmed(except) {
        APPS.forEach(n => {
            const l = state[n].launcher;
            if (l && n !== except) l.classList.remove("active");
        });
    }

    // LAUNCHERS
    APPS.forEach(name => {
        const s = state[name];
        if (!s.launcher) return;
        s.launcher.addEventListener("click", (e) => {
            e.stopPropagation();
            if (s.open) {
                s.minimized ? restoreApp(name) : focusApp(name);
                s.launcher.classList.remove("active");
                return;
            }
            if (s.launcher.classList.contains("active")) {
                openApp(name);
                s.launcher.classList.remove("active");
            } else {
                clearLauncherArmed(name);
                s.launcher.classList.add("active");
            }
        });
    });

    // LAUNCHER CLEAR ACTIVE
    document.addEventListener("click", (e) => {
        if (e.target.closest(".launcher")) return;
        clearLauncherArmed(null);
    });

    // TASKS
    APPS.forEach(name => {
        const s = state[name];
        if (!s.task) return;
        s.task.addEventListener("click", () => {
            if (!s.open) return;
            if (s.minimized) restoreApp(name);
            else if (activeApp === name) minimizeApp(name);
            else focusApp(name);
        });
    });

    // MIN, CLOSE, DRAG
    APPS.forEach(name => {
        const s = state[name];
        const win = s.win;
        const titlebar = win.querySelector(".titlebar");
        if (!titlebar) return;

        const minBtn = win.querySelector(".min.btn");
        const clsBtn = win.querySelector(".cls.btn");
        if (minBtn) minBtn.addEventListener("click", (e) => { e.stopPropagation(); minimizeApp(name); });
        if (clsBtn) clsBtn.addEventListener("click", (e) => { e.stopPropagation(); closeApp(name); });

        let dragging = false;
        let startX = 0, startY = 0, startLeft = 0, startTop = 0;
        let touchId = null;
        let pendingX = null, pendingY = null, rafId = null;

        function applyMove(clientX, clientY) {
            const dx = clientX - startX;
            const dy = clientY - startY;
            const clamped = clampToDesktop(win, startLeft + dx, startTop + dy);
            win.style.left = `${clamped.left}px`;
            win.style.top = `${clamped.top}px`;
        }

        function flushMove() {
            rafId = null;
            if (pendingX === null) return;
            applyMove(pendingX, pendingY);
            pendingX = null; pendingY = null;
        }

        function queueMove(clientX, clientY) {
            pendingX = clientX; pendingY = clientY;
            if (rafId === null) rafId = requestAnimationFrame(flushMove);
        }

        function beginDrag(clientX, clientY) {
            dragging = true;
            focusApp(name);
            startX = clientX;
            startY = clientY;
            startLeft = parseFloat(win.style.left) || 0;
            startTop = parseFloat(win.style.top) || 0;
            win.classList.add("dragging");
        }

        function endDrag() {
            dragging = false;
            touchId = null;
            win.classList.remove("dragging");
            if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
            pendingX = null; pendingY = null;
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
            document.removeEventListener("touchmove", onTouchMove);
            document.removeEventListener("touchend", onTouchEnd);
            document.removeEventListener("touchcancel", onTouchEnd);
        }

        // MOUSE
        function onMouseDown(e) {
            if (e.target.closest(".btn")) return;
            if (e.button !== undefined && e.button !== 0) return;
            beginDrag(e.clientX, e.clientY);
            document.addEventListener("mousemove", onMouseMove);
            document.addEventListener("mouseup", onMouseUp);
        }
        function onMouseMove(e) {
            if (!dragging) return;
            queueMove(e.clientX, e.clientY);
        }
        function onMouseUp() {
            endDrag();
        }

        // TOUCH
        function onTouchStart(e) {
            if (e.target.closest(".btn")) return;
            if (dragging) return;
            const touch = e.changedTouches[0];
            touchId = touch.identifier;
            beginDrag(touch.clientX, touch.clientY);
            document.addEventListener("touchmove", onTouchMove, { passive: false });
            document.addEventListener("touchend", onTouchEnd);
            document.addEventListener("touchcancel", onTouchEnd);
        }
        function onTouchMove(e) {
            if (!dragging) return;
            let touch = null;
            for (const t of e.changedTouches) {
                if (t.identifier === touchId) { touch = t; break; }
            }
            if (!touch) return;
            e.preventDefault();
            queueMove(touch.clientX, touch.clientY);
        }
        function onTouchEnd(e) {
            for (const t of e.changedTouches) {
                if (t.identifier === touchId) { endDrag(); break; }
            }
        }

        titlebar.addEventListener("mousedown", onMouseDown);
        titlebar.addEventListener("touchstart", onTouchStart, { passive: false });
        win.addEventListener("mousedown", () => focusApp(name));
        win.addEventListener("touchstart", () => focusApp(name), { passive: true });
    });

    // SAFETY NET
    const ro = new ResizeObserver(entries => {
        for (const entry of entries) {
            if (entry.target === desktopEl) APPS.forEach(n => reclamp(state[n].win));
            else reclamp(entry.target);
        }
    });
    ro.observe(desktopEl);
    APPS.forEach(name => ro.observe(state[name].win));

    // ABOUT LOAD
    openApp("about");
})();


//START MENU TOGGLE
const startBtn = document.querySelector(".start-btn");
const startMenu = document.querySelector(".start-menu");

function closeStart() {
    startBtn.classList.remove("active");
    startMenu.classList.remove("active");
}

startBtn.addEventListener("click", () => {
    const isOpen = startMenu.classList.toggle("active");
    startBtn.classList.toggle("active", isOpen);
});

document.addEventListener("click", (e) => {
    if (startBtn.contains(e.target) || startMenu.contains(e.target)) return;
    closeStart();
});

// CLOCK
const clock = document.querySelector(".clock p");

function updateClock() {
    const now = new Date();
    let hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";

    hours = hours % 12 || 12;

    clock.textContent = `${hours}:${minutes} ${ampm}`;
}

updateClock();
setInterval(updateClock, 1000);

// BLOG READER TOGGLE
const desktop=document.querySelector(".desktop");
const blogWin=document.querySelector(".blog");
const blogPosts=document.querySelector("#posts-list");
const readersMount=document.querySelector("#readers-mount");
let blogScroll=0;
let readers=[];

function escapeHtml(str){
    return str.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function renderPosts(posts){
    posts.forEach(post => {
        const link = document.createElement("div");
        link.className = "post-link";
        link.dataset.post = post.id;
        link.innerHTML = `<div><p>${escapeHtml(post.title)}</p><p>${escapeHtml(post.date)}</p></div><p>${escapeHtml(post.excerpt)}</p>`;
        blogPosts.appendChild(link);
    });

    posts.forEach(post => {
        const contentHtml = post.content.map(section =>
            `<span>${escapeHtml(section.heading)}</span><br>${escapeHtml(section.text).replace(/\n\n/g,"<br><br>")}`
        ).join("<br><br>");

        const reader = document.createElement("div");
        reader.className = "reader ins";
        reader.dataset.post = post.id;
        reader.innerHTML = `
            <div class="reader-back"><p>Exit Reader</p></div>
            <div class="reader-main">
                <div class="reader-brief">
                    <div><p class="reader-est">${escapeHtml(post.readTime)}</p><p class="reader-date">${escapeHtml(post.date)}</p></div>
                    <p class="reader-title">${escapeHtml(post.title)}</p>
                    <p class="reader-desc">${escapeHtml(post.desc)}</p>
                </div>
                <div class="separator"></div>
                <div class="reader-content">${contentHtml}</div>
            </div>
            <div class="reader-back b"><p>Exit Reader</p></div>`;
        readersMount.appendChild(reader);
    });

    readers = document.querySelectorAll(".reader");
}

function showReader(postId){
    blogScroll = desktop.scrollTop;
    blogPosts.classList.add("hide");
    readersMount.classList.add("active");
    readers.forEach(reader =>
        reader.classList.toggle("active", reader.dataset.post === postId)
    );

    desktop.scrollTop = blogWin.offsetTop - 8;
}

function hideReader(){
    readers.forEach(reader => reader.classList.remove("active"));
    readersMount.classList.remove("active");
    blogPosts.classList.remove("hide");
    requestAnimationFrame(() => desktop.scrollTop = blogScroll);
}

// EVENT DELEG
document.addEventListener("click", (e) => {
    const link = e.target.closest(".post-link");
    if (link) { showReader(link.dataset.post); return; }
    const backBtn = e.target.closest(".reader-back");
    if (backBtn) hideReader();
});

fetch("/api/posts")
    .then(res => res.json())
    .then(renderPosts)
    .catch(err => console.error("Failed to load posts:", err));

// THEME SWAP
const themeBtns = document.querySelectorAll(".theme .btn[data-theme]");
const THEMES = ["gray", "orange", "blue", "green", "yellow", "violet", "teal", "red"];
const THEME_KEY = "frauhns95-theme";

function setTheme(name){
    if (!THEMES.includes(name)) return;
    [...document.body.classList].forEach(c => c.startsWith("theme-") && document.body.classList.remove(c));
    document.body.classList.add(`theme-${name}`);
    themeBtns.forEach(btn => btn.classList.toggle("active", btn.dataset.theme === name));
    localStorage.setItem(THEME_KEY, name);
}

themeBtns.forEach(btn => btn.addEventListener("click", () => setTheme(btn.dataset.theme)));
// renamed themes: map old saved values to their closest replacement
const LEGACY_THEMES = { amber: "yellow", lime: "green" };
const savedTheme = localStorage.getItem(THEME_KEY);
const startTheme = LEGACY_THEMES[savedTheme] || savedTheme;
setTheme(THEMES.includes(startTheme) ? startTheme : "gray");

// MUSIC PLAYLIST
const musicTtl = document.querySelector(".track-title");
const musicArtist = document.querySelector(".track-artist");
const musicArt = document.querySelector(".album-cover");
const musicLyric = document.querySelector(".lyric-text");
const musicCount = document.querySelector(".track-count");
const queueEl = document.querySelector(".queue");
const musBackBtn = document.querySelector('[data-action="prev"]');
const musPlayBtn = document.querySelector('[data-action="play"]');
const musPlayIcon = musPlayBtn.querySelector("img");
const musNextBtn = document.querySelector('[data-action="next"]');

let lyricShown = null;
function setLyricText(text) {
    if (text === lyricShown) return;
    lyricShown = text;
    musicLyric.textContent = text;
}

let tracks = [];
let trackIndex = 0;
let isPlaying = false;

const audioEl = new Audio();
audioEl.preload = "auto";
audioEl.volume = 0.75;

const DEFAULT_PREVIEW_OFFSET = 48;
let currentPreviewOffset = DEFAULT_PREVIEW_OFFSET;
let previewOffsetOverrides = {};

const PLAYLIST_PAGE_SIZE = 15;

// tiny safe localStorage helpers (private mode / quota must never break the player)
const store = {
    get(key) {
        try { return JSON.parse(localStorage.getItem(key)); } catch (_) { return null; }
    },
    set(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
    },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fetch that always has a timeout and can be aborted from outside
async function fetchTimeout(url, ms, outerSignal) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    const onAbort = () => ctl.abort();
    if (outerSignal) {
        if (outerSignal.aborted) ctl.abort();
        else outerSignal.addEventListener("abort", onAbort, { once: true });
    }
    try {
        return await fetch(url, { signal: ctl.signal });
    } finally {
        clearTimeout(timer);
        if (outerSignal) outerSignal.removeEventListener("abort", onAbort);
    }
}

async function loadPreviewOffsets() {
    try {
        const res = await fetchTimeout("/api/offsets", 6000);
        if (!res.ok) throw new Error(`offsets ${res.status}`);
        const data = await res.json();
        previewOffsetOverrides = data && typeof data === "object" ? data : {};
        store.set("offsets:v2", previewOffsetOverrides);
    } catch (err) {
        previewOffsetOverrides = store.get("offsets:v2") || {};
        console.error("couldn't load offsets", err);
    }
}

function getPreviewOffset(track) {
    if (!track) return DEFAULT_PREVIEW_OFFSET;
    if (Object.prototype.hasOwnProperty.call(previewOffsetOverrides, track.name)) {
        const v = Number(previewOffsetOverrides[track.name]);
        if (Number.isFinite(v)) return v;
    }
    return DEFAULT_PREVIEW_OFFSET;
}

function setPlayUi(playing) {
    isPlaying = playing;
    musPlayBtn.classList.toggle("active", playing);
    musPlayIcon.src = playing ? "icons/system/pause.png" : "icons/system/play.png";
}

// ---------------------------------------------------------------
// AUDIO: per-track ladder of sources, stall watchdog, race guards
// ---------------------------------------------------------------
// rung 1: our proxy (hands it the page's preview URL as a hint)
// rung 2: our proxy, forced to re-resolve a fresh signed URL
// rung 3: Deezer's preview URL directly
const STALL_MS = 14000;
const MAX_FAIL_STREAK = 3;

let session = 0;        // bumps on every track change; stale async work compares against it
let playToken = 0;      // bumps on every play/pause request
let srcList = [];
let srcIdx = 0;
let stallTimer = null;
let failStreak = 0;

function sourcesFor(track) {
    const list = [];
    if (track.id) {
        const id = encodeURIComponent(track.id);
        const hint = track.preview ? `&hint=${encodeURIComponent(track.preview)}` : "";
        list.push(`/api/preview?id=${id}${hint}`);
        list.push(`/api/preview?id=${id}&refresh=1&_=${Date.now()}`);
    }
    if (track.preview) list.push(track.preview);
    return list;
}

function clearStall() {
    clearTimeout(stallTimer);
    stallTimer = null;
}

function armStall() {
    clearStall();
    const mine = session;
    stallTimer = setTimeout(() => {
        if (mine === session && audioEl.readyState < 2) advanceSource("stalled");
    }, STALL_MS);
}

function loadCurrentSource() {
    audioEl.src = srcList[srcIdx];
    audioEl.load();
    armStall();
}

function advanceSource(reason) {
    clearStall();
    console.warn(`audio source ${srcIdx + 1}/${srcList.length} failed (${reason})`, audioEl.error || "");
    if (srcIdx + 1 < srcList.length) {
        srcIdx++;
        loadCurrentSource();
        if (isPlaying) startPlayback();
        return;
    }
    trackFailed();
}

function trackFailed() {
    clearStall();
    failStreak++;
    if (isPlaying && failStreak < MAX_FAIL_STREAK && tracks.length > 1) {
        showTrack(trackIndex + 1);
    } else {
        setPlayUi(false);
        failStreak = 0;
        setLyricText("couldn't play this track, try another");
    }
}

async function startPlayback() {
    const token = ++playToken;
    const mine = session;
    try {
        await audioEl.play();
        if (token === playToken && mine === session) failStreak = 0;
    } catch (err) {
        // superseded by a newer play/pause/track change
        if (err?.name === "AbortError" || token !== playToken || mine !== session) return;
        console.error("Audio playback failed:", err);
        // browser wants a user gesture; real media failures arrive via the "error" event / stall watchdog
        if (err?.name === "NotAllowedError") setPlayUi(false);
    }
}

function setPlaying(state) {
    if (!state) {
        playToken++;
        setPlayUi(false);
        audioEl.pause();
        return;
    }
    if (!srcList.length) return;
    setPlayUi(true); // update UI immediately; don't wait on the network
    startPlayback();
}

audioEl.addEventListener("playing", () => { clearStall(); failStreak = 0; });
audioEl.addEventListener("canplay", clearStall);
audioEl.addEventListener("loadeddata", clearStall);

audioEl.addEventListener("error", () => {
    if (!audioEl.getAttribute("src")) return; // fired by clearing the source, not a real failure
    advanceSource("media error");
});

audioEl.addEventListener("timeupdate", () => {
    updateLyricForTime(audioEl.currentTime + currentPreviewOffset);
});

audioEl.addEventListener("ended", () => {
    // showTrack already resumes playback when isPlaying
    showTrack(trackIndex + 1);
});

// ---------------------------------------------------------------
// QUEUE / TRACK UI
// ---------------------------------------------------------------
function updateQueuePage() {
    const page = Math.floor(trackIndex / PLAYLIST_PAGE_SIZE);
    const start = page * PLAYLIST_PAGE_SIZE;
    const end = start + PLAYLIST_PAGE_SIZE;

    queueEl.querySelectorAll("p").forEach((p, i) => {
        p.style.display = (i >= start && i < end) ? "" : "none";
        p.classList.toggle("active", i === trackIndex);
    });
}

function updateMusicCount() {
    if (!tracks.length) return;
    const current = String(trackIndex + 1).padStart(2, "0");
    const total = String(tracks.length).padStart(2, "0");
    musicCount.textContent = `${current} of ${total}`;
}

function showTrack(index) {
    if (!tracks.length) return;
    trackIndex = (index + tracks.length) % tracks.length;
    const track = tracks[trackIndex];

    session++;
    clearStall();

    musicTtl.textContent = track.name;
    musicArtist.textContent = track.artist;
    musicArt.src = track.cover;

    audioEl.pause();
    srcList = sourcesFor(track);
    srcIdx = 0;

    if (srcList.length) {
        loadCurrentSource();
    } else {
        audioEl.removeAttribute("src");
        audioEl.load();
    }

    updateQueuePage();
    updateMusicCount();

    loadLyrics(track);

    if (!srcList.length) {
        trackFailed();
        return;
    }
    if (isPlaying) startPlayback();
    else setPlayUi(false);
}

function renderQueue() {
    queueEl.innerHTML = "";
    tracks.forEach((track, i) => {
        const p = document.createElement("p");
        p.textContent = `${i + 1}. ${track.name} by ${track.artist}`;
        p.addEventListener("click", () => showTrack(i));
        queueEl.appendChild(p);
    });
    updateQueuePage();
}

// ---------------------------------------------------------------
// LYRICS
// ---------------------------------------------------------------
// Parsing and matching live in /lib/lyrics-match.js, the same file the server uses.
let matchLib = null;
function getMatchLib() {
    if (!matchLib) matchLib = import("/lib/lyrics-match.js").catch((err) => { matchLib = null; throw err; });
    return matchLib;
}

let lyricLines = [];
let lyricsToken = 0;
let lyricsAbort = null;
let lyricsState = "idle"; // idle | loading | ready | none | error

const LYRIC_CACHE_INDEX = "lyrics:index:v2";
const LYRIC_CACHE_MAX = 80;

function lyricCacheKey(track) {
    return `lyrics:v2:${track.id || `${track.artist}|${track.name}`}`;
}

function lyricCacheGet(track) {
    const hit = store.get(lyricCacheKey(track));
    return hit && (hit.lrc || hit.plain || hit.instrumental) ? hit : null;
}

function lyricCachePut(track, value) {
    const key = lyricCacheKey(track);
    store.set(key, value);
    const index = (store.get(LYRIC_CACHE_INDEX) || []).filter((k) => k !== key);
    index.push(key);
    while (index.length > LYRIC_CACHE_MAX) {
        try { localStorage.removeItem(index.shift()); } catch (_) {}
    }
    store.set(LYRIC_CACHE_INDEX, index);
}

// Ask our own API. Returns { lrc } | { instrumental } | { none } | { retry }
async function lyricsFromServer(track, signal) {
    const qs = new URLSearchParams({ artist: track.artist, title: track.name });
    if (track.album) qs.set("album", track.album);
    if (track.duration) qs.set("duration", String(track.duration));

    let res;
    try {
        res = await fetchTimeout(`/api/lyrics?${qs}`, 20000, signal);
    } catch (err) {
        if (signal.aborted) throw err;
        return { retry: true };
    }

    let data = null;
    try { data = await res.json(); } catch (_) {}

    if (res.ok && data?.syncedLyrics) return { lrc: data.syncedLyrics };
    if (res.ok && data?.plainLyrics) return { plain: data.plainLyrics };
    if (res.ok && data?.instrumental) return { instrumental: true };
    if (res.status === 404 && data?.notFound) return { none: true };
    return { retry: true }; // 5xx, 503 retryable, HTML error page, anything unexpected
}

// Same lookup straight from the browser. Covers the case where lrclib blocks / rate-limits our server's IP.
async function lyricsFromBrowser(track, signal) {
    let lib;
    try { lib = await getMatchLib(); } catch (_) { return { retry: true }; }

    const urls = [
        `https://lrclib.net/api/search?${new URLSearchParams({ q: `${lib.primaryArtist(track.artist)} ${lib.cleanTitle(track.name)}` })}`,
        `https://lrclib.net/api/search?${new URLSearchParams({ track_name: track.name, artist_name: track.artist })}`,
    ];

    let failed = false;
    const pool = [];
    await Promise.all(urls.map(async (u) => {
        try {
            const res = await fetchTimeout(u, 9000, signal);
            if (res.status === 404) return;
            if (!res.ok) { failed = true; return; }
            const data = await res.json();
            if (Array.isArray(data)) pool.push(...data);
        } catch (err) {
            if (signal.aborted) throw err;
            failed = true;
        }
    }));

    const best = lib.pickBest(pool, { artist: track.artist, title: track.name, duration: track.duration });
    if (best) return best.synced ? { lrc: best.record.syncedLyrics } : { plain: best.record.plainLyrics };
    return failed ? { retry: true } : { none: true };
}

function showLyricsError(track) {
    lyricsState = "error";
    setLyricText("lyrics didn't load, tap to retry");
}

async function loadLyrics(track) {
    const myToken = ++lyricsToken;
    if (lyricsAbort) lyricsAbort.abort();
    const abort = (lyricsAbort = new AbortController());

    lyricLines = [];
    lyricsState = "loading";
    currentPreviewOffset = getPreviewOffset(track);

    const apply = async (value) => {
        const lib = await getMatchLib(); // throws if the module can't load -> error state, not "no lyrics"
        const lines = value.plain ? lib.spreadPlain(value.plain, track.duration) : lib.parseLrc(value.lrc);
        if (myToken !== lyricsToken) return true;
        if (!lines.length) return false;
        lyricLines = lines;
        lyricsState = "ready";
        lyricShown = null;
        updateLyricForTime(audioEl.currentTime + currentPreviewOffset);
        return true;
    };

    const cached = lyricCacheGet(track);
    if (cached?.instrumental) {
        lyricsState = "none";
        setLyricText("♪ instrumental ♪");
        return;
    }
    if (cached?.lrc || cached?.plain) {
        try { if (await apply(cached)) return; } catch (_) {}
    }

    setLyricText("looking for lyrics...");

    try {
        const delays = [0, 900, 2500, 5000];
        for (let attempt = 0; attempt < delays.length; attempt++) {
            if (delays[attempt]) await sleep(delays[attempt]);
            if (myToken !== lyricsToken) return;

            let out = await lyricsFromServer(track, abort.signal);
            if (myToken !== lyricsToken) return;

            // our server could not get an answer from lrclib: ask lrclib straight from this browser
            if (out.retry && attempt >= 1) {
                out = await lyricsFromBrowser(track, abort.signal);
                if (myToken !== lyricsToken) return;
            }

            if (out.instrumental) {
                lyricCachePut(track, { instrumental: true });
                lyricsState = "none";
                setLyricText("♪ instrumental ♪");
                return;
            }
            if (out.lrc || out.plain) {
                if (await apply(out)) {
                    if (myToken === lyricsToken) lyricCachePut(track, out.lrc ? { lrc: out.lrc } : { plain: out.plain });
                    return;
                }
                out = { none: true }; // unusable payload: behaves like "no lyrics"
            }
            if (out.none) {
                lyricsState = "none";
                setLyricText("no lyrics yet");
                return;
            }
            // out.retry -> loop again
        }
        showLyricsError(track); // only reached after every attempt genuinely failed
    } catch (err) {
        if (myToken !== lyricsToken || abort.signal.aborted) return;
        console.error(err);
        showLyricsError(track);
    }
}

musicLyric.addEventListener("click", () => {
    if (lyricsState === "error" && tracks[trackIndex]) loadLyrics(tracks[trackIndex]);
});

function updateLyricForTime(currentTime) {
    if (!lyricLines.length) return;

    // binary search: last line whose time <= currentTime
    let lo = 0;
    let hi = lyricLines.length - 1;
    let idx = 0;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (lyricLines[mid].time <= currentTime) { idx = mid; lo = mid + 1; }
        else hi = mid - 1;
    }
    setLyricText(lyricLines[idx].text);
}

// ---------------------------------------------------------------
// PLAYLIST LOADING
// ---------------------------------------------------------------
const PLAYLIST_CACHE_KEY = "playlist:v2";

async function fetchPlaylistWithRetry() {
    const delays = [0, 600, 1800];
    let lastErr;
    for (const d of delays) {
        if (d) await sleep(d);
        try {
            const res = await fetchTimeout("/api/playlist", 15000);
            if (!res.ok) throw new Error(`playlist ${res.status}`);
            const data = await res.json();
            if (Array.isArray(data?.tracks) && data.tracks.length) return data.tracks;
            throw new Error("empty playlist");
        } catch (err) {
            lastErr = err;
        }
    }
    throw lastErr;
}

let playlistLoading = false;
async function loadPlaylist() {
    if (playlistLoading) return;
    playlistLoading = true;
    queueEl.innerHTML = "<p>loading tracks...</p>";

    try {
        let list;
        try {
            list = await fetchPlaylistWithRetry();
            store.set(PLAYLIST_CACHE_KEY, list);
        } catch (err) {
            console.error(err);
            list = store.get(PLAYLIST_CACHE_KEY); // last good copy; audio is resolved by id server-side anyway
            if (!Array.isArray(list) || !list.length) throw err;
        }

        tracks = list;
        renderQueue();
        showTrack(Math.floor(Math.random() * tracks.length));
    } catch (err) {
        queueEl.innerHTML = "";
        const p = document.createElement("p");
        p.textContent = "couldn't load playlist. click to retry.";
        p.style.cursor = "pointer";
        p.addEventListener("click", loadPlaylist);
        queueEl.appendChild(p);
    } finally {
        playlistLoading = false;
    }
}

//STOP PLAYBACK ON CLOSE
document.addEventListener("wm:closed", (e) => {
    if (e.detail.app === "playlist" && isPlaying) setPlaying(false);
});

musBackBtn.addEventListener("click", () => showTrack(trackIndex - 1));
musNextBtn.addEventListener("click", () => showTrack(trackIndex + 1));
musPlayBtn.addEventListener("click", () => setPlaying(!isPlaying));

// coming back online: retry whatever was stuck
window.addEventListener("online", () => {
    if (!tracks.length) loadPlaylist();
    else if (lyricsState === "error" && tracks[trackIndex]) loadLyrics(tracks[trackIndex]);
});

loadPreviewOffsets().then(loadPlaylist);
