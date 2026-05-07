import * as THREE from "three";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import WebGPURenderer from "three/addons/renderers/webgpu/WebGPURenderer.js";

export function createScene({ canvas, labelsEl }) {
  const preferWebGPU = Boolean(navigator.gpu);
  const renderer = preferWebGPU
    ? new WebGPURenderer({ canvas, antialias: true, alpha: false })
    : new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.setClearColor(0x04060d, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // WebGPU needs explicit async initialization in Three.js.
  // If it's not supported or init fails, we fall back to WebGL.
  let initPromise = null;
  if (preferWebGPU && typeof renderer.init === "function") {
    initPromise = renderer.init().catch(() => null);
  }

  const labelRenderer = new CSS2DRenderer({ element: labelsEl });
  labelRenderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    52,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
  );
  camera.position.set(0, 14, 56);
  camera.lookAt(0, 0, 0);

  // Soft ambient + slight rim from above so planets aren't fully black on the
  // dark side. The actual sun light is added by each solar system.
  const ambient = new THREE.AmbientLight(0xb8c8ff, 0.32);
  scene.add(ambient);

  const rim = new THREE.DirectionalLight(0xffffff, 0.18);
  rim.position.set(20, 30, 20);
  scene.add(rim);

  return {
    renderer,
    labelRenderer,
    scene,
    camera,
    decor: {},
    capabilities: { preferWebGPU },
    initPromise,
  };
}

export function handleResize({ renderer, labelRenderer, camera }) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);
  labelRenderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
