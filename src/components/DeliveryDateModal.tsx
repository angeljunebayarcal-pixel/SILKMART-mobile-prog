
import React, {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";

// =====================================
// COLORS
// =====================================

const GREEN = "#235F45";
const DARK = "#173B2C";
const MUTED = "#627C6E";
const BORDER = "#D5DDCF";
const CREAM = "#FAF9F1";

// =====================================
// TYPES
// =====================================

type DeliveryDateModalProps = {
  visible: boolean;
  onClose: () => void;
  onConfirm: (date: string) => void;
  saving?: boolean;
};

// =====================================
// CONSTANTS
// =====================================

const WEEKDAYS = [
  "S",
  "M",
  "T",
  "W",
  "T",
  "F",
  "S",
];

const MONTH_LIMIT = 24;

// =====================================
// DATE HELPERS
// =====================================

function dateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function startOfToday(): Date {
  const now = new Date();

  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );
}

function firstDayOfMonth(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    1
  );
}

function addMonths(
  date: Date,
  count: number
): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth() + count,
    1
  );
}

function formatSelectedDate(
  value: string
): string {
  if (!value) {
    return "Select a delivery date";
  }

  const parts = value.split("-");

  if (parts.length !== 3) {
    return value;
  }

  const date = new Date(
    Number(parts[0]),
    Number(parts[1]) - 1,
    Number(parts[2])
  );

  return date.toLocaleDateString("en-PH", {
    weekday: "short",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// =====================================
// DELIVERY DATE MODAL
// =====================================

export default function DeliveryDateModal({
  visible,
  onClose,
  onConfirm,
  saving = false,
}: DeliveryDateModalProps) {
  const [month, setMonth] = useState(
    () => firstDayOfMonth(startOfToday())
  );

  const [selected, setSelected] =
    useState("");

  // =====================================
  // RESET WHEN OPENED
  // =====================================

  useEffect(() => {
    if (!visible) {
      return;
    }

    const today = startOfToday();

    setMonth(firstDayOfMonth(today));
    setSelected("");
  }, [visible]);

  // =====================================
  // CALENDAR LIMITS
  // =====================================

  const today = startOfToday();

  const minMonth =
    firstDayOfMonth(today);

  const maxMonth =
    addMonths(minMonth, MONTH_LIMIT);

  const canGoBack =
    month.getTime() >
    minMonth.getTime();

  const canGoForward =
    month.getTime() <
    maxMonth.getTime();

  // =====================================
  // GENERATE CALENDAR CELLS
  // =====================================

  const cells = useMemo(() => {
    const firstWeekday = new Date(
      month.getFullYear(),
      month.getMonth(),
      1
    ).getDay();

    const daysInMonth = new Date(
      month.getFullYear(),
      month.getMonth() + 1,
      0
    ).getDate();

    const blanks = Array.from(
      { length: firstWeekday },
      () => 0
    );

    const days = Array.from(
      { length: daysInMonth },
      (_, index) => index + 1
    );

    return [
      ...blanks,
      ...days,
    ];
  }, [month]);

  // =====================================
  // CHANGE MONTH
  // =====================================

  function previousMonth() {
    if (!canGoBack || saving) {
      return;
    }

    setMonth(
      addMonths(month, -1)
    );
  }

  function nextMonth() {
    if (!canGoForward || saving) {
      return;
    }

    setMonth(
      addMonths(month, 1)
    );
  }

  // =====================================
  // CONFIRM DELIVERY DATE
  // =====================================

  function confirmDate() {
    if (
      !selected ||
      saving
    ) {
      return;
    }

    // Prevent submitting a date that
    // has become outdated while the
    // calendar was left open.

    const minimumDate =
      dateKey(startOfToday());

    if (selected < minimumDate) {
      setSelected("");
      return;
    }

    onConfirm(selected);
  }

  // =====================================
  // RENDER
  // =====================================

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {/* HEADER */}

          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.heading}>
                Confirm delivery date
              </Text>

              <Text style={styles.help}>
                Select a date to confirm or
                reschedule the customer's
                delivery. Payment is Cash
                on Delivery (COD).
              </Text>
            </View>

            <Pressable
              disabled={saving}
              onPress={onClose}
              style={styles.closeButton}
              accessibilityLabel="Close calendar"
            >
              <Ionicons
                name="close"
                size={23}
                color={DARK}
              />
            </Pressable>
          </View>

          {/* MONTH NAVIGATION */}

          <View style={styles.monthRow}>
            <Pressable
              disabled={
                !canGoBack ||
                saving
              }
              onPress={previousMonth}
              style={styles.monthArrow}
              accessibilityLabel="Previous month"
            >
              <Ionicons
                name="chevron-back"
                size={23}
                color={
                  canGoBack
                    ? GREEN
                    : BORDER
                }
              />
            </Pressable>

            <Text style={styles.month}>
              {month.toLocaleDateString(
                "en-PH",
                {
                  month: "long",
                  year: "numeric",
                }
              )}
            </Text>

            <Pressable
              disabled={
                !canGoForward ||
                saving
              }
              onPress={nextMonth}
              style={styles.monthArrow}
              accessibilityLabel="Next month"
            >
              <Ionicons
                name="chevron-forward"
                size={23}
                color={
                  canGoForward
                    ? GREEN
                    : BORDER
                }
              />
            </Pressable>
          </View>

          {/* WEEKDAY HEADINGS */}

          <View style={styles.grid}>
            {WEEKDAYS.map(
              (day, index) => (
                <Text
                  key={`weekday-${index}`}
                  style={styles.dayHead}
                >
                  {day}
                </Text>
              )
            )}

            {/* CALENDAR DAYS */}

            {cells.map(
              (day, index) => {
                if (!day) {
                  return (
                    <View
                      key={`blank-${index}`}
                      style={styles.cell}
                    />
                  );
                }

                const date = new Date(
                  month.getFullYear(),
                  month.getMonth(),
                  day
                );

                const key =
                  dateKey(date);

                const disabled =
                  date.getTime() <
                  today.getTime();

                const active =
                  selected === key;

                return (
                  <Pressable
                    key={key}
                    disabled={
                      disabled ||
                      saving
                    }
                    onPress={() =>
                      setSelected(key)
                    }
                    accessibilityLabel={`Select ${date.toLocaleDateString(
                      "en-PH",
                      {
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      }
                    )}`}
                    style={[
                      styles.cell,
                      active &&
                        styles.active,
                    ]}
                  >
                    <Text
                      style={[
                        styles.day,
                        disabled &&
                          styles.disabled,
                        active &&
                          styles.activeDay,
                      ]}
                    >
                      {day}
                    </Text>
                  </Pressable>
                );
              }
            )}
          </View>

          {/* SELECTED DATE */}

          <View style={styles.choiceBox}>
            <Ionicons
              name="calendar-outline"
              size={17}
              color={GREEN}
            />

            <Text style={styles.choice}>
              {selected
                ? `Selected: ${formatSelectedDate(
                    selected
                  )}`
                : "Select a delivery date"}
            </Text>
          </View>

          {/* ACTIONS */}

          <View style={styles.actions}>
            <Pressable
              disabled={saving}
              style={styles.cancel}
              onPress={onClose}
            >
              <Text style={styles.cancelText}>
                Cancel
              </Text>
            </Pressable>

            <Pressable
              disabled={
                !selected ||
                saving
              }
              style={[
                styles.confirm,
                (!selected ||
                  saving) &&
                  styles.confirmDisabled,
              ]}
              onPress={confirmDate}
            >
              <Ionicons
                name="checkmark-circle-outline"
                size={18}
                color="#FFFFFF"
              />

              <Text style={styles.confirmText}>
                {saving
                  ? "Saving..."
                  : "Confirm Schedule"}
              </Text>
            </Pressable>
          </View>

          {/* INFORMATION */}

          <Text style={styles.footerNote}>
            The confirmed schedule will
            appear in the customer's order
            details and notifications.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

// =====================================
// STYLES
// =====================================

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 18,
  },

  card: {
    backgroundColor: CREAM,
    borderRadius: 20,
    padding: 18,
    maxWidth: 420,
    width: "100%",
    alignSelf: "center",
  },

  header: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
  },

  heading: {
    fontSize: 22,
    fontFamily: "serif",
    color: DARK,
  },

  help: {
    fontSize: 11,
    color: MUTED,
    lineHeight: 18,
    marginTop: 7,
  },

  closeButton: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },

  monthRow: {
    marginTop: 23,
    marginBottom: 15,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  monthArrow: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },

  month: {
    fontSize: 15,
    color: DARK,
    fontWeight: "700",
  },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },

  dayHead: {
    width: "14.2857%",
    textAlign: "center",
    fontSize: 11,
    color: MUTED,
    fontWeight: "600",
    paddingVertical: 8,
  },

  cell: {
    width: "14.2857%",
    height: 40,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 9,
  },

  day: {
    fontSize: 12,
    color: DARK,
  },

  disabled: {
    color: "#B8C2BA",
  },

  active: {
    backgroundColor: GREEN,
  },

  activeDay: {
    color: "#FFFFFF",
    fontWeight: "700",
  },

  choiceBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#EAF2E8",
    borderRadius: 11,
    paddingVertical: 12,
    paddingHorizontal: 10,
    marginTop: 16,
  },

  choice: {
    textAlign: "center",
    color: GREEN,
    fontWeight: "600",
    fontSize: 12,
    flexShrink: 1,
  },

  actions: {
    flexDirection: "row",
    gap: 9,
    marginTop: 17,
  },

  cancel: {
    flex: 1,
    padding: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },

  cancelText: {
    color: DARK,
    fontWeight: "700",
    fontSize: 12,
  },

  confirm: {
    flex: 2,
    backgroundColor: GREEN,
    paddingVertical: 13,
    paddingHorizontal: 9,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 7,
  },

  confirmDisabled: {
    opacity: 0.45,
  },

  confirmText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 12,
  },

  footerNote: {
    color: MUTED,
    fontSize: 10,
    lineHeight: 17,
    textAlign: "center",
    marginTop: 15,
  },
});
