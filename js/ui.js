import { getPreviewHref, LEGEND_TAG_TOP_COUNT } from "./graphData.js";

const EXCERPT_LEN = 220;

export function excerpt(text) {
  if (!text) return "";
  const t = text.trim();
  if (t.length <= EXCERPT_LEN) return t;
  return `${t.slice(0, EXCERPT_LEN).trim()}…`;
}

export function formatDate(data) {
  if (!data) return "";
  const { giorno, mese, anno } = data;
  if (giorno == null || mese == null || anno == null) return "";
  const mm = String(mese).padStart(2, "0");
  const dd = String(giorno).padStart(2, "0");
  return `${anno}-${mm}-${dd}`;
}

/**
 * @param {HTMLElement} container
 * @param {{ tag: string; color?: string }[]} topTags da `legend.tags` (stesso ordinamento della legenda)
 * @param {(tag: string|null) => void} onSelect tag normalizzato o null per «Tutti»
 */
export function setupFilters(container, topTags, onSelect) {
  if (!container) return { setActive() {}, updateTags() {} };

  function renderPills(tags) {
    container.innerHTML = "";

    const allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.className = "filter-pill";
    allBtn.innerHTML = `<span class="filter-pill__label">ALL PROJECTS</span>`;
    allBtn.setAttribute("data-tag", "");
    container.appendChild(allBtn);

    const tagCluster = document.createElement("div");
    tagCluster.className = "filters__tags";
    container.appendChild(tagCluster);

    for (const t of tags || []) {
      const tag = String(t.tag ?? "").trim();
      if (!tag) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "filter-pill filter-pill--tag";
      const color = t.color || "rgba(232,234,239,0.65)";
      b.style.setProperty("--pill-color", color);
      b.title = tag;
      b.innerHTML = `<span class="filter-pill__label mono">${escapeHtml(tag)}</span>`;
      b.setAttribute("data-tag", tag);
      tagCluster.appendChild(b);
    }
  }

  function setActive(tag) {
    const buttons = container.querySelectorAll(".filter-pill");
    buttons.forEach((btn) => {
      const raw = btn.getAttribute("data-tag");
      const id = raw === null || raw === "" ? null : raw;
      const active = tag == null ? id == null : id === tag;
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  if (!container.dataset.filtersBound) {
    container.dataset.filtersBound = "1";
    container.addEventListener("click", (e) => {
      const btn = e.target.closest(".filter-pill");
      if (!btn || !container.contains(btn)) return;
      const raw = btn.getAttribute("data-tag");
      const selected = raw === null || raw === "" ? null : raw;
      setActive(selected);
      onSelect(selected);
    });
  }

  renderPills(topTags);
  setActive(null);

  return {
    setActive,
    updateTags(tags, activeTag = null) {
      renderPills(tags);
      setActive(activeTag);
    },
  };
}

/**
 * Link «Apri progetto esterno» che segue il cursore sopra il puntatore (Top 10).
 * @param {HTMLElement} el
 */
export function setupCursorCta(el) {
  const link = el?.querySelector("a");
  if (!link) return { show() {}, move() {}, hide() {} };

  let visible = false;
  let lastNodeId = null;

  function position(clientX, clientY) {
    const pad = 12;
    const gap = 14;
    el.hidden = false;
    const rect = el.getBoundingClientRect();
    let x = clientX - rect.width / 2;
    let y = clientY - rect.height - gap;
    if (x < pad) x = pad;
    if (x + rect.width > window.innerWidth - pad) {
      x = window.innerWidth - pad - rect.width;
    }
    if (y < pad) y = clientY + gap;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }

  return {
    show(node, event) {
      if (!node?.url || !event) {
        visible = false;
        lastNodeId = null;
        el.hidden = true;
        return;
      }
      const nid = node.id ?? null;
      if (nid !== lastNodeId) {
        link.href = node.url;
        lastNodeId = nid;
      }
      visible = true;
      el.hidden = false;
      position(event.clientX, event.clientY);
    },
    move(event) {
      if (!visible || !event) return;
      position(event.clientX, event.clientY);
    },
    hide() {
      visible = false;
      lastNodeId = null;
      el.hidden = true;
    },
  };
}

/**
 * @param {HTMLElement} el
 */
export function setupTooltip(el) {
  let visible = false;
  let lastNodeId = null;

  function position(clientX, clientY) {
    const pad = 16;
    const rect = el.getBoundingClientRect();
    let x = clientX + pad;
    let y = clientY + pad;
    if (x + rect.width > window.innerWidth - pad) x = clientX - rect.width - pad;
    if (y + rect.height > window.innerHeight - pad) y = clientY - rect.height - pad;
    el.style.left = `${Math.max(pad, x)}px`;
    el.style.top = `${Math.max(pad, y)}px`;
  }

  return {
    show(node, event) {
      // Su mousemove D3 richiama spesso `show`: non rigeneriamo l'HTML
      // se il nodo è lo stesso, altrimenti l'immagine sembra “ricaricarsi”.
      const nid = node?.id ?? null;
      if (visible && nid && nid === lastNodeId) {
        position(event.clientX, event.clientY);
        return;
      }

      visible = true;
      lastNodeId = nid;
      el.hidden = false;
      const imgSrc = node.previewPath ? getPreviewHref(node.previewPath) : "";
      const authorLine = node.autore
        ? `<p class="tooltip__author">${escapeHtml(node.autore)}</p>`
        : "";
      const catDot = node.color
        ? `<span class="tooltip__catDot" aria-hidden="true" style="background:${escapeHtml(
            node.color
          )}"></span>`
        : "";
      el.innerHTML = `
        ${imgSrc ? `<img class="tooltip__img" src="${imgSrc}" alt="" loading="lazy" width="320" height="200">` : ""}
        ${authorLine}
        <h3 class="tooltip__title"><span class="tooltip__titleText">${escapeHtml(node.titolo)}${catDot}</span></h3>
        <p class="tooltip__excerpt">${escapeHtml(excerpt(node.descrizione))}</p>
        ${nodeTagsPanelHtml(node, "tooltip") || '<p class="tooltip__noTags mono">Nessun tag</p>'}
      `;
      position(event.clientX, event.clientY);
    },
    move(event) {
      if (!visible) return;
      position(event.clientX, event.clientY);
    },
    hide() {
      visible = false;
      lastNodeId = null;
      el.hidden = true;
      el.innerHTML = "";
    },
  };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** @param {string[]} tags */
function tagPillsHtml(tags, pillClass, max = 14) {
  const slice = (tags || []).slice(0, max);
  if (!slice.length) return "";
  return slice.map((t) => `<span class="${pillClass}">${escapeHtml(t)}</span>`).join("");
}

/**
 * @param {{ tagsNorm?: string[] }} node
 * @param {"tooltip"|"modal"|"preview"} variant
 */
function nodeTagsPanelHtml(node, variant) {
  const tags = (node.tagsNorm || []).slice(0, LEGEND_TAG_TOP_COUNT);
  if (!tags.length) return "";
  const pill =
    variant === "tooltip" ? "tooltip__tag" : variant === "preview" ? "preview-panel__tag" : "modal__tag";
  const wrap =
    variant === "tooltip" ? "tooltip__tags" : variant === "preview" ? "preview-panel__tags" : "modal__tags";
  const label =
    variant === "tooltip"
      ? "tooltip__tagBlockLabel mono"
      : variant === "preview"
        ? "preview-panel__tagBlockLabel mono"
        : "modal__tagBlockLabel mono";
  const block =
    variant === "tooltip"
      ? "tooltip__tagBlock"
      : variant === "preview"
        ? "preview-panel__tagBlock"
        : "modal__tagBlock";
  return `<div class="${block}"><p class="${label}">Top ${LEGEND_TAG_TOP_COUNT} tag</p><div class="${wrap}">${tagPillsHtml(tags, pill, LEGEND_TAG_TOP_COUNT)}</div></div>`;
}

/** Tutti i tag del progetto (sotto il titolo in anteprima). Se `highlightTags`
 *  è un Set di tag normalizzati, quei tag vengono mostrati in grassetto
 *  (usato per evidenziare i tag in comune col progetto selezionato). */
function previewAllTagsHtml(node, highlightTags) {
  const norms = (node.tagsNorm || []).map((t) => String(t).trim().toLowerCase());
  const labels = (node.tagsDisplay?.length ? node.tagsDisplay : node.tagsNorm || [])
    .map((t) => String(t).trim())
    .filter(Boolean);
  if (!labels.length) {
    return '<p class="preview-panel__tagsEmpty mono"><span class="preview-panel__tagsInlineLabel">Tag:</span> Nessun tag</p>';
  }
  const shared = highlightTags instanceof Set ? highlightTags : null;
  const items = labels.map((label, i) => {
    const norm = (norms[i] || label.toLowerCase()).trim();
    const isShared = !!shared && shared.has(norm);
    const safe = escapeHtml(label);
    return isShared
      ? `<strong class="preview-panel__tagShared">${safe}</strong>`
      : safe;
  });
  return `<p class="preview-panel__tags"><span class="preview-panel__tagsInlineLabel">Tag:</span> ${items.join(", ")}</p>`;
}

/** Descrizione anteprima: oltre questa soglia, scroll minimale sul testo. */
const PREVIEW_BODY_MAX_WORDS = 44;

function previewBodyHtml(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const escaped = escapeHtml(raw);
  return `<p class="preview-panel__body">${escaped}</p>`;
}

/**
 * HTML pannello anteprima (Top 10, colonna destra).
 * @param {object} node
 * @param {{ highlightTags?: Set<string> }} [opts] - se `highlightTags` è
 *   passato, i tag del nodo che appartengono al set vengono in grassetto
 *   (utile per mostrare i tag in comune col progetto selezionato).
 */
export function renderProjectPreviewHtml(node, opts = {}) {
  const heroSrc = node.previewPath ? getPreviewHref(node.previewPath) : "";
  const highlightTags = opts.highlightTags instanceof Set ? opts.highlightTags : null;
  const backToListHref =
    typeof opts.backToListHref === "string" && opts.backToListHref ? opts.backToListHref : "";

  return `
    <article class="preview-panel" aria-live="polite">
      ${
        heroSrc
          ? `<div class="preview-panel__heroWrap">
              <img class="preview-panel__hero" src="${escapeAttr(heroSrc)}" alt="" loading="lazy">
            </div>`
          : ""
      }
      <h2 class="preview-panel__title">${escapeHtml(node.titolo || "Senza titolo")}</h2>
      ${node.autore ? `<p class="preview-panel__author">di ${escapeHtml(node.autore)}</p>` : ""}
      <div class="preview-panel__lowerScroll" tabindex="0" aria-label="Dettagli progetto">
        ${previewAllTagsHtml(node, highlightTags)}
        ${previewBodyHtml(node.descrizione)}
        <div class="preview-panel__actions">
          ${
            node.url
              ? `<a class="preview-panel__cta preview-panel__cta--primary mono" href="${escapeAttr(node.url)}" target="_blank" rel="noopener noreferrer">Apri il progetto</a>`
              : ""
          }
          ${
            backToListHref
              ? `<a class="preview-panel__cta preview-panel__cta--back mono" href="${escapeAttr(backToListHref)}">Torna alla Project List</a>`
              : ""
          }
        </div>
      </div>
    </article>`;
}

/**
 * @param {HTMLElement} el
 * @param {{ tags: { tag: string; color: string }[] }} legend — usa `legend.tags` (lista top tag)
 */
export function setupLegend(el, legend) {
  if (!el || !legend) return;

  const strength = legend.strength || [];
  const scaleGradient =
    strength.length >= 2
      ? `linear-gradient(to right, ${strength.map((s) => s.color).join(", ")})`
      : "";
  const scaleLabels = strength
    .map((s) => `<span class="legend__scaleLabel">${escapeHtml(s.label)}</span>`)
    .join("");

  el.innerHTML = `
    <section class="legend__section" aria-labelledby="legend-strength">
      <h3 class="legend__heading mono" id="legend-strength">Tag in comune</h3>
      ${
        scaleGradient
          ? `<div class="legend__scale">
              <span class="legend__scaleBar" style="background:${escapeHtml(scaleGradient)}"></span>
              <div class="legend__scaleLabels">${scaleLabels}</div>
            </div>`
          : '<p class="legend__empty">Nessun collegamento.</p>'
      }
    </section>
  `;
}

/**
 * @param {HTMLElement} modalRoot
 * @param {HTMLElement} inner
 */
export function setupModal(modalRoot, inner) {
  function open(node) {
    modalRoot.hidden = false;
    document.body.style.overflow = "hidden";
    document.getElementById("main-stage")?.setAttribute("inert", "");
    document.getElementById("filter-bar")?.setAttribute("inert", "");
    document.getElementById("legend-panel")?.setAttribute("inert", "");
    document.getElementById("preview-pane")?.setAttribute("inert", "");
    document.getElementById("top10-graph-pane")?.setAttribute("inert", "");
    document.querySelector(".site-header")?.setAttribute("inert", "");
    const heroSrc = node.previewPath ? getPreviewHref(node.previewPath) : "";
    inner.innerHTML = `
      ${
        heroSrc
          ? `<div class="modal__heroWrap">
      <img class="modal__hero" src="${heroSrc}" alt="" loading="eager">
      <button type="button" class="modal__close modal__close--onHero mono" data-modal-close aria-label="Chiudi">&times;</button>
    </div>`
          : `<button type="button" class="modal__close modal__close--top mono" data-modal-close aria-label="Chiudi">&times;</button>`
      }
      ${node.autore ? `<p class="modal__author">${escapeHtml(node.autore)}</p>` : ""}
      <h2 class="modal__title" id="modal-title">${escapeHtml(node.titolo)}</h2>
      <p class="modal__meta mono">${escapeHtml(node.clusterLabel || "")}</p>
      <details class="modal__desc">
        <summary class="modal__descSummary mono">
          <span class="modal__descLabel">DESCRIZIONE</span>
          <span class="modal__descToggle" aria-hidden="true"></span>
        </summary>
        <div class="modal__descBody">
          <p class="modal__body">${escapeHtml(node.descrizione || "")}</p>
        </div>
      </details>
      <div class="modal__tagsWrap">${nodeTagsPanelHtml(node, "modal") || '<p class="modal__noTags mono">Nessun tag</p>'}</div>
      <a class="modal__cta" href="${escapeAttr(node.url)}" target="_blank" rel="noopener noreferrer">Apri progetto esterno</a>
    `;
    inner.querySelector(".modal__close")?.focus();
    const descEl = inner.querySelector(".modal__desc");
    if (descEl && window.matchMedia("(min-width: 821px)").matches) descEl.open = true;
  }

  function close() {
    modalRoot.hidden = true;
    document.body.style.overflow = "";
    document.getElementById("main-stage")?.removeAttribute("inert");
    document.getElementById("filter-bar")?.removeAttribute("inert");
    document.getElementById("legend-panel")?.removeAttribute("inert");
    document.getElementById("preview-pane")?.removeAttribute("inert");
    document.getElementById("top10-graph-pane")?.removeAttribute("inert");
    document.querySelector(".site-header")?.removeAttribute("inert");
    inner.innerHTML = "";
  }

  modalRoot.addEventListener("click", (e) => {
    const t = e.target?.closest?.("[data-modal-close]");
    if (!t || !modalRoot.contains(t)) return;
    close();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modalRoot.hidden) {
      e.preventDefault();
      close();
    }
  });

  return { open, close };
}

function escapeAttr(s) {
  return String(s).replace(/"/g, "&quot;");
}
