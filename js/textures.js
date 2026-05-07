import * as THREE from "three";

// Texture cache keyed by image URL. Avoids re-downloading the same project
// thumbnail when a system gets re-activated.
const textureCache = new Map();
// Cache for placeholder textures keyed by `${initial}|${color}`.
const placeholderCache = new Map();

const loader = new THREE.TextureLoader();
loader.crossOrigin = "anonymous";

export function getTexture(url) {
  if (!url) return null;
  if (textureCache.has(url)) return textureCache.get(url);

  const promise = new Promise((resolve, reject) => {
    loader.load(
      url,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.needsUpdate = true;
        resolve(texture);
      },
      undefined,
      (err) => reject(err),
    );
  });

  textureCache.set(url, promise);
  return promise;
}

export async function getFirstTexture(urls = []) {
  const list = Array.isArray(urls) ? urls.filter(Boolean) : [urls].filter(Boolean);
  for (const url of list) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const texture = await getTexture(url);
      if (texture) return texture;
    } catch {
      // Try next URL
    }
  }
  return null;
}

// Generates a flat circular thumbnail with the project author's initial.
// Used while the real image is still loading (or as fallback on error).
export function getPlaceholderTexture({ label = "?", color = "#3a4670" } = {}) {
  const key = `${label}|${color}`;
  if (placeholderCache.has(key)) return placeholderCache.get(key);

  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  const gradient = ctx.createRadialGradient(
    size * 0.35,
    size * 0.35,
    size * 0.05,
    size * 0.5,
    size * 0.5,
    size * 0.55,
  );
  gradient.addColorStop(0, lighten(color, 0.4));
  gradient.addColorStop(1, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  // Subtle dotted texture so the planet looks less flat without an image.
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  for (let i = 0; i < 60; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = Math.random() * 2 + 0.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = `600 ${size * 0.42}px "Space Grotesk", "Inter", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(label).slice(0, 2).toUpperCase(), size / 2, size / 2 + size * 0.02);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  placeholderCache.set(key, texture);
  return texture;
}

function lighten(hex, amount) {
  const c = new THREE.Color(hex);
  c.lerp(new THREE.Color(0xffffff), amount);
  return `#${c.getHexString()}`;
}

export function disposeTexture(texture) {
  if (!texture) return;
  if (typeof texture.then === "function") return;
  texture.dispose?.();
}
