/**
 * Block, report and ban QA on a computer: two builders in a fresh world. B
 * blocks A (A's chat stops showing for B, and comes back on unblocking),
 * reports A (the report reaches the owner with what A said), and the owner
 * bans A's device (A is let go at once and cannot join again), then lifts it.
 * Names the chat filter would mask are not taken. Start the Gallop dev server
 * first, then: npm run qa:moderation  (or: npm run qa:moderation -- "http://localhost:5173/").
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const world = `mod-${Date.now().toString(36)}`;
const site = new URL(process.argv[2] ?? process.env.QA_BASE ?? "http://localhost:5173/");
const base = new URL(site);
base.searchParams.set("world", world);
// The admin secret of the dev server (never printed).
const secret = readFileSync(".dev.vars", "utf8").match(/^ADMIN_SECRET\s*=\s*"?([^"\n]+)"?/m)?.[1];
if (!secret) throw new Error("No ADMIN_SECRET in .dev.vars");
const admin = async (path, method = "GET") => (await fetch(new URL(path, site), { method, headers: { "x-admin-secret": secret } })).json();

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const errors = [];
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(label, context) {
  const page = await (context ?? (await browser.newContext({ viewport: { width: 1100, height: 700 } }))).newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[${label}] ${m.text().slice(0, 200)}`); });
  page.on("pageerror", (e) => errors.push(`[${label} pageerror] ${e.message.slice(0, 300)}`));
  await page.goto(base.toString());
  await page.waitForSelector("body.ready", { timeout: 20000 });
  await page.click("#play-free");
  await wait(300);
  return page;
}
const sf = (page, fn, arg) => page.evaluate(fn, arg);
const frames = (page, n = 3) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const stand = async (page, x, z, yaw) => {
  await sf(page, ([x, z, yaw]) => { const s = window.snapfort; s.player.teleport(x, 0.95, z); s.rig.yaw = yaw; s.rig.pitch = 0.1; }, [x, z, yaw]);
  await frames(page, 6);
};
const named = (page, name) => sf(page, (name) => { const n = document.getElementById("player-name"); n.value = name; n.dispatchEvent(new Event("change", { bubbles: true })); }, name);
const lines = (page) => sf(page, () => [...document.querySelectorAll(".chat-line")].map((l) => l.textContent));
const bubbleTexts = (page) => sf(page, () => [...document.querySelectorAll(".chat-bubble span")].map((b) => b.textContent));
const say = async (page, text) => {
  await sf(page, () => window.snapfort.input.lock?.());
  await page.keyboard.press("Enter");
  await frames(page, 2);
  if ((await page.textContent("#chat-to")) !== "Everyone") await page.keyboard.press("Tab");
  await page.keyboard.type(text, { delay: 5 });
  await page.keyboard.press("Enter");
  await wait(500);
};
/** Opens the Players panel: Esc (the settings), then "Players". */
const openPlayers = async (page) => {
  await sf(page, () => window.snapfort.input.unlock());
  await wait(400);
  await sf(page, () => document.getElementById("paused-players").click());
  await wait(200);
};
const rows = (page) => sf(page, () => [...document.querySelectorAll("#players-list .player")].map((r) => ({ name: r.querySelector("b").textContent, blocked: !!r.querySelector(".tag"), text: r.textContent })));
const clickIn = (page, name, selector) => sf(page, ([name, selector]) => {
  const row = [...document.querySelectorAll("#players-list .player")].find((r) => r.querySelector("b").textContent === name);
  row?.querySelector(selector)?.click();
  return !!row;
}, [name, selector]);
const back = async (page) => { await sf(page, () => document.getElementById("players-back").click()); await wait(200); };

const a = await open("A");
const b = await open("B");
await named(a, "Rowdy Rabbit");
await named(b, "Kind Koala");
await stand(a, 2.5, 0, 0);
await stand(b, 2.5, 10, Math.PI);
await wait(600);

// ── Names ────────────────────────────────────────────────────────────────
await openPlayers(b);
let list = await rows(b);
check("the Players panel lists who is here, by name", list.length === 1 && list[0].name === "Rowdy Rabbit", JSON.stringify(list));
check("…each with Report and Block", list[0]?.text.includes("Report") && list[0]?.text.includes("Block"));
await named(a, "Fuck Face");
await wait(600);
list = await rows(b);
check("a name the filter would mask is not taken: others still see the old one", list[0]?.name === "Rowdy Rabbit", JSON.stringify(list.map((r) => r.name)));
await named(a, "Rowdy Rabbit");
await back(b);

// ── Block ────────────────────────────────────────────────────────────────
await say(a, "first from A");
check("before blocking, B sees what A says", (await lines(b)).some((l) => l.includes("first from A")));
await openPlayers(b);
await clickIn(b, "Rowdy Rabbit", '[data-act="block"]');
await wait(100);
list = await rows(b);
check("Block marks them Blocked", list[0]?.blocked === true);
check("…and takes their chat off the screen at once", !(await lines(b)).some((l) => l.includes("first from A")));
await back(b);
await say(a, "second from A");
check("a blocked builder's chat is not shown", !(await lines(b)).some((l) => l.includes("second from A")) && !(await bubbleTexts(b)).includes("second from A"));
check("…while they still see their own", (await lines(a)).some((l) => l.includes("second from A")));
const saved = await sf(b, () => JSON.parse(localStorage.getItem("snapfort.blocked") ?? "[]"));
check("the block is kept on this device, by public id", saved.length === 1 && /^[0-9a-f]{12}$/.test(saved[0].uid) && saved[0].name === "Rowdy Rabbit", JSON.stringify(saved));

// Joining again: A gets a new player id, the block still holds.
await a.reload();
await a.waitForSelector("body.ready", { timeout: 20000 });
await a.click("#play-free");
await wait(800);
await stand(a, 2.5, 0, 0);
await say(a, "after reload from A");
check("the block lasts when they join again (new player id, same device)", !(await lines(b)).some((l) => l.includes("after reload from A")));

await openPlayers(b);
await clickIn(b, "Rowdy Rabbit", '[data-act="block"]');
await back(b);
await say(a, "third from A");
check("Unblock shows their chat again", (await lines(b)).some((l) => l.includes("third from A")));

// ── Report ───────────────────────────────────────────────────────────────
await openPlayers(b);
await clickIn(b, "Rowdy Rabbit", '[data-act="report"]');
const reasons = await sf(b, () => [...document.querySelectorAll('#players-list [data-act="why"]')].map((x) => x.textContent));
check("Report asks why, in one tap", reasons.length === 4 && reasons.includes("Rude or unsafe chat"), JSON.stringify(reasons));
await clickIn(b, "Rowdy Rabbit", '[data-why="chat"]');
await wait(800);
list = await rows(b);
check("…says it was sent", list[0]?.text.includes("Reported"), list[0]?.text);
check("…and blocks them too", list[0]?.blocked === true);
const openReports = await admin("/admin/reports");
const mine = openReports.find((r) => r.room.includes(world) && r.name === "Rowdy Rabbit");
check("the report reaches the owner: who, by whom, why", mine && mine.byName === "Kind Koala" && mine.why === "chat" && mine.status === "open", JSON.stringify(mine));
check("…with what they said just before", mine && mine.said.map((l) => l.text).includes("third from A") && mine.said.map((l) => l.text).includes("after reload from A"), JSON.stringify(mine?.said));
const overview = await admin("/admin/overview");
check("the admin overview counts open reports and shows each player's public id", overview.openReports >= 1 && overview.worlds.some((w) => w.players.some((p) => p.name === "Rowdy Rabbit" && p.uid === mine?.uid)));
// Reporting the same builder again soon is not taken (one report is enough).
await sf(b, () => { const s = window.snapfort; s.net.report(s.remotes.list()[0].id, "name"); });
await wait(600);
list = await rows(b);
check("reporting the same builder again soon is not taken", list[0]?.text.includes("Not sent"), list[0]?.text);
check("…and only one report was kept", (await admin("/admin/reports")).filter((r) => r.room.includes(world)).length === 1);
await back(b);

// ── Ban ──────────────────────────────────────────────────────────────────
const banned = await admin(`/admin/ban?uid=${mine?.uid}&why=qa`, "POST");
await wait(800);
check("the owner bans by public id: they are let go at once", banned?.kicked === 1, JSON.stringify(banned));
check("…and shown why", ((await a.textContent("#net")) ?? "").includes("removed"), await a.textContent("#net"));
check("…their report is closed as banned", (await admin("/admin/reports?all=1")).find((r) => r.id === mine?.id)?.status === "banned");
await a.reload();
await a.waitForSelector("body.ready", { timeout: 20000 });
await wait(1500);
check("a banned device cannot join again", ((await a.textContent("#net")) ?? "").includes("removed") && !(await sf(a, () => window.snapfort.net?.online ?? false)));
const bans = await admin("/admin/bans");
check("the ban is listed", bans.some((x) => x.uid === mine?.uid && x.name === "Rowdy Rabbit"));
const lifted = await admin(`/admin/unban?uid=${mine?.uid}`, "POST");
await a.reload();
await a.waitForSelector("body.ready", { timeout: 20000 });
await a.click("#play-free");
await wait(1500);
check("lifting the ban lets them back in", lifted.ok && ((await a.textContent("#net")) ?? "") === "");

await browser.close();
if (errors.length) console.log(`\nConsole errors:\n${errors.join("\n")}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed || errors.length ? 1 : 0);
