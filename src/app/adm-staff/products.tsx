
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Timestamp,
} from "firebase/firestore";
import { auth, db } from "../../firebase/config";
import {
  Action,
  C,
  Fade,
  Heading,
  S,
  Search,
  Stat,
} from "../../components/AdminUI";

// -------------------------------------
// TYPES
// -------------------------------------

type ProductColorStock = {
  name: string;
  quantity: number;
};

type ShopProduct = {
  id: string;
  name: string;
  category: string;
  description: string;
  price: number;
  stock: number;
  imageUrl: string;
  published: boolean;
  featured: boolean;
  colorStocks: ProductColorStock[];
  inventorySpeciesId: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
};

type ProductForm = {
  name: string;
  category: string;
  description: string;
  price: string;
  stock: string;
  imageUrl: string;
  inventorySpeciesId: string;
  published: boolean;
  featured: boolean;
  colorStocks: {
    name: string;
    quantity: string;
  }[];
};

type StatusFilter =
  | "All"
  | "Published"
  | "Draft"
  | "Out of Stock";

type StockFilter =
  | "All Stock"
  | "In Stock"
  | "Low Stock"
  | "Out of Stock";

type SortOption =
  | "Newest First"
  | "Oldest First"
  | "Product Name"
  | "Price: Low to High"
  | "Price: High to Low"
  | "Lowest Stock";

// -------------------------------------
// OPTIONS
// -------------------------------------

const categories = [
  "Silkworms",
  "Cocoons",
  "Scarves",
  "Sleepwear",
  "Shawls",
  "Home & Living",
  "Accessories",
  "Fabrics",
  "Ribbons & Trim",
  "Silk Thread",
  "Other",
];

const colors = [
  { name: "White", hex: "#FFFFFF" },
  { name: "Black", hex: "#242424" },
  { name: "Red", hex: "#CC4E4E" },
  { name: "Pink", hex: "#ED9EB9" },
  { name: "Orange", hex: "#E99B56" },
  { name: "Yellow", hex: "#EACB59" },
  { name: "Green", hex: "#679E75" },
  { name: "Blue", hex: "#679ACF" },
  { name: "Purple", hex: "#9875B5" },
  { name: "Brown", hex: "#98765D" },
  { name: "Beige", hex: "#D6BFA1" },
  { name: "Gray", hex: "#A5A8A8" },
];

const statuses: StatusFilter[] = [
  "All",
  "Published",
  "Draft",
  "Out of Stock",
];

const stockOptions: StockFilter[] = [
  "All Stock",
  "In Stock",
  "Low Stock",
  "Out of Stock",
];

const sortOptions: SortOption[] = [
  "Newest First",
  "Oldest First",
  "Product Name",
  "Price: Low to High",
  "Price: High to Low",
  "Lowest Stock",
];

// -------------------------------------
// HELPERS
// -------------------------------------

function emptyForm(): ProductForm {
  return {
    name: "",
    category: "Scarves",
    description: "",
    price: "",
    stock: "",
    imageUrl: "",
    inventorySpeciesId: "",
    published: false,
    featured: false,
    colorStocks: [],
  };
}

function supportsColors(category: string) {
  return category !== "Silkworms" && category !== "Cocoons";
}

function stockUnit(category: string) {
  if (category === "Silkworms") return "worms";
  if (category === "Cocoons") return "cocoons";
  return "pcs";
}

function lowStockThreshold(category: string) {
  return category === "Silkworms" ? 10 : 100;
}

function money(value: number) {
  return `₱${value.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function dateMillis(value: unknown): number {
  if (
    value &&
    typeof value === "object" &&
    "toMillis" in value &&
    typeof value.toMillis === "function"
  ) {
    return value.toMillis();
  }
  return 0;
}

function dateText(value: unknown) {
  const milliseconds = dateMillis(value);
  if (!milliseconds) return "Not available";

  return new Date(milliseconds).toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function validImage(value: string) {
  if (!value) return true;

  if (value.startsWith("data:image/jpeg;base64,")) {
    return (
      value.length <= 180000 &&
      /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value)
    );
  }

  return (
    value.length <= 2048 &&
    /^https?:\/\/\S+$/i.test(value)
  );
}

function productStatus(product: ShopProduct) {
  if (product.stock <= 0) return "Out of Stock";
  return product.published ? "Published" : "Draft";
}

function normalizeProduct(
  id: string,
  data: Record<string, any>
): ShopProduct {
  return {
    id,
    name: String(data.name ?? ""),
    category: String(data.category ?? "Other"),
    description: String(data.description ?? ""),
    price: Number(data.price ?? 0),
    stock: Number(data.stock ?? 0),
    imageUrl: String(data.imageUrl ?? ""),
    inventorySpeciesId: String(data.inventorySpeciesId ?? ""),
    published: data.published === true,
    featured: data.featured === true,
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
    colorStocks: Array.isArray(data.colorStocks)
      ? data.colorStocks
          .filter(
            (item: any) =>
              typeof item?.name === "string" &&
              Number.isInteger(Number(item.quantity)) &&
              Number(item.quantity) >= 0
          )
          .map((item: any) => ({
            name: item.name,
            quantity: Number(item.quantity),
          }))
      : [],
  };
}

// -------------------------------------
// SILKWORM STOCK SOURCE
// -------------------------------------

type InventorySpecies = {
  id: string;
  name: string;
  scientificName: string;
  quantity: number;
  imageUrl: string;
  stage: string;
};

// -------------------------------------
// PRODUCT MANAGEMENT
// -------------------------------------

export default function Products() {
  const [user, setUser] = useState<User | null>(
    auth.currentUser
  );

  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [inventorySpecies, setInventorySpecies] = useState<InventorySpecies[]>([]);
  const [inventoryError, setInventoryError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All Categories");

  const [statusFilter, setStatusFilter] =
    useState<StatusFilter>("All");

  const [stockFilter, setStockFilter] =
    useState<StockFilter>("All Stock");

  const [sortBy, setSortBy] =
    useState<SortOption>("Newest First");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(
    null
  );

  const [form, setForm] = useState<ProductForm>(
    emptyForm()
  );

  const [formError, setFormError] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(
    null
  );

  const [showDetails, setShowDetails] = useState(false);

  const [deleteTarget, setDeleteTarget] =
    useState<ShopProduct | null>(null);

  const [filterPanel, setFilterPanel] = useState(false);

  // Image selection state
  const [selectingImage, setSelectingImage] = useState(false);

  // -------------------------------------
  // AUTHENTICATION
  // -------------------------------------

  useEffect(() => {
    return onAuthStateChanged(auth, setUser);
  }, []);

  // -------------------------------------
  // FIRESTORE REAL-TIME PRODUCTS
  // -------------------------------------

  useEffect(() => {
    setLoading(true);
    setError("");

    if (!user) {
      setProducts([]);
      setLoading(false);
      return;
    }

    const unsubscribe = onSnapshot(
      collection(db, "products"),
      snapshot => {
        const records = snapshot.docs.map(item =>
          normalizeProduct(item.id, item.data())
        );

        setProducts(records);
        setLoading(false);
        setError("");
      },
      firebaseError => {
        console.error(
          "Products Firestore error:",
          firebaseError
        );

        setLoading(false);
        setError(
          firebaseError.code === "permission-denied"
            ? "Firestore denied access to products. Check your Admin/Staff role and product security rules."
            : "Unable to load products from Firebase."
        );
      }
    );

    return unsubscribe;
  }, [user]);

  // Read the SAME species collection used by Inventory Management.
  // Inventory remains the authoritative source for silkworm quantities.
  useEffect(() => {
    if (!user) {
      setInventorySpecies([]);
      return;
    }

    return onSnapshot(
      collection(db, "inventory_species"),
      snapshot => {
        setInventorySpecies(snapshot.docs.map(item => {
          const data = item.data();
          return {
            id: item.id,
            name: String(data.name ?? ""),
            scientificName: String(data.scientificName ?? ""),
            quantity: Number(data.quantity ?? 0),
            imageUrl: String(data.imageUrl ?? ""),
            stage: String(data.stage ?? ""),
          };
        }).sort((a, b) => a.name.localeCompare(b.name)));
        setInventoryError("");
      },
      reason => {
        console.error("Silkworm inventory read failed:", reason);
        setInventoryError("Cannot read silkworm inventory. Check inventory permissions.");
      }
    );
  }, [user?.uid]);

  // Reflect inventory changes immediately on linked product cards.
  // This changes the displayed stock; the Firestore `products.stock`
  // snapshot is updated only when the listing itself is saved.
  const visibleProducts = useMemo(() => {
    const stockById = new Map(
      inventorySpecies.map(item => [item.id, item] as const)
    );
    return products.map(product => {
      if (!product.inventorySpeciesId) return product;
      const source = stockById.get(product.inventorySpeciesId);
      return source
        ? { ...product, stock: source.quantity }
        : { ...product, stock: 0 };
    });
  }, [products, inventorySpecies]);

  // -------------------------------------
  // PRODUCT STATISTICS
  // -------------------------------------

  const publishedCount = visibleProducts.filter(
    product => product.published && product.stock > 0
  ).length;

  const draftCount = visibleProducts.filter(
    product => !product.published
  ).length;

  const outOfStockCount = visibleProducts.filter(
    product => product.stock <= 0
  ).length;

  // -------------------------------------
  // FILTER AND SORT
  // -------------------------------------

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();

    return visibleProducts
      .filter(product => {
        const searchable = [
          product.name,
          product.category,
          product.description,
          product.id,
        ]
          .join(" ")
          .toLowerCase();

        const matchesSearch = searchable.includes(term);

        const matchesCategory =
          category === "All Categories" ||
          product.category === category;

        let matchesStatus = true;

        if (statusFilter === "Published") {
          matchesStatus = product.published;
        } else if (statusFilter === "Draft") {
          matchesStatus = !product.published;
        } else if (statusFilter === "Out of Stock") {
          matchesStatus = product.stock <= 0;
        }

        let matchesStock = true;

        if (stockFilter === "In Stock") {
          matchesStock = product.stock > 0;
        } else if (stockFilter === "Low Stock") {
          matchesStock =
            product.stock > 0 &&
            product.stock <= lowStockThreshold(
              product.category
            );
        } else if (stockFilter === "Out of Stock") {
          matchesStock = product.stock <= 0;
        }

        return (
          matchesSearch &&
          matchesCategory &&
          matchesStatus &&
          matchesStock
        );
      })
      .sort((a, b) => {
        switch (sortBy) {
          case "Oldest First":
            return dateMillis(a.createdAt) -
              dateMillis(b.createdAt);

          case "Product Name":
            return a.name.localeCompare(b.name);

          case "Price: Low to High":
            return a.price - b.price;

          case "Price: High to Low":
            return b.price - a.price;

          case "Lowest Stock":
            return a.stock - b.stock;

          default:
            return dateMillis(b.createdAt) -
              dateMillis(a.createdAt);
        }
      });
  }, [
    visibleProducts,
    search,
    category,
    statusFilter,
    stockFilter,
    sortBy,
  ]);

  const selectedProduct = visibleProducts.find(
    product => product.id === selectedId
  ) ?? null;

  // -------------------------------------
  // ADD / EDIT FORM
  // -------------------------------------

  function openAdd() {
    setEditingId(null);
    setForm(emptyForm());
    setFormError("");
    setShowForm(true);
  }

  function openEdit(product: ShopProduct) {
    setEditingId(product.id);

    setForm({
      name: product.name,
      category: product.category,
      description: product.description,
      price: String(product.price),
      stock: String(product.stock),
      imageUrl: product.imageUrl,
      inventorySpeciesId: product.inventorySpeciesId,
      published: product.published,
      featured: product.featured,
      colorStocks: product.colorStocks.map(item => ({
        name: item.name,
        quantity: String(item.quantity),
      })),
    });

    setFormError("");
    setShowDetails(false);
    setShowForm(true);
  }

  function updateForm<K extends keyof ProductForm>(
    key: K,
    value: ProductForm[K]
  ) {
    setForm(previous => ({
      ...previous,
      [key]: value,
    }));
  }

  function changeCategory(value: string) {
    setForm(previous => ({
      ...previous,
      category: value,
      colorStocks: supportsColors(value)
        ? previous.colorStocks
        : [],
      inventorySpeciesId: value === "Silkworms" ? previous.inventorySpeciesId : "",
    }));
  }

  function chooseInventorySpecies(species: InventorySpecies) {
    setForm(previous => ({
      ...previous,
      inventorySpeciesId: species.id,
      name: species.name,
      stock: String(species.quantity),
      imageUrl: previous.imageUrl || species.imageUrl,
      colorStocks: [],
    }));
    setFormError("");
  }

  const selectedSpecies = inventorySpecies.find(
    item => item.id === form.inventorySpeciesId
  );

  // -------------------------------------
  // COLOR-SPECIFIC INVENTORY
  // -------------------------------------

  function toggleColor(name: string) {
    setForm(previous => {
      const exists = previous.colorStocks.some(
        item => item.name === name
      );

      return {
        ...previous,
        colorStocks: exists
          ? previous.colorStocks.filter(
              item => item.name !== name
            )
          : [
              ...previous.colorStocks,
              { name, quantity: "" },
            ],
      };
    });
  }

  function updateColorQuantity(
    name: string,
    quantity: string
  ) {
    setForm(previous => ({
      ...previous,
      colorStocks: previous.colorStocks.map(item =>
        item.name === name
          ? { ...item, quantity }
          : item
      ),
    }));
  }

  const hasColorStock =
    supportsColors(form.category) &&
    form.colorStocks.length > 0;

  const totalColorStock = form.colorStocks.reduce(
    (total, item) =>
      total + (Number(item.quantity) || 0),
    0
  );

  // -------------------------------------
  // PRODUCT IMAGE PICKER
  // -------------------------------------

  async function pickProductImage() {
    if (selectingImage || saving) return;

    try {
      const result =
        await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsEditing: false,
          quality: 1,
        });

      if (result.canceled || !result.assets?.length) {
        return;
      }

      setSelectingImage(true);
      setFormError("");

      const selected = result.assets[0];

      const attempts = [
        { width: 800, quality: 0.65 },
        { width: 600, quality: 0.5 },
        { width: 450, quality: 0.4 },
        { width: 320, quality: 0.3 },
      ];

      let imageData = "";

      for (const attempt of attempts) {
        const resized =
          await ImageManipulator.manipulateAsync(
            selected.uri,
            [{ resize: { width: attempt.width } }],
            {
              compress: attempt.quality,
              format: ImageManipulator.SaveFormat.JPEG,
              base64: true,
            }
          );

        if (!resized.base64) continue;

        const candidate =
          `data:image/jpeg;base64,${resized.base64}`;

        if (candidate.length <= 180000) {
          imageData = candidate;
          break;
        }
      }

      if (!imageData) {
        setFormError(
          "This image could not be compressed enough. Please choose a smaller image."
        );
        return;
      }

      setForm(previous => ({
        ...previous,
        imageUrl: imageData,
      }));
    } catch (imageError) {
      console.error(
        "Product image selection error:",
        imageError
      );

      setFormError(
        "Unable to select the image. Please try again."
      );
    } finally {
      setSelectingImage(false);
    }
  }

  function removeProductImage() {
    setForm(previous => ({
      ...previous,
      imageUrl: "",
    }));
  }

  // -------------------------------------
  // VALIDATION
  // -------------------------------------

  function validateForm(): string {
    if (!form.name.trim()) {
      return "Please enter a product name.";
    }

    if (form.name.trim().length > 120) {
      return "Product name must be 120 characters or fewer.";
    }

    if (!categories.includes(form.category)) {
      return "Please select a valid category.";
    }

    if (form.description.length > 2000) {
      return "Description must be 2,000 characters or fewer.";
    }

    if (
      form.price.trim() === "" ||
      !Number.isFinite(Number(form.price)) ||
      Number(form.price) < 0
    ) {
      return "Enter a valid selling price.";
    }

    if (
      hasColorStock &&
      form.colorStocks.some(
        item =>
          item.quantity.trim() === "" ||
          !Number.isInteger(Number(item.quantity)) ||
          Number(item.quantity) <= 0
      )
    ) {
      return "Every selected color must have a whole-number stock quantity greater than zero.";
    }

    const stock = hasColorStock
      ? totalColorStock
      : Number(form.stock);

    if (
      (!hasColorStock && form.stock.trim() === "") ||
      !Number.isSafeInteger(stock) ||
      stock < 0
    ) {
      return "Stock must be a non-negative whole number.";
    }

    if (!validImage(form.imageUrl.trim())) {
      return "Use a valid HTTP/HTTPS image URL or a compressed Base64 JPEG image under 180,000 characters.";
    }

    if (form.category === "Silkworms") {
      if (!form.inventorySpeciesId || !selectedSpecies) {
        return "Choose a silkworm species from Inventory Management first.";
      }
      if (form.name.trim() !== selectedSpecies.name) {
        return "Linked silkworm product names follow Inventory Management.";
      }
    }

    const availableStock = form.category === "Silkworms"
      ? (selectedSpecies?.quantity ?? 0)
      : stock;

    if (form.published && availableStock <= 0) {
      return "Add stock before publishing this product.";
    }

    return "";
  }

  // -------------------------------------
  // SAVE TO FIRESTORE
  // -------------------------------------

  async function saveProduct() {
    if (saving) return;

    const validation = validateForm();

    if (validation) {
      setFormError(validation);
      return;
    }

    if (!auth.currentUser) {
      setFormError(
        "Sign in before saving a product."
      );
      return;
    }

    setSaving(true);
    setFormError("");

    const colorStocks: ProductColorStock[] =
      hasColorStock
        ? form.colorStocks.map(item => ({
            name: item.name,
            quantity: Number(item.quantity),
          }))
        : [];

    let stock = hasColorStock
      ? totalColorStock
      : Number(form.stock);

    // Re-read live inventory before saving a silkworm listing.
    // Never invent extra worms by typing a separate product quantity.
    if (form.category === "Silkworms") {
      try {
        const snapshot = await getDoc(
          doc(db, "inventory_species", form.inventorySpeciesId)
        );
        if (!snapshot.exists()) {
          setFormError("This silkworm species no longer exists in Inventory.");
          setSaving(false);
          return;
        }
        stock = Number(snapshot.data().quantity ?? 0);
        if (!Number.isSafeInteger(stock) || stock < 0) {
          setFormError("Invalid silkworm inventory quantity.");
          setSaving(false);
          return;
        }
        if (form.published && stock <= 0) {
          setFormError("Add silkworm stock in Inventory before publishing.");
          setSaving(false);
          return;
        }
      } catch (reason) {
        setFormError("Unable to verify silkworm stock in Firestore.");
        setSaving(false);
        return;
      }
    }

    const data = {
      name: form.name.trim(),
      category: form.category,
      description: form.description.trim(),
      price: Number(form.price),
      stock,
      colorStocks,
      imageUrl: form.imageUrl.trim(),
      inventorySpeciesId: form.category === "Silkworms"
        ? form.inventorySpeciesId
        : "",
      published: form.published,
      featured: form.featured,
      updatedAt: serverTimestamp(),
    };

    try {
      if (editingId) {
        await updateDoc(
          doc(db, "products", editingId),
          data
        );

        setNotice(
          "Product updated successfully."
        );
      } else {
        const reference = doc(
          collection(db, "products")
        );

        await setDoc(reference, {
          ...data,
          id: reference.id,
          createdAt: serverTimestamp(),
        });

        setSelectedId(reference.id);
        setNotice(
          "Product added successfully."
        );
      }

      setShowForm(false);
      setEditingId(null);
    } catch (firebaseError: any) {
      console.error(
        "Product save error:",
        firebaseError
      );

      setFormError(
        firebaseError?.code === "permission-denied"
          ? "Firestore denied the save. Check the products collection security rules."
          : firebaseError?.message ||
              "Unable to save product."
      );
    } finally {
      setSaving(false);
    }
  }

  // -------------------------------------
  // PUBLISH / UNPUBLISH
  // -------------------------------------

  async function togglePublish(
    product: ShopProduct
  ) {
    if (saving) return;

    const nextValue = !product.published;

    // Refresh inventory quantity before publishing a linked silkworm.
    let actualStock = product.stock;
    if (product.inventorySpeciesId) {
      try {
        const snapshot = await getDoc(doc(db, "inventory_species", product.inventorySpeciesId));
        actualStock = snapshot.exists() ? Number(snapshot.data().quantity ?? 0) : 0;
      } catch (reason) {
        setNotice("Unable to check silkworm inventory stock.");
        return;
      }
    }

    if (nextValue && actualStock <= 0) {
      setNotice(
        "Add stock before publishing this product."
      );
      return;
    }

    setSaving(true);

    try {
      await updateDoc(
        doc(db, "products", product.id),
        {
          published: nextValue,
          ...(product.inventorySpeciesId ? { stock: actualStock } : {}),
          updatedAt: serverTimestamp(),
        }
      );

      setNotice(
        nextValue
          ? "Product published successfully."
          : "Product unpublished successfully."
      );
    } catch (firebaseError: any) {
      setNotice(
        firebaseError?.message ||
          "Unable to update publication status."
      );
    } finally {
      setSaving(false);
    }
  }

  // -------------------------------------
  // DELETE PRODUCT
  // -------------------------------------

  async function confirmDelete() {
    if (!deleteTarget || saving) return;

    setSaving(true);

    try {
      await deleteDoc(
        doc(db, "products", deleteTarget.id)
      );

      if (selectedId === deleteTarget.id) {
        setSelectedId(null);
        setShowDetails(false);
      }

      setDeleteTarget(null);
      setNotice(
        "Product deleted successfully."
      );
    } catch (firebaseError: any) {
      setNotice(
        firebaseError?.message ||
          "Unable to delete product."
      );

      setDeleteTarget(null);
    } finally {
      setSaving(false);
    }
  }

  // -------------------------------------
  // RESET FILTERS
  // -------------------------------------

  function resetFilters() {
    setSearch("");
    setCategory("All Categories");
    setStatusFilter("All");
    setStockFilter("All Stock");
    setSortBy("Newest First");
  }

  // -------------------------------------
  // USER INTERFACE
  // -------------------------------------

  return (
    <View style={S.page}>
      <ScrollView
        style={S.page}
        contentContainerStyle={S.content}
        showsVerticalScrollIndicator={false}
      >
        <Heading
          label="PRODUCT MANAGEMENT"
          title="Product Management"
          description="Manage your silk product catalog. Add, edit, and publish products for your customers."
        />

        <Fade delay={100}>
          <View style={styles.statsGrid}>
            <Stat
              icon="cube-outline"
              label="Total Products"
              value={visibleProducts.length}
            />
            <Stat
              icon="checkmark-circle-outline"
              label="Published"
              value={publishedCount}
            />
            <Stat
              icon="document-text-outline"
              label="Drafts"
              value={draftCount}
            />
            <Stat
              icon="alert-circle-outline"
              label="Out of Stock"
              value={outOfStockCount}
            />
          </View>
        </Fade>

        {notice ? (
          <Pressable
            onPress={() => setNotice("")}
            style={styles.notice}
          >
            <Ionicons
              name="information-circle-outline"
              size={18}
              color={C.green}
            />
            <Text style={styles.noticeText}>
              {notice}
            </Text>
            <Ionicons
              name="close"
              size={16}
              color={C.green}
            />
          </Pressable>
        ) : null}

        <Fade delay={180}>
          <View style={S.card}>
            <View style={styles.sectionHeader}>
              <View style={{ flex: 1 }}>
                <Text style={S.sectionTitle}>
                  Product Catalog
                </Text>
                <Text style={S.muted}>
                  Manage all products in your store.
                </Text>
              </View>

              <Pressable
                onPress={openAdd}
                style={styles.addButton}
                accessibilityRole="button"
              >
                <Ionicons
                  name="add"
                  size={17}
                  color="#FFFFFF"
                />
                <Text style={styles.addButtonText}>
                  Add
                </Text>
              </Pressable>
            </View>

            <Search
              value={search}
              onChange={setSearch}
              placeholder="Search products..."
            />

            <Pressable
              style={styles.filterToggle}
              onPress={() =>
                setFilterPanel(previous => !previous)
              }
            >
              <Ionicons
                name="options-outline"
                size={18}
                color={C.green}
              />
              <Text style={styles.filterToggleText}>
                Filters & Sorting
              </Text>
              <Ionicons
                name={
                  filterPanel
                    ? "chevron-up"
                    : "chevron-down"
                }
                size={17}
                color={C.green}
              />
            </Pressable>

            {filterPanel && (
              <View style={styles.filterPanel}>
                <FilterSection
                  label="Category"
                  options={[
                    "All Categories",
                    ...categories,
                  ]}
                  selected={category}
                  onSelect={setCategory}
                />

                <FilterSection
                  label="Status"
                  options={statuses}
                  selected={statusFilter}
                  onSelect={value =>
                    setStatusFilter(
                      value as StatusFilter
                    )
                  }
                />

                <FilterSection
                  label="Stock"
                  options={stockOptions}
                  selected={stockFilter}
                  onSelect={value =>
                    setStockFilter(
                      value as StockFilter
                    )
                  }
                />

                <FilterSection
                  label="Sort By"
                  options={sortOptions}
                  selected={sortBy}
                  onSelect={value =>
                    setSortBy(
                      value as SortOption
                    )
                  }
                />

                <Pressable
                  onPress={resetFilters}
                >
                  <Text style={styles.resetText}>
                    Clear All Filters
                  </Text>
                </Pressable>
              </View>
            )}

            <View style={styles.resultsRow}>
              <Text style={S.muted}>
                {filtered.length} products found
              </Text>
              <Text style={styles.liveLabel}>
                FIRESTORE LIVE
              </Text>
            </View>

            {loading ? (
              <View style={styles.loadingArea}>
                <ActivityIndicator
                  color={C.green}
                />
                <Text style={S.muted}>
                  Loading products from Firebase...
                </Text>
              </View>
            ) : error ? (
              <View style={styles.emptyArea}>
                <Ionicons
                  name="alert-circle-outline"
                  size={30}
                  color="#B34D4D"
                />
                <Text style={styles.errorText}>
                  {error}
                </Text>
              </View>
            ) : filtered.length === 0 ? (
              <View style={styles.emptyArea}>
                <Ionicons
                  name="cube-outline"
                  size={38}
                  color={C.green}
                />
                <Text style={styles.emptyTitle}>
                  {visibleProducts.length === 0
                    ? "No products yet"
                    : "No matching products"}
                </Text>
                <Text style={styles.emptyDescription}>
                  {visibleProducts.length === 0
                    ? "Add your first product to start building the catalog."
                    : "Try changing your filters."}
                </Text>
                <Action
                  title={
                    visibleProducts.length === 0
                      ? "Add Product"
                      : "Clear Filters"
                  }
                  icon="add-outline"
                  onPress={
                    visibleProducts.length === 0
                      ? openAdd
                      : resetFilters
                  }
                />
              </View>
            ) : (
              filtered.map(product => (
                <View
                  key={product.id}
                  style={styles.productCard}
                >
                  <Pressable
                    onPress={() => {
                      setSelectedId(product.id);
                      setShowDetails(true);
                    }}
                    style={styles.productTop}
                  >
                    <ProductImage
                      imageUrl={product.imageUrl}
                      size={60}
                    />

                    <View style={{ flex: 1 }}>
                      <Text style={styles.productName}>
                        {product.name}
                      </Text>
                      <Text style={S.muted}>
                        {product.category}{product.inventorySpeciesId ? " · Inventory linked" : ""}
                      </Text>
                      <Text style={styles.priceText}>
                        {money(product.price)}
                      </Text>
                    </View>

                    <Ionicons
                      name="chevron-forward"
                      size={17}
                      color={C.muted}
                    />
                  </Pressable>

                  <View style={styles.productMeta}>
                    <View>
                      <Text style={styles.metaLabel}>
                        STOCK
                      </Text>
                      <Text style={styles.metaValue}>
                        {product.stock.toLocaleString()}{" "}
                        {stockUnit(product.category)}
                      </Text>
                    </View>

                    <View>
                      <Text style={styles.metaLabel}>
                        STATUS
                      </Text>
                      <ProductBadge
                        status={productStatus(product)}
                      />
                    </View>
                  </View>

                  <View style={styles.actionRow}>
                    <SmallButton
                      title="Details"
                      icon="eye-outline"
                      onPress={() => {
                        setSelectedId(product.id);
                        setShowDetails(true);
                      }}
                    />

                    <SmallButton
                      title="Edit"
                      icon="create-outline"
                      onPress={() => openEdit(product)}
                    />

                    <SmallButton
                      title={
                        product.published
                          ? "Unpublish"
                          : "Publish"
                      }
                      icon={
                        product.published
                          ? "eye-off-outline"
                          : "cloud-upload-outline"
                      }
                      disabled={
                        saving ||
                        (!product.published &&
                          product.stock <= 0)
                      }
                      onPress={() =>
                        togglePublish(product)
                      }
                    />
                  </View>
                </View>
              ))
            )}
          </View>
        </Fade>
      </ScrollView>

      {/* ADD / EDIT PRODUCT MODAL */}

      <Modal
        visible={showForm}
        animationType="slide"
        transparent
        onRequestClose={() => {
          if (!saving && !selectingImage) {
            setShowForm(false);
          }
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={S.eyebrow}>
                  SILKMART CATALOG
                </Text>
                <Text style={styles.modalTitle}>
                  {editingId
                    ? "Edit Product"
                    : "Add New Product"}
                </Text>
              </View>

              <Pressable
                disabled={saving || selectingImage}
                onPress={() => setShowForm(false)}
              >
                <Ionicons
                  name="close"
                  size={24}
                  color={C.dark}
                />
              </Pressable>
            </View>

            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={styles.formBody}
              keyboardShouldPersistTaps="handled"
            >
              <FormField label="Product Name">
                <TextInput
                  style={S.input}
                  value={form.name}
                  maxLength={120}
                  placeholder="e.g. Mulberry Silk Scarf"
                  placeholderTextColor={C.muted}
                  onChangeText={value =>
                    updateForm("name", value)
                  }
                />
              </FormField>

              <Text style={styles.fieldLabel}>
                Category
              </Text>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.categoryOptions}
              >
                {categories.map(item => (
                  <Pressable
                    key={item}
                    onPress={() => changeCategory(item)}
                    style={[
                      S.chip,
                      form.category === item &&
                        S.chipActive,
                    ]}
                  >
                    <Text
                      style={{
                        color:
                          form.category === item
                            ? "#FFFFFF"
                            : C.dark,
                        fontSize: 11,
                      }}
                    >
                      {item}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>

              {form.category === "Silkworms" && (
                <View style={styles.colorPanel}>
                  <Text style={styles.fieldLabel}>Choose Silkworm from Inventory</Text>
                  <Text style={S.muted}>
                    Select an existing species. Its quantity is shared with Inventory Management.
                  </Text>
                  {inventoryError ? <Text style={styles.errorText}>{inventoryError}</Text> : null}
                  {inventorySpecies.length === 0 ? (
                    <Text style={[S.muted, { marginTop: 12 }]}>
                      No species available. Add a silkworm species in Inventory first.
                    </Text>
                  ) : inventorySpecies.map(item => (
                    <Pressable
                      key={item.id}
                      onPress={() => chooseInventorySpecies(item)}
                      style={[
                        styles.colorChoice,
                        { marginTop: 8, alignItems: "center" },
                        form.inventorySpeciesId === item.id && styles.selectedColor,
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={S.strong}>{item.name}</Text>
                        <Text style={S.muted}>
                          {item.quantity.toLocaleString()} worms · {item.stage}
                        </Text>
                      </View>
                      {form.inventorySpeciesId === item.id && (
                        <Ionicons name="checkmark-circle" color={C.green} size={20}/>
                      )}
                    </Pressable>
                  ))}
                </View>
              )}

              <FormField label="Selling Price (PHP)">
                <TextInput
                  style={S.input}
                  value={form.price}
                  placeholder="0.00"
                  placeholderTextColor={C.muted}
                  keyboardType="decimal-pad"
                  onChangeText={value =>
                    updateForm("price", value)
                  }
                />
              </FormField>

              {supportsColors(form.category) && (
                <View style={styles.colorPanel}>
                  <Text style={styles.fieldLabel}>
                    Available Product Colors
                  </Text>
                  <Text style={S.muted}>
                    Select the colors available for
                    this product.
                  </Text>

                  <View style={styles.colorGrid}>
                    {colors.map(color => {
                      const selected =
                        form.colorStocks.some(
                          item =>
                            item.name === color.name
                        );

                      return (
                        <Pressable
                          key={color.name}
                          onPress={() =>
                            toggleColor(color.name)
                          }
                          style={[
                            styles.colorChoice,
                            selected &&
                              styles.selectedColor,
                          ]}
                        >
                          <View
                            style={[
                              styles.colorDot,
                              {
                                backgroundColor:
                                  color.hex,
                              },
                            ]}
                          />
                          <Text style={styles.colorName}>
                            {color.name}
                          </Text>
                          {selected && (
                            <Ionicons
                              name="checkmark-circle"
                              color={C.green}
                              size={16}
                            />
                          )}
                        </Pressable>
                      );
                    })}
                  </View>

                  {form.colorStocks.map(item => (
                    <View
                      key={item.name}
                      style={styles.colorStockRow}
                    >
                      <Text style={styles.colorStockName}>
                        {item.name}
                      </Text>
                      <TextInput
                        style={styles.colorStockInput}
                        value={item.quantity}
                        keyboardType="number-pad"
                        placeholder="Qty"
                        placeholderTextColor={C.muted}
                        onChangeText={value =>
                          updateColorQuantity(
                            item.name,
                            value
                          )
                        }
                      />
                    </View>
                  ))}

                  {hasColorStock && (
                    <Text style={styles.totalColorText}>
                      Total Color Stock:{" "}
                      {totalColorStock.toLocaleString()} pcs
                    </Text>
                  )}
                </View>
              )}

              <FormField
                label={`Available Stock (${stockUnit(
                  form.category
                )})`}
              >
                <TextInput
                  style={[
                    S.input,
                    (hasColorStock || form.category === "Silkworms") &&
                      styles.readonlyInput,
                  ]}
                  value={
                    form.category === "Silkworms"
                      ? String(selectedSpecies?.quantity ?? 0)
                      : hasColorStock
                        ? String(totalColorStock)
                        : form.stock
                  }
                  editable={!hasColorStock && form.category !== "Silkworms"}
                  placeholder="0"
                  placeholderTextColor={C.muted}
                  keyboardType="number-pad"
                  onChangeText={value =>
                    updateForm("stock", value)
                  }
                />
              </FormField>

              {form.category === "Silkworms" && (
                <Text style={[S.muted, { marginBottom: 14 }]}>
                  Silkworm stock is edited in Inventory Management. Product stock follows it automatically on this page.
                </Text>
              )}

              {/* UPDATED IMAGE UPLOAD FIELD */}

              <FormField label="Product Image (Optional)">
                <Pressable
                  onPress={pickProductImage}
                  disabled={selectingImage || saving}
                  style={styles.imageUploadBox}
                >
                  {selectingImage ? (
                    <>
                      <ActivityIndicator
                        size="small"
                        color={C.green}
                      />
                      <Text style={S.muted}>
                        Processing image...
                      </Text>
                    </>
                  ) : form.imageUrl ? (
                    <>
                      <Image
                        source={{ uri: form.imageUrl }}
                        resizeMode="cover"
                        style={styles.uploadedImage}
                      />
                      <Text style={styles.imageUploadTitle}>
                        Tap to change image
                      </Text>
                    </>
                  ) : (
                    <>
                      <Ionicons
                        name="image-outline"
                        size={37}
                        color={C.green}
                      />
                      <Text style={styles.imageUploadTitle}>
                        Tap to Select Image
                      </Text>
                      <Text style={styles.imageUploadHelp}>
                        Choose a product photo from your device
                      </Text>
                    </>
                  )}
                </Pressable>

                {form.imageUrl !== "" && (
                  <Pressable
                    onPress={removeProductImage}
                    disabled={saving || selectingImage}
                    style={styles.removeImageButton}
                  >
                    <Ionicons
                      name="trash-outline"
                      size={16}
                      color="#B34D4D"
                    />
                    <Text style={styles.removeImageText}>
                      Remove Image
                    </Text>
                  </Pressable>
                )}
              </FormField>

              <FormField label="Product Description">
                <TextInput
                  style={[
                    S.input,
                    styles.multilineInput,
                  ]}
                  multiline
                  value={form.description}
                  maxLength={2000}
                  placeholder="Describe the product..."
                  placeholderTextColor={C.muted}
                  onChangeText={value =>
                    updateForm("description", value)
                  }
                />
              </FormField>

              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={S.strong}>
                    Featured Product
                  </Text>
                  <Text style={S.muted}>
                    Highlight this item in the catalog.
                  </Text>
                </View>
                <Switch
                  value={form.featured}
                  trackColor={{
                    true: C.green,
                    false: C.line,
                  }}
                  onValueChange={value =>
                    updateForm("featured", value)
                  }
                />
              </View>

              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={S.strong}>
                    Publish Product
                  </Text>
                  <Text style={S.muted}>
                    Save as published or keep as draft.
                  </Text>
                </View>
                <Switch
                  value={form.published}
                  trackColor={{
                    true: C.green,
                    false: C.line,
                  }}
                  onValueChange={value =>
                    updateForm("published", value)
                  }
                />
              </View>

              {formError !== "" && (
                <View style={styles.formErrorBox}>
                  <Text style={styles.errorText}>
                    {formError}
                  </Text>
                </View>
              )}

              <View style={styles.formActions}>
                <Pressable
                  disabled={saving || selectingImage}
                  style={styles.cancelButton}
                  onPress={() => setShowForm(false)}
                >
                  <Text style={styles.cancelText}>
                    Cancel
                  </Text>
                </Pressable>

                <Pressable
                  disabled={saving || selectingImage}
                  style={[
                    styles.saveButton,
                    (saving || selectingImage) && {
                      opacity: 0.6,
                    },
                  ]}
                  onPress={saveProduct}
                >
                  {saving && (
                    <ActivityIndicator
                      color="#FFFFFF"
                      size="small"
                    />
                  )}
                  <Text style={styles.saveText}>
                    {saving
                      ? "Saving..."
                      : editingId
                        ? "Save Changes"
                        : "Add Product"}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* PRODUCT DETAILS MODAL */}

      <Modal
        visible={showDetails}
        transparent
        animationType="slide"
        onRequestClose={() => setShowDetails(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                Product Details
              </Text>
              <Pressable
                onPress={() => setShowDetails(false)}
              >
                <Ionicons
                  name="close"
                  size={24}
                  color={C.dark}
                />
              </Pressable>
            </View>

            {selectedProduct && (
              <ScrollView
                contentContainerStyle={styles.formBody}
              >
                <View style={styles.detailsHero}>
                  <ProductImage
                    imageUrl={selectedProduct.imageUrl}
                    size={110}
                  />
                  <Text style={styles.detailsName}>
                    {selectedProduct.name}
                  </Text>
                  <ProductBadge
                    status={productStatus(selectedProduct)}
                  />
                </View>

                {selectedProduct.inventorySpeciesId ? (
                  <DetailRow label="Stock Source" value="Silkworm Inventory (linked)" />
                ) : null}
                <DetailRow
                  label="Category"
                  value={selectedProduct.category}
                />
                <DetailRow
                  label="Price"
                  value={money(selectedProduct.price)}
                />
                <DetailRow
                  label="Stock"
                  value={`${selectedProduct.stock.toLocaleString()} ${stockUnit(
                    selectedProduct.category
                  )}`}
                />
                <DetailRow
                  label="Featured"
                  value={
                    selectedProduct.featured
                      ? "Yes"
                      : "No"
                  }
                />
                <DetailRow
                  label="Date Added"
                  value={dateText(selectedProduct.createdAt)}
                />
                <DetailRow
                  label="Last Updated"
                  value={dateText(selectedProduct.updatedAt)}
                />

                {selectedProduct.colorStocks.length >
                  0 && (
                  <View style={S.card}>
                    <Text style={S.strong}>
                      Available Colors
                    </Text>
                    {selectedProduct.colorStocks.map(
                      color => (
                        <View
                          key={color.name}
                          style={styles.detailRow}
                        >
                          <Text style={S.muted}>
                            {color.name}
                          </Text>
                          <Text style={S.strong}>
                            {color.quantity} pcs
                          </Text>
                        </View>
                      )
                    )}
                  </View>
                )}

                {selectedProduct.description ? (
                  <View style={S.card}>
                    <Text style={S.strong}>
                      Description
                    </Text>
                    <Text
                      style={[
                        S.muted,
                        { marginTop: 8 },
                      ]}
                    >
                      {selectedProduct.description}
                    </Text>
                  </View>
                ) : null}

                <View style={{ gap: 9 }}>
                  <Action
                    title="Edit Product"
                    icon="create-outline"
                    onPress={() =>
                      openEdit(selectedProduct)
                    }
                  />
                  <Action
                    title={
                      selectedProduct.published
                        ? "Unpublish Product"
                        : "Publish Product"
                    }
                    disabled={
                      saving ||
                      (!selectedProduct.published &&
                        selectedProduct.stock <= 0)
                    }
                    onPress={() =>
                      togglePublish(selectedProduct)
                    }
                  />

                  <Pressable
                    onPress={() => {
                      setShowDetails(false);
                      setDeleteTarget(selectedProduct);
                    }}
                    style={styles.deleteButton}
                  >
                    <Ionicons
                      name="trash-outline"
                      color="#B34D4D"
                      size={18}
                    />
                    <Text style={styles.deleteButtonText}>
                      Delete Product
                    </Text>
                  </Pressable>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* DELETE CONFIRMATION */}

      <Modal
        visible={deleteTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteTarget(null)}
      >
        <View style={styles.confirmBackdrop}>
          <View style={styles.confirmCard}>
            <Ionicons
              name="warning-outline"
              size={38}
              color="#B34D4D"
            />
            <Text style={styles.confirmTitle}>
              Delete Product?
            </Text>
            <Text style={styles.confirmDescription}>
              Permanently delete{" "}
              {deleteTarget?.name} from the catalog?
            </Text>
            <View style={styles.formActions}>
              <Pressable
                disabled={saving}
                style={styles.cancelButton}
                onPress={() => setDeleteTarget(null)}
              >
                <Text style={styles.cancelText}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                disabled={saving}
                style={styles.confirmDelete}
                onPress={confirmDelete}
              >
                <Text style={styles.saveText}>
                  {saving ? "Deleting..." : "Delete"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// -------------------------------------
// REUSABLE COMPONENTS
// -------------------------------------

function ProductImage({
  imageUrl,
  size,
}: {
  imageUrl: string;
  size: number;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [imageUrl]);

  return (
    <View
      style={[
        styles.productImage,
        {
          width: size,
          height: size,
        },
      ]}
    >
      {imageUrl && !failed ? (
        <Image
          source={{ uri: imageUrl }}
          style={{
            width: "100%",
            height: "100%",
          }}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <Ionicons
          name="cube-outline"
          size={size * 0.4}
          color={C.green}
        />
      )}
    </View>
  );
}

function ProductBadge({
  status,
}: {
  status: string;
}) {
  const color =
    status === "Out of Stock"
      ? "#B34D4D"
      : status === "Draft"
        ? "#A77931"
        : C.green;

  const background =
    status === "Out of Stock"
      ? "#FCEAEA"
      : status === "Draft"
        ? "#FFF2D9"
        : C.soft;

  return (
    <View
      style={[
        styles.statusBadge,
        { backgroundColor: background },
      ]}
    >
      <Text
        style={{
          color,
          fontSize: 10,
          fontWeight: "700",
        }}
      >
        {status}
      </Text>
    </View>
  );
}

function SmallButton({
  title,
  icon,
  onPress,
  disabled = false,
}: {
  title: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.smallButton,
        disabled && { opacity: 0.4 },
      ]}
    >
      <Ionicons
        name={icon}
        size={14}
        color={C.green}
      />
      <Text style={styles.smallButtonText}>
        {title}
      </Text>
    </Pressable>
  );
}

function FilterSection({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: readonly string[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.fieldLabel}>
        {label}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 7 }}
      >
        {options.map(option => (
          <Pressable
            key={option}
            onPress={() => onSelect(option)}
            style={[
              S.chip,
              selected === option &&
                S.chipActive,
            ]}
          >
            <Text
              style={{
                fontSize: 11,
                color:
                  selected === option
                    ? "#FFFFFF"
                    : C.dark,
              }}
            >
              {option}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ marginBottom: 17 }}>
      <Text style={styles.fieldLabel}>
        {label}
      </Text>
      {children}
    </View>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={S.muted}>
        {label}
      </Text>
      <Text
        style={[
          S.strong,
          {
            flexShrink: 1,
            textAlign: "right",
          },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

// -------------------------------------
// STYLES
// -------------------------------------

const styles = StyleSheet.create({
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 18,
  },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 15,
  },

  addButton: {
    backgroundColor: C.green,
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },

  addButtonText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },

  filterToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 11,
    marginBottom: 12,
  },

  filterToggleText: {
    color: C.green,
    fontSize: 12,
    fontWeight: "700",
    flex: 1,
  },

  filterPanel: {
    paddingVertical: 10,
  },

  resetText: {
    color: C.green,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "right",
    marginBottom: 10,
  },

  resultsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginVertical: 12,
  },

  liveLabel: {
    color: C.green,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
  },

  productCard: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 15,
    padding: 12,
    backgroundColor: "#FFFFFF",
    marginBottom: 12,
  },

  productTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },

  productImage: {
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: C.soft,
    alignItems: "center",
    justifyContent: "center",
  },

  productName: {
    color: C.dark,
    fontFamily: "serif",
    fontSize: 17,
    marginBottom: 3,
  },

  priceText: {
    color: C.green,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 5,
  },

  productMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.line,
  },

  metaLabel: {
    fontSize: 9,
    color: C.muted,
    fontWeight: "700",
    marginBottom: 5,
  },

  metaValue: {
    fontSize: 12,
    color: C.dark,
    fontWeight: "700",
  },

  statusBadge: {
    alignSelf: "flex-start",
    borderRadius: 20,
    paddingVertical: 5,
    paddingHorizontal: 9,
  },

  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 14,
  },

  smallButton: {
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 9,
    backgroundColor: C.soft,
    gap: 5,
  },

  smallButtonText: {
    color: C.green,
    fontSize: 10,
    fontWeight: "700",
  },

  loadingArea: {
    paddingVertical: 45,
    alignItems: "center",
    gap: 12,
  },

  emptyArea: {
    alignItems: "center",
    paddingVertical: 32,
    gap: 12,
  },

  emptyTitle: {
    fontFamily: "serif",
    fontSize: 23,
    color: C.dark,
  },

  emptyDescription: {
    color: C.muted,
    fontSize: 12,
    lineHeight: 19,
    textAlign: "center",
  },

  errorText: {
    color: "#B34D4D",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },

  notice: {
    backgroundColor: C.soft,
    padding: 13,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginBottom: 14,
  },

  noticeText: {
    flex: 1,
    color: C.green,
    fontSize: 12,
    lineHeight: 18,
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },

  modalContainer: {
    backgroundColor: C.cream,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    height: "92%",
    overflow: "hidden",
  },

  modalHeader: {
    padding: 20,
    backgroundColor: C.white,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  modalTitle: {
    fontFamily: "serif",
    fontSize: 25,
    color: C.dark,
  },

  formBody: {
    padding: 20,
    paddingBottom: 40,
  },

  fieldLabel: {
    color: C.dark,
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 9,
  },

  fieldHelp: {
    color: C.muted,
    fontSize: 10,
    lineHeight: 17,
    marginTop: 7,
  },

  categoryOptions: {
    gap: 7,
    paddingBottom: 17,
  },

  colorPanel: {
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 14,
    padding: 13,
    marginBottom: 17,
  },

  colorGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    marginTop: 13,
  },

  colorChoice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 9,
    padding: 9,
  },

  selectedColor: {
    borderColor: C.green,
    backgroundColor: C.soft,
  },

  colorDot: {
    width: 15,
    height: 15,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.line,
  },

  colorName: {
    fontSize: 11,
    color: C.dark,
  },

  colorStockRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 9,
  },

  colorStockName: {
    color: C.dark,
    fontSize: 12,
    fontWeight: "600",
  },

  colorStockInput: {
    width: 90,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 9,
    backgroundColor: C.white,
    padding: 9,
    color: C.dark,
    fontSize: 12,
  },

  totalColorText: {
    color: C.green,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 9,
  },

  readonlyInput: {
    backgroundColor: C.soft,
  },

  multilineInput: {
    minHeight: 82,
    textAlignVertical: "top",
  },

  imagePreview: {
    alignItems: "center",
    marginBottom: 17,
  },

  // IMAGE UPLOAD STYLES

  imageUploadBox: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: C.green,
    borderRadius: 14,
    backgroundColor: C.soft,
    padding: 18,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 145,
    gap: 9,
  },

  uploadedImage: {
    width: 115,
    height: 115,
    borderRadius: 12,
  },

  imageUploadTitle: {
    color: C.green,
    fontSize: 12,
    fontWeight: "700",
  },

  imageUploadHelp: {
    color: C.muted,
    fontSize: 11,
    textAlign: "center",
  },

  removeImageButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
  },

  removeImageText: {
    color: "#B34D4D",
    fontWeight: "600",
    fontSize: 12,
  },

  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 15,
    borderTopWidth: 1,
    borderTopColor: C.line,
    gap: 10,
  },

  formErrorBox: {
    backgroundColor: "#FCEAEA",
    borderRadius: 11,
    padding: 14,
    marginTop: 12,
  },

  formActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 20,
  },

  cancelButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    padding: 14,
  },

  cancelText: {
    color: C.dark,
    fontSize: 12,
    fontWeight: "700",
  },

  saveButton: {
    flex: 1.5,
    backgroundColor: C.green,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
    gap: 7,
  },

  saveText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },

  detailsHero: {
    alignItems: "center",
    paddingVertical: 16,
    gap: 12,
  },

  detailsName: {
    fontFamily: "serif",
    fontSize: 25,
    color: C.dark,
    textAlign: "center",
  },

  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
    gap: 15,
  },

  deleteButton: {
    borderWidth: 1,
    borderColor: "#EAC5C5",
    borderRadius: 12,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },

  deleteButtonText: {
    color: "#B34D4D",
    fontWeight: "700",
    fontSize: 12,
  },

  confirmBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: 25,
  },

  confirmCard: {
    backgroundColor: C.white,
    borderRadius: 20,
    padding: 25,
    width: "100%",
    alignItems: "center",
  },

  confirmTitle: {
    fontFamily: "serif",
    fontSize: 26,
    color: C.dark,
    marginTop: 12,
  },

  confirmDescription: {
    color: C.muted,
    fontSize: 12,
    lineHeight: 20,
    textAlign: "center",
    marginTop: 9,
  },

  confirmDelete: {
    flex: 1,
    backgroundColor: "#B34D4D",
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    justifyContent: "center",
  },
});
