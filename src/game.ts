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
import { BuildState, type BuildOp, type PlaceCheck, type PlaceProblem } from "./game/buildState";
import { planFall } from "./game/fall";
import { engineInTheWay } from "./game/keepOut";
import { BUILDER_BODY, cutsIntoBody, Solids, type Box } from "./game/solids";
import { Bodies } from "./render/bodies";
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
import { olderBuild, type SeatReason } from "./net/protocol";
import { flooding, PIN_AIM_RANGE, PIN_RANGE, type ChatTo } from "./net/chat";
import { ChatView } from "./ui/chat";
import { Blocks, PlayersView } from "./ui/players";
import { PRICE, Store } from "./ui/store";
import { Tips } from "./ui/tips";
import { halfCellsOf, pieceLabel, saidName, type Environment } from "./game/environments";
import type { PageGame, WorldFeature, WorldPage } from "./worlds/pageDoors";
import { WORLDS } from "./worlds";
import { askBuilders, reachOf } from "./ui/worlds";
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
import { TrebuchetView } from "./render/trebuchetView";
import { TREBUCHET_BASE } from "./render/geometry";
import { checkRange, hitPoints, launchPoint, maxRange, openAirTarget, rangeTo, trebuchetBase, type Vec } from "./game/trebuchet";
import { Graphics } from "./render/graphics";
import { ResolutionGovernor } from "./render/resolution";
import { SoldierView } from "./render/soldierView";
import { clock, Hud, showStats, type HotbarItem } from "./ui/hud";

type Tool = PieceType | "remove";
/** The tools every world has. A world may add its own after them (WorldPage.tools). */
/** Seconds in one step of the physics world. */
const PHYSICS_STEP = 1 / 60;

/**
 * Havok, stepped in fixed steps: as many as the time since the last frame
 * holds (at most six, so a long stall does not freeze the page catching up),
 * the rest carried over. A frame that comes sooner than a step takes none.
 */
class SteadyHavok extends HavokPlugin {
  private carry = 0;
  override executeStep(delta: number, bodies: Parameters<HavokPlugin["executeStep"]>[1]): void {
    this.carry = Math.min(this.carry + delta, PHYSICS_STEP * 6);
    while (this.carry >= PHYSICS_STEP - 1e-6) {
      super.executeStep(PHYSICS_STEP, bodies);
      this.carry -= PHYSICS_STEP;
    }
  }
}

const SHARED_TOOLS: readonly Tool[] = ["wall", "floor", "ramp", "roof", "remove", "trebuchet"];
/** Quick keys beside WASD, one per piece. F1 to F4 and the number keys work too. */
const TOOL_KEYS: Record<Tool, string> = { wall: "Z", floor: "F", ramp: "X", roof: "C", remove: "V", trebuchet: "B" };
const FUNCTION_KEYS: Record<string, Tool> = { F1: "wall", F2: "floor", F3: "ramp", F4: "roof" };

/** The keys every world shares: a world's own code is never handed these. */
const WORLD_KEYS_KEPT = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "ShiftLeft", "ShiftRight", "Enter", "NumpadEnter", "Slash", "Escape"]);

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
  blocked: "Something stands in the way",
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
  // The world's pull on rubble. The world moves in fixed steps, as many as the time since the last frame holds (the rest
  // carried over to the next), so rubble falls and bounces the same on every computer, however fast it draws.
  scene.enablePhysics(new Vector3(0, -env.rubbleGravity, 0), new SteadyHavok(true, havok));
  const physics = scene.getPhysicsEngine() as PhysicsEngine;

  // Game logic: plain modules that know nothing about rendering.
  const state = new BuildState();
  state.halfCells = halfCellsOf(env);
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
  // A world with water to wade in: everyone standing in it is drawn that deep.
  if (world.wade) player.wade = remotes.wade = world.wade;
  if (world.wake) player.wake = remotes.wake = world.wake;
  const trebuchets = new TrebuchetView(scene, state, world.shadows, env, page.siegeModel(scene));
  // Rubble: a copy of the piece's mesh (a trebuchet with its frame and arm on it).
  const debris = new Debris(scene, (piece) => (piece.type === "trebuchet" ? trebuchets.debrisMesh(piece, view.debrisMesh(piece)) : view.debrisMesh(piece)), env, page.dust);
  /** What this world has of its own (vehicles, say), started below once the game's parts exist. */
  let feature: WorldFeature | null = null;
  /** What the world's page was handed (kept for the checks: PageGame.clearSpot). */
  let worldGame: PageGame | null = null;
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
  }, Math.random, env);

  /** The selected hotbar slot, or -1 when nothing is selected (just running around). */
  /** A colour the world has dressed this player in, in place of their own (see PageGame.wear). */
  let wornColor: string | null = null;
  /** Kept out of this world by its own rules (see PageGame.shut), and why. */
  let shutOut: { text: string; unlock?: boolean } | null = null;
  let toolIndex = 0;
  /** (Where a world has one material, that one, for good.) */
  let materialIndex = page.row?.material ? Math.max(0, MATERIALS.indexOf(page.row.material)) : 0;
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

  /** The hotbar: the shared tools, then the world's own. A world's tool is not a piece: its feature does the aiming and placing. */
  const ownTools = page.tools ?? [];
  // (A world may do without the siege engine: its tile is then not on the row at all.)
  // (And may build only some of the pieces: the others' tiles are not on the row either.)
  const onlyPieces = page.row?.pieces;
  const sharedTools = SHARED_TOOLS.filter((t) => !(t === "trebuchet" && page.row?.siege === false) && !(onlyPieces && t !== "remove" && t !== "trebuchet" && !onlyPieces.includes(t)));
  const TOOLS: readonly string[] = [...sharedTools, ...ownTools.map((t) => t.id)];
  const ownTool = (index: number) => ownTools[index - sharedTools.length];
  const keyOf = (tool: string) => TOOL_KEYS[tool as Tool] ?? ownTools.find((t) => t.id === tool)?.key ?? "";
  const items: HotbarItem[] = [
    ...sharedTools.map((tool) => ({ id: tool, label: tool === "remove" ? "Remove" : pieceLabel(tool, env), key: TOOL_KEYS[tool] })),
    ...ownTools.map((t) => ({ id: t.id, label: t.label, key: t.key, icon: t.icon })),
  ];
  const hud = new Hud(items, {
    selectTool: (i) => toggleTool(i),
    play(next) {
      sfx.unlock();
      // No place for them in this world now: the button says why (or offers the Full Game), and no game starts.
      if (shutOut) {
        if (shutOut.unlock) {
          // (Owning it, with the key's seat in use on another device: it is taken back here, and the world lets them in.)
          if (waiting) {
            useKeyHere();
            return hud.menuNote(`${seatsTaken()}: using it here now…`);
          }
          store.offer(false);
          return hud.show("unlock");
        }
        sfx.deny();
        return hud.menuNote(shutOut.text);
      }
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
    players() {
      playersView.show(remotes.list());
    },
    setIdentity(next) {
      identity.name = next.name;
      identity.color = next.color;
      saveIdentity(identity);
      net.setIdentity(identity);
      player.avatar.setColor(wornColor ?? identity.color);
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
    const start = feature?.spawn?.();
    if (start) player.teleport(start[0], start[1], start[2]);
    rig.yaw = 0;
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
    // A button of the world's own: pressed, not picked.
    const button = ownTool(index);
    if (button?.press) return void feature?.useTool?.(button.id);
    if (index === toolIndex && !editing) deselectTool();
    else selectTool(index);
  }

  // ── Who may build here ───────────────────────────────────────────────
  /** May build here: always in a free world; in a paid one, with the Full Game (the server decides on joining). */
  let builder = !env.paid;
  /** A visitor tried to build: the unlock panel, with the button to buy (or, owning it, how to take it back). */
  function lockedNote(): void {
    sfx.deny();
    if (waiting) return void hud.toast(`${seatsTaken()}: ${touch ? "tap Use it here" : "press U to use it here"}`, 3500);
    offerUnlock();
  }
  /**
   * Owning the Full Game but without a seat on the key: every seat was in use
   * on coming here ("full"), or this device's seat was taken by another
   * ("elsewhere"). In a paid world that means visiting; in a free one,
   * playing free. Null: seated, or no key.
   */
  let waiting: SeatReason | null = null;
  /** Said once in a free world, where nothing else shows it: the key has no seat left for this device. */
  const playingFree = () => hud.toast(`${seatsTaken()}: you are playing free here`, 4500);
  /** Why they wait, in a few words. */
  function seatsTaken(): string {
    if (waiting === "elsewhere") return "Your seat was taken by another device";
    return store.seats > 1 ? `All ${store.seats} seats on your key are in use` : "Your key is in use on another device";
  }
  /** Takes a seat: whoever has played longest with the key goes back to visiting ("Use it here"). */
  function useKeyHere(): void {
    if (store.key) net.sendKey(store.key, true);
  }
  /** The unlock panel: the Full Game for so many players, or (`add`) more seats on the key this device has. */
  function offerUnlock(add = false): void {
    store.offer(add);
    openPanel("unlock");
  }
  /** The bar while visiting: an offer to unlock, or (the key in use elsewhere) a way to take it back. */
  function paintVisitBar(): void {
    const what = document.querySelector("#visit-bar .what")!;
    const button = document.getElementById("visit-buy")!;
    // Every seat taken: the way to one more, so everyone can play together.
    const add = document.getElementById("visit-own")!;
    add.hidden = !waiting || !store.canBuy;
    add.innerHTML = `Add a seat · ${PRICE}<kbd class="desk">O</kbd>`;
    document.getElementById("visit-bar")!.classList.toggle("elsewhere", waiting !== null);
    if (waiting) {
      what.innerHTML = `<b>${seatsTaken()}</b>`;
      button.innerHTML = `Use it here<kbd class="desk">U</kbd>`;
    } else {
      what.innerHTML = `<b>Visiting ${saidName(env)}</b> · building here comes with the Full Game`;
      button.innerHTML = `Unlock · ${PRICE}<kbd class="desk">U</kbd>`;
    }
  }
  /** Visiting (no building: nothing selected, the hotbar faded) or building. */
  function setBuilder(on: boolean): void {
    const was = builder;
    builder = on;
    document.body.classList.toggle("visiting", !on);
    const play = document.getElementById("play-free") as HTMLButtonElement;
    if (!play.disabled) play.textContent = on ? "Start building" : `Visit ${saidName(env)}`;
    if (!on) {
      finishEdit(false);
      toolIndex = -1;
      placing = false;
      hud.select(-1);
      ghost.hide();
      aimSpec = null;
    } else if (!was && !page.emptyHanded) selectTool(0);
  }

  /** What the badge last showed, so it is only redrawn when that changes. */
  let shownMaterial = "";

  /**
   * The material badge: the chosen material and where it can go, or, when the
   * build target is too high for it, the material that will be used instead.
   */
  function showMaterial(): void {
    // (One material here: there is nothing to show, and the badge's place is the world's.)
    if (page.row?.material) return;
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
    if (page.row?.material) return;
    materialIndex = (materialIndex + 1) % MATERIALS.length;
    showMaterial();
    sfx.select();
  }

  /** What to tell the builder when a piece cannot go where they aim. */
  function problemText(spec: PieceSpec, problem: PlaceProblem): string {
    if (problem === "blocked" && onBody) return onBody === "you" ? "You are standing there" : `${onBody} is standing there`;
    const own = problem === "blocked" && feature?.blocks?.(spec) === true ? feature.whyBlocked?.(spec) : null;
    if (own) return own;
    if (problem === "blocked" && spec.type === "trebuchet") return `A ${engineName} needs clear space over it: nothing built in its way`;
    if (problem === "blocked" && engineInTheWay(state, spec, env)) return `A ${engineName} stands in the way`;
    if (problem !== "unsupported") return PROBLEM_TEXT[problem];
    if (spec.type === "trebuchet") return `A ${engineName} needs a floor or the ground under it`;
    // A ramp next to a ramp climbing another way: they only join in a straight line.
    if (spec.type === "ramp" && state.around(spec, 1).some((p) => p.type === "ramp" && p.rot !== normalizeSpec(spec).rot && Math.abs(p.y - spec.y) <= 1)) {
      return "Ramps turn only on a floor: put a floor down first";
    }
    return PROBLEM_TEXT[problem];
  }

  /**
   * Whether a piece can go there: the build's own rules, and nothing that
   * cannot be built into in the way (a siege engine, or something of the
   * world's own).
   */
  /** Who a piece just found in the way would have been built into (see `placeable`), for saying so. */
  let onBody: string | null = null;
  function placeable(spec: PieceSpec): PlaceCheck {
    onBody = null;
    const check = state.canPlace(spec);
    if (!check.ok) return check;
    if (engineInTheWay(state, spec, env) || feature?.blocks?.(spec) === true) return { ok: false, problem: "blocked" };
    // Nothing is built into somebody: this builder, or anyone else standing there.
    const trial = { ...spec, id: "", material: "wood" as const, edit: 0 };
    if (cutsIntoBody(trial, env, [player.position.x, player.position.y, player.position.z])) {
      onBody = "you";
      return { ok: false, problem: "blocked" };
    }
    for (const r of remotes.list()) {
      const at = remotes.positionOf(r.id);
      if (at && cutsIntoBody(trial, env, at)) {
        onBody = r.name;
        return { ok: false, problem: "blocked" };
      }
    }
    return check;
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
    const kept = piece ? feature?.keeps?.(piece) : null;
    if (kept) {
      hud.toast(kept);
      return sfx.deny();
    }
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
    const kept = feature?.keeps?.(piece);
    if (kept) {
      hud.toast(kept);
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
  /** Leaving for another world, still playing (see `travel`): the browser lets go of the mouse as this page goes, and that is not Esc. */
  let leaving = false;
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
    // On the way to another world: no panel, the game stays in view until that world's page takes over.
    if (leaving) return;
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
    } else if (hud.view === "players") hud.show("paused");
    else if (hud.view === "paused" || hud.view === "unlock") backToBuilding();
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
    // Something of the world's own may take the click first.
    if (feature?.mouse?.(button, true)) return;
    // Riding something of the world's own: hands are busy (visitors too); a click is for that.
    if (feature?.busy?.()) return button === 0 ? feature.act?.() : undefined;
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
      // Something of the world's own: its feature places it.
      const own = ownTool(toolIndex);
      if (own) return feature?.useTool?.(own.id);
      if (TOOLS[toolIndex] === "remove") {
        if (aimPieceId) removePiece(aimPieceId);
        else if (feature?.remove?.()) return;
        else if (pieceFarAway()) hud.toast("Get closer to remove it");
      } else {
        placing = true;
        placeAtAim(true);
      }
    } else if (button === 2) {
      if (aimPieceId) removePiece(aimPieceId);
      else if (feature?.remove?.()) return;
      else if (pieceFarAway()) hud.toast("Get closer to remove it");
    }
  };
  input.onMouseUp = (button) => {
    if (button !== 1 && feature?.mouse?.(button, false)) return;
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
    if (feature?.wheel?.(direction)) return;
    wheelTool(direction);
  };
  /** The tools the wheel goes round (not buttons of a world's own, which are pressed, never held). */
  const held = TOOLS.map((_, i) => i).filter((i) => !ownTool(i)?.press);
  const wheelTool = (direction: 1 | -1) => {
    const at = held.indexOf(toolIndex);
    selectTool(held[at < 0 ? (direction > 0 ? 0 : held.length - 1) : (at + direction + held.length) % held.length]!);
  };
  input.onKey = (code, event) => {
    const command = event.ctrlKey || event.metaKey;
    // Something of the world's own may take the key first (never the ones every world shares).
    if (!WORLD_KEYS_KEPT.has(code) && !crewOn && feature?.key?.(code, event)) return;
    if (command && code === "KeyZ") return event.shiftKey ? redo() : undo();
    if (command && code === "KeyY") return redo();
    if (command) return;
    // U: unlock the Full Game (while visiting a paid world).
    if (code === "KeyU" && !builder) return waiting ? useKeyHere() : offerUnlock();
    // O: one more seat on their key, when every seat is in use.
    if (code === "KeyO" && !builder && waiting && store.canBuy) return offerUnlock(true);
    // Enter talks (while editing it still confirms the cut).
    if ((code === "Enter" || code === "NumpadEnter") && !editing) return chat.open();
    // "/" too, as in Minecraft and Roblox.
    if (code === "Slash") return chat.open();
    // H gets on and off: a siege engine, or something of the world's own.
    if (code === "KeyH") return crewOn || !feature?.board?.() ? toggleCrew() : undefined;
    // On a trebuchet the hands are busy: no building until getting off.
    if (crewOn || feature?.busy?.()) return;
    const fnTool = FUNCTION_KEYS[code];
    if (fnTool) return TOOLS.includes(fnTool) ? toggleTool(TOOLS.indexOf(fnTool)) : undefined;
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
      const index = TOOLS.findIndex((tool) => `Key${keyOf(tool)}` === code);
      if (index >= 0) toggleTool(index);
    }
  };

  // Other builders are drawn moving only where a body could: a straight line between two places they were that would
  // cut a wall's corner stops against it (see RemotePlayers.blocked).
  const drawnSolids = new Solids(state, env, () => feature?.solids?.() ?? []);
  trebuchets.solids = () => feature?.solids?.() ?? [];
  remotes.blocked = (from, to) => {
    if (Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) < 0.01) return null;
    // (A little slimmer than the body, and stepping up what a builder steps up: a graze is not a stop.)
    const hit = drawnSolids.sweep(from, to, BUILDER_BODY.r - 0.08, BUILDER_BODY.half, { stepUp: 0.45 });
    // (Already inside something where it started: no stopping it there, or it could never get out.)
    if (!hit || hit.k === 0) return null;
    return hit.at;
  };

  // What moves of the world's own (vehicles, units) is solid to the builder near it: a few bodies, moved onto the nearest each step.
  const bodies = new Bodies(scene);
  scene.onBeforePhysicsObservable.add(() => {
    const things = feature?.bodies?.();
    if (things) bodies.update(player.position, things);
  });

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
    // Pressed against another builder: both are shoved apart (each page moves its own builder), so walking into
    // someone pushes them along, and nobody stands inside anybody.
    if (!player.knockedDown && !crewOn) shoveApart();
    // Riding something of the world's own moves the player in its own way; otherwise they walk.
    if (crewOn || player.knockedDown || !feature?.drive?.(dt, moving)) player.step(dt, moving);
  });

  /** How far apart two builders' middles keep, m: their bodies side by side. */
  const BUILDERS_APART = 0.85;
  /** Moves this builder out of anyone they are pressed into, by half the overlap (the other's page does the other half). */
  function shoveApart(): void {
    const me = player.position;
    let px = 0, pz = 0;
    for (const r of remotes.list()) {
      if (remotes.isRiding(r.id) || remotes.isConcealed(r.id)) continue;
      const at = remotes.positionOf(r.id);
      if (!at || Math.abs(at[1] - me.y) > 1.7) continue;
      let dx = me.x - at[0], dz = me.z - at[2];
      const d = Math.hypot(dx, dz);
      if (d >= BUILDERS_APART) continue;
      if (d < 0.01) {
        // Exactly in one another: apart by who is who.
        const a = (myId < r.id ? 0 : Math.PI) + 0.7;
        dx = Math.sin(a);
        dz = Math.cos(a);
      } else {
        dx /= d;
        dz /= d;
      }
      // (Harder the deeper: a shove, not a nudge.)
      const k = ((BUILDERS_APART - d) / BUILDERS_APART) * 22;
      px += dx * k;
      pz += dz * k;
    }
    if (px !== 0 || pz !== 0) player.push(px, pz);
  }

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
    // Something of the world's own: its feature shows where it would go.
    const own = ownTool(toolIndex);
    if (own) {
      ghost.hide();
      return feature?.aimTool?.(own.id);
    }
    const tool = TOOLS[toolIndex] as Tool;

    if (tool === "remove") {
      const piece = aimPieceId ? state.get(aimPieceId) : undefined;
      if (piece) ghost.show(piece, "remove", piece.edit);
      else {
        ghost.hide();
        // Not on a piece: something of the world's own, perhaps.
        feature?.aimRemove?.();
      }
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
      (spec) => (placeable(spec).ok ? state.touching(spec).length : null),
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
      if (next && placeable(next).ok) aimSpec = next;
    }
    const check = placeable(aimSpec);
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
  // Blocking and reporting (the Players panel, from the settings while playing): a blocked
  // builder's chat is not shown on this device, from now on and on every visit.
  const blocks = new Blocks();
  const playersView = new PlayersView(blocks);
  const isBlocked = (by: string, uid: string | undefined) => by !== myId && blocks.has(by, uid);
  playersView.onReport = (id, why) => net.report(id, why);
  playersView.onBlocksChange = () => chat.hide(isBlocked);
  /** Keeps the Players panel up to date while it is open. */
  const refreshPlayers = () => {
    if (hud.view === "players") playersView.show(remotes.list());
  };
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
    if (crewOn) return piecesOnly || targetOpen ? null : target;
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
      if (extras.seats) store.learnSeats(extras.seats);
      const waited = waiting;
      waiting = extras.full ? "full" : null;
      setBuilder(extras.builder);
      paintVisitBar();
      // (Joining again, after a dropped connection, does not say it twice.)
      if (waiting && extras.builder && !waited) playingFree();
      chat.clear();
      for (const said of extras.chat) if (!isBlocked(said.by, said.uid)) chat.show(said, myId, now);
      playersView.reset();
      refreshPlayers();
      feature?.joined?.();
      // The world cards' counts now include this builder (asked a moment later: the world tells
      // the count's keeper as it welcomes us, and that word may still be on its way).
      setTimeout(askBuilders, 1500);
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
      refreshPlayers();
    },
    leave(id) {
      remotes.leave(id);
      showOnline();
      refreshPlayers();
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
    worn(point, ops, fallen, hits) {
      if (solo) return;
      const falling = new Set(fallen);
      const pieces = ops.flatMap((op) => (op.kind === "remove" && state.get(op.id) ? [{ ...state.get(op.id)! }] : []));
      const broken = new Set(pieces.filter((p) => !falling.has(p.id)).map((p) => p.id));
      synced.remote(ops);
      for (const [id, n] of hits) {
        damage.set(id, n);
        tint(id);
      }
      if (pieces.length === 0) return;
      debris.spawn(pieces, broken, point);
      debris.puff(new Vector3(...point), 1.6, 0.8);
      if (nearness(point) > 0) sfx.crumble();
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
        locked: `Building on ${saidName(env)} comes with the Full Game`,
      };
      hud.toast(text[reason] ?? "Not now");
      sfx.deny();
    },
    said(said) {
      if (isBlocked(said.by, said.uid)) return;
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
    access(on, reason, seats) {
      const before = waiting;
      if (seats) store.learnSeats(seats);
      // (Asking again while waiting and still finding no seat changes nothing: they still know why.)
      // In a free world building stays open with no seat: the reason alone says there is none.
      waiting = !reason ? null : before && reason === "full" ? before : reason;
      setBuilder(on);
      paintVisitBar();
      // (A message the store just showed, like "you have a new key", is not covered up.)
      const storeSpoke = performance.now() - noticeAt < 4000;
      if (waiting && waiting !== before) on ? playingFree() : hud.toast(seatsTaken(), 4000);
      else if (on && env.paid && !storeSpoke) hud.toast(before ? `Building here again: you have a seat` : `Unlocked: build anywhere on ${saidName(env)}!`, 3000);
    },
    reported(who, ok) {
      playersView.reported(who, ok);
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
  /** The crosshair is on nothing: the target is a point in open air, the way the builder looks. */
  let targetOpen = false;
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
   * follow (green in range, red not). With nothing under it (open sky, or
   * something flying, which is not solid here), the target is a point in the
   * air along the line of sight: the shot goes that way and carries on.
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
    targetOpen = !point;
    point ??= openAirTarget(t, [rig.pivot.x, rig.pivot.y, rig.pivot.z], [rig.forward.x, rig.forward.y, rig.forward.z], env);
    target = point;
    trebuchets.aimAt(t.id, point);
    trebuchets.showTarget(launchPoint(t, env), point, checkRange(t, point, env) === "ok");
  }

  function fireStone(): void {
    const t = crewOn ? state.get(crewOn) : undefined;
    if (!t) return;
    aimScope();
    if (!target) return;
    const range = checkRange(t, target, env);
    if (range !== "ok") {
      hud.toast(targetOpen ? "Too steep: aim lower to fire" : range === "near" ? `Too close: aim at least ${env.siege.minRange} m away` : "Out of range: build higher or get closer");
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
      const reach = env.siege.minRange > 0 ? `range ${env.siege.minRange}–${Math.round(maxRange(t, env))} m` : `range up to ${Math.round(maxRange(t, env))} m`;
      let status: { text: string; ok: boolean };
      if (!target) status = { text: `Aim at a target · ${reach}`, ok: true };
      else {
        const d = Math.round(rangeTo(t, target));
        const range = checkRange(t, target, env);
        const ready = `ready: ${touch ? "tap Fire" : "click to fire"}`;
        if (targetOpen) status = range !== "ok" ? { text: "Open air: aim lower to fire", ok: false } : reload > 0 ? { text: `Open air · reloading ${reload.toFixed(1)} s`, ok: false } : { text: `Open air · ${ready}`, ok: true };
        else if (range === "near") status = { text: `Target ${d} m: too close (min ${env.siege.minRange} m)`, ok: false };
        else if (range === "far") status = { text: `Target ${d} m: out of range (max ${Math.round(maxRange(t, env))} m)`, ok: false };
        else if (reload > 0) status = { text: `Target ${d} m · reloading ${reload.toFixed(1)} s`, ok: false };
        else status = { text: `Target ${d} m · ${ready}`, ok: true };
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
  // Removed from this device: the world frees its seat at once (in a paid world, back to visiting).
  store.onRemoved = () => net.dropKey();
  // "Have a key?" on the menu or the unlock panel: the settings, with the key box open.
  store.onHaveKey = () => {
    openPanel(mode === "menu" ? "settings" : "paused");
    store.showEnter(true);
  };
  document.getElementById("visit-buy")!.addEventListener("click", () => (waiting ? useKeyHere() : offerUnlock()));
  document.getElementById("visit-own")!.addEventListener("click", () => offerUnlock(true));
  // "Add seats" in the settings, and "Playing together?" on the menu: the unlock panel, with its count of players.
  store.onAddSeats = () => offerUnlock(true);
  document.getElementById("offer-more")!.addEventListener("click", () => offerUnlock());
  // Waiting for a seat: ask again now and then, so building opens by itself when someone stops.
  setInterval(() => {
    if (waiting && store.key && !document.hidden) net.sendKey(store.key);
  }, 15_000);
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
    if (!((dx !== 0 || dy !== 0) && feature?.look?.(dx, dy))) rig.look(dx, dy);
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
      net.sendMove(player.position.x, player.position.y, player.position.z, rig.yaw, player.onGround, now, player.tumbling, player.gliding || player.aloft);
    }
    remotes.update(dt, now, rig.camera.globalPosition, rig.camera.fov);
    showMaterial();
    if (touch) touch.mode = crewOn ? "crew" : editing ? "edit" : "build";
    trebuchets.update(dt);
    debris.update(dt);
    chat.update(now, here());
    tips.update(
      { moved: Math.hypot(player.position.x - tipStart.x, player.position.z - tipStart.z), placed: placedTotal, kinds: placedKinds, chatted },
      input.locked && builder && !crewOn && !siege.captured && !page.ownTips,
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

  // Come from another world, still playing (something of that world's own brought them): read once.
  const arrived = takeTravel(env.id);
  feature =
    page.start?.(worldGame = {
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
      viewPitch: () => rig.pitch,
      myId: () => myId,
      send: (data) => {
        if (!solo && net.online) net.sendWorld(data);
      },
      toast: (text, ms) => hud.toast(text, ms),
      aim: (range) => aimPoint(range),
      mayBuild: () => builder,
      panel: (html) => {
        const el = document.getElementById("world-panel")!;
        if (html === null) el.hidden = true;
        else {
          if (el.innerHTML !== html) el.innerHTML = html;
          el.hidden = false;
        }
      },
      sound: sfx.kit,
      touch: input.touch,
      worlds: () => WORLDS.filter((w) => w !== env && !w.apart).map((w) => ({ id: w.id, name: w.name, said: saidName(w) })),
      travel: (worldId, note) => {
        const to = WORLDS.find((w) => w.id === worldId);
        if (!to || to === env) return;
        const trip: Travel = { env: to.id, at: Date.now(), yaw: rig.yaw, pitch: rig.pitch, note };
        sessionStorage.setItem(TRAVEL_KEY, JSON.stringify(trip));
        leaving = true;
        // (A dev server's test world is kept, as on every link between worlds.)
        const test = new URLSearchParams(location.search).get("world");
        location.assign(test ? `${to.path}?world=${encodeURIComponent(test)}` : to.path);
      },
      arrival: () => arrived?.note ?? null,
      chase: (distance) => {
        rig.chase = distance;
      },
      look: (pitch) => {
        rig.pitch = Math.max(-1.4, Math.min(1.4, pitch));
      },
      face: (yaw) => {
        rig.yaw = yaw;
      },
      held: (code) => input.isDown(code),
      playing: () => input.locked && !input.typing && !outdated,
      sight: () => ({ from: [rig.pivot.x, rig.pivot.y, rig.pivot.z], dir: [rig.forward.x, rig.forward.y, rig.forward.z] }),
      conceal: (id, hidden) => remotes.conceal(id, hidden),
      others: () => remotes.list().map((p) => ({ id: p.id, name: p.name, color: p.color, position: remotes.positionOf(p.id) })),
      me: () => ({ name: identity.name, color: identity.color }),
      play: (sound) => {
        if (sound === "boom") sfx.boom(1);
        else sfx[sound]();
      },
      wear: (id, color) => {
        if (id !== myId) return remotes.wear(id, color);
        if (wornColor === color) return;
        wornColor = color;
        player.avatar.setColor(color ?? identity.color);
      },
      clearSpot: (x, y, z) => {
        // (Clear of the world's own moving things too: each a box of its own.)
        const moving = [...(feature?.bodies?.() ?? [])].map((b): Box => {
          const r = Math.hypot(b.w, b.d) / 2;
          return [b.x - r, b.y, b.z - r, b.x + r, b.y + b.h, b.z + r];
        });
        const solids = new Solids(state, env, () => [...(feature?.solids?.() ?? []), ...moving]);
        // Clear already (open ground, or open air for someone getting out in flight): there it is.
        if (!solids.touch([x, y, z], BUILDER_BODY.r, BUILDER_BODY.half)) return [x, y, z];
        const at = solids.nearestClear(x, z, y - BUILDER_BODY.half - BUILDER_BODY.r, BUILDER_BODY.r, BUILDER_BODY.half);
        return at ? [at[0], at[1], at[2]] : null;
      },
      row: (tiles, pick) => hud.setRow(tiles, pick),
      badge: (html) => hud.setBadge(html),
      shut: (why) => {
        const was = shutOut;
        shutOut = why;
        if (!why) {
          if (was) hud.menuNote(null);
          return;
        }
        // Playing: back to the menu, where the note says why.
        if (input.locked) {
          mode = "menu";
          nextView = null;
          input.unlock();
        } else if (mode !== "menu" && hud.view !== "unlock") {
          mode = "menu";
          hud.show("menu");
        }
        hud.menuNote(why.text);
      },
      hands: () => (toolIndex < 0 ? null : TOOLS[toolIndex]!),
      hold: (tool) => {
        const i = TOOLS.indexOf(tool);
        if (!builder) return lockedNote();
        if (i >= 0 && i !== toolIndex) selectTool(i);
      },
    }) ?? null;

  // One material here: no badge and no button for changing it (the badge's place is the world's own).
  if (page.row?.material) {
    hud.setBadge(null);
    document.body.classList.add("one-material");
  }
  if (builder && page.emptyHanded) {
    toolIndex = -1;
    hud.select(-1);
  } else if (builder) selectTool(0);
  else setBuilder(false);
  // The world's own controls, after the shared ones in the Controls panel.
  if (page.controls) {
    const row = (parent: Element | null, html: string, cls: string) => {
      if (!parent) return;
      const el = document.createElement("div");
      el.className = cls;
      el.innerHTML = html;
      parent.appendChild(el);
    };
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    for (const [key, what] of page.controls.keys) row(document.querySelector("#view-controls .keys"), `<kbd>${esc(key)}</kbd><span>${esc(what)}</span>`, "keyrow");
    for (const line of page.controls.touch ?? []) row(document.getElementById("touch-help"), esc(line), "");
    if (page.controls.note) row(document.querySelector("#view-controls .keys")?.parentElement ?? null, esc(page.controls.note), "small world-note");
  }
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
  } else if (arrived) {
    // Brought here from another world: playing straight away, looking the way they were.
    startMode("free");
    rig.yaw = arrived.yaw;
    rig.pitch = arrived.pitch;
    if (touch) void input.lock();
    else {
      away = true;
      hud.show("away");
    }
  }
  // Started: the menu is no longer held back (it shows now if the trip or the restart turned out not to count).
  document.documentElement.classList.remove("arriving");
  if (!builder) (document.getElementById("play-free") as HTMLButtonElement).textContent = `Visit ${saidName(env)}`;

  if (import.meta.env.DEV) {
    // Handles for poking at the game from the browser console while developing.
    Object.assign(window, {
      snapfort: { scene, engine, chat, store, env, get feature() { return feature; }, get builder() { return builder; }, get waiting() { return waiting; }, get myId() { return myId; }, resolution, trebuchets, debris, get crewOn() { return crewOn; }, get target() { return target; }, damage, get graphics() { return graphics; }, state, synced, net, remotes, bodies, Solids, clearSpot: (x: number, y: number, z: number) => worldGame?.clearSpot(x, y, z) ?? null, planFall: (from: Vec, v: Vec) => planFall(state, from, v, env, () => feature?.solids?.() ?? []), history, player, rig, input, selectTool, placeable, nextId, siege, startMode, removePiece, audit: () => [...view.audit(state), ...trebuchets.audit()], get editing() { return editing; } },
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

/** Travelling from one world to another while playing (sessionStorage, read once by the world it names). */
interface Travel {
  env: string;
  at: number;
  yaw: number;
  pitch: number;
  /** Whatever the world they left wants the one they reach to know. */
  note: unknown;
}
const TRAVEL_KEY = "snapfort.travel";

function takeTravel(env: string): Travel | null {
  const raw = sessionStorage.getItem(TRAVEL_KEY);
  sessionStorage.removeItem(TRAVEL_KEY);
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as Travel;
    return t.env === env && Date.now() - t.at < 2 * 60_000 && [t.yaw, t.pitch].every(Number.isFinite) ? t : null;
  } catch {
    return null;
  }
}

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
