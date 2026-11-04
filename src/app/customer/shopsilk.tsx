import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Easing,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth, db } from "../../firebase/config";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { addToCart, type CartItem } from "../../lib/customerCart";
import { createDemoOrder } from "../../lib/customerOrders";
import { useNotificationCounts } from "../../lib/useNotificationCounts";
import DeliveryDateModal from "../../components/DeliveryDateModal";

const GREEN = "#235F45";
const DARK = "#173B2C";
const MUTED = "#627C6E";
const CREAM = "#FAF9F1";
const BORDER = "#D5DDCF";

type Product = {
  id: string;
  name: string;
  category: string;
  description: string;
  price: number;
  stock: number;
  featured: boolean;
  imageUrl: string;
  inventorySpeciesId: string;
  colors: {
    name: string;
    hex: string;
    quantity: number;
  }[];
};

const COLOR_HEX: Record<string, string> = {
  White: "#FFFFFF", Black: "#242424", Red: "#CC4E4E",
  Pink: "#ED9EB9", Orange: "#E99B56", Yellow: "#EACB59",
  Green: "#679E75", Blue: "#679ACF", Purple: "#9875B5",
  Brown: "#98765D", Beige: "#D6BFA1", Gray: "#A5A8A8",
};

function fromFirestore(id: string, data: Record<string, any>): Product {
  const stock = Number(data.stock ?? 0);
  return {
    id,
    name: String(data.name ?? ""),
    category: String(data.category ?? "Other"),
    description: String(data.description ?? ""),
    price: Number(data.price ?? 0),
    stock: Number.isSafeInteger(stock) && stock >= 0 ? stock : 0,
    featured: data.featured === true,
    imageUrl: String(data.imageUrl ?? ""),
    inventorySpeciesId: String(data.inventorySpeciesId ?? ""),
    colors: Array.isArray(data.colorStocks)
      ? data.colorStocks.filter((color: any) =>
          color && typeof color.name === "string" &&
          Number.isInteger(color.quantity) && color.quantity > 0
        ).map((color: any) => ({
          name: color.name,
          hex: COLOR_HEX[color.name] ?? "#D5DDCF",
          quantity: color.quantity,
        }))
      : [],
  };
}

const money = (value: number) =>
  `₱${value.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const stockUnit = (category: string) => {
  if (category === "Silkworms") return "worms";
  if (category === "Cocoons") return "cocoons";
  return "pcs";
};

function FadeIn({
  children,
  delay = 0,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  style?: any;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(14)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        delay,
        duration: 580,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        delay,
        duration: 580,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [delay, opacity, translateY]);

  return (
    <Animated.View
      style={[style, { opacity, transform: [{ translateY }] }]}
    >
      {children}
    </Animated.View>
  );
}


// A gentle letter-by-letter reveal for existing headings.
function LetterReveal({
  text,
  style,
  delay = 0,
}: {
  text: string;
  style?: any;
  delay?: number;
}) {
  const letters = Array.from(text);
  const values = useRef(letters.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    const animation = Animated.sequence([
      Animated.delay(delay),
      Animated.stagger(
        28,
        values.map((value) =>
          Animated.timing(value, {
            toValue: 1,
            duration: 350,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          })
        )
      ),
    ]);
    animation.start();
    return () => animation.stop();
  }, [delay, values]);

  return (
    <Text style={style} accessibilityLabel={text}>
      {letters.map((letter, index) => (
        <Animated.Text
          key={index}
          style={{
            opacity: values[index],
            transform: [
              {
                translateY: values[index].interpolate({
                  inputRange: [0, 1],
                  outputRange: [7, 0],
                }),
              },
            ],
          }}
        >
          {letter}
        </Animated.Text>
      ))}
    </Text>
  );
}

export default function ShopSilk() {
  const router = useRouter();
  const { totalUnread } = useNotificationCounts("customer");
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [savingItem, setSavingItem] = useState(false);
  const [shopNotice, setShopNotice] = useState("");
  const [showDeliveryCalendar, setShowDeliveryCalendar] = useState(false);
  const [pendingOrderItem, setPendingOrderItem] = useState<CartItem | null>(null);
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");

  useEffect(() => {
    const published = query(
      collection(db, "products"),
      where("published", "==", true)
    );
    return onSnapshot(published, snapshot => {
      const rows = snapshot.docs.map(entry =>
        fromFirestore(entry.id, entry.data())
      );
      setCatalog(rows);
      setCatalogLoading(false);
      setCatalogError("");
    }, error => {
      console.error("Shop Silk products read failed:", error);
      setCatalogLoading(false);
      setCatalogError("Unable to load the shop catalog. Please check your connection or Firestore rules.");
    });
  }, []);


  useEffect(() => {
    return onAuthStateChanged(auth, nextUser => {
      setUser(nextUser);
      setAuthReady(true);
    });
  }, []);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All pieces");
  const [sort, setSort] = useState("featured");
  const [showSort, setShowSort] = useState(false);

  const [selectedProduct, setSelectedProduct] =
    useState<Product | null>(null);
  const [selectedColor, setSelectedColor] = useState("");
  const [quantity, setQuantity] = useState(1);

  const [showLoginRequired, setShowLoginRequired] =
    useState(false);

  const categories = [
    "All pieces",
    ...Array.from(
      new Set(catalog.map((product) => product.category))
    ),
  ];

  const products = useMemo(() => {
    let result = catalog.filter((product) => {
      const matchesCategory =
        category === "All pieces" ||
        product.category === category;

      const query = search.trim().toLowerCase();

      const matchesSearch =
        product.name.toLowerCase().includes(query) ||
        product.category.toLowerCase().includes(query) ||
        product.description.toLowerCase().includes(query);

      return matchesCategory && matchesSearch && product.stock > 0;
    });

    if (sort === "low") {
      result = [...result].sort((a, b) => a.price - b.price);
    } else if (sort === "high") {
      result = [...result].sort((a, b) => b.price - a.price);
    } else {
      result = [...result].sort(
        (a, b) => Number(b.featured) - Number(a.featured)
      );
    }

    return result;
  }, [catalog, search, category, sort]);

  useEffect(() => {
    if (!selectedProduct) return;
    const updated = catalog.find(product => product.id === selectedProduct.id);
    if (!updated || updated.stock <= 0) {
      setSelectedProduct(null);
    } else if (updated !== selectedProduct) {
      setSelectedProduct(updated);
    }
  }, [catalog]);

  function openProduct(product: Product) {
    setSelectedProduct(product);
    setSelectedColor("");
    setQuantity(1);
  }

  function closeProduct() {
    setSelectedProduct(null);
    setSelectedColor("");
    setQuantity(1);
  }

  const needsColor =
    selectedProduct !== null && selectedProduct.colors.length > 0;

  const chosenColor = selectedProduct?.colors.find(
    (color) => color.name === selectedColor
  );

  const maxQuantity = selectedProduct
    ? needsColor
      ? Math.min(selectedProduct.stock, chosenColor?.quantity ?? 0)
      : selectedProduct.stock
    : 0;

  const selectionValid =
    selectedProduct !== null &&
    (!needsColor || Boolean(chosenColor)) &&
    quantity >= 1 &&
    quantity <= maxQuantity;

  function chooseColor(colorName: string) {
    setSelectedColor(colorName);
    setQuantity(1);
  }

  async function handleProductAction(action: "bag" | "order") {
    if (savingItem) return;
    if (!selectionValid || !selectedProduct) {
      setShopNotice(
        needsColor && !selectedColor
          ? "Please select an available color first."
          : "Please select a valid quantity."
      );
      return;
    }

    if (!authReady) return;
    if (!user) {
      setShowLoginRequired(true);
      return;
    }

    const uid = user.uid;
    const item: CartItem = {
      productId: selectedProduct.id,
      name: selectedProduct.name,
      price: selectedProduct.price,
      color: selectedColor,
      quantity,
      maxQuantity,
      // Preserve the exact product picture for My Bag.
      imageUrl: selectedProduct.imageUrl || "",
    };

    setSavingItem(true);
    try {
      if (auth.currentUser?.uid !== uid) {
        throw new Error("Your session changed. Please sign in again.");
      }

      if (action === "bag") {
        await addToCart(uid, item);
        closeProduct();
        router.push("/customer/cart");
      } else {
        // Order Now creates an order for this selected item only.
        // Existing shopping bag items remain in the bag.
        setPendingOrderItem(item);
        closeProduct();
        setShowDeliveryCalendar(true);
      }
    } catch (error) {
      setShopNotice(
        error instanceof Error
          ? error.message
          : "Unable to save your selection. Please try again."
      );
    } finally {
      setSavingItem(false);
    }
  }

  async function confirmDirectDelivery(date: string) {
    if (!user || !pendingOrderItem || savingItem) return;
    setSavingItem(true);
    try {
      await createDemoOrder(user.uid, [pendingOrderItem], date);
      setShowDeliveryCalendar(false);
      setPendingOrderItem(null);
      router.push("/customer/order");
    } catch (reason) {
      setShopNotice(reason instanceof Error ? reason.message : "Unable to request delivery.");
    } finally {
      setSavingItem(false);
    }
  }

  function goToLogin() {
    setShowLoginRequired(false);
    closeProduct();

    router.push("/login");
  }

  function productArtwork(product: Product, large = false) {
    let icon: React.ComponentProps<typeof Ionicons>["name"] =
      "bag-handle-outline";

    if (product.category === "Scarves") {
      icon = "color-palette-outline";
    } else if (product.category === "Home") {
      icon = "home-outline";
    } else if (product.category === "Silkworms") {
      icon = "leaf-outline";
    } else if (product.category === "Cocoons") {
      icon = "ellipse-outline";
    }

    return (
      <View
        style={[
          styles.productArtwork,
          large && styles.largeArtwork,
        ]}
      >
        {product.imageUrl ? (
          <Image
            source={{ uri: product.imageUrl }}
            resizeMode="cover"
            style={{ width: "100%", height: "100%", borderRadius: 15 }}
          />
        ) : (
        <View
          style={[
            styles.artCircle,
            large && styles.largeArtCircle,
          ]}
        >
          <Ionicons
            name={icon}
            size={large ? 67 : 42}
            color="#699A80"
          />
        </View>
        )}

        {product.featured && !large && (
          <View style={styles.featuredLabel}>
            <Text style={styles.featuredText}>FEATURED</Text>
          </View>
        )}
      </View>
    );
  }

  function renderProduct({ item, index }: { item: Product; index: number }) {
    return (
      <FadeIn delay={260 + (index % 8) * 75} style={{ flex: 1, maxWidth: "49%" }}>
      <Pressable
        style={[styles.productCard, { maxWidth: "100%" }]}
        onPress={() => openProduct(item)}
        accessibilityRole="button"
      >
        {productArtwork(item)}

        <View style={styles.productInfo}>
          <Text style={styles.productCategory}>
            {item.category.toUpperCase()}
          </Text>

          <Text style={styles.productName} numberOfLines={2}>
            {item.name}
          </Text>

          <Text style={styles.productPrice}>
            {money(item.price)}
          </Text>

          <View style={styles.productBottom}>
            <Text style={styles.productStock} numberOfLines={2}>
              {item.stock} {stockUnit(item.category)} available
            </Text>

            <View style={styles.addCircle}>
              <Ionicons name="add" size={19} color="#FFFFFF" />
            </View>
          </View>
        </View>
      </Pressable>
      </FadeIn>
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" />

      <FadeIn delay={40}>
      <View style={styles.header}>
        <View style={styles.headerBrand}>
          <View style={styles.brandIcon}>
            <Ionicons name="leaf-outline" size={22} color={GREEN} />
          </View>

          <View>
            <LetterReveal text="SilkMart" style={styles.brandName} delay={190} />
            <Text style={styles.brandSubtitle}>
              VILLANUEVA (DOST-PTRI)
            </Text>
          </View>
        </View>

        <View style={styles.headerActions}>
          <Pressable
            onPress={() => router.push("/customer/notif-cust")}
            accessibilityRole="button"
            accessibilityLabel={
              totalUnread > 0
                ? `Notifications, ${totalUnread} unread`
                : "Notifications, no unread updates"
            }
            style={styles.notificationBell}
          >
            <Ionicons name="notifications-outline" size={24} color={DARK} />
            {totalUnread > 0 && (
              <View style={styles.notificationBadge}>
                <Text style={styles.notificationBadgeText}>
                  {totalUnread > 99 ? "99+" : totalUnread}
                </Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>
      </FadeIn>

      <FlatList
        data={products}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.productColumns}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <FadeIn delay={150}>
            <LetterReveal text="THE COLLECTION" style={styles.eyebrow} delay={260} />

            <LetterReveal
              text={"Useful beauty,\nwoven slowly."}
              style={styles.heading}
              delay={300}
            />

            <Text style={styles.description}>
              Pieces for quiet mornings, thoughtful gifting, and
              the everyday rituals in between.
            </Text>

            <View style={styles.searchBox}>
              <Ionicons
                name="search-outline"
                size={19}
                color={MUTED}
              />

              <TextInput
                style={styles.searchInput}
                placeholder="Search the collection"
                placeholderTextColor="#8B9A91"
                value={search}
                onChangeText={setSearch}
              />

              {search.length > 0 && (
                <Pressable onPress={() => setSearch("")}>
                  <Ionicons
                    name="close-circle"
                    size={20}
                    color={MUTED}
                  />
                </Pressable>
              )}
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.categoryScroll}
              contentContainerStyle={styles.categoryRow}
            >
              {categories.map((item) => (
                <Pressable
                  key={item}
                  style={[
                    styles.categoryChip,
                    category === item && styles.activeChip,
                  ]}
                  onPress={() => setCategory(item)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      category === item && styles.activeChipText,
                    ]}
                  >
                    {item}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <View style={styles.sortRow}>
              <Pressable
                style={styles.sortButton}
                onPress={() => setShowSort(!showSort)}
              >
                <Text style={styles.sortButtonText}>
                  {sort === "low"
                    ? "Price: Low to high"
                    : sort === "high"
                      ? "Price: High to low"
                      : "Featured first"}
                </Text>

                <Ionicons
                  name="chevron-down-outline"
                  size={16}
                  color={DARK}
                />
              </Pressable>

              <Text style={styles.resultsCount}>
                {products.length} products
              </Text>
            </View>

            {showSort && (
              <View style={styles.sortOptions}>
                {[
                  { value: "featured", label: "Featured first" },
                  { value: "low", label: "Price: Low to high" },
                  { value: "high", label: "Price: High to low" },
                ].map((option) => (
                  <Pressable
                    key={option.value}
                    onPress={() => {
                      setSort(option.value);
                      setShowSort(false);
                    }}
                    style={styles.sortOption}
                  >
                    <Text style={styles.sortOptionText}>
                      {option.label}
                    </Text>

                    {sort === option.value && (
                      <Ionicons
                        name="checkmark"
                        size={18}
                        color={GREEN}
                      />
                    )}
                  </Pressable>
                ))}
              </View>
            )}
          </FadeIn>
        }
        renderItem={renderProduct}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons
              name="search-outline"
              size={35}
              color={MUTED}
            />
            <Text style={styles.emptyTitle}>
              {catalogLoading ? "Loading products..." : catalogError ? "Shop unavailable" : "No products found"}
            </Text>
            <Text style={styles.emptyText}>
              {catalogError || (catalogLoading
                ? "Retrieving published products from Firestore."
                : "Try another search or category.")}
            </Text>
          </View>
        }
        ListFooterComponent={
          <FadeIn delay={360}>
          <View style={styles.careCard}>
            <Text style={styles.careEyebrow}>
              CARE IS PART OF THE CRAFT
            </Text>

            <LetterReveal
              text="Keep the softness going."
              style={styles.careHeading}
              delay={430}
            />

            <Text style={styles.careDescription}>
              Silk likes a gentle life: cool water, a little shade,
              and time to breathe. Every piece comes with simple
              care notes from our makers.
            </Text>

            <Text style={styles.footerName}>SilkMart</Text>
            <Text style={styles.footerDescription}>
              Naturally raised, locally woven.
              {"\n"}Villanueva, Misamis Oriental.
            </Text>
          </View>
          </FadeIn>
        }
      />

      <Modal
        visible={selectedProduct !== null}
        transparent
        animationType="slide"
        onRequestClose={closeProduct}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.productModal}>
            <View style={styles.modalTop}>
              <Text style={styles.modalTopTitle}>
                Product Details
              </Text>

              <Pressable onPress={closeProduct}>
                <Ionicons
                  name="close"
                  size={23}
                  color={DARK}
                />
              </Pressable>
            </View>

            {selectedProduct && (
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.modalContent}
              >
                {productArtwork(selectedProduct, true)}

                <Text style={styles.modalCategory}>
                  {selectedProduct.category.toUpperCase()}
                </Text>

                <Text style={styles.modalProductName}>
                  {selectedProduct.name}
                </Text>

                <Text style={styles.modalPrice}>
                  {money(selectedProduct.price)}
                </Text>

                <Text style={styles.modalDescription}>
                  {selectedProduct.description}
                </Text>

                <Text style={styles.modalStock}>
                  {selectedProduct.stock}{" "}
                  {stockUnit(selectedProduct.category)} available
                </Text>

                {needsColor && (
                  <View style={styles.colorSection}>
                    <Text style={styles.sectionLabel}>
                      Available Colors
                    </Text>

                    <Text style={styles.sectionHint}>
                      Select one color. Stock varies by color.
                    </Text>

                    <View style={styles.colorList}>
                      {selectedProduct.colors
                        .filter((color) => color.quantity > 0)
                        .map((color) => (
                          <Pressable
                            key={color.name}
                            onPress={() =>
                              chooseColor(color.name)
                            }
                            style={[
                              styles.colorOption,
                              selectedColor === color.name &&
                                styles.selectedColorOption,
                            ]}
                          >
                            <View
                              style={[
                                styles.colorSwatch,
                                {
                                  backgroundColor: color.hex,
                                },
                              ]}
                            />

                            <View style={styles.colorInfo}>
                              <Text style={styles.colorName}>
                                {color.name}
                              </Text>
                              <Text style={styles.colorStock}>
                                {color.quantity} pcs
                              </Text>
                            </View>

                            {selectedColor === color.name && (
                              <Ionicons
                                name="checkmark-circle"
                                size={20}
                                color={GREEN}
                              />
                            )}
                          </Pressable>
                        ))}
                    </View>

                    {!selectedColor && (
                      <Text style={styles.colorReminder}>
                        Please select a color to continue.
                      </Text>
                    )}
                  </View>
                )}

                <View style={styles.quantityRow}>
                  <View>
                    <Text style={styles.sectionLabel}>
                      Quantity
                    </Text>
                    <Text style={styles.sectionHint}>
                      {maxQuantity} available
                    </Text>
                  </View>

                  <View style={styles.quantityControl}>
                    <Pressable
                      onPress={() =>
                        setQuantity((value) =>
                          Math.max(1, value - 1)
                        )
                      }
                      disabled={quantity <= 1}
                      style={styles.quantityButton}
                    >
                      <Ionicons
                        name="remove"
                        size={20}
                        color={DARK}
                      />
                    </Pressable>

                    <Text style={styles.quantityValue}>
                      {quantity}
                    </Text>

                    <Pressable
                      onPress={() =>
                        setQuantity((value) =>
                          Math.min(
                            maxQuantity,
                            value + 1
                          )
                        )
                      }
                      disabled={
                        maxQuantity < 1 ||
                        quantity >= maxQuantity
                      }
                      style={styles.quantityButton}
                    >
                      <Ionicons
                        name="add"
                        size={20}
                        color={DARK}
                      />
                    </Pressable>
                  </View>
                </View>

                <View style={styles.modalActions}>
                  <Pressable
                    style={[
                      styles.addBagButton,
                      !selectionValid && styles.disabledButton,
                    ]}
                    onPress={() => handleProductAction("bag")}
                    disabled={savingItem || !authReady}
                  >
                    <Ionicons
                      name="bag-add-outline"
                      size={19}
                      color="#FFFFFF"
                    />
                    <Text style={styles.addBagText}>
                      Add to Bag
                    </Text>
                  </Pressable>

                  <Pressable
                    style={[
                      styles.orderButton,
                      !selectionValid && styles.disabledButton,
                    ]}
                    onPress={() => handleProductAction("order")}
                    disabled={savingItem || !authReady}
                  >
                    <Ionicons
                      name="flash-outline"
                      size={18}
                      color={GREEN}
                    />
                    <Text style={styles.orderButtonText}>
                      Order Now
                    </Text>
                  </Pressable>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      <DeliveryDateModal
        visible={showDeliveryCalendar}
        saving={savingItem}
        onClose={() => { if (!savingItem) { setShowDeliveryCalendar(false); setPendingOrderItem(null); } }}
        onConfirm={confirmDirectDelivery}
      />

      <Modal visible={shopNotice.length > 0} transparent animationType="fade" onRequestClose={() => setShopNotice("")}>
        <View style={styles.loginBackdrop}>
          <View style={styles.loginCard}>
            <View style={styles.loginIconCircle}><Ionicons name="information-circle-outline" size={35} color={GREEN} /></View>
            <Text style={styles.loginTitle}>SilkMart</Text>
            <Text style={styles.loginDescription}>{shopNotice}</Text>
            <Pressable style={styles.loginPrimary} onPress={() => setShopNotice("")}>
              <Text style={styles.loginPrimaryText}>OK</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showLoginRequired}
        transparent
        animationType="fade"
        onRequestClose={() =>
          setShowLoginRequired(false)
        }
      >
        <View style={styles.loginBackdrop}>
          <View style={styles.loginCard}>
            <Pressable
              style={styles.loginClose}
              onPress={() =>
                setShowLoginRequired(false)
              }
            >
              <Ionicons
                name="close"
                size={22}
                color={DARK}
              />
            </Pressable>

            <View style={styles.loginIconCircle}>
              <Ionicons
                name="lock-closed-outline"
                size={35}
                color={GREEN}
              />
            </View>

            <Text style={styles.loginTitle}>
              Sign in to continue
            </Text>

            <Text style={styles.loginDescription}>
              You need to be signed in to place an order
              or access your customer account.
            </Text>

            <Pressable
              style={styles.loginPrimary}
              onPress={goToLogin}
            >
              <Text style={styles.loginPrimaryText}>
                Go to login
              </Text>
            </Pressable>

            <Pressable
              onPress={() =>
                setShowLoginRequired(false)
              }
              style={styles.cancelButton}
            >
              <Text style={styles.cancelText}>
                Continue browsing
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: CREAM,
  },
  header: {
    height: 70,
    backgroundColor: "#FFFDF8",
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerBrand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  brandIcon: {
    width: 36,
    height: 36,
    borderWidth: 1,
    borderColor: "#A7BFAF",
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  brandName: {
    fontFamily: "serif",
    color: DARK,
    fontSize: 23,
    lineHeight: 26,
  },
  brandSubtitle: {
    color: MUTED,
    fontSize: 7,
    fontWeight: "700",
    letterSpacing: 1,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 21,
  },
  notificationBell: {
    width: 39,
    height: 39,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  notificationBadge: {
    position: "absolute",
    top: 0,
    right: -6,
    minWidth: 19,
    height: 19,
    borderRadius: 10,
    paddingHorizontal: 4,
    backgroundColor: "#B34D4D",
    borderWidth: 1,
    borderColor: "#FFFDF8",
    alignItems: "center",
    justifyContent: "center",
  },
  notificationBadgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "700",
  },
  listContent: {
    paddingHorizontal: 18,
    paddingTop: 28,
    paddingBottom: 18,
  },
  eyebrow: {
    color: GREEN,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2,
    marginBottom: 9,
  },
  heading: {
    fontFamily: "serif",
    fontSize: 37,
    lineHeight: 40,
    color: DARK,
  },
  description: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 19,
    marginTop: 10,
    marginBottom: 23,
  },
  searchBox: {
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "#FFFDF8",
    paddingHorizontal: 15,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: DARK,
  },
  categoryScroll: {
    marginTop: 16,
    marginBottom: 16,
    flexGrow: 0,
  },
  categoryRow: {
    gap: 7,
    paddingRight: 12,
  },
  categoryChip: {
    paddingHorizontal: 15,
    minHeight: 33,
    borderRadius: 20,
    backgroundColor: "#E8EFDF",
    justifyContent: "center",
  },
  activeChip: {
    backgroundColor: GREEN,
  },
  chipText: {
    color: DARK,
    fontSize: 11,
    fontWeight: "600",
  },
  activeChipText: {
    color: "#FFFFFF",
  },
  sortRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 17,
  },
  sortButton: {
    minHeight: 37,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 12,
    backgroundColor: "#FFFDF8",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sortButtonText: {
    fontSize: 11,
    color: DARK,
    fontWeight: "600",
  },
  resultsCount: {
    fontSize: 11,
    color: MUTED,
  },
  sortOptions: {
    backgroundColor: "#FFFDF8",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    marginBottom: 15,
    padding: 5,
  },
  sortOption: {
    paddingVertical: 10,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sortOptionText: {
    color: DARK,
    fontSize: 12,
  },
  productColumns: {
    gap: 12,
    marginBottom: 12,
  },
  productCard: {
    flex: 1,
    minWidth: 0,
    maxWidth: "49%",
    backgroundColor: "#FFFDF8",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    overflow: "hidden",
  },
  productArtwork: {
    height: 151,
    backgroundColor: "#E7F0E6",
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
  },
  artCircle: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: "#D8E8D8",
    alignItems: "center",
    justifyContent: "center",
  },
  featuredLabel: {
    position: "absolute",
    left: 8,
    top: 9,
    backgroundColor: "#FFFDF8",
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 5,
  },
  featuredText: {
    fontSize: 8,
    fontWeight: "700",
    color: GREEN,
    letterSpacing: 0.7,
  },
  productInfo: {
    padding: 10,
    minHeight: 129,
  },
  productCategory: {
    fontSize: 8,
    fontWeight: "700",
    color: GREEN,
    letterSpacing: 1,
    marginBottom: 7,
  },
  productName: {
    fontSize: 12,
    fontWeight: "700",
    color: DARK,
    minHeight: 32,
  },
  productPrice: {
    fontSize: 13,
    color: GREEN,
    fontWeight: "700",
    marginTop: 3,
  },
  productBottom: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginTop: 10,
    gap: 4,
  },
  productStock: {
    fontSize: 9,
    color: MUTED,
    flex: 1,
  },
  addCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: GREEN,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 45,
  },
  emptyTitle: {
    marginTop: 12,
    fontSize: 16,
    color: DARK,
    fontWeight: "700",
  },
  emptyText: {
    marginTop: 6,
    fontSize: 12,
    color: MUTED,
  },
  careCard: {
    marginTop: 27,
    marginBottom: 15,
    borderRadius: 17,
    padding: 23,
    backgroundColor: "#E2EDD7",
  },
  careEyebrow: {
    fontSize: 9,
    color: GREEN,
    fontWeight: "700",
    letterSpacing: 1.4,
  },
  careHeading: {
    fontFamily: "serif",
    fontSize: 30,
    lineHeight: 34,
    color: DARK,
    marginTop: 12,
  },
  careDescription: {
    fontSize: 12,
    lineHeight: 20,
    color: MUTED,
    marginTop: 12,
  },
  footerName: {
    fontFamily: "serif",
    fontSize: 21,
    color: GREEN,
    marginTop: 25,
  },
  footerDescription: {
    fontSize: 11,
    color: MUTED,
    lineHeight: 18,
  },
  bottomNav: {
    height: 63,
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: BORDER,
    backgroundColor: "#FFFDF8",
    justifyContent: "space-around",
    alignItems: "center",
  },
  navItem: {
    flex: 1,
    alignItems: "center",
    gap: 4,
  },
  activeNavText: {
    color: GREEN,
    fontSize: 10,
    fontWeight: "700",
  },
  navText: {
    color: MUTED,
    fontSize: 10,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.42)",
    justifyContent: "flex-end",
  },
  productModal: {
    height: "89%",
    backgroundColor: CREAM,
    borderTopLeftRadius: 23,
    borderTopRightRadius: 23,
    overflow: "hidden",
  },
  modalTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 17,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  modalTopTitle: {
    color: DARK,
    fontSize: 15,
    fontWeight: "700",
  },
  modalContent: {
    padding: 20,
    paddingBottom: 40,
  },
  largeArtwork: {
    height: 205,
    borderRadius: 17,
    marginBottom: 19,
  },
  largeArtCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
  },
  modalCategory: {
    color: GREEN,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
  },
  modalProductName: {
    color: DARK,
    fontFamily: "serif",
    fontSize: 29,
    marginTop: 7,
  },
  modalPrice: {
    fontSize: 19,
    fontWeight: "700",
    color: GREEN,
    marginTop: 5,
  },
  modalDescription: {
    fontSize: 13,
    lineHeight: 21,
    color: MUTED,
    marginTop: 14,
  },
  modalStock: {
    color: GREEN,
    fontWeight: "600",
    fontSize: 11,
    marginTop: 12,
  },
  colorSection: {
    marginTop: 23,
  },
  sectionLabel: {
    color: DARK,
    fontSize: 13,
    fontWeight: "700",
  },
  sectionHint: {
    fontSize: 11,
    color: MUTED,
    marginTop: 5,
  },
  colorList: {
    marginTop: 12,
    gap: 8,
  },
  colorOption: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 11,
    backgroundColor: "#FFFDF8",
    paddingHorizontal: 12,
    gap: 10,
  },
  selectedColorOption: {
    borderColor: GREEN,
    backgroundColor: "#E8F0E7",
  },
  colorSwatch: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "#C9D8CC",
  },
  colorInfo: {
    flex: 1,
  },
  colorName: {
    fontSize: 12,
    fontWeight: "600",
    color: DARK,
  },
  colorStock: {
    fontSize: 10,
    color: MUTED,
    marginTop: 3,
  },
  colorReminder: {
    fontSize: 11,
    color: MUTED,
    marginTop: 10,
  },
  quantityRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 25,
    marginBottom: 25,
  },
  quantityControl: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    backgroundColor: "#FFFDF8",
  },
  quantityButton: {
    padding: 11,
  },
  quantityValue: {
    minWidth: 30,
    textAlign: "center",
    color: DARK,
    fontWeight: "700",
  },
  modalActions: {
    gap: 10,
  },
  addBagButton: {
    backgroundColor: GREEN,
    minHeight: 49,
    borderRadius: 26,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  addBagText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 13,
  },
  orderButton: {
    minHeight: 49,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: GREEN,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  orderButtonText: {
    color: GREEN,
    fontWeight: "700",
    fontSize: 13,
  },
  disabledButton: {
    opacity: 0.5,
  },
  loginBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    paddingHorizontal: 25,
  },
  loginCard: {
    backgroundColor: CREAM,
    borderRadius: 22,
    padding: 24,
    alignItems: "center",
  },
  loginClose: {
    position: "absolute",
    right: 17,
    top: 15,
    padding: 4,
  },
  loginIconCircle: {
    height: 83,
    width: 83,
    borderRadius: 42,
    backgroundColor: "#E7F0E2",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  loginTitle: {
    fontFamily: "serif",
    color: DARK,
    fontSize: 26,
    marginTop: 18,
  },
  loginDescription: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 20,
    textAlign: "center",
    marginTop: 11,
    marginBottom: 23,
  },
  loginPrimary: {
    minHeight: 48,
    backgroundColor: GREEN,
    alignSelf: "stretch",
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
  },
  loginPrimaryText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  cancelButton: {
    paddingTop: 20,
    paddingBottom: 4,
  },
  cancelText: {
    color: GREEN,
    fontSize: 12,
    fontWeight: "700",
  },
});
