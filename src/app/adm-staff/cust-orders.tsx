
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  ActivityIndicator,
  Image,
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

import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";

import { auth, db } from "../../firebase/config";

import {
  C,
  Fade,
  Heading,
  S,
  Search,
  Stat,
} from "../../components/AdminUI";

import type { DemoOrder } from "../../lib/customerOrders";

import {
  formatOrderChatTime,
  MAX_CHAT_MESSAGE_LENGTH,
  sendOrderChatMessage,
  subscribeToOrderChat,
  type OrderChatMessage,
} from "../../lib/orderChat";

// =====================================
// TYPES AND CONSTANTS
// =====================================

type StaffOrder = DemoOrder;

type OrderFilter =
  | "All"
  | "Pending"
  | "Confirmed"
  | "Rejected";

type OrderDecision = "Confirmed" | "Rejected";

type CustomerProfile = {
  fullName: string;
  email: string;
  phoneNumber: string;
  address: string;
};

type MessageDeleteTarget = {
  orderId: string;
  messageId: string;
};

type IconName =
  React.ComponentProps<typeof Ionicons>["name"];

const FILTERS: OrderFilter[] = [
  "All",
  "Pending",
  "Confirmed",
  "Rejected",
];

const GREEN = C.green;
const DARK = C.dark;
const MUTED = "#627C6E";
const SURFACE = "#FFFDF8";
const LINE = C.line;
const RED = "#A43F3F";
const SOFT = "#EAF2E8";

function money(amount: number): string {
  return `₱${Number(amount || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function friendlyDate(value?: string): string {
  if (!value) return "Not set";

  const parts = value.split("-");

  if (parts.length === 3) {
    const date = new Date(
      Number(parts[0]),
      Number(parts[1]) - 1,
      Number(parts[2])
    );

    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString("en-PH", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    }
  }

  const date = new Date(value);

  if (!Number.isNaN(date.getTime())) {
    return date.toLocaleDateString("en-PH", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }

  return value;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : "Something went wrong. Please try again.";
}

// =====================================
// PRODUCT IMAGE
// =====================================

function ProductPhoto({
  imageUrl,
  name,
  large = false,
}: {
  imageUrl?: string;
  name: string;
  large?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [imageUrl]);

  return (
    <View
      style={[
        styles.imageContainer,
        large && styles.largeImageContainer,
      ]}
    >
      {imageUrl && !failed ? (
        <Image
          source={{ uri: imageUrl }}
          resizeMode="cover"
          style={styles.productImage}
          accessibilityLabel={`${name} product image`}
          onError={() => setFailed(true)}
        />
      ) : (
        <Ionicons
          name="bag-handle-outline"
          size={large ? 30 : 24}
          color={GREEN}
        />
      )}
    </View>
  );
}

// =====================================
// INFORMATION ROW
// =====================================

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: IconName;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.detailRow}>
      <View style={styles.detailIcon}>
        <Ionicons
          name={icon}
          size={18}
          color={GREEN}
        />
      </View>

      <View style={{ flex: 1 }}>
        <Text style={styles.detailLabel}>
          {label}
        </Text>

        <Text style={styles.detailValue}>
          {value || "Not available"}
        </Text>
      </View>
    </View>
  );
}

// =====================================
// MAIN CUSTOMER ORDERS SCREEN
// =====================================

export default function CustomerOrders() {
  // ORDERS

  const [orders, setOrders] = useState<StaffOrder[]>([]);
  const [productImages, setProductImages] = useState<
    Record<string, string>
  >({});

  const [queryText, setQueryText] = useState("");
  const [filter, setFilter] = useState<OrderFilter>("All");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  // ORDER DECISION

  const [
    decisionConfirmation,
    setDecisionConfirmation,
  ] = useState<{
    orderId: string;
    status: OrderDecision;
  } | null>(null);

  const [decisionError, setDecisionError] = useState("");

  // CUSTOMER DETAILS

  const [selectedOrderId, setSelectedOrderId] =
    useState<string | null>(null);

  const [customer, setCustomer] =
    useState<CustomerProfile | null>(null);

  const [customerLoading, setCustomerLoading] =
    useState(false);

  const [customerError, setCustomerError] = useState("");

  // CHAT

  const [chatOpen, setChatOpen] = useState(false);

  const [chatMessages, setChatMessages] =
    useState<OrderChatMessage[]>([]);

  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatSaving, setChatSaving] = useState(false);
  const [chatError, setChatError] = useState("");

  const chatScrollRef = useRef<
    React.ElementRef<typeof ScrollView> | null
  >(null);

  // DELETE CHAT MESSAGE

  const [messageToDelete, setMessageToDelete] =
    useState<MessageDeleteTarget | null>(null);

  const [deletingMessage, setDeletingMessage] =
    useState(false);

  const [deleteMessageError, setDeleteMessageError] =
    useState("");

  // =====================================
  // REAL-TIME ORDERS
  // =====================================

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "orders"),

      snapshot => {
        const records = snapshot.docs.map(entry => {
          const data = entry.data();

          return {
            ...data,
            id: entry.id,
            createdAt:
              data.createdAt?.toDate?.()?.toISOString?.() ??
              (typeof data.createdAt === "string"
                ? data.createdAt
                : ""),
          } as StaffOrder;
        });

        records.sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt)
        );

        setOrders(records);
        setLoading(false);
        setError("");
      },

      reason => {
        setLoading(false);
        setError(errorMessage(reason));
      }
    );

    return unsubscribe;
  }, []);

  const selectedOrder = useMemo(
    () =>
      orders.find(order => order.id === selectedOrderId) ??
      null,
    [orders, selectedOrderId]
  );

  // =====================================
  // PRODUCT IMAGE IDS
  // =====================================

  const productIdsKey = useMemo(() => {
    const ids = orders.flatMap(order =>
      (order.items ?? [])
        .map(item => item.productId)
        .filter(Boolean)
    );

    return Array.from(new Set(ids))
      .sort()
      .join("|");
  }, [orders]);

  // =====================================
  // PRODUCT IMAGES
  // =====================================

  useEffect(() => {
    let active = true;

    async function loadImages() {
      const images: Record<string, string> = {};

      const productIds = productIdsKey
        ? productIdsKey.split("|")
        : [];

      await Promise.all(
        productIds.map(async productId => {
          try {
            const snapshot = await getDoc(
              doc(db, "products", productId)
            );

            if (!snapshot.exists()) return;

            const imageUrl = snapshot.data().imageUrl;

            if (
              typeof imageUrl === "string" &&
              imageUrl.length > 0
            ) {
              images[productId] = imageUrl;
            }
          } catch {
            // Keep the saved image or fallback icon.
          }
        })
      );

      if (active) {
        setProductImages(images);
      }
    }

    void loadImages();

    return () => {
      active = false;
    };
  }, [productIdsKey]);

  // =====================================
  // CUSTOMER INFORMATION
  // =====================================

  useEffect(() => {
    if (!selectedOrder?.customerUid) {
      setCustomer(null);
      setCustomerLoading(false);
      setCustomerError("");
      return;
    }

    let active = true;
    const customerUid = selectedOrder.customerUid;

    setCustomer(null);
    setCustomerLoading(true);
    setCustomerError("");

    async function loadCustomer() {
      try {
        const snapshot = await getDoc(
          doc(db, "users", customerUid)
        );

        if (!active) return;

        if (!snapshot.exists()) {
          setCustomerError("Customer profile was not found.");
          return;
        }

        const data = snapshot.data();

        setCustomer({
          fullName: String(data.fullName ?? ""),
          email: String(data.email ?? ""),
          phoneNumber: String(data.phoneNumber ?? ""),
          address: String(data.address ?? ""),
        });
      } catch (reason) {
        if (active) {
          setCustomerError(errorMessage(reason));
        }
      } finally {
        if (active) {
          setCustomerLoading(false);
        }
      }
    }

    void loadCustomer();

    return () => {
      active = false;
    };
  }, [
    selectedOrder?.id,
    selectedOrder?.customerUid,
  ]);

  // =====================================
  // SEARCH AND FILTER
  // =====================================

  const displayed = useMemo(() => {
    const search = queryText.trim().toLowerCase();

    return orders.filter(order => {
      const matchesFilter =
        filter === "All" || order.status === filter;

      const searchable = [
        order.id,
        order.customerUid,
        ...(order.items ?? []).map(item => item.name),
        ...(order.items ?? []).map(item => item.color),
      ]
        .join(" ")
        .toLowerCase();

      return (
        matchesFilter &&
        searchable.includes(search)
      );
    });
  }, [orders, queryText, filter]);

  // =====================================
  // CONFIRM / REJECT ORDER
  // =====================================

  function requestDecision(
    order: StaffOrder,
    status: OrderDecision
  ) {
    if (busy || order.status !== "Pending") return;

    setDecisionError("");

    setDecisionConfirmation({
      orderId: order.id,
      status,
    });
  }

  async function updateStatus(
    orderId: string,
    status: OrderDecision
  ) {
    if (
      busy ||
      !decisionConfirmation ||
      decisionConfirmation.orderId !== orderId ||
      decisionConfirmation.status !== status
    ) {
      return;
    }

    setBusy(orderId);
    setDecisionError("");
    setError("");

    try {
      await runTransaction(db, async transaction => {
        const orderRef = doc(db, "orders", orderId);
        const snapshot = await transaction.get(orderRef);

        if (!snapshot.exists()) {
          throw new Error("This order no longer exists.");
        }

        const data = snapshot.data();

        if (
          data.status !== "Pending" ||
          data.deliveryStatus !== "Pending"
        ) {
          throw new Error(
            "This order is no longer pending. Refresh its status."
          );
        }

        transaction.update(orderRef, {
          status,
          updatedAt: serverTimestamp(),
          decisionAt: serverTimestamp(),
        });
      });

      setDecisionConfirmation(null);
    } catch (reason) {
      const message = errorMessage(reason);
      setDecisionError(message);
      setError(message);
    } finally {
      setBusy("");
    }
  }

  // =====================================
  // ORDER DETAILS
  // =====================================

  function openOrderDetails(order: StaffOrder) {
    setSelectedOrderId(order.id);
    setChatOpen(false);
    setChatError("");
  }

  function closeOrderDetails() {
    if (chatSaving || deletingMessage) return;

    setChatOpen(false);
    setSelectedOrderId(null);
    setCustomer(null);
    setCustomerError("");
    setChatInput("");
    setChatMessages([]);
    setChatError("");
  }

  // =====================================
  // CHAT SUBSCRIPTION
  // =====================================

  useEffect(() => {
    if (!chatOpen || !selectedOrderId) {
      setChatMessages([]);
      setChatLoading(false);
      return;
    }

    let active = true;

    setChatMessages([]);
    setChatLoading(true);
    setChatError("");

    const unsubscribe = subscribeToOrderChat(
      selectedOrderId,

      messages => {
        if (!active) return;

        setChatMessages(messages);
        setChatLoading(false);
      },

      reason => {
        if (!active) return;

        setChatLoading(false);
        setChatError(errorMessage(reason));
      }
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [chatOpen, selectedOrderId]);

  // =====================================
  // OPEN / CLOSE CHAT
  // =====================================

  function openChat() {
    if (!selectedOrder) return;

    setChatInput("");
    setChatError("");
    setChatOpen(true);
  }

  function closeChat() {
    if (chatSaving || deletingMessage) return;

    setChatOpen(false);
    setChatInput("");
    setChatError("");
  }

  // =====================================
  // SEND CHAT MESSAGE
  // =====================================

  async function sendMessage() {
    if (
      !selectedOrderId ||
      chatSaving ||
      !chatInput.trim()
    ) {
      return;
    }

    const orderId = selectedOrderId;
    const text = chatInput.trim();

    setChatSaving(true);
    setChatError("");

    try {
      await sendOrderChatMessage(orderId, text);
      setChatInput("");
    } catch (reason) {
      setChatError(errorMessage(reason));
    } finally {
      setChatSaving(false);
    }
  }

  // =====================================
  // REQUEST CHAT DELETION
  // =====================================

  function requestMessageDelete(message: OrderChatMessage) {
    const uid = auth.currentUser?.uid;

    if (
      !uid ||
      !selectedOrderId ||
      chatSaving ||
      deletingMessage ||
      message.senderUid !== uid
    ) {
      return;
    }

    setDeleteMessageError("");

    setMessageToDelete({
      orderId: selectedOrderId,
      messageId: message.id,
    });
  }

  // =====================================
  // PERMANENT CHAT DELETION
  // =====================================

  async function confirmMessageDelete() {
    const target = messageToDelete;
    const uid = auth.currentUser?.uid;

    if (!target || !uid || deletingMessage) return;

    setDeletingMessage(true);
    setDeleteMessageError("");

    try {
      const messageRef = doc(
        db,
        "orders",
        target.orderId,
        "messages",
        target.messageId
      );

      await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(messageRef);

        if (!snapshot.exists()) {
          throw new Error(
            "This message has already been deleted."
          );
        }

        const data = snapshot.data();

        if (
          auth.currentUser?.uid !== uid ||
          data.senderUid !== uid ||
          data.orderId !== target.orderId
        ) {
          throw new Error(
            "You can only delete messages you sent."
          );
        }

        transaction.delete(messageRef);
      });

      setMessageToDelete(null);
    } catch (reason) {
      setDeleteMessageError(errorMessage(reason));
    } finally {
      setDeletingMessage(false);
    }
  }

  // =====================================
  // RENDER PRODUCTS
  // =====================================

  function renderProducts(
    order: StaffOrder,
    large = false
  ) {
    return (
      <View style={styles.productList}>
        {(order.items ?? []).map((item, index) => {
          const imageUrl =
            productImages[item.productId] ||
            item.imageUrl ||
            "";

          return (
            <Pressable
              key={`${item.productId}:${item.color}:${index}`}
              disabled={large}
              onPress={() => openOrderDetails(order)}
              style={({ pressed }) => [
                styles.productRow,
                pressed && !large && styles.pressed,
              ]}
            >
              <ProductPhoto
                imageUrl={imageUrl}
                name={item.name}
                large={large}
              />

              <View style={styles.productDetails}>
                <Text style={styles.productName}>
                  {item.name}
                </Text>

                <Text style={styles.productMeta}>
                  {item.quantity} × {money(item.price)}
                </Text>

                {!!item.color && (
                  <Text style={styles.productMeta}>
                    Color: {item.color}
                  </Text>
                )}

                <Text style={styles.productSubtotal}>
                  {money(item.price * item.quantity)}
                </Text>
              </View>

              {!large && (
                <Ionicons
                  name="chevron-forward"
                  size={17}
                  color={MUTED}
                />
              )}
            </Pressable>
          );
        })}
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
          label="ORDER MANAGEMENT"
          title="Customer Orders"
          description="Review purchases, customer information and delivery-date requests."
        />

        {/* STATISTICS */}

        <Fade delay={100}>
          <View style={styles.statsContainer}>
            <Stat
              icon="receipt-outline"
              label="Total Orders"
              value={String(orders.length)}
            />

            <Stat
              icon="time-outline"
              label="Pending"
              value={String(
                orders.filter(order => order.status === "Pending").length
              )}
            />

            <Stat
              icon="checkmark-outline"
              label="Confirmed"
              value={String(
                orders.filter(order => order.status === "Confirmed").length
              )}
            />

            <Stat
              icon="close-circle-outline"
              label="Rejected"
              value={String(
                orders.filter(order => order.status === "Rejected").length
              )}
            />
          </View>
        </Fade>

        {/* SEARCH AND FILTERS */}

        <View style={S.card}>
          <Search
            value={queryText}
            onChange={setQueryText}
            placeholder="Search order ID, customer or product..."
          />

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filters}
          >
            {FILTERS.map(option => {
              const active = filter === option;

              return (
                <Pressable
                  key={option}
                  style={[
                    S.chip,
                    active && S.chipActive,
                  ]}
                  onPress={() => setFilter(option)}
                >
                  <Text
                    style={{
                      color: active ? "#FFFFFF" : DARK,
                      fontSize: 11,
                    }}
                  >
                    {option}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {loading && (
            <ActivityIndicator color={GREEN} />
          )}

          {!!error && (
            <Text style={styles.errorText}>
              {error}
            </Text>
          )}

          {!loading && displayed.length === 0 && (
            <Text style={S.muted}>
              No matching customer orders.
            </Text>
          )}

          {/* ORDER LIST */}

          {displayed.map(order => (
            <View
              key={order.id}
              style={styles.orderContainer}
            >
              <Pressable
                onPress={() => openOrderDetails(order)}
                style={styles.orderHeading}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={S.strong}
                    numberOfLines={2}
                  >
                    {order.id}
                  </Text>

                  <Text style={S.muted}>
                    Customer UID: {order.customerUid}
                  </Text>
                </View>

                <Ionicons
                  name="chevron-forward-circle-outline"
                  size={24}
                  color={GREEN}
                />
              </Pressable>

              {renderProducts(order)}

              <View style={styles.orderDetails}>
                <Text style={S.muted}>
                  Total: {money(order.total)} · COD
                </Text>

                <Text style={S.muted}>
                  Requested:{" "}
                  {order.preferredDeliveryDate || "None"}
                </Text>

                <Text style={S.muted}>
                  Order: {order.status}
                </Text>

                <Text style={S.muted}>
                  Delivery: {order.deliveryStatus}
                  {order.confirmedDeliveryDate
                    ? ` · ${order.confirmedDeliveryDate}`
                    : ""}
                </Text>
              </View>

              <Pressable
                onPress={() => openOrderDetails(order)}
                style={styles.viewDetailsButton}
              >
                <Ionicons
                  name="person-circle-outline"
                  size={17}
                  color={GREEN}
                />

                <Text style={styles.viewDetailsText}>
                  View Customer & Order Details
                </Text>

                <Ionicons
                  name="arrow-forward"
                  size={15}
                  color={GREEN}
                />
              </Pressable>

              {order.status === "Pending" && (
                <View style={styles.actions}>
                  <Pressable
                    disabled={!!busy}
                    onPress={() =>
                      requestDecision(order, "Confirmed")
                    }
                    style={[
                      S.chip,
                      S.chipActive,
                      !!busy && styles.disabledButton,
                    ]}
                  >
                    <Text style={styles.confirmText}>
                      {busy === order.id
                        ? "Saving..."
                        : "Confirm Order"}
                    </Text>
                  </Pressable>

                  <Pressable
                    disabled={!!busy}
                    onPress={() =>
                      requestDecision(order, "Rejected")
                    }
                    style={[
                      S.chip,
                      !!busy && styles.disabledButton,
                    ]}
                  >
                    <Text style={styles.rejectText}>
                      Reject
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))}
        </View>
      </ScrollView>

      {/* =====================================
          ORDER DETAILS MODAL
          ===================================== */}

      <Modal
        visible={
          !!selectedOrder &&
          !chatOpen &&
          !decisionConfirmation
        }
        transparent
        animationType="fade"
        onRequestClose={closeOrderDetails}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalEyebrow}>
                  ORDER MANAGEMENT
                </Text>

                <Text style={styles.modalTitle}>
                  Order details.
                </Text>
              </View>

              <Pressable
                onPress={closeOrderDetails}
                style={styles.closeButton}
              >
                <Ionicons
                  name="close"
                  size={22}
                  color={DARK}
                />
              </Pressable>
            </View>

            {selectedOrder && (
              <>
                <ScrollView
                  style={styles.modalScroll}
                  contentContainerStyle={styles.modalContent}
                  showsVerticalScrollIndicator={false}
                >
                  <Text style={styles.sectionEyebrow}>
                    CUSTOMER INFORMATION
                  </Text>

                  {customerLoading ? (
                    <ActivityIndicator
                      color={GREEN}
                      style={{ marginVertical: 20 }}
                    />
                  ) : (
                    <View style={styles.customerCard}>
                      <View style={styles.customerTop}>
                        <View style={styles.customerAvatar}>
                          <Ionicons
                            name="person-outline"
                            size={25}
                            color={GREEN}
                          />
                        </View>

                        <View style={{ flex: 1 }}>
                          <Text style={styles.customerName}>
                            {customer?.fullName || "Customer"}
                          </Text>

                          <Text style={styles.customerSub}>
                            SilkMart Customer
                          </Text>
                        </View>
                      </View>

                      {!!customerError && (
                        <Text style={styles.errorText}>
                          {customerError}
                        </Text>
                      )}

                      <DetailRow
                        icon="person-outline"
                        label="Full Name"
                        value={
                          customer?.fullName || "Not available"
                        }
                      />

                      <DetailRow
                        icon="mail-outline"
                        label="Email Address"
                        value={
                          customer?.email || "Not available"
                        }
                      />

                      <DetailRow
                        icon="call-outline"
                        label="Mobile Number"
                        value={
                          customer?.phoneNumber || "Not available"
                        }
                      />

                      <DetailRow
                        icon="location-outline"
                        label="Complete Address"
                        value={
                          customer?.address || "Not available"
                        }
                      />
                    </View>
                  )}

                  <Text style={styles.sectionEyebrow}>
                    ORDERED PRODUCTS
                  </Text>

                  {renderProducts(selectedOrder, true)}

                  <Text style={styles.sectionEyebrow}>
                    ORDER INFORMATION
                  </Text>

                  <View style={styles.summaryCard}>
                    <DetailRow
                      icon="receipt-outline"
                      label="Order ID"
                      value={selectedOrder.id}
                    />

                    <DetailRow
                      icon="calendar-outline"
                      label="Order Date"
                      value={friendlyDate(
                        selectedOrder.createdAt
                      )}
                    />

                    <DetailRow
                      icon="card-outline"
                      label="Payment Method"
                      value="Cash on Delivery (COD)"
                    />

                    <DetailRow
                      icon="calendar-number-outline"
                      label="Preferred Delivery Date"
                      value={friendlyDate(
                        selectedOrder.preferredDeliveryDate
                      )}
                    />

                    <DetailRow
                      icon="checkmark-circle-outline"
                      label="Confirmed Delivery Date"
                      value={friendlyDate(
                        selectedOrder.confirmedDeliveryDate
                      )}
                    />

                    <DetailRow
                      icon="bag-check-outline"
                      label="Order Status"
                      value={selectedOrder.status}
                    />

                    <DetailRow
                      icon="car-outline"
                      label="Delivery Status"
                      value={
                        selectedOrder.deliveryStatus || "Pending"
                      }
                    />

                    <View style={styles.totalRow}>
                      <Text style={styles.totalLabel}>
                        Order Total
                      </Text>

                      <Text style={styles.totalAmount}>
                        {money(selectedOrder.total)}
                      </Text>
                    </View>
                  </View>
                </ScrollView>

                <View style={styles.modalFooter}>
                  {selectedOrder.status === "Pending" && (
                    <View style={styles.modalActionRow}>
                      <Pressable
                        disabled={!!busy}
                        onPress={() =>
                          requestDecision(
                            selectedOrder,
                            "Confirmed"
                          )
                        }
                        style={[
                          styles.actionConfirm,
                          !!busy && styles.disabledButton,
                        ]}
                      >
                        <Text style={styles.actionConfirmText}>
                          {busy === selectedOrder.id
                            ? "Saving..."
                            : "Confirm"}
                        </Text>
                      </Pressable>

                      <Pressable
                        disabled={!!busy}
                        onPress={() =>
                          requestDecision(
                            selectedOrder,
                            "Rejected"
                          )
                        }
                        style={[
                          styles.actionReject,
                          !!busy && styles.disabledButton,
                        ]}
                      >
                        <Text style={styles.actionRejectText}>
                          Reject
                        </Text>
                      </Pressable>
                    </View>
                  )}

                  <Pressable
                    onPress={openChat}
                    style={styles.messageButton}
                  >
                    <Ionicons
                      name="chatbubbles-outline"
                      size={19}
                      color="#FFFFFF"
                    />

                    <Text style={styles.messageButtonText}>
                      Message Customer
                    </Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* =====================================
          CONFIRM / REJECT DIALOG
          ===================================== */}

      <Modal
        visible={decisionConfirmation !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!busy) {
            setDecisionConfirmation(null);
            setDecisionError("");
          }
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.decisionCard}>
            <View
              style={[
                styles.decisionIcon,
                decisionConfirmation?.status === "Rejected" &&
                  styles.decisionRejectIcon,
              ]}
            >
              <Ionicons
                name={
                  decisionConfirmation?.status === "Confirmed"
                    ? "checkmark-circle-outline"
                    : "close-circle-outline"
                }
                size={27}
                color={
                  decisionConfirmation?.status === "Confirmed"
                    ? GREEN
                    : RED
                }
              />
            </View>

            <Text style={styles.decisionTitle}>
              {decisionConfirmation?.status === "Confirmed"
                ? "Confirm this order?"
                : "Reject this order?"}
            </Text>

            <Text style={styles.decisionDescription}>
              {decisionConfirmation?.status === "Confirmed"
                ? "Continue to confirm this customer's order? You can schedule its delivery after confirmation."
                : "Continue to reject this customer's order? This decision cannot be changed here."}
            </Text>

            {!!decisionError && (
              <Text style={styles.errorText}>
                {decisionError}
              </Text>
            )}

            <View style={styles.decisionActions}>
              <Pressable
                disabled={!!busy}
                onPress={() => {
                  setDecisionConfirmation(null);
                  setDecisionError("");
                }}
                style={styles.decisionCancel}
              >
                <Text style={styles.decisionCancelText}>
                  Cancel
                </Text>
              </Pressable>

              <Pressable
                disabled={!!busy}
                onPress={() => {
                  if (!decisionConfirmation) return;

                  void updateStatus(
                    decisionConfirmation.orderId,
                    decisionConfirmation.status
                  );
                }}
                style={[
                  styles.decisionAccept,
                  decisionConfirmation?.status === "Rejected" &&
                    styles.decisionReject,
                  !!busy && styles.disabledButton,
                ]}
              >
                {busy ? (
                  <ActivityIndicator
                    color="#FFFFFF"
                    size="small"
                  />
                ) : (
                  <Text style={styles.decisionAcceptText}>
                    {decisionConfirmation?.status === "Confirmed"
                      ? "Yes, Confirm"
                      : "Yes, Reject"}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* =====================================
          CUSTOMER CHAT MODAL
          ===================================== */}

      <Modal
        visible={
          chatOpen &&
          !!selectedOrder &&
          !messageToDelete
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
                style={styles.closeButton}
                disabled={chatSaving || deletingMessage}
              >
                <Ionicons
                  name="arrow-back"
                  size={21}
                  color={GREEN}
                />
              </Pressable>

              <View style={{ flex: 1 }}>
                <Text style={styles.chatEyebrow}>
                  SILKMART MESSAGES
                </Text>

                <Text style={styles.chatTitle}>
                  {customer?.fullName || "Customer Chat"}
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
                size={24}
                color={GREEN}
              />
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
              {chatLoading && (
                <ActivityIndicator
                  color={GREEN}
                  style={{ marginVertical: 25 }}
                />
              )}

              {!chatLoading &&
                chatMessages.length === 0 &&
                !chatError && (
                  <View style={styles.chatEmpty}>
                    <Ionicons
                      name="chatbubble-ellipses-outline"
                      size={42}
                      color={GREEN}
                    />

                    <Text style={styles.chatEmptyTitle}>
                      Start a conversation
                    </Text>

                    <Text style={styles.chatEmptyText}>
                      Contact the customer about their order,
                      delivery schedule, or rescheduling request.
                    </Text>
                  </View>
                )}

              {/* MESSAGES */}

              {chatMessages.map(message => {
                const fromMe =
                  !!auth.currentUser?.uid &&
                  message.senderUid === auth.currentUser.uid;

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
                          ? styles.staffBubble
                          : styles.customerBubble,
                      ]}
                    >
                      <Text
                        style={[
                          styles.messageBody,
                          fromMe && styles.staffMessageBody,
                        ]}
                      >
                        {message.text}
                      </Text>

                      <View style={styles.messageFooter}>
                        <Text
                          style={[
                            styles.messageTime,
                            fromMe && styles.staffMessageTime,
                          ]}
                        >
                          {fromMe ? "You" : "Customer"} ·{" "}
                          {formatOrderChatTime(
                            message.createdAt
                          )}
                        </Text>

                        {/* OWN MESSAGE DELETE ICON */}

                        {fromMe && (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Delete my message"
                            onPress={() =>
                              requestMessageDelete(message)
                            }
                            disabled={
                              deletingMessage || chatSaving
                            }
                            style={styles.deleteMessageIcon}
                          >
                            <Ionicons
                              name="trash-outline"
                              size={15}
                              color="#FFFFFF"
                            />
                          </Pressable>
                        )}
                      </View>
                    </View>
                  </View>
                );
              })}
            </ScrollView>

            {/* CHAT INPUT */}

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
                  maxLength={MAX_CHAT_MESSAGE_LENGTH}
                  editable={!chatSaving && !deletingMessage}
                  textAlignVertical="top"
                />

                <Pressable
                  disabled={
                    chatSaving ||
                    deletingMessage ||
                    !chatInput.trim()
                  }
                  onPress={() => void sendMessage()}
                  style={[
                    styles.sendButton,
                    (chatSaving ||
                      deletingMessage ||
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
                Messages are saved to this order
                conversation in Firestore.
              </Text>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* =====================================
          DELETE MESSAGE CONFIRMATION
          ===================================== */}

      <Modal
        visible={messageToDelete !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!deletingMessage) {
            setMessageToDelete(null);
            setDeleteMessageError("");
          }
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.decisionCard}>
            <View style={styles.deleteMessageBadge}>
              <Ionicons
                name="trash-outline"
                size={26}
                color={RED}
              />
            </View>

            <Text style={styles.decisionTitle}>
              Delete this message?
            </Text>

            <Text style={styles.decisionDescription}>
              This permanently removes only your
              selected message from Firestore.
              Other messages and order details
              will remain unchanged.
            </Text>

            {!!deleteMessageError && (
              <Text style={styles.errorText}>
                {deleteMessageError}
              </Text>
            )}

            <View style={styles.decisionActions}>
              <Pressable
                disabled={deletingMessage}
                onPress={() => {
                  setMessageToDelete(null);
                  setDeleteMessageError("");
                }}
                style={styles.decisionCancel}
              >
                <Text style={styles.decisionCancelText}>
                  Cancel
                </Text>
              </Pressable>

              <Pressable
                disabled={deletingMessage}
                onPress={() =>
                  void confirmMessageDelete()
                }
                style={[
                  styles.decisionAccept,
                  styles.decisionReject,
                  deletingMessage &&
                    styles.disabledButton,
                ]}
              >
                {deletingMessage ? (
                  <ActivityIndicator
                    color="#FFFFFF"
                    size="small"
                  />
                ) : (
                  <Text style={styles.decisionAcceptText}>
                    Delete Permanently
                  </Text>
                )}
              </Pressable>
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
  statsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
    marginBottom: 18,
  },

  filters: {
    gap: 7,
    marginBottom: 17,
  },

  orderContainer: {
    borderTopWidth: 1,
    borderColor: LINE,
    paddingVertical: 15,
    gap: 7,
  },

  orderHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  productList: {
    marginTop: 5,
    gap: 10,
  },

  productRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: LINE,
  },

  imageContainer: {
    width: 55,
    height: 55,
    borderRadius: 12,
    backgroundColor: "#E6F0E4",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },

  largeImageContainer: {
    width: 70,
    height: 70,
    borderRadius: 14,
  },

  productImage: {
    width: "100%",
    height: "100%",
  },

  productDetails: {
    flex: 1,
    gap: 3,
  },

  productName: {
    fontSize: 12,
    fontWeight: "700",
    color: DARK,
  },

  productMeta: {
    fontSize: 11,
    color: MUTED,
  },

  productSubtotal: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "700",
    color: GREEN,
  },

  orderDetails: {
    gap: 5,
    marginTop: 4,
  },

  viewDetailsButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: SOFT,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 10,
    marginTop: 5,
  },

  viewDetailsText: {
    color: GREEN,
    fontSize: 12,
    fontWeight: "700",
  },

  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
    marginTop: 5,
  },

  confirmText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "600",
  },

  rejectText: {
    color: DARK,
    fontSize: 11,
    fontWeight: "600",
  },

  pressed: {
    opacity: 0.75,
  },

  disabledButton: {
    opacity: 0.5,
  },

  errorText: {
    color: "#B34D4D",
    fontSize: 12,
    marginTop: 10,
    marginBottom: 10,
    textAlign: "center",
  },

  // MODALS

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(13,31,22,0.57)",
    justifyContent: "center",
    padding: 15,
  },

  modalCard: {
    width: "100%",
    maxWidth: 560,
    maxHeight: "92%",
    alignSelf: "center",
    backgroundColor: SURFACE,
    borderRadius: 22,
    overflow: "hidden",
  },

  modalHeader: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: LINE,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  modalEyebrow: {
    color: GREEN,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.7,
  },

  modalTitle: {
    fontSize: 27,
    fontFamily: "serif",
    color: DARK,
    marginTop: 5,
  },

  closeButton: {
    width: 35,
    height: 35,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: SOFT,
  },

  modalScroll: {
    flexShrink: 1,
  },

  modalContent: {
    padding: 20,
    paddingBottom: 26,
  },

  sectionEyebrow: {
    color: GREEN,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    marginTop: 8,
    marginBottom: 13,
  },

  customerCard: {
    padding: 14,
    backgroundColor: "#F5F8F1",
    borderRadius: 16,
    marginBottom: 24,
  },

  customerTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },

  customerAvatar: {
    width: 51,
    height: 51,
    borderRadius: 26,
    backgroundColor: "#E2EDDF",
    alignItems: "center",
    justifyContent: "center",
  },

  customerName: {
    fontSize: 17,
    fontWeight: "700",
    color: DARK,
  },

  customerSub: {
    fontSize: 11,
    color: MUTED,
    marginTop: 4,
  },

  detailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#DBE5DA",
    gap: 10,
  },

  detailIcon: {
    width: 32,
    height: 32,
    backgroundColor: SOFT,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },

  detailLabel: {
    color: MUTED,
    fontSize: 10,
    marginBottom: 4,
  },

  detailValue: {
    color: DARK,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 18,
  },

  summaryCard: {
    backgroundColor: "#F5F8F1",
    borderRadius: 16,
    padding: 14,
    marginBottom: 8,
  },

  totalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 17,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: LINE,
  },

  totalLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: DARK,
  },

  totalAmount: {
    fontSize: 19,
    fontWeight: "700",
    color: GREEN,
  },

  modalFooter: {
    padding: 15,
    borderTopWidth: 1,
    borderTopColor: LINE,
    gap: 10,
  },

  modalActionRow: {
    flexDirection: "row",
    gap: 10,
  },

  actionConfirm: {
    flex: 1,
    backgroundColor: GREEN,
    borderRadius: 12,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },

  actionConfirmText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },

  actionReject: {
    flex: 1,
    backgroundColor: "#FCECEC",
    borderRadius: 12,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },

  actionRejectText: {
    color: RED,
    fontSize: 12,
    fontWeight: "700",
  },

  messageButton: {
    backgroundColor: GREEN,
    minHeight: 49,
    borderRadius: 13,
    flexDirection: "row",
    gap: 9,
    alignItems: "center",
    justifyContent: "center",
  },

  messageButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },

  // CONFIRMATION DIALOGS

  decisionCard: {
    width: "100%",
    maxWidth: 390,
    alignSelf: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: SURFACE,
    borderRadius: 20,
  },

  decisionIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: SOFT,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },

  decisionRejectIcon: {
    backgroundColor: "#FCECEC",
  },

  decisionTitle: {
    fontFamily: "serif",
    color: DARK,
    fontSize: 24,
    textAlign: "center",
  },

  decisionDescription: {
    fontSize: 12,
    lineHeight: 19,
    color: MUTED,
    textAlign: "center",
    marginTop: 10,
  },

  decisionActions: {
    flexDirection: "row",
    gap: 10,
    width: "100%",
    marginTop: 22,
  },

  decisionCancel: {
    flex: 1,
    minHeight: 45,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: LINE,
    alignItems: "center",
    justifyContent: "center",
  },

  decisionCancelText: {
    color: DARK,
    fontWeight: "700",
    fontSize: 12,
  },

  decisionAccept: {
    flex: 1,
    minHeight: 45,
    borderRadius: 12,
    backgroundColor: GREEN,
    alignItems: "center",
    justifyContent: "center",
  },

  decisionReject: {
    backgroundColor: RED,
  },

  decisionAcceptText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 12,
  },

  deleteMessageBadge: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#FCECEC",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },

  // CHAT

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
    padding: 17,
    borderBottomWidth: 1,
    borderBottomColor: LINE,
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

  chatMessages: {
    flex: 1,
  },

  chatMessagesContent: {
    padding: 15,
    paddingBottom: 25,
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
    marginTop: 9,
    textAlign: "center",
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

  staffBubble: {
    backgroundColor: GREEN,
    borderBottomRightRadius: 4,
  },

  customerBubble: {
    backgroundColor: "#E7EFE4",
    borderBottomLeftRadius: 4,
  },

  messageBody: {
    fontSize: 12,
    color: DARK,
    lineHeight: 19,
  },

  staffMessageBody: {
    color: "#FFFFFF",
  },

  messageFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 8,
  },

  messageTime: {
    fontSize: 9,
    color: MUTED,
  },

  staffMessageTime: {
    color: "#DCEDE1",
  },

  deleteMessageIcon: {
    paddingHorizontal: 6,
    paddingVertical: 5,
    borderRadius: 7,
    backgroundColor: "rgba(255,255,255,0.16)",
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

  composerHint: {
    color: MUTED,
    fontSize: 10,
    textAlign: "center",
  },
});
