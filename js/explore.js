import { buildNetwork, getPreviewHref } from "./graphData.js";
import { loadProjectsRaw } from "./loadData.js";
import { formatDate, formatPublishDate } from "./ui.js?v=back-cta-always";
import { initHeaderScroll } from "./headerScroll.js";

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

function cardTagsHtml(node) {
  const labels = (node.tagsDisplay?.length ? node.tagsDisplay : node.tagsNorm || [])
    .map((t) => String(t).trim())
    .filter(Boolean);
  if (!labels.length) {
    return '<p class="explore-card__tags"><span class="explore-card__tagsLabel">Tags:</span> Nessun tag</p>';
  }
  return `<p class="explore-card__tags"><span class="explore-card__tagsLabel">Tags:</span> ${labels.map((l) => escapeHtml(l)).join(", ")}</p>`;
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

      const heroHtml = primary
        ? `<div class="explore-card__heroWrap">
            <img class="explore-card__hero" src="${escapeAttr(primary)}" alt="" loading="lazy" width="220" height="150">
          </div>`
        : `<div class="explore-card__heroWrap explore-card__heroWrap--empty"></div>`;

      return `
        <li class="explore-card" id="proj-${escapeAttr(node.id)}">
          ${heroHtml}
          <h2 class="explore-card__title">${escapeHtml(node.titolo || "Senza titolo")}</h2>
          ${
            node.autore || published
              ? `<p class="explore-card__author">${escapeHtml(node.autore || "")}${node.autore && published ? " · " : ""}${escapeHtml(published || "")}</p>`
              : ""
          }
          ${cardTagsHtml(node)}
          <div class="explore-card__descWrap">
            <p class="explore-card__desc">${escapeHtml(node.descrizione || "")}</p>
            <span class="explore-card__descFade" aria-hidden="true">…</span>
          </div>
          <div class="explore-card__actions">
            ${
              node.url
                ? `<a class="explore-card__cta explore-card__cta--primary" href="${escapeAttr(node.url)}" target="_blank" rel="noopener noreferrer">
                    <span class="explore-card__ctaLabel">Open Project</span>
                    <span class="explore-card__ctaArrow" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" focusable="false"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </span>
                  </a>`
                : ""
            }
            <a class="explore-card__cta explore-card__cta--secondary" href="explore.html?focus=${escapeAttr(node.id)}">
              <span class="explore-card__ctaLabel">View in Connections</span>
              <span class="explore-card__ctaParticles" aria-hidden="true"><span></span><span></span><span></span><span></span></span>
            </a>
          </div>
        </li>`;
    })
    .join("");
}

/** "…" di fondo sulla descrizione: visibile solo se il testo non entra
 *  tutto in 4 righe, e solo finché non si inizia a scrollare. Il listener
 *  di scroll va agganciato UNA volta sola su `listEl` (in cattura, perché
 *  "scroll" non risale/bubbla fino al genitore): ritorna una funzione
 *  `refresh` da richiamare ad ogni nuovo render (sort/ricerca) per
 *  ricalcolare quali descrizioni hanno davvero bisogno della "…".
 */
function setupDescScroll(listEl) {
  if (!listEl) return () => {};

  function refresh() {
    listEl.querySelectorAll(".explore-card__descWrap").forEach((wrap) => {
      const desc = wrap.querySelector(".explore-card__desc");
      if (!desc) return;
      const hasOverflow = desc.scrollHeight > desc.clientHeight + 1;
      wrap.classList.toggle("explore-card__descWrap--noOverflow", !hasOverflow);
    });
  }

  listEl.addEventListener(
    "scroll",
    (e) => {
      const desc = e.target;
      if (!desc.classList?.contains("explore-card__desc")) return;
      desc
        .closest(".explore-card__descWrap")
        ?.classList.toggle("explore-card__descWrap--scrolled", desc.scrollTop > 1);
    },
    true,
  );

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(refresh, 150);
  });

  return refresh;
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

  const refreshDescOverflow = setupDescScroll(listEl);

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
    refreshDescOverflow();
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
    target.classList.add("explore-card--focused");
    setTimeout(() => target.classList.remove("explore-card--focused"), 1600);
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

  // La Home ha ora il suo grafo (decorativo→interattivo) gestito da
  // main.js, vedi index.html/explore.html: questo script serve solo più la
  // scheda "Project List".
  if (!listEl) return;

  if (statusEl) statusEl.hidden = false;

  try {
    const raw = await loadProjectsRaw();
    const model = buildNetwork(raw);
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
    if (statusEl) statusEl.hidden = true;
  } catch (err) {
    console.error(err);
    if (statusEl) {
      const detail = err instanceof Error ? err.message : String(err);
      statusEl.textContent = detail || "Errore caricamento archivio.";
      statusEl.hidden = false;
    }
  }
}

main();
