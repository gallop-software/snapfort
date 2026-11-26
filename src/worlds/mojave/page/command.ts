import { CELL, LEVEL } from "../../../game/constants";
import { gridBox, type Piece, type PieceSpec } from "../../../game/pieces";
import type { PageGame, RowTile, WorldFeature } from "../../pageDoors";
import {
  buildingBox,
  BUILDING_KINDS,
  BUILDINGS,
  EMP,
  HIGH_GROUND,
  MAKES,
  PIECE_COST,
  UNITS,
  UPGRADE_COST,
  UPGRADE_KEYS,
  UPGRADE_LEVELS,
  UPGRADE_TIME,
  UPGRADES,
  upkeep,
  type BuildingKind,
  type UnitKind,
} from "../kit";
import { ARMY_COLOR_NAMES, ARMY_COLORS, BUILD_REACH, generalSight } from "../sim";
import type { ToPage, ToServer, WireGeneral, WireSpot, WireTarget } from "../wire";
import { HALF_CELLS } from "../world";
import { ArmyView, type SeenBuilding, type SeenField, type SeenUnit } from "./army";
import { ICONS } from "./icons";
import { Panel, type MapDot } from "./panel";
import { Sight } from "./sight";

/**
 * Commanding, from the ground. The general keeps the view every world has and
 * gives StarCraft's orders with the crosshair: a click on a unit selects it,
 * a right click sends what is selected (to move, to attack what was clicked,
 * to gather, to rally), and the keys are StarCraft's wherever they do not
 * clash with the keys every world shares (so attack is F and stop is X: A and
 * S walk the general).
 *
 * What the keys mean depends on what is selected, as in StarCraft:
 * nothing (the building keys of every world), units (orders), or a building
 * (what it makes). Whatever they mean now is shown on the row, in the same
 * boxes the pieces are picked from: the Command tile opens the general's own
 * menu there, and a selection puts its orders there.
 *
 * The land is never dark, but an enemy is known of only while it is in sight.
 * What was seen and is no longer in sight stays on the map as a report, where
 * it was last seen, fading with age, until that ground is looked at again.
 */

type Pending = "move" | "amove" | "patrol" | "gather" | "unload" | "emp" | "rally";
/** A menu on the row: the general's own (what the Command tile opens), the eight armies to serve, or the buildings (basic, advanced). */
type Menu = "cmd" | "army" | 0 | 1;
/** (`from`: a patrol's first end, once it has been clicked.) */
type Mode = null | { k: "target"; what: Pending; from?: WireSpot } | { k: "menu"; page: Menu } | { k: "place"; kind: BuildingKind };
/** An enemy unit seen and no longer in sight: where it was, and when. */
interface Report { x: number; z: number; owner: number; kind: UnitKind; at: number; lookedAt: number }
type Picked = { k: "unit"; u: SeenUnit } | { k: "building"; b: SeenBuilding } | { k: "field"; f: SeenField } | { k: "general"; slot: number } | null;

const HALF = HALF_CELLS * CELL;
const PENDING_TEXT: Record<Pending, string> = {
  move: "Move: click where",
  amove: "Attack: click where, or on what",
  patrol: "Patrol: click one end",
  gather: "Gather: click on crystals",
  unload: "Unload: click where",
  emp: "EMP: click where",
  rally: "Rally point: click where",
};
/** What an order waiting for its click asks for. */
const pendingText = (m: { what: Pending; from?: WireSpot }) => (m.what === "patrol" && m.from ? "Patrol: click the other end" : PENDING_TEXT[m.what]);
/**
 * The keys that pick a piece in every world. With something selected or a
 * menu open, one that means nothing there lets go of it and picks that piece,
 * so the way back to building is the key the builder already knows.
 */
const PIECE_KEYS: Record<string, "wall" | "floor" | "ramp" | "roof"> = { KeyZ: "wall", KeyF: "floor", KeyX: "ramp", KeyC: "roof", F1: "wall", F2: "floor", F3: "ramp", F4: "roof" };
/** A report is as faint as it gets after this long, ms (it is never dropped for its age: only when the spot is seen again). */
const REPORT_FADES_MS = 5 * 60_000;
const ORDER_KEYS: [string, string, Pending | "stop" | "hold" | "return", string][] = [
  ["KeyM", "M", "move", "Move"],
  ["KeyF", "F", "amove", "Attack"],
  ["KeyX", "X", "stop", "Stop"],
  ["KeyH", "H", "hold", "Hold"],
  ["KeyP", "P", "patrol", "Patrol"],
  ["KeyG", "G", "gather", "Gather"],
  ["KeyC", "C", "return", "Return"],
  ["KeyU", "U", "unload", "Unload"],
  ["KeyE", "E", "emp", "EMP"],
];

export function startCommand(game: PageGame): WorldFeature & Record<string, unknown> {
  const army = new ArmyView(game);
  const sight = new Sight();
  const panel = new Panel();
  panel.badge = (html) => game.badge(html);
  const reports = new Map<number, Report>();
  /** Who is dressed in an army's colour now (see `PageGame.wear`). */
  let wearing = new Set<string>();

  /** Who this player is here: a general's slot, or -1 (there is no place for them: they are kept out), and why. */
  let slot = -1;
  let why: "choose" | "visitor" | undefined;
  let start: [number, number] | null = null;
  let placed = false;
  const myPids = new Set<string>();
  let generals: WireGeneral[] = [];
  let bank = { l: 0, p: 0, used: 0, max: 0, up: [0, 0] as [number, number], routed: -1 };

  const selected = new Set<number>();
  const selectedBuildings = new Set<number>();
  army.selected = selected;
  army.selectedBuildings = selectedBuildings;
  const groups = new Map<number, { units: number[]; buildings: number[] }>();
  let mode: Mode = null;
  /** The buildings menu was reached through the general's own menu (so Back goes there, not all the way out). */
  let menuTop = false;
  let mapOn = false;
  const cursor = { x: 0, z: 0 };
  let painting = false;
  let tookLeft = false, tookRight = false;
  let lastClick = { id: 0, at: 0 };
  let lastDigit = { n: -1, at: 0 };
  let idleAt = 0;
  const pings: { x: number; z: number; at: number; color: string }[] = [];
  let cardDirty = true;
  let lookAt = 0, mapAt = 0, cardAt = 0, shotAt = 0, boomAt = 0;
  let lastHint: string | null = null;
  /** What the row and the line over it last showed (for the checks that read them). */
  let shownRow: RowTile[] | null = null;
  let shownStatus: string | null = null;
  let shownHtml: string | null = null;
  /** Frames left in which a general who has just arrived is turned to face their base. */
  let faceHome = 0;
  /** What a hint says, without its markup. */
  const plain = (html: string | null) => (html ?? "").replace(/<[^>]+>/g, "");

  const general = (s: number) => generals.find((g) => g.slot === s);
  /** Mine, or not: there are no allies. */
  const mine = (owner: number) => slot >= 0 && owner === slot;
  army.colorOf = (owner) => general(owner)?.color ?? "#8a8f98";
  army.inSight = (x, z) => sight.sees(x, z);
  // An enemy that goes out of sight stays on the map where it was last seen.
  army.onUnseen = (u) => {
    if (mine(u.owner)) return;
    reports.set(u.id, { x: u.x, z: u.z, owner: u.owner, kind: u.kind, at: performance.now(), lookedAt: 0 });
    if (reports.size > 2500) reports.delete(reports.keys().next().value as number);
  };

  const send = (msg: ToServer) => game.send(msg);
  const shift = () => game.held("ShiftLeft") || game.held("ShiftRight");
  const setMode = (next: Mode) => {
    mode = next;
    cardDirty = true;
  };
  const deselect = () => {
    selected.clear();
    selectedBuildings.clear();
    cardDirty = true;
  };

  // ── What the crosshair is on ───────────────────────────────────────────

  /** The spot under the crosshair, on the ground or anything solid. */
  const aimSpot = (): WireSpot | null => game.aim(600);

  /** What the crosshair is on: the nearest unit along it, else the building, field or general at the spot it lands on. */
  function pick(): Picked {
    const { from, dir } = game.sight();
    const spot = aimSpot();
    const reach = spot ? Math.hypot(spot[0] - from[0], spot[1] - from[1], spot[2] - from[2]) + 1.5 : 600;
    let best: Picked = null, bestAlong = reach;
    for (const u of army.units.values()) {
      const def = UNITS[u.kind];
      const cx = u.x - from[0], cy = u.y + def.height * 0.5 - from[1], cz = u.z - from[2];
      const along = cx * dir[0] + cy * dir[1] + cz * dir[2];
      if (along < 0.5 || along > bestAlong) continue;
      const off = Math.hypot(cx - dir[0] * along, cy - dir[1] * along, cz - dir[2] * along);
      // Generous far away: a Trooper at 150 m is a few pixels.
      if (off > Math.max(def.radius * 1.15, def.height * 0.6, along * 0.013)) continue;
      best = { k: "unit", u };
      bestAlong = along;
    }
    if (best) return best;
    for (const o of game.others()) {
      const g = generals.find((x) => x.pids.includes(o.id));
      if (!g || !o.position || !sight.sees(o.position[0], o.position[2])) continue;
      const cx = o.position[0] - from[0], cy = o.position[1] - from[1], cz = o.position[2] - from[2];
      const along = cx * dir[0] + cy * dir[1] + cz * dir[2];
      if (along < 0.5 || along > reach) continue;
      if (Math.hypot(cx - dir[0] * along, cy - dir[1] * along, cz - dir[2] * along) < Math.max(1, along * 0.012)) return { k: "general", slot: g.slot };
    }
    if (!spot) return null;
    // On a building as it is drawn (a wall built on the ground by its foot is not a click on it).
    for (const b of army.buildings.values()) {
      const [x0, , z0, x1, y1, z1] = buildingBox(b.kind, b.x, b.z);
      if (spot[0] > x0 - 0.6 && spot[0] < x1 + 0.6 && spot[2] > z0 - 0.6 && spot[2] < z1 + 0.6 && spot[1] < y1 + 1.5) return { k: "building", b };
    }
    if (spot[1] < 3) {
      for (const f of army.fields.values()) if (Math.abs(spot[0] - (f.cx + 0.5) * CELL) < CELL * 0.75 && Math.abs(spot[2] - (f.cz + 0.5) * CELL) < CELL * 0.75) return { k: "field", f };
    }
    return null;
  }

  // ── Selecting ──────────────────────────────────────────────────────────

  function selectUnits(ids: Iterable<number>, add: boolean): void {
    if (!add) selected.clear();
    selectedBuildings.clear();
    for (const id of ids) selected.add(id);
    cardDirty = true;
  }

  function selectArmy(): void {
    const ids = [...army.units.values()].filter((u) => mine(u.owner) && u.kind !== "hauler").map((u) => u.id);
    if (ids.length === 0) return game.toast("You have no army yet");
    selectUnits(ids, false);
    game.play("select");
  }

  /** The next Hauler standing idle: selected, and the view turned to it. */
  function idleHauler(): void {
    const idle = [...army.units.values()].filter((u) => mine(u.owner) && u.kind === "hauler" && !(u.flags & 97));
    if (idle.length === 0) return game.toast("No idle Haulers");
    const u = idle[idleAt++ % idle.length]!;
    selectUnits([u.id], false);
    faceSpot(u.x, u.z);
  }

  function faceSpot(x: number, z: number): void {
    const p = game.player.position;
    if (Math.hypot(x - p.x, z - p.z) > 2) game.face(Math.atan2(x - p.x, z - p.z));
    pings.push({ x, z, at: performance.now(), color: "#ffffff" });
  }

  function saveGroup(n: number): void {
    if (selected.size === 0 && selectedBuildings.size === 0) return;
    groups.set(n, { units: [...selected], buildings: [...selectedBuildings] });
    game.toast(`Group ${n} saved`, 1200);
  }

  function recallGroup(n: number): void {
    const g = groups.get(n);
    const now = performance.now();
    const units = g ? g.units.filter((id) => army.units.has(id)) : [];
    const buildings = g ? g.buildings.filter((id) => army.buildings.has(id)) : [];
    if (units.length === 0 && buildings.length === 0) return game.toast(`Group ${n} is empty: Ctrl + ${n} saves what is selected`, 2200);
    selected.clear();
    selectedBuildings.clear();
    for (const id of units) selected.add(id);
    for (const id of buildings) selectedBuildings.add(id);
    cardDirty = true;
    // Twice: the view turns to face them.
    if (lastDigit.n === n && now - lastDigit.at < 450) {
      let x = 0, z = 0, c = 0;
      for (const id of units) {
        const u = army.units.get(id)!;
        x += u.x;
        z += u.z;
        c++;
      }
      for (const id of buildings) {
        const b = army.buildings.get(id)!;
        x += (b.x + BUILDINGS[b.kind].size / 2) * CELL;
        z += (b.z + BUILDINGS[b.kind].size / 2) * CELL;
        c++;
      }
      faceSpot(x / c, z / c);
    }
    lastDigit = { n, at: now };
    game.play("select");
  }

  /** A click on something of this general's: selected (with Shift, added or taken out; twice on a unit, all of its kind nearby). */
  function clickOn(p: Picked): boolean {
    const now = performance.now();
    if (p?.k === "unit" && mine(p.u.owner)) {
      const twice = lastClick.id === p.u.id && now - lastClick.at < 380;
      lastClick = { id: p.u.id, at: now };
      if (twice) {
        const near = [...army.units.values()].filter((u) => mine(u.owner) && u.kind === p.u.kind && Math.hypot(u.x - p.u.x, u.z - p.u.z) < 90);
        selectUnits(near.map((u) => u.id), shift());
      } else if (shift() && selected.has(p.u.id)) {
        selected.delete(p.u.id);
        cardDirty = true;
      } else selectUnits([p.u.id], shift());
      painting = true;
      game.play("select");
      return true;
    }
    if (p?.k === "building" && mine(p.b.o)) {
      const twice = lastClick.id === -p.b.i && now - lastClick.at < 380;
      lastClick = { id: -p.b.i, at: now };
      if (!shift()) selectedBuildings.clear();
      selected.clear();
      if (twice) for (const b of army.buildings.values()) if (mine(b.o) && b.kind === p.b.kind) selectedBuildings.add(b.i);
      selectedBuildings.add(p.b.i);
      cardDirty = true;
      game.play("select");
      return true;
    }
    return false;
  }

  // ── Orders ─────────────────────────────────────────────────────────────

  function mark(spot: WireSpot, color: [number, number, number]): void {
    army.ping(spot[0], spot[1], spot[2], color, performance.now());
    pings.push({ x: spot[0], z: spot[2], at: performance.now(), color: `rgb(${color.map((c) => Math.round(c * 255)).join(",")})` });
  }

  function order(k: Pending | "stop" | "hold" | "return", spot: WireSpot | null, queue: boolean): void {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (k === "stop" || k === "hold" || k === "return") return send({ m: "order", ids, k, q: queue });
    if (!spot) return void game.toast("Aim at the ground");
    if (k === "rally") return;
    if (k === "gather") {
      const f = [...army.fields.values()].find((x) => !x.vent && Math.abs(spot[0] - (x.cx + 0.5) * CELL) < CELL && Math.abs(spot[2] - (x.cz + 0.5) * CELL) < CELL);
      if (!f) return void game.toast("Aim at crystals to gather");
      send({ m: "order", ids, k: "gather", field: f.id, q: queue });
      return mark(spot, [0.5, 1, 0.95]);
    }
    send({ m: "order", ids, k, at: spot, q: queue });
    mark(spot, k === "amove" ? [1, 0.4, 0.3] : k === "emp" ? [0.5, 0.9, 1] : [0.5, 1, 0.5]);
  }

  /**
   * Patrol takes two clicks, one for each end: the first is kept (and marked) until the second. True once both are in
   * and the order is sent; they go to the first end, then back and forth.
   */
  function patrol(spot: WireSpot | null, queue: boolean): boolean {
    if (!spot) return void game.toast("Aim at the ground"), false;
    const first = mode?.k === "target" ? mode.from : undefined;
    if (!first) {
      setMode({ k: "target", what: "patrol", from: spot });
      mark(spot, [0.5, 1, 0.5]);
      return false;
    }
    const ids = [...selected];
    if (ids.length > 0) send({ m: "order", ids, k: "patrol", at: first, back: spot, q: queue });
    mark(spot, [0.5, 1, 0.5]);
    return true;
  }

  /** A right click with units selected: what it means depends on what it is on. */
  function smartOrder(): void {
    const p = pick();
    const spot = aimSpot();
    const queue = shift();
    const ids = [...selected];
    const attack = (on: WireTarget, at: WireSpot | null) => {
      send({ m: "order", ids, k: "attack", on, q: queue });
      if (at) mark(at, [1, 0.3, 0.25]);
    };
    if (p?.k === "unit" && !mine(p.u.owner)) return attack([1, p.u.id], [p.u.x, p.u.y, p.u.z]);
    if (p?.k === "building" && !mine(p.b.o)) return attack([2, p.b.i], spot);
    if (p?.k === "general" && !mine(p.slot)) return attack([3, p.slot], spot);
    if (p?.k === "unit" && p.u.kind === "transport" && mine(p.u.owner) && !selected.has(p.u.id)) {
      send({ m: "order", ids, k: "load", into: p.u.id, q: queue });
      return mark([p.u.x, 0, p.u.z], [0.6, 0.8, 1]);
    }
    if (p?.k === "field" && !p.f.vent && ids.some((id) => army.units.get(id)?.kind === "hauler")) {
      send({ m: "order", ids, k: "gather", field: p.f.id, q: queue });
      return mark([(p.f.cx + 0.5) * CELL, 0, (p.f.cz + 0.5) * CELL], [0.5, 1, 0.95]);
    }
    if (p?.k === "building" && p.b.kind === "core" && mine(p.b.o) && ids.some((id) => (army.units.get(id)?.extra ?? 0) > 0 && army.units.get(id)?.kind === "hauler")) {
      return send({ m: "order", ids, k: "return", q: queue });
    }
    // An enemy's wall or floor: shot down.
    if (spot && spot[1] > 0.3) {
      const piece = pieceAt(spot);
      if (piece && !myPids.has(ownerPid(piece.id))) return attack([4, piece.id], spot);
    }
    order("move", spot, queue);
  }

  /** The built piece a spot is on, if any. */
  function pieceAt(spot: WireSpot): Piece | null {
    let best: Piece | null = null, bestD = 0.8;
    for (const p of game.build.near(spot[0], spot[1], spot[2])) {
      const [x0, y0, z0, x1, y1, z1] = gridBox(p);
      const dx = Math.max(x0 * CELL - spot[0], 0, spot[0] - x1 * CELL), dy = Math.max(y0 * LEVEL - spot[1], 0, spot[1] - Math.max(y1, y0 + 0.1) * LEVEL), dz = Math.max(z0 * CELL - spot[2], 0, spot[2] - z1 * CELL);
      const d = Math.hypot(dx, dy, dz);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }
  const ownerPid = (pieceId: string) => pieceId.slice(0, Math.max(0, pieceId.lastIndexOf("-")));

  // ── Buildings: where they go, what they make ───────────────────────────

  /** The cell a building of this kind would go at, from the spot under the crosshair, and why it cannot (or ""). */
  function placing(kind: BuildingKind): { cx: number; cz: number; why: string } | null {
    const spot = aimSpot();
    if (!spot) return null;
    const def = BUILDINGS[kind];
    const cx = Math.round(spot[0] / CELL - def.size / 2), cz = Math.round(spot[2] / CELL - def.size / 2);
    return { cx, cz, why: cannotBuild(kind, cx, cz) };
  }

  function cannotBuild(kind: BuildingKind, cx: number, cz: number): string {
    const def = BUILDINGS[kind];
    const free = kind === "core" && bank.routed === 0;
    if (!free) {
      for (const need of def.needs ?? []) if (![...army.buildings.values()].some((b) => mine(b.o) && b.kind === need && b.d === 0)) return `Needs ${BUILDINGS[need].label} first`;
      if (bank.l < def.lithium) return "Not enough lithium";
      if (bank.p < def.plasma) return "Not enough plasma";
    }
    const p = game.player.position;
    if (Math.hypot(p.x - (cx + def.size / 2) * CELL, p.z - (cz + def.size / 2) * CELL) > BUILD_REACH + (def.size * CELL) / 2) return "Too far away: go closer";
    if (Math.abs(cx) > HALF_CELLS - def.size - 1 || Math.abs(cz) > HALF_CELLS - def.size - 1) return "Outside the building area";
    if (kind === "tap") {
      const vent = [...army.fields.values()].find((f) => f.vent && f.cx === cx && f.cz === cz);
      if (!vent) return "A Tap goes on a plasma vent";
      return taken(cx, cz, true) ? "That vent already has a Tap" : "";
    }
    // As the server judges it (Sim.cannotBuild): every storey it stands up through, and nobody standing where it goes.
    const storeys = Math.ceil(def.height / LEVEL);
    for (let x = cx; x < cx + def.size; x++) {
      for (let z = cz; z < cz + def.size; z++) {
        if (taken(x, z, false)) return "Something is in the way";
        for (let y = 0; y < storeys; y++) {
          if (game.build.occupant({ type: "floor", x, y, z, rot: 0 }) || game.build.occupant({ type: "ramp", x, y, z, rot: 0 })) return "Something is built there";
          if (x > cx && game.build.occupant({ type: "wall", x, y, z, rot: 1 })) return "Something is built there";
          if (z > cz && game.build.occupant({ type: "wall", x, y, z, rot: 0 })) return "Something is built there";
        }
      }
    }
    const x0 = cx * CELL - 0.45, z0 = cz * CELL - 0.45, x1 = (cx + def.size) * CELL + 0.45, z1 = (cz + def.size) * CELL + 0.45;
    const on = (at: readonly [number, number, number] | null) => !!at && at[0] > x0 && at[0] < x1 && at[2] > z0 && at[2] < z1 && at[1] < def.height + 1;
    if (on([p.x, p.y, p.z])) return "You are standing there";
    // (Another general out of sight is not given away: the server refuses that one, and says why.)
    if (game.others().some((o) => generals.some((g) => g.pids.includes(o.id)) && !!o.position && sight.sees(o.position[0], o.position[2]) && on(o.position))) return "A general is standing there";
    return "";
  }

  /** Whether a ground cell is taken by a building (or, unless `buildingsOnly`, a field). */
  function taken(x: number, z: number, buildingsOnly: boolean): boolean {
    for (const b of army.buildings.values()) {
      const s = BUILDINGS[b.kind].size;
      if (x >= b.x && x < b.x + s && z >= b.z && z < b.z + s) return true;
    }
    if (buildingsOnly) return false;
    for (const f of army.fields.values()) if (f.cx === x && f.cz === z) return true;
    return false;
  }

  function placeBuilding(kind: BuildingKind): void {
    const at = placing(kind);
    if (!at) return void game.toast("Aim at the ground");
    if (at.why) {
      game.toast(at.why);
      return game.play("deny");
    }
    send({ m: "build", kind, x: at.cx, z: at.cz });
    game.play("place");
    if (!shift()) setMode(null);
  }

  // ── Everything a key or a button can do ────────────────────────────────

  function act(id: string, many = false): void {
    const [what, arg] = id.split(":") as [string, string | undefined];
    switch (what) {
      case "o": {
        const k = arg as Pending | "stop" | "hold" | "return";
        if (k === "stop" || k === "hold" || k === "return") return order(k, null, many);
        return setMode({ k: "target", what: k });
      }
      case "menu": {
        const page: Menu = arg === "cmd" ? "cmd" : arg === "army" ? "army" : arg === "1" ? 1 : 0;
        if (page !== "cmd" && mode?.k !== "menu" && mode?.k !== "place") menuTop = false;
        if (page !== "cmd" && mode?.k === "menu" && mode.page === "cmd") menuTop = true;
        return setMode(mode?.k === "menu" && mode.page === page ? null : { k: "menu", page });
      }
      case "b":
        if (BUILDING_KINDS.includes(arg as BuildingKind)) setMode({ k: "place", kind: arg as BuildingKind });
        return;
      case "make":
        for (const b of selectedBuildings) {
          const s = army.buildings.get(b);
          if (s && UNITS[arg as UnitKind]?.madeAt === s.kind) send({ m: "make", id: b, kind: arg as UnitKind, n: many ? 5 : 1 });
        }
        return;
      case "up":
        for (const b of selectedBuildings) if (army.buildings.get(b)?.kind === "armory") return send({ m: "research", id: b, kind: arg as (typeof UPGRADES)[number] });
        return;
      case "rally":
        return setMode({ k: "target", what: "rally" });
      case "cancel":
        for (const b of selectedBuildings) send({ m: "cancel", id: b });
        return;
      case "army":
        if (mode?.k === "menu") setMode(null);
        return selectArmy();
      case "idle":
        if (mode?.k === "menu") setMode(null);
        return idleHauler();
      case "desel":
        setMode(null);
        return deselect();
      case "map":
        if (mode?.k === "menu") setMode(null);
        return toggleMap();
      case "serve": {
        // Serve this army: on arriving, or changing sides.
        const to = Number(arg);
        if (to === slot) return setMode(null);
        if (Number.isInteger(to) && to >= 0 && to < 8) send({ m: "serve", slot: to });
        return;
      }
      case "back":
        // One step back, to whatever was on the row before: from placing a building to the buildings, from them to the
        // general's own menu (if they were reached through it), from a menu or an order waiting for its click to what
        // is selected, and from a selection to nothing selected.
        if (mapOn) return toggleMap();
        // (Someone who serves no army yet has only the armies to choose from: there is nothing to go back to.)
        if (slot < 0) return;
        if (mode?.k === "place") return setMode({ k: "menu", page: BUILDINGS[mode.kind].advanced ? 1 : 0 });
        if (mode?.k === "menu" && mode.page !== "cmd" && menuTop) return setMode({ k: "menu", page: "cmd" });
        if (mode) return setMode(null);
        return deselect();
    }
  }

  function toggleMap(): void {
    mapOn = !mapOn;
    panel.setBig(mapOn);
    if (mapOn) {
      cursor.x = game.player.position.x;
      cursor.z = game.player.position.z;
    }
  }

  /**
   * What the row shows now in place of the pieces, and the line over it: the
   * menu that is open, or what is selected and what it can be told. Null row:
   * the pieces (nothing selected, nothing open).
   */
  function row(): { tiles: RowTile[] | null; status: string | null; html?: string } {
    const tile = (id: string, key: string, label: string, icon: string, more: Partial<RowTile> = {}): RowTile => ({ id, key, label, icon: ICONS[icon] ?? "", ...more });
    /** The eight armies, each a tile in its colour, with how many generals serve it now. */
    const armies = (): RowTile[] =>
      [...generals]
        .sort((a, b) => a.slot - b.slot)
        .map((g) => {
          const others = g.pids.filter((id) => id !== game.myId()).length;
          const name = ARMY_COLOR_NAMES[g.slot] ?? "grey";
          return tile(`serve:${g.slot}`, `${g.slot + 1}`, name[0]!.toUpperCase() + name.slice(1), "", { icon: flag(g.color), sub: g.slot === slot ? (others ? `you + ${others}` : "you") : others === 0 ? "nobody" : others === 1 ? "1 general" : `${others} generals`, on: g.slot === slot });
        });
    // Not a general of any army yet: the armies, to choose from.
    if (slot < 0) return why === "choose" ? { tiles: armies(), status: `Choose the army you serve: ${game.touch ? "tap its colour" : "press its number"}. You command all of it, with whoever else serves it, and may change sides at any moment.` } : { tiles: null, status: null };
    const cost = (lithium: number, plasma: number) => (plasma > 0 ? `${lithium} · ${plasma} pl` : `${lithium}`);
    const has = (kind: BuildingKind) => [...army.buildings.values()].some((b) => mine(b.o) && b.kind === kind && b.d === 0);
    const back = (label = "Back") => tile("back", "⌫", label, label === "Back" ? "back" : "cancel");
    const building = (k: BuildingKind, more: Partial<RowTile> = {}) => {
      const def = BUILDINGS[k];
      const free = k === "core" && bank.routed === 0;
      const lacks = (def.needs ?? []).find((n) => !has(n));
      return tile(`b:${k}`, def.key, def.label, k, { sub: free ? "free" : lacks ? `needs ${BUILDINGS[lacks].label}` : cost(def.lithium, def.plasma), off: !free && (!!lacks || bank.l < def.lithium || bank.p < def.plasma), ...more });
    };
    const routed = bank.routed >= 0 ? (bank.routed === 0 ? "You are routed: your new Core is free. " : `You are routed: a free Core in ${bank.routed} s. `) : "";
    if (mode?.k === "place") {
      const def = BUILDINGS[mode.kind];
      return { tiles: [building(mode.kind, { on: true, off: false }), back()], status: plain(lastHint) || `${def.label}: ${def.blurb}` };
    }
    if (mode?.k === "target") {
      const what = mode.what;
      const found = ORDER_KEYS.find(([, , k]) => k === what);
      const tiles = [found ? tile(`o:${what}`, found[1], found[3], what, { on: true }) : tile("rally", "R", "Rally point", "rally", { on: true }), back("Cancel")];
      return { tiles, status: pendingText(mode).replace("click", game.touch ? "aim and tap Go" : "click") };
    }
    if (mode?.k === "menu" && mode.page === "cmd") {
      const with_ = (general(slot)?.pids.length ?? 1) - 1;
      return {
        tiles: [tile("menu:0", "N", "Build", "build"), tile("army", "`", "Whole army", "army"), tile("idle", "I", "Idle Hauler", "idle"), tile("map", "Tab", "Map", "map"), tile("menu:army", "J", "Change army", "", { icon: flag(ARMY_COLORS[slot] ?? "#888888") }), back()],
        status: `${routed}You serve the ${ARMY_COLOR_NAMES[slot] ?? "grey"} army${with_ > 0 ? `, with ${with_} other general${with_ > 1 ? "s" : ""}` : ", alone"}. Click a unit or building of yours to select it; right click sends what is selected.`,
      };
    }
    if (mode?.k === "menu" && mode.page === "army") return { tiles: [...armies(), back()], status: "Change army: press the number of the one to serve. You leave this one as it stands, and command all of the other." };
    if (mode?.k === "menu") {
      const page = mode.page as 0 | 1;
      const kinds = BUILDING_KINDS.filter((k) => !!BUILDINGS[k].advanced === (page === 1));
      return {
        tiles: [...kinds.map((k) => building(k)), tile(`menu:${page === 1 ? 0 : 1}`, "V", page === 1 ? "Basic" : "Advanced", page === 1 ? "less" : "more"), back()],
        status: `${routed}Build${page === 1 ? ", advanced" : ""}: pick one, then ${game.touch ? "aim and tap Place" : "click where it goes"}.`,
      };
    }
    if (selected.size > 0) {
      const counts = new Map<UnitKind, number>();
      for (const id of selected) {
        const u = army.units.get(id);
        if (u) counts.set(u.kind, (counts.get(u.kind) ?? 0) + 1);
      }
      const only = selected.size === 1 ? army.units.get([...selected][0]!) : undefined;
      const status = only ? `${UNITS[only.kind].label} · ${only.hp}% · ${UNITS[only.kind].blurb}` : `${selected.size} selected: ${[...counts].map(([k, n]) => `${n} ${UNITS[k].label}`).join(", ")}`;
      const tiles = orders().map(([, key, k, label]) => tile(`o:${k}`, key, label, k));
      tiles.push(tile("menu:0", "B", "Build", "build"), back("Deselect"));
      return { tiles, status };
    }
    if (selectedBuildings.size > 0) {
      const list = [...selectedBuildings].flatMap((id) => army.buildings.get(id) ?? []);
      const first = list[0];
      if (!first) return { tiles: null, status: null };
      const def = BUILDINGS[first.kind];
      const now = performance.now();
      const left = (s: number) => Math.max(0, Math.ceil(s - (now - first.at) / 1000));
      const doing =
        first.d > 0 ? `printing, ${left(first.d)} s` : first.r > 0 ? `working on ${UPGRADES[first.r - 1]}, ${left(first.rl)} s` : first.q.length > 0 ? `making ${first.q.map((k) => UNITS[UNIT_KIND_AT(k)].label).join(", ")} · ${left(first.ql)} s` : def.blurb;
      const kinds = new Set(list.map((b) => b.kind));
      // The army is at its limit: said plainly wherever units are made, since their tiles are faded and nothing more can be ordered until there is room.
      const makes = [...kinds].some((k) => MAKES[k].length > 0);
      const full = makes && bank.used >= bank.max ? (bank.max >= 200 ? ` · Your army is at its limit (${bank.used} / ${bank.max})` : ` · Supply is full (${bank.used} / ${bank.max}): build a Relay mast for 10 more (N, then R), or another Core for 12`) : "";
      const tiles: RowTile[] = [];
      for (const kind of kinds) {
        for (const unit of MAKES[kind]) {
          const u = UNITS[unit];
          const lacks = (u.needs ?? []).find((n) => !has(n));
          tiles.push(tile(`make:${unit}`, u.key, u.label, unit === "emp" ? "emp_unit" : unit, { sub: lacks ? `needs ${BUILDINGS[lacks].label}` : bank.used + u.supply > bank.max ? "no supply" : cost(u.lithium, u.plasma), off: !!lacks || bank.l < u.lithium || bank.p < u.plasma || bank.used + u.supply > bank.max }));
        }
        if (kind === "armory") {
          UPGRADES.forEach((up, i) => {
            const level = bank.up[i]!;
            const price = UPGRADE_COST[level];
            tiles.push(tile(`up:${up}`, UPGRADE_KEYS[up], `${up === "weapons" ? "Weapons" : "Armour"} ${Math.min(UPGRADE_LEVELS, level + 1)}`, up, { sub: price === undefined ? "done" : `${price} · ${price} pl`, off: price === undefined || bank.l < price || bank.p < price }));
          });
        }
      }
      if ([...kinds].some((k) => MAKES[k].length > 0)) tiles.push(tile("rally", kinds.has("armory") ? "Y" : "R", "Rally point", "rally"), tile("cancel", "Q", "Cancel last", "cancel"));
      else if (first.r > 0) tiles.push(tile("cancel", "Q", "Cancel", "cancel"));
      tiles.push(back("Deselect"));
      const title = list.length > 1 ? `${list.length} ${def.label}s` : `${def.label} · ${first.h}%`;
      // What it is doing, as a line of pictures: the first with a bar that fills as it nears being done (units being
      // made, an upgrade being worked on, the building itself being printed).
      const pictures = (items: readonly { icon: string; label: string }[], whole: number, leftS: number, words: string) => {
        const done = Math.max(0, Math.min(1, 1 - leftS / whole));
        return (
          `<span class="mjq"><b>${escapeHtml(title)}</b><span class="q">` +
          items.map((it, i) => `<i class="${i === 0 ? "now" : ""}" title="${escapeHtml(it.label)}"><svg viewBox="0 0 40 40" aria-hidden="true">${ICONS[it.icon] ?? ""}</svg>${i === 0 ? `<em><u style="width:${Math.round(done * 100)}%"></u></em>` : ""}</i>`).join("") +
          `</span><small>${escapeHtml(words)}</small>${full ? `<small class="bad">${escapeHtml(full.replace(/^ · /, ""))}</small>` : ""}</span>`
        );
      };
      const since = (now - first.at) / 1000;
      let html: string | undefined;
      if (first.d > 0) {
        html = pictures([{ icon: first.kind, label: def.label }], def.time, first.d - since, `Printing · ${left(first.d)} s`);
      } else if (first.r > 0) {
        const up = UPGRADES[first.r - 1]!;
        const level = Math.min(UPGRADE_LEVELS - 1, bank.up[first.r - 1] ?? 0);
        const label = `${up === "weapons" ? "Weapons" : "Armour"} ${level + 1}`;
        html = pictures([{ icon: up, label }], UPGRADE_TIME[level]!, first.rl - since, `${label} · ${left(first.rl)} s`);
      } else if (first.q.length > 0) {
        const kindsQ = first.q.map((k) => UNIT_KIND_AT(k));
        html = pictures(
          kindsQ.map((k) => ({ icon: k === "emp" ? "emp_unit" : k, label: UNITS[k].label })),
          UNITS[kindsQ[0]!].time,
          first.ql - since,
          `${UNITS[kindsQ[0]!].label} · ${left(first.ql)} s${kindsQ.length > 1 ? ` · ${kindsQ.length - 1} more after it` : ""}`,
        );
      }
      return { tiles, status: `${title} · ${doing}${full}`, ...(html ? { html } : {}) };
    }
    return { tiles: null, status: routed ? `${routed}${game.touch ? "Tap Build" : "Press N"} to put it down.` : null };
  }
  /** The orders the selected units can be given: those on the row, and the only ones their keys mean. */
  function orders(): typeof ORDER_KEYS {
    const kinds = new Set([...selected].flatMap((id) => army.units.get(id)?.kind ?? []));
    return ORDER_KEYS.filter(([, , k]) => {
      if (k === "gather" || k === "return") return kinds.has("hauler");
      if (k === "unload") return kinds.has("transport");
      if (k === "emp") return kinds.has("emp");
      // (Phones have room for the orders that matter most.)
      if (k === "patrol" && game.touch) return false;
      return true;
    });
  }
  /** A flag in an army's colour, for its tile. */
  const flag = (color: string) => `<path d="M11 35V6"/><path style="fill:${/^#[0-9a-f]{6}$/i.test(color) ? color : "#888888"}" d="M11 7h20l-5 7 5 7H11Z"/>`;
  const UNIT_KIND_AT = (i: number): UnitKind => (Object.keys(UNITS) as UnitKind[])[i] ?? "trooper";

  /** A new general's first notes, once in each browser: what they have, and the first keys. */
  function intro(): void {
    try {
      if (localStorage.getItem("snapfort.mojave.intro") === "seen") return;
      localStorage.setItem("snapfort.mojave.intro", "seen");
    } catch {
      return;
    }
    const lines = game.touch
      ? ["Aim at your Core and tap Select, then tap Hauler for more of them.", "Build opens the build menu: a Foundry makes Troopers. Buildings stand at once; units take a little time.", "Army picks every fighting unit; aim at the ground and tap Order to send them."]
      : ["Click your Core, then press H for more Haulers. Command (B) is your own menu: you can change army there.", "N opens the build menu: a Foundry makes Troopers. Buildings stand at once; units take a little time.", "Click a unit to select it (twice for all of its kind); right click sends them. Tab is the map."];
    lines.forEach((text, i) => setTimeout(() => panel.note(text, "info"), 1500 + i * 6500));
  }

  // ── From the server ────────────────────────────────────────────────────

  function onMessage(data: unknown): void {
    const msg = data as ToPage;
    if (!msg || typeof msg !== "object") return;
    const now = performance.now();
    switch (msg.m) {
      case "you": {
        const was = slot;
        slot = msg.slot;
        why = msg.why;
        for (const pid of msg.pids ?? []) myPids.add(pid);
        start = msg.start ?? null;
        // No place here for them now: kept out, with why on the menu. Let in the moment there is one.
        // Without the Full Game there is no place here: kept out, with why on the menu.
        game.shut(why === "visitor" ? { text: "Commanding an army in Mojave comes with the Full Game.", unlock: true } : null);
        // After saying who this is, the server sends everything afresh. The same army as before (the connection was
        // lost and found): what is drawn stays until then, so nothing blinks. Another army: nothing of the old is kept.
        if (was === slot && slot >= 0) army.refresh(now);
        else {
          army.clear();
          reports.clear();
          deselect();
          setMode(null);
        }
        if (was !== slot) {
          sight.clear();
          placed = false;
          if (slot >= 0) intro();
          // Whose all this is: said every time a place is taken, since it is never the general's own colour that marks it.
          if (slot >= 0) panel.note(`You serve the ${ARMY_COLOR_NAMES[slot] ?? "grey"} army: this base and everything ${ARMY_COLOR_NAMES[slot] ?? "grey"} is yours to command, with whoever else serves it.`, "ready");
          // Playing already (they have just chosen an army, or changed sides): straight to its base.
          if (slot >= 0 && start && game.playing()) {
            placed = true;
            // (On clear ground: a unit or a building may stand on the spot.)
            const at = game.clearSpot(start[0], 0.95, start[1]) ?? [start[0], 0.95, start[1]];
            game.player.teleport(at[0], at[1], at[2]);
            faceHome = 3;
          }
        }
        cardDirty = true;
        return;
      }
      case "gens":
        // (For a moment after a new version goes out, a world may still be running the one before, which named one builder to an army: read either.)
        generals = msg.g.map((g) => ({ ...g, pids: Array.isArray(g.pids) ? g.pids : typeof (g as { pid?: unknown }).pid === "string" && (g as { pid?: string }).pid ? [(g as { pid?: string }).pid!] : [] }));
        cardDirty = true;
        return;
      case "fields":
        return army.setFields(msg.f);
      case "res":
        bank = msg;
        cardDirty = true;
        return;
      case "note":
        panel.note(msg.text, msg.kind);
        if (msg.x !== undefined && msg.z !== undefined) pings.push({ x: msg.x, z: msg.z, at: now, color: msg.kind === "attack" ? "#ff5a4a" : "#7ee2a0" });
        if (msg.kind === "attack") game.play("horn");
        return;
      case "no":
        game.toast(msg.text);
        return game.play("deny");
      case "tick": {
        if (msg.u) {
          army.seeUnits(msg.u, now);
          // Seen again: the old report of it is done with.
          if (reports.size > 0) for (let i = 0; i < msg.u.length; i += 9) reports.delete(msg.u[i]!);
        }
        if (msg.k) army.tumbles(msg.k, now);
        if (msg.x) {
          army.loseUnits(msg.x, now);
          for (let i = 0; i < msg.x.length; i += 2) selected.delete(msg.x[i]!) && (cardDirty = true);
        }
        if (msg.b) {
          army.seeBuildings(msg.b, now);
          if (msg.b.some((b) => selectedBuildings.has(b.i))) cardDirty = true;
        }
        if (msg.bx) {
          army.loseBuildings(msg.bx, now);
          for (let i = 0; i < msg.bx.length; i += 2) selectedBuildings.delete(msg.bx[i]!) && (cardDirty = true);
        }
        if (msg.s) {
          army.shots(msg.s, now);
          shotSound(msg.s, now);
        }
        if (msg.bl) {
          army.blasts(msg.bl, now);
          blastSound(msg.bl, now);
        }
        if (msg.p) army.pulses(msg.p, now, EMP.radius);
        if (msg.z) army.zaps(msg.z, now);
        if (msg.f) {
          for (let i = 0; i + 1 < msg.f.length; i += 2) {
            const f = army.fields.get(msg.f[i]!);
            if (f) f.amount = msg.f[i + 1]!;
          }
        }
        return;
      }
    }
  }

  /** How near something is, for how loud it sounds: 1 right here, 0 from 140 m. */
  const nearness = (x: number, z: number) => Math.max(0, 1 - Math.hypot(x - game.player.position.x, z - game.player.position.z) / 140);
  function shotSound(s: readonly number[], now: number): void {
    if (now - shotAt < 70) return;
    let near = 0, big = false;
    for (let i = 0; i + 10 <= s.length; i += 10) {
      const n = nearness(s[i]! / 10, s[i + 2]! / 10);
      if (n > near) {
        near = n;
        big = s[i + 6] !== 0;
      }
    }
    if (near <= 0.05) return;
    shotAt = now;
    if (big) game.sound.tone("sawtooth", 220, 70, 0.16, 0.07 * near);
    else game.sound.noise(0.045, 0.05 * near, 2600);
  }
  function blastSound(bl: readonly number[], now: number): void {
    if (now - boomAt < 140) return;
    let near = 0;
    for (let i = 0; i + 4 <= bl.length; i += 4) near = Math.max(near, nearness(bl[i]! / 10, bl[i + 2]! / 10));
    if (near <= 0.05) return;
    boomAt = now;
    game.sound.noise(0.32, 0.16 * near, 700);
    game.sound.tone("sine", 110, 40, 0.3, 0.12 * near);
  }

  // ── Keys and the mouse ─────────────────────────────────────────────────

  function onKey(code: string, event: KeyboardEvent): boolean {
    if (code === "Tab") {
      toggleMap();
      return true;
    }
    const digit = code.startsWith("Digit") ? Number(code.slice(5)) : -1;
    // Choosing an army (on arriving, or changing sides): its number.
    if (why === "choose" && slot < 0) {
      if (digit >= 1 && digit <= 8) act(`serve:${digit - 1}`);
      return /^(Key[A-Z]|Digit\d|F[1-4]|Backspace|Backquote)$/.test(code);
    }
    if (slot < 0) return false;
    if (mode?.k === "menu" && mode.page === "army") {
      if (digit >= 1 && digit <= 8) act(`serve:${digit - 1}`);
      else act("back");
      return true;
    }
    if (digit >= 0) {
      // (Ctrl, Alt or Shift saves: some browsers keep Ctrl + number for themselves.)
      if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) saveGroup(digit);
      else recallGroup(digit);
      return true;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    if (code === "Backquote") return act("army"), true;
    if (code === "Backspace") return act("back"), true;
    if (code === "KeyI") return act("idle"), true;
    const piece = PIECE_KEYS[code];
    /** Lets go of every menu, order and selection, and picks the piece: building again, its preview showing. */
    const toPieces = (tool: "wall" | "floor" | "ramp" | "roof") => {
      setMode(null);
      deselect();
      game.hold(tool);
      return true;
    };
    if (mode?.k === "menu" && mode.page === "cmd") {
      // The general's own menu: its tiles' keys; a piece's key builds; anything else closes it.
      if (code === "KeyN") act("menu:0");
      else if (code === "KeyJ") act("menu:army");
      else if (piece) return toPieces(piece);
      else setMode(null);
      return true;
    }
    if (mode?.k === "menu") {
      const key = code.replace("Key", "");
      const page = mode.page as 0 | 1;
      const kind = BUILDING_KINDS.find((k) => !!BUILDINGS[k].advanced === (page === 1) && BUILDINGS[k].key === key);
      if (kind) act(`b:${kind}`);
      else if (code === "KeyV") act(`menu:${page === 1 ? 0 : 1}`);
      else if (piece) return toPieces(piece);
      else setMode(null);
      return true;
    }
    if (code === "KeyN") return act("menu:0"), true;
    // Placing a building or an order waiting for its click: any other key lets go of it (a piece's key, for that piece).
    const letGo = mode?.k === "place" || mode?.k === "target";
    if (letGo) setMode(null);
    if (selected.size > 0) {
      const found = orders().find(([c]) => c === code);
      if (found) return act(`o:${found[2]}`, event.shiftKey), true;
      if (code === "KeyB") return act("menu:0"), true;
      if (code === "KeyV") return act("menu:1"), true;
      if (piece) return toPieces(piece);
      // The other building keys of every world (R turns, T, G, Q, E) would only confuse while commanding.
      return /^Key[A-Z]$/.test(code);
    }
    if (selectedBuildings.size > 0) {
      const kinds = new Set([...selectedBuildings].flatMap((id) => army.buildings.get(id)?.kind ?? []));
      const key = code.replace("Key", "");
      if (kinds.has("armory")) {
        const up = UPGRADES.find((u) => UPGRADE_KEYS[u] === key);
        if (up) return act(`up:${up}`), true;
      }
      for (const kind of kinds) {
        const unit = MAKES[kind].find((u) => UNITS[u].key === key);
        if (unit) return act(`make:${unit}`, event.shiftKey), true;
      }
      if (code === "KeyR" || code === "KeyY") return act("rally"), true;
      if (code === "KeyQ") return act("cancel"), true;
      if (code === "KeyB") return act("menu:0"), true;
      if (code === "KeyV") return act("menu:1"), true;
      if (piece) return toPieces(piece);
      return /^Key[A-Z]$/.test(code);
    }
    // (Pressing a piece's key normally puts the piece away when it is the one picked: here it is picked again.)
    if (letGo && piece) return toPieces(piece);
    return false;
  }

  function onMouse(button: number, down: boolean, tapped = false): boolean {
    if (!down) {
      if (button === 0) {
        painting = false;
        const took = tookLeft;
        tookLeft = false;
        return took;
      }
      const took = tookRight;
      tookRight = false;
      return took;
    }
    const take = () => {
      if (button === 0) tookLeft = true;
      else tookRight = true;
      return true;
    };
    if (mapOn) {
      const spot: WireSpot = [cursor.x, 0, cursor.z];
      if (button === 0) {
        faceSpot(cursor.x, cursor.z);
        toggleMap();
      } else if (slot >= 0 && selected.size > 0 && mode?.k === "target" && mode.what === "patrol") {
        if (patrol(spot, shift())) setMode(shift() ? { k: "target", what: "patrol" } : null);
      } else if (slot >= 0 && selected.size > 0) order(mode?.k === "target" && mode.what !== "rally" ? mode.what : "move", spot, shift());
      else if (slot >= 0 && selectedBuildings.size > 0) send({ m: "rally", ids: [...selectedBuildings], at: spot });
      return take();
    }
    if (slot < 0) return why === "choose" ? take() : false;
    if (mode?.k === "place") {
      if (button === 0) placeBuilding(mode.kind);
      else setMode(null);
      return take();
    }
    if (mode?.k === "target") {
      if (button === 0) {
        const what = mode.what;
        const spot = aimSpot();
        if (what === "patrol") {
          // (Shift keeps Patrol in hand for the next pair of ends.)
          if (patrol(spot, shift())) setMode(shift() ? { k: "target", what: "patrol" } : null);
          return take();
        }
        if (what === "rally") {
          if (spot) {
            send({ m: "rally", ids: [...selectedBuildings], at: spot });
            mark(spot, [1, 0.9, 0.4]);
          }
        } else if (what === "amove") {
          // On an enemy: that one. On the ground: there, fighting on the way.
          const p = pick();
          if (p?.k === "unit" && !mine(p.u.owner)) send({ m: "order", ids: [...selected], k: "attack", on: [1, p.u.id], q: shift() });
          else if (p?.k === "building" && !mine(p.b.o)) send({ m: "order", ids: [...selected], k: "attack", on: [2, p.b.i], q: shift() });
          else if (p?.k === "general" && !mine(p.slot)) send({ m: "order", ids: [...selected], k: "attack", on: [3, p.slot], q: shift() });
          else order("amove", spot, shift());
        } else order(what, spot, shift());
        if (!shift()) setMode(null);
      } else setMode(null);
      return take();
    }
    if (mode) {
      setMode(null);
      return take();
    }
    if (button === 0) {
      // A click on something of this general's selects it, a piece in hand or not; on the ground, the piece in hand is
      // built there. With Remove in hand a click takes down, never selects. (A phone's Select button selects.)
      if (!tapped && selected.size === 0 && selectedBuildings.size === 0 && game.hands() === "remove") return false;
      if (clickOn(pick())) return take();
      if (selected.size > 0 || selectedBuildings.size > 0) {
        deselect();
        return take();
      }
      return false;
    }
    if (button === 2) {
      if (selected.size > 0) {
        smartOrder();
        return take();
      }
      if (selectedBuildings.size > 0) {
        const spot = aimSpot();
        if (spot) {
          send({ m: "rally", ids: [...selectedBuildings], at: spot });
          mark(spot, [1, 0.9, 0.4]);
        }
        return take();
      }
    }
    return false;
  }

  panel.onButton = (id) => {
    if (id === "t-select") {
      onMouse(0, true, true);
      onMouse(0, false);
    } else if (id === "t-order") {
      onMouse(2, true);
      onMouse(2, false);
    } else if (id === "t-army") act("army");
    else if (id === "t-menu") act("menu:0");
    else if (id === "t-map") act("map");
    else act(id);
  };

  // ── Every frame ────────────────────────────────────────────────────────

  function update(): void {
    const now = performance.now();
    if (faceHome > 0 && start && game.playing()) {
      faceHome--;
      game.face(Math.atan2(start[0], start[1]));
      // (Looking level, so the crosshair is on the Core and not on the ground before it: a click selects it.)
      game.look(0.04);
    }
    // Whoever is selected and has gone is let go of.
    for (const id of selected) if (!army.units.has(id) || !mine(army.units.get(id)!.owner)) selected.delete(id) && (cardDirty = true);
    for (const id of selectedBuildings) if (!army.buildings.has(id)) selectedBuildings.delete(id) && (cardDirty = true);

    // Holding the button and sweeping the crosshair: everything of mine it passes over.
    if (painting && game.playing()) {
      const p = pick();
      if (p?.k === "unit" && mine(p.u.owner) && !selected.has(p.u.id)) {
        selected.add(p.u.id);
        cardDirty = true;
      }
    }

    if (now - lookAt > 250) {
      lookAt = now;
      // (Not before the general has arrived at their base: where they stood on the menu is not seen.)
      if (slot >= 0 && placed) {
        const sources: [number, number, number][] = [];
        for (const u of army.units.values()) {
          if (!mine(u.owner)) continue;
          const def = UNITS[u.kind];
          sources.push([u.x, u.z, def.sight * (!def.air && u.y > 1.5 ? HIGH_GROUND : 1)]);
        }
        for (const b of army.buildings.values()) if (mine(b.o)) sources.push([(b.x + BUILDINGS[b.kind].size / 2) * CELL, (b.z + BUILDINGS[b.kind].size / 2) * CELL, BUILDINGS[b.kind].sight * (b.d > 0 ? 0.4 : 1)]);
        const p = game.player.position;
        sources.push([p.x, p.z, generalSight(p.y)]);
        sight.look(sources);
      }
      // A report holds until its spot has been looked at again for a moment: then what is there now is what shows.
      for (const [id, r] of reports) {
        if (!sight.sees(r.x, r.z)) r.lookedAt = 0;
        else if (r.lookedAt === 0) r.lookedAt = now;
        else if (now - r.lookedAt > 900) reports.delete(id);
      }
      // Every general wears their army's colour while they command it (this one too): whose general is whose is plain.
      const dressed = new Set<string>();
      for (const g of generals) {
        for (const pid of g.pids) {
          dressed.add(pid);
          game.wear(pid, g.color);
        }
      }
      if (slot >= 0 && game.myId()) {
        dressed.add(game.myId());
        game.wear(game.myId(), ARMY_COLORS[slot] ?? null);
      }
      for (const id of wearing) if (!dressed.has(id)) game.wear(id, null);
      wearing = dressed;
      // Only generals in sight are drawn: where the others are is not this general's to know (and whoever is not a general is not here at all).
      for (const o of game.others()) {
        const g = generals.find((x) => x.pids.includes(o.id));
        game.conceal(o.id, !g || slot < 0 || (!!o.position && !sight.sees(o.position[0], o.position[2])));
      }
    }

    let hint: string | null = null;
    if (mode?.k === "place" && game.playing()) {
      const at = placing(mode.kind);
      if (at) {
        const size = BUILDINGS[mode.kind].size * CELL;
        const c: [number, number, number] = at.why ? [1, 0.3, 0.25] : [0.4, 1, 0.5];
        const x = at.cx * CELL + size / 2, z = at.cz * CELL + size / 2;
        // The building itself, see-through, where it would stand; and its corners, so the square it takes is plain.
        army.ghost(mode.kind, x, z, !at.why);
        for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) army.mark(at.cx * CELL + dx * size, 0, at.cz * CELL + dz * size, 0.6, c);
        hint = at.why ? `<span class="bad">${at.why}</span>` : `<span class="ok">${BUILDINGS[mode.kind].label}: ${game.touch ? "tap Place" : "click"} to put it here</span>`;
      } else hint = `<span class="bad">Aim at the ground</span>`;
    } else if (mode?.k === "target") {
      hint = `<b>${pendingText(mode)}</b>`;
      // A patrol's first end, until the other is clicked.
      if (mode.from) army.mark(mode.from[0], mode.from[1], mode.from[2], 1.2, [0.5, 1, 0.5]);
    }
    if (hint !== lastHint) {
      lastHint = hint;
      cardDirty = true;
    }
    panel.setTouch(mode?.k === "place" ? "Place" : mode?.k === "target" ? "Go" : mapOn ? "Face" : "Select", mode || mapOn ? (mapOn ? "Send" : "Cancel") : "Order");

    // Rally points of what is selected.
    for (const id of selectedBuildings) {
      const b = army.buildings.get(id);
      if (b?.rx !== undefined && b.rz !== undefined) army.mark(b.rx, 0, b.rz, 1.2, [1, 0.9, 0.4]);
    }

    army.update(now);

    if (now - mapAt > (mapOn ? 60 : 220)) {
      mapAt = now;
      const dots: MapDot[] = [];
      const fresh = (since: number) => Math.max(0, 1 - (now - since) / REPORT_FADES_MS);
      for (const f of army.fields.values()) dots.push({ x: (f.cx + 0.5) * CELL, z: (f.cz + 0.5) * CELL, color: f.vent ? "#8a4fe0" : f.amount > 0 ? "#1f9e94" : "#8f8a78", size: 2 });
      // Buildings out of sight are as they were last seen: a report, as old as that.
      for (const b of army.buildings.values()) dots.push({ x: (b.x + BUILDINGS[b.kind].size / 2) * CELL, z: (b.z + BUILDINGS[b.kind].size / 2) * CELL, color: army.colorOf(b.o), size: 2 + BUILDINGS[b.kind].size * 1.6, ...(b.stale && !mine(b.o) ? { report: fresh(b.staleAt || now) } : {}) });
      for (const r of reports.values()) dots.push({ x: r.x, z: r.z, color: army.colorOf(r.owner), size: UNITS[r.kind].radius > 1.9 ? 4 : 3, report: fresh(r.at) });
      for (const u of army.units.values()) dots.push({ x: u.x, z: u.z, color: selected.has(u.id) ? "#ffffff" : army.colorOf(u.owner), size: UNITS[u.kind].radius > 1.9 ? 3 : 2 });
      for (const o of game.others()) {
        const g = generals.find((x) => x.pids.includes(o.id));
        if (g && o.position && sight.sees(o.position[0], o.position[2])) dots.push({ x: o.position[0], z: o.position[2], color: g.color, size: 4 });
      }
      while (pings.length > 0 && now - pings[0]!.at > 2500) pings.shift();
      const p = game.player.position;
      panel.drawMap({
        visible: slot >= 0 ? sight.visible : null,
        dots,
        me: { x: p.x, z: p.z, yaw: game.viewYaw() },
        pings: pings.map((q) => ({ x: q.x, z: q.z, age: ((now - q.at) % 1250) / 1250, color: q.color })),
        cursor: mapOn ? cursor : null,
      });
    }

    if (cardDirty || now - cardAt > 500) {
      cardDirty = false;
      cardAt = now;
      const shown = row();
      shownRow = shown.tiles;
      shownStatus = shown.status;
      shownHtml = shown.html ?? null;
      // (While something is being made, the bar on it is kept moving.)
      if (shownHtml) cardAt = now - 350;
      game.row(shown.tiles, (id) => act(id));
      panel.setStatus(game.touch ? shown.status : null, game.touch ? shownHtml : null);
      panel.setBank(slot >= 0 ? { color: ARMY_COLORS[slot] ?? "#888888", lithium: bank.l, plasma: bank.p, used: bank.used, max: bank.max, upkeep: upkeep(bank.used) } : null);
    }
    // The line over the row: where a building would go or what an order waits for, else what is selected. (A phone has it under its bank: the row is at the top there.)
    game.panel(game.touch ? null : (hint ?? shownHtml ?? (shownStatus ? escapeHtml(shownStatus) : null)));
  }

  // ── Pieces: whose they are, and what is in their way ───────────────────

  /** A piece cut into a building or a field, as the server judges it (see Sim.blocks). */
  function cutsIn(spec: PieceSpec): boolean {
    const [x0, y0, z0] = gridBox(spec);
    const full = (x: number, z: number) => {
      for (const b of army.buildings.values()) {
        const s = BUILDINGS[b.kind].size;
        if (x >= b.x && x < b.x + s && z >= b.z && z < b.z + s && y0 < Math.ceil(BUILDINGS[b.kind].height / LEVEL)) return true;
      }
      if (y0 < 1) for (const f of army.fields.values()) if (f.cx === x && f.cz === z) return true;
      return false;
    };
    if (spec.type === "wall") return spec.rot % 2 === 0 ? full(x0, z0 - 1) && full(x0, z0) : full(x0 - 1, z0) && full(x0, z0);
    return full(x0, z0);
  }
  const escapeHtml = (text: string) => text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

  return {
    message: onMessage,
    joined() {
      // Joined again (a dropped connection, or the room restarted): the server sends everything afresh. What is drawn
      // stays until it has, so the war does not blink out and in; what is selected stays selected.
      army.refresh(performance.now());
    },
    update,
    key: onKey,
    mouse: onMouse,
    // With something selected or a menu open the wheel does nothing: a trackpad's two fingers brushing it would
    // otherwise let go of what was selected, or change the piece out of sight. (A piece's key goes back to building.)
    wheel() {
      return slot >= 0 && (mapOn || mode !== null || selected.size > 0 || selectedBuildings.size > 0);
    },
    look(dx, dy) {
      if (!mapOn) return false;
      const k = panel.metresPerPixel();
      cursor.x = Math.max(-HALF, Math.min(HALF, cursor.x + dx * k));
      cursor.z = Math.max(-HALF, Math.min(HALF, cursor.z - dy * k));
      return true;
    },
    busy: () => slot >= 0 && (selected.size > 0 || selectedBuildings.size > 0 || mode !== null || mapOn),
    spawn() {
      if (slot >= 0 && start) {
        placed = true;
        // (They arrive looking at their own Core, which stands a few cells further from the middle of the map.)
        faceHome = 3;
        return game.clearSpot(start[0], 0.95, start[1]) ?? [start[0], 0.95, start[1]];
      }
      // (Not a general: they are kept on the menu, and this is only where the menu looks from.)
      return [2.5, 0.95, -62.5];
    },
    useTool(id) {
      // The Command tile: the general's own menu, on the row.
      if (id === "command") act("menu:cmd");
    },
    blocks: (spec) => slot < 0 || cutsIn(spec) || bank.l < PIECE_COST,
    whyBlocked(spec) {
      if (slot < 0) return "Choose an army first";
      if (cutsIn(spec)) return "A building or a field is in the way";
      return `Not enough lithium: a piece costs ${PIECE_COST}`;
    },
    keeps(piece) {
      if (slot < 0) return "You are not a general here";
      return myPids.has(ownerPid(piece.id)) || ownerPid(piece.id) === game.myId() ? null : "That is another general's: your army can shoot it down";
    },
    aimRemove() {
      const p = pick();
      if (p?.k === "building" && mine(p.b.o)) {
        const size = BUILDINGS[p.b.kind].size * CELL;
        army.mark(p.b.x * CELL + size / 2, 0, p.b.z * CELL + size / 2, size * 0.74, [1, 0.3, 0.25]);
        game.panel(`<span class="bad">${BUILDINGS[p.b.kind].label}: click to take it down (half its price back)</span>`);
      }
    },
    remove() {
      const p = pick();
      if (p?.k !== "building" || !mine(p.b.o)) return false;
      send({ m: "scrap", id: p.b.i });
      game.play("remove");
      return true;
    },
    // (Kept in reach for the checks that drive the game.)
    army,
    sight,
    // Units on the ground are solid to the general (thrown ones too: a tank coming down is not walked through).
    *bodies() {
      if (slot < 0) return;
      for (const u of army.units.values()) {
        const def = UNITS[u.kind];
        if (def.air || u.goneAt) continue;
        if (u.kind === "trooper") yield { x: u.x, y: u.y, z: u.z, yaw: u.h, w: 0.8, h: 1.85, d: 0.8 };
        else yield { x: u.x, y: u.y, z: u.z, yaw: u.h, w: def.radius * 1.7, h: def.height, d: def.radius * 2.1 };
      }
    },
    // Buildings stand still: as boxes, for the page's questions of what is solid (where to put a general down, say).
    solids() {
      const out: [number, number, number, number, number, number][] = [];
      for (const b of army.buildings.values()) out.push(buildingBox(b.kind, b.x, b.z));
      return out;
    },
    reports,
    panel,
    get row() {
      return shownRow;
    },
    get status() {
      return shownStatus;
    },
    get why() {
      return why;
    },
    get slot() {
      return slot;
    },
    get bank() {
      return bank;
    },
    get generals() {
      return generals;
    },
    get mode() {
      return mode;
    },
    selected,
    selectedBuildings,
    run: act,
    pick,
  };
}
