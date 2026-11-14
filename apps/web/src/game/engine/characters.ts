// Procedural low-poly characters: no model files, every limb is a pivot we can animate.
import * as THREE from 'three';
import type { Look } from '../world-data';

export type Pose = 'idle' | 'walk' | 'run' | 'mine' | 'wave' | 'talk';

export interface Character {
  root: THREE.Group;
  /** Rotates with the body; root stays upright so labels don't wobble. */
  body: THREE.Group;
  pose: Pose;
  phase: number;
  /** Seconds left in a one-shot pose (wave, talk) before falling back to idle. */
  poseTimer: number;
  heading: number;
  parts: {
    torso: THREE.Object3D;
    head: THREE.Object3D;
    armL: THREE.Object3D;
    armR: THREE.Object3D;
    legL: THREE.Object3D;
    legR: THREE.Object3D;
    pickaxe?: THREE.Object3D;
  };
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, roughness = 0.85): THREE.MeshStandardMaterial {
  const key = `${color}|${roughness}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
    matCache.set(key, m);
  }
  return m;
}

function mesh(geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** A limb hanging from a pivot at (x, y): rotate the pivot on x to swing it. */
function limb(radius: number, length: number, color: string, x: number, y: number, end?: THREE.Mesh) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, 0);
  const seg = mesh(new THREE.CapsuleGeometry(radius, length - radius * 2, 4, 8), mat(color), 0, -length / 2, 0);
  pivot.add(seg);
  if (end) {
    end.position.y = -length + 0.02;
    pivot.add(end);
  }
  return pivot;
}

export function makePickaxe(): THREE.Group {
  // Handle runs along local +y; the head crosses it along z, i.e. in the swing plane.
  const g = new THREE.Group();
  const handle = mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.85, 6), mat('#7a5230'), 0, 0.3, 0);
  const head = mesh(new THREE.BoxGeometry(0.07, 0.07, 0.6), mat('#9aa3ad', 0.4), 0, 0.7, 0.02);
  const tipF = mesh(new THREE.ConeGeometry(0.05, 0.18, 5), mat('#c3cad1', 0.35), 0, 0.66, 0.38);
  tipF.rotation.x = Math.PI / 2 + 0.25;
  const tipB = mesh(new THREE.ConeGeometry(0.045, 0.14, 5), mat('#c3cad1', 0.35), 0, 0.7, -0.33);
  tipB.rotation.x = -Math.PI / 2;
  g.add(handle, head, tipF, tipB);
  return g;
}

function makeHat(look: Look): THREE.Object3D | null {
  const c = look.hatColor ?? '#c9a46a';
  switch (look.hat) {
    case 'salakot': {
      // Wide conical Filipino hat.
      const g = new THREE.Group();
      const cone = mesh(new THREE.ConeGeometry(0.52, 0.26, 12), mat(c), 0, 0.12, 0);
      const knob = mesh(new THREE.SphereGeometry(0.05, 6, 4), mat('#8a6a3a'), 0, 0.27, 0);
      g.add(cone, knob);
      return g;
    }
    case 'hardhat': {
      const g = new THREE.Group();
      const dome = mesh(new THREE.SphereGeometry(0.27, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(c, 0.45), 0, 0.02, 0);
      const brim = mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.03, 16), mat(c, 0.45), 0, 0.02, 0.02);
      const lamp = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 8), mat('#fff6c8', 0.3), 0, 0.12, 0.25);
      lamp.rotation.x = Math.PI / 2;
      g.add(dome, brim, lamp);
      return g;
    }
    case 'cap': {
      const g = new THREE.Group();
      const dome = mesh(new THREE.SphereGeometry(0.255, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(c), 0, 0.02, 0);
      const bill = mesh(new THREE.BoxGeometry(0.26, 0.025, 0.2), mat(c), 0, 0.03, 0.27);
      g.add(dome, bill);
      return g;
    }
    case 'bandana': {
      const band = mesh(new THREE.CylinderGeometry(0.255, 0.255, 0.1, 14), mat(c), 0, 0.03, 0);
      return band;
    }
    case 'bun': {
      return mesh(new THREE.SphereGeometry(0.11, 8, 6), mat(look.hair), 0, 0.12, -0.2);
    }
    default:
      return null;
  }
}

export function makeCharacter(look: Look): Character {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const s = look.scale ?? 1;
  body.scale.setScalar(s);

  // Torso (slightly flattened capsule) with hips.
  const torso = new THREE.Group();
  torso.position.y = 1.12;
  const chest = mesh(new THREE.CapsuleGeometry(0.25, 0.32, 4, 10), mat(look.shirt), 0, 0.08, 0);
  chest.scale.set(1, 1, 0.72);
  const hips = mesh(new THREE.CylinderGeometry(0.22, 0.2, 0.16, 10), mat(look.pants), 0, -0.2, 0);
  hips.scale.z = 0.8;
  torso.add(chest, hips);
  if (look.apron) {
    const apron = mesh(new THREE.BoxGeometry(0.36, 0.5, 0.02), mat(look.apron), 0, -0.05, 0.19);
    torso.add(apron);
  }
  if (look.backpack) {
    const pack = mesh(new THREE.BoxGeometry(0.34, 0.4, 0.18), mat('#7a5a3a'), 0, 0.08, -0.25);
    const roll = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.36, 8), mat('#3e5a4a'), 0, 0.33, -0.25);
    roll.rotation.z = Math.PI / 2;
    torso.add(pack, roll);
  }

  // Head with a face, so you can tell which way people look.
  const head = new THREE.Group();
  head.position.y = 1.72;
  const skull = mesh(new THREE.SphereGeometry(0.24, 16, 12), mat(look.skin), 0, 0, 0);
  const hair = mesh(
    new THREE.SphereGeometry(0.25, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
    mat(look.hair),
    0,
    0.02,
    -0.015,
  );
  const eyeMat = mat('#16110d', 0.3);
  const eyeL = mesh(new THREE.SphereGeometry(0.03, 6, 6), eyeMat, -0.08, 0.02, 0.215);
  const eyeR = mesh(new THREE.SphereGeometry(0.03, 6, 6), eyeMat, 0.08, 0.02, 0.215);
  const nose = mesh(new THREE.SphereGeometry(0.035, 6, 6), mat(look.skin), 0, -0.04, 0.235);
  head.add(skull, hair, eyeL, eyeR, nose);
  if (look.mustache) {
    const stache = mesh(new THREE.BoxGeometry(0.16, 0.035, 0.03), mat(look.hair), 0, -0.1, 0.225);
    head.add(stache);
  }
  const hat = makeHat(look);
  if (hat) {
    hat.position.y += 0.12;
    head.add(hat);
  }
  const neck = mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.14, 8), mat(look.skin), 0, 1.5, 0);

  // Limbs.
  const hand = () => mesh(new THREE.SphereGeometry(0.075, 8, 6), mat(look.skin));
  const shoe = () => {
    const m = mesh(new THREE.BoxGeometry(0.15, 0.09, 0.26), mat('#2a211b'));
    m.position.z = 0.05;
    return m;
  };
  const armL = limb(0.075, 0.62, look.shirt, -0.33, 1.42, hand());
  const armR = limb(0.075, 0.62, look.shirt, 0.33, 1.42, hand());
  const legL = limb(0.095, 0.86, look.pants, -0.12, 0.9, shoe());
  const legR = limb(0.095, 0.86, look.pants, 0.12, 0.9, shoe());

  let pickaxe: THREE.Object3D | undefined;
  if (look.pickaxe) {
    pickaxe = makePickaxe();
    // Held in the right hand, handle angled 45 degrees forward of the arm, so it rests
    // forward-down when idle and lands forward-down at the bottom of a swing.
    pickaxe.position.set(0, -0.6, 0.02);
    pickaxe.rotation.set((Math.PI * 3) / 4, 0, 0);
    armR.add(pickaxe);
  }

  body.add(torso, head, neck, armL, armR, legL, legR);

  // Soft blob shadow helps characters feel grounded even where real shadows are faint.
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.42 * s, 16),
    new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.18, depthWrite: false }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.02;
  root.add(blob);

  return {
    root,
    body,
    pose: 'idle',
    phase: Math.random() * 10,
    poseTimer: 0,
    heading: 0,
    parts: { torso, head, armL, armR, legL, legR, pickaxe },
  };
}

/** One-shot pose that returns to idle after `seconds`. */
export function playPose(c: Character, pose: Pose, seconds: number) {
  c.pose = pose;
  c.poseTimer = seconds;
  c.phase = 0;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Advance a character's animation. `speed` is ground speed in m/s (drives walk cycles). */
export function animateCharacter(c: Character, dt: number, speed: number) {
  if (c.poseTimer > 0) {
    c.poseTimer -= dt;
    if (c.poseTimer <= 0) c.pose = 'idle';
  }
  if (c.pose === 'idle' || c.pose === 'walk' || c.pose === 'run') {
    c.pose = speed > 5.5 ? 'run' : speed > 0.3 ? 'walk' : 'idle';
  }

  const { torso, head, armL, armR, legL, legR } = c.parts;
  const k = Math.min(1, dt * 12); // smoothing toward target angles
  let tArmL = 0,
    tArmR = 0,
    tLegL = 0,
    tLegR = 0,
    tArmRz = 0,
    tArmLz = 0,
    bob = 0,
    lean = 0;

  switch (c.pose) {
    case 'idle': {
      c.phase += dt * 1.6;
      bob = Math.sin(c.phase) * 0.012;
      tArmL = Math.sin(c.phase) * 0.04;
      tArmR = -Math.sin(c.phase) * 0.04;
      tArmLz = 0.06;
      tArmRz = -0.06;
      break;
    }
    case 'walk':
    case 'run': {
      const run = c.pose === 'run';
      c.phase += dt * speed * (run ? 1.55 : 2.1);
      const sw = Math.sin(c.phase) * (run ? 0.95 : 0.6);
      tLegL = sw;
      tLegR = -sw;
      tArmL = -sw * 0.9;
      tArmR = sw * 0.9;
      tArmLz = 0.08;
      tArmRz = -0.08;
      bob = Math.abs(Math.cos(c.phase)) * (run ? 0.07 : 0.04);
      lean = run ? 0.16 : 0.05;
      break;
    }
    case 'mine': {
      // Raise the pickaxe overhead, then bring it down hard. ~0.4 s per swing.
      c.phase += dt;
      const t = (c.phase % 0.4) / 0.4;
      const swing = t < 0.55 ? lerp(-0.4, -2.7, t / 0.55) : lerp(-2.7, -0.3, (t - 0.55) / 0.45);
      tArmR = swing;
      tArmL = swing * 0.8;
      tArmLz = 0.25;
      tArmRz = -0.25;
      tLegL = 0.25;
      tLegR = -0.15;
      lean = t < 0.55 ? -0.08 : 0.22;
      bob = -0.03;
      break;
    }
    case 'wave': {
      c.phase += dt * 10;
      tArmR = -2.9;
      tArmRz = -0.3 + Math.sin(c.phase) * 0.35;
      tArmLz = 0.06;
      bob = Math.sin(c.phase * 0.5) * 0.01;
      break;
    }
    case 'talk': {
      c.phase += dt * 7;
      tArmR = -0.6 + Math.sin(c.phase) * 0.25;
      tArmL = -0.3 + Math.cos(c.phase * 0.8) * 0.2;
      tArmLz = 0.1;
      tArmRz = -0.1;
      bob = Math.abs(Math.sin(c.phase)) * 0.015;
      break;
    }
  }

  // The pickaxe-holding arm needs a pose even when idle, or the tool clips into the leg.
  if (c.parts.pickaxe && c.pose !== 'mine' && c.pose !== 'wave') {
    tArmR = Math.min(tArmR, -0.15) * 0.7 - 0.15;
  }

  armL.rotation.x = lerp(armL.rotation.x, tArmL, k);
  armR.rotation.x = lerp(armR.rotation.x, tArmR, k);
  armL.rotation.z = lerp(armL.rotation.z, tArmLz, k);
  armR.rotation.z = lerp(armR.rotation.z, tArmRz, k);
  legL.rotation.x = lerp(legL.rotation.x, tLegL, k);
  legR.rotation.x = lerp(legR.rotation.x, tLegR, k);
  c.body.position.y = lerp(c.body.position.y, bob, k);
  torso.rotation.x = lerp(torso.rotation.x, lean, k);
  head.rotation.x = lerp(head.rotation.x, lean * 0.4, k);

  // Turn smoothly toward heading, taking the short way around.
  let d = c.heading - c.body.rotation.y;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  c.body.rotation.y += d * Math.min(1, dt * 10);
}

/** Heading (radians) that makes a character at (x,z) face (tx,tz). */
export const headingTo = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z);
