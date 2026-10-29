import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ---------- 场景 ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b5d8); // 天空色
scene.fog = new THREE.Fog(0x87b5d8, 60, 180);

// ---------- 相机 ----------
const viewport = document.getElementById('viewport');
const camera = new THREE.PerspectiveCamera(
  60,
  viewport.clientWidth / viewport.clientHeight,
  0.1,
  1000
);
camera.position.set(20, 15, 25);

// ---------- 渲染器（挂载到视口，编辑模式下视口左侧会让出零件面板） ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(viewport.clientWidth, viewport.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
viewport.appendChild(renderer.domElement);

// ---------- 控制器 ----------
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2.05; // 不允许看到地面以下
controls.update();

// ---------- 灯光 ----------
const ambient = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xfff2cc, 1.5);
sun.position.set(30, 40, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -50;
sun.shadow.camera.right = 50;
sun.shadow.camera.top = 50;
sun.shadow.camera.bottom = -50;
scene.add(sun);

// ---------- 地面 ----------
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshStandardMaterial({ color: 0x5a8f4a, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ---------- 占位物体（后续替换为中世纪村庄建筑） ----------
const houseMat = new THREE.MeshStandardMaterial({ color: 0xc9a876, roughness: 0.9 });
const roofMat = new THREE.MeshStandardMaterial({ color: 0x8b3a2a, roughness: 0.9 });

function addHouse(x, z) {
  const house = new THREE.Group();

  const body = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 3), houseMat);
  body.position.y = 1;
  body.castShadow = true;
  body.receiveShadow = true;
  house.add(body);

  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.5, 1.5, 4), roofMat);
  roof.position.y = 2.75;
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  house.add(roof);

  house.position.set(x, 0, z);
  scene.add(house);
}

addHouse(-6, -4);
addHouse(2, -6);
addHouse(6, 3);
addHouse(-3, 5);

// ---------- 窗口自适应 ----------
window.addEventListener('resize', () => {
  camera.aspect = viewport.clientWidth / viewport.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(viewport.clientWidth, viewport.clientHeight);
});

// ---------- 渲染循环 ----------
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

// ---------- 编辑模式入口：URL 带 ?edit=1 时加载编辑器 ----------
if (new URLSearchParams(location.search).get('edit') !== null) {
  import('./editor/editor.js').then((m) => m.initEditor());
}

// 供编辑器模块使用
export { scene, camera, renderer, controls, ground };
