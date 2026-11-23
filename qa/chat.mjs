/**
 * Chat QA on a computer: builders near each other and one far away, all in a
 * fresh world, talking with real keys and mouse. Start the Gallop dev server
 * first, then: npm run qa:chat  (or: npm run qa:chat -- "http://localhost:5173/").
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const world = `chat-${Date.now().toString(36)}`;
const base = new URL(process.argv[2] ?? "http://localhost:5173/");
base.searchParams.set("world", world);
mkdirSync("qa/shots", { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const errors = [];
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(label, play = true) {
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 700 } })).newPage();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`[${label}] ${m.text().slice(0, 200)}`); });
  page.on("pageerror", (e) => errors.push(`[${label} pageerror] ${e.message.slice(0, 300)}`));
  await page.goto(base.toString());
  await page.waitForSelector("body.ready", { timeout: 20000 });
  if (play) { await page.click("#play-free"); await wait(300); }
  return page;
}
const sf = (page, fn, arg) => page.evaluate(fn, arg);
const frames = (page, n = 3) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
/** Puts a builder at (x, z) looking toward yaw, and makes sure the world has heard where they are. */
const stand = async (page, x, z, yaw, pitch = 0.1) => {
  await sf(page, ([x, z, yaw, pitch]) => { const s = window.snapfort; s.player.teleport(x, 0.95, z); s.rig.yaw = yaw; s.rig.pitch = pitch; }, [x, z, yaw, pitch]);
  await frames(page, 6);
};
const bubbles = (page) => sf(page, () => [...document.querySelectorAll(".chat-bubble")].map((b) => { const r = b.getBoundingClientRect(); return { name: b.querySelector("b").textContent, text: b.querySelector("span").textContent, edge: b.classList.contains("edge"), all: b.classList.contains("all"), mine: b.classList.contains("mine"), x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, right: r.right, top: r.top, bottom: r.bottom, shown: getComputedStyle(b).visibility !== "hidden" }; }));
const pins = (page) => sf(page, () => [...document.querySelectorAll(".chat-pin")].map((p) => { const r = p.getBoundingClientRect(); return { name: p.querySelector("b").textContent, dist: p.querySelector("em").textContent, edge: p.classList.contains("edge"), x: r.left + r.width / 2, bottom: r.bottom }; }));
const lines = (page) => sf(page, () => [...document.querySelectorAll(".chat-line")].map((l) => l.textContent));
const toast = (page) => sf(page, () => document.getElementById("toast").textContent);
const boxOpen = (page) => sf(page, () => !document.getElementById("chat-box").hidden);
const named = async (page, name) => { await sf(page, (name) => { document.getElementById("player-name").value = name; document.getElementById("player-name").dispatchEvent(new Event("change", { bubbles: true })); document.getElementById("player-name").dispatchEvent(new Event("input", { bubbles: true })); }, name); };
/** Says something with the keys: Enter, Tab if the line is set to the other audience, type, Enter. */
const say = async (page, text, to = "near") => {
  await page.keyboard.press("Enter");
  await frames(page, 2);
  if ((await page.textContent("#chat-to")) !== (to === "all" ? "Everyone" : "Nearby")) await page.keyboard.press("Tab");
  await page.keyboard.type(text, { delay: 5 });
  await page.keyboard.press("Enter");
  await wait(400);
};

const a = await open("A");
const b = await open("B");
const c = await open("C");
const myName = (page) => sf(page, () => document.getElementById("player-name").value);
const [nameA, nameB, nameC] = [await myName(a), await myName(b), await myName(c)];
// A and B ten metres apart, facing each other; C 300 m away.
await stand(a, 2.5, 0, 0);
await stand(b, 2.5, 10, Math.PI);
await stand(c, 300, 300, 0);
await wait(500);

// ── Typing ───────────────────────────────────────────────────────────────
const before = await sf(a, () => ({ p: window.snapfort.player.position.asArray(), n: window.snapfort.state.size, bar: document.getElementById("hotbar").innerHTML }));
await a.keyboard.press("Enter");
await frames(a, 2);
check("Enter opens the chat line, ready to type", (await boxOpen(a)) && (await sf(a, () => document.activeElement?.id === "chat-input" && window.snapfort.input.typing)));
check("…to everyone at first, with the keys shown", (await a.textContent("#chat-to")) === "Everyone" && (await a.textContent("#chat-note")).includes("Tab"), await a.textContent("#chat-note"));
await a.keyboard.type("wasd zfxc 123 qe g");
await a.keyboard.down("KeyW"); await wait(400); await a.keyboard.up("KeyW");
await a.mouse.down(); await a.mouse.up();
await frames(a, 4);
const during = await sf(a, () => ({ p: window.snapfort.player.position.asArray(), n: window.snapfort.state.size, bar: document.getElementById("hotbar").innerHTML, value: document.getElementById("chat-input").value }));
const moved = Math.hypot(during.p[0] - before.p[0], during.p[2] - before.p[2]);
check("typing letters does not move, build, undo or switch pieces, and a click does not place", moved < 0.05 && during.n === before.n && during.bar === before.bar, `moved ${moved.toFixed(2)} m, pieces ${before.n}→${during.n}`);
check("…the letters land in the line", during.value === "wasd zfxc 123 qe gw", JSON.stringify(during.value));
check("…and the click ended typing, keeping what was typed", !(await boxOpen(a)) && !(await sf(a, () => window.snapfort.input.typing)));
await a.keyboard.press("Enter"); await frames(a, 2);
check("Enter opens the line again with the text still there", (await boxOpen(a)) && (await sf(a, () => document.getElementById("chat-input").value)) === "wasd zfxc 123 qe gw");
await sf(a, () => { document.getElementById("chat-input").value = ""; });
await a.keyboard.press("Tab");
check("Tab switches the line to builders nearby", (await a.textContent("#chat-to")) === "Nearby" && (await sf(a, () => document.getElementById("chat-input").placeholder)).includes("nearby"));
await a.keyboard.type("hello from A");
await a.keyboard.press("Enter");
await wait(500);
check("Enter sends and closes the line", !(await boxOpen(a)) && !(await sf(a, () => window.snapfort.input.typing)));
const bubA = (await bubbles(a)).find((x) => x.mine);
check("the speaker sees their own bubble", bubA?.text === "hello from A" && bubA.name === nameA, JSON.stringify(bubA));
const bubB = (await bubbles(b)).find((x) => x.name === nameA);
check("a builder nearby sees it over the speaker's head, on screen", bubB?.text === "hello from A" && !bubB.edge && bubB.shown && Math.abs(bubB.x - 550) < 120 && bubB.y < 350, JSON.stringify(bubB));
check("a message said looking at open ground is not pinned anywhere", (await pins(b)).length === 0 && (await pins(a)).length === 0);
check("a builder 300 m away does not", (await bubbles(c)).length === 0 && (await lines(c)).length === 0);
check("nearby messages stay off the everyone lines", (await lines(b)).length === 0);
await a.screenshot({ path: "qa/shots/chat-own-bubble.png" });
await b.screenshot({ path: "qa/shots/chat-bubble.png" });
// Moving again after typing.
const p0 = await sf(a, () => window.snapfort.player.position.z);
await a.keyboard.down("KeyW"); await wait(500); await a.keyboard.up("KeyW");
check("after sending, the keys move the builder again", (await sf(a, () => window.snapfort.player.position.z)) - p0 > 1);
await stand(a, 2.5, 0, 0);

// ── Everyone ─────────────────────────────────────────────────────────────
await wait(1700);
await a.keyboard.press("Enter"); await frames(a, 2);
check("the line opens to whoever it talked to last (nearby)", (await a.textContent("#chat-to")) === "Nearby");
await a.keyboard.press("Tab");
check("Tab switches back to everyone", (await a.textContent("#chat-to")) === "Everyone" && (await sf(a, () => document.getElementById("chat-input").placeholder)).includes("everyone"));
await a.keyboard.type("anyone want to build a castle?");
await a.screenshot({ path: "qa/shots/chat-line.png" });
await a.keyboard.press("Enter");
await wait(500);
check("a message to everyone reaches a builder 300 m away, as a line at the top", (await lines(c)).some((l) => l.includes(nameA) && l.includes("castle")), JSON.stringify(await lines(c)));
check("…and the speaker and builders nearby see the line too", (await lines(a)).some((l) => l.includes("castle")) && (await lines(b)).some((l) => l.includes("castle")));
check("…as a line only: no bubble over the speaker, even for builders nearby", !(await bubbles(b)).some((x) => x.text.includes("castle")) && !(await bubbles(a)).some((x) => x.text.includes("castle")));
check("…but no bubble for the far builder", !(await bubbles(c)).some((x) => x.name === nameA));
await c.screenshot({ path: "qa/shots/chat-everyone.png" });
// Back to back: no waiting between messages.
await a.keyboard.press("Enter"); await frames(a, 2);
check("…and the line stays set to everyone for next time", (await a.textContent("#chat-to")) === "Everyone");
await a.keyboard.type("me again");
await a.keyboard.press("Enter");
await say(a, "me again", "all");
check("messages go back to back, the same words twice too", (await lines(c)).filter((l) => l.includes("me again")).length === 2, JSON.stringify(await lines(c)));
await a.keyboard.press("Enter"); await frames(a, 2);
await a.keyboard.type("never sent");
await a.keyboard.press("Escape");
await wait(300);
check("Esc closes the line without sending", !(await boxOpen(a)) && !(await lines(c)).some((l) => l.includes("never sent")));
// Esc also frees the mouse (the browser's rule): carry on.
if (!(await sf(a, () => window.snapfort.input.locked))) { await wait(1200); await a.click("#resume").catch(() => a.mouse.click(550, 350)); await wait(1300); }
check("…and building carries on after it", await sf(a, () => window.snapfort.input.locked));
await a.keyboard.press("Enter"); await frames(a, 2);
check("next time the line opens empty (Esc forgot it), still to everyone", (await sf(a, () => document.getElementById("chat-input").value)) === "" && (await a.textContent("#chat-to")) === "Everyone");
await a.keyboard.press("Enter"); await frames(a, 2);
check("Enter on an empty line just closes it", !(await boxOpen(a)));

// ── The server's rules ──────────────────────────────────────────────────
await say(b, "what the fuck is that");
const filtered = (await bubbles(a)).find((x) => x.name === nameB);
check("swear words are masked for everyone, the speaker too", filtered?.text === "what the ♥♥♥ is that" && (await bubbles(b)).find((x) => x.mine)?.text === "what the ♥♥♥ is that", JSON.stringify(filtered));
await wait(2100);
await say(b, "visit www.example.com or call 555 123 4567");
check("links and phone numbers are masked", (await bubbles(a)).find((x) => x.name === nameB)?.text === "visit ♥♥♥ or call ♥♥♥", (await bubbles(a)).find((x) => x.name === nameB)?.text);
await wait(2100);
// A flood (a script, not typing): the sixth message within 5 s is held back.
await wait(5100);
await sf(c, () => { for (let i = 1; i <= 5; i++) window.snapfort.net.say(`flood ${i}`, "all", null); });
await say(c, "flood 6", "all");
check("a flood is held back on the server: five messages in a few seconds go, the sixth does not", (await lines(a)).some((l) => l.includes("flood 5")) && !(await lines(a)).some((l) => l.includes("flood 6")) && (await toast(c)).startsWith("Slow down"), await toast(c));
await c.keyboard.press("Enter"); await frames(c, 2);
{ const st = await sf(c, () => document.getElementById("chat-input").value); check("…and the held message is waiting in the line to send again", st === "flood 6" && (await c.textContent("#chat-to")) === "Everyone", JSON.stringify(st)); }
await c.keyboard.press("Escape"); await wait(300);
if (!(await sf(c, () => window.snapfort.input.locked))) { await wait(1200); await c.click("#resume").catch(() => {}); await wait(1300); }
// Typing fast by hand: the page holds the sixth itself and keeps it in the line.
await wait(5100);
for (let i = 1; i <= 5; i++) await say(c, `quick ${i}`, "all");
await c.keyboard.press("Enter"); await frames(c, 2);
await c.keyboard.type("quick 6");
await c.keyboard.press("Enter"); await frames(c, 3);
check("five quick messages by hand all go; a sixth at once is held in the line, saying to slow down", (await lines(a)).some((l) => l.includes("quick 5")) && (await boxOpen(c)) && (await c.textContent("#chat-note")).startsWith("Slow down") && (await sf(c, () => document.getElementById("chat-input").value)) === "quick 6", await c.textContent("#chat-note"));
await c.keyboard.press("Escape"); await wait(300);
if (!(await sf(c, () => window.snapfort.input.locked))) { await wait(1200); await c.click("#resume").catch(() => {}); await wait(1300); }

// ── Pings ────────────────────────────────────────────────────────────────
await wait(2100);
// A looks down at the ground a few metres ahead and middle-clicks.
await stand(a, 2.5, 0, 0, 0.55);
await a.mouse.down({ button: "middle" }); await a.mouse.up({ button: "middle" });
await wait(500);
const pinB = (await pins(b)).find((x) => x.name === nameA);
check("middle click pings the spot: a builder nearby sees the marker, with how far it is", !!pinB && /^\d+ m$/.test(pinB.dist) && !pinB.edge, JSON.stringify(pinB));
check("…the pinger sees it too, the far builder does not", (await pins(a)).some((x) => x.name === nameA) && (await pins(c)).length === 0);
await b.screenshot({ path: "qa/shots/chat-ping.png" });
await a.mouse.down({ button: "middle" }); await a.mouse.up({ button: "middle" });
await frames(a, 2);
check("pinging again at once works too (the marker moves)", !(await toast(a)).startsWith("Slow down") && (await pins(b)).filter((x) => x.name === nameA).length === 1);
// Looking at the sky: nothing to ping.
await wait(2100);
await stand(a, 2.5, 0, 0, -1.2);
await a.mouse.down({ button: "middle" }); await a.mouse.up({ button: "middle" });
await frames(a, 2);
check("pinging the sky says to aim at something", (await toast(a)) === "Aim at something to ping it", await toast(a));
// A nearby message while aiming at a wall a few metres away: pinned there.
await sf(a, () => { const s = window.snapfort; s.history.do({ kind: "place", piece: { type: "wall", x: 0, y: 0, z: 1, rot: 0, id: s.nextId(), material: "wood", edit: 0 } }); });
await stand(a, 2.5, 1, 0, 0.15);
await wait(300);
await say(a, "need a ramp here");
const pinned = (await pins(b)).find((x) => x.name === nameA);
check("a nearby message said while aiming at a wall is pinned to it, as well as over the head", !!pinned && (await bubbles(b)).some((x) => x.name === nameA && x.text === "need a ramp here"), JSON.stringify(pinned));
await wait(2100);
// Off screen: B looks away from A.
await stand(b, 2.5, 10, 0);
await say(a, "behind you!");
const edge = (await bubbles(b)).find((x) => x.name === nameA);
check("a bubble from a builder behind waits at the edge of the screen, with an arrow", !!edge && edge.edge && edge.left >= 0 && edge.right <= 1100 && edge.top >= 0 && edge.bottom <= 700, JSON.stringify(edge));
check("…straight behind, at the bottom, above the hotbar", !!edge && edge.y > 450 && Math.abs(edge.x - 550) < 80 && edge.bottom <= (await sf(b, () => document.getElementById("hotbar").getBoundingClientRect().top)), JSON.stringify(edge));
await b.screenshot({ path: "qa/shots/chat-edge.png" });

// ── On a trebuchet ───────────────────────────────────────────────────────
await wait(2100);
await stand(b, 2.5, 10, Math.PI);
await sf(a, () => { const s = window.snapfort; s.history.do({ kind: "place", piece: { type: "trebuchet", x: 4, y: 0, z: -2, rot: 0, id: s.nextId(), material: "wood", edit: 0 } }); });
await stand(a, 22.5, -12.5, 0);
await wait(300);
await a.keyboard.press("KeyH");
await wait(600);
check("(on a trebuchet for the next checks)", !!(await sf(a, () => window.snapfort.crewOn)));
await say(a, "firing soon");
check("Enter talks from a trebuchet too", (await bubbles(b)).some((x) => x.name === nameA && x.text === "firing soon"));
check("…and typing there does not fire it", (await a.textContent("#crew")).includes("ready"), await a.textContent("#crew"));
await wait(2100);
await sf(a, () => { window.snapfort.rig.pitch = 0.3; });
await frames(a, 4);
await a.mouse.down({ button: "middle" }); await a.mouse.up({ button: "middle" });
await wait(500);
const target = await sf(a, () => window.snapfort.target);
check("middle click on a trebuchet pings its target", !!target && (await pins(b)).some((x) => x.name === nameA), JSON.stringify(target));
await a.keyboard.press("KeyH");
await wait(300);

// ── Coming and going ─────────────────────────────────────────────────────
// At most three lines at once, newest last.
await sf(b, () => { const s = window.snapfort; const now = performance.now(); for (let i = 1; i <= 5; i++) s.chat.show({ by: "x" + i, name: "Bot " + i, color: "#55aaff", text: "line " + i, to: "all" }, s.myId, now); });
check("at most three lines for everyone at once, the newest kept", JSON.stringify((await lines(b)).map((l) => l.split(" ").pop())) === JSON.stringify(["3", "4", "5"]), JSON.stringify(await lines(b)));
// A builder who arrives now sees the recent line to everyone.
await wait(1100);
await sf(c, () => window.snapfort.net.say("welcome, newcomers", "all", null));
await wait(400);
const d = await open("D");
await wait(500);
check("a builder who just arrived sees the last few seconds of lines for everyone", (await lines(d)).some((l) => l.includes("welcome, newcomers")), JSON.stringify(await lines(d)));
// Everything fades.
await wait(8800);
check("bubbles, pins and lines are gone after about 8 seconds", (await bubbles(b)).length === 0 && (await pins(b)).length === 0 && (await lines(b)).length === 0 && (await lines(d)).length === 0, `${(await bubbles(b)).length} bubbles, ${(await pins(b)).length} pins, ${(await lines(b)).length} lines`);

check("no errors", errors.length === 0, errors.slice(0, 4).join(" | "));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed in world ${world}`);
await browser.close();
process.exit(failed.length ? 1 : 0);
