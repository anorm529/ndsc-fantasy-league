"use server";

import { redirect } from "next/navigation";
import {
  getUserByEmail,
  getUserPasswordHash,
  verifyPassword,
  createSession,
  setSessionCookie,
  clearSessionCookie,
  getCurrentSessionToken,
  deleteSession,
} from "./auth";

export type LoginResult = { error?: string };

export async function loginAction(
  _prev: LoginResult,
  formData: FormData
): Promise<LoginResult> {
  const email = formData.get("email")?.toString().trim().toLowerCase() ?? "";
  const password = formData.get("password")?.toString() ?? "";

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const user = await getUserByEmail(email);
  if (!user || user.account_status !== "active") {
    return { error: "Invalid credentials." };
  }

  const hash = await getUserPasswordHash(email);
  if (!hash) return { error: "Invalid credentials." };

  const valid = await verifyPassword(password, hash);
  if (!valid) return { error: "Invalid credentials." };

  const { token, expiresAt } = await createSession(user.id, user.display_name ? `${user.display_name}'s Team` : undefined);
  await setSessionCookie(token, expiresAt);

  redirect("/dashboard");
}

export async function logoutAction() {
  const token = await getCurrentSessionToken();
  if (token) await deleteSession(token);
  await clearSessionCookie();
  redirect("/login");
}
