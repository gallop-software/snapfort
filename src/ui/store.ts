import { cleanKey } from "../net/keys";

/** Where the key is kept in this browser. */
const KEY = "snapfort.key";
/** Set by visiting with ?testpay: shows the Unlock button while Stripe is still in test mode. */
const TESTPAY = "snapfort.testpay";
export const PRICE = "$7";

/**
 * The Full Game: whether this browser owns it (a SnapFort key, checked with the
 * server), buying it (off to Stripe Checkout and back), and typing in a key
 * bought on another device. Drives the Full Game row in the settings and the
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

  private readonly row = document.getElementById("full-game")!;
  private readonly message = document.getElementById("store-message")!;
  private readonly input = document.getElementById("store-key-input") as HTMLInputElement;

  constructor() {
    const params = new URLSearchParams(location.search);
    if (params.has("testpay")) sessionStorage.setItem(TESTPAY, "1");
    this.testpay = sessionStorage.getItem(TESTPAY) === "1";
    document.getElementById("store-buy-button")!.addEventListener("click", () => void this.buy());
    document.getElementById("store-have-key")!.addEventListener("click", () => this.showEnter(true));
    document.getElementById("store-enter")!.addEventListener("submit", (e) => {
      e.preventDefault();
      void this.enter(this.input.value);
    });
    document.getElementById("store-enter-cancel")!.addEventListener("click", () => this.showEnter(false));
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
    if (paid) {
      // Tidy the address, so a reload does not claim again.
      params.delete("paid");
      history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
      await this.claim(paid);
    } else if (this.key) {
      this.owned = await this.check(this.key);
      // A key from a test purchase stops working once real payments start: forget it quietly.
      if (!this.owned) this.forget();
    }
    this.render();
  }

  /** Off to Stripe's checkout page. */
  async buy(): Promise<void> {
    this.say("Opening checkout…");
    try {
      const response = await fetch("/api/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: location.pathname, testpay: this.testpay }),
      });
      const data = (await response.json()) as { url?: string; error?: string };
      if (!data.url) return this.say(data.error ?? "Checkout is not available right now.", true);
      location.assign(data.url);
    } catch {
      this.say("Could not reach checkout. Check your connection and try again.", true);
    }
  }

  /** A key typed in (bought on another device). */
  async enter(raw: string): Promise<void> {
    const key = cleanKey(raw);
    if (!key) return this.say("That does not look like a SnapFort key (SNAP-XXXX-XXXX-XXXX).", true);
    this.say("Checking…");
    if (!(await this.check(key))) return this.say("That key is not valid. Check it and try again.", true);
    this.own(key);
    this.showEnter(false);
    this.say("Unlocked on this device.");
  }

  private async claim(session: string): Promise<void> {
    try {
      const data = (await (await fetch(`/api/claim?session=${encodeURIComponent(session)}`)).json()) as { status?: string; key?: string; error?: string };
      if (data.status === "paid" && data.key) {
        this.own(data.key);
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

  private showEnter(on: boolean): void {
    this.row.classList.toggle("entering", on);
    if (on) this.input.focus();
    else this.input.value = "";
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
    document.getElementById("store-key")!.textContent = this.key ?? "";
    document.body.classList.toggle("owned", this.owned);
  }
}
