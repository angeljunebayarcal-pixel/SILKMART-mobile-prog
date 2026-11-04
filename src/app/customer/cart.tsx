
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
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { onAuthStateChanged, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

import { auth, db } from "../../firebase/config";

import {
  type CartItem,
  readCart,
  writeCart,
} from "../../lib/customerCart";

import { createDemoOrder } from "../../lib/customerOrders";
import DeliveryDateModal from "../../components/DeliveryDateModal";

// =====================================
// COLORS
// =====================================

const GREEN = "#235F45";
const DARK = "#173B2C";
const MUTED = "#627C6E";
const CREAM = "#FAF9F1";

// =====================================
// HELPERS
// =====================================

const money = (n: number) =>
  `₱${n.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

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

  const rise = useRef(
    new Animated.Value(16)
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

      Animated.timing(rise, {
        toValue: 0,
        delay,
        duration: 520,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);

    animation.start();

    return () => animation.stop();
  }, [delay, opacity, rise]);

  return (
    <Animated.View
      style={{
        opacity,
        transform: [{ translateY: rise }],
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
    <View style={styles.itemIcon}>
      {!!imageUrl && !failed ? (
        <Image
          source={{ uri: imageUrl }}
          resizeMode="cover"
          style={styles.itemImage}
          accessibilityLabel={`${name} product image`}
          onError={() => setFailed(true)}
        />
      ) : (
        <Ionicons
          name="bag-handle-outline"
          color={GREEN}
          size={25}
        />
      )}
    </View>
  );
}

// =====================================
// MAIN CART SCREEN
// =====================================

export default function CartScreen() {
  const router = useRouter();

  const [user, setUser] =
    useState<User | null>(null);

  const [authReady, setAuthReady] =
    useState(false);

  const [items, setItems] =
    useState<CartItem[]>([]);

  const [productImages, setProductImages] =
    useState<Record<string, string>>({});

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [saving, setSaving] =
    useState(false);

  const [
    showDeliveryCalendar,
    setShowDeliveryCalendar,
  ] = useState(false);

  // =====================================
  // AUTHENTICATION
  // =====================================

  useEffect(() => {
    return onAuthStateChanged(auth, next => {
      setUser(next);
      setItems([]);
      setProductImages({});
      setAuthReady(true);
    });
  }, []);

  // =====================================
  // LOAD SHOPPING CART
  // =====================================

  useFocusEffect(
    useCallback(() => {
      let active = true;

      async function load() {
        setLoading(true);
        setItems([]);
        setProductImages({});
        setError("");

        if (!authReady || !user) {
          if (active) {
            setLoading(false);
          }

          return;
        }

        try {
          const cart = await readCart(user.uid);

          if (
            active &&
            auth.currentUser?.uid === user.uid
          ) {
            setItems(cart);
          }

          // Retrieve product images from
          // their original Firestore documents.

          const ids = Array.from(
            new Set(
              cart.map(item => item.productId)
            )
          );

          const images: Record<string, string> = {};

          await Promise.all(
            ids.map(async productId => {
              try {
                const product = await getDoc(
                  doc(
                    db,
                    "products",
                    productId
                  )
                );

                if (!product.exists()) {
                  return;
                }

                const imageUrl =
                  product.data().imageUrl;

                if (
                  typeof imageUrl === "string" &&
                  imageUrl.length > 0
                ) {
                  images[productId] = imageUrl;
                }
              } catch {
                // Retain saved image or
                // placeholder if lookup fails.
              }
            })
          );

          if (
            active &&
            auth.currentUser?.uid === user.uid
          ) {
            setProductImages(images);
          }
        } catch (reason) {
          if (active) {
            setError(
              reason instanceof Error
                ? reason.message
                : "Could not load your bag. Please try again."
            );
          }
        } finally {
          if (active) {
            setLoading(false);
          }
        }
      }

      void load();

      return () => {
        active = false;
      };
    }, [user, authReady])
  );

  // =====================================
  // UPDATE CART ITEMS
  // =====================================

  async function updateItems(
    updated: CartItem[]
  ) {
    if (!user || saving) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      await writeCart(
        user.uid,
        updated
      );

      setItems(updated);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to update your bag. Please try again."
      );
    } finally {
      setSaving(false);
    }
  }

  // =====================================
  // OPEN DELIVERY CALENDAR
  // =====================================

  function placeDemoOrder() {
    if (
      user &&
      items.length > 0 &&
      !saving
    ) {
      setShowDeliveryCalendar(true);
    }
  }

  // =====================================
  // SUBMIT ORDER
  // =====================================

  async function submitScheduledOrder(
    preferredDate: string
  ) {
    if (
      !user ||
      saving ||
      !items.length
    ) {
      return;
    }

    const uid = user.uid;

    setSaving(true);
    setError("");

    try {
      if (
        auth.currentUser?.uid !== uid
      ) {
        throw new Error(
          "Sign in again to place an order."
        );
      }

      // Create the order using the
      // current saved cart items.

      await createDemoOrder(
        uid,
        items,
        preferredDate
      );

      // Clear the saved cart after
      // successful order creation.

      await writeCart(
        uid,
        []
      );

      setItems([]);
      setProductImages({});
      setShowDeliveryCalendar(false);

      router.push(
        "/customer/order"
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to create the order."
      );
    } finally {
      setSaving(false);
    }
  }

  // =====================================
  // CART TOTAL
  // =====================================

  const total = items.reduce(
    (sum, item) =>
      sum + item.price * item.quantity,
    0
  );

  // =====================================
  // SCREEN
  // =====================================

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" />

      {/* HEADER */}

      <View style={styles.header}>
        <Pressable
          onPress={() =>
            router.push(
              "/customer/shopsilk"
            )
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
          My Bag
        </Text>

        <View style={{ width: 36 }} />
      </View>

      {/* DELIVERY CALENDAR */}

      <DeliveryDateModal
        visible={showDeliveryCalendar}
        saving={saving}
        onClose={() => {
          if (!saving) {
            setShowDeliveryCalendar(false);
          }
        }}
        onConfirm={submitScheduledOrder}
      />

      {/* CONTENT */}

      <ScrollView
        contentContainerStyle={styles.content}
      >
        <FadeUp delay={100}>
          <Text style={styles.eyebrow}>
            YOUR SELECTION
          </Text>

          <Text style={styles.title}>
            Shopping bag.
          </Text>

          <Text style={styles.intro}>
            Your chosen SilkMart pieces will
            appear here.
          </Text>
        </FadeUp>

        {/* LOADING OR EMPTY STATE */}

        {!authReady || loading ? (
          <ActivityIndicator
            color={GREEN}
            style={{
              marginTop: 45,
            }}
          />
        ) : !user || items.length === 0 ? (
          <FadeUp delay={220}>
            <View style={styles.emptyCard}>
              <View style={styles.iconCircle}>
                <Ionicons
                  name="bag-handle-outline"
                  size={39}
                  color={GREEN}
                />
              </View>

              <Text style={styles.emptyTitle}>
                {user
                  ? "Your bag is empty"
                  : "Sign in to use your bag"}
              </Text>

              <Text style={styles.emptyText}>
                {user
                  ? "Explore the collection and select pieces you'd like to order."
                  : "Create an account or sign in before adding products to your bag."}
              </Text>

              <Pressable
                style={styles.primaryButton}
                onPress={() =>
                  router.push(
                    user
                      ? "/customer/shopsilk"
                      : "/login"
                  )
                }
              >
                <Text style={styles.primaryText}>
                  {user
                    ? "Explore Shop Silk"
                    : "Go to Login"}
                </Text>

                <Ionicons
                  name="arrow-forward"
                  size={18}
                  color="#FFFFFF"
                />
              </Pressable>
            </View>
          </FadeUp>
        ) : (
          <FadeUp delay={180}>
            {/* CART ITEMS */}

            <View style={styles.itemsCard}>
              {items.map(item => {
                const imageUrl =
                  item.imageUrl ||
                  productImages[
                    item.productId
                  ] ||
                  "";

                return (
                  <View
                    key={`${item.productId}:${item.color}`}
                    style={styles.itemRow}
                  >
                    <ProductPhoto
                      imageUrl={imageUrl}
                      name={item.name}
                    />

                    <View
                      style={{
                        flex: 1,
                      }}
                    >
                      <Text style={styles.itemName}>
                        {item.name}
                      </Text>

                      {!!item.color && (
                        <Text style={styles.itemMeta}>
                          Color: {item.color}
                        </Text>
                      )}

                      <Text style={styles.itemPrice}>
                        {money(item.price)} each
                      </Text>

                      {/* ITEM ACTIONS */}

                      <View style={styles.itemActions}>
                        {/* DECREASE */}

                        <Pressable
                          disabled={
                            saving ||
                            item.quantity <= 1
                          }
                          onPress={() =>
                            updateItems(
                              items.map(x =>
                                x === item
                                  ? {
                                      ...x,
                                      quantity:
                                        x.quantity - 1,
                                    }
                                  : x
                              )
                            )
                          }
                          style={styles.stepButton}
                          accessibilityLabel={`Decrease ${item.name} quantity`}
                        >
                          <Ionicons
                            name="remove"
                            size={17}
                            color={DARK}
                          />
                        </Pressable>

                        <Text style={styles.quantity}>
                          {item.quantity}
                        </Text>

                        {/* INCREASE */}

                        <Pressable
                          disabled={
                            saving ||
                            item.quantity >=
                              item.maxQuantity
                          }
                          onPress={() =>
                            updateItems(
                              items.map(x =>
                                x === item
                                  ? {
                                      ...x,
                                      quantity:
                                        x.quantity + 1,
                                    }
                                  : x
                              )
                            )
                          }
                          style={styles.stepButton}
                          accessibilityLabel={`Increase ${item.name} quantity`}
                        >
                          <Ionicons
                            name="add"
                            size={17}
                            color={DARK}
                          />
                        </Pressable>

                        {/* REMOVE PRODUCT */}

                        <Pressable
                          disabled={saving}
                          onPress={() =>
                            updateItems(
                              items.filter(
                                x => x !== item
                              )
                            )
                          }
                          style={{
                            marginLeft: "auto",
                            padding: 8,
                          }}
                          accessibilityLabel={`Remove ${item.name}`}
                        >
                          <Ionicons
                            name="trash-outline"
                            size={19}
                            color="#A43F3F"
                          />
                        </Pressable>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>

            {/* SUBTOTAL */}

            <View style={styles.summary}>
              <Text style={styles.summaryTitle}>
                Subtotal
              </Text>

              <Text style={styles.summaryTotal}>
                {money(total)}
              </Text>
            </View>

            {/* INFORMATION */}

            <View style={styles.tipCard}>
              <Ionicons
                name="information-circle-outline"
                size={21}
                color={GREEN}
              />

              <Text style={styles.tipText}>
                Requests are sent to staff for review.
                Choose a preferred delivery date; it
                is not confirmed until staff approves
                it. Payment is Cash on Delivery (COD).
                Stock is not reserved automatically.
              </Text>
            </View>

            {/* CHECKOUT */}

            <Pressable
              disabled={saving}
              style={[
                styles.primaryButton,
                saving && {
                  opacity: 0.6,
                },
              ]}
              onPress={placeDemoOrder}
              accessibilityRole="button"
            >
              <Text style={styles.primaryText}>
                {saving
                  ? "Saving..."
                  : "Request Delivery & Order"}
              </Text>

              <Ionicons
                name="checkmark-circle-outline"
                size={19}
                color="#FFFFFF"
              />
            </Pressable>

            {/* CONTINUE SHOPPING */}

            <Pressable
              style={styles.primaryButton}
              onPress={() =>
                router.push(
                  "/customer/shopsilk"
                )
              }
            >
              <Text style={styles.primaryText}>
                Continue Shopping
              </Text>
            </Pressable>
          </FadeUp>
        )}

        {/* ERRORS */}

        {!!error && (
          <Text style={styles.error}>
            {error}
          </Text>
        )}
      </ScrollView>
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
    backgroundColor: "#FFFDF8",
    borderBottomWidth: 1,
    borderBottomColor: "#D5DDCF",
  },

  back: {
    height: 36,
    width: 36,
    justifyContent: "center",
  },

  headerTitle: {
    fontFamily: "serif",
    fontSize: 23,
    color: DARK,
  },

  content: {
    paddingHorizontal: 22,
    paddingTop: 32,
    paddingBottom: 48,
  },

  eyebrow: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2,
    color: GREEN,
  },

  title: {
    marginTop: 10,
    fontFamily: "serif",
    fontSize: 36,
    color: DARK,
  },

  intro: {
    fontSize: 13,
    lineHeight: 21,
    color: MUTED,
    marginTop: 8,
  },

  emptyCard: {
    marginTop: 30,
    paddingHorizontal: 25,
    paddingVertical: 40,
    borderWidth: 1,
    borderColor: "#D5DDCF",
    backgroundColor: "#FFFDF8",
    borderRadius: 20,
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
    fontSize: 26,
    color: DARK,
    marginTop: 22,
    textAlign: "center",
  },

  emptyText: {
    fontSize: 12,
    lineHeight: 20,
    color: MUTED,
    textAlign: "center",
    marginTop: 11,
    marginBottom: 27,
  },

  primaryButton: {
    width: "100%",
    height: 49,
    borderRadius: 25,
    backgroundColor: GREEN,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    marginTop: 15,
  },

  primaryText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },

  tipCard: {
    marginTop: 18,
    borderRadius: 13,
    padding: 16,
    backgroundColor: "#EAF2E8",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },

  tipText: {
    flex: 1,
    color: MUTED,
    fontSize: 11,
    lineHeight: 18,
  },

  itemsCard: {
    marginTop: 26,
    backgroundColor: "#FFFDF8",
    borderColor: "#D5DDCF",
    borderWidth: 1,
    borderRadius: 17,
    paddingHorizontal: 16,
  },

  itemRow: {
    flexDirection: "row",
    gap: 13,
    borderBottomWidth: 1,
    borderBottomColor: "#E4EADF",
    paddingVertical: 20,
  },

  itemIcon: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: "#E6F0E4",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },

  itemImage: {
    width: "100%",
    height: "100%",
    borderRadius: 12,
  },

  itemName: {
    fontSize: 14,
    fontWeight: "700",
    color: DARK,
  },

  itemMeta: {
    fontSize: 11,
    color: MUTED,
    marginTop: 5,
  },

  itemPrice: {
    color: GREEN,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 8,
  },

  itemActions: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    gap: 6,
  },

  stepButton: {
    borderWidth: 1,
    borderColor: "#D5DDCF",
    borderRadius: 9,
    width: 34,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },

  quantity: {
    fontSize: 13,
    fontWeight: "700",
    color: DARK,
    minWidth: 25,
    textAlign: "center",
  },

  summary: {
    marginTop: 19,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  summaryTitle: {
    fontSize: 14,
    color: DARK,
    fontWeight: "600",
  },

  summaryTotal: {
    fontSize: 18,
    color: GREEN,
    fontWeight: "700",
  },

  error: {
    color: "#A43F3F",
    marginTop: 17,
    fontSize: 12,
  },
});
