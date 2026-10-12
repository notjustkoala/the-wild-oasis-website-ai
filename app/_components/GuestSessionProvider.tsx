"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { guestSessionSchema, type GuestUser } from "../_lib/guest-read-schema";

type GuestSession = { user: GuestUser; status: "loading" | "ready" | "error"; retry: () => void };
const GuestSessionContext = createContext<GuestSession | null>(null);

export default function GuestSessionProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [attempt, setAttempt] = useState(0);
  const [session, setSession] = useState<Omit<GuestSession, "retry">>({ user: null, status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    setSession({ user: null, status: "loading" });
    const deadline = window.setTimeout(() => {
      setSession({ user: null, status: "error" });
      controller.abort();
    }, 15_000);
    async function load() {
      try {
        const response = await fetch("/api/guest/session", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
        if (!response.ok) throw new Error("Unavailable");
        const result = guestSessionSchema.parse(await response.json());
        if (!controller.signal.aborted) setSession({ user: result.user, status: "ready" });
      } catch {
        if (!controller.signal.aborted) setSession({ user: null, status: "error" });
      } finally {
        window.clearTimeout(deadline);
      }
    }
    void load();
    return () => { window.clearTimeout(deadline); controller.abort(); };
  }, [pathname, attempt]);
  useEffect(() => {
    const refresh = () => setAttempt(value => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  return <GuestSessionContext.Provider value={{ ...session, retry: () => setAttempt(value => value + 1) }}>
    {children}
  </GuestSessionContext.Provider>;
}

export function useGuestSession() {
  const session = useContext(GuestSessionContext);
  if (!session) throw new Error("Guest session must be used inside its provider.");
  return session;
}
