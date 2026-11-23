/**
 * The emails SnapFort sends: a buyer's key, right after paying, and again when
 * they ask for it ("Lost your key?"). Sent with Cloudflare Email Service from
 * keys@snapfort.io, branded like the game (cream card, coral and teal, the
 * SnapFort wordmark), with a plain-text copy for mail apps that prefer it.
 * Replies go to the support address.
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

export type KeyMailKind = "bought" | "asked";

/** The subject, HTML and text of a key email. `site` is the address links go to (https://snapfort.io). */
export function keyEmail(keys: readonly string[], kind: KeyMailKind, site: string): { subject: string; html: string; text: string } {
  const one = keys.length === 1;
  const subject = kind === "bought" ? "Your SnapFort key: the Full Game is yours" : "Your SnapFort key";
  const heading = kind === "bought" ? "Thanks! The Full Game is yours." : one ? "Here's your SnapFort key" : "Here are your SnapFort keys";
  const intro =
    kind === "bought"
      ? "You can now build on the Moon, and in every paid world we add. The browser you bought in is already unlocked."
      : "You asked for the SnapFort key bought with this email address. If that wasn't you, you can ignore this email: nobody else can see it.";
  const how = "On another computer, phone or tablet: open SnapFort, go to Settings, choose <b>Have a key?</b> and paste it in.";
  const keep = "Keep this email: it's how you get your key back.";
  const moon = `${site}/moon`;
  const terms = `${site}/terms`;
  const keyBoxes = keys
    .map(
      (k) => `<tr><td align="center" style="padding:6px 0;">
        <div style="display:inline-block;padding:14px 22px;border:2px dashed #2f8f8a;border-radius:14px;background:#ffffff;font:800 24px/1.2 ui-monospace,'SF Mono',Menlo,Consolas,monospace;letter-spacing:1px;color:#1f2a37;">${k}</div>
      </td></tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#fbe9c8;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your key: ${keys.join(", ")}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbe9c8;">
<tr><td align="center" style="padding:28px 14px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff6e4;border-radius:24px;overflow:hidden;box-shadow:0 6px 0 rgba(31,42,55,0.45);font-family:ui-rounded,'SF Pro Rounded','Nunito',system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1f2a37;">
    <tr><td><a href="${site}"><img src="${site}/og-flag.jpg" width="560" alt="A tall tower with a gold flag on top, between two trebuchets" style="display:block;width:100%;height:auto;border:0;"></a></td></tr>
    <tr><td align="center" style="padding:26px 30px 4px;">
      <div style="font-size:36px;font-weight:900;letter-spacing:-0.5px;line-height:1;">Snap<span style="color:#f0765a;">Fort</span><span style="font-size:18px;color:#2f8f8a;font-weight:800;">.io</span></div>
    </td></tr>
    <tr><td align="center" style="padding:14px 30px 0;">
      <div style="font-size:22px;font-weight:800;line-height:1.3;">${heading}</div>
      <p style="margin:10px 0 0;font-size:15px;line-height:1.55;font-weight:600;color:#4a5562;">${intro}</p>
    </td></tr>
    <tr><td align="center" style="padding:20px 30px 4px;">
      <div style="font-size:12px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#2f8f8a;">${one ? "Your key" : "Your keys"}</div>
    </td></tr>
    <tr><td align="center" style="padding:0 30px;"><table role="presentation" cellpadding="0" cellspacing="0">${keyBoxes}</table></td></tr>
    <tr><td align="center" style="padding:16px 34px 0;">
      <p style="margin:0;font-size:14px;line-height:1.55;font-weight:600;color:#4a5562;">${how}</p>
    </td></tr>
    <tr><td align="center" style="padding:22px 30px 6px;">
      <a href="${moon}" style="display:inline-block;padding:14px 28px;border-radius:14px;background:#f0765a;color:#ffffff;font-size:17px;font-weight:800;text-decoration:none;box-shadow:0 4px 0 #c95a41;">Build on the Moon</a>
    </td></tr>
    <tr><td align="center" style="padding:14px 30px 24px;">
      <p style="margin:0;font-size:13px;font-weight:700;color:#1f2a37;">${keep}</p>
    </td></tr>
    <tr><td style="padding:16px 30px 22px;background:#f6e3bf;" align="center">
      <p style="margin:0;font-size:12px;line-height:1.6;color:#6a6255;">SnapFort is a game by Web Plant Media LLC.<br>
      Questions or a refund? Just reply, or write to <a href="mailto:${SUPPORT}" style="color:#2f8f8a;font-weight:700;">${SUPPORT}</a>.<br>
      <a href="${terms}" style="color:#2f8f8a;font-weight:700;">Terms, refunds and privacy</a></p>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;

  const text = [
    "SnapFort.io",
    "",
    heading,
    "",
    intro,
    "",
    `${one ? "Your key" : "Your keys"}: ${keys.join(", ")}`,
    "",
    how.replace(/<\/?b>/g, ""),
    "",
    `Build on the Moon: ${moon}`,
    "",
    keep,
    "",
    "SnapFort is a game by Web Plant Media LLC.",
    `Questions or a refund? Just reply, or write to ${SUPPORT}.`,
    `Terms, refunds and privacy: ${terms}`,
  ].join("\n");

  return { subject, html, text };
}

/** Sends a key email; false (and a line in the log) when it could not go. */
export async function sendKeyEmail(mail: MailBinding | undefined, to: string, keys: readonly string[], kind: KeyMailKind, site: string): Promise<boolean> {
  if (!mail || keys.length === 0) return false;
  const { subject, html, text } = keyEmail(keys, kind, site);
  try {
    await mail.send({ to, from: MAIL_FROM, replyTo: { email: SUPPORT, name: "SnapFort support" }, subject, html, text });
    return true;
  } catch (error) {
    const code = (error as { code?: string }).code ?? "";
    console.error(`Key email to a buyer failed ${code}`, error);
    return false;
  }
}

/** A plausible email address (the real check is whether a purchase used it). */
export const looksLikeEmail = (value: unknown): value is string => typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
