import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import "@babylonjs/core/Physics/joinedPhysicsEngineComponent";
import { PhysicsRaycastResult } from "@babylonjs/core/Physics/physicsRaycastResult";
import { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin";
import type { PhysicsEngine } from "@babylonjs/core/Physics/v2/physicsEngine";
import { Scene } from "@babylonjs/core/scene";
import HavokPhysics from "@babylonjs/havok";
import havokWasmUrl from "@babylonjs/havok/lib/esm/HavokPhysics.wasm?url";
import { Sfx } from "./audio";
import { BuildState, type BuildOp, type PlaceProblem } from "./game/buildState";
import { CELL, LEVEL } from "./game/constants";
import { editTileAt } from "./game/edit";
import { History } from "./game/history";
import { createIdSource } from "./game/ids";
import {
  editGrid,
  isValidEdit,
  normalizeSpec,
  materialFor,
  MATERIALS,
  slotKey,
  type Piece,
  type PieceSpec,
  type Rot,
  type PieceType,
} from "./game/pieces";
import { Siege } from "./game/siege";
import { findLooseAfterRemoval } from "./game/structure";
import { aimTarget } from "./game/aim";
import { facingRot } from "./game/targeting";
import { COLORS, loadIdentity, saveIdentity } from "./identity";
import { Input } from "./input";
import { TouchControls } from "./ui/touch";
import { NetClient, pageBuild, worldUrl } from "./net/client";
import { olderBuild } from "./net/protocol";
import { flooding, PIN_AIM_RANGE, PIN_RANGE, type ChatTo } from "./net/chat";
import { ChatView } from "./ui/chat";
import { Store } from "./ui/store";
import { Tips } from "./ui/tips";
import { pieceLabel, type Environment } from "./game/environments";
import type { WorldFeature, WorldPage } from "./worlds/pageDoors";
import { reachOf } from "./ui/worlds";
import { SyncedState } from "./net/sync";
import { loadSettings, saveSettings } from "./settings";
import { CameraRig, SCOPE_ZOOMS } from "./render/cameraRig";
import { EditOverlay } from "./render/editOverlay";
import type { GraphicsApi } from "./render/engine";
import { Ghost, PieceView, PlaceFlash } from "./render/pieceView";
import { IGNORE_BUILDER } from "./render/physicsGroups";
import { Player } from "./render/player";
import { Debris } from "./render/debris";
import { RemotePlayers } from "./render/remotePlayers";
import { TowerFlag } from "./render/towerFlags";
import { TrebuchetView } from "./render/trebuchetView";
import { TREBUCHET_BASE } from "./render/geometry";
import { checkRange, hitPoints, launchPoint, maxRange, rangeTo, trebuchetBase, type Vec } from "./game/trebuchet";
import { Graphics } from "./render/graphics";
import { ResolutionGovernor } from "./render/resolution";
import { SoldierView } from "./render/soldierView";
import { clock, Hud, showStats, type HotbarItem } from "./ui/hud";

type Tool = PieceType | "remove";
const TOOLS: readonly Tool[] = ["wall", "floor", "ramp", "roof", "remove", "trebuchet"];
/** Quick keys beside WASD, one per piece. F1 to F4 and the number keys work too. */
const TOOL_KEYS: Record<Tool, string> = { wall: "Z", floor: "F", ramp: "X", roof: "C", remove: "V", trebuchet: "B" };
const FUNCTION_KEYS: Record<string, Tool> = { F1: "wall", F2: "floor", F3: "ramp", F4: "roof" };

/** Which way a ramp climbs for each rotation: rot 0 toward +z, 1 toward +x, 2 toward -z, 3 toward -x. */
const RAMP_DIR: Record<number, [number, number]> = { 0: [0, 1], 1: [1, 0], 2: [0, -1], 3: [-1, 0] };
/** How long a ramp just placed keeps setting the direction of the next (ms). */
const RUSH_MEMORY = 1500;
/** The Turn setting, as seen by the builder. */
const TURN_NAMES = ["straight", "right", "back", "left"];

/** "free": building only. "siege": the army comes (not on the menu for now). "menu": nothing chosen yet. */
type Mode = "menu" | "siege" | "free";

/** How far from the camera line a piece can be removed or edited, in metres. */
const REMOVE_REACH = 16;
const EDIT_REACH = 14;

const PROBLEM_TEXT: Record<PlaceProblem, string> = {
  occupied: "Something is already there",
  unsupported: "Needs something to attach to",
  bounds: "Outside the building area",
};

interface EditSession {
  id: string;
  /** Tiles marked to be cut out, one bit each. */
  cut: number;
  /** While the mouse is held: true marks tiles, false unmarks them. */
  paint: boolean | null;
  hover: number;
}

/**
 * Runs the game in one world: `env` is its rules and names, `page` everything
 * it draws and plays itself. Nothing in here knows which world that is.
 */
export async function startGame(canvas: HTMLCanvasElement, engine: AbstractEngine, api: GraphicsApi, env: Environment, page: WorldPage): Promise<void> {
  /** This world's siege engine, as it reads in a sentence ("trebuchet"). */
  const engineName = env.siege.name.toLowerCase();
  const scene = new Scene(engine);
  scene.skipPointerMovePicking = true;

  const havok = await HavokPhysics({ locateFile: () => havokWasmUrl });
  // The world's pull on rubble.
  scene.enablePhysics(new Vector3(0, -env.rubbleGravity, 0), new HavokPlugin(true, havok));
  const physics = scene.getPhysicsEngine() as PhysicsEngine;

  // Game logic: plain modules that know nothing about rendering.
  const state = new BuildState();
  // Own changes go through `synced`, which applies them at once and sends them to the shared world.
  const synced = new SyncedState(state);
  const history = new History(synced);
  /** Makes ids for new pieces; the prefix comes from the server on joining, so ids never clash. */
  let idSource = createIdSource();
  const nextId = () => idSource();

  const rig = new CameraRig(scene);
  const world = page.scenery(scene, rig.camera);
  const view = new PieceView(scene, state, world.shadows, env, page.pieceSkin);
  const ghost = new Ghost(scene, env.roof);
  const flash = new PlaceFlash(scene, env.roof);
  const overlay = new EditOverlay(scene);
  const player = new Player(scene, world.shadows, env, page.outfit);
  const input = new Input(canvas);
  // Phones and tablets: on-screen controls (created once the game's actions exist, below).
  let touch: TouchControls | null = null;
  const sfx = new Sfx(page.sounds);
  const army = new SoldierView(scene, world.shadows);
  const remotes = new RemotePlayers(scene, world.shadows, page.outfit);
  const trebuchets = new TrebuchetView(scene, state, world.shadows, env, page.siegeModel(scene));
  // Rubble: a copy of the piece's mesh (a trebuchet with its frame and arm on it).
  const debris = new Debris(scene, (piece) => (piece.type === "trebuchet" ? trebuchets.debrisMesh(piece, view.debrisMesh(piece)) : view.debrisMesh(piece)), env, page.dust);
  const flag = new TowerFlag(scene);
  /** What this world has of its own (vehicles, say), started below once the game's parts exist. */
  let feature: WorldFeature | null = null;
  /** Hits taken by damaged pieces (from the server), so their cracks show. */
  const damage = new Map<string, number>();
  const tint = (id: string) => {
    const piece = state.get(id);
    const hits = damage.get(id);
    if (piece && hits) view.setDamage(piece, Math.min(0.9, hits / hitPoints(piece, env)));
  };
  // A damaged piece drawn again (after a correction from the server) keeps its cracks.
  state.subscribe((op, piece) => {
    if (op.kind === "remove") damage.delete(piece.id);
    else if (damage.has(piece.id)) tint(piece.id);
  });
  const resolution = new ResolutionGovernor(engine);

  const settings = loadSettings();
  rig.sensitivity = settings.mouseSpeed;
  sfx.muted = settings.muted;

  let mode: Mode = "menu";
  /** The tallest towers as last heard from the server: [height, x, y, z, pieces]. */
  let tallest: readonly [number, number, number, number, number][] = [];
  /** Siege (hidden for now) is played alone: the build is local and nothing is sent or received. */
  let solo = false;
  let placedCount = 0;
  /** Kinds of piece placed this session, and pieces placed in all (for the first-game tips). */
  const placedKinds = new Set<string>();
  let placedTotal = 0;
  let lastKnock = 0;
  let lastCrumble = 0;
  const siege = new Siege(state, {
    hit(piece, damage) {
      view.setDamage(piece, damage);
      const now = performance.now();
      if (now - lastKnock > 110) {
        lastKnock = now;
        sfx.knock();
      }
    },
    destroyed() {
      const now = performance.now();
      if (now - lastCrumble > 200) {
        lastCrumble = now;
        sfx.crumble();
      }
    },
    wave(wave, soldiers) {
      hud.banner(wave === 1 ? "The army is here!" : `Wave ${wave}: ${soldiers} soldiers`);
      sfx.horn();
    },
  });

  /** The selected hotbar slot, or -1 when nothing is selected (just running around). */
  let toolIndex = 0;
  let materialIndex = 0;
  let rotation = 0;
  /** The direction of the last ramp placed straight ahead, and when (for ramp rushing). */
  let rushRot: number | null = null;
  let rushAt = 0;
  let placing = false;
  /** The slot of the last placement tried; holding the button places again when the target moves on. */
  let lastTriedSlot = "";
  /** What the build target is this frame. */
  let aimSpec: PieceSpec | null = null;
  let aimProblem: PlaceProblem | null = null;
  /** The piece on the crosshair, for removing and editing. */
  let aimPieceId: string | undefined;
  let editing: EditSession | null = null;

  const items: HotbarItem[] = TOOLS.map((tool) => ({
    id: tool,
    label: tool === "remove" ? "Remove" : pieceLabel(tool, env),
    key: TOOL_KEYS[tool],
  }));
  const hud = new Hud(items, {
    selectTool: (i) => toggleTool(i),
    play(next) {
      sfx.unlock();
      startMode(next);
      void input.lock().then((locked) => {
        // The browser said no (it sometimes does right after Esc, or when the page is not in front).
        if (!locked && !input.locked) hud.menuNote("Your browser did not let the game take the mouse. Click Start building again.");
      });
    },
    resume() {
      backToBuilding();
    },
    setMouseSpeed(speed) {
      settings.mouseSpeed = speed;
      rig.sensitivity = speed;
      saveSettings(settings);
    },
    setMuted(muted) {
      settings.muted = muted;
      sfx.muted = muted;
      saveSettings(settings);
      // A little blip confirms sound is back (the click counts as permission to play it).
      if (!muted) {
        sfx.unlock();
        sfx.select();
      }
    },
    setGraphics(mode) {
      settings.graphics = mode;
      saveSettings(settings);
      graphics.apply(mode);
      debris.limit = graphics.effective === "saver" ? 40 : 140;
    },
    setIdentity(next) {
      identity.name = next.name;
      identity.color = next.color;
      saveIdentity(identity);
      net.setIdentity(identity);
      player.avatar.setColor(identity.color);
    },
    menu() {
      mode = "menu";
      siege.reset(false);
      hud.setSiege(null);
      hud.show("menu");
    },
  });

  /**
   * Begins a game in the given mode. Free build joins the shared world as it is;
   * siege clears a private copy of the world, and leaving it fetches the shared one again.
   */
  function startMode(next: Mode): void {
    finishEdit(false);
    const wasSolo = solo;
    solo = next === "siege";
    if (solo) {
      for (const piece of [...state.all()]) state.apply({ kind: "remove", id: piece.id });
      synced.reset([...state.all()]);
    } else if (wasSolo) net.requestSnapshot();
    history.clear();
    placedCount = 0;
    mode = next;
    siege.reset(next === "siege");
    // Start on open ground, clear of anything built at ground level for 3 cells
    // around, so nobody begins boxed in inside a fort or its courtyard.
    const built = new Set<string>();
    for (const p of state.all()) if (p.y <= 1) built.add(`${p.x},${p.z}`);
    player.respawn((cx, cz) => {
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) if (built.has(`${cx + dx},${cz + dz}`)) return false;
      return true;
    });
    // Face the tallest tower, so the first thing a builder sees is what to beat.
    const top = tallest[0];
    rig.yaw = top ? Math.atan2(top[1] - player.position.x, top[3] - player.position.z) : 0;
    rig.pitch = 0.22;
    hud.setSiege(null);
    // The first-game tips count walking from where the builder starts.
    tipStart.copyFrom(player.position);
  }

  function selectTool(index: number): void {
    // Picking a piece while editing confirms the edit, so you can go straight back to building.
    finishEdit(true);
    toolIndex = ((index % TOOLS.length) + TOOLS.length) % TOOLS.length;
    hud.select(toolIndex);
    setTurn(0);
    lastTriedSlot = "";
    sfx.select();
  }

  /** Puts the selected piece away: no preview, and clicks build nothing. */
  function deselectTool(): void {
    finishEdit(true);
    toolIndex = -1;
    placing = false;
    hud.select(-1);
    ghost.hide();
    aimSpec = null;
    hud.toast("Building off: press a piece key to build");
    sfx.select();
  }

  /** A piece key or hotbar click: selects that piece, or puts it away if it is already selected. */
  function toggleTool(index: number): void {
    if (!builder) return lockedNote();
    if (index === toolIndex && !editing) deselectTool();
    else selectTool(index);
  }

  // ── Who may build here ───────────────────────────────────────────────
  /** May build here: always in a free world; in a paid one, with the Full Game (the server decides on joining). */
  let builder = !env.paid;
  /** A visitor tried to build: the unlock panel, with the button to buy (or, owning it, how to take it back). */
  function lockedNote(): void {
    sfx.deny();
    if (elsewhere) return void hud.toast(touch ? "Your key is in use on another device: tap Use it here" : "Your key is in use on another device: press U to use it here", 3500);
    openPanel("unlock");
  }
  /** Their key was taken over by another device (one player at a time): owned, but visiting here. */
  let elsewhere = false;
  /** Takes the key back from the other device ("Use it here"). */
  function useKeyHere(): void {
    if (store.key) net.sendKey(store.key);
  }
  /** The bar while visiting: an offer to unlock, or (the key in use elsewhere) a way to take it back. */
  function paintVisitBar(): void {
    const what = document.querySelector("#visit-bar .what")!;
    const button = document.getElementById("visit-buy")!;
    // Sharing a key and the other person is playing: the way to a key of their own.
    document.getElementById("visit-own")!.hidden = !elsewhere;
    document.getElementById("visit-bar")!.classList.toggle("elsewhere", elsewhere);
    if (elsewhere) {
      what.innerHTML = "<b>Your key is in use on another device</b> · one player at a time";
      button.innerHTML = `Use it here<kbd class="desk">U</kbd>`;
    } else {
      what.innerHTML = `<b>Visiting the ${env.name}</b> · building here comes with the Full Game`;
      button.innerHTML = `Unlock · $7<kbd class="desk">U</kbd>`;
    }
  }
  /** Visiting (no building: nothing selected, the hotbar faded) or building. */
  function setBuilder(on: boolean): void {
    const was = builder;
    builder = on;
    document.body.classList.toggle("visiting", !on);
    const play = document.getElementById("play-free") as HTMLButtonElement;
    if (!play.disabled) play.textContent = on ? "Start building" : `Visit the ${env.name}`;
    if (!on) {
      finishEdit(false);
      toolIndex = -1;
      placing = false;
      hud.select(-1);
      ghost.hide();
      aimSpec = null;
    } else if (!was) selectTool(0);
  }

  /** What the badge last showed, so it is only redrawn when that changes. */
  let shownMaterial = "";

  /**
   * The material badge: the chosen material and where it can go, or, when the
   * build target is too high for it, the material that will be used instead.
   */
  function showMaterial(): void {
    const chosen = MATERIALS[materialIndex]!;
    const used = aimSpec && !crewOn ? materialFor(aimSpec.type, chosen, aimSpec.y, env) : chosen;
    const key = `${chosen}>${used}`;
    if (key === shownMaterial) return;
    shownMaterial = key;
    const mine = env.materials[chosen], shown = env.materials[used];
    const note = used === chosen ? reachOf(env, chosen) : `${mine.label} only to storey ${mine.maxLevel + 1}`;
    hud.setMaterial(shown.label, shown.color, "T", note);
    touch?.setMaterial(shown.label, `rgb(${shown.color.map((c) => Math.round(c * 255)).join(", ")})`);
  }

  function cycleMaterial(): void {
    materialIndex = (materialIndex + 1) % MATERIALS.length;
    showMaterial();
    sfx.select();
  }

  /** What to tell the builder when a piece cannot go where they aim. */
  function problemText(spec: PieceSpec, problem: PlaceProblem): string {
    if (problem !== "unsupported") return PROBLEM_TEXT[problem];
    if (spec.type === "trebuchet") return `A ${engineName} needs a floor or the ground under it`;
    // A ramp next to a ramp climbing another way: they only join in a straight line.
    if (spec.type === "ramp" && state.around(spec, 1).some((p) => p.type === "ramp" && p.rot !== normalizeSpec(spec).rot && Math.abs(p.y - spec.y) <= 1)) {
      return "Ramps turn only on a floor: put a floor down first";
    }
    return PROBLEM_TEXT[problem];
  }

  function placeAtAim(announce: boolean): void {
    if (!aimSpec) return;
    lastTriedSlot = slotKey(aimSpec);
    if (aimProblem) {
      if (announce) {
        hud.toast(problemText(aimSpec, aimProblem));
        sfx.deny();
      }
      return;
    }
    // Too high for the chosen material: the strongest one allowed there.
    const piece = { ...aimSpec, id: nextId(), material: materialFor(aimSpec.type, MATERIALS[materialIndex]!, aimSpec.y, env), edit: 0 };
    if (history.do({ kind: "place", piece })) {
      // A turned ramp is a one-off: the next one climbs straight ahead again.
      if (piece.type === "ramp" && rotation !== 0) setTurn(0);
      else if (piece.type === "ramp") {
        rushRot = piece.rot;
        rushAt = performance.now();
      }
      placedCount++;
      placedTotal++;
      placedKinds.add(piece.type);
      flash.play(aimSpec);
      sfx.place();
    }
  }

  /** Removes a piece and, in the same undo step, everything that no longer connects to the ground. */
  function removePiece(id: string): void {
    const piece = state.get(id);
    if (!piece || !history.do({ kind: "remove", id })) return;
    const loose = findLooseAfterRemoval(state, [piece]).map((p) => ({ ...p }));
    for (const p of loose) history.extend({ kind: "remove", id: p.id });
    // What the removed piece held up comes down as rubble, as it does when a stone hits.
    fallAsRubble(loose);
    if (loose.length > 0) sfx.crumble();
    else sfx.remove();
  }

  /** Pieces that lost their support tumble down as rubble (they are already gone from the build). */
  function fallAsRubble(pieces: readonly Piece[]): void {
    if (pieces.length === 0 || solo) return;
    const c = pieces[0]!;
    debris.spawn(pieces, new Set(), [(c.x + 0.5) * CELL, c.y * LEVEL, (c.z + 0.5) * CELL]);
  }

  /**
   * Applies removals from someone else (or the server). In a batch of several,
   * the first is the piece taken away on purpose and the rest are what it held
   * up, which fall as rubble (as they did on the page that removed them).
   */
  function fallingIn(ops: readonly BuildOp[]): Piece[] {
    const removed = ops.filter((op): op is Extract<BuildOp, { kind: "remove" }> => op.kind === "remove");
    if (removed.length < 2) return [];
    return removed.slice(1).flatMap((op) => (state.get(op.id) ? [{ ...state.get(op.id)! }] : []));
  }

  function undo(): void {
    finishEdit(false);
    if (history.undo()) sfx.undo();
    else hud.toast("Nothing to undo");
  }

  function redo(): void {
    finishEdit(false);
    if (history.redo()) sfx.redo();
    else hud.toast("Nothing to redo");
  }

  function startEdit(): void {
    if (!builder) return lockedNote();
    const piece = aimPieceId ? state.get(aimPieceId) : undefined;
    if (!piece) {
      hud.toast(pieceFarAway() ? "Get closer to edit it" : "Aim at a wall or floor to edit it");
      return sfx.deny();
    }
    if (!editGrid(piece.type)) {
      hud.toast("Only walls and floors can be edited for now");
      return sfx.deny();
    }
    editing = { id: piece.id, cut: piece.edit, paint: null, hover: -1 };
    placing = false;
    ghost.hide();
    hud.setEditing(true);
    sfx.select();
  }

  /** Leaves edit mode, applying the marked cuts when `confirm` is true. */
  function finishEdit(confirm: boolean): void {
    if (!editing) return;
    const session = editing;
    editing = null;
    overlay.hide();
    hud.setEditing(false);
    const piece = state.get(session.id);
    if (!confirm || !piece || session.cut === piece.edit) return;
    if (!isValidEdit(piece.type, session.cut)) {
      hud.toast("Leave at least one tile");
      return sfx.deny();
    }
    if (history.do({ kind: "edit", id: piece.id, edit: session.cut })) sfx.edit();
  }

  /** Puts every tile of the piece being edited back. */
  function resetEdit(): void {
    if (!editing) return;
    const piece = state.get(editing.id);
    editing.cut = 0;
    finishEdit(false);
    if (piece && piece.edit !== 0 && history.do({ kind: "edit", id: piece.id, edit: 0 })) sfx.edit();
  }

  function updateEdit(): void {
    const session = editing!;
    const piece = state.get(session.id);
    const centre = piece && Math.hypot(player.position.x - (piece.x + 0.5) * CELL, player.position.z - (piece.z + 0.5) * CELL);
    if (!piece || centre === undefined || centre > EDIT_REACH + CELL) return finishEdit(true);
    const f = rig.forward;
    session.hover = editTileAt(piece, rig.pivot.x, rig.pivot.y, rig.pivot.z, f.x, f.y, f.z, EDIT_REACH);
    if (session.paint !== null && session.hover >= 0) {
      const bit = 1 << session.hover;
      session.cut = session.paint ? session.cut | bit : session.cut & ~bit;
    }
    overlay.show(piece, session.cut, session.hover);
  }

  /**
   * True after the mouse was released because the player switched to another
   * window (not because they pressed Esc). Then there is no pause panel: one
   * click on the game captures the mouse again and play carries on.
   */
  let away = false;

  // ── A new version is live ────────────────────────────────────────────
  /** This page is from an older build than the server's: it can watch, not move or build, until it restarts. */
  let outdated = false;
  /** Says a new version is ready, and offers to restart (the world keeps going behind the panel). */
  function showUpdate(): void {
    if (outdated) return;
    outdated = true;
    placing = false;
    chat.close();
    if (input.locked) {
      nextView = "update";
      input.unlock();
    } else hud.show("update");
  }
  /** Reloads the page, noting where the builder is, so the new version puts them back there. */
  function restart(): void {
    const resume: Resume = {
      env: env.id,
      at: Date.now(),
      playing: mode !== "menu",
      x: player.position.x,
      y: player.position.y,
      z: player.position.z,
      yaw: rig.yaw,
      pitch: rig.pitch,
    };
    sessionStorage.setItem(RESUME_KEY, JSON.stringify(resume));
    location.reload();
  }
  document.getElementById("update-restart")!.addEventListener("click", restart);
  /**
   * A second way to hear of a new version, besides the world saying so when it
   * reconnects (Cloudflare moves a running world onto new code a little after a
   * deploy, not at once): the site's own build, asked every 45 seconds while
   * the tab is in view, and on coming back to it.
   */
  async function checkVersion(): Promise<void> {
    if (outdated || document.hidden) return;
    try {
      const { build } = (await (await fetch("/api/store", { cache: "no-store" })).json()) as { build?: string };
      if (build && olderBuild(pageBuild(), build)) showUpdate();
    } catch {
      // Offline: the next check, or the world on reconnecting, will tell.
    }
  }
  setInterval(() => void checkVersion(), 45_000);
  document.addEventListener("visibilitychange", () => void checkVersion());
  /** The panel to show once play has stopped (it stops first: the mouse is released, or on touch the controls hide). */
  let nextView: "unlock" | "settings" | "paused" | "update" | null = null;
  /** Stops playing (if playing) and shows a panel. */
  function openPanel(view: "unlock" | "settings" | "paused"): void {
    if (input.locked) {
      nextView = view;
      input.unlock();
    } else hud.show(view);
  }
  let unlockedAt = 0;
  const isAway = () => document.hidden || !document.hasFocus();

  function showAway(): void {
    away = true;
    hud.show("away");
  }

  input.onLockChange = (locked) => {
    placing = false;
    if (touch) touch.visible = locked;
    if (locked) {
      away = false;
      hud.menuNote(null);
      return hud.show("playing");
    }
    chat.close();
    finishEdit(false);
    if (outdated) return hud.show("update");
    // A panel asked for on the way out of play (the unlock panel, the settings to type a key in).
    if (nextView) {
      const view = nextView;
      nextView = null;
      away = false;
      return hud.show(view);
    }
    if (siege.captured) return hud.showCaptured({ seconds: siege.elapsed, waves: siege.wave, placed: placedCount });
    if (mode === "menu") return hud.show("menu");
    unlockedAt = performance.now();
    if (isAway()) return showAway();
    // The window may lose focus a moment after the mouse is released, so wait
    // briefly before deciding this was Esc (pause) rather than a window switch.
    hud.show("away");
    setTimeout(() => {
      if (input.locked || mode === "menu") return;
      if (isAway()) showAway();
      else {
        away = false;
        hud.show("paused");
      }
    }, 150);
  };
  // Switching windows just after the release also counts as stepping away.
  window.addEventListener("blur", () => {
    if (!input.locked && mode !== "menu" && !siege.captured && performance.now() - unlockedAt < 600) showAway();
  });
  // Back from another window: a click on the game carries on (it does not place a piece).
  // Listen for pointerdown: Babylon cancels it while the mouse is free, so no mousedown follows.
  canvas.addEventListener("pointerdown", () => {
    if (!input.locked && away) {
      sfx.unlock();
      void input.lock();
    }
  });
  /**
   * Closes the settings panel and carries on building. The panel goes at once;
   * if the browser will not capture the mouse from this key or click (it
   * refuses for Esc, and for a moment after the mouse was released), one click
   * on the game carries on.
   */
  function backToBuilding(): void {
    if (outdated) return hud.show("update");
    sfx.unlock();
    showAway();
    void input.lock();
  }
  // Esc toggles the settings: opens them while stepped away, closes them while open.
  window.addEventListener("keydown", (e) => {
    if (e.code !== "Escape" || input.locked || outdated) return;
    if (away) {
      away = false;
      hud.show("paused");
    } else if (hud.view === "paused" || hud.view === "unlock") backToBuilding();
  });
  // Stepped away (Esc out of the chat line, another window): any key carries on, not only a
  // click. Browsers never let Esc itself take the mouse back, but any other key may.
  window.addEventListener("keydown", (e) => {
    if (!away || input.locked || outdated || mode === "menu" || e.code === "Escape" || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if ((e.target as HTMLElement | null)?.closest("input, textarea, select")) return;
    e.preventDefault();
    sfx.unlock();
    const code = e.code;
    void input.lock().then((locked) => {
      // The key that brought them back counts as held (W keeps walking) until it is let go.
      if (locked && !(e as KeyboardEvent & { released?: boolean }).released) input.press(code, true);
    });
    const release = (up: KeyboardEvent) => {
      if (up.code !== code) return;
      (e as KeyboardEvent & { released?: boolean }).released = true;
      window.removeEventListener("keyup", release);
    };
    window.addEventListener("keyup", release);
  });
  input.onMouseDown = (button) => {
    sfx.unlock();
    // Middle click pings the spot under the crosshair.
    if (button === 1) return ping();
    // Riding something of the world's own: hands are busy (visitors too).
    if (feature?.busy?.()) return;
    if (!builder) return lockedNote();
    // Flying through the air, or flat on the ground: hands are busy.
    if (player.knockedDown) return;
    if (crewOn) {
      // Aim and shoot: the crosshair is the target.
      if (button === 0) fireStone();
      return;
    }
    if (editing) {
      if (button === 0 && editing.hover >= 0) {
        editing.paint = ((editing.cut >> editing.hover) & 1) === 0;
        updateEdit();
      } else if (button === 2) resetEdit();
      return;
    }
    // Work the target out now, not from the last frame, so a piece key pressed a
    // moment before the click already counts.
    updateAim();
    if (button === 0) {
      if (toolIndex < 0) return;
      if (TOOLS[toolIndex] === "remove") {
        if (aimPieceId) removePiece(aimPieceId);
        else if (pieceFarAway()) hud.toast("Get closer to remove it");
      } else {
        placing = true;
        placeAtAim(true);
      }
    } else if (button === 2) {
      if (aimPieceId) removePiece(aimPieceId);
      else if (pieceFarAway()) hud.toast("Get closer to remove it");
    }
  };
  input.onMouseUp = (button) => {
    if (button === 0) {
      placing = false;
      if (editing) editing.paint = null;
    }
  };
  // The wheel moves along the hotbar; from nothing selected it starts at either end.
  input.onWheel = (direction) => {
    // On a trebuchet the wheel zooms the scope.
    if (crewOn) {
      rig.zoom = Math.max(0, Math.min(SCOPE_ZOOMS.length - 1, rig.zoom + direction));
      return;
    }
    wheelTool(direction);
  };
  const wheelTool = (direction: 1 | -1) => selectTool(toolIndex < 0 ? (direction > 0 ? 0 : TOOLS.length - 1) : toolIndex + direction);
  input.onKey = (code, event) => {
    const command = event.ctrlKey || event.metaKey;
    if (command && code === "KeyZ") return event.shiftKey ? redo() : undo();
    if (command && code === "KeyY") return redo();
    if (command) return;
    // U: unlock the Full Game (while visiting a paid world).
    if (code === "KeyU" && !builder) return elsewhere ? useKeyHere() : openPanel("unlock");
    // O: a key of their own, when the one they share is being played on another device.
    if (code === "KeyO" && !builder && elsewhere) return openPanel("unlock");
    // Enter talks (while editing it still confirms the cut).
    if ((code === "Enter" || code === "NumpadEnter") && !editing) return chat.open();
    // "/" too, as in Minecraft and Roblox.
    if (code === "Slash") return chat.open();
    // H gets on and off: a siege engine, or something of the world's own.
    if (code === "KeyH") return crewOn || !feature?.board?.() ? toggleCrew() : undefined;
    // On a trebuchet the hands are busy: no building until getting off.
    if (crewOn || feature?.busy?.()) return;
    const fnTool = FUNCTION_KEYS[code];
    if (fnTool) return toggleTool(TOOLS.indexOf(fnTool));
    if (code.startsWith("Digit")) {
      const n = Number(code.slice(5));
      if (n >= 1 && n <= TOOLS.length) toggleTool(n - 1);
    } else if (code === "KeyG") {
      if (editing) finishEdit(true);
      else startEdit();
    } else if (code === "Enter") finishEdit(true);
    else if (code === "KeyT") cycleMaterial();
    else if (code === "KeyR") {
      setTurn((rotation + 1) % 4);
      hud.toast(`Ramp turned: ${TURN_NAMES[rotation]}`);
      sfx.rotate();
    } else if (code === "KeyQ") undo();
    else if (code === "KeyE") redo();
    else {
      const index = TOOLS.findIndex((tool) => `Key${TOOL_KEYS[tool]}` === code);
      if (index >= 0) toggleTool(index);
    }
  };

  // Character: stepped right after physics so it collides with this frame's world.
  scene.onAfterPhysicsObservable.add(() => {
    const dt = Math.min(0.05, engine.getDeltaTime() / 1000);
    if (dt <= 0) return;
    // On a trebuchet the builder stands still at its controls.
    const on = input.locked && !crewOn && !outdated;
    // Arrow keys and WASD both move the builder.
    const key = (a: string, b: string) => (input.isDown(a) || input.isDown(b) ? 1 : 0);
    // Touch: the on-screen joystick adds its own push (and runs when pushed all the way).
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    const moving = {
      strafe: on ? clamp(key("ArrowRight", "KeyD") - key("ArrowLeft", "KeyA") + input.axis.x) : 0,
      forward: on ? clamp(key("ArrowUp", "KeyW") - key("ArrowDown", "KeyS") + input.axis.y) : 0,
      run: on && (input.isDown("ShiftLeft") || input.isDown("ShiftRight") || input.axis.run),
      jump: on && input.isDown("Space"),
      yaw: rig.yaw,
    };
    // Riding something of the world's own moves the player in its own way; otherwise they walk.
    if (crewOn || player.knockedDown || !feature?.drive?.(dt, moving)) player.step(dt, moving);
  });

  const ray = new PhysicsRaycastResult();
  const rayEnd = new Vector3();

  /** How steeply the ground under the builder rises in the direction they face (for ramp rushing). */
  function groundSlope(): number {
    if (!player.onGround) return 0;
    const under = state.occupant({
      type: "ramp",
      x: Math.floor(player.position.x / CELL),
      y: Math.floor(player.feetY / LEVEL),
      z: Math.floor(player.position.z / CELL),
      rot: 0,
    });
    if (!under || under.type !== "ramp") return 0;
    const q = facingRot(rig.yaw);
    if (under.rot === q) return LEVEL / CELL;
    if (under.rot === (q + 2) % 4) return -LEVEL / CELL;
    return 0;
  }

  /** True when the crosshair is on a piece that is just out of reach (for a helpful message). */
  function pieceFarAway(): boolean {
    rig.pivot.addToRef(rig.forward.scale(80), rayEnd);
    physics.raycastToRef(rig.pivot, rayEnd, ray, IGNORE_BUILDER);
    return ray.hasHit && view.pieceIdOf(ray.body) !== undefined;
  }

  function updateAim(): void {
    rig.pivot.addToRef(rig.forward.scale(REMOVE_REACH), rayEnd);
    physics.raycastToRef(rig.pivot, rayEnd, ray, IGNORE_BUILDER);
    aimPieceId = ray.hasHit ? view.pieceIdOf(ray.body) : undefined;
    aimSpec = null;
    aimProblem = null;
    // Nothing selected: just running around, no preview. (G can still edit what the crosshair is on.)
    if (toolIndex < 0) return ghost.hide();
    const tool = TOOLS[toolIndex]!;

    if (tool === "remove") {
      const piece = aimPieceId ? state.get(aimPieceId) : undefined;
      if (piece) ghost.show(piece, "remove", piece.edit);
      else ghost.hide();
      return;
    }

    // The slot under the crosshair; right in front when no slot is in reach.
    const hitPiece = aimPieceId ? state.get(aimPieceId) : undefined;
    const f = rig.forward;
    aimSpec = aimTarget(
      tool,
      { ox: rig.pivot.x, oy: rig.pivot.y, oz: rig.pivot.z, dx: f.x, dy: f.y, dz: f.z },
      ray.hasHit ? { dist: ray.hitDistance, piece: hitPiece } : null,
      { x: player.position.x, z: player.position.z, feetY: player.feetY, yaw: rig.yaw, pitch: rig.pitch, slope: groundSlope() },
      rotation,
      (spec) => (state.canPlace(spec).ok ? state.touching(spec).length : null),
    ).spec;
    // Ramp rushing: standing on a ramp and facing up it, the next ramp continues the
    // staircase (same line, same direction), whatever a wobbly view or an angled run says.
    if (tool === "ramp" && rotation === 0) {
      // Still building the same staircase (a ramp placed a moment ago, facing roughly
      // its way): keep its direction, so a view near a diagonal does not flip it.
      if (rushRot !== null && performance.now() - rushAt < RUSH_MEMORY && aimSpec.type === "ramp" && aimSpec.rot !== rushRot && facingAlong(rushRot)) {
        aimSpec = { ...aimSpec, rot: rushRot as Rot };
      }
      const next = rampAhead();
      if (next && state.canPlace(next).ok) aimSpec = next;
    }
    const check = state.canPlace(aimSpec);
    aimProblem = check.ok ? null : check.problem;
    ghost.show(aimSpec, check.ok ? "ok" : "bad");
  }

  /** The ramp the builder is standing on, if any. */
  function rampUnderfoot(): Piece | undefined {
    if (!player.onGround) return undefined;
    const cx = Math.floor(player.position.x / CELL), cz = Math.floor(player.position.z / CELL);
    for (const y of [Math.floor(player.feetY / LEVEL), Math.floor((player.feetY - 0.2) / LEVEL)]) {
      const p = state.occupant({ type: "ramp", x: cx, y, z: cz, rot: 0 });
      if (p?.type === "ramp") return p;
    }
    return undefined;
  }

  /**
   * The next ramp of the staircase underfoot: one cell on and one storey up, the
   * same way, while the builder faces within about 60 degrees of up the ramp.
   */
  function rampAhead(): PieceSpec | null {
    const under = rampUnderfoot();
    if (!under) return null;
    const [dx, dz] = RAMP_DIR[under.rot];
    if (!facingAlong(under.rot)) return null;
    return { type: "ramp", x: under.x + dx, y: under.y + 1, z: under.z + dz, rot: under.rot };
  }

  /** True when the builder faces within about 60 degrees of the way a ramp with rotation `rot` climbs. */
  function facingAlong(rot: number): boolean {
    const [dx, dz] = RAMP_DIR[rot]!;
    return Math.sin(rig.yaw) * dx + Math.cos(rig.yaw) * dz >= 0.5;
  }

  /** Sets which way the next ramp turns from straight ahead (0 = straight), and shows it. */
  function setTurn(turn: number): void {
    if (turn === rotation) return;
    rotation = turn;
    lastTriedSlot = "";
    touch?.setTurn(turn, TURN_NAMES[turn]!);
  }

  // ── Chat ─────────────────────────────────────────────────────────────
  const chat = new ChatView(scene, input.touch, (id) => remotes.positionOf(id));
  const here = (): Vec => [player.position.x, player.position.y, player.position.z];
  /** When this builder sent their last few messages and pings (performance.now() ms), for the flood guard. */
  const sentTimes: number[] = [];
  const SLOW_DOWN = "Slow down a little: try again in a moment";
  /** The last message sent, put back in the line if the server could not pass it on. */
  let lastSent: { text: string; to: ChatTo } | null = null;
  chat.onOpenChange = (open) => {
    input.typing = open;
    if (open) {
      placing = false;
      chatted = true;
    }
  };
  // Esc in the chat line opens the menu, as Esc does everywhere in the game (on a computer the
  // browser lets go of the mouse with it anyway; on a tablet's keyboard this does it).
  chat.onEscape = () => input.unlock();
  /** The chat line has been opened (for the first-game tips). */
  let chatted = false;
  const chatChip = document.getElementById("chat-chip")!;
  // With the mouse free (stepped away), the chip can be clicked: back to playing, talking.
  chatChip.addEventListener("click", () => {
    sfx.unlock();
    void input.lock().then((locked) => locked && chat.open());
  });
  let pingTimer = 0;
  /** Someone else said something: the chat button glows, and the first time, a hint to reply. */
  function chatNoticed(): void {
    const button = touch ? document.getElementById("t-chat") : chatChip;
    if (!button || chat.isOpen) return;
    button.classList.remove("ping");
    void button.offsetWidth;
    button.classList.add("ping");
    clearTimeout(pingTimer);
    pingTimer = window.setTimeout(() => button.classList.remove("ping"), 2800);
    if (input.locked && localStorage.getItem("snapfort.replyHint") !== "seen") {
      localStorage.setItem("snapfort.replyHint", "seen");
      hud.toast(touch ? "Someone's talking: tap the chat button to reply" : "Someone's talking: press Enter to reply", 4000);
    }
  }
  chat.onSend = (text, to) => {
    if (solo || !net.online) return "Not connected to the world right now";
    const now = performance.now();
    if (flooding(sentTimes, now)) return SLOW_DOWN;
    sentTimes.push(now);
    lastSent = { text, to };
    // Nearby messages are pinned to the piece the crosshair is on, when it is close.
    net.say(text, to, to === "near" ? aimPoint(PIN_AIM_RANGE, true) : null);
    return null;
  };

  /**
   * The spot under the crosshair within `range` metres (the target on a
   * trebuchet), or null. With `piecesOnly`, only a spot on a built piece.
   */
  function aimPoint(range: number, piecesOnly = false): Vec | null {
    if (crewOn) return piecesOnly ? null : target;
    rig.pivot.addToRef(rig.forward.scale(range), rayEnd);
    physics.raycastToRef(rig.pivot, rayEnd, ray, IGNORE_BUILDER);
    if (ray.hasHit && (!piecesOnly || view.pieceIdOf(ray.body) !== undefined)) return [ray.hitPointWorld.x, ray.hitPointWorld.y, ray.hitPointWorld.z];
    if (piecesOnly) return null;
    const f = rig.forward;
    if (f.y < -0.01) {
      const t = -rig.pivot.y / f.y;
      if (t <= range) return [rig.pivot.x + f.x * t, 0, rig.pivot.z + f.z * t];
    }
    return null;
  }

  /** Marks the spot under the crosshair for builders nearby. */
  function ping(): void {
    if (solo || !net.online) return;
    const now = performance.now();
    if (flooding(sentTimes, now)) return hud.toast(SLOW_DOWN);
    const at = aimPoint(PIN_RANGE);
    const p = here();
    if (!at || Math.hypot(at[0] - p[0], at[1] - p[1], at[2] - p[2]) > PIN_RANGE) {
      hud.toast(at ? "Too far away to ping" : "Aim at something to ping it");
      return sfx.deny();
    }
    sentTimes.push(now);
    lastSent = null;
    net.say("", "near", at);
  }

  // ── The shared world ─────────────────────────────────────────────────
  const identity = loadIdentity();
  player.avatar.setColor(identity.color);
  let joined = false;
  /** This builder's id in the shared world. */
  let myId = "";
  const showOnline = () => hud.setOnline(net.online ? remotes.count + 1 : null);
  const net = new NetClient(worldUrl(env.id), identity, {
    status(status) {
      // An old page the server no longer talks to: the same restart, as for any new version.
      if (status === "outdated") showUpdate();
      hud.setNetStatus(status);
      showOnline();
    },
    welcome(you, pieces, players, moves, extras) {
      joined = true;
      leaveCrew();
      crews.clear();
      for (const [id, by] of extras.crews) crews.set(id, by);
      myId = you;
      idSource = createIdSource(you);
      finishEdit(false);
      if (!solo) synced.reset(pieces);
      history.clear();
      remotes.clear();
      for (const p of players) remotes.join(p);
      const now = performance.now();
      for (const m of moves) remotes.move(m, now);
      showOnline();
      damage.clear();
      for (const [id, hits] of extras.damage) {
        damage.set(id, hits);
        tint(id);
      }
      showTowers(extras.towers);
      setBuilder(extras.builder);
      chat.clear();
      for (const said of extras.chat) chat.show(said, myId, now);
      feature?.joined?.();
    },
    snapshot(pieces) {
      if (solo) return;
      finishEdit(false);
      synced.reset(pieces);
      history.clear();
    },
    ops(_by, ops) {
      if (solo) return;
      const falling = fallingIn(ops);
      synced.remote(ops);
      fallAsRubble(falling);
    },
    ack(seq, rejected, extra) {
      if (solo) return;
      // Pieces the server found had lost their support (beyond what we removed) fall too.
      const falling = extra.flatMap((op) => (op.kind === "remove" && state.get(op.id) ? [{ ...state.get(op.id)! }] : []));
      const refused = synced.ack(seq, rejected, extra);
      fallAsRubble(falling);
      if (refused.some((op) => op.kind === "place")) hud.toast("Someone built there first");
    },
    join(p) {
      if (p.id === myId) return;
      remotes.join(p);
      showOnline();
    },
    leave(id) {
      remotes.leave(id);
      showOnline();
    },
    moves(list) {
      const now = performance.now();
      for (const m of list) remotes.move(m, now);
    },
    crew(id, by) {
      if (by === null) crews.delete(id);
      else crews.set(id, by);
      if (by === myId && !solo) {
        // Already on it (a quiet re-board): keep the view and the target.
        if (crewOn !== id) joinCrew(id);
      }
      else if (crewOn === id) {
        leaveCrew();
        if (!state.get(id)) hud.toast(`Your ${engineName} is gone`);
      }
    },
    shot(shot, id, by, from, to) {
      if (solo) return;
      trebuchets.throwStone(shot, id, from, to);
      if (by === myId) readyAt = performance.now() + env.siege.reload * 1000;
      const near = nearness(from);
      if (near > 0) sfx.launch();
    },
    impact(shot, point, ops, fallen, hits) {
      if (solo) return;
      trebuchets.land(shot);
      // Take copies of what is coming down before it goes, for the rubble.
      const falling = new Set(fallen);
      const pieces = ops.flatMap((op) => (op.kind === "remove" && state.get(op.id) ? [{ ...state.get(op.id)! }] : []));
      const broken = new Set(pieces.filter((p) => !falling.has(p.id)).map((p) => p.id));
      synced.remote(ops);
      debris.spawn(pieces, broken, point);
      debris.puff(new Vector3(...point), 3.2, 1.3);
      for (const [id, n] of hits) {
        damage.set(id, n);
        tint(id);
      }
      const near = nearness(point);
      if (near > 0) {
        sfx.boom(near);
        if (pieces.length > 4) sfx.crumble();
      }
    },
    towers(list) {
      showTowers(list);
    },
    thrown(id, fall) {
      if (solo) return;
      if (id === myId) {
        // The server threw us (or what we stood on went): follow its flight, even
        // if this tab was asleep; waking up later puts us where we came down.
        if (crewOn) leaveCrew();
        finishEdit(false);
        placing = false;
        player.startFall(fall);
        if (fall.time > 0.6) sfx.yelp();
        // A way back of the world's own (rockets, say): its sound when it starts.
        const glide = fall.glideFrom;
        if (glide !== undefined) setTimeout(() => player.gliding && sfx.glide(fall.time - glide), glide * 1000 + 50);
      } else remotes.throw(id, fall, performance.now());
    },
    denied(reason) {
      // The server lost track of us on a trebuchet that is still here: get back on it quietly.
      if (reason === "gone" && crewOn && state.get(crewOn)) {
        net.board(crewOn, [player.position.x, player.feetY, player.position.z]);
        hud.toast(`Back on the ${engineName}: click to fire`);
        return;
      }
      const text: Record<string, string> = {
        busy: `Someone else is on that ${engineName}`,
        far: `Get closer to the ${engineName}`,
        near: `Too close: aim at least ${env.siege.minRange} m away`,
        range: "Out of range: build higher or get closer",
        reload: "Still reloading",
        gone: `That ${engineName} is gone`,
        locked: `Building on the ${env.name} comes with the Full Game`,
      };
      hud.toast(text[reason] ?? "Not now");
      sfx.deny();
    },
    said(said) {
      chat.show(said, myId, performance.now());
      if (said.at && !said.text) sfx.ping();
      else if (said.by !== myId) {
        sfx.chat();
        chatNoticed();
      }
    },
    update() {
      showUpdate();
    },
    world(data) {
      if (!solo) feature?.message?.(data);
    },
    access(on, reason) {
      const wasElsewhere = elsewhere;
      elsewhere = !on && reason === "elsewhere";
      setBuilder(on);
      paintVisitBar();
      // (A message the store just showed, like "you have a new key", is not covered up.)
      const storeSpoke = performance.now() - noticeAt < 4000;
      if (elsewhere) hud.toast("Your Full Game key is now in use on another device", 4000);
      else if (on && env.paid && !storeSpoke) hud.toast(wasElsewhere ? `Building here again: your key moved to this device` : `Unlocked: build anywhere on the ${env.name}!`, 3000);
    },
    hush() {
      hud.toast(SLOW_DOWN);
      sfx.deny();
      // Not lost: it is back in the line for next time.
      if (lastSent) chat.restore(lastSent.text, lastSent.to);
    },
  });

  // ── Trebuchets ───────────────────────────────────────────────────────
  /** Who is on each trebuchet (trebuchet id → builder id). */
  const crews = new Map<string, string>();
  /** The trebuchet this builder is on, and where it is aimed. */
  let crewOn: string | null = null;
  let target: Vec | null = null;
  /** When this builder's trebuchet can throw again (performance.now() ms). */
  let readyAt = 0;

  /** 1 right here, falling to 0 at 160 m: how loud something is. */
  const nearness = (p: Vec) => Math.max(0, 1 - Math.hypot(p[0] - player.position.x, p[1] - player.position.y, p[2] - player.position.z) / 160);

  /** The trebuchet within reach of the builder, nearest first. */
  function trebuchetInReach(): Piece | undefined {
    let best: Piece | undefined;
    let bestDist = Infinity;
    for (const p of state.near(player.position.x, player.feetY + 0.5, player.position.z)) {
      if (p.type !== "trebuchet") continue;
      const [x, y, z] = trebuchetBase(p);
      const d = Math.hypot(x - player.position.x, z - player.position.z);
      if (d <= env.siege.boardReach && Math.abs(y - player.feetY) < 3 && d < bestDist) {
        best = p;
        bestDist = d;
      }
    }
    return best;
  }

  function toggleCrew(): void {
    if (!builder && !crewOn) return lockedNote();
    if (crewOn) {
      net.leaveTrebuchet();
      leaveCrew();
      return;
    }
    if (solo || player.knockedDown) return;
    const t = trebuchetInReach();
    if (!t) {
      hud.toast(`Stand next to a ${engineName} to get on`);
      return sfx.deny();
    }
    if (crews.has(t.id) && crews.get(t.id) !== myId) {
      hud.toast(`Someone else is on that ${engineName}`);
      return sfx.deny();
    }
    net.board(t.id, [player.position.x, player.feetY, player.position.z]);
  }

  function joinCrew(id: string): void {
    const t = state.get(id);
    if (!t) return;
    finishEdit(false);
    placing = false;
    ghost.hide();
    crewOn = id;
    target = null;
    // Scope: look from above the trebuchet with nothing of it, or of yourself, in the way.
    rig.scope = new Vector3(...scopePoint(t));
    rig.zoom = 0;
    trebuchets.hidden = id;
    player.avatar.setEnabled(false);
    document.body.classList.add("scoped");
    // Stand on its turntable, on its own floor: to the right of the frame and a
    // little back, so the camera over the right shoulder looks past it at the target.
    const [x, y, z] = trebuchetBase(t);
    const fx = Math.sin(rig.yaw), fz = Math.cos(rig.yaw);
    player.teleport(x + fz * 1.55 - fx * 0.8, y + TREBUCHET_BASE + 0.95, z - fx * 1.55 - fz * 0.8);
    sfx.select();
  }

  function leaveCrew(): void {
    if (!crewOn) return;
    crewOn = null;
    target = null;
    rig.scope = null;
    rig.zoom = 0;
    trebuchets.hidden = null;
    player.avatar.setEnabled(true);
    document.body.classList.remove("scoped");
    trebuchets.showTarget(null, null, false);
    hud.setCrew(null);
  }

  /** Where the scope looks from: just above where the stone is released. */
  function scopePoint(t: Piece): Vec {
    const [x, y, z] = launchPoint(t, env);
    return [x, y + 0.8, z];
  }

  /**
   * On a trebuchet the crosshair is the target: every frame, the spot under it
   * becomes the target, the trebuchet turns toward it, and the ring and arc
   * follow (green in range, red not).
   */
  function aimScope(): void {
    const t = crewOn ? state.get(crewOn) : undefined;
    if (!t) return;
    const start = rig.pivot.clone();
    // Further than any trebuchet reaches (the Moon's, from the very top).
    const end = start.add(rig.forward.scale(1500));
    let point: Vec | null = null;
    // Look past this trebuchet's own frame.
    for (let tries = 0; tries < 3 && !point; tries++) {
      physics.raycastToRef(start, end, ray, IGNORE_BUILDER);
      if (!ray.hasHit) break;
      const hit = ray.hitPointWorld;
      if (view.pieceIdOf(ray.body) === t.id) start.copyFrom(hit.add(rig.forward.scale(0.2)));
      else point = [hit.x, hit.y, hit.z];
    }
    target = point;
    if (!point) return trebuchets.showTarget(null, null, false);
    trebuchets.aimAt(t.id, point);
    trebuchets.showTarget(launchPoint(t, env), point, checkRange(t, point, env) === "ok");
  }

  function fireStone(): void {
    const t = crewOn ? state.get(crewOn) : undefined;
    if (!t) return;
    aimScope();
    if (!target) {
      hud.toast("Aim at something to fire at it");
      return sfx.deny();
    }
    const range = checkRange(t, target, env);
    if (range !== "ok") {
      hud.toast(range === "near" ? `Too close: aim at least ${env.siege.minRange} m away` : "Out of range: build higher or get closer");
      return sfx.deny();
    }
    if (performance.now() < readyAt) {
      hud.toast("Still reloading");
      return sfx.deny();
    }
    net.fire(t.id, target);
  }

  /** Keeps the trebuchet panel and the get-on hint up to date. */
  function updateCrewHud(now: number): void {
    const t = crewOn ? state.get(crewOn) : undefined;
    // Off it somehow (thrown, or its floor gave way): let go of it.
    if (t && !player.knockedDown) {
      const [x, y, z] = trebuchetBase(t);
      if (Math.hypot(player.position.x - x, player.position.z - z) > env.siege.boardReach || Math.abs(player.feetY - y) > 3) {
        net.leaveTrebuchet();
        leaveCrew();
        return;
      }
    }
    if (t) {
      hud.setHint(null);
      const reload = Math.max(0, (readyAt - now) / 1000);
      const reach = `range ${env.siege.minRange}–${Math.round(maxRange(t, env))} m`;
      let status: { text: string; ok: boolean };
      if (!target) status = { text: `Aim at a target · ${reach}`, ok: true };
      else {
        const d = Math.round(rangeTo(t, target));
        const range = checkRange(t, target, env);
        if (range === "near") status = { text: `Target ${d} m: too close (min ${env.siege.minRange} m)`, ok: false };
        else if (range === "far") status = { text: `Target ${d} m: out of range (max ${Math.round(maxRange(t, env))} m)`, ok: false };
        else if (reload > 0) status = { text: `Target ${d} m · reloading ${reload.toFixed(1)} s`, ok: false };
        else status = { text: `Target ${d} m · ready: ${touch ? "tap Fire" : "click to fire"}`, ok: true };
      }
      // Zoom as a magnification: how much bigger things look than without the scope.
      const magnify = Math.tan(SCOPE_ZOOMS[0] / 2) / Math.tan(SCOPE_ZOOMS[rig.zoom]! / 2);
      hud.setCrew({ ...status, zoom: `${magnify < 1.05 ? 1 : magnify.toFixed(1)}×` });
      return;
    }
    hud.setCrew(null);
    const near = input.locked && !solo && !player.knockedDown ? trebuchetInReach() : undefined;
    const busy = !!near && crews.has(near.id) && crews.get(near.id) !== myId;
    // Nothing of the shared kind to get on: something of the world's own, perhaps.
    const own = !near && input.locked && !solo && !player.knockedDown ? (feature?.prompt?.() ?? null) : null;
    // Touch: a Get on button instead of the key hint.
    touch?.setBoard((!!near && !busy) || !!own, own?.button);
    if (own) return hud.setHint(touch ? null : own.text);
    if (!near) return hud.setHint(null);
    if (touch && !busy) return hud.setHint(null);
    hud.setHint(busy ? `Someone is on this ${engineName}` : `<kbd>H</kbd> get on the ${engineName}`);
  }

  function showTowers(list: readonly [number, number, number, number, number][]): void {
    tallest = list;
    flag.show(list);
  }
  if (input.touch) {
    // A pretend key event for on-screen buttons that do a key's job.
    const keyEvent = { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, repeat: false } as KeyboardEvent;
    touch = new TouchControls(input, {
      place: (down) => (down ? input.onMouseDown(0) : input.onMouseUp(0)),
      remove: () => {
        input.onMouseDown(2);
        input.onMouseUp(2);
      },
      key: (code) => input.onKey(code, keyEvent),
      fire: () => input.onMouseDown(0),
      zoom: () => {
        rig.zoom = (rig.zoom + 1) % SCOPE_ZOOMS.length;
      },
      settings: () => input.unlock(),
      chat: () => chat.open(),
      ping: () => ping(),
    });
  }
  // The Full Game: a saved key goes with joining; buying or typing one in sends it at once.
  const store = new Store();
  store.onOwned = (key) => net.sendKey(key);
  // "Have a key?" on the menu or the unlock panel: the settings, with the key box open.
  store.onHaveKey = () => {
    openPanel(mode === "menu" ? "settings" : "paused");
    store.showEnter(true);
  };
  document.getElementById("visit-buy")!.addEventListener("click", () => (elsewhere ? useKeyHere() : openPanel("unlock")));
  document.getElementById("visit-own")!.addEventListener("click", () => openPanel("unlock"));
  /** When the store last showed a message. */
  let noticeAt = -Infinity;
  store.onNotice = (text) => {
    noticeAt = performance.now();
    hud.toast(text, 4500);
  };
  document.getElementById("unlock-later")!.addEventListener("click", () => (mode === "menu" ? hud.show("menu") : backToBuilding()));
  const tips = new Tips(input.touch);
  const tipStart = player.position.clone();
  net.key = store.key;
  net.connect();
  void store.init();
  // Leaving the page (another world, a reload, closing the tab): say goodbye at once, so this
  // builder leaves everyone's count now. A page brought back from the browser's back/forward
  // cache starts afresh.
  window.addEventListener("pagehide", () => net.close());
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) location.reload();
  });

  let statsTimer = 0;
  let fitTimer = 0;
  /** The canvas's size in CSS pixels when the drawing size was last set. */
  let fittedSize = "";
  /** Sets the drawing size again if the canvas's size on screen has changed. */
  function checkCanvasSize(): void {
    const size = `${canvas.clientWidth}x${canvas.clientHeight}`;
    if (size === fittedSize || canvas.clientWidth === 0 || canvas.clientHeight === 0) return;
    fittedSize = size;
    engine.resize();
  }
  /**
   * Keeps the picture drawn at the canvas's real size, so it is never stretched.
   * Browsers announce most size changes with a resize event, but an iPhone app
   * opened from the home screen often settles into full-screen landscape after
   * launch without one (the picture came out stretched). So the canvas itself
   * is watched, rotating and the visible area changing count too, and the size
   * is checked twice a second as a last resort.
   */
  function fitCanvas(): void {
    // Once now too: the screen may have changed while the game was loading.
    checkCanvasSize();
    new ResizeObserver(checkCanvasSize).observe(canvas);
    for (const target of [window, window.visualViewport]) target?.addEventListener("resize", checkCanvasSize);
    window.addEventListener("orientationchange", () => setTimeout(checkCanvasSize, 300));
    window.addEventListener("pageshow", checkCanvasSize);
  }
  const stats = showStats();
  /** Which graphics chip is drawing, for the ?stats readout. */
  const gpuName = (() => {
    const info = (engine as AbstractEngine & { getInfo?: () => { vendor: string; renderer: string } }).getInfo?.() ?? { vendor: "", renderer: "" };
    return [info.vendor, info.renderer].filter((s) => s && s !== "unknown").join(" ") || "unknown GPU";
  })();

  scene.onBeforeRenderObservable.add(() => {
    resolution.update(engine.getDeltaTime() / 1000);
    const dt = Math.min(0.05, engine.getDeltaTime() / 1000);
    const [dx, dy] = input.takeLook();
    rig.look(dx, dy);
    rig.update(player.position, dt);
    player.animate(dt, rig.yaw);
    world.update(dt);
    flash.update(dt);

    feature?.update?.(dt);
    if (crewOn || player.knockedDown || feature?.busy?.()) {
      ghost.hide();
      placing = false;
      if (crewOn && input.locked) aimScope();
    } else if (input.locked && editing) {
      updateEdit();
    } else if (input.locked) {
      updateAim();
      // Holding the button keeps placing as the build target moves to new slots.
      if (placing && aimSpec && slotKey(aimSpec) !== lastTriedSlot) placeAtAim(false);
    } else {
      ghost.hide();
    }

    if (mode === "siege" && input.locked && !siege.captured) {
      siege.update(dt, player.position.x, player.feetY, player.position.z);
      if (siege.captured) {
        sfx.caught();
        // Leaving pointer lock brings up the captured panel.
        input.unlock();
      }
    }
    army.update(siege.soldiers, input.locked ? dt : 0);

    // Send this frame's changes as one action, and where the builder is.
    const now = performance.now();
    if (!solo && net.online) {
      const action = synced.takeAction();
      if (action) net.sendAction(action.seq, action.ops);
      net.sendMove(player.position.x, player.position.y, player.position.z, rig.yaw, player.onGround, now, player.tumbling);
    }
    remotes.update(dt, now, rig.camera.globalPosition, rig.camera.fov);
    showMaterial();
    if (touch) touch.mode = crewOn ? "crew" : editing ? "edit" : "build";
    trebuchets.update(dt);
    debris.update(dt);
    flag.update(dt);
    chat.update(now, here());
    tips.update(
      { moved: Math.hypot(player.position.x - tipStart.x, player.position.z - tipStart.z), placed: placedTotal, kinds: placedKinds, chatted },
      input.locked && builder && !crewOn && !siege.captured,
      now,
    );
    updateCrewHud(now);
    view.flush();

    // Now and then, make sure the picture is drawn at the canvas's real size (see fitCanvas).
    fitTimer -= dt;
    if (fitTimer <= 0) {
      fitTimer = 0.5;
      checkCanvasSize();
    }

    statsTimer -= dt;
    if (statsTimer <= 0 && stats) {
      statsTimer = 0.25;
      hud.setStats(`${engine.getFps().toFixed(0)} fps · ${api} · ${graphics.effective} · ${resolution.scale}× · ${gpuName}`);
    }
    if (mode === "siege") {
      if (siege.wave === 0) hud.setSiege(`The army arrives in ${clock(Math.ceil(siege.nextWave))}`, siege.nextWave < 10);
      else hud.setSiege(`Wave ${siege.wave} · ${siege.soldiers.length} soldiers · next in ${clock(Math.ceil(siege.nextWave))} · held ${clock(siege.elapsed)}`);
    }
  });

  feature =
    page.start?.({
      scene,
      shadows: world.shadows,
      env,
      build: state,
      player,
      ride: (id, seat) => {
        if (id === myId) player.riding = seat;
        else remotes.ride(id, seat);
      },
      viewYaw: () => rig.yaw,
      myId: () => myId,
      send: (data) => {
        if (!solo && net.online) net.sendWorld(data);
      },
      toast: (text, ms) => hud.toast(text, ms),
      sound: sfx.kit,
      touch: input.touch,
    }) ?? null;

  if (builder) selectTool(0);
  else setBuilder(false);
  showMaterial();
  hud.showMouseSpeed(settings.mouseSpeed);
  hud.showMuted(settings.muted);
  const graphics = new Graphics(engine, world, resolution, gpuName, input.touch);
  graphics.apply(settings.graphics);
  debris.limit = graphics.effective === "saver" ? 40 : 140;
  hud.showGraphics(settings.graphics, graphics.autoMode);
  fitCanvas();
  engine.runRenderLoop(() => scene.render());
  await scene.whenReadyAsync();
  // Wait a moment for the shared world, so the first pieces placed are not lost when it arrives.
  for (let waited = 0; !joined && waited < 5000; waited += 100) await new Promise((r) => setTimeout(r, 100));
  hud.showIdentity(identity, COLORS);
  hud.ready(joined);
  // Back from a restart for a new version: in the same place, playing again.
  const resume = takeResume(env.id);
  if (resume?.playing) {
    startMode("free");
    player.teleport(resume.x, resume.y, resume.z);
    rig.yaw = resume.yaw;
    rig.pitch = resume.pitch;
    if (touch) void input.lock();
    else {
      // The browser needs a click to take the mouse: the world in view until then.
      away = true;
      hud.show("away");
    }
    hud.toast("Updated to the latest version", 2500);
  }
  if (!builder) (document.getElementById("play-free") as HTMLButtonElement).textContent = `Visit the ${env.name}`;

  if (import.meta.env.DEV) {
    // Handles for poking at the game from the browser console while developing.
    Object.assign(window, {
      snapfort: { scene, engine, flag, chat, store, env, get feature() { return feature; }, get builder() { return builder; }, get myId() { return myId; }, resolution, trebuchets, debris, get crewOn() { return crewOn; }, get target() { return target; }, damage, get graphics() { return graphics; }, state, synced, net, remotes, history, player, rig, input, selectTool, nextId, siege, startMode, removePiece, audit: () => [...view.audit(state), ...trebuchets.audit()], get editing() { return editing; } },
    });
  }
}

/** Where a builder was when they restarted for a new version (sessionStorage, read once). */
interface Resume {
  env: string;
  at: number;
  playing: boolean;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}
const RESUME_KEY = "snapfort.resume";

/** The saved place from a restart in this world in the last few minutes, if any (and forgets it). */
function takeResume(env: string): Resume | null {
  const raw = sessionStorage.getItem(RESUME_KEY);
  sessionStorage.removeItem(RESUME_KEY);
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as Resume;
    const ok = r.env === env && Date.now() - r.at < 10 * 60_000 && [r.x, r.y, r.z, r.yaw, r.pitch].every(Number.isFinite);
    return ok ? r : null;
  } catch {
    return null;
  }
}
