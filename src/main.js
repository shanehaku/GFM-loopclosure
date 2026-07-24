import * as THREE from "three";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";

const viewer = document.getElementById("viewer");
const statusEl = document.getElementById("status");
const groupSwitchEl = document.getElementById("groupSwitch");
const layerListEl = document.getElementById("layerList");
const pageTitleEl = document.getElementById("pageTitle");
const pageHintEl = document.getElementById("pageHint");
const sceneNotesEl = document.getElementById("sceneNotes");
const originalFrameColorbarEl = document.getElementById("originalFrameColorbar");

const loader = new PLYLoader();
const layers = new Map();
const views = new Map();
const layersByGroup = new Map();
const loadedGroups = new Set();
const loadingGroups = new Map();

let activeGroup = null;
let globalPointSize = 0.006;
let globalLinePointSize = 0.04;
let groupOrder = [];
let groupLabels = {};
let groupSections = [];
let activeSection = null;
let syncedCameraGroups = new Set();

const DEFAULT_POINT_SIZE = 0.008;
const DEFAULT_LINE_POINT_SIZE = 0.015;

const syncedCameraState = {
  ready: false,
  position: new THREE.Vector3(),
  up: new THREE.Vector3(),
  target: new THREE.Vector3(),
  fov: 60,
  near: 0.00001,
  far: 100000,
  zoom: 1
};

const viewport = document.createElement("section");
viewport.className = "viewport";
viewer.appendChild(viewport);

const viewportTitle = document.createElement("div");
viewportTitle.className = "viewportTitle";
viewport.appendChild(viewportTitle);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
viewport.appendChild(renderer.domElement);
renderer.domElement.addEventListener("wheel", zoomActiveView, { passive: false });
renderer.domElement.addEventListener("contextmenu", (event) => event.preventDefault());
renderer.domElement.addEventListener("pointerdown", startRightPan, true);
renderer.domElement.addEventListener("pointermove", moveRightPan, true);
renderer.domElement.addEventListener("pointerup", endRightPan, true);
renderer.domElement.addEventListener("pointercancel", endRightPan, true);

const rightPan = {
  active: false,
  pointerId: null,
  x: 0,
  y: 0
};

function makeMaterial(layer) {
  const mat = new THREE.PointsMaterial({
    size: effectivePointSize(layer),
    sizeAttenuation: true,
    vertexColors: true
  });

  if (layer.color) {
    mat.vertexColors = false;
    mat.color = new THREE.Color(layer.color);
  }
  return mat;
}

function pointSizeScale(layer) {
  const base = isLineLayer(layer) ? DEFAULT_LINE_POINT_SIZE : DEFAULT_POINT_SIZE;
  return Number.isFinite(layer.pointSize) ? layer.pointSize / base : 1;
}

function effectivePointSize(layer) {
  const base = isLineLayer(layer) ? globalLinePointSize : globalPointSize;
  return base * pointSizeScale(layer);
}

function isLineLayer(layer) {
  if (layer.kind === "line") return true;
  const text = `${layer.id ?? ""} ${layer.label ?? ""} ${layer.path ?? ""}`.toLowerCase();
  return text.includes("line") || text.includes("match");
}

function updateMaterialPointSizes() {
  for (const { layer, material } of layers.values()) {
    material.size = effectivePointSize(layer);
    material.needsUpdate = true;
  }
}

function makeView(groupName) {
  if (views.has(groupName)) return views.get(groupName);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111111);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.00001, 100000);
  camera.position.set(0, -2, 1);

  const controls = new TrackballControls(camera, renderer.domElement);
  controls.enabled = false;
  controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
  controls.mouseButtons.MIDDLE = -1;
  controls.mouseButtons.RIGHT = -1;
  controls.noZoom = true;
  controls.noPan = true;
  controls.staticMoving = true;
  controls.dynamicDampingFactor = 0;
  controls.rotateSpeed = 2.2;
  controls.zoomSpeed = 0.75;
  controls.panSpeed = 0.8;
  controls.minDistance = 0.000001;
  controls.maxDistance = Infinity;
  controls.addEventListener("change", () => syncCameraFromView(groupName));

  const light = new THREE.DirectionalLight(0xffffff, 1.0);
  light.position.set(1, -1, 2);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  scene.add(new THREE.AxesHelper(0.5));

  const group = new THREE.Group();
  group.name = groupName;
  scene.add(group);

  const view = { groupName, scene, camera, controls, group, cameraReady: false };
  views.set(groupName, view);
  return view;
}

function resizeActiveView() {
  const w = Math.max(1, viewport.clientWidth);
  const h = Math.max(1, viewport.clientHeight);
  renderer.setSize(w, h, false);

  const view = getActiveView();
  if (!view) return;
  view.camera.aspect = w / h;
  view.camera.updateProjectionMatrix();
  if (typeof view.controls.handleResize === "function") view.controls.handleResize();
}
window.addEventListener("resize", resizeActiveView);

function getActiveView() {
  return activeGroup ? views.get(activeGroup) : null;
}

function startRightPan(event) {
  if (event.button !== 2 || !getActiveView()) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  rightPan.active = true;
  rightPan.pointerId = event.pointerId;
  rightPan.x = event.clientX;
  rightPan.y = event.clientY;
  renderer.domElement.setPointerCapture(event.pointerId);
}

function moveRightPan(event) {
  if (!rightPan.active || event.pointerId !== rightPan.pointerId) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  const view = getActiveView();
  if (!view) return;

  const dx = event.clientX - rightPan.x;
  const dy = event.clientY - rightPan.y;
  rightPan.x = event.clientX;
  rightPan.y = event.clientY;

  const distance = view.camera.position.distanceTo(view.controls.target);
  const visibleHeight = 2 * distance * Math.tan(THREE.MathUtils.degToRad(view.camera.fov * 0.5));
  const unitsPerPixel = visibleHeight / Math.max(1, renderer.domElement.clientHeight);
  const right = new THREE.Vector3().setFromMatrixColumn(view.camera.matrix, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(view.camera.matrix, 1);
  const pan = right
    .multiplyScalar(-dx * unitsPerPixel * view.controls.panSpeed)
    .add(up.multiplyScalar(dy * unitsPerPixel * view.controls.panSpeed));

  view.camera.position.add(pan);
  view.controls.target.add(pan);
  view.camera.lookAt(view.controls.target);
  view.camera.updateMatrixWorld();
  view.cameraReady = true;
  syncCameraFromView(view.groupName);
}

function endRightPan(event) {
  if (!rightPan.active || event.pointerId !== rightPan.pointerId) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  renderer.domElement.releasePointerCapture(event.pointerId);
  rightPan.active = false;
  rightPan.pointerId = null;
}

function zoomActiveView(event) {
  const view = getActiveView();
  if (!view) return;

  event.preventDefault();
  const deltaScale = event.deltaMode === 1 ? 0.03 : event.deltaMode === 2 ? 0.6 : 0.0015;
  const factor = Math.exp(event.deltaY * deltaScale);
  const eye = view.camera.position.clone().sub(view.controls.target);
  const distance = THREE.MathUtils.clamp(
    eye.length() * factor,
    view.controls.minDistance,
    view.controls.maxDistance
  );

  view.camera.position.copy(view.controls.target).add(eye.setLength(distance));
  view.camera.updateProjectionMatrix();
  view.controls.update();
  view.cameraReady = true;
  syncCameraFromView(view.groupName);
}

function syncCameraFromView(groupName) {
  if (!syncedCameraGroups.has(groupName)) return;

  const view = views.get(groupName);
  if (!view || !view.cameraReady) return;

  syncedCameraState.position.copy(view.camera.position);
  syncedCameraState.up.copy(view.camera.up);
  syncedCameraState.target.copy(view.controls.target);
  syncedCameraState.fov = view.camera.fov;
  syncedCameraState.near = view.camera.near;
  syncedCameraState.far = view.camera.far;
  syncedCameraState.zoom = view.camera.zoom;
  syncedCameraState.ready = true;
}

function applySyncedCameraToView(view) {
  if (!syncedCameraGroups.has(view.groupName) || !syncedCameraState.ready) return;

  view.camera.position.copy(syncedCameraState.position);
  view.camera.up.copy(syncedCameraState.up);
  view.camera.fov = syncedCameraState.fov;
  view.camera.near = syncedCameraState.near;
  view.camera.far = syncedCameraState.far;
  view.camera.zoom = syncedCameraState.zoom;
  view.controls.target.copy(syncedCameraState.target);
  view.camera.updateProjectionMatrix();
  view.controls.update();
  view.cameraReady = true;
}

function setActiveSection(sectionId) {
  activeSection = sectionId;

  groupSwitchEl.querySelectorAll("button[data-section]").forEach((button) => {
    const active = button.dataset.section === sectionId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  groupSwitchEl.querySelectorAll(".groupSwitchSection").forEach((section) => {
    section.hidden = section.dataset.section !== sectionId;
  });
}

async function setActiveGroup(groupName) {
  if (!views.has(groupName)) return;
  activeGroup = groupName;
  viewportTitle.textContent = groupLabels[groupName] ?? groupName;

  for (const view of views.values()) view.controls.enabled = false;
  const view = views.get(groupName);
  applySyncedCameraToView(view);
  view.controls.enabled = true;
  if (!view.cameraReady) resetCamera(view);

  groupSwitchEl.querySelectorAll("button[data-group]").forEach((button) => {
    const active = button.dataset.group === groupName;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  layerListEl.querySelectorAll(".group").forEach((group) => {
    group.hidden = group.dataset.group !== groupName;
  });

  resizeActiveView();
  await ensureGroupLoaded(groupName);
  if (activeGroup !== groupName) return;

  applySyncedCameraToView(view);
  view.controls.enabled = true;
  if (!view.cameraReady) resetCamera(view);
  resizeActiveView();
}

async function loadLayer(layer) {
  return new Promise((resolve, reject) => {
    loader.load(
      layer.path,
      (geometry) => {
        geometry.computeBoundingBox();

        const mat = makeMaterial(layer);
        const points = new THREE.Points(geometry, mat);
        points.name = layer.id;
        const checkbox = layerListEl.querySelector(`input[data-layer="${CSS.escape(layer.id)}"]`);
        points.visible = checkbox ? checkbox.checked : layer.visible ?? true;

        const view = makeView(layer.group);
        view.group.add(points);
        view.cameraReady = false;

        layers.set(layer.id, { layer, object: points, material: mat, view });
        resolve(points);
      },
      undefined,
      (err) => reject(err)
    );
  });
}

async function ensureGroupLoaded(groupName) {
  if (loadedGroups.has(groupName)) return;
  if (loadingGroups.has(groupName)) return loadingGroups.get(groupName);

  const groupLayers = layersByGroup.get(groupName) ?? [];
  const promise = (async () => {
    let loaded = 0;
    statusEl.textContent = `Loading ${groupLabels[groupName] ?? groupName} (${groupLayers.length} layers)...`;

    for (const layer of groupLayers) {
      if (layers.has(layer.id)) {
        loaded += 1;
        continue;
      }

      try {
        await loadLayer(layer);
        loaded += 1;
        statusEl.textContent = `Loaded ${loaded}/${groupLayers.length}: ${layer.label}`;
      } catch (err) {
        console.error(err);
        statusEl.textContent += `\nFAILED: ${layer.label} (${layer.path})`;
      }
    }

    loadedGroups.add(groupName);
    resetCamera(views.get(groupName));
    statusEl.textContent += `\nDone: ${groupLabels[groupName] ?? groupName}.`;
  })();

  loadingGroups.set(groupName, promise);
  try {
    await promise;
  } finally {
    loadingGroups.delete(groupName);
  }
}

function applyManifestText(manifest) {
  if (manifest.title) {
    document.title = manifest.title;
    if (pageTitleEl) pageTitleEl.textContent = manifest.title;
  }
  if (manifest.description && pageHintEl) pageHintEl.textContent = manifest.description;
  if (sceneNotesEl && Array.isArray(manifest.notes)) {
    sceneNotesEl.innerHTML = [
      "<strong>Notes</strong>",
      ...manifest.notes.map((note) => `<p>${escapeHtml(note)}</p>`)
    ].join("");
    sceneNotesEl.hidden = manifest.notes.length === 0;
  }
}

function createControls(manifest) {
  groupSwitchEl.innerHTML = "";
  layerListEl.innerHTML = "";
  const requestedSection = new URLSearchParams(window.location.search).get("section");

  const byGroup = {};
  for (const layer of manifest.layers) {
    byGroup[layer.group] ??= [];
    byGroup[layer.group].push(layer);
  }
  layersByGroup.clear();

  const requestedSectionConfig = groupSections.find((section) => {
    return section.title.toLowerCase() === (requestedSection ?? "").toLowerCase();
  });
  const originalOnly = requestedSectionConfig?.title === "Original";
  layerListEl.hidden = originalOnly;
  if (originalFrameColorbarEl) originalFrameColorbarEl.hidden = !originalOnly;

  const allOrderedGroups = [
    ...groupOrder.filter((name) => byGroup[name]),
    ...Object.keys(byGroup).filter((name) => !groupOrder.includes(name))
  ];
  const orderedGroups = requestedSectionConfig
    ? requestedSectionConfig.groups.filter((name) => byGroup[name])
    : allOrderedGroups;

  const sectionByGroup = new Map();
  const sectionIds = new Map();
  groupSections.forEach((section, index) => {
    const sectionId = `section_${index}`;
    sectionIds.set(section.title, sectionId);
    for (const groupName of section.groups ?? []) sectionByGroup.set(groupName, sectionId);
  });

  for (const section of requestedSectionConfig ? [] : groupSections) {
    const sectionId = sectionIds.get(section.title);
    const sectionButton = document.createElement("button");
    sectionButton.type = "button";
    sectionButton.className = "groupSectionButton";
    sectionButton.dataset.section = sectionId;
    sectionButton.setAttribute("aria-pressed", "false");
    sectionButton.textContent = section.title;
    sectionButton.addEventListener("click", () => {
      setActiveSection(sectionId);
      const firstGroup = section.groups.find((name) => byGroup[name]);
      if (firstGroup) setActiveGroup(firstGroup);
    });
    groupSwitchEl.appendChild(sectionButton);
  }

  const sectionContainers = new Map();

  for (const groupName of orderedGroups) {
    makeView(groupName);
    layersByGroup.set(groupName, byGroup[groupName]);

    const sectionId = requestedSectionConfig ? null : sectionByGroup.get(groupName);
    let switchParent = groupSwitchEl;
    if (sectionId) {
      if (!sectionContainers.has(sectionId)) {
        const section = document.createElement("div");
        section.className = "groupSwitchSection";
        section.dataset.section = sectionId;
        section.hidden = true;
        groupSwitchEl.appendChild(section);
        sectionContainers.set(sectionId, section);
      }
      switchParent = sectionContainers.get(sectionId);
    }

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.group = groupName;
    button.setAttribute("aria-pressed", "false");
    button.textContent = groupLabels[groupName] ?? groupName;
    button.addEventListener("click", () => setActiveGroup(groupName));
    switchParent.appendChild(button);

    const div = document.createElement("div");
    div.className = "group";
    div.dataset.group = groupName;
    div.hidden = true;
    div.innerHTML = `<h2>${escapeHtml(groupLabels[groupName] ?? groupName)}</h2>`;

    for (const layer of byGroup[groupName]) {
      const row = document.createElement("label");
      row.className = "layer";
      row.innerHTML = `
        <input type="checkbox" ${layer.visible === false ? "" : "checked"} data-layer="${escapeHtml(layer.id)}">
        <span>${escapeHtml(layer.label)}<small>${escapeHtml(layer.path)}</small></span>
      `;
      div.appendChild(row);
    }
    layerListEl.appendChild(div);
  }

  layerListEl.querySelectorAll("input[type='checkbox']").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const id = e.target.dataset.layer;
      const rec = layers.get(id);
      if (rec) rec.object.visible = e.target.checked;
    });
  });

  const initialGroup = orderedGroups[0];
  const initialSection = sectionByGroup.get(initialGroup);
  if (initialSection && !requestedSectionConfig) setActiveSection(initialSection);
  setActiveGroup(initialGroup);
}

function resetCamera(view = getActiveView()) {
  if (!view) return;

  const box = new THREE.Box3();
  for (const object of view.group.children) box.expandByObject(object);

  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  if (box.isEmpty()) {
    center.set(0, 0, 0);
    size.set(1, 1, 1);
  } else {
    box.getCenter(center);
    box.getSize(size);
  }

  const radius = Math.max(size.x, size.y, size.z, 1);
  view.controls.target.copy(center);
  view.camera.position.copy(center).add(new THREE.Vector3(0, -radius * 1.6, radius * 0.9));
  view.camera.near = Math.max(radius / 100000, 0.000001);
  view.camera.far = Math.max(radius * 100000, 1000);
  view.camera.updateProjectionMatrix();
  view.controls.update();
  view.cameraReady = true;
  syncCameraFromView(view.groupName);
}

function setActiveLayerVisibility(visible) {
  const view = getActiveView();
  if (!view) return;

  for (const rec of layers.values()) {
    if (rec.view === view) rec.object.visible = visible;
  }
  layerListEl
    .querySelectorAll(`.group[data-group="${view.groupName}"] input[type='checkbox']`)
    .forEach((cb) => cb.checked = visible);
}

async function init() {
  const manifestPath = document.body.dataset.manifest || "./manifest.json";
  const res = await fetch(manifestPath, { cache: "no-store" });
  const manifest = await res.json();

  if (!Array.isArray(manifest.layers)) throw new Error("manifest.layers must be an array");
  groupOrder = manifest.groupOrder ?? [];
  groupLabels = manifest.groupLabels ?? {};
  groupSections = manifest.groupSections ?? [];
  syncedCameraGroups = new Set(manifest.syncedCameraGroups ?? []);
  applyManifestText(manifest);

  statusEl.textContent = `Ready. Select a map to load.`;
  createControls(manifest);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

document.getElementById("showAll").addEventListener("click", () => setActiveLayerVisibility(true));
document.getElementById("hideAll").addEventListener("click", () => setActiveLayerVisibility(false));
document.getElementById("resetCamera").addEventListener("click", () => resetCamera());

document.getElementById("pointSize").addEventListener("input", (e) => {
  globalPointSize = parseFloat(e.target.value);
  document.getElementById("pointSizeValue").textContent = globalPointSize.toFixed(4);
  updateMaterialPointSizes();
});

document.getElementById("lineSize").addEventListener("input", (e) => {
  globalLinePointSize = parseFloat(e.target.value);
  document.getElementById("lineSizeValue").textContent = globalLinePointSize.toFixed(4);
  updateMaterialPointSizes();
});

viewport.addEventListener("dblclick", () => resetCamera());

function animate() {
  const view = getActiveView();
  if (view) {
    view.controls.update();
    renderer.render(view.scene, view.camera);
  }
  requestAnimationFrame(animate);
}
animate();

init().catch((err) => {
  console.error(err);
  statusEl.textContent = `ERROR: ${err.message}`;
});
