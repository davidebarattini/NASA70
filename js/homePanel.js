export function createHomePanel({ categories, initialState, onChange }) {
  const els = {
    panel: document.getElementById("controlPanel"),
    toggle: document.getElementById("panelToggle"),
    modeCategories: document.getElementById("modeCategories"),
    modeProjects: document.getElementById("modeProjects"),
    rings: document.getElementById("ringsSlider"),
    ringsValue: document.getElementById("ringsValue"),
    planetSize: document.getElementById("planetSizeSlider"),
    planetSizeValue: document.getElementById("planetSizeValue"),
    list: document.getElementById("categoryList"),
    selectAll: document.getElementById("selectAllCategories"),
  };

  const state = {
    mode: initialState?.mode ?? "categories", // "categories" | "projects"
    ringCount: clampInt(initialState?.ringCount ?? 3, 1, 6),
    planetScale: clampFloat(initialState?.planetScale ?? 1, 0.6, 1.6),
    selectedCategoryIds: new Set(initialState?.selectedCategoryIds ?? categories.map((c) => c.id)),
    collapsed: Boolean(initialState?.collapsed ?? false),
  };

  function emit() {
    onChange?.({
      mode: state.mode,
      ringCount: state.ringCount,
      planetScale: state.planetScale,
      selectedCategoryIds: new Set(state.selectedCategoryIds),
    });
  }

  function setMode(mode) {
    state.mode = mode;
    els.modeCategories.classList.toggle("is-active", mode === "categories");
    els.modeProjects.classList.toggle("is-active", mode === "projects");
    emit();
  }

  function setRingCount(value) {
    state.ringCount = clampInt(value, 1, 6);
    els.rings.value = String(state.ringCount);
    els.ringsValue.textContent = String(state.ringCount);
    emit();
  }

  function setPlanetScale(value) {
    // slider uses 60..160 (percent)
    const scale = clampFloat(Number(value) / 100, 0.6, 1.6);
    state.planetScale = scale;
    if (els.planetSize) els.planetSize.value = String(Math.round(scale * 100));
    if (els.planetSizeValue) els.planetSizeValue.textContent = `${Math.round(scale * 100)}%`;
    emit();
  }

  function setCollapsed(value) {
    state.collapsed = Boolean(value);
    els.panel.classList.toggle("is-collapsed", state.collapsed);
  }

  function buildCategoryList() {
    els.list.innerHTML = "";
    for (const c of categories) {
      const row = document.createElement("div");
      row.className = "category-item";

      const left = document.createElement("div");
      left.className = "category-item__left";

      const dot = document.createElement("span");
      dot.className = "category-item__dot";
      dot.style.setProperty("--dot-color", c.color);

      const name = document.createElement("span");
      name.className = "category-item__name";
      name.textContent = c.label;

      left.appendChild(dot);
      left.appendChild(name);

      const toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.className = "toggle";
      toggle.checked = state.selectedCategoryIds.has(c.id);
      toggle.addEventListener("change", () => {
        if (toggle.checked) state.selectedCategoryIds.add(c.id);
        else state.selectedCategoryIds.delete(c.id);
        emit();
      });

      row.appendChild(left);
      row.appendChild(toggle);
      els.list.appendChild(row);
    }
  }

  els.toggle.addEventListener("click", () => setCollapsed(!state.collapsed));
  els.modeCategories.addEventListener("click", () => setMode("categories"));
  els.modeProjects.addEventListener("click", () => setMode("projects"));
  els.rings.addEventListener("input", (e) => setRingCount(e.target.value));
  els.planetSize?.addEventListener("input", (e) => setPlanetScale(e.target.value));
  els.selectAll.addEventListener("click", () => {
    state.selectedCategoryIds = new Set(categories.map((c) => c.id));
    buildCategoryList();
    emit();
  });

  buildCategoryList();
  setRingCount(state.ringCount);
  setPlanetScale(state.planetScale * 100);
  setMode(state.mode);
  setCollapsed(state.collapsed);

  return {
    getState() {
      return {
        mode: state.mode,
        ringCount: state.ringCount,
        planetScale: state.planetScale,
        selectedCategoryIds: new Set(state.selectedCategoryIds),
      };
    },
  };
}

function clampInt(value, min, max) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function clampFloat(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

