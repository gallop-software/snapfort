import { readFileSync } from "node:fs";
const secret = readFileSync("secrets/admin-secret.txt", "utf8").trim();
const over = await fetch("https://snapfort.io/admin/overview", { headers: { "x-admin-secret": secret } }).then((r) => r.json());
const list = over.worlds ?? over.rooms ?? [];
for (const w of list) console.log(w.env ?? w.id, "· pieces", w.pieces, "· players", (w.players ?? []).map((p) => `${p.name} (${p.status ?? (p.builder ? "builder" : "visitor")}, joined ${p.joined ? Math.round((Date.now() - p.joined) / 1000) + " s ago" : "?"})`).join(", ") || "none");
