import { CATEGORIES, findCategoryForTags } from "./categories.js";

export const DATA_URL = "https://ixd-supsi.github.io/n70api/data.json";
export const FALLBACK_DATA_URL = new URL("../data.json", import.meta.url).toString();
// Image filenames in the JSON are relative to the API host.
export const IMAGE_BASE_URL = "https://ixd-supsi.github.io/n70api/immagini/";

const MONTHS_IT = [
  "gennaio",
  "febbraio",
  "marzo",
  "aprile",
  "maggio",
  "giugno",
  "luglio",
  "agosto",
  "settembre",
  "ottobre",
  "novembre",
  "dicembre",
];

function resolveImageUrl(filename) {
  if (!filename) return null;
  if (/^https?:\/\//i.test(filename)) return filename;
  return new URL(filename, IMAGE_BASE_URL).toString();
}

function formatDate(date) {
  if (!date) return "";
  const day = Number(date.giorno);
  const month = Number(date.mese);
  const year = Number(date.anno);
  if (!day || !month || !year) return "";
  const monthName = MONTHS_IT[month - 1] ?? "";
  return `${day} ${monthName} ${year}`.trim();
}

function slugify(value, fallback = "project") {
  const slug = String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug || fallback;
}

function normalizeProject(raw, index) {
  const tags = Array.isArray(raw.tags) ? raw.tags.filter(Boolean) : [];
  const category = findCategoryForTags(tags);
  const id = `${slugify(raw.titolo, `project-${index}`)}-${index}`;

  return {
    id,
    title: String(raw.titolo ?? "Senza titolo").trim(),
    description: String(raw.descrizione ?? "").trim(),
    author: String(raw.autore ?? "").trim(),
    url: String(raw.url ?? "#").trim(),
    image: resolveImageUrl(raw.immagine),
    date: formatDate(raw.data),
    rawDate: raw.data ?? null,
    tags,
    categoryId: category?.id ?? null,
  };
}

export async function fetchProjects({ signal } = {}) {
  const json = await fetchJsonWithFallback({ signal });
  if (!Array.isArray(json)) {
    throw new Error("Formato dati inatteso");
  }

  return json.map((entry, index) => normalizeProject(entry, index));
}

async function fetchJson(url, { signal } = {}) {
  const response = await fetch(url, { signal, credentials: "omit" });
  if (!response.ok) throw new Error(`Errore di rete (${response.status}) su ${url}`);
  try {
    return await response.json();
  } catch {
    throw new Error(`Risposta JSON non valida su ${url}`);
  }
}

async function fetchJsonWithFallback({ signal } = {}) {
  try {
    return await fetchJson(DATA_URL, { signal });
  } catch (err) {
    // Fallback to a same-origin snapshot so local dev always works.
    try {
      return await fetchJson(FALLBACK_DATA_URL, { signal });
    } catch (fallbackErr) {
      // Surface the original error first; the fallback error is usually 404
      // when the developer doesn't have the file.
      throw err instanceof Error ? err : fallbackErr;
    }
  }
}

// Returns an array of { category, projects } in the canonical order, only
// including categories that contain at least one project.
export function groupByCategory(projects) {
  const buckets = new Map();
  for (const category of CATEGORIES) {
    buckets.set(category.id, { category, projects: [] });
  }

  for (const project of projects) {
    const bucket = buckets.get(project.categoryId);
    if (bucket) bucket.projects.push(project);
  }

  return Array.from(buckets.values()).filter((b) => b.projects.length > 0);
}
