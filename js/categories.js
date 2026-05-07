// Macro-categories ordered by priority. The first matching category wins.
// Each entry: id, label, color (hex), accent (rgb glow), tags (lowercase aliases),
// and a sunSize multiplier used by the 3D scene.

export const CATEGORIES = [
  {
    id: "2d",
    label: "2D",
    color: "#7dd3fc",
    accent: "rgba(125, 211, 252, 0.55)",
    tags: ["2d", "2D"],
    sunSize: 4.2,
    description: "Esperienze bidimensionali, interfacce e visualizzazioni 2D.",
  },
  {
    id: "3d",
    label: "3D",
    color: "#34d399",
    accent: "rgba(52, 211, 153, 0.55)",
    tags: ["3d", "3D", "webgl", "three.js", "threejs"],
    sunSize: 4.3,
    description: "Esperienze tridimensionali, simulazioni e ambienti 3D.",
  },
  {
    id: "apollo",
    label: "Apollo",
    color: "#fbbf24",
    accent: "rgba(251, 191, 36, 0.55)",
    tags: ["apollo", "apollo11", "apollo 11", "apollo-program", "apollo program"],
    sunSize: 4.6,
    description: "Missioni Apollo, racconti e materiali correlati.",
  },
  {
    id: "astronomy",
    label: "Astronomy",
    color: "#a78bfa",
    accent: "rgba(167, 139, 250, 0.6)",
    tags: [
      "astronomy",
      "nebula",
      "nebulae",
      "spitzer",
      "hubble",
      "deep space",
      "exoplanets",
      "galaxy",
      "galaxies",
    ],
    sunSize: 4.4,
    description: "Spazio profondo, osservazioni e astronomia.",
  },
  {
    id: "audio",
    label: "Audio",
    color: "#fb7185",
    accent: "rgba(251, 113, 133, 0.55)",
    tags: ["audio", "sound", "sounds", "radio", "transmissions"],
    sunSize: 4.2,
    description: "Archivi sonori, trasmissioni e racconti audio.",
  },
  {
    id: "climate",
    label: "Climate",
    color: "#60a5fa",
    accent: "rgba(96, 165, 250, 0.55)",
    tags: ["climate", "climate change", "satellites", "satellite", "observatory"],
    sunSize: 4.8,
    description: "Clima, osservazione e impatti sulla Terra.",
  },
  {
    id: "science",
    label: "Science",
    color: "#22c55e",
    accent: "rgba(34, 197, 94, 0.5)",
    tags: ["science", "scientific", "data", "research", "measurements"],
    sunSize: 4.3,
    description: "Dati, misure e divulgazione scientifica.",
  },
  {
    id: "data-visualization",
    label: "Data visualization",
    color: "#38bdf8",
    accent: "rgba(56, 189, 248, 0.55)",
    tags: ["data visualization", "dataviz", "visualization", "visualisation"],
    sunSize: 4.4,
    description: "Visualizzazioni dati e infografiche interattive.",
  },
  {
    id: "earth",
    label: "Earth",
    color: "#4ea8ff",
    accent: "rgba(78, 168, 255, 0.55)",
    tags: ["earth", "terra", "orbit", "satellites", "satellite"],
    sunSize: 4.8,
    description: "Terra, orbite e osservazione del pianeta.",
  },
  {
    id: "planets",
    label: "Planets",
    color: "#f59e0b",
    accent: "rgba(245, 158, 11, 0.55)",
    tags: ["planets", "planetary", "solar system", "orbits", "sun", "moon", "mars"],
    sunSize: 5.0,
    description: "Pianeti, orbite e sistema solare.",
  },
  {
    id: "educational",
    label: "Educational",
    color: "#93c5fd",
    accent: "rgba(147, 197, 253, 0.55)",
    tags: ["educational", "education", "learning", "kids", "outreach"],
    sunSize: 4.4,
    description: "Progetti educativi e divulgativi.",
  },
  {
    id: "game",
    label: "Game",
    color: "#f472b6",
    accent: "rgba(244, 114, 182, 0.55)",
    tags: ["game", "play", "interactive", "challenge"],
    sunSize: 4.4,
    description: "Esperienze ludiche e interattive.",
  },
  {
    id: "history",
    label: "History",
    color: "#fb923c",
    accent: "rgba(251, 146, 60, 0.55)",
    tags: ["history", "historical", "media", "frontpage", "paradigms", "myth-busting"],
    sunSize: 4.5,
    description: "Storia, media e contesti culturali.",
  },
  {
    id: "archive",
    label: "Archive",
    color: "#facc15",
    accent: "rgba(250, 204, 21, 0.55)",
    tags: ["archive", "archives", "historical-archives", "nasa archive"],
    sunSize: 4.4,
    description: "Archivi, collezioni e materiali consultabili.",
  },
  {
    id: "robot",
    label: "Robot",
    color: "#5ad9c5",
    accent: "rgba(90, 217, 197, 0.55)",
    tags: ["robot", "rover", "aerospace", "engineering", "perseverance"],
    sunSize: 4.6,
    description: "Robot, rover e tecnologie per l’esplorazione.",
  },
  {
    id: "space",
    label: "Space",
    color: "#0ea5e9",
    accent: "rgba(14, 165, 233, 0.55)",
    tags: ["space", "spazio", "mission", "exploration", "discovery", "deep space"],
    sunSize: 4.7,
    description: "Spazio, missioni e esplorazione.",
  },
];

export const FALLBACK_CATEGORY_ID = "space";

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
