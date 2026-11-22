import type { Env } from "./world";

export { World } from "./world";

/**
 * SnapFort.io on Cloudflare: the game's files are served as static assets; /ws
 * joins the one shared world (the World Durable Object); /admin/* lets the
 * owner reset or roll back the world with the ADMIN_SECRET.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
      return world(env, request).fetch(request);
    }
    if (url.pathname.startsWith("/admin/")) {
      if (!(await isAdmin(request, env))) return new Response("Forbidden", { status: 403 });
      return world(env, request).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

/**
 * The world to join: always "main", except on a local dev server, where
 * ?world=<name> opens a separate one (the browser QA uses a fresh world per run).
 */
function world(env: Env, request: Request) {
  const url = new URL(request.url);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const name = url.searchParams.get("world");
  const id = local && name && /^[a-z0-9-]{1,40}$/.test(name) ? `test-${name}` : "main";
  return env.WORLD.get(env.WORLD.idFromName(id));
}

async function isAdmin(request: Request, env: Env): Promise<boolean> {
  const secret = env.ADMIN_SECRET;
  const given = request.headers.get("x-admin-secret");
  if (!secret || !given) return false;
  // Compare digests in constant time, so the secret cannot be guessed one character at a time.
  const digest = async (s: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  const [a, b] = await Promise.all([digest(secret), digest(given)]);
  return crypto.subtle.timingSafeEqual(a, b);
}
