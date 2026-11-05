
import React, { useEffect, useMemo, useState } from "react";

import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
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
  Heading,
  S,
  Search,
  Stat,
} from "../../components/AdminUI";

import DeliveryDateModal from "../../components/DeliveryDateModal";

import { completeSilkwormDelivery } from "../../lib/silkwormDelivery";

import type {
  DemoOrder,
  DeliveryStatus,
} from "../../lib/customerOrders";

// =====================================
// TYPES
// =====================================

type DeliveryFilter =
  | "All"
  | "Pending"
  | "Scheduled"
  | "Preparing"
  | "Out for Delivery"
  | "Delivered";

type StageAction = {
  next: DeliveryStatus;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
};

const FILTERS: DeliveryFilter[] = [
  "All",
  "Pending",
  "Scheduled",
  "Preparing",
  "Out for Delivery",
  "Delivered",
];

const STAGES: DeliveryStatus[] = [
  "Pending",
  "Scheduled",
  "Preparing",
  "Out for Delivery",
  "Delivered",
];

const MUTED = "#627C6E";
const SURFACE = "#FFFDF8";

// =====================================
// HELPERS
// =====================================

function money(amount: number): string {
  return `₱${Number(amount || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value?: string): string {
  if (!value) return "Not set";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return value;
  }

  return date.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function localToday(): string {
  const date = new Date();

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function validDeliveryDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function nextStage(status: DeliveryStatus): StageAction | null {
  switch (status) {
    case "Scheduled":
      return {
        next: "Preparing",
        label: "Start Preparing",
        icon: "cube-outline",
      };

    case "Preparing":
      return {
        next: "Out for Delivery",
        label: "Out for Delivery",
        icon: "car-outline",
      };

    case "Out for Delivery":
      return {
        next: "Delivered",
        label: "Mark Delivered",
        icon: "checkmark-circle-outline",
      };

    default:
      return null;
  }
}

function normalizeOrder(
  id: string,
  data: Record<string, any>
): DemoOrder {
  const status =
    data.status === "Confirmed" ||
    data.status === "Rejected"
      ? data.status
      : "Pending";

  const deliveryStatus: DeliveryStatus =
    STAGES.includes(data.deliveryStatus)
      ? data.deliveryStatus
      : "Pending";

  return {
    id,
    customerUid: String(data.customerUid ?? ""),
    createdAt:
      typeof data.createdAt?.toDate === "function"
        ? data.createdAt.toDate().toISOString()
        : String(data.createdAt ?? ""),
    status,
    deliveryStatus,
    preferredDeliveryDate: String(
      data.preferredDeliveryDate ?? ""
    ),
    confirmedDeliveryDate: String(
      data.confirmedDeliveryDate ?? ""
    ),
    paymentMethod: "COD",
    items: Array.isArray(data.items) ? data.items : [],
    total: Number(data.total ?? 0),
  };
}

// =====================================
// PRODUCT PHOTO
// =====================================

function ProductPhoto({
  imageUrl,
  name,
}: {
  imageUrl?: string;
  name: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [imageUrl]);

  return (
    <View style={styles.imageContainer}>
      {imageUrl && !failed ? (
        <Image
          source={{ uri: imageUrl }}
          style={styles.productImage}
          resizeMode="cover"
          accessibilityLabel={`${name} product image`}
          onError={() => setFailed(true)}
        />
      ) : (
        <Ionicons
          name="bag-handle-outline"
          size={24}
          color={C.green}
        />
      )}
    </View>
  );
}

// =====================================
// DELIVERY SCREEN
// =====================================

export default function Delivery() {
  const [orders, setOrders] = useState<DemoOrder[]>([]);

  const [productImages, setProductImages] = useState<
    Record<string, string>
  >({});

  const [queryText, setQueryText] = useState("");
  const [filter, setFilter] = useState<DeliveryFilter>("All");
  const [selectedOrderId, setSelectedOrderId] =
    useState<string | null>(null);

  const [calendarOpen, setCalendarOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [stageConfirmation, setStageConfirmation] =
    useState<{
      orderId: string;
      next: DeliveryStatus;
    } | null>(null);

  const [deleteConfirmationId, setDeleteConfirmationId] =
    useState<string | null>(null);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // =====================================
  // REAL-TIME ORDERS
  // =====================================

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "orders"),
      snapshot => {
        const records = snapshot.docs
          .map(entry =>
            normalizeOrder(entry.id, entry.data())
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
        setError(reason.message);
      }
    );

    return unsubscribe;
  }, []);

  // =====================================
  // SELECTED ORDER
  // =====================================

  const selectedOrder = useMemo(
    () =>
      orders.find(order => order.id === selectedOrderId) ??
      null,
    [orders, selectedOrderId]
  );

  // =====================================
  // PRODUCT IDS
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
  // LOAD PRODUCT IMAGES
  // =====================================

  useEffect(() => {
    let active = true;

    async function loadProductImages() {
      const images: Record<string, string> = {};

      const ids = productIdsKey
        ? productIdsKey.split("|")
        : [];

      await Promise.all(
        ids.map(async productId => {
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
            // Use the saved image or fallback icon.
          }
        })
      );

      if (active) {
        setProductImages(images);
      }
    }

    void loadProductImages();

    return () => {
      active = false;
    };
  }, [productIdsKey]);

  // =====================================
  // SEARCH AND FILTER
  // =====================================

  const displayed = useMemo(() => {
    const search = queryText.trim().toLowerCase();

    return orders.filter(order => {
      const matchesFilter =
        filter === "All" ||
        order.deliveryStatus === filter;

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
  }, [orders, filter, queryText]);

  // =====================================
  // SAVE DELIVERY UPDATE
  // =====================================

  async function saveDelivery(
    orderId: string,
    nextStatus: DeliveryStatus,
    requestedDate?: string
  ) {
    if (saving) return;

    setSaving(true);
    setError("");

    try {
      // =====================================
      // NEW: DELIVERED + STOCK DEDUCTION
      // =====================================
      //
      // The helper updates the order, purchased
      // product quantities, color stock, and
      // linked silkworm inventory atomically.
      //
      // Never use the status-only transaction
      // when completing a delivery.

      if (nextStatus === "Delivered") {
        await completeSilkwormDelivery(orderId);

        setCalendarOpen(false);
        setSelectedOrderId(null);

        return;
      }

      // =====================================
      // EXISTING DELIVERY TRANSITIONS
      // =====================================

      const orderRef = doc(db, "orders", orderId);

      await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(orderRef);

        if (!snapshot.exists()) {
          throw new Error(
            "This order no longer exists."
          );
        }

        const data = snapshot.data();

        if (data.status !== "Confirmed") {
          throw new Error(
            "Only confirmed orders can be scheduled for delivery."
          );
        }

        const currentStatus: DeliveryStatus =
          STAGES.includes(data.deliveryStatus)
            ? data.deliveryStatus
            : "Pending";

        if (currentStatus === "Delivered") {
          throw new Error(
            "This order is already delivered and cannot be changed."
          );
        }

        if (nextStatus === "Scheduled") {
          if (
            currentStatus !== "Pending" &&
            currentStatus !== "Scheduled" &&
            currentStatus !== "Preparing"
          ) {
            throw new Error(
              "This delivery can no longer be rescheduled."
            );
          }

          const date = requestedDate?.trim() ?? "";

          if (
            !validDeliveryDate(date) ||
            date < localToday()
          ) {
            throw new Error(
              "Please select a valid delivery date that is today or later."
            );
          }

          const resultingStatus =
            currentStatus === "Preparing"
              ? "Preparing"
              : "Scheduled";

          transaction.update(orderRef, {
            deliveryStatus: resultingStatus,
            confirmedDeliveryDate: date,
            scheduledAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          return;
        }

        const expected = nextStage(currentStatus);

        if (
          !expected ||
          expected.next !== nextStatus
        ) {
          throw new Error(
            "Please complete the current delivery stage before proceeding."
          );
        }

        const confirmedDate = String(
          data.confirmedDeliveryDate ?? ""
        );

        if (!confirmedDate) {
          throw new Error(
            "Confirm a delivery date before updating its delivery stage."
          );
        }

        const stageTimestampField =
          nextStatus === "Preparing"
            ? "preparingAt"
            : "dispatchedAt";

        transaction.update(orderRef, {
          deliveryStatus: nextStatus,
          confirmedDeliveryDate: confirmedDate,
          [stageTimestampField]: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });

      setCalendarOpen(false);
      setSelectedOrderId(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to update delivery."
      );
    } finally {
      setSaving(false);
    }
  }

  // =====================================
  // PERMANENTLY DELETE ELIGIBLE ORDER
  // =====================================

  async function deleteEligibleOrder(orderId: string) {
    if (saving || !auth.currentUser) return;

    setSaving(true);
    setError("");

    try {
      const orderRef = doc(db, "orders", orderId);

      await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(orderRef);

        if (!snapshot.exists()) {
          throw new Error(
            "This order has already been removed."
          );
        }

        const data = snapshot.data();

        const isDelivered =
          data.status === "Confirmed" &&
          data.deliveryStatus === "Delivered";

        const isRejected =
          data.status === "Rejected" &&
          data.deliveryStatus === "Pending";

        if (!isDelivered && !isRejected) {
          throw new Error(
            "Only rejected orders or fully delivered confirmed orders can be deleted."
          );
        }

        transaction.delete(orderRef);
      });

      setDeleteConfirmationId(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to delete this order."
      );
    } finally {
      setSaving(false);
    }
  }

  // =====================================
  // OPEN DELIVERY CALENDAR
  // =====================================

  function openCalendar(order: DemoOrder) {
    if (saving) return;

    if (
      order.status !== "Confirmed" ||
      order.deliveryStatus === "Delivered" ||
      order.deliveryStatus === "Out for Delivery"
    ) {
      return;
    }

    setSelectedOrderId(order.id);
    setCalendarOpen(true);
  }

  function closeCalendar() {
    if (saving) return;

    setCalendarOpen(false);
    setSelectedOrderId(null);
  }

  // =====================================
  // STATISTICS
  // =====================================

  const readyCount = orders.filter(
    order =>
      order.status === "Confirmed" &&
      order.deliveryStatus === "Pending"
  ).length;

  const scheduledCount = orders.filter(
    order => order.deliveryStatus === "Scheduled"
  ).length;

  const dispatchedCount = orders.filter(
    order => order.deliveryStatus === "Out for Delivery"
  ).length;

  const deliveredCount = orders.filter(
    order => order.deliveryStatus === "Delivered"
  ).length;

  // =====================================
  // SCREEN
  // =====================================

  return (
    <ScrollView
      style={S.page}
      contentContainerStyle={S.content}
      keyboardShouldPersistTaps="handled"
    >
      <Heading
        label="DELIVERY MANAGEMENT"
        title="Delivery Management"
        description="Manage preferred dates, delivery schedules, and order fulfillment. Cash on Delivery only."
      />

      {/* DELIVERY STATISTICS */}

      <View style={styles.statsContainer}>
        <Stat
          icon="calendar-outline"
          label="Ready to Schedule"
          value={String(readyCount)}
        />

        <Stat
          icon="calendar-number-outline"
          label="Scheduled"
          value={String(scheduledCount)}
        />

        <Stat
          icon="car-outline"
          label="Out for Delivery"
          value={String(dispatchedCount)}
        />

        <Stat
          icon="checkmark-circle-outline"
          label="Delivered"
          value={String(deliveredCount)}
        />
      </View>

      {/* DELIVERY REQUESTS */}

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
                    fontSize: 11,
                    color: active
                      ? "#FFFFFF"
                      : C.dark,
                  }}
                >
                  {option}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {loading && (
          <ActivityIndicator color={C.green} />
        )}

        {!!error && (
          <Text style={styles.errorText}>
            {error}
          </Text>
        )}

        {!loading && displayed.length === 0 && (
          <Text style={S.muted}>
            No matching delivery requests.
          </Text>
        )}

        {/* INDIVIDUAL ORDERS */}

        {displayed.map(order => {
          const stage = nextStage(order.deliveryStatus);
          const isConfirmed = order.status === "Confirmed";

          const canSchedule =
            isConfirmed &&
            [
              "Pending",
              "Scheduled",
              "Preparing",
            ].includes(order.deliveryStatus);

          return (
            <View
              key={order.id}
              style={styles.orderContainer}
            >
              <Text style={S.strong}>
                {order.id}
              </Text>

              <Text style={styles.customerText}>
                Customer UID: {order.customerUid}
              </Text>

              {/* PRODUCTS */}

              <View style={styles.productList}>
                {(order.items ?? []).map(
                  (item, index) => {
                    const imageUrl =
                      productImages[item.productId] ||
                      item.imageUrl ||
                      "";

                    return (
                      <View
                        key={`${item.productId}:${item.color}:${index}`}
                        style={styles.productRow}
                      >
                        <ProductPhoto
                          imageUrl={imageUrl}
                          name={item.name}
                        />

                        <View style={styles.productDetails}>
                          <Text style={styles.productName}>
                            {item.name}
                          </Text>

                          <Text style={styles.productMeta}>
                            {item.quantity} ×{" "}
                            {money(item.price)}
                          </Text>

                          {!!item.color && (
                            <Text style={styles.productMeta}>
                              Color: {item.color}
                            </Text>
                          )}

                          <Text style={styles.productSubtotal}>
                            {money(
                              item.price * item.quantity
                            )}
                          </Text>
                        </View>
                      </View>
                    );
                  }
                )}
              </View>

              {/* ORDER SUMMARY */}

              <View style={styles.summary}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>
                    Total
                  </Text>

                  <Text style={styles.totalValue}>
                    {money(order.total)}
                  </Text>
                </View>

                <Text style={styles.summaryText}>
                  Payment: Cash on Delivery (COD)
                </Text>

                <Text style={styles.summaryText}>
                  Preferred date:{" "}
                  {formatDate(
                    order.preferredDeliveryDate
                  )}
                </Text>

                <Text style={styles.summaryText}>
                  Order status: {order.status}
                </Text>

                <Text style={styles.summaryText}>
                  Delivery status: {order.deliveryStatus}
                </Text>

                <Text style={styles.summaryText}>
                  Confirmed date:{" "}
                  {formatDate(
                    order.confirmedDeliveryDate
                  )}
                </Text>
              </View>

              {/* DELIVERY ACTIONS */}

              {isConfirmed ? (
                <View style={styles.actions}>
                  {canSchedule && (
                    <Pressable
                      disabled={saving}
                      style={[
                        S.chip,
                        S.chipActive,
                        saving && styles.disabledButton,
                      ]}
                      onPress={() => openCalendar(order)}
                    >
                      <Text style={styles.primaryText}>
                        {order.deliveryStatus === "Pending"
                          ? "Confirm Schedule"
                          : "Reschedule"}
                      </Text>
                    </Pressable>
                  )}

                  {stage &&
                    !!order.confirmedDeliveryDate && (
                      <Pressable
                        disabled={saving}
                        style={[
                          styles.nextStageButton,
                          saving && styles.disabledButton,
                        ]}
                        onPress={() => {
                          setStageConfirmation({
                            orderId: order.id,
                            next: stage.next,
                          });
                        }}
                      >
                        <Ionicons
                          name={stage.icon}
                          color={C.green}
                          size={16}
                        />

                        <Text style={styles.nextStageText}>
                          {stage.label}
                        </Text>
                      </Pressable>
                    )}

                  {order.deliveryStatus === "Delivered" && (
                    <View style={styles.completedBox}>
                      <Ionicons
                        name="checkmark-circle"
                        size={19}
                        color={C.green}
                      />

                      <Text style={styles.completedText}>
                        Delivery completed.
                      </Text>
                    </View>
                  )}

                  {order.deliveryStatus === "Delivered" && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Delete delivered order ${order.id}`}
                      disabled={saving}
                      style={[
                        styles.deleteDeliveredButton,
                        saving && styles.disabledButton,
                      ]}
                      onPress={() =>
                        setDeleteConfirmationId(order.id)
                      }
                    >
                      <Ionicons
                        name="trash-outline"
                        size={17}
                        color="#A43F3F"
                      />

                      <Text style={styles.deleteDeliveredText}>
                        Delete Delivered Order
                      </Text>
                    </Pressable>
                  )}
                </View>
              ) : (
                <View>
                  <View style={styles.noticeBox}>
                    <Ionicons
                      name={
                        order.status === "Rejected"
                          ? "close-circle-outline"
                          : "time-outline"
                      }
                      size={17}
                      color={C.green}
                    />

                    <Text style={styles.noticeText}>
                      {order.status === "Rejected"
                        ? "This order was rejected. Delivery scheduling is unavailable."
                        : "Confirm this order in Customer Orders before scheduling delivery."}
                    </Text>
                  </View>

                  {order.status === "Rejected" &&
                    order.deliveryStatus === "Pending" && (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Delete rejected order ${order.id}`}
                        disabled={saving}
                        style={[
                          styles.deleteDeliveredButton,
                          styles.rejectedDeleteButton,
                          saving && styles.disabledButton,
                        ]}
                        onPress={() =>
                          setDeleteConfirmationId(order.id)
                        }
                      >
                        <Ionicons
                          name="trash-outline"
                          size={17}
                          color="#A43F3F"
                        />

                        <Text style={styles.deleteDeliveredText}>
                          Delete Rejected Order
                        </Text>
                      </Pressable>
                    )}
                </View>
              )}
            </View>
          );
        })}
      </View>

      {/* DELIVERY DATE MODAL */}

      <DeliveryDateModal
        visible={calendarOpen}
        saving={saving}
        onClose={closeCalendar}
        onConfirm={date => {
          if (selectedOrder) {
            void saveDelivery(
              selectedOrder.id,
              "Scheduled",
              date
            );
          }
        }}
      />

      {/* DELIVERY CONFIRMATION */}

      <Modal
        visible={stageConfirmation !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!saving) setStageConfirmation(null);
        }}
      >
        <View style={styles.confirmBackdrop}>
          <View style={styles.confirmCard}>
            <View style={styles.confirmIcon}>
              <Ionicons
                name="car-outline"
                color={C.green}
                size={25}
              />
            </View>

            <Text style={styles.confirmTitle}>
              {stageConfirmation?.next === "Delivered"
                ? "Complete Delivery"
                : "Update Delivery"}
            </Text>

            <Text style={styles.confirmDescription}>
              {stageConfirmation?.next === "Delivered"
                ? "Mark this order as Delivered and deduct all purchased products from stock, including linked silkworm inventory?"
                : stageConfirmation
                  ? `Change delivery status to "${stageConfirmation.next}"?`
                  : ""}
            </Text>

            <View style={styles.confirmActions}>
              <Pressable
                disabled={saving}
                onPress={() =>
                  setStageConfirmation(null)
                }
                style={styles.confirmCancel}
              >
                <Text style={styles.confirmCancelText}>
                  Cancel
                </Text>
              </Pressable>

              <Pressable
                disabled={saving}
                onPress={() => {
                  const choice = stageConfirmation;
                  if (!choice || saving) return;

                  setStageConfirmation(null);

                  void saveDelivery(
                    choice.orderId,
                    choice.next
                  );
                }}
                style={[
                  styles.confirmAccept,
                  saving && styles.disabledButton,
                ]}
              >
                {saving ? (
                  <ActivityIndicator
                    color="#FFFFFF"
                    size="small"
                  />
                ) : (
                  <Text style={styles.confirmAcceptText}>
                    Confirm
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* DELETE ORDER CONFIRMATION */}

      <Modal
        visible={deleteConfirmationId !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!saving) setDeleteConfirmationId(null);
        }}
      >
        <View style={styles.confirmBackdrop}>
          <View style={styles.confirmCard}>
            <View style={styles.deleteConfirmIcon}>
              <Ionicons
                name="trash-outline"
                color="#A43F3F"
                size={25}
              />
            </View>

            <Text style={styles.confirmTitle}>
              {orders.find(
                order => order.id === deleteConfirmationId
              )?.status === "Rejected"
                ? "Delete Rejected Order?"
                : "Delete Delivered Order?"}
            </Text>

            <Text style={styles.confirmDescription}>
              This permanently removes the order record from
              Firestore, including its appearance in customer
              order history and delivery management. This
              action cannot be undone.
            </Text>

            <View style={styles.confirmActions}>
              <Pressable
                disabled={saving}
                onPress={() =>
                  setDeleteConfirmationId(null)
                }
                style={styles.confirmCancel}
              >
                <Text style={styles.confirmCancelText}>
                  Cancel
                </Text>
              </Pressable>

              <Pressable
                disabled={saving}
                onPress={() => {
                  if (deleteConfirmationId) {
                    void deleteEligibleOrder(
                      deleteConfirmationId
                    );
                  }
                }}
                style={[
                  styles.deleteConfirmButton,
                  saving && styles.disabledButton,
                ]}
              >
                {saving ? (
                  <ActivityIndicator
                    color="#FFFFFF"
                    size="small"
                  />
                ) : (
                  <Text style={styles.confirmAcceptText}>
                    Delete Permanently
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* CALENDAR INFORMATION */}

      <View style={S.card}>
        <Text style={S.sectionTitle}>
          Delivery Calendar
        </Text>

        <Text style={styles.calendarInfo}>
          Select a date to confirm or reschedule delivery.
          Each order moves through Scheduled, Preparing,
          Out for Delivery, and Delivered. SilkMart does
          not include courier integration or live vehicle tracking.
        </Text>
      </View>
    </ScrollView>
  );
}

// =====================================
// STYLES
// =====================================

const styles = StyleSheet.create({
  confirmBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },

  confirmCard: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "#FFFDF8",
    borderRadius: 20,
    padding: 22,
    alignItems: "center",
  },

  confirmIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#E6F0E4",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },

  confirmTitle: {
    color: C.dark,
    fontSize: 22,
    fontFamily: "serif",
    marginBottom: 8,
  },

  confirmDescription: {
    color: "#627C6E",
    textAlign: "center",
    fontSize: 13,
    lineHeight: 21,
  },

  confirmActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 22,
    width: "100%",
  },

  confirmCancel: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },

  confirmCancelText: {
    color: C.dark,
    fontWeight: "700",
    fontSize: 12,
  },

  confirmAccept: {
    flex: 1,
    minHeight: 44,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.green,
  },

  confirmAcceptText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 12,
  },

  deleteConfirmIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#FFF0EC",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },

  deleteConfirmButton: {
    flex: 1,
    minHeight: 44,
    backgroundColor: "#A43F3F",
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },

  rejectedDeleteButton: {
    marginTop: 10,
  },

  deleteDeliveredButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderWidth: 1,
    borderColor: "#E8C9C3",
    backgroundColor: "#FFF8F5",
    borderRadius: 11,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },

  deleteDeliveredText: {
    color: "#A43F3F",
    fontSize: 11,
    fontWeight: "700",
  },

  statsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
    marginBottom: 16,
  },

  filters: {
    gap: 7,
    marginBottom: 15,
  },

  orderContainer: {
    borderTopWidth: 1,
    borderColor: C.line,
    paddingVertical: 15,
    gap: 7,
  },

  customerText: {
    color: MUTED,
    fontSize: 10,
  },

  productList: {
    gap: 9,
    marginTop: 8,
    marginBottom: 5,
  },

  productRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
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

  productImage: {
    width: "100%",
    height: "100%",
  },

  productDetails: {
    flex: 1,
    gap: 3,
  },

  productName: {
    color: C.dark,
    fontSize: 12,
    fontWeight: "700",
  },

  productMeta: {
    color: MUTED,
    fontSize: 11,
  },

  productSubtotal: {
    color: C.green,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },

  summary: {
    marginTop: 6,
    padding: 12,
    backgroundColor: "#F0F5EC",
    borderRadius: 12,
    gap: 6,
  },

  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 3,
  },

  summaryLabel: {
    color: C.dark,
    fontSize: 12,
    fontWeight: "700",
  },

  totalValue: {
    color: C.green,
    fontSize: 15,
    fontWeight: "700",
  },

  summaryText: {
    color: MUTED,
    fontSize: 11,
    lineHeight: 17,
  },

  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },

  primaryText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },

  nextStageButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: SURFACE,
    borderRadius: 11,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },

  nextStageText: {
    color: C.dark,
    fontSize: 11,
    fontWeight: "700",
  },

  disabledButton: {
    opacity: 0.4,
  },

  completedBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#E6F2E8",
    padding: 11,
    borderRadius: 11,
  },

  completedText: {
    color: C.green,
    fontSize: 11,
    fontWeight: "700",
  },

  noticeBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "#EAF2E8",
    padding: 12,
    borderRadius: 11,
    marginTop: 7,
  },

  noticeText: {
    flex: 1,
    color: MUTED,
    fontSize: 11,
    lineHeight: 17,
  },

  errorText: {
    color: "#B34D4D",
    fontSize: 12,
    marginBottom: 10,
  },

  calendarInfo: {
    color: MUTED,
    fontSize: 11,
    lineHeight: 19,
    marginTop: 9,
  },
});
