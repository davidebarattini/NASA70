// HTML/DOM controller: nav between systems, info card, tooltip, hash sync.

export function createUIController({
  systems,
  onEnterCategory,
  onBackToMain,
  onClose,
}) {
  const elements = {
    title: document.getElementById("categoryTitle"),
    titleName: document.querySelector(".category-title__name"),
    dots: document.getElementById("systemDots"),
    prev: document.getElementById("prevSystem"),
    next: document.getElementById("nextSystem"),
    tooltip: document.getElementById("hudTooltip"),
    infoCard: document.getElementById("infoCard"),
    infoCardClose: document.getElementById("infoCardClose"),
    infoThumb: document.getElementById("infoCardThumb"),
    infoAuthor: document.getElementById("infoCardAuthor"),
    infoTitle: document.getElementById("infoCardTitle"),
    infoDate: document.getElementById("infoCardDate"),
    infoDescription: document.getElementById("infoCardDescription"),
    infoTags: document.getElementById("infoCardTags"),
    infoCta: document.getElementById("infoCardCta"),
    canvas: document.getElementById("scene"),
    logoHome: document.getElementById("logoHome"),
  };

  let activeCategoryIndex = 0;
  let mode = "main"; // "main" | "category"

  function buildDots() {
    elements.dots.innerHTML = "";
    systems.forEach((system, index) => {
      const li = document.createElement("li");
      li.className = "system-nav__dot";
      li.dataset.label = system.category.label;
      li.style.setProperty("--dot-color", system.category.color);

      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "tab");
      button.setAttribute("aria-label", system.category.label);
      button.addEventListener("click", () => {
        if (index !== activeCategoryIndex || mode !== "category") {
          enterCategory(index);
        }
      });
      li.appendChild(button);
      elements.dots.appendChild(li);
    });
    syncDotsState();
  }

  function syncDotsState() {
    const dots = elements.dots.querySelectorAll(".system-nav__dot");
    dots.forEach((dot, index) => {
      dot.classList.toggle("is-active", mode === "category" && index === activeCategoryIndex);
      dot.querySelector("button")?.setAttribute(
        "aria-selected",
        mode === "category" && index === activeCategoryIndex ? "true" : "false",
      );
    });
  }

  function setMode(nextMode, { animate = true } = {}) {
    if (mode === nextMode) return;
    mode = nextMode;
    syncDotsState();
    updateTitle({ animate });
    updateHash();
  }

  function updateTitle({ animate }) {
    const category = mode === "main"
      ? { label: "Categorie", accent: "rgba(110, 168, 255, 0.35)", id: "main" }
      : systems[activeCategoryIndex]?.category;
    if (!category) return;
    if (animate) {
      elements.title.classList.add("is-changing");
      setTimeout(() => {
        elements.titleName.textContent = category.label;
        elements.title.style.setProperty("--cat-glow", category.accent ?? "rgba(110, 168, 255, 0.35)");
        elements.title.classList.remove("is-changing");
      }, 200);
    } else {
      elements.titleName.textContent = category.label;
      elements.title.style.setProperty("--cat-glow", category.accent ?? "rgba(110, 168, 255, 0.35)");
    }
  }

  function updateHash() {
    if (mode === "main") {
      history.replaceState(null, "", "#");
      return;
    }
    const system = systems[activeCategoryIndex];
    if (!system) return;
    history.replaceState(null, "", `#${system.category.id}`);
  }

  function enterCategory(index) {
    const clamped = ((index % systems.length) + systems.length) % systems.length;
    activeCategoryIndex = clamped;
    setMode("category");
    onEnterCategory?.(clamped);
  }

  function backToMain() {
    setMode("main");
    onBackToMain?.();
    closeInfoCard();
  }

  function next() {
    enterCategory(activeCategoryIndex + 1);
  }
  function prev() {
    enterCategory(activeCategoryIndex - 1);
  }

  elements.next.addEventListener("click", next);
  elements.prev.addEventListener("click", prev);
  elements.logoHome.addEventListener("click", (event) => {
    event.preventDefault();
    backToMain();
  });

  document.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLElement && /input|textarea/i.test(event.target.tagName)) {
      return;
    }
    if (event.key === "ArrowRight") {
      next();
    } else if (event.key === "ArrowLeft") {
      prev();
    } else if (event.key === "Escape") {
      if (mode === "category") backToMain();
      else closeInfoCard();
    }
  });

  // Touch swipe support on the canvas.
  let touchStart = null;
  elements.canvas.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length === 1) {
        touchStart = {
          x: event.touches[0].clientX,
          y: event.touches[0].clientY,
          t: performance.now(),
        };
      }
    },
    { passive: true },
  );
  elements.canvas.addEventListener(
    "touchend",
    (event) => {
      if (!touchStart) return;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - touchStart.x;
      const dy = touch.clientY - touchStart.y;
      const dt = performance.now() - touchStart.t;
      touchStart = null;
      // Horizontal swipe with reasonable speed and dominant horizontal motion.
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 700) {
        if (dx < 0) next();
        else prev();
      }
    },
    { passive: true },
  );

  function showTooltip(payload) {
    if (!payload) {
      elements.tooltip.classList.remove("is-visible");
      return;
    }
    const label =
      payload.kind === "category" ? payload.category?.label : payload.project?.title;
    if (!label) {
      elements.tooltip.classList.remove("is-visible");
      return;
    }
    elements.tooltip.textContent = label;
    elements.tooltip.style.left = `${payload.clientX}px`;
    elements.tooltip.style.top = `${payload.clientY}px`;
    elements.tooltip.classList.add("is-visible");
  }

  function openInfoCard(project) {
    if (!project) return;
    elements.infoAuthor.textContent = project.author || "Autore sconosciuto";
    elements.infoTitle.textContent = project.title;
    elements.infoDate.textContent = project.date || "";
    elements.infoDescription.textContent = project.description || "";

    if (project.image) {
      elements.infoThumb.style.backgroundImage = `url(${JSON.stringify(project.image)})`;
      elements.infoThumb.style.display = "block";
    } else {
      elements.infoThumb.style.backgroundImage = "";
      elements.infoThumb.style.display = "none";
    }

    elements.infoTags.innerHTML = "";
    (project.tags || []).slice(0, 8).forEach((tag) => {
      const li = document.createElement("li");
      li.textContent = tag;
      elements.infoTags.appendChild(li);
    });

    elements.infoCta.href = project.url || "#";
    const system = systems[activeCategoryIndex];
    if (mode === "category" && system) {
      elements.infoCard.style.setProperty("--cat-color", system.category.color);
    }

    elements.infoCard.classList.add("is-open");
    elements.infoCard.setAttribute("aria-hidden", "false");
  }

  function closeInfoCard() {
    elements.infoCard.classList.remove("is-open");
    elements.infoCard.setAttribute("aria-hidden", "true");
    onClose?.();
  }

  elements.infoCardClose.addEventListener("click", closeInfoCard);

  function applyInitialFromHash() {
    const hash = window.location.hash.replace("#", "");
    if (!hash) return;
    const idx = systems.findIndex((s) => s.category.id === hash);
    if (idx >= 0) {
      activeCategoryIndex = idx;
      mode = "category";
    }
  }

  applyInitialFromHash();

  return {
    init() {
      buildDots();
      updateTitle({ animate: false });
      updateHash();
    },
    getInitialMode() {
      return mode;
    },
    getActiveCategoryIndex() {
      return activeCategoryIndex;
    },
    setMode,
    enterCategory,
    backToMain,
    showTooltip,
    openInfoCard,
    closeInfoCard,
  };
}
