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
import { BuildState, type PlaceProblem } from "./game/buildState";
import { CELL, LEVEL } from "./game/constants";
import { editTileAt } from "./game/edit";
import { History } from "./game/history";
import { createIdSource } from "./game/ids";
import {
  editGrid,
  isValidEdit,
  MATERIAL_DEFS,
  MATERIALS,
  PIECE_DEFS,
  PIECE_TYPES,
  slotKey,
  type PieceSpec,
  type PieceType,
} from "./game/pieces";
import { Siege } from "./game/siege";
import { findUnsupported } from "./game/structure";
import { aimTarget } from "./game/aim";
import { facingRot } from "./game/targeting";
import { Input } from "./input";
import { loadSettings, saveSettings } from "./settings";
import { CameraRig } from "./render/cameraRig";
import { EditOverlay } from "./render/editOverlay";
import type { GraphicsApi } from "./render/engine";
import { Ghost, PieceView, PlaceFlash } from "./render/pieceView";
import { Player } from "./render/player";
import { SoldierView } from "./render/soldierView";
import { createWorld } from "./render/world";
import { clock, Hud, type HotbarItem } from "./ui/hud";

type Tool = PieceType | "remove";
const TOOLS: readonly Tool[] = [...PIECE_TYPES, "remove"];
/** Quick keys beside WASD, one per piece. F1 to F4 and the number keys work too. */
const TOOL_KEYS: Record<Tool, string> = { wall: "Z", floor: "F", ramp: "X", roof: "C", remove: "V" };
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
  const history = new History(state);
  const nextId = createIdSource();

  const rig = new CameraRig(scene);
  const world = createWorld(scene, rig.camera);
  const view = new PieceView(scene, state, world.shadows);
  const ghost = new Ghost(scene);
  const flash = new PlaceFlash(scene);
  const overlay = new EditOverlay(scene);
  const player = new Player(scene, world.shadows);
  const input = new Input(canvas);
  const sfx = new Sfx();
  const army = new SoldierView(scene, world.shadows);

  const settings = loadSettings();
  rig.sensitivity = settings.mouseSpeed;

  let mode: Mode = "menu";
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
      void input.lock();
    },
    resume() {
      sfx.unlock();
      void input.lock();
    },
    startOver() {
      if (state.size > 0 && !window.confirm(`Clear all ${state.size} pieces and start over?`)) return;
      sfx.unlock();
      startMode(mode === "menu" ? "free" : mode);
      void input.lock();
    },
    setMouseSpeed(speed) {
      settings.mouseSpeed = speed;
      rig.sensitivity = speed;
      saveSettings(settings);
    },
    menu() {
      mode = "menu";
      siege.reset(false);
      hud.setSiege(null);
      hud.show("menu");
    },
  });

  /** Clears the world and begins a fresh game in the given mode. */
  function startMode(next: Mode): void {
    finishEdit(false);
    for (const piece of [...state.all()]) state.apply({ kind: "remove", id: piece.id });
    history.clear();
    placedCount = 0;
    mode = next;
    siege.reset(next === "siege");
    player.respawn();
    rig.yaw = 0;
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

  function showMaterial(): void {
    const id = MATERIALS[materialIndex]!;
    hud.setMaterial(MATERIAL_DEFS[id].label, MATERIAL_DEFS[id].color, "T");
  }

  function cycleMaterial(): void {
    materialIndex = (materialIndex + 1) % MATERIALS.length;
    showMaterial();
    sfx.select();
  }

  function placeAtAim(announce: boolean): void {
    if (!aimSpec) return;
    lastTriedSlot = slotKey(aimSpec);
    if (aimProblem) {
      if (announce) {
        hud.toast(PROBLEM_TEXT[aimProblem]);
        sfx.deny();
      }
      return;
    }
    const piece = { ...aimSpec, id: nextId(), material: MATERIALS[materialIndex]!, edit: 0 };
    if (history.do({ kind: "place", piece })) {
      placedCount++;
      flash.play(aimSpec);
      sfx.place();
    }
  }

  /** Removes a piece and, in the same undo step, everything that no longer connects to the ground. */
  function removePiece(id: string): void {
    if (!history.do({ kind: "remove", id })) return;
    const loose = findUnsupported(state);
    for (const piece of loose) history.extend({ kind: "remove", id: piece.id });
    if (loose.length > 0) sfx.crumble();
    else sfx.remove();
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
      hud.toast("Aim at a wall or floor to edit it");
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
    if (locked) {
      away = false;
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
  // Esc while stepped away opens the pause menu.
  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape" && away && !input.locked) {
      away = false;
      hud.show("paused");
    }
  });
  input.onMouseDown = (button) => {
    sfx.unlock();
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
      } else {
        placing = true;
        placeAtAim(true);
      }
    } else if (button === 2 && aimPieceId) removePiece(aimPieceId);
  };
  input.onMouseUp = (button) => {
    if (button === 0) {
      placing = false;
      if (editing) editing.paint = null;
    }
  };
  // The wheel moves along the hotbar; from nothing selected it starts at either end.
  input.onWheel = (direction) => selectTool(toolIndex < 0 ? (direction > 0 ? 0 : TOOLS.length - 1) : toolIndex + direction);
  input.onKey = (code, event) => {
    const command = event.ctrlKey || event.metaKey;
    if (command && code === "KeyZ") return event.shiftKey ? redo() : undo();
    if (command && code === "KeyY") return redo();
    if (command) return;
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
    const on = input.locked;
    // Arrow keys and WASD both move the builder.
    const key = (a: string, b: string) => (input.isDown(a) || input.isDown(b) ? 1 : 0);
    player.step(dt, {
      strafe: on ? key("ArrowRight", "KeyD") - key("ArrowLeft", "KeyA") : 0,
      forward: on ? key("ArrowUp", "KeyW") - key("ArrowDown", "KeyS") : 0,
      run: on && (input.isDown("ShiftLeft") || input.isDown("ShiftRight")),
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

  function updateAim(): void {
    rig.pivot.addToRef(rig.forward.scale(REMOVE_REACH), rayEnd);
    physics.raycastToRef(rig.pivot, rayEnd, ray);
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

  let statsTimer = 0;
  let lastCount = -1;

  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(0.05, engine.getDeltaTime() / 1000);
    const [dx, dy] = input.takeLook();
    rig.look(dx, dy);
    rig.update(player.position, dt);
    player.animate(dt, rig.yaw);
    world.update(dt);
    flash.update(dt);

    if (input.locked && editing) {
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
        document.exitPointerLock();
      }
    }
    army.update(siege.soldiers, input.locked ? dt : 0);
    view.flush();

    if (state.size !== lastCount) hud.setCount((lastCount = state.size));
    statsTimer -= dt;
    if (statsTimer <= 0 && import.meta.env.DEV) {
      statsTimer = 0.25;
      hud.setStats(`${engine.getFps().toFixed(0)} fps · ${api}`);
    }
    if (mode === "siege") {
      if (siege.wave === 0) hud.setSiege(`The army arrives in ${clock(Math.ceil(siege.nextWave))}`, siege.nextWave < 10);
      else hud.setSiege(`Wave ${siege.wave} · ${siege.soldiers.length} soldiers · next in ${clock(Math.ceil(siege.nextWave))} · held ${clock(siege.elapsed)}`);
    }
  });

  selectTool(0);
  showMaterial();
  hud.showMouseSpeed(settings.mouseSpeed);
  window.addEventListener("resize", () => engine.resize());
  engine.runRenderLoop(() => scene.render());
  await scene.whenReadyAsync();
  hud.ready();

  if (import.meta.env.DEV) {
    // Handles for poking at the game from the browser console while developing.
    Object.assign(window, {
      snapfort: { scene, engine, state, history, player, rig, input, selectTool, nextId, siege, startMode, removePiece, audit: () => view.audit(state), get editing() { return editing; } },
    });
  }
}
