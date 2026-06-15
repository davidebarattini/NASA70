const DATA_URLS = [
  "data.json",
  new URL("../data.json", import.meta.url).href,
  "https://ixd-supsi.github.io/n70api/data.json",
];

/**
 * Carica l'array progetti con fallback multipli (locale → snapshot → API).
 * @returns {Promise<object[]>}
 */
export async function loadProjectsRaw() {
  const errors = [];

  for (const url of DATA_URLS) {
    try {
      const res = await fetch(url, { cache: "no-store", credentials: "omit" });
      if (!res.ok) {
        errors.push(`${url} → HTTP ${res.status}`);
        continue;
      }
      const raw = await res.json();
      if (!Array.isArray(raw)) {
        errors.push(`${url} → JSON non è un array`);
        continue;
      }
      if (!raw.length) {
        errors.push(`${url} → array vuoto`);
        continue;
      }
      return raw;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${url} → ${msg}`);
    }
  }

  const hint =
    typeof window !== "undefined" && window.location?.protocol === "file:"
      ? " Apri il sito con un server locale (es. Live Server), non via file://."
      : "";

  throw new Error(
    `Impossibile caricare i progetti.${hint} Dettagli: ${errors.join(" | ")}`,
  );
}
