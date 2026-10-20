import { createHmac, randomBytes } from "node:crypto";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Config } from "./config.js";
import { hashToken, safeEqual } from "./tokens.js";

/**
 * Browser sessions for the team dashboard and the admin console.
 *
 * A session is a signed cookie: base64url(JSON payload) + "." + HMAC-SHA256.
 * Nothing is stored server-side except a short in-memory list of sessions that
 * signed out early. The payload carries a fingerprint of the credential it was
 * made from (team key hash / admin token), so rotating a team key, deleting a
 * team or changing ADMIN_TOKEN ends the matching sessions at once.
 *
 * CSRF: every state-changing form or fetch must send a token bound to the
 * session (HMAC of the session id), as a `_csrf` form field or an
 * `X-CSRF-Token` header. Sign-in forms (no session yet) use a double-submit
 * cookie. The cookie is SameSite=Lax and httpOnly; uploaded sites run in a
 * sandbox (opaque origin) and can't read it or ride it on POSTs.
 */
export type Role = "team" | "admin";

export interface Session {
  sid: string;
  role: Role;
  /** Team id (role "team"). */
  teamId?: string;
  /** Member id, when a team member signed in with a password (absent for the team key). */
  memberId?: string;
  /** Fingerprint of the credential the session was made from. */
  fp: string;
  iat: number;
  exp: number;
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");

/** A short fingerprint of a secret (never the secret itself). */
export const fingerprint = (secretOrHash: string) => hashToken(`fp:${secretOrHash}`).slice(0, 16);

export class Sessions {
  readonly cookieName: string;
  readonly csrfCookieName: string;
  private readonly secure: boolean;
  private readonly revoked = new Map<string, number>();

  constructor(
    private readonly config: Config,
    private readonly now: () => number = Date.now,
  ) {
    this.secure = config.publicUrl.startsWith("https://");
    // __Host- cookies must be Secure, Path=/ and have no Domain: they can't be
    // set or shadowed by another subdomain.
    this.cookieName = this.secure ? "__Host-marsa_session" : "marsa_session";
    this.csrfCookieName = this.secure ? "__Host-marsa_login" : "marsa_login";
  }

  private sign(data: string): string {
    return createHmac("sha256", this.config.sessions.secret).update(data).digest("base64url");
  }

  /** Create a session and set its cookie. */
  start(c: Context, role: Role, fp: string, teamId?: string, memberId?: string): Session {
    const ttlHours =
      role === "admin" ? this.config.sessions.adminTtlHours : this.config.sessions.teamTtlHours;
    const iat = this.now();
    const s: Session = {
      sid: randomBytes(16).toString("base64url"),
      role,
      ...(teamId ? { teamId } : {}),
      ...(memberId ? { memberId } : {}),
      fp,
      iat,
      exp: iat + ttlHours * 3600_000,
    };
    const payload = b64(JSON.stringify(s));
    setCookie(c, this.cookieName, `${payload}.${this.sign(payload)}`, {
      path: "/",
      httpOnly: true,
      secure: this.secure,
      sameSite: "Lax",
      maxAge: ttlHours * 3600,
    });
    return s;
  }

  /** The verified session from the request cookie, or null. */
  read(c: Context): Session | null {
    const raw = getCookie(c, this.cookieName);
    if (!raw || raw.length > 2048) return null;
    const dot = raw.lastIndexOf(".");
    if (dot <= 0) return null;
    const payload = raw.slice(0, dot);
    if (!safeEqual(raw.slice(dot + 1), this.sign(payload))) return null;
    let s: Session;
    try {
      s = JSON.parse(unb64(payload)) as Session;
    } catch {
      return null;
    }
    if (!s || typeof s.sid !== "string" || (s.role !== "team" && s.role !== "admin")) return null;
    if (typeof s.exp !== "number" || s.exp <= this.now()) return null;
    if (this.revoked.has(s.sid)) return null;
    return s;
  }

  /** A session cookie is present (valid or not): used to say "your session ended". */
  hasCookie(c: Context): boolean {
    return !!getCookie(c, this.cookieName);
  }

  /** End a session: forget the cookie and refuse its id until it would have expired. */
  end(c: Context, s: Session | null): void {
    if (s) {
      this.revoked.set(s.sid, s.exp);
      const t = this.now();
      if (this.revoked.size > 10_000) {
        for (const [k, exp] of this.revoked) if (exp <= t) this.revoked.delete(k);
      }
    }
    deleteCookie(c, this.cookieName, { path: "/", secure: this.secure });
  }

  /** CSRF token bound to a session. */
  csrfFor(s: Session): string {
    return this.sign(`csrf:${s.sid}`);
  }

  checkCsrf(s: Session, token: string | undefined | null): boolean {
    return !!token && safeEqual(token, this.csrfFor(s));
  }

  /** Double-submit token for sign-in forms (no session yet). Sets the cookie if missing. */
  loginCsrf(c: Context): string {
    let v = getCookie(c, this.csrfCookieName);
    if (!v || !/^[A-Za-z0-9_-]{20,64}$/.test(v)) {
      v = randomBytes(18).toString("base64url");
      setCookie(c, this.csrfCookieName, v, {
        path: "/",
        httpOnly: true,
        secure: this.secure,
        sameSite: "Strict",
        maxAge: 3600,
      });
    }
    return this.sign(`login:${v}`);
  }

  checkLoginCsrf(c: Context, token: string | undefined | null): boolean {
    const v = getCookie(c, this.csrfCookieName);
    return !!v && !!token && safeEqual(token, this.sign(`login:${v}`));
  }
}

/**
 * Same-origin check for form posts: when the browser sends Origin (all modern
 * browsers do on POST), it must be this instance. A second layer on top of the
 * CSRF token.
 */
export function sameOrigin(c: Context, publicUrl: string): boolean {
  const origin = c.req.header("origin");
  const site = c.req.header("sec-fetch-site");
  // "null" is what browsers send under Referrer-Policy: no-referrer, and what a
  // sandboxed (opaque-origin) page sends. Sec-Fetch-Site tells them apart: it is
  // set by the browser and is "same-origin" only for this app's own pages.
  if (!origin || origin === "null") return site ? site === "same-origin" : origin !== "null";
  try {
    const want = new URL(publicUrl).origin;
    const reqOrigin = new URL(c.req.url).origin;
    return origin === want || origin === reqOrigin;
  } catch {
    return false;
  }
}
