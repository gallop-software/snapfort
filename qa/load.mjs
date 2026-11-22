/**
 * Load test for the shared world: BOTS builders (default 100) connect over
 * WebSockets, walk around ten times a second and keep building, while one real
 * browser page joins the same world and reports its frame rate.
 * Start the Gallop dev server first, then: npm run qa:load  (or: npm run qa:load -- 100 120)
 * Arguments: number of bots, seconds to run, base URL.
 */
import { chromium } from "playwright-core";

const BOTS = Number(process.argv[2] ?? 100);
const SECONDS = Number(process.argv[3] ?? 60);
const base = new URL(process.argv[4] ?? "http://localhost:5173/");
const world = `load-${Date.now().toString(36)}`;
base.searchParams.set("world", world);
const wsUrl = `${base.protocol === "https:" ? "wss" : "ws"}://${base.host}/ws?world=${world}`;

const latencies = [];
let received = 0, closed = 0, rejected = 0, placed = 0;

function bot(n) {
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    const sentAt = new Map();
    let me = "", seq = 0, k = 0;
    const mine = [];
    // Each bot walks its own circle around its own patch of ground and builds there.
    const cx = ((n % 10) - 5) * 40, cz = (Math.floor(n / 10) - 5) * 40, radius = 6 + (n % 5);
    let t = Math.random() * 6;
    const timers = [];
    ws.onopen = () => ws.send(JSON.stringify({ t: "hello", v: 2, name: `Bot ${n}`, color: "#4a8fe0" }));
    ws.onclose = () => { closed++; timers.forEach(clearInterval); };
    ws.onmessage = (e) => {
      received++;
      const msg = JSON.parse(e.data);
      if (msg.t === "welcome") {
        me = msg.you;
        timers.push(setInterval(() => {
          t += 0.1;
          const x = cx + Math.cos(t) * radius, z = cz + Math.sin(t) * radius;
          ws.send(JSON.stringify({ t: "move", m: [Math.round(x * 100), 95, Math.round(z * 100), Math.round(((t + Math.PI / 2) % 6.283) * 1000), 1] }));
        }, 100));
        timers.push(setInterval(() => {
          // A floor on the ground nearby, or take an old one away.
          const ops = [];
          if (mine.length > 30 || (mine.length > 0 && Math.random() < 0.3)) ops.push(["r", mine.shift()]);
          else {
            const id = `${me}-${(k++).toString(36)}`;
            const gx = Math.floor(cx / 5) + Math.floor(Math.random() * 6) - 3, gz = Math.floor(cz / 5) + Math.floor(Math.random() * 6) - 3;
            ops.push(["p", [id, 1, gx, 0, gz, 0, n % 3, 0]]);
            mine.push(id);
          }
          seq++;
          sentAt.set(seq, performance.now());
          ws.send(JSON.stringify({ t: "act", seq, ops }));
        }, 700 + Math.random() * 600));
        resolve(ws);
      } else if (msg.t === "ack") {
        const at = sentAt.get(msg.seq);
        if (at !== undefined) latencies.push(performance.now() - at);
        sentAt.delete(msg.seq);
        if (msg.rejected.length) rejected += msg.rejected.length;
        else placed++;
      }
    };
  });
}

console.log(`Connecting ${BOTS} bots to world ${world}…`);
const sockets = [];
for (let i = 0; i < BOTS; i++) {
  sockets.push(await bot(i));
  if (i % 20 === 19) await new Promise((r) => setTimeout(r, 100));
}
console.log(`${BOTS} bots connected. Opening a real browser page…`);

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(base.toString());
await page.waitForSelector("body.ready", { timeout: 30000 });
await page.click("#play-free");
// Stand in the middle of the crowd, looking over it.
await page.evaluate(() => { const s = window.snapfort; s.player.teleport(0, 0.95, -60); s.rig.yaw = 0; s.rig.pitch = 0.25; });

const start = Date.now();
const fps = [];
let lastReceived = received;
while (Date.now() - start < SECONDS * 1000) {
  await new Promise((r) => setTimeout(r, 5000));
  const now = await page.evaluate(() => ({ fps: window.snapfort.engine.getFps(), online: document.getElementById("online").textContent, remotes: window.snapfort.remotes.count, pieces: window.snapfort.state.size }));
  fps.push(now.fps);
  const sorted = [...latencies].sort((a, b) => a - b);
  const pct = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))].toFixed(0) : "-");
  console.log(`${Math.round((Date.now() - start) / 1000)}s · page ${now.fps.toFixed(0)} fps · ${now.online} · ${now.pieces} pieces · bots heard ${((received - lastReceived) / 5).toFixed(0)} msg/s · ack p50 ${pct(0.5)} ms p95 ${pct(0.95)} ms · ${closed} dropped`);
  lastReceived = received;
}

const sorted = [...latencies].sort((a, b) => a - b);
const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? Infinity;
const minFps = Math.min(...fps.slice(1));
const pageCount = await page.evaluate(() => window.snapfort.remotes.count);
await page.screenshot({ path: "qa/shots/load.png" });
await browser.close();
for (const ws of sockets) ws.close();

const checks = [
  [`all ${BOTS} bots stayed connected`, closed === 0, `${closed} dropped`],
  ["the page saw every bot", pageCount === BOTS, `${pageCount}`],
  ["actions answered quickly (p95 under 100 ms locally)", p95 < 100, `p95 ${p95.toFixed(0)} ms over ${sorted.length} actions`],
  ["the page stayed smooth with the crowd around (over 30 fps)", minFps > 30, `lowest ${minFps.toFixed(0)} fps`],
  ["no page errors", errors.length === 0, errors.slice(0, 3).join(" | ")],
];
for (const [name, ok, detail] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}  — ${detail}`);
console.log(`(${placed} actions taken, ${rejected} operations refused: bots building in the same spot)`);
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
