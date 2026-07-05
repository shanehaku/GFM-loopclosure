import * as THREE from "three";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";

const viewer = document.getElementById("viewer");
const statusEl = document.getElementById("status");
const groupSwitchEl = document.getElementById("groupSwitch");
const layerListEl = document.getElementById("layerList");

const loader = new PLYLoader();
const layers = new Map();
const views = new Map();

let activeGroup = null;
let globalPointSize = 0.006;
let globalLinePointSize = 0.0002;
const DEFAULT_POINT_SIZE = 0.008;
const DEFAULT_LINE_POINT_SIZE = 0.015;

const GROUP_ORDER = ["original", "lg_aligned", "lg_vgicp"];
const GROUP_LABELS = {
  "original": "Original: A + B",
  "lg_aligned": "LG aligned: A + B + matching lines",
  "lg_vgicp": "LG + VGICP: A + B + matching lines"
};
const SYNCED_CAMERA_GROUPS = new Set(["lg_aligned", "lg_vgicp"]);
const syncedCameraState = {
  ready: false,
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  target: new THREE.Vector3()
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
  const text = `${layer.id ?? ""} ${layer.label ?? ""} ${layer.path ?? ""}`.toLowerCase();
  return text.includes("line");
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
  controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
  controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
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

function syncCameraFromView(groupName) {
  if (!SYNCED_CAMERA_GROUPS.has(groupName)) return;

  const view = views.get(groupName);
  if (!view || !view.cameraReady) return;

  syncedCameraState.position.copy(view.camera.position);
  syncedCameraState.quaternion.copy(view.camera.quaternion);
  syncedCameraState.target.copy(view.controls.target);
  syncedCameraState.ready = true;
}

function applySyncedCameraToView(view) {
  if (!SYNCED_CAMERA_GROUPS.has(view.groupName) || !syncedCameraState.ready) return;

  view.camera.position.copy(syncedCameraState.position);
  view.camera.quaternion.copy(syncedCameraState.quaternion);
  view.controls.target.copy(syncedCameraState.target);
  view.camera.updateProjectionMatrix();
  view.controls.update();
  view.cameraReady = true;
}

function setActiveGroup(groupName) {
  if (!views.has(groupName)) return;
  activeGroup = groupName;
  viewportTitle.textContent = GROUP_LABELS[groupName] ?? groupName;

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
}

async function loadLayer(layer) {
  return new Promise((resolve, reject) => {
    loader.load(
      layer.path,
      (geometry) => {
        geometry.computeBoundingBox();

        // PLYLoader may output normals/faces, but this viewer treats every PLY as a point layer.
        const mat = makeMaterial(layer);
        const points = new THREE.Points(geometry, mat);
        points.name = layer.id;
        points.visible = layer.visible ?? true;

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

function createControls(manifest) {
  groupSwitchEl.innerHTML = "";
  layerListEl.innerHTML = "";

  const byGroup = {};
  for (const layer of manifest.layers) {
    byGroup[layer.group] ??= [];
    byGroup[layer.group].push(layer);
  }

  const orderedGroups = [
    ...GROUP_ORDER.filter((name) => byGroup[name]),
    ...Object.keys(byGroup).filter((name) => !GROUP_ORDER.includes(name))
  ];

  for (const groupName of orderedGroups) {
    makeView(groupName);

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.group = groupName;
    button.setAttribute("aria-pressed", "false");
    button.textContent = GROUP_LABELS[groupName] ?? groupName;
    button.addEventListener("click", () => setActiveGroup(groupName));
    groupSwitchEl.appendChild(button);

    const div = document.createElement("div");
    div.className = "group";
    div.dataset.group = groupName;
    div.hidden = true;
    div.innerHTML = `<h2>${GROUP_LABELS[groupName] ?? groupName}</h2>`;

    for (const layer of byGroup[groupName]) {
      const row = document.createElement("label");
      row.className = "layer";
      row.innerHTML = `
        <input type="checkbox" ${layer.visible === false ? "" : "checked"} data-layer="${layer.id}">
        <span>${layer.label}<small>${layer.path}</small></span>
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

  setActiveGroup(orderedGroups[0]);
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
  const res = await fetch("./manifest.json", { cache: "no-store" });
  const manifest = await res.json();

  statusEl.textContent = `Loading ${manifest.layers.length} layers...`;
  createControls(manifest);

  let loaded = 0;
  for (const layer of manifest.layers) {
    try {
      await loadLayer(layer);
      loaded += 1;
      statusEl.textContent = `Loaded ${loaded}/${manifest.layers.length}: ${layer.label}`;
    } catch (err) {
      console.error(err);
      statusEl.textContent += `\nFAILED: ${layer.label} (${layer.path})`;
    }
  }

  for (const view of views.values()) resetCamera(view);
  setActiveGroup(activeGroup ?? GROUP_ORDER[0]);
  statusEl.textContent += "\nDone.";
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
