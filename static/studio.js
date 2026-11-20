// Studio page: multitrack arrangement, transport, projects, and the companion panel.
(() => {
  const { $, $$, api, toast, authenticated, player } = window.Cadence;
  const storageKey = "cadence.studio.v1";
  const initialTracks = [
    { id: "lead", name: "Soft focus", subtitle: "LEAD SYNTH · ANALOG DREAM", color: "mint", volume: 78, clips: [{ name: "soft-focus", start: 5, width: 35 }, { name: "soft-focus / take 2", start: 53, width: 25 }] },
    { id: "keys", name: "Afterglow", subtitle: "KEYS · ELECTRIC PIANO", color: "lilac", volume: 72, clips: [{ name: "afterglow chords", start: 17, width: 45 }] },
    { id: "bass", name: "Low tide", subtitle: "BASS · SUB", color: "amber", volume: 66, clips: [{ name: "low tide", start: 5, width: 68 }] },
    { id: "texture", name: "Room tone", subtitle: "TEXTURE · FIELD RECORDING", color: "blue", volume: 54, clips: [{ name: "room tone / rain", start: 37, width: 38 }] }
  ];
  const blankState = () => ({
    projectId: null, name: "Midnight in motion", bpm: 92, key: "C min", duration: 30,
    tracks: structuredClone(initialTracks), volume: 76, notes: [], history: [], future: []
  });

  let state = loadState();
  let projects = [];
  let playing = false;
  let elapsed = 0;
  let ticker = null;
  let zoom = 100;

  function loadState() {
    try { return { ...blankState(), ...JSON.parse(localStorage.getItem(storageKey) || "{}") }; }
    catch { return blankState(); }
  }
  // Object URLs only live for this page session, so they are never persisted.
  function persistableTracks() {
    return state.tracks.map(track => ({
      ...track,
      clips: (track.clips || []).map(clip => (clip.url?.startsWith("blob:") ? { ...clip, url: undefined } : clip))
    }));
  }
  function store() {
    try { localStorage.setItem(storageKey, JSON.stringify({ ...state, tracks: persistableTracks() })); } catch {}
  }

  function previewUrl(name) {
    const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "session";
    return `/preview/${encodeURIComponent(slug)}.wav`;
  }
  function clipTrack(track, clip) {
    return {
      url: clip.url || previewUrl(`${track.name}-${clip.name}`),
      title: clip.name,
      subtitle: `${track.name} · ${track.subtitle || "Studio layer"}`
    };
  }
  function sessionQueue() {
    const queue = [];
    for (const track of state.tracks) {
      for (const clip of track.clips || []) queue.push(clipTrack(track, clip));
    }
    return queue;
  }
  function setSavedState(text) {
    $("#save-state").innerHTML = `<i></i> ${text}`;
  }

  /* ---------- project persistence ---------- */
  async function saveProject() {
    if (!authenticated) return;
    const payload = {
      name: state.name, bpm: state.bpm, musical_key: state.key, tracks: persistableTracks(),
      settings: { duration: state.duration, volume: state.volume, notes: state.notes }
    };
    try {
      const saved = state.projectId
        ? await api(`projects/${state.projectId}/`, { method: "PATCH", body: JSON.stringify(payload) })
        : await api("projects/", { method: "POST", body: JSON.stringify(payload) });
      state.projectId = saved.id;
      store();
      upsertProject(saved);
      setSavedState("Saved");
    } catch (error) {
      setSavedState("Not saved");
      toast(error.message);
    }
  }
  function scheduleSave() {
    if (!authenticated) { setSavedState("Saved in this browser"); store(); return; }
    setSavedState("Saving…");
    clearTimeout(scheduleSave.timer);
    scheduleSave.timer = setTimeout(saveProject, 700);
  }
  function persist() {
    state.bpm = Number($("#bpm").value) || 92;
    state.volume = Number($("#master-volume").value);
    store();
    updateMaster();
    scheduleSave();
  }
  function upsertProject(project) {
    const index = projects.findIndex(item => item.id === project.id);
    if (index < 0) projects.unshift(project); else projects[index] = project;
    renderProjects();
  }
  function renderProjects() {
    const list = $("#project-list");
    list.innerHTML = "";
    const visible = authenticated ? projects : [{ id: "local", name: state.name }];
    if (!visible.length) {
      const empty = document.createElement("p");
      empty.className = "tool-note";
      empty.textContent = "No saved projects yet.";
      list.append(empty);
      return;
    }
    visible.forEach(project => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `project-row${project.id === state.projectId || (!authenticated && project.id === "local") ? " selected" : ""}`;
      const dot = document.createElement("span"); dot.className = "project-dot";
      const label = document.createElement("span"); label.textContent = project.name;
      row.append(dot, label);
      row.addEventListener("click", () => project.id === "local" ? toast("This guest session is saved in this browser.") : openProject(project.id));
      list.append(row);
    });
  }
  async function loadProjects() {
    try { projects = await api("projects/"); renderProjects(); }
    catch (error) { toast(error.message); }
  }
  async function openProject(id) {
    try {
      const project = await api(`projects/${id}/`);
      state = { ...blankState(), projectId: project.id, name: project.name, bpm: project.bpm, key: project.musical_key, tracks: project.tracks, ...(project.settings || {}) };
      hydrate(); store(); renderProjects();
      toast(`Opened “${project.name}”.`);
    } catch (error) { toast(error.message); }
  }

  /* ---------- tracks ---------- */
  function renderTracks() {
    const container = $("#tracks-container");
    container.innerHTML = "";
    for (const track of state.tracks) {
      const row = document.createElement("div");
      row.className = "track-row";
      row.dataset.trackId = track.id;
      row.innerHTML = `<div class="track-info"><button class="track-menu" aria-label="Track options">···</button><div class="track-color ${track.color}"></div><div class="track-title"><strong></strong><small></small></div><button class="track-mute" title="Mute" aria-label="Mute track">M</button><button class="track-solo" title="Solo" aria-label="Solo track">S</button><button class="track-volume" title="Track volume" aria-label="Track volume">◖</button></div><div class="track-lane"><div class="lane-grid"></div><div class="track-waveforms"></div><div class="lane-playhead"></div></div>`;
      $(".track-title strong", row).textContent = track.name;
      $(".track-title small", row).textContent = track.subtitle || "AUDIO · IMPORTED";

      const waves = $(".track-waveforms", row);
      for (const [index, clip] of track.clips.entries()) {
        const block = document.createElement("button");
        block.type = "button";
        block.className = `audio-clip ${track.color}`;
        block.style.left = `${clip.start}%`;
        block.style.width = `${clip.width}%`;
        block.title = `${clip.name} · drag to arrange`;
        block.innerHTML = `<span class="clip-label"></span><span class="waveform" aria-hidden="true"></span><span class="clip-handle left"></span><span class="clip-handle right"></span>`;
        $(".clip-label", block).textContent = clip.name;
        const wave = $(".waveform", block);
        const seed = (track.id.length + index * 11 + clip.name.length) % 13;
        for (let index2 = 0; index2 < 46; index2++) {
          const bar = document.createElement("i");
          bar.style.height = `${16 + ((index2 * 17 + seed * 13) % 76)}%`;
          wave.append(bar);
        }
        block.addEventListener("click", () => {
          player.play(clipTrack(track, clip), sessionQueue());
        });
        waves.append(block);
      }

      for (const type of ["track-mute", "track-solo"]) {
        $(`.${type}`, row).addEventListener("click", event => event.currentTarget.classList.toggle("engaged"));
      }
      $(".track-menu", row).addEventListener("click", event => openTrackMenu(event.currentTarget, track));
      $(".track-volume", row).addEventListener("click", event => openVolume(event.currentTarget, track));
      container.append(row);
    }
    $("#track-count").textContent = `${state.tracks.length} ${state.tracks.length === 1 ? "track" : "tracks"}`;
    enableClipDrag();
  }

  function openTrackMenu(anchor, track) {
    $$(".track-pop").forEach(element => element.remove());
    const menu = document.createElement("div");
    menu.className = "card-menu track-pop";
    menu.style.top = "26px";
    menu.style.left = "10px";
    menu.innerHTML = `<button type="button" data-track-action="rename">Rename track</button><button type="button" data-track-action="remove">Remove track</button>`;
    menu.addEventListener("click", event => {
      const action = event.target.dataset.trackAction;
      if (!action) return;
      if (action === "remove") {
        remember();
        state.tracks = state.tracks.filter(item => item.id !== track.id);
        renderTracks(); persist(); toast(`Removed “${track.name}”.`);
      }
      if (action === "rename") {
        const title = anchor.closest(".track-info").querySelector(".track-title strong");
        const input = document.createElement("input");
        input.className = "draft-name clip-rename";
        input.value = track.name;
        title.replaceWith(input);
        input.focus(); input.select();
        input.addEventListener("keydown", event2 => {
          if (event2.key === "Enter") input.blur();
          if (event2.key === "Escape") renderTracks();
        });
        input.addEventListener("blur", () => {
          const name = input.value.trim();
          if (name) { remember(); track.name = name; persist(); }
          renderTracks();
        }, { once: true });
      }
      menu.remove();
    });
    anchor.parentElement.append(menu);
  }

  function openVolume(anchor, track) {
    $$(".track-pop").forEach(element => element.remove());
    const pop = document.createElement("div");
    pop.className = "card-menu track-pop";
    pop.style.top = "26px";
    pop.style.right = "8px";
    pop.style.width = "140px";
    const label = document.createElement("span");
    label.className = "tool-note";
    label.textContent = `Volume ${track.volume ?? 70}%`;
    const slider = document.createElement("input");
    slider.type = "range"; slider.min = "0"; slider.max = "100"; slider.value = String(track.volume ?? 70);
    slider.addEventListener("input", () => { track.volume = Number(slider.value); label.textContent = `Volume ${track.volume}%`; persist(); });
    pop.append(label, slider);
    anchor.parentElement.append(pop);
  }

  function enableClipDrag() {
    let drag = null;
    $$(".audio-clip").forEach(clip => clip.addEventListener("pointerdown", event => {
      if (event.target.classList.contains("clip-handle")) return;
      const lane = clip.closest(".track-lane");
      const rect = lane.getBoundingClientRect();
      drag = { clip, rect, startX: event.clientX, original: Number.parseFloat(clip.style.left) };
      clip.setPointerCapture(event.pointerId);
      clip.classList.add("dragging");
    }));
    $$(".audio-clip").forEach(clip => clip.addEventListener("pointermove", event => {
      if (!drag || drag.clip !== clip) return;
      const delta = (event.clientX - drag.startX) / drag.rect.width * 100;
      clip.style.left = `${Math.max(0, Math.min(100 - Number.parseFloat(clip.style.width), drag.original + delta))}%`;
    }));
    $$(".audio-clip").forEach(clip => clip.addEventListener("pointerup", () => {
      if (!drag || drag.clip !== clip) return;
      const row = clip.closest(".track-row");
      const track = state.tracks.find(item => item.id === row.dataset.trackId);
      const index = [...clip.parentElement.children].indexOf(clip);
      if (track?.clips[index]) track.clips[index].start = Number.parseFloat(clip.style.left);
      clip.classList.remove("dragging");
      drag = null;
      persist();
    }));
  }

  function addTrack(name = "New layer", color = "blue", subtitle = "AUDIO · NEW TRACK") {
    remember();
    state.tracks.push({ id: `track-${Date.now()}`, name, subtitle, color, volume: 70, clips: [] });
    renderTracks(); persist();
    toast(`${name} added to your arrangement.`);
  }
  function remember() {
    state.history ||= [];
    state.future ||= [];
    state.history.push(JSON.stringify(state.tracks));
    if (state.history.length > 30) state.history.shift();
    state.future = [];
  }
  function travel(direction) {
    const from = direction === "undo" ? state.history : state.future;
    const to = direction === "undo" ? state.future : state.history;
    if (!from?.length) return;
    to.push(JSON.stringify(state.tracks));
    state.tracks = JSON.parse(from.pop());
    renderTracks(); persist();
  }

  /* ---------- transport ---------- */
  function updateMaster() {
    const db = state.volume > 0 ? 20 * Math.log10(state.volume / 100) : -Infinity;
    $("#master-db").textContent = db === -Infinity ? "−∞ dB" : `${db.toFixed(1)} dB`;
    $$(".master-meter i").forEach((bar, index) => {
      bar.style.opacity = index < Math.round(state.volume / 100 * 18) ? "1" : ".28";
    });
  }
  function formatTime(seconds, milliseconds = false) {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return milliseconds
      ? `${String(minutes).padStart(2, "0")}:${rest.toFixed(3).padStart(6, "0")}`
      : `${String(minutes).padStart(2, "0")}:${String(Math.floor(rest)).padStart(2, "0")}`;
  }
  function tick() {
    elapsed = (elapsed + 0.1) % state.duration;
    const beats = (elapsed * state.bpm) / 60;
    const bar = Math.floor(beats / 4) + 1;
    const beat = Math.floor(beats % 4) + 1;
    $("#timecode").textContent = formatTime(elapsed, true);
    $("#barbeat").textContent = `${String(bar).padStart(3, "0")}.${beat}.1`;
    $("#time-display").innerHTML = `${formatTime(elapsed)} <i>/</i> ${formatTime(state.duration)}`;
    $("#playhead-line").style.left = `${8 + elapsed / state.duration * 92}%`;
    $$(".lane-playhead").forEach(line => { line.style.left = `${elapsed / state.duration * 100}%`; });
  }
  function setPlaying(on) {
    playing = on;
    $("#play-btn").textContent = on ? "Ⅱ" : "▶";
    $("#play-btn").classList.toggle("is-playing", on);
    clearInterval(ticker);
    if (on) ticker = setInterval(tick, 100);
  }
  function togglePlay() {
    if (playing) {
      player.pause();
      setPlaying(false);
      return;
    }
    if (!state.tracks.length) { toast("Add a track or generate a clip first."); return; }
    if (!player.current) {
      const queue = sessionQueue();
      if (!queue.length) { toast("Add a clip to the timeline first."); return; }
      player.play(queue[0], queue);
    } else {
      player.toggle();
    }
    setPlaying(true);
  }

  /* ---------- studio notes ---------- */
  function renderNotes() {
    const note = $("#studio-prompt-note");
    if (!state.notes.length) { note.hidden = true; note.textContent = ""; return; }
    note.hidden = false;
    note.textContent = `Recent directions: ${state.notes.slice(0, 3).join(" · ")}`;
  }
  function addNote(text) {
    const value = text.trim();
    if (!value) { $("#studio-prompt").focus(); toast("Describe the part you want first."); return; }
    state.notes.unshift(value);
    state.notes = state.notes.slice(0, 12);
    $("#studio-prompt").value = "";
    renderNotes(); persist();
    toast("Direction added to this project. Audio parts need a connected provider.");
  }

  /* ---------- hydrate ---------- */
  function hydrate() {
    $("#project-name").textContent = state.name;
    $("#bpm").value = state.bpm;
    $("#master-volume").value = state.volume;
    renderTracks(); renderProjects(); renderNotes(); updateMaster();
    $("#timecode").textContent = "00:00.000";
    $("#barbeat").textContent = "001.1.1";
  }

  hydrate();

  /* ---------- wiring ---------- */
  $("#play-btn").addEventListener("click", togglePlay);
  $("#stop-btn").addEventListener("click", () => {
    player.stop();
    setPlaying(false);
    elapsed = 0;
    $("#timecode").textContent = "00:00.000";
    $("#barbeat").textContent = "001.1.1";
    $("#time-display").innerHTML = `00:00 <i>/</i> ${formatTime(state.duration)}`;
    $("#playhead-line").style.left = "8%";
    $$(".lane-playhead").forEach(line => { line.style.left = "0%"; });
  });
  $("#loop-btn").addEventListener("click", event => {
    const on = event.currentTarget.getAttribute("aria-pressed") !== "true";
    event.currentTarget.setAttribute("aria-pressed", String(on));
    event.currentTarget.classList.toggle("engaged", on);
  });
  $("#master-volume").addEventListener("input", event => { state.volume = Number(event.target.value); updateMaster(); store(); scheduleSave(); });
  $("#bpm").addEventListener("change", persist);
  $("#bpm").addEventListener("input", persist);
  $("#undo-btn").addEventListener("click", () => travel("undo"));
  $("#redo-btn").addEventListener("click", () => travel("redo"));
  $("#add-track").addEventListener("click", () => addTrack());
  $("#add-track-top").addEventListener("click", () => addTrack());
  $("#add-track-bottom").addEventListener("click", () => addTrack());
  $("#new-project").addEventListener("click", () => {
    state = blankState();
    state.name = "Untitled session";
    state.projectId = null;
    hydrate(); store(); setSavedState("Saved locally");
    toast("A fresh session is ready.");
  });
  $("#rename-project").addEventListener("click", () => {
    const label = $("#project-name");
    if (document.querySelector(".project-rename")) return;
    const input = document.createElement("input");
    input.className = "draft-name project-rename";
    input.value = state.name;
    input.maxLength = 120;
    label.replaceWith(input);
    input.focus(); input.select();
    const commit = () => {
      const value = input.value.trim();
      if (value) { state.name = value.slice(0, 120); }
      input.replaceWith(label);
      label.textContent = state.name;
      renderProjects();
      store(); scheduleSave();
    };
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") input.blur();
      if (event.key === "Escape") { input.value = state.name; input.blur(); }
    });
    input.addEventListener("blur", commit, { once: true });
  });
  $("#import-audio").addEventListener("click", () => $("#audio-file").click());
  $("#audio-file").addEventListener("change", event => {
    const file = event.target.files[0];
    if (!file) return;
    const label = file.name.replace(/\.[^.]+$/, "").slice(0, 36);
    addTrack(label, "blue", `AUDIO · ${file.type.split("/")[1]?.toUpperCase() || "IMPORTED"}`);
    const track = state.tracks[state.tracks.length - 1];
    const objectUrl = URL.createObjectURL(file);
    const probe = new Audio(objectUrl);
    probe.preload = "metadata";
    probe.addEventListener("loadedmetadata", () => {
      track.clips = [{ name: label, start: 0, width: Math.min(100, Math.max(12, Math.round(probe.duration / state.duration * 100))), url: objectUrl }];
      renderTracks(); persist();
      toast(`Imported ${file.name} · ${Math.round(probe.duration)} seconds. Press the clip to hear it.`);
    }, { once: true });
    probe.addEventListener("error", () => {
      track.clips = [{ name: label, start: 0, width: 40, url: objectUrl }];
      renderTracks(); persist();
      toast(`${file.name} was added, but this browser could not read its duration.`);
    }, { once: true });
    event.target.value = "";
  });
  $("#zoom-in").addEventListener("click", () => { zoom = Math.min(160, zoom + 10); $("#zoom-label").textContent = `${zoom}%`; $("#tracks-container").style.width = `${zoom}%`; });
  $("#zoom-out").addEventListener("click", () => { zoom = Math.max(60, zoom - 10); $("#zoom-label").textContent = `${zoom}%`; $("#tracks-container").style.width = `${zoom}%`; });
  const fit = () => { zoom = 100; $("#zoom-label").textContent = "100%"; $("#tracks-container").style.width = "100%"; };
  $("#fit-timeline").addEventListener("click", fit);
  $("#fit-timeline-bottom").addEventListener("click", fit);
  $("#collapse-tracks").addEventListener("click", () => {
    $(".timeline").classList.toggle("tracks-collapsed");
    $("#collapse-tracks").textContent = $(".timeline").classList.contains("tracks-collapsed") ? "⌄" : "⌃";
  });
  $("#studio-prompt-send").addEventListener("click", () => addNote($("#studio-prompt").value));
  $("#studio-prompt").addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); addNote(event.target.value); }
  });
  $$(".suggestion-card").forEach(card => card.addEventListener("click", () => {
    $("#studio-prompt").value = card.dataset.prompt;
    $("#studio-prompt").focus();
    toast("Suggestion loaded into the studio prompt. Press ↗ to add it.");
  }));
  $("#refine-btn").addEventListener("click", () => {
    const text = $("#refine-prompt").value.trim();
    if (!text) { $("#refine-prompt").focus(); return; }
    $("#refine-prompt").value = "";
    addNote(text);
  });
  $("#hide-assistant").addEventListener("click", () => { $("#assistant-panel").classList.add("hidden"); toast("Companion hidden. Reload the page to bring it back."); });
  $("#close-assistant").addEventListener("click", () => { $("#assistant-panel").classList.add("hidden"); });
  $("#export-btn").addEventListener("click", () => {
    if (!authenticated) { toast("Sign in to export a project file."); return; }
    const blob = new Blob([JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" });
    const link = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob),
      download: `${state.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "cadence"}.cadence.json`
    });
    link.click();
    URL.revokeObjectURL(link.href);
    toast("Studio session exported as a project file.");
  });

  document.addEventListener("click", event => {
    if (!event.target.closest(".track-pop") && !event.target.closest(".track-menu") && !event.target.closest(".track-volume")) $$(".track-pop").forEach(element => element.remove());
  });
  document.addEventListener("keydown", event => {
    if (event.code === "Space" && !["TEXTAREA", "INPUT"].includes(document.activeElement.tagName)) { event.preventDefault(); togglePlay(); }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); addNote($("#studio-prompt").value); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); travel(event.shiftKey ? "redo" : "undo"); }
  });

  /* ---------- deep link from the create page ---------- */
  const clipParam = new URLSearchParams(location.search).get("clip");
  if (clipParam && authenticated) {
    api(`jobs/${clipParam}/`).then(job => {
      const name = job.title || job.prompt.slice(0, 40) || "Generated clip";
      $("#project-name").textContent = name;
      if (job.audio_url && !state.tracks.some(track => track.clips?.some(clip => clip.url === job.audio_url))) {
        state.tracks.push({
          id: `clip-${job.id}`, name, subtitle: job.provider === "wavespeed" ? "GENERATED SONG · CADENCE AI" : "GENERATED CLIP · LOCAL PREVIEW",
          color: "mint", volume: 80, clips: [{ name, start: 0, width: 60, url: job.audio_url }]
        });
        renderTracks();
      }
      state.notes.unshift(`Opened clip “${name}” from your library.`);
      renderNotes(); store();
      toast(job.audio_url ? "Clip opened in the studio. Press its block to hear it." : "That clip has no audio yet.");
    }).catch(() => toast("That clip is not available in your library."));
  }

  if (authenticated) { loadProjects(); setSavedState("Saved"); }
  else setSavedState("Saved in this browser");
})();
