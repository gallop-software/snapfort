import { worldAtPath } from "../worlds";
import { cleanKey } from "../net/keys";

/** Where the key is kept in this browser. */
const KEY = "snapfort.key";
/** Set by visiting with ?testpay: shows the Unlock button while Stripe is still in test mode. */
const TESTPAY = "snapfort.testpay";
/** What one seat (one player) costs, in dollars. */
const EACH = 7;
export const PRICE = `$${EACH}`;
/** The most seats one purchase can buy (the server's limit too). */
const MOST_SEATS = 10;
/** "3 seats" */
const seatsText = (n: number) => (n === 1 ? "1 seat" : `${n} seats`);

/**
 * The Full Game: whether this browser owns it (a SnapFort key, checked with the
 * server), buying it (off to Stripe Checkout and back), and typing in a key
 * bought on another device, or switching to another key (someone sharing a
 * friend's key who then buys their own: any new key replaces the one this
 * device had). A key has seats: as many can build with it at once as were
 * bought, together or added later. Drives the Full Game row in the settings,
 * the count of players on the unlock panel and the thank-you note after buying.
 */
export class Store {
  key: string | null = localStorage.getItem(KEY);
  /** The key is paid for (checked with the server). */
  owned = false;
  /** How many can build at once with this device's key (0 until it is known). */
  seats = 0;
  /** How many players the unlock panel is set to: seats for a new key, or seats to add. */
  private pick = 1;
  /** The unlock panel is for more seats on this device's key, not a new key. */
  private adding = false;
  /** The unlock panel's own title, kept while it reads "Add seats". */
  private title: string | null = null;
  /** The server can sell (Stripe set up), and with real money or not. */
  private ready = false;
  private live = false;
  private readonly testpay: boolean;
  /** Called when ownership changes (bought, or a key typed in). */
  onOwned: (key: string) => void = () => {};
  /** "Have a key?" from the menu or the unlock panel: the game opens the settings to type it in. */
  onHaveKey: () => void = () => {};
  /** "Add seats": the game opens the unlock panel, set to adding. */
  onAddSeats: () => void = () => {};
  /** A short message for the player (shown by the game as a toast). */
  onNotice: (text: string) => void = () => {};

  private readonly row = document.getElementById("full-game")!;
  private readonly message = document.getElementById("store-message")!;
  private readonly input = document.getElementById("store-key-input") as HTMLInputElement;

  constructor() {
    const params = new URLSearchParams(location.search);
    if (params.has("testpay")) sessionStorage.setItem(TESTPAY, "1");
    this.testpay = sessionStorage.getItem(TESTPAY) === "1";
    // "Get my own" (owning it with a shared key) buys like any other button: the new key takes this device over.
    for (const id of ["store-buy-button", "offer-buy", "unlock-buy"]) document.getElementById(id)!.addEventListener("click", () => void this.buy());
    // (Their own key is always a new one, for one player, whatever the unlock panel was last set to.)
    for (const button of document.querySelectorAll(".store-own-buy")) button.addEventListener("click", () => void this.buy(true));
    for (const button of document.querySelectorAll(".store-add-seats")) button.addEventListener("click", () => this.onAddSeats());
    document.getElementById("seats-less")!.addEventListener("click", () => this.choose(this.pick - 1));
    document.getElementById("seats-more")!.addEventListener("click", () => this.choose(this.pick + 1));
    for (const id of ["offer-key", "unlock-key"]) document.getElementById(id)!.addEventListener("click", () => this.onHaveKey());
    for (const id of ["store-have-key", "store-other-key"]) document.getElementById(id)!.addEventListener("click", () => this.showEnter(true));
    document.getElementById("store-enter")!.addEventListener("submit", (e) => {
      e.preventDefault();
      void this.enter(this.input.value);
    });
    document.getElementById("store-enter-cancel")!.addEventListener("click", () => this.showEnter(false));
    document.getElementById("store-lost-open")!.addEventListener("click", () => this.showLost(true));
    for (const button of document.querySelectorAll(".store-replace")) button.addEventListener("click", () => void this.replace());
    document.getElementById("store-lost-cancel")!.addEventListener("click", () => this.showLost(false));
    document.getElementById("store-lost")!.addEventListener("submit", (e) => {
      e.preventDefault();
      void this.lost((document.getElementById("store-lost-email") as HTMLInputElement).value);
    });
    for (const id of ["store-copy", "thanks-copy"]) document.getElementById(id)!.addEventListener("click", () => void this.copy(id));
    document.getElementById("thanks-close")!.addEventListener("click", () => (document.getElementById("thanks")!.hidden = true));
  }

  /** Buying is possible here: always on a live site, in test mode only with ?testpay. */
  get canBuy(): boolean {
    return this.ready && (this.live || this.testpay);
  }

  /** Sets the unlock panel up: the Full Game for some number of players, or (`add`) more seats on this device's key. */
  offer(add: boolean): void {
    const adding = add && this.owned;
    if (adding !== this.adding) this.pick = 1;
    this.adding = adding;
    this.render();
  }

  private choose(n: number): void {
    this.pick = Math.min(MOST_SEATS, Math.max(1, n));
    this.render();
  }

  /** The world said how many seats this device's key has. */
  learnSeats(n: number): void {
    if (n === this.seats) return;
    this.seats = n;
    this.render();
  }

  /** Learns what the server sells, checks a saved key, and finishes a purchase coming back from Stripe. */
  async init(): Promise<void> {
    try {
      const store = (await (await fetch("/api/store")).json()) as { ready: boolean; live: boolean };
      this.ready = store.ready;
      this.live = store.live;
    } catch {
      // Offline or an old server: no buying for now.
    }
    const params = new URLSearchParams(location.search);
    const paid = params.get("paid");
    // A link from an email opened in a tab already showing SnapFort only changes the part after
    // the #, which does not reload the page: read it then too.
    window.addEventListener("hashchange", () => void this.fromLink().then(() => this.render()));
    if (paid) {
      // Tidy the address, so a reload does not claim again.
      params.delete("paid");
      history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
      await this.claim(paid);
    } else if (await this.fromLink()) {
      // Unlocked (or replaced) from an email link.
    } else if (this.key) {
      this.seats = await this.check(this.key);
      this.owned = this.seats > 0;
      // A key replaced after a leak, or from a test purchase once real payments start: forget it.
      if (!this.owned) this.forget();
    }
    // Nothing saved in this browser (Safari clears what sites store after 7 days unvisited, or
    // the browser was cleaned): the device's year-long cookie may still remember the key.
    if (!this.owned && !this.key) {
      const remembered = await this.checkCookie();
      if (remembered) this.own(remembered.key, remembered.seats);
    }
    this.render();
  }

  /**
   * A link from an email: #key=… (the "Unlock SnapFort on this device" button)
   * or #replace=… (confirming a new key). After the #, so it never reaches a
   * server's logs; wiped from the address at once. True when there was one.
   */
  private async fromLink(): Promise<boolean> {
    const hash = new URLSearchParams(location.hash.slice(1));
    const linkKey = hash.get("key");
    const replace = hash.get("replace");
    if (!linkKey && !replace) return false;
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    if (replace) {
      await this.confirmReplace(replace);
      return true;
    }
    const key = cleanKey(linkKey);
    const seats = key ? await this.check(key) : 0;
    if (key && seats) {
      this.own(key, seats);
      this.onNotice("Unlocked on this device: the Full Game is yours here");
    } else this.onNotice("That link's key no longer works. Ask for a new link in Settings.");
    return true;
  }

  /** "Replace my key": a link goes to the buyer's email; nothing changes until it is tapped. */
  async replace(): Promise<void> {
    if (!this.key) return;
    this.say("Sending…");
    try {
      const response = await fetch("/api/replace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: this.key }) });
      const data = (await response.json()) as { ok?: boolean; to?: string; error?: string };
      if (!data.ok) return this.say(data.error ?? "Could not send the link. Try again in a moment.", true);
      this.say(`We emailed a link to ${data.to}. Tap it to switch to a new key: the old one then stops working everywhere.`);
    } catch {
      this.say("Could not send the link. Check your connection and try again.", true);
    }
  }

  private async confirmReplace(token: string): Promise<void> {
    try {
      const response = await fetch("/api/replace/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const data = (await response.json()) as { key?: string; seats?: number; error?: string };
      if (!data.key) {
        this.onNotice(data.error ?? "That link did not work.");
        if (this.key) {
          this.seats = await this.check(this.key);
          this.owned = this.seats > 0;
        }
        return;
      }
      this.own(data.key, data.seats ?? 1);
      this.onNotice("Done: you have a new key, and the old one no longer works");
    } catch {
      this.onNotice("Could not replace the key. Check your connection and try again.");
    }
  }

  /** The key this device's cookie remembers, if it is still good. */
  private async checkCookie(): Promise<{ key: string; seats: number } | null> {
    try {
      const response = await fetch("/api/key", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = (await response.json()) as { valid?: boolean; key?: string | null; seats?: number };
      return data.valid && data.key ? { key: data.key, seats: data.seats ?? 1 } : null;
    } catch {
      return null;
    }
  }

  /**
   * Off to Stripe's checkout page: for a new key with as many seats as the
   * unlock panel is set to, or (the panel set to adding) that many more seats
   * on this device's key. `own`: a new key for one player, whatever the panel says.
   */
  async buy(own = false): Promise<void> {
    if (!this.canBuy) return;
    const adding = !own && this.adding && this.owned && !!this.key;
    const seats = own ? 1 : this.pick;
    this.say("Opening checkout…");
    for (const id of ["offer-buy", "unlock-buy"]) {
      const button = document.getElementById(id) as HTMLButtonElement;
      button.disabled = true;
      button.textContent = "Opening checkout…";
    }
    try {
      const response = await fetch("/api/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: location.pathname, testpay: this.testpay, seats, ...(adding ? { key: this.key } : {}) }),
      });
      const data = (await response.json()) as { url?: string; error?: string };
      if (!data.url) {
        this.render();
        return this.say(data.error ?? "Checkout is not available right now.", true);
      }
      location.assign(data.url);
    } catch {
      this.render();
      this.say("Could not reach checkout. Check your connection and try again.", true);
    }
  }

  /** A key typed in (bought on another device). */
  async enter(raw: string): Promise<void> {
    const key = cleanKey(raw);
    if (!key) return this.say("That does not look like a SnapFort key (SNAP-XXXX-XXXX-XXXX).", true);
    if (this.owned && key === this.key) return this.say("This device already uses that key.");
    this.say("Checking…");
    const seats = await this.check(key);
    if (!seats) return this.say("That key is not valid. Check it and try again.", true);
    const switched = this.owned;
    this.own(key, seats);
    this.showEnter(false);
    this.say(switched ? "Switched: this device now uses that key." : "Unlocked on this device.");
  }

  /** "Lost your key?": the key goes to the email it was bought with (never shown here). */
  async lost(email: string): Promise<void> {
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return this.say("Type the email address you paid with.", true);
    this.say("Sending…");
    try {
      const response = await fetch("/api/lost", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: address }) });
      if (!response.ok) return this.say(((await response.json()) as { error?: string }).error ?? "Could not send it. Try again in a moment.", true);
      this.showLost(false);
      this.say("If that email bought the Full Game, a link is on its way: open it on this device and tap the button. (Check spam too.)");
    } catch {
      this.say("Could not send it. Check your connection and try again.", true);
    }
  }

  private async claim(session: string): Promise<void> {
    try {
      const data = (await (await fetch(`/api/claim?session=${encodeURIComponent(session)}`)).json()) as { status?: string; key?: string; seats?: number; added?: boolean; error?: string; emailed?: boolean };
      if (data.status === "paid" && data.key) {
        const seats = data.seats ?? 1;
        // Bought while using someone else's key: this device moves to the new one.
        document.getElementById("thanks-switched")!.hidden = !this.key || this.key === data.key;
        document.getElementById("thanks-title")!.textContent = data.added
          ? `Thanks! Your key now has ${seatsText(seats)}.`
          : seats > 1
            ? `Thanks! The Full Game is yours, for ${seats} players.`
            : "Thanks! The Full Game is yours.";
        const together = document.getElementById("thanks-seats")!;
        together.hidden = seats < 2;
        together.textContent = data.added ? "A new player unlocks their device with this same key." : `All ${seats} of you play with this same key, each on your own device.`;
        this.own(data.key, seats);
        document.getElementById("thanks-emailed")!.hidden = !data.emailed;
        document.getElementById("thanks-key")!.textContent = data.key;
        document.getElementById("thanks")!.hidden = false;
        return;
      }
      this.say(data.status === "unpaid" ? "Your payment has not gone through yet. Reload in a moment." : (data.error ?? "Could not finish the purchase."), true);
    } catch {
      this.say("Could not finish the purchase. Reload to try again.", true);
    }
  }

  /** The seats of a key that is good here; 0 when it is not. */
  private async check(key: string): Promise<number> {
    try {
      const response = await fetch("/api/key", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
      const data = (await response.json()) as { valid?: boolean; seats?: number };
      return data.valid === true ? (data.seats ?? 1) : 0;
    } catch {
      // Offline: trust a saved key for now (the world checks it again on joining).
      return key === this.key ? Math.max(1, this.seats) : 0;
    }
  }

  private own(key: string, seats: number): void {
    this.key = key;
    this.owned = true;
    this.seats = seats;
    localStorage.setItem(KEY, key);
    this.render();
    this.onOwned(key);
  }

  private forget(): void {
    this.key = null;
    localStorage.removeItem(KEY);
  }

  private async copy(id: string): Promise<void> {
    if (!this.key) return;
    try {
      await navigator.clipboard.writeText(this.key);
      const button = document.getElementById(id)!;
      button.textContent = "Copied";
      setTimeout(() => (button.textContent = "Copy"), 1500);
    } catch {
      // No clipboard (an old browser): the key is on screen to copy by hand.
    }
  }

  showEnter(on: boolean): void {
    this.row.classList.remove("losing");
    this.row.classList.toggle("entering", on);
    if (on) this.input.focus();
    else this.input.value = "";
  }

  private showLost(on: boolean): void {
    this.row.classList.remove("entering");
    this.row.classList.toggle("losing", on);
    const email = document.getElementById("store-lost-email") as HTMLInputElement;
    if (on) email.focus();
    else email.value = "";
  }

  private say(text: string, bad = false): void {
    this.message.textContent = text;
    this.message.classList.toggle("bad", bad);
    this.message.hidden = !text;
  }

  /** Shows owned (with the key), Unlock, or "opens soon". */
  render(): void {
    document.getElementById("store-owned")!.hidden = !this.owned;
    document.getElementById("store-buy")!.hidden = this.owned || !this.canBuy;
    document.getElementById("store-soon")!.hidden = this.owned || this.canBuy;
    for (const button of document.querySelectorAll<HTMLElement>(".store-own-buy, .store-add-seats")) button.hidden = !this.canBuy;
    document.getElementById("store-key")!.textContent = this.key ?? "";
    const has = this.owned && this.seats > 0 ? seatsText(this.seats) : "";
    document.getElementById("store-seats")!.textContent = has;
    // (On phones the row beside the key has no room: the count goes with "Add seats", in the key box.)
    for (const button of document.querySelectorAll(".store-add-seats.phone-owned")) button.textContent = has ? `${has} · Add seats` : "Add seats";
    document.body.classList.toggle("owned", this.owned);
    // In a paid world, its offer on the menu; and the buttons that buy: ready, or not open yet.
    const here = worldAtPath(location.pathname);
    document.getElementById("paid-offer")!.hidden = this.owned || !here.paid;
    const label = this.canBuy ? null : "Unlocks open soon";
    const adding = this.adding && this.owned;
    const n = this.pick;
    const cost = `$${EACH * n}`;
    const unlock = adding ? `Add ${seatsText(n)} · ${cost}` : n === 1 ? `Unlock · ${cost}` : `Unlock for ${n} players · ${cost}`;
    const offer = n === 1 ? `Unlock the ${here.name} · ${cost}` : `Unlock the ${here.name} for ${n} players · ${cost}`;
    for (const [id, text] of [["offer-buy", offer], ["unlock-buy", unlock]] as const) {
      const button = document.getElementById(id) as HTMLButtonElement;
      button.disabled = !this.canBuy;
      button.textContent = label ?? text;
    }
    // The unlock panel: how many players; or, adding to a key, how many more seats.
    document.getElementById("seats-count")!.textContent = String(n);
    document.getElementById("seats-label")!.textContent = adding ? "Seats to add" : "Players";
    (document.getElementById("seats-less") as HTMLButtonElement).disabled = n <= 1;
    (document.getElementById("seats-more") as HTMLButtonElement).disabled = n >= MOST_SEATS;
    document.getElementById("view-unlock")!.classList.toggle("adding", adding);
    const title = document.getElementById("unlock-title")!;
    if (adding) {
      this.title ??= title.textContent;
      title.textContent = "Add seats to your key";
    } else if (this.title !== null) {
      title.textContent = this.title;
      this.title = null;
    }
    const about = document.getElementById("unlock-add")!;
    about.hidden = !adding;
    about.textContent = `Your key has ${seatsText(this.seats)}: ${this.seats === 1 ? "one player can build at a time" : `${this.seats} players can build at the same time`}. Each seat you add lets one more play with it, on their own device.`;
  }
}
