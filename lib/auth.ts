import { betterAuth } from "better-auth";
import Database from "better-sqlite3";
import { join } from "path";
import type { IncomingMessage } from "http";

const AUTH_DISABLED = process.env.AUTH_DISABLED === "1";
const ALLOWED_USERS = process.env.ALLOWED_GITHUB_USERS
  ? process.env.ALLOWED_GITHUB_USERS.split(",").map((u) => u.trim().toLowerCase())
  : null;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";

/** Which auth methods are enabled. Defaults to "credentials" (email/password only). */
const AUTH_METHODS = (process.env.AUTH_METHODS || "credentials")
  .split(",")
  .map((m) => m.trim().toLowerCase());

const LOCAL_USER = { userId: "local", login: "local", avatar: "" };

const hasGitHub = AUTH_METHODS.includes("github") &&
  !!process.env.GITHUB_CLIENT_ID &&
  !!process.env.GITHUB_CLIENT_SECRET;
const hasCredentials = AUTH_METHODS.includes("credentials");

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || undefined,
  database: new Database(join(process.cwd(), "data", "auth.db")),
  trustedOrigins: process.env.BETTER_AUTH_TRUSTED_ORIGINS
    ? process.env.BETTER_AUTH_TRUSTED_ORIGINS.split(",").map((o) => o.trim())
    : [],
  emailAndPassword: {
    enabled: hasCredentials,
    requireEmailVerification: false,
  },
  socialProviders: hasGitHub
    ? {
        github: {
          clientId: process.env.GITHUB_CLIENT_ID || "",
          clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
          mapProfileToUser(profile) {
            return { name: profile.login };
          },
        },
      }
    : {},
});

/** Returns which auth methods are enabled (for the login page) */
export function getEnabledAuthMethods(): { credentials: boolean; github: boolean } {
  return { credentials: hasCredentials, github: hasGitHub };
}

/** The configured admin email — used to auto-adopt orphaned data on first login */
export function getAdminEmail(): string {
  return ADMIN_EMAIL;
}

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

const adoptedUsers = new Set<string>();

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

  const userId = session.user.id;

  // Auto-adopt orphaned data for admin user on first request
  if (ADMIN_EMAIL && session.user.email === ADMIN_EMAIL && !adoptedUsers.has(userId)) {
    adoptedUsers.add(userId);
    const { getSessionManager } = await import("./sessions");
    getSessionManager().adoptUnownedResources(userId);
  }

  return {
    userId,
    login: session.user.name,
    avatar: session.user.image || "",
  };
}
