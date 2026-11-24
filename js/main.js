import { buildNetwork, filterNetworkByTag, legendTagsTopFromNodes } from "./graphData.js";
import { loadProjectsRaw } from "./loadData.js";
import { createGraphController } from "./graph.js?v=ambient-lines-fade";
import {
  setupFilters,
  setupTooltip,
  setupModal,
  setupLegend,
  renderProjectPreviewHtml,
} from "./ui.js?v=ambient-lines-fade";
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

  return {
    // Esposto per il morph Home→Connections (vedi activateConnections):
    // ridisegna canvas + stelle sulla nuova dimensione del contenitore SENZA
    // passare dal listener "resize" della finestra, che qui rigenererebbe
    // le stelle a ogni frame del morph (il box cresce, la finestra no).
    // Chiamato una volta sola a transizione conclusa.
    resize,
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    },
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
  const mobilePeek = document.getElementById("mobile-peek");
  const previewInner = document.getElementById("preview-inner");
  const previewPane = document.getElementById("preview-pane");
  const graphPane = document.getElementById("top10-graph-pane");

  if (!stage || !svg || !canvas || !filterBar || !tooltipEl || !modalRoot || !modalInner || !previewInner) return;

  // Home e Connections sono la stessa pagina/DOM (vedi index.html /
  // explore.html): `data-mode` sul <body> dice solo con quale aspetto
  // partire al primo paint, MAI ricreato dopo — "home" costruisce il grafo
  // decorativo (niente hover/click/pan/zoom), "connections" parte già
  // interattivo. Il passaggio dall'uno all'altro è poi gestito in-page da
  // activateConnections()/deactivateConnections() più sotto.
  const initialMode = document.body.dataset.mode === "home" ? "home" : "connections";

  const raw = await loadProjectsRaw();
  const allNodesModel = buildNetwork(raw);
  // Mostriamo tutti i progetti: la prossimità (e dimensione) è data dai tag in comune,
  // non più dalla appartenenza ai top-tag.
  let fullModel = allNodesModel;

  if (legendEl) setupLegend(legendEl, fullModel.legend);

  const starfield = initStarfield(canvas);

  const tooltip = setupTooltip(tooltipEl);
  const modal = setupModal(modalRoot, modalInner);

  const MOBILE_BP = 820;
  function isMobile() {
    return window.innerWidth <= MOBILE_BP;
  }

  let lockedPreviewId = null;
  let hoverPreviewId = null;
  let hidePreviewTimer = null;

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

  // Tag in comune tra `node` e il progetto selezionato (locked), se c'è e
  // se non È lo stesso `node`: usato dal tooltip "Shares N tags" che segue
  // il cursore (vedi onNodeHover), non più dal pannello anteprima.
  function sharedTagsInfoFor(node) {
    const nid = node?.id ?? null;
    const lockedNode = lockedProjectNode();
    const lockedTags = lockedNode
      ? new Set(
          (lockedNode.tagsNorm || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean),
        )
      : null;
    if (!lockedTags || !lockedTags.size || !lockedPreviewId || nid === lockedPreviewId) {
      return null;
    }
    return { highlightTags: lockedTags, sharedWithTitle: lockedNode?.titolo || "" };
  }

  function showPreview(node, { locked = false } = {}) {
    if (!previewInner || !node) return;
    cancelHidePreview();
    const nid = node.id ?? null;
    if (locked) {
      lockedPreviewId = nid;
    }
    hoverPreviewId = nid;
    // "View in Project List" sull'anteprima di qualsiasi progetto, sia in
    // hover sia selezionato (click nel grafo o arrivo da "Show Connections").
    const backToListHref = nid
      ? `projects.html#proj-${encodeURIComponent(String(nid))}`
      : "";
    previewInner.innerHTML = renderProjectPreviewHtml(node, { backToListHref });
    previewPane?.classList.add("top10-preview-pane--active");
  }

  function showLockedPreview() {
    if (!lockedPreviewId) return;
    const node = fullModel.nodes.find((n) => n.id === lockedPreviewId);
    if (node) showPreview(node);
    else showPreviewEmpty();
  }

  function unlockPreview() {
    lockedPreviewId = null;
    tooltip.hide();
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
    decorative: initialMode === "home",
    onNodeHover: (node, event) => {
      if (isMobile()) return;
      if (node?._inactive) return; // nodi "spenti": niente preview
      cancelHidePreview();
      // Tooltip "Shares N tags with X" che segue il cursore: solo quando c'è
      // già un progetto selezionato e siamo in hover su un ALTRO progetto
      // attivo con cui condivide almeno un tag (vedi sharedTagsInfoFor).
      const sharedInfo = sharedTagsInfoFor(node);
      if (sharedInfo && event) tooltip.show(node, event, sharedInfo);
      else tooltip.hide();
      if (node?.id && hoverPreviewId === node.id) return;
      showPreview(node);
    },
    onNodeLeave: () => {
      tooltip.hide();
      if (isMobile()) return;
      scheduleHidePreview();
    },
    onNodeClick: (node) => {
      if (node?._inactive) return; // nodi "spenti": non si possono selezionare
      tooltip.hide();
      showPreview(node, { locked: true });
      const allowed = allowedIdsForSelection(node);
      graph.setSelection?.(allowed, node.id);
    },
  });

  graph.rebuild();

  let didMobileInitZoom = false;
  function applyMobileInitZoom() {
    if (didMobileInitZoom) return;
    if (!isMobile()) return;
    didMobileInitZoom = true;
    graph.zoomOut?.();
    graph.zoomOut?.();
  }
  applyMobileInitZoom();

  // ---- Morph Home ⇄ Connections (stessa pagina, stesso grafo) ----
  // Il click su "Explore Connections" non naviga più altrove: fa solo
  // crescere in-page lo stesso riquadro grafo (CSS, vedi .top10-shell in
  // main.css) mentre il grafo passa da decorativo a interattivo
  // (graph.setInteractive) e la simulazione si riequilibra sulla nuova
  // dimensione via resize() ripetuti (vedi runMorphResizeLoop). Il tasto
  // "indietro" del browser inverte la stessa transizione in-page grazie a
  // history.pushState + il listener "popstate" sotto, invece di forzare un
  // vero reload su index.html.
  const heroCta = document.getElementById("hero-cta");
  const navConnectionsLink = document.getElementById("nav-connections-link");
  const prefersReducedMotionMode = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let currentMode = initialMode;

  function syncNavActiveState() {
    if (!navConnectionsLink) return;
    const on = currentMode === "connections";
    navConnectionsLink.classList.toggle("site-nav__link--active", on);
    if (on) navConnectionsLink.setAttribute("aria-current", "page");
    else navConnectionsLink.removeAttribute("aria-current");
  }
  syncNavActiveState();

  // Durante il morph rinfresca ripetutamente centro/forze della simulazione
  // sulla dimensione corrente dell'SVG (graph.resize(), vedi graph.js) così
  // i pianeti si "aprono" insieme al riquadro invece di restare fermi alla
  // scala di partenza. Lo starfield viene invece ridimensionato UNA SOLA
  // volta a transizione conclusa: rigenera le stelle, farlo a ogni frame le
  // farebbe tremolare.
  function runMorphResizeLoop({ finalSettle = false } = {}) {
    if (prefersReducedMotionMode) {
      graph.resize();
      starfield.resize();
      if (finalSettle) graph.settleLayout?.();
      return;
    }
    // Deve coprire l'INTERA transizione CSS di .top10-shell (--morph-
    // transition in main.css, 1.3s) più un margine: se si ferma prima che
    // il riquadro abbia davvero raggiunto la sua larghezza finale, il bias
    // di centerX (vedi computeCenters in graph.js, che compensa lo spazio
    // riservato al pannello anteprima) resta calcolato su una larghezza
    // intermedia e i pianeti si assestano leggermente più a sinistra del
    // centro corretto invece che al centro vero e proprio.
    const durationMs = 1450;
    const start = performance.now();
    function step(now) {
      graph.resize();
      if (now - start < durationMs) {
        requestAnimationFrame(step);
      } else {
        starfield.resize();
        // Il trascinamento usa un'alpha volutamente bassa (moto fluido,
        // non nervoso): da sola non basta a riassestare i pianeti come un
        // caricamento diretto. Ora che il riquadro è alla dimensione
        // finale, una spinta di energia in più li ridistribuisce
        // correttamente (vedi settleLayout in graph.js).
        if (finalSettle) graph.settleLayout?.();
      }
    }
    requestAnimationFrame(step);
  }

  // Sequenza voluta: prima si accendono i collegamenti (riquadro ancora
  // fermo, piccolo come nella hero), POI il riquadro si apre (lentamente,
  // vedi --morph-transition) verso lo stage di Connections. Filtri/legenda/
  // controlli header compaiono da soli via CSS con un piccolo ritardo
  // proprio (vedi "body.mode-connections .filters" ecc. in main.css): non
  // c'è bisogno di orchestrarli qui, arrivano già fermi nella posizione
  // finale un attimo dopo che il riquadro ha iniziato a muoversi.
  let pendingBoxOpenTimer = null;

  function activateConnections({ push = true } = {}) {
    if (currentMode === "connections") return;
    currentMode = "connections";
    document.body.dataset.mode = "connections";
    graph.setInteractive?.(true);
    // Nella hero i pianeti stanno isolati (vedi rebuild() in graph.js):
    // i collegamenti compaiono ora, con un fade, mentre il riquadro non si
    // è ancora mosso.
    graph.revealAmbientLinks?.();
    syncNavActiveState();
    if (push) history.pushState({ nasa70Mode: "connections" }, "", `explore.html${location.search}`);

    if (pendingBoxOpenTimer) clearTimeout(pendingBoxOpenTimer);
    const boxOpenDelayMs = prefersReducedMotionMode ? 0 : 550;
    pendingBoxOpenTimer = setTimeout(() => {
      pendingBoxOpenTimer = null;
      document.body.classList.remove("mode-home");
      document.body.classList.add("mode-connections");
      runMorphResizeLoop({ finalSettle: true });
    }, boxOpenDelayMs);
  }

  function deactivateConnections({ push = true } = {}) {
    if (currentMode === "home") return;
    currentMode = "home";
    if (pendingBoxOpenTimer) {
      clearTimeout(pendingBoxOpenTimer);
      pendingBoxOpenTimer = null;
    }
    document.body.classList.remove("mode-connections");
    document.body.classList.add("mode-home");
    document.body.dataset.mode = "home";
    graph.setInteractive?.(false);
    // Azzera anche selezione/preview bloccata: rientrando in home non deve
    // restare "agganciato" un progetto della sessione Connections appena
    // lasciata.
    unlockPreview();
    // Rimette i pianeti isolati: se si torna in Connections da qui, il
    // fade-in dei collegamenti deve poter ripartire da zero.
    graph.hideAllLinks?.();
    syncNavActiveState();
    if (push) history.pushState({ nasa70Mode: "home" }, "", "index.html");
    runMorphResizeLoop();
  }

  heroCta?.addEventListener("click", (event) => {
    // Stesso-origine, nessun modificatore (apri-in-nuova-scheda ecc.): solo
    // allora intercettiamo per il morph in-page, altrimenti lasciamo il
    // comportamento normale del link (nuova scheda, ecc.).
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    activateConnections();
  });

  window.addEventListener("popstate", () => {
    const wantConnections = /explore\.html/.test(location.pathname);
    if (wantConnections) activateConnections({ push: false });
    else deactivateConnections({ push: false });
  });

  function syncLegendForFilter(activeTag) {
    if (!legendEl) return;
    const view = activeTag ? filterNetworkByTag(fullModel, activeTag) : fullModel;
    setupLegend(legendEl, view.legend);
  }

  // Elenco FISSO di tutti i tag dell'archivio, ordinati per numero di
  // progetti (il numero accanto = pianeti che si accendono cliccandolo).
  // Non cambia quando si seleziona un tag: la barra ne mostra i primi 10 e
  // il resto dietro "+N more tags" (vedi setupFilters in ui.js).
  function tagsForFilterBar() {
    return legendTagsTopFromNodes(fullModel.nodes, Infinity);
  }

  let filtersUi;
  function onFilterSelect(tag) {
    graph.setFilter(tag);
    syncLegendForFilter(tag || null);
    filtersUi.setActive(tag);
    // Cambiando tag il progetto selezionato viene deselezionato: chiudiamo
    // anche l'anteprima a destra. Azzerando l'hover prima di unlockPreview,
    // questa non rimostra l'ultimo progetto visto (che era proprio quello
    // selezionato) ma il pannello vuoto.
    cancelHidePreview();
    hoverPreviewId = null;
    unlockPreview();
  }

  filtersUi = setupFilters(filterBar, tagsForFilterBar(), onFilterSelect);

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
        filtersUi.updateTags(tagsForFilterBar(), null);
      }
    }
    if (!node) return;

    const focusProject = () => {
      graph.resetView();
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
