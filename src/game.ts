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
  MATERIAL_DEFS,
  normalizeSpec,
  MATERIAL_MAX_LEVEL,
  materialFor,
  type MaterialId,
  MATERIALS,
  PIECE_DEFS,
  slotKey,
  type Piece,
  type PieceSpec,
  type PieceType,
} from "./game/pieces";
import { Siege } from "./game/siege";
import { findLooseAfterRemoval } from "./game/structure";
import { aimTarget } from "./game/aim";
import { facingRot } from "./game/targeting";
import { COLORS, loadIdentity, saveIdentity } from "./identity";
import { Input } from "./input";
import { TouchControls } from "./ui/touch";
import { NetClient, worldUrl } from "./net/client";
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
import { TowerFlags } from "./render/towerFlags";
import { TrebuchetView } from "./render/trebuchetView";
import { TREBUCHET_BASE } from "./render/geometry";
import { checkRange, hitPoints, launchPoint, maxRange, rangeTo, TREBUCHET, trebuchetBase, type Vec } from "./game/trebuchet";
import { Graphics } from "./render/graphics";
import { ResolutionGovernor } from "./render/resolution";
import { SoldierView } from "./render/soldierView";
import { createWorld } from "./render/world";
import { clock, Hud, showStats, type HotbarItem } from "./ui/hud";

type Tool = PieceType | "remove";
const TOOLS: readonly Tool[] = ["wall", "floor", "ramp", "roof", "remove", "trebuchet"];
/** Quick keys beside WASD, one per piece. F1 to F4 and the number keys work too. */
const TOOL_KEYS: Record<Tool, string> = { wall: "Z", floor: "F", ramp: "X", roof: "C", remove: "V", trebuchet: "B" };
const FUNCTION_KEYS: Record<string, Tool> = { F1: "wall", F2: "floor", F3: "ramp", F4: "roof" };

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

export async function startGame(canvas: HTMLCanvasElement, engine: AbstractEngine, api: GraphicsApi): Promise<void> {
  const scene = new Scene(engine);
  scene.skipPointerMovePicking = true;

  const havok = await HavokPhysics({ locateFile: () => havokWasmUrl });
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok));
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
  const world = createWorld(scene, rig.camera);
  const view = new PieceView(scene, state, world.shadows);
  const ghost = new Ghost(scene);
  const flash = new PlaceFlash(scene);
  const overlay = new EditOverlay(scene);
  const player = new Player(scene, world.shadows);
  const input = new Input(canvas);
  // Phones and tablets: on-screen controls (created once the game's actions exist, below).
  let touch: TouchControls | null = null;
  const sfx = new Sfx();
  const army = new SoldierView(scene, world.shadows);
  const remotes = new RemotePlayers(scene, world.shadows);
  const trebuchets = new TrebuchetView(scene, state, world.shadows);
  // Rubble: a copy of the piece's mesh (a trebuchet with its frame and arm on it).
  const debris = new Debris(scene, (piece) => (piece.type === "trebuchet" ? trebuchets.debrisMesh(piece, view.debrisMesh(piece)) : view.debrisMesh(piece)));
  const flags = new TowerFlags(scene);
  /** Hits taken by damaged pieces (from the server), so their cracks show. */
  const damage = new Map<string, number>();
  const tint = (id: string) => {
    const piece = state.get(id);
    const hits = damage.get(id);
    if (piece && hits) view.setDamage(piece, Math.min(0.9, hits / hitPoints(piece)));
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
    label: tool === "remove" ? "Remove" : PIECE_DEFS[tool].label,
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
  }

  function selectTool(index: number): void {
    // Picking a piece while editing confirms the edit, so you can go straight back to building.
    finishEdit(true);
    toolIndex = ((index % TOOLS.length) + TOOLS.length) % TOOLS.length;
    hud.select(toolIndex);
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
    if (index === toolIndex && !editing) deselectTool();
    else selectTool(index);
  }

  /** What the badge last showed, so it is only redrawn when that changes. */
  let shownMaterial = "";
  const reach: Record<MaterialId, string> = { metal: "storeys 1–10", brick: "storeys 1–30", wood: "any storey" };

  /**
   * The material badge: the chosen material and where it can go, or, when the
   * build target is too high for it, the material that will be used instead.
   */
  function showMaterial(): void {
    const chosen = MATERIALS[materialIndex]!;
    const used = aimSpec && !crewOn ? materialFor(aimSpec.type, chosen, aimSpec.y) : chosen;
    const key = `${chosen}>${used}`;
    if (key === shownMaterial) return;
    shownMaterial = key;
    const note = used === chosen ? reach[chosen] : `${MATERIAL_DEFS[chosen].label} only to storey ${MATERIAL_MAX_LEVEL[chosen] + 1}`;
    hud.setMaterial(MATERIAL_DEFS[used].label, MATERIAL_DEFS[used].color, "T", note);
    touch?.setMaterial(MATERIAL_DEFS[used].label, `rgb(${MATERIAL_DEFS[used].color.map((c) => Math.round(c * 255)).join(", ")})`);
  }

  function cycleMaterial(): void {
    materialIndex = (materialIndex + 1) % MATERIALS.length;
    showMaterial();
    sfx.select();
  }

  /** What to tell the builder when a piece cannot go where they aim. */
  function problemText(spec: PieceSpec, problem: PlaceProblem): string {
    if (problem !== "unsupported") return PROBLEM_TEXT[problem];
    if (spec.type === "trebuchet") return "A trebuchet needs a floor or the ground under it";
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
    const piece = { ...aimSpec, id: nextId(), material: materialFor(aimSpec.type, MATERIALS[materialIndex]!, aimSpec.y), edit: 0 };
    if (history.do({ kind: "place", piece })) {
      placedCount++;
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
    finishEdit(false);
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
    sfx.unlock();
    showAway();
    void input.lock();
  }
  // Esc toggles the settings: opens them while stepped away, closes them while open.
  window.addEventListener("keydown", (e) => {
    if (e.code !== "Escape" || input.locked) return;
    if (away) {
      away = false;
      hud.show("paused");
    } else if (hud.view === "paused") backToBuilding();
  });
  input.onMouseDown = (button) => {
    sfx.unlock();
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
    if (code === "KeyH") return toggleCrew();
    // On a trebuchet the hands are busy: no building until getting off.
    if (crewOn) return;
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
      rotation = (rotation + 1) % 4;
      lastTriedSlot = "";
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
    const on = input.locked && !crewOn;
    // Arrow keys and WASD both move the builder.
    const key = (a: string, b: string) => (input.isDown(a) || input.isDown(b) ? 1 : 0);
    // Touch: the on-screen joystick adds its own push (and runs when pushed all the way).
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    player.step(dt, {
      strafe: on ? clamp(key("ArrowRight", "KeyD") - key("ArrowLeft", "KeyA") + input.axis.x) : 0,
      forward: on ? clamp(key("ArrowUp", "KeyW") - key("ArrowDown", "KeyS") + input.axis.y) : 0,
      run: on && (input.isDown("ShiftLeft") || input.isDown("ShiftRight") || input.axis.run),
      jump: on && input.isDown("Space"),
      yaw: rig.yaw,
    });
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
    const check = state.canPlace(aimSpec);
    aimProblem = check.ok ? null : check.problem;
    ghost.show(aimSpec, check.ok ? "ok" : "bad");
  }

  // ── The shared world ─────────────────────────────────────────────────
  const identity = loadIdentity();
  player.avatar.setColor(identity.color);
  let joined = false;
  /** This builder's id in the shared world. */
  let myId = "";
  const showOnline = () => hud.setOnline(net.online ? remotes.count + 1 : null);
  const net = new NetClient(worldUrl(), identity, {
    status(status) {
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
        if (!state.get(id)) hud.toast("Your trebuchet is gone");
      }
    },
    shot(shot, id, by, from, to) {
      if (solo) return;
      trebuchets.throwStone(shot, id, from, to);
      if (by === myId) readyAt = performance.now() + TREBUCHET.reload * 1000;
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
      } else remotes.throw(id, fall, performance.now());
    },
    denied(reason) {
      // The server lost track of us on a trebuchet that is still here: get back on it quietly.
      if (reason === "gone" && crewOn && state.get(crewOn)) {
        net.board(crewOn, [player.position.x, player.feetY, player.position.z]);
        hud.toast("Back on the trebuchet: click to fire");
        return;
      }
      const text: Record<string, string> = {
        busy: "Someone else is on that trebuchet",
        far: "Get closer to the trebuchet",
        near: `Too close: aim at least ${TREBUCHET.minRange} m away`,
        range: "Out of range: build higher or get closer",
        reload: "Still reloading",
        gone: "That trebuchet is gone",
      };
      hud.toast(text[reason] ?? "Not now");
      sfx.deny();
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
      if (d <= TREBUCHET.boardReach && Math.abs(y - player.feetY) < 3 && d < bestDist) {
        best = p;
        bestDist = d;
      }
    }
    return best;
  }

  function toggleCrew(): void {
    if (crewOn) {
      net.leaveTrebuchet();
      leaveCrew();
      return;
    }
    if (solo || player.knockedDown) return;
    const t = trebuchetInReach();
    if (!t) {
      hud.toast("Stand next to a trebuchet to get on");
      return sfx.deny();
    }
    if (crews.has(t.id) && crews.get(t.id) !== myId) {
      hud.toast("Someone else is on that trebuchet");
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
    const [x, y, z] = launchPoint(t);
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
    const end = start.add(rig.forward.scale(600));
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
    trebuchets.showTarget(launchPoint(t), point, checkRange(t, point) === "ok");
  }

  function fireStone(): void {
    const t = crewOn ? state.get(crewOn) : undefined;
    if (!t) return;
    aimScope();
    if (!target) {
      hud.toast("Aim at something to fire at it");
      return sfx.deny();
    }
    const range = checkRange(t, target);
    if (range !== "ok") {
      hud.toast(range === "near" ? `Too close: aim at least ${TREBUCHET.minRange} m away` : "Out of range: build higher or get closer");
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
      if (Math.hypot(player.position.x - x, player.position.z - z) > TREBUCHET.boardReach || Math.abs(player.feetY - y) > 3) {
        net.leaveTrebuchet();
        leaveCrew();
        return;
      }
    }
    if (t) {
      hud.setHint(null);
      const reload = Math.max(0, (readyAt - now) / 1000);
      const reach = `range ${TREBUCHET.minRange}–${Math.round(maxRange(t))} m`;
      let status: { text: string; ok: boolean };
      if (!target) status = { text: `Aim at a target · ${reach}`, ok: true };
      else {
        const d = Math.round(rangeTo(t, target));
        const range = checkRange(t, target);
        if (range === "near") status = { text: `Target ${d} m: too close (min ${TREBUCHET.minRange} m)`, ok: false };
        else if (range === "far") status = { text: `Target ${d} m: out of range (max ${Math.round(maxRange(t))} m)`, ok: false };
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
    // Touch: a Get on button instead of the key hint.
    touch?.setBoard(!!near && !busy);
    if (!near) return hud.setHint(null);
    if (touch && !busy) return hud.setHint(null);
    hud.setHint(busy ? "Someone is on this trebuchet" : "<kbd>H</kbd> get on the trebuchet");
  }

  function showTowers(list: readonly [number, number, number, number, number][]): void {
    tallest = list;
    hud.setTowers(list.map((t) => t[0]));
    flags.show(list);
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
    });
  }
  net.connect();

  let statsTimer = 0;
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

    if (crewOn || player.knockedDown) {
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
    flags.update(dt);
    updateCrewHud(now);
    view.flush();

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

  selectTool(0);
  showMaterial();
  hud.showMouseSpeed(settings.mouseSpeed);
  hud.showMuted(settings.muted);
  const graphics = new Graphics(engine, world, resolution, gpuName, input.touch);
  graphics.apply(settings.graphics);
  debris.limit = graphics.effective === "saver" ? 40 : 140;
  hud.showGraphics(settings.graphics, graphics.autoMode);
  window.addEventListener("resize", () => engine.resize());
  engine.runRenderLoop(() => scene.render());
  await scene.whenReadyAsync();
  // Wait a moment for the shared world, so the first pieces placed are not lost when it arrives.
  for (let waited = 0; !joined && waited < 5000; waited += 100) await new Promise((r) => setTimeout(r, 100));
  hud.showIdentity(identity, COLORS);
  hud.ready(joined);

  if (import.meta.env.DEV) {
    // Handles for poking at the game from the browser console while developing.
    Object.assign(window, {
      snapfort: { scene, engine, resolution, trebuchets, debris, get crewOn() { return crewOn; }, get target() { return target; }, damage, get graphics() { return graphics; }, state, synced, net, remotes, history, player, rig, input, selectTool, nextId, siege, startMode, removePiece, audit: () => view.audit(state), get editing() { return editing; } },
    });
  }
}
