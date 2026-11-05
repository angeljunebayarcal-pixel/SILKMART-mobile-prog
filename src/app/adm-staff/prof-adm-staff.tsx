import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";

import {
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signOut,
  updatePassword,
  type User,
} from "firebase/auth";

import {
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { auth, db } from "../../firebase/config";
import { C, Fade, Heading, S } from "../../components/AdminUI";

// =====================================
// TYPES
// =====================================

type IconName =
  React.ComponentProps<typeof Ionicons>["name"];

type NotificationPreferences = {
  newOrders: boolean;
  deliveryUpdates: boolean;
  lowInventory: boolean;
  staffApplications: boolean;
};

type StaffProfile = {
  fullName?: string;
  email?: string;
  phoneNumber?: string;
  address?: string;
  role?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  isActive?: boolean;
  notificationPreferences?: Partial<NotificationPreferences>;
};

type SettingsSection =
  | "main"
  | "password"
  | "security"
  | "notifications";

const DEFAULT_PREFERENCES: NotificationPreferences = {
  newOrders: true,
  deliveryUpdates: true,
  lowInventory: true,
  staffApplications: true,
};

const RED = "#A43F3F";
const SURFACE = "#FFFDF8";

// =====================================
// HELPERS
// =====================================

function getDisplayName(
  profile: StaffProfile | null,
  user: User | null
): string {
  const fullName = profile?.fullName?.trim();

  if (fullName) return fullName;

  if (user?.displayName?.trim()) {
    return user.displayName.trim();
  }

  return (
    user?.email?.split("@")[0] ||
    "SilkMart Staff"
  );
}

function getInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "S";
}

function getRoleLabel(role?: string): string {
  const value = role?.trim().toLowerCase();

  if (
    value === "administrator" ||
    value === "admin"
  ) {
    return "Administrator";
  }

  if (value === "staff") {
    return "Staff";
  }

  return "Unauthorized";
}

function isAuthorizedRole(role?: string): boolean {
  const value = role?.trim().toLowerCase();

  return [
    "administrator",
    "admin",
    "staff",
  ].includes(value || "");
}

function displayValue(value?: string | null): string {
  return value?.trim() || "Not available";
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
  } else if (
    typeof value === "object" &&
    value !== null &&
    "seconds" in value &&
    typeof value.seconds === "number"
  ) {
    date = new Date(value.seconds * 1000);
  } else {
    date = new Date(value as string | number);
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
    provider => provider.providerId
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

function normalizePreferences(
  saved?: Partial<NotificationPreferences>
): NotificationPreferences {
  return {
    newOrders:
      typeof saved?.newOrders === "boolean"
        ? saved.newOrders
        : true,

    deliveryUpdates:
      typeof saved?.deliveryUpdates === "boolean"
        ? saved.deliveryUpdates
        : true,

    lowInventory:
      typeof saved?.lowInventory === "boolean"
        ? saved.lowInventory
        : true,

    staffApplications:
      typeof saved?.staffApplications === "boolean"
        ? saved.staffApplications
        : true,
  };
}

function firebaseErrorMessage(error: unknown): string {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error
      ? String(error.code)
      : "";

  switch (code) {
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

    case "permission-denied":
    case "firestore/permission-denied":
      return "Firestore blocked your profile update. Verify that the published users/{uid} rules permit an Admin/Staff account to update its own fullName, phoneNumber, address and updatedAt fields, and that your saved role is lowercase (admin, administrator or staff).";

    case "not-found":
    case "firestore/not-found":
      return "Your user profile document was not found in Firestore.";

    default:
      return error instanceof Error && error.message
        ? error.message
        : `Unable to save changes${code ? ` (${code})` : ""}.`;
  }
}

// =====================================
// INFORMATION ROW
// =====================================

function InformationRow({
  label,
  value,
  icon,
  last = false,
}: {
  label: string;
  value: string;
  icon: IconName;
  last?: boolean;
}) {
  return (
    <View
      style={[
        styles.infoRow,
        last && styles.lastInfoRow,
      ]}
    >
      <View style={styles.infoIcon}>
        <Ionicons
          name={icon}
          size={17}
          color={C.green}
        />
      </View>

      <View style={styles.infoContent}>
        <Text style={styles.infoLabel}>
          {label}
        </Text>

        <Text style={styles.infoValue} selectable>
          {value}
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
        pressed && { opacity: 0.75 },
      ]}
    >
      <View style={styles.settingsRowIcon}>
        <Ionicons
          name={icon}
          size={21}
          color={C.green}
        />
      </View>

      <View style={{ flex: 1 }}>
        <Text style={styles.settingsRowTitle}>
          {title}
        </Text>

        <Text style={styles.settingsRowDescription}>
          {description}
        </Text>
      </View>

      <Ionicons
        name="chevron-forward"
        color={C.muted}
        size={17}
      />
    </Pressable>
  );
}

// =====================================
// SETTINGS FIELD
// =====================================

function PasswordField({
  label,
  value,
  onChangeText,
  visible,
  onToggleVisibility,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  visible: boolean;
  onToggleVisibility: () => void;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>
        {label}
      </Text>

      <View style={styles.passwordField}>
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
          onPress={onToggleVisibility}
          style={styles.eyeButton}
        >
          <Ionicons
            name={visible ? "eye-off-outline" : "eye-outline"}
            size={20}
            color={C.muted}
          />
        </Pressable>
      </View>
    </View>
  );
}

// =====================================
// ADMIN / STAFF PROFILE
// =====================================

export default function AdminProfile() {
  const router = useRouter();

  // =====================================
  // AUTHENTICATION AND PROFILE
  // =====================================

  const [user, setUser] = useState<User | null>(
    auth.currentUser
  );

  const [authReady, setAuthReady] =
    useState(false);

  const [profile, setProfile] =
    useState<StaffProfile | null>(null);

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

  const [savingProfile, setSavingProfile] =
    useState(false);

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
  // NOTIFICATION PREFERENCES
  // =====================================

  const [preferences, setPreferences] =
    useState<NotificationPreferences>({
      ...DEFAULT_PREFERENCES,
    });

  const [savingPreferences, setSavingPreferences] =
    useState(false);

  // Keep the latest editing state without restarting
  // the Firestore listener when the user clicks Edit.
  const editModeRef = useRef(editMode);
  const savingPreferencesRef = useRef(savingPreferences);

  useEffect(() => {
    editModeRef.current = editMode;
    savingPreferencesRef.current = savingPreferences;
  }, [editMode, savingPreferences]);

  // =====================================
  // SIGN OUT
  // =====================================

  const [confirmSignOut, setConfirmSignOut] =
    useState(false);

  const [signingOut, setSigningOut] =
    useState(false);

  // =====================================
  // AUTHENTICATION LISTENER
  // =====================================

  useEffect(() => {
    return onAuthStateChanged(
      auth,
      nextUser => {
        setUser(nextUser);
        setAuthReady(true);

        setProfile(null);
        setLoading(Boolean(nextUser));

        setEditMode(false);
        setSettingsOpen(false);
        setSettingsSection("main");
        setConfirmSignOut(false);

        setError("");
        setSuccess("");
      }
    );
  }, []);

  // =====================================
  // FIRESTORE PROFILE LISTENER
  // =====================================

  useEffect(() => {
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }

    let active = true;

    setLoading(true);
    setError("");

    const unsubscribe = onSnapshot(
      doc(db, "users", user.uid),

      snapshot => {
        if (!active) return;

        if (snapshot.exists()) {
          const data = snapshot.data() as StaffProfile;

          setProfile(data);

          if (!editModeRef.current) {
            setEditFullName(data.fullName || "");
            setEditPhone(data.phoneNumber || "");
            setEditAddress(data.address || "");
          }

          if (!savingPreferencesRef.current) {
            setPreferences(
              normalizePreferences(
                data.notificationPreferences
              )
            );
          }

          // Don't erase a save failure while the user is editing.
          if (!editModeRef.current) {
            setError("");
          }
        } else {
          setProfile(null);

          setError(
            "Your SilkMart staff profile was not found."
          );
        }

        setLoading(false);
      },

      reason => {
        if (!active) return;

        console.warn(
          "Unable to load staff profile:",
          reason
        );

        setError(
          "Unable to load your profile. Check your connection."
        );

        setLoading(false);
      }
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [user?.uid]);

  // =====================================
  // DERIVED PROFILE INFORMATION
  // =====================================

  const displayName = useMemo(
    () => getDisplayName(profile, user),
    [profile, user]
  );

  const initial = getInitial(displayName);

  const roleLabel = getRoleLabel(
    profile?.role
  );

  const authorized = isAuthorizedRole(
    profile?.role
  );

  const email = displayValue(
    user?.email
  );

  const phone = displayValue(
    profile?.phoneNumber
  );

  const address = displayValue(
    profile?.address
  );

  const memberSince = formatDate(
    profile?.createdAt ||
      user?.metadata.creationTime
  );

  const lastUpdated = formatDate(
    profile?.updatedAt
  );

  const lastSignIn = formatAuthDate(
    user?.metadata.lastSignInTime
  );

  const accountCreated = formatAuthDate(
    user?.metadata.creationTime
  );

  const loginProvider = getLoginProvider(user);

  const passwordProvider =
    user?.providerData.some(
      provider => provider.providerId === "password"
    ) ?? false;

  // =====================================
  // PROFILE EDITING
  // =====================================

  function enableEdit() {
    if (!profile || !authorized || savingProfile) {
      return;
    }

    setEditFullName(profile.fullName || "");
    setEditPhone(profile.phoneNumber || "");
    setEditAddress(profile.address || "");

    setError("");
    setSuccess("");
    editModeRef.current = true;
    setEditMode(true);
  }

  function cancelEdit() {
    if (savingProfile) return;

    editModeRef.current = false;
    setEditMode(false);
    setError("");
  }

  async function saveProfile() {
    if (
      !user ||
      !authorized ||
      !profile ||
      savingProfile
    ) {
      return;
    }

    const fullName = editFullName.trim();
    const phoneNumber = editPhone.trim();
    const addressValue = editAddress.trim();

    setError("");
    setSuccess("");

    if (!fullName) {
      setError("Full name is required.");
      return;
    }

    if (fullName.length > 120) {
      setError(
        "Full name must contain 120 characters or fewer."
      );
      return;
    }

    if (
      phoneNumber &&
      !/^[0-9+\s()-]{7,30}$/.test(phoneNumber)
    ) {
      setError("Please enter a valid phone number.");
      return;
    }

    if (addressValue.length > 500) {
      setError(
        "Address must contain 500 characters or fewer."
      );
      return;
    }

    const uid = user.uid;

    setSavingProfile(true);

    try {
      await updateDoc(
        doc(db, "users", uid),
        {
          fullName,
          phoneNumber,
          address: addressValue,
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
      console.error("SilkMart profile save failed:", reason);
      setError(firebaseErrorMessage(reason));
    } finally {
      setSavingProfile(false);
    }
  }

  // =====================================
  // SETTINGS FUNCTIONS
  // =====================================

  function openSettings() {
    setSettingsSection("main");
    setSettingsError("");
    setSettingsSuccess("");
    setSettingsOpen(true);
  }

  function clearPasswordFields() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");

    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
  }

  function closeSettings() {
    if (
      changingPassword ||
      savingPreferences ||
      signingOut
    ) {
      return;
    }

    setSettingsOpen(false);
    setSettingsSection("main");
    setSettingsError("");
    setSettingsSuccess("");

    clearPasswordFields();
  }

  function openSettingsSection(
    section: SettingsSection
  ) {
    setSettingsError("");
    setSettingsSuccess("");
    setSettingsSection(section);

    if (section === "password") {
      clearPasswordFields();
    }

    if (section === "notifications") {
      setPreferences(
        normalizePreferences(
          profile?.notificationPreferences
        )
      );
    }
  }

  // =====================================
  // CHANGE PASSWORD
  // =====================================

  async function changePassword() {
    if (!user || changingPassword) {
      return;
    }

    setSettingsError("");
    setSettingsSuccess("");

    if (!passwordProvider || !user.email) {
      setSettingsError(
        "Password changes here are available for email-and-password accounts."
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
        "New password must contain at least 8 characters."
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

      await updatePassword(
        user,
        newPassword
      );

      clearPasswordFields();

      setSettingsSuccess(
        "Your password has been changed successfully."
      );
    } catch (reason) {
      setSettingsError(
        firebaseErrorMessage(reason)
      );
    } finally {
      setChangingPassword(false);
    }
  }

  // =====================================
  // NOTIFICATION PREFERENCES
  // =====================================

  function updatePreference(
    key: keyof NotificationPreferences,
    value: boolean
  ) {
    setPreferences(current => ({
      ...current,
      [key]: value,
    }));
  }

  async function saveNotificationPreferences() {
    if (
      !user ||
      !authorized ||
      savingPreferences
    ) {
      return;
    }

    setSavingPreferences(true);
    setSettingsError("");
    setSettingsSuccess("");

    try {
      await updateDoc(
        doc(db, "users", user.uid),
        {
          notificationPreferences: preferences,
          updatedAt: serverTimestamp(),
        }
      );

      setSettingsSuccess(
        "Notification preferences have been saved."
      );
    } catch (reason) {
      setSettingsError(
        firebaseErrorMessage(reason)
      );
    } finally {
      setSavingPreferences(false);
    }
  }

  // =====================================
  // SIGN OUT
  // =====================================

  async function logout() {
    if (signingOut) return;

    setSigningOut(true);
    setSettingsError("");

    try {
      await signOut(auth);

      setConfirmSignOut(false);
      setSettingsOpen(false);

      router.replace("/login");
    } catch (reason) {
      setConfirmSignOut(false);
      setSettingsError(
        firebaseErrorMessage(reason)
      );
    } finally {
      setSigningOut(false);
    }
  }

  // =====================================
  // QUICK NAVIGATION
  // =====================================

  function navigateTo(path: Href) {
    router.push(path);
  }

  // =====================================
  // SCREEN
  // =====================================

  return (
    <>
      <ScrollView
        style={S.page}
        contentContainerStyle={S.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Heading
          label="YOUR ACCOUNT"
          title="My profile."
          description="Manage your SilkMart administrative account details."
        />

        {/* LOADING */}

        {!authReady || loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator
              size="large"
              color={C.green}
            />

            <Text style={S.muted}>
              Loading your profile...
            </Text>
          </View>
        ) : !user ? (
          <View style={S.card}>
            <Text style={S.sectionTitle}>
              Sign in required
            </Text>

            <Text style={styles.description}>
              Sign in with your SilkMart Admin
              or Staff account.
            </Text>
          </View>
        ) : !profile || !authorized ? (
          <View style={S.card}>
            <Ionicons
              name="shield-outline"
              size={35}
              color={C.green}
            />

            <Text
              style={[
                S.sectionTitle,
                { marginTop: 13 },
              ]}
            >
              Access Restricted
            </Text>

            <Text style={styles.description}>
              This page is available only to
              authorized Admin and Staff accounts.
            </Text>

            {!!error && (
              <Text style={styles.errorText}>
                {error}
              </Text>
            )}
          </View>
        ) : (
          <Fade delay={150}>
            {/* =====================================
                PROFILE CARD
                ===================================== */}

            <View
              style={[
                S.card,
                styles.profileCard,
              ]}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarLetter}>
                  {initial}
                </Text>
              </View>

              <Text style={styles.profileName}>
                {displayName}
              </Text>

              <Text style={styles.profileEmail}>
                {email}
              </Text>

              <View
                style={[
                  S.badge,
                  { marginTop: 13 },
                ]}
              >
                <Text style={S.badgeText}>
                  {roleLabel}
                </Text>
              </View>
            </View>

            {/* =====================================
                PERSONAL INFORMATION
                ===================================== */}

            <View
              style={[
                S.card,
                styles.sectionCard,
              ]}
            >
              <View style={styles.sectionHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionTitle}>
                    Personal Information
                  </Text>

                  <Text style={styles.description}>
                    Keep your account details up to date.
                  </Text>
                </View>

                {!editMode && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={enableEdit}
                    style={styles.editButton}
                  >
                    <Ionicons
                      name="create-outline"
                      size={16}
                      color={C.green}
                    />

                    <Text style={styles.editButtonText}>
                      Edit
                    </Text>
                  </Pressable>
                )}
              </View>

              {!editMode ? (
                <View style={styles.informationList}>
                  <InformationRow
                    label="Full Name"
                    value={displayName}
                    icon="person-outline"
                  />

                  <InformationRow
                    label="Email Address"
                    value={email}
                    icon="mail-outline"
                  />

                  <InformationRow
                    label="Phone Number"
                    value={phone}
                    icon="call-outline"
                  />

                  <InformationRow
                    label="Complete Address"
                    value={address}
                    icon="location-outline"
                    last
                  />
                </View>
              ) : (
                <View style={styles.form}>
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
                    Phone Number
                  </Text>

                  <TextInput
                    value={editPhone}
                    onChangeText={setEditPhone}
                    keyboardType="phone-pad"
                    maxLength={30}
                    placeholder="Enter your phone number"
                    placeholderTextColor="#91A198"
                    style={styles.input}
                  />

                  <Text style={styles.fieldLabel}>
                    Email Address
                  </Text>

                  <View style={styles.disabledField}>
                    <Text style={styles.disabledFieldText}>
                      {email}
                    </Text>
                  </View>

                  <Text style={styles.fieldHint}>
                    Your email is managed by Firebase
                    Authentication and cannot be edited here.
                  </Text>
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
                </View>
              )}
            </View>

            {/* =====================================
                SAVE / CANCEL
                ===================================== */}

            {editMode && (
              <View style={styles.actionRow}>
                <Pressable
                  disabled={savingProfile}
                  onPress={cancelEdit}
                  style={styles.cancelAction}
                >
                  <Text style={styles.cancelActionText}>
                    Cancel
                  </Text>
                </Pressable>

                <Pressable
                  disabled={savingProfile}
                  onPress={() => void saveProfile()}
                  style={[
                    styles.saveAction,
                    savingProfile && styles.disabled,
                  ]}
                >
                  {savingProfile ? (
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
                    {savingProfile
                      ? "Saving..."
                      : "Save Changes"}
                  </Text>
                </Pressable>
              </View>
            )}

            {!!error && (
              <View style={styles.feedbackError}>
                <Text style={styles.errorText}>
                  {error}
                </Text>
              </View>
            )}

            {!!success && (
              <View style={styles.feedbackSuccess}>
                <Text style={styles.successText}>
                  {success}
                </Text>
              </View>
            )}

            {/* =====================================
                WORK INFORMATION
                ===================================== */}

            <View
              style={[
                S.card,
                styles.sectionCard,
              ]}
            >
              <Text style={styles.sectionTitle}>
                Work Information
              </Text>

              <Text style={styles.description}>
                Your SilkMart management access.
              </Text>

              <InformationRow
                icon="business-outline"
                label="System"
                value="SilkMart"
              />

              <InformationRow
                icon="shield-checkmark-outline"
                label="System Role"
                value={roleLabel}
              />

              <InformationRow
                icon="briefcase-outline"
                label="Management Access"
                value="Inventory, Products, Orders, Delivery, and Staff Approval"
                last
              />
            </View>

            {/* =====================================
                ACCOUNT INFORMATION
                ===================================== */}

            <View
              style={[
                S.card,
                styles.sectionCard,
              ]}
            >
              <Text style={styles.sectionTitle}>
                Account Information
              </Text>

              <Text style={styles.description}>
                Your account and security details.
              </Text>

              <InformationRow
                icon="person-circle-outline"
                label="Account Role"
                value={roleLabel}
              />

              <InformationRow
                icon="calendar-outline"
                label="Member Since"
                value={memberSince}
              />

              <InformationRow
                icon="time-outline"
                label="Last Profile Update"
                value={lastUpdated}
              />

              <InformationRow
                icon="checkmark-circle-outline"
                label="Account Access"
                value={
                  profile.isActive === false
                    ? "Inactive"
                    : "Authorized"
                }
                last
              />

              <SettingsRow
                icon="settings-outline"
                title="Account Settings"
                description="Password, security, notifications, and sign out"
                onPress={openSettings}
              />
            </View>

            {/* =====================================
                QUICK ACCESS
                ===================================== */}

            <View
              style={[
                S.card,
                styles.sectionCard,
              ]}
            >
              <Text style={styles.sectionTitle}>
                Staff Quick Access
              </Text>

              <Text style={styles.description}>
                Open your SilkMart work areas.
              </Text>

              <SettingsRow
                icon="layers-outline"
                title="Inventory"
                description="Silkworms, cocoons, and stock records"
                onPress={() =>
                  navigateTo("/adm-staff/inventory")
                }
              />

              <SettingsRow
                icon="cube-outline"
                title="Product Management"
                description="Catalog listings and availability"
                onPress={() =>
                  navigateTo("/adm-staff/products")
                }
              />

              <SettingsRow
                icon="receipt-outline"
                title="Customer Orders"
                description="Review orders and customer requests"
                onPress={() =>
                  navigateTo("/adm-staff/cust-orders")
                }
              />
            </View>

          </Fade>
        )}
      </ScrollView>

      {/* =====================================
          SETTINGS MODAL
          ===================================== */}

      <Modal
        visible={settingsOpen}
        transparent
        animationType="fade"
        onRequestClose={closeSettings}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={
            Platform.OS === "ios"
              ? "padding"
              : undefined
          }
        >
          <View style={styles.modalCard}>
            {/* SETTINGS HEADER */}

            <View style={styles.modalHeader}>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  if (settingsSection === "main") {
                    closeSettings();
                  } else {
                    setSettingsSection("main");
                    setSettingsError("");
                    setSettingsSuccess("");
                  }
                }}
                style={styles.modalBack}
              >
                <Ionicons
                  name={
                    settingsSection === "main"
                      ? "close"
                      : "arrow-back"
                  }
                  size={22}
                  color={C.dark}
                />
              </Pressable>

              <Text style={styles.modalHeading}>
                {settingsSection === "main"
                  ? "Account Settings"
                  : settingsSection === "password"
                  ? "Change Password"
                  : settingsSection === "security"
                  ? "Security & Login"
                  : "Notifications"}
              </Text>

              <View style={{ width: 35 }} />
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.modalContent}
            >
              {/* SETTINGS MAIN MENU */}

              {settingsSection === "main" && (
                <>
                  <Text style={styles.settingsIntro}>
                    Manage your SilkMart account,
                    password, and preferences.
                  </Text>

                  <SettingsRow
                    icon="lock-closed-outline"
                    title="Change Password"
                    description="Update your account password securely"
                    onPress={() =>
                      openSettingsSection("password")
                    }
                  />

                  <SettingsRow
                    icon="shield-checkmark-outline"
                    title="Security & Login Activity"
                    description="View your Firebase account security details"
                    onPress={() =>
                      openSettingsSection("security")
                    }
                  />

                  <SettingsRow
                    icon="notifications-outline"
                    title="Notification Preferences"
                    description="Manage notification categories"
                    onPress={() =>
                      openSettingsSection("notifications")
                    }
                  />

                  <Pressable
                    onPress={() => setConfirmSignOut(true)}
                    style={styles.settingsSignOut}
                  >
                    <Ionicons
                      name="log-out-outline"
                      color={RED}
                      size={21}
                    />

                    <Text style={styles.settingsSignOutText}>
                      Sign Out
                    </Text>

                    <Ionicons
                      name="chevron-forward"
                      color={RED}
                      size={17}
                    />
                  </Pressable>
                </>
              )}

              {/* CHANGE PASSWORD */}

              {settingsSection === "password" && (
                <>
                  <Text style={styles.settingsIntro}>
                    Verify your current password
                    before setting a new one.
                  </Text>

                  {!passwordProvider ? (
                    <Text style={styles.settingsNotice}>
                      This account does not use
                      email-and-password authentication.
                      Password changes through this form
                      are unavailable.
                    </Text>
                  ) : (
                    <>
                      <PasswordField
                        label="Current Password"
                        value={currentPassword}
                        onChangeText={setCurrentPassword}
                        visible={showCurrentPassword}
                        onToggleVisibility={() =>
                          setShowCurrentPassword(v => !v)
                        }
                      />

                      <PasswordField
                        label="New Password"
                        value={newPassword}
                        onChangeText={setNewPassword}
                        visible={showNewPassword}
                        onToggleVisibility={() =>
                          setShowNewPassword(v => !v)
                        }
                      />

                      <PasswordField
                        label="Confirm New Password"
                        value={confirmPassword}
                        onChangeText={setConfirmPassword}
                        visible={showConfirmPassword}
                        onToggleVisibility={() =>
                          setShowConfirmPassword(v => !v)
                        }
                      />

                      <Text style={styles.fieldHint}>
                        Use at least 8 characters.
                      </Text>

                      <Pressable
                        disabled={changingPassword}
                        onPress={() => void changePassword()}
                        style={[
                          styles.modalPrimary,
                          changingPassword && styles.disabled,
                        ]}
                      >
                        <Text style={styles.modalPrimaryText}>
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
                    Information provided by
                    Firebase Authentication.
                  </Text>

                  <InformationRow
                    icon="calendar-outline"
                    label="Account Created"
                    value={accountCreated}
                  />

                  <InformationRow
                    icon="time-outline"
                    label="Last Sign In"
                    value={lastSignIn}
                  />

                  <InformationRow
                    icon="key-outline"
                    label="Login Provider"
                    value={loginProvider}
                  />

                  <InformationRow
                    icon="mail-outline"
                    label="Account Email"
                    value={email}
                    last
                  />

                  <Text style={styles.settingsNotice}>
                    Firebase provides the most recent
                    sign-in timestamp here. This is not
                    a complete history of every login.
                  </Text>
                </>
              )}

              {/* NOTIFICATION PREFERENCES */}

              {settingsSection === "notifications" && (
                <>
                  <Text style={styles.settingsIntro}>
                    Choose your preferred categories
                    of SilkMart updates.
                  </Text>

                  {(
                    [
                      {
                        key: "newOrders",
                        title: "New Orders",
                        description: "New customer order requests",
                      },
                      {
                        key: "deliveryUpdates",
                        title: "Delivery Updates",
                        description: "Delivery scheduling and status changes",
                      },
                      {
                        key: "lowInventory",
                        title: "Low Inventory",
                        description: "Silkworm and cocoon stock alerts",
                      },
                      {
                        key: "staffApplications",
                        title: "Staff Applications",
                        description: "New staff applicant updates",
                      },
                    ] as const
                  ).map(item => (
                    <View
                      key={item.key}
                      style={styles.preferenceRow}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.preferenceTitle}>
                          {item.title}
                        </Text>

                        <Text style={styles.preferenceDescription}>
                          {item.description}
                        </Text>
                      </View>

                      <Switch
                        value={preferences[item.key]}
                        onValueChange={value =>
                          updatePreference(item.key, value)
                        }
                        trackColor={{
                          false: "#D5DDCF",
                          true: "#B7D2BE",
                        }}
                        thumbColor={
                          preferences[item.key]
                            ? C.green
                            : "#F3F4F0"
                        }
                      />
                    </View>
                  ))}

                  <Text style={styles.settingsNotice}>
                    These switches save category
                    preferences to your account.
                    Notification filtering requires
                    the notification system to use
                    these saved preferences.
                  </Text>

                  <Pressable
                    disabled={savingPreferences}
                    onPress={() =>
                      void saveNotificationPreferences()
                    }
                    style={[
                      styles.modalPrimary,
                      savingPreferences && styles.disabled,
                    ]}
                  >
                    <Text style={styles.modalPrimaryText}>
                      {savingPreferences
                        ? "Saving Preferences..."
                        : "Save Preferences"}
                    </Text>
                  </Pressable>
                </>
              )}

              {!!settingsError && (
                <Text style={styles.errorText}>
                  {settingsError}
                </Text>
              )}

              {!!settingsSuccess && (
                <Text style={styles.successText}>
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
        visible={confirmSignOut}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!signingOut) {
            setConfirmSignOut(false);
          }
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.confirmCard}>
            <View style={styles.confirmIcon}>
              <Ionicons
                name="log-out-outline"
                size={29}
                color={RED}
              />
            </View>

            <Text style={styles.confirmTitle}>
              Sign Out?
            </Text>

            <Text style={styles.confirmDescription}>
              You will return to the
              SilkMart login screen.
            </Text>

            <Pressable
              disabled={signingOut}
              onPress={() => void logout()}
              style={[
                styles.confirmButton,
                signingOut && styles.disabled,
              ]}
            >
              <Text style={styles.confirmButtonText}>
                {signingOut
                  ? "Signing Out..."
                  : "Confirm Sign Out"}
              </Text>
            </Pressable>

            <Pressable
              disabled={signingOut}
              onPress={() => setConfirmSignOut(false)}
              style={styles.confirmCancel}
            >
              <Text style={styles.cancelActionText}>
                Cancel
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

// =====================================
// STYLES
// =====================================

const styles = StyleSheet.create({
  loadingContainer: {
    paddingVertical: 55,
    alignItems: "center",
    gap: 12,
  },

  description: {
    color: C.muted,
    fontSize: 11,
    lineHeight: 18,
    marginTop: 6,
    marginBottom: 14,
  },

  sectionCard: {
    marginTop: 12,
    paddingVertical: 20,
  },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },

  sectionTitle: {
    fontFamily: "serif",
    fontSize: 22,
    color: C.dark,
  },

  // PROFILE SUMMARY

  profileCard: {
    paddingVertical: 28,
    paddingHorizontal: 20,
    alignItems: "center",
  },

  avatar: {
    width: 82,
    height: 82,
    borderRadius: 41,
    backgroundColor: C.soft,
    alignItems: "center",
    justifyContent: "center",
  },

  avatarLetter: {
    fontFamily: "serif",
    fontSize: 39,
    color: C.green,
    textAlign: "center",
    includeFontPadding: false,
  },

  profileName: {
    fontFamily: "serif",
    fontSize: 26,
    color: C.dark,
    marginTop: 14,
    textAlign: "center",
  },

  profileEmail: {
    color: C.muted,
    fontSize: 12,
    marginTop: 6,
    textAlign: "center",
  },

  // PERSONAL INFORMATION

  informationList: {
    borderTopWidth: 1,
    borderTopColor: C.line,
  },

  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },

  lastInfoRow: {
    borderBottomWidth: 0,
  },

  infoIcon: {
    width: 35,
    height: 35,
    borderRadius: 11,
    backgroundColor: C.soft,
    justifyContent: "center",
    alignItems: "center",
  },

  infoContent: {
    flex: 1,
    minWidth: 0,
  },

  infoLabel: {
    color: C.muted,
    fontSize: 11,
  },

  infoValue: {
    color: C.dark,
    fontSize: 13,
    fontWeight: "600",
    marginTop: 5,
    lineHeight: 19,
  },

  // EDIT FORM

  editButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 9,
    backgroundColor: C.soft,
  },

  editButtonText: {
    color: C.green,
    fontSize: 11,
    fontWeight: "700",
  },

  form: {
    gap: 7,
    marginTop: 12,
  },

  fieldGroup: {
    marginTop: 13,
  },

  fieldLabel: {
    color: C.dark,
    fontWeight: "600",
    fontSize: 12,
    marginTop: 12,
    marginBottom: 5,
  },

  input: {
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: SURFACE,
    borderRadius: 11,
    paddingHorizontal: 13,
    paddingVertical: 12,
    color: C.dark,
    fontSize: 13,
  },

  addressInput: {
    minHeight: 105,
    marginTop: 7,
  },

  disabledField: {
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: "#F2F4EF",
    borderRadius: 11,
    padding: 13,
  },

  disabledFieldText: {
    color: C.muted,
    fontSize: 12,
  },

  fieldHint: {
    fontSize: 10,
    color: C.muted,
    lineHeight: 17,
    marginTop: 7,
  },

  actionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 13,
  },

  cancelAction: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.line,
    alignItems: "center",
    justifyContent: "center",
  },

  cancelActionText: {
    color: C.green,
    fontSize: 12,
    fontWeight: "700",
  },

  saveAction: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    backgroundColor: C.green,
    flexDirection: "row",
    gap: 7,
    alignItems: "center",
    justifyContent: "center",
  },

  saveActionText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },

  disabled: {
    opacity: 0.55,
  },

  feedbackError: {
    backgroundColor: "#FFF1EE",
    padding: 12,
    borderRadius: 11,
    marginTop: 12,
  },

  feedbackSuccess: {
    backgroundColor: C.soft,
    padding: 12,
    borderRadius: 11,
    marginTop: 12,
  },

  errorText: {
    color: RED,
    fontSize: 12,
    lineHeight: 19,
    marginTop: 9,
  },

  successText: {
    color: C.green,
    fontSize: 12,
    lineHeight: 19,
    marginTop: 9,
  },

  // QUICK ACCESS / SETTINGS

  settingsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },

  settingsRowIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.soft,
    alignItems: "center",
    justifyContent: "center",
  },

  settingsRowTitle: {
    color: C.dark,
    fontSize: 13,
    fontWeight: "700",
  },

  settingsRowDescription: {
    color: C.muted,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 4,
  },

  // SETTINGS MODAL

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(13,31,22,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },

  modalCard: {
    backgroundColor: SURFACE,
    borderRadius: 19,
    width: "100%",
    maxWidth: 460,
    maxHeight: "85%",
    overflow: "hidden",
  },

  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: C.line,
    padding: 15,
  },

  modalBack: {
    width: 35,
    height: 35,
    alignItems: "center",
    justifyContent: "center",
  },

  modalHeading: {
    fontFamily: "serif",
    fontSize: 21,
    color: C.dark,
  },

  modalContent: {
    padding: 19,
    paddingBottom: 27,
  },

  settingsIntro: {
    color: C.muted,
    fontSize: 12,
    lineHeight: 19,
    marginBottom: 14,
  },

  settingsNotice: {
    color: C.muted,
    fontSize: 11,
    lineHeight: 19,
    backgroundColor: C.soft,
    borderRadius: 11,
    padding: 12,
    marginTop: 16,
  },

  settingsSignOut: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 20,
    paddingVertical: 15,
    borderTopWidth: 1,
    borderTopColor: C.line,
  },

  settingsSignOutText: {
    flex: 1,
    color: RED,
    fontSize: 13,
    fontWeight: "700",
  },

  // PASSWORD

  passwordField: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 11,
    backgroundColor: SURFACE,
    flexDirection: "row",
    alignItems: "center",
  },

  passwordInput: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 13,
    paddingVertical: 12,
    color: C.dark,
    fontSize: 13,
  },

  eyeButton: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },

  modalPrimary: {
    marginTop: 19,
    backgroundColor: C.green,
    padding: 15,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },

  modalPrimaryText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },

  // NOTIFICATION PREFERENCES

  preferenceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },

  preferenceTitle: {
    color: C.dark,
    fontSize: 13,
    fontWeight: "700",
  },

  preferenceDescription: {
    color: C.muted,
    fontSize: 11,
    lineHeight: 18,
    marginTop: 4,
  },

  // SIGN OUT CONFIRMATION

  confirmCard: {
    backgroundColor: SURFACE,
    borderRadius: 20,
    padding: 25,
    width: "100%",
    maxWidth: 400,
    alignItems: "center",
  },

  confirmIcon: {
    width: 65,
    height: 65,
    borderRadius: 33,
    backgroundColor: "#FFF0EC",
    justifyContent: "center",
    alignItems: "center",
  },

  confirmTitle: {
    marginTop: 15,
    color: C.dark,
    fontFamily: "serif",
    fontSize: 25,
  },

  confirmDescription: {
    color: C.muted,
    fontSize: 12,
    lineHeight: 20,
    textAlign: "center",
    marginVertical: 16,
  },

  confirmButton: {
    backgroundColor: RED,
    paddingVertical: 15,
    width: "100%",
    borderRadius: 13,
    alignItems: "center",
  },

  confirmButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 13,
  },

  confirmCancel: {
    padding: 16,
  },
});