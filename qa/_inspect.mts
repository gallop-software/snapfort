import { BuildState } from "../src/game/buildState";
import { gridBox, type Piece } from "../src/game/pieces";
import { decodePieces } from "../src/net/protocol";
const ws = new WebSocket("wss://snapfort.io/ws"); const inbox: any[] = [];
ws.onmessage = (e) => inbox.push(JSON.parse(String(e.data)));
await new Promise((r) => (ws.onopen = r));
ws.send(JSON.stringify({ t: "hello", v: 2, name: "Inspector", color: "#4a8fe0" }));
await new Promise((r) => setTimeout(r, 1500)); ws.close();
const w = inbox.find((m) => m.t === "welcome");
const state = new BuildState();
for (const p of decodePieces(w.pieces)) state.apply({ kind: "place", piece: p });
// Components by touching (as measureTowers does), grounded or not.
const comp = new Map<string, number>(); let n = 0; const groups: Piece[][] = [];
for (const s of state.all()) { if (comp.has(s.id) || s.type === "trebuchet") continue; const g: Piece[] = []; const q = [s]; comp.set(s.id, n);
  for (let p = q.pop(); p; p = q.pop()) { g.push(p); for (const o of state.touching(p)) if (o.type !== "trebuchet" && !comp.has(o.id)) { comp.set(o.id, n); q.push(o); } }
  groups.push(g); n++; }
for (const g of groups.sort((a, b) => b.length - a.length).slice(0, 6)) {
  const xs = g.map((p) => p.x), zs = g.map((p) => p.z), ys = g.map((p) => gridBox(p)[4]);
  console.log(`${g.length} pieces · x ${Math.min(...xs)}..${Math.max(...xs)} z ${Math.min(...zs)}..${Math.max(...zs)} · top storey ${Math.max(...ys)} · grounded ${g.some((p) => gridBox(p)[1] === 0)} · types ${[...new Set(g.map((p) => p.type))].join("/")}`);
}
// For the small groups, what is their nearest piece of the big group, and why do they not touch?
const big = groups[0]!;
for (const g of groups.slice(1, 4)) {
  let best: [Piece, Piece, number] | null = null;
  for (const a of g) for (const b of big) { const A = gridBox(a), B = gridBox(b); const gap = Math.max(A[0] - B[3], B[0] - A[3], 0) + Math.max(A[1] - B[4], B[1] - A[4], 0) + Math.max(A[2] - B[5], B[2] - A[5], 0); if (!best || gap < best[2]) best = [a, b, gap]; }
  const [a, b, gap] = best!;
  console.log(`group of ${g.length}: nearest ${a.type}(${a.x},${a.y},${a.z},r${a.rot}) box ${gridBox(a)} ↔ ${b.type}(${b.x},${b.y},${b.z},r${b.rot}) box ${gridBox(b)} gap ${gap}`);
}
