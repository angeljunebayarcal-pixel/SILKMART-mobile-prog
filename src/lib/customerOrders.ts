import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";

import { auth, db } from "../firebase/config";
import type { CartItem } from "./customerCart";

// =====================================
// ORDER TYPES
// =====================================

export type OrderStatus = "Pending" | "Confirmed" | "Rejected";

export type DeliveryStatus =
  | "Pending"
  | "Scheduled"
  | "Preparing"
  | "Out for Delivery"
  | "Delivered";

export type DemoOrder = {
  id: string;
  customerUid: string;
  createdAt: string;
  status: OrderStatus;
  deliveryStatus: DeliveryStatus;
  preferredDeliveryDate: string;
  confirmedDeliveryDate: string;
  paymentMethod: "COD";
  items: CartItem[];
  total: number;

  // Optional historical event timestamps. Existing orders do not have to
  // contain these fields, and new orders do not write them on creation.
  updatedAt?: string;
  decisionAt?: string;
  scheduledAt?: string;
  preparingAt?: string;
  dispatchedAt?: string;
  deliveredAt?: string;
};

// =====================================
// LOCAL STORAGE
// =====================================

const keyFor = (uid: string) => `silkmart:demo-orders:${uid}`;

// =====================================
// DATE HELPERS
// =====================================

function validDate(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;

  const [year, month, date] = day.split("-").map(Number);
  const parsed = new Date(year, month - 1, date);

  return (
    parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === date
  );
}

function localToday(): string {
  const date = new Date();

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

// Firestore timestamps, ISO strings and legacy timestamps are handled
// consistently. Missing event timestamps remain absent, never fabricated.
function timestampToIso(value: unknown): string | undefined {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
  }

  if (value && typeof value === "object") {
    const timestamp = value as {
      toDate?: () => Date;
      seconds?: number;
    };

    if (typeof timestamp.toDate === "function") {
      const date = timestamp.toDate();
      return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
    }

    if (typeof timestamp.seconds === "number") {
      const date = new Date(timestamp.seconds * 1000);
      return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
    }
  }

  return undefined;
}

// =====================================
// ORDER NORMALIZATION
// =====================================

function normalize(id: string, data: Record<string, any>): DemoOrder {
  const status: OrderStatus =
    data.status === "Confirmed" || data.status === "Rejected"
      ? data.status
      : "Pending";

  const deliveryStatus: DeliveryStatus =
    data.deliveryStatus === "Scheduled" ||
    data.deliveryStatus === "Preparing" ||
    data.deliveryStatus === "Out for Delivery" ||
    data.deliveryStatus === "Delivered"
      ? data.deliveryStatus
      : "Pending";

  return {
    id,
    customerUid: String(data.customerUid ?? ""),
    createdAt: timestampToIso(data.createdAt) ?? "",
    status,
    deliveryStatus,
    preferredDeliveryDate: String(data.preferredDeliveryDate ?? ""),
    confirmedDeliveryDate: String(data.confirmedDeliveryDate ?? ""),
    paymentMethod: "COD",
    items: Array.isArray(data.items) ? (data.items as CartItem[]) : [],
    total: Number(data.total ?? 0),
    updatedAt: timestampToIso(data.updatedAt),
    decisionAt: timestampToIso(data.decisionAt),
    scheduledAt: timestampToIso(data.scheduledAt),
    preparingAt: timestampToIso(data.preparingAt),
    dispatchedAt: timestampToIso(data.dispatchedAt),
    deliveredAt: timestampToIso(data.deliveredAt),
  };
}

// =====================================
// READ CUSTOMER ORDERS
// =====================================

export async function readDemoOrders(uid: string): Promise<DemoOrder[]> {
  if (!uid || auth.currentUser?.uid !== uid) return [];

  const snapshot = await getDocs(
    query(collection(db, "orders"), where("customerUid", "==", uid))
  );

  const firestoreOrders = snapshot.docs.map(entry =>
    normalize(entry.id, entry.data())
  );

  // Preserve older device-only demo orders. They remain visible to the
  // customer, but not to Admin/Staff.
  let legacy: DemoOrder[] = [];

  try {
    const raw = await AsyncStorage.getItem(keyFor(uid));
    const parsed: unknown = raw ? JSON.parse(raw) : [];

    if (Array.isArray(parsed)) {
      legacy = parsed
        .filter(
          (item): item is DemoOrder =>
            item !== null &&
            typeof item === "object" &&
            typeof item.id === "string" &&
            Array.isArray(item.items)
        )
        .map(item => ({
          ...item,
          customerUid: uid,
          createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
          status:
            item.status === "Confirmed" || item.status === "Rejected"
              ? item.status
              : "Pending",
          deliveryStatus: "Pending" as const,
          preferredDeliveryDate: "",
          confirmedDeliveryDate: "",
          paymentMethod: "COD" as const,
          total: Number(item.total ?? 0),
        }));
    }
  } catch {
    // Invalid legacy data does not prevent reading current Firestore orders.
  }

  const firestoreIds = new Set(firestoreOrders.map(order => order.id));
  const uniqueLegacy = legacy.filter(order => !firestoreIds.has(order.id));

  return [...firestoreOrders, ...uniqueLegacy].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
}

// =====================================
// VALIDATE CART ITEMS
// =====================================

function validCartItem(item: CartItem): boolean {
  return (
    typeof item.productId === "string" &&
    item.productId.trim().length > 0 &&
    typeof item.name === "string" &&
    item.name.trim().length > 0 &&
    Number.isSafeInteger(item.quantity) &&
    item.quantity >= 1 &&
    Number.isFinite(item.price) &&
    item.price >= 0 &&
    Number.isFinite(item.maxQuantity) &&
    item.maxQuantity >= item.quantity
  );
}

// =====================================
// CREATE CUSTOMER ORDER
// =====================================

export async function createDemoOrder(
  uid: string,
  items: CartItem[],
  preferredDeliveryDate: string
): Promise<DemoOrder> {
  if (!uid || auth.currentUser?.uid !== uid) {
    throw new Error("Please sign in before placing an order.");
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Your bag is empty.");
  }

  if (items.length > 30) {
    throw new Error("An order cannot contain more than 30 product entries.");
  }

  if (!validDate(preferredDeliveryDate) || preferredDeliveryDate <= localToday()) {
    throw new Error("Please choose a future preferred delivery date.");
  }

  if (items.some(item => !validCartItem(item))) {
    throw new Error("Your bag contains an invalid product, price, or quantity.");
  }

  // Do not duplicate Base64 product photos inside an order document.
  const orderItems: CartItem[] = items.map(item => {
    const { imageUrl: _imageUrl, ...details } = item;
    return { ...details, imageUrl: "" };
  });

  const rawTotal = orderItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  const total = Math.round((rawTotal + Number.EPSILON) * 100) / 100;

  if (!Number.isFinite(total) || total < 0 || total > 1000000000) {
    throw new Error("The order total is invalid.");
  }

  const reference = doc(collection(db, "orders"));
  const createdAt = new Date().toISOString();

  const order: DemoOrder = {
    id: reference.id,
    customerUid: uid,
    createdAt,
    status: "Pending",
    deliveryStatus: "Pending",
    preferredDeliveryDate,
    confirmedDeliveryDate: "",
    paymentMethod: "COD",
    items: orderItems,
    total,
  };

  // Keep the create payload unchanged to satisfy existing Firestore rules.
  await setDoc(reference, {
    ...order,
    createdAt: serverTimestamp(),
  });

  return order;
}
