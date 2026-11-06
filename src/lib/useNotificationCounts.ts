
import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

import { auth, db } from "../firebase/config";

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

type StockRow = Record<string, any>;

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
// CONSTANTS
// =====================================

const COCOON_LOW_STOCK_THRESHOLD = 100;

// =====================================
// HELPERS
// =====================================

function toMillis(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (value && typeof value === "object") {
    const item = value as {
      toMillis?: () => number;
      seconds?: number;
    };

    if (typeof item.toMillis === "function") {
      return item.toMillis();
    }

    if (typeof item.seconds === "number") {
      return item.seconds * 1000;
    }
  }

  return 0;
}

// Keep this export compatible with the
// existing notification screens.

const listeners = new Set<() => void>();

export function notifySilkMartReadStateChanged(): void {
  listeners.forEach(listener => listener());
}

// =====================================
// ORDER NOTIFICATION IDS
// =====================================

function notificationIds(
  order: OrderForNotifications
): string[] {
  const ids: string[] = [
    `placed:${order.id}`,
  ];

  if (order.status === "Confirmed") {
    ids.push(`confirmed:${order.id}`);
  }

  if (order.status === "Rejected") {
    ids.push(`rejected:${order.id}`);
    return ids;
  }

  if (
    order.confirmedDeliveryDate &&
    order.deliveryStatus !== "Pending"
  ) {
    ids.push(
      `scheduled:${order.id}:${order.confirmedDeliveryDate}`
    );
  }

  if (
    [
      "Preparing",
      "Out for Delivery",
      "Delivered",
    ].includes(order.deliveryStatus)
  ) {
    ids.push(`preparing:${order.id}`);
  }

  if (
    [
      "Out for Delivery",
      "Delivered",
    ].includes(order.deliveryStatus)
  ) {
    ids.push(`dispatched:${order.id}`);
  }

  if (order.deliveryStatus === "Delivered") {
    ids.push(`delivered:${order.id}`);
  }

  return ids;
}

// =====================================
// STOCK NOTIFICATION IDS
// =====================================

// The notification IDs must match
// notif-adm-staff.tsx exactly.
//
// Includes:
// 1. Silkworm species
// 2. Product stock
// 3. Individual color variants
// 4. Available good-quality cocoons

function lowStockEventIds(
  products: StockRow[],
  species: StockRow[],
  cocoons: StockRow | null
): string[] {
  const ids: string[] = [];

  const speciesIds = new Set(
    species.map(item => String(item.id))
  );

  function add(
    key: string,
    quantity: number,
    threshold: number,
    updatedAt: unknown
  ) {
    if (
      !Number.isFinite(quantity) ||
      !Number.isFinite(threshold) ||
      quantity > threshold
    ) {
      return;
    }

    const timestamp = toMillis(updatedAt);

    ids.push(
      `lowstock:${key}:${timestamp || Math.floor(quantity)}`
    );
  }

  // =====================================
  // SILKWORM STOCK
  // =====================================

  for (const item of species) {
    add(
      `worm:${item.id}`,
      Number(item.quantity ?? 0),
      Math.max(
        0,
        Number(item.threshold ?? 0)
      ),
      item.updatedAt
    );
  }

  // =====================================
  // PRODUCT AND COLOR-VARIANT STOCK
  // =====================================

  for (const item of products) {
    const category = String(
      item.category ?? ""
    );

    const speciesId = String(
      item.inventorySpeciesId ?? ""
    );

    // Prevent duplicate alerts for
    // silkworms linked to Inventory.

    if (
      category === "Silkworms" &&
      speciesId &&
      speciesIds.has(speciesId)
    ) {
      continue;
    }

    const threshold =
      category === "Silkworms" ? 10 : 100;

    const colors = Array.isArray(item.colorStocks)
      ? item.colorStocks
      : [];

    if (
      category !== "Silkworms" &&
      category !== "Cocoons" &&
      colors.length > 0
    ) {
      for (const color of colors) {
        if (
          !color ||
          typeof color.name !== "string"
        ) {
          continue;
        }

        add(
          `product:${item.id}:color:${color.name}`,
          Number(color.quantity ?? 0),
          threshold,
          item.updatedAt
        );
      }
    } else {
      add(
        `product:${item.id}`,
        Number(item.stock ?? 0),
        threshold,
        item.updatedAt
      );
    }
  }

  // =====================================
  // COCOON INVENTORY LOW-STOCK ALERT
  // =====================================

  // Firestore document:
  // inventory/cocoons
  //
  // Available = Good Quality - Reserved
  //
  // The alert appears when available
  // stock reaches 100 or fewer.
  //
  // This uses the same notification ID
  // as the Admin/Staff Notifications page.

  if (cocoons) {
    const good = Number(
      cocoons.good ?? 0
    );

    const reserved = Number(
      cocoons.reserved ?? 0
    );

    const validCocoonStock =
      Number.isSafeInteger(good) &&
      Number.isSafeInteger(reserved) &&
      good >= 0 &&
      reserved >= 0 &&
      reserved <= good;

    if (validCocoonStock) {
      const available = good - reserved;

      add(
        "cocoon:available",
        available,
        COCOON_LOW_STOCK_THRESHOLD,
        cocoons.updatedAt
      );
    }
  }

  return [...new Set(ids)];
}

// =====================================
// SHARED NOTIFICATION COUNTS HOOK
// =====================================

export function useNotificationCounts(
  audience: Audience
) {
  // =====================================
  // AUTHENTICATION
  // =====================================

  const [uid, setUid] = useState(
    auth.currentUser?.uid ?? ""
  );

  // =====================================
  // ORDER AND CHAT STATES
  // =====================================

  const [orders, setOrders] = useState<
    OrderForNotifications[]
  >([]);

  const [chats, setChats] = useState<
    Record<string, OrderChatMessage[]>
  >({});

  const [ordersReady, setOrdersReady] =
    useState(false);

  const [hasError, setHasError] =
    useState(false);

  // =====================================
  // STOCK STATES
  // =====================================

  const [stockProducts, setStockProducts] =
    useState<StockRow[]>([]);

  const [stockSpecies, setStockSpecies] =
    useState<StockRow[]>([]);

  // New: Cocoon inventory

  const [stockCocoons, setStockCocoons] =
    useState<StockRow | null>(null);

  const [deletedStockIds, setDeletedStockIds] =
    useState<Set<string>>(new Set());

  const [stockReady, setStockReady] =
    useState(false);

  const [deletionsReady, setDeletionsReady] =
    useState(false);

  const [stockError, setStockError] =
    useState(false);

  // =====================================
  // AUTHENTICATION LISTENER
  // =====================================

  useEffect(() => {
    return onAuthStateChanged(
      auth,
      user => {
        setUid(user?.uid ?? "");

        setOrders([]);
        setChats({});

        setOrdersReady(false);
        setHasError(false);

        setStockProducts([]);
        setStockSpecies([]);
        setStockCocoons(null);

        setDeletedStockIds(new Set());

        setStockReady(false);
        setDeletionsReady(false);
        setStockError(false);
      }
    );
  }, []);

  // =====================================
  // NOTIFICATION READ PREFERENCES
  // =====================================

  const preferences = useNotificationPreferences(
    uid,
    audience
  );

  const readState = preferences.readState;

  const seenMessages =
    preferences.seenMessages;

  const preferencesReady =
    preferences.ready &&
    !preferences.error;

  // =====================================
  // REAL-TIME ORDERS
  // =====================================

  useEffect(() => {
    setOrders([]);
    setOrdersReady(false);
    setHasError(false);

    if (!uid) {
      setOrdersReady(true);
      return;
    }

    const ordersCollection = collection(
      db,
      "orders"
    );

    const ordersQuery =
      audience === "customer"
        ? query(
            ordersCollection,
            where("customerUid", "==", uid)
          )
        : ordersCollection;

    let active = true;

    const unsubscribe = onSnapshot(
      ordersQuery,
      snapshot => {
        if (!active) return;

        const records: OrderForNotifications[] =
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

              confirmedDeliveryDate: String(
                data.confirmedDeliveryDate ?? ""
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
        if (!active) return;

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
  }, [uid, audience]);

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
  // REAL-TIME ORDER CHATS
  // =====================================

  useEffect(() => {
    setChats({});

    if (!uid || !orderIdsKey) {
      return;
    }

    let active = true;

    const unsubscribers = orderIdsKey
      .split("|")
      .map(orderId =>
        subscribeToOrderChat(
          orderId,
          messages => {
            if (!active) return;

            setChats(current => ({
              ...current,
              [orderId]: messages,
            }));
          },
          error => {
            if (!active) return;

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

      unsubscribers.forEach(unsubscribe => {
        unsubscribe();
      });
    };
  }, [uid, orderIdsKey]);

  // =====================================
  // REAL-TIME STOCK LISTENERS
  // =====================================

  useEffect(() => {
    setStockProducts([]);
    setStockSpecies([]);
    setStockCocoons(null);

    setDeletedStockIds(new Set());

    setStockReady(false);
    setDeletionsReady(false);
    setStockError(false);

    // Customer accounts must not
    // subscribe to staff inventory.

    if (audience !== "staff" || !uid) {
      return;
    }

    let active = true;

    let productsLoaded = false;
    let speciesLoaded = false;
    let cocoonsLoaded = false;

    // Wait for all three inventory
    // sources before showing counts.

    function setReadyIfLoaded() {
      if (
        active &&
        productsLoaded &&
        speciesLoaded &&
        cocoonsLoaded
      ) {
        setStockReady(true);
      }
    }

    // =====================================
    // PRODUCT STOCK
    // =====================================

    const stopProducts = onSnapshot(
      collection(db, "products"),
      snapshot => {
        if (!active) return;

        setStockProducts(
          snapshot.docs.map(item => ({
            ...item.data(),
            id: item.id,
          }))
        );

        productsLoaded = true;
        setReadyIfLoaded();
      },
      reason => {
        if (!active) return;

        console.warn(
          "Unable to read product stock notifications:",
          reason
        );

        setStockError(true);
        productsLoaded = true;
        setReadyIfLoaded();
      }
    );

    // =====================================
    // SILKWORM INVENTORY
    // =====================================

    const stopSpecies = onSnapshot(
      collection(db, "inventory_species"),
      snapshot => {
        if (!active) return;

        setStockSpecies(
          snapshot.docs.map(item => ({
            ...item.data(),
            id: item.id,
          }))
        );

        speciesLoaded = true;
        setReadyIfLoaded();
      },
      reason => {
        if (!active) return;

        console.warn(
          "Unable to read silkworm stock notifications:",
          reason
        );

        setStockError(true);
        speciesLoaded = true;
        setReadyIfLoaded();
      }
    );

    // =====================================
    // COCOON INVENTORY
    // =====================================

    // Read the same Firestore document
    // used by Inventory Management.

    const stopCocoons = onSnapshot(
      doc(db, "inventory", "cocoons"),
      snapshot => {
        if (!active) return;

        if (snapshot.exists()) {
          setStockCocoons(
            snapshot.data()
          );
        } else {
          setStockCocoons(null);
        }

        cocoonsLoaded = true;
        setReadyIfLoaded();
      },
      reason => {
        if (!active) return;

        console.warn(
          "Unable to read cocoon stock notifications:",
          reason
        );

        setStockError(true);
        cocoonsLoaded = true;
        setReadyIfLoaded();
      }
    );

    // =====================================
    // DELETED STOCK NOTIFICATIONS
    // =====================================

    // Read deletion markers so a
    // dismissed cocoon alert does not
    // continue increasing the badge.

    const stopDeleted = onSnapshot(
      collection(
        db,
        "notificationRecords",
        uid,
        "deleted"
      ),
      snapshot => {
        if (!active) return;

        const deleted = new Set<string>();

        snapshot.docs.forEach(item => {
          const data = item.data();

          if (
            data.audience === "staff" &&
            typeof data.id === "string" &&
            data.id.startsWith("lowstock:")
          ) {
            deleted.add(data.id);
          }
        });

        setDeletedStockIds(deleted);
        setDeletionsReady(true);
      },
      reason => {
        if (!active) return;

        console.warn(
          "Unable to read deleted stock alerts:",
          reason
        );

        setStockError(true);
        setDeletionsReady(true);
      }
    );

    return () => {
      active = false;

      stopProducts();
      stopSpecies();
      stopCocoons();
      stopDeleted();
    };
  }, [uid, audience]);

  // =====================================
  // BUILD STOCK NOTIFICATION IDS
  // =====================================

  const stockEventIds = useMemo(
    () =>
      audience === "staff"
        ? lowStockEventIds(
            stockProducts,
            stockSpecies,
            stockCocoons
          )
        : [],
    [
      audience,
      stockProducts,
      stockSpecies,
      stockCocoons,
    ]
  );

  // =====================================
  // COUNT UNREAD STOCK NOTIFICATIONS
  // =====================================

  const unreadStock = useMemo(
    () =>
      stockEventIds.filter(
        id =>
          !deletedStockIds.has(id) &&
          !readState[id]
      ).length,
    [
      stockEventIds,
      deletedStockIds,
      readState,
    ]
  );

  // =====================================
  // BUILD ORDER NOTIFICATION EVENTS
  // =====================================

  const notificationEvents = useMemo<
    NotificationEvent[]
  >(
    () =>
      orders.flatMap(order =>
        notificationIds(order).map(id => {
          let timestamp = order.createdAt;

          if (id.startsWith("delivered:")) {
            timestamp = order.deliveredAt;
          } else if (
            id.startsWith("dispatched:")
          ) {
            timestamp = order.dispatchedAt;
          } else if (
            id.startsWith("preparing:")
          ) {
            timestamp = order.preparingAt;
          } else if (
            id.startsWith("scheduled:")
          ) {
            timestamp = order.scheduledAt;
          } else if (
            id.startsWith("confirmed:") ||
            id.startsWith("rejected:")
          ) {
            timestamp = order.decisionAt;
          }

          return {
            id,
            orderId: order.id,
            timestamp:
              timestamp || order.createdAt,
          };
        })
      ),
    [orders]
  );

  // =====================================
  // FIRESTORE NOTIFICATION RECORDS
  // =====================================

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
          message.senderRole === incomingRole &&
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
  // READY STATE
  // =====================================

  const ready =
    ordersReady &&
    preferencesReady &&
    notificationRecordsReady &&
    (
      audience !== "staff" ||
      (stockReady && deletionsReady)
    );

  // =====================================
  // FINAL NOTIFICATION COUNTS
  // =====================================

  const totalUnread =
    unreadOrders +
    unreadChats +
    (
      audience === "staff"
        ? unreadStock
        : 0
    );

  return {
    unreadOrders:
      ready ? unreadOrders : 0,

    unreadChats:
      ready ? unreadChats : 0,

    unreadStock:
      ready && audience === "staff"
        ? unreadStock
        : 0,

    totalUnread:
      ready ? totalUnread : 0,

    ready,

    hasError:
      hasError ||
      !!preferences.error ||
      !!notificationRecordsError ||
      stockError,
  };
}
