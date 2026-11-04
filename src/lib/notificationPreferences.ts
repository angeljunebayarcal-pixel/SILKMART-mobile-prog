import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { doc, onSnapshot, runTransaction, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../firebase/config";

type Audience = "customer" | "staff";
export type ReadState = Record<string, boolean>;
export type SeenMessages = Record<string, string[]>;

type Preferences = {
  readState: ReadState;
  seenMessages: SeenMessages;
};

const empty = (): Preferences => ({ readState: {}, seenMessages: {} });
const refFor = (uid: string, audience: Audience) =>
  doc(db, "notificationPreferences", uid, "audiences", audience);

function requireSession(uid: string) {
  if (!uid || auth.currentUser?.uid !== uid) {
    throw new Error("Please sign in again to save notification preferences.");
  }
}

function safeRead(input: unknown): ReadState {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input).filter(
    ([key, value]) => key.length > 0 && value === true
  ));
}
function safeSeen(input: unknown): SeenMessages {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input)
    .filter(([key, value]) => key.length > 0 && Array.isArray(value))
    .map(([key, value]) => [key, (value as unknown[]).filter(
      (id): id is string => typeof id === "string" && id.length > 0
    )]));
}
function parse(raw: string | null): unknown {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

async function migrateLocal(uid: string, audience: Audience) {
  requireSession(uid);
  const prefix = audience === "staff" ? "staff-" : "";
  const [readRaw, seenRaw] = await Promise.all([
    AsyncStorage.getItem(`silkmart:${prefix}notifications-read:${uid}`),
    AsyncStorage.getItem(`silkmart:${prefix}chat-seen:${uid}`),
  ]);
  requireSession(uid);
  const readState = safeRead(parse(readRaw));
  const seenMessages = safeSeen(parse(seenRaw));
  await runTransaction(db, async tx => {
    const ref = refFor(uid, audience);
    const snap = await tx.get(ref);
    // Never overwrite an existing cloud state with older browser values.
    if (!snap.exists()) {
      tx.set(ref, { audience, readState, seenMessages, updatedAt: serverTimestamp() });
    }
  });
}

export function useNotificationPreferences(uid: string, audience: Audience) {
  const [preferences, setPreferences] = useState<Preferences>(empty);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setPreferences(empty());
    setReady(false);
    setError("");
    if (!uid) { setReady(true); return; }

    // Firestore state is authoritative on every device and after browser resets.
    const unsubscribe = onSnapshot(refFor(uid, audience), snap => {
      if (!active) return;
      if (snap.exists()) {
        setPreferences({
          readState: safeRead(snap.data().readState),
          seenMessages: safeSeen(snap.data().seenMessages),
        });
        setReady(true);
      } else {
        // Legacy AsyncStorage state is imported only for the first cloud use.
        void migrateLocal(uid, audience).catch(reason => {
          if (!active) return;
          console.warn("Notification preference migration failed:", reason);
          setError(reason instanceof Error ? reason.message : "Unable to migrate read status.");
          setReady(true);
        });
      }
    }, reason => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : "Unable to read notification preferences.");
      setReady(true);
    });
    return () => { active = false; unsubscribe(); };
  }, [uid, audience]);

  return { ...preferences, ready, error };
}

export async function markNotificationsRead(
  uid: string, audience: Audience, notificationIds: string[]
): Promise<void> {
  requireSession(uid);
  const ids = [...new Set(notificationIds.filter(id => typeof id === "string" && id.length > 0))];
  if (!ids.length) return;
  await runTransaction(db, async tx => {
    const ref = refFor(uid, audience);
    const snap = await tx.get(ref);
    const data = snap.exists() ? snap.data() : {};
    const readState = safeRead(data.readState);
    for (const id of ids) readState[id] = true;
    tx.set(ref, {
      audience, readState,
      seenMessages: safeSeen(data.seenMessages),
      updatedAt: serverTimestamp(),
    });
  });
}

export async function markChatMessagesSeen(
  uid: string, audience: Audience, orderId: string, messageIds: string[]
): Promise<void> {
  requireSession(uid);
  const ids = [...new Set(messageIds.filter(id => typeof id === "string" && id.length > 0))];
  if (!orderId || !ids.length) return;
  await runTransaction(db, async tx => {
    const ref = refFor(uid, audience);
    const snap = await tx.get(ref);
    const data = snap.exists() ? snap.data() : {};
    const seenMessages = safeSeen(data.seenMessages);
    seenMessages[orderId] = [...new Set([...(seenMessages[orderId] ?? []), ...ids])];
    tx.set(ref, {
      audience, readState: safeRead(data.readState), seenMessages,
      updatedAt: serverTimestamp(),
    });
  });
}