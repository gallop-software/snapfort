// Says which rules the live Mojave room is running: exit 0 when a general arriving is offered the eight armies (the third pass), 1 when they are put straight into a place (the room has not moved onto the new code yet).
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";
const base = "https://snapfort.io";
const secret = readFileSync("secrets/admin-secret.txt", "utf8").trim();
const keys = await fetch(`${base}/admin/keys?email=qa@snapfort.io`, { headers: { "x-admin-secret": secret } }).then((r) => r.json());
const key = keys.find((k) => (k.seats ?? 1) >= 2 && k.paid !== false)?.key;
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--ignore-gpu-blocklist"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 760 } });
await context.addInitScript((k) => { localStorage.setItem("snapfort.key", k); localStorage.setItem("snapfort.tips", "done"); localStorage.setItem("snapfort.mojave.intro", "seen"); }, key);
const page = await context.newPage();
await page.goto(`${base}/mojave`);
await page.waitForSelector("body.ready", { timeout: 40000 });
await page.click("#play-free");
await new Promise((r) => setTimeout(r, 3500));
const offered = await page.evaluate(() => [...document.querySelectorAll("#hotbar .slot .label")].map((l) => l.firstChild?.textContent).join(","));
console.log(new Date().toISOString().slice(11, 19), offered);
await browser.close();
process.exit(offered.startsWith("Red,Blue") ? 0 : 1);
