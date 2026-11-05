
import React, {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";

import {
  Slot,
  usePathname,
  useRouter,
  type Href,
} from "expo-router";

import {
  onAuthStateChanged,
  type User,
} from "firebase/auth";

import {
  doc,
  onSnapshot,
} from "firebase/firestore";

import { auth, db } from "../../firebase/config";
import { C } from "../../components/AdminUI";

import {
  useNotificationCounts,
} from "../../lib/useNotificationCounts";

// =====================================
// TYPES
// =====================================

type Role = "administrator" | "staff" | null;

type IconName =
  React.ComponentProps<typeof Ionicons>["name"];

type MenuPage = {
  name: string;
  path: Href;
  icon: IconName;
};

// =====================================
// NAVIGATION PAGES
// =====================================

const pages: MenuPage[] = [
  {
    name: "Dashboard",
    path: "/adm-staff",
    icon: "grid-outline",
  },
  {
    name: "Inventory Management",
    path: "/adm-staff/inventory",
    icon: "layers-outline",
  },
  {
    name: "Product Management",
    path: "/adm-staff/products",
    icon: "cube-outline",
  },
  {
    name: "Customer Orders",
    path: "/adm-staff/cust-orders",
    icon: "receipt-outline",
  },
  {
    name: "Delivery Management",
    path: "/adm-staff/delivery",
    icon: "calendar-outline",
  },
  {
    name: "Staff Approval",
    path: "/adm-staff/staff-approval",
    icon: "people-outline",
  },
];

// =====================================
// HELPERS
// =====================================

function normalizeRole(value: unknown): Role {
  const role = String(value ?? "")
    .trim()
    .toLowerCase();

  if (
    role === "administrator" ||
    role === "admin"
  ) {
    return "administrator";
  }

  if (role === "staff") {
    return "staff";
  }

  return null;
}

function getInitial(
  fullName: string,
  user: User | null
): string {
  const name = fullName.trim();

  const fallback =
    user?.displayName?.trim() ||
    user?.email?.split("@")[0]?.trim() ||
    "Staff";

  const firstCharacter = Array.from(
    name || fallback
  )[0];

  return firstCharacter
    ? firstCharacter.toLocaleUpperCase()
    : "S";
}

// =====================================
// ADMIN / STAFF LAYOUT
// =====================================

export default function AdminStaffLayout() {
  const router = useRouter();
  const pathname = usePathname();

  // =====================================
  // STATE
  // =====================================

  const [menuOpen, setMenuOpen] =
    useState(false);

  const [user, setUser] =
    useState<User | null>(auth.currentUser);

  const [role, setRole] =
    useState<Role>(null);

  const [fullName, setFullName] =
    useState("");

  const [ready, setReady] =
    useState(false);

  const { totalUnread } =
    useNotificationCounts("staff");

  // =====================================
  // MENU ANIMATIONS
  // =====================================

  const menuOpacity = useRef(
    new Animated.Value(0)
  ).current;

  const menuTranslate = useRef(
    new Animated.Value(-10)
  ).current;

  // =====================================
  // AUTHENTICATION AND ACCOUNT PROFILE
  // =====================================

  useEffect(() => {
    let active = true;

    let stopProfileListener:
      (() => void) | undefined;

    const unsubscribe = onAuthStateChanged(
      auth,
      nextUser => {
        stopProfileListener?.();
        stopProfileListener = undefined;

        if (!active) return;

        setReady(false);
        setUser(nextUser);
        setRole(null);
        setFullName("");

        if (!nextUser) {
          setReady(true);
          return;
        }

        // Read role and full name from
        // the same Firestore user profile.

        stopProfileListener = onSnapshot(
          doc(db, "users", nextUser.uid),

          snapshot => {
            if (!active) return;

            if (!snapshot.exists()) {
              setRole(null);
              setFullName("");
              setReady(true);
              return;
            }

            const data = snapshot.data();

            const nextRole = normalizeRole(
              data.role
            );

            const nextName =
              typeof data.fullName === "string"
                ? data.fullName.trim()
                : "";

            setRole(nextRole);
            setFullName(nextName);
            setReady(true);
          },

          error => {
            if (!active) return;

            console.warn(
              "Unable to verify staff profile:",
              error
            );

            setRole(null);
            setFullName("");
            setReady(true);
          }
        );
      }
    );

    return () => {
      active = false;
      stopProfileListener?.();
      unsubscribe();
    };
  }, []);

  // =====================================
  // CLOSE MENU ON PAGE CHANGE
  // =====================================

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // =====================================
  // ROUTE PROTECTION
  // =====================================

  useEffect(() => {
    if (!ready) return;

    if (!user || !role) {
      router.replace("/login");
    }
  }, [
    ready,
    user,
    role,
    router,
  ]);

  // =====================================
  // MENU ANIMATION
  // =====================================

  useEffect(() => {
    const animation = Animated.parallel([
      Animated.timing(menuOpacity, {
        toValue: menuOpen ? 1 : 0,
        duration: 210,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),

      Animated.timing(menuTranslate, {
        toValue: menuOpen ? 0 : -10,
        duration: 210,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);

    animation.start();

    return () => animation.stop();
  }, [
    menuOpen,
    menuOpacity,
    menuTranslate,
  ]);

  // =====================================
  // NAVIGATION
  // =====================================

  function navigate(path: Href) {
    setMenuOpen(false);
    router.push(path);
  }

  // =====================================
  // PROFILE AVATAR INITIAL
  // =====================================

  const profileInitial = getInitial(
    fullName,
    user
  );

  // =====================================
  // LOADING / ACCESS CHECK
  // =====================================

  if (
    !ready ||
    !user ||
    !role
  ) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator
          color={C.green}
          size="large"
        />

        <Text style={styles.loadingText}>
          {!ready
            ? "Checking staff access..."
            : "Staff access required. Returning to login..."}
        </Text>
      </View>
    );
  }

  // =====================================
  // MAIN LAYOUT
  // =====================================

  return (
    <View style={styles.screen}>
      {/* HEADER */}

      <View style={styles.header}>
        {/* BRAND */}

        <View style={styles.brand}>
          <View style={styles.logo}>
            <Ionicons
              name="leaf-outline"
              color="#FFFFFF"
              size={19}
            />
          </View>

          <View style={styles.brandText}>
            <Text style={styles.brandName}>
              SilkMart
            </Text>

            <Text style={styles.subtitle}>
              VILLANUEVA (DOST-PTRI)
            </Text>
          </View>
        </View>

        {/* HEADER ACTIONS */}

        <View style={styles.headerRight}>
          {/* NOTIFICATION ICON */}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              totalUnread > 0
                ? `Notifications, ${totalUnread} unread`
                : "Notifications, no unread updates"
            }
            onPress={() =>
              navigate(
                "/adm-staff/notif-adm-staff"
              )
            }
            style={styles.touch}
          >
            <Ionicons
              name="notifications-outline"
              color={C.dark}
              size={22}
            />

            {totalUnread > 0 && (
              <View style={styles.notificationBadge}>
                <Text
                  style={styles.notificationBadgeText}
                >
                  {totalUnread > 99
                    ? "99+"
                    : totalUnread}
                </Text>
              </View>
            )}
          </Pressable>

          {/* PROFILE AVATAR */}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              `My Profile, ${fullName || "Staff account"}`
            }
            onPress={() =>
              navigate(
                "/adm-staff/prof-adm-staff"
              )
            }
            style={styles.avatar}
          >
            <Text style={styles.avatarText}>
              {profileInitial}
            </Text>
          </Pressable>

          {/* MENU BUTTON */}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              menuOpen
                ? "Close menu"
                : "Open menu"
            }
            onPress={() =>
              setMenuOpen(previous => !previous)
            }
            style={styles.touch}
          >
            <Ionicons
              name={
                menuOpen
                  ? "close"
                  : "menu"
              }
              color={C.dark}
              size={23}
            />
          </Pressable>
        </View>
      </View>

      {/* PAGE CONTENT */}

      <View style={styles.pageContent}>
        <Slot />
      </View>

      {/* =====================================
          NAVIGATION MENU
          ===================================== */}

      {menuOpen && (
        <>
          {/* MENU BACKDROP */}

          <Pressable
            accessibilityLabel="Close navigation menu"
            onPress={() => setMenuOpen(false)}
            style={styles.scrim}
          />

          {/* MENU CONTENT */}

          <Animated.View
            style={[
              styles.menu,
              {
                opacity: menuOpacity,
                transform: [
                  {
                    translateY:
                      menuTranslate,
                  },
                ],
              },
            ]}
          >
            <ScrollView
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.menuCaption}>
                ADMIN/STAFF · MENU
              </Text>

              {pages.map(page => {
                const activePage =
                  pathname === page.path ||
                  (
                    page.path === "/adm-staff" &&
                    pathname === "/adm-staff/"
                  );

                return (
                  <Pressable
                    key={page.name}
                    accessibilityRole="button"
                    onPress={() =>
                      navigate(page.path)
                    }
                    style={({ pressed }) => [
                      styles.menuItem,
                      activePage &&
                        styles.selected,
                      pressed &&
                        styles.pressedItem,
                    ]}
                  >
                    <Ionicons
                      name={page.icon}
                      size={18}
                      color={C.green}
                    />

                    <Text
                      style={[
                        styles.menuText,
                        activePage &&
                          styles.activeMenuText,
                      ]}
                    >
                      {page.name}
                    </Text>

                    <Ionicons
                      name="chevron-forward"
                      size={15}
                      color={C.muted}
                    />
                  </Pressable>
                );
              })}
            </ScrollView>
          </Animated.View>
        </>
      )}
    </View>
  );
}

// =====================================
// STYLES
// =====================================

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.cream,
  },

  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.cream,
    paddingHorizontal: 24,
  },

  loadingText: {
    color: C.muted,
    marginTop: 12,
    fontSize: 12,
    textAlign: "center",
  },

  // HEADER

  header: {
    height: 70,
    backgroundColor: C.white,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
    paddingHorizontal: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    flexShrink: 1,
    minWidth: 0,
  },

  brandText: {
    flexShrink: 1,
  },

  logo: {
    width: 35,
    height: 35,
    borderRadius: 18,
    backgroundColor: C.green,
    alignItems: "center",
    justifyContent: "center",
  },

  brandName: {
    fontSize: 22,
    fontFamily: "serif",
    color: C.dark,
  },

  subtitle: {
    fontSize: 7,
    letterSpacing: 1,
    color: C.muted,
    fontWeight: "800",
  },

  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },

  touch: {
    padding: 7,
    position: "relative",
  },

  // NOTIFICATION BADGE

  notificationBadge: {
    position: "absolute",
    top: -2,
    right: -6,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: "#B34D4D",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: C.white,
  },

  notificationBadgeText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "800",
    textAlign: "center",
  },

  // PROFILE AVATAR

  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.soft,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: C.line,
  },

  avatarText: {
    color: C.green,
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center",
    includeFontPadding: false,
  },

  // PAGE CONTENT

  pageContent: {
    flex: 1,
  },

  // MENU BACKDROP

  scrim: {
    position: "absolute",
    top: 70,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.15)",
  },

  // MENU

  menu: {
    position: "absolute",
    top: 75,
    right: 10,
    width: 270,
    maxHeight: "78%",
    backgroundColor: C.white,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: C.line,
    padding: 10,
    elevation: 7,
    shadowColor: "#000000",
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: {
      width: 0,
      height: 5,
    },
  },

  menuCaption: {
    color: C.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.3,
    margin: 9,
  },

  menuItem: {
    padding: 12,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  selected: {
    backgroundColor: C.soft,
  },

  pressedItem: {
    opacity: 0.8,
  },

  menuText: {
    flex: 1,
    fontSize: 12,
    color: C.dark,
  },

  activeMenuText: {
    fontWeight: "800",
  },

  menuDivider: {
    height: 1,
    backgroundColor: C.line,
    marginVertical: 9,
  },
});
