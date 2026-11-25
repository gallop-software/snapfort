import { DEFAULT_WORLD, FIRST_PAID_WORLD } from "../src/worlds";
/**
 * The emails SnapFort sends: a buyer's key (right after paying, again when
 * they ask for a link, and after replacing a leaked one), and the link that
 * confirms replacing a key. Sent with Cloudflare Email Service from
 * keys@snapfort.io, branded like the game (cream card, coral and teal, the
 * SnapFort wordmark), with a plain-text copy for mail apps that prefer it.
 * Replies go to the support address.
 *
 * Key emails carry a button that unlocks whichever device it is tapped on:
 * the key travels after the # of the address, which browsers never send to a
 * server, and the page wipes it from the address bar at once.
 */

export const MAIL_FROM = { email: "keys@snapfort.io", name: "SnapFort" };
export const SUPPORT = "dev@webplant.media";

/** Just the part of the Email Service binding we use. */
export interface MailBinding {
  send(message: {
    to: string;
    from: { email: string; name: string };
    replyTo?: { email: string; name: string };
    subject: string;
    html: string;
    text: string;
  }): Promise<{ messageId: string }>;
}

/** "given": a key the owner made for someone (no purchase). */
export type KeyMailKind = "bought" | "asked" | "replaced" | "given";

interface Mail {
  subject: string;
  html: string;
  text: string;
}

/** The link that unlocks the device it is opened on. */
export const unlockLink = (site: string, key: string) => `${site}${SHOWN.path === "/" ? "/" : SHOWN.path}#key=${encodeURIComponent(key)}`;

/** The world a key email talks about and its link opens: the first one that needs the Full Game. */
const SHOWN = FIRST_PAID_WORLD ?? DEFAULT_WORLD;

/** A key in an email, with how many can build with it at once. */
export interface MailKey {
  key: string;
  seats: number;
}

/** "3 players at a time" */
const players = (seats: number) => (seats === 1 ? "One player at a time" : `${seats} players at a time`);

/** The subject, HTML and text of a key email. `site` is the address links go to (https://snapfort.io). */
export function keyEmail(owned: readonly MailKey[], kind: KeyMailKind, site: string): Mail {
  const keys = owned.map((k) => k.key);
  const one = keys.length === 1;
  const seats = owned[0]!.seats;
  /** One key for several people (a family): say so, and how the others get in. */
  const shared = one && seats > 1;
  const subject =
    kind === "bought" || kind === "given" ? "Your SnapFort key: the Full Game is yours" : kind === "replaced" ? "Your new SnapFort key" : "Your SnapFort link and key";
  const heading =
    kind === "bought" ? "Thanks! The Full Game is yours." : kind === "given" ? "The Full Game is yours." : kind === "replaced" ? "Here's your new key" : "Here's your link to SnapFort";
  const intro =
    kind === "bought"
      ? shared
        ? `${seats} of you can now build on the ${SHOWN.name} at the same time, and in every paid world we add, all with this one key. The browser you bought in is already unlocked.`
        : `You can now build on the ${SHOWN.name}, and in every paid world we add. The browser you bought in is already unlocked.`
      : kind === "given"
        ? `You've been given the SnapFort Full Game: you can build on the ${SHOWN.name}, and in every paid world we add. Tap the button on the device you play on.`
      : kind === "replaced"
        ? "Your old key no longer works, so nobody who saw it can use it. The device where you confirmed is already unlocked."
        : "You asked for a link to unlock SnapFort with the key bought with this email address. If that wasn't you, you can ignore this email: nobody else can see it.";
  const how = shared
    ? "For everyone else: open this email on their computer, phone or tablet and tap the button (forward it to them if you like). Or open SnapFort there, go to Settings, choose <b>Have a key?</b> and type the key."
    : "On another computer, phone or tablet: open this email there and tap the button. (Or open SnapFort, go to Settings, choose <b>Have a key?</b> and type the key.)";
  const rule = one
    ? seats > 1
      ? `${players(seats)}, each on their own device. Need room for one more? Add a seat in Settings.`
      : "One player at a time. Want to play together? Add a seat in Settings."
    : "Each key lets as many play at once as it has seats.";
  const seatsOf = (k: MailKey) => (one ? "" : ` (${players(k.seats).toLowerCase()})`);
  const keyBoxes = owned
    .map(
      (k) => `<tr><td align="center" style="padding:6px 0;">
        <div style="display:inline-block;padding:12px 20px;border:2px dashed #2f8f8a;border-radius:14px;background:#ffffff;font:800 22px/1.2 ui-monospace,'SF Mono',Menlo,Consolas,monospace;letter-spacing:1px;color:#1f2a37;">${k.key}</div>${one ? "" : `<div style="margin-top:4px;font-size:12px;font-weight:700;color:#4a5562;">${players(k.seats)}</div>`}
      </td></tr>`,
    )
    .join("");
  const body = `
    <tr><td align="center" style="padding:22px 30px 6px;">
      ${button(unlockLink(site, keys[0]!), "Unlock SnapFort on this device")}
    </td></tr>
    <tr><td align="center" style="padding:10px 34px 0;">
      <p style="margin:0;font-size:14px;line-height:1.55;font-weight:600;color:#4a5562;">${how}</p>
    </td></tr>
    <tr><td align="center" style="padding:18px 30px 4px;">
      <div style="font-size:12px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#2f8f8a;">${one ? "Your key" : "Your keys"}</div>
    </td></tr>
    <tr><td align="center" style="padding:0 30px;"><table role="presentation" cellpadding="0" cellspacing="0">${keyBoxes}</table></td></tr>
    <tr><td align="center" style="padding:14px 34px 22px;">
      <p style="margin:0;font-size:13px;line-height:1.5;font-weight:700;color:#1f2a37;">${rule}<br>Keep this email: it's how you get back in.</p>
    </td></tr>`;
  const text = [
    "SnapFort.io",
    "",
    heading,
    "",
    intro,
    "",
    `Unlock SnapFort on this device: ${unlockLink(site, keys[0]!)}`,
    "",
    how.replace(/<\/?b>/g, ""),
    "",
    `${one ? "Your key" : "Your keys"}: ${owned.map((k) => `${k.key}${seatsOf(k)}`).join(", ")}`,
    "",
    rule,
    "Keep this email: it's how you get back in.",
    "",
    ...footerText(site),
  ].join("\n");
  return { subject, html: layout(subject, heading, intro, body, site, `Your key: ${keys.join(", ")}`), text };
}

/** The email after seats were added to a key: how many it has now, and how the new players get in. */
export function seatsEmail(key: string, added: number, seats: number, site: string): Mail {
  const subject = added === 1 ? "A seat was added to your SnapFort key" : `${added} seats were added to your SnapFort key`;
  const heading = `Your key now has ${seats} seats`;
  const intro = `Thanks! ${seats} players can now build with your key at the same time, each on their own device. Nothing changes for the devices already using it.`;
  const how = "For a new player: open this email on their computer, phone or tablet and tap the button. (Or open SnapFort there, go to Settings, choose <b>Have a key?</b> and type the key.)";
  const body = `
    <tr><td align="center" style="padding:22px 30px 6px;">
      ${button(unlockLink(site, key), "Unlock SnapFort on this device")}
    </td></tr>
    <tr><td align="center" style="padding:10px 34px 0;">
      <p style="margin:0;font-size:14px;line-height:1.55;font-weight:600;color:#4a5562;">${how}</p>
    </td></tr>
    <tr><td align="center" style="padding:18px 30px 4px;">
      <div style="font-size:12px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#2f8f8a;">Your key</div>
    </td></tr>
    <tr><td align="center" style="padding:6px 30px 22px;">
      <div style="display:inline-block;padding:12px 20px;border:2px dashed #2f8f8a;border-radius:14px;background:#ffffff;font:800 22px/1.2 ui-monospace,'SF Mono',Menlo,Consolas,monospace;letter-spacing:1px;color:#1f2a37;">${key}</div>
    </td></tr>`;
  const text = ["SnapFort.io", "", heading, "", intro, "", `Unlock SnapFort on this device: ${unlockLink(site, key)}`, "", how.replace(/<\/?b>/g, ""), "", `Your key: ${key}`, "", ...footerText(site)].join("\n");
  return { subject, html: layout(subject, heading, intro, body, site, `Your key now has ${seats} seats`), text };
}

/** The email confirming a key replacement: nothing changes until the buyer taps its button. */
export function replaceEmail(link: string, site: string): Mail {
  const subject = "Replace your SnapFort key?";
  const heading = "Replace your SnapFort key?";
  const intro =
    "Someone (hopefully you) asked to replace the SnapFort key bought with this email, for example because it was shared or leaked. The old key will stop working everywhere, and you'll get a new one.";
  const body = `
    <tr><td align="center" style="padding:22px 30px 6px;">
      ${button(link, "Yes, replace my key")}
    </td></tr>
    <tr><td align="center" style="padding:12px 34px 24px;">
      <p style="margin:0;font-size:13px;line-height:1.55;font-weight:600;color:#4a5562;">The link works once, for an hour, and unlocks the device you open it on with the new key. If you didn't ask for this, ignore this email: your key keeps working.</p>
    </td></tr>`;
  const text = [
    "SnapFort.io",
    "",
    heading,
    "",
    intro,
    "",
    `Yes, replace my key: ${link}`,
    "",
    "The link works once, for an hour, and unlocks the device you open it on with the new key. If you didn't ask for this, ignore this email: your key keeps working.",
    "",
    ...footerText(site),
  ].join("\n");
  return { subject, html: layout(subject, heading, intro, body, site, "Confirm replacing your SnapFort key"), text };
}

function button(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;padding:15px 30px;border-radius:14px;background:#f0765a;color:#ffffff;font-size:17px;font-weight:800;text-decoration:none;box-shadow:0 4px 0 #c95a41;">${label}</a>`;
}

function footerText(site: string): string[] {
  return ["SnapFort is a game by Web Plant Media LLC.", `Questions or a refund? Just reply, or write to ${SUPPORT}.`, `Terms, refunds and privacy: ${site}/terms`];
}

/** The branded frame every email shares: the picture, the wordmark, a heading, the body, the footer. */
function layout(subject: string, heading: string, intro: string, body: string, site: string, preview: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#fbe9c8;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preview}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbe9c8;">
<tr><td align="center" style="padding:28px 14px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff6e4;border-radius:24px;overflow:hidden;box-shadow:0 6px 0 rgba(31,42,55,0.45);font-family:ui-rounded,'SF Pro Rounded','Nunito',system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1f2a37;">
    <tr><td><a href="${site}"><img src="https://cdn.snapfort.io/og.jpg" width="560" alt="A castle with trebuchets before its gate, and a Starship lifting off behind" style="display:block;width:100%;height:auto;border:0;"></a></td></tr>
    <tr><td align="center" style="padding:26px 30px 4px;">
      <div style="font-size:36px;font-weight:900;letter-spacing:-0.5px;line-height:1;">Snap<span style="color:#f0765a;">Fort</span><span style="font-size:18px;color:#2f8f8a;font-weight:800;">.io</span></div>
    </td></tr>
    <tr><td align="center" style="padding:14px 30px 0;">
      <div style="font-size:22px;font-weight:800;line-height:1.3;">${heading}</div>
      <p style="margin:10px 0 0;font-size:15px;line-height:1.55;font-weight:600;color:#4a5562;">${intro}</p>
    </td></tr>
    ${body}
    <tr><td style="padding:16px 30px 22px;background:#f6e3bf;" align="center">
      <p style="margin:0;font-size:12px;line-height:1.6;color:#6a6255;">SnapFort is a game by Web Plant Media LLC.<br>
      Questions or a refund? Just reply, or write to <a href="mailto:${SUPPORT}" style="color:#2f8f8a;font-weight:700;">${SUPPORT}</a>.<br>
      <a href="${site}/terms" style="color:#2f8f8a;font-weight:700;">Terms, refunds and privacy</a></p>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;
}

async function sendMail(mail: MailBinding | undefined, to: string, message: Mail, what: string): Promise<boolean> {
  if (!mail) return false;
  try {
    await mail.send({ to, from: MAIL_FROM, replyTo: { email: SUPPORT, name: "SnapFort support" }, ...message });
    return true;
  } catch (error) {
    const code = (error as { code?: string }).code ?? "";
    console.error(`${what} email failed ${code}`, error);
    return false;
  }
}

/** Sends a key email; false (and a line in the log) when it could not go. */
export function sendKeyEmail(mail: MailBinding | undefined, to: string, keys: readonly MailKey[], kind: KeyMailKind, site: string): Promise<boolean> {
  if (keys.length === 0) return Promise.resolve(false);
  return sendMail(mail, to, keyEmail(keys, kind, site), "Key");
}

/** Sends the note that seats were added to a key. */
export function sendSeatsEmail(mail: MailBinding | undefined, to: string, key: string, added: number, seats: number, site: string): Promise<boolean> {
  return sendMail(mail, to, seatsEmail(key, added, seats, site), "Seats");
}

/** Sends the link that confirms replacing a key. */
export function sendReplaceEmail(mail: MailBinding | undefined, to: string, link: string, site: string): Promise<boolean> {
  return sendMail(mail, to, replaceEmail(link, site), "Replace");
}

/** An address shown without giving it away: c***@gmail.com. */
export function maskEmail(email: string): string {
  const [name = "", domain = ""] = email.split("@");
  return `${name.slice(0, 1)}***@${domain}`;
}

/** A plausible email address (the real check is whether a purchase used it). */
export const looksLikeEmail = (value: unknown): value is string => typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
