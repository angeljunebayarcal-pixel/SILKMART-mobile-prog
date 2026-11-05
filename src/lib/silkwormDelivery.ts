
import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";

import {
  auth,
  db,
} from "../firebase/config";

// =====================================
// TYPES
// =====================================

type OrderItem = {
  productId?: unknown;
  quantity?: unknown;
  color?: unknown;
};

type PurchasedProduct = {
  productId: string;
  quantity: number;
  colorQuantities: Map<string, number>;
};

type ColorStock = {
  name: string;
  quantity: number;
};

type ProductStockUpdate = {
  productId: string;
  productName: string;
  quantityDeducted: number;
  nextStock: number;
  nextColorStocks: ColorStock[];
  nextPublished: boolean;
};

type SpeciesStockUpdate = {
  speciesId: string;
  speciesName: string;
  quantityDeducted: number;
  nextQuantity: number;
};

export type DeliveryStockResult = {
  orderId: string;
  productsUpdated: number;
  silkwormSpeciesUpdated: number;
  totalProductsDeducted: number;
  totalSilkwormsDeducted: number;
};

// =====================================
// VALIDATION HELPERS
// =====================================

function validQuantity(
  value: unknown,
  label: string
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new Error(
      `Invalid quantity for ${label}.`
    );
  }

  return value;
}

function validStock(
  value: unknown,
  label: string
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new Error(
      `Invalid available stock for ${label}.`
    );
  }

  return value;
}

function validProductId(
  value: unknown
): string {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    throw new Error(
      "An ordered product has no valid product ID."
    );
  }

  return value.trim();
}

function safeAddition(
  current: number,
  amount: number
): number {
  const result = current + amount;

  if (!Number.isSafeInteger(result)) {
    throw new Error(
      "The combined quantity exceeds the supported limit."
    );
  }

  return result;
}

function readColorStocks(
  value: unknown,
  productName: string
): ColorStock[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `Invalid color stock records for ${productName}.`
    );
  }

  return value.map(item => {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.name !== "string" ||
      !item.name.trim()
    ) {
      throw new Error(
        `Invalid color information for ${productName}.`
      );
    }

    return {
      name: item.name,
      quantity: validStock(
        item.quantity,
        `${productName} (${item.name})`
      ),
    };
  });
}

// =====================================
// COMPLETE DELIVERY AND DEDUCT STOCK
// =====================================

export async function completeSilkwormDelivery(
  orderId: string
): Promise<DeliveryStockResult> {
  const user = auth.currentUser;

  if (!user) {
    throw new Error(
      "Please sign in as an authorized Admin or Staff account."
    );
  }

  if (!orderId.trim()) {
    throw new Error(
      "A valid order ID is required."
    );
  }

  const uid = user.uid;

  const orderReference = doc(
    db,
    "orders",
    orderId
  );

  return runTransaction(
    db,
    async transaction => {
      // =====================================
      // 1. READ AND VERIFY ORDER
      // =====================================

      const orderSnapshot =
        await transaction.get(
          orderReference
        );

      if (!orderSnapshot.exists()) {
        throw new Error(
          "This order no longer exists."
        );
      }

      const order = orderSnapshot.data();

      if (order.status !== "Confirmed") {
        throw new Error(
          "Only confirmed orders can be delivered."
        );
      }

      if (
        order.deliveryStatus === "Delivered"
      ) {
        throw new Error(
          "This order was already delivered. Stock was not deducted again."
        );
      }

      if (
        order.deliveryStatus !== "Out for Delivery"
      ) {
        throw new Error(
          "Complete the required delivery stages before marking this order Delivered."
        );
      }

      if (
        typeof order.confirmedDeliveryDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(
          order.confirmedDeliveryDate
        )
      ) {
        throw new Error(
          "A valid confirmed delivery date is required."
        );
      }

      if (
        !Array.isArray(order.items) ||
        order.items.length === 0
      ) {
        throw new Error(
          "This order does not contain valid products."
        );
      }

      // =====================================
      // 2. GROUP PURCHASED PRODUCTS
      // =====================================

      const purchased =
        new Map<
          string,
          PurchasedProduct
        >();

      for (
        const item of order.items as OrderItem[]
      ) {
        const productId =
          validProductId(
            item.productId
          );

        const quantity =
          validQuantity(
            item.quantity,
            productId
          );

        const color =
          typeof item.color === "string"
            ? item.color.trim()
            : "";

        let entry =
          purchased.get(productId);

        if (!entry) {
          entry = {
            productId,
            quantity: 0,
            colorQuantities:
              new Map<string, number>(),
          };

          purchased.set(
            productId,
            entry
          );
        }

        entry.quantity = safeAddition(
          entry.quantity,
          quantity
        );

        entry.colorQuantities.set(
          color,
          safeAddition(
            entry.colorQuantities.get(color) ??
              0,
            quantity
          )
        );
      }

      // =====================================
      // 3. READ PRODUCT STOCK DOCUMENTS
      // =====================================

      const purchasedEntries =
        Array.from(
          purchased.values()
        );

      const productReferences =
        purchasedEntries.map(
          item =>
            doc(
              db,
              "products",
              item.productId
            )
        );

      const productSnapshots =
        await Promise.all(
          productReferences.map(
            reference =>
              transaction.get(reference)
          )
        );

      // =====================================
      // 4. VERIFY PRODUCTS AND COLORS
      // =====================================

      const productUpdates:
        ProductStockUpdate[] = [];

      const speciesQuantities =
        new Map<string, number>();

      const speciesForProduct =
        new Map<string, string>();

      for (
        let index = 0;
        index < purchasedEntries.length;
        index++
      ) {
        const purchasedItem =
          purchasedEntries[index];

        const productSnapshot =
          productSnapshots[index];

        if (!productSnapshot.exists()) {
          throw new Error(
            `Product ${purchasedItem.productId} no longer exists. Delivery cannot be completed.`
          );
        }

        const product =
          productSnapshot.data();

        const productName =
          typeof product.name === "string"
            ? product.name
            : purchasedItem.productId;

        const currentStock =
          validStock(
            product.stock,
            productName
          );

        const isSilkworm =
          product.category ===
          "Silkworms";

        const colorStocks =
          readColorStocks(
            product.colorStocks,
            productName
          );

        // =====================================
        // COLOR-SPECIFIC PRODUCTS
        // =====================================

        let nextColorStocks =
          colorStocks.map(item => ({
            ...item,
          }));

        if (colorStocks.length > 0) {
          for (
            const [
              colorName,
              requestedQuantity,
            ] of purchasedItem.colorQuantities
          ) {
            if (!colorName) {
              throw new Error(
                `${productName} requires a selected color.`
              );
            }

            const colorIndex =
              nextColorStocks.findIndex(
                color =>
                  color.name ===
                  colorName
              );

            if (colorIndex === -1) {
              throw new Error(
                `Color "${colorName}" is no longer available for ${productName}.`
              );
            }

            const available =
              nextColorStocks[
                colorIndex
              ].quantity;

            if (
              available <
              requestedQuantity
            ) {
              throw new Error(
                `Insufficient ${colorName} stock for ${productName}. Available: ${available}, required: ${requestedQuantity}.`
              );
            }

            nextColorStocks[
              colorIndex
            ].quantity -=
              requestedQuantity;
          }
        }

        // =====================================
        // SILKWORM INVENTORY LINK
        // =====================================

        if (isSilkworm) {
          const speciesId =
            typeof product.inventorySpeciesId ===
            "string"
              ? product.inventorySpeciesId.trim()
              : "";

          if (!speciesId) {
            throw new Error(
              `${productName} is not linked to Silkworm Inventory. Link the product before completing delivery.`
            );
          }

          const existing =
            speciesQuantities.get(
              speciesId
            ) ?? 0;

          speciesQuantities.set(
            speciesId,
            safeAddition(
              existing,
              purchasedItem.quantity
            )
          );

          speciesForProduct.set(
            purchasedItem.productId,
            speciesId
          );
        } else {
          // =====================================
          // NORMAL PRODUCT STOCK CHECK
          // =====================================

          if (
            currentStock <
            purchasedItem.quantity
          ) {
            throw new Error(
              `Insufficient stock for ${productName}. Available: ${currentStock}, required: ${purchasedItem.quantity}.`
            );
          }
        }

        productUpdates.push({
          productId:
            purchasedItem.productId,

          productName,

          quantityDeducted:
            purchasedItem.quantity,

          // Silkworm listings will be
          // synchronized with their
          // inventory quantity below.
          nextStock: isSilkworm
            ? currentStock
            : currentStock -
              purchasedItem.quantity,

          nextColorStocks,

          nextPublished:
            product.published === true,
        });
      }

      // =====================================
      // 5. READ SILKWORM INVENTORY
      // =====================================

      const speciesEntries =
        Array.from(
          speciesQuantities.entries()
        );

      const speciesReferences =
        speciesEntries.map(
          ([speciesId]) =>
            doc(
              db,
              "inventory_species",
              speciesId
            )
        );

      const speciesSnapshots =
        await Promise.all(
          speciesReferences.map(
            reference =>
              transaction.get(reference)
          )
        );

      const speciesUpdates:
        SpeciesStockUpdate[] = [];

      const nextSpeciesStock =
        new Map<string, number>();

      for (
        let index = 0;
        index < speciesEntries.length;
        index++
      ) {
        const [
          speciesId,
          quantity,
        ] = speciesEntries[index];

        const snapshot =
          speciesSnapshots[index];

        if (!snapshot.exists()) {
          throw new Error(
            `The linked silkworm inventory record ${speciesId} no longer exists.`
          );
        }

        const species =
          snapshot.data();

        const speciesName =
          typeof species.name === "string"
            ? species.name
            : speciesId;

        const available =
          validStock(
            species.quantity,
            speciesName
          );

        if (available < quantity) {
          throw new Error(
            `Insufficient silkworm inventory for ${speciesName}. Available: ${available}, required: ${quantity}.`
          );
        }

        const remaining =
          available - quantity;

        speciesUpdates.push({
          speciesId,
          speciesName,
          quantityDeducted:
            quantity,
          nextQuantity:
            remaining,
        });

        nextSpeciesStock.set(
          speciesId,
          remaining
        );
      }

      // =====================================
      // 6. SYNCHRONIZE SILKWORM PRODUCT STOCK
      // =====================================

      for (const update of productUpdates) {
        const speciesId =
          speciesForProduct.get(
            update.productId
          );

        if (speciesId) {
          const remaining =
            nextSpeciesStock.get(
              speciesId
            );

          if (
            remaining === undefined
          ) {
            throw new Error(
              "Unable to verify linked silkworm stock."
            );
          }

          update.nextStock =
            remaining;
        }

        // Existing product rules require
        // stock > 0 for published listings.
        // Automatically unpublish at zero.
        if (
          update.nextStock === 0
        ) {
          update.nextPublished =
            false;
        }
      }

      // =====================================
      // 7. UPDATE PRODUCT STOCK
      // =====================================

      for (const update of productUpdates) {
        const productReference =
          doc(
            db,
            "products",
            update.productId
          );

        transaction.update(
          productReference,
          {
            stock:
              update.nextStock,

            colorStocks:
              update.nextColorStocks,

            published:
              update.nextPublished,

            updatedAt:
              serverTimestamp(),
          }
        );
      }

      // =====================================
      // 8. UPDATE SILKWORM INVENTORY
      // =====================================

      for (const update of speciesUpdates) {
        const speciesReference =
          doc(
            db,
            "inventory_species",
            update.speciesId
          );

        transaction.update(
          speciesReference,
          {
            quantity:
              update.nextQuantity,

            updatedAt:
              serverTimestamp(),

            updatedBy: uid,
          }
        );
      }

      // =====================================
      // 9. RECORD SILKWORM DEDUCTIONS
      // =====================================

      for (const update of speciesUpdates) {
        const activityReference =
          doc(
            collection(
              db,
              "inventory_activity"
            )
          );

        transaction.set(
          activityReference,
          {
            message:
              "Silkworm stock deducted",

            detail:
              `${update.speciesName}: -${update.quantityDeducted} worms (Delivered order ${orderId})`
                .slice(0, 1000),

            type: "stock",

            actorUid: uid,

            createdAt:
              serverTimestamp(),
          }
        );
      }

      // =====================================
      // 10. MARK ORDER AS DELIVERED
      // =====================================

      transaction.update(
        orderReference,
        {
          deliveryStatus:
            "Delivered",

          deliveredAt:
            serverTimestamp(),

          updatedAt:
            serverTimestamp(),
        }
      );

      // =====================================
      // 11. RESULT
      // =====================================

      const totalProductsDeducted =
        productUpdates.reduce(
          (total, item) =>
            total +
            item.quantityDeducted,
          0
        );

      const totalSilkwormsDeducted =
        speciesUpdates.reduce(
          (total, item) =>
            total +
            item.quantityDeducted,
          0
        );

      return {
        orderId,

        productsUpdated:
          productUpdates.length,

        silkwormSpeciesUpdated:
          speciesUpdates.length,

        totalProductsDeducted,

        totalSilkwormsDeducted,
      };
    }
  );
}
