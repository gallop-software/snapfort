/**
 * The menu and a first game, on a computer: world cards, Controls and
 * Settings panels, the Moon's unlock (menu button, the bar while visiting,
 * the U key, the panel), and the first-game tips stepping along as they are
 * done. Dev server running: npm run qa:menu
 */
import { chromium, devices } from "playwright-core";

const base = new URL(process.argv[2] ?? "http://localhost:5173/");
const world = `menu-${Date.now().toString(36)}`;
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const results = [];
const errors = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(path) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
  const url = new URL(path, base);
  url.searchParams.set("world", world);
  await page.goto(url.toString());
  await page.waitForSelector("body.ready", { timeout: 60000 });
  await wait(500);
  return page;
}
const sf = (page, fn, arg) => page.evaluate(fn, arg);
const fits = (page) => sf(page, () => { const o = document.getElementById("overlay"); return o.scrollHeight <= o.clientHeight + 1; });
const tip = (page) => sf(page, () => { const t = document.getElementById("tip"); return t.hidden ? "" : t.querySelector(".tip-text").textContent; });

// ── The menu ─────────────────────────────────────────────────────────────
const p = await open("/");
check("the menu: two world cards with pictures, one button, no settings or key list in sight", (await p.locator(".world .pic").count()) === 2 && (await p.isVisible("#play-free")) && !(await p.isVisible("#settings")) && !(await p.isVisible(".keys")) && (await fits(p)));
check("…the meadow card is marked as where you are, the Moon's as the Full Game", await sf(p, () => document.querySelector('.world[data-env="meadow"]').classList.contains("current") && document.querySelector('.world[data-env="moon"] .badge').textContent === "Full Game"));
check("…and the pictures load", await sf(p, () => Promise.all(["/worlds/meadow.jpg", "/worlds/moon.jpg"].map((u) => fetch(u).then((r) => r.ok && r.headers.get("content-type")?.includes("image")))).then((a) => a.every(Boolean))));
check("'Playing as' shows your name and colour", (await p.textContent("#me-name")) === (await p.inputValue("#player-name")) && !!(await sf(p, () => document.getElementById("me-dot").style.background)));
await p.click("#open-controls");
check("Controls opens the key list, and fits", (await p.isVisible(".keys")) && (await fits(p)));
await p.click("#controls-back");
await p.click("#playing-as");
check("'Playing as' opens Settings, with your name and colour to change", (await p.isVisible("#settings")) && (await p.isVisible("#player-name")) && (await fits(p)));
await p.fill("#player-name", "Captain Menu"); await p.press("#player-name", "Enter");
await p.click("#settings-back");
check("…and the new name shows on the menu", (await p.textContent("#me-name")) === "Captain Menu" && (await p.isVisible("#worlds")));
check("the Moon card goes to the Moon (keeping the test world)", (await p.getAttribute('.world[data-env="moon"]', "href")).startsWith("/moon"));

// ── First-game tips ──────────────────────────────────────────────────────
await p.click("#play-free"); await wait(800);
check("a first game starts with a tip: how to move", (await tip(p)).includes("W A S D"), await tip(p));
await p.keyboard.down("KeyW"); await wait(700); await p.keyboard.up("KeyW"); await wait(300);
check("…walking moves it on: click to place a wall", (await tip(p)).includes("Click"), await tip(p));
await sf(p, () => { window.snapfort.rig.pitch = 0.35; }); await wait(200);
await p.mouse.down(); await p.mouse.up(); await wait(400);
check("…placing moves it on: other pieces", (await tip(p)).includes("floor"), await tip(p));
await p.keyboard.press("KeyF"); await wait(200);
await p.mouse.down(); await p.mouse.up(); await wait(400);
check("…a floor moves it on: hold to keep placing", (await tip(p)).includes("Hold"), await tip(p));
await p.keyboard.press("KeyZ"); await wait(100);
await p.keyboard.down("KeyA"); await p.mouse.down(); await wait(1600); await p.mouse.up(); await p.keyboard.up("KeyA"); await wait(400);
check("…holding to place moves it on: pieces need support", (await tip(p)).includes("support"), await tip(p));
await wait(7600);
check("…then, last: press Enter to chat", (await tip(p)).includes("chat"), await tip(p));
check("a chat chip (Enter) is in the corner while playing", (await p.isVisible("#chat-chip")) && (await p.textContent("#chat-chip")).includes("Enter"));
await p.keyboard.press("Slash"); await wait(300);
check("'/' opens the chat line too, with nothing typed in it", (await sf(p, () => !document.getElementById("chat-box").hidden && document.getElementById("chat-input").value === "")));
await p.keyboard.press("Enter"); await wait(300);
check("…opening chat finishes the tips", (await tip(p)) === "" && (await sf(p, () => localStorage.getItem("snapfort.tips"))) === "done");
// Someone else talks: the chip glows, and the first time a hint says how to reply.
const other = await open("/");
await other.click("#play-free"); await wait(600);
await sf(other, () => window.snapfort.net.say("hello from the other builder", "all", null));
await wait(600);
check("when someone else talks, the chip glows and a hint says to press Enter to reply", (await sf(p, () => document.getElementById("chat-chip").classList.contains("ping"))) && (await sf(p, () => document.getElementById("toast").textContent)).includes("press Enter to reply"));
await wait(4300); // the first hint shows for 4 s
await sf(other, () => window.snapfort.net.say("and again", "all", null));
await wait(500);
check("…the hint only once (the glow each time)", (await sf(p, () => document.getElementById("chat-chip").classList.contains("ping"))) && !(await sf(p, () => document.getElementById("toast").classList.contains("show") && document.getElementById("toast").textContent.includes("reply"))));
await other.context().close();
await p.reload(); await p.waitForSelector("body.ready"); await p.click("#play-free"); await wait(800);
check("a returning player sees no tips", (await tip(p)) === "");
await p.context().close();

// ── The Moon, without the Full Game ──────────────────────────────────────
const m = await open("/moon?testpay");
check("the Moon's menu: a big Unlock the Moon · $7 above Visit the Moon", (await m.isVisible("#offer-buy")) && (await m.textContent("#play-free")) === "Visit the Moon" && (await fits(m)));
const order = await sf(m, () => document.getElementById("offer-buy").getBoundingClientRect().top < document.getElementById("play-free").getBoundingClientRect().top);
check("…Unlock comes first", order);
await m.click("#play-free"); await wait(800);
check("visiting: a bar with Unlock · $7 (and the U key) stays in sight", (await m.isVisible("#visit-bar")) && (await m.textContent("#visit-buy")).includes("$7"));
check("…no tips while visiting (there is nothing to build)", (await tip(m)) === "");
await m.keyboard.press("KeyU"); await wait(600);
check("U opens the unlock panel: picture, what you get, Unlock · $7", (await m.isVisible("#view-unlock")) && (await m.locator(".perks li").count()) === 4 && (await m.textContent("#unlock-buy")) === "Unlock · $7" && (await fits(m)));
await m.keyboard.press("Escape"); await wait(1300);
check("Esc closes it", !(await m.isVisible("#view-unlock")));
if (!(await sf(m, () => window.snapfort.input.locked))) { await wait(1200); await m.mouse.click(640, 400); await wait(1300); }
await m.mouse.down(); await m.mouse.up(); await wait(600);
await m.click("#unlock-key"); await wait(500);
check("'Have a key?' on the panel opens the key box in the settings", (await m.isVisible("#store-key-input")) && (await sf(m, () => document.getElementById("full-game").classList.contains("entering"))));

// ── Switching world while playing (phone: the gear) ─────────────────────
{
  const ctx = await browser.newContext({ ...devices["iPhone 13 landscape"] });
  const ph = await ctx.newPage();
  ph.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
  const url = new URL("/moon", base); url.searchParams.set("world", world);
  await ph.goto(url.toString()); await ph.waitForSelector("body.ready", { timeout: 60000 });
  await ph.tap("#play-free"); await wait(800);
  await ph.tap("#t-settings"); await wait(600);
  const here = await sf(ph, () => document.querySelector('.mini-world.current')?.dataset.env);
  check("playing on the Moon, the gear's panel offers to switch world, the Moon marked as here", (await ph.isVisible(".mini-world[data-env=meadow]")) && here === "moon" && (await fits(ph)));
  await ph.tap(".mini-world[data-env=meadow]");
  await ph.waitForSelector("body.ready", { timeout: 60000 }); await wait(500);
  check("…one tap on Meadow goes back to the meadow (same test world)", (await sf(ph, () => window.snapfort.env.id)) === "meadow" && new URL(ph.url()).searchParams.get("world") === world, ph.url());
  await ctx.close();
}

// ── How many builders are in each world; the world you are in is not a link ─
{
  const counts = (page, sel) => sf(page, (sel) => Object.fromEntries([...document.querySelectorAll(`${sel} [data-builders]`)].map((el) => [el.dataset.builders, el.textContent])), sel);
  const one = await open("/moon");
  const two = await open("/moon");
  const three = await open("/");
  // (Every page opened above in this test world is still there: count them from the server's own answer.)
  const truth = await sf(one, (w) => fetch(`/api/worlds?world=${w}`).then((r) => r.json()), world);
  const moon = truth.worlds.find((w) => w.id === "moon").builders, meadow = truth.worlds.find((w) => w.id === "meadow").builders;
  check("the server knows how many builders are in each world", moon >= 2 && meadow >= 1, JSON.stringify(truth.worlds));
  await one.reload(); await one.waitForSelector("body.ready"); await wait(2600);
  const cards = await counts(one, "#worlds");
  check("each world's card says how many builders are there", cards.moon === `${moon} builders` && cards.meadow === `${meadow} ${meadow === 1 ? "builder" : "builders"}`, JSON.stringify(cards));
  check("…and the menu still fits", await fits(one));
  await two.context().close(); await wait(1200);
  await one.click("#play-free"); await wait(800);
  await sf(one, () => document.exitPointerLock()); await wait(1500);
  const mini = await counts(one, "#mini-worlds");
  check("…the world switcher too, and it notices when someone leaves", (await one.isVisible("#mini-worlds")) && mini.moon === String(moon - 1) && mini.meadow === String(meadow), JSON.stringify(mini));
  check("…and the settings still fit", await fits(one));
  await one.click("#resume").catch(() => {}); await wait(300);
  // The card of the world you are in: clicking it does not load the page again.
  const four = await open("/moon");
  await sf(four, () => { window.__same = true; });
  await four.click("#worlds .world.current"); await wait(1200);
  check("clicking the card of the world you are in does nothing (the page is not loaded again)", (await sf(four, () => window.__same === true)) && (await sf(four, () => document.querySelector("#worlds .world.current").getAttribute("href"))) === null);
  check("…while the other world's card still goes there", (await sf(four, () => document.querySelector("#worlds .world:not(.current)").getAttribute("href"))).startsWith("/?world="));
  await three.context().close(); await four.context().close(); await one.context().close();
}

check("no errors", errors.length === 0, errors.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
