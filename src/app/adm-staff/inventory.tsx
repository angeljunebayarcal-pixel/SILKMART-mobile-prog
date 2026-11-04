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
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  writeBatch,
  type DocumentData,
} from "firebase/firestore";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { auth, db } from "../../firebase/config";
import { C, Fade, Heading, S, Search, Stat, Status } from "../../components/AdminUI";

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
type Activity = {
  id: string;
  message: string;
  detail: string;
  type: string;
  createdAt?: { toMillis?: () => number };
};
type Tab = "Silkworms" | "Cocoons";
type Editor = "species" | "stock" | "cocoons" | "reserved" | null;

const STAGES = ["Egg", "1st Instar", "2nd Instar", "3rd Instar", "4th Instar", "5th Instar", "Mature", "Pupa", "Moth"];
const CONDITIONS = ["Healthy", "Good", "Monitoring", "Quarantined"];
const blankSpecies = (): Species => ({
  id: "", name: "", scientificName: "", stage: "Egg", condition: "Healthy",
  quantity: 0, threshold: 10, imageUrl: "",
});
const blankCocoons = (): Cocoons => ({ good: 0, minor: 0, unusable: 0, reserved: 0, imageUrl: "" });
const asNumber = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const positiveInteger = (value: string) => value.trim() !== "" && /^\d+$/.test(value) && Number.isSafeInteger(Number(value));
const signedInteger = (value: string) => /^[+-]?\d+$/.test(value.trim()) && Number.isSafeInteger(Number(value));
const fmt = (value: number) => value.toLocaleString("en-PH");
function notify(title: string, message: string) {
  if (Platform.OS === "web") { window.alert(`${title}\n\n${message}`); return; }
  Alert.alert(title, message);
}
function formatError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code.includes("permission-denied")) return "Firestore denied this action. Check Admin/Staff access and inventory security rules.";
  return error instanceof Error ? error.message : "Unable to complete the action. Check your connection.";
}
function Field({ label, value, onChangeText, numeric = false, placeholder }: {
  label: string; value: string; onChangeText: (text: string) => void; numeric?: boolean; placeholder?: string;
}) {
  return <View style={styles.field}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder}
      keyboardType={numeric ? "numbers-and-punctuation" : "default"}
      autoCapitalize={numeric ? "none" : "sentences"}
      style={styles.fieldInput} placeholderTextColor="#82988B" />
  </View>;
}
function SelectChips({ label, options, value, onChange }: {
  label: string; options: string[]; value: string; onChange: (value: string) => void;
}) {
  return <View style={styles.field}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <View style={styles.chips}>{options.map(option => <Pressable key={option}
      onPress={() => onChange(option)}
      style={[styles.chip, option === value && styles.chipSelected]}>
      <Text style={[styles.chipLabel, option === value && styles.chipSelectedLabel]}>{option}</Text>
    </Pressable>)}</View>
  </View>;
}

export default function Inventory() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [tab, setTab] = useState<Tab>("Silkworms");
  const [species, setSpecies] = useState<Species[]>([]);
  const [cocoons, setCocoons] = useState<Cocoons>(blankCocoons());
  const [activities, setActivities] = useState<Activity[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<Editor>(null);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState<Species>(blankSpecies());
  const [quantityText, setQuantityText] = useState("0");
  const [thresholdText, setThresholdText] = useState("10");
  const [stockChange, setStockChange] = useState("0");
  const [goodChange, setGoodChange] = useState("0");
  const [minorChange, setMinorChange] = useState("0");
  const [unusableChange, setUnusableChange] = useState("0");
  const [reservedText, setReservedText] = useState("0");
  const [cocoonImage, setCocoonImage] = useState("");
  const [saving, setSaving] = useState(false);
  const [processingImage, setProcessingImage] = useState(false);

  useEffect(() => onAuthStateChanged(auth, setUser), []);
  useEffect(() => {
    setSpecies([]); setCocoons(blankCocoons()); setActivities([]); setError(""); setReady(false);
    if (!user) { setReady(true); return; }
    let firstSpecies = false;
    let firstCocoons = false;
    const handleError = (reason: unknown) => { setError(formatError(reason)); setReady(true); };
    const subSpecies = onSnapshot(collection(db, "inventory_species"), snapshot => {
      const items = snapshot.docs.map(item => {
        const data = item.data();
        return {
          id: item.id, name: String(data.name ?? ""),
          scientificName: String(data.scientificName ?? ""),
          stage: String(data.stage ?? "Egg"), condition: String(data.condition ?? "Healthy"),
          quantity: asNumber(data.quantity), threshold: asNumber(data.threshold ?? 10),
          imageUrl: String(data.imageUrl ?? ""),
        };
      });
      setSpecies(items.sort((a, b) => a.name.localeCompare(b.name)));
      firstSpecies = true; if (firstCocoons) setReady(true);
    }, handleError);
    const subCocoons = onSnapshot(doc(db, "inventory", "cocoons"), snapshot => {
      const data = snapshot.data();
      setCocoons(data ? {
        good: asNumber(data.good), minor: asNumber(data.minor),
        unusable: asNumber(data.unusable), reserved: asNumber(data.reserved),
        imageUrl: String(data.imageUrl ?? ""),
      } : blankCocoons());
      firstCocoons = true; if (firstSpecies) setReady(true);
    }, handleError);
    const subActivity = onSnapshot(collection(db, "inventory_activity"), snapshot => {
      setActivities(snapshot.docs.map(item => ({
        id: item.id,
        message: String(item.data().message ?? ""),
        detail: String(item.data().detail ?? ""),
        type: String(item.data().type ?? "edit"),
        createdAt: item.data().createdAt,
      })).sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)).slice(0, 5));
    }, handleError);
    return () => { subSpecies(); subCocoons(); subActivity(); };
  }, [user?.uid]);

  const filtered = useMemo(() => species.filter(item =>
    [item.name, item.scientificName, item.stage, item.condition].join(" ").toLowerCase().includes(query.trim().toLowerCase())
  ), [query, species]);
  const totalWorms = species.reduce((sum, item) => sum + item.quantity, 0);
  const totalCocoons = cocoons.good + cocoons.minor + cocoons.unusable;
  const availableCocoons = Math.max(0, cocoons.good - cocoons.reserved);
  const qualityPercent = totalCocoons ? Math.round(100 * cocoons.good / totalCocoons) : 0;
  const lowStock = species.filter(item => item.quantity <= item.threshold);
  const busy = saving || processingImage;

  function editSpecies(item?: Species) {
    const value = item ?? blankSpecies();
    setForm({ ...value }); setSelectedId(item?.id ?? "");
    setQuantityText(String(value.quantity)); setThresholdText(String(value.threshold));
    setEditor("species");
  }
  function editStock(item: Species) { setForm({ ...item }); setStockChange("0"); setEditor("stock"); }
  function editCocoons() {
    setGoodChange("0"); setMinorChange("0"); setUnusableChange("0");
    setCocoonImage(cocoons.imageUrl); setEditor("cocoons");
  }
  function editReserved() { setReservedText(String(cocoons.reserved)); setEditor("reserved"); }

  async function pickImage(kind: "species" | "cocoons") {
    if (busy) return;
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: false, quality: 1 });
      if (picked.canceled || !picked.assets.length) return;
      const asset = picked.assets[0];
      if ((asset.fileSize ?? 0) > 5 * 1024 * 1024) throw new Error("Choose an image below 5 MB.");
      setProcessingImage(true);
      const resized = await ImageManipulator.manipulateAsync(asset.uri,
        [{ resize: { width: Math.min(asset.width || 700, 700) } }],
        { compress: 0.55, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      const imageData = `data:image/jpeg;base64,${resized.base64 ?? ""}`;
      if (!resized.base64 || imageData.length > 180000) throw new Error("Image is too large after compression. Try a smaller image.");
      if (kind === "species") setForm(current => ({ ...current, imageUrl: imageData }));
      else setCocoonImage(imageData);
    } catch (reason) { notify("Image", formatError(reason)); }
    finally { setProcessingImage(false); }
  }

  function activityBatch(batch: ReturnType<typeof writeBatch>, message: string, detail: string, type: string) {
    batch.set(doc(collection(db, "inventory_activity")), {
      message, detail, type, actorUid: user?.uid, createdAt: serverTimestamp(),
    });
  }
  async function saveSpecies() {
    if (!user || busy) return;
    const quantity = Number(quantityText), threshold = Number(thresholdText);
    if (!form.name.trim() || form.name.trim().length > 100 || form.scientificName.length > 150 ||
      !STAGES.includes(form.stage) || !CONDITIONS.includes(form.condition) ||
      !positiveInteger(quantityText) || !positiveInteger(thresholdText) ||
      (form.imageUrl && form.imageUrl.length > 180000)) {
      notify("Check details", "Enter a name, valid stage and condition, and non-negative whole numbers."); return;
    }
    setSaving(true);
    try {
      const reference = selectedId ? doc(db, "inventory_species", selectedId) : doc(collection(db, "inventory_species"));
      const batch = writeBatch(db);
      const fields = { name: form.name.trim(), scientificName: form.scientificName.trim(), stage: form.stage,
        condition: form.condition, quantity, threshold, imageUrl: form.imageUrl,
        updatedAt: serverTimestamp(), updatedBy: user.uid };
      if (selectedId) batch.update(reference, fields);
      else batch.set(reference, { ...fields, createdAt: serverTimestamp() });
      activityBatch(batch, selectedId ? "Silkworm species updated" : "Silkworm species added", form.name.trim(), selectedId ? "edit" : "add");
      await batch.commit(); setEditor(null);
    } catch (reason) { notify("Unable to save", formatError(reason)); }
    finally { setSaving(false); }
  }
  async function adjustStock() {
    if (!user || busy || !signedInteger(stockChange)) { notify("Invalid adjustment", "Enter a positive or negative whole number."); return; }
    setSaving(true);
    try {
      const reference = doc(db, "inventory_species", form.id);
      await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists()) throw new Error("This species no longer exists.");
        const next = asNumber(snapshot.data().quantity) + Number(stockChange);
        if (next < 0 || !Number.isSafeInteger(next)) throw new Error("Adjustment exceeds available stock.");
        transaction.update(reference, { quantity: next, updatedAt: serverTimestamp(), updatedBy: user.uid });
        transaction.set(doc(collection(db, "inventory_activity")), {
          message: "Silkworm stock adjusted", detail: `${form.name}: ${stockChange} worms`, type: "stock",
          actorUid: user.uid, createdAt: serverTimestamp(),
        });
      });
      setEditor(null);
    } catch (reason) { notify("Unable to adjust", formatError(reason)); }
    finally { setSaving(false); }
  }
  function confirmDelete(item: Species) {
    if (Platform.OS === "web") {
      if (window.confirm(`Delete ${item.name} from inventory?`)) void deleteSpecies(item);
      return;
    }
    Alert.alert("Delete species", `Delete ${item.name} from inventory?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => { void deleteSpecies(item); } },
    ]);
  }
  async function deleteSpecies(item: Species) {
    if (!user || busy) return;
    setSaving(true);
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, "inventory_species", item.id));
      activityBatch(batch, "Silkworm species deleted", item.name, "remove");
      await batch.commit();
    } catch (reason) { notify("Unable to delete", formatError(reason)); }
    finally { setSaving(false); }
  }
  async function saveCocoons() {
    if (!user || busy || ![goodChange, minorChange, unusableChange].every(signedInteger)) {
      notify("Invalid quantities", "Enter whole-number changes for each cocoon quality."); return;
    }
    setSaving(true);
    try {
      const reference = doc(db, "inventory", "cocoons");
      await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(reference);
        const data: DocumentData = snapshot.data() ?? {};
        const next = {
          good: asNumber(data.good) + Number(goodChange),
          minor: asNumber(data.minor) + Number(minorChange),
          unusable: asNumber(data.unusable) + Number(unusableChange),
          reserved: asNumber(data.reserved), imageUrl: cocoonImage,
        };
        if ([next.good, next.minor, next.unusable].some(num => num < 0 || !Number.isSafeInteger(num)))
          throw new Error("Cocoon stock cannot be negative.");
        if (next.reserved > next.good) throw new Error("Good-quality cocoons must cover reserved stock.");
        transaction.set(reference, { ...next, updatedAt: serverTimestamp(), updatedBy: user.uid });
        transaction.set(doc(collection(db, "inventory_activity")), {
          message: "Cocoon inventory adjusted", detail: `Good ${goodChange}, Minor ${minorChange}, Unusable ${unusableChange}`,
          type: "cocoon", actorUid: user.uid, createdAt: serverTimestamp(),
        });
      });
      setEditor(null);
    } catch (reason) { notify("Unable to update", formatError(reason)); }
    finally { setSaving(false); }
  }
  async function saveReserved() {
    if (!user || busy || !positiveInteger(reservedText)) { notify("Invalid reservation", "Enter a non-negative whole number."); return; }
    setSaving(true);
    try {
      const reference = doc(db, "inventory", "cocoons");
      await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(reference);
        const record = snapshot.data() ?? {};
        const reserved = Number(reservedText);
        if (reserved > asNumber(record.good)) throw new Error("Reserved cocoons cannot exceed good-quality stock.");
        transaction.set(reference, { good: asNumber(record.good), minor: asNumber(record.minor),
          unusable: asNumber(record.unusable), imageUrl: String(record.imageUrl ?? ""),
          reserved, updatedAt: serverTimestamp(), updatedBy: user.uid });
        transaction.set(doc(collection(db, "inventory_activity")), {
          message: "Cocoon reservation updated", detail: `${reserved} cocoons reserved`, type: "cocoon",
          actorUid: user.uid, createdAt: serverTimestamp(),
        });
      });
      setEditor(null);
    } catch (reason) { notify("Unable to reserve", formatError(reason)); }
    finally { setSaving(false); }
  }

  return <View style={S.page}>
    <ScrollView contentContainerStyle={S.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Heading label="INVENTORY MANAGEMENT" title="Inventory Management" description="Manage silkworm species, stock levels, and cocoon production." />
      {error ? <View style={styles.errorCard}><Text style={styles.errorText}>{error}</Text></View> : null}
      {!ready ? <ActivityIndicator color={C.green} style={{ marginVertical: 20 }} /> : null}
      <Fade delay={100}><View style={styles.statGrid}>
        <Stat icon="leaf-outline" label="Total Silkworms" value={fmt(totalWorms)} />
        <Stat icon="layers-outline" label="Active Species" value={fmt(species.length)} />
        <Stat icon="ellipse-outline" label="Available Cocoons" value={fmt(availableCocoons)} />
        <Stat icon="alert-circle-outline" label="Low Stock Alerts" value={fmt(lowStock.length)} />
      </View></Fade>
      <View style={styles.tabs}>{(["Silkworms", "Cocoons"] as Tab[]).map(option => <Pressable key={option}
        onPress={() => setTab(option)} style={[S.chip, tab === option && S.chipActive]}>
        <Text style={{ color: tab === option ? "#FFFFFF" : C.dark, fontSize: 12, fontWeight: "700" }}>{option}</Text>
      </Pressable>)}</View>
      {tab === "Silkworms" ? <Fade delay={100}>
        <View style={S.card}>
          <View style={styles.sectionRow}><Text style={S.sectionTitle}>Silkworm Species</Text>
            <Pressable disabled={busy} onPress={() => editSpecies()} style={styles.addButton}><Ionicons name="add" size={16} color="white"/><Text style={styles.addText}>Add</Text></Pressable>
          </View>
          <Search value={query} onChange={setQuery} placeholder="Search silkworm species..." />
          <Text style={styles.smallLabel}>{filtered.length} record(s)</Text>
          {filtered.length === 0 && <Text style={S.muted}>No species records found. Add a silkworm species to get started.</Text>}
          {filtered.map(item => <View key={item.id} style={styles.speciesCard}>
            <View style={styles.speciesTop}>
              {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={styles.thumbnail} /> : <View style={styles.thumbnailEmpty}><Ionicons name="leaf-outline" size={22} color={C.green}/></View>}
              <View style={{ flex: 1 }}><Text style={S.strong}>{item.name}</Text><Text style={S.muted} numberOfLines={2}>{item.scientificName || "No description"}</Text></View>
              <Status value={item.stage}/>
            </View>
            <Text style={styles.infoLine}>{fmt(item.quantity)} worms · {item.condition}</Text>
            <Text style={[styles.infoLine, item.quantity <= item.threshold && { color: "#AD7225" }]}>
              {item.quantity === 0 ? "Out of Stock" : item.quantity <= item.threshold ? "Low Stock" : "In Stock"} · Alert threshold: {fmt(item.threshold)}
            </Text>
            <View style={styles.actionRow}>
              <Pressable onPress={() => editStock(item)} disabled={busy} style={styles.outlineButton}><Text style={styles.outlineLabel}>Stock</Text></Pressable>
              <Pressable onPress={() => editSpecies(item)} disabled={busy} style={styles.outlineButton}><Text style={styles.outlineLabel}>Edit</Text></Pressable>
              <Pressable onPress={() => confirmDelete(item)} disabled={busy} style={[styles.outlineButton, styles.deleteButton]}><Text style={styles.deleteLabel}>Delete</Text></Pressable>
            </View>
          </View>)}
        </View>
      </Fade> : <Fade delay={100}>
        <View style={S.card}>
          <Text style={S.sectionTitle}>Cocoon Inventory</Text>
          <Text style={[S.muted, { marginTop: 5, marginBottom: 14 }]}>Track production, quality distribution, and reserved stock.</Text>
          {cocoons.imageUrl ? <Image source={{ uri: cocoons.imageUrl }} style={styles.cocoonImage} /> : null}
          <View style={styles.metrics}>
            <View style={styles.metric}><Text style={S.muted}>Total Cocoons</Text><Text style={styles.metricValue}>{fmt(totalCocoons)}</Text></View>
            <View style={styles.metric}><Text style={S.muted}>Good Quality</Text><Text style={styles.metricValue}>{fmt(cocoons.good)}</Text></View>
            <View style={styles.metric}><Text style={S.muted}>Minor Defects</Text><Text style={styles.metricValue}>{fmt(cocoons.minor)}</Text></View>
            <View style={styles.metric}><Text style={S.muted}>Not Usable</Text><Text style={styles.metricValue}>{fmt(cocoons.unusable)}</Text></View>
            <View style={styles.metric}><Text style={S.muted}>Reserved</Text><Text style={styles.metricValue}>{fmt(cocoons.reserved)}</Text></View>
            <View style={styles.metric}><Text style={S.muted}>Available Good</Text><Text style={styles.metricValue}>{fmt(availableCocoons)}</Text></View>
          </View>
          <Text style={[S.strong, { marginTop: 8 }]}>Good-quality cocoons: {qualityPercent}%</Text>
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${qualityPercent}%` }]} /></View>
          <View style={styles.cocoonButtons}>
            <Pressable onPress={editCocoons} style={styles.fullButton} disabled={busy}><Text style={styles.fullButtonText}>+ Update Cocoons</Text></Pressable>
            <Pressable onPress={editReserved} style={styles.outlineButton} disabled={busy}><Text style={styles.outlineLabel}>Manage Reserved</Text></Pressable>
          </View>
        </View>
      </Fade>}
      {lowStock.length > 0 && <Fade delay={160}><View style={S.card}><Text style={S.sectionTitle}>Needs Attention</Text>
        {lowStock.map(item => <Text key={item.id} style={[S.muted, { marginTop: 9 }]}>{item.name}: {fmt(item.quantity)} left (threshold {fmt(item.threshold)})</Text>)}
      </View></Fade>}
      <Fade delay={180}><View style={S.card}><Text style={S.sectionTitle}>Recent Activity</Text>
        {activities.length ? activities.map(item => <View key={item.id} style={styles.activityRow}>
          <Text style={S.strong}>{item.message}</Text><Text style={S.muted}>{item.detail}</Text>
        </View>) : <Text style={[S.muted, { marginTop: 10 }]}>No inventory activity yet.</Text>}
      </View></Fade>
    </ScrollView>
    <Modal visible={editor !== null} transparent animationType="fade" onRequestClose={() => { if (!busy) setEditor(null); }}>
      <View style={styles.backdrop}><View style={styles.modalCard}>
        <View style={styles.modalHead}><Text style={S.sectionTitle}>
          {editor === "species" ? (selectedId ? "Edit Silkworm Species" : "Add Silkworm Species") :
           editor === "stock" ? "Adjust Silkworm Stock" : editor === "cocoons" ? "Update Cocoons" : "Manage Reserved"}
        </Text><Pressable disabled={busy} onPress={() => setEditor(null)}><Ionicons name="close" size={23} color={C.dark}/></Pressable></View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 12 }}>
          {editor === "species" && <>
            <Field label="Species / Batch Name" value={form.name} onChangeText={value => setForm(current => ({ ...current, name: value }))}/>
            <Field label="Scientific Name / Description" value={form.scientificName} onChangeText={value => setForm(current => ({ ...current, scientificName: value }))}/>
            <SelectChips label="Lifecycle Stage" options={STAGES} value={form.stage} onChange={value => setForm(current => ({ ...current, stage: value }))}/>
            <SelectChips label="Condition" options={CONDITIONS} value={form.condition} onChange={value => setForm(current => ({ ...current, condition: value }))}/>
            <Field label="Current Quantity" value={quantityText} numeric onChangeText={setQuantityText}/>
            <Field label="Low Stock Alert Threshold" value={thresholdText} numeric onChangeText={setThresholdText}/>
            <Text style={styles.fieldLabel}>Silkworm Image (optional)</Text>
            {form.imageUrl ? <Image source={{ uri: form.imageUrl }} style={styles.preview} /> : null}
            <Pressable disabled={busy} style={styles.outlineButton} onPress={() => pickImage("species")}><Text style={styles.outlineLabel}>Choose Image</Text></Pressable>
            {!!form.imageUrl && <Pressable onPress={() => setForm(current => ({ ...current, imageUrl: "" }))}><Text style={styles.removeLabel}>Remove Image</Text></Pressable>}
          </>}
          {editor === "stock" && <>
            <Text style={[S.muted, { marginBottom: 10 }]}>{form.name} · Current: {fmt(form.quantity)} worms</Text>
            <Field label="Stock Adjustment (+ to add, - to remove)" value={stockChange} onChangeText={setStockChange} numeric/>
          </>}
          {editor === "cocoons" && <>
            <Text style={[S.muted, { marginBottom: 12 }]}>Enter changes, not new totals. Use negative values to reduce a category.</Text>
            <Field label={`Good Quality (current ${fmt(cocoons.good)})`} value={goodChange} onChangeText={setGoodChange} numeric/>
            <Field label={`Minor Defects (current ${fmt(cocoons.minor)})`} value={minorChange} onChangeText={setMinorChange} numeric/>
            <Field label={`Not Usable (current ${fmt(cocoons.unusable)})`} value={unusableChange} onChangeText={setUnusableChange} numeric/>
            <Text style={styles.fieldLabel}>Cocoon Image (optional)</Text>
            {cocoonImage ? <Image source={{ uri: cocoonImage }} style={styles.preview}/> : null}
            <Pressable disabled={busy} style={styles.outlineButton} onPress={() => pickImage("cocoons")}><Text style={styles.outlineLabel}>Choose Image</Text></Pressable>
            {!!cocoonImage && <Pressable onPress={() => setCocoonImage("")}><Text style={styles.removeLabel}>Remove Image</Text></Pressable>}
          </>}
          {editor === "reserved" && <>
            <Text style={[S.muted, { marginBottom: 12 }]}>Good-quality: {fmt(cocoons.good)} · Current reserved: {fmt(cocoons.reserved)}</Text>
            <Field label="New Total Reserved" value={reservedText} onChangeText={setReservedText} numeric/>
          </>}
          {busy ? <ActivityIndicator color={C.green} style={{ marginVertical: 12 }}/> : null}
          <View style={styles.modalActions}>
            <Pressable disabled={busy} onPress={() => setEditor(null)} style={styles.outlineButton}><Text style={styles.outlineLabel}>Cancel</Text></Pressable>
            <Pressable disabled={busy} onPress={() => {
              if (editor === "species") void saveSpecies();
              else if (editor === "stock") void adjustStock();
              else if (editor === "cocoons") void saveCocoons();
              else if (editor === "reserved") void saveReserved();
            }} style={[styles.fullButton, busy && { opacity: 0.5 }]}>
              <Text style={styles.fullButtonText}>{saving ? "Saving..." : "Save Changes"}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View></View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 18 },
  tabs: { flexDirection: "row", gap: 8, marginBottom: 14 },
  sectionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  addButton: { backgroundColor: C.green, paddingHorizontal: 11, paddingVertical: 9, borderRadius: 10, flexDirection: "row", alignItems: "center", gap: 4 },
  addText: { color: "white", fontSize: 12, fontWeight: "700" },
  smallLabel: { color: C.muted, fontSize: 10, marginBottom: 7 },
  speciesCard: { borderTopWidth: 1, borderColor: C.line, paddingVertical: 14 },
  speciesTop: { flexDirection: "row", gap: 9, alignItems: "center", marginBottom: 8 },
  thumbnail: { width: 43, height: 43, borderRadius: 10 },
  thumbnailEmpty: { width: 43, height: 43, borderRadius: 10, backgroundColor: C.soft, alignItems: "center", justifyContent: "center" },
  infoLine: { color: C.muted, fontSize: 11, marginTop: 4 },
  actionRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  outlineButton: { borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  outlineLabel: { color: C.green, fontSize: 12, fontWeight: "700" },
  deleteButton: { borderColor: "#E9BFBF" }, deleteLabel: { color: "#B84B4B", fontSize: 12, fontWeight: "700" },
  removeLabel: { color: "#B84B4B", fontSize: 12, fontWeight: "700", marginVertical: 12 },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metric: { borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 11, minWidth: "47%", flex: 1 },
  metricValue: { color: C.dark, fontSize: 22, fontFamily: "serif", marginTop: 6 },
  progressTrack: { backgroundColor: C.soft, borderRadius: 8, overflow: "hidden", height: 10, marginTop: 10 },
  progressFill: { backgroundColor: C.green, height: 10, borderRadius: 8 },
  cocoonButtons: { marginTop: 16, gap: 9 },
  fullButton: { backgroundColor: C.green, borderRadius: 11, paddingHorizontal: 16, paddingVertical: 13, alignItems: "center", justifyContent: "center" },
  fullButtonText: { color: "white", fontSize: 12, fontWeight: "700" },
  cocoonImage: { width: "100%", height: 145, borderRadius: 12, marginBottom: 14 },
  activityRow: { paddingVertical: 12, borderBottomWidth: 1, borderColor: C.line },
  errorCard: { backgroundColor: "#FFF0EC", borderRadius: 12, padding: 12, marginBottom: 14 },
  errorText: { color: "#B34843", fontSize: 12 },
  backdrop: { flex: 1, backgroundColor: "rgba(9,30,18,0.5)", paddingHorizontal: 16, paddingVertical: 34, justifyContent: "center" },
  modalCard: { backgroundColor: C.white, borderRadius: 18, padding: 17, maxHeight: "90%" },
  modalHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 8 },
  field: { marginBottom: 13 }, fieldLabel: { color: C.dark, fontSize: 12, fontWeight: "700", marginBottom: 7 },
  fieldInput: { backgroundColor: C.white, borderColor: C.line, borderWidth: 1, borderRadius: 11, padding: 11, color: C.dark, fontSize: 13 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  chip: { backgroundColor: C.soft, borderRadius: 17, paddingVertical: 9, paddingHorizontal: 12 },
  chipSelected: { backgroundColor: C.green }, chipLabel: { fontSize: 11, color: C.dark }, chipSelectedLabel: { color: "white", fontWeight: "700" },
  preview: { width: "100%", height: 130, borderRadius: 10, marginBottom: 10 },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 17 },
});
