// The 3D side of the game: rendering, movement, camera, NPCs and effects.
// It knows nothing about the blockchain. React tells it what's on-chain (cooldowns) and
// it tells React what the player is doing (focused target, interact, swing finished).
import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import {
  MERCHANTS,
  MINE_SPOTS,
  PLAYER_LOOK,
  SPAWN,
  SWING_SECONDS,
  VILLAGERS,
  WORLD_RADIUS,
  type MerchantKey,
} from '../world-data';
import { animateCharacter, headingTo, makeCharacter, playPose, type Character } from './characters';
import { sfx } from './sfx';
import { buildWorld, type World } from './world';

export type Target =
  | { kind: 'spot'; spotId: number; name: string }
  | { kind: 'merchant'; key: MerchantKey; name: string }
  | { kind: 'villager'; index: number; name: string };

export interface GameEvents {
  onTarget(target: Target | null): void;
  onInteract(target: Target): void;
  onSwingDone(spotId: number): void;
}

interface Npc {
  c: Character;
  pos: THREE.Vector3;
  label: CSS2DObject;
  bubble: CSS2DObject;
  bubbleTimer: number;
}

interface Villager extends Npc {
  index: number;
  goal: THREE.Vector3 | null;
  wait: number;
  speed: number;
}

interface Merchant extends Npc {
  key: MerchantKey;
  home: number; // facing when idle
  greeted: boolean;
}

interface Spark {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
}

interface Floater {
  obj: CSS2DObject;
  life: number;
  y0: number;
}

const PLAYER_RADIUS = 0.4;
const WALK = 4.2;
const RUN = 7.5;

function div(className: string, text = '') {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  return el;
}

export class Game {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1200);
  private renderer: THREE.WebGLRenderer;
  private labels = new CSS2DRenderer();
  private world: World;
  private container: HTMLElement;
  private events: GameEvents;

  readonly player: Character;
  readonly pos = new THREE.Vector3(SPAWN.x, 0, SPAWN.z);
  private speed = 0;
  private keys = new Set<string>();
  private inputEnabled = true;

  camYaw: number = SPAWN.heading + Math.PI;
  camPitch = 0.42;
  camDist = 9.5;
  private camTarget = new THREE.Vector3();
  private shake = 0;
  private drag: { x: number; y: number } | null = null;

  private villagers: Villager[] = [];
  private merchants: Merchant[] = [];
  private sparks: Spark[] = [];
  private floaters: Floater[] = [];
  private rockTags = new Map<number, CSS2DObject>();
  /** Unix seconds when each spot is ready again, from the chain. */
  private spotReadyAt = new Map<number, number>();

  private swing: { spotId: number; t: number; hits: number } | null = null;
  private target: Target | null = null;
  private time = 0;
  private raf = 0;
  private disposed = false;
  private resizeObserver: ResizeObserver;

  constructor(container: HTMLElement, events: GameEvents) {
    this.container = container;
    this.events = events;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.className = 'game-canvas';
    container.appendChild(this.renderer.domElement);

    this.labels.domElement.className = 'game-labels';
    container.appendChild(this.labels.domElement);

    this.world = buildWorld(this.scene);

    this.player = makeCharacter(PLAYER_LOOK);
    this.player.heading = SPAWN.heading;
    this.player.body.rotation.y = SPAWN.heading;
    this.scene.add(this.player.root);

    this.spawnMerchants();
    this.spawnVillagers();
    this.makeRockTags();
    this.makeSparkPool();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.bindInput();

    let last = performance.now();
    const loop = (now: number) => {
      if (this.disposed) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.step(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /* ------------------------------------------------------------- public API */

  setInputEnabled(enabled: boolean) {
    this.inputEnabled = enabled;
    if (!enabled) this.keys.clear();
  }

  setSpotReadyAt(readyAt: Map<number, number>) {
    this.spotReadyAt = readyAt;
  }

  isSwinging() {
    return this.swing !== null;
  }

  /** Face the rock and swing for SWING_SECONDS; then onSwingDone fires. */
  startMining(spotId: number): boolean {
    if (this.swing) return false;
    const rock = this.world.rocks.get(spotId);
    if (!rock) return false;
    this.player.heading = headingTo(this.pos.x, this.pos.z, rock.info.x, rock.info.z);
    playPose(this.player, 'mine', SWING_SECONDS + 0.1);
    this.swing = { spotId, t: 0, hits: 0 };
    return true;
  }

  /** Floating text above a rock, a merchant, or the player. */
  floatText(at: { spotId: number } | { merchant: MerchantKey } | 'player', text: string, tone: 'gold' | 'ore' | 'bad' | 'info', delay = 0) {
    let p: THREE.Vector3;
    if (at === 'player') p = this.pos.clone().add(new THREE.Vector3(0, 2.4, 0));
    else if ('spotId' in at) {
      const rock = this.world.rocks.get(at.spotId)!;
      p = new THREE.Vector3(rock.info.x, rock.top + 0.6, rock.info.z);
    } else {
      const m = this.merchants.find((x) => x.key === at.merchant)!;
      p = m.pos.clone().add(new THREE.Vector3(0, 2.6, 0));
    }
    const el = div(`float-text float-text--${tone}`, text);
    const obj = new CSS2DObject(el);
    obj.position.copy(p);
    setTimeout(() => {
      if (this.disposed) return;
      this.scene.add(obj);
      this.floaters.push({ obj, life: 0, y0: p.y });
    }, delay);
  }

  /** Speech bubble over a merchant. */
  merchantSay(key: MerchantKey, text: string, seconds = 3.5, pose: 'talk' | 'wave' = 'talk') {
    const m = this.merchants.find((x) => x.key === key);
    if (!m) return;
    this.say(m, text, seconds);
    playPose(m.c, pose, Math.min(seconds, 2));
  }

  getPose() {
    return { x: this.pos.x, z: this.pos.z, heading: this.player.body.rotation.y, camYaw: this.camYaw };
  }

  getVillagerPositions() {
    return this.villagers.map((v) => ({ x: v.pos.x, z: v.pos.z }));
  }

  /** Testing hook: teleport next to something. */
  teleport(x: number, z: number, heading?: number) {
    this.pos.set(x, 0, z);
    if (heading !== undefined) {
      this.player.heading = heading;
      this.player.body.rotation.y = heading;
      this.camYaw = heading + Math.PI;
    }
  }

  /** Testing hook: run the simulation without waiting for animation frames. */
  advance(seconds: number) {
    const steps = Math.ceil(seconds / (1 / 30));
    for (let i = 0; i < steps; i++) this.step(1 / 30, i === steps - 1);
  }

  pressKey(code: string, down: boolean) {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.unbindInput();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.domElement.remove();
  }

  /* ---------------------------------------------------------------- setup */

  private say(npc: Npc, text: string, seconds: number) {
    npc.bubble.element.textContent = text;
    npc.bubble.element.classList.add('bubble--show');
    npc.bubbleTimer = seconds;
  }

  private makeLabels(c: Character, name: string, title?: string) {
    const tag = div('nametag');
    tag.append(div('nametag__name', name));
    if (title) tag.append(div('nametag__title', title));
    const label = new CSS2DObject(tag);
    label.position.set(0, 2.25 * (c.body.scale.y || 1), 0);
    c.root.add(label);
    const bubble = new CSS2DObject(div('bubble'));
    bubble.position.set(0, 2.75 * (c.body.scale.y || 1), 0);
    c.root.add(bubble);
    return { label, bubble };
  }

  private spawnMerchants() {
    for (const info of MERCHANTS) {
      const stall = this.world.stalls.get(info.key)!;
      const c = makeCharacter(info.look);
      c.root.position.set(stall.x, 0, stall.z);
      c.heading = stall.facing;
      c.body.rotation.y = stall.facing;
      this.scene.add(c.root);
      const { label, bubble } = this.makeLabels(c, info.name, info.title);
      label.position.y += 0.2;
      bubble.position.y += 0.2;
      this.merchants.push({ c, pos: c.root.position, label, bubble, bubbleTimer: 0, key: info.key, home: stall.facing, greeted: false });
    }
  }

  private spawnVillagers() {
    VILLAGERS.forEach((info, index) => {
      const c = makeCharacter(info.look);
      const a = (index / VILLAGERS.length) * Math.PI * 2 + 0.7;
      c.root.position.set(Math.cos(a) * 6, 0, Math.sin(a) * 6);
      this.scene.add(c.root);
      const { label, bubble } = this.makeLabels(c, info.name);
      this.villagers.push({ c, pos: c.root.position, label, bubble, bubbleTimer: 0, index, goal: null, wait: Math.random() * 3, speed: 1.3 + Math.random() * 0.5 });
    });
  }

  private makeRockTags() {
    for (const info of MINE_SPOTS) {
      const rock = this.world.rocks.get(info.spotId)!;
      const tag = new CSS2DObject(div('rock-tag'));
      tag.position.set(0, rock.top + 0.2, 0);
      rock.group.add(tag);
      this.rockTags.set(info.spotId, tag);
    }
  }

  private makeSparkPool() {
    const geo = new THREE.BoxGeometry(0.07, 0.07, 0.07);
    for (let i = 0; i < 48; i++) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#ffd27a' }));
      mesh.visible = false;
      this.scene.add(mesh);
      this.sparks.push({ mesh, vel: new THREE.Vector3(), life: 0 });
    }
  }

  private burst(at: THREE.Vector3, color: THREE.ColorRepresentation, n: number) {
    let made = 0;
    for (const s of this.sparks) {
      if (s.life > 0) continue;
      s.mesh.visible = true;
      s.mesh.position.copy(at);
      (s.mesh.material as THREE.MeshBasicMaterial).color.set(color);
      s.vel.set((Math.random() - 0.5) * 5, 2 + Math.random() * 4, (Math.random() - 0.5) * 5);
      s.life = 0.5 + Math.random() * 0.4;
      if (++made >= n) break;
    }
  }

  /* ---------------------------------------------------------------- input */

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.inputEnabled) return;
    if ((e.target as HTMLElement | null)?.closest?.('input, textarea')) return;
    this.keys.add(e.code);
    if (e.code === 'KeyE' && !e.repeat && this.target && !this.swing) this.events.onInteract(this.target);
    if (e.code === 'Space') e.preventDefault();
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private onBlur = () => this.keys.clear();
  private onPointerDown = (e: PointerEvent) => {
    if (!this.inputEnabled) return;
    this.drag = { x: e.clientX, y: e.clientY };
    this.renderer.domElement.setPointerCapture(e.pointerId);
  };
  private onPointerMove = (e: PointerEvent) => {
    if (!this.drag) return;
    const dx = e.clientX - this.drag.x;
    const dy = e.clientY - this.drag.y;
    this.drag = { x: e.clientX, y: e.clientY };
    this.camYaw -= dx * 0.006;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch + dy * 0.004, 0.08, 1.25);
  };
  private onPointerUp = () => (this.drag = null);
  private onWheel = (e: WheelEvent) => {
    if (!this.inputEnabled) return;
    this.camDist = THREE.MathUtils.clamp(this.camDist + Math.sign(e.deltaY) * 0.8, 4, 18);
  };
  private onContextMenu = (e: Event) => e.preventDefault();

  private bindInput() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('wheel', this.onWheel, { passive: true });
    el.addEventListener('contextmenu', this.onContextMenu);
  }

  private unbindInput() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  private resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /* ----------------------------------------------------------------- loop */

  private step(dt: number, render = true) {
    this.time += dt;
    this.updatePlayer(dt);
    this.updateSwing(dt);
    this.updateNpcs(dt);
    this.updateRocks();
    this.updateEffects(dt);
    this.world.update(this.time, dt);
    this.updateTarget();
    this.updateCamera(dt);
    if (render) {
      this.renderer.render(this.scene, this.camera);
      this.labels.render(this.scene, this.camera);
    }
  }

  private collide(p: THREE.Vector3, radius: number) {
    for (const c of this.world.colliders) {
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const min = c.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        p.x = c.x + (dx / d) * min;
        p.z = c.z + (dz / d) * min;
      }
    }
    const r = Math.hypot(p.x, p.z);
    if (r > WORLD_RADIUS) {
      p.x *= WORLD_RADIUS / r;
      p.z *= WORLD_RADIUS / r;
    }
  }

  private updatePlayer(dt: number) {
    let fwd = 0,
      right = 0;
    if (this.inputEnabled && !this.swing) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fwd += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fwd -= 1;
      if (this.keys.has('KeyD')) right += 1;
      if (this.keys.has('KeyA')) right -= 1;
      if (this.keys.has('ArrowLeft')) this.camYaw += dt * 2.2;
      if (this.keys.has('ArrowRight')) this.camYaw -= dt * 2.2;
    }
    const sy = Math.sin(this.camYaw);
    const cy = Math.cos(this.camYaw);
    let mx = -sy * fwd + cy * right;
    let mz = -cy * fwd - sy * right;
    const len = Math.hypot(mx, mz);
    const running = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const targetSpeed = len > 0 ? (running ? RUN : WALK) : 0;
    this.speed += (targetSpeed - this.speed) * Math.min(1, dt * 10);
    if (len > 0) {
      mx /= len;
      mz /= len;
      this.player.heading = Math.atan2(mx, mz);
    }
    if (this.speed > 0.01) {
      const h = this.player.heading;
      const moving = len > 0 ? 1 : 0.6; // glide to a stop in the facing direction
      this.pos.x += Math.sin(h) * this.speed * dt * moving;
      this.pos.z += Math.cos(h) * this.speed * dt * moving;
    }
    this.collide(this.pos, PLAYER_RADIUS);
    // Villagers are soft obstacles too.
    for (const v of this.villagers) {
      const dx = this.pos.x - v.pos.x;
      const dz = this.pos.z - v.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.8 && d > 1e-4) {
        this.pos.x = v.pos.x + (dx / d) * 0.8;
        this.pos.z = v.pos.z + (dz / d) * 0.8;
      }
    }
    this.player.root.position.copy(this.pos);
    animateCharacter(this.player, dt, this.swing ? 0 : this.speed);
  }

  private updateSwing(dt: number) {
    if (!this.swing) return;
    const s = this.swing;
    s.t += dt;
    const rock = this.world.rocks.get(s.spotId)!;
    // A hit lands near the bottom of each 0.4 s swing.
    const hitsDue = Math.floor((s.t + 0.18) / 0.4);
    if (hitsDue > s.hits && s.t < SWING_SECONDS) {
      s.hits = hitsDue;
      const toward = new THREE.Vector3(this.pos.x - rock.info.x, 0, this.pos.z - rock.info.z).normalize();
      const at = new THREE.Vector3(rock.info.x, rock.info.size * 0.9, rock.info.z).addScaledVector(toward, rock.info.size * 0.8);
      this.burst(at, rock.shardMat.color, 7);
      rock.shake = 1;
      this.shake = 0.25;
      sfx.hit();
    }
    if (s.t >= SWING_SECONDS) {
      this.swing = null;
      this.events.onSwingDone(s.spotId);
    }
  }

  private updateNpcs(dt: number) {
    for (const v of this.villagers) {
      if (v.bubbleTimer > 0) {
        v.bubbleTimer -= dt;
        if (v.bubbleTimer <= 0) v.bubble.element.classList.remove('bubble--show');
      }
      let speed = 0;
      const talking = v.bubbleTimer > 0;
      if (talking) {
        v.c.heading = headingTo(v.pos.x, v.pos.z, this.pos.x, this.pos.z);
      } else if (v.wait > 0) {
        v.wait -= dt;
      } else if (!v.goal) {
        // Wander within the plaza and market, avoiding the statue.
        const a = Math.random() * Math.PI * 2;
        const d = 4 + Math.random() * 9;
        v.goal = new THREE.Vector3(Math.cos(a) * d + 2, 0, Math.sin(a) * d);
      } else {
        const dx = v.goal.x - v.pos.x;
        const dz = v.goal.z - v.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.4) {
          v.goal = null;
          v.wait = 2 + Math.random() * 5;
        } else {
          v.c.heading = Math.atan2(dx, dz);
          speed = v.speed;
          const before = v.pos.clone();
          v.pos.x += (dx / d) * speed * dt;
          v.pos.z += (dz / d) * speed * dt;
          this.collide(v.pos, 0.35);
          if (Math.hypot(this.pos.x - v.pos.x, this.pos.z - v.pos.z) < 0.8) v.pos.copy(before);
          // Stuck against something? Pick a new goal.
          if (before.distanceTo(v.pos) < speed * dt * 0.3) v.goal = null;
        }
      }
      animateCharacter(v.c, dt, speed);
      v.label.visible = this.pos.distanceTo(v.pos) < 22;
    }

    for (const m of this.merchants) {
      if (m.bubbleTimer > 0) {
        m.bubbleTimer -= dt;
        if (m.bubbleTimer <= 0) m.bubble.element.classList.remove('bubble--show');
      }
      const d = this.pos.distanceTo(m.pos);
      // Look at the player when they come close; otherwise face the plaza.
      m.c.heading = d < 7 ? headingTo(m.pos.x, m.pos.z, this.pos.x, this.pos.z) : m.home;
      const lim = 1.1;
      let rel = m.c.heading - m.home;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      m.c.heading = m.home + THREE.MathUtils.clamp(rel, -lim, lim);
      if (d < 5.5 && !m.greeted) {
        m.greeted = true;
        const info = MERCHANTS.find((x) => x.key === m.key)!;
        this.say(m, info.lines.greet[Math.floor(Math.random() * info.lines.greet.length)]!, 3.5);
        playPose(m.c, 'wave', 1.4);
      }
      if (d > 10) m.greeted = false;
      animateCharacter(m.c, dt, 0);
      m.label.visible = d < 30;
    }
  }

  private updateRocks() {
    const now = Date.now() / 1000;
    for (const info of MINE_SPOTS) {
      const rock = this.world.rocks.get(info.spotId)!;
      const readyAt = this.spotReadyAt.get(info.spotId) ?? 0;
      const left = Math.ceil(readyAt - now);
      rock.depleted = left > 0 ? 1 : 0;
      const tag = this.rockTags.get(info.spotId)!;
      const d = Math.hypot(this.pos.x - info.x, this.pos.z - info.z);
      tag.visible = d < 12;
      const text = left > 0 ? `${info.name} · ${left}s` : info.name;
      if (tag.element.textContent !== text) tag.element.textContent = text;
      tag.element.classList.toggle('rock-tag--cooling', left > 0);
    }
  }

  private updateEffects(dt: number) {
    for (const s of this.sparks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      s.vel.y -= 14 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += dt * 9;
      if (s.life <= 0 || s.mesh.position.y < 0) {
        s.life = 0;
        s.mesh.visible = false;
      }
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i]!;
      f.life += dt;
      f.obj.position.y = f.y0 + f.life * 0.9;
      f.obj.element.style.opacity = String(Math.max(0, 1 - Math.max(0, f.life - 1.2) / 0.6));
      if (f.life > 1.8) {
        this.scene.remove(f.obj);
        f.obj.element.remove();
        this.floaters.splice(i, 1);
      }
    }
  }

  private updateTarget() {
    let best: Target | null = null;
    let bestScore = Infinity;
    if (!this.swing) {
      for (const info of MINE_SPOTS) {
        const d = Math.hypot(this.pos.x - info.x, this.pos.z - info.z) - info.size;
        if (d < 1.6 && d < bestScore) {
          bestScore = d;
          best = { kind: 'spot', spotId: info.spotId, name: info.name };
        }
      }
      for (const m of this.merchants) {
        const d = this.pos.distanceTo(m.pos) - 1.6;
        if (d < 1.9 && d < bestScore) {
          bestScore = d;
          best = { kind: 'merchant', key: m.key, name: MERCHANTS.find((x) => x.key === m.key)!.name };
        }
      }
      for (const v of this.villagers) {
        const d = this.pos.distanceTo(v.pos) - 0.4;
        if (d < 1.4 && d < bestScore) {
          bestScore = d;
          best = { kind: 'villager', index: v.index, name: VILLAGERS[v.index]!.name };
        }
      }
    }
    const same =
      best === this.target ||
      (best !== null &&
        this.target !== null &&
        best.kind === this.target.kind &&
        JSON.stringify(best) === JSON.stringify(this.target));
    if (!same) {
      this.target = best;
      this.events.onTarget(best);
    }
  }

  /** Villager chat is pure flavor, so the game handles it without React. */
  villagerTalk(index: number) {
    const v = this.villagers[index];
    const info = VILLAGERS[index];
    if (!v || !info) return;
    this.say(v, info.lines[Math.floor(Math.random() * info.lines.length)]!, 4);
    v.goal = null;
    v.wait = 4;
    playPose(v.c, 'wave', 1.2);
  }

  private updateCamera(dt: number) {
    const desired = this.pos.clone().add(new THREE.Vector3(0, 1.6, 0));
    this.camTarget.lerp(desired, Math.min(1, dt * 8));
    if (this.camTarget.lengthSq() === 0 || this.time < 0.1) this.camTarget.copy(desired);
    const cp = Math.cos(this.camPitch);
    const offset = new THREE.Vector3(Math.sin(this.camYaw) * cp, Math.sin(this.camPitch), Math.cos(this.camYaw) * cp).multiplyScalar(this.camDist);
    this.camera.position.copy(this.camTarget).add(offset);
    if (this.camera.position.y < 0.5) this.camera.position.y = 0.5;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2);
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.25;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.25;
    }
    this.camera.lookAt(this.camTarget);
  }
}
