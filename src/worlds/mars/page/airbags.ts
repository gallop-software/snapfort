import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { fallPosition } from "../../../game/fall";
import type { PageGame, WorldFeature } from "../../pageDoors";
import type { AirbagMessage } from "../airbags";

/** How big the cluster of bags is, m across, and how far above the body's centre its middle sits (so it rests on the ground, not in it). */
const SIZE = 3.1, LIFT = 0.55;

interface Bags {
  mesh: Mesh;
  msg: AirbagMessage;
  /** Seconds since the throw. */
  t: number;
  /** Bounces already sounded. */
  heard: number;
}

/**
 * The page's side of Mars's airbags (see ../airbags.ts): a cluster of tan
 * bags round every builder who has been hit, following the way down the server
 * planned, tumbling as it goes, thumping at each bounce, and letting go at the end.
 */
export function startAirbags(game: PageGame): WorldFeature {
  const { scene } = game;
  const cloth = new StandardMaterial("airbag", scene);
  cloth.diffuseColor = new Color3(0.86, 0.78, 0.62);
  cloth.specularColor = new Color3(0.12, 0.1, 0.08);
  // One cluster to copy: a ball in the middle and lobes all round it, as the landers' bags were.
  const lobes: Mesh[] = [CreateSphere("airbag-core", { diameter: 0.74, segments: 10 }, scene)];
  const turn = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < 14; i++) {
    const y = 1 - (i / 13) * 2, r = Math.sqrt(1 - y * y), a = turn * i;
    const lobe = CreateSphere("airbag-lobe", { diameter: 0.5, segments: 8 }, scene);
    lobe.position.set(Math.cos(a) * r * 0.3, y * 0.3, Math.sin(a) * r * 0.3);
    lobes.push(lobe);
  }
  const master = Mesh.MergeMeshes(lobes, true)!;
  master.name = "airbags";
  master.material = cloth;
  master.isPickable = false;
  master.setEnabled(false);

  const flying = new Map<string, Bags>();
  const end = (id: string) => {
    flying.get(id)?.mesh.dispose();
    flying.delete(id);
  };

  return {
    message(data) {
      const msg = data as AirbagMessage;
      if (msg?.k !== "airbag" || !Array.isArray(msg.fall?.path) || msg.fall.path.length < 2) return;
      end(msg.id);
      const mesh = master.clone(`airbags-${msg.id}`);
      mesh.setEnabled(true);
      game.shadows.addShadowCaster(mesh);
      flying.set(msg.id, { mesh, msg, t: 0, heard: 0 });
      // The bags bursting out.
      if (msg.id === game.myId()) {
        game.sound.noise(0.18, 0.3, 900);
        game.sound.tone("sine", 220, 90, 0.2, 0.3);
      }
    },
    joined() {
      for (const id of [...flying.keys()]) end(id);
    },
    update(dt) {
      for (const [id, bags] of flying) {
        const before = bags.t;
        bags.t += dt;
        const { msg, mesh } = bags;
        if (bags.t >= msg.fall.time) {
          end(id);
          continue;
        }
        const fall = { from: msg.fall.path[0]!, v: [0, 0, 0] as [number, number, number], ...msg.fall };
        const at = fallPosition(fall, bags.t), was = fallPosition(fall, before);
        mesh.position.set(at[0], at[1] + LIFT, at[2]);
        // It rolls the way it travels.
        const dx = at[0] - was[0], dz = at[2] - was[2];
        mesh.rotation.z -= dx / (SIZE / 2);
        mesh.rotation.x += dz / (SIZE / 2);
        // Out in a moment, and away again as they let go.
        const out = Math.min(1, bags.t / 0.18), away = bags.t > msg.until ? Math.max(0, 1 - (bags.t - msg.until) / (msg.fall.time - msg.until)) : 1;
        mesh.scaling.setAll(SIZE * out * away);
        // Each bounce: a dull thump (the thin air carries little), softer each time, and fainter from far off.
        while (bags.heard < msg.bounces.length && msg.bounces[bags.heard]! <= bags.t) {
          const me = game.player.position;
          const near = Math.max(0, 1 - Math.hypot(at[0] - me.x, at[2] - me.z) / 140);
          const v = near * Math.max(0.25, 1 - bags.heard * 0.14);
          if (v > 0.02) {
            game.sound.tone("sine", 120, 46, 0.22, 0.5 * v);
            game.sound.noise(0.1, 0.16 * v, 420);
          }
          bags.heard++;
        }
      }
    },
  };
}
