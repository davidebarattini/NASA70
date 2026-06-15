import { buildNetwork, getPreviewHref } from "./graphData.js";
import { loadProjectsRaw } from "./loadData.js";
import { formatDate } from "./ui.js";
import { initHeaderScroll } from "./headerScroll.js";
import { createGraphController } from "./graph.js";

initHeaderScroll();

const SORT_OPTIONS = [
  { value: "recent", label: "Recent" },
  { value: "oldest", label: "Oldest" },
  { value: "a-z", label: "A–Z" },
  { value: "z-a", label: "Z–A" },
];

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return String(s).replace(/"/g, "&quot;");
}

/** Data di pubblicazione (es. 21/04/2026). */
function formatPublishDate(data) {
  if (!data) return "";
  const { giorno, mese, anno } = data;
  if (giorno == null || mese == null || anno == null) {
    if (anno != null) return String(anno);
    return "";
  }
  const dd = String(giorno).padStart(2, "0");
  const mm = String(mese).padStart(2, "0");
  return `${dd}/${mm}/${anno}`;
}

function projectTimestamp(data) {
  if (!data) return 0;
  const y = Number(data.anno) || 0;
  const m = Number(data.mese) || 0;
  const d = Number(data.giorno) || 0;
  return y * 10000 + m * 100 + d;
}

function compareTitle(a, b) {
  return String(a.titolo || "").localeCompare(String(b.titolo || ""), "it", {
    sensitivity: "base",
  });
}

function sortNodes(nodes, sortBy) {
  const list = [...nodes];
  switch (sortBy) {
    case "z-a":
      return list.sort((a, b) => compareTitle(b, a));
    case "oldest":
      return list.sort((a, b) => {
        const ta = projectTimestamp(a.data);
        const tb = projectTimestamp(b.data);
        if (ta !== tb) return ta - tb;
        return compareTitle(a, b);
      });
    case "a-z":
      return list.sort((a, b) => compareTitle(a, b));
    case "recent":
    default:
      return list.sort((a, b) => {
        const ta = projectTimestamp(a.data);
        const tb = projectTimestamp(b.data);
        if (tb !== ta) return tb - ta;
        return compareTitle(a, b);
      });
  }
}

function renderExploreList(nodes, sortBy) {
  const sorted = sortNodes(nodes, sortBy);

  if (!sorted.length) {
    return '<li class="explore-empty mono">Nessun progetto.</li>';
  }

  return sorted
    .map((node) => {
      const paths = Array.isArray(node.previewPaths) ? node.previewPaths : [];
      const primary = paths[0] ? getPreviewHref(paths[0]) : "";
      const published = formatPublishDate(node.data) || formatDate(node.data);

      const mediaHtml = primary
        ? `<button type="button" class="explore-item__media" aria-expanded="false" aria-label="Apri dettagli di ${escapeAttr(node.titolo || "progetto")}">
            <img class="explore-item__img explore-item__img--primary" src="${escapeAttr(primary)}" alt="" loading="lazy" width="220" height="150">
          </button>`
        : `<button type="button" class="explore-item__media explore-item__media--empty" aria-expanded="false" aria-label="Apri dettagli di ${escapeAttr(node.titolo || "progetto")}"></button>`;

      return `
        <li class="explore-item" id="proj-${escapeAttr(node.id)}">
          <div class="explore-item__row">
            <h2 class="explore-item__title">${escapeHtml(node.titolo || "Senza titolo")}</h2>
            ${node.autore ? `<p class="explore-item__author">${escapeHtml(node.autore)}</p>` : '<p class="explore-item__author explore-item__author--empty" aria-hidden="true">&nbsp;</p>'}
            ${mediaHtml}
            <p class="explore-item__date mono">${escapeHtml(published)}</p>
          </div>
          <div class="explore-item__expand">
            <div class="explore-item__expandInner">
              <p class="explore-item__desc">${escapeHtml(node.descrizione || "")}</p>
              <div class="explore-item__actions">
                ${
                  node.url
                    ? `<a class="explore-item__link explore-item__link--primary mono" href="${escapeAttr(node.url)}" target="_blank" rel="noopener noreferrer">Apri progetto</a>`
                    : ""
                }
                <a class="explore-item__link mono" href="explore.html?focus=${escapeAttr(node.id)}">Mostra collegamenti</a>
              </div>
            </div>
          </div>
        </li>`;
    })
    .join("");
}

function setupListItemToggle(listEl) {
  if (!listEl) return;

  listEl.addEventListener("click", (e) => {
    const media = e.target.closest(".explore-item__media");
    if (!media || !listEl.contains(media)) return;

    const item = media.closest(".explore-item");
    if (!item) return;

    const willOpen = !item.classList.contains("explore-item--open");
    listEl.querySelectorAll(".explore-item--open").forEach((el) => {
      el.classList.remove("explore-item--open");
      el.querySelector(".explore-item__media")?.setAttribute("aria-expanded", "false");
    });

    if (willOpen) {
      item.classList.add("explore-item--open");
      media.setAttribute("aria-expanded", "true");
    }
  });
}

function filterNodesBySearch(nodes, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return nodes;
  return nodes.filter((node) => {
    const title = String(node.titolo || "").toLowerCase();
    const author = String(node.autore || "").toLowerCase();
    return title.includes(q) || author.includes(q);
  });
}

function setupSortFilter({
  toolbarEl,
  triggerEl,
  valueEl,
  panelEl,
  listboxEl,
  listEl,
  searchInputEl,
  allNodes,
}) {
  if (!triggerEl || !valueEl || !panelEl || !listboxEl || !listEl) {
    toolbarEl?.setAttribute("hidden", "");
    return;
  }

  toolbarEl?.removeAttribute("hidden");

  let selected = "recent";
  let searchQuery = "";

  function labelFor(value) {
    return SORT_OPTIONS.find((o) => o.value === value)?.label || "Recent";
  }

  function renderOptions() {
    listboxEl.innerHTML = SORT_OPTIONS.map(
      (entry) => `
        <li class="explore-sortFilter__item" role="presentation">
          <button
            type="button"
            class="explore-sortFilter__option mono${entry.value === selected ? " is-active" : ""}"
            role="option"
            aria-selected="${entry.value === selected ? "true" : "false"}"
            data-value="${escapeAttr(entry.value)}"
          >${escapeHtml(entry.label)}</button>
        </li>`
    ).join("");
  }

  function applySort() {
    valueEl.textContent = labelFor(selected);
    renderOptions();
    const visible = filterNodesBySearch(allNodes, searchQuery);
    listEl.innerHTML = renderExploreList(visible, selected);
  }

  function setOpen(open) {
    toolbarEl?.classList.toggle("is-open", open);
    triggerEl.setAttribute("aria-expanded", open ? "true" : "false");
  }

  triggerEl.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(!toolbarEl.classList.contains("is-open"));
  });

  listboxEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".explore-sortFilter__option");
    if (!btn || !listboxEl.contains(btn)) return;
    selected = btn.getAttribute("data-value") ?? "recent";
    applySort();
    setOpen(false);
  });

  searchInputEl?.addEventListener("input", () => {
    searchQuery = searchInputEl.value;
    applySort();
  });

  document.addEventListener("click", (e) => {
    if (toolbarEl && !toolbarEl.contains(e.target)) setOpen(false);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });

  applySort();
}

// Quando si torna alla Project List da "Torna alla Project List" (anteprima
// EXPLORE), l'URL contiene #proj-<id>: scorri fino a quel progetto e
// evidenzialo brevemente.
function scrollToFocusedProject() {
  const hash = location.hash;
  if (!hash || !hash.startsWith("#proj-")) return;
  let target = null;
  try {
    target = document.getElementById(hash.slice(1));
  } catch {
    target = null;
  }
  if (!target) return;
  requestAnimationFrame(() => {
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("explore-item--focused");
    target.classList.add("explore-item--open");
    target.querySelector(".explore-item__media")?.setAttribute("aria-expanded", "true");
    setTimeout(() => target.classList.remove("explore-item--focused"), 1600);
  });
}

async function main() {
  const listEl = document.getElementById("explore-list");
  const statusEl = document.getElementById("explore-status");
  const toolbarEl = document.getElementById("explore-toolbar");
  const triggerEl = document.getElementById("explore-sort-trigger");
  const valueEl = document.getElementById("explore-sort-value");
  const panelEl = document.getElementById("explore-sort-panel");
  const listboxEl = document.getElementById("explore-sort-list");
  const searchInputEl = document.getElementById("explore-search-input");
  const heroSvg = document.getElementById("hero-graph-svg");

  // Lo stesso script serve sia la Home (solo grafo hero) sia la scheda
  // "Project List" (solo lista). Se non c'è né lista né hero, non fare nulla.
  if (!listEl && !heroSvg) return;

  if (statusEl) statusEl.hidden = false;

  try {
    const raw = await loadProjectsRaw();
    const model = buildNetwork(raw);
    if (listEl) {
      setupListItemToggle(listEl);
      setupSortFilter({
        toolbarEl,
        triggerEl,
        valueEl,
        panelEl,
        listboxEl,
        listEl,
        searchInputEl,
        allNodes: model.nodes,
      });
      scrollToFocusedProject();
    }
    if (statusEl) statusEl.hidden = true;
    setupHeroDecorativeGraph(model);
  } catch (err) {
    console.error(err);
    if (statusEl) {
      const detail = err instanceof Error ? err.message : String(err);
      statusEl.textContent = detail || "Errore caricamento archivio.";
      statusEl.hidden = false;
    }
  }
}

/**
 * Inizializza il grafo decorativo nella hero (PROJECTS).
 * Non interattivo: nessun hover/click callback, e l'SVG ha
 * `pointer-events: none` via CSS, quindi è solo un'anteprima visiva
 * dello stesso layout della pagina Explore.
 */
function setupHeroDecorativeGraph(model) {
  const svg = document.getElementById("hero-graph-svg");
  if (!svg || !model) return;
  // Mostra tutti i progetti anche nella hero (PROJECTS).
  const decorModel = model;
  // Attendi il prossimo paint così l'SVG ha dimensioni reali (`clientWidth/Height`).
  requestAnimationFrame(() => {
    try {
      const graph = createGraphController({
        svg,
        fullModel: decorModel,
        decorative: true,
      });
      graph.rebuild();
    } catch (err) {
      console.warn("Hero decorative graph init failed:", err);
    }
  });
}

main();
