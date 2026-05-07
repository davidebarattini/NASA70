import * as THREE from "three";

// Lightweight galaxy look inspired by the reference:
// - spiral distribution
// - additive blending
// - subtle rotation + pointer drag pan/tilt
//
// Works with both WebGLRenderer and WebGPURenderer in Three.js.

export function createGalaxy({
  starCount = 60000,
  radius = 140,
  height = 16,
  branches = 4,
  spin = 1.15,
  randomness = 0.35,
  materialMode = "auto", // "auto" | "shader" | "points"
  isWebGPU = false,
} = {}) {
  const group = new THREE.Group();
  group.name = "galaxy";

  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(starCount * 3);
  const colors = new Float32Array(starCount * 3);
  const sizes = new Float32Array(starCount);

  const innerColor = new THREE.Color("#ffffff");
  const midColor = new THREE.Color("#8fb6ff");
  const outerColor = new THREE.Color("#ff7a4a");

  for (let i = 0; i < starCount; i += 1) {
    const r = Math.random() ** 1.7 * radius;
    const branch = i % branches;
    const branchAngle = (branch / branches) * Math.PI * 2;
    const spinAngle = r * 0.03 * spin;

    const randomX = (Math.random() - 0.5) * randomness * r;
    const randomY = (Math.random() - 0.5) * (height * (1 - r / radius));
    const randomZ = (Math.random() - 0.5) * randomness * r;

    const angle = branchAngle + spinAngle;
    const x = Math.cos(angle) * r + randomX;
    const y = randomY;
    const z = Math.sin(angle) * r + randomZ;

    positions[i * 3 + 0] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    const t = r / radius;
    const c = innerColor.clone()
      .lerp(midColor, Math.min(1, t * 1.2))
      .lerp(outerColor, Math.max(0, t - 0.25));
    colors[i * 3 + 0] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;

    sizes[i] = 0.6 + Math.random() * 1.4;
  }

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));

  const chosenMode =
    materialMode === "auto"
      ? (isWebGPU ? "points" : "shader")
      : materialMode;

  // WebGPU renderer doesn't support ShaderMaterial; use PointsMaterial there.
  let material;
  if (chosenMode === "points") {
    material = new THREE.PointsMaterial({
      size: 1.6,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    // aSize is ignored in this mode.
  } else {
    // Custom shader so we can vary point size per-star without spritesheets.
    material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      uniforms: {
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uSize: { value: 2.2 },
        uTime: { value: 0 },
      },
      vertexShader: `
        attribute float aSize;
        varying vec3 vColor;
        uniform float uPixelRatio;
        uniform float uSize;
        uniform float uTime;

        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          float flicker = 0.7 + 0.3 * sin(uTime * 1.2 + position.x * 0.03 + position.z * 0.02);
          gl_PointSize = (uSize * aSize * uPixelRatio * flicker) * (1.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          float alpha = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vColor, alpha);
        }
      `,
    });
  }

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -20;
  group.add(points);

  group.userData.points = points;
  group.userData.material = material;
  group.userData.drag = { isDown: false, lastX: 0, lastY: 0, rotX: 0, rotY: 0 };

  return group;
}

export function updateGalaxy(galaxyGroup, deltaSeconds, nowSeconds) {
  if (!galaxyGroup) return;
  const material = galaxyGroup.userData.material;
  if (material?.uniforms?.uTime) material.uniforms.uTime.value = nowSeconds;
  // Local slow drift for life (world group handles drag rotation).
  galaxyGroup.rotation.y += deltaSeconds * 0.03;
}

export function bindGalaxyDrag({ galaxyGroup, canvas, targetGroup = galaxyGroup }) {
  const drag = (targetGroup.userData.drag ??= { isDown: false, lastX: 0, lastY: 0, rotX: 0, rotY: 0 });

  function down(e) {
    drag.isDown = true;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    canvas.classList.add("is-grabbing");
  }
  function up() {
    drag.isDown = false;
    canvas.classList.remove("is-grabbing");
  }
  function move(e) {
    if (!drag.isDown) return;
    const dx = e.clientX - drag.lastX;
    const dy = e.clientY - drag.lastY;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    drag.rotY += dx * 0.0008;
    drag.rotX += dy * 0.0008;
    drag.rotX = THREE.MathUtils.clamp(drag.rotX, -0.35, 0.35);
  }

  canvas.addEventListener("pointerdown", down);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointermove", move);

  return () => {
    canvas.removeEventListener("pointerdown", down);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointermove", move);
  };
}

export function applyDragRotation(targetGroup, deltaSeconds) {
  if (!targetGroup) return;
  const drag = targetGroup.userData?.drag;
  if (!drag) return;
  targetGroup.rotation.x = THREE.MathUtils.lerp(targetGroup.rotation.x, drag.rotX, deltaSeconds * 4);
  targetGroup.rotation.z = THREE.MathUtils.lerp(targetGroup.rotation.z, drag.rotY, deltaSeconds * 4);
}

