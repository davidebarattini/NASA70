import { buildNetwork, filterNetworkByTag, legendTagsTopFromNodes } from "./graphData.js";
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
  const mobilePeek = document.getElementById("mobile-peek");
  const previewInner = document.getElementById("preview-inner");
  const previewPane = document.getElementById("preview-pane");
  const graphPane = document.getElementById("top10-graph-pane");

  if (!stage || !svg || !canvas || !filterBar || !tooltipEl || !modalRoot || !modalInner || !previewInner) return;

  const res = await fetch("data.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`Impossibile caricare data.json (${res.status})`);
  const raw = await res.json();
  const allNodesModel = buildNetwork(raw);
  let fullModel = buildNetwork(raw, { topTagsOnly: true });

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

  const PREVIEW_EMPTY =
    '<p class="top10-preview__empty">Select a project to preview</p>';

  function showPreviewEmpty() {
    if (!previewInner) return;
    previewInner.innerHTML = PREVIEW_EMPTY;
    hoverPreviewId = null;
    if (!lockedPreviewId) previewPane?.classList.remove("top10-preview-pane--active");
  }

  function showPreview(node, { locked = false } = {}) {
    if (!previewInner || !node) return;
    const nid = node.id ?? null;
    if (locked) {
      lockedPreviewId = nid;
    }
    hoverPreviewId = nid;
    previewInner.innerHTML = renderProjectPreviewHtml(node);
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
    graph?.unpinNode?.();
    graph?.clearFocus?.();
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
      if (isMobile()) return;
      if (node?.id && hoverPreviewId === node.id) return;
      showPreview(node);
    },
    onNodeLeave: () => {
      if (isMobile()) return;
      if (lockedPreviewId) {
        showLockedPreview();
        return;
      }
      hoverPreviewId = null;
      showPreviewEmpty();
    },
    onNodeClick: (node) => {
      showPreview(node, { locked: true });
      graph.pinNode?.(node.id);
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
      graph.pinNode?.(node.id);
      showPreview(node, { locked: true });
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
    if (lockedPreviewId) {
      showLockedPreview();
      return;
    }
    hoverPreviewId = null;
    showPreviewEmpty();
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
    if (lockedPreviewId) unlockPreview();
  });
}

main().catch((err) => {
  console.error(err);
  const stage = document.getElementById("main-stage");
  if (stage) {
    stage.insertAdjacentHTML(
      "beforeend",
      `<p style="position:fixed;bottom:3rem;left:50%;transform:translateX(-50%);color:#fca5a5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:0.75rem;">Errore caricamento archivio.</p>`
    );
  }
});
