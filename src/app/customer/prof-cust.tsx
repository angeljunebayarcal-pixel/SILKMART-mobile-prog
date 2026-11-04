
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import {
  onAuthStateChanged,
  signOut,
  type User,
} from "firebase/auth";

import {
  doc,
  getDoc,
} from "firebase/firestore";

import { auth, db } from "../../firebase/config";

// =====================================
// COLORS
// =====================================

const GREEN = "#235F45";
const DARK = "#173B2C";
const MUTED = "#627C6E";
const CREAM = "#FAF9F1";
const SURFACE = "#FFFDF8";
const BORDER = "#D5DDCF";
const RED = "#A43F3F";

// =====================================
// TYPES
// =====================================

type CustomerProfile = {
  fullName: string;
  email: string;
  phoneNumber: string;
  address: string;
  role: string;
};

type DetailProps = {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  value: string;
  last?: boolean;
};

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

    return () => {
      animation.stop();
    };
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

      <View style={{ flex: 1 }}>
        <Text style={styles.detailLabel}>
          {label}
        </Text>

        <Text style={styles.detailValue}>
          {value || "Not available"}
        </Text>
      </View>
    </View>
  );
}

// =====================================
// NORMALIZE FIRESTORE PROFILE
// =====================================

function normalizeProfile(
  data: Record<string, unknown>
): CustomerProfile {
  const readString = (value: unknown) =>
    typeof value === "string"
      ? value.trim()
      : "";

  return {
    fullName: readString(data.fullName),
    email: readString(data.email),
    phoneNumber: readString(data.phoneNumber),
    address: readString(data.address),
    role: readString(data.role).toLowerCase(),
  };
}

// =====================================
// MAIN CUSTOMER PROFILE
// =====================================

export default function CustomerProfileScreen() {
  const router = useRouter();

  const [user, setUser] =
    useState<User | null>(null);

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

  const [busy, setBusy] =
    useState(false);

  const [showSignOut, setShowSignOut] =
    useState(false);

  // =====================================
  // AUTHENTICATION
  // =====================================

  useEffect(() => {
    return onAuthStateChanged(
      auth,
      nextUser => {
        setUser(nextUser);
        setAuthReady(true);

        // Clear the old account's information
        // whenever authentication changes.
        setProfile(null);
        setProfileUid(null);
        setError("");

        if (!nextUser) {
          setLoading(false);
          setShowSignOut(false);
        } else {
          setLoading(true);
        }
      }
    );
  }, []);

  // =====================================
  // LOAD PROFILE WHEN SCREEN IS FOCUSED
  // =====================================

  useFocusEffect(
    useCallback(() => {
      let active = true;

      if (!authReady) {
        return () => {
          active = false;
        };
      }

      if (!user) {
        setProfile(null);
        setProfileUid(null);
        setLoading(false);

        return () => {
          active = false;
        };
      }

      const uid = user.uid;

      async function loadProfile() {
        setLoading(true);
        setError("");

        try {
          const snapshot = await getDoc(
            doc(db, "users", uid)
          );

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
              "Your account exists, but its customer profile could not be found."
            );

            return;
          }

          const data = normalizeProfile(
            snapshot.data()
          );

          setProfile(data);
          setProfileUid(uid);
        } catch (reason) {
          if (
            !active ||
            auth.currentUser?.uid !== uid
          ) {
            return;
          }

          setProfile(null);
          setProfileUid(uid);

          setError(
            reason instanceof Error &&
              reason.message.includes("permission")
              ? "Firestore denied access to your profile. Check your account permissions."
              : "Unable to load your profile. Check your internet connection."
          );
        } finally {
          if (
            active &&
            auth.currentUser?.uid === uid
          ) {
            setLoading(false);
          }
        }
      }

      void loadProfile();

      return () => {
        active = false;
      };
    }, [authReady, user])
  );

  // =====================================
  // SIGN OUT
  // =====================================

  async function confirmSignOut() {
    if (busy) return;

    setBusy(true);
    setError("");

    try {
      await signOut(auth);

      setProfile(null);
      setProfileUid(null);
      setShowSignOut(false);

      router.replace("/login");
    } catch {
      setError(
        "Sign out failed. Please try again."
      );

      setShowSignOut(false);
    } finally {
      setBusy(false);
    }
  }

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
    "SilkMart Customer";

  const displayEmail =
    currentProfile?.email ||
    user?.email ||
    "Not available";

  const displayRole =
    currentProfile?.role === "customer"
      ? "Customer Account"
      : "Signed-in Account";

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

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* PAGE HEADING */}

        <FadeUp delay={100}>
          <Text style={styles.eyebrow}>
            YOUR ACCOUNT
          </Text>

          <Text style={styles.title}>
            My profile.
          </Text>

          <Text style={styles.intro}>
            Your SilkMart customer
            information in one place.
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
                customer profile.
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
            {/* CUSTOMER CARD */}

            <FadeUp delay={200}>
              <View style={styles.card}>
                <View style={styles.avatar}>
                  <Text style={styles.initial}>
                    {displayName
                      .charAt(0)
                      .toUpperCase()}
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

            {/* PERSONAL INFORMATION */}

            <FadeUp delay={280}>
              <Text style={styles.sectionLabel}>
                PERSONAL INFORMATION
              </Text>

              {loading ? (
                <ActivityIndicator
                  color={GREEN}
                  style={styles.loading}
                />
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

              <Text style={styles.help}>
                This information comes from
                your SilkMart account
                profile. Your contact details
                are also used by staff when
                reviewing customer orders.
              </Text>

              {/* SIGN OUT BUTTON */}

              <Pressable
                disabled={busy}
                style={({ pressed }) => [
                  styles.signOut,
                  pressed &&
                    styles.pressed,
                  busy &&
                    styles.disabledButton,
                ]}
                onPress={() =>
                  setShowSignOut(true)
                }
              >
                <Ionicons
                  name="log-out-outline"
                  size={20}
                  color={RED}
                />

                <Text style={styles.signOutText}>
                  {busy
                    ? "Signing out..."
                    : "Sign Out"}
                </Text>
              </Pressable>
            </FadeUp>
          </>
        )}
      </ScrollView>

      {/* =====================================
          SIGN OUT CONFIRMATION
          ===================================== */}

      <Modal
        visible={showSignOut}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!busy) {
            setShowSignOut(false);
          }
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
              sign out of your SilkMart
              account?
            </Text>

            <Pressable
              disabled={busy}
              style={[
                styles.confirmButton,
                busy &&
                  styles.disabledButton,
              ]}
              onPress={() =>
                void confirmSignOut()
              }
            >
              {busy ? (
                <ActivityIndicator
                  color="#FFFFFF"
                  size="small"
                />
              ) : (
                <Text
                  style={
                    styles.confirmButtonText
                  }
                >
                  Sign Out
                </Text>
              )}
            </Pressable>

            <Pressable
              disabled={busy}
              onPress={() =>
                setShowSignOut(false)
              }
              style={styles.confirmCancel}
            >
              <Text
                style={
                  styles.confirmCancelText
                }
              >
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

  sectionLabel: {
    fontSize: 10,
    color: GREEN,
    fontWeight: "700",
    letterSpacing: 1.5,
    marginTop: 26,
    marginBottom: 12,
  },

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
    backgroundColor: "#EAF2E8",
    alignItems: "center",
    justifyContent: "center",
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

  error: {
    marginTop: 12,
    fontSize: 12,
    lineHeight: 18,
    color: RED,
  },

  help: {
    marginVertical: 20,
    fontSize: 11,
    lineHeight: 18,
    color: MUTED,
  },

  signOut: {
    height: 52,
    backgroundColor: "#FFF8F5",
    borderWidth: 1,
    borderColor: "#E8C9C3",
    borderRadius: 26,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    justifyContent: "center",
  },

  signOutText: {
    fontSize: 13,
    color: RED,
    fontWeight: "700",
  },

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

  confirmBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    paddingHorizontal: 25,
  },

  confirmCard: {
    backgroundColor: SURFACE,
    borderRadius: 20,
    alignItems: "center",
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
