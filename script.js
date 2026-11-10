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
// OLD THEME NAMES -> NEW
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

const PLAYLIST_ID = "15656484663";
const PLAYLIST_PAGE_SIZE = 15;
const DEFAULT_PREVIEW_OFFSET = 48;

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

let currentPreviewOffset = DEFAULT_PREVIEW_OFFSET;
let previewOffsetOverrides = {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// FETCH WITH TIMEOUT + OUTER ABORT
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

// OFFSETS (FROM KV)
async function loadPreviewOffsets() {
    try {
        const res = await fetchTimeout("/api/offsets", 6000);
        if (!res.ok) throw new Error(`offsets ${res.status}`);
        const data = await res.json();
        previewOffsetOverrides = data && typeof data === "object" ? data : {};
    } catch (err) {
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

// DEEZER (BROWSER JSONP, API HAS NO CORS, USES VISITOR IP)
function deezerJsonp(path, ms = 8000) {
    return new Promise((resolve) => {
        const cb = `dz_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
        const el = document.createElement("script");
        const done = (v) => { clearTimeout(t); delete window[cb]; el.remove(); resolve(v); };
        const t = setTimeout(() => done(null), ms);
        window[cb] = (d) => done(d && !d.error ? d : null);
        el.onerror = () => done(null);
        el.src = `https://api.deezer.com${path}${path.includes("?") ? "&" : "?"}output=jsonp&callback=${cb}`;
        document.head.appendChild(el);
    });
}

// AUDIO SOURCES: TRIED IN ORDER, STALL WATCHDOG
// 1 FRESH URL FROM DEEZER, 2 URL FROM PLAYLIST, 3-4 SERVER PROXY BACKUP
const STALL_MS = 14000;
const MAX_FAIL_STREAK = 3;
const RESOLVE = "resolve:deezer";

let session = 0;        // BUMPS ON TRACK CHANGE
let playToken = 0;      // BUMPS ON PLAY/PAUSE
let srcList = [];
let srcIdx = 0;
let stallTimer = null;
let failStreak = 0;

function sourcesFor(track) {
    const list = [];
    if (track.id) list.push(RESOLVE);
    if (track.preview) list.push(track.preview);
    if (track.id) {
        const id = encodeURIComponent(track.id);
        const hint = track.preview ? `&hint=${encodeURIComponent(track.preview)}` : "";
        list.push(`/api/preview?id=${id}${hint}`);
        list.push(`/api/preview?id=${id}&refresh=1&_=${Date.now()}`);
    }
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
    const src = srcList[srcIdx];
    if (src === RESOLVE) {
        const mine = session;
        const myIdx = srcIdx;
        const track = tracks[trackIndex];
        armStall();
        deezerJsonp(`/track/${encodeURIComponent(track.id)}`).then((d) => {
            if (mine !== session || myIdx !== srcIdx) return;
            if (!d?.preview) { advanceSource("browser resolve failed"); return; }
            audioEl.src = d.preview;
            audioEl.load();
            armStall();
            if (isPlaying) startPlayback();
        });
        return;
    }
    audioEl.src = src;
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
        const mine = session;
        setTimeout(() => { if (mine === session && isPlaying) showTrack(trackIndex + 1); }, 1500);
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
        // SUPERSEDED BY NEWER PLAY/PAUSE/TRACK
        if (err?.name === "AbortError" || token !== playToken || mine !== session) return;
        console.error("Audio playback failed:", err);
        // NEEDS USER GESTURE
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
    setPlayUi(true);
    startPlayback();
}

audioEl.addEventListener("playing", () => { clearStall(); failStreak = 0; });
audioEl.addEventListener("canplay", clearStall);
audioEl.addEventListener("loadeddata", clearStall);

audioEl.addEventListener("error", () => {
    // IGNORE SRC CLEAR
    if (!audioEl.getAttribute("src")) return;
    advanceSource("media error");
});

audioEl.addEventListener("timeupdate", () => {
    updateLyricForTime(audioEl.currentTime + currentPreviewOffset);
});

// SHOWTRACK RESUMES PLAYBACK
audioEl.addEventListener("ended", () => showTrack(trackIndex + 1));

// QUEUE / TRACK UI
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

// LYRICS (BROWSER -> LRCLIB, HAS CORS)
const LRCLIB = "https://lrclib.net/api";
const LYRIC_DELAYS = [0, 900, 2500, 5000];

let matchLib = null;
function getMatchLib() {
    if (!matchLib) matchLib = import("/lib/lyrics-match.js").catch((err) => { matchLib = null; throw err; });
    return matchLib;
}

let lyricLines = [];
let lyricsToken = 0;
let lyricsAbort = null;
let lyricsState = "idle"; // idle | loading | ready | none | error

// ONE LRCLIB CALL, NEVER THROWS EXCEPT ON ABORT. TRANSIENT = NO REAL ANSWER
async function lrc(path, params, signal) {
    try {
        const res = await fetchTimeout(`${LRCLIB}/${path}?${new URLSearchParams(params)}`, 9000, signal);
        if (res.status === 404) return { data: [], transient: false };
        if (res.ok) return { data: [].concat(await res.json()), transient: false };
        return { data: [], transient: res.status >= 500 || res.status === 429 };
    } catch (err) {
        if (signal.aborted) throw err;
        return { data: [], transient: true };
    }
}

// RETURNS { lrc } | { plain } | { instrumental } | { none } | { retry }
async function lyricsFromLrclib(track, signal) {
    const lib = await getMatchLib();
    const want = { artist: track.artist, title: track.name, duration: track.duration };
    const dur = track.duration ? { duration: String(Math.round(track.duration)) } : null;
    const pool = [];
    let transient = false;

    const run = async (jobs) => {
        for (const r of await Promise.all(jobs)) {
            if (r.transient) transient = true;
            pool.push(...r.data);
        }
        return lib.pickBest(pool, want);
    };

    const cTitle = lib.cleanTitle(track.name);
    const pArtist = lib.primaryArtist(track.artist);

    // STAGE 1: LIKELY HITS
    const stage1 = [
        lrc("search", { track_name: track.name, artist_name: track.artist }, signal),
        lrc("search", { q: `${pArtist} ${cTitle}` }, signal),
    ];
    if (dur) {
        stage1.push(lrc("get", {
            track_name: track.name,
            artist_name: track.artist,
            ...(track.album ? { album_name: track.album } : {}),
            ...dur,
        }, signal));
    }
    let best = await run(stage1);

    // STAGE 2: LOOSER VARIANTS
    if (!best) {
        const jobs = [];
        const seen = new Set();
        for (const t of lib.titleVariants(track.name)) {
            for (const a of lib.artistVariants(track.artist)) {
                const key = `${lib.fold(t)}|${lib.fold(a)}`;
                if (seen.has(key)) continue;
                seen.add(key);
                jobs.push(lrc("search", { track_name: t, artist_name: a }, signal));
            }
        }
        jobs.push(lrc("search", { track_name: cTitle }, signal));
        jobs.push(lrc("search", { q: cTitle }, signal));
        if (dur) jobs.push(lrc("get", { track_name: cTitle, artist_name: pArtist, ...dur }, signal));
        best = await run(jobs.slice(0, 8));
    }

    if (best) return best.synced ? { lrc: best.record.syncedLyrics } : { plain: best.record.plainLyrics };

    const instrumental = pool.some(
        (r) => r && r.instrumental === true
            && lib.titleScore(track.name, r.trackName ?? r.name) >= 0.85
            && lib.artistScore(track.artist, r.artistName) >= 0.5
    );
    if (instrumental) return { instrumental: true };
    return transient ? { retry: true } : { none: true };
}

function showLyricsError() {
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
    setLyricText("looking for lyrics...");

    try {
        const lib = await getMatchLib();

        for (let attempt = 0; attempt < LYRIC_DELAYS.length; attempt++) {
            if (LYRIC_DELAYS[attempt]) await sleep(LYRIC_DELAYS[attempt]);
            if (myToken !== lyricsToken) return;

            const out = await lyricsFromLrclib(track, abort.signal);
            if (myToken !== lyricsToken) return;

            if (out.instrumental) {
                lyricsState = "none";
                setLyricText("♪ instrumental ♪");
                return;
            }
            if (out.lrc || out.plain) {
                const lines = out.plain ? lib.spreadPlain(out.plain, track.duration) : lib.parseLrc(out.lrc);
                if (lines.length) {
                    lyricLines = lines;
                    lyricsState = "ready";
                    lyricShown = null;
                    updateLyricForTime(audioEl.currentTime + currentPreviewOffset);
                    return;
                }
                out.none = true;
            }
            if (out.none) {
                lyricsState = "none";
                setLyricText("no lyrics yet");
                return;
            }
            // RETRY -> LOOP
        }
        showLyricsError();
    } catch (err) {
        if (myToken !== lyricsToken || abort.signal.aborted) return;
        console.error(err);
        showLyricsError();
    }
}

musicLyric.addEventListener("click", () => {
    if (lyricsState === "error" && tracks[trackIndex]) loadLyrics(tracks[trackIndex]);
});

function updateLyricForTime(currentTime) {
    if (!lyricLines.length) return;

    // BINARY SEARCH: LAST LINE <= CURRENT TIME
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

// PLAYLIST LOADING (BROWSER -> DEEZER)
function mapTrack(t) {
    return {
        id: t.id,
        name: t.title,
        artist: t.artist?.name ?? "",
        album: t.album?.title ?? "",
        cover: t.album?.cover_medium ?? t.album?.cover_big ?? t.album?.cover ?? "",
        preview: t.preview || "",
        duration: t.duration,
    };
}

async function fetchPlaylistOnce() {
    const pl = await deezerJsonp(`/playlist/${PLAYLIST_ID}`, 10000);
    if (!pl) throw new Error("playlist unreachable");

    const all = Array.isArray(pl.tracks?.data) ? [...pl.tracks.data] : [];
    const total = Number(pl.nb_tracks) || all.length;

    // EMBEDDED LIST CAN BE TRUNCATED, PAGE THE REST
    for (let guard = 0; all.length < total && guard < 20; guard++) {
        const page = await deezerJsonp(`/playlist/${PLAYLIST_ID}/tracks?index=${all.length}&limit=100`, 10000);
        if (!Array.isArray(page?.data) || !page.data.length) break;
        all.push(...page.data);
    }

    const seen = new Set();
    const list = all.filter((t) => t && t.id && !seen.has(t.id) && seen.add(t.id)).map(mapTrack);
    if (!list.length) throw new Error("empty playlist");
    return list;
}

async function fetchPlaylistWithRetry() {
    const delays = [0, 600, 1800];
    let lastErr;
    for (const d of delays) {
        if (d) await sleep(d);
        try {
            return await fetchPlaylistOnce();
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
        tracks = await fetchPlaylistWithRetry();
        renderQueue();
        showTrack(Math.floor(Math.random() * tracks.length));
    } catch (err) {
        console.error(err);
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

// STOP PLAYBACK ON CLOSE
document.addEventListener("wm:closed", (e) => {
    if (e.detail.app === "playlist" && isPlaying) setPlaying(false);
});

musBackBtn.addEventListener("click", () => showTrack(trackIndex - 1));
musNextBtn.addEventListener("click", () => showTrack(trackIndex + 1));
musPlayBtn.addEventListener("click", () => setPlaying(!isPlaying));

// BACK ONLINE: RETRY STUCK LOAD
window.addEventListener("online", () => {
    if (!tracks.length) loadPlaylist();
    else if (lyricsState === "error" && tracks[trackIndex]) loadLyrics(tracks[trackIndex]);
});

loadPreviewOffsets().then(loadPlaylist);
