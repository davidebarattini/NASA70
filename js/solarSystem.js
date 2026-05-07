import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { createPlanet, updatePlanet } from "./planet.js";

const BASE_RADIUS = 12;
const RING_GAP = 6;
const PLANETS_PER_RING = 8;
const SUN_GEOMETRY = new THREE.SphereGeometry(1, 48, 48);

export function createSolarSystem({ category, projects, isWebGPU = false }) {
  const group = new THREE.Group();
  group.name = `system:${category.id}`;
  group.userData.categoryId = category.id;

  const sun = createSun(category, { enableGlow: !isWebGPU });
  group.add(sun);

  const sunLight = new THREE.PointLight(new THREE.Color(category.color), 1.85, 240, 1.65);
  sunLight.position.set(0, 0, 0);
  group.add(sunLight);

  const fillLight = new THREE.PointLight(0xffffff, 0.62, 200, 2);
  fillLight.position.set(24, 20, 32);
  group.add(fillLight);

  const rim = new THREE.DirectionalLight(0xdde8ff, 0.28);
  rim.position.set(-22, 16, 36);
  group.add(rim);

  // Distribute projects across concentric rings so dense categories don't
  // overlap. Inner rings keep fewer planets to avoid crowding the sun.
  const ringPlan = planRings(projects.length);
  const planets = [];
  let cursor = 0;

  ringPlan.forEach((count, ringIndex) => {
    const distance = BASE_RADIUS + ringIndex * RING_GAP;
    addOrbitGuide(group, distance, category.color);

    for (let i = 0; i < count; i += 1) {
      const project = projects[cursor];
      cursor += 1;
      const angleStep = (Math.PI * 2) / count;
      const offset = ringIndex * 0.5;
      const startAngle = i * angleStep + offset;
      // Same angular speed for every planet on a ring so spacing stays stable.
      const direction = ringIndex % 2 === 0 ? 1 : -1;
      const speed = direction * (0.18 - ringIndex * 0.03);
      const orbit = {
        distance,
        radius: 1.6 + Math.random() * 0.4,
        startAngle,
        speed,
        spin: 0.4 + Math.random() * 0.4,
        tilt: Math.random() * Math.PI,
        bob: 0.6 + Math.random() * 0.4,
        ringIndex,
        enableHalo: !isWebGPU,
      };

      const planet = createPlanet({ project, category, orbit });
      const labelEl = document.createElement("div");
      labelEl.className = "planet-label";
      labelEl.textContent = project.title;
      const label = new CSS2DObject(labelEl);
      label.position.set(0, orbit.radius * 1.35, 0);
      // Start hidden: labels are enabled only for the active system.
      label.visible = false;
      planet.add(label);
      planet.userData.label = label;
      group.add(planet);
      planets.push(planet);
    }
  });

  group.userData.planets = planets;
  group.userData.sun = sun;

  // Start hidden so the entry transition can fade us in.
  group.visible = false;
  // Ensure every CSS2D label starts hidden; showSystem() will enable them.
  setPlanetLabelsVisible(group, false);

  return group;
}

export function updateSolarSystem(systemGroup, deltaSeconds) {
  const sun = systemGroup.userData.sun;
  if (sun) sun.rotation.y += deltaSeconds * 0.05;

  const planets = systemGroup.userData.planets ?? [];
  for (const planet of planets) {
    updatePlanet(planet, deltaSeconds);
  }
}

function planRings(planetCount) {
  if (planetCount <= 0) return [];
  if (planetCount <= 5) return [planetCount];

  const rings = [];
  let remaining = planetCount;
  let ringIndex = 0;
  while (remaining > 0) {
    // First ring is a bit smaller, outer rings carry more planets.
    const capacity = PLANETS_PER_RING + ringIndex;
    const count = Math.min(remaining, capacity);
    rings.push(count);
    remaining -= count;
    ringIndex += 1;
    if (ringIndex > 6) {
      // Safety fallback if we ever get a ridiculously large category.
      rings[rings.length - 1] += remaining;
      remaining = 0;
    }
  }
  return rings;
}

function createSun(category, { enableGlow } = {}) {
  const color = new THREE.Color(category.color);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.92,
  });
  const sun = new THREE.Mesh(SUN_GEOMETRY, material);
  sun.scale.setScalar(category.sunSize);

  if (enableGlow !== false) {
    // Soft additive glow sphere.
    const glowMaterial = new THREE.SpriteMaterial({
      map: getSunHaloTexture(),
      color,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.85,
    });
    const glow = new THREE.Sprite(glowMaterial);
    glow.scale.setScalar(category.sunSize * 4.2);
    sun.add(glow);
  }

  return sun;
}

function addOrbitGuide(parent, radius, colorHex) {
  const segments = 128;
  // WebGPU renderer doesn't support LineLoop, so we create a closed Line
  // by repeating the first vertex at the end.
  const positions = new Float32Array((segments + 1) * 3);
  for (let i = 0; i <= segments; i += 1) {
    const t = (i / segments) * Math.PI * 2;
    positions[i * 3 + 0] = Math.cos(t) * radius;
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = Math.sin(t) * radius;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({
    color: new THREE.Color(colorHex),
    transparent: true,
    opacity: 0.16,
  });
  const ring = new THREE.Line(geometry, material);
  parent.add(ring);
}

let cachedSunHalo = null;
function getSunHaloTexture() {
  if (cachedSunHalo) return cachedSunHalo;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.25, "rgba(255,255,255,0.55)");
  gradient.addColorStop(0.6, "rgba(255,255,255,0.12)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  cachedSunHalo = new THREE.CanvasTexture(canvas);
  cachedSunHalo.colorSpace = THREE.SRGBColorSpace;
  return cachedSunHalo;
}

// Smoothly fade-in the system: scales it up from 0.85 to 1.0 and reveals
// the label.
export function showSystem(systemGroup, { instant = false } = {}) {
  systemGroup.visible = true;
  setPlanetLabelsVisible(systemGroup, true);
  systemGroup.userData.fadeStart = performance.now();
  systemGroup.userData.fadeDuration = instant ? 0 : 600;
  systemGroup.userData.fadeMode = "in";
  if (systemGroup.userData.label) {
    systemGroup.userData.label.visible = true;
  }
  if (systemGroup.userData.labelEl) {
    systemGroup.userData.labelEl.style.opacity = instant ? "1" : "0";
  }
}

export function hideSystem(systemGroup, { instant = false } = {}) {
  systemGroup.userData.fadeStart = performance.now();
  systemGroup.userData.fadeDuration = instant ? 0 : 400;
  systemGroup.userData.fadeMode = "out";
  if (systemGroup.userData.labelEl) {
    systemGroup.userData.labelEl.style.opacity = "0";
  }
  if (instant) {
    systemGroup.visible = false;
    setPlanetLabelsVisible(systemGroup, false);
    if (systemGroup.userData.label) {
      systemGroup.userData.label.visible = false;
    }
  }
}

export function tickSystemFade(systemGroup) {
  if (!systemGroup) return;
  const start = systemGroup.userData.fadeStart;
  const duration = systemGroup.userData.fadeDuration;
  if (start == null || duration == null) return;
  const t = duration === 0 ? 1 : Math.min(1, (performance.now() - start) / duration);
  const eased = easeOutCubic(t);
  if (systemGroup.userData.fadeMode === "in") {
    const scale = 0.85 + eased * 0.15;
    systemGroup.scale.setScalar(scale);
    setSystemOpacity(systemGroup, eased);
    if (systemGroup.userData.labelEl) {
      systemGroup.userData.labelEl.style.opacity = String(eased);
    }
    if (t >= 1) {
      systemGroup.userData.fadeStart = null;
    }
  } else if (systemGroup.userData.fadeMode === "out") {
    const scale = 1.0 - eased * 0.1;
    systemGroup.scale.setScalar(scale);
    setSystemOpacity(systemGroup, 1 - eased);
    if (t >= 1) {
      systemGroup.visible = false;
      setPlanetLabelsVisible(systemGroup, false);
      if (systemGroup.userData.label) {
        systemGroup.userData.label.visible = false;
      }
      systemGroup.userData.fadeStart = null;
    }
  }
}

function setPlanetLabelsVisible(systemGroup, visible) {
  if (!systemGroup) return;
  systemGroup.traverse((child) => {
    // CSS2DObject extends Object3D and is identified with isCSS2DObject.
    if (child?.isCSS2DObject) {
      child.visible = visible;
    }
  });
}

function setSystemOpacity(systemGroup, opacity) {
  systemGroup.traverse((child) => {
    if (child.material && "opacity" in child.material) {
      if (child.userData?.kind === "planet") {
        child.material.opacity = opacity;
        child.material.transparent = true;
      } else if (child.isLine) {
        child.material.opacity = 0.16 * opacity;
      } else if (child.isSprite) {
        const baseOpacity = child.material.userData?.baseOpacity;
        if (baseOpacity == null) {
          child.material.userData = child.material.userData || {};
          child.material.userData.baseOpacity = child.material.opacity;
        }
        child.material.opacity = (child.material.userData.baseOpacity ?? 0.85) * opacity;
      } else if (child.isMesh) {
        child.material.transparent = true;
        child.material.opacity = opacity;
      }
    }
  });
}

function easeOutCubic(x) {
  return 1 - Math.pow(1 - x, 3);
}
