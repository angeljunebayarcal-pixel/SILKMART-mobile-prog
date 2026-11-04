
import React, { useEffect, useRef, useState } from "react";

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
  getDoc,
} from "firebase/firestore";

import { auth, db } from "../../firebase/config";
import { C } from "../../components/AdminUI";
import { useNotificationCounts } from "../../lib/useNotificationCounts";

type Role = "administrator" | "staff" | null;

type IconName =
  React.ComponentProps<typeof Ionicons>["name"];

type MenuPage = {
  name: string;
  path: Href;
  icon: IconName;
};

// =====================================
// ADMIN AND APPROVED STAFF MENU
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

export default function AdminStaffLayout() {
  const router = useRouter();
  const pathname = usePathname();

  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [ready, setReady] = useState(false);
  const { totalUnread } = useNotificationCounts("staff");

  const menuOpacity = useRef(
    new Animated.Value(0)
  ).current;

  const menuTranslate = useRef(
    new Animated.Value(-10)
  ).current;

  // =====================================
  // VERIFY STAFF / ADMIN ACCESS
  // =====================================

  useEffect(() => {
    let active = true;
    let requestId = 0;

    const unsubscribe = onAuthStateChanged(
      auth,
      async nextUser => {
        const currentRequest = ++requestId;

        if (!active) return;

        setReady(false);
        setUser(nextUser);
        setRole(null);

        if (!nextUser) {
          setReady(true);
          return;
        }

        let nextRole: Role = null;

        try {
          const snapshot = await getDoc(
            doc(db, "users", nextUser.uid)
          );

          const rawRole = String(
            snapshot.data()?.role ?? ""
          ).trim().toLowerCase();

          if (
            rawRole === "administrator" ||
            rawRole === "admin"
          ) {
            nextRole = "administrator";
          } else if (rawRole === "staff") {
            nextRole = "staff";
          }
        } catch {
          nextRole = null;
        }

        if (
          !active ||
          currentRequest !== requestId
        ) {
          return;
        }

        setRole(nextRole);
        setReady(true);
      }
    );

    return () => {
      active = false;
      requestId += 1;
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
  // PROTECT ADMIN / STAFF ROUTES
  // =====================================

  useEffect(() => {
    if (!ready) return;

    if (!user || !role) {
      router.replace("/login");
    }
  }, [ready, user, role, router]);

  // =====================================
  // MENU ANIMATIONS
  // =====================================

  useEffect(() => {
    Animated.parallel([
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
    ]).start();
  }, [menuOpen, menuOpacity, menuTranslate]);

  function navigate(path: Href) {
    setMenuOpen(false);
    router.push(path);
  }

  // =====================================
  // LOADING / ACCESS CHECK
  // =====================================

  if (!ready || !user || !role) {
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
      <View style={styles.header}>
        <View style={styles.brand}>
          <View style={styles.logo}>
            <Ionicons
              name="leaf-outline"
              color="#FFFFFF"
              size={19}
            />
          </View>

          <View>
            <Text style={styles.brandName}>
              SilkMart
            </Text>

            <Text style={styles.subtitle}>
              VILLANUEVA (DOST-PTRI)
            </Text>
          </View>
        </View>

        <View style={styles.headerRight}>
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
                <Text style={styles.notificationBadgeText}>
                  {totalUnread > 99 ? "99+" : totalUnread}
                </Text>
              </View>
            )}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="My Profile"
            onPress={() =>
              navigate(
                "/adm-staff/prof-adm-staff"
              )
            }
            style={styles.avatar}
          >
            <Text style={styles.avatarText}>
              {(user.email?.[0] || "A").toUpperCase()}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              menuOpen ? "Close menu" : "Open menu"
            }
            onPress={() =>
              setMenuOpen(previous => !previous)
            }
            style={styles.touch}
          >
            <Ionicons
              name={menuOpen ? "close" : "menu"}
              color={C.dark}
              size={23}
            />
          </Pressable>
        </View>
      </View>

      <View style={styles.pageContent}>
        <Slot />
      </View>

      {/* =====================================
          NAVIGATION MENU
          ===================================== */}

      {menuOpen && (
        <>
          <Pressable
            accessibilityLabel="Close navigation menu"
            onPress={() => setMenuOpen(false)}
            style={styles.scrim}
          />

          <Animated.View
            style={[
              styles.menu,
              {
                opacity: menuOpacity,
                transform: [
                  { translateY: menuTranslate },
                ],
              },
            ]}
          >
            <ScrollView
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.menuCaption}>
                {role === "administrator"
                  ? "ADMIN/STAFF"
                  : "ADMIN/STAFF"}{" "}
                · MENU
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
                      activePage && styles.selected,
                      pressed && styles.pressedItem,
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
  },

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
    fontWeight: "800",
  },

  pageContent: {
    flex: 1,
  },

  scrim: {
    position: "absolute",
    top: 70,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.15)",
  },

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
