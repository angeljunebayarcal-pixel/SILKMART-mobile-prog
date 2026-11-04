import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type { ScrollViewInstance } from "react-native";

import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import {
  onAuthStateChanged,
  type User,
} from "firebase/auth";

import {
  collection,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

import { auth, db } from "../../firebase/config";
import { notifySilkMartReadStateChanged } from "../../lib/useNotificationCounts";
import { useNotificationPreferences, markNotificationsRead, markChatMessagesSeen } from "../../lib/notificationPreferences";
import {
  useFirestoreNotificationRecords,
  deleteNotificationRecord,
} from "../../lib/notificationRecords";

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
// COLORS
// =====================================

const GREEN = "#235F45";
const DARK = "#173B2C";
const MUTED = "#627C6E";
const CREAM = "#FAF9F1";
const SURFACE = "#FFFDF8";
const LINE = "#D5DDCF";
const SOFT = "#EAF2E8";
const RED = "#B34D4D";

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

type CustomerNotification = {
  id: string;
  orderId: string;
  title: string;
  message: string;
  icon: IconName;
  timestamp: number;
};

type ReadState = Record<string, boolean>;

type SeenMessages = Record<string, string[]>;

const TABS: NotificationTab[] = [
  "All",
  "Unread",
  "Orders",
  "Chat",
];

// =====================================
// HELPERS
// =====================================

function timestampToMillis(value: unknown): number {
  if (!value) return 0;

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
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

function displayDate(value?: string): string {
  if (!value) return "Not yet scheduled";

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

function displayTime(value: number): string {
  if (!value) return "Recently";

  return new Date(value).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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
  const millis = timestampToMillis(value);
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
// BUILD ORDER NOTIFICATIONS
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
): CustomerNotification[] {
  const notifications: CustomerNotification[] = [];

  for (const order of orders) {
    const product = productTitle(order);
    const createdAt = timestampToMillis(
      order.createdAt
    );

    const quantity = (order.items ?? []).reduce(
      (total, item) =>
        total + Number(item.quantity || 0),
      0
    );

    function add(
      id: string,
      title: string,
      message: string,
      icon: IconName,
      time = createdAt
    ) {
      notifications.push({
        id,
        orderId: order.id,
        title,
        message,
        icon,
        timestamp: time,
      });
    }

    // ORDER PLACED

    add(
      `placed:${order.id}`,
      "Order placed successfully",
      `Your order for ${quantity} item(s), including ${product}, has been received. Preferred delivery: ${displayDate(
        order.preferredDeliveryDate
      )}.`,
      "bag-check-outline"
    );

    // ORDER CONFIRMED

    if (order.status === "Confirmed") {
      add(
        `confirmed:${order.id}`,
        "Order confirmed",
        `SilkMart staff has confirmed your order for ${product}.`,
        "checkmark-circle-outline",
        timestampToMillis(order.decisionAt) || createdAt
      );
    }

    // ORDER REJECTED

    if (order.status === "Rejected") {
      add(
        `rejected:${order.id}`,
        "Order rejected",
        `Your order for ${product} was not approved. You can contact SilkMart staff through the Chat tab.`,
        "close-circle-outline",
        timestampToMillis(order.decisionAt) || createdAt
      );

      continue;
    }

    // DELIVERY SCHEDULED

    const hasSchedule =
      !!order.confirmedDeliveryDate &&
      order.deliveryStatus !== "Pending";

    if (hasSchedule) {
      add(
        `scheduled:${order.id}:${order.confirmedDeliveryDate}`,
        "Delivery schedule confirmed",
        `Your order for ${product} is scheduled for ${displayDate(
          order.confirmedDeliveryDate
        )}.`,
        "calendar-outline",
        timestampToMillis(order.scheduledAt) || createdAt
      );
    }

    // ORDER PREPARING

    if (
      order.deliveryStatus === "Preparing" ||
      order.deliveryStatus === "Out for Delivery" ||
      order.deliveryStatus === "Delivered"
    ) {
      add(
        `preparing:${order.id}`,
        "Your order is being prepared",
        `SilkMart staff is preparing your order for ${product}.`,
        "cube-outline",
        timestampToMillis(order.preparingAt) || createdAt
      );
    }

    // OUT FOR DELIVERY

    if (
      order.deliveryStatus === "Out for Delivery" ||
      order.deliveryStatus === "Delivered"
    ) {
      add(
        `dispatched:${order.id}`,
        "Your order is out for delivery",
        `Your SilkMart order for ${product} has been marked as out for delivery.`,
        "car-outline",
        timestampToMillis(order.dispatchedAt) || createdAt
      );
    }

    // DELIVERED

    if (order.deliveryStatus === "Delivered") {
      add(
        `delivered:${order.id}`,
        "Order delivered",
        `Your order for ${product} has been marked as delivered. Thank you for ordering from SilkMart!`,
        "checkmark-done-circle-outline",
        timestampToMillis(order.deliveredAt) || createdAt
      );
    }
  }

  return notifications.sort(
    (a, b) =>
      b.timestamp - a.timestamp ||
      eventPriority(b.id) - eventPriority(a.id) ||
      a.id.localeCompare(b.id)
  );
}

// =====================================
// ANIMATION
// =====================================

function FadeUp({
  children,
  delay = 0,
}: {
  children: React.ReactNode;
  delay?: number;
}) {
  const opacity = useRef(
    new Animated.Value(0)
  ).current;

  const translateY = useRef(
    new Animated.Value(18)
  ).current;

  useEffect(() => {
    const animation = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        delay,
        duration: 520,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        delay,
        duration: 520,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);

    animation.start();

    return () => animation.stop();
  }, [opacity, translateY, delay]);

  return (
    <Animated.View
      style={{
        opacity,
        transform: [{ translateY }],
      }}
    >
      {children}
    </Animated.View>
  );
}

// =====================================
// MAIN SCREEN
// =====================================

export default function CustomerNotificationsScreen() {
  const router = useRouter();

  const [user, setUser] =
    useState<User | null>(auth.currentUser);

  const [authReady, setAuthReady] =
    useState(false);

  const [tab, setTab] =
    useState<NotificationTab>("All");

  const [orders, setOrders] =
    useState<DemoOrder[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");



  const [notificationToDelete, setNotificationToDelete] = useState<string | null>(null);
  const [chatMessageToDelete, setChatMessageToDelete] = useState<OrderChatMessage | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");



  const [messageMap, setMessageMap] =
    useState<Record<string, OrderChatMessage[]>>({});



  // CHAT

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

        setOrders([]);
        setMessageMap({});
        setSelectedOrderId(null);
        setChatOpen(false);
        setChatInput("");
        setError("");
      }
    );
  }, []);

  const uid = user?.uid ?? "";

  // =====================================
  // FIRESTORE READ AND CHAT PREFERENCES
  // =====================================

  const {
    readState,
    seenMessages,
    ready: preferencesReady,
    error: preferenceError,
  } = useNotificationPreferences(uid, "customer");

  // =====================================
  // LISTEN TO CUSTOMER ORDERS
  // =====================================

  useEffect(() => {
    if (!uid) {
      setOrders([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    const ordersQuery = query(
      collection(db, "orders"),
      where("customerUid", "==", uid)
    );

    const unsubscribe = onSnapshot(
      ordersQuery,
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
            ? "Firebase denied access to your orders. Please check the Firestore rules."
            : "Unable to load your notifications. Check your connection."
        );
      }
    );

    return unsubscribe;
  }, [uid]);

  // =====================================
  // LISTEN TO ORDER CONVERSATIONS
  // =====================================

  const orderIdsKey = useMemo(() => {
    return orders
      .map(order => order.id)
      .sort()
      .join("|");
  }, [orders]);

  useEffect(() => {
    if (!uid || !preferencesReady) {
      return;
    }

    const orderIds = orderIdsKey
      ? orderIdsKey.split("|")
      : [];

    let active = true;

    setMessageMap({});

    const unsubscribers = orderIds.map(
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
              `Unable to load order chat ${orderId}:`,
              reason.message
            );

            if (selectedOrderId === orderId) {
              setChatError(reason.message);
            }
          }
        )
    );

    return () => {
      active = false;

      unsubscribers.forEach(
        unsubscribe => unsubscribe()
      );
    };
  }, [uid, orderIdsKey, preferencesReady]);

  // =====================================
  // NOTIFICATION DATA
  // =====================================

  const allNotifications = useMemo(
    () => buildNotifications(orders),
    [orders]
  );

  const { visible: persistedNotifications,
    error: notificationStoreError } = useFirestoreNotificationRecords(
    uid,
    "customer",
    allNotifications
  );

  const notifications = useMemo(
    () => allNotifications.filter(notification =>
      persistedNotifications.some(saved => saved.id === notification.id)
    ),
    [allNotifications, persistedNotifications]
  );

  const unreadNotifications =
    notifications.filter(
      item => !readState[item.id]
    );

  const unreadNotificationCount =
    unreadNotifications.length;

  // =====================================
  // CHAT UNREAD COUNTS
  // =====================================

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
          message.senderRole === "staff" &&
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

  // =====================================
  // MARK NOTIFICATIONS AS READ
  // =====================================

  async function saveReadState(next: ReadState) {
    if (!uid) return;
    try {
      const ids = Object.keys(next).filter(id => next[id] && !readState[id]);
      await markNotificationsRead(uid, "customer", ids);
      notifySilkMartReadStateChanged();
    } catch (reason) {
      console.warn("Unable to save notification read status:", reason);
      setError("Unable to save your read status. Check your connection and Firestore permissions.");
    }
  }

  function markNotificationAsRead(id: string) {
    if (readState[id]) return;
    void saveReadState({ ...readState, [id]: true });
  }

  function markAllAsRead() {
    const next = { ...readState };
    notifications.forEach(item => { next[item.id] = true; });
    void saveReadState(next);
  }

  // =====================================
  // MARK ORDER CHAT AS READ IN FIRESTORE
  // =====================================

  async function markChatAsRead(orderId: string, messages: OrderChatMessage[]) {
    if (!uid) return;
    const seen = new Set(seenMessages[orderId] ?? []);
    const newIds = messages
      .filter(message => message.senderRole === "staff" &&
        message.senderUid !== uid && !seen.has(message.id))
      .map(message => message.id);
    if (!newIds.length) return;
    try {
      await markChatMessagesSeen(uid, "customer", orderId, newIds);
      notifySilkMartReadStateChanged();
    } catch (reason) {
      console.warn("Unable to save chat seen state:", reason);
      setChatError("Unable to save chat read status. Please try again.");
    }
  }

  // =====================================
  // SELECTED CHAT
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

  const chatMessages = selectedOrderId
    ? messageMap[selectedOrderId] ?? []
    : [];

  // Keep opened conversation marked as read
  // when new staff messages arrive.

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
      void markChatAsRead(
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
    setChatError("");
    setChatInput("");
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
  // SEND CUSTOMER MESSAGE
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
          : "Unable to send your message."
      );
    } finally {
      setChatSaving(false);
    }
  }

  // =====================================
  // FILTERED NOTIFICATIONS
  // =====================================

  const filteredNotifications = useMemo(() => {
    if (tab === "Unread") {
      return notifications.filter(
        item => !readState[item.id]
      );
    }

    return notifications;
  }, [notifications, readState, tab]);

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
        await deleteNotificationRecord(uid, "customer", id);
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
        <View style={styles.iconCircle}>
          <Ionicons
            name={icon}
            size={38}
            color={GREEN}
          />
        </View>

        <Text style={styles.emptyTitle}>
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
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.header}>
        <Pressable
          style={styles.back}
          onPress={() =>
            router.push(
              "/customer/shopsilk"
            )
          }
        >
          <Ionicons
            name="arrow-back"
            size={21}
            color={GREEN}
          />
        </Pressable>

        <Text style={styles.headerTitle}>
          Notifications
        </Text>

        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <FadeUp delay={90}>
          <Text style={styles.eyebrow}>
            STAY INFORMED
          </Text>

          <Text style={styles.title}>
            Your updates.
          </Text>

          <Text style={styles.intro}>
            Stay informed about your orders,
            delivery schedules, and messages
            from SilkMart staff.
          </Text>
        </FadeUp>

        <FadeUp delay={180}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabs}
          >
            {TABS.map(item => {
              const active = tab === item;

              let count = 0;

              if (item === "All") {
                count =
                  notifications.length;
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
                  onPress={() =>
                    setTab(item)
                  }
                  style={({ pressed }) => [
                    styles.tab,
                    active &&
                      styles.activeTab,
                    pressed && {
                      opacity: 0.8,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.tabText,
                      active &&
                        styles.activeTabText,
                    ]}
                  >
                    {item} ({count})
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </FadeUp>

        {!authReady || loading || !preferencesReady ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator
              color={GREEN}
              size="large"
            />

            <Text style={styles.loadingText}>
              Loading your SilkMart updates...
            </Text>
          </View>
        ) : !user ? (
          <FadeUp delay={250}>
            {renderEmpty(
              "person-outline",
              "Sign in for updates",
              "Sign in to view your orders, delivery notifications, and conversations."
            )}

            <Pressable
              style={styles.loginButton}
              onPress={() =>
                router.push("/login")
              }
            >
              <Text
                style={styles.loginButtonText}
              >
                Go to Login
              </Text>
            </Pressable>
          </FadeUp>
        ) : error || preferenceError ? (
          <View style={styles.emptyCard}>
            <Ionicons
              name="alert-circle-outline"
              size={39}
              color={RED}
            />

            <Text style={styles.emptyTitle}>
              Unable to load updates
            </Text>

            <Text style={styles.emptyText}>
              {error || preferenceError}
            </Text>
          </View>
        ) : tab === "Chat" ? (
          <FadeUp delay={220}>
            <View style={styles.sectionHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>
                  Order Conversations
                </Text>

                <Text style={styles.sectionDescription}>
                  Chat with SilkMart staff about
                  your orders and delivery requests.
                </Text>
              </View>
            </View>

            {orders.length === 0
              ? renderEmpty(
                  "chatbubbles-outline",
                  "No conversations yet",
                  "Once you place an order, you can contact SilkMart staff here."
                )
              : newestChatFirst.map(order => {
                  const unread =
                    unreadChatsByOrder[
                      order.id
                    ] ?? 0;

                  const messages =
                    messageMap[
                      order.id
                    ] ?? [];

                  const latest =
                    messages[
                      messages.length - 1
                    ];

                  return (
                    <View
                      key={order.id}
                      style={
                        styles.conversationCard
                      }
                    >
                      <View
                        style={
                          styles.conversationIcon
                        }
                      >
                        <Ionicons
                          name="chatbubbles-outline"
                          size={24}
                          color={GREEN}
                        />
                      </View>

                      <View
                        style={{
                          flex: 1,
                        }}
                      >
                        <Text
                          style={
                            styles.conversationEyebrow
                          }
                          numberOfLines={1}
                        >
                          ORDER #{order.id}
                        </Text>

                        <Text
                          style={
                            styles.conversationTitle
                          }
                        >
                          {productTitle(
                            order
                          )}
                        </Text>

                        <Text
                          style={
                            styles.conversationMeta
                          }
                        >
                          Order: {order.status}
                        </Text>

                        {!!latest && (
                          <Text
                            style={
                              styles.conversationPreview
                            }
                            numberOfLines={2}
                          >
                            {latest.senderRole ===
                            "staff"
                              ? "SilkMart: "
                              : "You: "}
                            {latest.text}
                          </Text>
                        )}

                        <Pressable
                          onPress={() =>
                            openChat(order)
                          }
                          style={
                            styles.openChatButton
                          }
                        >
                          <Ionicons
                            name="chatbubble-ellipses-outline"
                            size={16}
                            color="#FFFFFF"
                          />

                          <Text
                            style={
                              styles.openChatText
                            }
                          >
                            Open Chat
                          </Text>

                          {unread > 0 && (
                            <View
                              style={
                                styles.unreadBadge
                              }
                            >
                              <Text
                                style={
                                  styles.unreadBadgeText
                                }
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
          </FadeUp>
        ) : (
          <FadeUp delay={220}>
            <View style={styles.notificationToolbar}>
              <Text style={styles.sectionTitle}>
                {tab === "Unread"
                  ? "Unread updates"
                  : "Order updates"}
              </Text>

              {unreadNotificationCount > 0 && (
                <Pressable
                  onPress={markAllAsRead}
                  style={styles.markAllButton}
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
                    ? "No unread notifications"
                    : "You're all caught up",
                  tab === "Unread"
                    ? "You have no unread order updates."
                    : "Your order and delivery updates will appear here."
                )
              : filteredNotifications.map(
                  notification => {
                    const unread =
                      !readState[
                        notification.id
                      ];

                    return (
                      <Pressable
                        key={
                          notification.id
                        }
                        onPress={() => {
                          markNotificationAsRead(
                            notification.id
                          );

                          router.push(
                            "/customer/order"
                          );
                        }}
                        style={({ pressed }) => [
                          styles.notificationCard,
                          unread &&
                            styles.unreadNotification,
                          pressed && {
                            opacity: 0.85,
                          },
                        ]}
                      >
                        <View
                          style={
                            styles.notificationIcon
                          }
                        >
                          <Ionicons
                            name={
                              notification.icon
                            }
                            size={23}
                            color={GREEN}
                          />
                        </View>

                        <View
                          style={{
                            flex: 1,
                          }}
                        >
                          <View
                            style={
                              styles.notificationTop
                            }
                          >
                            <Text
                              style={
                                styles.notificationTitle
                              }
                            >
                              {notification.title}
                            </Text>

                            {unread && (
                              <View
                                style={
                                  styles.unreadDot
                                }
                              />
                            )}
                          </View>

                          <Text
                            style={
                              styles.notificationMessage
                            }
                          >
                            {notification.message}
                          </Text>

                          <Text
                            style={
                              styles.notificationTime
                            }
                          >
                            {displayTime(
                              notification.timestamp
                            )}
                          </Text>

                          <Text
                            style={
                              styles.viewOrderText
                            }
                          >
                            View My Orders →
                          </Text>
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Permanently delete this notification"
                          onPress={event => { event.stopPropagation(); setNotificationToDelete(notification.id); }}
                          style={{ padding: 8, alignSelf: "flex-start" }}
                        >
                          <Ionicons name="trash-outline" size={19} color={RED} />
                        </Pressable>
                      </Pressable>
                    );
                  }
                )}
          </FadeUp>
        )}

        {user && (
          <View style={styles.tip}>
            <Ionicons
              name="shield-checkmark-outline"
              size={20}
              color={GREEN}
            />

            <Text style={styles.tipText}>
              Your order updates and
              conversations are connected to
              your SilkMart account.
              Conversation access is controlled
              by Firestore Security Rules.
            </Text>
          </View>
        )}
      </ScrollView>



      {/* =====================================
          CUSTOMER CHAT MODAL
          ===================================== */}

      <Modal
        visible={
          chatOpen &&
          !!selectedOrder
        }
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
                onPress={closeChat}
                disabled={chatSaving}
                style={styles.closeButton}
              >
                <Ionicons
                  name="arrow-back"
                  size={21}
                  color={GREEN}
                />
              </Pressable>

              <View style={{ flex: 1 }}>
                <Text
                  style={styles.chatEyebrow}
                >
                  SILKMART MESSAGES
                </Text>

                <Text
                  style={styles.chatTitle}
                >
                  Chat with SilkMart
                </Text>

                <Text
                  style={styles.chatOrderId}
                  numberOfLines={1}
                >
                  Order #{selectedOrderId}
                </Text>
              </View>

              <Ionicons
                name="people-outline"
                size={25}
                color={GREEN}
              />
            </View>

            <View style={styles.recipientRow}>
              <View
                style={styles.staffAvatar}
              >
                <Ionicons
                  name="people-outline"
                  size={22}
                  color={GREEN}
                />
              </View>

              <View style={{ flex: 1 }}>
                <Text
                  style={styles.recipientName}
                >
                  SilkMart Admin / Staff
                </Text>

                <Text
                  style={styles.recipientDescription}
                >
                  Order-specific conversation
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

                  <Text
                    style={styles.chatEmptyTitle}
                  >
                    Start a conversation
                  </Text>

                  <Text
                    style={styles.chatEmptyText}
                  >
                    Ask SilkMart staff about
                    your order, products,
                    or delivery schedule.
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
                        styles.chatMessageRow,
                        fromMe
                          ? styles.messageRight
                          : styles.messageLeft,
                      ]}
                    >
                      <View
                        style={[
                          styles.messageBubble,
                          fromMe
                            ? styles.customerBubble
                            : styles.staffBubble,
                        ]}
                      >
                        <Text
                          style={[
                            styles.messageBody,
                            fromMe &&
                              styles.customerMessageBody,
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
                              styles.customerMessageTime,
                          ]}
                        >
                          {fromMe
                            ? "You"
                            : "SilkMart Staff"}{" "}
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
                  placeholder="Type your message..."
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

              <Text
                style={styles.composerHint}
              >
                Messages are saved to your
                order conversation in Firestore.
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
              Only the selected {chatMessageToDelete ? "chat message" : "notification"} will be deleted from Firestore. This cannot be undone.
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
    </View>
  );
}

// =====================================
// STYLES
// =====================================

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: CREAM,
  },

  header: {
    height: 68,
    paddingHorizontal: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: SURFACE,
    borderBottomWidth: 1,
    borderBottomColor: LINE,
  },

  back: {
    width: 36,
    height: 36,
    justifyContent: "center",
  },

  headerTitle: {
    color: DARK,
    fontFamily: "serif",
    fontSize: 23,
  },

  content: {
    padding: 22,
    paddingTop: 32,
    paddingBottom: 45,
  },

  eyebrow: {
    color: GREEN,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2,
  },

  title: {
    color: DARK,
    fontSize: 36,
    fontFamily: "serif",
    marginTop: 10,
  },

  intro: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 21,
    color: MUTED,
  },

  tabs: {
    flexDirection: "row",
    gap: 8,
    marginTop: 24,
    marginBottom: 20,
  },

  tab: {
    paddingVertical: 11,
    paddingHorizontal: 17,
    borderRadius: 20,
    backgroundColor: "#E8EFDF",
  },

  activeTab: {
    backgroundColor: GREEN,
  },

  tabText: {
    color: DARK,
    fontSize: 11,
    fontWeight: "600",
  },

  activeTabText: {
    color: "#FFFFFF",
  },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },

  sectionTitle: {
    fontSize: 19,
    fontFamily: "serif",
    color: DARK,
  },

  sectionDescription: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 19,
    marginTop: 6,
  },

  notificationToolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
  },

  markAllButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    padding: 7,
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
    borderRadius: 16,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: LINE,
    marginBottom: 10,
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
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },

  notificationTitle: {
    flex: 1,
    color: DARK,
    fontWeight: "700",
    fontSize: 13,
  },

  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: GREEN,
    marginTop: 4,
  },

  notificationMessage: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 19,
    marginTop: 7,
  },

  notificationTime: {
    color: "#85978B",
    fontSize: 10,
    marginTop: 10,
  },

  viewOrderText: {
    color: GREEN,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 10,
  },

  emptyCard: {
    borderWidth: 1,
    borderColor: LINE,
    backgroundColor: SURFACE,
    borderRadius: 20,
    marginTop: 12,
    paddingHorizontal: 26,
    paddingVertical: 38,
    alignItems: "center",
  },

  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: "#E6F0E4",
    alignItems: "center",
    justifyContent: "center",
  },

  emptyTitle: {
    fontFamily: "serif",
    fontSize: 24,
    color: DARK,
    marginTop: 20,
    textAlign: "center",
  },

  emptyText: {
    fontSize: 12,
    color: MUTED,
    lineHeight: 20,
    textAlign: "center",
    marginTop: 10,
  },

  loadingBox: {
    paddingVertical: 65,
    alignItems: "center",
    gap: 14,
  },

  loadingText: {
    color: MUTED,
    fontSize: 12,
  },

  loginButton: {
    height: 49,
    borderRadius: 25,
    backgroundColor: GREEN,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 15,
  },

  loginButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },

  tip: {
    padding: 16,
    backgroundColor: SOFT,
    borderRadius: 13,
    marginTop: 20,
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
  },

  tipText: {
    flex: 1,
    color: MUTED,
    fontSize: 11,
    lineHeight: 18,
  },

  // =====================================
  // CONVERSATIONS
  // =====================================

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

  conversationTitle: {
    color: DARK,
    fontSize: 15,
    fontWeight: "700",
    marginTop: 5,
  },

  conversationMeta: {
    color: MUTED,
    fontSize: 11,
    marginTop: 5,
  },

  conversationPreview: {
    fontSize: 11,
    color: MUTED,
    lineHeight: 17,
    marginTop: 8,
  },

  openChatButton: {
    backgroundColor: GREEN,
    borderRadius: 11,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    gap: 8,
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
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },

  unreadBadgeText: {
    color: GREEN,
    fontSize: 10,
    fontWeight: "700",
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
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: SOFT,
  },

  chatEyebrow: {
    color: GREEN,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.5,
  },

  chatTitle: {
    fontFamily: "serif",
    color: DARK,
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
    alignItems: "center",
    gap: 11,
    padding: 13,
    borderBottomWidth: 1,
    borderBottomColor: LINE,
    backgroundColor: "#F5F8F1",
  },

  staffAvatar: {
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

  recipientDescription: {
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
    color: DARK,
    fontSize: 22,
    marginTop: 15,
  },

  chatEmptyText: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 20,
    textAlign: "center",
    marginTop: 8,
  },

  chatMessageRow: {
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

  customerBubble: {
    backgroundColor: GREEN,
    borderBottomRightRadius: 4,
  },

  staffBubble: {
    backgroundColor: "#E7EFE4",
    borderBottomLeftRadius: 4,
  },

  messageBody: {
    fontSize: 12,
    color: DARK,
    lineHeight: 19,
  },

  customerMessageBody: {
    color: "#FFFFFF",
  },

  messageTime: {
    fontSize: 9,
    color: MUTED,
    marginTop: 8,
  },

  customerMessageTime: {
    color: "#DCEDE1",
  },

  chatComposer: {
    borderTopWidth: 1,
    borderTopColor: LINE,
    padding: 12,
    gap: 7,
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

  errorText: {
    color: RED,
    fontSize: 11,
    marginBottom: 8,
  },
});