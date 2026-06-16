import { scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { cookies } from "next/headers";
import { db } from "./fantasy-db";
import { getMainDb } from "./main-db";

const scryptAsync = promisify(scrypt);

const SESSION_COOKIE = "fantasy_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type MainUser = {
  id: string;
  email: string;
  role: string;
  player_id: string | null;
  account_status: string;
  display_name: string | null;
  gender: string | null;
};

export async function verifyPassword(
  plain: string,
  stored: string
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;

  const [, salt, hashHex] = parts;
  const storedHash = Buffer.from(hashHex, "hex");
  const keylen = storedHash.length;

  try {
    // salt is passed as the raw hex string (not decoded), matching how it was hashed
    const derived = (await scryptAsync(plain, salt, keylen)) as Buffer;
    return timingSafeEqual(derived, storedHash);
  } catch {
    return false;
  }
}

export async function getUserByEmail(email: string): Promise<MainUser | null> {
  const pool = getMainDb();
  const res = await pool.query<MainUser>(
    `SELECT u.id, u.email, u.role, u.player_id, u.account_status,
            p.display_name, p.gender
     FROM users u
     LEFT JOIN players p ON p.id = u.player_id
     WHERE u.email = $1`,
    [email]
  );
  return res.rows[0] ?? null;
}

export async function getUserPasswordHash(email: string): Promise<string | null> {
  const pool = getMainDb();
  const res = await pool.query<{ password_hash: string }>(
    "SELECT password_hash FROM users WHERE email = $1",
    [email]
  );
  return res.rows[0]?.password_hash ?? null;
}

export async function createSession(memberUserId: string, teamName?: string) {
  let fantasyUser = await db.fantasyUser.findUnique({
    where: { memberUserId },
  });

  if (!fantasyUser) {
    fantasyUser = await db.fantasyUser.create({
      data: {
        memberUserId,
        teamName: teamName ?? "My Fantasy Team",
      },
    });
  }

  const token = crypto.randomUUID() + "-" + crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.fantasySession.create({
    data: {
      fantasyUserId: fantasyUser.id,
      sessionToken: token,
      expiresAt,
    },
  });

  return { token, expiresAt, fantasyUserId: fantasyUser.id };
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export type Session = {
  fantasyUserId: string;
  memberUserId: string;
};

export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await db.fantasySession.findUnique({
    where: { sessionToken: token },
    include: { user: true },
  });

  if (!session || session.expiresAt < new Date()) return null;

  return {
    fantasyUserId: session.fantasyUserId,
    memberUserId: session.user.memberUserId,
  };
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) {
    const { redirect } = await import("next/navigation");
    redirect("/login");
    throw new Error("unreachable");
  }
  return session;
}

export async function deleteSession(token: string) {
  await db.fantasySession.deleteMany({ where: { sessionToken: token } });
}

export async function getCurrentSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE)?.value ?? null;
}
