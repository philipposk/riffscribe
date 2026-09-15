/**
 * The signed-in person's plan and this month's usage, and the few account
 * actions that need the server (billing, deletion).
 */
import { useCallback, useEffect, useState } from "react";

import { supabase, savingConfigured } from "../supabase/client";
import { currentUser, onAuthChange, signOut } from "./charts";

export interface Account {
  plan: string;
  period: string;
  songs: number;
  songs_limit: number;
  assistant: number;
  assistant_limit: number;
  has_billing: boolean;
  renews_at: string | null;
  status: string | null;
}

export type User = { id: string; email?: string };

/** Fired after anything that changes the numbers, so open menus refresh. */
export const ACCOUNT_CHANGED = "riffscribe:account-changed";
export const accountChanged = () => window.dispatchEvent(new Event(ACCOUNT_CHANGED));

export async function getAccount(): Promise<Account | null> {
  const s = supabase();
  if (!s) return null;
  const { data, error } = await s.rpc("riffscribe_account");
  if (error) throw error;
  return (data as Account | null) ?? null;
}

export function useAccount() {
  const [user, setUser] = useState<User | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [ready, setReady] = useState(!savingConfigured);

  useEffect(() => {
    if (!savingConfigured) return;
    void currentUser().then((u) => { setUser(u); setReady(true); });
    return onAuthChange(setUser);
  }, []);

  const refresh = useCallback(async () => {
    if (!user) { setAccount(null); return; }
    try { setAccount(await getAccount()); } catch { /* the menu still works without numbers */ }
  }, [user]);

  useEffect(() => {
    void refresh();
    window.addEventListener(ACCOUNT_CHANGED, refresh);
    return () => window.removeEventListener(ACCOUNT_CHANGED, refresh);
  }, [refresh]);

  return { user, account, ready, refresh };
}

/**
 * Mirror the access token into a cookie scoped to /api. Our own fetches send
 * it as a header, but the assistant widget builds its requests itself, and a
 * same-origin cookie is the one thing it carries along without being asked.
 */
export function syncAuthCookie(): () => void {
  const s = supabase();
  if (!s) return () => {};
  const write = (token: string | null) => {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = token
      ? `rs_at=${encodeURIComponent(token)}; Path=/api; Max-Age=3600; SameSite=Lax${secure}`
      : `rs_at=; Path=/api; Max-Age=0; SameSite=Lax${secure}`;
  };
  void s.auth.getSession().then(({ data }) => write(data.session?.access_token ?? null));
  const { data } = s.auth.onAuthStateChange((_e, session) => write(session?.access_token ?? null));
  return () => data.subscription.unsubscribe();
}

async function authed<T>(path: string, method: string): Promise<T> {
  const s = supabase();
  const token = (await s?.auth.getSession())?.data.session?.access_token;
  const res = await fetch(path, { method, headers: token ? { authorization: `Bearer ${token}` } : {} });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "that did not work");
  return body as T;
}

export async function startCheckout(): Promise<void> {
  const { url } = await authed<{ url: string }>("/api/checkout", "POST");
  location.href = url;
}

export async function openBillingPortal(): Promise<void> {
  const { url } = await authed<{ url: string }>("/api/portal", "POST");
  location.href = url;
}

export async function deleteAccount(): Promise<void> {
  await authed("/api/account", "DELETE");
  await signOut();
}
