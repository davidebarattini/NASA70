import { buildNetwork, filterNetworkByTag, legendTagsTopFromNodes } from "./graphData.js";
import { loadProjectsRaw } from "./loadData.js";
import { createGraphController } from "./graph.js";
import {
  setupFilters,
  setupTooltip,
  setupModal,
  setupLegend,
  renderProjectPreviewHtml,
} from "./ui.js";
import { initHeaderScroll } from "./headerScroll.js";

initHeaderScroll();

function initStarfield(canvas) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};

  const stars = [];
  let reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", () => {
    reduced = mq.matches;
  });

  function makeStars(w, h) {
    stars.length = 0;
    const count = Math.min(420, Math.floor((w * h) / 8500));
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.05 + 0.15,
        tw: Math.random() * Math.PI * 2,
        sp: 0.015 + Math.random() * 0.028,
      });
    }
  }

  let raf = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const host = canvas.parentElement;
    const w = host?.clientWidth || window.innerWidth;
    const h = host?.clientHeight || window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    makeStars(w, h);
  }

  function frame() {
    const host = canvas.parentElement;
    const w = host?.clientWidth || window.innerWidth;
    const h = host?.clientHeight || window.innerHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(10, 10, 10, 0.35)";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(210, 220, 255, 0.5)";
    for (const s of stars) {
      let alpha = 0.32;
      if (!reduced) {
        s.tw += s.sp;
        alpha = 0.14 + (Math.sin(s.tw) * 0.5 + 0.5) * 0.42;
      }
      ctx.globalAlpha = Math.max(0.06, Math.min(0.72, alpha));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener("resize", resize);
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
  };
}

async function main() {
  const stage = document.getElementById("main-stage");
  const svg = document.getElementById("graph-svg");
  const canvas = document.getElementById("starfield");
  const filterBar = document.getElementById("filter-bar");
  const tooltipEl = document.getElementById("tooltip");
  const modalRoot = document.getElementById("modal");
  const modalInner = document.getElementById("modal-inner");
  const legendEl = document.getElementById("legend-panel");
  const legendToggle = document.getElementById("legend-toggle");
  const tutorialReplayButton = document.getElementById("connections-tutorial-replay");
  const mobilePeek = document.getElementById("mobile-peek");
  const previewInner = document.getElementById("preview-inner");
  const previewPane = document.getElementById("preview-pane");
  const graphPane = document.getElementById("top10-graph-pane");

  if (!stage || !svg || !canvas || !filterBar || !tooltipEl || !modalRoot || !modalInner || !previewInner) return;

  const raw = await loadProjectsRaw();
  const allNodesModel = buildNetwork(raw);
  // Mostriamo tutti i progetti: la prossimità (e dimensione) è data dai tag in comune,
  // non più dalla appartenenza ai top-tag.
  let fullModel = allNodesModel;

  if (legendEl) setupLegend(legendEl, fullModel.legend);

  initStarfield(canvas);

  const tooltip = setupTooltip(tooltipEl);
  const modal = setupModal(modalRoot, modalInner);

  const MOBILE_BP = 820;
  function isMobile() {
    return window.innerWidth <= MOBILE_BP;
  }

  let lockedPreviewId = null;
  let hoverPreviewId = null;
  let hidePreviewTimer = null;
  // Id del progetto da cui si è arrivati via "Mostra collegamenti" (lista):
  // sulla sua anteprima mostriamo il link "Torna alla Project List".
  let backToListNodeId = null;

  function cancelHidePreview() {
    if (hidePreviewTimer) {
      clearTimeout(hidePreviewTimer);
      hidePreviewTimer = null;
    }
  }

  // Nasconde il pannello con un minimo ritardo: evita che, passando da un
  // nodo all'altro, il pannello "rientri" e poi riesca di scatto.
  function scheduleHidePreview() {
    cancelHidePreview();
    hidePreviewTimer = setTimeout(() => {
      hidePreviewTimer = null;
      if (lockedPreviewId) {
        showLockedPreview();
        return;
      }
      hoverPreviewId = null;
      showPreviewEmpty();
    }, 110);
  }

  const PREVIEW_EMPTY =
    '<p class="top10-preview__empty">Select a project to preview</p>';

  function showPreviewEmpty() {
    if (!previewInner) return;
    previewInner.innerHTML = PREVIEW_EMPTY;
    hoverPreviewId = null;
    if (!lockedPreviewId) previewPane?.classList.remove("top10-preview-pane--active");
  }

  // Id dei progetti che condividono almeno un tag con `node` (incluso `node`).
  function relatedIdsForNode(node) {
    const ids = new Set([node.id]);
    const tags = new Set(
      (node.tagsNorm || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean),
    );
    if (!tags.size) return ids;
    for (const n of fullModel.nodes) {
      if (n.id === node.id) continue;
      const shares = (n.tagsNorm || []).some((t) =>
        tags.has(String(t).trim().toLowerCase()),
      );
      if (shares) ids.add(n.id);
    }
    return ids;
  }

  // Id dei progetti interattivi dopo un click: almeno un tag in comune.
  function allowedIdsForSelection(node) {
    const related = relatedIdsForNode(node);
    const activeFilter = graph.getActiveFilter?.();
    if (!activeFilter) return related;
    const tagNorm = String(activeFilter).trim();
    return new Set(
      fullModel.nodes
        .filter((n) => related.has(n.id) && (n.tagsNorm || []).includes(tagNorm))
        .map((n) => String(n.id)),
    );
  }

  function lockedProjectNode() {
    if (!lockedPreviewId) return null;
    return fullModel.nodes.find((n) => n.id === lockedPreviewId) || null;
  }

  function showPreview(node, { locked = false } = {}) {
    if (!previewInner || !node) return;
    cancelHidePreview();
    const nid = node.id ?? null;
    if (locked) {
      lockedPreviewId = nid;
    }
    hoverPreviewId = nid;
    // Mostra i tag in comune col progetto selezionato (locked). Nessun
    // highlight se non c'è ancora un progetto selezionato, o se il nodo che
    // stiamo visualizzando È quello selezionato.
    const lockedNode = lockedProjectNode();
    const lockedTags = lockedNode
      ? new Set(
          (lockedNode.tagsNorm || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean),
        )
      : null;
    const highlightTags =
      lockedTags && lockedTags.size && lockedPreviewId && nid !== lockedPreviewId
        ? lockedTags
        : null;
    const sharedWithTitle = highlightTags ? lockedNode?.titolo || "" : "";
    // "Torna alla Project List" solo sull'anteprima (bloccata) del progetto da
    // cui si è arrivati tramite "Mostra collegamenti".
    const backToListHref =
      backToListNodeId && nid === backToListNodeId && lockedPreviewId === backToListNodeId
        ? `projects.html#proj-${encodeURIComponent(String(nid))}`
        : "";
    previewInner.innerHTML = renderProjectPreviewHtml(node, {
      highlightTags,
      sharedWithTitle,
      backToListHref,
    });
    previewPane?.classList.add("top10-preview-pane--active");
  }

  function showLockedPreview() {
    if (!lockedPreviewId) return;
    const node = fullModel.nodes.find((n) => n.id === lockedPreviewId);
    if (node) showPreview(node);
    else showPreviewEmpty();
  }

  // Mini tutorial al primo arrivo su Connections, in due passi:
  //  1) tutti i progetti spenti tranne uno, evidenziato: invita all'hover
  //     per rivelarne i collegamenti, poi a selezionarlo (click).
  //  2) dopo la selezione, il focus si sposta su uno dei progetti attivi
  //     (tag in comune): invita all'hover per vederne i tag condivisi.
  //  3) col pannello di anteprima aperto, invita a cliccare fuori per
  //     chiuderlo: da lì il tutorial finisce.
  const CONNECTIONS_TUTORIAL_KEY = "nasa70ConnectionsTutorialSeen";
  let tutorialStep = 0; // 0 inattivo, 1 hover-spotlight, 2 hover-progetto-attivo, 3 chiudi-pannello
  let tutorialCalloutEl = null;
  let tutorialSpotlightEl = null;
  let tutorialRafId = null;
  let tutorialAnchorEl = null;
  // Id del progetto cliccato per passare allo step 2: un hover "in ritardo"
  // su di esso (timer di hover già in corsa al momento del click) non deve
  // chiudere subito lo step 2, solo un hover su un progetto DIVERSO conta.
  let tutorialOriginId = null;
  // Id dell'UNICO progetto su cui l'hover è ammesso durante i passi 2/3.
  // Non ci si affida solo a `pointer-events:none` sui nodi bloccati: se un
  // hover era già "in corso" su un altro progetto attivo nel preciso istante
  // in cui scatta il blocco (il browser non genera un mouseleave sintetico
  // solo perché una classe CSS cambia sotto un cursore fermo), quel progetto
  // resterebbe "incollato" come se fosse ancora hoverabile normalmente.
  // Questo guard extra in `onNodeHover` ignora esplicitamente qualunque
  // hover che non sia su questo id, indipendentemente dal CSS.
  let tutorialAllowedHoverId = null;
  // Passo 3: cerchietto "bersaglio" in un punto vuoto del grafo, per
  // mostrare visivamente dove si può cliccare per chiudere il pannello.
  let tutorialTargetEl = null;
  let tutorialTargetResize = null;
  // Piccolo ritardo tra l'hover sul progetto attivo (passo 2) e il passaggio
  // al passo 3, così il fumetto "Hover an active project..." non sparisce
  // di scatto ma resta leggibile un attimo.
  const TUTORIAL_STEP3_DELAY_MS = 700;
  let tutorialAdvanceTimer = null;

  function onTutorialOutsideInteraction(event) {
    // Le interazioni sul grafo (hover/click sui nodi) sono gestite dai
    // callback onNodeHover/onNodeClick: qui intercettiamo solo i click
    // fuori dal grafo (nav, filtri, ecc.) come rete di sicurezza.
    if (svg.contains(event.target)) return;
    endConnectionsTutorial();
  }

  function clearTutorialVisuals() {
    if (tutorialAdvanceTimer != null) {
      clearTimeout(tutorialAdvanceTimer);
      tutorialAdvanceTimer = null;
    }
    svg.querySelectorAll(".graph-node--tutorial-dim").forEach((el) => {
      el.classList.remove("graph-node--tutorial-dim");
    });
    svg.querySelectorAll(".graph-node--tutorial-lock").forEach((el) => {
      el.classList.remove("graph-node--tutorial-lock");
    });
    tutorialSpotlightEl?.classList.remove("graph-node--tutorial-spotlight");
    tutorialSpotlightEl = null;
    tutorialCalloutEl?.remove();
    tutorialCalloutEl = null;
    tutorialAnchorEl = null;
    tutorialTargetEl?.remove();
    tutorialTargetEl = null;
    if (tutorialTargetResize) {
      window.removeEventListener("resize", tutorialTargetResize);
      tutorialTargetResize = null;
    }
    if (tutorialRafId != null) {
      cancelAnimationFrame(tutorialRafId);
      tutorialRafId = null;
    }
  }

  function endConnectionsTutorial() {
    if (tutorialStep === 0) return;
    tutorialStep = 0;
    tutorialOriginId = null;
    tutorialAllowedHoverId = null;
    document.body.classList.remove("connections-tutorial-active");
    clearTutorialVisuals();
    document.removeEventListener("pointerdown", onTutorialOutsideInteraction, true);
    try {
      localStorage.setItem(CONNECTIONS_TUTORIAL_KEY, "1");
    } catch {
      // Storage non disponibile (es. navigazione privata): il tutorial si
      // ripresenterà alla prossima visita, non è un problema bloccante.
    }
  }

  // `direction` "down": il fumetto sta sopra l'ancora, freccia verso il
  // basso (nodi del grafo). "left": il fumetto sta a sinistra dell'ancora,
  // freccia verso destra (pannello di anteprima).
  function showTutorialCallout(text, anchorEl, direction = "down") {
    tutorialCalloutEl?.remove();
    tutorialAnchorEl = anchorEl;
    tutorialCalloutEl = document.createElement("div");
    tutorialCalloutEl.className = `tutorial-callout tutorial-callout--${direction}`;
    // Stessa freccia usata nei bottoni (es. "Open Project"), senza il
    // cerchio rosso: solo l'icona, ruotata con CSS a seconda della direzione.
    const arrowSvg = `<svg class="tutorial-callout__arrow" viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
        <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
    tutorialCalloutEl.innerHTML =
      direction === "left"
        ? `${arrowSvg}<p class="tutorial-callout__text">${text}</p>`
        : `<p class="tutorial-callout__text">${text}</p>${arrowSvg}`;
    document.body.appendChild(tutorialCalloutEl);

    if (tutorialRafId != null) cancelAnimationFrame(tutorialRafId);
    function positionCallout() {
      if (!tutorialCalloutEl || !tutorialAnchorEl?.isConnected) return;
      const r = tutorialAnchorEl.getBoundingClientRect();
      // Un rect ancora a zero (nodo non ancora "impaginato" dal browser, o
      // dalla simulazione) non va usato: si riprova al frame successivo
      // invece di posizionare il fumetto sull'origine (0,0).
      if (r.width > 0 || r.height > 0) {
        // Solo custom property + transform (mai left/top): in Safari
        // aggiornare left/top ogni frame su un elemento fixed può restare
        // "indietro" rispetto a contenuto SVG animato sotto di esso.
        if (direction === "left") {
          tutorialCalloutEl.style.setProperty("--tutorial-x", `${r.left - 8}px`);
          tutorialCalloutEl.style.setProperty("--tutorial-y", `${r.top + Math.min(90, r.height / 2)}px`);
        } else {
          tutorialCalloutEl.style.setProperty("--tutorial-x", `${r.left + r.width / 2}px`);
          tutorialCalloutEl.style.setProperty("--tutorial-y", `${r.top - 8}px`);
        }
      }
      tutorialRafId = requestAnimationFrame(positionCallout);
    }
    positionCallout();
  }

  // Passo 2: sposta il focus su uno dei progetti rimasti attivi dopo la
  // selezione (già "spenti" gli altri dalla normale logica di selezione).
  function advanceConnectionsTutorial(originNode, allowedIds) {
    const nextId = [...allowedIds].find((id) => id !== originNode.id);
    const nextEl = nextId
      ? svg.querySelector(`[data-node-id="${CSS.escape(String(nextId))}"]`)
      : null;
    if (!nextEl) {
      endConnectionsTutorial();
      return;
    }
    tutorialStep = 2;
    tutorialOriginId = String(originNode.id);
    tutorialAllowedHoverId = String(nextId);
    clearTutorialVisuals();
    // Durante il tutorial è interagibile SOLO il progetto in evidenza: gli
    // altri progetti attivi restano visivamente normali (li gestisce già
    // la selezione) ma non cliccabili/hoverabili, altrimenti interferiscono
    // con applyFocus del grafo e mandano in confusione lo stato del passo.
    svg.querySelectorAll(".graph-node").forEach((el) => {
      if (el !== nextEl) el.classList.add("graph-node--tutorial-lock");
    });
    nextEl.classList.add("graph-node--tutorial-spotlight");
    tutorialSpotlightEl = nextEl;
    showTutorialCallout("Hover an active project to see its shared tags", nextEl);
  }

  // Passo 3: col pannello di anteprima ormai aperto, invita a cliccare
  // fuori per chiuderlo. Nessun nodo resta in evidenza: il fumetto punta al
  // pannello stesso.
  // `keepHoverableId`: il progetto da cui si arriva (hover/click appena
  // avvenuto) non va bloccato — se il mouse è ancora fermo lì sopra,
  // "spegnerlo" gli farebbe perdere l'hover a metà (mouseleave sintetico),
  // facendo sparire l'anteprima appena mostrata.
  function advanceConnectionsTutorialToStep3(keepHoverableId) {
    keepHoverableId = keepHoverableId != null ? String(keepHoverableId) : null;
    const container = graphPane || stage;
    if (!container) {
      endConnectionsTutorial();
      return;
    }
    tutorialStep = 3;
    tutorialAllowedHoverId = keepHoverableId;
    clearTutorialVisuals();
    // Nessun nodo è più il "prossimo passo": blocca tutti i progetti così
    // l'unica azione valida resta cliccare fuori per chiudere il pannello.
    svg.querySelectorAll(".graph-node").forEach((el) => {
      if (el.getAttribute("data-node-id") === keepHoverableId) return;
      el.classList.add("graph-node--tutorial-lock");
    });

    tutorialTargetEl = document.createElement("div");
    tutorialTargetEl.className = "tutorial-target-circle";
    document.body.appendChild(tutorialTargetEl);

    function positionTarget() {
      if (!tutorialTargetEl) return;
      const r = container.getBoundingClientRect();
      tutorialTargetEl.style.left = `${r.left + r.width * 0.48}px`;
      tutorialTargetEl.style.top = `${r.top + r.height * 0.68}px`;
    }
    positionTarget();
    tutorialTargetResize = positionTarget;
    window.addEventListener("resize", tutorialTargetResize);

    showTutorialCallout("Click outside to close the panel", tutorialTargetEl, "down");
  }

  function setupConnectionsTutorial(force = false) {
    if (!force) {
      if (isMobile()) return; // "hover" non ha senso su touch
      let seen = false;
      try {
        seen = localStorage.getItem(CONNECTIONS_TUTORIAL_KEY) === "1";
      } catch {
        seen = false;
      }
      if (seen) return;
    }
    endConnectionsTutorial();

    const spotlightNode = fullModel.nodes[0];
    if (!spotlightNode) return;
    const nodeEl = svg.querySelector(`[data-node-id="${CSS.escape(String(spotlightNode.id))}"]`);
    if (!nodeEl) return;

    tutorialStep = 1;
    document.body.classList.add("connections-tutorial-active");
    svg.querySelectorAll(".graph-node").forEach((el) => {
      if (el !== nodeEl) el.classList.add("graph-node--tutorial-dim");
    });
    nodeEl.classList.add("graph-node--tutorial-spotlight");
    tutorialSpotlightEl = nodeEl;
    showTutorialCallout("Hover a project to reveal its connections", nodeEl);

    // Qualunque altra interazione con la pagina chiude comunque il
    // tutorial: non deve mai bloccare l'uso reale del sito.
    document.addEventListener("pointerdown", onTutorialOutsideInteraction, true);
  }

  function unlockPreview() {
    lockedPreviewId = null;
    graph?.unpinNode?.();
    graph?.clearFocus?.();
    graph?.clearSelection?.();
    if (hoverPreviewId) {
      const node = fullModel.nodes.find((n) => n.id === hoverPreviewId);
      if (node) showPreview(node, { locked: false });
      else showPreviewEmpty();
    } else {
      showPreviewEmpty();
    }
  }

  const graph = createGraphController({
    svg,
    fullModel,
    onNodeHover: (node) => {
      // Passo 1 (hover sul progetto in evidenza): i collegamenti si
      // rivelano da soli (comportamento normale), il fumetto passa a
      // invitare alla selezione. Passo 2 (hover su un progetto ATTIVO
      // DIVERSO da quello appena selezionato): passa al passo 3.
      if (tutorialStep === 1) {
        const textEl = tutorialCalloutEl?.querySelector(".tutorial-callout__text");
        if (textEl && textEl.textContent !== "Select project") {
          textEl.textContent = "Select project";
        }
      }
      if (
        tutorialStep === 2 &&
        node?.id != null &&
        String(node.id) === tutorialAllowedHoverId &&
        tutorialAdvanceTimer == null
      ) {
        const hoveredId = node.id;
        tutorialAdvanceTimer = setTimeout(() => {
          tutorialAdvanceTimer = null;
          if (tutorialStep === 2) advanceConnectionsTutorialToStep3(hoveredId);
        }, TUTORIAL_STEP3_DELAY_MS);
      }
      // Passi 2/3: ignora qualunque hover che non sia sull'unico progetto
      // consentito, anche se fosse arrivato fin qui nonostante il blocco CSS
      // (vedi commento su `tutorialAllowedHoverId`) — non deve mai mostrare
      // i collegamenti/l'anteprima di un progetto che dovrebbe restare
      // bloccato durante il tutorial.
      if (
        (tutorialStep === 2 || tutorialStep === 3) &&
        node?.id != null &&
        String(node.id) !== tutorialAllowedHoverId
      ) {
        return;
      }
      if (isMobile()) return;
      if (node?._inactive) return; // nodi "spenti": niente preview
      cancelHidePreview();
      if (node?.id && hoverPreviewId === node.id) return;
      showPreview(node);
    },
    onNodeLeave: () => {
      if (isMobile()) return;
      scheduleHidePreview();
    },
    onNodeClick: (node) => {
      if (node?._inactive) return; // nodi "spenti": non si possono selezionare
      // Stessa cautela dell'hover: durante i passi 2/3 un click che non sia
      // sull'unico progetto consentito va ignorato, non solo lasciato al
      // pointer-events:none dei nodi bloccati.
      if (
        (tutorialStep === 2 || tutorialStep === 3) &&
        node?.id != null &&
        String(node.id) !== tutorialAllowedHoverId
      ) {
        return;
      }
      showPreview(node, { locked: true });
      const allowed = allowedIdsForSelection(node);
      graph.setSelection?.(allowed, node.id);
      if (tutorialStep === 1) advanceConnectionsTutorial(node, allowed);
      else if (tutorialStep === 2) advanceConnectionsTutorialToStep3(node.id);
      else if (tutorialStep === 3) endConnectionsTutorial();
    },
  });

  graph.rebuild();
  setupConnectionsTutorial();
  tutorialReplayButton?.addEventListener("click", () => setupConnectionsTutorial(true));

  let didMobileInitZoom = false;
  function applyMobileInitZoom() {
    if (didMobileInitZoom) return;
    if (!isMobile()) return;
    didMobileInitZoom = true;
    graph.zoomOut?.();
    graph.zoomOut?.();
  }
  applyMobileInitZoom();

  function syncLegendForFilter(activeTag) {
    if (!legendEl) return;
    const view = activeTag ? filterNetworkByTag(fullModel, activeTag) : fullModel;
    setupLegend(legendEl, view.legend);
  }

  function nodesForTag(tag) {
    if (!tag) return fullModel.nodes;
    const tagNorm = String(tag).trim();
    return fullModel.nodes.filter((n) => (n.tagsNorm || []).includes(tagNorm));
  }

  function tagsForFilterBar(activeTag) {
    return legendTagsTopFromNodes(nodesForTag(activeTag));
  }

  let filtersUi;
  function onFilterSelect(tag) {
    graph.setFilter(tag);
    syncLegendForFilter(tag || null);
    filtersUi.updateTags(tagsForFilterBar(tag), tag);
    unlockPreview();
  }

  filtersUi = setupFilters(filterBar, tagsForFilterBar(null), onFilterSelect);

  function focusProjectFromUrl() {
    const focusId = new URLSearchParams(location.search).get("focus");
    if (!focusId) return;

    let node = fullModel.nodes.find((n) => n.id === focusId);
    if (!node) {
      node = allNodesModel.nodes.find((n) => n.id === focusId);
      if (node) {
        fullModel = allNodesModel;
        graph.setNetworkModel(allNodesModel);
        syncLegendForFilter(null);
        filtersUi.updateTags(tagsForFilterBar(null), null);
      }
    }
    if (!node) return;

    const focusProject = () => {
      graph.resetView();
      // Siamo arrivati qui da "Mostra collegamenti": ricordiamo il progetto per
      // mostrare il link "Torna alla Project List" nella sua anteprima.
      backToListNodeId = node.id;
      showPreview(node, { locked: true });
      const allowed = allowedIdsForSelection(node);
      graph.setSelection?.(allowed, node.id);
      history.replaceState(null, "", location.pathname);
    };

    const tryFocus = (attempt = 0) => {
      if (graph.hasNode(node.id) || attempt > 48) {
        focusProject();
        return;
      }
      requestAnimationFrame(() => tryFocus(attempt + 1));
    };

    tryFocus();
  }

  focusProjectFromUrl();

  window.addEventListener("resize", () => graph.resize());

  stage.addEventListener("mouseleave", () => {
    if (isMobile()) return;
    scheduleHidePreview();
  });

  function setLegendOpen(open) {
    const on = !!open;
    document.body.classList.toggle("legend-open", on);
    if (legendToggle) legendToggle.setAttribute("aria-expanded", on ? "true" : "false");
  }
  function toggleLegend() {
    setLegendOpen(!document.body.classList.contains("legend-open"));
  }

  if (legendToggle && legendEl) {
    setLegendOpen(false);
    legendToggle.addEventListener("click", () => toggleLegend());

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (lockedPreviewId) {
          unlockPreview();
          return;
        }
        setLegendOpen(false);
      }
    });

    window.addEventListener("resize", () => {
      if (!isMobile()) setLegendOpen(false);
    });
  }

  stage.addEventListener("click", (e) => {
    if (e.target.closest(".graph-node")) return;
    if (lockedPreviewId) {
      // Click sullo sfondo: chiusura completa. Azzeriamo anche l'hover così il
      // pannello di destra rientra invece di riaprirsi sul progetto appena
      // deselezionato.
      cancelHidePreview();
      hoverPreviewId = null;
      unlockPreview();
    }
    if (tutorialStep === 3) endConnectionsTutorial();
  });
}

main().catch((err) => {
  console.error(err);
  const stage = document.getElementById("main-stage");
  if (stage) {
    stage.insertAdjacentHTML(
      "beforeend",
      `<p style="position:fixed;bottom:3rem;left:50%;transform:translateX(-50%);max-width:min(92vw,42rem);text-align:center;color:#fca5a5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:0.75rem;">${String(err?.message || "Errore caricamento archivio.")}</p>`
    );
  }
});
