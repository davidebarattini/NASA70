import * as THREE from "three";
import { getFirstTexture, getPlaceholderTexture } from "./textures.js";

// Re-used geometry to keep memory low when a system has many planets.
const PLANET_GEOMETRY = new THREE.SphereGeometry(1, 48, 48);
const HOVER_CAGE_GEOMETRY = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1, 3));

export function createPlanet({ project, category, orbit }) {
  const group = new THREE.Group();
  group.name = `planet:${project.id}`;
  group.userData.kind = "planet";

  // Each planet maintains its own material so its texture and emissive tint
  // stay independent from the others.
  const material = new THREE.MeshStandardMaterial({
    map: getPlaceholderTexture({
      label: project.author?.[0] ?? project.title?.[0] ?? "?",
      color: category.color,
    }),
    roughness: 0.48,
    metalness: 0.2,
    color: 0xffffff,
    emissive: new THREE.Color(0x000000),
    emissiveIntensity: 0,
  });

  const mesh = new THREE.Mesh(PLANET_GEOMETRY, material);
  mesh.scale.setScalar(orbit.radius);
  mesh.userData = {
    kind: "planet",
    projectId: project.id,
    project,
    baseScale: orbit.radius,
    hoverScale: orbit.radius * 1.18,
  };

  const glowColor = new THREE.Color(category.color).lerp(new THREE.Color(0xffffff), 0.32);
  // Projects: hover "cage" outline only (never covers thumbnail).
  const glow = { inner: null, outer: null, baseInner: 0, baseOuter: 0 };
  const hoverCage = addHoverCage(mesh, glowColor, { baseOpacity: 0 });

  group.add(mesh);

  const { enableHalo = true } = orbit;
  let halo = null;
  if (enableHalo) {
    // Extra hover ring (WebGL-friendly); skipped on WebGPU elsewhere via enableHalo=false.
    const haloMaterial = new THREE.SpriteMaterial({
      map: getHaloTexture(),
      color: new THREE.Color(category.color),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.0,
    });
    halo = new THREE.Sprite(haloMaterial);
    halo.scale.setScalar(orbit.radius * 3);
    group.add(halo);
  }

  group.userData.mesh = mesh;
  group.userData.glowMesh = glow.inner;
  group.userData.outerGlowMesh = glow.outer;
  group.userData.glowBaseOpacity = glow.baseInner;
  group.userData.outerGlowBaseOpacity = glow.baseOuter;
  group.userData.hoverCage = hoverCage;
  group.userData.hoverCageBaseOpacity = hoverCage.material.opacity;
  group.userData.halo = halo;
  group.userData.orbit = orbit;
  group.userData.theta = orbit.startAngle;

  // Place the planet at its starting orbital position.
  positionPlanet(group, orbit.startAngle);

  // Kick off the texture load asynchronously; if it fails, the placeholder
  // stays in place.
  const sources = Array.isArray(project.imageSources) ? project.imageSources : [project.image].filter(Boolean);
  if (sources.length > 0) {
    Promise.resolve(getFirstTexture(sources))
      .then((texture) => {
        if (texture) {
          material.map = texture;
          material.needsUpdate = true;
        }
      })
      .catch(() => {
        // Already showing the placeholder; nothing else to do.
      });
  }

  return group;
}

export function createCategoryPlanet({ category, orbit }) {
  const group = new THREE.Group();
  group.name = `category:${category.id}`;
  group.userData.kind = "category";
  group.userData.categoryId = category.id;

  const material = new THREE.MeshStandardMaterial({
    map: getPlaceholderTexture({
      label: category.label?.[0] ?? "?",
      color: category.color,
    }),
    roughness: 0.5,
    metalness: 0.25,
    color: 0xffffff,
    emissive: new THREE.Color(0x000000),
    emissiveIntensity: 0.0,
  });

  const mesh = new THREE.Mesh(PLANET_GEOMETRY, material);
  mesh.scale.setScalar(orbit.radius);
  mesh.userData = {
    kind: "category",
    categoryId: category.id,
    category,
    baseScale: orbit.radius,
    hoverScale: orbit.radius * 1.18,
  };
  const glowColor = new THREE.Color(category.color).lerp(new THREE.Color(0xffffff), 0.28);
  // Categories: keep a subtle inner glow, but hover uses the same outline cage.
  const glow = addGlowShell(mesh, glowColor, { includeInner: true, baseInner: 0.07, baseOuter: 0.0 });
  const hoverCage = addHoverCage(mesh, glowColor, { baseOpacity: 0 });
  group.add(mesh);

  const { enableHalo = true } = orbit;
  let halo = null;
  if (enableHalo) {
    const haloMaterial = new THREE.SpriteMaterial({
      map: getHaloTexture(),
      color: new THREE.Color(category.color),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.0,
    });
    halo = new THREE.Sprite(haloMaterial);
    halo.scale.setScalar(orbit.radius * 3.2);
    group.add(halo);
  }

  group.userData.mesh = mesh;
  group.userData.glowMesh = glow.inner;
  group.userData.outerGlowMesh = glow.outer;
  group.userData.glowBaseOpacity = glow.baseInner;
  group.userData.outerGlowBaseOpacity = glow.baseOuter;
  group.userData.hoverCage = hoverCage;
  group.userData.hoverCageBaseOpacity = hoverCage.material.opacity;
  group.userData.halo = halo;
  group.userData.orbit = orbit;
  group.userData.theta = orbit.startAngle;

  positionPlanet(group, orbit.startAngle);
  return group;
}

export function updatePlanet(planetGroup, deltaSeconds) {
  const orbit = planetGroup.userData.orbit;
  planetGroup.userData.theta += orbit.speed * deltaSeconds;
  positionPlanet(planetGroup, planetGroup.userData.theta);

  // Slow self-rotation makes the sphere feel alive.
  const mesh = planetGroup.userData.mesh;
  mesh.rotation.y += deltaSeconds * orbit.spin;

  // Smoothly relax hover scale/glow back toward the resting state.
  const target = planetGroup.userData.hoverTarget ?? mesh.userData.baseScale;
  const current = mesh.scale.x;
  const next = THREE.MathUtils.lerp(current, target, Math.min(1, deltaSeconds * 8));
  mesh.scale.setScalar(next);

  const haloTarget = planetGroup.userData.haloTarget ?? 0;
  const halo = planetGroup.userData.halo;
  if (halo) {
    halo.material.opacity = THREE.MathUtils.lerp(
      halo.material.opacity,
      haloTarget,
      Math.min(1, deltaSeconds * 6),
    );
  }

  const glowBoost = planetGroup.userData.glowBoost ?? 0;
  const gm = planetGroup.userData.glowMesh;
  const og = planetGroup.userData.outerGlowMesh;
  const baseG = planetGroup.userData.glowBaseOpacity ?? 0.22;
  const baseO = planetGroup.userData.outerGlowBaseOpacity ?? 0.06;
  if (gm?.material) {
    gm.material.opacity = THREE.MathUtils.lerp(
      gm.material.opacity,
      baseG + glowBoost * 0.55,
      Math.min(1, deltaSeconds * 8),
    );
  }
  if (og?.material) {
    og.material.opacity = THREE.MathUtils.lerp(
      og.material.opacity,
      baseO + glowBoost * 0.75,
      Math.min(1, deltaSeconds * 8),
    );
  }

  const cage = planetGroup.userData.hoverCage;
  const cageBase = planetGroup.userData.hoverCageBaseOpacity ?? 0;
  if (cage?.material) {
    cage.material.opacity = THREE.MathUtils.lerp(
      cage.material.opacity,
      cageBase + glowBoost * 0.35,
      Math.min(1, deltaSeconds * 10),
    );
  }
}

export function setPlanetHover(planetGroup, isHovered) {
  const mesh = planetGroup.userData.mesh;
  planetGroup.userData.hoverTarget = isHovered
    ? mesh.userData.hoverScale
    : mesh.userData.baseScale;
  planetGroup.userData.haloTarget = isHovered ? 0.55 : 0.0;
  planetGroup.userData.glowBoost = isHovered ? 1 : 0;
}

function positionPlanet(planetGroup, theta) {
  const orbit = planetGroup.userData.orbit;
  const x = Math.cos(theta) * orbit.distance;
  const z = Math.sin(theta) * orbit.distance;
  const y = Math.sin(theta * 1.4 + orbit.tilt) * orbit.bob;
  planetGroup.position.set(x, y, z);
}

let cachedHalo = null;
function getHaloTexture() {
  if (cachedHalo) return cachedHalo;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,0.9)");
  gradient.addColorStop(0.4, "rgba(255,255,255,0.2)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  cachedHalo = new THREE.CanvasTexture(canvas);
  cachedHalo.colorSpace = THREE.SRGBColorSpace;
  return cachedHalo;
}

function addGlowShell(
  mesh,
  glowColor,
  {
    includeInner = true,
    baseInner = 0.06,
    baseOuter = 0.025,
    innerScale = 1.12,
    outerScale = 1.2,
  } = {},
) {
  let inner = null;
  if (includeInner) {
    const innerMat = new THREE.MeshBasicMaterial({
      color: glowColor,
      transparent: true,
      opacity: baseInner,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
    });
    inner = new THREE.Mesh(PLANET_GEOMETRY, innerMat);
    inner.scale.setScalar(innerScale);
    inner.renderOrder = -1;
    mesh.add(inner);
  }

  const outerMat = new THREE.MeshBasicMaterial({
    color: glowColor,
    transparent: true,
    opacity: baseOuter,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
  });
  const outer = new THREE.Mesh(PLANET_GEOMETRY, outerMat);
  outer.scale.setScalar(outerScale);
  outer.renderOrder = -2;
  mesh.add(outer);

  return { inner, outer, baseInner, baseOuter };
}

function addHoverCage(mesh, glowColor, { baseOpacity = 0 } = {}) {
  const mat = new THREE.LineBasicMaterial({
    color: glowColor,
    transparent: true,
    opacity: baseOpacity,
    blending: THREE.AdditiveBlending,
  });
  const cage = new THREE.LineSegments(HOVER_CAGE_GEOMETRY, mat);
  cage.scale.setScalar(1.26);
  cage.renderOrder = 6;
  mesh.add(cage);
  return cage;
}
