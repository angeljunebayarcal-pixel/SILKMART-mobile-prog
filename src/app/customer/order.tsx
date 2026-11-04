import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  onAuthStateChanged,
  type User,
} from "firebase/auth";

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

import { auth, db } from "../../firebase/config";

import {
  readDemoOrders,
  type DemoOrder,
} from "../../lib/customerOrders";

// =====================================
// COLORS
// =====================================

const GREEN = "#235F45";
const DARK = "#173B2C";
const MUTED = "#627C6E";
const CREAM = "#FAF9F1";
const SURFACE = "#FFFDF8";
const LINE = "#D5DDCF";

// =====================================
// FILTERS
// =====================================

type Filter =
  | "All"
  | "Pending"
  | "Confirmed"
  | "Rejected"
  | "Completed";

const filters: Filter[] = [
  "All",
  "Pending",
  "Confirmed",
  "Rejected",
  "Completed",
];

// =====================================
// HELPERS
// =====================================

function money(amount: number): string {
  return `₱${Number(amount || 0).toLocaleString(
    "en-PH",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }
  )}`;
}

function displayDate(value?: string): string {
  if (!value) return "Not scheduled";

  const parts = value.split("-");

  if (
    parts.length === 3 &&
    /^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
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

function orderDate(value: string): string {
  if (!value) return "Date unavailable";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return date.toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function orderMatchesFilter(
  order: DemoOrder,
  filter: Filter
): boolean {
  if (filter === "All") {
    return true;
  }

  if (filter === "Completed") {
    return order.deliveryStatus === "Delivered";
  }

  if (
    filter === "Confirmed" &&
    order.deliveryStatus === "Delivered"
  ) {
    return false;
  }

  return order.status === filter;
}

function statusColors(status: string) {
  if (status === "Confirmed") {
    return {
      backgroundColor: "#E5F2E8",
      color: "#277348",
    };
  }

  if (status === "Rejected") {
    return {
      backgroundColor: "#FCECEC",
      color: "#A43F3F",
    };
  }

  if (
    status === "Delivered" ||
    status === "Completed"
  ) {
    return {
      backgroundColor: "#E5F2E8",
      color: "#277348",
    };
  }

  return {
    backgroundColor: "#FCF0D9",
    color: "#986923",
  };
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
// PRODUCT IMAGE
// =====================================

function ProductPhoto({
  uri,
  name,
}: {
  uri?: string;
  name: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [uri]);

  return (
    <View style={styles.productPhotoBox}>
      {uri && !failed ? (
        <Image
          source={{ uri }}
          style={styles.productPhoto}
          resizeMode="cover"
          accessibilityLabel={`${name} product photo`}
          onError={() => setFailed(true)}
        />
      ) : (
        <Ionicons
          name="bag-handle-outline"
          size={23}
          color={GREEN}
        />
      )}
    </View>
  );
}

// =====================================
// MAIN SCREEN
// =====================================

export default function OrdersScreen() {
  const router = useRouter();

  const [user, setUser] =
    useState<User | null>(auth.currentUser);

  const [authReady, setAuthReady] =
    useState(false);

  const [filter, setFilter] =
    useState<Filter>("All");

  const [orders, setOrders] =
    useState<DemoOrder[]>([]);

  const [productImages, setProductImages] =
    useState<Record<string, string>>({});

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [orderToDelete, setOrderToDelete] =
    useState<DemoOrder | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  function requestOrderDeletion(order: DemoOrder) {
    if (order.status !== "Confirmed" && order.status !== "Rejected") {
      return;
    }
    setDeleteError("");
    setOrderToDelete(order);
  }

  async function confirmOrderDeletion() {
    const selected = orderToDelete;
    const uid = user?.uid;
    if (!selected || !uid || deleteBusy) return;

    setDeleteBusy(true);
    setDeleteError("");

    try {
      if (auth.currentUser?.uid !== uid) {
        throw new Error("Your session has changed. Please sign in again.");
      }

      const orderRef = doc(db, "orders", selected.id);
      const snapshot = await getDoc(orderRef);
      if (!snapshot.exists()) {
        throw new Error("This order does not exist in Firestore. Older device-only orders cannot be deleted using this action.");
      }
      const data = snapshot.data();
      if (data.customerUid !== uid) {
        throw new Error("You can only delete your own orders.");
      }
      if (data.status !== "Confirmed" && data.status !== "Rejected") {
        throw new Error("Only Confirmed or Rejected orders can be deleted.");
      }
      if (auth.currentUser?.uid !== uid) {
        throw new Error("Your session has changed. Please sign in again.");
      }

      // The security rules independently enforce ownership and status.
      await deleteDoc(orderRef);

      // An older AsyncStorage copy with the same ID must not reappear.
      // Firestore is the authoritative record; a local cleanup failure
      // is reported but must not undo a successful Firestore deletion.
      try {
        const key = `silkmart:demo-orders:${uid}`;
        const raw = await AsyncStorage.getItem(key);
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            await AsyncStorage.setItem(
              key,
              JSON.stringify(parsed.filter(entry =>
                !entry || typeof entry !== "object" ||
                (entry as { id?: unknown }).id !== selected.id
              ))
            );
          }
        }
      } catch (cacheError) {
        console.warn("Order deleted, but local legacy cache cleanup failed:", cacheError);
      }

      setOrders(current => current.filter(order => order.id !== selected.id));
      setOrderToDelete(null);
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : "Unable to delete this order.");
    } finally {
      setDeleteBusy(false);
    }
  }


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
        setProductImages({});
        setError("");
      }
    );
  }, []);

  // =====================================
  // LIVE ORDER UPDATES
  // =====================================

  useFocusEffect(
    useCallback(() => {
      let active = true;
      let requestNumber = 0;

      if (!authReady || !user) {
        setLoading(false);
        setOrders([]);
        return () => {
          active = false;
        };
      }

      const uid = user.uid;

      setLoading(true);
      setError("");

      async function loadOrders() {
        const request = ++requestNumber;

        try {
          // Reads Firestore orders and
          // compatible older local orders.

          const saved = await readDemoOrders(uid);

          if (
            !active ||
            request !== requestNumber ||
            auth.currentUser?.uid !== uid
          ) {
            return;
          }

          setOrders(saved);
          setError("");
          setLoading(false);

          // Product images are loaded from
          // their original product documents.
          // New orders no longer duplicate
          // Base64 images.

          const ids = Array.from(
            new Set(
              saved.flatMap(order =>
                (order.items ?? [])
                  .map(item => item.productId)
                  .filter(Boolean)
              )
            )
          );

          const images: Record<string, string> =
            {};

          await Promise.all(
            ids.map(async productId => {
              try {
                const snapshot = await getDoc(
                  doc(
                    db,
                    "products",
                    productId
                  )
                );

                if (!snapshot.exists()) {
                  return;
                }

                const imageUrl =
                  snapshot.data().imageUrl;

                if (
                  typeof imageUrl === "string" &&
                  imageUrl.length > 0
                ) {
                  images[productId] = imageUrl;
                }
              } catch {
                // Existing saved images or
                // placeholder icons are used.
              }
            })
          );

          if (
            active &&
            request === requestNumber &&
            auth.currentUser?.uid === uid
          ) {
            setProductImages(images);
          }
        } catch (reason) {
          if (
            !active ||
            request !== requestNumber
          ) {
            return;
          }

          setError(
            reason instanceof Error
              ? reason.message
              : "Unable to load your orders."
          );

          setLoading(false);
        }
      }

      // Initial read includes older
      // device-only orders.

      void loadOrders();

      // Refresh the screen whenever
      // Firestore reports an order change.

      const ordersQuery = query(
        collection(db, "orders"),
        where("customerUid", "==", uid)
      );

      const unsubscribe = onSnapshot(
        ordersQuery,
        () => {
          if (active) {
            void loadOrders();
          }
        },
        reason => {
          if (!active) return;

          setLoading(false);

          setError(
            reason.code === "permission-denied"
              ? "Firestore denied access to your orders. Please check your account and security rules."
              : "Unable to synchronize your orders."
          );
        }
      );

      return () => {
        active = false;
        unsubscribe();
      };
    }, [user, authReady])
  );

  // =====================================
  // FILTER ORDER HISTORY
  // =====================================

  const visibleOrders = orders.filter(order =>
    orderMatchesFilter(order, filter)
  );

  const completedCount = orders.filter(
    order =>
      order.deliveryStatus === "Delivered"
  ).length;

  // =====================================
  // RENDER
  // =====================================

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" />

      {/* HEADER */}

      <View style={styles.header}>
        <Pressable
          onPress={() =>
            router.push("/customer/shopsilk")
          }
          style={styles.back}
          accessibilityLabel="Back to Shop Silk"
        >
          <Ionicons
            name="arrow-back"
            size={21}
            color={GREEN}
          />
        </Pressable>

        <Text style={styles.headerTitle}>
          My Orders
        </Text>

        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
      >
        {/* PAGE HEADING */}

        <FadeUp delay={100}>
          <Text style={styles.eyebrow}>
            ORDER HISTORY
          </Text>

          <Text style={styles.title}>
            Your orders.
          </Text>

          <Text style={styles.intro}>
            Track your purchases, order
            confirmations, and delivery
            schedules.
          </Text>
        </FadeUp>

        {/* FILTERS */}

        <FadeUp delay={200}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filters}
          >
            {filters.map(item => {
              const active = filter === item;

              const count =
                item === "All"
                  ? orders.length
                  : item === "Completed"
                    ? completedCount
                    : orders.filter(order =>
                        orderMatchesFilter(
                          order,
                          item
                        )
                      ).length;

              return (
                <Pressable
                  key={item}
                  onPress={() =>
                    setFilter(item)
                  }
                  style={({ pressed }) => [
                    styles.chip,
                    active &&
                      styles.chipActive,
                    pressed && {
                      opacity: 0.8,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      active &&
                        styles.chipTextActive,
                    ]}
                  >
                    {item} ({count})
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </FadeUp>

        {/* INFORMATION */}

        <FadeUp delay={280}>
          <View style={styles.tip}>
            <Ionicons
              name="information-circle-outline"
              size={20}
              color={GREEN}
            />

            <Text style={styles.tipText}>
              Your preferred delivery date is
              a request until SilkMart staff
              confirms the schedule. You can
              check staff responses in
              Notifications.
            </Text>
          </View>
        </FadeUp>

        {/* LOADING */}

        {!authReady || loading ? (
          <ActivityIndicator
            color={GREEN}
            size="large"
            style={{ marginTop: 40 }}
          />
        ) : !user ? (
          <FadeUp delay={320}>
            <View style={styles.emptyCard}>
              <View style={styles.iconCircle}>
                <Ionicons
                  name="person-outline"
                  size={39}
                  color={GREEN}
                />
              </View>

              <Text style={styles.emptyTitle}>
                Sign in to view orders
              </Text>

              <Text style={styles.emptyText}>
                Use your SilkMart customer
                account to view your orders.
              </Text>

              <Pressable
                style={styles.button}
                onPress={() =>
                  router.push("/login")
                }
              >
                <Text style={styles.buttonText}>
                  Go to Login
                </Text>

                <Ionicons
                  name="arrow-forward"
                  size={18}
                  color="#FFFFFF"
                />
              </Pressable>
            </View>
          </FadeUp>
        ) : visibleOrders.length === 0 ? (
          <FadeUp delay={320}>
            <View style={styles.emptyCard}>
              <View style={styles.iconCircle}>
                <Ionicons
                  name="receipt-outline"
                  size={39}
                  color={GREEN}
                />
              </View>

              <Text style={styles.emptyTitle}>
                {error
                  ? "Unable to load orders"
                  : orders.length > 0
                    ? `No ${filter.toLowerCase()} orders`
                    : "No orders yet"}
              </Text>

              <Text style={styles.emptyText}>
                {error
                  ? error
                  : "Your SilkMart orders will appear here once you place an order."}
              </Text>

              {!error && (
                <Pressable
                  style={styles.button}
                  onPress={() =>
                    router.push(
                      "/customer/shopsilk"
                    )
                  }
                >
                  <Text style={styles.buttonText}>
                    Browse Shop Silk
                  </Text>

                  <Ionicons
                    name="arrow-forward"
                    size={18}
                    color="#FFFFFF"
                  />
                </Pressable>
              )}
            </View>
          </FadeUp>
        ) : (
          visibleOrders.map((order, index) => {
            const delivered =
              order.deliveryStatus ===
              "Delivered";

            const currentStatus = delivered
              ? "Delivered"
              : order.status;

            const colors =
              statusColors(currentStatus);

            return (
              <FadeUp
                key={order.id}
                delay={
                  300 +
                  Math.min(index, 8) * 45
                }
              >
                <View style={styles.orderCard}>
                  {/* ORDER HEADER */}

                  <View style={styles.orderHead}>
                    <View
                      style={{ flex: 1 }}
                    >
                      <Text
                        style={styles.orderId}
                        numberOfLines={2}
                      >
                        Order #{order.id}
                      </Text>

                      <Text
                        style={styles.orderDate}
                      >
                        {orderDate(
                          order.createdAt
                        )}
                      </Text>
                    </View>

                    <View style={styles.orderActions}>
                      {(order.status === "Confirmed" || order.status === "Rejected") && (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Permanently delete order ${order.id}`}
                          onPress={() => requestOrderDeletion(order)}
                          style={({ pressed }) => [
                            styles.deleteIconButton,
                            pressed && { opacity: 0.6 },
                          ]}
                        >
                          <Ionicons name="trash-outline" size={17} color="#B34D4D" />
                        </Pressable>
                      )}
                    <View
                      style={[
                        styles.statusPill,
                        {
                          backgroundColor:
                            colors.backgroundColor,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusText,
                          {
                            color:
                              colors.color,
                          },
                        ]}
                      >
                        {currentStatus}
                      </Text>
                    </View>
                    </View>
                  </View>

                  {/* PRODUCTS */}

                  {(order.items ?? []).map(
                    (item, itemIndex) => (
                      <View
                        key={`${item.productId}:${item.color}:${itemIndex}`}
                        style={styles.itemRow}
                      >
                        <ProductPhoto
                          uri={
                            productImages[
                              item.productId
                            ] ||
                            item.imageUrl ||
                            ""
                          }
                          name={item.name}
                        />

                        <View style={{ flex: 1 }}>
                          <Text
                            style={styles.itemName}
                          >
                            {item.name}
                          </Text>

                          <Text
                            style={styles.itemMeta}
                          >
                            {item.quantity} ×{" "}
                            {money(item.price)}
                          </Text>

                          {!!item.color && (
                            <Text
                              style={styles.itemMeta}
                            >
                              Color: {item.color}
                            </Text>
                          )}
                        </View>

                        <Text
                          style={styles.itemSubtotal}
                        >
                          {money(
                            item.quantity *
                              item.price
                          )}
                        </Text>
                      </View>
                    )
                  )}

                  {/* DELIVERY INFORMATION */}

                  <View
                    style={styles.deliverySection}
                  >
                    <View
                      style={styles.deliveryHeading}
                    >
                      <Ionicons
                        name="calendar-outline"
                        size={18}
                        color={GREEN}
                      />

                      <Text
                        style={styles.deliveryTitle}
                      >
                        Delivery Information
                      </Text>
                    </View>

                    <View
                      style={styles.detailRow}
                    >
                      <Text
                        style={styles.detailLabel}
                      >
                        Preferred Date
                      </Text>

                      <Text
                        style={styles.detailValue}
                      >
                        {order.preferredDeliveryDate
                          ? displayDate(
                              order.preferredDeliveryDate
                            )
                          : "Not requested"}
                      </Text>
                    </View>

                    <View
                      style={styles.detailRow}
                    >
                      <Text
                        style={styles.detailLabel}
                      >
                        Confirmed Date
                      </Text>

                      <Text
                        style={styles.detailValue}
                      >
                        {displayDate(
                          order.confirmedDeliveryDate
                        )}
                      </Text>
                    </View>

                    <View
                      style={styles.detailRow}
                    >
                      <Text
                        style={styles.detailLabel}
                      >
                        Delivery Status
                      </Text>

                      <Text
                        style={[
                          styles.detailValue,
                          {
                            color: GREEN,
                          },
                        ]}
                      >
                        {order.deliveryStatus ||
                          "Pending"}
                      </Text>
                    </View>

                    <View
                      style={styles.detailRow}
                    >
                      <Text
                        style={styles.detailLabel}
                      >
                        Payment
                      </Text>

                      <Text
                        style={styles.detailValue}
                      >
                        Cash on Delivery
                      </Text>
                    </View>
                  </View>

                  {/* ORDER TOTAL */}

                  <View style={styles.orderTotal}>
                    <Text
                      style={styles.totalLabel}
                    >
                      Order Total
                    </Text>

                    <Text
                      style={styles.totalValue}
                    >
                      {money(order.total)}
                    </Text>
                  </View>

                  {/* NOTIFICATIONS LINK */}

                  <Pressable
                    onPress={() =>
                      router.push(
                        "/customer/notif-cust"
                      )
                    }
                    style={({ pressed }) => [
                      styles.messageButton,
                      pressed && {
                        opacity: 0.85,
                      },
                    ]}
                  >
                    <Ionicons
                      name="chatbubbles-outline"
                      size={17}
                      color={GREEN}
                    />

                    <Text
                      style={styles.messageText}
                    >
                      View Updates & Messages
                    </Text>

                    <Ionicons
                      name="arrow-forward"
                      size={16}
                      color={GREEN}
                    />
                  </Pressable>
                </View>
              </FadeUp>
            );
          })
        )}

        {!!error && orders.length > 0 && (
          <Text style={styles.error}>
            {error}
          </Text>
        )}
      </ScrollView>

      <Modal
        visible={!!orderToDelete}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!deleteBusy) setOrderToDelete(null); }}
      >
        <View style={styles.deleteOverlay}>
          <View style={styles.deleteDialog}>
            <Ionicons name="trash-outline" color="#B34D4D" size={26} />
            <Text style={styles.deleteTitle}>Delete order permanently?</Text>
            <Text style={styles.deleteDescription}>
              Only order #{orderToDelete?.id} will be deleted from the Firestore orders collection. This cannot be undone and may affect delivery management. Existing chat subcollection documents are not automatically deleted.
            </Text>
            {!!deleteError && <Text style={styles.deleteErrorText}>{deleteError}</Text>}
            <View style={styles.deleteButtons}>
              <Pressable
                disabled={deleteBusy}
                onPress={() => { setOrderToDelete(null); setDeleteError(""); }}
                style={styles.cancelDeleteButton}
              >
                <Text style={styles.cancelDeleteText}>Cancel</Text>
              </Pressable>
              <Pressable
                disabled={deleteBusy}
                onPress={() => void confirmOrderDeletion()}
                style={[styles.confirmDeleteButton, deleteBusy && { opacity: 0.6 }]}
              >
                {deleteBusy ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.confirmDeleteText}>Delete</Text>
                )}
              </Pressable>
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
    alignItems: "center",
    justifyContent: "space-between",
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
    fontFamily: "serif",
    fontSize: 23,
    color: DARK,
  },

  content: {
    padding: 22,
    paddingTop: 32,
    paddingBottom: 40,
  },

  eyebrow: {
    color: GREEN,
    fontWeight: "700",
    fontSize: 10,
    letterSpacing: 2,
  },

  title: {
    fontFamily: "serif",
    fontSize: 36,
    color: DARK,
    marginTop: 10,
  },

  intro: {
    fontSize: 13,
    lineHeight: 21,
    color: MUTED,
    marginTop: 8,
  },

  filters: {
    flexDirection: "row",
    gap: 8,
    paddingVertical: 23,
  },

  chip: {
    backgroundColor: "#E8EFDF",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },

  chipActive: {
    backgroundColor: GREEN,
  },

  chipText: {
    fontSize: 12,
    fontWeight: "600",
    color: DARK,
  },

  chipTextActive: {
    color: "#FFFFFF",
  },

  tip: {
    padding: 14,
    backgroundColor: "#EAF2E8",
    borderRadius: 13,
    marginTop: 3,
    marginBottom: 8,
    flexDirection: "row",
    gap: 9,
    alignItems: "flex-start",
  },

  tipText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 18,
    color: MUTED,
  },

  emptyCard: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 20,
    backgroundColor: SURFACE,
    alignItems: "center",
    paddingVertical: 42,
    paddingHorizontal: 25,
  },

  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: "#E6F0E4",
    justifyContent: "center",
    alignItems: "center",
  },

  emptyTitle: {
    color: DARK,
    fontFamily: "serif",
    fontSize: 25,
    marginTop: 20,
    textAlign: "center",
  },

  emptyText: {
    fontSize: 12,
    lineHeight: 20,
    color: MUTED,
    textAlign: "center",
    marginTop: 10,
    marginBottom: 25,
  },

  button: {
    backgroundColor: GREEN,
    height: 49,
    borderRadius: 25,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 12,
  },

  buttonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },

  orderCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: LINE,
    backgroundColor: SURFACE,
    padding: 17,
    marginTop: 15,
  },

  orderHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingBottom: 13,
    borderBottomWidth: 1,
    borderBottomColor: "#E4EADF",
  },

  orderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  deleteIconButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "#FCECEC",
    alignItems: "center",
    justifyContent: "center",
  },
  deleteOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  deleteDialog: {
    width: "100%",
    maxWidth: 390,
    borderRadius: 18,
    backgroundColor: SURFACE,
    padding: 21,
    gap: 14,
  },
  deleteTitle: {
    color: DARK,
    fontSize: 18,
    fontWeight: "700",
  },
  deleteDescription: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 19,
  },
  deleteErrorText: {
    color: "#B34D4D",
    fontSize: 12,
  },
  deleteButtons: {
    flexDirection: "row",
    gap: 10,
  },
  cancelDeleteButton: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: LINE,
    padding: 13,
    alignItems: "center",
  },
  confirmDeleteButton: {
    flex: 1,
    borderRadius: 10,
    padding: 13,
    backgroundColor: "#B34D4D",
    alignItems: "center",
    justifyContent: "center",
  },
  cancelDeleteText: { color: DARK, fontWeight: "600" },
  confirmDeleteText: { color: "#FFFFFF", fontWeight: "700" },

  orderId: {
    color: DARK,
    fontWeight: "700",
    fontSize: 13,
  },

  orderDate: {
    color: MUTED,
    fontSize: 10,
    marginTop: 6,
  },

  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 14,
  },

  statusText: {
    fontWeight: "700",
    fontSize: 10,
  },

  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
  },

  productPhotoBox: {
    width: 49,
    height: 49,
    borderRadius: 11,
    backgroundColor: "#E6F0E4",
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },

  productPhoto: {
    width: "100%",
    height: "100%",
  },

  itemName: {
    color: DARK,
    fontWeight: "600",
    fontSize: 12,
  },

  itemMeta: {
    color: MUTED,
    fontSize: 11,
    marginTop: 4,
  },

  itemSubtotal: {
    color: GREEN,
    fontSize: 11,
    fontWeight: "700",
  },

  deliverySection: {
    borderTopWidth: 1,
    borderTopColor: "#E4EADF",
    marginTop: 5,
    paddingTop: 15,
    paddingBottom: 13,
    gap: 10,
  },

  deliveryHeading: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    marginBottom: 6,
  },

  deliveryTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: DARK,
  },

  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },

  detailLabel: {
    color: MUTED,
    fontSize: 11,
    flex: 1,
  },

  detailValue: {
    color: DARK,
    fontSize: 11,
    fontWeight: "600",
    flex: 1,
    textAlign: "right",
  },

  orderTotal: {
    borderTopWidth: 1,
    borderTopColor: "#E4EADF",
    paddingTop: 15,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  totalLabel: {
    color: DARK,
    fontWeight: "600",
    fontSize: 13,
  },

  totalValue: {
    color: GREEN,
    fontWeight: "700",
    fontSize: 18,
  },

  messageButton: {
    backgroundColor: "#EAF2E8",
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    marginTop: 17,
  },

  messageText: {
    fontSize: 12,
    fontWeight: "700",
    color: GREEN,
  },

  error: {
    color: "#A43F3F",
    fontSize: 12,
    marginTop: 16,
  },
});