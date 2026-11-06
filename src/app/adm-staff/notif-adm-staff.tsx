
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";
import type { ScrollViewInstance } from "react-native";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
} from "firebase/firestore";

import { auth, db } from "../../firebase/config";
import {
  C,
  Fade,
  Heading,
  S,
} from "../../components/AdminUI";

import type { DemoOrder } from "../../lib/customerOrders";

import {
  useNotificationPreferences,
  markNotificationsRead,
  markChatMessagesSeen,
} from "../../lib/notificationPreferences";

import {
  useFirestoreNotificationRecords,
  deleteNotificationRecord,
} from "../../lib/notificationRecords";

import {
  notifySilkMartReadStateChanged,
} from "../../lib/useNotificationCounts";

import {
  formatOrderChatTime,
  MAX_CHAT_MESSAGE_LENGTH,
  sendOrderChatMessage,
  deleteOrderChatMessage,
  subscribeToOrderChat,
  type OrderChatMessage,
} from "../../lib/orderChat";

type Tab = "All" | "Unread" | "Orders" | "Stock" | "Chat";

type IconName = React.ComponentProps<
  typeof Ionicons
>["name"];

type Notice = {
  id: string;
  orderId: string;
  title: string;
  message: string;
  icon: IconName;
  timestamp: number;
  kind: "order" | "stock";
};

type Row = Record<string, any>;

type Profile = {
  fullName: string;
  email: string;
};

const TABS: Tab[] = [
  "All",
  "Unread",
  "Orders",
  "Stock",
  "Chat",
];

const GREEN = C.green;
const DARK = C.dark;
const MUTED = "#627C6E";
const SURFACE = "#FFFDF8";
const LINE = C.line;
const SOFT = C.soft;
const RED = "#B34D4D";

const COCOON_THRESHOLD = 100;

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

function formatTime(value: number) {
  if (!value) return "Recently";

  return new Date(value).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDate(value?: string) {
  if (!value) return "Not scheduled";

  const parts = value.split("-");

  if (parts.length === 3) {
    const date = new Date(
      Number(parts[0]),
      Number(parts[1]) - 1,
      Number(parts[2])
    );

    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString("en-PH", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    }
  }

  return value;
}

function money(value: number) {
  return `₱${Number(value || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function normalizeOrder(id: string, data: Row): DemoOrder {
  const iso = (value: unknown) => {
    const time = toMillis(value);
    return time ? new Date(time).toISOString() : undefined;
  };

  return {
    id,
    customerUid: String(data.customerUid ?? ""),
    createdAt: iso(data.createdAt) ?? "",
    status:
      data.status === "Confirmed" || data.status === "Rejected"
        ? data.status
        : "Pending",
    deliveryStatus: [
      "Pending",
      "Scheduled",
      "Preparing",
      "Out for Delivery",
      "Delivered",
    ].includes(data.deliveryStatus)
      ? data.deliveryStatus
      : "Pending",
    preferredDeliveryDate: String(
      data.preferredDeliveryDate ?? ""
    ),
    confirmedDeliveryDate: String(
      data.confirmedDeliveryDate ?? ""
    ),
    decisionAt: iso(data.decisionAt),
    scheduledAt: iso(data.scheduledAt),
    preparingAt: iso(data.preparingAt),
    dispatchedAt: iso(data.dispatchedAt),
    deliveredAt: iso(data.deliveredAt),
    updatedAt: iso(data.updatedAt),
    paymentMethod: "COD",
    items: Array.isArray(data.items) ? data.items : [],
    total: Number(data.total ?? 0),
  };
}

function productTitle(order: DemoOrder) {
  const first = order.items?.[0]?.name;

  if (!first) return "SilkMart products";

  const count = order.items?.length ?? 0;

  return count > 1
    ? `${first} and ${count - 1} more`
    : first;
}

function buildOrderNotices(orders: DemoOrder[]): Notice[] {
  const notices: Notice[] = [];

  for (const order of orders) {
    const name = productTitle(order);
    const createdAt = toMillis(order.createdAt);

    function add(
      id: string,
      title: string,
      message: string,
      icon: IconName,
      time = createdAt
    ) {
      notices.push({
        id,
        orderId: order.id,
        title,
        message,
        icon,
        timestamp: time,
        kind: "order",
      });
    }

    add(
      `placed:${order.id}`,
      "New customer order",
      `An order for ${name} was placed. Total: ${money(order.total)}. Preferred delivery date: ${formatDate(order.preferredDeliveryDate)}.`,
      "bag-handle-outline"
    );

    if (order.status === "Confirmed") {
      add(
        `confirmed:${order.id}`,
        "Order confirmed",
        `The order for ${name} is confirmed.`,
        "checkmark-circle-outline",
        toMillis(order.decisionAt) || createdAt
      );
    }

    if (order.status === "Rejected") {
      add(
        `rejected:${order.id}`,
        "Order rejected",
        `The order for ${name} was rejected.`,
        "close-circle-outline",
        toMillis(order.decisionAt) || createdAt
      );

      continue;
    }

    if (
      order.confirmedDeliveryDate &&
      order.deliveryStatus !== "Pending"
    ) {
      add(
        `scheduled:${order.id}:${order.confirmedDeliveryDate}`,
        "Delivery scheduled",
        `Delivery for ${name} is scheduled for ${formatDate(order.confirmedDeliveryDate)}.`,
        "calendar-outline",
        toMillis(order.scheduledAt) || createdAt
      );
    }

    if (
      ["Preparing", "Out for Delivery", "Delivered"].includes(
        order.deliveryStatus
      )
    ) {
      add(
        `preparing:${order.id}`,
        "Order preparation",
        `The order for ${name} has reached the preparation stage.`,
        "cube-outline",
        toMillis(order.preparingAt) || createdAt
      );
    }

    if (
      ["Out for Delivery", "Delivered"].includes(
        order.deliveryStatus
      )
    ) {
      add(
        `dispatched:${order.id}`,
        "Order out for delivery",
        `The order for ${name} has been marked as out for delivery.`,
        "car-outline",
        toMillis(order.dispatchedAt) || createdAt
      );
    }

    if (order.deliveryStatus === "Delivered") {
      add(
        `delivered:${order.id}`,
        "Delivery completed",
        `The order for ${name} has been marked as delivered.`,
        "checkmark-done-circle-outline",
        toMillis(order.deliveredAt) || createdAt
      );
    }
  }

  return notices;
}

function buildStockNotices(
  products: Row[],
  species: Row[],
  cocoons: Row | null
): Notice[] {
  const notices: Notice[] = [];

  const speciesIds = new Set(
    species.map(item => String(item.id))
  );

  function add(
    key: string,
    name: string,
    quantity: number,
    threshold: number,
    unit: string,
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

    notices.push({
      id: `lowstock:${key}:${timestamp || Math.floor(quantity)}`,
      orderId: "",
      title: quantity <= 0 ? "Out of stock" : "Low stock alert",
      message:
        `${name} has ${quantity.toLocaleString("en-PH")} ${unit} remaining ` +
        `(low-stock threshold: ${threshold.toLocaleString("en-PH")}).`,
      icon:
        quantity <= 0
          ? "alert-circle-outline"
          : "warning-outline",
      timestamp,
      kind: "stock",
    });
  }

  // Silkworm inventory

  for (const item of species) {
    add(
      `worm:${item.id}`,
      String(item.name ?? "Silkworm"),
      Number(item.quantity ?? 0),
      Math.max(0, Number(item.threshold ?? 0)),
      "worms",
      item.updatedAt
    );
  }

  // Product inventory and separate color variants

  for (const item of products) {
    const category = String(item.category ?? "");
    const speciesId = String(item.inventorySpeciesId ?? "");

    // Prevent duplicate alerts for linked silkworms.
    if (
      category === "Silkworms" &&
      speciesId &&
      speciesIds.has(speciesId)
    ) {
      continue;
    }

    const threshold = category === "Silkworms" ? 10 : 100;
    const variants = Array.isArray(item.colorStocks)
      ? item.colorStocks
      : [];

    if (
      category !== "Silkworms" &&
      category !== "Cocoons" &&
      variants.length > 0
    ) {
      for (const color of variants) {
        if (
          !color ||
          typeof color.name !== "string"
        ) {
          continue;
        }

        add(
          `product:${item.id}:color:${color.name}`,
          `${String(item.name ?? "Product")} (${color.name})`,
          Number(color.quantity ?? 0),
          threshold,
          "pcs",
          item.updatedAt
        );
      }
    } else {
      add(
        `product:${item.id}`,
        String(item.name ?? "Product"),
        Number(item.stock ?? 0),
        threshold,
        category === "Silkworms"
          ? "worms"
          : category === "Cocoons"
            ? "cocoons"
            : "pcs",
        item.updatedAt
      );
    }
  }

  // Cocoon inventory from Inventory Management.
  // The quantity available for use is Good - Reserved.

  if (cocoons) {
    const good = Number(cocoons.good ?? 0);
    const reserved = Number(cocoons.reserved ?? 0);

    if (
      Number.isSafeInteger(good) &&
      Number.isSafeInteger(reserved) &&
      good >= 0 &&
      reserved >= 0 &&
      reserved <= good
    ) {
      add(
        "cocoon:available",
        "Available good-quality cocoons",
        good - reserved,
        COCOON_THRESHOLD,
        "cocoons",
        cocoons.updatedAt
      );
    }
  }

  return notices;
}

export default function AdminNotifications() {
  const [user, setUser] = useState<User | null>(
    auth.currentUser
  );

  const [authReady, setAuthReady] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);

  const [tab, setTab] = useState<Tab>("All");
  const [orders, setOrders] = useState<DemoOrder[]>([]);

  const [products, setProducts] = useState<Row[]>([]);
  const [species, setSpecies] = useState<Row[]>([]);
  const [cocoons, setCocoons] = useState<Row | null>(null);

  const [ordersReady, setOrdersReady] = useState(false);
  const [stockReady, setStockReady] = useState(false);
  const [deletionsReady, setDeletionsReady] = useState(false);

  const [error, setError] = useState("");
  const [stockError, setStockError] = useState("");

  const [deletedStockIds, setDeletedStockIds] =
    useState<Set<string>>(new Set());

  const [profiles, setProfiles] = useState<
    Record<string, Profile>
  >({});

  const [messages, setMessages] = useState<
    Record<string, OrderChatMessage[]>
  >({});

  const [readState, setReadState] = useState<
    Record<string, boolean>
  >({});

  const [seenMessages, setSeenMessages] = useState<
    Record<string, string[]>
  >({});

  const [chatOpen, setChatOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] =
    useState<string | null>(null);

  const [chatInput, setChatInput] = useState("");
  const [chatSaving, setChatSaving] = useState(false);
  const [chatError, setChatError] = useState("");

  const [notificationToDelete, setNotificationToDelete] =
    useState<string | null>(null);

  const [chatMessageToDelete, setChatMessageToDelete] =
    useState<OrderChatMessage | null>(null);

  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const scrollRef = useRef<ScrollViewInstance | null>(null);
  
  const uid = user?.uid ?? "";

  const cloudPreferences =
    useNotificationPreferences(uid, "staff");

  // Authentication

  useEffect(() => {
    return onAuthStateChanged(auth, next => {
      setUser(next);
      setAuthReady(true);

      setAuthorized(false);
      setCheckingAccess(true);

      setOrders([]);
      setProducts([]);
      setSpecies([]);
      setCocoons(null);
      setProfiles({});
      setMessages({});
      setReadState({});
      setSeenMessages({});
      setDeletedStockIds(new Set());

      setOrdersReady(false);
      setStockReady(false);
      setDeletionsReady(false);

      setSelectedOrderId(null);
      setChatOpen(false);
      setError("");
      setStockError("");
    });
  }, []);

  // Role verification

  useEffect(() => {
    let active = true;

    setAuthorized(false);
    setCheckingAccess(true);

    if (!uid) {
      setCheckingAccess(false);
      return;
    }

    getDoc(doc(db, "users", uid))
      .then(snapshot => {
        if (!active) return;

        const role = String(
          snapshot.data()?.role ?? ""
        ).toLowerCase();

        setAuthorized(
          ["administrator", "admin", "staff"].includes(role)
        );
      })
      .catch(() => {
        if (active) setAuthorized(false);
      })
      .finally(() => {
        if (active) setCheckingAccess(false);
      });

    return () => {
      active = false;
    };
  }, [uid]);

  // Read/unread preferences

  useEffect(() => {
    if (!uid) {
      setReadState({});
      setSeenMessages({});
      return;
    }

    if (!cloudPreferences.ready) return;

    if (cloudPreferences.error) {
      setError(cloudPreferences.error);
      return;
    }

    setReadState(cloudPreferences.readState);
    setSeenMessages(cloudPreferences.seenMessages);
  }, [
    uid,
    cloudPreferences.ready,
    cloudPreferences.error,
    cloudPreferences.readState,
    cloudPreferences.seenMessages,
  ]);

  // Orders

  useEffect(() => {
    setOrdersReady(false);

    if (!uid || !authorized) {
      setOrders([]);
      return;
    }

    return onSnapshot(
      collection(db, "orders"),
      snapshot => {
        setOrders(
          snapshot.docs.map(item =>
            normalizeOrder(item.id, item.data())
          )
        );

        setOrdersReady(true);
      },
      reason => {
        setError(reason.message);
        setOrdersReady(true);
      }
    );
  }, [uid, authorized]);

  // Products, silkworms and cocoons

  useEffect(() => {
    setProducts([]);
    setSpecies([]);
    setCocoons(null);
    setStockReady(false);
    setStockError("");

    if (!uid || !authorized) return;

    let active = true;
    let productsLoaded = false;
    let speciesLoaded = false;
    let cocoonsLoaded = false;

    function checkReady() {
      if (
        active &&
        productsLoaded &&
        speciesLoaded &&
        cocoonsLoaded
      ) {
        setStockReady(true);
      }
    }

    const stopProducts = onSnapshot(
      collection(db, "products"),
      snapshot => {
        if (!active) return;

        setProducts(
          snapshot.docs.map(item => ({
            ...item.data(),
            id: item.id,
          }))
        );

        productsLoaded = true;
        checkReady();
      },
      reason => {
        if (!active) return;

        setStockError(reason.message);
        productsLoaded = true;
        checkReady();
      }
    );

    const stopSpecies = onSnapshot(
      collection(db, "inventory_species"),
      snapshot => {
        if (!active) return;

        setSpecies(
          snapshot.docs.map(item => ({
            ...item.data(),
            id: item.id,
          }))
        );

        speciesLoaded = true;
        checkReady();
      },
      reason => {
        if (!active) return;

        setStockError(reason.message);
        speciesLoaded = true;
        checkReady();
      }
    );

    const stopCocoons = onSnapshot(
      doc(db, "inventory", "cocoons"),
      snapshot => {
        if (!active) return;

        setCocoons(
          snapshot.exists() ? snapshot.data() : null
        );

        cocoonsLoaded = true;
        checkReady();
      },
      reason => {
        if (!active) return;

        setStockError(reason.message);
        cocoonsLoaded = true;
        checkReady();
      }
    );

    return () => {
      active = false;
      stopProducts();
      stopSpecies();
      stopCocoons();
    };
  }, [uid, authorized]);

  // Permanent deletion markers

  useEffect(() => {
    setDeletionsReady(false);
    setDeletedStockIds(new Set());

    if (!uid || !authorized) return;

    return onSnapshot(
      collection(db, "notificationRecords", uid, "deleted"),
      snapshot => {
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
        setStockError(reason.message);
        setDeletionsReady(true);
      }
    );
  }, [uid, authorized]);

  const orderNotices = useMemo(
    () => buildOrderNotices(orders),
    [orders]
  );

  const stockNotices = useMemo(
    () => buildStockNotices(products, species, cocoons),
    [products, species, cocoons]
  );

  const events = useMemo(
    () =>
      orderNotices.map(item => ({
        id: item.id,
        orderId: item.orderId,
        timestamp: item.timestamp,
      })),
    [orderNotices]
  );

  const {
    visible: savedNotifications,
    ready: recordsReady,
    error: recordsError,
  } = useFirestoreNotificationRecords(
    uid,
    "staff",
    events
  );

  const notifications = useMemo(() => {
    const savedIds = new Set(
      savedNotifications.map(item => item.id)
    );

    const visibleOrders = orderNotices.filter(item =>
      savedIds.has(item.id)
    );

    const visibleStock =
      stockReady && deletionsReady
        ? stockNotices.filter(
            item => !deletedStockIds.has(item.id)
          )
        : [];

    return [...visibleOrders, ...visibleStock].sort(
      (a, b) =>
        b.timestamp - a.timestamp ||
        a.id.localeCompare(b.id)
    );
  }, [
    orderNotices,
    stockNotices,
    savedNotifications,
    deletedStockIds,
    stockReady,
    deletionsReady,
  ]);

  const unreadNotices = notifications.filter(
    item => !readState[item.id]
  );

  // Chat subscriptions

  const orderIds = useMemo(
    () => orders.map(item => item.id).sort().join("|"),
    [orders]
  );

  useEffect(() => {
    setMessages({});

    if (!uid || !authorized || !orderIds) return;

    let active = true;

    const stops = orderIds.split("|").map(orderId =>
      subscribeToOrderChat(
        orderId,
        rows => {
          if (!active) return;

          setMessages(current => ({
            ...current,
            [orderId]: rows,
          }));
        },
        reason => {
          if (active) setChatError(reason.message);
        }
      )
    );

    return () => {
      active = false;
      stops.forEach(stop => stop());
    };
  }, [uid, authorized, orderIds]);

  // Customer profiles

  const customerIds = useMemo(
    () =>
      [...new Set(orders.map(item => item.customerUid))]
        .filter(Boolean)
        .sort()
        .join("|"),
    [orders]
  );

  useEffect(() => {
    setProfiles({});

    if (!authorized || !customerIds) return;

    let active = true;

    Promise.all(
      customerIds.split("|").map(async customerUid => {
        try {
          const snapshot = await getDoc(
            doc(db, "users", customerUid)
          );

          return {
            id: customerUid,
            fullName: String(
              snapshot.data()?.fullName ?? ""
            ),
            email: String(
              snapshot.data()?.email ?? ""
            ),
          };
        } catch {
          return null;
        }
      })
    ).then(results => {
      if (!active) return;

      const next: Record<string, Profile> = {};

      results.forEach(item => {
        if (item) {
          next[item.id] = {
            fullName: item.fullName,
            email: item.email,
          };
        }
      });

      setProfiles(next);
    });

    return () => {
      active = false;
    };
  }, [authorized, customerIds]);

  const unreadChatsByOrder = useMemo(() => {
    const result: Record<string, number> = {};

    for (const order of orders) {
      const seen = new Set(
        seenMessages[order.id] ?? []
      );

      result[order.id] = (
        messages[order.id] ?? []
      ).filter(item =>
        item.senderRole === "customer" &&
        item.senderUid !== uid &&
        !seen.has(item.id)
      ).length;
    }

    return result;
  }, [orders, messages, seenMessages, uid]);

  const unreadChatCount = Object.values(
    unreadChatsByOrder
  ).reduce((sum, count) => sum + count, 0);

  const sortedChats = useMemo(
    () =>
      [...orders].sort((a, b) => {
        const latest = (orderId: string) => {
          const list = messages[orderId] ?? [];
          return toMillis(
            list[list.length - 1]?.createdAt
          );
        };

        return (
          (latest(b.id) || toMillis(b.createdAt)) -
          (latest(a.id) || toMillis(a.createdAt))
        );
      }),
    [orders, messages]
  );

  const filtered = useMemo(() => {
    switch (tab) {
      case "Unread":
        return unreadNotices;
      case "Orders":
        return notifications.filter(
          item => item.kind === "order"
        );
      case "Stock":
        return notifications.filter(
          item => item.kind === "stock"
        );
      default:
        return notifications;
    }
  }, [tab, notifications, unreadNotices]);

  async function saveRead(ids: string[]) {
    if (!uid || ids.length === 0) return;

    const unreadIds = ids.filter(
      id => !readState[id]
    );

    if (!unreadIds.length) return;

    setReadState(current => {
      const next = { ...current };

      unreadIds.forEach(id => {
        next[id] = true;
      });

      return next;
    });

    try {
      await markNotificationsRead(
        uid,
        "staff",
        unreadIds
      );

      notifySilkMartReadStateChanged();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to save read status."
      );
    }
  }

  function markRead(id: string) {
    void saveRead([id]);
  }

  function markAllRead() {
    void saveRead(
      notifications.map(item => item.id)
    );
  }

  function markChatRead(
    orderId: string,
    chat: OrderChatMessage[]
  ) {
    if (!uid) return;

    const existing = new Set(
      seenMessages[orderId] ?? []
    );

    const newIds = chat
      .filter(
        item =>
          item.senderRole === "customer" &&
          item.senderUid !== uid &&
          !existing.has(item.id)
      )
      .map(item => item.id);

    if (!newIds.length) return;

    setSeenMessages(current => ({
      ...current,
      [orderId]: [
        ...new Set([
          ...(current[orderId] ?? []),
          ...newIds,
        ]),
      ],
    }));

    void markChatMessagesSeen(
      uid,
      "staff",
      orderId,
      newIds
    )
      .then(() => notifySilkMartReadStateChanged())
      .catch(reason =>
        setChatError(
          reason instanceof Error
            ? reason.message
            : "Unable to save chat read status."
        )
      );
  }

  const selectedOrder = orders.find(
    item => item.id === selectedOrderId
  );

  const selectedProfile = selectedOrder
    ? profiles[selectedOrder.customerUid]
    : undefined;

  const chatMessages = selectedOrderId
    ? messages[selectedOrderId] ?? []
    : [];

  useEffect(() => {
    if (!chatOpen || !selectedOrderId) return;

    const current = messages[selectedOrderId] ?? [];

    if (current.length) {
      markChatRead(selectedOrderId, current);
    }
  }, [
    chatOpen,
    selectedOrderId,
    messages,
  ]);

  function openChat(order: DemoOrder) {
    setSelectedOrderId(order.id);
    setChatInput("");
    setChatError("");
    setChatOpen(true);
  }

  function closeChat() {
    if (chatSaving) return;

    setChatOpen(false);
    setSelectedOrderId(null);
    setChatInput("");
  }

  async function sendMessage() {
    if (
      !selectedOrderId ||
      !chatInput.trim() ||
      chatSaving
    ) {
      return;
    }

    setChatSaving(true);
    setChatError("");

    try {
      await sendOrderChatMessage(
        selectedOrderId,
        chatInput.trim()
      );

      setChatInput("");
    } catch (reason) {
      setChatError(
        reason instanceof Error
          ? reason.message
          : "Unable to send message."
      );
    } finally {
      setChatSaving(false);
    }
  }

  async function confirmDelete() {
    if (!uid || deleteBusy) return;

    setDeleteBusy(true);
    setDeleteError("");

    try {
      if (notificationToDelete) {
        const id = notificationToDelete;

        await deleteNotificationRecord(
          uid,
          "staff",
          id
        );

        setNotificationToDelete(null);
        notifySilkMartReadStateChanged();
      } else if (chatMessageToDelete) {
        await deleteOrderChatMessage(
          chatMessageToDelete.orderId,
          chatMessageToDelete.id
        );

        setChatMessageToDelete(null);
        notifySilkMartReadStateChanged();
      }
    } catch (reason) {
      setDeleteError(
        reason instanceof Error
          ? reason.message
          : "Unable to delete."
      );
    } finally {
      setDeleteBusy(false);
    }
  }

  function empty(
    title: string,
    description: string,
    icon: IconName = "notifications-outline"
  ) {
    return (
      <View style={styles.empty}>
        <Ionicons
          name={icon}
          size={34}
          color={GREEN}
        />

        <Text style={styles.emptyTitle}>
          {title}
        </Text>

        <Text style={styles.emptyDescription}>
          {description}
        </Text>
      </View>
    );
  }

  const ready =
    authReady &&
    !checkingAccess &&
    ordersReady &&
    stockReady &&
    deletionsReady &&
    cloudPreferences.ready &&
    recordsReady;

  return (
    <>
      <ScrollView
        style={S.page}
        contentContainerStyle={S.content}
        keyboardShouldPersistTaps="handled"
      >
        <Heading
          label="STAY INFORMED"
          title="Notifications."
          description="Order, delivery, stock, and customer conversation updates in one place."
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabs}
        >
          {TABS.map(item => {
            const count =
              item === "All"
                ? notifications.length
                : item === "Unread"
                  ? unreadNotices.length
                  : item === "Orders"
                    ? notifications.filter(
                        n => n.kind === "order"
                      ).length
                    : item === "Stock"
                      ? notifications.filter(
                          n => n.kind === "stock"
                        ).length
                      : unreadChatCount;

            return (
              <Pressable
                key={item}
                style={[
                  S.chip,
                  tab === item && S.chipActive,
                ]}
                onPress={() => setTab(item)}
              >
                <Text
                  style={{
                    color:
                      tab === item
                        ? "#FFFFFF"
                        : DARK,
                    fontSize: 11,
                    fontWeight: "600",
                  }}
                >
                  {item} ({count})
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {!authReady || checkingAccess ? (
          <View style={styles.loading}>
            <ActivityIndicator color={GREEN} />
            <Text style={S.muted}>
              Checking account access...
            </Text>
          </View>
        ) : !user ? (
          empty(
            "Sign in required",
            "Please sign in with a SilkMart Admin or Staff account.",
            "lock-closed-outline"
          )
        ) : !authorized ? (
          empty(
            "Access restricted",
            "Only authorized Admin and Staff accounts may view notifications.",
            "shield-outline"
          )
        ) : !ready ? (
          <View style={styles.loading}>
            <ActivityIndicator color={GREEN} />
            <Text style={S.muted}>
              Loading SilkMart notifications...
            </Text>
          </View>
        ) : error || stockError || recordsError ? (
          empty(
            "Unable to load updates",
            error ||
              stockError ||
              String(recordsError),
            "alert-circle-outline"
          )
        ) : tab === "Chat" ? (
          <Fade delay={120}>
            <Text style={styles.sectionTitle}>
              Customer Conversations
            </Text>

            <Text style={styles.sectionDescription}>
              Open an order to read and reply to customer messages.
            </Text>

            {sortedChats.length === 0
              ? empty(
                  "No conversations yet",
                  "Customer conversations appear when orders are placed.",
                  "chatbubbles-outline"
                )
              : sortedChats.map(order => {
                  const profile =
                    profiles[order.customerUid];

                  const chat =
                    messages[order.id] ?? [];

                  const last =
                    chat[chat.length - 1];

                  const unread =
                    unreadChatsByOrder[order.id] ?? 0;

                  return (
                    <View
                      key={order.id}
                      style={styles.conversationCard}
                    >
                      <View style={styles.iconBox}>
                        <Ionicons
                          name="chatbubbles-outline"
                          size={22}
                          color={GREEN}
                        />
                      </View>

                      <View style={{ flex: 1 }}>
                        <Text style={styles.eyebrow}>
                          ORDER #{order.id}
                        </Text>

                        <Text style={styles.customerName}>
                          {profile?.fullName ||
                            "SilkMart Customer"}
                        </Text>

                        <Text style={styles.body}>
                          {productTitle(order)}
                        </Text>

                        <Text style={styles.muted}>
                          Order: {order.status}
                        </Text>

                        {!!last && (
                          <Text
                            style={styles.messagePreview}
                            numberOfLines={2}
                          >
                            {last.senderRole === "customer"
                              ? "Customer: "
                              : "Staff: "}
                            {last.text}
                          </Text>
                        )}

                        <Pressable
                          style={styles.primaryButton}
                          onPress={() => openChat(order)}
                        >
                          <Ionicons
                            name="chatbubble-ellipses-outline"
                            size={16}
                            color="#FFFFFF"
                          />

                          <Text style={styles.primaryText}>
                            Open Chat
                          </Text>

                          {unread > 0 && (
                            <View style={styles.badge}>
                              <Text style={styles.badgeText}>
                                {unread > 99 ? "99+" : unread}
                              </Text>
                            </View>
                          )}
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
          </Fade>
        ) : (
          <Fade delay={120}>
            <View style={styles.toolbar}>
              <Text style={styles.sectionTitle}>
                {tab === "Unread"
                  ? "Unread notifications"
                  : tab === "Orders"
                    ? "Order updates"
                    : tab === "Stock"
                      ? "Stock alerts"
                      : "All notifications"}
              </Text>

              {unreadNotices.length > 0 && (
                <Pressable
                  style={styles.markAll}
                  onPress={markAllRead}
                >
                  <Ionicons
                    name="checkmark-done-outline"
                    size={15}
                    color={GREEN}
                  />
                  <Text style={styles.markAllText}>
                    Mark all read
                  </Text>
                </Pressable>
              )}
            </View>

            {filtered.length === 0
              ? empty(
                  tab === "Unread"
                    ? "No unread notifications"
                    : "You're all caught up",
                  "New order, delivery, and low-stock alerts will appear here."
                )
              : filtered.map(item => {
                  const unread = !readState[item.id];

                  const order =
                    item.kind === "order"
                      ? orders.find(
                          o => o.id === item.orderId
                        )
                      : undefined;

                  return (
                    <Pressable
                      key={item.id}
                      style={[
                        styles.notificationCard,
                        unread && styles.unreadCard,
                      ]}
                      onPress={() => markRead(item.id)}
                    >
                      <View style={styles.iconBox}>
                        <Ionicons
                          name={item.icon}
                          color={GREEN}
                          size={22}
                        />
                      </View>

                      <View style={{ flex: 1 }}>
                        <View style={styles.titleRow}>
                          <Text style={styles.notificationTitle}>
                            {item.title}
                          </Text>

                          {unread && (
                            <View style={styles.unreadDot} />
                          )}
                        </View>

                        <Text style={styles.body}>
                          {item.message}
                        </Text>

                        <Text style={styles.timestamp}>
                          {formatTime(item.timestamp)}
                        </Text>

                        {order && (
                          <Pressable
                            style={styles.replyLink}
                            onPress={() => {
                              markRead(item.id);
                              openChat(order);
                            }}
                          >
                            <Ionicons
                              name="chatbubble-outline"
                              size={15}
                              color={GREEN}
                            />
                            <Text style={styles.replyText}>
                              Open Order Conversation
                            </Text>
                          </Pressable>
                        )}
                      </View>

                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Delete notification"
                        style={styles.deleteIcon}
                        onPress={event => {
                          event.stopPropagation();
                          setNotificationToDelete(item.id);
                        }}
                      >
                        <Ionicons
                          name="trash-outline"
                          size={19}
                          color={RED}
                        />
                      </Pressable>
                    </Pressable>
                  );
                })}
          </Fade>
        )}

        {authorized && (
          <View style={styles.infoCard}>
            <Ionicons
              name="shield-checkmark-outline"
              size={20}
              color={GREEN}
            />
            <Text style={styles.infoText}>
              Orders, stock levels, and conversations
              synchronize with Firestore. Read status
              is saved for this staff account.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* CHAT MODAL */}

      <Modal
        visible={chatOpen && !!selectedOrder}
        transparent
        animationType="fade"
        onRequestClose={closeChat}
      >
        <KeyboardAvoidingView
          style={styles.backdrop}
          behavior={
            Platform.OS === "ios"
              ? "padding"
              : undefined
          }
        >
          <View style={styles.chatCard}>
            <View style={styles.chatHeader}>
              <Pressable
                style={styles.closeButton}
                disabled={chatSaving}
                onPress={closeChat}
              >
                <Ionicons
                  name="arrow-back"
                  size={21}
                  color={GREEN}
                />
              </Pressable>

              <View style={{ flex: 1 }}>
                <Text style={styles.eyebrow}>
                  SILKMART MESSAGES
                </Text>
                <Text style={styles.chatTitle}>
                  {selectedProfile?.fullName ||
                    "Customer Chat"}
                </Text>
                <Text style={styles.muted}>
                  Order #{selectedOrderId}
                </Text>
              </View>

              <Ionicons
                name="chatbubbles-outline"
                size={24}
                color={GREEN}
              />
            </View>

            <View style={styles.recipient}>
              <View style={styles.iconBox}>
                <Ionicons
                  name="person-outline"
                  size={22}
                  color={GREEN}
                />
              </View>

              <View style={{ flex: 1 }}>
                <Text style={styles.customerName}>
                  {selectedProfile?.fullName ||
                    "SilkMart Customer"}
                </Text>
                <Text style={styles.muted}>
                  {selectedProfile?.email ||
                    "Customer order conversation"}
                </Text>
              </View>
            </View>

            <ScrollView
              ref={scrollRef}
              style={styles.chatScroll}
              contentContainerStyle={styles.chatContent}
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={() =>
                scrollRef.current?.scrollToEnd({
                  animated: false,
                })
              }
            >
              {chatMessages.length === 0 ? (
                <View style={styles.chatEmpty}>
                  <Ionicons
                    name="chatbubbles-outline"
                    size={38}
                    color={GREEN}
                  />
                  <Text style={styles.chatTitle}>
                    Start a conversation
                  </Text>
                  <Text style={styles.emptyDescription}>
                    Message the customer about their
                    order or delivery schedule.
                  </Text>
                </View>
              ) : (
                chatMessages.map(message => {
                  const mine = message.senderUid === uid;

                  return (
                    <View
                      key={message.id}
                      style={[
                        styles.messageRow,
                        {
                          justifyContent: mine
                            ? "flex-end"
                            : "flex-start",
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.messageBubble,
                          mine
                            ? styles.staffBubble
                            : styles.customerBubble,
                        ]}
                      >
                        <Text
                          style={[
                            styles.chatMessage,
                            mine && styles.whiteText,
                          ]}
                        >
                          {message.text}
                        </Text>

                        {mine && (
                          <Pressable
                            style={styles.chatDelete}
                            onPress={() =>
                              setChatMessageToDelete(message)
                            }
                          >
                            <Ionicons
                              name="trash-outline"
                              size={15}
                              color="#FFFFFF"
                            />
                          </Pressable>
                        )}

                        <Text
                          style={[
                            styles.messageTime,
                            mine && styles.staffTime,
                          ]}
                        >
                          {mine
                            ? "You"
                            : message.senderRole === "staff"
                              ? "SilkMart Staff"
                              : "Customer"}
                          {" · "}
                          {formatOrderChatTime(
                            message.createdAt
                          )}
                        </Text>
                      </View>
                    </View>
                  );
                })
              )}
            </ScrollView>

            {!!chatError && (
              <Text style={styles.error}>
                {chatError}
              </Text>
            )}

            <View style={styles.composer}>
              <View style={styles.composerRow}>
                <TextInput
                  style={styles.chatInput}
                  placeholder="Type a message..."
                  placeholderTextColor="#91A198"
                  multiline
                  maxLength={MAX_CHAT_MESSAGE_LENGTH}
                  value={chatInput}
                  onChangeText={setChatInput}
                  editable={!chatSaving}
                  textAlignVertical="top"
                />

                <Pressable
                  style={[
                    styles.sendButton,
                    (chatSaving || !chatInput.trim()) &&
                      { opacity: 0.5 },
                  ]}
                  disabled={
                    chatSaving || !chatInput.trim()
                  }
                  onPress={() => void sendMessage()}
                >
                  {chatSaving ? (
                    <ActivityIndicator
                      size="small"
                      color="#FFFFFF"
                    />
                  ) : (
                    <Ionicons
                      name="send"
                      size={19}
                      color="#FFFFFF"
                    />
                  )}
                </Pressable>
              </View>

              <Text style={styles.composerHint}>
                Messages are stored in the order conversation.
              </Text>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* DELETE CONFIRMATION */}

      <Modal
        visible={
          notificationToDelete !== null ||
          chatMessageToDelete !== null
        }
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!deleteBusy) {
            setNotificationToDelete(null);
            setChatMessageToDelete(null);
            setDeleteError("");
          }
        }}
      >
        <View style={styles.backdrop}>
          <View style={styles.confirmCard}>
            <Ionicons
              name="trash-outline"
              size={27}
              color={RED}
            />

            <Text style={styles.confirmTitle}>
              Delete permanently?
            </Text>

            <Text style={styles.body}>
              Only the selected{" "}
              {chatMessageToDelete
                ? "message that you sent"
                : "notification"}{" "}
              will be deleted or permanently dismissed.
              Orders and other messages remain unchanged.
            </Text>

            {!!deleteError && (
              <Text style={styles.error}>
                {deleteError}
              </Text>
            )}

            <View style={styles.confirmActions}>
              <Pressable
                disabled={deleteBusy}
                style={styles.secondaryButton}
                onPress={() => {
                  setNotificationToDelete(null);
                  setChatMessageToDelete(null);
                  setDeleteError("");
                }}
              >
                <Text style={styles.secondaryText}>
                  Cancel
                </Text>
              </Pressable>

              <Pressable
                disabled={deleteBusy}
                style={[
                  styles.secondaryButton,
                  { backgroundColor: RED },
                ]}
                onPress={() => void confirmDelete()}
              >
                <Text style={styles.whiteText}>
                  {deleteBusy
                    ? "Deleting..."
                    : "Delete"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 17,
    paddingRight: 10,
  },
  loading: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 55,
    gap: 14,
  },
  toolbar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  },
  sectionTitle: {
    fontFamily: "serif",
    fontSize: 20,
    color: DARK,
    marginBottom: 10,
  },
  sectionDescription: {
    color: MUTED,
    fontSize: 12,
    marginBottom: 16,
  },
  markAll: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  markAllText: {
    color: GREEN,
    fontSize: 11,
    fontWeight: "700",
  },
  notificationCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 15,
    marginBottom: 11,
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: LINE,
  },
  unreadCard: {
    backgroundColor: "#F0F7EC",
    borderColor: "#B7CFB7",
  },
  iconBox: {
    width: 43,
    height: 43,
    borderRadius: 13,
    backgroundColor: SOFT,
    alignItems: "center",
    justifyContent: "center",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  notificationTitle: {
    flex: 1,
    color: DARK,
    fontSize: 13,
    fontWeight: "700",
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: GREEN,
    marginTop: 4,
  },
  body: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 19,
    marginTop: 7,
  },
  timestamp: {
    color: "#85978B",
    fontSize: 10,
    marginTop: 10,
  },
  deleteIcon: {
    padding: 8,
    alignSelf: "flex-start",
  },
  replyLink: {
    marginTop: 12,
    flexDirection: "row",
    gap: 7,
    alignItems: "center",
  },
  replyText: {
    fontSize: 11,
    fontWeight: "700",
    color: GREEN,
  },
  empty: {
    ...S.card,
    alignItems: "center",
    paddingVertical: 40,
    paddingHorizontal: 20,
    gap: 10,
  },
  emptyTitle: {
    color: DARK,
    fontSize: 17,
    fontWeight: "700",
  },
  emptyDescription: {
    color: MUTED,
    fontSize: 12,
    textAlign: "center",
    lineHeight: 20,
  },
  conversationCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 15,
    marginBottom: 12,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 17,
  },
  eyebrow: {
    color: GREEN,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  customerName: {
    color: DARK,
    fontSize: 15,
    fontWeight: "700",
    marginTop: 5,
  },
  muted: {
    color: MUTED,
    fontSize: 11,
    marginTop: 5,
  },
  messagePreview: {
    color: MUTED,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 8,
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    gap: 8,
    marginTop: 13,
    backgroundColor: GREEN,
    borderRadius: 11,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  primaryText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },
  badge: {
    minWidth: 19,
    height: 19,
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: {
    color: GREEN,
    fontSize: 10,
    fontWeight: "700",
  },
  infoCard: {
    padding: 16,
    backgroundColor: SOFT,
    borderRadius: 13,
    marginTop: 18,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  infoText: {
    flex: 1,
    color: MUTED,
    fontSize: 11,
    lineHeight: 18,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(13,31,22,0.57)",
    justifyContent: "center",
    padding: 14,
  },
  chatCard: {
    width: "100%",
    maxWidth: 560,
    height: "85%",
    maxHeight: 720,
    alignSelf: "center",
    backgroundColor: SURFACE,
    borderRadius: 22,
    overflow: "hidden",
  },
  chatHeader: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: LINE,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  closeButton: {
    width: 35,
    height: 35,
    borderRadius: 18,
    backgroundColor: SOFT,
    alignItems: "center",
    justifyContent: "center",
  },
  chatTitle: {
    color: DARK,
    fontFamily: "serif",
    fontSize: 22,
    marginTop: 5,
  },
  recipient: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    padding: 13,
    backgroundColor: "#F5F8F1",
    borderBottomWidth: 1,
    borderBottomColor: LINE,
  },
  chatScroll: {
    flex: 1,
  },
  chatContent: {
    flexGrow: 1,
    justifyContent: "flex-end",
    gap: 12,
    padding: 15,
    paddingBottom: 24,
  },
  chatEmpty: {
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    gap: 13,
    padding: 25,
  },
  messageRow: {
    width: "100%",
    flexDirection: "row",
  },
  messageBubble: {
    maxWidth: "84%",
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderRadius: 15,
  },
  staffBubble: {
    backgroundColor: GREEN,
    borderBottomRightRadius: 4,
  },
  customerBubble: {
    backgroundColor: "#E7EFE4",
    borderBottomLeftRadius: 4,
  },
  chatMessage: {
    color: DARK,
    fontSize: 12,
    lineHeight: 19,
  },
  whiteText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  chatDelete: {
    alignSelf: "flex-end",
    padding: 5,
  },
  messageTime: {
    color: MUTED,
    fontSize: 9,
    marginTop: 8,
  },
  staffTime: {
    color: "#DCEDE1",
  },
  composer: {
    padding: 12,
    gap: 7,
    borderTopWidth: 1,
    borderTopColor: LINE,
  },
  composerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 9,
  },
  chatInput: {
    flex: 1,
    minHeight: 45,
    maxHeight: 105,
    backgroundColor: "#F3F6EF",
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 14,
    color: DARK,
    fontSize: 12,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  sendButton: {
    width: 45,
    height: 45,
    borderRadius: 13,
    backgroundColor: GREEN,
    justifyContent: "center",
    alignItems: "center",
  },
  composerHint: {
    color: MUTED,
    fontSize: 10,
    textAlign: "center",
  },
  error: {
    color: RED,
    fontSize: 11,
    margin: 10,
  },
  confirmCard: {
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
    backgroundColor: SURFACE,
    borderRadius: 18,
    padding: 22,
    gap: 14,
  },
  confirmTitle: {
    color: DARK,
    fontSize: 19,
    fontWeight: "700",
  },
  confirmActions: {
    flexDirection: "row",
    gap: 10,
  },
  secondaryButton: {
    flex: 1,
    borderColor: LINE,
    borderWidth: 1,
    padding: 13,
    borderRadius: 10,
    alignItems: "center",
  },
  secondaryText: {
    color: DARK,
    fontSize: 12,
    fontWeight: "700",
  },
});
