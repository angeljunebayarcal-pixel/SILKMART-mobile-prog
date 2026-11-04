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

import type { ScrollViewInstance } from "react-native";

import { Ionicons } from "@expo/vector-icons";

import {
  onAuthStateChanged,
  type User,
} from "firebase/auth";

import {
  collection,
  doc,
  getDoc,
  onSnapshot,
} from "firebase/firestore";

import { auth, db } from "../../firebase/config";
import { notifySilkMartReadStateChanged } from "../../lib/useNotificationCounts";
import {
  useNotificationPreferences,
  markNotificationsRead,
  markChatMessagesSeen,
} from "../../lib/notificationPreferences";
import { useFirestoreNotificationRecords, deleteNotificationRecord } from "../../lib/notificationRecords";

import {
  C,
  Fade,
  Heading,
  S,
} from "../../components/AdminUI";

import type { DemoOrder } from "../../lib/customerOrders";

import {
  formatOrderChatTime,
  MAX_CHAT_MESSAGE_LENGTH,
  sendOrderChatMessage,
  deleteOrderChatMessage,
  subscribeToOrderChat,
  type OrderChatMessage,
} from "../../lib/orderChat";

// =====================================
// TYPES
// =====================================

type NotificationTab =
  | "All"
  | "Unread"
  | "Orders"
  | "Chat";

type IconName =
  React.ComponentProps<typeof Ionicons>["name"];

type StaffNotification = {
  id: string;
  orderId: string;
  title: string;
  message: string;
  icon: IconName;
  timestamp: number;
};

type CustomerProfile = {
  fullName: string;
  email: string;
};

type ReadState = Record<string, boolean>;

type SeenMessages = Record<string, string[]>;

const TABS: NotificationTab[] = [
  "All",
  "Unread",
  "Orders",
  "Chat",
];

const GREEN = C.green;
const DARK = C.dark;
const MUTED = "#627C6E";
const SURFACE = "#FFFDF8";
const LINE = C.line;
const SOFT = C.soft;
const RED = "#B34D4D";

// =====================================
// HELPERS
// =====================================

function toMillis(value: unknown): number {
  if (!value) return 0;

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const result = Date.parse(value);

    return Number.isFinite(result)
      ? result
      : 0;
  }

  if (typeof value === "object") {
    const data = value as {
      toMillis?: () => number;
      seconds?: number;
    };

    if (typeof data.toMillis === "function") {
      return data.toMillis();
    }

    if (typeof data.seconds === "number") {
      return data.seconds * 1000;
    }
  }

  return 0;
}

function displayTime(value: number): string {
  if (!value) return "Recently";

  return new Date(value).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function displayDate(value?: string): string {
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
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    }
  }

  return value;
}

function money(amount: number): string {
  return `₱${Number(amount || 0).toLocaleString(
    "en-PH",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }
  )}`;
}

function productTitle(order: DemoOrder): string {
  const first = order.items?.[0]?.name;

  if (!first) return "SilkMart products";

  const count = order.items?.length ?? 0;

  return count > 1
    ? `${first} and ${count - 1} more`
    : first;
}

function toIsoTime(value: unknown): string | undefined {
  const millis = toMillis(value);
  return millis > 0 ? new Date(millis).toISOString() : undefined;
}

function normalizeOrder(
  id: string,
  data: Record<string, any>
): DemoOrder {
  return {
    id,
    customerUid: String(data.customerUid ?? ""),

    createdAt:
      typeof data.createdAt?.toDate === "function"
        ? data.createdAt.toDate().toISOString()
        : String(data.createdAt ?? ""),

    status:
      data.status === "Confirmed" ||
      data.status === "Rejected"
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

    updatedAt: toIsoTime(data.updatedAt),
    decisionAt: toIsoTime(data.decisionAt),
    scheduledAt: toIsoTime(data.scheduledAt),
    preparingAt: toIsoTime(data.preparingAt),
    dispatchedAt: toIsoTime(data.dispatchedAt),
    deliveredAt: toIsoTime(data.deliveredAt),
    paymentMethod: "COD",

    items: Array.isArray(data.items)
      ? data.items
      : [],

    total: Number(data.total ?? 0),
  };
}

// =====================================
// BUILD STAFF ORDER NOTIFICATIONS
// =====================================

// Legacy orders may lack event timestamps. Keep their stage ordering stable.
function eventPriority(id: string): number {
  if (id.startsWith("delivered:")) return 7;
  if (id.startsWith("dispatched:")) return 6;
  if (id.startsWith("preparing:")) return 5;
  if (id.startsWith("scheduled:")) return 4;
  if (id.startsWith("confirmed:") || id.startsWith("rejected:")) return 3;
  return 1;
}

function buildNotifications(
  orders: DemoOrder[]
): StaffNotification[] {
  const result: StaffNotification[] = [];

  for (const order of orders) {
    const product = productTitle(order);

    const createdAt = toMillis(
      order.createdAt
    );

    function add(
      id: string,
      title: string,
      message: string,
      icon: IconName,
      time: number = createdAt
    ) {
      result.push({
        id,
        orderId: order.id,
        title,
        message,
        icon,
        timestamp: time,
      });
    }

    // NEW ORDER

    add(
      `placed:${order.id}`,
      "New customer order",
      `An order for ${product} was placed. Total: ${money(
        order.total
      )}. Preferred delivery date: ${displayDate(
        order.preferredDeliveryDate
      )}.`,
      "bag-handle-outline"
    );

    // ORDER CONFIRMED

    if (order.status === "Confirmed") {
      add(
        `confirmed:${order.id}`,
        "Order confirmed",
        `The order for ${product} is confirmed.`,
        "checkmark-circle-outline",
        toMillis(order.decisionAt) || createdAt
      );
    }

    // ORDER REJECTED

    if (order.status === "Rejected") {
      add(
        `rejected:${order.id}`,
        "Order rejected",
        `The order for ${product} was rejected.`,
        "close-circle-outline",
        toMillis(order.decisionAt) || createdAt
      );

      continue;
    }

    // DELIVERY SCHEDULED

    if (
      order.confirmedDeliveryDate &&
      order.deliveryStatus !== "Pending"
    ) {
      add(
        `scheduled:${order.id}:${order.confirmedDeliveryDate}`,
        "Delivery scheduled",
        `Delivery for ${product} is scheduled for ${displayDate(
          order.confirmedDeliveryDate
        )}.`,
        "calendar-outline",
        toMillis(order.scheduledAt) || createdAt
      );
    }

    // PREPARATION

    if (
      order.deliveryStatus === "Preparing" ||
      order.deliveryStatus === "Out for Delivery" ||
      order.deliveryStatus === "Delivered"
    ) {
      add(
        `preparing:${order.id}`,
        "Order preparation",
        `The order for ${product} has reached the preparation stage.`,
        "cube-outline",
        toMillis(order.preparingAt) || createdAt
      );
    }

    // OUT FOR DELIVERY

    if (
      order.deliveryStatus === "Out for Delivery" ||
      order.deliveryStatus === "Delivered"
    ) {
      add(
        `dispatched:${order.id}`,
        "Order out for delivery",
        `The order for ${product} has been marked as out for delivery.`,
        "car-outline",
        toMillis(order.dispatchedAt) || createdAt
      );
    }

    // DELIVERED

    if (order.deliveryStatus === "Delivered") {
      add(
        `delivered:${order.id}`,
        "Delivery completed",
        `The order for ${product} has been marked as delivered.`,
        "checkmark-done-circle-outline",
        toMillis(order.deliveredAt) || createdAt
      );
    }
  }

  return result.sort(
    (a, b) =>
      b.timestamp - a.timestamp ||
      eventPriority(b.id) - eventPriority(a.id) ||
      a.id.localeCompare(b.id)
  );
}

// =====================================
// MAIN SCREEN
// =====================================

export default function AdminNotifications() {
  const [user, setUser] =
    useState<User | null>(auth.currentUser);

  const [authReady, setAuthReady] =
    useState(false);

  const [authorized, setAuthorized] =
    useState(false);

  const [checkingAccess, setCheckingAccess] =
    useState(true);

  const [tab, setTab] =
    useState<NotificationTab>("All");

  const [orders, setOrders] =
    useState<DemoOrder[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [readState, setReadState] =
    useState<ReadState>({});

  const [notificationToDelete, setNotificationToDelete] = useState<string | null>(null);
  const [chatMessageToDelete, setChatMessageToDelete] = useState<OrderChatMessage | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const [seenMessages, setSeenMessages] =
    useState<SeenMessages>({});

  const [preferencesReady, setPreferencesReady] =
    useState(false);

  const [messageMap, setMessageMap] =
    useState<Record<string, OrderChatMessage[]>>({});

  const [customerProfiles, setCustomerProfiles] =
    useState<Record<string, CustomerProfile>>({});

  // CHAT STATE

  const [selectedOrderId, setSelectedOrderId] =
    useState<string | null>(null);

  const [chatOpen, setChatOpen] =
    useState(false);

  const [chatInput, setChatInput] =
    useState("");

  const [chatSaving, setChatSaving] =
    useState(false);

  const [chatError, setChatError] =
    useState("");

  const chatScrollRef =
    useRef<ScrollViewInstance | null>(null);

  // =====================================
  // AUTHENTICATION
  // =====================================

  useEffect(() => {
    return onAuthStateChanged(
      auth,
      nextUser => {
        setUser(nextUser);
        setAuthReady(true);

        setAuthorized(false);
        setCheckingAccess(true);

        setOrders([]);
        setMessageMap({});
        setCustomerProfiles({});
        setReadState({});
        setSeenMessages({});
        setPreferencesReady(false);

        setChatOpen(false);
        setSelectedOrderId(null);
        setChatInput("");
        setError("");
      }
    );
  }, []);

  const uid = user?.uid ?? "";

  const cloudPreferences = useNotificationPreferences(uid, "staff");

  // =====================================
  // CHECK ADMIN/STAFF ROLE
  // =====================================

  useEffect(() => {
    let active = true;

    setAuthorized(false);
    setCheckingAccess(true);

    if (!uid) {
      setCheckingAccess(false);
      return;
    }

    async function checkAccess() {
      try {
        const snapshot = await getDoc(
          doc(db, "users", uid)
        );

        if (!active) return;

        const role = String(
          snapshot.data()?.role ?? ""
        ).toLowerCase();

        setAuthorized(
          [
            "administrator",
            "admin",
            "staff",
          ].includes(role)
        );
      } catch {
        if (active) {
          setAuthorized(false);
        }
      } finally {
        if (active) {
          setCheckingAccess(false);
        }
      }
    }

    void checkAccess();

    return () => {
      active = false;
    };
  }, [uid]);

  // =====================================
  // RESTORE READ STATE FROM FIRESTORE
  // =====================================

  useEffect(() => {
    if (!uid) {
      setReadState({});
      setSeenMessages({});
      setPreferencesReady(true);
      return;
    }

    if (!cloudPreferences.ready) {
      setPreferencesReady(false);
      return;
    }

    if (cloudPreferences.error) {
      setError(cloudPreferences.error);
      setPreferencesReady(true);
      return;
    }

    setReadState(cloudPreferences.readState);
    setSeenMessages(cloudPreferences.seenMessages);
    setPreferencesReady(true);
  }, [
    uid,
    cloudPreferences.ready,
    cloudPreferences.error,
    cloudPreferences.readState,
    cloudPreferences.seenMessages,
  ]);

  // =====================================
  // REAL-TIME ORDERS
  // =====================================

  useEffect(() => {
    if (!uid || !authorized) {
      setOrders([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    const unsubscribe = onSnapshot(
      collection(db, "orders"),
      snapshot => {
        const records = snapshot.docs
          .map(item =>
            normalizeOrder(
              item.id,
              item.data()
            )
          )
          .sort((a, b) =>
            b.createdAt.localeCompare(a.createdAt)
          );

        setOrders(records);
        setLoading(false);
        setError("");
      },
      reason => {
        setLoading(false);

        setError(
          reason.code === "permission-denied"
            ? "Firestore denied access to customer orders."
            : "Unable to load staff notifications. Check your connection."
        );
      }
    );

    return unsubscribe;
  }, [uid, authorized]);

  // =====================================
  // LOAD CUSTOMER NAMES
  // =====================================

  const customerIdsKey = useMemo(() => {
    return Array.from(
      new Set(
        orders
          .map(order => order.customerUid)
          .filter(Boolean)
      )
    )
      .sort()
      .join("|");
  }, [orders]);

  useEffect(() => {
    if (!authorized || !customerIdsKey) {
      setCustomerProfiles({});
      return;
    }

    let active = true;

    async function loadProfiles() {
      const next: Record<
        string,
        CustomerProfile
      > = {};

      const customerIds =
        customerIdsKey.split("|");

      await Promise.all(
        customerIds.map(async customerUid => {
          try {
            const snapshot = await getDoc(
              doc(db, "users", customerUid)
            );

            if (!snapshot.exists()) return;

            const data = snapshot.data();

            next[customerUid] = {
              fullName: String(
                data.fullName ?? ""
              ),
              email: String(
                data.email ?? ""
              ),
            };
          } catch {
            // The order ID remains available
            // if customer information is denied.
          }
        })
      );

      if (active) {
        setCustomerProfiles(next);
      }
    }

    void loadProfiles();

    return () => {
      active = false;
    };
  }, [authorized, customerIdsKey]);

  // =====================================
  // REAL-TIME ORDER CHATS
  // =====================================

  const orderIdsKey = useMemo(() => {
    return orders
      .map(order => order.id)
      .sort()
      .join("|");
  }, [orders]);

  useEffect(() => {
    if (
      !uid ||
      !authorized ||
      !preferencesReady
    ) {
      return;
    }

    const ids = orderIdsKey
      ? orderIdsKey.split("|")
      : [];

    let active = true;

    setMessageMap({});

    const unsubscribers = ids.map(
      orderId =>
        subscribeToOrderChat(
          orderId,
          messages => {
            if (!active) return;

            setMessageMap(current => ({
              ...current,
              [orderId]: messages,
            }));
          },
          reason => {
            if (!active) return;

            console.warn(
              `Order conversation ${orderId}:`,
              reason.message
            );

            setChatError(current =>
              current ||
              `Unable to load messages: ${reason.message}`
            );
          }
        )
    );

    return () => {
      active = false;

      unsubscribers.forEach(
        unsubscribe => unsubscribe()
      );
    };
  }, [
    uid,
    authorized,
    preferencesReady,
    orderIdsKey,
  ]);

  // =====================================
  // NOTIFICATION COUNTS
  // =====================================

  const allNotifications = useMemo(
    () => buildNotifications(orders),
    [orders]
  );

  const notificationEvents = useMemo(
    () => allNotifications.map(item => ({
      id: item.id,
      orderId: item.orderId,
      timestamp: item.timestamp,
    })),
    [allNotifications]
  );

  const {
    visible: persistedNotifications,
    ready: notificationRecordsReady,
    error: notificationStoreError,
  } = useFirestoreNotificationRecords(
    uid,
    "staff",
    notificationEvents
  );

  const notifications = useMemo(
    () => allNotifications.filter(notification =>
      persistedNotifications.some(saved => saved.id === notification.id)
    ),
    [allNotifications, persistedNotifications]
  );

  const unreadNotificationCount =
    notifications.filter(
      item => !readState[item.id]
    ).length;

  const unreadChatsByOrder = useMemo(() => {
    const result: Record<string, number> = {};

    for (const order of orders) {
      const messages =
        messageMap[order.id] ?? [];

      const seen = new Set(
        seenMessages[order.id] ?? []
      );

      result[order.id] = messages.filter(
        message =>
          message.senderRole === "customer" &&
          message.senderUid !== uid &&
          !seen.has(message.id)
      ).length;
    }

    return result;
  }, [
    orders,
    messageMap,
    seenMessages,
    uid,
  ]);

  const unreadChatCount = Object.values(
    unreadChatsByOrder
  ).reduce(
    (sum, count) => sum + count,
    0
  );

  const filteredNotifications = useMemo(() => {
    if (tab === "Unread") {
      return notifications.filter(
        item => !readState[item.id]
      );
    }

    return notifications;
  }, [notifications, readState, tab]);

  // =====================================
  // PERSIST NOTIFICATION READ STATE
  // =====================================

  async function saveReadState(next: ReadState) {
    if (!uid) return;

    const newlyReadIds = Object.keys(next).filter(
      id => next[id] && !readState[id]
    );

    if (!newlyReadIds.length) return;

    // Show the result immediately. Firestore's
    // subscription restores the authoritative state.
    setReadState(current => ({ ...current, ...next }));

    try {
      await markNotificationsRead(uid, "staff", newlyReadIds);
      notifySilkMartReadStateChanged();
    } catch (reason) {
      console.warn("Unable to save notification read state:", reason);
      setError(reason instanceof Error ? reason.message : "Unable to save read status.");
    }
  }

  function markNotificationAsRead(notificationId: string) {
    if (readState[notificationId]) return;
    void saveReadState({ ...readState, [notificationId]: true });
  }

  function markAllAsRead() {
    const next = { ...readState };
    notifications.forEach(item => { next[item.id] = true; });
    void saveReadState(next);
  }

  // =====================================
  // PERSIST CHAT READ STATE IN FIRESTORE
  // =====================================

  function markChatAsRead(
    orderId: string,
    messages: OrderChatMessage[]
  ) {
    if (!uid) return;

    const previouslySeen = new Set(seenMessages[orderId] ?? []);
    const newlySeen = messages.filter(message =>
      message.senderRole === "customer" &&
      message.senderUid !== uid &&
      !previouslySeen.has(message.id)
    ).map(message => message.id);

    if (!newlySeen.length) return;

    setSeenMessages(current => ({
      ...current,
      [orderId]: Array.from(new Set([
        ...(current[orderId] ?? []),
        ...newlySeen,
      ])),
    }));

    void markChatMessagesSeen(uid, "staff", orderId, newlySeen)
      .then(() => notifySilkMartReadStateChanged())
      .catch(reason => {
        console.warn("Unable to save staff chat read state:", reason);
        setChatError(reason instanceof Error ? reason.message : "Unable to save chat read state.");
      });
  }

  // =====================================
  // SELECTED CONVERSATION
  // =====================================

  // Keep conversations with the most recent chat activity at the top.
  const newestChatFirst = useMemo(() => {
    function lastActivity(orderId: string): number {
      const messages = messageMap[orderId] ?? [];
      const last = messages[messages.length - 1];
      return last?.createdAt?.toMillis?.() ?? 0;
    }
    return [...orders].sort((a, b) => {
      const recentA = lastActivity(a.id) || Date.parse(a.createdAt) || 0;
      const recentB = lastActivity(b.id) || Date.parse(b.createdAt) || 0;
      return recentB - recentA || a.id.localeCompare(b.id);
    });
  }, [orders, messageMap]);

  const selectedOrder = orders.find(
    order => order.id === selectedOrderId
  );

  const selectedCustomer = selectedOrder
    ? customerProfiles[
        selectedOrder.customerUid
      ]
    : undefined;

  const chatMessages = selectedOrderId
    ? messageMap[selectedOrderId] ?? []
    : [];

  useEffect(() => {
    if (
      !chatOpen ||
      !selectedOrderId ||
      !preferencesReady
    ) {
      return;
    }

    const messages =
      messageMap[selectedOrderId] ?? [];

    if (messages.length > 0) {
      markChatAsRead(
        selectedOrderId,
        messages
      );
    }
  }, [
    chatOpen,
    selectedOrderId,
    messageMap,
    preferencesReady,
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
    setChatError("");
  }

  // =====================================
  // SEND ADMIN/STAFF MESSAGE
  // =====================================

  async function sendMessage() {
    if (
      !selectedOrderId ||
      !chatInput.trim() ||
      chatSaving
    ) {
      return;
    }

    const text = chatInput.trim();

    setChatSaving(true);
    setChatError("");

    try {
      await sendOrderChatMessage(
        selectedOrderId,
        text
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

  // =====================================
  // PERMANENTLY DELETE THE SELECTED ITEM
  // =====================================

  async function confirmPermanentDelete() {
    if (deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      if (notificationToDelete) {
        const id = notificationToDelete;
        await deleteNotificationRecord(uid, "staff", id);
        await saveReadState({ ...readState, [id]: true });
        setNotificationToDelete(null);
      } else if (chatMessageToDelete) {
        await deleteOrderChatMessage(chatMessageToDelete.orderId, chatMessageToDelete.id);
        setChatMessageToDelete(null);
        notifySilkMartReadStateChanged();
      }
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : "Deletion failed.");
    } finally {
      setDeleteBusy(false);
    }
  }

  // =====================================
  // EMPTY STATE
  // =====================================

  function renderEmpty(
    icon: IconName,
    title: string,
    message: string
  ) {
    return (
      <View style={styles.emptyCard}>
        <View style={styles.emptyIcon}>
          <Ionicons
            name={icon}
            size={37}
            color={GREEN}
          />
        </View>

        <Text style={S.sectionTitle}>
          {title}
        </Text>

        <Text style={styles.emptyText}>
          {message}
        </Text>
      </View>
    );
  }

  // =====================================
  // SCREEN
  // =====================================

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
          description="Order, delivery, and customer conversation updates in one place."
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabs}
        >
          {TABS.map(item => {
            const active = tab === item;

            let count = 0;

            if (item === "All") {
              count = notifications.length;
            }

            if (item === "Unread") {
              count = unreadNotificationCount;
            }

            if (item === "Orders") {
              count = notifications.length;
            }

            if (item === "Chat") {
              count = unreadChatCount;
            }

            return (
              <Pressable
                key={item}
                onPress={() => setTab(item)}
                style={[
                  S.chip,
                  active && S.chipActive,
                ]}
              >
                <Text
                  style={{
                    color: active
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

        {!authReady ||
        checkingAccess ||
        (authorized &&
          (loading || !preferencesReady || !notificationRecordsReady)) ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator
              color={GREEN}
              size="large"
            />

            <Text style={S.muted}>
              Loading SilkMart notifications...
            </Text>
          </View>
        ) : !user ? (
          renderEmpty(
            "lock-closed-outline",
            "Sign in required",
            "Please sign in with an authorized SilkMart Admin or Staff account."
          )
        ) : !authorized ? (
          renderEmpty(
            "shield-outline",
            "Access restricted",
            "Only authorized SilkMart Admin and Staff accounts can access these notifications."
          )
        ) : error ? (
          renderEmpty(
            "alert-circle-outline",
            "Unable to load updates",
            error
          )
        ) : tab === "Chat" ? (
          <Fade delay={120}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>
                Customer Conversations
              </Text>

              <Text style={styles.sectionDescription}>
                Open an order to read and reply
                to customer messages.
              </Text>
            </View>

            {orders.length === 0
              ? renderEmpty(
                  "chatbubbles-outline",
                  "No conversations yet",
                  "Customer order conversations will appear here when orders are placed."
                )
              : newestChatFirst.map(order => {
                  const customer =
                    customerProfiles[
                      order.customerUid
                    ];

                  const messages =
                    messageMap[order.id] ?? [];

                  const latest =
                    messages[
                      messages.length - 1
                    ];

                  const unread =
                    unreadChatsByOrder[
                      order.id
                    ] ?? 0;

                  return (
                    <View
                      key={order.id}
                      style={styles.conversationCard}
                    >
                      <View
                        style={styles.conversationIcon}
                      >
                        <Ionicons
                          name="chatbubbles-outline"
                          size={23}
                          color={GREEN}
                        />
                      </View>

                      <View style={{ flex: 1 }}>
                        <Text
                          style={styles.conversationEyebrow}
                          numberOfLines={1}
                        >
                          ORDER #{order.id}
                        </Text>

                        <Text style={styles.customerName}>
                          {customer?.fullName ||
                            "SilkMart Customer"}
                        </Text>

                        <Text style={styles.productName}>
                          {productTitle(order)}
                        </Text>

                        <Text
                          style={styles.conversationMeta}
                        >
                          Order: {order.status}
                        </Text>

                        {!!latest && (
                          <Text
                            style={styles.messagePreview}
                            numberOfLines={2}
                          >
                            {latest.senderRole ===
                            "customer"
                              ? "Customer: "
                              : "Staff: "}
                            {latest.text}
                          </Text>
                        )}

                        <Pressable
                          onPress={() =>
                            openChat(order)
                          }
                          style={styles.openChatButton}
                        >
                          <Ionicons
                            name="chatbubble-ellipses-outline"
                            color="#FFFFFF"
                            size={16}
                          />

                          <Text style={styles.openChatText}>
                            Open Chat
                          </Text>

                          {unread > 0 && (
                            <View
                              style={styles.unreadBadge}
                            >
                              <Text
                                style={styles.unreadBadgeText}
                              >
                                {unread > 99
                                  ? "99+"
                                  : unread}
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
                  ? "Unread order updates"
                  : "Order updates"}
              </Text>

              {unreadNotificationCount > 0 && (
                <Pressable
                  onPress={markAllAsRead}
                  style={styles.markAll}
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

            {filteredNotifications.length === 0
              ? renderEmpty(
                  "notifications-outline",
                  tab === "Unread"
                    ? "No unread order updates"
                    : "You're all caught up",
                  "New order and delivery updates will appear here."
                )
              : filteredNotifications.map(item => {
                  const unread =
                    !readState[item.id];

                  const relatedOrder =
                    orders.find(
                      order =>
                        order.id === item.orderId
                    );

                  return (
                    <Pressable
                      key={item.id}
                      style={[
                        styles.notificationCard,
                        unread &&
                          styles.unreadNotification,
                      ]}
                      onPress={() =>
                        markNotificationAsRead(
                          item.id
                        )
                      }
                    >
                      <View
                        style={styles.notificationIcon}
                      >
                        <Ionicons
                          name={item.icon}
                          color={GREEN}
                          size={23}
                        />
                      </View>

                      <View style={{ flex: 1 }}>
                        <View
                          style={styles.notificationTop}
                        >
                          <Text
                            style={styles.notificationTitle}
                          >
                            {item.title}
                          </Text>

                          {unread && (
                            <View
                              style={styles.unreadDot}
                            />
                          )}
                        </View>

                        <Text
                          style={styles.notificationBody}
                        >
                          {item.message}
                        </Text>

                        <Text
                          style={styles.notificationTime}
                        >
                          {displayTime(
                            item.timestamp
                          )}
                        </Text>

                        {relatedOrder && (
                          <Pressable
                            onPress={() => {
                              markNotificationAsRead(
                                item.id
                              );

                              openChat(
                                relatedOrder
                              );
                            }}
                            style={styles.replyLink}
                          >
                            <Ionicons
                              name="chatbubble-outline"
                              size={15}
                              color={GREEN}
                            />

                            <Text
                              style={styles.replyLinkText}
                            >
                              Open Order Conversation
                            </Text>
                          </Pressable>
                        )}
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Permanently delete this notification"
                        onPress={event => { event.stopPropagation(); setNotificationToDelete(item.id); }}
                        style={{ padding: 8, alignSelf: "flex-start" }}
                      >
                        <Ionicons name="trash-outline" size={19} color={RED} />
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
              color={GREEN}
              size={20}
            />

            <Text style={styles.infoText}>
              Orders and conversations are
              synchronized through Cloud Firestore.
              Read indicators are stored locally
              for this staff account.
            </Text>
          </View>
        )}
      </ScrollView>


      {/* =====================================
          ADMIN / STAFF CHAT MODAL
          ===================================== */}

      <Modal
        visible={chatOpen && !!selectedOrder}
        transparent
        animationType="fade"
        onRequestClose={closeChat}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
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
                onPress={closeChat}
                disabled={chatSaving}
              >
                <Ionicons
                  name="arrow-back"
                  color={GREEN}
                  size={21}
                />
              </Pressable>

              <View style={{ flex: 1 }}>
                <Text style={styles.chatEyebrow}>
                  SILKMART MESSAGES
                </Text>

                <Text style={styles.chatTitle}>
                  {selectedCustomer?.fullName ||
                    "Customer Chat"}
                </Text>

                <Text
                  style={styles.chatOrderId}
                  numberOfLines={1}
                >
                  Order #{selectedOrderId}
                </Text>
              </View>

              <Ionicons
                name="chatbubbles-outline"
                color={GREEN}
                size={24}
              />
            </View>

            <View style={styles.recipientRow}>
              <View style={styles.recipientAvatar}>
                <Ionicons
                  name="person-outline"
                  size={21}
                  color={GREEN}
                />
              </View>

              <View style={{ flex: 1 }}>
                <Text style={styles.recipientName}>
                  {selectedCustomer?.fullName ||
                    "SilkMart Customer"}
                </Text>

                <Text style={styles.recipientDetails}>
                  {selectedCustomer?.email ||
                    "Customer order conversation"}
                </Text>
              </View>
            </View>

            <ScrollView
              ref={chatScrollRef}
              style={styles.chatMessages}
              contentContainerStyle={
                styles.chatMessagesContent
              }
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={() => {
                chatScrollRef.current?.scrollToEnd({
                  animated: false,
                });
              }}
            >
              {chatMessages.length === 0 ? (
                <View style={styles.chatEmpty}>
                  <Ionicons
                    name="chatbubbles-outline"
                    size={40}
                    color={GREEN}
                  />

                  <Text style={styles.chatEmptyTitle}>
                    Start a conversation
                  </Text>

                  <Text style={styles.chatEmptyText}>
                    Message the customer about
                    their order, delivery schedule,
                    or a proposed rescheduling date.
                  </Text>
                </View>
              ) : (
                chatMessages.map(message => {
                  const fromMe =
                    message.senderUid === uid;

                  return (
                    <View
                      key={message.id}
                      style={[
                        styles.messageRow,
                        fromMe
                          ? styles.messageRight
                          : styles.messageLeft,
                      ]}
                    >
                      <View
                        style={[
                          styles.messageBubble,
                          fromMe
                            ? styles.staffBubble
                            : styles.customerBubble,
                        ]}
                      >
                        <Text
                          style={[
                            styles.messageBody,
                            fromMe &&
                              styles.staffMessageBody,
                          ]}
                        >
                          {message.text}
                        </Text>

                        {fromMe && (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Permanently delete this message"
                            onPress={() => setChatMessageToDelete(message)}
                            style={{ alignSelf: "flex-end", padding: 5 }}
                          >
                            <Ionicons name="trash-outline" size={15} color={fromMe ? "#FFFFFF" : RED} />
                          </Pressable>
                        )}

                        <Text
                          style={[
                            styles.messageTime,
                            fromMe &&
                              styles.staffMessageTime,
                          ]}
                        >
                          {fromMe
                            ? "You"
                            : message.senderRole ===
                                "staff"
                              ? "SilkMart Staff"
                              : "Customer"}{" "}
                          ·{" "}
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

            <View style={styles.chatComposer}>
              {!!chatError && (
                <Text style={styles.errorText}>
                  {chatError}
                </Text>
              )}

              <View style={styles.chatInputRow}>
                <TextInput
                  style={styles.chatInput}
                  value={chatInput}
                  onChangeText={setChatInput}
                  placeholder="Type a message..."
                  placeholderTextColor="#91A198"
                  multiline
                  maxLength={
                    MAX_CHAT_MESSAGE_LENGTH
                  }
                  editable={!chatSaving}
                  textAlignVertical="top"
                />

                <Pressable
                  disabled={
                    chatSaving ||
                    !chatInput.trim()
                  }
                  onPress={() =>
                    void sendMessage()
                  }
                  style={[
                    styles.sendButton,
                    (chatSaving ||
                      !chatInput.trim()) &&
                      styles.disabledButton,
                  ]}
                >
                  {chatSaving ? (
                    <ActivityIndicator
                      color="#FFFFFF"
                      size="small"
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
                Messages are saved to this
                order's Firestore conversation.
              </Text>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal
        visible={notificationToDelete !== null || chatMessageToDelete !== null}
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
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 22 }}>
          <View style={{ backgroundColor: SURFACE, borderRadius: 18, padding: 22, gap: 14 }}>
            <Ionicons name="trash-outline" size={27} color={RED} />
            <Text style={{ color: DARK, fontSize: 19, fontWeight: "700" }}>Delete permanently?</Text>
            <Text style={{ color: MUTED, lineHeight: 20 }}>
              Only the selected {chatMessageToDelete ? "message that you sent" : "notification"} will be deleted from Firestore. The order and other messages remain unchanged. This cannot be undone.
            </Text>
            {!!deleteError && <Text style={{ color: RED }}>{deleteError}</Text>}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                disabled={deleteBusy}
                onPress={() => {
                  setNotificationToDelete(null);
                  setChatMessageToDelete(null);
                  setDeleteError("");
                }}
                style={{ flex: 1, borderColor: LINE, borderWidth: 1, padding: 13, borderRadius: 10, alignItems: "center" }}
              ><Text style={{ color: DARK }}>Cancel</Text></Pressable>
              <Pressable
                disabled={deleteBusy}
                onPress={() => void confirmPermanentDelete()}
                style={{ flex: 1, backgroundColor: RED, padding: 13, borderRadius: 10, alignItems: "center" }}
              ><Text style={{ color: "white", fontWeight: "700" }}>{deleteBusy ? "Deleting..." : "Delete"}</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>

    </>
  );
}

// =====================================
// STYLES
// =====================================

const styles = StyleSheet.create({
  tabs: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 17,
    paddingRight: 10,
  },

  loadingBox: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 55,
    gap: 14,
  },

  sectionHeader: {
    marginBottom: 16,
  },

  sectionTitle: {
    fontFamily: "serif",
    fontSize: 20,
    color: DARK,
  },

  sectionDescription: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 19,
    marginTop: 5,
  },

  toolbar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  },

  markAll: {
    flexDirection: "row",
    gap: 5,
    alignItems: "center",
    paddingVertical: 7,
  },

  markAllText: {
    fontSize: 11,
    fontWeight: "700",
    color: GREEN,
  },

  emptyCard: {
    ...S.card,
    alignItems: "center",
    paddingVertical: 40,
    paddingHorizontal: 20,
  },

  emptyIcon: {
    width: 80,
    height: 80,
    backgroundColor: SOFT,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 15,
  },

  emptyText: {
    ...S.muted,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 20,
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

  unreadNotification: {
    backgroundColor: "#F0F7EC",
    borderColor: "#B7CFB7",
  },

  notificationIcon: {
    width: 43,
    height: 43,
    borderRadius: 13,
    backgroundColor: SOFT,
    alignItems: "center",
    justifyContent: "center",
  },

  notificationTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 9,
  },

  notificationTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    color: DARK,
  },

  unreadDot: {
    height: 8,
    width: 8,
    borderRadius: 4,
    backgroundColor: GREEN,
    marginTop: 4,
  },

  notificationBody: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 19,
    marginTop: 7,
  },

  notificationTime: {
    fontSize: 10,
    color: "#85978B",
    marginTop: 10,
  },

  replyLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 12,
  },

  replyLinkText: {
    fontSize: 11,
    fontWeight: "700",
    color: GREEN,
  },

  conversationCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 17,
    padding: 15,
    marginBottom: 12,
  },

  conversationIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: SOFT,
    alignItems: "center",
    justifyContent: "center",
  },

  conversationEyebrow: {
    color: MUTED,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.5,
  },

  customerName: {
    color: DARK,
    fontSize: 15,
    fontWeight: "700",
    marginTop: 5,
  },

  productName: {
    color: GREEN,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 4,
  },

  conversationMeta: {
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

  openChatButton: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    backgroundColor: GREEN,
    borderRadius: 11,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 13,
  },

  openChatText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },

  unreadBadge: {
    minWidth: 19,
    height: 19,
    borderRadius: 10,
    paddingHorizontal: 4,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },

  unreadBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: GREEN,
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

  errorText: {
    color: RED,
    fontSize: 11,
    marginBottom: 8,
  },

  // =====================================
  // CHAT MODAL
  // =====================================

  modalBackdrop: {
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
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: LINE,
  },

  closeButton: {
    width: 35,
    height: 35,
    borderRadius: 18,
    backgroundColor: SOFT,
    alignItems: "center",
    justifyContent: "center",
  },

  chatEyebrow: {
    color: GREEN,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.5,
  },

  chatTitle: {
    color: DARK,
    fontFamily: "serif",
    fontSize: 22,
    marginTop: 4,
  },

  chatOrderId: {
    color: MUTED,
    fontSize: 10,
    marginTop: 4,
  },

  recipientRow: {
    flexDirection: "row",
    gap: 11,
    alignItems: "center",
    padding: 13,
    backgroundColor: "#F5F8F1",
    borderBottomWidth: 1,
    borderBottomColor: LINE,
  },

  recipientAvatar: {
    width: 43,
    height: 43,
    borderRadius: 22,
    backgroundColor: "#E2EDDF",
    alignItems: "center",
    justifyContent: "center",
  },

  recipientName: {
    color: DARK,
    fontSize: 13,
    fontWeight: "700",
  },

  recipientDetails: {
    color: MUTED,
    fontSize: 10,
    marginTop: 4,
  },

  chatMessages: {
    flex: 1,
  },

  chatMessagesContent: {
    padding: 15,
    paddingBottom: 24,
    flexGrow: 1,
    justifyContent: "flex-end",
    gap: 12,
  },

  chatEmpty: {
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    padding: 25,
  },

  chatEmptyTitle: {
    fontFamily: "serif",
    fontSize: 22,
    color: DARK,
    marginTop: 15,
  },

  chatEmptyText: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 20,
    textAlign: "center",
    marginTop: 9,
  },

  messageRow: {
    width: "100%",
    flexDirection: "row",
  },

  messageRight: {
    justifyContent: "flex-end",
  },

  messageLeft: {
    justifyContent: "flex-start",
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

  messageBody: {
    color: DARK,
    fontSize: 12,
    lineHeight: 19,
  },

  staffMessageBody: {
    color: "#FFFFFF",
  },

  messageTime: {
    color: MUTED,
    fontSize: 9,
    marginTop: 8,
  },

  staffMessageTime: {
    color: "#DCEDE1",
  },

  chatComposer: {
    padding: 12,
    gap: 7,
    borderTopWidth: 1,
    borderTopColor: LINE,
  },

  chatInputRow: {
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
    alignItems: "center",
    justifyContent: "center",
  },

  disabledButton: {
    opacity: 0.5,
  },

  composerHint: {
    color: MUTED,
    fontSize: 10,
    textAlign: "center",
  },
});