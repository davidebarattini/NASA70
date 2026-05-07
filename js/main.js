import * as THREE from "three";
import { fetchProjects, groupByCategory } from "./data.js";
import { createScene, handleResize } from "./scene.js";
import {
  createSolarSystem,
  hideSystem,
  showSystem,
  tickSystemFade,
  updateSolarSystem,
} from "./solarSystem.js";
import { createInteractionController } from "./interaction.js";
import { createUIController } from "./ui.js";
import { applyHomeLayout, createMainSystem, updateMainSystem } from "./mainSystem.js";
import { applyDragRotation, bindGalaxyDrag, createGalaxy, updateGalaxy } from "./galaxy.js";
import { createHomePanel } from "./homePanel.js";

const canvas = document.getElementById("scene");
const labelsEl = document.getElementById("labels");
const loaderEl = document.getElementById("loader");
const errorEl = document.getElementById("errorBanner");
const errorTextEl = document.getElementById("errorText");
const retryButton = document.getElementById("retryButton");

let renderer;
let labelRenderer;
let scene;
let camera;
let world = null;
let systems = [];
let mainSystem = null;
let galaxy = null;
let unbindGalaxyDrag = null;
let activeSystem = null;
let interaction = null;
let ui = null;
let homePanel = null;
let allProjects = [];
let categoryById = new Map();
let lastFrame = performance.now();
let cameraTarget = new THREE.Vector3(0, 0, 0);
let cameraDesired = new THREE.Vector3(0, 14, 56);
let cameraBase = new THREE.Vector3(0, 14, 56);
let zoomOffset = 0;
const ZOOM_LIMITS = { min: -35, max: 120 };
let abortController = null;
let sceneInitPromise = null;

function showLoader(visible) {
  loaderEl.classList.toggle("is-hidden", !visible);
}

function showError(visible) {
  errorEl.hidden = !visible;
}

function setErrorText(text) {
  if (!errorTextEl) return;
  if (text === undefined || text === null) {
    errorTextEl.textContent = "Impossibile caricare i progetti.";
    return;
  }
  errorTextEl.textContent = String(text);
}

async function bootstrap() {
  showLoader(true);
  showError(false);
  setErrorText(null);
  abortController?.abort();
  abortController = new AbortController();

  try {
    setupScene();
    if (sceneInitPromise) {
      // Await WebGPU init (or no-op on WebGL). If init fails, we still proceed
      // and rely on the renderer fallback logic.
      await sceneInitPromise;
    }

    const projects = await fetchProjects({ signal: abortController.signal });
    allProjects = projects;
    const grouped = groupByCategory(projects);
    if (grouped.length === 0) {
      throw new Error("Nessun progetto disponibile");
    }

    buildSystems(grouped);
    setupHomePanel(grouped);
    setupUI(grouped);
    setupInteraction();
    if (ui.getInitialMode() === "category") {
      enterCategory(ui.getActiveCategoryIndex(), { instant: true });
    } else {
      backToMain({ instant: true });
    }
    startRenderLoop();
    showLoader(false);
  } catch (err) {
    if (err?.name === "AbortError") return;
    console.error("[NASA70] bootstrap failed:", err);
    showLoader(false);
    setErrorText(err?.message || "Impossibile caricare i progetti.");
    showError(true);
  }
}

function setupScene() {
  if (renderer) return;
  const created = createScene({ canvas, labelsEl });
  renderer = created.renderer;
  labelRenderer = created.labelRenderer;
  scene = created.scene;
  camera = created.camera;
  sceneInitPromise = created.initPromise ?? null;

  world = new THREE.Group();
  world.name = "world";
  scene.add(world);

  window.addEventListener("resize", () => {
    handleResize({ renderer, labelRenderer, camera });
  });

  // Zoom with trackpad / mouse wheel.
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const delta = event.deltaY;
      // Trackpads usually emit small deltas; mouse wheels bigger jumps.
      const step = Math.abs(delta) < 50 ? 0.06 : 0.02;
      zoomOffset = clamp(zoomOffset + delta * step, ZOOM_LIMITS.min, ZOOM_LIMITS.max);
      applyCameraBase(cameraBase);
    },
    { passive: false },
  );
}

function buildSystems(grouped) {
  // Tear down anything from a previous bootstrap (e.g. after retry).
  for (const s of systems) world.remove(s.group);
  if (mainSystem) world.remove(mainSystem);
  if (galaxy) world.remove(galaxy);

  const isWebGPU = Boolean(renderer?.isWebGPURenderer);

  systems = grouped.map(({ category, projects }) => {
    const group = createSolarSystem({ category, projects, isWebGPU });
    world.add(group);
    return { category, projects, group };
  });

  const categories = systems.map((s) => s.category);
  categoryById = new Map(categories.map((c) => [c.id, c]));

  mainSystem = createMainSystem({ categories, isWebGPU });
  world.add(mainSystem);

  galaxy = createGalaxy({
    starCount: 90000,
    isWebGPU,
  });
  // Centered placement: galaxy aligned with the solar systems.
  galaxy.visible = true;
  galaxy.position.set(0, 0, 0);
  galaxy.rotation.set(0.08, -0.18, 0.02);
  galaxy.scale.setScalar(1.55);
  setGalaxyOpacity(0.55);
  world.add(galaxy);

  unbindGalaxyDrag?.();
  unbindGalaxyDrag = bindGalaxyDrag({ galaxyGroup: galaxy, targetGroup: world, canvas });
}

function setupHomePanel(grouped) {
  const categories = grouped.map((g) => g.category);
  const initialState = {
    mode: "categories",
    ringCount: 3,
    planetScale: 1,
    selectedCategoryIds: categories.map((c) => c.id),
    collapsed: false,
  };

  homePanel = createHomePanel({
    categories,
    initialState,
    onChange: (state) => {
      applyHomeLayout(mainSystem, {
        mode: state.mode,
        categories,
        projects: allProjects,
        selectedCategoryIds: state.selectedCategoryIds,
        ringCount: state.ringCount,
        planetScale: state.planetScale,
        categoryById,
      });
    },
  });

  // First paint.
  const s = homePanel.getState();
  applyHomeLayout(mainSystem, {
    mode: s.mode,
    categories,
    projects: allProjects,
    selectedCategoryIds: s.selectedCategoryIds,
    ringCount: s.ringCount,
    planetScale: s.planetScale,
    categoryById,
  });
}

function setupUI(grouped) {
  ui = createUIController({
    systems: grouped,
    onEnterCategory: (idx) => {
      enterCategory(idx);
    },
    onBackToMain: () => {
      backToMain();
    },
    onClose: () => {},
  });
  ui.init();
}

function setupInteraction() {
  interaction = createInteractionController({
    canvas,
    camera,
    getActiveSystem: () => activeSystem,
    onHover: (payload) => ui.showTooltip(payload),
    onSelect: (payload) => {
      if (!payload) return;
      if (payload.kind === "category") {
        const idx = systems.findIndex((s) => s.category.id === payload.categoryId);
        if (idx >= 0) {
          ui.enterCategory(idx);
          enterCategory(idx);
        }
      } else if (payload.kind === "project") {
        ui.openInfoCard(payload.project);
      }
    },
  });
}

function hideActive({ instant } = {}) {
  if (activeSystem) hideSystem(activeSystem, { instant });
}

function backToMain({ instant = false } = {}) {
  hideActive({ instant });
  activeSystem = mainSystem;
  showSystem(activeSystem, { instant });
  setGalaxyOpacity(0.55);
  setCameraBase(new THREE.Vector3(0, 16, 70));
  cameraTarget.set(0, 0, 0);
}

function enterCategory(index, { instant = false } = {}) {
  if (!systems[index]) return;
  hideActive({ instant });
  activeSystem = systems[index].group;
  showSystem(activeSystem, { instant });
  // Keep galaxy as background but dim it inside categories.
  setGalaxyOpacity(0.22);

  const planetCount = systems[index].projects.length;
  const distance = 46 + Math.sqrt(planetCount) * 5.5;
  setCameraBase(new THREE.Vector3(0, 14 + Math.min(planetCount, 26) * 0.18, distance));
  cameraTarget.set(0, 0, 0);
}

function setGalaxyOpacity(opacity) {
  if (!galaxy) return;
  const material = galaxy.userData?.material;
  if (material && "opacity" in material) {
    material.opacity = opacity;
    material.needsUpdate = true;
  }
}

function setCameraBase(vec3) {
  cameraBase.copy(vec3);
  // Reset zoom when switching context so it doesn't surprise you.
  zoomOffset = clamp(zoomOffset, ZOOM_LIMITS.min, ZOOM_LIMITS.max);
  applyCameraBase(cameraBase);
}

function applyCameraBase(base) {
  // Zoom moves camera along Z (and a little Y to keep composition).
  const z = Math.max(8, base.z + zoomOffset);
  const y = base.y + zoomOffset * 0.12;
  cameraDesired.set(base.x, y, z);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function startRenderLoop() {
  lastFrame = performance.now();
  requestAnimationFrame(loop);
}

function loop(now) {
  const deltaSeconds = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  const nowSeconds = now / 1000;

  // Smoothly drift the camera toward the desired pose.
  camera.position.lerp(cameraDesired, Math.min(1, deltaSeconds * 2));
  camera.lookAt(cameraTarget);

  if (world) applyDragRotation(world, deltaSeconds);
  if (mainSystem?.visible) updateMainSystem(mainSystem, deltaSeconds);
  tickSystemFade(mainSystem);
  if (galaxy?.visible) updateGalaxy(galaxy, deltaSeconds, nowSeconds);

  for (const sys of systems) {
    if (sys.group.visible) updateSolarSystem(sys.group, deltaSeconds);
    tickSystemFade(sys.group);
  }

  interaction?.tick();
  // WebGPURenderer uses an async render path internally; calling it like this is fine.
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);

  requestAnimationFrame(loop);
}

retryButton.addEventListener("click", bootstrap);

bootstrap();
