import { betterAuth } from "better-auth";
import Database from "better-sqlite3";
import { join } from "path";
import type { IncomingMessage } from "http";

const AUTH_DISABLED = process.env.AUTH_DISABLED === "1";
const ALLOWED_USERS = process.env.ALLOWED_GITHUB_USERS
  ? process.env.ALLOWED_GITHUB_USERS.split(",").map((u) => u.trim().toLowerCase())
  : null;

const LOCAL_USER = { userId: "local", login: "local", avatar: "" };

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || undefined,
  database: new Database(join(process.cwd(), "data", "auth.db")),
  trustedOrigins: process.env.BETTER_AUTH_TRUSTED_ORIGINS
    ? process.env.BETTER_AUTH_TRUSTED_ORIGINS.split(",").map((o) => o.trim())
    : [],
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID || "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
      mapProfileToUser(profile) {
        return { name: profile.login }; // store GitHub login, not display name
      },
    },
  },
});

/** Convert IncomingMessage headers to a Headers object */
function headersFromIncoming(req: IncomingMessage): Headers {
  const h = new Headers();
  if (req.headers) {
    for (const [key, val] of Object.entries(req.headers)) {
      if (val) h.set(key, Array.isArray(val) ? val.join(", ") : val);
    }
  }
  return h;
}

export interface AuthUser {
  userId: string;
  login: string;
  avatar: string;
}

/** Get authenticated user from a Request (API routes) or IncomingMessage (WebSocket upgrades) */
export async function getAuthUser(
  req: Request | IncomingMessage,
): Promise<AuthUser | null> {
  if (AUTH_DISABLED) return LOCAL_USER;

  const headers =
    req instanceof Request ? req.headers : headersFromIncoming(req);
  const session = await auth.api.getSession({ headers });
  if (!session) return null;

  // Enforce allowlist: reject users not on the list
  if (ALLOWED_USERS && !ALLOWED_USERS.includes(session.user.name.toLowerCase())) {
    return null;
  }

  return {
    userId: session.user.id,
    login: session.user.name,
    avatar: session.user.image || "",
  };
}
