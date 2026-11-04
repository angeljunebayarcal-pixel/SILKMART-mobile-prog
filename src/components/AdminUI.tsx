
import React, { useEffect, useRef } from "react";

import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";

export const C = {
  green: "#235F45",
  dark: "#173B2C",
  muted: "#627C6E",
  cream: "#FAF9F1",
  white: "#FFFDF8",
  line: "#D5DDCF",
  soft: "#EAF2E8",
};

export const S = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: C.cream,
  },

  content: {
    padding: 18,
    paddingBottom: 40,
  },

  eyebrow: {
    color: C.green,
    fontSize: 10,
    letterSpacing: 1.8,
    fontWeight: "800",
  },

  title: {
    fontFamily: "serif",
    color: C.dark,
    fontSize: 32,
    marginTop: 7,
  },

  description: {
    color: C.muted,
    fontSize: 12,
    lineHeight: 19,
    marginTop: 5,
    marginBottom: 18,
  },

  card: {
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 17,
    padding: 16,
    marginBottom: 13,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  sectionTitle: {
    fontSize: 22,
    fontFamily: "serif",
    color: C.dark,
  },

  muted: {
    color: C.muted,
    fontSize: 12,
    lineHeight: 18,
  },

  strong: {
    color: C.dark,
    fontSize: 13,
    fontWeight: "700",
  },

  button: {
    backgroundColor: C.green,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },

  buttonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 12,
  },

  chip: {
    backgroundColor: C.soft,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },

  chipActive: {
    backgroundColor: C.green,
  },

  input: {
    backgroundColor: C.white,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    color: C.dark,
    fontSize: 12,
  },

  badge: {
    borderRadius: 30,
    backgroundColor: C.soft,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },

  badgeText: {
    color: C.green,
    fontSize: 10,
    fontWeight: "700",
  },
});

type FadeProps = {
  children: React.ReactNode;
  delay?: number;
};

export function Fade({
  children,
  delay = 0,
}: FadeProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(
    new Animated.Value(12)
  ).current;

  useEffect(() => {
    const animation = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 450,
        delay,
        useNativeDriver: true,
      }),

      Animated.timing(translateY, {
        toValue: 0,
        duration: 450,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);

    animation.start();

    return () => animation.stop();
  }, [delay, opacity, translateY]);

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

type HeadingProps = {
  label: string;
  title: string;
  description: string;
};

export function Heading({
  label,
  title,
  description,
}: HeadingProps) {
  return (
    <Fade>
      <Text style={S.eyebrow}>{label}</Text>

      <Text style={S.title}>{title}</Text>

      <Text style={S.description}>
        {description}
      </Text>
    </Fade>
  );
}

type IconName =
  React.ComponentProps<typeof Ionicons>["name"];

type StatProps = {
  icon: IconName;
  label: string;
  value: string | number;
  note?: string;
};

export function Stat({
  icon,
  label,
  value,
  note,
}: StatProps) {
  return (
    <View
      style={[
        S.card,
        {
          flex: 1,
          minWidth: 145,
          marginBottom: 0,
        },
      ]}
    >
      <View style={S.row}>
        <View
          style={{
            backgroundColor: C.soft,
            padding: 9,
            borderRadius: 13,
          }}
        >
          <Ionicons
            name={icon}
            size={21}
            color={C.green}
          />
        </View>

        <View style={{ flex: 1 }}>
          <Text
            style={[
              S.muted,
              { fontSize: 11 },
            ]}
          >
            {label}
          </Text>

          <Text
            style={{
              fontSize: 26,
              fontFamily: "serif",
              color: C.dark,
            }}
          >
            {value}
          </Text>
        </View>
      </View>

      {note ? (
        <Text
          style={[
            S.muted,
            {
              fontSize: 10,
              marginTop: 5,
            },
          ]}
        >
          {note}
        </Text>
      ) : null}
    </View>
  );
}

type ActionProps = {
  title: string;
  onPress: () => void;
  icon?: IconName;
  disabled?: boolean;
};

export function Action({
  title,
  onPress,
  icon = "chevron-forward",
  disabled = false,
}: ActionProps) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [
        S.button,
        disabled && { opacity: 0.5 },
        pressed && {
          opacity: 0.8,
          transform: [{ scale: 0.98 }],
        },
      ]}
    >
      <Text style={S.buttonText}>
        {title}
      </Text>

      <Ionicons
        name={icon}
        color="#FFFFFF"
        size={16}
      />
    </Pressable>
  );
}

type SearchProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
};

export function Search({
  value,
  onChange,
  placeholder,
}: SearchProps) {
  return (
    <View style={{ marginBottom: 13 }}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#87978A"
        style={S.input}
        accessibilityLabel={placeholder}
      />
    </View>
  );
}

export function Status({
  value,
}: {
  value: string;
}) {
  return (
    <View style={S.badge}>
      <Text style={S.badgeText}>
        {value}
      </Text>
    </View>
  );
}

export function DemoNote({
  text,
}: {
  text: string;
}) {
  return (
    <View
      style={[
        S.card,
        {
          backgroundColor: C.soft,
          flexDirection: "row",
          gap: 9,
        },
      ]}
    >
      <Ionicons
        name="information-circle-outline"
        color={C.green}
        size={20}
      />

      <Text
        style={[
          S.muted,
          { flex: 1 },
        ]}
      >
        {text}
      </Text>
    </View>
  );
}
