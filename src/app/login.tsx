import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebase/config";

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


function OutlineButton({
  label,
  onPress,
  soft = false,
  iconName,
}: {
  label: string;
  onPress: () => void;
  soft?: boolean;
  iconName?: IconName;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.outlineButton,
        soft && styles.softButton,
        pressed && { opacity: 0.7 },
      ]}
    >
      {iconName && (
        <Ionicons name={iconName} size={19} color={GREEN} />
      )}

      <Text style={styles.outlineButtonText}>{label}</Text>

      <Ionicons
        name="arrow-forward-outline"
        size={18}
        color={GREEN}
      />
    </Pressable>
  );
}


function FormInput({
  label,
  placeholder,
  value,
  onChangeText,
  secure = false,
  keyboardType = "default",
  autoCapitalize = "sentences",
  iconName,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (value: string) => void;
  secure?: boolean;
  keyboardType?: "default" | "email-address" | "phone-pad";
  autoCapitalize?: "none" | "sentences" | "words";
  iconName?: IconName;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>

      <View style={styles.inputBox}>
        {iconName && (
          <Ionicons
            name={iconName}
            size={19}
            color="#7B9684"
            style={styles.inputIcon}
          />
        )}

        <TextInput
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor="#9BAEA2"
          value={value}
          onChangeText={onChangeText}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          keyboardType={keyboardType}
          secureTextEntry={secure && !visible}
        />

        {secure && (
          <Pressable
            onPress={() => setVisible(!visible)}
            accessibilityRole="button"
            accessibilityLabel={
              visible ? "Hide password" : "Show password"
            }
            style={styles.showButton}
          >
            <Ionicons
              name={visible ? "eye-outline" : "eye-off-outline"}
              size={21}
              color={GREEN}
            />
          </Pressable>
        )}
      </View>
    </View>
  );
}


export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginNotice, setLoginNotice] = useState<{
    kind: "success" | "error" | "warning";
    title: string;
    message: string;
  } | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [resetVisible, setResetVisible] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetSending, setResetSending] = useState(false);
  const [resetError, setResetError] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const [noticeClosing, setNoticeClosing] = useState(false);
  const [successDestination, setSuccessDestination] = useState<"customer" | "admin">("customer");

  function closeLoginNotice() {
    if (!loginNotice || noticeClosing) return;

    const isSuccess = loginNotice.kind === "success";
    setNoticeClosing(true);

    // Keep the notice content intact while its fade-out finishes.
    setTimeout(() => {
      if (isSuccess) {
        router.replace(successDestination === "admin" ? "/adm-staff" : "/customer");
      } else {
        setLoginNotice(null);
        setNoticeClosing(false);
      }
    }, 300);
  }

  function openPasswordReset() {
    setResetEmail(email.trim());
    setResetError("");
    setResetSent(false);
    setResetVisible(true);
  }

  function closePasswordReset() {
    if (resetSending) return;
    setResetVisible(false);
    setResetError("");
  }

  async function sendResetLink() {
    if (resetSending) return;
    const address = resetEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setResetError("Please enter a valid email address.");
      return;
    }
    setResetSending(true);
    setResetError("");
    try {
      await sendPasswordResetEmail(auth, address);
      // Firebase email enumeration protection can make unknown emails appear successful.
      // Avoid confirming whether an account exists.
      setResetSent(true);
    } catch (error: unknown) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? String(error.code) : "";
      setResetError(
        code === "auth/too-many-requests"
          ? "Too many requests. Please try again later."
          : code === "auth/network-request-failed"
            ? "Check your internet connection and try again."
            : code === "auth/invalid-email"
              ? "Please enter a valid email address."
              : "We couldn't process the request right now. Please try again."
      );
    } finally {
      setResetSending(false);
    }
  }

  async function signIn() {
    if (signingIn) return;

    if (!email.trim() || !password.trim()) {
      setLoginNotice({
        kind: "warning",
        title: "Missing Information",
        message: "Please enter your email address and password.",
      });
      return;
    }

    setSigningIn(true);
    try {
      const credentials = await signInWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );
      let role = "";
      try {
        const profile = await getDoc(doc(db, "users", credentials.user.uid));
        role = String(profile.data()?.role ?? "").trim().toLowerCase();
      } catch {
        await signOut(auth);
        setLoginNotice({
          kind: "error",
          title: "Account Verification Unavailable",
          message: "Could not verify your role from Firestore. Check your connection or Firestore rules.",
        });
        return;
      }
      if (role === "staffapplicant" || role === "pendingstaff") {
        await signOut(auth);
        setLoginNotice({
          kind: "warning",
          title: "Application Pending",
          message: "Your staff account is awaiting administrator approval.",
        });
        return;
      }
      if (role === "administrator" || role === "admin" || role === "staff") {
        setSuccessDestination("admin");
      } else if (role === "customer") {
        setSuccessDestination("customer");
      } else {
        await signOut(auth);
        setLoginNotice({
          kind: "warning",
          title: "Account Access Unavailable",
          message: "Your account is not yet assigned an approved role. Contact the administrator.",
        });
        return;
      }
      setLoginNotice({
        kind: "success",
        title: "Signed In Successfully!",
        message: "Welcome back to SilkMart. Your account is ready.",
      });
    } catch (error: unknown) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String(error.code)
          : "";

      // Firebase may intentionally return the same error for an unknown
      // email and an incorrect password to prevent account discovery.
      const message =
        code === "auth/invalid-credential" ||
        code === "auth/wrong-password" ||
        code === "auth/user-not-found"
          ? "Email or password is incorrect. If you haven't created an account yet, tap Create an account below."
          : code === "auth/invalid-email"
            ? "Please enter a valid email address."
            : code === "auth/too-many-requests"
              ? "Too many attempts. Please try again later."
              : code === "auth/network-request-failed"
                ? "Please check your internet connection and try again."
                : code === "auth/user-disabled"
                  ? "This account is disabled. Please contact support."
                  : "Unable to sign in right now. Please try again.";

      setLoginNotice({
        kind: code === "auth/invalid-email" ? "warning" : "error",
        title: "Sign In Failed",
        message,
      });
    } finally {
      setSigningIn(false);
    }
  }


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
          <View key="login" style={styles.page}>
            <View style={styles.topActions}>
              <Pressable
                onPress={() => router.push("/")}
                accessibilityRole="button"
                style={styles.backButton}
              >
                <Ionicons
                  name="arrow-back"
                  size={19}
                  color={GREEN}
                />
                <Text style={styles.backText}>Back</Text>
              </Pressable>
            </View>

            <FadeView delay={60}>
              <SilkMartLogo />
            </FadeView>

            <FadeView delay={150} style={styles.loginImageBox}>
              <Image
                source={{ uri: SILKWORM_IMAGE }}
                style={styles.loginImage}
                resizeMode="cover"
              />
            </FadeView>

            <FadeText
              style={[styles.eyebrow, styles.loginEyebrow]}
              delay={240}
            >
              ACCOUNT
            </FadeText>

            <FadeText style={styles.heading} delay={340}>
              Welcome!
            </FadeText>

            <FadeText style={styles.subheading} delay={430}>
              Sign in to continue to your account.
            </FadeText>

            <FadeView delay={530}>
              <FormInput
                label="Email address"
                placeholder="you@example.com"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                iconName="mail-outline"
              />
            </FadeView>

            <FadeView delay={610}>
              <FormInput
                label="Password"
                placeholder="Enter your password"
                value={password}
                onChangeText={setPassword}
                secure
                autoCapitalize="none"
                iconName="lock-closed-outline"
              />
            </FadeView>

            <FadeView delay={660} style={styles.forgotPasswordRow}>
              <Pressable accessibilityRole="button" onPress={openPasswordReset}>
                <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
              </Pressable>
            </FadeView>

            <FadeView delay={710}>
              <MainButton label="Sign in" onPress={signIn} />
            </FadeView>

            <FadeView delay={790} style={styles.orContainer}>
              <View style={styles.orLine} />
              <FadeText style={styles.orText} delay={830}>
                or
              </FadeText>
              <View style={styles.orLine} />
            </FadeView>

            <FadeView delay={890} style={styles.secondaryButtons}>
              <OutlineButton
                label="Create an account"
                iconName="person-add-outline"
                onPress={() => router.push("/register")}
              />

              <OutlineButton
                label="Continue as customer"
                iconName="bag-handle-outline"
                soft
                onPress={() => router.push("/customer")}
              />
            </FadeView>
          </View>
      </ScrollView>
      <Modal
        visible={resetVisible}
        transparent
        animationType="fade"
        onRequestClose={closePasswordReset}
      >
        <KeyboardAvoidingView
          style={styles.noticeBackdrop}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.noticeCard}>
            <View style={[styles.noticeIconCircle, styles.noticeSuccessCircle]}>
              <Ionicons
                name={resetSent ? "mail-open-outline" : "lock-open-outline"}
                size={42}
                color={GREEN}
              />
            </View>
            <Text style={styles.noticeTitle}>
              {resetSent ? "Check Your Email" : "Reset Your Password"}
            </Text>
            <Text style={styles.noticeMessage}>
              {resetSent
                ? "If this email is registered, a password-reset link will arrive shortly. Check your inbox and spam folder."
                : "Enter your email address and we'll send you a secure password-reset link."}
            </Text>
            {!resetSent && (
              <View style={styles.resetForm}>
                <Text style={styles.fieldLabel}>Email address</Text>
                <View style={styles.inputBox}>
                  <Ionicons name="mail-outline" size={19} color="#7B9684" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="you@example.com"
                    placeholderTextColor="#9BAEA2"
                    value={resetEmail}
                    onChangeText={(value) => {
                      setResetEmail(value);
                      if (resetError) setResetError("");
                    }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    textContentType="emailAddress"
                    editable={!resetSending}
                  />
                </View>
                {resetError ? (
                  <Text style={styles.resetError} accessibilityRole="alert">{resetError}</Text>
                ) : null}
              </View>
            )}
            <Pressable
              accessibilityRole="button"
              disabled={resetSending}
              style={({ pressed }) => [
                styles.noticeButton,
                styles.noticeSuccessButton,
                resetSending && { opacity: 0.6 },
                pressed && { opacity: 0.84 },
              ]}
              onPress={resetSent ? closePasswordReset : sendResetLink}
            >
              <Text style={styles.noticeButtonText}>
                {resetSent ? "Back to Login" : resetSending ? "Sending..." : "Send Reset Link"}
              </Text>
            </Pressable>
            {!resetSent && (
              <Pressable
                accessibilityRole="button"
                disabled={resetSending}
                style={styles.resetCancelButton}
                onPress={closePasswordReset}
              >
                <Text style={styles.resetCancelText}>Cancel</Text>
              </Pressable>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal
        visible={loginNotice !== null && !noticeClosing}
        transparent
        animationType="fade"
        onRequestClose={closeLoginNotice}
      >
        <View style={styles.noticeBackdrop}>
          <View style={styles.noticeCard}>
            <View
              style={[
                styles.noticeIconCircle,
                loginNotice?.kind === "success"
                  ? styles.noticeSuccessCircle
                  : loginNotice?.kind === "warning"
                    ? styles.noticeWarningCircle
                    : styles.noticeErrorCircle,
              ]}
            >
              <Ionicons
                name={
                  loginNotice?.kind === "success"
                    ? "checkmark-circle-outline"
                    : loginNotice?.kind === "warning"
                      ? "alert-circle-outline"
                      : "close-circle-outline"
                }
                size={48}
                color={
                  loginNotice?.kind === "success"
                    ? GREEN
                    : loginNotice?.kind === "warning"
                      ? "#A57226"
                      : "#B34343"
                }
              />
            </View>
            <Text style={styles.noticeTitle}>{loginNotice?.title}</Text>
            <Text style={styles.noticeMessage}>{loginNotice?.message}</Text>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.noticeButton,
                loginNotice?.kind === "success"
                  ? styles.noticeSuccessButton
                  : loginNotice?.kind === "warning"
                    ? styles.noticeWarningButton
                    : styles.noticeErrorButton,
                pressed && { opacity: 0.84 },
              ]}
              onPress={closeLoginNotice}
            >
              <Text style={styles.noticeButtonText}>
                {loginNotice?.kind === "success" ? (successDestination === "admin" ? "Continue to Dashboard" : "Continue to Shop") : "OK"}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  forgotPasswordRow: {
    alignItems: "flex-end",
    marginTop: -7,
    marginBottom: 18,
  },
  forgotPasswordText: {
    fontSize: 13,
    fontWeight: "700",
    color: GREEN,
  },
  resetForm: {
    width: "100%",
    marginBottom: 20,
  },
  resetError: {
    color: "#B34343",
    fontSize: 12,
    marginTop: 9,
  },
  resetCancelButton: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginTop: 8,
  },
  resetCancelText: {
    color: MUTED,
    fontWeight: "600",
    fontSize: 13,
  },
  noticeBackdrop: {
    flex: 1,
    backgroundColor: "rgba(10, 25, 17, 0.54)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  noticeCard: {
    width: "100%",
    maxWidth: 390,
    borderRadius: 22,
    backgroundColor: "#FFFDF8",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 30,
    paddingBottom: 24,
  },
  noticeIconCircle: {
    width: 86,
    height: 86,
    borderRadius: 43,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  noticeSuccessCircle: { backgroundColor: "#E7F2E7" },
  noticeWarningCircle: { backgroundColor: "#FCF0D9" },
  noticeErrorCircle: { backgroundColor: "#FBEAEA" },
  noticeTitle: {
    fontFamily: "serif",
    fontSize: 27,
    color: DARK,
    textAlign: "center",
  },
  noticeMessage: {
    marginTop: 12,
    marginBottom: 24,
    fontSize: 13,
    lineHeight: 21,
    color: MUTED,
    textAlign: "center",
  },
  noticeButton: {
    width: "100%",
    minHeight: 49,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
  },
  noticeSuccessButton: { backgroundColor: GREEN },
  noticeWarningButton: { backgroundColor: "#A57226" },
  noticeErrorButton: { backgroundColor: "#B34343" },
  noticeButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#FFFFFF",
  },
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
  eyebrow: {
    color: GREEN,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2.3,
    marginBottom: 12,
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
  topActions: {
    height: 30,
    marginBottom: 18,
    justifyContent: "center",
  },
  backText: {
    color: GREEN,
    fontWeight: "600",
    fontSize: 13,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
  },
  loginImageBox: {
    height: 122,
    borderRadius: 19,
    overflow: "hidden",
    backgroundColor: "#E9EFDE",
    marginTop: 23,
    marginBottom: 26,
  },
  loginImage: {
    width: "100%",
    height: "100%",
  },
  loginEyebrow: {
    marginBottom: 7,
  },
  heading: {
    fontFamily: "serif",
    fontSize: 39,
    color: DARK,
    lineHeight: 46,
  },
  subheading: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 21,
    marginTop: 5,
    marginBottom: 24,
  },
  field: {
    marginBottom: 17,
  },
  fieldLabel: {
    color: DARK,
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 8,
  },
  inputBox: {
    height: 52,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 11,
    backgroundColor: "#FFFDF8",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
  },
  inputIcon: {
    marginRight: 11,
  },
  input: {
    flex: 1,
    fontSize: 14,
    color: DARK,
    height: "100%",
  },
  showButton: {
    paddingVertical: 10,
    paddingLeft: 10,
  },
  orContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    marginVertical: 20,
  },
  orLine: {
    height: 1,
    flex: 1,
    backgroundColor: "#D9E2D6",
  },
  orText: {
    fontSize: 12,
    color: MUTED,
  },
  secondaryButtons: {
    gap: 11,
  },
  outlineButton: {
    height: 51,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "#A6BDAE",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 12,
  },
  softButton: {
    backgroundColor: "#EAF2E8",
  },
  outlineButtonText: {
    color: DARK,
    fontSize: 13,
    fontWeight: "700",
  },
});
