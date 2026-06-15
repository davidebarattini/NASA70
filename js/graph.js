import * as d3 from "./vendor/d3.bundle.mjs";
import { filterNetworkByTag, getPreviewHref } from "./graphData.js";

/** Quattro dimensioni discrete stelle (legenda: S → XL). */
export const NODE_SCALE_STEPS = Object.freeze([0.72, 1.12, 1.55, 2.2]);
const GRAPH_Y_OFFSET = -54;

function nearestNodeScaleStep(k) {
  const n = Number(k);
  if (!Number.isFinite(n)) return NODE_SCALE_STEPS[1];
  let best = NODE_SCALE_STEPS[0];
  let dmin = Infinity;
  for (const s of NODE_SCALE_STEPS) {
    const d = Math.abs(s - n);
    if (d < dmin) {
      dmin = d;
      best = s;
    }
  }
  return best;
}

function thumbClipId(d) {
  return `thumbc-${d.id}`;
}

function seedNodes(nodes, width, height, spread, usableHeight, yOffset) {
  const cx = width / 2;
  const h = Number.isFinite(usableHeight) && usableHeight > 0 ? usableHeight : height;
  const off = Number.isFinite(yOffset) ? yOffset : GRAPH_Y_OFFSET;
  const cy = h / 2 + off;
  const maxR = Math.min(width, h) * 0.42;
  const minR = Math.min(width, h) * 0.06;
  nodes.forEach((n, i) => {
    const overlap = Math.max(0, Math.min(1, Number(n.overlapRatio) || 0));
    const r = minR + (1 - overlap) * (maxR - minR);
    // Distribuzione angolare deterministica + jitter casuale.
    const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2 + Math.random() * 0.4;
    n.x = cx + Math.cos(angle) * r + (Math.random() - 0.5) * spread * 0.08;
    n.y = cy + Math.sin(angle) * r + (Math.random() - 0.5) * spread * 0.08;
    if (n.vx !== undefined) n.vx = 0;
    if (n.vy !== undefined) n.vy = 0;
  });
}

/**
 * @param {object} options
 * @param {SVGSVGElement} options.svg
 * @param {object} options.fullModel
 * @param {(node: object) => void} [options.onNodeHover]
 * @param {(node: object|null) => void} [options.onNodeLeave]
 * @param {(node: object) => void} [options.onNodeClick]
 * @param {boolean} [options.decorative] — se true: niente hover/click/focus,
 *   solo drag dei nodi. Usato per la mini-preview del grafo nella hero
 *   della pagina PROJECTS.
 */
export function createGraphController(options) {
  const { svg, onNodeHover, onNodeLeave, onNodeClick } = options;
  const decorative = !!options.decorative;
  if (decorative) svg.classList.add("graph-svg--decorative");
  let networkModel = options.fullModel;
  const gRoot = d3.select(svg).select("#zoom-layer");
  const gLinks = gRoot.select("#links-layer");
  const gNodes = gRoot.select("#nodes-layer");

  let width = svg.clientWidth || window.innerWidth;
  let height = svg.clientHeight || window.innerHeight;
  // Limite inferiore: la filter-bar è `position: fixed; bottom: 0` quindi
  // copre la parte bassa dell'SVG. Calcoliamo la y in coordinate SVG dove
  // iniziano i tag, così i nodi non finiscono mai dietro.
  const filterBarEl = document.getElementById("filter-bar");
  function computeBottomBound() {
    // In modalità decorativa non c'è filter-bar: il bound inferiore è
    // l'intera altezza dell'SVG (i nodi possono usare tutta la verticale).
    if (decorative) return height;
    const svgRect = svg.getBoundingClientRect();
    if (filterBarEl) {
      const r = filterBarEl.getBoundingClientRect();
      if (r && Number.isFinite(r.top) && r.top > 0) {
        return Math.max(80, r.top - svgRect.top - 12);
      }
    }
    return height - 80;
  }
  let bottomBound = computeBottomBound();

  // Quando la filter-bar cambia altezza (es. wrap dei tag) aggiorniamo il
  // limite inferiore e diamo un piccolo restart alla simulazione così i
  // nodi si ricompongono dentro l'area visibile.
  if (filterBarEl && typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => {
      const next = computeBottomBound();
      if (Math.abs(next - bottomBound) > 2) {
        bottomBound = next;
        if (simulation) {
          simulation.alpha(Math.max(simulation.alpha(), 0.25)).restart();
        }
      }
    });
    ro.observe(filterBarEl);
  }
  let activeTagFilter = null;
  /** @type {d3.Simulation<any, undefined>|null} */
  let simulation = null;
  let linkSel = gLinks.selectAll("line.link");
  let nodeSel = gNodes.selectAll("g.graph-node");
  // Zoom solo scala (no pan): più stabile del d3.zoom completo.
  let viewScale = 1;
  const minScale = 0.35;
  const maxScale = 4;
  let viewTx = 0;
  let viewTy = 0;
  let nodeScale = NODE_SCALE_STEPS[2];
  let vizLinks = true;
  let vizNodesPreferred = true;
  /** @type {(id: string|null) => void} */
  let focusById = () => {};
  /** @type {() => void} */
  let clearFocusFn = () => {};
  let pinnedNodeId = null;
  /** Set di id ancora interattivi quando un progetto è selezionato (null = nessuna selezione). */
  let selectionAllowedIds = null;
  /** Adiacenze (link) correnti: id → Set di id collegati (incluso se stesso). */
  let nodeNeighbors = new Map();
  /** @type {Map<string, {x:number,y:number}>} */
  let nodePos = new Map();
  /** @type {object[]} */
  let currentNodes = [];
  /** @type {() => void} */
  let applyInactiveLayoutFn = () => {};
  /** Snapshot layout (ALL PROJECTS) per ripristino dopo filtri. */
  /** @type {Map<string, {x:number,y:number}>|null} */
  let allProjectsLayoutSnapshot = null;
  /** @type {number} */
  const FILTER_TRANSITION_MS = 460;

  function applyVizLayers() {
    const showL = vizLinks;
    const showN = vizLinks && vizNodesPreferred;
    gLinks.style("visibility", showL ? "visible" : "hidden").style("pointer-events", showL ? "auto" : "none");
    gNodes.style("visibility", showN ? "visible" : "hidden").style("pointer-events", showN ? "auto" : "none");
  }

  function clampScale(k) {
    return Math.max(minScale, Math.min(maxScale, k));
  }

  function applyScale(k) {
    viewScale = clampScale(k);
    // scala attorno al centro viewport
    const cx = width / 2;
    const cy = height / 2;
    gRoot.attr(
      "transform",
      `translate(${viewTx},${viewTy}) translate(${cx},${cy}) scale(${viewScale}) translate(${-cx},${-cy})`
    );
  }

  applyScale(1);

  if (!decorative) {
    d3.select(svg).on("wheel.zoomScale", (event) => {
      // zoom con rotella; nessun pan
      event.preventDefault();
      const delta = -event.deltaY;
      const factor = Math.pow(1.0016, delta);
      applyScale(viewScale * factor);
    });
  }

  // Pan trascinando lo sfondo (non nodi / non link).
  const panDrag = d3
    .drag()
    .filter((event) => {
      if (event.type === "mousedown" && event.button) return false;
      if (event.target?.closest?.(".graph-node")) return false;
      if (event.target?.closest?.("#links-layer")) return false;
      return true;
    })
    .on("start", (event) => {
      const se = event.sourceEvent;
      if (se?.preventDefault) se.preventDefault();
      if (se?.stopPropagation) se.stopPropagation();
      window.getSelection()?.removeAllRanges?.();
    })
    .on("drag", (event) => {
      const se = event.sourceEvent;
      if (se?.preventDefault) se.preventDefault();
      viewTx += event.dx;
      viewTy += event.dy;
      applyScale(viewScale);
    });

  if (!decorative) d3.select(svg).call(panDrag);

  // Scala per-nodo basata sull'overlap totale di tag: più tag in comune complessivi
  // → pianeta più grande (range ~0.78x .. 1.85x rispetto allo step base).
  function nodeOverlapFactor(d) {
    const r = Math.max(0, Math.min(1, Number(d?.overlapRatio) || 0));
    return 0.78 + r * 1.07;
  }

  function nodeDims(d) {
    const f = d ? nodeOverlapFactor(d) : 1;
    // Nodi "disattivati" (fuori dal filtro) → versione mini in basso a sx.
    const inactiveFactor = d?._inactive ? 0.42 : 1;
    const thumbR = 12.2 * nodeScale * f * inactiveFactor;
    const ringR = thumbR + 0.6;
    const hitR = 29 * nodeScale * Math.max(1, f) * inactiveFactor;
    return { ringR, thumbR, hitR, thumbD: thumbR * 2 };
  }

  function getModel() {
    // Quando c'è un filtro attivo, NON filtriamo via i nodi: marchiamo
    // come `_inactive` quelli che non hanno il tag, così possiamo spostarli
    // in basso a sinistra e tenerli visibili ma "spenti".
    if (!activeTagFilter) return networkModel;
    const tagNorm = String(activeTagFilter).trim();
    const nodes = networkModel.nodes.map((n) => ({
      ...n,
      _inactive: !(n.tagsNorm || []).includes(tagNorm),
    }));
    // Manteniamo solo i link tra nodi attivi (così non "tirano" gli inactive).
    const activeIds = new Set(nodes.filter((n) => !n._inactive).map((n) => n.id));
    const links = networkModel.links.filter(
      (l) => activeIds.has(typeof l.source === "object" ? l.source.id : l.source)
        && activeIds.has(typeof l.target === "object" ? l.target.id : l.target),
    );
    return { ...networkModel, nodes, links };
  }

  function drag(simulationRef) {
    function dragstarted(event, d) {
      const se = event.sourceEvent;
      if (se?.preventDefault) se.preventDefault();
      if (se?.stopPropagation) se.stopPropagation();
      window.getSelection()?.removeAllRanges?.();
      if (!event.active) simulationRef.alphaTarget(0.72).restart();
      d.fx = d.x;
      d.fy = d.y;
    }
    function dragged(event, d) {
      const se = event.sourceEvent;
      if (se?.preventDefault) se.preventDefault();
      d.fx = event.x;
      d.fy = event.y;
    }
    function dragended(event, d) {
      const se = event.sourceEvent;
      if (se?.preventDefault) se.preventDefault();
      window.getSelection()?.removeAllRanges?.();
      if (!event.active) simulationRef.alphaTarget(0);
      d.fx = null;
      d.fy = null;
      d.vx = 0;
      d.vy = 0;
      ticked();
    }
    return d3.drag().on("start", dragstarted).on("drag", dragged).on("end", dragended);
  }

  function ticked() {
    // Un singolo pass: clamp + transform + cache. Evitiamo D3 .attr()
    // su selezione (più costoso di setAttribute diretto) e riusiamo il Map.
    const boundPad = 14;
    const yMax = bottomBound;
    const w = width;
    const baseThumb = 12.2 * nodeScale;
    nodePos.clear();
    nodeSel.each(function (d) {
      if (!d || !Number.isFinite(d.x) || !Number.isFinite(d.y)) return;
      // Inline di nodeDims().thumbR (evita allocazione dell'oggetto ogni tick).
      const overlap = Math.max(0, Math.min(1, +d.overlapRatio || 0));
      const f = 0.78 + overlap * 1.07;
      const inactiveK = d._inactive ? 0.42 : 1;
      const r = baseThumb * f * inactiveK + boundPad;

      if (d.x < r) { d.x = r; if (d.vx < 0) d.vx = 0; }
      else if (d.x > w - r) { d.x = w - r; if (d.vx > 0) d.vx = 0; }
      if (d.y < r) { d.y = r; if (d.vy < 0) d.vy = 0; }
      else if (d.y > yMax - r) { d.y = yMax - r; if (d.vy > 0) d.vy = 0; }
      if (Number.isFinite(d.fx)) d.fx = d.fx < r ? r : d.fx > w - r ? w - r : d.fx;
      if (Number.isFinite(d.fy)) d.fy = d.fy < r ? r : d.fy > yMax - r ? yMax - r : d.fy;

      this.setAttribute("transform", `translate(${d.x},${d.y})`);
      if (d.id != null) nodePos.set(String(d.id), { x: d.x, y: d.y });
    });

    // I link sono nascosti via CSS; aggiorniamo le coordinate solo quando
    // sono effettivamente visualizzati (vizLinks attivo).
    if (vizLinks && !linkSel.empty()) {
      linkSel
        .attr("x1", (d) => d.source.x)
        .attr("y1", (d) => d.source.y)
        .attr("x2", (d) => d.target.x)
        .attr("y2", (d) => d.target.y);
    }
  }

  function rebuild() {
    bottomBound = computeBottomBound();
    const model = getModel();
    const nodes = model.nodes.map((n) => ({ ...n }));
    const linkObjs = model.links.map((l) => ({
      ...l,
      source: l.source,
      target: l.target,
    }));

    for (const l of linkObjs) {
      if (typeof l.source === "string") l.source = nodes.find((n) => n.id === l.source);
      if (typeof l.target === "string") l.target = nodes.find((n) => n.id === l.target);
    }

    // Adiacenze per highlight in hover/focus.
    /** @type {Map<string, Set<string>>} */
    const neighbors = new Map();
    /** @type {Map<string, Set<string>>} */
    const incidentLinkKeys = new Map();

    for (const n0 of nodes) {
      neighbors.set(n0.id, new Set([n0.id]));
      incidentLinkKeys.set(n0.id, new Set());
    }
    for (const l of linkObjs) {
      const a = l.source?.id;
      const b = l.target?.id;
      if (!a || !b) continue;
      neighbors.get(a)?.add(b);
      neighbors.get(b)?.add(a);
      const key = `${a}--${b}`;
      incidentLinkKeys.get(a)?.add(key);
      incidentLinkKeys.get(b)?.add(key);
      // salva sul link per lookup veloce
      l._k = key;
    }
    // Esponiamo le adiacenze (gli stessi "collegamenti" usati in hover) così
    // la selezione al click usa esattamente lo stesso insieme di progetti.
    nodeNeighbors = neighbors;

    const isAllView = activeTagFilter == null;
    const n = Math.max(1, nodes.length);
    const density = Math.sqrt(n);
    const seedSpread =
      (isAllView ? 280 : 165) + Math.min(isAllView ? 720 : 340, n * (isAllView ? 9.5 : 6.8));
    const chargeBase = (-380 - density * 52) * (isAllView ? 1.65 : 1.2);
    // Su dataset medio-grandi accorciamo il raggio di repulsione: meno coppie
    // da valutare per il quadtree → tick più leggero.
    const chargeDistanceMax = n >= 35
      ? (isAllView ? 380 : 300)
      : (isAllView ? 560 : 420);
    const baseDims = nodeDims();
    // Buffer di anti-sovrapposizione: garantisce uno spazio minimo tra i pianeti.
    const collisionBuffer = 18;
    const collR = Math.max(baseDims.thumbR + collisionBuffer, isAllView ? 42 : 36);
    const linkDist =
      ((135 + 920 / (density + 2.2)) / (1 + Math.log10(n + 3) * 0.1)) * 1.62;

    // Raggio radiale per nodo: chi ha più tag in comune complessivi sta più vicino al centro.
    const usableH = bottomBound > 0 ? bottomBound : height;
    const maxRadial = Math.min(width, usableH) * 0.42;
    const minRadial = Math.min(width, usableH) * 0.06;
    function radialForNode(d) {
      const r = Math.max(0, Math.min(1, Number(d?.overlapRatio) || 0));
      return minRadial + (1 - r) * (maxRadial - minRadial);
    }

    // Posizione dei nodi "disattivati" (no tag selezionato): angolo in basso a sx,
    // disposti in una griglietta compatta.
    const inactiveOriginX = 70;
    const inactiveOriginY = Math.max(140, bottomBound - 30);
    const inactiveSpread = 36;
    const inactiveCols = 6;

    function assignInactiveTargets() {
      const list = nodes
        .filter((nd) => nd._inactive)
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
      list.forEach((nd, i) => {
        nd._inactiveTargetX = inactiveOriginX + (i % inactiveCols) * inactiveSpread;
        nd._inactiveTargetY = inactiveOriginY - Math.floor(i / inactiveCols) * inactiveSpread;
      });
    }

    assignInactiveTargets();
    currentNodes = nodes;
    applyInactiveLayoutFn = assignInactiveTargets;

    seedNodes(
      nodes,
      width,
      height,
      seedSpread,
      decorative ? height : bottomBound,
      decorative ? 0 : GRAPH_Y_OFFSET,
    );

    if (simulation) {
      simulation.on("end", null);
      simulation.stop();
    }

    const svgEl = d3.select(svg);
    let defsSel = svgEl.select("defs");
    if (defsSel.empty()) defsSel = svgEl.insert("defs", ":first-child");

    defsSel
      .selectAll("clipPath.node-thumb-clip")
      .data(nodes, (d) => d.id)
      .join(
        (enter) => {
          const cp = enter
            .append("clipPath")
            .attr("class", "node-thumb-clip")
            .attr("id", (d) => thumbClipId(d))
            .attr("clipPathUnits", "objectBoundingBox");
          cp.append("circle").attr("cx", 0.5).attr("cy", 0.5).attr("r", 0.5);
          return cp;
        },
        (update) => update.attr("id", (d) => thumbClipId(d)),
        (exit) => exit.remove()
      );

    linkObjs.sort((a, b) => (a.weight ?? 0) - (b.weight ?? 0));

    linkSel = gLinks
      .selectAll("line.link")
      .data(linkObjs, (d) => `${d.source.id}-${d.target.id}`)
      .join(
        (enter) =>
          enter
            .append("line")
            .attr("class", (d) => `link link--strength link--${d.strengthTier || "cool"}`)
            .attr("data-kind", "strength")
            .attr("data-strength", (d) => d.strengthTier || "cool")
            .attr("stroke", (d) => d.strokeColor || "rgba(160,170,200,0.35)"),
        (update) =>
          update
            .attr("class", (d) => `link link--strength link--${d.strengthTier || "cool"}`)
            .attr("data-kind", "strength")
            .attr("data-strength", (d) => d.strengthTier || "cool")
            .attr("stroke", (d) => d.strokeColor || "rgba(160,170,200,0.35)"),
        (exit) => exit.remove()
      )
      .sort((a, b) => (a.weight ?? 0) - (b.weight ?? 0));

    nodeSel = gNodes
      .selectAll("g.graph-node")
      .data(nodes, (d) => d.id)
      .join(
        (enter) => {
          const g = enter.append("g").attr("class", "graph-node");
          g.append("circle")
            .attr("class", "graph-node__halo")
            .attr("r", (d) => nodeDims(d).ringR * 1.5)
            .attr("fill", "none")
            .attr("stroke", "rgba(210, 225, 255, 0.55)")
            .attr("stroke-width", 2.2)
            .attr("stroke-opacity", 0);
          g.append("circle")
            .attr("class", "graph-node__ring")
            .attr("r", (d) => nodeDims(d).ringR)
            .attr("fill", "none")
            .attr("stroke-width", 1.4)
            .attr("stroke-opacity", 0.72);
          g.append("image")
            .attr("class", "graph-node__thumb")
            .attr("x", (d) => -nodeDims(d).thumbR)
            .attr("y", (d) => -nodeDims(d).thumbR)
            .attr("width", (d) => nodeDims(d).thumbD)
            .attr("height", (d) => nodeDims(d).thumbD)
            .attr("preserveAspectRatio", "xMidYMid slice")
            .attr("clip-path", (d) => `url(#${thumbClipId(d)})`)
            .each(function (d) {
              const u = getPreviewHref(d.previewPath || "");
              if (!u) return;
              this.setAttribute("href", u);
              this.setAttributeNS("http://www.w3.org/1999/xlink", "href", u);
            })
            .attr("display", (d) => (d.previewPath ? null : "none"));
          g.append("circle")
            .attr("class", "graph-node__hit")
            .attr("r", (d) => nodeDims(d).hitR)
            .attr("fill", "transparent")
            .attr("stroke", "none")
            .attr("pointer-events", "all")
            .attr("tabindex", -1);
          g.append("title").text((d) => d.titolo);
          return g;
        },
        (update) => {
          update.select("circle.graph-node__halo").attr("r", (d) => nodeDims(d).ringR * 1.5);
          update.select("circle.graph-node__ring").attr("r", (d) => nodeDims(d).ringR);
          update
            .select("image.graph-node__thumb")
            .attr("x", (d) => -nodeDims(d).thumbR)
            .attr("y", (d) => -nodeDims(d).thumbR)
            .attr("width", (d) => nodeDims(d).thumbD)
            .attr("height", (d) => nodeDims(d).thumbD);
          update.select("circle.graph-node__hit").attr("r", (d) => nodeDims(d).hitR);
          update
            .select("image.graph-node__thumb")
            .each(function (d) {
              const u = getPreviewHref(d.previewPath || "");
              if (u) {
                this.setAttribute("href", u);
                this.setAttributeNS("http://www.w3.org/1999/xlink", "href", u);
              }
            })
            .attr("display", (d) => (d.previewPath ? null : "none"));
          return update;
        },
        (exit) => exit.remove()
      );

    nodeSel.select("image.graph-node__thumb").on("error", function () {
      d3.select(this).attr("display", "none");
    });

    nodeSel.classed("graph-node--inactive", (d) => !!d._inactive);

    function clearFocus() {
      if (pinnedNodeId) {
        // se c'è un pin attivo, non perdere l'evidenziazione
        const n = nodes.find((x) => x.id === pinnedNodeId);
        if (n) return applyFocus(n);
      }
      nodeSel.classed("graph-node--dim", false);
      nodeSel.classed("graph-node--focus", false);
      nodeSel.classed("graph-node--pinned", false);
      nodeSel.classed("graph-node--neighbor", false);
      linkSel.classed("link--dim", false);
      linkSel.classed("link--active", false);
    }

    function tagRelatedIds(nodeId) {
      const origin = nodes.find((x) => x.id === nodeId);
      if (!origin) return new Set([nodeId]);
      const keep = new Set([nodeId]);
      const tags = new Set(
        (origin.tagsNorm || [])
          .map((t) => String(t).trim().toLowerCase())
          .filter(Boolean),
      );
      if (!tags.size) return keep;
      for (const n of nodes) {
        if (n._inactive || n.id === nodeId) continue;
        const shares = (n.tagsNorm || []).some((t) =>
          tags.has(String(t).trim().toLowerCase()),
        );
        if (shares) keep.add(n.id);
      }
      return keep;
    }

    function applyFocus(node) {
      const activeId = pinnedNodeId || node?.id;
      if (!activeId) return;
      const keepLinks = incidentLinkKeys.get(activeId) || new Set();
      const keep = tagRelatedIds(activeId);
      const isPinned = !!pinnedNodeId;

      nodeSel.classed("graph-node--dim", (d) => !keep.has(d.id));
      nodeSel.classed("graph-node--focus", (d) => !isPinned && d.id === node.id);
      nodeSel.classed("graph-node--pinned", (d) => isPinned && d.id === pinnedNodeId);
      nodeSel.classed("graph-node--neighbor", false);
      linkSel.classed("link--dim", (l) => !keepLinks.has(l._k));
      linkSel.classed("link--active", false);
    }

    clearFocusFn = clearFocus;
    focusById = (id) => {
      if (!id) return clearFocus();
      const n = nodes.find((x) => x.id === id);
      if (!n) return clearFocus();
      applyFocus(n);
    };

    // Piccolo delay sull'hover: evita di attivare focus/preview quando il
    // mouse passa solo di sfuggita su un progetto.
    const HOVER_DELAY_MS = 180;
    let hoverTimerId = null;
    let hoverActiveId = null;

    function cancelHoverTimer() {
      if (hoverTimerId != null) {
        clearTimeout(hoverTimerId);
        hoverTimerId = null;
      }
    }

    if (!decorative) {
      nodeSel
        .attr("tabindex", 0)
        .attr("role", "button")
        .attr("aria-label", (d) => `Progetto: ${d.titolo}`)
        .on("mouseenter", (event, d) => {
          cancelHoverTimer();
          hoverTimerId = setTimeout(() => {
            hoverTimerId = null;
            hoverActiveId = d.id;
            // Con una selezione attiva la vista resta fissa sul progetto
            // cliccato: l'hover non deve cambiare i collegamenti evidenziati.
            if (!pinnedNodeId && !selectionAllowedIds) applyFocus(d);
            if (onNodeHover) onNodeHover(d, event);
          }, HOVER_DELAY_MS);
        })
        .on("mousemove", (event, d) => {
          if (hoverActiveId === d.id && onNodeHover) onNodeHover(d, event);
        })
        .on("mouseleave", () => {
          cancelHoverTimer();
          const wasActive = hoverActiveId != null;
          hoverActiveId = null;
          if (wasActive) {
            if (!selectionAllowedIds) clearFocus();
            if (onNodeLeave) onNodeLeave();
          }
        })
        .on("click", (event, d) => {
          event.stopPropagation();
          if (onNodeClick) onNodeClick(d, event);
        })
        .on("focus", (_event, d) => {
          if (!pinnedNodeId && !selectionAllowedIds) applyFocus(d);
        })
        .on("blur", () => {
          if (!selectionAllowedIds) clearFocus();
        })
        .on("keydown", (event, d) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (onNodeClick) onNodeClick(d, event);
          }
        });
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Link ancora più corti: cluster più compatti.
    const minLinkDist = isAllView ? 52 : 44;
    const maxLinkDist = isAllView ? 205 : 172;

    function linkDistance(d) {
      const common = Math.max(0, d.tagsCommon ?? d.tagShared ?? 0);
      // Più tag in comune → distanza più breve (avvicinamento).
      const pull = 1 - Math.exp(-0.65 * common);
      return minLinkDist + (maxLinkDist - minLinkDist) * (1 - pull);
    }

    function linkStrength(d) {
      const common = Math.max(0, d.tagsCommon ?? d.tagShared ?? 0);
      const pull = 1 - Math.exp(-0.55 * common);
      const base = reducedMotion ? 0.32 : 0.52;
      return Math.min(0.82, base + 0.42 * pull);
    }

    function settleSimulation() {
      ticked();
      for (const n of nodes) {
        n.vx = 0;
        n.vy = 0;
      }
      simulation?.stop();
    }

    function onSimTick() {
      ticked();
    }

    const centerX = width / 2;
    // Il centro verticale considera l'area utile (sopra la filter-bar) e
    // NON metà schermo: altrimenti, con tag su più righe, i nodi attivi
    // finiscono visivamente nella metà inferiore. In modalità filtrata
    // (o decorativa) azzeriamo l'offset così è esattamente al centro
    // visivo dell'area.
    const centerY = decorative
      ? height / 2
      : bottomBound / 2 + (activeTagFilter ? 0 : GRAPH_Y_OFFSET);
    // Centro "filtro": punto verso cui convergono i progetti attivi.
    // Lo bilanciamo verso destra del centro pure per allontanarli dal
    // cluster degli inactive nell'angolo basso-sx.
    const filterCenterX = centerX + width * 0.14;
    const filterCenterY = centerY;

    simulation = d3
      .forceSimulation(nodes)
      .force(
        "link",
        d3
          .forceLink(linkObjs)
          .id((d) => d.id)
          .distance(linkDistance)
          // Quando c'è un filtro attivo, i link non devono "spingere": i nodi
          // attivi si organizzano solo al centro tramite le forze X/Y.
          .strength((l) =>
            activeTagFilter ? 0 : linkStrength(l),
          )
      )
      .force(
        "charge",
        d3
          .forceManyBody()
          // Nessuna repulsione dagli inactive verso gli attivi (e viceversa
          // quasi trascurabile fra inactive). Così i pochi attivi non vengono
          // "spinti via" dai tanti nodi raggruppati in basso.
          .strength((d) => {
            if (d._inactive) return -20;
            const base = reducedMotion ? chargeBase * 0.72 : chargeBase;
            return activeTagFilter ? base * 0.45 : base;
          })
          .distanceMax(chargeDistanceMax)
      )
      .force(
        "collision",
        d3
          .forceCollide()
          .radius((d) => {
            if (d._inactive) return nodeDims(d).thumbR + 4;
            return Math.max(collR, nodeDims(d).thumbR + collisionBuffer);
          })
          .strength(0.92)
          // 1 iterazione invece di 2: con dataset medio-grandi (>=35 nodi)
          // ogni iterazione costa O(n) di lavoro extra al tick.
          .iterations(n >= 35 ? 1 : 2)
      )
      .force(
        "radial",
        d3
          .forceRadial(
            (d) => (d._inactive ? 0 : radialForNode(d)),
            centerX,
            centerY,
          )
          // In vista filtrata disattivo la forza radiale: i nodi attivi
          // devono raggrupparsi attorno al centro, non distribuirsi su un
          // anello (era questo a "spingerli verso l'alto").
          .strength((d) =>
            d._inactive ? 0 : activeTagFilter ? 0 : reducedMotion ? 0.18 : 0.14,
          )
      )
      .force(
        "activeX",
        d3
          .forceX(filterCenterX)
          .strength((d) => (!d._inactive && activeTagFilter ? 0.38 : 0))
      )
      .force(
        "activeY",
        d3
          .forceY(filterCenterY)
          .strength((d) => (!d._inactive && activeTagFilter ? 0.38 : 0))
      )
      .force(
        "inactiveX",
        d3
          .forceX((d) => (d._inactive ? d._inactiveTargetX ?? inactiveOriginX : 0))
          .strength((d) => (d._inactive ? 0.42 : 0))
      )
      .force(
        "inactiveY",
        d3
          .forceY((d) => (d._inactive ? d._inactiveTargetY ?? inactiveOriginY : 0))
          .strength((d) => (d._inactive ? 0.42 : 0))
      )
      .force(
        "center",
        d3
          .forceCenter(centerX, centerY)
          // Disattivato in modalità filtrata (le forze activeX/Y già
          // gestiscono il centraggio dei nodi attivi).
          .strength(activeTagFilter ? 0 : 0.025),
      )
      .alpha(reducedMotion ? 0.58 : 0.78)
      // alphaDecay più alto → la simulazione si calma prima e smette di
      // "tremolare" attorno alle posizioni di equilibrio.
      // Su dataset medio-grandi (e sul mini-grafo decorativo della hero)
      // alziamo l'alphaDecay: chiude prima la coda di tick a basso valore
      // informativo che è il principale responsabile del lag percepito.
      .alphaDecay(
        reducedMotion ? 0.28 : decorative ? 0.14 : n >= 35 ? 0.105 : 0.085,
      )
      // alphaMin più alto → niente coda di tick a energia quasi-zero che
      // producono micro-jitter visibili. Su decorativo/dataset medio-grandi
      // alziamo ancora la soglia per chiudere prima la simulazione.
      .alphaMin(decorative ? 0.03 : n >= 35 ? 0.02 : 0.012)
      // velocityDecay più alto → meno overshoot/oscillazioni residue.
      .velocityDecay(reducedMotion ? 0.78 : 0.62)
      .on("tick", onSimTick)
      .on("end", settleSimulation);

    nodeSel.call(drag(simulation));

    applyVizLayers();
  }

  function resize() {
    width = svg.clientWidth || window.innerWidth;
    height = svg.clientHeight || window.innerHeight;
    bottomBound = computeBottomBound();
    applyScale(viewScale);
    if (simulation) {
      simulation.force("center", d3.forceCenter(width / 2, bottomBound / 2 + GRAPH_Y_OFFSET));
      simulation.velocityDecay(0.58).alpha(0.22).restart();
    }
  }

  function snapshotAllProjectsLayoutIfNeeded(prevFilter, nextFilter) {
    // Salviamo la disposizione solo quando usciamo da ALL PROJECTS verso un filtro.
    if (prevFilter == null && nextFilter != null) {
      const snap = new Map();
      for (const n of currentNodes) {
        if (!n?.id) continue;
        if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
        snap.set(String(n.id), { x: n.x, y: n.y });
      }
      allProjectsLayoutSnapshot = snap.size ? snap : null;
    }
  }

  function restoreAllProjectsLayoutIfAvailable() {
    if (!allProjectsLayoutSnapshot) return false;
    for (const n of currentNodes) {
      const id = n?.id != null ? String(n.id) : "";
      if (!id) continue;
      const p = allProjectsLayoutSnapshot.get(id);
      if (!p) continue;
      n.x = p.x;
      n.y = p.y;
      if (pinnedNodeId !== id) {
        n.fx = null;
        n.fy = null;
      }
      n.vx = 0;
      n.vy = 0;
    }
    ticked();
    return true;
  }

  function centerOnNode(id, opts = {}) {
    const nid = id ? String(id) : "";
    if (!nid) return;
    const p = nodePos.get(nid);
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;

    const cx = width / 2;
    const cy = height / 2 + GRAPH_Y_OFFSET;
    const targetSx = Number.isFinite(opts.screenX) ? opts.screenX : width * 0.36;
    const targetSy = Number.isFinite(opts.screenY) ? opts.screenY : height * 0.46;

    viewTx = targetSx - (p.x - cx) * viewScale - cx;
    viewTy = targetSy - (p.y - cy) * viewScale - cy;
    applyScale(viewScale);
  }

  return {
    rebuild,
    resize,
    setNetworkModel(model) {
      if (!model) return;
      networkModel = model;
      rebuild();
    },
    hasNode(id) {
      return nodePos.has(String(id || ""));
    },
    centerOnNode,
    focusNode(id) {
      focusById(String(id || ""));
    },
    clearFocus() {
      clearFocusFn();
    },
    pinNode(id) {
      pinnedNodeId = id ? String(id) : null;
      if (pinnedNodeId) focusById(pinnedNodeId);
      else clearFocusFn();
    },
    unpinNode() {
      pinnedNodeId = null;
      clearFocusFn();
    },
    // Selezione: solo i nodi in `allowedIds` (es. quelli con tag in comune)
    // restano interattivi/visibili; gli altri si "spengono" e non sono più
    // cliccabili né hoverabili.
    setSelection(allowedIds, selectedId) {
      selectionAllowedIds =
        allowedIds instanceof Set
          ? allowedIds
          : Array.isArray(allowedIds)
            ? new Set(allowedIds.map(String))
            : null;
      const selId = selectedId != null ? String(selectedId) : null;
      // Azzera eventuali evidenziazioni di collegamenti rimaste dall'hover
      // precedente al click: la vista deve restare fissa e pulita.
      clearFocusFn();
      if (nodeSel && !nodeSel.empty()) {
        nodeSel.classed("graph-node--off", (d) =>
          selectionAllowedIds ? !selectionAllowedIds.has(String(d.id)) : false,
        );
        nodeSel.classed("graph-node--selected", (d) =>
          selId != null && String(d.id) === selId,
        );
      }
    },
    clearSelection() {
      selectionAllowedIds = null;
      if (nodeSel && !nodeSel.empty()) {
        nodeSel.classed("graph-node--off", false);
        nodeSel.classed("graph-node--selected", false);
      }
    },
    // Id dei progetti collegati a `id` (gli stessi evidenziati in hover),
    // incluso `id` stesso.
    getNeighborIds(id) {
      const set = nodeNeighbors.get(String(id));
      return set ? new Set(set) : new Set([String(id)]);
    },
    ensureNodeNotUnderRect(id, rect, pad = 18) {
      const nid = id ? String(id) : "";
      if (!nid || !rect) return;
      const p = nodePos.get(nid);
      if (!p) return;

      // Converti coordinate grafo -> screen (px)
      const cx = width / 2;
      const cy = height / 2;
      const sx = (p.x - cx) * viewScale + cx + viewTx;
      const sy = (p.y - cy) * viewScale + cy + viewTy;

      const left = rect.left - pad;
      const right = rect.right + pad;
      const top = rect.top - pad;
      const bottom = rect.bottom + pad;

      const overlaps = sx >= left && sx <= right && sy >= top && sy <= bottom;
      if (!overlaps) return;

      // Spostiamo preferibilmente a sinistra del pannello; se non basta, sopra.
      let dx = 0;
      let dy = 0;
      if (sx > left) dx = left - sx;
      if (sy > top) dy = top - sy;

      viewTx += dx;
      viewTy += dy;
      applyScale(viewScale);
    },
    setFilter(tag) {
      const t = tag && String(tag).trim() ? String(tag).trim() : null;
      if (t === activeTagFilter) return;
      const prevFilter = activeTagFilter;
      snapshotAllProjectsLayoutIfNeeded(prevFilter, t);
      activeTagFilter = t;

      // Se la simulazione non esiste ancora (primo paint), fall back al rebuild.
      if (!simulation || currentNodes.length === 0) {
        rebuild();
        return;
      }

      // Aggiorna i flag `_inactive` sui nodi correnti.
      for (const n of currentNodes) {
        n._inactive = activeTagFilter
          ? !(n.tagsNorm || []).includes(activeTagFilter)
          : false;
      }
      // Ricomputa i target dell'angolo basso-sx per gli inactive.
      applyInactiveLayoutFn();

      // Aggiorna i parametri delle forze sensibili al filtro.
      simulation.force("center")?.strength(activeTagFilter ? 0 : 0.025);

      // IMPORTANTE: d3-force cacha i target/strength delle forze X/Y/Collide/...
      // alla chiamata di `initialize()`. Avendo cambiato `_inactive` e i
      // `_inactiveTargetX/Y` sui nodi, dobbiamo forzare il re-initialize di
      // tutte le forze, altrimenti useranno i vecchi valori (e i nodi
      // "disattivati" non andrebbero nell'angolo basso-sx).
      simulation.nodes(currentNodes);

      // Aggiorna le dimensioni dei nodi con una transizione (rimpicciolimento/
      // ingrandimento fluido).
      if (nodeSel && !nodeSel.empty()) {
        const tr = nodeSel.transition().duration(FILTER_TRANSITION_MS).ease(d3.easeCubicInOut);
        tr.select("circle.graph-node__halo").attr("r", (d) => nodeDims(d).ringR * 1.5);
        tr.select("circle.graph-node__ring").attr("r", (d) => nodeDims(d).ringR);
        tr.select("image.graph-node__thumb")
          .attr("x", (d) => -nodeDims(d).thumbR)
          .attr("y", (d) => -nodeDims(d).thumbR)
          .attr("width", (d) => nodeDims(d).thumbD)
          .attr("height", (d) => nodeDims(d).thumbD);
        tr.select("circle.graph-node__hit").attr("r", (d) => nodeDims(d).hitR);
        nodeSel.classed("graph-node--inactive", (d) => !!d._inactive);
      }

      // Riavvia la simulazione con abbastanza energia da coprire anche la
      // grande distanza "angolo basso-sx → centro" quando si rimuove il
      // filtro. Manteniamo il velocityDecay di default così non rallenta
      // troppo a metà strada.
      const goingToAll = activeTagFilter === null;
      if (goingToAll) {
        // Ripristina la disposizione originale di ALL PROJECTS, così tornando
        // da un filtro la posizione non cambia “a caso”.
        const restored = restoreAllProjectsLayoutIfAvailable();
        // Reset delle velocità: tutti i nodi devono ridistribuirsi liberamente
        // attorno al centro radiale, senza il momentum/cluster basso-sx
        // accumulato durante la modalità filtrata.
        if (!restored) {
          for (const n of currentNodes) {
            n.vx = 0;
            n.vy = 0;
          }
        }
        // Decay più lento → più tick disponibili per ridistribuire i nodi
        // sull'anello radiale. Su dataset medio-grandi non possiamo
        // permetterci un decay troppo basso (troppi tick costosi): scaliamo
        // i valori.
        const prevDecay = simulation.alphaDecay();
        const bigSet = currentNodes.length >= 35;
        const tempDecay = bigSet ? 0.072 : 0.045;
        const restoreMs = bigSet ? 1100 : 1600;
        // Se abbiamo ripristinato posizioni, basta un kick leggero.
        simulation
          .alpha(restored ? 0.32 : 1)
          .alphaDecay(tempDecay)
          .alphaTarget(0)
          .restart();
        setTimeout(() => {
          if (simulation) simulation.alphaDecay(prevDecay);
        }, restoreMs);
      } else {
        simulation.alpha(0.85).alphaTarget(0).restart();
      }
    },
    getActiveFilter() {
      return activeTagFilter;
    },
    resetView() {
      viewTx = 0;
      viewTy = 0;
      applyScale(1);
    },
    zoomIn() {
      applyScale(viewScale * 1.12);
    },
    zoomOut() {
      applyScale(viewScale / 1.12);
    },
    getScale() {
      return viewScale;
    },
    getPan() {
      return { x: viewTx, y: viewTy };
    },
    setPan(pan) {
      const x = Number(pan?.x);
      const y = Number(pan?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      viewTx = x;
      viewTy = y;
      applyScale(viewScale);
    },
    setVizLayers(links, nodesPreferred) {
      vizLinks = !!links;
      if (!vizLinks) vizNodesPreferred = false;
      else vizNodesPreferred = !!nodesPreferred;
      applyVizLayers();
    },
    getVizLayers() {
      return { links: vizLinks, nodesPreferred: vizNodesPreferred };
    },
    setNodeScale(k) {
      const nk = nearestNodeScaleStep(k);
      nodeScale = nk;
      // aggiorna subito dimensioni (senza ricostruire tutta la simulazione)
      gNodes.selectAll("circle.graph-node__halo").attr("r", (d) => nodeDims(d).ringR * 1.5);
      gNodes.selectAll("circle.graph-node__ring").attr("r", (d) => nodeDims(d).ringR);
      gNodes
        .selectAll("image.graph-node__thumb")
        .attr("x", (d) => -nodeDims(d).thumbR)
        .attr("y", (d) => -nodeDims(d).thumbR)
        .attr("width", (d) => nodeDims(d).thumbD)
        .attr("height", (d) => nodeDims(d).thumbD);
      gNodes.selectAll("circle.graph-node__hit").attr("r", (d) => nodeDims(d).hitR);
    },
  };
}
