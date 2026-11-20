// Create page: composer state, lyric drafts, style presets, options, and the saved clip list.
(() => {
  const { $, $$, api, toast, authenticated, player } = window.Cadence;
  const stateKey = "cadence.create.v1";
  const clipsKey = "cadence.clips.v1";
  const PAGE_SIZE = 8;

  const providerChip = $("#provider-chip");
  const provider = {
    name: providerChip?.dataset.provider || "local",
    ai: providerChip?.dataset.ai === "true",
    detail: providerChip?.dataset.detail || ""
  };
  const providerLabel = clip => (clip?.provider === "wavespeed" ? "Cadence AI song" : "Local preview");

  const defaults = () => ({
    type: "song", mode: "advanced", model: "balanced",
    simplePrompt: "", lyrics: "", styles: "", title: "", instrumental: false,
    gender: null, durationMode: "custom", duration: 30, maxMode: "off",
    weirdness: 50, influence: 50, variety: 1, personalize: "off",
    personalizeStyle: false, voice: "auto", inspo: "",
    lyricDrafts: [], savedStyles: [],
    likes: {}, dislikes: {}, published: {},
    search: "", filters: [], sort: "new", view: "list", page: 1,
    audioName: ""
  });

  let state = { ...defaults(), ...readJSON(stateKey) };
  let serverClips = [];
  let pageIndex = 1;
  const past = [];
  let future = [];
  let snapshot = "";

  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch { return {}; }
  }
  function save() {
    state.page = pageIndex;
    try { localStorage.setItem(stateKey, JSON.stringify(state)); } catch {}
  }
  function localClips() { try { return JSON.parse(localStorage.getItem(clipsKey) || "[]"); } catch { return []; } }
  function writeLocalClips(items) { try { localStorage.setItem(clipsKey, JSON.stringify(items.slice(0, 120))); } catch {} }

  const lyricsEditor = $("#lyrics-editor");
  const styleInput = $("#style-input");
  const simplePrompt = $("#simple-prompt");
  const titleInput = $("#song-title");

  /* ---------- hydration ---------- */
  const params = new URLSearchParams(location.search);
  if (params.get("prompt")) state.simplePrompt = params.get("prompt").slice(0, 1200);
  if (params.get("style")) state.styles = params.get("style").slice(0, 1000);
  if (params.get("instrumental") === "1") state.instrumental = true;
  if (params.get("prompt")) state.mode = "simple";

  if (simplePrompt) simplePrompt.value = state.simplePrompt;
  if (lyricsEditor) lyricsEditor.value = state.lyrics;
  if (styleInput) styleInput.value = state.styles;
  if (titleInput) titleInput.value = state.title;
  $("#create-model").value = state.model;
  $("#voice-select").value = state.voice;
  $("#inspo-select").value = state.inspo;
  $("#weirdness").value = state.weirdness;
  $("#style-influence").value = state.influence;
  $("#variety").value = state.variety;
  $("#personalize-style").checked = state.personalizeStyle;
  $("#instrumental").checked = Boolean(state.instrumental);
  $("#option-duration").value = String(state.duration);
  if (state.audioName) $("#audio-label").textContent = state.audioName;
  snapshot = lyricsEditor?.value || "";
  pageIndex = state.page || 1;

  function setType(type) {
    state.type = type;
    $$("[data-create-type]").forEach(tab => {
      const selected = tab.dataset.createType === type;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", String(selected));
    });
    $("#create-song span").textContent = type === "speech" ? "Create speech" : "Create song";
    $("#simple-prompt").placeholder = type === "speech"
      ? "Write or paste the words to speak, and describe the delivery you want…"
      : "A warm, unhurried soul groove with brushed drums and a close, conversational vocal…";
    const speech = type === "speech";
    $("#lyrics-block").hidden = speech;
    $("#tool-voice").hidden = speech;
    $('[data-create-mode="advanced"]').disabled = speech;
    if (speech) setMode("simple");
  }
  function setMode(mode) {
    if (state.type === "speech") mode = "simple";
    state.mode = mode;
    $$("[data-create-mode]").forEach(tab => {
      const selected = tab.dataset.createMode === mode;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", String(selected));
    });
    $("#simple-fields").hidden = mode !== "simple";
    $("#advanced-fields").hidden = mode !== "advanced";
    $("#create-tools").hidden = mode === "simple";
  }

  /* ---------- segmented option groups ---------- */
  function paintSegments() {
    $$("[data-option]").forEach(group => {
      const key = group.dataset.option;
      let current = null;
      if (key === "gender") current = state.gender;
      if (key === "duration") current = state.durationMode;
      if (key === "max") current = state.maxMode;
      if (key === "personalize") current = state.personalize;
      $$("button", group).forEach(button => button.classList.toggle("selected", button.dataset.value === current));
    });
    $("#duration-field").hidden = state.durationMode !== "custom";
    $("#weirdness-value").textContent = `${state.weirdness}%`;
    $("#influence-value").textContent = `${state.influence}%`;
    $("#weirdness-hint").textContent = state.weirdness < 25 ? "Safe and familiar" : state.weirdness > 75 ? "Unpredictable" : "Expected results";
    $("#influence-hint").textContent = state.influence < 25 ? "Loose interpretation" : state.influence > 75 ? "Follows the style closely" : "Moderate";
    const varietyLabels = ["Consistent", "Normal", "Adventurous"];
    const varietyHints = ["Very similar takes", "Balanced variety", "Wide range of takes"];
    $("#variety-value").textContent = varietyLabels[state.variety];
    $("#variety-hint").textContent = varietyHints[state.variety];
  }

  $$("[data-option] button").forEach(button => button.addEventListener("click", () => {
    const key = button.closest("[data-option]").dataset.option;
    const value = button.dataset.value;
    if (key === "gender") state.gender = state.gender === value ? null : value;
    if (key === "duration") state.durationMode = value;
    if (key === "max") state.maxMode = value;
    if (key === "personalize") state.personalize = value;
    paintSegments(); save();
  }));
  $("#option-duration").addEventListener("change", event => { state.duration = Number(event.target.value); save(); });
  $("#weirdness").addEventListener("input", event => { state.weirdness = Number(event.target.value); paintSegments(); save(); });
  $("#style-influence").addEventListener("input", event => { state.influence = Number(event.target.value); paintSegments(); save(); });
  $("#variety").addEventListener("input", event => { state.variety = Number(event.target.value); paintSegments(); save(); });
  $("#options-reset").addEventListener("click", () => {
    Object.assign(state, { gender: null, durationMode: "custom", duration: 30, maxMode: "off", weirdness: 50, influence: 50, variety: 1, personalize: "off" });
    $("#weirdness").value = 50; $("#style-influence").value = 50; $("#variety").value = 1; $("#option-duration").value = "30";
    paintSegments(); save(); toast("Creation options reset.");
  });

  /* ---------- panels ---------- */
  /* ---------- tool popovers ---------- */
  const panels = { audio: "#panel-audio", voice: "#panel-voice", inspo: "#panel-inspo" };
  const tools = { audio: "#tool-audio", voice: "#tool-voice", inspo: "#tool-inspo" };
  Object.keys(panels).forEach(key => {
    $(tools[key]).addEventListener("click", () => {
      const panel = $(panels[key]);
      const open = panel.hidden;
      Object.keys(panels).forEach(other => {
        $(panels[other]).hidden = true;
        $(tools[other]).setAttribute("aria-expanded", "false");
      });
      panel.hidden = !open;
      $(tools[key]).setAttribute("aria-expanded", String(open));
    });
  });
  $("#browse-audio").addEventListener("click", () => $("#create-audio-file").click());
  $("#create-audio-file").addEventListener("change", event => {
    const file = event.target.files[0];
    if (!file) return;
    state.audioName = `${file.name} · ${Math.round(file.size / 1024)} KB`;
    $("#audio-label").textContent = state.audioName;
    save();
    toast(`${file.name} attached for this session. Reference audio is not sent to the provider yet.`);
    event.target.value = "";
  });
  $("#instrumental").addEventListener("change", event => { state.instrumental = event.target.checked; save(); });
  $("#voice-select").addEventListener("change", event => { state.voice = event.target.value; save(); });
  $("#inspo-select").addEventListener("change", event => { state.inspo = event.target.value; save(); });

  /* ---------- collapsible blocks ---------- */
  [["#lyrics-toggle", "#lyrics-body"], ["#styles-toggle", "#styles-body"], ["#more-toggle", "#more-body"]].forEach(([toggle, body]) => {
    $(toggle).addEventListener("click", () => {
      const target = $(body);
      target.hidden = !target.hidden;
      $(toggle).setAttribute("aria-expanded", String(!target.hidden));
    });
  });

  /* ---------- lyrics ---------- */
  function updateLyricMeta() {
    const text = lyricsEditor.value;
    $("#lyrics-count").textContent = `${text.length} of 5000 characters used.`;
    $("#lyrics-hint").textContent = text.trim() ? "Line breaks and [section] tags are kept as written." : "Start writing lyrics, or leave this empty for instrumental";
    $("#lyrics-undo").disabled = !past.length;
    $("#lyrics-redo").disabled = !future.length;
    state.lyrics = text;
  }
  function commitLyrics() {
    if (lyricsEditor.value === snapshot) return;
    past.push(snapshot);
    if (past.length > 40) past.shift();
    future = [];
    snapshot = lyricsEditor.value;
    updateLyricMeta();
  }
  function setLyrics(text) {
    if (text === lyricsEditor.value) return;
    past.push(lyricsEditor.value);
    future = [];
    lyricsEditor.value = text;
    snapshot = text;
    updateLyricMeta();
    save();
  }
  lyricsEditor.addEventListener("blur", commitLyrics);
  lyricsEditor.addEventListener("input", () => { updateLyricMeta(); save(); });
  $("#lyrics-undo").addEventListener("click", () => { if (!past.length) return; future.push(lyricsEditor.value); const value = past.pop(); lyricsEditor.value = value; snapshot = value; updateLyricMeta(); save(); });
  $("#lyrics-redo").addEventListener("click", () => { if (!future.length) return; past.push(lyricsEditor.value); const value = future.pop(); lyricsEditor.value = value; snapshot = value; updateLyricMeta(); save(); });
  $("#lyrics-new").addEventListener("click", () => { setLyrics(""); $("#draft-name").focus(); });
  $("#lyrics-full").addEventListener("click", () => {
    document.body.classList.toggle("lyrics-expanded");
    toast(document.body.classList.contains("lyrics-expanded") ? "Lyrics editor expanded. Press the same button to return." : "Lyrics editor returned to the page.");
  });

  $("#draft-save").addEventListener("click", () => {
    const text = lyricsEditor.value.trim();
    if (!text) { lyricsEditor.focus(); toast("Write some lyrics before saving a draft."); return; }
    const name = $("#draft-name").value.trim() || titleInput.value.trim() || `Draft ${state.lyricDrafts.length + 1}`;
    state.lyricDrafts.unshift({ id: `draft-${Date.now()}`, name: name.slice(0, 80), text, savedAt: new Date().toISOString() });
    state.lyricDrafts = state.lyricDrafts.slice(0, 40);
    $("#draft-name").value = "";
    save(); renderLyricDrafts();
    if (!$("#saved-lyrics").hidden) $("#saved-lyrics").hidden = false;
    toast(`Saved “${name}” to your lyric drafts.`);
  });
  $("#lyrics-saved").addEventListener("click", () => {
    const panel = $("#saved-lyrics");
    panel.hidden = !panel.hidden;
    $("#lyrics-saved").setAttribute("aria-expanded", String(!panel.hidden));
    renderLyricDrafts();
  });
  function renderLyricDrafts() {
    const panel = $("#saved-lyrics");
    panel.innerHTML = "";
    if (!state.lyricDrafts.length) {
      const empty = document.createElement("p");
      empty.className = "saved-empty";
      empty.textContent = "No saved lyric drafts yet. Write something and press Save draft.";
      panel.append(empty);
      return;
    }
    state.lyricDrafts.forEach(draft => {
      const row = document.createElement("div");
      row.className = "saved-row";
      const open = document.createElement("button");
      open.type = "button"; open.className = "open";
      const name = document.createElement("strong"); name.textContent = draft.name;
      const excerpt = document.createElement("small"); excerpt.textContent = draft.text.slice(0, 80).replace(/\s+/g, " ");
      open.append(name, excerpt);
      open.addEventListener("click", () => { setLyrics(draft.text); toast(`Loaded “${draft.name}”.`); });
      const remove = document.createElement("button");
      remove.type = "button"; remove.className = "del"; remove.textContent = "×";
      remove.setAttribute("aria-label", `Delete ${draft.name}`);
      remove.addEventListener("click", () => {
        state.lyricDrafts = state.lyricDrafts.filter(item => item.id !== draft.id);
        save(); renderLyricDrafts(); toast(`Deleted “${draft.name}”.`);
      });
      row.append(open, remove);
      panel.append(row);
    });
  }
  renderLyricDrafts();

  /* ---------- local draft writer ---------- */
  const PRESETS = {
    "power-ballad": ["wide open sky", "a bright, rising chorus", "every light along the road", "hold on through the quiet"],
    "indie-hit": ["a borrowed bike", "the corner shop at midnight", "something almost like a plan", "small hours, smaller talk"],
    "punk-anthem": ["a broken amp", "the last bus out of town", "no permission needed", "sound the alarm"],
    "jazz-standard": ["a slow blue evening", "smoke and conversation", "the way you almost stayed", "one more chorus, then home"],
    "shoegaze": ["a wall of soft noise", "the room after the rain", "half-heard words", "a blur that feels like light"],
    "free": ["an open window", "the sound of the street below", "a thought you keep returning to", "the light before the evening"]
  };
  const STRUCTURE = ["[Verse 1]", "[Chorus]", "[Verse 2]", "[Bridge]"];
  $("#cowriter-toggle").addEventListener("click", () => {
    const panel = $("#cowriter-panel");
    panel.hidden = !panel.hidden;
    $("#cowriter-toggle").setAttribute("aria-expanded", String(!panel.hidden));
  });
  $$(".cowriter-presets button").forEach(button => button.addEventListener("click", () => {
    $("#cowriter-prompt").value = button.textContent.replace(/^Write (a|an) /i, "").replace(/^(power ballad|indie hit|punk anthem|jazz standard|shoegaze song)$/i, m => m);
    writeDraft(button.dataset.preset);
  }));
  $("#cowriter-go").addEventListener("click", () => writeDraft("free"));
  function writeDraft(preset) {
    const words = PRESETS[preset] || PRESETS.free;
    const subject = $("#cowriter-prompt").value.trim() || words[0];
    const blocks = STRUCTURE.map((section, index) => {
      const phrase = words[index % words.length];
      const line = index === 1
        ? `${subject}, ${phrase} — and I keep the door ajar`
        : `I found ${phrase} in the shape of you`;
      const line2 = index === 1 ? `Say it once, say it slower, let it carry far` : `Turned it over twice and let the meaning through`;
      return `${section}\n${line}\n${line2}\n`;
    });
    setLyrics(blocks.join("\n"));
    $("#cowriter-panel").hidden = true;
    $("#cowriter-toggle").setAttribute("aria-expanded", "false");
    toast("Draft structure added. Edit any line to make it yours.");
  }

  /* ---------- styles ---------- */
  const STYLE_POOL = ["pop soul", "mbira", "breakstep synthwave", "festival anthem", "jazz-rock", "female husky alto", "steady drums", "dark synthpop", "violin-driven", "hypercore", "shimmering arpeggios", "hang drum", "gritty male vocals", "orchestral soundtrack", "late night", "warm analog", "close vocal", "brushed drums"];
  let styleOffset = 0;
  function updateStyleMeta() {
    $("#style-count").textContent = `${styleInput.value.length} / 1000`;
    state.styles = styleInput.value;
  }
  function renderSuggestions() {
    const holder = $("#style-suggests");
    holder.innerHTML = "";
    for (let index = 0; index < 8; index++) {
      const style = STYLE_POOL[(index + styleOffset) % STYLE_POOL.length];
      const button = document.createElement("button");
      button.type = "button"; button.className = "style-suggest"; button.textContent = `＋ ${style}`;
      button.addEventListener("click", () => {
        const current = styleInput.value.trim();
        if (current.toLowerCase().includes(style)) { toast(`“${style}” is already in your styles.`); return; }
        styleInput.value = current ? `${current}, ${style}` : style;
        updateStyleMeta(); save();
      });
      holder.append(button);
    }
  }
  styleInput.addEventListener("input", () => { updateStyleMeta(); save(); });
  $("#style-refresh").addEventListener("click", () => { styleOffset += 3; renderSuggestions(); });
  $("#personalize-style").addEventListener("change", event => { state.personalizeStyle = event.target.checked; save(); });
  $("#style-save").addEventListener("click", () => {
    const text = styleInput.value.trim();
    if (!text) { styleInput.focus(); toast("Write a style prompt before saving it."); return; }
    if (state.savedStyles.some(item => item.text === text)) { toast("That style prompt is already saved."); return; }
    state.savedStyles.unshift({ id: `style-${Date.now()}`, name: text.length > 48 ? `${text.slice(0, 48)}…` : text, text });
    state.savedStyles = state.savedStyles.slice(0, 40);
    save(); renderSavedStyles(); $("#saved-styles").hidden = false;
    toast("Style prompt saved.");
  });
  $("#styles-saved").addEventListener("click", () => {
    const panel = $("#saved-styles");
    panel.hidden = !panel.hidden;
    $("#styles-saved").setAttribute("aria-expanded", String(!panel.hidden));
    renderSavedStyles();
  });
  function renderSavedStyles() {
    const panel = $("#saved-styles");
    panel.innerHTML = "";
    if (!state.savedStyles.length) {
      const empty = document.createElement("p");
      empty.className = "saved-empty";
      empty.textContent = "No saved style prompts yet. Write one and press Save style.";
      panel.append(empty);
      return;
    }
    state.savedStyles.forEach(item => {
      const row = document.createElement("div");
      row.className = "saved-row";
      const open = document.createElement("button");
      open.type = "button"; open.className = "open";
      const name = document.createElement("strong"); name.textContent = item.name;
      const excerpt = document.createElement("small"); excerpt.textContent = item.text;
      open.append(name, excerpt);
      open.addEventListener("click", () => { styleInput.value = item.text; updateStyleMeta(); save(); toast("Style prompt loaded."); });
      const remove = document.createElement("button");
      remove.type = "button"; remove.className = "del"; remove.textContent = "×";
      remove.setAttribute("aria-label", "Delete saved style");
      remove.addEventListener("click", () => { state.savedStyles = state.savedStyles.filter(entry => entry.id !== item.id); save(); renderSavedStyles(); });
      row.append(open, remove);
      panel.append(row);
    });
  }
  renderSavedStyles(); renderSuggestions();

  /* ---------- tabs, model, simple prompt ---------- */
  $$("[data-create-type]").forEach(tab => tab.addEventListener("click", () => { setType(tab.dataset.createType); save(); }));
  $$("[data-create-mode]").forEach(tab => tab.addEventListener("click", () => { setMode(tab.dataset.createMode); save(); }));
  $("#create-model").addEventListener("change", event => { state.model = event.target.value; save(); });
  simplePrompt.addEventListener("input", () => {
    state.simplePrompt = simplePrompt.value;
    $("#simple-count").textContent = `${simplePrompt.value.length} / 1200`;
    save();
  });
  $("#simple-count").textContent = `${simplePrompt.value.length} / 1200`;
  titleInput.addEventListener("input", () => { state.title = titleInput.value; save(); });

  $("#clear-form").addEventListener("click", () => {
    Object.assign(state, { simplePrompt: "", lyrics: "", styles: "", title: "", instrumental: false, audioName: "" });
    simplePrompt.value = ""; lyricsEditor.value = ""; styleInput.value = ""; titleInput.value = "";
    $("#instrumental").checked = false;
    $("#audio-label").textContent = "No file chosen";
    past.length = 0; future = []; snapshot = "";
    updateLyricMeta(); updateStyleMeta(); $("#simple-count").textContent = "0 / 1200";
    save(); toast("Form cleared.");
  });

  /* ---------- create ---------- */
  $("#create-form").addEventListener("submit", async event => {
    event.preventDefault();
    const speech = state.type === "speech";
    const advanced = state.mode === "advanced";
    const styles = styleInput.value.trim();
    const lyrics = lyricsEditor.value.trim();
    let prompt = "";
    if (speech) prompt = simplePrompt.value.trim();
    else if (advanced) prompt = styles || (lyrics ? `Vocal sketch: ${lyrics.slice(0, 160)}` : "");
    else prompt = simplePrompt.value.trim();

    const note = $("#create-note");
    note.hidden = true;
    if (!prompt) {
      (advanced && !speech ? styleInput : simplePrompt).focus();
      note.hidden = false;
      note.textContent = speech || !advanced ? "Describe what you want to create first." : "Add a style prompt, or some lyrics, before creating.";
      return;
    }

    const button = $("#create-song");
    button.disabled = true;
    const original = button.innerHTML;
    button.innerHTML = '<span class="spinner"></span> <span>Shaping the idea…</span>';

    const payload = {
      prompt, title: titleInput.value.trim(), style: speech ? "" : styles,
      lyrics: speech || advanced ? (speech ? simplePrompt.value.trim() : lyrics) : "",
      duration: state.durationMode === "auto" ? 60 : state.duration,
      instrumental: speech ? false : state.instrumental,
      settings: {
        format: speech ? "speech" : "song", mode: state.mode, model: state.model,
        vocalGender: state.gender, maxMode: state.maxMode, weirdness: state.weirdness,
        styleInfluence: state.influence, variety: state.variety, personalize: state.personalize,
        personalizeStyle: state.personalizeStyle, voice: state.voice, inspo: state.inspo,
        audioReference: state.audioName
      }
    };

    try {
      if (!authenticated) {
        const clip = {
          id: `local-${Date.now()}`, title: payload.title || "Untitled sketch", prompt,
          style: payload.style, status: "draft", audio_url: "", local: true,
          duration: payload.duration, created_at: new Date().toISOString()
        };
        writeLocalClips([clip, ...localClips()]);
        note.hidden = false;
        note.textContent = "Saved in this browser. Sign in to keep clips in your private workspace and to send prompts to a provider.";
        toast("Saved to this browser's clip list. Sign in to keep clips in your workspace.");
      } else {
        const job = await api("jobs/", { method: "POST", body: JSON.stringify(payload) });
        serverClips.unshift(job);
        note.hidden = false;
        if (job.status === "failed") {
          note.textContent = job.error || "The provider rejected this request.";
          toast(note.textContent);
        } else if (job.status === "running" || job.status === "queued") {
          note.textContent = `Rendering with ${providerLabel(job)}. This usually takes a minute — the clip updates itself when it is ready.`;
          toast("Rendering started.");
          pollJob(job.id);
        } else if (job.audio_url) {
          note.textContent = job.provider === "wavespeed"
            ? "Your song is ready. Press play next to the clip to hear it."
            : "A local preview is ready and playable now. Add WAVESPEED_API_KEY to generate AI songs with vocals.";
          toast(`${providerLabel(job)} ready.`);
        } else {
          note.textContent = "The provider did not return audio for this prompt.";
          toast("No audio was returned.");
        }
      }
      Object.assign(state, { simplePrompt: "", lyrics: "", styles: "", title: "" });
      simplePrompt.value = ""; lyricsEditor.value = ""; styleInput.value = ""; titleInput.value = "";
      past.length = 0; future = []; snapshot = "";
      updateLyricMeta(); updateStyleMeta(); $("#simple-count").textContent = "0 / 1200";
      save();
      pageIndex = 1;
      await loadClips();
    } catch (error) {
      note.hidden = false;
      note.textContent = error.message;
      toast(error.message);
    } finally {
      button.disabled = false;
      button.innerHTML = original;
    }
  });

  /* ---------- provider polling ---------- */
  const pollTimers = new Map();
  function pollJob(id, attempt = 0) {
    clearTimeout(pollTimers.get(id));
    if (attempt > 90) return;
    pollTimers.set(id, setTimeout(async () => {
      try {
        const fresh = await api(`jobs/${id}/`);
        const index = serverClips.findIndex(item => item.id === id);
        if (index >= 0) serverClips[index] = fresh; else serverClips.unshift(fresh);
        renderClips();
        if (fresh.status === "complete") {
          toast(`${providerLabel(fresh)} ready.`);
          const note = $("#create-note");
          note.hidden = false;
          note.textContent = fresh.provider === "wavespeed"
            ? "Your song is ready. Press play next to the clip to hear it."
            : "A local preview is ready and playable now. Add WAVESPEED_API_KEY to generate AI songs with vocals.";
          return;
        }
        if (fresh.status === "failed") {
          toast(fresh.error || "Generation failed.");
          const note = $("#create-note");
          note.hidden = false;
          note.textContent = fresh.error || "Generation failed.";
          return;
        }
        pollJob(id, attempt + 1);
      } catch {
        pollJob(id, attempt + 1);
      }
    }, 4000));
  }

  function clipTrack(clip) {
    const title = clip.title || clip.prompt.slice(0, 60) || "Untitled sketch";
    return {
      url: clip.audio_url,
      title,
      subtitle: `${providerLabel(clip)} · ${clip.style || "Cadence"}`
    };
  }

  /* ---------- clips ---------- */
  function allClips() {
    const local = localClips().map(clip => ({ ...clip, local: true }));
    const remote = serverClips.map(clip => ({ ...clip, local: false }));
    return [...local, ...remote];
  }
  function statusOf(clip) {
    if (clip.audio_url) return { label: clip.provider === "wavespeed" ? "AI audio" : "Preview ready", className: "audio" };
    if (clip.status === "running" || clip.status === "queued") return { label: "Rendering…", className: "" };
    if (clip.status === "failed") return { label: "Failed", className: "failed" };
    if (clip.status === "draft") return { label: "Saved locally", className: "" };
    return { label: "Prompt saved", className: "" };
  }
  function filtered() {
    const query = state.search.toLowerCase();
    let items = allClips().filter(clip => {
      if (query && !`${clip.title} ${clip.prompt} ${clip.style}`.toLowerCase().includes(query)) return false;
      if (state.filters.includes("audio") && !clip.audio_url) return false;
      if (state.filters.includes("no-audio") && (clip.audio_url || clip.status === "failed")) return false;
      if (state.filters.includes("failed") && clip.status !== "failed") return false;
      return true;
    });
    if (state.sort === "old") items = items.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    else if (state.sort === "title") items = items.slice().sort((a, b) => (a.title || a.prompt).localeCompare(b.title || b.prompt));
    else items = items.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return items;
  }
  function groupLabel(iso) {
    const date = new Date(iso);
    const today = new Date();
    const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
    const same = (a, b) => a.toDateString() === b.toDateString();
    if (same(date, today)) return "Today";
    if (same(date, yesterday)) return "Yesterday";
    return date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" });
  }

  function renderClips() {
    const table = $("#clips-table");
    const items = filtered();
    const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    pageIndex = Math.min(Math.max(1, pageIndex), pages);
    const visible = items.slice((pageIndex - 1) * PAGE_SIZE, pageIndex * PAGE_SIZE);
    $("#clips-count").textContent = `${items.length} ${items.length === 1 ? "song" : "songs"}`;
    $("#clips-page").textContent = String(pageIndex);
    $("#clips-prev").disabled = pageIndex <= 1;
    $("#clips-next").disabled = pageIndex >= pages;
    $("#filter-count").textContent = String(state.filters.length);
    table.classList.toggle("clips-grid-view", state.view === "grid");
    table.innerHTML = "";

    if (!visible.length) {
      const empty = document.createElement("p");
      empty.className = "clips-empty";
      empty.textContent = allClips().length
        ? "No clips match this search or filter."
        : "No clips yet. Describe something above and press Create.";
      table.append(empty);
      return;
    }

    let currentGroup = null;
    visible.forEach(clip => {
      const group = groupLabel(clip.created_at);
      if (group !== currentGroup) {
        currentGroup = group;
        const head = document.createElement("div");
        head.className = "clip-group-head";
        const left = document.createElement("span"); left.textContent = group;
        const right = document.createElement("span"); right.textContent = `${items.filter(item => groupLabel(item.created_at) === group).length} ${items.length === 1 ? "song" : "songs"}`;
        head.append(left, right);
        table.append(head);
      }
      const row = document.createElement("div");
      row.className = "clip-row";

      const art = document.createElement("button");
      art.type = "button"; art.className = "clip-art art-c1";
      art.innerHTML = `▶<span class="clip-len">${Math.floor((clip.duration || 30) / 60)}:${String((clip.duration || 30) % 60).padStart(2, "0")}</span>`;
      art.setAttribute("aria-label", `Play ${clip.title || "clip"}`);
      art.addEventListener("click", () => {
        if (!clip.audio_url) {
          toast(clip.status === "failed" ? "This clip has no audio because generation failed." : "This clip has no audio yet.");
          return;
        }
        const queue = filtered().filter(item => item.audio_url).map(clipTrack);
        player.play(clipTrack(clip), queue);
      });

      const main = document.createElement("div");
      main.className = "clip-main";
      const titleRow = document.createElement("div");
      titleRow.className = "clip-title-row";
      const title = document.createElement("a");
      title.className = "clip-title"; title.href = "#clips";
      title.textContent = clip.title || clip.prompt.slice(0, 60) || "Untitled sketch";
      const status = statusOf(clip);
      const badge = document.createElement("span");
      badge.className = `clip-status ${status.className}`.trim();
      badge.textContent = status.label;
      titleRow.append(title, badge);
      const promptLine = document.createElement("p");
      promptLine.className = "clip-prompt";
      promptLine.textContent = clip.prompt;
      main.append(titleRow, promptLine);

      const actions = document.createElement("div");
      actions.className = "clip-actions";
      const like = document.createElement("button");
      like.type = "button"; like.className = `mini-btn${state.likes[clip.id] ? " on" : ""}`; like.textContent = "♡";
      like.setAttribute("aria-label", `Like ${title.textContent}`);
      like.addEventListener("click", () => { state.likes[clip.id] = !state.likes[clip.id]; save(); renderClips(); });
      const dislike = document.createElement("button");
      dislike.type = "button"; dislike.className = `mini-btn${state.dislikes[clip.id] ? " on" : ""}`; dislike.textContent = "⊘";
      dislike.setAttribute("aria-label", `Dislike ${title.textContent}`);
      dislike.addEventListener("click", () => { state.dislikes[clip.id] = !state.dislikes[clip.id]; save(); renderClips(); });
      const share = document.createElement("button");
      share.type = "button"; share.className = "mini-btn"; share.textContent = "↗";
      share.setAttribute("aria-label", `Share ${title.textContent}`);
      share.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(`${location.origin}/studio?clip=${clip.id}`); toast("Clip link copied."); }
        catch { toast("Copy is unavailable in this browser."); }
      });
      const publish = document.createElement("button");
      publish.type = "button";
      publish.className = `mini-btn${state.published[clip.id] ? " on" : ""}`;
      publish.textContent = state.published[clip.id] ? "Published" : "Publish";
      publish.addEventListener("click", () => {
        state.published[clip.id] = !state.published[clip.id]; save(); renderClips();
        toast(state.published[clip.id] ? "Marked as published in this browser. No public page is created." : "Publishing undone.");
      });
      const more = document.createElement("button");
      more.type = "button"; more.className = "mini-btn"; more.textContent = "⋯";
      more.setAttribute("aria-label", `More options for ${title.textContent}`);
      more.addEventListener("click", () => openClipMenu(more, clip));

      actions.append(like, dislike, share, publish, more);
      row.append(art, main, actions);
      table.append(row);
    });
  }

  function openClipMenu(anchor, clip) {
    $$(".clip-menu").forEach(element => element.remove());
    const menu = document.createElement("div");
    menu.className = "filter-pop clip-menu";
    menu.innerHTML = `<button type="button" class="mini-btn" data-clip-action="studio">Open in studio</button><button type="button" class="mini-btn" data-clip-action="rename">Rename clip</button><button type="button" class="mini-btn" data-clip-action="delete">Delete clip</button>`;
    menu.addEventListener("click", async event => {
      const action = event.target.dataset.clipAction;
      if (!action) return;
      menu.remove();
      if (action === "studio") { location.href = `/studio?clip=${encodeURIComponent(clip.id)}`; return; }
      if (action === "rename") {
        const row = anchor.closest(".clip-row");
        const title = row.querySelector(".clip-title");
        if (!title || row.querySelector(".clip-rename")) return;
        const input = document.createElement("input");
        input.className = "draft-name clip-rename";
        input.maxLength = 120;
        input.value = title.textContent;
        title.replaceWith(input);
        input.focus();
        input.select();
        const commit = async () => {
          const name = input.value.trim();
          if (!name) { input.replaceWith(title); return; }
          if (clip.local) {
            writeLocalClips(localClips().map(item => item.id === clip.id ? { ...item, title: name } : item));
          } else {
            try { await api(`jobs/${clip.id}/`, { method: "PATCH", body: JSON.stringify({ title: name }) }); }
            catch (error) { toast(error.message); }
          }
          toast("Clip renamed.");
          renderClips();
        };
        input.addEventListener("keydown", event => {
          if (event.key === "Enter") { event.preventDefault(); commit(); }
          if (event.key === "Escape") { input.replaceWith(title); }
        });
        input.addEventListener("blur", commit, { once: true });
        return;
      }
      if (action === "delete") {
        if (clip.local) {
          writeLocalClips(localClips().filter(item => item.id !== clip.id));
        } else {
          try { await api(`jobs/${clip.id}/`, { method: "DELETE" }); }
          catch (error) { toast(error.message); return; }
          serverClips = serverClips.filter(item => item.id !== clip.id);
        }
        toast("Clip deleted.");
        renderClips();
      }
    });
    anchor.closest(".clip-row").append(menu);
    menu.style.top = "auto";
    menu.style.bottom = "34px";
    menu.style.right = "10px";
    menu.style.left = "auto";
  }

  $("#clip-search").addEventListener("input", event => { state.search = event.target.value.trim(); pageIndex = 1; save(); renderClips(); });
  $("#sort-clips").addEventListener("change", event => { state.sort = event.target.value; pageIndex = 1; save(); renderClips(); });
  $("#clip-view").addEventListener("click", event => {
    state.view = state.view === "list" ? "grid" : "list";
    event.currentTarget.setAttribute("aria-pressed", String(state.view === "grid"));
    event.currentTarget.querySelector("span").textContent = state.view === "grid" ? "Grid" : "List";
    save(); renderClips();
  });
  $("#filters-btn").addEventListener("click", () => {
    const pop = $("#filter-pop");
    pop.hidden = !pop.hidden;
    $("#filters-btn").setAttribute("aria-expanded", String(!pop.hidden));
  });
  $$("#filter-pop input").forEach(input => input.addEventListener("change", () => {
    state.filters = $$("#filter-pop input").filter(box => box.checked).map(box => box.value);
    pageIndex = 1; save(); renderClips();
  }));
  $("#filters-clear").addEventListener("click", () => {
    $$("#filter-pop input").forEach(box => { box.checked = false; });
    state.filters = []; pageIndex = 1; save(); renderClips();
  });
  $("#clips-prev").addEventListener("click", () => { pageIndex = Math.max(1, pageIndex - 1); save(); renderClips(); });
  $("#clips-next").addEventListener("click", () => { pageIndex += 1; save(); renderClips(); });
  $("#clips-share").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(`${location.origin}/create#clips`); toast("Library link copied."); }
    catch { toast("Copy is unavailable in this browser."); }
  });
  document.addEventListener("click", event => {
    if (!event.target.closest(".filter-wrap")) $("#filter-pop").hidden = true;
    if (!event.target.closest(".clip-menu") && !event.target.closest(".clip-actions")) $$(".clip-menu").forEach(element => element.remove());
  });
  $$("#filter-pop input").forEach(input => { input.checked = state.filters.includes(input.value); });

  async function loadClips() {
    if (authenticated) {
      try { serverClips = await api("jobs/"); }
      catch (error) { toast(error.message); }
    }
    renderClips();
  }

  /* ---------- init ---------- */
  setType(state.type);
  setMode(state.mode);
  paintSegments();
  updateLyricMeta();
  updateStyleMeta();
  $("#simple-count").textContent = `${simplePrompt.value.length} / 1200`;
  $("#clip-search").value = state.search;
  $("#sort-clips").value = state.sort;
  if (state.view === "grid") {
    $("#clip-view").setAttribute("aria-pressed", "true");
    $("#clip-view span").textContent = "Grid";
  }
  loadClips();

  document.addEventListener("keydown", event => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); $("#create-form").requestSubmit(); }
  });
})();
