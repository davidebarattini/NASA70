import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { createCategoryPlanet, createPlanet, updatePlanet } from "./planet.js";

const NASA_LOGO_URL = new URL("../assets/logo_nasa.png", import.meta.url).href;

export function createMainSystem({ categories, isWebGPU = false }) {
  const group = new THREE.Group();
  group.name = "system:main";
  group.userData.systemType = "main";
  group.userData.isWebGPU = isWebGPU;

  const sun = createSunCage();
  group.add(sun);
  group.userData.sun = sun;

  const sunLight = new THREE.PointLight(0xffffff, 1.0, 240, 1.8);
  sunLight.position.set(0, 0, 0);
  group.add(sunLight);

  const orbitContainer = new THREE.Group();
  orbitContainer.name = "homeOrbits";
  group.add(orbitContainer);
  group.userData.orbitContainer = orbitContainer;
  group.userData.planets = [];
  group.userData.categories = categories;

  group.visible = false;
  return group;
}

export function updateMainSystem(systemGroup, deltaSeconds) {
  const sun = systemGroup.userData.sun;
  if (sun) {
    sun.rotation.y += deltaSeconds * 0.12;
    const holder = sun.userData.logoHolder;
    if (holder) holder.rotation.y += deltaSeconds * 0.55;
    const inner = sun.userData.innerCage;
    if (inner) inner.rotation.y -= deltaSeconds * 0.08;
  }

  const planets = systemGroup.userData.planets ?? [];
  for (const planet of planets) {
    updatePlanet(planet, deltaSeconds);
  }
}

export function applyHomeLayout(systemGroup, { mode, categories, projects, selectedCategoryIds, ringCount, planetScale = 1, categoryById }) {
  const container = systemGroup.userData.orbitContainer;
  if (!container) return;

  // CSS2DRenderer can leave stale label nodes around when objects are rebuilt quickly.
  // Clearing the labels root keeps DOM in sync and prevents duplicated texts.
  const labelsRoot = document.getElementById("labels");
  if (labelsRoot) labelsRoot.innerHTML = "";

  // Clear old orbiting bodies.
  while (container.children.length) container.remove(container.children[0]);
  systemGroup.userData.planets = [];

  const isWebGPU = Boolean(systemGroup.userData.isWebGPU);
  const selected = new Set(selectedCategoryIds ?? []);

  const items = [];
  if (mode === "projects") {
    for (const p of projects ?? []) {
      if (selected.size && p.categoryId && !selected.has(p.categoryId)) continue;
      const cat = categoryById?.get(p.categoryId) ?? categories?.find((c) => c.id === p.categoryId) ?? categories?.[0];
      items.push({ kind: "project", project: p, category: cat });
    }
  } else {
    for (const c of categories ?? []) {
      if (selected.size && !selected.has(c.id)) continue;
      items.push({ kind: "category", category: c });
    }
  }

  const rings = clampInt(ringCount ?? 3, 1, 6);
  const ringPlan = planRings(items.length, rings);
  const scale = clampFloat(planetScale, 0.6, 1.6);
  const baseR = 22 + (scale - 1) * 6;
  const gap = 7.5 + (scale - 1) * 4;

  let cursor = 0;
  ringPlan.forEach((countOnRing, ringIndex) => {
    if (countOnRing <= 0) return;
    const radius = baseR + ringIndex * gap;
    const direction = ringIndex % 2 === 0 ? 1 : -1;
    const speed = direction * (0.12 - ringIndex * 0.01);
    for (let i = 0; i < countOnRing; i += 1) {
      const entry = items[cursor++];
      const startAngle = (i / countOnRing) * Math.PI * 2 + ringIndex * 0.35;
      const orbit = {
        distance: radius,
        radius: (entry.kind === "project" ? 1.55 : 2.6) * scale,
        startAngle,
        speed,
        spin: 0.25,
        tilt: i * 0.3 + ringIndex * 0.6,
        bob: 0.14 + ringIndex * 0.05,
        ringIndex,
        enableHalo: !isWebGPU,
      };

      let planet;
      if (entry.kind === "project") {
        planet = createPlanet({ project: entry.project, category: entry.category, orbit });
        const labelEl = document.createElement("div");
        labelEl.className = "planet-label planet-label--small";
        labelEl.textContent = entry.project.title;
        const label = new CSS2DObject(labelEl);
        label.position.set(0, orbit.radius * 1.55, 0);
        label.visible = false;
        planet.add(label);
        planet.userData.label = label;
      } else {
        planet = createCategoryPlanet({ category: entry.category, orbit });
        const labelEl = document.createElement("div");
        labelEl.className = "category-label";
        labelEl.textContent = entry.category.label;
        const label = new CSS2DObject(labelEl);
        label.position.set(0, orbit.radius * 1.35, 0);
        label.visible = false;
        planet.add(label);
        planet.userData.label = label;
      }

      container.add(planet);
      systemGroup.userData.planets.push(planet);
    }
  });

  // If the home system is active, keep labels live; otherwise keep them hidden.
  setCss2dVisibility(systemGroup, Boolean(systemGroup.visible));
}

function setCss2dVisibility(root, visible) {
  if (!root) return;
  root.traverse((child) => {
    if (child?.isCSS2DObject) child.visible = visible;
  });
}

function planRings(total, ringCount) {
  if (total <= 0) return Array.from({ length: ringCount }, () => 0);
  const base = Math.floor(total / ringCount);
  const remainder = total % ringCount;
  const plan = [];
  for (let i = 0; i < ringCount; i += 1) {
    plan.push(base + (i < remainder ? 1 : 0));
  }
  return plan;
}

function clampInt(value, min, max) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function clampFloat(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function createCircleLine(radius, axis, material) {
  const segments = 128;
  const positions = new Float32Array((segments + 1) * 3);
  for (let i = 0; i <= segments; i += 1) {
    const t = (i / segments) * Math.PI * 2;
    if (axis === "xy") {
      positions[i * 3 + 0] = Math.cos(t) * radius;
      positions[i * 3 + 1] = Math.sin(t) * radius;
      positions[i * 3 + 2] = 0;
    } else if (axis === "xz") {
      positions[i * 3 + 0] = Math.cos(t) * radius;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = Math.sin(t) * radius;
    } else {
      positions[i * 3 + 0] = 0;
      positions[i * 3 + 1] = Math.cos(t) * radius;
      positions[i * 3 + 2] = Math.sin(t) * radius;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return new THREE.Line(geometry, material);
}

/**
 * Central “sun”: outline cage + rotating NASA logo inside (no solid glowing sphere).
 */
function createSunCage() {
  const rig = new THREE.Group();
  rig.name = "sunCage";

  const outerR = 6.2;
  const lineOuter = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  rig.add(createCircleLine(outerR, "xy", lineOuter));
  rig.add(createCircleLine(outerR, "xz", lineOuter));
  rig.add(createCircleLine(outerR, "yz", lineOuter));

  const lineHalo = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const haloR = outerR + 0.35;
  rig.add(createCircleLine(haloR, "xy", lineHalo));
  rig.add(createCircleLine(haloR, "xz", lineHalo));
  rig.add(createCircleLine(haloR, "yz", lineHalo));

  const lineHaloRed = new THREE.LineBasicMaterial({
    color: 0xfc3d21,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const haloR2 = outerR + 0.7;
  rig.add(createCircleLine(haloR2, "xy", lineHaloRed));
  rig.add(createCircleLine(haloR2, "xz", lineHaloRed));
  rig.add(createCircleLine(haloR2, "yz", lineHaloRed));

  const midR = 5.0;
  const lineMid = new THREE.LineBasicMaterial({
    color: 0xfc3d21,
    transparent: true,
    opacity: 0.98,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const midGroup = new THREE.Group();
  midGroup.add(createCircleLine(midR, "xy", lineMid));
  midGroup.add(createCircleLine(midR, "xz", lineMid));
  midGroup.add(createCircleLine(midR, "yz", lineMid));
  midGroup.rotation.set(0.55, 0.35, 0.2);
  rig.add(midGroup);
  rig.userData.innerCage = midGroup;

  const ico = new THREE.IcosahedronGeometry(3.55, 1);
  const edges = new THREE.EdgesGeometry(ico);
  const latticeMatWhite = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const lattice = new THREE.LineSegments(edges, latticeMatWhite);
  rig.add(lattice);

  const edgesRed = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(3.62, 1));
  const latticeRed = new THREE.LineSegments(
    edgesRed,
    new THREE.LineBasicMaterial({
      color: 0xfc3d21,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  latticeRed.rotation.set(0.12, 0.08, 0);
  rig.add(latticeRed);

  const logoHolder = new THREE.Group();
  logoHolder.name = "nasaLogoSpin";

  const aspect = 200 / 168;
  const planeW = 3.6;
  const planeH = planeW / aspect;
  const planeGeo = new THREE.PlaneGeometry(planeW, planeH);
  const planeMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const logoPlane = new THREE.Mesh(planeGeo, planeMat);
  logoHolder.add(logoPlane);

  const loader = new THREE.TextureLoader();
  loader.load(
    NASA_LOGO_URL,
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      planeMat.map = texture;
      planeMat.opacity = 1;
      planeMat.needsUpdate = true;
    },
    undefined,
    () => {
      planeMat.color.setHex(0xfc3d21);
      planeMat.opacity = 0.85;
      planeMat.needsUpdate = true;
    },
  );

  rig.add(logoHolder);
  rig.userData.logoHolder = logoHolder;

  return rig;
}
