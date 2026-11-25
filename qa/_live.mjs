// A look at the live site after a deploy: every world loads and joins, and Mojave shows a visitor the war.
import { chromium } from "playwright-core";
const base = "https://snapfort.io";
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const say = (ok, text) => { if (!ok) bad++; console.log(`${ok ? "PASS" : "FAIL"}  ${text}`); };
for (const path of ["/", "/moon", "/mars", "/mojave"]) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  await context.addInitScript(() => localStorage.setItem("snapfort.tips", "done"));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
  await page.goto(base + path);
  const ready = await page.waitForSelector("body.ready", { timeout: 40000 }).then(() => true).catch(() => false);
  const menu = await page.evaluate(() => ({ cards: document.querySelectorAll(".world .pic").length, here: document.querySelector(".world.current b")?.textContent, button: document.getElementById("play-free")?.textContent, net: document.getElementById("net")?.hidden !== false ? "" : document.getElementById("net").textContent }));
  say(ready && menu.cards === 4, `${path}: loads, four world cards, this one marked "${menu.here}", button "${menu.button}"${menu.net ? `, net: ${menu.net}` : ""}`);
  if (path === "/mojave") await page.screenshot({ path: "qa/shots/live-menu.png" });
  await page.click("#play-free");
  await wait(3500);
  const playing = await page.evaluate(() => ({ playing: document.body.classList.contains("playing") || document.body.classList.contains("away"), online: document.getElementById("online")?.textContent ?? "", visit: !document.getElementById("visit-bar")?.hidden }));
  say(playing.playing && /online/.test(playing.online), `${path}: joined the live world (${playing.online})`);
  if (path === "/mojave") {
    const m = await page.evaluate(() => ({ watch: document.getElementById("mj-watch")?.textContent ?? "", map: !!document.getElementById("mj-map"), bank: document.getElementById("mj-bank")?.hidden, dark: !!document.querySelector("#mj") }));
    say(/Full Game/.test(m.watch) && m.map && m.bank === true, `/mojave: a visitor is told they are watching ("${m.watch.slice(0, 60)}…"), with the map and no bank`);
    await wait(2500);
    await page.screenshot({ path: "qa/shots/live-mojave.png" });
  }
  say(errors.length === 0, `${path}: no errors${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
  await context.close();
}
const pic = await fetch("https://cdn.snapfort.io/worlds/mojave.jpg");
say(pic.ok, `the card's picture is on the CDN (${pic.status})`);
const terms = await (await fetch(base + "/terms")).text();
say(/Mojave/.test(terms), "the terms name Mojave");
const store = await (await fetch(base + "/api/store", { cache: "no-store" })).json();
console.log("live build:", store.build, "· payments live:", store.live);
const worlds = await (await fetch(base + "/api/worlds", { cache: "no-store" })).json();
console.log("worlds:", JSON.stringify(worlds.worlds));
await browser.close();
process.exit(bad ? 1 : 0);
