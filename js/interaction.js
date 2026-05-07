import * as THREE from "three";
import { setPlanetHover } from "./planet.js";

// Sets up pointer-based interaction over the Three.js canvas. The raycaster is
// updated on every frame against the planets of the currently active system.
export function createInteractionController({
  canvas,
  camera,
  getActiveSystem,
  onPointerMove,
  onHover,
  onSelect,
}) {
  const pointer = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  let hoveredPlanet = null;
  let lastClientX = 0;
  let lastClientY = 0;
  let pressedAt = 0;
  let pressX = 0;
  let pressY = 0;

  function updatePointer(event) {
    const rect = canvas.getBoundingClientRect();
    lastClientX = event.clientX;
    lastClientY = event.clientY;
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function onMove(event) {
    updatePointer(event);
    onPointerMove?.({ clientX: event.clientX, clientY: event.clientY });
  }

  function onLeave() {
    pointer.set(-2, -2);
    if (hoveredPlanet) {
      setPlanetHover(hoveredPlanet, false);
      hoveredPlanet = null;
      onHover?.(null);
      canvas.classList.remove("is-pointer");
    }
  }

  function onPointerDown(event) {
    pressedAt = performance.now();
    pressX = event.clientX;
    pressY = event.clientY;
  }

  function onPointerUp(event) {
    const dx = Math.abs(event.clientX - pressX);
    const dy = Math.abs(event.clientY - pressY);
    const dt = performance.now() - pressedAt;
    if (dt < 400 && dx < 6 && dy < 6 && hoveredPlanet) {
      const kind = hoveredPlanet.userData.kind;
      if (kind === "planet") {
        onSelect?.({ kind: "project", project: hoveredPlanet.userData.project });
      } else if (kind === "category") {
        onSelect?.({
          kind: "category",
          categoryId: hoveredPlanet.userData.categoryId,
          category: hoveredPlanet.userData.category,
        });
      }
    }
  }

  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);

  function tick() {
    const system = getActiveSystem();
    if (!system) {
      if (hoveredPlanet) {
        setPlanetHover(hoveredPlanet, false);
        hoveredPlanet = null;
        onHover?.(null);
        canvas.classList.remove("is-pointer");
      }
      return;
    }

    raycaster.setFromCamera(pointer, camera);
    const meshes = (system.userData.planets ?? [])
      .map((p) => p.userData.mesh)
      .filter(Boolean);
    const hits = raycaster.intersectObjects(meshes, false);

    let nextHover = null;
    if (hits.length > 0) {
      // Walk up to the planet group so that hover state lives on the group.
      let obj = hits[0].object;
      while (obj && !obj.userData?.mesh && obj.parent) obj = obj.parent;
      if (obj?.userData?.mesh && (obj.userData.kind === "planet" || obj.userData.kind === "category")) {
        nextHover = obj;
      }
    }

    if (nextHover !== hoveredPlanet) {
      if (hoveredPlanet) setPlanetHover(hoveredPlanet, false);
      if (nextHover) setPlanetHover(nextHover, true);
      hoveredPlanet = nextHover;
      onHover?.(nextHover ? buildHoverPayload(nextHover, lastClientX, lastClientY) : null);
      canvas.classList.toggle("is-pointer", Boolean(nextHover));
    } else if (nextHover) {
      // Refresh tooltip position while hovering.
      onHover?.(buildHoverPayload(nextHover, lastClientX, lastClientY));
    }
  }

  function dispose() {
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerleave", onLeave);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointerup", onPointerUp);
  }

  return { tick, dispose };
}

function buildHoverPayload(obj, clientX, clientY) {
  const kind = obj.userData.kind;
  if (kind === "planet") {
    return {
      kind: "project",
      project: obj.userData.project,
      clientX,
      clientY,
    };
  }
  if (kind === "category") {
    return {
      kind: "category",
      category: obj.userData.category,
      categoryId: obj.userData.categoryId,
      clientX,
      clientY,
    };
  }
  return null;
}
