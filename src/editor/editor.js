import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { scene, camera, renderer, ground } from '../main.js';
import './editor.css';

const GRID = 2; // 网格边长（米），零件按网格吸附摆放

// ---------- 零件定义：内置占位零件（glb 零件由 src/models/kit/ 启动时扫描注册） ----------
function stdMat(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
}

const PARTS = {
  wall: {
    label: '墙',
    color: '#c9a876',
    create() {
      const m = new THREE.Mesh(new THREE.BoxGeometry(GRID, 2.5, 0.4), stdMat(0xc9a876));
      m.position.y = 1.25;
      m.castShadow = m.receiveShadow = true;
      return m;
    },
  },
  roof: {
    label: '屋顶',
    color: '#8b3a2a',
    create() {
      const m = new THREE.Mesh(new THREE.ConeGeometry(1.6, 1.2, 4), stdMat(0x8b3a2a));
      m.rotation.y = Math.PI / 4;
      m.position.y = 0.6;
      m.castShadow = true;
      return m;
    },
  },
  door: {
    label: '门',
    color: '#6b4a2f',
    create() {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.3), stdMat(0x6b4a2f));
      m.position.y = 1;
      m.castShadow = m.receiveShadow = true;
      return m;
    },
  },
  tree: {
    label: '树',
    color: '#3e7a3a',
    create() {
      const g = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 1, 8), stdMat(0x6b4a2f));
      trunk.position.y = 0.5;
      trunk.castShadow = true;
      const crown = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2, 8), stdMat(0x3e7a3a));
      crown.position.y = 2;
      crown.castShadow = true;
      g.add(trunk, crown);
      return g;
    },
  },
};

// ---------- 编辑器状态 ----------
let selectedId = 'wall'; // 当前选中零件（用于放置）
let rotSteps = 0; // 放置旋转步数（每步 90°）
let ghost = null; // 幽灵预览对象
const items = []; // 摆放数据，导出为 scene.json：{ part, x, z, rot }
let placedGroup = null; // 已放置零件的容器，children 与 items 一一对应
let selected = null; // 当前选中的已放置零件索引
let boxHelper = null; // 选中高亮框
const undoStack = []; // items 快照栈
const redoStack = [];

const snap = (v) => Math.round(v / GRID) * GRID;

// ---------- glb 模型包扫描：src/models/kit/*.glb 自动注册为零件 ----------
const gltfLoader = new GLTFLoader();

function loadGLB(url) {
  return new Promise((resolve, reject) => gltfLoader.load(url, resolve, undefined, reject));
}

// 把任意模型规整成"底面中心为原点"的零件模板
function makePartTemplate(src) {
  src.updateMatrixWorld(true);
  src.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  const box = new THREE.Box3().setFromObject(src);
  const center = box.getCenter(new THREE.Vector3());
  src.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
  const wrapper = new THREE.Group();
  wrapper.add(src);
  return wrapper;
}

async function loadKitParts() {
  const urls = import.meta.glob('../models/kit/*.glb', { eager: true, query: '?url', import: 'default' });
  await Promise.all(
    Object.entries(urls).map(async ([path, url]) => {
      const base = path.split('/').pop().replace(/\.glb$/, '');
      let gltf;
      try {
        gltf = await loadGLB(url);
      } catch (err) {
        console.error('模型加载失败：' + path, err);
        return;
      }
      const roots = gltf.scene.children;
      if (roots.length === 1) {
        registerGlbPart(base, base, roots[0]);
      } else {
        // 一个文件多个顶层节点：每个节点各成一个零件
        roots.forEach((node, i) => {
          const name = node.name || base + '_' + i;
          registerGlbPart(base + '#' + name, name, node);
        });
      }
    })
  );
}

function registerGlbPart(id, label, src) {
  if (PARTS[id]) {
    console.warn('零件 id 重复，跳过：' + id);
    return;
  }
  const template = makePartTemplate(src);
  PARTS[id] = { label, color: '#8a8f98', create: () => template.clone() };
}

// ---------- 零件缩略图：共享一个 64px 离屏渲染器 ----------
let thumbRenderer = null;

function renderThumb(model) {
  if (!thumbRenderer) {
    thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    thumbRenderer.setSize(64, 64);
  }
  const s = new THREE.Scene();
  s.add(new THREE.AmbientLight(0xffffff, 1.5));
  const d = new THREE.DirectionalLight(0xffffff, 2);
  d.position.set(3, 5, 4);
  s.add(d);
  s.add(model);

  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3()).length() || 1;
  const center = box.getCenter(new THREE.Vector3());
  const cam = new THREE.PerspectiveCamera(35, 1, 0.1, size * 10);
  cam.position.copy(center).add(new THREE.Vector3(size, size * 0.6, size));
  cam.lookAt(center);

  thumbRenderer.render(s, cam);
  return thumbRenderer.domElement.toDataURL();
}

function partThumbURL(part) {
  if (!part.thumbURL) {
    try {
      part.thumbURL = renderThumb(part.create());
    } catch (err) {
      console.error('缩略图渲染失败：' + part.label, err);
    }
  }
  return part.thumbURL;
}

export async function initEditor() {
  document.body.classList.add('edit-mode');

  // 网格辅助线
  const gridHelper = new THREE.GridHelper(200, 200 / GRID, 0x335577, 0x9db8d2);
  gridHelper.position.y = 0.01;
  scene.add(gridHelper);

  placedGroup = new THREE.Group();
  scene.add(placedGroup);

  await loadKitParts();
  renderPartsList();
  buildGhost();
  bindInteractions();
  updateHistoryButtons();

  // 调试钩子：供控制台/自动化测试读取编辑器内部状态
  window.__editor = {
    items,
    placedGroup,
    getGhost: () => ghost,
    getSelected: () => selected,
    undoStack,
    redoStack,
  };

  // 面板出现后视口变窄，触发一次 resize 让渲染器适配新尺寸
  window.dispatchEvent(new Event('resize'));
}

// ---------- 左侧零件列表 ----------
function renderPartsList() {
  const list = document.getElementById('parts-list');
  list.innerHTML = '';
  Object.entries(PARTS).forEach(([id, part], index) => {
    const item = document.createElement('div');
    item.className = 'part-item' + (index === 0 ? ' active' : '');

    const thumb = document.createElement('span');
    thumb.className = 'part-thumb';
    const url = partThumbURL(part);
    if (url) {
      thumb.style.background = `#e4e4e8 url(${url}) center/contain no-repeat`;
    } else {
      thumb.style.background = part.color;
    }

    const label = document.createElement('span');
    label.className = 'part-label';
    label.textContent = part.label;

    item.append(thumb, label);
    item.addEventListener('click', () => {
      list.querySelector('.part-item.active')?.classList.remove('active');
      item.classList.add('active');
      selectedId = id;
      buildGhost();
    });
    list.appendChild(item);
  });
}

// ---------- 幽灵预览 ----------
function buildGhost() {
  if (ghost) scene.remove(ghost);
  ghost = PARTS[selectedId].create();
  ghost.traverse((o) => {
    if (o.isMesh) {
      const m = o.material.clone();
      m.transparent = true;
      m.opacity = 0.5;
      m.depthWrite = false;
      o.material = m;
      o.castShadow = false;
    }
  });
  ghost.visible = false;
  scene.add(ghost);
}

// ---------- 场景数据与历史 ----------
function rebuildPlaced() {
  placedGroup.clear();
  clearSelection();
  items.forEach((it, i) => {
    placedGroup.add(makePlacedObject(it, i));
  });
}

function makePlacedObject(it, index) {
  const obj = PARTS[it.part].create();
  obj.position.set(it.x, 0, it.z);
  obj.rotation.y = (it.rot * Math.PI) / 180;
  obj.userData.itemIndex = index;
  return obj;
}

function pushHistory() {
  undoStack.push(JSON.stringify(items));
  if (undoStack.length > 50) undoStack.shift();
  redoStack.length = 0;
  updateHistoryButtons();
}

function applyItems(next) {
  items.length = 0;
  items.push(...next);
  rebuildPlaced();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(items));
  applyItems(JSON.parse(undoStack.pop()));
  updateHistoryButtons();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(items));
  applyItems(JSON.parse(redoStack.pop()));
  updateHistoryButtons();
}

function updateHistoryButtons() {
  document.getElementById('btn-undo').disabled = !undoStack.length;
  document.getElementById('btn-redo').disabled = !redoStack.length;
}

// ---------- 选中 ----------
function select(index) {
  clearSelection();
  selected = index;
  boxHelper = new THREE.BoxHelper(placedGroup.children[index], 0x22dd66);
  scene.add(boxHelper);
}

function clearSelection() {
  if (boxHelper) {
    scene.remove(boxHelper);
    boxHelper.geometry.dispose();
    boxHelper = null;
  }
  selected = null;
}

function deleteSelected() {
  if (selected == null) return;
  pushHistory();
  items.splice(selected, 1);
  rebuildPlaced();
}

function rotateSelectedOrGhost() {
  if (selected != null) {
    pushHistory();
    const it = items[selected];
    it.rot = (it.rot + 90) % 360;
    const obj = placedGroup.children[selected];
    obj.rotation.y = (it.rot * Math.PI) / 180;
    boxHelper?.update();
  } else {
    rotSteps = (rotSteps + 1) % 4;
    if (ghost.visible) ghost.rotation.y = (rotSteps * Math.PI) / 2;
  }
}

function moveSelected(dx, dz) {
  if (selected == null) return;
  pushHistory();
  const it = items[selected];
  it.x += dx * GRID;
  it.z += dz * GRID;
  const obj = placedGroup.children[selected];
  obj.position.set(it.x, 0, it.z);
  boxHelper?.update();
}

// ---------- 交互：射线拾取、放置、选中、快捷键 ----------
function bindInteractions() {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const dom = renderer.domElement;
  let downPos = null;

  function setRaycaster(e) {
    const rect = dom.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
  }

  dom.addEventListener('pointermove', (e) => {
    setRaycaster(e);
    const hit = raycaster.intersectObject(ground)[0];
    if (!hit) {
      ghost.visible = false;
      return;
    }
    ghost.visible = true;
    ghost.position.set(snap(hit.point.x), 0, snap(hit.point.z));
    ghost.rotation.y = (rotSteps * Math.PI) / 2;
  });

  dom.addEventListener('pointerleave', () => {
    ghost.visible = false;
  });

  dom.addEventListener('pointerdown', (e) => {
    downPos = { x: e.clientX, y: e.clientY };
  });

  // 与 OrbitControls 共存：拖拽转视角不触发；点击时优先选中已有零件，否则放置
  dom.addEventListener('pointerup', (e) => {
    if (!downPos) return;
    const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
    downPos = null;
    if (moved > 6) return;

    setRaycaster(e);
    // 快速连续点击时两帧之间可能尚未渲染，先刷新矩阵保证射线能命中新放零件
    placedGroup.updateMatrixWorld(true);
    const hitPlaced = raycaster.intersectObjects(placedGroup.children, true)[0];
    if (hitPlaced) {
      let obj = hitPlaced.object;
      while (obj && obj.parent !== placedGroup) obj = obj.parent;
      select(obj.userData.itemIndex);
      return;
    }
    if (ghost.visible) placeGhost();
  });

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
      return;
    }
    switch (e.key) {
      case 'r':
      case 'R':
        rotateSelectedOrGhost();
        break;
      case 'Delete':
      case 'Backspace':
        deleteSelected();
        break;
      case 'Escape':
        clearSelection();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        moveSelected(-1, 0);
        break;
      case 'ArrowRight':
        e.preventDefault();
        moveSelected(1, 0);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveSelected(0, -1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        moveSelected(0, 1);
        break;
    }
  });

  document.getElementById('btn-export').addEventListener('click', exportScene);
  document.getElementById('btn-undo').addEventListener('click', undo);
  document.getElementById('btn-redo').addEventListener('click', redo);
  bindImport();
}

function placeGhost() {
  pushHistory();
  clearSelection();
  const { x, z } = ghost.position;
  items.push({ part: selectedId, x, z, rot: rotSteps * 90 });
  placedGroup.add(makePlacedObject(items[items.length - 1], items.length - 1));
}

// ---------- 导入 / 导出 scene.json ----------
function exportScene() {
  const doc = { version: 1, grid: GRID, items };
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'scene.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function bindImport() {
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.json';
  fileInput.style.display = 'none';
  document.body.appendChild(fileInput);

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const doc = JSON.parse(await file.text());
      if (!Array.isArray(doc.items)) throw new Error('缺少 items');
      pushHistory();
      applyItems(doc.items);
    } catch (err) {
      alert('scene.json 解析失败：' + err.message);
    }
  });

  document.getElementById('btn-import').addEventListener('click', () => fileInput.click());
}
