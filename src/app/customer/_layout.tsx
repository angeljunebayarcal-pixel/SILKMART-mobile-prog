import React from "react";
import { Ionicons } from "@expo/vector-icons";
import { Stack, usePathname, useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const GREEN = "#235F45";
const MUTED = "#627C6E";
const BORDER = "#D5DDCF";

const tabs = [
  { label: "Shop Silk", href: "/customer/shopsilk", icon: "home-outline", activeIcon: "home" },
  { label: "Orders", href: "/customer/order", icon: "receipt-outline", activeIcon: "receipt" },
  { label: "Cart", href: "/customer/cart", icon: "bag-handle-outline", activeIcon: "bag-handle" },
  { label: "Profile", href: "/customer/prof-cust", icon: "person-outline", activeIcon: "person" },
] as const;

export default function CustomerLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: "slide_from_right",
          contentStyle: { backgroundColor: "#FAF9F1" },
        }}
      />

      <View style={[styles.bottomNav, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        {tabs.map((tab) => {
          const active = pathname === tab.href || (tab.href === "/customer/shopsilk" && pathname === "/customer");
          return (
            <Pressable
              key={tab.href}
              style={styles.navItem}
              accessibilityRole="button"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: active }}
              onPress={() => {
                if (!active) router.replace(tab.href);
              }}
            >
              <Ionicons
                name={active ? tab.activeIcon : tab.icon}
                size={21}
                color={active ? GREEN : MUTED}
              />
              <Text style={active ? styles.activeNavText : styles.navText} numberOfLines={1}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FAF9F1" },
  bottomNav: {
    flexDirection: "row",
    paddingTop: 10,
    backgroundColor: "#FFFDF8",
    borderTopColor: BORDER,
    borderTopWidth: 1,
    alignItems: "center",
  },
  navItem: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", gap: 4 },
  activeNavText: { color: GREEN, fontSize: 10, fontWeight: "700" },
  navText: { color: MUTED, fontSize: 10 },
});
