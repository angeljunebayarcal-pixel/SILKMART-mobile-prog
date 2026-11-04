
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

import { auth, db } from "../firebase/config";

// =====================================
// CART ITEM TYPE
// =====================================

export type CartItem = {
  productId: string;
  name: string;
  price: number;
  color: string;
  quantity: number;
  maxQuantity: number;
  imageUrl?: string;
};

// =====================================
// CART STORAGE
// =====================================

const keyFor = (uid: string) =>
  `silkmart:cart:${uid}`;

const MAX_CART_ITEMS = 50;

// =====================================
// AUTHENTICATION
// =====================================

function requireCartOwner(uid: string): void {
  if (!uid || auth.currentUser?.uid !== uid) {
    throw new Error(
      "Please sign in to access your shopping bag."
    );
  }
}

// =====================================
// FIRESTORE REFERENCE
// =====================================

function cartRef(uid: string) {
  return doc(db, "customerCarts", uid);
}

// =====================================
// IMAGE VALIDATION
// =====================================

function validImageUrl(value: unknown): boolean {
  if (
    value === undefined ||
    value === ""
  ) {
    return true;
  }

  if (typeof value !== "string") {
    return false;
  }

  if (
    value.startsWith("data:image/jpeg;base64,")
  ) {
    return (
      value.length <= 180000 &&
      /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(
        value
      )
    );
  }

  if (
    value.startsWith("data:image/png;base64,")
  ) {
    return (
      value.length <= 180000 &&
      /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(
        value
      )
    );
  }

  return (
    value.length <= 2048 &&
    /^https?:\/\/\S+$/i.test(value)
  );
}

// =====================================
// CART ITEM VALIDATION
// =====================================

function isValidCartItem(
  value: unknown
): value is CartItem {
  if (
    value === null ||
    typeof value !== "object"
  ) {
    return false;
  }

  const item = value as Partial<CartItem>;

  return (
    typeof item.productId === "string" &&
    item.productId.trim().length > 0 &&

    typeof item.name === "string" &&
    item.name.trim().length > 0 &&

    typeof item.price === "number" &&
    Number.isFinite(item.price) &&
    item.price >= 0 &&

    typeof item.color === "string" &&

    typeof item.quantity === "number" &&
    Number.isSafeInteger(item.quantity) &&
    item.quantity >= 1 &&

    typeof item.maxQuantity === "number" &&
    Number.isSafeInteger(item.maxQuantity) &&
    item.maxQuantity >= 1 &&

    item.quantity <= item.maxQuantity &&

    validImageUrl(item.imageUrl)
  );
}

// =====================================
// NORMALIZE CART ITEMS
// =====================================

function normalizeCart(
  items: CartItem[]
): CartItem[] {
  const result: CartItem[] = [];

  for (const item of items) {
    if (!isValidCartItem(item)) {
      continue;
    }

    const index = result.findIndex(
      existing =>
        existing.productId === item.productId &&
        existing.color === item.color
    );

    if (index < 0) {
      result.push({
        ...item,
        imageUrl: item.imageUrl || "",
      });

      continue;
    }

    const existing = result[index];

    const combined =
      existing.quantity + item.quantity;

    const maxQuantity = Math.min(
      existing.maxQuantity,
      item.maxQuantity
    );

    result[index] = {
      ...existing,
      name: item.name,
      price: item.price,
      maxQuantity,
      imageUrl:
        item.imageUrl ||
        existing.imageUrl ||
        "",
      quantity: Math.min(
        combined,
        maxQuantity
      ),
    };
  }

  return result;
}

// =====================================
// READ LOCAL CART
// =====================================

async function readLocalCart(
  uid: string
): Promise<CartItem[]> {
  try {
    const raw = await AsyncStorage.getItem(
      keyFor(uid)
    );

    if (!raw) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return normalizeCart(
      parsed.filter(isValidCartItem)
    ).slice(0, MAX_CART_ITEMS);
  } catch (error) {
    console.warn(
      "Unable to read local shopping cart:",
      error
    );

    return [];
  }
}

// =====================================
// SAVE LOCAL CART CACHE
// =====================================

async function saveLocalCart(
  uid: string,
  items: CartItem[]
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      keyFor(uid),
      JSON.stringify(items)
    );
  } catch (error) {
    console.warn(
      "Unable to update local cart cache:",
      error
    );
  }
}

// =====================================
// RESTORE LOCAL PRODUCT IMAGES
// =====================================

function restoreCachedImages(
  cloudItems: CartItem[],
  localItems: CartItem[]
): CartItem[] {
  return cloudItems.map(item => {
    if (item.imageUrl) {
      return item;
    }

    const cached = localItems.find(
      existing =>
        existing.productId === item.productId &&
        existing.color === item.color
    );

    if (
      cached &&
      cached.imageUrl &&
      validImageUrl(cached.imageUrl)
    ) {
      return {
        ...item,
        imageUrl: cached.imageUrl,
      };
    }

    return item;
  });
}

// =====================================
// PREPARE FIRESTORE CART
// =====================================

function prepareFirestoreCart(
  items: CartItem[]
): CartItem[] {
  return items.map(item => {
    const imageUrl =
      typeof item.imageUrl === "string"
        ? item.imageUrl
        : "";

    // Keep only small HTTP/HTTPS image URLs
    // in the Firestore cart document.
    //
    // Base64 images may be too large for
    // the Firestore document size limit.
    //
    // The cart screen can load images from
    // the products collection separately.

    const safeImageUrl =
      imageUrl.length <= 2048 &&
      /^https?:\/\/\S+$/i.test(imageUrl)
        ? imageUrl
        : "";

    return {
      productId: item.productId,
      name: item.name,
      price: item.price,
      color: item.color,
      quantity: item.quantity,
      maxQuantity: item.maxQuantity,
      imageUrl: safeImageUrl,
    };
  });
}

// =====================================
// READ CUSTOMER CART
// =====================================

export async function readCart(
  uid: string
): Promise<CartItem[]> {
  requireCartOwner(uid);

  try {
    // Firestore is the main source of truth.
    const snapshot = await getDoc(
      cartRef(uid)
    );

    requireCartOwner(uid);

    const localItems = await readLocalCart(uid);

    requireCartOwner(uid);

    // =====================================
    // EXISTING CLOUD CART
    // =====================================

    if (snapshot.exists()) {
      const data = snapshot.data();

      if (!Array.isArray(data.items)) {
        throw new Error(
          "The saved shopping bag has an invalid format."
        );
      }

      const cloudItems = normalizeCart(
        data.items.filter(isValidCartItem)
      );

      const restoredItems =
        restoreCachedImages(
          cloudItems,
          localItems
        );

      requireCartOwner(uid);

      await saveLocalCart(
        uid,
        restoredItems
      );

      // Cloud cart always wins.
      // An empty Firestore cart stays empty.
      return restoredItems;
    }

    // =====================================
    // MIGRATE OLD ASYNCSTORAGE CART
    // =====================================

    // This happens only when the customer
    // does not have a cloud cart document yet.

    const migratedItems = normalizeCart(
      localItems
    );

    if (migratedItems.length > MAX_CART_ITEMS) {
      throw new Error(
        "Your shopping bag contains too many selections."
      );
    }

    requireCartOwner(uid);

    await setDoc(
      cartRef(uid),
      {
        uid,
        items: prepareFirestoreCart(
          migratedItems
        ),
        updatedAt: serverTimestamp(),
      }
    );

    requireCartOwner(uid);

    await saveLocalCart(
      uid,
      migratedItems
    );

    return migratedItems;
  } catch (error) {
    console.error(
      "Unable to load shopping bag:",
      error
    );

    if (
      !uid ||
      auth.currentUser?.uid !== uid
    ) {
      throw new Error(
        "Please sign in again to access your shopping bag."
      );
    }

    throw new Error(
      error instanceof Error &&
      error.message ===
        "The saved shopping bag has an invalid format."
        ? error.message
        : "Unable to load your saved shopping bag. Please check your internet connection and Firestore Security Rules."
    );
  }
}

// =====================================
// SAVE CUSTOMER CART
// =====================================

export async function writeCart(
  uid: string,
  items: CartItem[]
): Promise<void> {
  requireCartOwner(uid);

  if (
    !Array.isArray(items) ||
    !items.every(isValidCartItem)
  ) {
    throw new Error(
      "Your bag contains an invalid product, price, or quantity."
    );
  }

  const normalized = normalizeCart(items);

  if (normalized.length > MAX_CART_ITEMS) {
    throw new Error(
      "Your shopping bag cannot contain more than 50 selections."
    );
  }

  requireCartOwner(uid);

  try {
    // =====================================
    // SAVE TO FIRESTORE
    // =====================================

    await setDoc(
      cartRef(uid),
      {
        uid,
        items: prepareFirestoreCart(
          normalized
        ),
        updatedAt: serverTimestamp(),
      }
    );

    requireCartOwner(uid);

    // =====================================
    // UPDATE LOCAL CACHE
    // =====================================

    await saveLocalCart(
      uid,
      normalized
    );
  } catch (error) {
    console.error(
      "Unable to save shopping bag:",
      error
    );

    throw new Error(
      "Unable to save your shopping bag. Please check your internet connection and Firestore permissions."
    );
  }
}

// =====================================
// ADD PRODUCT TO CART
// =====================================

export async function addToCart(
  uid: string,
  item: CartItem
): Promise<void> {
  requireCartOwner(uid);

  if (!isValidCartItem(item)) {
    throw new Error(
      "Invalid product or quantity."
    );
  }

  // Load the latest saved cart.
  const items = await readCart(uid);

  requireCartOwner(uid);

  const index = items.findIndex(
    existing =>
      existing.productId === item.productId &&
      existing.color === item.color
  );

  // =====================================
  // EXISTING PRODUCT
  // =====================================

  if (index >= 0) {
    const current = items[index];

    const combined =
      current.quantity + item.quantity;

    const maxQuantity = Math.min(
      current.maxQuantity,
      item.maxQuantity
    );

    if (
      !Number.isSafeInteger(combined) ||
      combined > maxQuantity
    ) {
      throw new Error(
        "Quantity exceeds available stock for this selection."
      );
    }

    items[index] = {
      ...current,
      ...item,
      maxQuantity,
      imageUrl:
        item.imageUrl ||
        current.imageUrl ||
        "",
      quantity: combined,
    };
  } else {
    // =====================================
    // NEW PRODUCT
    // =====================================

    if (items.length >= MAX_CART_ITEMS) {
      throw new Error(
        "Your shopping bag cannot contain more than 50 selections."
      );
    }

    items.push({
      ...item,
      imageUrl: item.imageUrl || "",
    });
  }

  // Save the updated cart permanently.
  await writeCart(uid, items);
}
