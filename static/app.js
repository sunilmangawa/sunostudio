// Shared shell behaviour: toasts, modal, sidebar, share, and real audio playback.
(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const Cadence = { $, $$, authenticated: document.body.dataset.authenticated === "true" };

  function readCookie(name) {
    return document.cookie.split(";").map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.split("=").slice(1).join("=") || "";
  }
  const csrfToken = $("[name=csrfmiddlewaretoken]")?.value || readCookie("csrftoken");
  Cadence.csrf = csrfToken;

  Cadence.api = async function api(path, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (csrfToken) headers["X-CSRFToken"] = csrfToken;
    const response = await fetch(`/api/${path}`, { credentials: "same-origin", ...options, headers });
    if (response.status === 401 || response.status === 403) throw new Error("Sign in to use your private library.");
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || Object.values(body).flat().join(" ") || `Request failed (${response.status})`);
    }
    if (response.status === 204) return null;
    return response.json();
  };

  let toastTimer;
  Cadence.toast = function toast(message) {
    const element = $("#toast");
    if (!element) return;
    element.textContent = message;
    element.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove("visible"), 3200);
  };

  Cadence.openModal = function openModal(title, copy, href) {
    $("#modal-title").textContent = title;
    $("#modal-copy").textContent = copy;
    if (href) $("#modal-link").href = href;
    $("#modal-backdrop").hidden = false;
  };
  Cadence.closeModal = () => { $("#modal-backdrop").hidden = true; };

  /* ---------- audio playback ---------- */
  const audio = $("#cadence-audio");
  const timeLabel = $("#global-time");
  const durationLabel = $("#global-duration");
  const progress = $("#global-progress");
  const playButton = $("#global-play");
  const volume = $("#global-volume");
  const muteButton = $("#mute-btn");

  const format = seconds => {
    if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
    return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  };
  const showTrack = track => {
    const title = $("#now-title");
    if (title) title.textContent = track.title || "Untitled";
    const sub = $("#now-sub");
    if (sub) sub.textContent = track.subtitle || "Cadence";
  };

  const player = {
    queue: [],
    index: -1,
    repeat: "off",
    shuffle: false,
    current: null,
    play(track, queue) {
      if (!track?.url) {
        Cadence.toast("This item has no audio file attached yet.");
        return false;
      }
      if (Array.isArray(queue) && queue.length) {
        player.queue = queue;
        player.index = Math.max(0, queue.findIndex(item => item.url === track.url));
      } else if (!player.queue.some(item => item.url === track.url)) {
        player.queue = [track];
        player.index = 0;
      }
      player.current = track;
      if (audio.getAttribute("src") === track.url) {
        audio.play().catch(() => Cadence.toast("Press play once more to allow audio in this browser."));
        return true;
      }
      audio.src = track.url;
      showTrack(track);
      audio.load();
      const attempt = audio.play();
      if (attempt?.catch) attempt.catch(() => Cadence.toast("Press play once more to allow audio in this browser."));
      return true;
    },
    toggle() {
      if (!player.current) {
        if (player.queue.length) player.play(player.queue[0]);
        else Cadence.toast("Pick a track or a clip to start playback.");
        return;
      }
      if (audio.paused) audio.play().catch(() => Cadence.toast("Playback was blocked by the browser."));
      else audio.pause();
    },
    pause() { audio.pause(); },
    stop() {
      audio.pause();
      audio.currentTime = 0;
    },
    next() {
      if (!player.queue.length) return;
      player.index = player.shuffle
        ? Math.floor(Math.random() * player.queue.length)
        : (player.index + 1) % player.queue.length;
      const track = player.queue[player.index];
      player.current = track;
      audio.src = track.url;
      showTrack(track);
      audio.play().catch(() => {});
    },
    previous() {
      if (!player.queue.length) return;
      if (audio.currentTime > 3) { audio.currentTime = 0; return; }
      player.index = (player.index - 1 + player.queue.length) % player.queue.length;
      const track = player.queue[player.index];
      player.current = track;
      audio.src = track.url;
      showTrack(track);
      audio.play().catch(() => {});
    },
    setQueue(queue) {
      player.queue = Array.isArray(queue) ? queue.filter(item => item?.url) : [];
      player.index = Math.max(0, player.queue.findIndex(item => item.url === player.current?.url));
    }
  };
  Cadence.player = player;
  Cadence.playTrack = track => player.play(track);

  // Kept for pages that only relabel the bar; playback always goes through the player.
  Cadence.nowPlaying = function nowPlaying(title, subtitle) {
    if ($("#now-title")) $("#now-title").textContent = title;
    if ($("#now-sub")) $("#now-sub").textContent = subtitle || "Cadence";
  };

  audio?.addEventListener("loadedmetadata", () => {
    if (progress) { progress.max = String(Math.floor(audio.duration) || 0); progress.disabled = false; }
    if (durationLabel) durationLabel.textContent = format(audio.duration);
  });
  audio?.addEventListener("timeupdate", () => {
    if (timeLabel) timeLabel.textContent = format(audio.currentTime);
    if (progress) progress.value = String(Math.floor(audio.currentTime));
  });
  audio?.addEventListener("play", () => {
    if (playButton) { playButton.textContent = "Ⅱ"; playButton.setAttribute("aria-label", "Pause"); }
  });
  audio?.addEventListener("pause", () => {
    if (playButton) { playButton.textContent = "▶"; playButton.setAttribute("aria-label", "Play"); }
  });
  audio?.addEventListener("ended", () => {
    if (player.repeat === "one") { audio.currentTime = 0; audio.play().catch(() => {}); return; }
    const last = !player.shuffle && player.index >= player.queue.length - 1;
    if (player.repeat !== "all" && last) {
      player.index = -1;
      if (playButton) playButton.textContent = "▶";
      return;
    }
    player.next();
  });
  audio?.addEventListener("error", () => {
    if (!audio.getAttribute("src")) return;
    Cadence.toast("That audio file could not be loaded. Try generating the clip again.");
  });

  playButton?.addEventListener("click", () => player.toggle());
  $("#prev-btn")?.addEventListener("click", () => player.previous());
  $("#next-btn")?.addEventListener("click", () => player.next());
  progress?.addEventListener("input", event => {
    if (!Number.isFinite(audio.duration)) return;
    audio.currentTime = Number(event.target.value);
  });
  $("#shuffle-btn")?.addEventListener("click", event => {
    const on = event.currentTarget.getAttribute("aria-pressed") !== "true";
    event.currentTarget.setAttribute("aria-pressed", String(on));
    event.currentTarget.classList.toggle("engaged", on);
    player.shuffle = on;
  });
  $("#repeat-btn")?.addEventListener("click", event => {
    const modes = ["off", "all", "one"];
    const current = event.currentTarget.dataset.mode || "off";
    const next = modes[(modes.indexOf(current) + 1) % modes.length];
    event.currentTarget.dataset.mode = next;
    event.currentTarget.setAttribute("aria-pressed", String(next !== "off"));
    event.currentTarget.classList.toggle("engaged", next !== "off");
    event.currentTarget.textContent = next === "one" ? "⟳¹" : "⟳";
    player.repeat = next;
    Cadence.toast(`Repeat ${next === "one" ? "this track" : next === "all" ? "the queue" : "off"}.`);
  });
  $("#mute-btn")?.addEventListener("click", event => {
    const on = !audio.muted;
    audio.muted = on;
    event.currentTarget.setAttribute("aria-pressed", String(on));
    event.currentTarget.textContent = on ? "◌" : "◖";
    if (volume) volume.value = on ? 0 : Math.round(audio.volume * 100);
  });
  volume?.addEventListener("input", event => {
    audio.volume = Number(event.target.value) / 100;
    audio.muted = Number(event.target.value) === 0;
    if (muteButton) muteButton.textContent = audio.muted ? "◌" : "◖";
  });
  if (audio) audio.volume = Number(volume?.value ?? 76) / 100;

  /* ---------- shell ---------- */
  $("#modal-close")?.addEventListener("click", Cadence.closeModal);
  $("#modal-cancel")?.addEventListener("click", Cadence.closeModal);
  $("#modal-backdrop")?.addEventListener("click", event => { if (event.target === event.currentTarget) Cadence.closeModal(); });

  $("#share-btn")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      Cadence.toast("Link copied to the clipboard.");
    } catch {
      Cadence.toast(`This page's link is ${location.href}`);
    }
  });

  const collapse = $("#sidebar-collapse");
  collapse?.addEventListener("click", () => {
    const collapsed = document.body.classList.toggle("sidebar-collapsed");
    collapse.setAttribute("aria-expanded", String(!collapsed));
    collapse.textContent = collapsed ? "»" : "«";
    try { localStorage.setItem("cadence.sidebar.collapsed", collapsed ? "1" : "0"); } catch {}
  });
  try {
    if (localStorage.getItem("cadence.sidebar.collapsed") === "1") {
      document.body.classList.add("sidebar-collapsed");
      if (collapse) { collapse.setAttribute("aria-expanded", "false"); collapse.textContent = "»"; }
    }
  } catch {}

  document.addEventListener("keydown", event => { if (event.key === "Escape") Cadence.closeModal(); });
  window.Cadence = Cadence;
})();
