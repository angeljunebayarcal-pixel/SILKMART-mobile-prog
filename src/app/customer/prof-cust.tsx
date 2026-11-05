
import React, {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";
import {
  useRouter,
  type Href,
} from "expo-router";

import {
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signOut,
  updatePassword,
  type User,
} from "firebase/auth";

import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";

import { auth, db } from "../../firebase/config";

// =====================================
// COLORS - ORIGINAL CUSTOMER DESIGN
// =====================================

const GREEN = "#235F45";
const DARK = "#173B2C";
const MUTED = "#627C6E";
const CREAM = "#FAF9F1";
const SURFACE = "#FFFDF8";
const BORDER = "#D5DDCF";
const RED = "#A43F3F";
const SOFT = "#EAF2E8";

// =====================================
// TYPES
// =====================================

type IconName =
  React.ComponentProps<typeof Ionicons>["name"];

type CustomerProfile = {
  fullName: string;
  email: string;
  phoneNumber: string;
  address: string;
  role: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

type RecentOrder = {
  id: string;
  name: string;
  status: string;
  total: number;
  createdAt: number;
};

type SettingsSection =
  | "main"
  | "password"
  | "security";

type DetailProps = {
  icon: IconName;
  label: string;
  value: string;
  last?: boolean;
};

// =====================================
// HELPERS
// =====================================

function readString(value: unknown): string {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function normalizeProfile(
  data: Record<string, unknown>
): CustomerProfile {
  return {
    fullName: readString(data.fullName),
    email: readString(data.email),
    phoneNumber: readString(data.phoneNumber),
    address: readString(data.address),
    role: readString(data.role).toLowerCase(),
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

function getMillis(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    return Date.parse(value) || 0;
  }

  if (value && typeof value === "object") {
    const data = value as {
      toMillis?: () => number;
      seconds?: number;
    };

    if (typeof data.toMillis === "function") {
      return data.toMillis();
    }

    if (typeof data.seconds === "number") {
      return data.seconds * 1000;
    }
  }

  return 0;
}

function formatDate(value: unknown): string {
  if (!value) return "Not available";

  let date: Date;

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof value.toDate === "function"
  ) {
    date = (value.toDate as () => Date)();
  } else {
    const millis = getMillis(value);
    date = new Date(millis);
  }

  if (Number.isNaN(date.getTime())) {
    return "Not available";
  }

  return date.toLocaleDateString("en-PH", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatAuthDate(value?: string): string {
  if (!value) return "Not available";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not available";
  }

  return date.toLocaleString("en-PH", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getLoginProvider(user: User | null): string {
  if (!user) return "Not available";

  const providers = user.providerData.map(
    item => item.providerId
  );

  if (providers.includes("password")) {
    return "Email and Password";
  }

  if (providers.includes("google.com")) {
    return "Google";
  }

  return providers.length
    ? providers.join(", ")
    : "Not available";
}

function getErrorMessage(reason: unknown): string {
  const code =
    typeof reason === "object" &&
    reason !== null &&
    "code" in reason
      ? String(reason.code)
      : "";

  switch (code) {
    case "permission-denied":
    case "firestore/permission-denied":
      return "Firestore denied this update. Customer profile edits need an allow update rule for users/{uid} permitting fullName, phoneNumber, address, and updatedAt. Check your published Firestore Rules.";

    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Your current password is incorrect.";

    case "auth/weak-password":
      return "Please choose a stronger password.";

    case "auth/requires-recent-login":
      return "Please sign in again before changing your password.";

    case "auth/too-many-requests":
      return "Too many attempts. Please try again later.";

    case "auth/network-request-failed":
    case "unavailable":
    case "firestore/unavailable":
      return "Unable to connect. Check your internet connection.";

    case "not-found":
    case "firestore/not-found":
      return "Your customer profile document no longer exists.";

    default:
      return reason instanceof Error && reason.message
        ? reason.message
        : `Unable to complete this action${code ? ` (${code})` : ""}.`;
  }
}

function formatPrice(value: number): string {
  return `₱${value.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
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
// PERSONAL INFORMATION ROW
// =====================================

function Detail({
  icon,
  label,
  value,
  last = false,
}: DetailProps) {
  return (
    <View
      style={[
        styles.detailRow,
        last && styles.lastDetailRow,
      ]}
    >
      <View style={styles.detailIcon}>
        <Ionicons
          name={icon}
          size={19}
          color={GREEN}
        />
      </View>

      <View style={styles.detailContent}>
        <Text style={styles.detailLabel}>
          {label}
        </Text>

        <Text
          style={styles.detailValue}
          selectable
        >
          {value || "Not available"}
        </Text>
      </View>
    </View>
  );
}

// =====================================
// SETTINGS MENU ROW
// =====================================

function SettingsRow({
  icon,
  title,
  description,
  onPress,
}: {
  icon: IconName;
  title: string;
  description: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.settingsRow,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.settingsIcon}>
        <Ionicons
          name={icon}
          size={20}
          color={GREEN}
        />
      </View>

      <View style={styles.detailContent}>
        <Text style={styles.settingsRowTitle}>
          {title}
        </Text>

        <Text style={styles.settingsRowDescription}>
          {description}
        </Text>
      </View>

      <Ionicons
        name="chevron-forward"
        size={17}
        color={MUTED}
      />
    </Pressable>
  );
}

// =====================================
// PASSWORD INPUT
// =====================================

function PasswordField({
  label,
  value,
  onChangeText,
  visible,
  onToggle,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>
        {label}
      </Text>

      <View style={styles.passwordContainer}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          placeholder={`Enter ${label.toLowerCase()}`}
          placeholderTextColor="#91A198"
          style={styles.passwordInput}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            visible ? "Hide password" : "Show password"
          }
          onPress={onToggle}
          style={styles.eyeButton}
        >
          <Ionicons
            name={
              visible
                ? "eye-off-outline"
                : "eye-outline"
            }
            size={20}
            color={MUTED}
          />
        </Pressable>
      </View>
    </View>
  );
}

// =====================================
// MAIN CUSTOMER PROFILE
// =====================================

export default function CustomerProfileScreen() {
  const router = useRouter();

  // =====================================
  // AUTHENTICATION
  // =====================================

  const [user, setUser] = useState<User | null>(
    auth.currentUser
  );

  const [authReady, setAuthReady] =
    useState(false);

  const [profile, setProfile] =
    useState<CustomerProfile | null>(null);

  const [profileUid, setProfileUid] =
    useState<string | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [success, setSuccess] =
    useState("");

  // =====================================
  // PROFILE EDITING
  // =====================================

  const [editMode, setEditMode] =
    useState(false);

  const [editFullName, setEditFullName] =
    useState("");

  const [editPhone, setEditPhone] =
    useState("");

  const [editAddress, setEditAddress] =
    useState("");

  const [saving, setSaving] =
    useState(false);

  // Prevent live Firestore snapshots from clearing save errors while editing.
  const editModeRef = useRef(false);

  // =====================================
  // RECENT ORDERS
  // =====================================

  const [recentOrders, setRecentOrders] =
    useState<RecentOrder[]>([]);

  const [ordersLoading, setOrdersLoading] =
    useState(false);

  const [ordersError, setOrdersError] =
    useState("");

  // =====================================
  // SETTINGS
  // =====================================

  const [settingsOpen, setSettingsOpen] =
    useState(false);

  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("main");

  const [settingsError, setSettingsError] =
    useState("");

  const [settingsSuccess, setSettingsSuccess] =
    useState("");

  // =====================================
  // PASSWORD
  // =====================================

  const [currentPassword, setCurrentPassword] =
    useState("");

  const [newPassword, setNewPassword] =
    useState("");

  const [confirmPassword, setConfirmPassword] =
    useState("");

  const [showCurrentPassword, setShowCurrentPassword] =
    useState(false);

  const [showNewPassword, setShowNewPassword] =
    useState(false);

  const [showConfirmPassword, setShowConfirmPassword] =
    useState(false);

  const [changingPassword, setChangingPassword] =
    useState(false);

  // =====================================
  // SIGN OUT
  // =====================================

  const [showSignOut, setShowSignOut] =
    useState(false);

  const [busy, setBusy] =
    useState(false);

  // =====================================
  // AUTH LISTENER
  // =====================================

  useEffect(() => {
    return onAuthStateChanged(
      auth,
      nextUser => {
        setUser(nextUser);
        setAuthReady(true);

        setProfile(null);
        setProfileUid(null);
        setLoading(Boolean(nextUser));

        editModeRef.current = false;
        setEditMode(false);
        setSettingsOpen(false);
        setSettingsSection("main");
        setShowSignOut(false);

        setError("");
        setSuccess("");
      }
    );
  }, []);

  // =====================================
  // FIRESTORE PROFILE LISTENER
  // =====================================

  useEffect(() => {
    if (!authReady || !user) {
      setProfile(null);
      setProfileUid(null);
      setLoading(false);
      return;
    }

    const uid = user.uid;
    let active = true;

    setLoading(true);
    setError("");

    const unsubscribe = onSnapshot(
      doc(db, "users", uid),

      snapshot => {
        if (
          !active ||
          auth.currentUser?.uid !== uid
        ) {
          return;
        }

        if (!snapshot.exists()) {
          setProfile(null);
          setProfileUid(uid);

          setError(
            "Your customer profile could not be found."
          );
        } else {
          const data = normalizeProfile(
            snapshot.data()
          );

          setProfile(data);
          setProfileUid(uid);
          if (!editModeRef.current) {
            setError("");
          }
        }

        setLoading(false);
      },

      reason => {
        if (
          !active ||
          auth.currentUser?.uid !== uid
        ) {
          return;
        }

        setProfile(null);
        setProfileUid(uid);
        setError(getErrorMessage(reason));
        setLoading(false);
      }
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [authReady, user?.uid]);

  // =====================================
  // RECENT ORDERS LISTENER
  // =====================================

  useEffect(() => {
    setRecentOrders([]);
    setOrdersError("");

    if (!user) {
      setOrdersLoading(false);
      return;
    }

    let active = true;
    setOrdersLoading(true);

    const uid = user.uid;

    const ordersQuery = query(
      collection(db, "orders"),
      where("customerUid", "==", uid)
    );

    const unsubscribe = onSnapshot(
      ordersQuery,

      snapshot => {
        if (!active) return;

        const results: RecentOrder[] =
          snapshot.docs.map(record => {
            const data = record.data();

            const items = Array.isArray(data.items)
              ? data.items
              : [];

            const itemNames = items
              .map((item: unknown) => {
                if (
                  item &&
                  typeof item === "object" &&
                  "name" in item
                ) {
                  return readString(item.name);
                }

                return "";
              })
              .filter(Boolean);

            const name =
              itemNames.join(", ") ||
              "SilkMart Order";

            return {
              id: record.id,
              name,
              status: readString(data.status) ||
                "Pending",
              total:
                typeof data.total === "number"
                  ? data.total
                  : 0,
              createdAt: getMillis(
                data.createdAt
              ),
            };
          });

        results.sort(
          (a, b) => b.createdAt - a.createdAt
        );

        setRecentOrders(results.slice(0, 1));
        setOrdersLoading(false);
        setOrdersError("");
      },

      reason => {
        if (!active) return;

        console.warn(
          "Unable to load recent orders:",
          reason
        );

        setRecentOrders([]);
        setOrdersLoading(false);

        setOrdersError(
          "Unable to load your recent orders."
        );
      }
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [user?.uid]);

  // =====================================
  // DISPLAY INFORMATION
  // =====================================

  const currentProfile =
    user && profileUid === user.uid
      ? profile
      : null;

  const displayName =
    currentProfile?.fullName ||
    user?.displayName ||
    user?.email?.split("@")[0] ||
    "SilkMart Customer";

  const displayEmail =
    user?.email ||
    "Not available";

  const initial =
    displayName.trim().charAt(0).toUpperCase() ||
    "C";

  const displayRole =
    currentProfile?.role === "customer"
      ? "Customer Account"
      : "Signed-in Account";

  const memberSince = formatDate(
    currentProfile?.createdAt ||
    user?.metadata.creationTime
  );

  const accountCreated = formatAuthDate(
    user?.metadata.creationTime
  );

  const lastSignIn = formatAuthDate(
    user?.metadata.lastSignInTime
  );

  const loginProvider = getLoginProvider(user);

  const passwordProvider =
    user?.providerData.some(
      provider => provider.providerId === "password"
    ) ?? false;

  const canEdit =
    Boolean(user) &&
    Boolean(currentProfile) &&
    currentProfile?.role === "customer";

  // =====================================
  // EDIT PROFILE
  // =====================================

  function enableEdit() {
    if (!canEdit || saving) return;

    setEditFullName(
      currentProfile?.fullName || ""
    );

    setEditPhone(
      currentProfile?.phoneNumber || ""
    );

    setEditAddress(
      currentProfile?.address || ""
    );

    setError("");
    setSuccess("");
    editModeRef.current = true;
    setEditMode(true);
  }

  function cancelEdit() {
    if (saving) return;

    editModeRef.current = false;
    setEditMode(false);
    setError("");
  }

  async function saveProfile() {
    if (
      !user ||
      !currentProfile ||
      !canEdit ||
      saving
    ) {
      return;
    }

    const fullName = editFullName.trim();
    const phoneNumber = editPhone.trim();
    const address = editAddress.trim();

    setError("");
    setSuccess("");

    if (!fullName) {
      setError("Full name is required.");
      return;
    }

    if (fullName.length > 120) {
      setError(
        "Full name must be 120 characters or fewer."
      );
      return;
    }

    if (
      phoneNumber &&
      !/^[0-9+\s()-]{7,30}$/.test(phoneNumber)
    ) {
      setError(
        "Please enter a valid phone number."
      );
      return;
    }

    if (address.length > 500) {
      setError(
        "Address must be 500 characters or fewer."
      );
      return;
    }

    const uid = user.uid;

    setSaving(true);

    try {
      await updateDoc(
        doc(db, "users", uid),
        {
          fullName,
          phoneNumber,
          address,
          updatedAt: serverTimestamp(),
        }
      );

      if (auth.currentUser?.uid !== uid) {
        return;
      }

      editModeRef.current = false;
      setEditMode(false);

      setSuccess(
        "Your profile has been updated successfully."
      );
    } catch (reason) {
      console.error("SilkMart customer profile save failed:", reason);
      setError(getErrorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  // =====================================
  // SETTINGS
  // =====================================

  function clearPasswordFields() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");

    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
  }

  function openSettings() {
    setSettingsSection("main");
    setSettingsError("");
    setSettingsSuccess("");
    setSettingsOpen(true);
  }

  function closeSettings() {
    if (changingPassword || busy) return;

    setSettingsOpen(false);
    setSettingsSection("main");
    setSettingsError("");
    setSettingsSuccess("");
    clearPasswordFields();
  }

  function openSettingsSection(
    section: SettingsSection
  ) {
    setSettingsSection(section);
    setSettingsError("");
    setSettingsSuccess("");

    if (section === "password") {
      clearPasswordFields();
    }
  }

  // =====================================
  // CHANGE PASSWORD
  // =====================================

  async function changePassword() {
    if (!user || changingPassword) return;

    setSettingsError("");
    setSettingsSuccess("");

    if (!passwordProvider || !user.email) {
      setSettingsError(
        "Password changes here are only available for email-and-password accounts."
      );
      return;
    }

    if (
      !currentPassword ||
      !newPassword ||
      !confirmPassword
    ) {
      setSettingsError(
        "Please complete all password fields."
      );
      return;
    }

    if (newPassword.length < 8) {
      setSettingsError(
        "Your new password must contain at least 8 characters."
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      setSettingsError(
        "New password and confirmation do not match."
      );
      return;
    }

    if (currentPassword === newPassword) {
      setSettingsError(
        "Your new password must be different from your current password."
      );
      return;
    }

    setChangingPassword(true);

    try {
      const credential =
        EmailAuthProvider.credential(
          user.email,
          currentPassword
        );

      await reauthenticateWithCredential(
        user,
        credential
      );

      await updatePassword(user, newPassword);

      clearPasswordFields();

      setSettingsSuccess(
        "Your password has been changed successfully."
      );
    } catch (reason) {
      setSettingsError(
        getErrorMessage(reason)
      );
    } finally {
      setChangingPassword(false);
    }
  }

  // =====================================
  // SIGN OUT
  // =====================================

  async function confirmSignOut() {
    if (busy) return;

    setBusy(true);
    setSettingsError("");

    try {
      await signOut(auth);

      setProfile(null);
      setProfileUid(null);

      setShowSignOut(false);
      setSettingsOpen(false);

      router.replace("/login");
    } catch (reason) {
      setShowSignOut(false);
      setSettingsError(getErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  // =====================================
  // NAVIGATION
  // =====================================

  function goToOrders() {
    router.push("/customer/order" as Href);
  }

  // =====================================
  // SCREEN
  // =====================================

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" />

      {/* HEADER */}

      <View style={styles.header}>
        <Pressable
          style={styles.back}
          onPress={() =>
            router.push("/customer/shopsilk")
          }
          accessibilityRole="button"
          accessibilityLabel="Back to Shop Silk"
        >
          <Ionicons
            name="arrow-back"
            size={21}
            color={GREEN}
          />
        </Pressable>

        <Text style={styles.headerTitle}>
          My Profile
        </Text>

        <View style={{ width: 36 }} />
      </View>

      {/* CONTENT */}

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <FadeUp delay={100}>
          <Text style={styles.eyebrow}>
            YOUR ACCOUNT
          </Text>

          <Text style={styles.title}>
            My profile.
          </Text>

          <Text style={styles.intro}>
            Manage your SilkMart customer
            information and account settings.
          </Text>
        </FadeUp>

        {!authReady ? (
          <ActivityIndicator
            color={GREEN}
            size="large"
            style={styles.loading}
          />
        ) : !user ? (
          // =====================================
          // GUEST VIEW
          // =====================================

          <FadeUp delay={200}>
            <View style={styles.card}>
              <View style={styles.avatar}>
                <Ionicons
                  name="person-outline"
                  size={37}
                  color={GREEN}
                />
              </View>

              <Text style={styles.name}>
                Welcome, guest
              </Text>

              <Text style={styles.subtitle}>
                Sign in to view your
                customer account information.
              </Text>

              <Pressable
                style={styles.primary}
                onPress={() =>
                  router.push("/login")
                }
              >
                <Text style={styles.primaryText}>
                  Go to Login
                </Text>
              </Pressable>
            </View>
          </FadeUp>
        ) : (
          <>
            {/* =====================================
                CUSTOMER PROFILE CARD
                ===================================== */}

            <FadeUp delay={200}>
              <View style={styles.card}>
                <View style={styles.avatar}>
                  <Text style={styles.initial}>
                    {initial}
                  </Text>
                </View>

                <Text style={styles.name}>
                  {displayName}
                </Text>

                <Text style={styles.subtitle}>
                  {displayEmail}
                </Text>

                <View style={styles.rolePill}>
                  <Ionicons
                    name="checkmark-circle-outline"
                    size={16}
                    color={GREEN}
                  />

                  <Text style={styles.roleText}>
                    {displayRole}
                  </Text>
                </View>
              </View>
            </FadeUp>

            {/* =====================================
                PERSONAL INFORMATION
                ===================================== */}

            <FadeUp delay={280}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionLabel}>
                  PERSONAL INFORMATION
                </Text>

                {!editMode && canEdit && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={enableEdit}
                    style={styles.editButton}
                  >
                    <Ionicons
                      name="create-outline"
                      size={16}
                      color={GREEN}
                    />

                    <Text style={styles.editButtonText}>
                      Edit
                    </Text>
                  </Pressable>
                )}
              </View>

              {loading ? (
                <ActivityIndicator
                  color={GREEN}
                  style={styles.loading}
                />
              ) : editMode ? (
                <View style={styles.details}>
                  <View style={styles.editForm}>
                    <Text style={styles.fieldLabel}>
                      Full Name
                    </Text>

                    <TextInput
                      value={editFullName}
                      onChangeText={setEditFullName}
                      maxLength={120}
                      placeholder="Enter your full name"
                      placeholderTextColor="#91A198"
                      style={styles.input}
                    />

                    <Text style={styles.fieldLabel}>
                      Email Address
                    </Text>

                    <View style={styles.disabledField}>
                      <Text style={styles.disabledText}>
                        {displayEmail}
                      </Text>
                    </View>

                    <Text style={styles.fieldHint}>
                      Email is managed by Firebase Authentication.
                    </Text>

                    <Text style={styles.fieldLabel}>
                      Mobile Number
                    </Text>

                    <TextInput
                      value={editPhone}
                      onChangeText={setEditPhone}
                      keyboardType="phone-pad"
                      maxLength={30}
                      placeholder="Enter your mobile number"
                      placeholderTextColor="#91A198"
                      style={styles.input}
                    />

                    <Text style={styles.fieldLabel}>
                      Complete Address
                    </Text>

                    <TextInput
                      value={editAddress}
                      onChangeText={setEditAddress}
                      multiline
                      numberOfLines={4}
                      maxLength={500}
                      textAlignVertical="top"
                      placeholder="Enter your complete address"
                      placeholderTextColor="#91A198"
                      style={[
                        styles.input,
                        styles.addressInput,
                      ]}
                    />

                    <View style={styles.editActions}>
                      <Pressable
                        disabled={saving}
                        onPress={cancelEdit}
                        style={styles.cancelAction}
                      >
                        <Text style={styles.cancelActionText}>
                          Cancel
                        </Text>
                      </Pressable>

                      <Pressable
                        disabled={saving}
                        onPress={() =>
                          void saveProfile()
                        }
                        style={[
                          styles.saveAction,
                          saving && styles.disabledButton,
                        ]}
                      >
                        {saving ? (
                          <ActivityIndicator
                            size="small"
                            color="#FFFFFF"
                          />
                        ) : (
                          <Ionicons
                            name="checkmark-outline"
                            size={18}
                            color="#FFFFFF"
                          />
                        )}

                        <Text style={styles.saveActionText}>
                          {saving
                            ? "Saving..."
                            : "Save Changes"}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
              ) : (
                <View style={styles.details}>
                  <Detail
                    icon="person-outline"
                    label="Full Name"
                    value={
                      currentProfile?.fullName ||
                      user.displayName ||
                      "Not available"
                    }
                  />

                  <Detail
                    icon="mail-outline"
                    label="Email Address"
                    value={displayEmail}
                  />

                  <Detail
                    icon="call-outline"
                    label="Mobile Number"
                    value={
                      currentProfile?.phoneNumber ||
                      "Not available"
                    }
                  />

                  <Detail
                    icon="location-outline"
                    label="Complete Address"
                    value={
                      currentProfile?.address ||
                      "Not available"
                    }
                    last
                  />
                </View>
              )}

              {!!error && (
                <Text style={styles.error}>
                  {error}
                </Text>
              )}

              {!!success && (
                <Text style={styles.success}>
                  {success}
                </Text>
              )}

              <Text style={styles.help}>
                Your contact information is used
                when reviewing SilkMart orders
                and coordinating deliveries.
              </Text>
            </FadeUp>

            {/* =====================================
                ACCOUNT INFORMATION
                ===================================== */}

            <FadeUp delay={340}>
              <Text style={styles.sectionLabel}>
                ACCOUNT INFORMATION
              </Text>

              <View style={styles.details}>
                <Detail
                  icon="person-circle-outline"
                  label="Account Role"
                  value={displayRole}
                />

                <Detail
                  icon="calendar-outline"
                  label="Member Since"
                  value={memberSince}
                />

                <Detail
                  icon="shield-checkmark-outline"
                  label="Authentication"
                  value="Signed In"
                />

                <SettingsRow
                  icon="settings-outline"
                  title="Account Settings"
                  description="Password, security, and sign out"
                  onPress={openSettings}
                />
              </View>
            </FadeUp>

            {/* =====================================
                RECENT ORDERS
                ===================================== */}

            <FadeUp delay={400}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionLabel}>
                  RECENT ORDERS
                </Text>

                <Pressable
                  accessibilityRole="button"
                  onPress={goToOrders}
                  style={styles.viewAll}
                >
                  <Text style={styles.viewAllText}>
                    View All
                  </Text>

                  <Ionicons
                    name="chevron-forward"
                    size={15}
                    color={GREEN}
                  />
                </Pressable>
              </View>

              <View style={styles.details}>
                {ordersLoading ? (
                  <View style={styles.ordersEmpty}>
                    <ActivityIndicator
                      color={GREEN}
                    />

                    <Text style={styles.ordersEmptyText}>
                      Loading your orders...
                    </Text>
                  </View>
                ) : ordersError ? (
                  <View style={styles.ordersEmpty}>
                    <Ionicons
                      name="alert-circle-outline"
                      size={25}
                      color={RED}
                    />

                    <Text style={styles.ordersEmptyText}>
                      {ordersError}
                    </Text>
                  </View>
                ) : recentOrders.length === 0 ? (
                  <View style={styles.ordersEmpty}>
                    <Ionicons
                      name="bag-handle-outline"
                      size={27}
                      color={GREEN}
                    />

                    <Text style={styles.ordersEmptyText}>
                      You don't have any orders yet.
                    </Text>
                  </View>
                ) : (
                  recentOrders.map(order => (
                    <View
                      key={order.id}
                      style={styles.orderRow}
                    >
                      <View style={styles.detailIcon}>
                        <Ionicons
                          name="cube-outline"
                          size={20}
                          color={GREEN}
                        />
                      </View>

                      <View style={styles.detailContent}>
                        <Text
                          style={styles.orderName}
                          numberOfLines={2}
                        >
                          {order.name}
                        </Text>

                        <Text style={styles.orderDate}>
                          {formatDate(order.createdAt)}
                        </Text>

                        <Text style={styles.orderStatus}>
                          {order.status}
                        </Text>
                      </View>

                      <Text style={styles.orderTotal}>
                        {formatPrice(order.total)}
                      </Text>
                    </View>
                  ))
                )}
              </View>
            </FadeUp>
          </>
        )}
      </ScrollView>

      {/* =====================================
          ACCOUNT SETTINGS
          ===================================== */}

      <Modal
        visible={settingsOpen}
        transparent
        animationType="fade"
        onRequestClose={closeSettings}
      >
        <KeyboardAvoidingView
          style={styles.confirmBackdrop}
          behavior={
            Platform.OS === "ios"
              ? "padding"
              : undefined
          }
        >
          <View style={styles.settingsCard}>
            <View style={styles.settingsHeader}>
              <Pressable
                onPress={() => {
                  if (settingsSection === "main") {
                    closeSettings();
                  } else if (!changingPassword) {
                    setSettingsSection("main");
                    setSettingsError("");
                    setSettingsSuccess("");
                    clearPasswordFields();
                  }
                }}
                style={styles.settingsBack}
              >
                <Ionicons
                  name={
                    settingsSection === "main"
                      ? "close"
                      : "arrow-back"
                  }
                  size={22}
                  color={DARK}
                />
              </Pressable>

              <Text style={styles.settingsHeading}>
                {settingsSection === "main"
                  ? "Account Settings"
                  : settingsSection === "password"
                  ? "Change Password"
                  : "Security & Login"}
              </Text>

              <View style={{ width: 35 }} />
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.settingsContent}
            >
              {settingsSection === "main" && (
                <>
                  <Text style={styles.settingsIntro}>
                    Manage your customer account
                    and security preferences.
                  </Text>

                  <SettingsRow
                    icon="lock-closed-outline"
                    title="Change Password"
                    description="Securely update your account password"
                    onPress={() =>
                      openSettingsSection("password")
                    }
                  />

                  <SettingsRow
                    icon="shield-checkmark-outline"
                    title="Security & Login Activity"
                    description="View Firebase account information"
                    onPress={() =>
                      openSettingsSection("security")
                    }
                  />

                  <Pressable
                    onPress={() => setShowSignOut(true)}
                    style={styles.settingsSignOut}
                  >
                    <Ionicons
                      name="log-out-outline"
                      size={20}
                      color={RED}
                    />

                    <Text style={styles.settingsSignOutText}>
                      Sign Out
                    </Text>

                    <Ionicons
                      name="chevron-forward"
                      size={17}
                      color={RED}
                    />
                  </Pressable>
                </>
              )}

              {/* CHANGE PASSWORD */}

              {settingsSection === "password" && (
                <>
                  <Text style={styles.settingsIntro}>
                    Verify your current password
                    before choosing a new one.
                  </Text>

                  {!passwordProvider ? (
                    <Text style={styles.settingsNotice}>
                      Password changes through this form
                      are only available for accounts
                      using email and password.
                    </Text>
                  ) : (
                    <>
                      <PasswordField
                        label="Current Password"
                        value={currentPassword}
                        onChangeText={setCurrentPassword}
                        visible={showCurrentPassword}
                        onToggle={() =>
                          setShowCurrentPassword(v => !v)
                        }
                      />

                      <PasswordField
                        label="New Password"
                        value={newPassword}
                        onChangeText={setNewPassword}
                        visible={showNewPassword}
                        onToggle={() =>
                          setShowNewPassword(v => !v)
                        }
                      />

                      <PasswordField
                        label="Confirm New Password"
                        value={confirmPassword}
                        onChangeText={setConfirmPassword}
                        visible={showConfirmPassword}
                        onToggle={() =>
                          setShowConfirmPassword(v => !v)
                        }
                      />

                      <Text style={styles.fieldHint}>
                        Use at least 8 characters.
                      </Text>

                      <Pressable
                        disabled={changingPassword}
                        onPress={() =>
                          void changePassword()
                        }
                        style={[
                          styles.settingsPrimary,
                          changingPassword &&
                            styles.disabledButton,
                        ]}
                      >
                        {changingPassword && (
                          <ActivityIndicator
                            color="#FFFFFF"
                            size="small"
                          />
                        )}

                        <Text style={styles.primaryText}>
                          {changingPassword
                            ? "Updating Password..."
                            : "Update Password"}
                        </Text>
                      </Pressable>
                    </>
                  )}
                </>
              )}

              {/* SECURITY & LOGIN */}

              {settingsSection === "security" && (
                <>
                  <Text style={styles.settingsIntro}>
                    Your Firebase Authentication
                    account security information.
                  </Text>

                  <Detail
                    icon="calendar-outline"
                    label="Account Created"
                    value={accountCreated}
                  />

                  <Detail
                    icon="time-outline"
                    label="Last Sign In"
                    value={lastSignIn}
                  />

                  <Detail
                    icon="key-outline"
                    label="Login Provider"
                    value={loginProvider}
                  />

                  <Detail
                    icon="mail-outline"
                    label="Account Email"
                    value={displayEmail}
                    last
                  />

                  <Text style={styles.settingsNotice}>
                    Last Sign In shows the latest
                    sign-in timestamp available from
                    Firebase. It is not a complete
                    history of previous sessions.
                  </Text>
                </>
              )}

              {!!settingsError && (
                <Text style={styles.error}>
                  {settingsError}
                </Text>
              )}

              {!!settingsSuccess && (
                <Text style={styles.success}>
                  {settingsSuccess}
                </Text>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* =====================================
          SIGN OUT CONFIRMATION
          ===================================== */}

      <Modal
        visible={showSignOut}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!busy) setShowSignOut(false);
        }}
      >
        <View style={styles.confirmBackdrop}>
          <View style={styles.confirmCard}>
            <View style={styles.confirmIcon}>
              <Ionicons
                name="log-out-outline"
                size={33}
                color={RED}
              />
            </View>

            <Text style={styles.confirmTitle}>
              Sign Out
            </Text>

            <Text style={styles.confirmDescription}>
              Are you sure you want to
              sign out of your SilkMart account?
            </Text>

            <Pressable
              disabled={busy}
              style={[
                styles.confirmButton,
                busy && styles.disabledButton,
              ]}
              onPress={() =>
                void confirmSignOut()
              }
            >
              {busy ? (
                <ActivityIndicator
                  size="small"
                  color="#FFFFFF"
                />
              ) : (
                <Text style={styles.confirmButtonText}>
                  Confirm Sign Out
                </Text>
              )}
            </Pressable>

            <Pressable
              disabled={busy}
              onPress={() => setShowSignOut(false)}
              style={styles.confirmCancel}
            >
              <Text style={styles.confirmCancelText}>
                Cancel
              </Text>
            </Pressable>
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

  // HEADER

  header: {
    height: 68,
    paddingHorizontal: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: SURFACE,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
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

  // CONTENT

  content: {
    padding: 22,
    paddingTop: 32,
    paddingBottom: 45,
  },

  eyebrow: {
    color: GREEN,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2,
  },

  title: {
    color: DARK,
    fontFamily: "serif",
    fontSize: 36,
    marginTop: 10,
  },

  intro: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 21,
    marginTop: 8,
  },

  loading: {
    marginVertical: 30,
  },

  // CUSTOMER PROFILE CARD

  card: {
    alignItems: "center",
    marginTop: 26,
    backgroundColor: SURFACE,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 20,
    paddingVertical: 30,
  },

  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: "#E2EDD7",
    alignItems: "center",
    justifyContent: "center",
  },

  initial: {
    color: GREEN,
    fontFamily: "serif",
    fontSize: 41,
    textAlign: "center",
    includeFontPadding: false,
  },

  name: {
    color: DARK,
    fontFamily: "serif",
    fontSize: 26,
    marginTop: 15,
    textAlign: "center",
  },

  subtitle: {
    color: MUTED,
    fontSize: 12,
    marginTop: 6,
    textAlign: "center",
  },

  rolePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#E8F0E7",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginTop: 17,
  },

  roleText: {
    fontSize: 11,
    color: GREEN,
    fontWeight: "700",
  },

  // SECTION HEADINGS

  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },

  sectionLabel: {
    fontSize: 10,
    color: GREEN,
    fontWeight: "700",
    letterSpacing: 1.5,
    marginTop: 26,
    marginBottom: 12,
  },

  editButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: SOFT,
    borderRadius: 11,
    marginTop: 15,
  },

  editButtonText: {
    color: GREEN,
    fontSize: 11,
    fontWeight: "700",
  },

  // PERSONAL INFORMATION

  details: {
    paddingHorizontal: 15,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    backgroundColor: SURFACE,
  },

  detailRow: {
    paddingVertical: 17,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E4EADF",
  },

  lastDetailRow: {
    borderBottomWidth: 0,
  },

  detailIcon: {
    width: 37,
    height: 37,
    borderRadius: 19,
    backgroundColor: SOFT,
    alignItems: "center",
    justifyContent: "center",
  },

  detailContent: {
    flex: 1,
    minWidth: 0,
  },

  detailLabel: {
    fontSize: 10,
    color: MUTED,
  },

  detailValue: {
    marginTop: 3,
    fontSize: 13,
    fontWeight: "600",
    color: DARK,
    lineHeight: 20,
  },

  help: {
    marginVertical: 20,
    fontSize: 11,
    lineHeight: 18,
    color: MUTED,
  },

  // EDIT FORM

  editForm: {
    paddingVertical: 15,
  },

  fieldGroup: {
    marginTop: 14,
  },

  fieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: DARK,
    marginTop: 12,
    marginBottom: 7,
  },

  fieldHint: {
    fontSize: 10,
    color: MUTED,
    lineHeight: 17,
    marginTop: 6,
  },

  input: {
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SURFACE,
    borderRadius: 11,
    paddingHorizontal: 13,
    paddingVertical: 12,
    fontSize: 13,
    color: DARK,
  },

  disabledField: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 11,
    backgroundColor: "#F2F4EF",
    padding: 13,
  },

  disabledText: {
    color: MUTED,
    fontSize: 12,
  },

  addressInput: {
    minHeight: 105,
  },

  editActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 20,
  },

  cancelAction: {
    flex: 1,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 13,
    alignItems: "center",
    justifyContent: "center",
  },

  cancelActionText: {
    color: GREEN,
    fontSize: 12,
    fontWeight: "700",
  },

  saveAction: {
    flex: 1,
    flexDirection: "row",
    gap: 7,
    backgroundColor: GREEN,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    padding: 13,
  },

  saveActionText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },

  // FEEDBACK

  error: {
    marginTop: 12,
    fontSize: 12,
    lineHeight: 18,
    color: RED,
  },

  success: {
    marginTop: 12,
    fontSize: 12,
    lineHeight: 18,
    color: GREEN,
  },

  // SETTINGS ROWS

  settingsRow: {
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E4EADF",
  },

  settingsIcon: {
    width: 37,
    height: 37,
    borderRadius: 19,
    backgroundColor: SOFT,
    alignItems: "center",
    justifyContent: "center",
  },

  settingsRowTitle: {
    color: DARK,
    fontSize: 13,
    fontWeight: "700",
  },

  settingsRowDescription: {
    color: MUTED,
    fontSize: 10,
    lineHeight: 17,
    marginTop: 4,
  },

  // RECENT ORDERS

  viewAll: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 8,
    marginTop: 14,
  },

  viewAllText: {
    color: GREEN,
    fontSize: 11,
    fontWeight: "700",
  },

  ordersEmpty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 27,
    gap: 11,
  },

  ordersEmptyText: {
    color: MUTED,
    fontSize: 12,
    textAlign: "center",
  },

  orderRow: {
    flexDirection: "row",
    gap: 11,
    alignItems: "center",
    paddingVertical: 18,
  },

  orderName: {
    color: DARK,
    fontSize: 12,
    fontWeight: "700",
  },

  orderDate: {
    color: MUTED,
    fontSize: 10,
    marginTop: 5,
  },

  orderStatus: {
    color: GREEN,
    fontSize: 10,
    fontWeight: "700",
    marginTop: 6,
  },

  orderTotal: {
    color: DARK,
    fontSize: 11,
    fontWeight: "700",
  },

  // SETTINGS MODAL

  settingsCard: {
    backgroundColor: SURFACE,
    borderRadius: 20,
    width: "100%",
    maxWidth: 440,
    maxHeight: "85%",
    overflow: "hidden",
  },

  settingsHeader: {
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 15,
  },

  settingsBack: {
    width: 35,
    height: 35,
    justifyContent: "center",
    alignItems: "center",
  },

  settingsHeading: {
    fontFamily: "serif",
    fontSize: 21,
    color: DARK,
  },

  settingsContent: {
    padding: 20,
    paddingBottom: 28,
  },

  settingsIntro: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 19,
    marginBottom: 12,
  },

  settingsNotice: {
    marginTop: 17,
    backgroundColor: SOFT,
    borderRadius: 11,
    padding: 12,
    color: MUTED,
    fontSize: 11,
    lineHeight: 19,
  },

  settingsSignOut: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 17,
    marginTop: 18,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },

  settingsSignOutText: {
    flex: 1,
    color: RED,
    fontSize: 13,
    fontWeight: "700",
  },

  // PASSWORD

  passwordContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 11,
  },

  passwordInput: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 13,
    paddingVertical: 12,
    fontSize: 13,
    color: DARK,
  },

  eyeButton: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },

  settingsPrimary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: GREEN,
    padding: 15,
    borderRadius: 13,
    marginTop: 20,
  },

  // BUTTONS

  primary: {
    alignSelf: "stretch",
    backgroundColor: GREEN,
    borderRadius: 24,
    paddingVertical: 15,
    marginTop: 24,
    alignItems: "center",
  },

  primaryText: {
    fontSize: 13,
    color: "#FFFFFF",
    fontWeight: "700",
  },

  pressed: {
    opacity: 0.82,
  },

  disabledButton: {
    opacity: 0.55,
  },

  // SIGN OUT CONFIRMATION

  confirmBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },

  confirmCard: {
    backgroundColor: SURFACE,
    borderRadius: 20,
    alignItems: "center",
    width: "100%",
    maxWidth: 400,
    padding: 25,
  },

  confirmIcon: {
    width: 65,
    height: 65,
    borderRadius: 33,
    backgroundColor: "#FFF1EE",
    alignItems: "center",
    justifyContent: "center",
  },

  confirmTitle: {
    fontFamily: "serif",
    fontSize: 27,
    color: DARK,
    marginTop: 15,
  },

  confirmDescription: {
    fontSize: 13,
    color: MUTED,
    textAlign: "center",
    lineHeight: 20,
    marginVertical: 15,
  },

  confirmButton: {
    backgroundColor: RED,
    borderRadius: 25,
    height: 48,
    alignSelf: "stretch",
    width: "100%",
    justifyContent: "center",
    alignItems: "center",
  },

  confirmButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
  },

  confirmCancel: {
    padding: 14,
    marginTop: 7,
  },

  confirmCancelText: {
    color: GREEN,
    fontWeight: "700",
  },
});
