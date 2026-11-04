import React, { useEffect, useRef } from "react";
import { Animated, Easing, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

const GREEN = "#235F45";
const DARK = "#173B2C";
const MUTED = "#627C6E";
const CREAM = "#F6F8F0";
const BORDER = "#C9D8CC";

const SILKWORM_IMAGE =
  "https://mp3tourl.com/images/1792036648578-cce5b0f3-87c3-4557-ab11-f9a03e08a192.png";


function SilkMartLogo({ small = false }: { small?: boolean }) {
  const size = small ? 40 : 48;

  return (
    <View style={styles.brandRow}>
      <View
        style={[
          styles.logoCircle,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
          },
        ]}
      >
        <Svg
          width={size * 0.63}
          height={size * 0.63}
          viewBox="0 0 24 24"
          fill="none"
        >
          <Circle cx="8.8" cy="8.9" r="1.55" stroke={GREEN} strokeWidth="1.2" />
          <Circle cx="11.1" cy="8" r="1.55" stroke={GREEN} strokeWidth="1.2" />
          <Circle cx="13.5" cy="7.4" r="1.55" stroke={GREEN} strokeWidth="1.2" />
          <Circle cx="15.8" cy="7.2" r="1.55" stroke={GREEN} strokeWidth="1.2" />
          <Circle cx="18.2" cy="7.4" r="1.75" stroke={GREEN} strokeWidth="1.2" />
          <Circle cx="18.7" cy="7" r="0.24" fill={GREEN} />

          <Path
            d="M18.5 5.9C19 5.1 19.7 4.9 20.4 5.1"
            stroke={GREEN}
            strokeWidth="1"
            strokeLinecap="round"
          />
          <Path
            d="M17.5 5.9C17.2 5.1 16.5 4.8 15.9 4.9"
            stroke={GREEN}
            strokeWidth="1"
            strokeLinecap="round"
          />
          <Path
            d="M19.5 3.5C13 3.5 7 6.5 5 12.5C3.8 16.1 5.4 19.2 8.5 20.5C11.8 21.8 15.5 20.1 17.4 17.1 19.5 13.8 19.5 8.5 19.5 3.5Z"
            stroke={GREEN}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M5 19C8 15 11.5 12 16.5 9"
            stroke={GREEN}
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </Svg>
      </View>

      <View>
        <Text style={[styles.brandTitle, small && { fontSize: 23 }]}>
          SilkMart
        </Text>
        <Text style={styles.brandSubtitle}>
          VILLANUEVA (DOST-PTRI)
        </Text>
      </View>
    </View>
  );
}


function FadeText({
  children,
  style,
  delay = 0,
}: {
  children: React.ReactNode;
  style?: any;
  delay?: number;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(15)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        delay,
        duration: 620,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        delay,
        duration: 620,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [delay, opacity, translateY]);

  return (
    <Animated.Text
      style={[style, { opacity, transform: [{ translateY }] }]}
    >
      {children}
    </Animated.Text>
  );
}


function FadeView({
  children,
  delay = 0,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  style?: any;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const offset = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        delay,
        duration: 570,
        useNativeDriver: true,
      }),
      Animated.timing(offset, {
        toValue: 0,
        delay,
        duration: 570,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [delay, opacity, offset]);

  return (
    <Animated.View
      style={[style, { opacity, transform: [{ translateY: offset }] }]}
    >
      {children}
    </Animated.View>
  );
}


function MainButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.primaryButton,
        pressed && {
          opacity: 0.86,
          transform: [{ scale: 0.98 }],
        },
      ]}
    >
      <Text style={styles.primaryButtonText}>{label}</Text>
      <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />
    </Pressable>
  );
}


export default function WelcomeScreen() {
  const router = useRouter();

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <StatusBar barStyle="dark-content" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
          <View key="welcome" style={styles.page}>
            <FadeView delay={60}>
              <SilkMartLogo />
            </FadeView>

            <FadeView delay={180} style={styles.welcomeImageBox}>
              <Image
                source={{ uri: SILKWORM_IMAGE }}
                style={styles.welcomeImage}
                resizeMode="cover"
              />
            </FadeView>

            <FadeText style={styles.eyebrow} delay={300}>
              WELCOME!
            </FadeText>

            <FadeText style={styles.heroTitle} delay={400}>
              Discover the beauty
            </FadeText>

            <FadeText style={styles.heroItalic} delay={510}>
              of Villanueva Silk.
            </FadeText>

            <FadeText style={styles.heroDescription} delay={620}>
              Handcrafted silk products inspired by the natural beauty
              and tradition of Villanueva (DOST-PTRI).
            </FadeText>

            <FadeView delay={770} style={styles.lastButtonArea}>
              <MainButton
                label="Explore now"
                onPress={() => router.push("/login")}
              />
            </FadeView>
          </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: CREAM,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 0,
  },
  page: {
    paddingHorizontal: 25,
    paddingTop: 42,
    paddingBottom: 24,
    backgroundColor: CREAM,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  logoCircle: {
    borderWidth: 1,
    borderColor: "#96B2A0",
    backgroundColor: "#F9FBF5",
    alignItems: "center",
    justifyContent: "center",
  },
  brandTitle: {
    fontFamily: "serif",
    color: DARK,
    fontSize: 29,
    lineHeight: 34,
  },
  brandSubtitle: {
    color: "#657C6C",
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 1.9,
    marginTop: 3,
  },
  welcomeImageBox: {
    height: 175,
    marginTop: 30,
    marginBottom: 25,
    position: "relative",
    overflow: "hidden",
    borderRadius: 20,
    backgroundColor: "#EAF0DF",
  },
  welcomeImage: {
    width: "100%",
    height: "100%",
    borderRadius: 20,
  },
  eyebrow: {
    color: GREEN,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2.3,
    marginBottom: 12,
  },
  heroTitle: {
    color: DARK,
    fontFamily: "serif",
    fontSize: 42,
    lineHeight: 47,
  },
  heroItalic: {
    color: "#3D795D",
    fontFamily: "serif",
    fontStyle: "italic",
    fontSize: 42,
    lineHeight: 48,
  },
  heroDescription: {
    color: MUTED,
    fontSize: 14,
    lineHeight: 24,
    marginTop: 18,
  },
  primaryButton: {
    backgroundColor: GREEN,
    minHeight: 54,
    borderRadius: 29,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
    paddingHorizontal: 20,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 15,
  },
  lastButtonArea: {
    marginTop: 24,
  },
});
