// 生成一个测试用的 2m 立方体积木模型：src/models/kit/crate.glb
// 用法：node tools/make-test-glb.mjs
import { writeFileSync, mkdirSync } from 'fs';

const s = 1; // 半边长 1m → 2m 立方体（与 GRID=2 对齐）

// 6 个面：法线 + 4 顶点
const faces = [
  [[1, 0, 0], [[s, -s, s], [s, -s, -s], [s, s, -s], [s, s, s]]],
  [[-1, 0, 0], [[-s, -s, -s], [-s, -s, s], [-s, s, s], [-s, s, -s]]],
  [[0, 1, 0], [[-s, s, s], [s, s, s], [s, s, -s], [-s, s, -s]]],
  [[0, -1, 0], [[-s, -s, -s], [s, -s, -s], [s, -s, s], [-s, -s, s]]],
  [[0, 0, 1], [[-s, -s, s], [s, -s, s], [s, s, s], [-s, s, s]]],
  [[0, 0, -1], [[s, -s, -s], [-s, -s, -s], [-s, s, -s], [s, s, -s]]],
];

const positions = [];
const normals = [];
const indices = [];
faces.forEach(([n, verts], f) => {
  verts.forEach((v) => {
    positions.push(...v);
    normals.push(...n);
  });
  const b = f * 4;
  indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
});

const posBuf = Buffer.from(new Float32Array(positions).buffer);
const nrmBuf = Buffer.from(new Float32Array(normals).buffer);
const idxBuf = Buffer.from(new Uint16Array(indices).buffer);
const bin = Buffer.concat([posBuf, nrmBuf, idxBuf]);

const gltf = {
  asset: { version: '2.0', generator: 'make-test-glb' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: 'crate', mesh: 0 }],
  meshes: [{
    name: 'crate',
    primitives: [{
      attributes: { POSITION: 0, NORMAL: 1 },
      indices: 2,
      material: 0,
    }],
  }],
  materials: [{
    name: 'crate_mat',
    doubleSided: true,
    pbrMetallicRoughness: {
      baseColorFactor: [0.78, 0.66, 0.46, 1],
      metallicFactor: 0,
      roughnessFactor: 0.9,
    },
  }],
  buffers: [{
    uri: 'data:application/octet-stream;base64,' + bin.toString('base64'),
    byteLength: bin.length,
  }],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: posBuf.length, target: 34962 },
    { buffer: 0, byteOffset: posBuf.length, byteLength: nrmBuf.length, target: 34962 },
    { buffer: 0, byteOffset: posBuf.length + nrmBuf.length, byteLength: idxBuf.length, target: 34963 },
  ],
  accessors: [
    {
      bufferView: 0, componentType: 5126, count: 24, type: 'VEC3',
      min: [-s, -s, -s], max: [s, s, s],
    },
    { bufferView: 1, componentType: 5126, count: 24, type: 'VEC3' },
    { bufferView: 2, componentType: 5123, count: 36, type: 'SCALAR' },
  ],
};

// GLB：12 字节头 + JSON chunk（buffer 用 data URI 内嵌，无 BIN chunk）
let jsonStr = JSON.stringify(gltf);
jsonStr += ' '.repeat((4 - (jsonStr.length % 4)) % 4);
const jsonBuf = Buffer.from(jsonStr, 'utf8');
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); // magic "glTF"
header.writeUInt32LE(2, 4); // version
header.writeUInt32LE(12 + 8 + jsonBuf.length, 8); // total length
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(jsonBuf.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4); // "JSON"

mkdirSync('src/models/kit', { recursive: true });
writeFileSync('src/models/kit/crate.glb', Buffer.concat([header, jsonHeader, jsonBuf]));
console.log('written src/models/kit/crate.glb,', 12 + 8 + jsonBuf.length, 'bytes');
