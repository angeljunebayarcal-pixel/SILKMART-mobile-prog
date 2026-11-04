
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  type Timestamp,
  type Unsubscribe,
} from "firebase/firestore";

import { auth, db } from "../firebase/config";

// =====================================
// TYPES
// =====================================

export type ChatSenderRole = "customer" | "staff";

export type OrderChatMessage = {
  id: string;
  orderId: string;
  senderUid: string;
  senderRole: ChatSenderRole;
  text: string;
  createdAt: Timestamp | null;
};

export type OrderChatErrorHandler = (
  error: Error
) => void;

export type OrderChatUpdateHandler = (
  messages: OrderChatMessage[]
) => void;

// =====================================
// CONSTANTS
// =====================================

export const MAX_CHAT_MESSAGE_LENGTH = 1000;

const STAFF_ROLES = [
  "administrator",
  "admin",
  "staff",
];

// =====================================
// ERROR HELPERS
// =====================================

function errorMessage(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error
  ) {
    const code = String(error.code);

    if (code === "permission-denied") {
      return "You do not have permission to perform this action. Check your account and Firestore Security Rules.";
    }

    if (code === "unavailable") {
      return "Unable to connect to Firestore. Check your internet connection.";
    }

    if (code === "unauthenticated") {
      return "Your session has expired. Please sign in again.";
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "An unexpected chat error occurred.";
}

// =====================================
// AUTHENTICATION
// =====================================

function requireSignedInUser(): string {
  const uid = auth.currentUser?.uid;

  if (!uid) {
    throw new Error(
      "Please sign in to access order conversations."
    );
  }

  return uid;
}

function validateOrderId(orderId: string): string {
  const value = orderId.trim();

  if (
    !value ||
    value.includes("/") ||
    value === "." ||
    value === ".."
  ) {
    throw new Error(
      "Please select a valid order."
    );
  }

  return value;
}

function validateMessageId(messageId: string): string {
  const value = messageId.trim();

  if (
    !value ||
    value.includes("/") ||
    value === "." ||
    value === ".."
  ) {
    throw new Error(
      "Please select a valid message."
    );
  }

  return value;
}

function sessionUnchanged(uid: string): void {
  if (auth.currentUser?.uid !== uid) {
    throw new Error(
      "Your session changed. Please sign in again."
    );
  }
}

// =====================================
// CHECK ORDER CHAT ROLE
// =====================================

export async function getOrderChatRole(
  orderId: string
): Promise<ChatSenderRole> {
  const uid = requireSignedInUser();
  const validOrderId = validateOrderId(orderId);

  const userSnapshot = await getDoc(
    doc(db, "users", uid)
  );

  sessionUnchanged(uid);

  if (!userSnapshot.exists()) {
    throw new Error(
      "Your account profile could not be found."
    );
  }

  const role = String(
    userSnapshot.data().role ?? ""
  ).toLowerCase();

  const isStaff = STAFF_ROLES.includes(role);

  if (!isStaff && role !== "customer") {
    throw new Error(
      "Your account cannot access order conversations."
    );
  }

  const orderSnapshot = await getDoc(
    doc(db, "orders", validOrderId)
  );

  sessionUnchanged(uid);

  if (!orderSnapshot.exists()) {
    throw new Error(
      "This order could not be found."
    );
  }

  if (isStaff) {
    return "staff";
  }

  const customerUid = String(
    orderSnapshot.data().customerUid ?? ""
  );

  if (customerUid !== uid) {
    throw new Error(
      "You cannot access another customer's order."
    );
  }

  return "customer";
}

// =====================================
// REAL-TIME ORDER MESSAGES
// =====================================

export function subscribeToOrderChat(
  orderId: string,
  onUpdate: OrderChatUpdateHandler,
  onError?: OrderChatErrorHandler
): Unsubscribe {
  const currentUid = auth.currentUser?.uid;

  if (!currentUid) {
    onError?.(
      new Error(
        "Please sign in to view order messages."
      )
    );

    return () => {};
  }

  const subscriberUid: string = currentUid;

  let validOrderId: string;

  try {
    validOrderId = validateOrderId(orderId);
  } catch (error) {
    onError?.(
      new Error(errorMessage(error))
    );

    return () => {};
  }

  let active = true;

  let unsubscribeSnapshot: Unsubscribe | null =
    null;

  async function startSubscription() {
    try {
      await getOrderChatRole(validOrderId);

      if (!active) {
        return;
      }

      sessionUnchanged(subscriberUid);

      const messagesQuery = query(
        collection(
          db,
          "orders",
          validOrderId,
          "messages"
        ),
        orderBy("createdAt", "asc")
      );

      const unsubscribe = onSnapshot(
        messagesQuery,
        snapshot => {
          if (
            !active ||
            auth.currentUser?.uid !== subscriberUid
          ) {
            return;
          }

          const messages: OrderChatMessage[] =
            snapshot.docs.map(entry => {
              const data = entry.data();

              return {
                id: entry.id,
                orderId: validOrderId,
                senderUid: String(
                  data.senderUid ?? ""
                ),
                senderRole:
                  data.senderRole === "staff"
                    ? "staff"
                    : "customer",
                text: String(
                  data.text ?? ""
                ),
                createdAt:
                  data.createdAt &&
                  typeof data.createdAt.toDate ===
                    "function"
                    ? (data.createdAt as Timestamp)
                    : null,
              };
            });

          onUpdate(messages);
        },
        error => {
          if (!active) {
            return;
          }

          onError?.(
            new Error(errorMessage(error))
          );
        }
      );

      if (!active) {
        unsubscribe();
        return;
      }

      unsubscribeSnapshot = unsubscribe;
    } catch (error) {
      if (!active) {
        return;
      }

      onError?.(
        new Error(errorMessage(error))
      );
    }
  }

  void startSubscription();

  return () => {
    active = false;

    if (unsubscribeSnapshot) {
      unsubscribeSnapshot();
      unsubscribeSnapshot = null;
    }
  };
}

// =====================================
// SEND ORDER CHAT MESSAGE
// =====================================

export async function sendOrderChatMessage(
  orderId: string,
  message: string
): Promise<void> {
  const uid = requireSignedInUser();

  const validOrderId = validateOrderId(orderId);
  const text = message.trim();

  if (!text) {
    throw new Error(
      "Please enter a message."
    );
  }

  if (text.length > MAX_CHAT_MESSAGE_LENGTH) {
    throw new Error(
      `Messages must contain no more than ${MAX_CHAT_MESSAGE_LENGTH} characters.`
    );
  }

  let senderRole: ChatSenderRole;

  try {
    senderRole = await getOrderChatRole(
      validOrderId
    );
  } catch (error) {
    throw new Error(errorMessage(error));
  }

  sessionUnchanged(uid);

  try {
    await addDoc(
      collection(
        db,
        "orders",
        validOrderId,
        "messages"
      ),
      {
        orderId: validOrderId,
        senderUid: uid,
        senderRole,
        text,
        createdAt: serverTimestamp(),
      }
    );
  } catch (error) {
    throw new Error(errorMessage(error));
  }
}

// =====================================
// PERMANENTLY DELETE ONE CHAT MESSAGE
// =====================================

export async function deleteOrderChatMessage(
  orderId: string,
  messageId: string
): Promise<void> {
  const uid = requireSignedInUser();

  const validOrderId = validateOrderId(orderId);
  const validMessageId = validateMessageId(messageId);

  try {
    await getOrderChatRole(validOrderId);

    sessionUnchanged(uid);

    const messageRef = doc(
      db,
      "orders",
      validOrderId,
      "messages",
      validMessageId
    );

    const snapshot = await getDoc(messageRef);

    sessionUnchanged(uid);

    if (!snapshot.exists()) {
      throw new Error(
        "This message has already been deleted."
      );
    }

    const senderUid = String(
      snapshot.data().senderUid ?? ""
    );

    if (senderUid !== uid) {
      throw new Error(
        "You can only delete messages you sent."
      );
    }

    await deleteDoc(messageRef);

    sessionUnchanged(uid);
  } catch (error) {
    throw new Error(errorMessage(error));
  }
}

// =====================================
// FORMAT MESSAGE TIME
// =====================================

export function formatOrderChatTime(
  timestamp: Timestamp | null
): string {
  if (!timestamp) {
    return "Sending...";
  }

  try {
    return timestamp
      .toDate()
      .toLocaleTimeString("en-PH", {
        hour: "numeric",
        minute: "2-digit",
      });
  } catch {
    return "Recently";
  }
}
