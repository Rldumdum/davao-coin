// Builds Barangay Durian: a small island with a plaza, a market row, a mine on the slope
// and Mt. Apo on the horizon. Returns the bits the game loop needs to animate or collide with.
import * as THREE from 'three';
import { HUTS, MERCHANTS, MINE_SPOTS, type MerchantInfo, type MineSpotInfo } from '../world-data';
import { headingTo } from './characters';

export interface Collider {
  x: number;
  z: number;
  r: number;
}

export interface RockObj {
  info: MineSpotInfo;
  group: THREE.Group;
  shards: THREE.Mesh[];
  shardMat: THREE.MeshStandardMaterial;
  baseEmissive: THREE.Color;
  depleted: number; // 0 = full, 1 = fully depleted (animated)
  shake: number;
  top: number;
}

export interface World {
  colliders: Collider[];
  rocks: Map<number, RockObj>;
  /** Merchant positions keyed by merchant key, with the stall front direction. */
  stalls: Map<string, { x: number; z: number; facing: number }>;
  update(t: number, dt: number): void;
}

/* ----------------------------------------------------------- utilities */

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const std = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });

function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Irregular blob outline, for coastlines. */
function blobShape(radius: number, wobble: number, seed: number) {
  const r = rng(seed);
  const shape = new THREE.Shape();
  const n = 72;
  const phases = [r() * 6, r() * 6, r() * 6];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rad =
      radius +
      Math.sin(a * 3 + phases[0]!) * wobble +
      Math.sin(a * 5 + phases[1]!) * wobble * 0.5 +
      Math.sin(a * 9 + phases[2]!) * wobble * 0.25;
    const x = Math.cos(a) * rad;
    const y = Math.sin(a) * rad;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  return shape;
}

/* -------------------------------------------------------------- pieces */

function buildSky(scene: THREE.Scene) {
  const geo = new THREE.SphereGeometry(500, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color('#5aa6dd') },
      horizon: { value: new THREE.Color('#f6dcb0') },
    },
    vertexShader: `varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 vPos;
      void main(){ float h = clamp(normalize(vPos).y * 2.2, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.7)), 1.0); }`,
  });
  scene.add(new THREE.Mesh(geo, mat));
}

function buildGround(scene: THREE.Scene) {
  // Ocean
  const ocean = add(scene, new THREE.PlaneGeometry(1200, 1200), std('#2b86b0', { roughness: 0.25, metalness: 0.1 }), 0, -0.3, 0, false);
  ocean.rotation.x = -Math.PI / 2;
  const shallow = add(
    scene,
    new THREE.ShapeGeometry(blobShape(62, 3, 7), 2),
    std('#5ec4c4', { roughness: 0.3, transparent: true, opacity: 0.7 }),
    0,
    -0.22,
    0,
    false,
  );
  shallow.rotation.x = -Math.PI / 2;

  // Sand, then grass on top.
  const sand = add(scene, new THREE.ShapeGeometry(blobShape(54, 2.5, 3), 2), std('#e5d2a0'), 0, -0.05, 0, false);
  sand.rotation.x = -Math.PI / 2;

  const grassTex = canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = '#76ad52';
    ctx.fillRect(0, 0, 256, 256);
    const r = rng(11);
    for (let i = 0; i < 2600; i++) {
      const shade = 0.82 + r() * 0.3;
      ctx.fillStyle = `rgb(${Math.round(110 * shade)},${Math.round(168 * shade)},${Math.round(76 * shade)})`;
      ctx.fillRect(r() * 256, r() * 256, 2 + r() * 3, 2 + r() * 3);
    }
  });
  grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
  grassTex.repeat.set(0.08, 0.08);
  const grass = add(scene, new THREE.ShapeGeometry(blobShape(47.5, 2, 5), 2), std('#ffffff', { map: grassTex }), 0, 0, 0, false);
  grass.rotation.x = -Math.PI / 2;

  // Plaza: stone tiles.
  const tileTex = canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = '#c9bca2';
    ctx.fillRect(0, 0, 256, 256);
    const r = rng(23);
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        const s = 0.88 + r() * 0.16;
        ctx.fillStyle = `rgb(${Math.round(214 * s)},${Math.round(200 * s)},${Math.round(172 * s)})`;
        ctx.fillRect(x * 32 + 1.5, y * 32 + 1.5, 29, 29);
      }
  });
  tileTex.wrapS = tileTex.wrapT = THREE.RepeatWrapping;
  tileTex.repeat.set(4, 4);
  const plaza = add(scene, new THREE.CircleGeometry(9.5, 48), std('#ffffff', { map: tileTex }), 0, 0.02, 0, false);
  plaza.rotation.x = -Math.PI / 2;
  const rim = add(scene, new THREE.RingGeometry(9.5, 10.1, 48), std('#9c8b6c'), 0, 0.025, 0, false);
  rim.rotation.x = -Math.PI / 2;

  // Gravel around the mine.
  const gravel = add(scene, new THREE.CircleGeometry(16, 40), std('#a59276'), 2, 0.015, -29, false);
  gravel.rotation.x = -Math.PI / 2;
  gravel.scale.set(1.25, 1, 1);

  // Dirt paths from the plaza.
  const pathMat = std('#c4a77a');
  const path = (x1: number, z1: number, x2: number, z2: number, w = 2.6) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const m = add(scene, new THREE.PlaneGeometry(w, len), pathMat, (x1 + x2) / 2, 0.012, (z1 + z2) / 2, false);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.atan2(x2 - x1, z2 - z1);
  };
  path(0, -9, 0, -19, 3);
  path(0, 9, 2, 24);
  path(-9, -1, -18, -4);
  path(-8, 4, -20, 7);
  path(-5, 8, -12, 16);
  for (const m of MERCHANTS) path(m.x * 0.55, m.z * 0.55, m.x - 1.5 * Math.sign(m.x), m.z * 0.92, 2.2);
}

function buildMountains(scene: THREE.Scene, colliders: Collider[]) {
  const rockMat = new THREE.MeshStandardMaterial({ color: '#77806a', roughness: 1, flatShading: true });
  const darkMat = new THREE.MeshStandardMaterial({ color: '#5c6656', roughness: 1, flatShading: true });
  const r = rng(99);

  // Mt. Apo, far away; the fog turns it blue.
  const apo = add(scene, new THREE.ConeGeometry(110, 95, 9, 3), new THREE.MeshStandardMaterial({ color: '#5d7a63', roughness: 1, flatShading: true }), 30, 40, -230, false);
  apo.rotation.y = 0.4;
  add(scene, new THREE.ConeGeometry(80, 70, 8, 2), darkMat, -90, 28, -200, false);
  add(scene, new THREE.ConeGeometry(70, 55, 7, 2), darkMat, 120, 20, -190, false);

  // The ridge behind the mine: big boulders forming a cliff.
  for (let i = 0; i < 16; i++) {
    const x = -34 + i * 4.6 + r() * 2;
    const z = -42 - r() * 6 - Math.abs(x - 3) * 0.08;
    const size = 4 + r() * 4;
    const m = add(scene, new THREE.IcosahedronGeometry(size, 0), r() > 0.5 ? rockMat : darkMat, x, size * 0.45, z);
    m.rotation.set(r(), r() * 6, r());
    m.scale.y = 0.9 + r() * 0.6;
    colliders.push({ x, z, r: size * 0.8 });
  }
  // A grassy cap on the ridge, so it reads as a hillside rather than a rock pile.
  for (let i = 0; i < 9; i++) {
    const x = -32 + i * 8 + r() * 3;
    const m = add(scene, new THREE.SphereGeometry(9 + r() * 4, 10, 6), std('#5f8f45', { flatShading: true }), x, -1, -54 - r() * 4);
    m.scale.y = 0.75;
  }

  // Crystal cave mouth.
  const cave = add(scene, new THREE.SphereGeometry(5.5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), rockMat, 16, 0, -40.5);
  cave.scale.set(1.2, 1.05, 0.9);
  const mouth = add(scene, new THREE.CircleGeometry(2.2, 20, 0, Math.PI), new THREE.MeshBasicMaterial({ color: '#120d1a' }), 16, 0.02, -35.6, false);
  mouth.scale.y = 1.3;
  colliders.push({ x: 16, z: -40.5, r: 5.6 });
}

function buildRock(scene: THREE.Scene, info: MineSpotInfo, seed: number): RockObj {
  const r = rng(seed);
  const group = new THREE.Group();
  group.position.set(info.x, 0, info.z);
  scene.add(group);

  const base = add(group, new THREE.IcosahedronGeometry(info.size, 0), new THREE.MeshStandardMaterial({ color: '#7d776c', roughness: 0.95, flatShading: true }), 0, info.size * 0.55, 0);
  base.scale.set(1.1, 0.85, 1);
  base.rotation.set(r(), r() * 6, r());

  const oreColors: Record<number, [string, string, number]> = {
    1: ['#c8743a', '#3a1a08', 0.15],
    2: ['#dfe6ec', '#2a3440', 0.15],
    3: ['#f5c62a', '#6b4a00', 0.45],
    4: ['#b77bff', '#6a2bd6', 1.1],
  };
  const [color, emissive, intensity] = oreColors[info.ore] ?? ['#ffffff', '#000000', 0];
  const shardMat = new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: intensity,
    roughness: 0.3,
    metalness: info.ore === 4 ? 0.1 : 0.6,
    flatShading: true,
  });
  const shards: THREE.Mesh[] = [];
  const count = info.ore === 4 ? 9 : 6;
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2;
    const up = 0.35 + r() * 0.55;
    const dir = new THREE.Vector3(Math.cos(a) * (1 - up * 0.6), up, Math.sin(a) * (1 - up * 0.6)).normalize();
    const big = info.ore === 4 ? 1.5 : 1;
    const geo = info.ore === 4 ? new THREE.ConeGeometry(0.12 * big, 0.7 * big + r() * 0.4, 5) : new THREE.OctahedronGeometry(0.16 + r() * 0.1, 0);
    const shard = add(group, geo, shardMat, dir.x * info.size * 0.95, info.size * 0.5 + dir.y * info.size * 0.75, dir.z * info.size * 0.95);
    shard.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    shard.userData.baseScale = 1;
    shards.push(shard);
  }
  if (info.ore === 4) {
    const glow = new THREE.PointLight('#a86bff', 6, 9, 1.6);
    glow.position.set(0, info.size + 0.8, 0.6);
    group.add(glow);
  }

  return {
    info,
    group,
    shards,
    shardMat,
    baseEmissive: shardMat.emissive.clone(),
    depleted: 0,
    shake: 0,
    top: info.size * 1.6,
  };
}

function buildStatue(scene: THREE.Scene, colliders: Collider[]) {
  const stone = std('#b7aa90');
  add(scene, new THREE.CylinderGeometry(1.9, 2.1, 0.5, 20), stone, 0, 0.25, 0);
  add(scene, new THREE.CylinderGeometry(1.3, 1.5, 1.1, 16), stone, 0, 1.05, 0);
  const fruitMat = std('#a3b23a', { roughness: 0.7, flatShading: true });
  const fruit = add(scene, new THREE.IcosahedronGeometry(1.25, 1), fruitMat, 0, 2.85, 0);
  fruit.scale.y = 1.12;
  // Spikes: one InstancedMesh, ~160 cones pointing out from the fruit.
  const spikeGeo = new THREE.ConeGeometry(0.11, 0.32, 4);
  spikeGeo.translate(0, 0.16, 0);
  const spikes = new THREE.InstancedMesh(spikeGeo, std('#8a9a2c', { flatShading: true }), 160);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 160; i++) {
    // Fibonacci sphere for even spacing.
    const y = 1 - (i / 159) * 2;
    const rad = Math.sqrt(1 - y * y);
    const th = i * 2.39996;
    const dir = new THREE.Vector3(Math.cos(th) * rad, y, Math.sin(th) * rad);
    q.setFromUnitVectors(up, dir);
    m.compose(new THREE.Vector3(dir.x * 1.2, 2.85 + dir.y * 1.32, dir.z * 1.2), q, new THREE.Vector3(1, 1, 1));
    spikes.setMatrixAt(i, m);
  }
  spikes.castShadow = true;
  scene.add(spikes);
  add(scene, new THREE.CylinderGeometry(0.08, 0.12, 0.45, 6), std('#6b4a2a'), 0, 4.35, 0);
  colliders.push({ x: 0, z: 0, r: 2.1 });
}

function buildBunting(scene: THREE.Scene) {
  // Kadayawan festival flags strung around the plaza.
  const poles: THREE.Vector3[] = [];
  const poleMat = std('#7a5a3a');
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const p = new THREE.Vector3(Math.cos(a) * 9.8, 0, Math.sin(a) * 9.8);
    add(scene, new THREE.CylinderGeometry(0.07, 0.09, 4.2, 6), poleMat, p.x, 2.1, p.z);
    poles.push(p);
  }
  const colors = ['#e63946', '#f4a261', '#f2c14e', '#2a9d8f', '#457b9d', '#9b5de5', '#ef476f'];
  const flagGeo = new THREE.BufferGeometry();
  flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.18, 0, 0, 0.18, 0, 0, 0, -0.4, 0], 3));
  flagGeo.computeVertexNormals();
  const per = 10;
  const flags = new THREE.InstancedMesh(flagGeo, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8 }), poles.length * per);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let n = 0;
  const lineMat = new THREE.LineBasicMaterial({ color: '#4a3a2a' });
  for (let i = 0; i < poles.length; i++) {
    const a = poles[i]!;
    const b = poles[(i + 1) % poles.length]!;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= per; k++) {
      const t = k / per;
      const p = a.clone().lerp(b, t);
      p.y = 4.05 - Math.sin(t * Math.PI) * 0.8;
      pts.push(p);
      if (k > 0 && k < per) {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.atan2(b.z - a.z, b.x - a.x));
        m.compose(p, q, new THREE.Vector3(1, 1, 1));
        flags.setMatrixAt(n, m);
        flags.setColorAt(n, new THREE.Color(colors[n % colors.length]!));
        n++;
      }
    }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
  }
  flags.count = n;
  scene.add(flags);
}

function signTexture(title: string, subtitle: string, bg: string) {
  return canvasTexture(512, 160, (ctx) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 160);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, 504, 152);
    ctx.fillStyle = '#fff8e6';
    ctx.textAlign = 'center';
    ctx.font = 'bold 64px Georgia, serif';
    ctx.fillText(title, 256, 82);
    ctx.font = '600 34px Inter, sans-serif';
    ctx.fillStyle = 'rgba(255,248,230,0.85)';
    ctx.fillText(subtitle.toUpperCase(), 256, 132);
  });
}

function buildStall(scene: THREE.Scene, m: MerchantInfo, colliders: Collider[]) {
  const facing = headingTo(m.x, m.z, 0, 0);
  const g = new THREE.Group();
  g.position.set(m.x, 0, m.z);
  g.rotation.y = facing;
  scene.add(g);

  const wood = std('#8b5e3c');
  const darkWood = std('#5e3d25');
  // Counter in front of the merchant (local +z is toward the plaza).
  add(g, new THREE.BoxGeometry(3.4, 1.0, 0.8), wood, 0, 0.5, 1.0);
  add(g, new THREE.BoxGeometry(3.6, 0.08, 1.0), darkWood, 0, 1.04, 1.0);
  // Posts and back shelf.
  for (const [x, z] of [
    [-1.75, 1.45],
    [1.75, 1.45],
    [-1.75, -1.2],
    [1.75, -1.2],
  ] as const) {
    add(g, new THREE.CylinderGeometry(0.07, 0.07, 2.9, 6), darkWood, x, 1.45, z);
  }
  add(g, new THREE.BoxGeometry(3.4, 1.4, 0.4), wood, 0, 0.7, -1.15);

  // Striped awning.
  const stripes = canvasTexture(256, 64, (ctx) => {
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? m.awning[1] : m.awning[0];
      ctx.fillRect(i * 32, 0, 32, 64);
    }
  });
  const awning = add(g, new THREE.PlaneGeometry(4.0, 3.2), std('#ffffff', { map: stripes, side: THREE.DoubleSide }), 0, 3.05, 0.1);
  awning.rotation.x = -Math.PI / 2 + 0.28;
  // Scalloped front edge.
  for (let i = 0; i < 8; i++) {
    const flap = add(g, new THREE.CircleGeometry(0.25, 10, Math.PI, Math.PI), std(i % 2 ? m.awning[1] : m.awning[0], { side: THREE.DoubleSide }), -1.75 + i * 0.5, 2.6, 1.66, false);
    flap.rotation.x = -0.1;
  }
  // Name sign.
  const sign = add(g, new THREE.PlaneGeometry(2.6, 0.8), new THREE.MeshStandardMaterial({ map: signTexture(m.name, m.title, m.awning[0]), roughness: 0.8 }), 0, 3.45, 1.7, false);
  sign.rotation.x = -0.12;

  // Goods on the counter.
  const counterTop = 1.1;
  if (m.key === 'nena') {
    const r = rng(5);
    const fruits: [string, number, number][] = [
      ['#9bae3c', 0.17, -1.1],
      ['#b7d16a', 0.2, 0],
      ['#5b2a4e', 0.1, 1.05],
    ];
    for (const [color, size, cx] of fruits) {
      for (let i = 0; i < 7; i++) {
        const geo = size > 0.15 && color === '#9bae3c' ? new THREE.IcosahedronGeometry(size, 0) : new THREE.SphereGeometry(size, 10, 8);
        add(g, geo, std(color, { flatShading: color === '#9bae3c' }), cx + (r() - 0.5) * 0.6, counterTop + size + (i > 4 ? size * 1.4 : 0), 1.0 + (r() - 0.5) * 0.5);
      }
    }
    for (let i = 0; i < 3; i++) add(g, new THREE.BoxGeometry(0.7, 0.45, 0.5), std('#a0784a'), -1.1 + i * 1.1, 0.25, 2.0);
  } else if (m.key === 'berto') {
    const anvil = new THREE.Group();
    add(anvil, new THREE.BoxGeometry(0.5, 0.25, 0.3), std('#3a3f45', { metalness: 0.7, roughness: 0.4 }), 0, 0.12, 0);
    add(anvil, new THREE.BoxGeometry(0.75, 0.18, 0.32), std('#4a5058', { metalness: 0.7, roughness: 0.4 }), 0.05, 0.33, 0);
    anvil.position.set(0.7, counterTop, 1.0);
    g.add(anvil);
    const ores = ['#c8743a', '#dfe6ec', '#f5c62a'];
    ores.forEach((c, i) => {
      for (let k = 0; k < 4; k++) add(g, new THREE.OctahedronGeometry(0.12, 0), std(c, { metalness: 0.6, roughness: 0.35, flatShading: true }), -1.3 + i * 0.35 + (k % 2) * 0.12, counterTop + 0.12 + (k > 1 ? 0.14 : 0), 0.85 + (k % 2) * 0.2);
    });
    // Glowing forge behind.
    add(g, new THREE.BoxGeometry(1.1, 0.9, 0.8), std('#55504a'), -1.0, 0.45, -2.1);
    add(g, new THREE.BoxGeometry(0.6, 0.3, 0.05), new THREE.MeshBasicMaterial({ color: '#ff7a1a' }), -1.0, 0.55, -1.68, false);
    const forgeLight = new THREE.PointLight('#ff8a3a', 4, 6, 1.5);
    forgeLight.position.set(-1.0, 1.0, -1.4);
    g.add(forgeLight);
  } else {
    // Money changer: coin stacks and a lockbox.
    for (let i = 0; i < 6; i++) {
      const h = 0.06 + (i % 3) * 0.08;
      add(g, new THREE.CylinderGeometry(0.11, 0.11, h, 14), std('#f2c14e', { metalness: 0.8, roughness: 0.3 }), -1.2 + i * 0.22, counterTop + h / 2, 0.9 + (i % 2) * 0.2);
    }
    add(g, new THREE.BoxGeometry(0.55, 0.38, 0.4), std('#2f4f3a', { metalness: 0.4 }), 0.9, counterTop + 0.19, 1.0);
    add(g, new THREE.OctahedronGeometry(0.16, 0), std('#8a94ff', { metalness: 0.5, roughness: 0.2, emissive: '#2a2f8a', emissiveIntensity: 0.5 }), 0.2, counterTop + 0.3, 1.0);
  }

  // Colliders along the stall footprint (in world space).
  const fwd = new THREE.Vector2(Math.sin(facing), Math.cos(facing));
  const right = new THREE.Vector2(Math.cos(facing), -Math.sin(facing));
  for (const along of [-1.3, 0, 1.3]) {
    colliders.push({ x: m.x + right.x * along + fwd.x * 1.0, z: m.z + right.y * along + fwd.y * 1.0, r: 0.75 });
    colliders.push({ x: m.x + right.x * along - fwd.x * 0.9, z: m.z + right.y * along - fwd.y * 0.9, r: 0.8 });
  }
  return facing;
}

function buildHut(scene: THREE.Scene, x: number, z: number, rot: number, colliders: Collider[]) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  scene.add(g);
  const bamboo = std('#c9a464');
  const darkBamboo = std('#8f6d3a');
  for (const [px, pz] of [
    [-1.4, -1.2],
    [1.4, -1.2],
    [-1.4, 1.2],
    [1.4, 1.2],
  ] as const) {
    add(g, new THREE.CylinderGeometry(0.1, 0.1, 1.0, 6), darkBamboo, px, 0.5, pz);
  }
  add(g, new THREE.BoxGeometry(3.1, 0.15, 2.7), darkBamboo, 0, 1.05, 0);
  add(g, new THREE.BoxGeometry(2.9, 1.7, 2.5), bamboo, 0, 1.95, 0);
  add(g, new THREE.BoxGeometry(0.8, 0.6, 0.05), std('#2c2014'), 0.6, 2.1, 1.26, false);
  add(g, new THREE.BoxGeometry(0.7, 1.25, 0.05), std('#4a3420'), -0.7, 1.75, 1.26, false);
  const roof = add(g, new THREE.ConeGeometry(2.75, 1.9, 4), std('#8a6a3a', { flatShading: true }), 0, 3.75, 0);
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1.15, 1, 1.05);
  // Ladder
  for (let i = 0; i < 4; i++) add(g, new THREE.BoxGeometry(0.6, 0.05, 0.08), darkBamboo, -0.7, 0.2 + i * 0.25, 1.55 + i * -0.04);
  colliders.push({ x, z, r: 2.1 });
}

function buildPalm(scene: THREE.Scene, x: number, z: number, r: () => number) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = r() * Math.PI * 2;
  scene.add(g);
  const trunkMat = std('#8a6b4a');
  const lean = 0.15 + r() * 0.25;
  const segs = 6;
  const h = 5 + r() * 2.5;
  let px = 0,
    py = 0;
  for (let i = 0; i < segs; i++) {
    const t = i / segs;
    const seg = add(g, new THREE.CylinderGeometry(0.17 - t * 0.05, 0.2 - t * 0.05, h / segs + 0.05, 7), trunkMat, px, py + h / segs / 2, 0);
    seg.rotation.z = -lean * (0.4 + t);
    px += Math.sin(lean * (0.4 + t)) * (h / segs);
    py += Math.cos(lean * (0.4 + t)) * (h / segs);
  }
  const leafMat = std('#3f8f3a', { side: THREE.DoubleSide, flatShading: true });
  for (let i = 0; i < 8; i++) {
    const leafGeo = new THREE.ConeGeometry(0.42, 3, 4, 1, true);
    leafGeo.translate(0, 1.5, 0);
    const leaf = add(g, leafGeo, leafMat, px, py, 0);
    leaf.scale.set(1, 1, 0.12);
    leaf.rotation.order = 'YXZ';
    leaf.rotation.y = (i / 8) * Math.PI * 2;
    leaf.rotation.x = 1.15 + r() * 0.35;
  }
  for (let i = 0; i < 3; i++) add(g, new THREE.SphereGeometry(0.17, 8, 6), std('#5a3d1f'), px + Math.cos(i * 2) * 0.2, py - 0.2, Math.sin(i * 2) * 0.2);
}

function buildDurianTree(scene: THREE.Scene, x: number, z: number, r: () => number) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  scene.add(g);
  add(g, new THREE.CylinderGeometry(0.22, 0.32, 3.2, 7), std('#6b4e33'), 0, 1.6, 0);
  const leaf = std('#2f6b34', { flatShading: true });
  for (let i = 0; i < 4; i++) {
    const s = 1.3 + r() * 0.7;
    add(g, new THREE.DodecahedronGeometry(s, 0), leaf, (r() - 0.5) * 1.6, 3.6 + r() * 1.2, (r() - 0.5) * 1.6);
  }
  for (let i = 0; i < 4; i++) {
    const a = r() * Math.PI * 2;
    add(g, new THREE.IcosahedronGeometry(0.2, 0), std('#9bae3c', { flatShading: true }), Math.cos(a) * 1.5, 2.9 + r() * 0.6, Math.sin(a) * 1.5);
  }
}

function buildScatter(scene: THREE.Scene, colliders: Collider[]) {
  const r = rng(42);
  const blocked = (x: number, z: number, pad: number) =>
    Math.hypot(x, z) < 12 + pad ||
    Math.hypot((x - 2) / 1.25, z + 29) < 16 + pad ||
    (x > 9 && x < 23 && z > -13 && z < 19) ||
    HUTS.some((h) => Math.hypot(x - h.x, z - h.z) < 4 + pad) ||
    Math.abs(x) < 2.5 + pad ||
    colliders.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + pad);

  // Palms around the shore.
  for (let i = 0, placed = 0; i < 200 && placed < 30; i++) {
    const a = r() * Math.PI * 2;
    const d = 37 + r() * 8;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (z < -36 || blocked(x, z, 1)) continue;
    buildPalm(scene, x, z, r);
    colliders.push({ x, z, r: 0.45 });
    placed++;
  }
  // Durian orchard on the west and south.
  for (let i = 0, placed = 0; i < 200 && placed < 12; i++) {
    const x = -36 + r() * 30;
    const z = -20 + r() * 50;
    if (blocked(x, z, 2)) continue;
    buildDurianTree(scene, x, z, r);
    colliders.push({ x, z, r: 0.6 });
    placed++;
  }
  // Bushes, flowers and pebbles (no colliders, just texture).
  const bushMat = std('#4f8a3c', { flatShading: true });
  for (let i = 0; i < 45; i++) {
    const a = r() * Math.PI * 2;
    const d = 12 + r() * 32;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (blocked(x, z, 0.5)) continue;
    const b = add(scene, new THREE.DodecahedronGeometry(0.5 + r() * 0.5, 0), bushMat, x, 0.3, z);
    b.scale.y = 0.7;
  }
  const flowerGeo = new THREE.SphereGeometry(0.08, 5, 4);
  const flowers = new THREE.InstancedMesh(flowerGeo, new THREE.MeshStandardMaterial({ roughness: 0.8 }), 300);
  const palette = ['#ff6b8b', '#ffd23f', '#ffffff', '#c77dff', '#ff8c42'];
  const m = new THREE.Matrix4();
  let n = 0;
  for (let i = 0; i < 600 && n < 300; i++) {
    const a = r() * Math.PI * 2;
    const d = 11 + r() * 33;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (blocked(x, z, 0)) continue;
    m.makeTranslation(x, 0.1, z);
    flowers.setMatrixAt(n, m);
    flowers.setColorAt(n, new THREE.Color(palette[n % palette.length]!));
    n++;
  }
  flowers.count = n;
  scene.add(flowers);
}

function buildMineProps(scene: THREE.Scene, colliders: Collider[]) {
  // Sign at the foot of the slope.
  const post = std('#6b4a2a');
  add(scene, new THREE.CylinderGeometry(0.08, 0.08, 2.4, 6), post, -2.2, 1.2, -17.5);
  add(scene, new THREE.CylinderGeometry(0.08, 0.08, 2.4, 6), post, 2.2, 1.2, -17.5);
  add(scene, new THREE.BoxGeometry(4.8, 0.25, 0.25), post, 0, 2.45, -17.5);
  const board = add(scene, new THREE.PlaneGeometry(3.6, 0.95), new THREE.MeshStandardMaterial({ map: signTexture('Durian Mine', 'press E at a vein', '#5e3d25') }), 0, 1.9, -17.4, false);
  board.rotation.y = 0;

  // Rails and a mine cart.
  const rail = std('#5a5a5a', { metalness: 0.6, roughness: 0.4 });
  for (const off of [-0.45, 0.45]) {
    const m = add(scene, new THREE.BoxGeometry(0.08, 0.08, 10), rail, -16 + off, 0.06, -31);
    m.rotation.y = 0.35;
  }
  for (let i = 0; i < 9; i++) {
    const m = add(scene, new THREE.BoxGeometry(1.3, 0.06, 0.2), std('#6b4a2a'), -16 + Math.sin(0.35) * (i - 4) * 1.1, 0.03, -31 + Math.cos(0.35) * (i - 4) * 1.1);
    m.rotation.y = 0.35;
  }
  const cart = new THREE.Group();
  cart.position.set(-15.2, 0, -29);
  cart.rotation.y = 0.35;
  add(cart, new THREE.BoxGeometry(1.2, 0.7, 1.6), std('#6e6f73', { metalness: 0.5, roughness: 0.5 }), 0, 0.6, 0);
  for (const [x, z] of [
    [-0.55, -0.5],
    [0.55, -0.5],
    [-0.55, 0.5],
    [0.55, 0.5],
  ] as const) {
    const w = add(cart, new THREE.CylinderGeometry(0.18, 0.18, 0.08, 10), std('#2d2d2d'), x, 0.2, z);
    w.rotation.z = Math.PI / 2;
  }
  for (let i = 0; i < 6; i++) add(cart, new THREE.OctahedronGeometry(0.16, 0), std('#c8743a', { metalness: 0.5, flatShading: true }), (i % 3) * 0.3 - 0.3, 1.0, Math.floor(i / 3) * 0.4 - 0.2);
  scene.add(cart);
  colliders.push({ x: -15.2, z: -29, r: 1.0 });

  // Lanterns on posts.
  for (const [x, z] of [
    [-6, -20],
    [7, -21],
    [-7, -31],
    [9, -32],
  ] as const) {
    add(scene, new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6), post, x, 1.2, z);
    add(scene, new THREE.BoxGeometry(0.25, 0.32, 0.25), new THREE.MeshStandardMaterial({ color: '#ffd27a', emissive: '#ffb347', emissiveIntensity: 1.2 }), x, 2.5, z, false);
  }
}

function buildBenches(scene: THREE.Scene, colliders: Collider[]) {
  const wood = std('#8b5e3c');
  for (const a of [Math.PI * 0.75, Math.PI * 1.25, Math.PI * 0.25]) {
    const x = Math.cos(a) * 6.5;
    const z = Math.sin(a) * 6.5;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = -a + Math.PI / 2;
    add(g, new THREE.BoxGeometry(2, 0.1, 0.5), wood, 0, 0.5, 0);
    add(g, new THREE.BoxGeometry(2, 0.5, 0.08), wood, 0, 0.8, -0.22);
    for (const lx of [-0.85, 0.85]) add(g, new THREE.BoxGeometry(0.1, 0.5, 0.45), std('#5e3d25'), lx, 0.25, 0);
    scene.add(g);
    colliders.push({ x, z, r: 0.9 });
  }
}

/* --------------------------------------------------------------- build */

export function buildWorld(scene: THREE.Scene): World {
  const colliders: Collider[] = [];

  scene.fog = new THREE.Fog('#d9e6e2', 70, 260);
  buildSky(scene);

  const hemi = new THREE.HemisphereLight('#d8ecff', '#6b7a45', 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff0d6', 2.4);
  sun.position.set(28, 42, 22);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -55;
  sc.right = 55;
  sc.top = 55;
  sc.bottom = -55;
  sc.near = 1;
  sc.far = 140;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);

  buildGround(scene);
  buildMountains(scene, colliders);
  buildStatue(scene, colliders);
  buildBunting(scene);
  buildBenches(scene, colliders);
  buildMineProps(scene, colliders);

  const stalls = new Map<string, { x: number; z: number; facing: number }>();
  for (const m of MERCHANTS) stalls.set(m.key, { x: m.x, z: m.z, facing: buildStall(scene, m, colliders) });
  for (const h of HUTS) buildHut(scene, h.x, h.z, h.rot, colliders);

  const rocks = new Map<number, RockObj>();
  MINE_SPOTS.forEach((info, i) => {
    rocks.set(info.spotId, buildRock(scene, info, 1000 + i * 17));
    colliders.push({ x: info.x, z: info.z, r: info.size * 1.05 });
  });

  buildScatter(scene, colliders);

  return {
    colliders,
    rocks,
    stalls,
    update(t: number, dt: number) {
      for (const rock of rocks.values()) {
        // Ore shards shrink and dim while the vein is cooling down, and glint when ready.
        const target = 1 - rock.depleted * 0.7;
        for (const s of rock.shards) {
          const cur = s.scale.x;
          s.scale.setScalar(cur + (target - cur) * Math.min(1, dt * 4));
        }
        const pulse = rock.depleted > 0.5 ? 0.15 : 0.8 + Math.sin(t * 3 + rock.info.spotId) * 0.35;
        rock.shardMat.emissive.copy(rock.baseEmissive).multiplyScalar(pulse);
        if (rock.shake > 0) {
          rock.shake = Math.max(0, rock.shake - dt * 4);
          rock.group.position.x = rock.info.x + Math.sin(t * 90) * 0.05 * rock.shake;
        }
      }
    },
  };
}
