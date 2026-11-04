import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";

import { auth, db } from "../firebase/config";

export type NotificationAudience = "customer" | "staff";

export type NotificationEvent = {
  id: string;
  orderId: string;
  timestamp: number;
};

export type FirestoreNotificationRecord = NotificationEvent & {
  audience: NotificationAudience;
};

type RecordMap = Record<string, FirestoreNotificationRecord>;
type DeletedMap = Record<string, boolean>;

function documentId(audience: NotificationAudience, id: string): string {
  return `${audience}_${encodeURIComponent(id)}`;
}

function recordReference(uid: string, audience: NotificationAudience, id: string) {
  return doc(db, "notificationRecords", uid, "items", documentId(audience, id));
}

function deletedReference(uid: string, audience: NotificationAudience, id: string) {
  return doc(db, "notificationRecords", uid, "deleted", documentId(audience, id));
}

function assertSession(uid: string) {
  if (!uid || auth.currentUser?.uid !== uid) {
    throw new Error("Your session changed. Please sign in again.");
  }
}

function assertValidId(id: string) {
  if (!id || id.includes("/") || id === "." || id === "..") {
    throw new Error("Invalid notification selected.");
  }
}

function describeError(reason: unknown): string {
  if (reason && typeof reason === "object" && "code" in reason) {
    if (String(reason.code) === "permission-denied") {
      return "Firestore denied notification access. Verify the published notificationRecords rules.";
    }
  }
  return reason instanceof Error ? reason.message : "Notification synchronization failed.";
}

async function ensureRecord(
  uid: string,
  audience: NotificationAudience,
  event: NotificationEvent
): Promise<void> {
  assertSession(uid);
  assertValidId(event.id);
  const itemRef = recordReference(uid, audience, event.id);
  const tombstoneRef = deletedReference(uid, audience, event.id);

  await runTransaction(db, async tx => {
    // All transaction reads must precede any writes.
    const deleted = await tx.get(tombstoneRef);
    const existing = await tx.get(itemRef);
    if (deleted.exists() || existing.exists()) return;

    tx.set(itemRef, {
      id: event.id,
      orderId: event.orderId,
      audience,
      timestamp: Number.isFinite(event.timestamp) && event.timestamp >= 0
        ? event.timestamp : 0,
      createdAt: serverTimestamp(),
    });
  });
}

/**
 * Permanently removes ONE notification document from Firestore.
 * A minimal immutable deletion marker remains so the original order cannot recreate it.
 * The source order and all other notifications are untouched.
 */
export async function deleteNotificationRecord(
  uid: string,
  audience: NotificationAudience,
  notificationId: string
): Promise<void> {
  assertSession(uid);
  assertValidId(notificationId);
  const itemRef = recordReference(uid, audience, notificationId);
  const tombstoneRef = deletedReference(uid, audience, notificationId);

  try {
    await runTransaction(db, async tx => {
      const deleted = await tx.get(tombstoneRef);
      const record = await tx.get(itemRef);
      if (!deleted.exists()) {
        tx.set(tombstoneRef, {
          id: notificationId,
          audience,
          deletedAt: serverTimestamp(),
        });
      }
      if (record.exists()) tx.delete(itemRef);
    });
  } catch (reason) {
    throw new Error(describeError(reason));
  }
}

/**
 * Displays genuine order events after deletion markers have loaded.
 * The view does not depend on the record-creation transaction finishing.
 * A Firestore record is still saved for each undeleted event, where permitted.
 */
export function useFirestoreNotificationRecords(
  uid: string,
  audience: NotificationAudience,
  events: NotificationEvent[]
) {
  const [records, setRecords] = useState<RecordMap>({});
  const [deleted, setDeleted] = useState<DeletedMap>({});
  const [recordsReady, setRecordsReady] = useState(false);
  const [deletedReady, setDeletedReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attemptedRef = useRef(new Set<string>());

  useEffect(() => {
    setRecords({});
    setDeleted({});
    setRecordsReady(false);
    setDeletedReady(false);
    setError(null);
    attemptedRef.current.clear();

    if (!uid) return;

    let active = true;
    const unsubRecords = onSnapshot(
      collection(db, "notificationRecords", uid, "items"),
      snapshot => {
        if (!active) return;
        const next: RecordMap = {};
        snapshot.docs.forEach(entry => {
          const data = entry.data();
          if (data.audience !== audience || typeof data.id !== "string") return;
          next[data.id] = {
            id: data.id,
            orderId: String(data.orderId ?? ""),
            audience,
            timestamp: typeof data.timestamp === "number" ? data.timestamp : 0,
          };
        });
        setRecords(next);
        setRecordsReady(true);
      },
      reason => {
        if (!active) return;
        console.warn("SilkMart notification record listener:", reason);
        setError(describeError(reason));
        setRecordsReady(true);
      }
    );

    const unsubDeleted = onSnapshot(
      collection(db, "notificationRecords", uid, "deleted"),
      snapshot => {
        if (!active) return;
        const next: DeletedMap = {};
        snapshot.docs.forEach(entry => {
          const data = entry.data();
          if (data.audience === audience && typeof data.id === "string") {
            next[data.id] = true;
          }
        });
        setDeleted(next);
        setDeletedReady(true);
      },
      reason => {
        if (!active) return;
        console.warn("SilkMart notification deletion listener:", reason);
        setError(describeError(reason));
        // Do not show notifications when we cannot verify permanent deletions.
        setDeletedReady(false);
      }
    );

    return () => {
      active = false;
      unsubRecords();
      unsubDeleted();
    };
  }, [uid, audience]);

  const eventKey = events.map(e => `${e.id}|${e.orderId}|${e.timestamp}`).join(";");
  const uniqueEvents = useMemo(() => {
    const unique = new Map<string, NotificationEvent>();
    for (const event of events) {
      if (event.id && event.orderId) unique.set(event.id, event);
    }
    return [...unique.values()];
  // eventKey changes when any event identity or timestamp changes.
  }, [eventKey]);

  useEffect(() => {
    if (!uid || !recordsReady || !deletedReady || auth.currentUser?.uid !== uid) return;
    for (const event of uniqueEvents) {
      if (deleted[event.id] || records[event.id]) continue;
      const key = `${uid}:${audience}:${event.id}`;
      if (attemptedRef.current.has(key)) continue;
      attemptedRef.current.add(key);
      void ensureRecord(uid, audience, event).catch(reason => {
        console.warn("SilkMart could not save notification", event.id, reason);
        setError(describeError(reason));
        // Avoid uncontrolled retries. A navigation or account change will retry.
      });
    }
  }, [uid, audience, recordsReady, deletedReady, records, deleted, uniqueEvents]);

  const visible = useMemo(() => {
    if (!uid || !deletedReady) return [];
    return uniqueEvents
      .filter(event => !deleted[event.id])
      .map(event => ({ ...event, audience }))
      .sort((a, b) => b.timestamp - a.timestamp || a.id.localeCompare(b.id));
  }, [uid, audience, deletedReady, uniqueEvents, deleted]);

  return {
    visible,
    ready: recordsReady && deletedReady,
    error,
  };
}