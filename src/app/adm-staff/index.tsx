
import React, {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";

import {
  collection,
  doc,
  onSnapshot,
} from "firebase/firestore";

import { db } from "../../firebase/config";

import {
  Action,
  C,
  Fade,
  Heading,
  S,
  Stat,
} from "../../components/AdminUI";

// =====================================
// TYPES
// =====================================

type GraphPeriod = "daily" | "monthly";

type GraphCategory =
  | "orders"
  | "products"
  | "silkworms"
  | "cocoons";

type OrderItem = {
  productId: string;
  quantity: number;
};

type OrderRecord = {
  id: string;
  createdAt: number;
  deliveredAt: number;
  status: string;
  deliveryStatus: string;
  items: OrderItem[];
};

type ProductRecord = {
  id: string;
  category: string;
};

type SilkwormRecord = {
  id: string;
  quantity: number;
};

type ActivityRecord = {
  id: string;
  createdAt: number;
  type: string;
};

type CocoonInventory = {
  good: number;
  minor: number;
  unusable: number;
  reserved: number;
};

type GraphPoint = {
  key: string;
  label: string;
  orders: number;
  products: number;
  silkworms: number;
  cocoons: number;
};

type GraphSeries = {
  key: GraphCategory;
  label: string;
  color: string;
};

// =====================================
// CONSTANTS
// =====================================

const GRAPH_HEIGHT = 180;

const SERIES: GraphSeries[] = [
  {
    key: "orders",
    label: "Orders",
    color: "#235F45",
  },
  {
    key: "products",
    label: "Products",
    color: "#477BA8",
  },
  {
    key: "silkworms",
    label: "Silkworms",
    color: "#B78A32",
  },
  {
    key: "cocoons",
    label: "Cocoons",
    color: "#9367A6",
  },
];

const EMPTY_COCOONS: CocoonInventory = {
  good: 0,
  minor: 0,
  unusable: 0,
  reserved: 0,
};

// =====================================
// HELPER FUNCTIONS
// =====================================

function asNonNegativeNumber(value: unknown): number {
  const result = Number(value);

  return Number.isFinite(result) && result >= 0
    ? result
    : 0;
}

function timestampMillis(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);

    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (value !== null && typeof value === "object") {
    const timestamp = value as {
      toMillis?: () => number;
      seconds?: number;
    };

    if (typeof timestamp.toMillis === "function") {
      return timestamp.toMillis();
    }

    if (typeof timestamp.seconds === "number") {
      return timestamp.seconds * 1000;
    }
  }

  return 0;
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-PH");
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function dayKey(date: Date): string {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-");
}

function monthKey(date: Date): string {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
  ].join("-");
}

function periodKey(
  timestamp: number,
  period: GraphPeriod
): string {
  if (!timestamp) return "";

  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) return "";

  return period === "daily"
    ? dayKey(date)
    : monthKey(date);
}

// =====================================
// GRAPH PERIODS
// =====================================

function createPeriods(
  period: GraphPeriod
): GraphPoint[] {
  const today = new Date();

  if (period === "daily") {
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate() - (6 - index)
      );

      return {
        key: dayKey(date),
        label: date.toLocaleDateString("en-PH", {
          day: "numeric",
          month: "short",
        }),
        orders: 0,
        products: 0,
        silkworms: 0,
        cocoons: 0,
      };
    });
  }

  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(
      today.getFullYear(),
      today.getMonth() - (5 - index),
      1
    );

    return {
      key: monthKey(date),
      label: date.toLocaleDateString("en-PH", {
        month: "short",
        year: "2-digit",
      }),
      orders: 0,
      products: 0,
      silkworms: 0,
      cocoons: 0,
    };
  });
}

// =====================================
// BUILD GRAPH DATA
// =====================================

function buildGraphData(
  period: GraphPeriod,
  orders: OrderRecord[],
  products: ProductRecord[],
  activities: ActivityRecord[]
): GraphPoint[] {
  const points = createPeriods(period);

  const pointMap = new Map<string, GraphPoint>();

  for (const point of points) {
    pointMap.set(point.key, point);
  }

  const productCategoryMap = new Map(
    products.map(product => [
      product.id,
      product.category,
    ])
  );

  function add(
    category: GraphCategory,
    timestamp: number,
    quantity: number
  ) {
    const key = periodKey(timestamp, period);
    const point = pointMap.get(key);

    if (!point || quantity <= 0) return;

    point[category] += quantity;
  }

  // =====================================
  // ORDERS PLACED
  // =====================================

  for (const order of orders) {
    add("orders", order.createdAt, 1);
  }

  // =====================================
  // SUCCESSFULLY DELIVERED PRODUCTS
  // =====================================

  for (const order of orders) {
    if (
      order.status !== "Confirmed" ||
      order.deliveryStatus !== "Delivered" ||
      !order.deliveredAt
    ) {
      continue;
    }

    for (const item of order.items) {
      if (
        !Number.isSafeInteger(item.quantity) ||
        item.quantity <= 0
      ) {
        continue;
      }

      // Count all purchased product units.

      add(
        "products",
        order.deliveredAt,
        item.quantity
      );

      // Count delivered silkworm units separately.

      if (
        productCategoryMap.get(item.productId) ===
        "Silkworms"
      ) {
        add(
          "silkworms",
          order.deliveredAt,
          item.quantity
        );
      }
    }
  }

  // =====================================
  // COCOON INVENTORY ACTIVITY
  // =====================================

  for (const activity of activities) {
    if (activity.type === "cocoon") {
      add(
        "cocoons",
        activity.createdAt,
        1
      );
    }
  }

  return points;
}

// =====================================
// GRAPH LINE COMPONENT
// =====================================

function GraphLine({
  x1,
  y1,
  x2,
  y2,
  color,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
}) {
  const dx = x2 - x1;
  const dy = y2 - y1;

  const length = Math.sqrt(dx * dx + dy * dy);

  if (length <= 0) return null;

  const angle =
    (Math.atan2(dy, dx) * 180) / Math.PI;

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: (x1 + x2) / 2 - length / 2,
        top: (y1 + y2) / 2 - 1.5,
        width: length,
        height: 3,
        borderRadius: 2,
        backgroundColor: color,
        transform: [
          {
            rotate: `${angle}deg`,
          },
        ],
      }}
    />
  );
}

// =====================================
// ACTIVITY LINE GRAPH
// =====================================

function ActivityLineGraph({
  data,
  visibleCategories,
}: {
  data: GraphPoint[];
  visibleCategories: GraphCategory[];
}) {
  const [plotWidth, setPlotWidth] = useState(0);

  const activeSeries = SERIES.filter(series =>
    visibleCategories.includes(series.key)
  );

  const maximum = Math.max(
    1,
    ...data.flatMap(point =>
      activeSeries.map(series => point[series.key])
    )
  );

  const axisMaximum = Math.max(
    2,
    Math.ceil(maximum / 2) * 2
  );

  const inset = 9;

  const usableWidth = Math.max(
    1,
    plotWidth - inset * 2
  );

  function getX(index: number): number {
    return (
      inset +
      (index / Math.max(1, data.length - 1)) *
        usableWidth
    );
  }

  function getY(value: number): number {
    return (
      GRAPH_HEIGHT -
      (value / axisMaximum) * GRAPH_HEIGHT
    );
  }

  return (
    <View style={styles.graphContainer}>
      {/* VALUE AXIS */}

      <View style={styles.valueAxis}>
        <Text style={styles.axisText}>
          {axisMaximum}
        </Text>

        <Text style={styles.axisText}>
          {axisMaximum / 2}
        </Text>

        <Text style={styles.axisText}>
          0
        </Text>
      </View>

      {/* GRAPH */}

      <View style={styles.graphArea}>
        <View
          style={styles.plotArea}
          onLayout={event => {
            const width = event.nativeEvent.layout.width;

            if (width !== plotWidth) {
              setPlotWidth(width);
            }
          }}
        >
          {/* HORIZONTAL GRID LINES */}

          {[0, 0.5, 1].map(level => (
            <View
              key={level}
              pointerEvents="none"
              style={[
                styles.gridLine,
                {
                  top: level * GRAPH_HEIGHT,
                },
              ]}
            />
          ))}

          {/* GRAPH DATA LINES */}

          {plotWidth > 0 &&
            activeSeries.map(series => (
              <React.Fragment key={series.key}>
                {data
                  .slice(0, -1)
                  .map((point, index) => {
                    const next = data[index + 1];

                    return (
                      <GraphLine
                        key={`${series.key}-${index}`}
                        x1={getX(index)}
                        y1={getY(point[series.key])}
                        x2={getX(index + 1)}
                        y2={getY(next[series.key])}
                        color={series.color}
                      />
                    );
                  })}

                {/* GRAPH DATA POINTS */}

                {data.map((point, index) => (
                  <View
                    key={`${series.key}-${point.key}`}
                    pointerEvents="none"
                    style={[
                      styles.graphDot,
                      {
                        left: getX(index) - 4,
                        top: getY(point[series.key]) - 4,
                        borderColor: series.color,
                      },
                    ]}
                  />
                ))}
              </React.Fragment>
            ))}
        </View>

        {/* DATE LABELS */}

        <View style={styles.dateAxis}>
          {data.map(point => (
            <Text
              key={point.key}
              style={styles.dateLabel}
              numberOfLines={2}
            >
              {point.label}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
}

// =====================================
// MAIN ADMIN DASHBOARD
// =====================================

export default function AdminDashboard() {
  const router = useRouter();

  // =====================================
  // FIRESTORE STATE
  // =====================================

  const [orders, setOrders] = useState<
    OrderRecord[]
  >([]);

  const [products, setProducts] = useState<
    ProductRecord[]
  >([]);

  const [silkworms, setSilkworms] = useState<
    SilkwormRecord[]
  >([]);

  const [cocoons, setCocoons] =
    useState<CocoonInventory>(
      EMPTY_COCOONS
    );

  const [activities, setActivities] = useState<
    ActivityRecord[]
  >([]);

  const [loaded, setLoaded] = useState<
    Record<string, boolean>
  >({});

  const [errors, setErrors] = useState<
    Record<string, string>
  >({});

  // =====================================
  // GRAPH CONTROLS
  // =====================================

  const [graphOpen, setGraphOpen] = useState(false);

  const [period, setPeriod] =
    useState<GraphPeriod>("daily");

  const [
    visibleCategories,
    setVisibleCategories,
  ] = useState<GraphCategory[]>([
    "orders",
    "products",
    "silkworms",
    "cocoons",
  ]);

  // =====================================
  // NAVIGATION
  // =====================================

  function navigate(path: Href) {
    router.push(path);
  }

  // =====================================
  // LOADING AND ERROR HELPERS
  // =====================================

  function markLoaded(key: string) {
    setLoaded(current => ({
      ...current,
      [key]: true,
    }));
  }

  function clearError(key: string) {
    setErrors(current => ({
      ...current,
      [key]: "",
    }));
  }

  function saveError(
    key: string,
    message: string
  ) {
    setErrors(current => ({
      ...current,
      [key]: message,
    }));
  }

  // =====================================
  // LIVE CUSTOMER ORDERS
  // =====================================

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "orders"),

      snapshot => {
        const records: OrderRecord[] =
          snapshot.docs.map(item => {
            const data = item.data();

            const orderItems: OrderItem[] =
              Array.isArray(data.items)
                ? data.items.map((product: any) => ({
                    productId: String(
                      product.productId ?? ""
                    ),
                    quantity: Number(
                      product.quantity ?? 0
                    ),
                  }))
                : [];

            return {
              id: item.id,

              createdAt: timestampMillis(
                data.createdAt
              ),

              deliveredAt: timestampMillis(
                data.deliveredAt
              ),

              status: String(
                data.status ?? "Pending"
              ),

              deliveryStatus: String(
                data.deliveryStatus ?? "Pending"
              ),

              items: orderItems,
            };
          });

        setOrders(records);
        clearError("orders");
        markLoaded("orders");
      },

      reason => {
        saveError("orders", reason.message);
        markLoaded("orders");
      }
    );

    return unsubscribe;
  }, []);

  // =====================================
  // LIVE PRODUCT RECORDS
  // =====================================

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "products"),

      snapshot => {
        const records: ProductRecord[] =
          snapshot.docs.map(item => ({
            id: item.id,
            category: String(
              item.data().category ?? "Other"
            ),
          }));

        setProducts(records);
        clearError("products");
        markLoaded("products");
      },

      reason => {
        saveError("products", reason.message);
        markLoaded("products");
      }
    );

    return unsubscribe;
  }, []);

  // =====================================
  // LIVE SILKWORM INVENTORY
  // =====================================

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "inventory_species"),

      snapshot => {
        const records: SilkwormRecord[] =
          snapshot.docs.map(item => ({
            id: item.id,
            quantity: asNonNegativeNumber(
              item.data().quantity
            ),
          }));

        setSilkworms(records);
        clearError("silkworms");
        markLoaded("silkworms");
      },

      reason => {
        saveError("silkworms", reason.message);
        markLoaded("silkworms");
      }
    );

    return unsubscribe;
  }, []);

  // =====================================
  // LIVE COCOON INVENTORY
  // =====================================

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, "inventory", "cocoons"),

      snapshot => {
        const data = snapshot.data();

        if (data) {
          setCocoons({
            good: asNonNegativeNumber(
              data.good
            ),

            minor: asNonNegativeNumber(
              data.minor
            ),

            unusable: asNonNegativeNumber(
              data.unusable
            ),

            reserved: asNonNegativeNumber(
              data.reserved
            ),
          });
        } else {
          setCocoons(EMPTY_COCOONS);
        }

        clearError("cocoons");
        markLoaded("cocoons");
      },

      reason => {
        saveError("cocoons", reason.message);
        markLoaded("cocoons");
      }
    );

    return unsubscribe;
  }, []);

  // =====================================
  // LIVE INVENTORY ACTIVITY
  // =====================================

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "inventory_activity"),

      snapshot => {
        const records: ActivityRecord[] =
          snapshot.docs.map(item => ({
            id: item.id,

            type: String(
              item.data().type ?? ""
            ),

            createdAt: timestampMillis(
              item.data().createdAt
            ),
          }));

        setActivities(records);
        clearError("activity");
        markLoaded("activity");
      },

      reason => {
        saveError("activity", reason.message);
        markLoaded("activity");
      }
    );

    return unsubscribe;
  }, []);

  // =====================================
  // LIVE DASHBOARD STATISTICS
  // =====================================

  const silkwormStock = useMemo(
    () =>
      silkworms.reduce(
        (sum, species) =>
          sum + species.quantity,
        0
      ),
    [silkworms]
  );

  const totalOrders = orders.length;

  const activeDeliveries = useMemo(
    () =>
      orders.filter(
        order =>
          order.status === "Confirmed" &&
          [
            "Scheduled",
            "Preparing",
            "Out for Delivery",
          ].includes(order.deliveryStatus)
      ).length,
    [orders]
  );

  // =====================================
  // AVAILABLE COCOONS
  // =====================================
  //
  // This is the same calculation used
  // in Inventory Management.
  //
  // Only good-quality cocoons that
  // are not reserved are counted.

  const availableCocoons = Math.max(
    0,
    cocoons.good - cocoons.reserved
  );

  // =====================================
  // GRAPH DATA
  // =====================================

  const graphData = useMemo(
    () =>
      buildGraphData(
        period,
        orders,
        products,
        activities
      ),
    [
      period,
      orders,
      products,
      activities,
    ]
  );

  const chartTotals = useMemo(
    () => ({
      orders: graphData.reduce(
        (sum, point) =>
          sum + point.orders,
        0
      ),

      products: graphData.reduce(
        (sum, point) =>
          sum + point.products,
        0
      ),

      silkworms: graphData.reduce(
        (sum, point) =>
          sum + point.silkworms,
        0
      ),

      cocoons: graphData.reduce(
        (sum, point) =>
          sum + point.cocoons,
        0
      ),
    }),
    [graphData]
  );

  // =====================================
  // LOADING STATES
  // =====================================

  const allReady = [
    "orders",
    "products",
    "silkworms",
    "cocoons",
    "activity",
  ].every(key => loaded[key]);

  const graphReady = [
    "orders",
    "products",
    "activity",
  ].every(key => loaded[key]);

  const errorEntries = Object.entries(
    errors
  ).filter(([, message]) => !!message);

  const hasActivity = Object.values(
    chartTotals
  ).some(total => total > 0);

  // =====================================
  // DISPLAY HELPERS
  // =====================================

  function displayCount(
    key: string,
    value: number
  ): string {
    if (!loaded[key]) return "…";
    if (errors[key]) return "—";

    return formatNumber(value);
  }

  function toggleSeries(
    category: GraphCategory
  ) {
    setVisibleCategories(current => {
      if (current.includes(category)) {
        if (current.length === 1) {
          return current;
        }

        return current.filter(
          item => item !== category
        );
      }

      return [...current, category];
    });
  }

  // =====================================
  // DASHBOARD USER INTERFACE
  // =====================================

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

      {/* =====================================
          LIVE STATISTICS
          ===================================== */}

      <Fade delay={100}>
        <View style={styles.statsContainer}>
          {/* SILKWORM STOCK */}

          <Stat
            icon="leaf-outline"
            label="Silkworm Stock"
            value={displayCount(
              "silkworms",
              silkwormStock
            )}
            note="Available inventory quantity"
          />

          {/* CUSTOMER ORDERS */}

          <Stat
            icon="receipt-outline"
            label="Customer Orders"
            value={displayCount(
              "orders",
              totalOrders
            )}
            note="Current order records"
          />

          {/* ACTIVE DELIVERIES */}

          <Stat
            icon="calendar-outline"
            label="Deliveries"
            value={displayCount(
              "orders",
              activeDeliveries
            )}
            note="Scheduled and active deliveries"
          />

          {/* AVAILABLE COCOONS */}

          <Stat
            icon="ellipse-outline"
            label="Available Cocoons"
            value={displayCount(
              "cocoons",
              availableCocoons
            )}
            note="Good-quality cocoons minus reserved"
          />
        </View>
      </Fade>

      {/* =====================================
          LOADING STATUS
          ===================================== */}

      {!allReady && (
        <View style={styles.statusRow}>
          <ActivityIndicator
            size="small"
            color={C.green}
          />

          <Text style={styles.statusText}>
            Loading live dashboard records...
          </Text>
        </View>
      )}

      {errorEntries.length > 0 && (
        <View style={styles.errorCard}>
          <Ionicons
            name="alert-circle-outline"
            size={20}
            color="#A43F3F"
          />

          <Text style={styles.errorText}>
            Some Firestore records could not be
            loaded. Check your connection and
            account permissions.
          </Text>
        </View>
      )}

      {/* =====================================
          ACTIVITY ANALYTICS
          ===================================== */}

      <Fade delay={150}>
        <View style={S.card}>
          <View style={styles.graphHeadingRow}>
            <View style={{ flex: 1 }}>
              <Text style={S.sectionTitle}>
                Activity Analytics
              </Text>

              <Text style={styles.mutedText}>
                View daily and monthly recorded
                order and inventory activity.
              </Text>
            </View>

            <Ionicons
              name="analytics-outline"
              size={24}
              color={C.green}
            />
          </View>

          {/* GRAPH TOGGLE BUTTON */}

          <Pressable
            accessibilityRole="button"
            onPress={() =>
              setGraphOpen(current => !current)
            }
            style={({ pressed }) => [
              styles.graphButton,
              pressed && styles.pressedButton,
            ]}
          >
            <Ionicons
              name={
                graphOpen
                  ? "chevron-up-outline"
                  : "stats-chart-outline"
              }
              size={19}
              color="#FFFFFF"
            />

            <Text style={styles.graphButtonText}>
              {graphOpen
                ? "Hide Line Graph"
                : "View Line Graph"}
            </Text>
          </Pressable>

          {/* =====================================
              LINE GRAPH PANEL
              ===================================== */}

          {graphOpen && (
            <View style={styles.graphPanel}>
              {/* DAILY / MONTHLY */}

              <View style={styles.periodControls}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    setPeriod("daily")
                  }
                  style={[
                    styles.periodButton,
                    period === "daily" &&
                      styles.activePeriod,
                  ]}
                >
                  <Text
                    style={[
                      styles.periodText,
                      period === "daily" &&
                        styles.activePeriodText,
                    ]}
                  >
                    Daily
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    setPeriod("monthly")
                  }
                  style={[
                    styles.periodButton,
                    period === "monthly" &&
                      styles.activePeriod,
                  ]}
                >
                  <Text
                    style={[
                      styles.periodText,
                      period === "monthly" &&
                        styles.activePeriodText,
                    ]}
                  >
                    Monthly
                  </Text>
                </Pressable>
              </View>

              <Text style={styles.periodDescription}>
                {period === "daily"
                  ? "Last 7 days"
                  : "Last 6 months"}
              </Text>

              {/* =====================================
                  GRAPH CATEGORY FILTERS
                  ===================================== */}

              <View style={styles.legendContainer}>
                {SERIES.map(series => {
                  const active =
                    visibleCategories.includes(
                      series.key
                    );

                  return (
                    <Pressable
                      key={series.key}
                      accessibilityRole="button"
                      accessibilityState={{
                        selected: active,
                      }}
                      onPress={() =>
                        toggleSeries(series.key)
                      }
                      style={[
                        styles.legendButton,
                        !active &&
                          styles.inactiveLegend,
                      ]}
                    >
                      <View
                        style={[
                          styles.legendDot,
                          {
                            backgroundColor:
                              series.color,
                          },
                        ]}
                      />

                      <Text style={styles.legendText}>
                        {series.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* =====================================
                  LINE GRAPH
                  ===================================== */}

              {!graphReady ? (
                <ActivityIndicator
                  color={C.green}
                  style={styles.chartLoading}
                />
              ) : (
                <>
                  <ActivityLineGraph
                    data={graphData}
                    visibleCategories={
                      visibleCategories
                    }
                  />

                  {!hasActivity && (
                    <Text style={styles.emptyGraphText}>
                      No recorded activity was found
                      for this period.
                    </Text>
                  )}
                </>
              )}

              {/* =====================================
                  PERIOD TOTALS
                  ===================================== */}

              <Text style={styles.totalsHeading}>
                Totals for this period
              </Text>

              <View style={styles.graphTotals}>
                {SERIES.map(series => (
                  <View
                    key={series.key}
                    style={styles.totalItem}
                  >
                    <View
                      style={[
                        styles.legendDot,
                        {
                          backgroundColor:
                            series.color,
                        },
                      ]}
                    />

                    <View style={{ flex: 1 }}>
                      <Text style={styles.totalLabel}>
                        {series.label}
                      </Text>

                      <Text style={styles.totalNumber}>
                        {formatNumber(
                          chartTotals[series.key]
                        )}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>

              {/* GRAPH EXPLANATION */}

              <Text style={styles.graphNote}>
                Orders count placement events.
                Products and Silkworms count
                units in successfully delivered
                orders. Cocoons count inventory
                update events, not individual
                cocoon units.
              </Text>

              <Text style={styles.graphNote}>
                Historical figures depend on
                retained Firestore records.
                Deleting an order removes it
                from these statistics. Silkworm
                classification uses the current
                product catalog, so deleted or
                recategorized products may not
                be classified historically.
              </Text>
            </View>
          )}
        </View>
      </Fade>

      {/* =====================================
          QUICK ACCESS
          ===================================== */}

      <Fade delay={180}>
        <View style={[S.card, styles.quickAccessCard]}>
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
    </ScrollView>
  );
}

// =====================================
// STYLES
// =====================================

const styles = StyleSheet.create({
  statsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 18,
  },

  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 13,
  },

  statusText: {
    fontSize: 11,
    color: C.muted,
  },

  errorCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    padding: 13,
    borderRadius: 12,
    backgroundColor: "#FFF1EE",
    marginBottom: 14,
  },

  errorText: {
    color: "#A43F3F",
    fontSize: 11,
    lineHeight: 18,
    flex: 1,
  },

  // =====================================
  // GRAPH HEADER
  // =====================================

  graphHeadingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 15,
  },

  mutedText: {
    color: C.muted,
    fontSize: 11,
    marginTop: 6,
    lineHeight: 17,
  },

  graphButton: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 9,
    backgroundColor: C.green,
    paddingVertical: 14,
    paddingHorizontal: 13,
    borderRadius: 12,
  },

  pressedButton: {
    opacity: 0.8,
  },

  graphButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 12,
  },

  // =====================================
  // GRAPH PANEL
  // =====================================

  graphPanel: {
    borderTopWidth: 1,
    borderTopColor: C.line,
    paddingTop: 18,
    marginTop: 19,
  },

  periodControls: {
    flexDirection: "row",
    backgroundColor: C.soft,
    padding: 4,
    borderRadius: 11,
    gap: 5,
  },

  periodButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 9,
  },

  activePeriod: {
    backgroundColor: C.green,
  },

  periodText: {
    color: C.green,
    fontSize: 12,
    fontWeight: "700",
  },

  activePeriodText: {
    color: "#FFFFFF",
  },

  periodDescription: {
    color: C.muted,
    fontSize: 11,
    marginTop: 12,
    marginBottom: 14,
    textAlign: "center",
  },

  // =====================================
  // GRAPH LEGEND
  // =====================================

  legendContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    marginBottom: 20,
  },

  legendButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: "#FFFDF8",
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 8,
  },

  inactiveLegend: {
    opacity: 0.45,
  },

  legendDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },

  legendText: {
    fontSize: 10,
    color: C.dark,
    fontWeight: "600",
  },

  // =====================================
  // LINE GRAPH
  // =====================================

  graphContainer: {
    flexDirection: "row",
    gap: 7,
    marginTop: 7,
  },

  valueAxis: {
    width: 29,
    height: GRAPH_HEIGHT + 1,
    justifyContent: "space-between",
    alignItems: "flex-end",
  },

  axisText: {
    color: C.muted,
    fontSize: 9,
  },

  graphArea: {
    flex: 1,
    minWidth: 0,
  },

  plotArea: {
    width: "100%",
    height: GRAPH_HEIGHT,
    position: "relative",
  },

  gridLine: {
    position: "absolute",
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderTopColor: "#DEE7DC",
  },

  graphDot: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#FFFDF8",
    borderWidth: 2,
  },

  dateAxis: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 13,
  },

  dateLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: 8,
    color: C.muted,
    textAlign: "center",
  },

  chartLoading: {
    paddingVertical: 45,
  },

  emptyGraphText: {
    color: C.muted,
    fontSize: 11,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 18,
  },

  // =====================================
  // ACTIVITY TOTALS
  // =====================================

  totalsHeading: {
    marginTop: 24,
    marginBottom: 12,
    color: C.dark,
    fontSize: 12,
    fontWeight: "700",
  },

  graphTotals: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
  },

  totalItem: {
    flexBasis: "45%",
    flexGrow: 1,
    flexDirection: "row",
    gap: 9,
    alignItems: "flex-start",
    padding: 12,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: "#FFFDF8",
    borderRadius: 11,
  },

  totalLabel: {
    color: C.muted,
    fontSize: 10,
  },

  totalNumber: {
    color: C.dark,
    fontSize: 21,
    fontFamily: "serif",
    marginTop: 5,
  },

  graphNote: {
    color: C.muted,
    fontSize: 10,
    lineHeight: 17,
    marginTop: 16,
  },

  // =====================================
  // QUICK ACCESS
  // =====================================

  quickAccessCard: {
    marginTop: 14,
  },
});
