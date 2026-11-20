import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
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
import { onAuthStateChanged, type User } from "firebase/auth";

import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  writeBatch,
  type DocumentData,
  type DocumentReference,
} from "firebase/firestore";

import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";

import { auth, db } from "../../firebase/config";

import {
  C,
  Fade,
  Heading,
  S,
  Search,
  Stat,
  Status,
} from "../../components/AdminUI";

// =====================================
// TYPES
// =====================================

type Species = {
  id: string;
  name: string;
  scientificName: string;
  stage: string;
  condition: string;
  quantity: number;
  threshold: number;
  imageUrl: string;
};

type Cocoons = {
  good: number;
  minor: number;
  unusable: number;
  reserved: number;
  imageUrl: string;
};

type CocoonRegion = Cocoons & {
  id: string;
  name: string;
};

type Activity = {
  id: string;
  message: string;
  detail: string;
  type: string;
  createdAt?: {
    toMillis?: () => number;
  };
};

type Tab = "Silkworms" | "Cocoons";

type Editor =
  | "species"
  | "stock"
  | "cocoons"
  | "reserved"
  | null;

type Notice = {
  title: string;
  message: string;
};

// =====================================
// CONSTANTS
// =====================================

const STAGES = [
  "Egg",
  "1st Instar",
  "2nd Instar",
  "3rd Instar",
  "4th Instar",
  "5th Instar",
  "Mature",
  "Pupa",
  "Moth",
];

const CONDITIONS = [
  "Healthy",
  "Good",
  "Monitoring",
  "Quarantined",
];

const COCOON_LOW_STOCK_THRESHOLD = 100;
const UNASSIGNED_COCOON_REGION_ID = "unassigned";
const COCOON_STOCK_FIELDS = ["good", "minor", "unusable", "reserved"] as const;

const blankSpecies = (): Species => ({
  id: "",
  name: "",
  scientificName: "",
  stage: "Egg",
  condition: "Healthy",
  quantity: 0,
  threshold: 10,
  imageUrl: "",
});

// =====================================
// HELPERS
// =====================================

const asNumber = (value: unknown) =>
  Number.isFinite(Number(value)) ? Number(value) : 0;

function readCocoonStock(data: Record<string, unknown> = {}): Cocoons {
  return {
    good: asNumber(data.good),
    minor: asNumber(data.minor),
    unusable: asNumber(data.unusable),
    reserved: asNumber(data.reserved),
    imageUrl: String(data.imageUrl ?? ""),
  };
}

const positiveInteger = (value: string) =>
  value.trim() !== "" &&
  /^\d+$/.test(value) &&
  Number.isSafeInteger(Number(value));

const signedInteger = (value: string) =>
  /^[+-]?\d+$/.test(value.trim()) &&
  Number.isSafeInteger(Number(value));

const fmt = (value: number) =>
  value.toLocaleString("en-PH");

function formatError(error: unknown) {
  const code =
    typeof error === "object" &&
    error &&
    "code" in error
      ? String(error.code)
      : "";

  if (code.includes("permission-denied")) {
    return "Firestore denied this action. Check Admin/Staff access and inventory security rules.";
  }

  return error instanceof Error
    ? error.message
    : "Unable to complete the action. Check your connection.";
}

// =====================================
// FORM COMPONENTS
// =====================================

function Field({
  label,
  value,
  onChangeText,
  numeric = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  numeric?: boolean;
  placeholder?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {label}
      </Text>

      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={
          numeric
            ? "numbers-and-punctuation"
            : "default"
        }
        autoCapitalize={
          numeric ? "none" : "sentences"
        }
        style={styles.fieldInput}
        placeholderTextColor="#82988B"
      />
    </View>
  );
}

function SelectChips({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {label}
      </Text>

      <View style={styles.chips}>
        {options.map(option => (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            style={[
              styles.chip,
              option === value &&
                styles.chipSelected,
            ]}
          >
            <Text
              style={[
                styles.chipLabel,
                option === value &&
                  styles.chipSelectedLabel,
              ]}
            >
              {option}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// =====================================
// MAIN INVENTORY SCREEN
// =====================================

export default function Inventory() {
  const [user, setUser] = useState<User | null>(
    auth.currentUser
  );

  const [tab, setTab] = useState<Tab>(
    "Silkworms"
  );

  const [species, setSpecies] = useState<
    Species[]
  >([]);

  const [activities, setActivities] = useState<
    Activity[]
  >([]);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  const [editor, setEditor] = useState<Editor>(
    null
  );

  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState<Species>(
    blankSpecies()
  );

  // Silkworm fields

  const [quantityText, setQuantityText] =
    useState("0");

  const [thresholdText, setThresholdText] =
    useState("10");

  const [stockChange, setStockChange] =
    useState("0");

  // Cocoon fields

  const [cocoonRegions, setCocoonRegions] = useState<CocoonRegion[]>([]);
  const [cocoonRegionsReady, setCocoonRegionsReady] = useState(false);
  const [cocoonRegionsError, setCocoonRegionsError] = useState("");
  const [selectedCocoonRegionId, setSelectedCocoonRegionId] =
    useState<string | null>(null);
  const [editedCocoonRegion, setEditedCocoonRegion] =
    useState<CocoonRegion | null>(null);
  const [cocoonRegionName, setCocoonRegionName] = useState("");

  const [goodChange, setGoodChange] =
    useState("0");

  const [minorChange, setMinorChange] =
    useState("0");

  const [unusableChange, setUnusableChange] =
    useState("0");

  const [showAllActivity, setShowAllActivity] =
    useState(false);

  const [reservedText, setReservedText] =
    useState("0");

  const [cocoonImage, setCocoonImage] =
    useState("");

  // Loading states

  const [saving, setSaving] = useState(false);

  const [processingImage, setProcessingImage] =
    useState(false);

  const busy = saving || processingImage;

  // Compact error popup

  const [notice, setNotice] = useState<
    Notice | null
  >(null);

  function notify(title: string, message: string) {
    setNotice({ title, message });
  }

  // =====================================
  // ACTIVITY DELETE STATE
  // =====================================

  const [
    activityToDelete,
    setActivityToDelete,
  ] = useState<Activity | null>(null);

  const [
    deletingActivity,
    setDeletingActivity,
  ] = useState(false);

  // =====================================
  // AUTHENTICATION
  // =====================================

  useEffect(() => {
    return onAuthStateChanged(auth, setUser);
  }, []);

  // =====================================
  // FIRESTORE REAL-TIME LISTENERS
  // =====================================

  useEffect(() => {
    setSpecies([]);
    setCocoonRegions([]);
    setCocoonRegionsReady(false);
    setCocoonRegionsError("");
    setSelectedCocoonRegionId(null);
    setEditedCocoonRegion(null);
    setEditor(current =>
      current === "cocoons" || current === "reserved" ? null : current
    );
    setActivities([]);
    setError("");
    setReady(false);

    if (!user) {
      setReady(true);
      return;
    }

    let firstSpecies = false;
    let firstCocoonRegions = false;

    const handleError = (reason: unknown) => {
      setError(formatError(reason));
      setReady(true);
    };

    const subSpecies = onSnapshot(
      collection(db, "inventory_species"),
      snapshot => {
        const items: Species[] =
          snapshot.docs.map(item => {
            const data = item.data();

            return {
              id: item.id,
              name: String(data.name ?? ""),
              scientificName: String(
                data.scientificName ?? ""
              ),
              stage: String(data.stage ?? "Egg"),
              condition: String(
                data.condition ?? "Healthy"
              ),
              quantity: asNumber(data.quantity),
              threshold: asNumber(
                data.threshold ?? 10
              ),
              imageUrl: String(
                data.imageUrl ?? ""
              ),
            };
          });

        setSpecies(
          items.sort((a, b) =>
            a.name.localeCompare(b.name)
          )
        );

        firstSpecies = true;

        if (firstCocoonRegions) {
          setReady(true);
        }
      },
      handleError
    );

    const subCocoonRegions = onSnapshot(
      collection(db, "cocoon_regions"),
      snapshot => {
        setCocoonRegions(
          snapshot.docs
            .filter(item => item.id !== UNASSIGNED_COCOON_REGION_ID)
            .map(item => {
              const data = item.data();
              return {
                ...readCocoonStock(data),
                id: item.id,
                name: String(data.name ?? ""),
              };
            }).sort((a, b) => a.name.localeCompare(b.name))
        );
        setCocoonRegionsReady(true);
        setCocoonRegionsError("");

        firstCocoonRegions = true;

        if (firstSpecies) {
          setReady(true);
        }
      },
      reason => {
        setCocoonRegionsReady(false);
        setCocoonRegionsError(formatError(reason));

        firstCocoonRegions = true;

        if (firstSpecies) {
          setReady(true);
        }
      }
    );

    // Recent inventory activity

    const subActivity = onSnapshot(
      collection(db, "inventory_activity"),
      snapshot => {
        const items: Activity[] =
          snapshot.docs.map(item => ({
            id: item.id,
            message: String(
              item.data().message ?? ""
            ),
            detail: String(
              item.data().detail ?? ""
            ),
            type: String(
              item.data().type ?? "edit"
            ),
            createdAt: item.data().createdAt,
          }));

        items.sort(
          (a, b) =>
            (b.createdAt?.toMillis?.() ?? 0) -
            (a.createdAt?.toMillis?.() ?? 0)
        );

        setActivities(items);
      },
      handleError
    );

    return () => {
      subSpecies();
      subCocoonRegions();
      subActivity();
    };
  }, [user?.uid]);

  // =====================================
  // FILTERS AND STATISTICS
  // =====================================

  const filtered = useMemo(
    () =>
      species.filter(item =>
        [
          item.name,
          item.scientificName,
          item.stage,
          item.condition,
        ]
          .join(" ")
          .toLowerCase()
          .includes(
            query.trim().toLowerCase()
          )
      ),
    [query, species]
  );

  const totalWorms = species.reduce(
    (sum, item) =>
      sum + item.quantity,
    0
  );

  const lowStock = species.filter(
    item =>
      item.quantity <= item.threshold
  );

  const cocoonTotals = cocoonRegions.reduce(
    (total, region) => ({
      good: total.good + region.good,
      minor: total.minor + region.minor,
      unusable: total.unusable + region.unusable,
      reserved: total.reserved + region.reserved,
    }),
    { good: 0, minor: 0, unusable: 0, reserved: 0 }
  );

  const selectedCocoonRegion = cocoonRegions.find(
    region => region.id === selectedCocoonRegionId
  );

  const lowCocoonRegions = cocoonRegions.filter(
    region => region.good - region.reserved <= COCOON_LOW_STOCK_THRESHOLD
  );

  const lowStockAlertCount =
    lowStock.length + lowCocoonRegions.length;

  // =====================================
  // OPEN EDITORS
  // =====================================

  function editSpecies(item?: Species) {
    const value = item ?? blankSpecies();

    setForm({ ...value });
    setSelectedId(item?.id ?? "");
    setQuantityText(String(value.quantity));
    setThresholdText(String(value.threshold));
    setEditor("species");
  }

  function editStock(item: Species) {
    setForm({ ...item });
    setStockChange("0");
    setEditor("stock");
  }

  function addCocoonRegion() {
    setEditedCocoonRegion(null);
    setCocoonRegionName("");
    setGoodChange("0");
    setMinorChange("0");
    setUnusableChange("0");
    setCocoonImage("");
    setEditor("cocoons");
  }

  function editReserved(region: CocoonRegion) {
    setEditedCocoonRegion(region);
    setReservedText(String(region.reserved));
    setEditor("reserved");
  }

  // =====================================
  // IMAGE PICKER
  // =====================================

  async function pickImage(
    kind: "species" | "cocoons"
  ) {
    if (busy) return;

    try {
      const picked =
        await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsEditing: false,
          quality: 1,
        });

      if (
        picked.canceled ||
        !picked.assets.length
      ) {
        return;
      }

      const asset = picked.assets[0];

      if (
        (asset.fileSize ?? 0) >
        5 * 1024 * 1024
      ) {
        throw new Error(
          "Choose an image below 5 MB."
        );
      }

      setProcessingImage(true);

      const resized =
        await ImageManipulator.manipulateAsync(
          asset.uri,
          [
            {
              resize: {
                width: Math.min(
                  asset.width || 700,
                  700
                ),
              },
            },
          ],
          {
            compress: 0.55,
            format:
              ImageManipulator.SaveFormat.JPEG,
            base64: true,
          }
        );

      const imageData =
        `data:image/jpeg;base64,${resized.base64 ?? ""}`;

      if (
        !resized.base64 ||
        imageData.length > 180000
      ) {
        throw new Error(
          "Image is too large after compression. Try a smaller image."
        );
      }

      if (kind === "species") {
        setForm(current => ({
          ...current,
          imageUrl: imageData,
        }));
      } else {
        setCocoonImage(imageData);
      }
    } catch (reason) {
      notify(
        "Image",
        formatError(reason)
      );
    } finally {
      setProcessingImage(false);
    }
  }

  // =====================================
  // INVENTORY ACTIVITY LOG
  // =====================================

  function activityBatch(
    batch: {
      set(reference: DocumentReference, data: DocumentData): void;
    },
    message: string,
    detail: string,
    type: string
  ) {
    batch.set(
      doc(
        collection(db, "inventory_activity")
      ),
      {
        message,
        detail,
        type,
        actorUid: user?.uid,
        createdAt: serverTimestamp(),
      }
    );
  }

  // =====================================
  // DELETE SELECTED ACTIVITY ONLY
  // =====================================

  function confirmActivityDelete(
    item: Activity
  ) {
    if (!user || deletingActivity) return;

    setActivityToDelete(item);
  }

  async function deleteSelectedActivity() {
    if (
      !user ||
      !activityToDelete ||
      deletingActivity
    ) {
      return;
    }

    const selected = activityToDelete;

    setDeletingActivity(true);

    try {
      // Delete only this inventory activity document.
      // No inventory quantities, species or cocoon
      // records are modified.

      await deleteDoc(
        doc(
          db,
          "inventory_activity",
          selected.id
        )
      );

      setActivityToDelete(null);

      // onSnapshot automatically updates both
      // Recent Activity and View All.
    } catch (reason) {
      setActivityToDelete(null);

      notify(
        "Unable to delete activity",
        formatError(reason)
      );
    } finally {
      setDeletingActivity(false);
    }
  }

  // =====================================
  // SAVE SILKWORM SPECIES
  // =====================================

  async function saveSpecies() {
    if (!user || busy) return;

    const quantity = Number(quantityText);
    const threshold = Number(thresholdText);

    if (
      !form.name.trim() ||
      form.name.trim().length > 100 ||
      form.scientificName.length > 150 ||
      !STAGES.includes(form.stage) ||
      !CONDITIONS.includes(form.condition) ||
      !positiveInteger(quantityText) ||
      !positiveInteger(thresholdText) ||
      (form.imageUrl &&
        form.imageUrl.length > 180000)
    ) {
      notify(
        "Check details",
        "Enter a name, valid stage and condition, and non-negative whole numbers."
      );

      return;
    }

    setSaving(true);

    try {
      const reference = selectedId
        ? doc(
            db,
            "inventory_species",
            selectedId
          )
        : doc(
            collection(
              db,
              "inventory_species"
            )
          );

      const fields = {
        name: form.name.trim(),
        scientificName:
          form.scientificName.trim(),
        stage: form.stage,
        condition: form.condition,
        quantity,
        threshold,
        imageUrl: form.imageUrl,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      };

      await runTransaction(db, async transaction => {
        let previousQuantity = 0;

        if (selectedId) {
          const snapshot = await transaction.get(reference);

          if (!snapshot.exists()) {
            throw new Error("This species no longer exists.");
          }

          previousQuantity = asNumber(snapshot.data().quantity);
          transaction.update(reference, fields);
        } else {
          transaction.set(reference, {
            ...fields,
            createdAt:
              serverTimestamp(),
          });
        }

        const added = quantity - previousQuantity;

        activityBatch(
          transaction,
          selectedId
            ? "Silkworm species updated"
            : "Silkworm species added",
          added > 0
            ? `${fields.name} — Stock added: ${added} worms`
            : fields.name,
          selectedId
            ? "edit"
            : "add"
        );
      });

      setEditor(null);
    } catch (reason) {
      notify(
        "Unable to save",
        formatError(reason)
      );
    } finally {
      setSaving(false);
    }
  }

  // =====================================
  // ADJUST SILKWORM STOCK
  // =====================================

  async function adjustStock() {
    if (
      !user ||
      busy ||
      !signedInteger(stockChange)
    ) {
      notify(
        "Invalid adjustment",
        "Enter a positive or negative whole number."
      );

      return;
    }

    setSaving(true);

    try {
      const reference = doc(
        db,
        "inventory_species",
        form.id
      );

      await runTransaction(
        db,
        async transaction => {
          const snapshot =
            await transaction.get(reference);

          if (!snapshot.exists()) {
            throw new Error(
              "This species no longer exists."
            );
          }

          const next =
            asNumber(
              snapshot.data().quantity
            ) +
            Number(stockChange);

          if (
            next < 0 ||
            !Number.isSafeInteger(next)
          ) {
            throw new Error(
              "Adjustment exceeds available stock."
            );
          }

          transaction.update(
            reference,
            {
              quantity: next,
              updatedAt:
                serverTimestamp(),
              updatedBy: user.uid,
            }
          );

          transaction.set(
            doc(
              collection(
                db,
                "inventory_activity"
              )
            ),
            {
              message:
                "Silkworm stock adjusted",
              detail:
                `${form.name}: ${stockChange} worms`,
              type: "stock",
              actorUid: user.uid,
              createdAt:
                serverTimestamp(),
            }
          );
        }
      );

      setEditor(null);
    } catch (reason) {
      notify(
        "Unable to adjust",
        formatError(reason)
      );
    } finally {
      setSaving(false);
    }
  }

  // =====================================
  // DELETE SILKWORM SPECIES
  // =====================================

  function confirmDelete(
    item: Species
  ) {
    if (Platform.OS === "web") {
      if (
        window.confirm(
          `Delete ${item.name} from inventory?`
        )
      ) {
        void deleteSpecies(item);
      }

      return;
    }

    Alert.alert(
      "Delete species",
      `Delete ${item.name} from inventory?`,
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void deleteSpecies(item);
          },
        },
      ]
    );
  }

  async function deleteSpecies(
    item: Species
  ) {
    if (!user || busy) return;

    setSaving(true);

    try {
      const batch = writeBatch(db);

      batch.delete(
        doc(
          db,
          "inventory_species",
          item.id
        )
      );

      activityBatch(
        batch,
        "Silkworm species deleted",
        item.name,
        "remove"
      );

      await batch.commit();
    } catch (reason) {
      notify(
        "Unable to delete",
        formatError(reason)
      );
    } finally {
      setSaving(false);
    }
  }

  // =====================================
  // SAVE COCOON REGIONS
  // =====================================

  async function saveCocoonRegion(
    values: Partial<Cocoons>,
    reservation: boolean
  ) {
    if (!user || busy || !cocoonRegionsReady) return;

    const region = reservation ? editedCocoonRegion : null;
    if (reservation && !region) return;

    const name = (region?.name ?? cocoonRegionName).trim();
    if (!name || name.length > 100) {
      notify("Invalid region", "Enter a region name of up to 100 characters.");
      return;
    }
    if (!region && name.toLowerCase() === "unassigned") {
      notify("Invalid region", "Choose a name other than Unassigned.");
      return;
    }

    const uid = user.uid;
    setSaving(true);

    try {
      const regionId = region?.id ?? `region-${encodeURIComponent(name.toLowerCase())}`;
      const reference = doc(db, "cocoon_regions", regionId);
      const activityRef = doc(collection(db, "inventory_activity"));

      await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(reference);

        if (auth.currentUser?.uid !== uid) {
          throw new Error("Your session changed. Sign in again before saving.");
        }

        if (!region && snapshot.exists()) {
          throw new Error("This region already exists.");
        }

        const current = readCocoonStock(snapshot.data());
        if (region && (
          !snapshot.exists() ||
          COCOON_STOCK_FIELDS.some(field => current[field] !== region[field]) ||
          current.imageUrl !== region.imageUrl
        )) {
          throw new Error("This region changed. Reopen its editor and try again.");
        }

        const next = { ...current, ...values };
        if (next.reserved > next.good) {
          throw new Error("Reserved cocoons cannot exceed good-quality stock.");
        }

        if (COCOON_STOCK_FIELDS.some(field =>
          !Number.isSafeInteger(next[field]) ||
          next[field] < 0 ||
          next[field] > 1000000000
        )) {
          throw new Error("Cocoon quantities are out of range.");
        }

        const metadata = {
          updatedAt: serverTimestamp(),
          updatedBy: uid,
        };

        transaction.set(reference, { ...next, name, ...metadata });
        transaction.set(activityRef, {
          message: reservation
            ? "Cocoon reservation updated"
            : "Cocoon region added",
          detail: reservation
            ? `${name} — ${next.reserved} cocoons reserved`
            : `${name} — Good ${next.good}, Minor ${next.minor}, Unusable ${next.unusable}`,
          type: "cocoon",
          actorUid: uid,
          createdAt: serverTimestamp(),
        });
      });

      setEditor(null);
    } catch (reason) {
      notify(
        reservation ? "Unable to reserve" : "Unable to add region",
        formatError(reason)
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveNewCocoonRegion() {
    if (!user || busy) return;

    if (![goodChange, minorChange, unusableChange].every(positiveInteger)) {
      notify(
        "Invalid quantities",
        "Enter non-negative whole-number totals for each cocoon quality."
      );
      return;
    }

    await saveCocoonRegion({
      good: Number(goodChange),
      minor: Number(minorChange),
      unusable: Number(unusableChange),
      imageUrl: cocoonImage,
    }, false);
  }

  // =====================================
  // UPDATE RESERVED COCOONS
  // =====================================

  async function saveReserved() {
    if (!user || busy) return;

    if (!positiveInteger(reservedText)) {
      notify("Invalid reservation", "Enter a non-negative whole number.");
      return;
    }

    await saveCocoonRegion({ reserved: Number(reservedText) }, true);
  }

  // =====================================
  // SHARED ACTIVITY ROW
  // =====================================

  function renderActivity(item: Activity) {
    return (
      <View
        key={item.id}
        style={styles.activityRow}
      >
        <View style={styles.activityInformation}>
          <Text style={S.strong}>
            {item.message}
          </Text>

          <Text style={S.muted}>
            {item.detail}
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Delete activity: ${item.message}`}
          disabled={deletingActivity}
          onPress={() =>
            confirmActivityDelete(item)
          }
          style={styles.activityDeleteButton}
        >
          <Ionicons
            name="trash-outline"
            size={18}
            color="#B34D4D"
          />
        </Pressable>
      </View>
    );
  }

  // =====================================
  // INVENTORY SCREEN UI
  // =====================================

  return (
    <View style={S.page}>
      <ScrollView
        contentContainerStyle={
          S.content
        }
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Heading
          label="INVENTORY MANAGEMENT"
          title="Inventory Management"
          description="Manage silkworm species, stock levels, and cocoon production."
        />

        {!!error && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>
              {error}
            </Text>
          </View>
        )}

        {!ready && (
          <ActivityIndicator
            color={C.green}
            style={{
              marginVertical: 20,
            }}
          />
        )}

        {/* INVENTORY STATISTICS */}

        <Fade delay={100}>
          <View style={styles.statGrid}>
            <Stat
              icon="leaf-outline"
              label="Total Silkworms"
              value={fmt(totalWorms)}
            />

            <Stat
              icon="layers-outline"
              label="Active Species"
              value={fmt(species.length)}
            />

            <Stat
              icon="ellipse-outline"
              label="Cocoon Regions"
              value={cocoonRegionsReady ? fmt(cocoonRegions.length) : "—"}
            />

            <Stat
              icon="alert-circle-outline"
              label="Low Stock Alerts"
              value={fmt(lowStockAlertCount)}
            />
          </View>
        </Fade>

        <View style={styles.tabs}>
          {(["Silkworms", "Cocoons"] as Tab[]).map(
            option => (
              <Pressable
                key={option}
                onPress={() => setTab(option)}
                style={[
                  S.chip,
                  tab === option &&
                    S.chipActive,
                ]}
              >
                <Text
                  style={{
                    color:
                      tab === option
                        ? "#FFFFFF"
                        : C.dark,
                    fontSize: 12,
                    fontWeight: "700",
                  }}
                >
                  {option}
                </Text>
              </Pressable>
            )
          )}
        </View>

        {tab === "Silkworms" ? (
          <Fade delay={100}>
            <View style={S.card}>
              <View style={styles.sectionRow}>
                <Text style={S.sectionTitle}>
                  Silkworm Species
                </Text>

                <Pressable
                  disabled={busy}
                  onPress={() => editSpecies()}
                  style={styles.addButton}
                >
                  <Ionicons
                    name="add"
                    size={16}
                    color="white"
                  />

                  <Text style={styles.addText}>
                    Add
                  </Text>
                </Pressable>
              </View>

              <Search
                value={query}
                onChange={setQuery}
                placeholder="Search silkworm species..."
              />

              <Text style={styles.smallLabel}>
                {filtered.length} record(s)
              </Text>

              {filtered.length === 0 && (
                <Text style={S.muted}>
                  No species records found. Add a
                  silkworm species to get started.
                </Text>
              )}

              {filtered.map(item => (
                <View
                  key={item.id}
                  style={styles.speciesCard}
                >
                  <View style={styles.speciesTop}>
                    {item.imageUrl ? (
                      <Image
                        source={{
                          uri: item.imageUrl,
                        }}
                        style={styles.thumbnail}
                      />
                    ) : (
                      <View
                        style={
                          styles.thumbnailEmpty
                        }
                      >
                        <Ionicons
                          name="leaf-outline"
                          size={22}
                          color={C.green}
                        />
                      </View>
                    )}

                    <View style={{ flex: 1 }}>
                      <Text style={S.strong}>
                        {item.name}
                      </Text>

                      <Text
                        style={S.muted}
                        numberOfLines={2}
                      >
                        {item.scientificName ||
                          "No description"}
                      </Text>
                    </View>

                    <Status value={item.stage} />
                  </View>

                  <Text style={styles.infoLine}>
                    {fmt(item.quantity)} worms
                    {" · "}
                    {item.condition}
                  </Text>

                  <Text
                    style={[
                      styles.infoLine,
                      item.quantity <=
                        item.threshold && {
                        color: "#AD7225",
                      },
                    ]}
                  >
                    {item.quantity === 0
                      ? "Out of Stock"
                      : item.quantity <=
                          item.threshold
                        ? "Low Stock"
                        : "In Stock"}
                    {" · "}
                    Alert threshold:{" "}
                    {fmt(item.threshold)}
                  </Text>

                  <View style={styles.actionRow}>
                    <Pressable
                      onPress={() =>
                        editStock(item)
                      }
                      disabled={busy}
                      style={
                        styles.outlineButton
                      }
                    >
                      <Text
                        style={
                          styles.outlineLabel
                        }
                      >
                        Stock
                      </Text>
                    </Pressable>

                    <Pressable
                      onPress={() =>
                        editSpecies(item)
                      }
                      disabled={busy}
                      style={
                        styles.outlineButton
                      }
                    >
                      <Text
                        style={
                          styles.outlineLabel
                        }
                      >
                        Edit
                      </Text>
                    </Pressable>

                    <Pressable
                      onPress={() =>
                        confirmDelete(item)
                      }
                      disabled={busy}
                      style={[
                        styles.outlineButton,
                        styles.deleteButton,
                      ]}
                    >
                      <Text
                        style={
                          styles.deleteLabel
                        }
                      >
                        Delete
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          </Fade>
        ) : (
          <Fade delay={100}>
            <View style={S.card}>
              <Text style={S.sectionTitle}>
                Cocoon Inventory
              </Text>

              <View style={styles.cocoonButtons}>
                {!!cocoonRegionsError && (
                  <Text style={styles.errorText}>{cocoonRegionsError}</Text>
                )}

                {!cocoonRegionsReady && !cocoonRegionsError && user && (
                  <ActivityIndicator color={C.green} />
                )}

                {cocoonRegionsReady && (
                  <View style={styles.cocoonRegionCard}>
                    <Text style={S.strong}>All Regions</Text>

                    <View style={styles.metrics}>
                      {([
                        ["Good Quality", cocoonTotals.good],
                        ["Minor Defects", cocoonTotals.minor],
                        ["Reject", cocoonTotals.unusable],
                        ["Reserved", cocoonTotals.reserved],
                        ["Available Good Quality", cocoonTotals.good - cocoonTotals.reserved],
                      ] as const).map(([label, value]) => (
                        <View key={label} style={styles.metric}>
                          <Text style={S.muted}>{label}</Text>
                          <Text style={styles.metricValue}>{fmt(value)}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                {cocoonRegions.map(region => (
                  <View key={region.id} style={styles.speciesCard}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`View cocoon counts for ${region.name}`}
                      onPress={() => setSelectedCocoonRegionId(region.id)}
                      disabled={!cocoonRegionsReady}
                      style={styles.speciesTop}
                    >
                      {region.imageUrl ? (
                        <Image
                          source={{ uri: region.imageUrl }}
                          style={styles.thumbnail}
                        />
                      ) : (
                        <View style={styles.thumbnailEmpty}>
                          <Ionicons
                            name="ellipse-outline"
                            size={22}
                            color={C.green}
                          />
                        </View>
                      )}

                      <View style={{ flex: 1 }}>
                        <Text style={S.strong}>{region.name}</Text>
                        <Text style={S.muted}>
                          {fmt(region.good + region.minor + region.unusable)} total
                          {" · "}{fmt(region.good - region.reserved)} available
                        </Text>
                      </View>

                      <Ionicons
                        name="chevron-forward"
                        size={18}
                        color={C.green}
                      />
                    </Pressable>

                    <View style={styles.actionRow}>
                      <Pressable
                        onPress={() => editReserved(region)}
                        style={styles.outlineButton}
                        disabled={busy || !cocoonRegionsReady}
                      >
                        <Text style={styles.outlineLabel}>Manage Reserved</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}

                {cocoonRegionsReady && cocoonRegions.length === 0 && (
                  <Text style={S.muted}>No cocoon regions yet.</Text>
                )}

                <Pressable
                  onPress={addCocoonRegion}
                  style={styles.fullButton}
                  disabled={busy || !cocoonRegionsReady || !user}
                >
                  <Text style={styles.fullButtonText}>Add Region</Text>
                </Pressable>
              </View>
            </View>
          </Fade>
        )}

        {lowStockAlertCount > 0 && (
          <Fade delay={160}>
            <View style={S.card}>
              <Text style={S.sectionTitle}>
                Needs Attention
              </Text>

              {lowCocoonRegions.map(region => (
                <Text
                  key={region.id}
                  style={[
                    S.muted,
                    { marginTop: 9 },
                  ]}
                >
                  {region.name}:{" "}
                  {fmt(region.good - region.reserved)} good-quality cocoons available
                  {" "}
                  (threshold {fmt(COCOON_LOW_STOCK_THRESHOLD)})
                </Text>
              ))}

              {lowStock.map(item => (
                <Text
                  key={item.id}
                  style={[
                    S.muted,
                    { marginTop: 9 },
                  ]}
                >
                  {item.name}:{" "}
                  {fmt(item.quantity)} left
                  {" "}
                  (threshold{" "}
                  {fmt(item.threshold)})
                </Text>
              ))}
            </View>
          </Fade>
        )}

        {/* RECENT ACTIVITY */}

        <Fade delay={180}>
          <View style={S.card}>
            <Text style={S.sectionTitle}>
              Recent Activity
            </Text>

            {activities.length ? (
              activities
                .slice(0, 2)
                .map(renderActivity)
            ) : (
              <Text
                style={[
                  S.muted,
                  { marginTop: 10 },
                ]}
              >
                No inventory activity yet.
              </Text>
            )}

            {activities.length > 2 && (
              <Pressable
                onPress={() =>
                  setShowAllActivity(true)
                }
                style={
                  styles.activityViewAllButton
                }
                accessibilityRole="button"
                accessibilityLabel="View all inventory activity"
              >
                <Text
                  style={
                    styles.activityViewAllText
                  }
                >
                  View All
                </Text>

                <Ionicons
                  name="arrow-forward"
                  size={16}
                  color="#FFFFFF"
                />
              </Pressable>
            )}
          </View>
        </Fade>
      </ScrollView>

      {/* ALL INVENTORY ACTIVITY MODAL */}

      <Modal
        visible={showAllActivity}
        transparent
        animationType="slide"
        onRequestClose={() =>
          setShowAllActivity(false)
        }
      >
        <View style={styles.backdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={S.sectionTitle}>
                All Inventory Activity
              </Text>

              <Pressable
                onPress={() =>
                  setShowAllActivity(false)
                }
              >
                <Ionicons
                  name="close"
                  size={23}
                  color={C.dark}
                />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={{
                paddingBottom: 16,
              }}
            >
              {activities.length === 0 ? (
                <Text style={S.muted}>
                  No inventory activity yet.
                </Text>
              ) : (
                activities.map(renderActivity)
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* COCOON REGION DETAILS MODAL */}

      <Modal
        visible={selectedCocoonRegionId !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedCocoonRegionId(null)}
      >
        <View style={styles.backdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={[S.sectionTitle, { flex: 1 }]}>
                {selectedCocoonRegion?.name ?? "Cocoon Region"}
              </Text>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close region details"
                onPress={() => setSelectedCocoonRegionId(null)}
              >
                <Ionicons name="close" size={23} color={C.dark} />
              </Pressable>
            </View>

            <ScrollView>
              {selectedCocoonRegion && cocoonRegionsReady ? (
                <>
                  <View style={styles.metrics}>
                    <View style={styles.metric}>
                      <Text style={S.muted}>Good Quality</Text>
                      <Text style={styles.metricValue}>
                        {fmt(selectedCocoonRegion.good)}
                      </Text>
                    </View>

                    <View style={styles.metric}>
                      <Text style={S.muted}>Minor Defects</Text>
                      <Text style={styles.metricValue}>
                        {fmt(selectedCocoonRegion.minor)}
                      </Text>
                    </View>

                    <View style={styles.metric}>
                      <Text style={S.muted}>Reject</Text>
                      <Text style={styles.metricValue}>
                        {fmt(selectedCocoonRegion.unusable)}
                      </Text>
                    </View>

                    <View style={styles.metric}>
                      <Text style={S.muted}>Reserved</Text>
                      <Text style={styles.metricValue}>
                        {fmt(selectedCocoonRegion.reserved)}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.cocoonButtons}>
                    <Text style={S.strong}>Available Good Quality</Text>
                    <Text style={styles.metricValue}>
                      {fmt(selectedCocoonRegion.good - selectedCocoonRegion.reserved)}
                    </Text>
                    <Text style={S.muted}>Good Quality − Reserved</Text>
                  </View>
                </>
              ) : (
                <Text style={S.muted}>
                  {cocoonRegionsError || "This region is no longer available."}
                </Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* INVENTORY EDITOR MODAL */}

      <Modal
        visible={editor !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!busy) setEditor(null);
        }}
      >
        <View style={styles.backdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={S.sectionTitle}>
                {editor === "species"
                  ? selectedId
                    ? "Edit Silkworm Species"
                    : "Add Silkworm Species"
                  : editor === "stock"
                    ? "Adjust Silkworm Stock"
                    : editor === "cocoons"
                      ? "Add Cocoon Region"
                      : `Manage Reserved — ${editedCocoonRegion?.name ?? ""}`}
              </Text>

              <Pressable
                disabled={busy}
                onPress={() =>
                  setEditor(null)
                }
              >
                <Ionicons
                  name="close"
                  size={23}
                  color={C.dark}
                />
              </Pressable>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{
                paddingBottom: 12,
              }}
            >
              {editor === "species" && (
                <>
                  <Field
                    label="Species / Batch Name"
                    value={form.name}
                    onChangeText={value =>
                      setForm(current => ({
                        ...current,
                        name: value,
                      }))
                    }
                  />

                  <Field
                    label="Scientific Name / Description"
                    value={
                      form.scientificName
                    }
                    onChangeText={value =>
                      setForm(current => ({
                        ...current,
                        scientificName: value,
                      }))
                    }
                  />

                  <SelectChips
                    label="Lifecycle Stage"
                    options={STAGES}
                    value={form.stage}
                    onChange={value =>
                      setForm(current => ({
                        ...current,
                        stage: value,
                      }))
                    }
                  />

                  <SelectChips
                    label="Condition"
                    options={CONDITIONS}
                    value={form.condition}
                    onChange={value =>
                      setForm(current => ({
                        ...current,
                        condition: value,
                      }))
                    }
                  />

                  <Field
                    label="Current Quantity"
                    value={quantityText}
                    numeric
                    onChangeText={
                      setQuantityText
                    }
                  />

                  <Field
                    label="Low Stock Alert Threshold"
                    value={thresholdText}
                    numeric
                    onChangeText={
                      setThresholdText
                    }
                  />

                  <Text
                    style={
                      styles.fieldLabel
                    }
                  >
                    Silkworm Image (optional)
                  </Text>

                  {!!form.imageUrl && (
                    <Image
                      source={{
                        uri: form.imageUrl,
                      }}
                      style={styles.preview}
                    />
                  )}

                  <Pressable
                    disabled={busy}
                    style={
                      styles.outlineButton
                    }
                    onPress={() =>
                      pickImage("species")
                    }
                  >
                    <Text
                      style={
                        styles.outlineLabel
                      }
                    >
                      Choose Image
                    </Text>
                  </Pressable>

                  {!!form.imageUrl && (
                    <Pressable
                      onPress={() =>
                        setForm(current => ({
                          ...current,
                          imageUrl: "",
                        }))
                      }
                    >
                      <Text
                        style={
                          styles.removeLabel
                        }
                      >
                        Remove Image
                      </Text>
                    </Pressable>
                  )}
                </>
              )}

              {editor === "stock" && (
                <>
                  <Text
                    style={[
                      S.muted,
                      {
                        marginBottom: 10,
                      },
                    ]}
                  >
                    {form.name} · Current:{" "}
                    {fmt(form.quantity)} worms
                  </Text>

                  <Field
                    label="Stock Adjustment (+ to add, - to remove)"
                    value={stockChange}
                    onChangeText={
                      setStockChange
                    }
                    numeric
                  />
                </>
              )}

              {editor === "cocoons" && (
                <>
                  <Field
                    label="Region Name"
                    value={cocoonRegionName}
                    onChangeText={setCocoonRegionName}
                    placeholder="Enter a region name"
                  />

                  <Field
                    label="Good Quality"
                    value={goodChange}
                    onChangeText={
                      setGoodChange
                    }
                    numeric
                  />

                  <Field
                    label="Minor Defects"
                    value={minorChange}
                    onChangeText={
                      setMinorChange
                    }
                    numeric
                  />

                  <Field
                    label="Reject"
                    value={
                      unusableChange
                    }
                    onChangeText={
                      setUnusableChange
                    }
                    numeric
                  />

                  <Text
                    style={
                      styles.fieldLabel
                    }
                  >
                    Cocoon Image (optional)
                  </Text>

                  {!!cocoonImage && (
                    <Image
                      source={{
                        uri: cocoonImage,
                      }}
                      style={styles.preview}
                    />
                  )}

                  <Pressable
                    disabled={busy}
                    style={
                      styles.outlineButton
                    }
                    onPress={() =>
                      pickImage("cocoons")
                    }
                  >
                    <Text
                      style={
                        styles.outlineLabel
                      }
                    >
                      Choose Image
                    </Text>
                  </Pressable>

                  {!!cocoonImage && (
                    <Pressable
                      onPress={() =>
                        setCocoonImage("")
                      }
                    >
                      <Text
                        style={
                          styles.removeLabel
                        }
                      >
                        Remove Image
                      </Text>
                    </Pressable>
                  )}
                </>
              )}

              {editor === "reserved" && (
                <>
                  <Text
                    style={[
                      S.muted,
                      {
                        marginBottom: 12,
                      },
                    ]}
                  >
                    Good-quality:{" "}
                    {fmt(editedCocoonRegion?.good ?? 0)}
                    {" · "}
                    Current reserved:{" "}
                    {fmt(editedCocoonRegion?.reserved ?? 0)}
                  </Text>

                  <Field
                    label="New Total Reserved"
                    value={reservedText}
                    onChangeText={
                      setReservedText
                    }
                    numeric
                  />
                </>
              )}

              {busy && (
                <ActivityIndicator
                  color={C.green}
                  style={{
                    marginVertical: 12,
                  }}
                />
              )}

              <View
                style={
                  styles.modalActions
                }
              >
                <Pressable
                  disabled={busy}
                  onPress={() =>
                    setEditor(null)
                  }
                  style={
                    styles.outlineButton
                  }
                >
                  <Text
                    style={
                      styles.outlineLabel
                    }
                  >
                    Cancel
                  </Text>
                </Pressable>

                <Pressable
                  disabled={busy}
                  onPress={() => {
                    if (
                      editor === "species"
                    ) {
                      void saveSpecies();
                    } else if (
                      editor === "stock"
                    ) {
                      void adjustStock();
                    } else if (
                      editor === "cocoons"
                    ) {
                      void saveNewCocoonRegion();
                    } else if (
                      editor === "reserved"
                    ) {
                      void saveReserved();
                    }
                  }}
                  style={[
                    styles.fullButton,
                    busy && {
                      opacity: 0.5,
                    },
                  ]}
                >
                  <Text
                    style={
                      styles.fullButtonText
                    }
                  >
                    {saving
                      ? "Saving..."
                      : "Save Changes"}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* SMALL ERROR AND VALIDATION POPUP */}

      <Modal
        visible={notice !== null}
        transparent
        animationType="fade"
        onRequestClose={() =>
          setNotice(null)
        }
      >
        <View
          style={
            styles.noticeBackdrop
          }
        >
          <View
            style={styles.noticeCard}
          >
            <View
              style={styles.noticeIcon}
            >
              <Ionicons
                name="alert-circle-outline"
                size={22}
                color="#B34D4D"
              />
            </View>

            <Text
              style={
                styles.noticeTitle
              }
            >
              {notice?.title}
            </Text>

            <Text
              style={
                styles.noticeMessage
              }
            >
              {notice?.message}
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close notification"
              onPress={() =>
                setNotice(null)
              }
              style={
                styles.noticeButton
              }
            >
              <Text
                style={
                  styles.noticeButtonText
                }
              >
                OK
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* DELETE INVENTORY ACTIVITY CONFIRMATION */}

      <Modal
        visible={activityToDelete !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!deletingActivity) {
            setActivityToDelete(null);
          }
        }}
      >
        <View
          style={
            styles.noticeBackdrop
          }
        >
          <View
            style={
              styles.activityConfirmCard
            }
          >
            <View
              style={
                styles.noticeIcon
              }
            >
              <Ionicons
                name="trash-outline"
                size={22}
                color="#B34D4D"
              />
            </View>

            <Text
              style={
                styles.noticeTitle
              }
            >
              Delete Activity?
            </Text>

            <Text
              style={
                styles.noticeMessage
              }
            >
              Permanently delete this activity
              record from Firestore?
            </Text>

            <Text
              style={
                styles.activityConfirmDetail
              }
            >
              {activityToDelete?.message}
            </Text>

            <Text
              style={
                styles.activityConfirmHint
              }
            >
              Only this activity history entry
              will be removed. Inventory stock
              and other records will not change.
            </Text>

            <View
              style={
                styles.activityConfirmActions
              }
            >
              <Pressable
                disabled={deletingActivity}
                style={
                  styles.activityCancelButton
                }
                onPress={() =>
                  setActivityToDelete(null)
                }
              >
                <Text
                  style={
                    styles.activityCancelText
                  }
                >
                  Cancel
                </Text>
              </Pressable>

              <Pressable
                disabled={deletingActivity}
                style={
                  styles.activityConfirmDeleteButton
                }
                onPress={() =>
                  void deleteSelectedActivity()
                }
              >
                {deletingActivity ? (
                  <ActivityIndicator
                    size="small"
                    color="#FFFFFF"
                  />
                ) : (
                  <Text
                    style={
                      styles.activityConfirmDeleteText
                    }
                  >
                    Delete
                  </Text>
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
  statGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 18,
  },

  tabs: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },

  sectionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },

  addButton: {
    backgroundColor: C.green,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },

  addText: {
    color: "white",
    fontSize: 12,
    fontWeight: "700",
  },

  smallLabel: {
    color: C.muted,
    fontSize: 10,
    marginBottom: 7,
  },

  speciesCard: {
    borderTopWidth: 1,
    borderColor: C.line,
    paddingVertical: 14,
  },

  speciesTop: {
    flexDirection: "row",
    gap: 9,
    alignItems: "center",
    marginBottom: 8,
  },

  thumbnail: {
    width: 43,
    height: 43,
    borderRadius: 10,
  },

  thumbnailEmpty: {
    width: 43,
    height: 43,
    borderRadius: 10,
    backgroundColor: C.soft,
    alignItems: "center",
    justifyContent: "center",
  },

  infoLine: {
    color: C.muted,
    fontSize: 11,
    marginTop: 4,
  },

  actionRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },

  outlineButton: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },

  outlineLabel: {
    color: C.green,
    fontSize: 12,
    fontWeight: "700",
  },

  deleteButton: {
    borderColor: "#E9BFBF",
  },

  deleteLabel: {
    color: "#B84B4B",
    fontSize: 12,
    fontWeight: "700",
  },

  removeLabel: {
    color: "#B84B4B",
    fontSize: 12,
    fontWeight: "700",
    marginVertical: 12,
  },

  metrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },

  metric: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    padding: 11,
    minWidth: "47%",
    flex: 1,
  },

  metricValue: {
    color: C.dark,
    fontSize: 22,
    fontFamily: "serif",
    marginTop: 6,
  },

  cocoonButtons: {
    marginTop: 16,
    gap: 9,
  },

  cocoonRegionCard: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },

  fullButton: {
    backgroundColor: C.green,
    borderRadius: 11,
    paddingHorizontal: 16,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
  },

  fullButtonText: {
    color: "white",
    fontSize: 12,
    fontWeight: "700",
  },

  // ACTIVITY ROW WITH RIGHT-SIDE DELETE ICON

  activityRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: C.line,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  activityInformation: {
    flex: 1,
  },

  activityDeleteButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF1ED",
    borderWidth: 1,
    borderColor: "#F1D6D0",
  },

  activityViewAllButton: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
    paddingVertical: 12,
    backgroundColor: C.green,
    borderRadius: 11,
  },

  activityViewAllText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },

  errorCard: {
    backgroundColor: "#FFF0EC",
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },

  errorText: {
    color: "#B34843",
    fontSize: 12,
  },

  backdrop: {
    flex: 1,
    backgroundColor: "rgba(9,30,18,0.5)",
    paddingHorizontal: 16,
    paddingVertical: 34,
    justifyContent: "center",
  },

  modalCard: {
    backgroundColor: C.white,
    borderRadius: 18,
    padding: 17,
    maxHeight: "90%",
  },

  modalHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
    gap: 8,
  },

  field: {
    marginBottom: 13,
  },

  fieldLabel: {
    color: C.dark,
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 7,
  },

  fieldInput: {
    backgroundColor: C.white,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 11,
    padding: 11,
    color: C.dark,
    fontSize: 13,
  },

  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },

  chip: {
    backgroundColor: C.soft,
    borderRadius: 17,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },

  chipSelected: {
    backgroundColor: C.green,
  },

  chipLabel: {
    fontSize: 11,
    color: C.dark,
  },

  chipSelectedLabel: {
    color: "white",
    fontWeight: "700",
  },

  preview: {
    width: "100%",
    height: 130,
    borderRadius: 10,
    marginBottom: 10,
  },

  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 17,
  },

  // SMALL ERROR POPUP

  noticeBackdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(8,24,15,0.42)",
    padding: 20,
  },

  noticeCard: {
    width: "100%",
    maxWidth: 330,
    backgroundColor: C.white,
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.line,
  },

  noticeIcon: {
    backgroundColor: "#FFF1ED",
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },

  noticeTitle: {
    color: C.dark,
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 7,
    textAlign: "center",
  },

  noticeMessage: {
    color: C.muted,
    fontSize: 12,
    lineHeight: 19,
    textAlign: "center",
    marginBottom: 18,
  },

  noticeButton: {
    backgroundColor: C.green,
    borderRadius: 10,
    alignItems: "center",
    paddingHorizontal: 30,
    paddingVertical: 11,
    minWidth: 110,
  },

  noticeButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 12,
  },

  // ACTIVITY DELETE CONFIRMATION

  activityConfirmCard: {
    width: "100%",
    maxWidth: 330,
    backgroundColor: C.white,
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.line,
  },

  activityConfirmDetail: {
    color: C.dark,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 8,
  },

  activityConfirmHint: {
    color: C.muted,
    fontSize: 11,
    lineHeight: 17,
    textAlign: "center",
    marginBottom: 18,
  },

  activityConfirmActions: {
    width: "100%",
    flexDirection: "row",
    gap: 10,
  },

  activityCancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.line,
    alignItems: "center",
    justifyContent: "center",
  },

  activityCancelText: {
    color: C.dark,
    fontSize: 12,
    fontWeight: "700",
  },

  activityConfirmDeleteButton: {
    flex: 1,
    backgroundColor: "#B34D4D",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },

  activityConfirmDeleteText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
});