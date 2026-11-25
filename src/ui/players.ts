import { REPORT_LABELS, REPORT_REASONS, type ReportReason } from "../net/moderation";
import type { WirePlayer } from "../net/protocol";

/** A builder blocked on this device: their public id, the name they had, and when (ms). */
interface Blocked {
  uid: string;
  name: string;
  at: number;
}

const KEY = "snapfort.blocked";
/** Most builders kept blocked (the oldest go first). */
const MOST_BLOCKED = 200;

/**
 * Who this device has blocked. A blocked builder's chat (bubbles, lines and
 * pings) is not shown here, in any world, on any visit: it is kept by their
 * public id (see moderation.ts) in localStorage. Nobody is told. A builder
 * whose old page sent no public id is blocked by their player id, for as long
 * as they stay.
 */
export class Blocks {
  private list: Blocked[] = [];
  private readonly forNow = new Set<string>();

  constructor() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
      if (Array.isArray(raw)) this.list = raw.filter((b): b is Blocked => typeof b?.uid === "string" && typeof b?.name === "string" && typeof b?.at === "number");
    } catch {
      // Unreadable or blocked storage: nobody blocked yet.
    }
  }

  /** Whether builder `id` (with public id `uid`, when known) is blocked. */
  has(id: string, uid: string | undefined): boolean {
    return uid ? this.list.some((b) => b.uid === uid) : this.forNow.has(id);
  }

  get count(): number {
    return this.list.length + this.forNow.size;
  }

  block(player: WirePlayer): void {
    if (this.has(player.id, player.uid)) return;
    if (!player.uid) {
      this.forNow.add(player.id);
      return;
    }
    this.list.push({ uid: player.uid, name: player.name, at: Date.now() });
    this.list = this.list.slice(-MOST_BLOCKED);
    this.save();
  }

  unblock(player: WirePlayer): void {
    this.forNow.delete(player.id);
    this.list = this.list.filter((b) => b.uid !== player.uid);
    this.save();
  }

  unblockAll(): void {
    this.forNow.clear();
    this.list = [];
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.list));
    } catch {
      // Kept for this visit only.
    }
  }
}

/**
 * The Players panel (from the settings while playing): everyone in this world
 * now, each with Block and Report. Report asks why, in one tap, then says it
 * went. Blocked builders stay on the list, marked, so they can be unblocked.
 */
export class PlayersView {
  /** Reports builder `id` for `why`; the answer comes back through `reported`. */
  onReport: (id: string, why: ReportReason) => void = () => {};
  /** Someone was blocked or unblocked: what is on screen should follow. */
  onBlocksChange: () => void = () => {};

  private readonly listEl = document.getElementById("players-list")!;
  private readonly noteEl = document.getElementById("players-blocked")!;
  /** Who is here (not counting this builder), as last given. */
  private players: WirePlayer[] = [];
  /** The row asking why a report is made, if one is open. */
  private asking: string | null = null;
  /** What each report came to: sending, sent, or not taken. */
  private readonly reports = new Map<string, "sending" | "sent" | "refused">();

  constructor(private readonly blocks: Blocks) {
    this.listEl.addEventListener("click", (e) => this.click(e));
    document.getElementById("players-unblock-all")!.addEventListener("click", () => {
      this.blocks.unblockAll();
      this.onBlocksChange();
      this.paint();
    });
  }

  /** Shows who is here now. */
  show(players: readonly WirePlayer[]): void {
    this.players = [...players].sort((a, b) => a.name.localeCompare(b.name));
    if (this.asking && !this.players.some((p) => p.id === this.asking)) this.asking = null;
    this.paint();
  }

  /** The world answered a report. */
  reported(id: string, ok: boolean): void {
    this.reports.set(id, ok ? "sent" : "refused");
    this.paint();
  }

  /** Joining a world again: reports made in the last one are forgotten (players there have other ids). */
  reset(): void {
    this.reports.clear();
    this.asking = null;
  }

  private click(e: MouseEvent): void {
    const button = (e.target as HTMLElement).closest("button");
    const row = button?.closest<HTMLElement>("[data-id]");
    const player = row && this.players.find((p) => p.id === row.dataset.id);
    if (!button || !player) return;
    const act = button.dataset.act;
    if (act === "block") {
      this.blocks.has(player.id, player.uid) ? this.blocks.unblock(player) : this.blocks.block(player);
      this.onBlocksChange();
    } else if (act === "report") this.asking = this.asking === player.id ? null : player.id;
    else if (act === "cancel") this.asking = null;
    else if (act === "why") {
      const why = button.dataset.why as ReportReason;
      this.asking = null;
      this.reports.set(player.id, "sending");
      this.onReport(player.id, why);
      // Reporting someone also hides their chat here: nobody should have to keep reading it.
      this.blocks.block(player);
      this.onBlocksChange();
    }
    this.paint();
  }

  private paint(): void {
    if (this.players.length === 0) {
      this.listEl.innerHTML = `<p class="players-empty">Nobody else is here right now.</p>`;
    } else {
      this.listEl.innerHTML = this.players.map((p) => this.row(p)).join("");
    }
    const n = this.blocks.count;
    this.noteEl.hidden = n === 0;
    this.noteEl.querySelector("span")!.textContent = `${n} blocked on this device`;
  }

  private row(p: WirePlayer): string {
    const blocked = this.blocks.has(p.id, p.uid);
    const report = this.reports.get(p.id);
    // Their jacket colour, as a little figure (a plain dot read as a radio button).
    const figure = `<svg class="figure" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="6" r="3.6" fill="${p.color}"/><path d="M3.2 18.5c0-4.2 3-6.9 6.8-6.9s6.8 2.7 6.8 6.9z" fill="${p.color}"/></svg>`;
    const name = `${figure}<b>${escape(p.name)}</b>${blocked ? `<span class="tag">Blocked</span>` : ""}`;
    if (this.asking === p.id) {
      const reasons = REPORT_REASONS.map((why) => `<button type="button" class="small ghost" data-act="why" data-why="${why}">${REPORT_LABELS[why]}</button>`).join("");
      return `<div class="player asking" data-id="${p.id}"><div class="who">${name}</div><div class="why"><span>Why are you reporting them?</span>${reasons}<button type="button" class="link" data-act="cancel">Cancel</button></div></div>`;
    }
    const said =
      report === "sent" ? `<span class="note">Reported. Thanks: we look at every report.</span>`
      : report === "sending" ? `<span class="note">Sending…</span>`
      : report === "refused" ? `<span class="note">Not sent: already reported, or too many reports just now</span>`
      : `<button type="button" class="small ghost" data-act="report">Report</button>`;
    return `<div class="player" data-id="${p.id}"><div class="who">${name}</div><div class="acts">${said}<button type="button" class="small${blocked ? "" : " ghost"}" data-act="block">${blocked ? "Unblock" : "Block"}</button></div></div>`;
  }
}

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
