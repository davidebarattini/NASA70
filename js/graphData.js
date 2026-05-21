/**
 * Tag macro fissi (16): cluster, colori, filtri. Ordine = priorità visiva.
 * I token in `tags` del JSON che coincidono con un id macro sono ancora “letterali macro”
 * (es. per colori in legenda); gli archi solo-tag usano solo tag non in quell’insieme.
 */
export const MACRO_META = [
  { id: "2d", label: "2D", color: "#7dd3fc" },
  { id: "3d", label: "3D", color: "#38bdf8" },
  { id: "apollo", label: "Apollo", color: "#c4b5fd" },
  { id: "astronomy", label: "Astronomy", color: "#a78bfa" },
  { id: "audio", label: "Audio", color: "#fcd34d" },
  { id: "climate", label: "Climate", color: "#4ade80" },
  { id: "science", label: "Science", color: "#67e8f9" },
  { id: "data_visualization", label: "Data visualization", color: "#93c5fd" },
  { id: "earth", label: "Earth", color: "#86efac" },
  { id: "planets", label: "Planets", color: "#fb923c" },
  { id: "educational", label: "Educational", color: "#fbbf24" },
  { id: "game", label: "Game", color: "#f472b6" },
  { id: "history", label: "History", color: "#d6d3d1" },
  { id: "archive", label: "Archive", color: "#94a3b8" },
  { id: "robot", label: "Robot", color: "#fdba74" },
  { id: "space", label: "Space", color: "#e2e8f0" },
];

/** Quante macrocategorie mostrare in filtri/legenda (le più frequenti nel dataset). */
export const LEGEND_MACRO_TOP_COUNT = 10;
/** Quanti tag mostrare in legenda (i più frequenti nel dataset / vista filtrata). */
export const LEGEND_TAG_TOP_COUNT = 10;

const MACRO_IDS = new Set(MACRO_META.map((m) => m.id));
const MACRO_BY_ID = Object.fromEntries(MACRO_META.map((m) => [m.id, m]));

/** Tag nel dataset che coincidono col nome di un tag macro (dopo normalizzazione lowercase). */
const MACRO_LITERAL_TAG_SET = new Set([
  ...MACRO_IDS,
  "data visualization",
]);

/** @param {string} tagNorm tag già lowercase/trim */
export function isMacroLiteralTag(tagNorm) {
  const k = String(tagNorm).trim();
  return k.length > 0 && MACRO_LITERAL_TAG_SET.has(k);
}

/** Colore arco per intensità legame: blu (pochi) → arancio (medio) → rosso (molti). */
export function colorForLinkStrength(weight, minW, maxW) {
  const w = Number(weight);
  const min = Number(minW);
  const max = Number(maxW);
  if (!Number.isFinite(w)) return "hsl(210, 68%, 58%)";
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return "hsl(210, 68%, 58%)";

  const t = Math.max(0, Math.min(1, (w - min) / (max - min)));
  let hue;
  if (t <= 0.5) {
    hue = 210 + ((32 - 210) * t) / 0.5;
  } else {
    hue = 32 + ((0 - 32) * (t - 0.5)) / 0.5;
  }
  const sat = 62 + t * 18;
  const light = 60 - t * 7;
  return `hsl(${Math.round(hue)}, ${Math.round(sat)}%, ${Math.round(light)}%)`;
}

function legendStrengthScale(minW, maxW) {
  return [
    { label: "Pochi", color: colorForLinkStrength(minW, minW, maxW) },
    { label: "Molti", color: colorForLinkStrength(maxW, minW, maxW) },
  ];
}

function applyLinkStrengthColors(links) {
  if (!links.length) return [];
  const weights = links.map((l) => l.weight);
  const minW = Math.min(...weights);
  const maxW = Math.max(...weights);
  for (const l of links) {
    const w = Number(l.weight);
    const t =
      Number.isFinite(minW) && Number.isFinite(maxW) && maxW > minW
        ? Math.max(0, Math.min(1, (w - minW) / (maxW - minW)))
        : 0;
    l.strokeColor = colorForLinkStrength(w, minW, maxW);
    l.strengthTier = t <= 0.5 ? "cool" : t < 0.75 ? "mid" : "warm";
    l.kind = "strength";
    l.linkKey = `strength:${l.weight}`;
  }
  return legendStrengthScale(minW, maxW);
}

/** Colore stabile e distinto per ogni tag (legenda tag). */
export function colorForTag(tag) {
  const s = String(tag);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hue = (h >>> 0) % 360;
  return `hsl(${hue}, 58%, 58%)`;
}

/** Tag troppo generici: non creano archi “solo-tag” (evita clique dense). */
const TAG_LINK_STOP = new Set([
  "space",
  "exploration",
  "discovery",
  "mission",
  "aerospace",
  "planetary",
  "technical",
]);

/** Tag ignorati nel conteggio Jaccard per archi solo-tag (ridondanti). */
const TAG_JACCARD_IGNORE = new Set([...TAG_LINK_STOP, "the", "and", "of"]);

/**
 * Mappa token/tag (lowercase) → id macrocategoria.
 * Un tag può attivare più macrocategorie.
 */
const TOKEN_TO_MACROS = {
  "2d": ["2d"],
  "3d": ["3d"],
  game: ["game"],
  audio: ["audio"],
  sounds: ["audio"],
  huston: ["audio", "history"],
  apollo: ["apollo"],
  apollo11: ["apollo"],
  "apollo-program": ["apollo"],
  moon: ["apollo", "space"],
  rover: ["robot", "space"],
  perseverance: ["robot", "planets", "space"],
  mars: ["planets", "space", "robot"],
  robot: ["robot"],
  "historical-archives": ["history", "archive"],
  archive: ["archive"],
  "nasa archive": ["archive", "astronomy"],
  media: ["history", "archive"],
  frontpage: ["history", "archive"],
  comparison: ["data_visualization", "history"],
  planets: ["planets"],
  exoplanets: ["planets", "astronomy", "science"],
  "extreme words": ["planets", "science"],
  astronomy: ["astronomy"],
  "deep space": ["astronomy", "space"],
  climate: ["climate"],
  satellites: ["earth", "space", "science"],
  earth: ["earth"],
  orbit: ["earth", "space"],
  observatory: ["astronomy", "earth"],
  technical: ["science"],
  nebula: ["astronomy", "space"],
  spitzer: ["astronomy", "science", "space"],
  space: ["space"],
  exploration: ["space"],
  mission: ["space"],
  missions: ["apollo", "space", "history"],
  discovery: ["science"],
  educational: ["educational"],
  aerospace: ["space"],
  planetary: ["planets", "space"],
  images: ["astronomy", "science"],
  image: ["astronomy"],
  panoramic: ["3d", "space"],
  history: ["history"],
  measurements: ["science", "data_visualization"],
  proportions: ["science", "data_visualization"],
  orbits: ["planets", "science", "space"],
  sun: ["planets", "science"],
  "solar system": ["planets", "space", "science"],
  neo: ["earth", "science", "space"],
  asteroids: ["planets", "space", "science"],
  radar: ["science", "earth"],
  "real life data": ["science", "data_visualization"],
  "data visualization": ["data_visualization", "science"],
  "3d simulator": ["3d", "science"],
  paradigms: ["history", "science"],
  "myth-busting": ["history", "science"],
  epistemology: ["history", "science"],
  "network-navigation": ["data_visualization"],
  "real-time-data": ["data_visualization", "science"],
  spacesuit: ["history", "apollo", "space"],
};

function addValidMacros(out, ids) {
  for (const id of ids) {
    if (MACRO_IDS.has(id)) out.add(id);
  }
}

/**
 * Deriva le macrocategorie da un singolo tag (token o frase).
 * @param {string} tag
 * @returns {Set<string>}
 */
export function tagToMacroIds(tag) {
  const out = new Set();
  const t = String(tag).toLowerCase().trim().replace(/\s+/g, " ");
  if (!t) return out;

  if (t.includes("data visualization") || t.includes("data viz")) {
    addValidMacros(out, ["data_visualization", "science"]);
  }
  if (t.includes("near earth")) addValidMacros(out, ["earth", "science", "space"]);
  if (t.includes("apollo")) addValidMacros(out, ["apollo"]);
  if (t.includes("archive")) addValidMacros(out, ["archive"]);
  if (t.includes("visual") && (t.includes("data") || t.includes("technical"))) {
    addValidMacros(out, ["data_visualization"]);
  }
  if (t.includes("simulator")) addValidMacros(out, ["3d", "science"]);

  const direct = TOKEN_TO_MACROS[t];
  if (direct) addValidMacros(out, direct);

  return out;
}

/** Unione delle macro da tutti i tag del progetto. */
export function collectMacroIds(tagsNorm) {
  const out = new Set();
  for (const tag of tagsNorm) {
    for (const m of tagToMacroIds(tag)) out.add(m);
  }
  return out;
}

/** Prima macro in ordine MACRO_META presente sul nodo (colore / seed). */
export function pickPrimaryMacro(macroIds) {
  for (const m of MACRO_META) {
    if (macroIds.has(m.id)) return m.id;
  }
  return "space";
}

function tagsForTagLinks(tagsNorm) {
  return new Set(
    tagsNorm.filter(
      (t) =>
        !TAG_LINK_STOP.has(t) && !TAG_JACCARD_IGNORE.has(t) && !MACRO_LITERAL_TAG_SET.has(t)
    )
  );
}

/** File effettivamente presenti in `Preview/` (nomi esatti, case-sensitive). */
const PREVIEW_FILES = [
  "Radiowawe_NASA_1.jpg",
  "Radiowawe_NASA_2.jpg",
  "eyesonearth_1.jpg",
  "eyesonearth_2.jpg",
  "hubble_1.jpg",
  "hubble_2.jpg",
  "moonprint_1.jpg",
  "moonprint_2.jpg",
  "nebulavision_1.jpg",
  "nebulavision_2.jpg",
  "neoprotocol_1.jpg",
  "neoprotocol_2.jpg",
  "otherworlds_1.jpg",
  "otherworlds_2.jpg",
  "perseverancerover_1.jpg",
  "perseverancerover_2.jpg",
  "solarscale_1.jpg",
  "solarscale_2.jpg",
];

/** Nomi nel JSON (progetti finti) → stem normalizzato dei file in Preview. */
const PREVIEW_IMAGE_ALIASES = {
  thumbnail: "perseverancerover",
  perseverance_rover: "perseverancerover",
  perseverancerover: "perseverancerover",
  nasasay: "radiowawenasa",
  radiowavenasa: "radiowawenasa",
  lae: "moonprint",
  carla: "eyesonearth",
  nebulavision: "nebulavision",
  moonprint: "moonprint",
  otherworlds: "otherworlds",
  solarscale: "solarscale",
  hubble: "hubble",
  neoprotocol: "neoprotocol",
  projectmoonbound: "moonprint",
};

/** Fallback per titolo se `immagine` è assente o placeholder (`...`). */
const PREVIEW_FALLBACK_BY_TITLE = {
  projectmoonbound: "moonprint",
  lunararchiveexplorer: "moonprint",
  beyondthemyth: "neoprotocol",
  spacesuitevolution: "hubble",
};

function isPlaceholderImageName(name) {
  const t = String(name || "").trim().toLowerCase();
  return !t || t === "..." || t.startsWith("...");
}

function titlePreviewKey(titolo) {
  return String(titolo || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizePreviewKey(name) {
  return String(name).toLowerCase().replace(/\.[^.]+$/, "").replace(/[^a-z0-9]/g, "");
}

/** `moonprint_1.jpg` → `moonprint`; `Radiowawe_NASA_2.jpg` → `radiowawenasa`. */
function previewStemFromFilename(filename) {
  let k = normalizePreviewKey(filename);
  if (/[12]$/.test(k) && k.length > 2) k = k.slice(0, -1);
  return k;
}

function pathsForPreviewStem(stem) {
  const key = PREVIEW_IMAGE_ALIASES[stem] || stem;
  const matches = PREVIEW_FILES.filter((f) => {
    const fileStem = previewStemFromFilename(f);
    return fileStem === key || fileStem.startsWith(key) || key.startsWith(fileStem);
  });
  matches.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return matches.map((f) => `Preview/${f}`);
}

function resolvePreviewPathsForName(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed || isPlaceholderImageName(trimmed)) return [];

  const exact = PREVIEW_FILES.find((f) => f.toLowerCase() === trimmed.toLowerCase());
  if (exact) return [`Preview/${exact}`];

  let key = normalizePreviewKey(trimmed);
  if (!key || key.length < 2) return [];
  if (PREVIEW_IMAGE_ALIASES[key]) key = PREVIEW_IMAGE_ALIASES[key];

  return pathsForPreviewStem(key);
}

function previewPathsFromProject(p) {
  const raw = p.immagine;
  const entries = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
  const out = [];
  const seen = new Set();

  const addPaths = (paths) => {
    for (const path of paths) {
      if (!seen.has(path)) {
        seen.add(path);
        out.push(path);
      }
    }
  };

  for (const entry of entries) {
    if (isPlaceholderImageName(entry)) continue;
    addPaths(resolvePreviewPathsForName(entry));
  }

  if (!out.length) {
    const titleKey = titlePreviewKey(p.titolo);
    const fallbackStem = PREVIEW_FALLBACK_BY_TITLE[titleKey];
    if (fallbackStem) addPaths(pathsForPreviewStem(fallbackStem));
  }

  return out;
}

/** URL sicuro per `<img>` / SVG `<image>` (spazi, `#`, ecc. nel nome file). */
export function getPreviewHref(path) {
  if (!path || typeof path !== "string") return "";
  const i = path.lastIndexOf("/");
  const dir = i >= 0 ? path.slice(0, i + 1) : "";
  const file = i >= 0 ? path.slice(i + 1) : path;
  return dir + encodeURIComponent(file);
}

/**
 * Tag macro più presenti come macro principale dei progetti (per filtri/legenda).
 * @param {{ primaryMacro: string }[]} nodes
 */
function clustersTopByPrimary(nodes, limit = LEGEND_MACRO_TOP_COUNT) {
  const counts = new Map();
  for (const n of nodes) {
    const id = n.primaryMacro;
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([id]) => MACRO_BY_ID[id])
    .filter(Boolean);
}

/**
 * Top tag in legenda (macro e micro insieme): frequenza su tutti i `tagsNorm` dei progetti.
 * @param {{ tagsNorm?: string[] }[]} nodes
 */
export function legendTagsTopFromNodes(nodes, limit = LEGEND_TAG_TOP_COUNT) {
  const tagCounts = new Map();
  for (const n of nodes) {
    for (const t of n.tagsNorm || []) {
      const k = String(t).trim();
      if (!k) continue;
      tagCounts.set(k, (tagCounts.get(k) || 0) + 1);
    }
  }
  return [...tagCounts.entries()]
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([tag]) => ({
      tag,
      color: isMacroLiteralTag(tag)
        ? MACRO_BY_ID[tag]?.color || colorForTag(tag)
        : colorForTag(tag),
    }));
}

/** Tag normalizzati + etichette originali (dedupe case-insensitive, ordine stabile). */
function normalizeProjectTags(tagsRaw) {
  /** @type {{ norm: string; label: string }[]} */
  const pairs = [];
  const seen = new Set();
  for (const raw of tagsRaw || []) {
    const label = String(raw).trim();
    if (!label) continue;
    const norm = label.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    pairs.push({ norm, label });
  }
  pairs.sort((a, b) => a.label.localeCompare(b.label, "it", { sensitivity: "base" }));
  return {
    tagsNorm: pairs.map((p) => p.norm),
    tagsDisplay: pairs.map((p) => p.label),
  };
}

/** @param {object[]} raw
 *  @param {{ topTagsOnly?: boolean }} [options] — Top 10: in vista «Tutti» mostra solo progetti con almeno un top tag
 */
export function buildNetwork(raw, options = {}) {
  const { topTagsOnly = false } = options;
  const allNodes = raw.map((p, i) => {
    const { tagsNorm, tagsDisplay } = normalizeProjectTags(p.tags);
    const macroIds = collectMacroIds(tagsNorm);
    if (macroIds.size === 0) {
      addValidMacros(macroIds, ["science", "space"]);
    }
    const primaryMacro = pickPrimaryMacro(macroIds);
    const meta = MACRO_BY_ID[primaryMacro] || MACRO_META[0];
    const macroLabels = [...macroIds]
      .map((id) => MACRO_BY_ID[id]?.label || id)
      .sort((a, b) => a.localeCompare(b));

    const previewPaths = previewPathsFromProject(p);
    const previewPath = previewPaths[0] || "";

    return {
      id: `n-${i}`,
      index: i,
      titolo: p.titolo,
      descrizione: p.descrizione,
      immagine: p.immagine,
      previewPath,
      previewPaths,
      url: p.url,
      autore: p.autore,
      data: p.data,
      tagsNorm,
      tagsDisplay,
      macroIds,
      primaryMacro,
      clusterId: primaryMacro,
      clusterLabel: macroLabels.join(" · "),
      macroLabels,
      color: meta.color,
      tagLinkSet: tagsForTagLinks(tagsNorm),
    };
  });

  const globalTopTags = legendTagsTopFromNodes(allNodes);
  const topTagSet = new Set(globalTopTags.map((t) => t.tag));
  const nodes = topTagsOnly
    ? allNodes.filter((n) => (n.tagsNorm || []).some((t) => topTagSet.has(t)))
    : allNodes;

  const links = [];

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const A = nodes[i];
      const B = nodes[j];
      let macroShared = 0;
      for (const m of A.macroIds) {
        if (B.macroIds.has(m)) macroShared += 1;
      }

      let tagShared = 0;
      for (const t of A.tagLinkSet) {
        if (B.tagLinkSet.has(t)) tagShared += 1;
      }

      const tagsB = new Set(B.tagsNorm);
      let tagsCommon = 0;
      for (const t of A.tagsNorm) {
        if (tagsB.has(t)) tagsCommon += 1;
      }

      const unionTags = new Set([...A.tagLinkSet, ...B.tagLinkSet]);
      const jaccardTags = unionTags.size > 0 ? tagShared / unionTags.size : 0;

      const hasMacroLink = macroShared >= 1;
      const hasTagLink =
        tagShared >= 2 || (tagShared >= 1 && (jaccardTags >= 0.1 || unionTags.size <= 10));

      if (!hasMacroLink && !hasTagLink) continue;

      const weight = macroShared * 4 + tagShared;

      links.push({
        source: A.id,
        target: B.id,
        weight,
        macroShared,
        tagShared,
        tagsCommon,
      });
    }
  }

  const legendStrength = applyLinkStrengthColors(links);

  const clusters = clustersTopByPrimary(nodes);
  const legendTags = topTagsOnly ? globalTopTags : legendTagsTopFromNodes(nodes);

  const legend = {
    macros: clusters,
    tags: legendTags,
    strength: legendStrength,
  };

  return { nodes, links, clusters, legend };
}

export function filterNetworkByTag(model, tag) {
  if (!tag) return model;
  const tagNorm = String(tag).trim();
  if (!tagNorm) return model;
  const nodes = model.nodes.filter((n) => (n.tagsNorm || []).includes(tagNorm));
  const ids = new Set(nodes.map((n) => n.id));
  const links = model.links.filter((l) => ids.has(l.source) && ids.has(l.target));
  const legendTags = legendTagsTopFromNodes(nodes);
  const legendStrength = applyLinkStrengthColors(links);
  const legendMacros = clustersTopByPrimary(nodes);
  const legend = { macros: legendMacros, tags: legendTags, strength: legendStrength };
  return { nodes, links, clusters: model.clusters, legend };
}
