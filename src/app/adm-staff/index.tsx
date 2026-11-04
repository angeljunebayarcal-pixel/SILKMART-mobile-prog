
import React from "react";

import {
  ScrollView,
  Text,
  View,
} from "react-native";

import {
  useRouter,
  type Href,
} from "expo-router";

import {
  Action,
  DemoNote,
  Fade,
  Heading,
  S,
  Stat,
} from "../../components/AdminUI";

export default function AdminDashboard() {
  const router = useRouter();

  function navigate(path: Href) {
    router.push(path);
  }

  return (
    <ScrollView
      style={S.page}
      contentContainerStyle={S.content}
      showsVerticalScrollIndicator={false}
    >
      <Heading
        label="SILKMART · ADMIN / STAFF"
        title="Overview."
        description="Manage silkworm orders, inventory, and deliveries in one place."
      />

      <Fade delay={100}>
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 10,
            marginBottom: 18,
          }}
        >
          <Stat
            icon="leaf-outline"
            label="Silkworm Stock"
            value="—"
            note="Connect Firestore inventory"
          />

          <Stat
            icon="receipt-outline"
            label="Customer Orders"
            value="—"
            note="Awaiting order backend"
          />

          <Stat
            icon="calendar-outline"
            label="Deliveries"
            value="—"
          />

          <Stat
            icon="ellipse-outline"
            label="Cocoon Records"
            value="—"
          />
        </View>
      </Fade>

      <Fade delay={180}>
        <View style={S.card}>
          <Text
            style={[
              S.sectionTitle,
              { marginBottom: 12 },
            ]}
          >
            Quick access
          </Text>

          <View style={{ gap: 9 }}>
            <Action
              title="Inventory Management"
              icon="layers-outline"
              onPress={() =>
                navigate("/adm-staff/inventory")
              }
            />

            <Action
              title="Product Management"
              icon="cube-outline"
              onPress={() =>
                navigate("/adm-staff/products")
              }
            />

            <Action
              title="Customer Orders"
              icon="receipt-outline"
              onPress={() =>
                navigate("/adm-staff/cust-orders")
              }
            />

            <Action
              title="Delivery Management"
              icon="calendar-outline"
              onPress={() =>
                navigate("/adm-staff/delivery")
              }
            />
          </View>
        </View>
      </Fade>

      <Fade delay={240}>
        <DemoNote
          text="Live dashboard totals will appear after Firestore inventory, ordering, and delivery collections are connected. No sample totals are presented as real records."
        />
      </Fade>
    </ScrollView>
  );
}
