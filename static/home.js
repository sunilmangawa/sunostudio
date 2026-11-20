// Home page: hero composer, spotlight carousel, rails, and search.
(() => {
  const { $, $$, toast, player } = window.Cadence;

  const prompt = $("#hero-prompt");
  const createButton = $("#hero-create");
  const instrumental = $("#hero-instrumental");
  const audioFile = $("#hero-file");

  const resize = () => {
    if (!prompt) return;
    prompt.style.height = "auto";
    prompt.style.height = `${Math.min(prompt.scrollHeight, 120)}px`;
    createButton.disabled = !prompt.value.trim();
  };
  prompt?.addEventListener("input", resize);
  prompt?.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); $("#hero-composer").requestSubmit(); }
  });
  instrumental?.addEventListener("click", () => {
    const on = instrumental.getAttribute("aria-pressed") !== "true";
    instrumental.setAttribute("aria-pressed", String(on));
    instrumental.classList.toggle("on", on);
  });
  $("#hero-audio")?.addEventListener("click", () => audioFile?.click());
  audioFile?.addEventListener("change", event => {
    const file = event.target.files[0];
    if (!file) return;
    toast(`${file.name} attached for this session. Audio guidance needs a connected provider.`);
    event.target.value = "";
  });
  $("#hero-composer")?.addEventListener("submit", event => {
    event.preventDefault();
    const text = prompt?.value.trim() || "";
    if (!text) { prompt?.focus(); return; }
    const params = new URLSearchParams({ prompt: text });
    if (instrumental?.getAttribute("aria-pressed") === "true") params.set("instrumental", "1");
    location.href = `/create?${params.toString()}`;
  });
  resize();

  // Spotlight carousel.
  const slides = $$(".spotlight-slide");
  const dots = $$(".spotlight-dot");
  let slideIndex = 0;
  let slideTimer;
  function showSlide(index) {
    slideIndex = (index + slides.length) % slides.length;
    slides.forEach((slide, position) => { slide.hidden = position !== slideIndex; });
    dots.forEach((dot, position) => dot.classList.toggle("active", position === slideIndex));
  }
  function autoAdvance() {
    clearInterval(slideTimer);
    slideTimer = setInterval(() => showSlide(slideIndex + 1), 9000);
  }
  dots.forEach(dot => dot.addEventListener("click", () => { showSlide(Number(dot.dataset.goto)); autoAdvance(); }));
  $(".spotlight")?.addEventListener("mouseenter", () => clearInterval(slideTimer));
  $(".spotlight")?.addEventListener("mouseleave", autoAdvance);
  if (slides.length) autoAdvance();

  function trackFor(card) {
    return {
      url: card?.dataset.audio || "",
      title: card?.dataset.title || "Cadence track",
      subtitle: `${card?.dataset.artist || "Cadence"} · ${card?.dataset.genre || "Preview"}`
    };
  }
  function queueFor(container) {
    return $$(".song-card", container).map(trackFor).filter(track => track.url);
  }

  // Horizontal rails.
  $$("[data-rail]").forEach(rail => {
    const track = $(".rail-track", rail);
    const previous = $(".rail-arrow.prev", rail);
    const next = $(".rail-arrow.next", rail);
    if (!track) return;
    const updateArrows = () => {
      const max = track.scrollWidth - track.clientWidth - 2;
      if (previous) previous.disabled = track.scrollLeft <= 2;
      if (next) next.disabled = track.scrollLeft >= max;
    };
    const scrollByPage = direction => {
      const delta = Math.max(180, Math.round(track.clientWidth * .8)) * direction;
      track.scrollBy({ left: delta, behavior: "instant" });
      updateArrows();
    };
    previous?.addEventListener("click", () => scrollByPage(-1));
    next?.addEventListener("click", () => scrollByPage(1));
    track.addEventListener("scroll", updateArrows, { passive: true });
    window.addEventListener("resize", updateArrows);
    updateArrows();

    $(".rail-play", rail)?.addEventListener("click", () => {
      const queue = queueFor(rail);
      if (!queue.length) { toast("Nothing to play in this shelf yet."); return; }
      player.play(queue[0], queue);
    });
  });

  // Card actions.
  document.addEventListener("click", async event => {
    const play = event.target.closest("[data-play]");
    if (play) {
      const card = play.closest(".song-card");
      const rail = play.closest("[data-rail]");
      player.play(trackFor(card), rail ? queueFor(rail) : [trackFor(card)]);
      return;
    }
    const album = event.target.closest(".album-art");
    if (album) {
      const card = album.closest(".album-card");
      player.play(trackFor(card), [trackFor(card)]);
      return;
    }
    const remix = event.target.closest("[data-remix]");
    if (remix) {
      const card = remix.closest(".song-card");
      location.href = `/create?style=${encodeURIComponent(card?.querySelector(".song-genre")?.textContent || "")}&prompt=${encodeURIComponent(`A remix in the spirit of ${card?.dataset.title || "this track"} — keep the mood, change the frame.`)}`;
      return;
    }
    const menu = event.target.closest("[data-menu]");
    $$(".card-menu").forEach(element => element.remove());
    if (menu) {
      const card = menu.closest(".song-card");
      const pop = document.createElement("div");
      pop.className = "card-menu";
      pop.innerHTML = `<button type="button" data-menu-action="inspire">Use as inspiration</button><button type="button" data-menu-action="copy">Copy link</button>`;
      pop.addEventListener("click", async menuEvent => {
        const action = menuEvent.target.dataset.menuAction;
        if (!action) return;
        if (action === "inspire") {
          location.href = `/create?style=${encodeURIComponent(card?.querySelector(".song-genre")?.textContent || "")}&prompt=${encodeURIComponent(`${card?.querySelector(".song-title")?.textContent || "This track"} — take this feeling somewhere new.`)}`;
        }
        if (action === "copy") {
          try { await navigator.clipboard.writeText(location.href); toast("Link copied."); } catch { toast("Copy is unavailable in this browser."); }
        }
        pop.remove();
      });
      menu.parentElement.append(pop);
      event.stopPropagation();
    }
  });
  document.addEventListener("click", event => {
    if (!event.target.closest(".card-menu") && !event.target.closest("[data-menu]")) $$(".card-menu").forEach(element => element.remove());
  });

  // Search filters curated cards on this page.
  const search = $("#home-search");
  search?.addEventListener("input", () => {
    const query = search.value.trim().toLowerCase();
    $$(".rail").forEach(rail => {
      let visible = 0;
      $$(".song-card, .album-card", rail).forEach(card => {
        const match = !query || card.textContent.toLowerCase().includes(query);
        card.hidden = !match;
        if (match) visible += 1;
      });
      const empty = $(".rail-empty", rail);
      if (empty) empty.remove();
      if (!visible && rail.querySelector(".song-card, .album-card")) {
        const note = document.createElement("p");
        note.className = "rail-empty";
        note.textContent = "Nothing in this shelf matches your search.";
        $(".rail-track, .album-grid", rail)?.after(note);
      }
    });
  });
})();
