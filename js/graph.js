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

/** Zoom extra per miniature circolari (nodo del grafo) dove il soggetto
 *  occupa solo una piccola parte dell'immagine sorgente: chiave = nome file
 *  in `previewPath`, valore = fattore di ingrandimento (1 = nessuno). */
const THUMB_ZOOM_BY_PREVIEW = {
  "lunararchive_1.jpg": 1.8,
};

function thumbZoomFor(d) {
  const path = String(d?.previewPath || "");
  for (const key in THUMB_ZOOM_BY_PREVIEW) {
    if (path.includes(key)) return THUMB_ZOOM_BY_PREVIEW[key];
  }
  return 1;
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
  // Mutabile (non `const`): `setInteractive()` la cambia a runtime, così lo
  // stesso controller/simulazione può passare da "decorativo" (hero Home,
  // niente hover/click/pan/zoom, solo drag) a interattivo (Connections)
  // senza ricreare l'SVG né riseminare i nodi — cambia solo il
  // comportamento, non il layout. Vedi `setInteractive` in fondo.
  let decorative = !!options.decorative;
  function syncDecorativeClass() {
    svg.classList.toggle("graph-svg--decorative", decorative);
  }
  syncDecorativeClass();
  let networkModel = options.fullModel;
  const gRoot = d3.select(svg).select("#zoom-layer");
  const gLinks = gRoot.select("#links-layer");
  const gNodes = gRoot.select("#nodes-layer");
  const gLinksHighlight = gRoot.select("#links-highlight-layer");

  let width = svg.clientWidth || window.innerWidth;
  let height = svg.clientHeight || window.innerHeight;
  // Su desktop la filter-bar (elenco tag) sta in alto a sinistra: non è più
  // un ostacolo in basso. Su mobile resta ancorata in fondo, quindi va
  // ancora evitata. Distinguiamo i due casi guardando dove si trova
  // davvero il suo bordo superiore, invece di assumere una posizione fissa.
  const filterBarEl = document.getElementById("filter-bar");
  function computeBottomBound() {
    if (decorative) return height;
    const svgRect = svg.getBoundingClientRect();
    if (filterBarEl) {
      const r = filterBarEl.getBoundingClientRect();
      // Ancorata in basso solo se il suo bordo superiore sta nella metà
      // inferiore dello schermo (mobile); in alto a sinistra (desktop) non
      // riduce lo spazio verticale utile del grafo.
      if (r && Number.isFinite(r.top) && r.top > height / 2) {
        return Math.max(80, r.top - svgRect.top - 12);
      }
    }
    return height - 80;
  }
  let bottomBound = computeBottomBound();

  // Su desktop la filter-bar (elenco tag) sta in alto a sinistra, proprio
  // sopra la zona dove crescono i pianeti "spenti" da un filtro (griglia in
  // basso a sinistra, vedi assignInactiveTargets): con molti progetti
  // disattivati la griglia può salire abbastanza da toccare l'elenco tag.
  // Bordo (in coordinate locali all'SVG) oltre il quale la griglia non
  // dovrebbe salire — solo su desktop, su mobile la filter-bar sta in
  // fondo e non è un ostacolo per questa griglia.
  function computeInactiveTopBound() {
    if (decorative || !filterBarEl) return -Infinity;
    const r = filterBarEl.getBoundingClientRect();
    if (!r || !Number.isFinite(r.bottom) || r.top > height / 2) return -Infinity;
    const svgRect = svg.getBoundingClientRect();
    return r.bottom - svgRect.top + 24;
  }

  // Quando la filter-bar cambia altezza (es. wrap dei tag, solo mobile:
  // su desktop non ha più effetto, vedi sopra) aggiorniamo il limite
  // inferiore e diamo un piccolo restart alla simulazione così i nodi si
  // ricompongono dentro l'area visibile.
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
  /** Linee dinamiche (nodo attivo → ogni progetto con tag in comune), non
   *  limitate al sottoinsieme di archi statici del grafo. */
  let highlightLinkSel = gLinksHighlight.selectAll("line.focus-link");
  /** Pallini animati sulle linee: uno per ogni tag condiviso, in loop. */
  let highlightDotSel = gLinksHighlight.selectAll("circle.focus-link__dot");
  let dotAnimRafId = null;
  // Velocità costante in px/ms: linee lunghe e corte "scorrono" alla stessa
  // velocità percepita, invece di avere tutte lo stesso tempo di giro.
  const DOT_SPEED_PX_PER_MS = 0.045;
  // Distanza fissa (px) tra i pallini di uno stesso gruppo: viaggiano vicini,
  // in coppia/tripletta, invece di essere sparsi lungo tutta la linea.
  const DOT_PACK_GAP_PX = 7;
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function positionDots(now) {
    highlightDotSel.each(function (d) {
      const dx = d.target.x - d.source.x;
      const dy = d.target.y - d.source.y;
      const dist = Math.hypot(dx, dy) || 1;
      const gapT = DOT_PACK_GAP_PX / dist;
      let t;
      if (prefersReducedMotion) {
        t = 0.5 + (d.index - (d.count - 1) / 2) * gapT;
      } else {
        // Moto a "va e vieni" (triangolare) invece che a giro con reset: la
        // posizione è sempre continua, senza il salto istantaneo che si
        // vedeva quando un pallino chiudeva il giro e ripartiva dall'inizio
        // (specialmente vistoso quando molti collegamenti venivano
        // ricreati insieme, come al click su un progetto).
        const period = (dist / DOT_SPEED_PX_PER_MS) * 2;
        const raw = (now / period + d.index * gapT) % 1;
        const phase = raw < 0 ? raw + 1 : raw;
        t = phase <= 0.5 ? phase * 2 : 2 - phase * 2;
      }
      this.setAttribute("cx", d.source.x + dx * t);
      this.setAttribute("cy", d.source.y + dy * t);
    });
  }

  function stepDots(now) {
    dotAnimRafId = null;
    if (highlightDotSel.empty()) return;
    positionDots(now);
    if (!prefersReducedMotion) dotAnimRafId = requestAnimationFrame(stepDots);
  }

  function ensureDotAnim() {
    if (dotAnimRafId == null && !highlightDotSel.empty() && !prefersReducedMotion) {
      dotAnimRafId = requestAnimationFrame(stepDots);
    }
  }

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
  /** @type {(originId: string|null, keepIds: Set<string>|null) => void} */
  let renderHighlightLinksFn = () => {};
  /** Ridisegna la vista ambient (tutte le coppie con tag in comune, incluse
   *  quelle attenuate dei progetti "spenti"): usata anche da `setFilter`. */
  let renderAllHighlightLinksFn = () => {};
  /** Svuota del tutto il layer dei collegamenti (usato dal tutorial: durante
   *  il passo 1 i nodi sono già attenuati via classe, ma lo sfondo ambient
   *  dei collegamenti andrebbe comunque nascosto per non confondere la
   *  messa in scena). */
  let hideAllLinksFn = () => {};
  let pinnedNodeId = null;
  /** Set di id ancora interattivi quando un progetto è selezionato (null = nessuna selezione). */
  let selectionAllowedIds = null;
  /** Id del progetto cliccato quando una selezione è attiva (per sapere chi
   *  resta "origine" quando poi si va in hover su un altro progetto attivo). */
  let selectedNodeId = null;
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

  // Zoom/pan sempre agganciati (non solo se non-decorativo alla creazione):
  // controllano `decorative` dal vivo a ogni evento, così `setInteractive()`
  // li accende/spegne senza dover ri-registrare i listener.
  d3.select(svg).on("wheel.zoomScale", (event) => {
    if (decorative) return;
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
      if (decorative) return false;
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

  // Dimensione per-nodo: uniforme (stesso "medio" per tutti) finché non c'è
  // una selezione attiva. Il posizionamento resta invece sempre basato su
  // `overlapRatio` (radialForNode/seedNodes, invariati) — qui cambia solo la
  // dimensione visiva. Al click su un progetto, `applySelectionSizing`
  // assegna a ogni nodo un `_selSizeFactor` dinamico in base ai tag
  // condivisi col progetto selezionato (vedi sotto), con una transizione
  // fluida; resta finché non si deseleziona.
  function nodeOverlapFactor(d) {
    if (d && Number.isFinite(d._selSizeFactor)) return d._selSizeFactor;
    return 1;
  }

  function sharedTagCount(a, b) {
    const tagsA = new Set(
      (a?.tagsNorm || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean)
    );
    if (!tagsA.size) return 0;
    const tagsB = new Set(
      (b?.tagsNorm || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean)
    );
    let count = 0;
    for (const t of tagsA) if (tagsB.has(t)) count++;
    return count;
  }

  // Raggio radiale per nodo: chi ha più tag in comune complessivi sta più
  // vicino al centro. Legge `width`/`bottomBound` dal vivo (non li
  // "congela" in chiusura): `resize()` può quindi rinfrescare la forza
  // "radial" con lo stesso raggio target che userebbe un rebuild completo,
  // così durante il morph hero→Connections i pianeti si aprono verso il
  // nuovo bordo invece di restare ancorati alla scala della hero.
  function radialForNode(d) {
    const usableH = bottomBound > 0 ? bottomBound : height;
    const maxRadial = Math.min(width, usableH) * 0.42;
    const minRadial = Math.min(width, usableH) * 0.06;
    const r = Math.max(0, Math.min(1, Number(d?.overlapRatio) || 0));
    return minRadial + (1 - r) * (maxRadial - minRadial);
  }

  // Centro (e centro "filtro") verso cui convergono le forze radial/center/
  // activeX/Y — ricalcolato da `rebuild()` (setup iniziale) e da `resize()`
  // (finestra ridimensionata, o durante il morph hero→Connections) sugli
  // stessi `width`/`height`/`bottomBound` correnti.
  function computeCenters() {
    // Il grafo occupa solo la porzione sinistra dello schermo (a destra c'è
    // la colonna riservata al pannello anteprima, vedi --preview-reserve):
    // centrare i nodi su `width/2` li lascia visivamente spostati a
    // sinistra della pagina intera. Compensiamo spostando il centro dei
    // nodi verso il centro reale della finestra, restando comunque dentro
    // i limiti dell'SVG (il clamp in `ticked()` non cambia).
    const centerX = decorative
      ? width / 2
      : width / 2 + Math.max(0, window.innerWidth - width) * 0.8;
    // Il centro verticale considera l'area utile (sopra la filter-bar) e
    // NON metà schermo: altrimenti, con tag su più righe, i nodi attivi
    // finiscono visivamente nella metà inferiore. In modalità filtrata (o
    // decorativa) azzeriamo l'offset così è esattamente al centro visivo
    // dell'area.
    const centerY = decorative
      ? height / 2
      : bottomBound / 2 + (activeTagFilter ? 0 : GRAPH_Y_OFFSET);
    // Centro "filtro": punto verso cui convergono i progetti attivi. Parte
    // dal centro "piatto" del riquadro (non da centerX, che ha già il suo
    // bias verso il pannello anteprima: sommarci sopra un altro
    // sbilanciamento li spostava visibilmente troppo a destra) con solo un
    // piccolo scarto per allontanarli dal cluster degli inactive
    // nell'angolo basso-sx.
    const filterCenterX = width / 2 + width * 0.06;
    const filterCenterY = centerY;
    return { centerX, centerY, filterCenterX, filterCenterY };
  }

  function nodeDims(d) {
    const f = d ? nodeOverlapFactor(d) : 1;
    // Nodi "disattivati" (fuori dal filtro) → versione mini in basso a sx.
    const inactiveFactor = d?._inactive ? 0.42 : 1;
    const thumbR = 14 * nodeScale * f * inactiveFactor;
    const ringR = thumbR + 0.6;
    const hitR = 29 * nodeScale * Math.max(1, f) * inactiveFactor;
    // thumbBoxR: dimensione reale dell'immagine dentro il cerchio. Più
    // grande di thumbR quando il progetto ha uno zoom extra (vedi
    // THUMB_ZOOM_BY_PREVIEW): il cerchio visibile (thumbR) resta invariato,
    // solo l'immagine al suo interno viene ingrandita/ritagliata di più.
    const thumbBoxR = thumbR * thumbZoomFor(d);
    return { ringR, thumbR, hitR, thumbD: thumbR * 2, thumbBoxR, thumbBoxD: thumbBoxR * 2 };
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
      const f = nodeOverlapFactor(d);
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

    if (!highlightLinkSel.empty()) {
      highlightLinkSel
        .attr("x1", (d) => d.source.x)
        .attr("y1", (d) => d.source.y)
        .attr("x2", (d) => d.target.x)
        .attr("y2", (d) => d.target.y);
    }
    if (!highlightDotSel.empty()) positionDots(performance.now());
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

    for (const n0 of nodes) {
      neighbors.set(n0.id, new Set([n0.id]));
    }
    for (const l of linkObjs) {
      const a = l.source?.id;
      const b = l.target?.id;
      if (!a || !b) continue;
      neighbors.get(a)?.add(b);
      neighbors.get(b)?.add(a);
    }
    // Esponiamo le adiacenze (gli stessi "collegamenti" usati in hover) così
    // la selezione al click usa esattamente lo stesso insieme di progetti.
    nodeNeighbors = neighbors;

    const isAllView = activeTagFilter == null;
    const n = Math.max(1, nodes.length);
    const density = Math.sqrt(n);
    const seedSpread =
      (isAllView ? 280 : 165) + Math.min(isAllView ? 720 : 340, n * (isAllView ? 9.5 : 6.8));
    const chargeBase = (-380 - density * 52) * (isAllView ? 1.78 : 1.3);
    // Su dataset medio-grandi accorciamo il raggio di repulsione: meno coppie
    // da valutare per il quadtree → tick più leggero.
    const chargeDistanceMax = n >= 35
      ? (isAllView ? 380 : 300)
      : (isAllView ? 560 : 420);
    const baseDims = nodeDims();
    // Buffer di anti-sovrapposizione: garantisce uno spazio minimo tra i pianeti.
    const collisionBuffer = 24;
    const collR = Math.max(baseDims.thumbR + collisionBuffer, isAllView ? 46 : 40);
    const linkDist =
      ((135 + 920 / (density + 2.2)) / (1 + Math.log10(n + 3) * 0.1)) * 1.82;

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
      // Se la griglia "a colonne fisse" (inactiveCols) salirebbe oltre il
      // bordo dell'elenco tag, allarghiamo le colonne (più larga, meno
      // alta) così resta sotto invece di arrivarci all'altezza.
      const topBound = computeInactiveTopBound();
      const availableHeight = inactiveOriginY - topBound;
      const maxRows = Number.isFinite(availableHeight)
        ? Math.max(1, Math.floor(availableHeight / inactiveSpread))
        : Infinity;
      const cols = Math.max(inactiveCols, Math.ceil(list.length / maxRows));
      list.forEach((nd, i) => {
        nd._inactiveTargetX = inactiveOriginX + (i % cols) * inactiveSpread;
        nd._inactiveTargetY = inactiveOriginY - Math.floor(i / cols) * inactiveSpread;
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
          // userSpaceOnUse (default): il cerchio di ritaglio ha un raggio
          // fisso (thumbR) nello spazio del nodo, indipendente dalla
          // dimensione reale dell'immagine — così l'immagine può essere
          // più grande del cerchio visibile (zoom, vedi thumbBoxR) senza
          // che il cerchio stesso si ingrandisca.
          const cp = enter
            .append("clipPath")
            .attr("class", "node-thumb-clip")
            .attr("id", (d) => thumbClipId(d));
          cp.append("circle")
            .attr("cx", 0)
            .attr("cy", 0)
            .attr("r", (d) => nodeDims(d).thumbR);
          return cp;
        },
        (update) => {
          update.attr("id", (d) => thumbClipId(d));
          update.select("circle").attr("r", (d) => nodeDims(d).thumbR);
          return update;
        },
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
          const g = enter.append("g").attr("class", "graph-node").attr("data-node-id", (d) => d.id);
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
            .attr("x", (d) => -nodeDims(d).thumbBoxR)
            .attr("y", (d) => -nodeDims(d).thumbBoxR)
            .attr("width", (d) => nodeDims(d).thumbBoxD)
            .attr("height", (d) => nodeDims(d).thumbBoxD)
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
            .attr("x", (d) => -nodeDims(d).thumbBoxR)
            .attr("y", (d) => -nodeDims(d).thumbBoxR)
            .attr("width", (d) => nodeDims(d).thumbBoxD)
            .attr("height", (d) => nodeDims(d).thumbBoxD);
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

    // Rende linea/alone + pallini per un elenco di coppie {id,source,target,count}.
    // Condivisa sia dal focus su singolo nodo (hover/click) sia dalla vista
    // "tutte le coppie attive insieme" (baseline della pagina Connections +
    // mini-grafo decorativo della hero): stesso stile animato con glow e
    // pallini in entrambi i casi. Le coppie con `dim` (almeno un progetto
    // "spento" dal filtro tag) restano invece una linea piatta e attenuata,
    // senza pallini: stesso trattamento visivo dei nodi `.graph-node--inactive`.
    // `fadeIn`: le coppie che ENTRANO partono da opacity 0 e transiscono a
    // piena opacità, invece di comparire di scatto. Usato solo dal "reveal"
    // esplicito dei collegamenti quando si attiva Connections dalla home
    // (vedi `revealAmbientLinks`/graph-node--reveal più sotto): il rebuild
    // e i normali refresh (hover, filtro) restano istantanei come prima.
    function renderHighlightPairs(pairs, opts = {}) {
      const fadeIn = !!opts.fadeIn;
      const noDots = !!opts.noDots;
      highlightLinkSel = gLinksHighlight
        .selectAll("line.focus-link")
        .data(pairs, (d) => d.id)
        .join(
          (enter) => {
            const el = enter.append("line").attr("class", "focus-link");
            return fadeIn ? el.style("opacity", 0) : el;
          },
          (update) => update,
          (exit) => exit.remove()
        );
      highlightLinkSel
        .attr("x1", (d) => d.source.x)
        .attr("y1", (d) => d.source.y)
        .attr("x2", (d) => d.target.x)
        .attr("y2", (d) => d.target.y)
        .classed("focus-link--dim", (d) => !!d.dim)
        // Vista ambient (nessun hover/selezione): linee più trasparenti di
        // quelle "in evidenza" di un hover/click, che restano invariate.
        .classed("focus-link--ambient", noDots);
      if (fadeIn) {
        highlightLinkSel.transition().duration(700).style("opacity", null);
      }

      const dots = [];
      // Niente pallini nella vista ambient (nessun hover/selezione attivi):
      // solo linee ferme, i pallini animati compaiono unicamente sui
      // collegamenti del progetto sotto hover/selezionato (vedi
      // renderHighlightLinks/applyFocus/applySelectionHover più sotto).
      for (const pair of noDots ? [] : pairs) {
        if (pair.dim) continue; // niente pallini animati sui collegamenti attenuati
        for (let i = 0; i < pair.count; i++) {
          dots.push({
            key: `${pair.id}-${i}`,
            source: pair.source,
            target: pair.target,
            index: i,
            count: pair.count,
          });
        }
      }
      highlightDotSel = gLinksHighlight
        .selectAll("circle.focus-link__dot")
        .data(dots, (d) => d.key)
        .join(
          (enter) => {
            const el = enter.append("circle").attr("class", "focus-link__dot").attr("r", 2.2);
            return fadeIn ? el.style("opacity", 0) : el;
          },
          (update) => update,
          (exit) => exit.remove()
        );
      if (fadeIn) {
        highlightDotSel.transition().duration(700).style("opacity", null);
      }
      positionDots(performance.now());
      ensureDotAnim();
    }

    // Disegna una linea/alone dal nodo `originId` verso ognuno degli id in
    // `keepIds` (tutti i progetti ancora attivi, non solo quelli con un arco
    // statico precalcolato): così la linea collega sempre TUTTI i progetti
    // che restano attivi in quel momento. Sopra ogni linea, tanti pallini
    // animati in loop quanti sono i tag condivisi con quel progetto.
    // `dimIds` (opzionale): sottoinsieme di `keepIds` le cui linee vanno
    // attenuate (niente pallini) invece che nello stile pieno — usato
    // quando, con una selezione già attiva, si va in hover su UNO degli
    // altri progetti attivi: la sua linea resta in evidenza, le altre si
    // oscurano senza sparire.
    function renderHighlightLinks(originId, keepIds, dimIds = null) {
      const origin = originId ? nodes.find((x) => x.id === originId) : null;
      const pairs = [];
      if (origin && keepIds) {
        for (const id of keepIds) {
          if (id === originId) continue;
          const target = nodes.find((x) => x.id === id);
          if (target) {
            const count = Math.max(1, sharedTagCount(origin, target));
            pairs.push({ id, source: origin, target, count, dim: !!(dimIds && dimIds.has(id)) });
          }
        }
      }
      renderHighlightPairs(pairs);
    }

    // Vista ambient "tutte le coppie con tag in comune insieme": baseline
    // della pagina Connections (nessun hover/selezione attivi). Nella hero
    // decorativa (Home) NON viene chiamata finché non si preme "Explore
    // Connections" (vedi `revealAmbientLinks`/rebuild più sotto): i pianeti
    // partono isolati, i collegamenti compaiono con un fade solo
    // all'attivazione. Include anche le coppie che coinvolgono progetti
    // "spenti" dal filtro tag, ma attenuate (`dim`): stessa logica visiva
    // usata per i nodi stessi (`.graph-node--inactive`), invece di farle
    // sparire del tutto.
    function renderAllHighlightLinks(opts) {
      const pairs = [];
      const seen = new Set();
      for (const a of nodes) {
        for (const b of nodes) {
          if (a.id === b.id) continue;
          const key = [String(a.id), String(b.id)].sort().join("--");
          if (seen.has(key)) continue;
          seen.add(key);
          const count = sharedTagCount(a, b);
          if (count > 0) {
            pairs.push({ id: key, source: a, target: b, count, dim: !!(a._inactive || b._inactive) });
          }
        }
      }
      renderHighlightPairs(pairs, { ...opts, noDots: true });
    }

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
      // Niente hover/pin attivi: torna alla vista ambient con tutti i
      // collegamenti attivi invece di lasciare il grafo senza linee.
      renderAllHighlightLinks();
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
      const keep = tagRelatedIds(activeId);
      const isPinned = !!pinnedNodeId;

      nodeSel.classed("graph-node--dim", (d) => !keep.has(d.id));
      nodeSel.classed("graph-node--focus", (d) => !isPinned && d.id === node.id);
      nodeSel.classed("graph-node--pinned", (d) => isPinned && d.id === pinnedNodeId);
      nodeSel.classed("graph-node--neighbor", false);
      renderHighlightLinks(activeId, keep);
    }

    // Con una selezione (click) già attiva, l'hover su UNO degli altri
    // progetti ancora attivi (`selectionAllowedIds`) stringe ulteriormente il
    // focus: solo il selezionato e quello sotto hover restano in evidenza,
    // gli altri progetti attivi si attenuano insieme ai loro collegamenti
    // (non spariscono, stesso trattamento visivo di `.graph-node--inactive`).
    function applySelectionHover(hoverId) {
      if (!selectionAllowedIds || !selectedNodeId) return;
      nodeSel.classed(
        "graph-node--selection-dim",
        (d) =>
          selectionAllowedIds.has(String(d.id)) &&
          String(d.id) !== selectedNodeId &&
          String(d.id) !== hoverId,
      );
      nodeSel.classed("graph-node--focus", (d) => String(d.id) === hoverId);
      const dimIds = new Set(
        [...selectionAllowedIds].filter((id) => String(id) !== hoverId),
      );
      renderHighlightLinks(selectedNodeId, selectionAllowedIds, dimIds);
    }

    // Fine hover (o hover sul progetto già selezionato): torna alla vista
    // "piatta" della selezione, tutti i progetti attivi ugualmente in
    // evidenza come subito dopo il click.
    function revertSelectionFocus() {
      if (!selectionAllowedIds) return;
      nodeSel.classed("graph-node--selection-dim", false);
      nodeSel.classed("graph-node--focus", false);
      renderHighlightLinks(selectedNodeId, selectionAllowedIds);
    }

    clearFocusFn = clearFocus;
    renderHighlightLinksFn = renderHighlightLinks;
    renderAllHighlightLinksFn = renderAllHighlightLinks;
    hideAllLinksFn = () => renderHighlightPairs([]);
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

    {
      // Listener sempre agganciati (non solo se non-decorativo al momento
      // del rebuild): ognuno controlla `decorative` dal vivo appena entra,
      // così `setInteractive()` li accende/spegne senza dover rifare il
      // rebuild (che riseminerebbe i nodi, perdendo la posizione corrente).
      nodeSel
        .attr("tabindex", 0)
        .attr("role", "button")
        .attr("aria-label", (d) => `Progetto: ${d.titolo}`)
        .on("mouseenter", (event, d) => {
          if (decorative) return;
          cancelHoverTimer();
          hoverTimerId = setTimeout(() => {
            hoverTimerId = null;
            hoverActiveId = d.id;
            if (!pinnedNodeId && !selectionAllowedIds) {
              applyFocus(d);
            } else if (selectionAllowedIds && String(d.id) !== selectedNodeId) {
              // Selezione già attiva: l'hover su un ALTRO progetto ancora
              // attivo stringe il focus su {selezionato, hover}, attenuando
              // gli altri invece di lasciare la vista fissa com'era prima.
              applySelectionHover(String(d.id));
            }
            if (onNodeHover) onNodeHover(d, event);
          }, HOVER_DELAY_MS);
        })
        .on("mousemove", (event, d) => {
          if (decorative) return;
          if (hoverActiveId === d.id && onNodeHover) onNodeHover(d, event);
        })
        .on("mouseleave", () => {
          if (decorative) return;
          cancelHoverTimer();
          const wasActive = hoverActiveId != null;
          hoverActiveId = null;
          if (wasActive) {
            if (!selectionAllowedIds) clearFocus();
            else revertSelectionFocus();
            if (onNodeLeave) onNodeLeave();
          }
        })
        .on("click", (event, d) => {
          if (decorative) return;
          event.stopPropagation();
          if (onNodeClick) onNodeClick(d, event);
        })
        .on("focus", (_event, d) => {
          if (decorative) return;
          if (!pinnedNodeId && !selectionAllowedIds) applyFocus(d);
          else if (selectionAllowedIds && String(d.id) !== selectedNodeId) {
            applySelectionHover(String(d.id));
          }
        })
        .on("blur", () => {
          if (decorative) return;
          if (!selectionAllowedIds) clearFocus();
          else revertSelectionFocus();
        })
        .on("keydown", (event, d) => {
          if (decorative) return;
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

    const { centerX, centerY, filterCenterX, filterCenterY } = computeCenters();

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

    // Mostra subito tutte le coppie di progetti collegati (vista ambient):
    // è la baseline della pagina Connections finché non si va in
    // hover/selezione su un progetto specifico. Nel mini-grafo decorativo
    // (hero Home) invece i pianeti restano isolati finché non si preme
    // "Explore Connections" (vedi `revealAmbientLinks`), quindi qui NON
    // renderizziamo nulla mentre `decorative` è vero.
    if (!decorative) renderAllHighlightLinks();
  }

  function resize() {
    width = svg.clientWidth || window.innerWidth;
    height = svg.clientHeight || window.innerHeight;
    bottomBound = computeBottomBound();
    applyScale(viewScale);
    if (simulation) {
      // Rimpiazziamo (non solo "center", ma anche "radial"/"activeX/Y")
      // così un salto di dimensioni grande — tipico durante il morph
      // hero→Connections, dove l'SVG passa dal piccolo riquadro decorativo
      // a tutto lo stage — fa "aprire" davvero i pianeti verso il nuovo
      // centro/raggio invece di lasciarli ancorati alla scala precedente
      // (radialForNode/computeCenters leggono width/height/bottomBound dal
      // vivo, quindi bastano nuove istanze delle forze per farli ripartire
      // dai valori aggiornati).
      const { centerX, centerY, filterCenterX, filterCenterY } = computeCenters();
      simulation.force(
        "radial",
        d3
          .forceRadial((d) => (d._inactive ? 0 : radialForNode(d)), centerX, centerY)
          .strength((d) =>
            d._inactive ? 0 : activeTagFilter ? 0 : prefersReducedMotion ? 0.18 : 0.14,
          ),
      );
      simulation.force(
        "activeX",
        d3.forceX(filterCenterX).strength((d) => (!d._inactive && activeTagFilter ? 0.38 : 0)),
      );
      simulation.force(
        "activeY",
        d3.forceY(filterCenterY).strength((d) => (!d._inactive && activeTagFilter ? 0.38 : 0)),
      );
      simulation.force("center", d3.forceCenter(centerX, centerY).strength(activeTagFilter ? 0 : 0.025));
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

  // Transizione fluida (r degli anelli/miniatura/hit-area + clipPath in
  // <defs>) verso le dimensioni correnti di `nodeDims(d)`: condivisa da
  // `setFilter` (nodi dis/riattivati dal filtro tag) e da
  // `applySelectionSizing` (nodi ridimensionati dopo un click).
  function transitionNodeSizes(durationMs) {
    if (!nodeSel || nodeSel.empty()) return;
    const tr = nodeSel.transition().duration(durationMs).ease(d3.easeCubicInOut);
    tr.select("circle.graph-node__halo").attr("r", (d) => nodeDims(d).ringR * 1.5);
    tr.select("circle.graph-node__ring").attr("r", (d) => nodeDims(d).ringR);
    tr.select("image.graph-node__thumb")
      .attr("x", (d) => -nodeDims(d).thumbBoxR)
      .attr("y", (d) => -nodeDims(d).thumbBoxR)
      .attr("width", (d) => nodeDims(d).thumbBoxD)
      .attr("height", (d) => nodeDims(d).thumbBoxD);
    tr.select("circle.graph-node__hit").attr("r", (d) => nodeDims(d).hitR);
    // I clipPath vivono in <defs>, fuori da nodeSel: aggiorna il raggio del
    // cerchio di ritaglio in parallelo (stessa durata/easing).
    d3.select(svg)
      .select("defs")
      .selectAll("clipPath.node-thumb-clip circle")
      .transition()
      .duration(durationMs)
      .ease(d3.easeCubicInOut)
      .attr("r", (d) => nodeDims(d).thumbR);
  }

  const SELECTION_SIZE_TRANSITION_MS = 520;
  // Nodo selezionato: sempre il più grande (ancora visivo dell'attenzione).
  const SELECTION_SIZE_SELECTED_FACTOR = 2.05;
  // Gli altri nodi si scalano tra questi due estremi in base a quanti tag
  // condividono col selezionato: 0 tag in comune → il più piccolo, il
  // massimo di tag in comune tra i nodi correnti → il più grande.
  const SELECTION_SIZE_MIN_FACTOR = 0.6;
  const SELECTION_SIZE_MAX_FACTOR = 1.65;

  // Ridimensiona tutti i nodi in base ai tag condivisi col progetto
  // selezionato (`selId`), con una transizione fluida; `null` riporta tutti
  // alla dimensione uniforme di default (vedi `nodeOverlapFactor`). Il
  // posizionamento (layout) non cambia: solo la dimensione visiva e, di
  // conseguenza, il raggio di collisione usato dalla fisica.
  function applySelectionSizing(selId) {
    if (!currentNodes.length) return;
    if (!selId) {
      for (const n of currentNodes) n._selSizeFactor = null;
    } else {
      const origin = currentNodes.find((n) => n.id === selId);
      const counts = new Map();
      let maxCount = 0;
      if (origin) {
        for (const n of currentNodes) {
          if (n.id === selId) continue;
          const c = sharedTagCount(origin, n);
          counts.set(n.id, c);
          if (c > maxCount) maxCount = c;
        }
      }
      for (const n of currentNodes) {
        if (n.id === selId) {
          n._selSizeFactor = SELECTION_SIZE_SELECTED_FACTOR;
          continue;
        }
        const norm = maxCount > 0 ? (counts.get(n.id) || 0) / maxCount : 0;
        n._selSizeFactor =
          SELECTION_SIZE_MIN_FACTOR + norm * (SELECTION_SIZE_MAX_FACTOR - SELECTION_SIZE_MIN_FACTOR);
      }
    }
    transitionNodeSizes(SELECTION_SIZE_TRANSITION_MS);
    // Rinfresca il raggio di collisione (dipende da nodeDims/_selSizeFactor)
    // e dà un piccolo "respiro" alla simulazione così i pianeti appena
    // ingranditi non restano sovrapposti ai vicini; le altre forze (radiale,
    // link, centro) restano quelle già attive, nessun cambio di layout.
    if (simulation) {
      simulation.nodes(currentNodes);
      simulation.alpha(Math.max(simulation.alpha(), 0.22)).restart();
    }
  }

  return {
    rebuild,
    resize,
    // Passa da decorativo (niente hover/click/pan/zoom, solo drag) a
    // interattivo o viceversa, SENZA rifare il rebuild: stessa istanza di
    // simulazione, stesse posizioni correnti dei nodi. Usato dal morph
    // hero→Connections (vedi js/app.js) per accendere l'interattività a
    // transizione visiva già avviata, invece di dover ricreare il grafo.
    setInteractive(on) {
      decorative = !on;
      syncDecorativeClass();
    },
    isInteractive() {
      return !decorative;
    },
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
    hideAllLinks() {
      hideAllLinksFn();
    },
    // Mostra i collegamenti ambient con un fade-in invece che di scatto:
    // usato all'attivazione di Connections dalla home (vedi
    // activateConnections in main.js), in coppia con `setInteractive(true)`.
    revealAmbientLinks() {
      renderAllHighlightLinksFn({ fadeIn: true });
    },
    // Dopo il morph hero→Connections (vedi main.js), quando il riquadro ha
    // smesso di crescere: durante il trascinamento (resize() ripetuti
    // mentre il box è ancora in movimento) l'alpha resta volutamente basso
    // per un moto fluido, e la forza "center"/"radial" da sola non sempre
    // basta a far rientrare del tutto i pianeti rimasti "impaccati" verso
    // il bordo di partenza — dare una spinta più energica qui per farceli
    // arrivare è un compromesso tarato a occhio (quanta energia, quanto a
    // lungo) e non garantisce un risultato deterministico. Calcoliamo
    // invece direttamente lo scarto tra il centro effettivo attuale del
    // gruppo e il centro vero, e li spostiamo tutti in blocco di quella
    // stessa quantità (traslazione rigida: le posizioni RELATIVE tra loro,
    // già corrette, non cambiano) — niente forza, niente attesa, sono già
    // dove devono essere.
    settleLayout() {
      if (!simulation || !currentNodes.length) return;
      // NB: il bersaglio "pieno" di computeCenters() (centerX) è quello
      // che la forza radial/center insegue per tutta la sua durata — ma
      // essendo intenzionalmente debole, in un caricamento DIRETTO (seed
      // centrato su width/2, non su centerX) la simulazione si ferma
      // (alphaMin) senza mai arrivarci fino in fondo: si assesta a metà
      // strada tra il centro "piatto" e il bersaglio con bias. Replichiamo
      // qui la stessa metà strada, non il bersaglio pieno, altrimenti
      // sovra-correggiamo rispetto a un caricamento diretto.
      const { centerY } = computeCenters();
      const biasX = Math.max(0, window.innerWidth - width) * 0.8;
      const targetX = width / 2 + biasX * 0.45;
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (const node of currentNodes) {
        if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
        sx += node.x;
        sy += node.y;
        n++;
      }
      if (!n) return;
      const dx = targetX - sx / n;
      const dy = centerY - sy / n;
      for (const node of currentNodes) {
        if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
        node.x += dx;
        node.y += dy;
      }
      ticked();
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
      selectedNodeId = selId;
      // Azzera eventuali evidenziazioni rimaste dall'hover precedente al
      // click, poi riapplica linee/alone per il progetto selezionato: la
      // vista resta fissa mostrando solo i collegamenti di `selId`.
      clearFocusFn();
      if (nodeSel && !nodeSel.empty()) {
        nodeSel.classed("graph-node--off", (d) =>
          selectionAllowedIds ? !selectionAllowedIds.has(String(d.id)) : false,
        );
        nodeSel.classed("graph-node--selected", (d) =>
          selId != null && String(d.id) === selId,
        );
        nodeSel.classed("graph-node--selection-dim", false);
      }
      renderHighlightLinksFn(selId, selId ? selectionAllowedIds : null);
      applySelectionSizing(selId);
    },
    clearSelection() {
      selectionAllowedIds = null;
      selectedNodeId = null;
      if (nodeSel && !nodeSel.empty()) {
        nodeSel.classed("graph-node--off", false);
        nodeSel.classed("graph-node--selected", false);
        nodeSel.classed("graph-node--selection-dim", false);
      }
      applySelectionSizing(null);
      clearFocusFn();
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

      // Rinfresca la vista ambient dei collegamenti con i nuovi flag
      // `_inactive` (progetti fuori dal filtro → linee attenuate), a meno
      // che non ci sia già un hover/pin/selezione attivi da preservare.
      if (!pinnedNodeId && !selectionAllowedIds) renderAllHighlightLinksFn();

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
      transitionNodeSizes(FILTER_TRANSITION_MS);
      if (nodeSel && !nodeSel.empty()) {
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
        .attr("x", (d) => -nodeDims(d).thumbBoxR)
        .attr("y", (d) => -nodeDims(d).thumbBoxR)
        .attr("width", (d) => nodeDims(d).thumbBoxD)
        .attr("height", (d) => nodeDims(d).thumbBoxD);
      gNodes.selectAll("circle.graph-node__hit").attr("r", (d) => nodeDims(d).hitR);
      d3.select(svg)
        .select("defs")
        .selectAll("clipPath.node-thumb-clip circle")
        .attr("r", (d) => nodeDims(d).thumbR);
    },
  };
}
