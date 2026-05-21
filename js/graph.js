import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { filterNetworkByTag, MACRO_META, getPreviewHref } from "./graphData.js";

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

function clusterCenter(clusterId, width, height) {
  const idx = Math.max(
    0,
    MACRO_META.findIndex((c) => c.id === clusterId)
  );
  const t = MACRO_META.length > 0 ? idx / MACRO_META.length : 0;
  const angle = t * Math.PI * 2 - Math.PI / 2;
  // Centri macro morbidi: area centrale, non anello rigido.
  const rx = width * 0.52;
  const ry = height * 0.38;
  return {
    x: width * 0.5 + Math.cos(angle) * rx,
    y: height * 0.5 + Math.sin(angle) * ry + GRAPH_Y_OFFSET,
  };
}

function macroTarget(n, width, height) {
  const center = clusterCenter(n.primaryMacro, width, height);
  const dx = Number(n._macroDx) || 0;
  const dy = Number(n._macroDy) || 0;
  return {
    x: center.x + dx,
    y: center.y + dy,
  };
}

/** Offset deterministico attorno al centro macrocategoria (evita sovrapposizioni su assi). */
function assignClusterOffsets(nodes, isAllView) {
  /** @type {Map<string, object[]>} */
  const byMacro = new Map();
  for (const n of nodes) {
    const key = n.primaryMacro || "default";
    if (!byMacro.has(key)) byMacro.set(key, []);
    byMacro.get(key).push(n);
  }

  for (const group of byMacro.values()) {
    group.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const count = group.length;
    const baseR = isAllView ? 52 : 38;
    const spreadR = isAllView ? 108 : 72;

    group.forEach((n, i) => {
      const id = String(n.id);
      let h = 2166136261;
      for (let k = 0; k < id.length; k++) {
        h ^= id.charCodeAt(k);
        h = Math.imul(h, 16777619);
      }
      const hash = h >>> 0;
      const angle = (hash % 6283) * 0.001 + i * 1.17 + (hash % 401) * 0.0023;
      const t = count > 1 ? i / (count - 1) : 0;
      const radius = baseR + Math.sqrt(t) * spreadR + (hash % 113) * 0.62 + (hash % 19) * 2.4;
      n._macroDx = Math.cos(angle) * radius;
      n._macroDy = Math.sin(angle) * radius;
    });
  }
}

const ALIGN_SNAP_ANGLES = [
  0,
  Math.PI / 4,
  Math.PI / 2,
  (3 * Math.PI) / 4,
  Math.PI,
  -Math.PI / 4,
  -Math.PI / 2,
  (-3 * Math.PI) / 4,
];

function snapMisalignment(angle) {
  let best = Math.PI;
  for (const s of ALIGN_SNAP_ANGLES) {
    const d = Math.abs(Math.atan2(Math.sin(angle - s), Math.cos(angle - s)));
    if (d < best) best = d;
  }
  return best;
}

function stablePerpDir(a, b) {
  const ida = String(a.id);
  const idb = String(b.id);
  return (ida.charCodeAt(0) + idb.charCodeAt(0) + ida.length) % 2 === 0 ? 1 : -1;
}

/** Evita link orizzontali, verticali o diagonali (sovrapposizione linee). */
function nudgeLinkOffAxis(a, b, { angleTol, maxNudge, gain }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 22) return;

  const mis = snapMisalignment(Math.atan2(dy, dx));
  if (mis > angleTol) return;

  const t = 1 - mis / angleTol;
  const push = Math.min(maxNudge, dist * 0.05) * t * gain;
  const dir = stablePerpDir(a, b);
  const px = (-dy / dist) * dir;
  const py = (dx / dist) * dir;

  if (a.fx == null && a.fy == null) {
    a.x += px * push * 0.5;
    a.y += py * push * 0.5;
  }
  if (b.fx == null && b.fy == null) {
    b.x -= px * push * 0.5;
    b.y -= py * push * 0.5;
  }
}

function forceAvoidAlignedLinks(opts = {}) {
  let links = [];
  const angleTol = ((opts.angleDeg ?? 8) * Math.PI) / 180;
  const strength = opts.strength ?? 0.2;
  const maxNudge = opts.maxNudge ?? 1.6;

  function force(alpha) {
    const k = strength * Math.min(1, alpha + 0.05);
    if (k < 0.006) return;
    for (const l of links) {
      const a = l.source;
      const b = l.target;
      if (!a || !b) continue;
      nudgeLinkOffAxis(a, b, { angleTol, maxNudge, gain: k });
    }
  }

  force.links = function (_) {
    if (arguments.length) {
      links = _;
      return force;
    }
    return links;
  };

  return force;
}

function finalizeDeAlign(nodes, links, passes = 6) {
  const angleTol = (8 * Math.PI) / 180;
  for (let p = 0; p < passes; p++) {
    for (const l of links) {
      const a = l.source;
      const b = l.target;
      if (!a || !b) continue;
      nudgeLinkOffAxis(a, b, { angleTol, maxNudge: 3.2, gain: 0.85 - p * 0.08 });
    }
  }
}

function seedNodes(nodes, width, height, spread) {
  for (const n of nodes) {
    const { x: cx, y: cy } = macroTarget(n, width, height);
    n.x = cx + (Math.random() - 0.5) * spread;
    n.y = cy + (Math.random() - 0.5) * spread;
    if (n.vx !== undefined) n.vx = 0;
    if (n.vy !== undefined) n.vy = 0;
  }
}

/**
 * @param {object} options
 * @param {SVGSVGElement} options.svg
 * @param {object} options.fullModel
 * @param {(node: object) => void} [options.onNodeHover]
 * @param {(node: object|null) => void} [options.onNodeLeave]
 * @param {(node: object) => void} [options.onNodeClick]
 */
export function createGraphController(options) {
  const { svg, onNodeHover, onNodeLeave, onNodeClick } = options;
  let networkModel = options.fullModel;
  const gRoot = d3.select(svg).select("#zoom-layer");
  const gLinks = gRoot.select("#links-layer");
  const gNodes = gRoot.select("#nodes-layer");

  let width = svg.clientWidth || window.innerWidth;
  let height = svg.clientHeight || window.innerHeight;
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
  /** @type {Map<string, {x:number,y:number}>} */
  let nodePos = new Map();

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

  d3.select(svg).on("wheel.zoomScale", (event) => {
    // zoom con rotella; nessun pan
    event.preventDefault();
    const delta = -event.deltaY;
    const factor = Math.pow(1.0016, delta);
    applyScale(viewScale * factor);
  });

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

  d3.select(svg).call(panDrag);

  function nodeDims() {
    const ringR = 17 * nodeScale;
    const thumbR = 12.2 * nodeScale;
    const hitR = 29 * nodeScale;
    return { ringR, thumbR, hitR, thumbD: thumbR * 2 };
  }

  function getModel() {
    return activeTagFilter ? filterNetworkByTag(networkModel, activeTagFilter) : networkModel;
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
      const links = simulationRef.force("link")?.links?.() || [];
      finalizeDeAlign(simulationRef.nodes(), links, 3);
      ticked();
    }
    return d3.drag().on("start", dragstarted).on("drag", dragged).on("end", dragended);
  }

  function ticked() {
    linkSel
      .attr("x1", (d) => d.source.x)
      .attr("y1", (d) => d.source.y)
      .attr("x2", (d) => d.target.x)
      .attr("y2", (d) => d.target.y);

    nodeSel.attr("transform", (d) => `translate(${d.x},${d.y})`);

    // cache posizioni per richieste esterne (mobile auto-pan)
    nodePos = new Map();
    nodeSel.each((d) => {
      if (d?.id != null && Number.isFinite(d.x) && Number.isFinite(d.y)) nodePos.set(String(d.id), { x: d.x, y: d.y });
    });
  }

  function rebuild() {
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

    const isAllView = activeTagFilter == null;
    const n = Math.max(1, nodes.length);
    const density = Math.sqrt(n);
    const seedSpread =
      (isAllView ? 280 : 165) + Math.min(isAllView ? 720 : 340, n * (isAllView ? 9.5 : 6.8));
    const chargeBase = (-380 - density * 52) * (isAllView ? 2.05 : 1.45);
    const chargeDistanceMax = isAllView ? 680 : 480;
    const dims = nodeDims();
    const collR = Math.max(dims.hitR + 14, dims.thumbR + 18, isAllView ? 50 : 44);
    const linkDist =
      ((135 + 920 / (density + 2.2)) / (1 + Math.log10(n + 3) * 0.1)) * 1.62;
    const clusterStrength = isAllView ? 0.052 : 0.038;
    const clusterStrengthRM = isAllView ? 0.068 : 0.048;

    assignClusterOffsets(nodes, isAllView);
    seedNodes(nodes, width, height, seedSpread);

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
          const { ringR, thumbR, thumbD, hitR } = nodeDims();
          const g = enter.append("g").attr("class", "graph-node");
          g.append("circle")
            .attr("class", "graph-node__halo")
            .attr("r", ringR * 1.5)
            .attr("fill", "none")
            .attr("stroke", "rgba(210, 225, 255, 0.55)")
            .attr("stroke-width", 2.2)
            .attr("stroke-opacity", 0);
          g.append("circle")
            .attr("class", "graph-node__ring")
            .attr("r", ringR)
            .attr("fill", "none")
            .attr("stroke-width", 1.4)
            .attr("stroke-opacity", 0.72);
          g.append("image")
            .attr("class", "graph-node__thumb")
            .attr("x", -thumbR)
            .attr("y", -thumbR)
            .attr("width", thumbD)
            .attr("height", thumbD)
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
            .attr("r", hitR)
            .attr("fill", "rgba(255,255,255,0.02)")
            .attr("stroke", "none")
            .attr("pointer-events", "all")
            .attr("tabindex", -1);
          g.append("title").text((d) => d.titolo);
          return g;
        },
        (update) => {
          const { ringR, thumbR, thumbD, hitR } = nodeDims();
          update.select("circle.graph-node__halo").attr("r", ringR * 1.5);
          update.select("circle.graph-node__ring").attr("r", ringR);
          update
            .select("image.graph-node__thumb")
            .attr("x", -thumbR)
            .attr("y", -thumbR)
            .attr("width", thumbD)
            .attr("height", thumbD);
          update.select("circle.graph-node__hit").attr("r", hitR);
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

    function applyFocus(node) {
      const activeId = pinnedNodeId || node?.id;
      if (!activeId) return;
      const keepLinks = incidentLinkKeys.get(activeId) || new Set();
      const keep = neighbors.get(activeId) || new Set([activeId]);
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

    nodeSel
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", (d) => `Progetto: ${d.titolo}`)
      .on("mouseenter", (event, d) => {
        if (!pinnedNodeId) applyFocus(d);
        if (onNodeHover) onNodeHover(d, event);
      })
      .on("mousemove", (event, d) => {
        if (onNodeHover) onNodeHover(d, event);
      })
      .on("mouseleave", () => {
        clearFocus();
        if (onNodeLeave) onNodeLeave();
      })
      .on("click", (event, d) => {
        event.stopPropagation();
        if (onNodeClick) onNodeClick(d, event);
      })
      .on("focus", (_event, d) => {
        if (!pinnedNodeId) applyFocus(d);
      })
      .on("blur", () => {
        clearFocus();
      })
      .on("keydown", (event, d) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (onNodeClick) onNodeClick(d, event);
        }
      });

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const minLinkDist = isAllView ? 138 : 108;
    const maxLinkDist = isAllView ? 420 : 360;

    function linkDistance(d) {
      const a = d.source;
      const b = d.target;
      const samePrimary = a?.primaryMacro && b?.primaryMacro && a.primaryMacro === b.primaryMacro;
      const common = Math.max(0, d.tagsCommon ?? d.tagShared ?? 0);

      const base = linkDist + 56 / Math.max(0.9, d.weight);
      const primaryK = samePrimary ? 0.72 : 1.28;
      const macroK = 1 / (1 + 0.06 * (d.macroShared || 0));
      const farDist = Math.min(maxLinkDist, base * primaryK * macroK);

      const pull = 1 - Math.exp(-0.78 * common);
      const dist = minLinkDist + (farDist - minLinkDist) * (1 - pull);
      if (!samePrimary && common <= 1) {
        return Math.max(dist, minLinkDist + (maxLinkDist - minLinkDist) * 0.78);
      }
      return dist;
    }

    function linkStrength(d) {
      const common = Math.max(0, d.tagsCommon ?? d.tagShared ?? 0);
      const pull = 1 - Math.exp(-0.55 * common);
      const base = reducedMotion ? 0.4 : 0.52;
      return Math.min(0.76, base + 0.32 * pull);
    }

    function settleSimulation() {
      finalizeDeAlign(nodes, linkObjs);
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

    simulation = d3
      .forceSimulation(nodes)
      .force(
        "link",
        d3.forceLink(linkObjs).id((d) => d.id).distance(linkDistance).strength(linkStrength)
      )
      .force(
        "charge",
        d3
          .forceManyBody()
          .strength(reducedMotion ? chargeBase * 0.72 : chargeBase)
          .distanceMax(chargeDistanceMax)
      )
      .force("center", d3.forceCenter(width / 2, height / 2 + GRAPH_Y_OFFSET).strength(0.04))
      .force("collision", d3.forceCollide().radius(collR).strength(0.9).iterations(2))
      .force(
        "clusterX",
        d3
          .forceX((d) => macroTarget(d, width, height).x)
          .strength(reducedMotion ? clusterStrengthRM : clusterStrength)
      )
      .force(
        "clusterY",
        d3
          .forceY((d) => macroTarget(d, width, height).y)
          .strength(reducedMotion ? clusterStrengthRM : clusterStrength)
      )
      .force(
        "dealign",
        forceAvoidAlignedLinks({
          angleDeg: 8,
          strength: reducedMotion ? 0.12 : 0.2,
          maxNudge: reducedMotion ? 1.1 : 1.6,
        }).links(linkObjs)
      )
      .alpha(reducedMotion ? 0.58 : 0.78)
      .alphaDecay(reducedMotion ? 0.28 : 0.062)
      .alphaMin(0.001)
      .velocityDecay(reducedMotion ? 0.78 : 0.54)
      .on("tick", onSimTick)
      .on("end", settleSimulation);

    nodeSel.call(drag(simulation));

    applyVizLayers();
  }

  function resize() {
    width = svg.clientWidth || window.innerWidth;
    height = svg.clientHeight || window.innerHeight;
    applyScale(viewScale);
    if (simulation) {
      simulation.force("center", d3.forceCenter(width / 2, height / 2 + GRAPH_Y_OFFSET));
      simulation.velocityDecay(0.58).alpha(0.22).restart();
    }
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
      activeTagFilter = t;
      rebuild();
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
      const { ringR, thumbR, thumbD, hitR } = nodeDims();
      gNodes.selectAll("circle.graph-node__ring").attr("r", ringR);
      gNodes
        .selectAll("image.graph-node__thumb")
        .attr("x", -thumbR)
        .attr("y", -thumbR)
        .attr("width", thumbD)
        .attr("height", thumbD);
      gNodes.selectAll("circle.graph-node__hit").attr("r", hitR);
    },
  };
}
