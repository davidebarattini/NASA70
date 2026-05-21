import { buildNetwork, getPreviewHref } from "./graphData.js";
import { formatDate } from "./ui.js";
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
      const secondary = paths[1] ? getPreviewHref(paths[1]) : primary;
      const hasSecond = paths.length > 1;
      const published = formatPublishDate(node.data) || formatDate(node.data);

      const mediaHtml = primary
        ? `<figure class="explore-item__media">
            <img class="explore-item__img explore-item__img--primary" src="${escapeAttr(primary)}" alt="" loading="lazy" width="220" height="150">
            ${
              hasSecond
                ? `<img class="explore-item__img explore-item__img--secondary" src="${escapeAttr(secondary)}" alt="" loading="lazy" width="220" height="150" aria-hidden="true">`
                : ""
            }
          </figure>`
        : `<figure class="explore-item__media explore-item__media--empty" aria-hidden="true"></figure>`;

      return `
        <li class="explore-item${hasSecond ? " explore-item--dual" : ""}" tabindex="0">
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
                    ? `<a class="explore-item__link mono" href="${escapeAttr(node.url)}" target="_blank" rel="noopener noreferrer">Apri progetto</a>`
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

function setupSortFilter({ toolbarEl, triggerEl, valueEl, panelEl, listboxEl, listEl, allNodes }) {
  if (!triggerEl || !valueEl || !panelEl || !listboxEl || !listEl) {
    toolbarEl?.setAttribute("hidden", "");
    return;
  }

  toolbarEl?.removeAttribute("hidden");

  let selected = "recent";

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
    listEl.innerHTML = renderExploreList(allNodes, selected);
  }

  function setOpen(open) {
    toolbarEl.classList.toggle("is-open", open);
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

  document.addEventListener("click", (e) => {
    if (!toolbarEl.contains(e.target)) setOpen(false);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });

  applySort();
}

async function main() {
  const listEl = document.getElementById("explore-list");
  const statusEl = document.getElementById("explore-status");
  const toolbarEl = document.getElementById("explore-toolbar");
  const triggerEl = document.getElementById("explore-sort-trigger");
  const valueEl = document.getElementById("explore-sort-value");
  const panelEl = document.getElementById("explore-sort-panel");
  const listboxEl = document.getElementById("explore-sort-list");
  if (!listEl) return;

  statusEl.hidden = false;

  try {
    const res = await fetch("data.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`Impossibile caricare data.json (${res.status})`);
    const raw = await res.json();
    const model = buildNetwork(raw);
    setupSortFilter({
      toolbarEl,
      triggerEl,
      valueEl,
      panelEl,
      listboxEl,
      listEl,
      allNodes: model.nodes,
    });
    statusEl.hidden = true;
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Errore caricamento archivio.";
    statusEl.hidden = false;
  }
}

main();
