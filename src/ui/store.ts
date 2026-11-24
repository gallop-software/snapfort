import { worldAtPath } from "../worlds";
import { cleanKey } from "../net/keys";

/** Where the key is kept in this browser. */
const KEY = "snapfort.key";
/** Set by visiting with ?testpay: shows the Unlock button while Stripe is still in test mode. */
const TESTPAY = "snapfort.testpay";
export const PRICE = "$7";

/**
 * The Full Game: whether this browser owns it (a SnapFort key, checked with the
 * server), buying it (off to Stripe Checkout and back), and typing in a key
 * bought on another device, or switching to another key (someone sharing a
 * friend's key who then buys their own: any new key replaces the one this
 * device had). Drives the Full Game row in the settings and the
 * thank-you note after buying.
 */
export class Store {
  key: string | null = localStorage.getItem(KEY);
  /** The key is paid for (checked with the server). */
  owned = false;
  /** The server can sell (Stripe set up), and with real money or not. */
  private ready = false;
  private live = false;
  private readonly testpay: boolean;
  /** Called when ownership changes (bought, or a key typed in). */
  onOwned: (key: string) => void = () => {};
  /** "Have a key?" from the menu or the unlock panel: the game opens the settings to type it in. */
  onHaveKey: () => void = () => {};
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
    for (const button of document.querySelectorAll(".store-own-buy")) button.addEventListener("click", () => void this.buy());
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
      this.owned = await this.check(this.key);
      // A key replaced after a leak, or from a test purchase once real payments start: forget it.
      if (!this.owned) this.forget();
    }
    // Nothing saved in this browser (Safari clears what sites store after 7 days unvisited, or
    // the browser was cleaned): the device's year-long cookie may still remember the key.
    if (!this.owned && !this.key) {
      const remembered = await this.checkCookie();
      if (remembered) this.own(remembered);
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
    if (key && (await this.check(key))) {
      this.own(key);
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
      const data = (await response.json()) as { key?: string; error?: string };
      if (!data.key) {
        this.onNotice(data.error ?? "That link did not work.");
        if (this.key) this.owned = await this.check(this.key);
        return;
      }
      this.own(data.key);
      this.onNotice("Done: you have a new key, and the old one no longer works");
    } catch {
      this.onNotice("Could not replace the key. Check your connection and try again.");
    }
  }

  /** The key this device's cookie remembers, if it is still good. */
  private async checkCookie(): Promise<string | null> {
    try {
      const response = await fetch("/api/key", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = (await response.json()) as { valid?: boolean; key?: string | null };
      return data.valid && data.key ? data.key : null;
    } catch {
      return null;
    }
  }

  /** Off to Stripe's checkout page. */
  async buy(): Promise<void> {
    if (!this.canBuy) return;
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
        body: JSON.stringify({ path: location.pathname, testpay: this.testpay }),
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
    if (!(await this.check(key))) return this.say("That key is not valid. Check it and try again.", true);
    const switched = this.owned;
    this.own(key);
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
      const data = (await (await fetch(`/api/claim?session=${encodeURIComponent(session)}`)).json()) as { status?: string; key?: string; error?: string; emailed?: boolean };
      if (data.status === "paid" && data.key) {
        // Bought while using someone else's key: this device moves to the new one.
        document.getElementById("thanks-switched")!.hidden = !this.key || this.key === data.key;
        this.own(data.key);
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

  private async check(key: string): Promise<boolean> {
    try {
      const response = await fetch("/api/key", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
      return ((await response.json()) as { valid?: boolean }).valid === true;
    } catch {
      // Offline: trust a saved key for now (the world checks it again on joining).
      return key === this.key;
    }
  }

  private own(key: string): void {
    this.key = key;
    this.owned = true;
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
    for (const button of document.querySelectorAll<HTMLElement>(".store-own-buy")) button.hidden = !this.canBuy;
    document.getElementById("store-key")!.textContent = this.key ?? "";
    document.body.classList.toggle("owned", this.owned);
    // In a paid world, its offer on the menu; and the buttons that buy: ready, or not open yet.
    const here = worldAtPath(location.pathname);
    document.getElementById("paid-offer")!.hidden = this.owned || !here.paid;
    const label = this.canBuy ? null : "Unlocks open soon";
    for (const [id, text] of [["offer-buy", `Unlock the ${here.name} · ${PRICE}`], ["unlock-buy", `Unlock · ${PRICE}`]] as const) {
      const button = document.getElementById(id) as HTMLButtonElement;
      button.disabled = !this.canBuy;
      button.textContent = label ?? text;
    }
  }
}
