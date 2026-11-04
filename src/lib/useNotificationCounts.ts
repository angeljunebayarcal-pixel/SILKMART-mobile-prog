
import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  onAuthStateChanged,
} from "firebase/auth";

import {
  collection,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

import {
  auth,
  db,
} from "../firebase/config";

import {
  useFirestoreNotificationRecords,
  type NotificationEvent,
} from "./notificationRecords";

import {
  useNotificationPreferences,
} from "./notificationPreferences";

import {
  subscribeToOrderChat,
  type OrderChatMessage,
} from "./orderChat";

// =====================================
// TYPES
// =====================================

type Audience = "customer" | "staff";

type OrderForNotifications = {
  id: string;
  status: string;
  deliveryStatus: string;
  confirmedDeliveryDate: string;
  createdAt: number;
  decisionAt: number;
  scheduledAt: number;
  preparingAt: number;
  dispatchedAt: number;
  deliveredAt: number;
};

// =====================================
// TIMESTAMP CONVERSION
// =====================================

function toMillis(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);

    return Number.isFinite(parsed)
      ? parsed
      : 0;
  }

  if (
    value &&
    typeof value === "object"
  ) {
    const item = value as {
      toMillis?: () => number;
      seconds?: number;
    };

    if (
      typeof item.toMillis === "function"
    ) {
      return item.toMillis();
    }

    if (
      typeof item.seconds === "number"
    ) {
      return item.seconds * 1000;
    }
  }

  return 0;
}

// =====================================
// SHARED CHANGE LISTENERS
// =====================================

// Keep this exported function for compatibility
// with existing notification screens.
//
// Firestore listeners automatically update
// read and unread counts when saved data changes.

const listeners = new Set<() => void>();

export function notifySilkMartReadStateChanged(): void {
  listeners.forEach(listener => {
    listener();
  });
}

// =====================================
// GENERATE NOTIFICATION IDS
// =====================================

function notificationIds(
  order: OrderForNotifications
): string[] {
  const ids: string[] = [
    `placed:${order.id}`,
  ];

  // ORDER CONFIRMED

  if (order.status === "Confirmed") {
    ids.push(
      `confirmed:${order.id}`
    );
  }

  // ORDER REJECTED

  if (order.status === "Rejected") {
    ids.push(
      `rejected:${order.id}`
    );

    return ids;
  }

  // DELIVERY SCHEDULED

  if (
    order.confirmedDeliveryDate &&
    order.deliveryStatus !== "Pending"
  ) {
    ids.push(
      `scheduled:${order.id}:${order.confirmedDeliveryDate}`
    );
  }

  // PREPARING

  if (
    [
      "Preparing",
      "Out for Delivery",
      "Delivered",
    ].includes(order.deliveryStatus)
  ) {
    ids.push(
      `preparing:${order.id}`
    );
  }

  // OUT FOR DELIVERY

  if (
    [
      "Out for Delivery",
      "Delivered",
    ].includes(order.deliveryStatus)
  ) {
    ids.push(
      `dispatched:${order.id}`
    );
  }

  // DELIVERED

  if (
    order.deliveryStatus === "Delivered"
  ) {
    ids.push(
      `delivered:${order.id}`
    );
  }

  return ids;
}

// =====================================
// SHARED NOTIFICATION COUNTS
// =====================================

export function useNotificationCounts(
  audience: Audience
) {
  // =====================================
  // AUTHENTICATED USER
  // =====================================

  const [uid, setUid] = useState(
    auth.currentUser?.uid ?? ""
  );

  // =====================================
  // ORDER STATE
  // =====================================

  const [orders, setOrders] = useState<
    OrderForNotifications[]
  >([]);

  // =====================================
  // CHAT STATE
  // =====================================

  const [chats, setChats] = useState<
    Record<string, OrderChatMessage[]>
  >({});

  // =====================================
  // LOADING AND ERRORS
  // =====================================

  const [ordersReady, setOrdersReady] =
    useState(false);

  const [hasError, setHasError] =
    useState(false);

  // =====================================
  // AUTHENTICATION LISTENER
  // =====================================

  useEffect(() => {
    return onAuthStateChanged(
      auth,
      user => {
        setUid(
          user?.uid ?? ""
        );

        setOrders([]);
        setChats({});
        setOrdersReady(false);
        setHasError(false);
      }
    );
  }, []);

  // =====================================
  // FIRESTORE NOTIFICATION PREFERENCES
  // =====================================

  // Both customer and staff now use
  // the same permanent Firestore storage.
  //
  // Customers:
  // notificationPreferences/{uid}
  //   /audiences/customer
  //
  // Admin/Staff:
  // notificationPreferences/{uid}
  //   /audiences/staff

  const preferences =
    useNotificationPreferences(
      uid,
      audience
    );

  const readState =
    preferences.readState;

  const seenMessages =
    preferences.seenMessages;

  const preferencesReady =
    preferences.ready &&
    !preferences.error;

  // =====================================
  // REAL-TIME ORDER LISTENER
  // =====================================

  useEffect(() => {
    setOrders([]);
    setOrdersReady(false);
    setHasError(false);

    if (!uid) {
      setOrdersReady(true);
      return;
    }

    const ordersCollection =
      collection(
        db,
        "orders"
      );

    // Customers can access their own orders.
    // Staff/Admin can access all orders.

    const ordersQuery =
      audience === "customer"
        ? query(
            ordersCollection,
            where(
              "customerUid",
              "==",
              uid
            )
          )
        : ordersCollection;

    let active = true;

    const unsubscribe = onSnapshot(
      ordersQuery,

      snapshot => {
        if (!active) {
          return;
        }

        const records:
          OrderForNotifications[] =
          snapshot.docs.map(record => {
            const data = record.data();

            return {
              id: record.id,

              status: String(
                data.status ?? "Pending"
              ),

              deliveryStatus: String(
                data.deliveryStatus ?? "Pending"
              ),

              confirmedDeliveryDate:
                String(
                  data.confirmedDeliveryDate ??
                    ""
                ),

              createdAt: toMillis(
                data.createdAt
              ),

              decisionAt: toMillis(
                data.decisionAt
              ),

              scheduledAt: toMillis(
                data.scheduledAt
              ),

              preparingAt: toMillis(
                data.preparingAt
              ),

              dispatchedAt: toMillis(
                data.dispatchedAt
              ),

              deliveredAt: toMillis(
                data.deliveredAt
              ),
            };
          });

        setOrders(records);
        setHasError(false);
        setOrdersReady(true);
      },

      error => {
        if (!active) {
          return;
        }

        console.warn(
          "Unable to load notification orders:",
          error
        );

        setOrders([]);
        setHasError(true);
        setOrdersReady(true);
      }
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [
    uid,
    audience,
  ]);

  // =====================================
  // ORDER IDS
  // =====================================

  const orderIdsKey = useMemo(
    () =>
      orders
        .map(order => order.id)
        .sort()
        .join("|"),
    [orders]
  );

  // =====================================
  // REAL-TIME CHAT LISTENERS
  // =====================================

  useEffect(() => {
    setChats({});

    if (
      !uid ||
      !orderIdsKey
    ) {
      return;
    }

    let active = true;

    const unsubscribers =
      orderIdsKey
        .split("|")
        .map(orderId =>
          subscribeToOrderChat(
            orderId,

            messages => {
              if (!active) {
                return;
              }

              setChats(current => ({
                ...current,
                [orderId]: messages,
              }));
            },

            error => {
              if (!active) {
                return;
              }

              console.warn(
                `Unable to load chat for order ${orderId}:`,
                error
              );

              setHasError(true);
            }
          )
        );

    return () => {
      active = false;

      unsubscribers.forEach(
        unsubscribe => {
          unsubscribe();
        }
      );
    };
  }, [
    uid,
    orderIdsKey,
  ]);

  // =====================================
  // BUILD NOTIFICATION EVENTS
  // =====================================

  const notificationEvents = useMemo<
    NotificationEvent[]
  >(
    () =>
      orders.flatMap(order =>
        notificationIds(order).map(id => {
          let timestamp =
            order.createdAt;

          if (
            id.startsWith("delivered:")
          ) {
            timestamp =
              order.deliveredAt;
          } else if (
            id.startsWith("dispatched:")
          ) {
            timestamp =
              order.dispatchedAt;
          } else if (
            id.startsWith("preparing:")
          ) {
            timestamp =
              order.preparingAt;
          } else if (
            id.startsWith("scheduled:")
          ) {
            timestamp =
              order.scheduledAt;
          } else if (
            id.startsWith("confirmed:") ||
            id.startsWith("rejected:")
          ) {
            timestamp =
              order.decisionAt;
          }

          return {
            id,
            orderId: order.id,
            timestamp:
              timestamp ||
              order.createdAt,
          };
        })
      ),
    [orders]
  );

  // =====================================
  // FIRESTORE NOTIFICATION RECORDS
  // =====================================

  // Retains permanent notification deletion
  // markers from your existing system.

  const {
    visible: savedNotifications,
    ready: notificationRecordsReady,
    error: notificationRecordsError,
  } = useFirestoreNotificationRecords(
    uid,
    audience,
    notificationEvents
  );

  // =====================================
  // COUNT UNREAD ORDER NOTIFICATIONS
  // =====================================

  const unreadOrders = useMemo(
    () =>
      savedNotifications.filter(
        item => !readState[item.id]
      ).length,

    [
      savedNotifications,
      readState,
    ]
  );

  // =====================================
  // COUNT UNREAD CHAT MESSAGES
  // =====================================

  const unreadChats = useMemo(() => {
    let total = 0;

    // Staff receives customer messages.
    // Customers receive staff messages.

    const incomingRole =
      audience === "staff"
        ? "customer"
        : "staff";

    for (const order of orders) {
      const seen = new Set(
        seenMessages[order.id] ?? []
      );

      const messages =
        chats[order.id] ?? [];

      for (const message of messages) {
        if (
          message.senderRole ===
            incomingRole &&
          message.senderUid !== uid &&
          !seen.has(message.id)
        ) {
          total += 1;
        }
      }
    }

    return total;
  }, [
    orders,
    chats,
    seenMessages,
    uid,
    audience,
  ]);

  // =====================================
  // LOADING STATE
  // =====================================

  const ready =
    ordersReady &&
    preferencesReady &&
    notificationRecordsReady;

  // =====================================
  // RETURN COUNTS
  // =====================================

  return {
    unreadOrders:
      ready
        ? unreadOrders
        : 0,

    unreadChats:
      ready
        ? unreadChats
        : 0,

    totalUnread:
      ready
        ? unreadOrders +
          unreadChats
        : 0,

    ready,

    hasError:
      hasError ||
      !!preferences.error ||
      !!notificationRecordsError,
  };
}
