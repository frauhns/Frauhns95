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
const THEMES = ["gray", "pink", "blue", "green", "amber", "violet", "brown", "red"];
const THEME_KEY = "frauhns95-theme";

function setTheme(name){
    if (!THEMES.includes(name)) return;
    [...document.body.classList].forEach(c => c.startsWith("theme-") && document.body.classList.remove(c));
    document.body.classList.add(`theme-${name}`);
    themeBtns.forEach(btn => btn.classList.toggle("active", btn.dataset.theme === name));
    localStorage.setItem(THEME_KEY, name);
}

themeBtns.forEach(btn => btn.addEventListener("click", () => setTheme(btn.dataset.theme)));
setTheme(localStorage.getItem(THEME_KEY) || "gray");

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

function setLyricText(text) {
    musicLyric.textContent = text;
}

let tracks = [];
let trackIndex = 0;
let isPlaying = false;

let lyricLines = [];
const audioEl = new Audio();
audioEl.volume = 0.75;

const DEFAULT_PREVIEW_OFFSET = 48;
let currentPreviewOffset = DEFAULT_PREVIEW_OFFSET;
let previewOffsetOverrides = {};

const PLAYLIST_PAGE_SIZE = 15;

async function loadPreviewOffsets() {
    try {
        const res = await fetch("/api/offsets");
        if (!res.ok) throw new Error(`offsets ${res.status}`);
        previewOffsetOverrides = await res.json();
    } catch (err) {
        previewOffsetOverrides = {};
        console.error("couldn't load offsets", err);
    }
}

function getPreviewOffset(track) {
    if (!track) return DEFAULT_PREVIEW_OFFSET;
    if (Object.prototype.hasOwnProperty.call(previewOffsetOverrides, track.name)) {
        return previewOffsetOverrides[track.name];
    }
    return DEFAULT_PREVIEW_OFFSET;
}

function setPlayUi(playing) {
    isPlaying = playing;
    musPlayBtn.classList.toggle("active", playing);
    musPlayIcon.src = playing ? "icons/system/pause.png" : "icons/system/play.png";
}

let playToken = 0;
let failStreak = 0;
let triedDirect = false;

async function setPlaying(state) {
    const token = ++playToken;

    if (!state) {
        setPlayUi(false);
        audioEl.pause();
        return;
    }

    if (!audioEl.src) return;

    // optimistic UI: don't wait on network
    setPlayUi(true);

    try {
        await audioEl.play();
        if (token === playToken) failStreak = 0;
    } catch (err) {
        // superseded by newer play/pause/track change
        if (err && err.name === "AbortError") return;
        if (token !== playToken) return;
        console.error("Audio playback failed:", {
            error: err,
            src: audioEl.currentSrc,
            networkState: audioEl.networkState,
            readyState: audioEl.readyState,
            mediaError: audioEl.error,
        });
        // autoplay block etc: revert. Media errors handled by "error" listener.
        if (err && err.name === "NotAllowedError") setPlayUi(false);
    }
}

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

    musicTtl.textContent = track.name;
    musicArtist.textContent = track.artist;
    musicArt.src = track.cover;

    triedDirect = false;
    audioEl.pause();
    audioEl.src = track.id
        ? `/api/preview?id=${encodeURIComponent(track.id)}`
        : track.preview || "";
    audioEl.load();

    updateQueuePage();
    updateMusicCount();

    loadLyrics(track);

    if (isPlaying) {
        setPlaying(true);
    } else {
        setPlayUi(false);
    }
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

// LYRICS
function parseLrc(lrcText) {
    const lines = lrcText.split("\n");
    const parsed = [];

    for (const line of lines) {
        const match = line.match(/\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\](.*)/);
        if (!match) continue;

        const minutes = parseInt(match[1], 10);
        const seconds = parseInt(match[2], 10);
        const ms = match[3] ? parseInt(match[3].padEnd(3, "0"), 10) : 0;
        const time = minutes * 60 + seconds + ms / 1000;
        const text = match[4].trim().toLowerCase();

        if (text) parsed.push({ time, text });
    }

    return parsed;
}

let lyricsToken = 0;

async function loadLyrics(track) {
    const myToken = ++lyricsToken;
    lyricLines = [];
    currentPreviewOffset = getPreviewOffset(track);
    setLyricText("looking for lyrics...");

    try {
        const durationParam = track.duration ? `&duration=${encodeURIComponent(track.duration)}` : "";
        const res = await fetch(`/api/lyrics?artist=${encodeURIComponent(track.artist)}&title=${encodeURIComponent(track.name)}${durationParam}`);
        const data = await res.json();
        if (myToken !== lyricsToken) return;

        if (!data.syncedLyrics) {
            setLyricText("no lyrics yet");
            return;
        }

        lyricLines = parseLrc(data.syncedLyrics);

        if (!lyricLines.length) {
            setLyricText("no lyrics yet");
            return;
        }

        updateLyricForTime(currentPreviewOffset);
    } catch (err) {
        if (myToken !== lyricsToken) return;
        setLyricText("lyrics didn't load, try again later");
        console.error(err);
    }
}

function updateLyricForTime(currentTime) {
    if (!lyricLines.length) return;

    let activeLine = lyricLines[0];
    for (const line of lyricLines) {
        if (line.time <= currentTime) {
            activeLine = line;
        } else {
            break;
        }
    }
    setLyricText(activeLine.text);
}

async function loadPlaylist() {
    try {
        const res = await fetch("/api/playlist");
        if (!res.ok) throw new Error(`playlist ${res.status}`);
        const data = await res.json();
        tracks = data.tracks;

        if (!tracks || !tracks.length) {
            queueEl.innerHTML = "<p>no tracks found.</p>";
            return;
        }

        renderQueue();

        const randomIndex = Math.floor(Math.random() * tracks.length);
        showTrack(randomIndex);

    } catch (err) {
        queueEl.innerHTML = "<p>couldn't load playlist.</p>";
        console.error(err);
    }
}

//STOP PLAYBACK ON CLOSE
document.addEventListener("wm:closed", (e) => {
    if (e.detail.app === "playlist" && isPlaying) setPlaying(false);
});

musBackBtn.addEventListener("click", () => showTrack(trackIndex - 1));
musNextBtn.addEventListener("click", () => showTrack(trackIndex + 1));
musPlayBtn.addEventListener("click", () => setPlaying(!isPlaying));

audioEl.addEventListener("timeupdate", () => {
    updateLyricForTime(audioEl.currentTime + currentPreviewOffset);
});

audioEl.addEventListener("error", () => {
    console.error("Audio element error:", {
        src: audioEl.currentSrc,
        networkState: audioEl.networkState,
        readyState: audioEl.readyState,
        mediaError: audioEl.error,
    });

    const track = tracks[trackIndex];
    if (!track || !audioEl.src) return;

    // 1st: fall back to direct Deezer preview URL
    if (!triedDirect && track.preview && !audioEl.src.endsWith(track.preview)) {
        triedDirect = true;
        audioEl.src = track.preview;
        audioEl.load();
        if (isPlaying) setPlaying(true);
        return;
    }

    // 2nd: skip to next track while playing, bail after 3 straight fails
    failStreak++;
    if (isPlaying && failStreak < 3 && tracks.length > 1) {
        showTrack(trackIndex + 1);
    } else {
        setPlayUi(false);
        failStreak = 0;
        setLyricText("couldn't play this track, try another");
    }
});

audioEl.addEventListener("ended", () => {
    // showTrack already resumes playback when isPlaying
    showTrack(trackIndex + 1);
});

loadPreviewOffsets().then(loadPlaylist);
