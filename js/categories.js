// Macro-categories ordered by priority. The first matching category wins.
// Each entry: id, label, color (hex), accent (rgb glow), tags (lowercase aliases),
// and a sunSize multiplier used by the 3D scene.

export const CATEGORIES = [
  {
    id: "luna",
    label: "Luna",
    color: "#d8d4c2",
    accent: "rgba(216, 212, 194, 0.55)",
    tags: ["moon", "luna", "apollo", "lunar"],
    sunSize: 4.4,
    description: "Missioni lunari, archivi e racconti del nostro satellite.",
  },
  {
    id: "marte",
    label: "Marte",
    color: "#ff7a4a",
    accent: "rgba(255, 122, 74, 0.55)",
    tags: ["mars", "marte", "rover", "perseverance", "curiosity", "planetary"],
    sunSize: 4.6,
    description: "Esplorazione robotica e missioni sul Pianeta Rosso.",
  },
  {
    id: "terra",
    label: "Terra",
    color: "#4ea8ff",
    accent: "rgba(78, 168, 255, 0.55)",
    tags: ["earth", "terra", "climate change", "climate", "satellites", "satelliti"],
    sunSize: 4.8,
    description: "Osservazione della Terra, clima e satelliti operativi.",
  },
  {
    id: "sistema-solare",
    label: "Sistema Solare",
    color: "#f5c45e",
    accent: "rgba(245, 196, 94, 0.6)",
    tags: [
      "solar system",
      "sistema solare",
      "planets",
      "pianeti",
      "dimensions",
      "distances",
      "positions",
    ],
    sunSize: 5.0,
    description: "Pianeti, distanze e proporzioni del nostro sistema.",
  },
  {
    id: "universo-profondo",
    label: "Universo Profondo",
    color: "#9b6dff",
    accent: "rgba(155, 109, 255, 0.6)",
    tags: [
      "exoplanets",
      "exoplanet",
      "nebula",
      "nebulae",
      "galaxy",
      "galaxies",
      "hubble",
      "spazio",
      "immagini",
      "deep space",
    ],
    sunSize: 4.2,
    description: "Esopianeti, galassie e immagini dei grandi telescopi.",
  },
  {
    id: "tecnologia",
    label: "Tecnologia & Veicoli",
    color: "#5ad9c5",
    accent: "rgba(90, 217, 197, 0.55)",
    tags: [
      "spacesuit",
      "tute",
      "robot",
      "aerospace",
      "3d",
      "engineering",
      "tecnologia",
      "vehicles",
    ],
    sunSize: 4.3,
    description: "Tute, veicoli e ingegneria che ci porta nello spazio.",
  },
  {
    id: "storia",
    label: "Storia & Media",
    color: "#fc3d21",
    accent: "rgba(252, 61, 33, 0.55)",
    tags: [
      "newspaper",
      "comparison",
      "sounds",
      "audio",
      "kids",
      "game",
      "educational",
      "gravity",
      "history",
      "media",
      "missions",
      "discovery",
      "exploration",
      "mission",
      "nasa70",
    ],
    sunSize: 4.5,
    description: "Archivi, narrazioni e media che hanno raccontato la NASA.",
  },
];

export const FALLBACK_CATEGORY_ID = "storia";

export function getCategoryById(id) {
  return CATEGORIES.find((c) => c.id === id) ?? null;
}

// Lower-case + trim project tags to compare with category aliases.
function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .trim();
}

export function findCategoryForTags(tags = []) {
  const normalized = tags.map(normalize).filter(Boolean);
  if (normalized.length === 0) {
    return getCategoryById(FALLBACK_CATEGORY_ID);
  }

  for (const category of CATEGORIES) {
    const aliasSet = new Set(category.tags.map(normalize));
    const hit = normalized.some((tag) => aliasSet.has(tag));
    if (hit) return category;
  }

  return getCategoryById(FALLBACK_CATEGORY_ID);
}
