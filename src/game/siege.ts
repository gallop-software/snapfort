import type { BuildState } from "./buildState";
import { CELL, WORLD_HALF_CELLS } from "./constants";
import { pieceTransform, type Piece, type PieceType } from "./pieces";
import { findUnsupported } from "./structure";

/**
 * Siege mode: an army charges the builder and batters down whatever is in its
 * way. Nobody gets hurt; a soldier who reaches the builder captures them and
 * the game is over. Plain logic, no rendering, so it can be tested and later
 * run on a server.
 *
 * Soldiers stay on the ground. A builder standing higher than they can reach is
 * safe until the army knocks out the pieces underneath: anything that no longer
 * connects to the ground falls.
 */

export const SIEGE = {
  /** Seconds to build before the first wave. */
  firstWaveDelay: 40,
  /** Seconds between waves. */
  waveGap: 35,
  /** How far from the builder a wave appears, in metres. */
  spawnDistance: 95,
  maxSoldiers: 600,
  /** A soldier this close to the builder (in metres, on the ground) captures them. */
  captureRange: 1.1,
  /** The builder's feet must be below this height to be caught or chased directly. */
  reachHeight: 1.7,
  hitInterval: 0.7,
  /** Shortest time between two hits on one piece: only a few soldiers can get at it at once. */
  pieceHitGap: 0.175,
  soldierRadius: 0.45,
};

/** Hits a piece takes before it breaks. */
export const PIECE_HITS: Record<PieceType, number> = { wall: 24, floor: 24, ramp: 16, roof: 24 };

export function waveSize(wave: number): number {
  return 10 + wave * 8;
}

export function soldierSpeed(wave: number): number {
  return Math.min(6, 3.2 + wave * 0.2);
}

export interface Soldier {
  x: number;
  z: number;
  /** Direction faced, radians, 0 = toward +z. */
  heading: number;
  /** True while battering a piece. */
  attacking: boolean;
  /** Seconds until the next hit. */
  cooldown: number;
  /** Per-soldier pace, around 1. */
  pace: number;
  /** Random offset so the army does not move in step. */
  phase: number;
  retarget: number;
  targetId: string | undefined;
}

export interface SiegeHooks {
  /** A piece was hit; `damage` runs from 0 (new) to 1 (about to break). */
  hit?(piece: Piece, damage: number): void;
  /** A piece was battered down, or fell because nothing held it up any more. */
  destroyed?(piece: Piece, fell: boolean): void;
  wave?(wave: number, soldiers: number): void;
}

export class Siege {
  readonly soldiers: Soldier[] = [];
  wave = 0;
  /** Seconds survived. */
  elapsed = 0;
  /** Seconds until the next wave. */
  nextWave = SIEGE.firstWaveDelay;
  captured = false;
  /** When false the siege does nothing (free build). */
  active = false;

  private readonly hits = new Map<string, number>();
  private readonly lastHit = new Map<string, number>();
  /** Pieces standing on the ground that block the army: what it goes for when the builder is out of reach. */
  private readonly ground = new Map<string, Piece>();
  private structureDirty = false;

  constructor(
    private readonly state: BuildState,
    private readonly hooks: SiegeHooks = {},
    private readonly rand: () => number = Math.random,
  ) {
    for (const piece of state.all()) this.track(piece);
    state.subscribe((op, piece) => {
      if (op.kind === "place") this.track(piece);
      else if (op.kind === "edit") {
        if (this.ground.has(piece.id)) this.ground.set(piece.id, piece);
      } else {
        this.ground.delete(piece.id);
        this.hits.delete(piece.id);
        this.lastHit.delete(piece.id);
        this.structureDirty = true;
      }
    });
  }

  /** Starts a new siege from nothing. */
  reset(active: boolean): void {
    this.soldiers.length = 0;
    this.hits.clear();
    this.lastHit.clear();
    this.wave = 0;
    this.elapsed = 0;
    this.nextWave = SIEGE.firstWaveDelay;
    this.captured = false;
    this.active = active;
    this.structureDirty = false;
  }

  /** How battered a piece is, 0 to 1. */
  damage(piece: Piece): number {
    return (this.hits.get(piece.id) ?? 0) / PIECE_HITS[piece.type];
  }

  /**
   * Advances the siege. `px, pz` is where the builder stands and `feetY` how
   * high their feet are above the ground.
   */
  update(dt: number, px: number, feetY: number, pz: number): void {
    if (!this.active || this.captured) return;
    this.elapsed += dt;
    this.nextWave -= dt;
    if (this.nextWave <= 0) {
      this.nextWave = SIEGE.waveGap;
      this.spawnWave(px, pz);
    }
    if (this.structureDirty) this.collapse();

    const reachable = feetY < SIEGE.reachHeight;
    const baseSpeed = soldierSpeed(this.wave);
    const crowd = this.bucketSoldiers();
    const r = SIEGE.soldierRadius;

    for (const s of this.soldiers) {
      const toPlayerX = px - s.x, toPlayerZ = pz - s.z;
      if (reachable && toPlayerX * toPlayerX + toPlayerZ * toPlayerZ < SIEGE.captureRange * SIEGE.captureRange) {
        this.captured = true;
        return;
      }

      s.retarget -= dt;
      if (s.retarget <= 0) {
        s.retarget = 0.4 + this.rand() * 0.4;
        s.targetId = reachable ? undefined : this.nearestGroundPiece(s.x, s.z)?.id;
      }
      const target = s.targetId ? this.state.get(s.targetId) : undefined;
      let tx = px, tz = pz;
      if (target) {
        const t = pieceTransform(target);
        tx = t.px;
        tz = t.pz;
      }
      const dx = tx - s.x, dz = tz - s.z;
      const dist = Math.hypot(dx, dz);
      let blocker: Piece | undefined;

      if (target && dist < 1.4) {
        blocker = target;
      } else if (dist > 0.05) {
        // Head for the target, nudged apart from neighbours so the army spreads along a wall.
        let vx = (dx / dist) * baseSpeed * s.pace;
        let vz = (dz / dist) * baseSpeed * s.pace;
        const cell = crowd.get(bucketKey(s.x, s.z));
        if (cell) {
          for (const o of cell) {
            if (o === s) continue;
            const ox = s.x - o.x, oz = s.z - o.z;
            const d2 = ox * ox + oz * oz;
            if (d2 < 1 && d2 > 1e-6) {
              const push = (1 - Math.sqrt(d2)) * 3;
              vx += (ox / Math.sqrt(d2)) * push;
              vz += (oz / Math.sqrt(d2)) * push;
            }
          }
        }
        const cx = Math.floor(s.x / CELL), cz = Math.floor(s.z / CELL);
        const nx = s.x + vx * dt;
        const leadX = Math.floor((nx + Math.sign(vx) * r) / CELL);
        const hitX = leadX === cx ? undefined : this.blockerBetween(cx, cz, leadX, cz);
        if (hitX) blocker = hitX;
        else s.x = nx;
        const nz = s.z + vz * dt;
        const cx2 = Math.floor(s.x / CELL);
        const leadZ = Math.floor((nz + Math.sign(vz) * r) / CELL);
        const hitZ = leadZ === cz ? undefined : this.blockerBetween(cx2, cz, cx2, leadZ);
        if (hitZ) {
          // Prefer the piece that is more squarely in the way.
          if (!blocker || Math.abs(dz) > Math.abs(dx)) blocker = hitZ;
        } else s.z = nz;
      }

      if (dist > 0.05) {
        let turn = (Math.atan2(dx, dz) - s.heading) % (Math.PI * 2);
        if (turn > Math.PI) turn -= Math.PI * 2;
        if (turn < -Math.PI) turn += Math.PI * 2;
        s.heading += turn * Math.min(1, dt * 8);
      }

      s.attacking = blocker !== undefined;
      if (blocker) {
        s.cooldown -= dt;
        if (s.cooldown <= 0) {
          s.cooldown = SIEGE.hitInterval;
          this.strike(blocker);
        }
      }
    }
    if (this.structureDirty) this.collapse();
  }

  private track(piece: Piece): void {
    if (piece.y === 0 && piece.type !== "floor") this.ground.set(piece.id, piece);
  }

  /** The piece stopping a soldier on the ground from stepping between two neighbouring cells. */
  private blockerBetween(fromX: number, fromZ: number, toX: number, toZ: number): Piece | undefined {
    const wall =
      toX !== fromX
        ? this.state.occupant({ type: "wall", x: Math.max(fromX, toX), y: 0, z: fromZ, rot: 1 })
        : this.state.occupant({ type: "wall", x: fromX, y: 0, z: Math.max(fromZ, toZ), rot: 0 });
    // Ramps and roofs fill their cell.
    return wall ?? this.state.occupant({ type: "roof", x: toX, y: 0, z: toZ, rot: 0 });
  }

  private nearestGroundPiece(x: number, z: number): Piece | undefined {
    let best: Piece | undefined;
    let bestD = Infinity;
    for (const piece of this.ground.values()) {
      const t = pieceTransform(piece);
      const d = (t.px - x) ** 2 + (t.pz - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = piece;
      }
    }
    return best;
  }

  private strike(piece: Piece): void {
    if (!this.state.get(piece.id)) return;
    if (this.elapsed - (this.lastHit.get(piece.id) ?? -1) < SIEGE.pieceHitGap) return;
    this.lastHit.set(piece.id, this.elapsed);
    const taken = (this.hits.get(piece.id) ?? 0) + 1;
    if (taken >= PIECE_HITS[piece.type]) {
      this.state.apply({ kind: "remove", id: piece.id });
      this.hooks.destroyed?.(piece, false);
    } else {
      this.hits.set(piece.id, taken);
      this.hooks.hit?.(piece, taken / PIECE_HITS[piece.type]);
    }
  }

  private collapse(): void {
    this.structureDirty = false;
    for (const piece of findUnsupported(this.state)) {
      this.state.apply({ kind: "remove", id: piece.id });
      this.hooks.destroyed?.(piece, true);
    }
    this.structureDirty = false;
  }

  private spawnWave(px: number, pz: number): void {
    this.wave++;
    const total = Math.min(waveSize(this.wave), SIEGE.maxSoldiers - this.soldiers.length);
    // Later waves split up and come from several sides at once.
    const groups = Math.min(4, 1 + Math.floor(this.wave / 3));
    const limit = WORLD_HALF_CELLS * CELL + 30;
    let made = 0;
    for (let g = 0; g < groups; g++) {
      const count = g === groups - 1 ? total - made : Math.floor(total / groups);
      const angle = this.rand() * Math.PI * 2;
      const dirX = Math.sin(angle), dirZ = Math.cos(angle);
      const perRow = Math.max(6, Math.ceil(Math.sqrt(count * 3)));
      for (let i = 0; i < count; i++) {
        const row = Math.floor(i / perRow), col = (i % perRow) - (perRow - 1) / 2;
        const along = SIEGE.spawnDistance + row * 1.8 + this.rand() * 0.6;
        const across = col * 1.7 + this.rand() * 0.6;
        const x = px + dirX * along + dirZ * across;
        const z = pz + dirZ * along - dirX * across;
        this.soldiers.push({
          x: Math.max(-limit, Math.min(limit, x)),
          z: Math.max(-limit, Math.min(limit, z)),
          heading: angle + Math.PI,
          attacking: false,
          cooldown: this.rand() * SIEGE.hitInterval,
          pace: 0.88 + this.rand() * 0.24,
          phase: this.rand() * Math.PI * 2,
          retarget: this.rand() * 0.5,
          targetId: undefined,
        });
      }
      made += count;
    }
    this.hooks.wave?.(this.wave, this.soldiers.length);
  }

  /** Soldiers grouped by 1 m square, each listed in its own and the 8 surrounding squares. */
  private bucketSoldiers(): Map<number, Soldier[]> {
    const buckets = new Map<number, Soldier[]>();
    for (const s of this.soldiers) {
      const bx = Math.floor(s.x), bz = Math.floor(s.z);
      for (let ix = bx - 1; ix <= bx + 1; ix++) {
        for (let iz = bz - 1; iz <= bz + 1; iz++) {
          const key = ix * 4096 + iz;
          const list = buckets.get(key);
          if (list) list.push(s);
          else buckets.set(key, [s]);
        }
      }
    }
    return buckets;
  }
}

function bucketKey(x: number, z: number): number {
  return Math.floor(x) * 4096 + Math.floor(z);
}
