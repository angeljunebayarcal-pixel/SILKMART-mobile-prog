import React, { useEffect, useRef, useState } from "react";

import { Animated, Easing, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from "react-native";

import Svg, { Circle, Path } from "react-native-svg";

import { Ionicons } from "@expo/vector-icons";

import { useRouter } from "expo-router";

import { createUserWithEmailAndPassword, signOut, updateProfile } from "firebase/auth";

import { doc, serverTimestamp, setDoc, writeBatch } from "firebase/firestore";

import { auth, db } from "../firebase/config";

import * as ImagePicker from "expo-image-picker";

import * as ImageManipulator from "expo-image-manipulator";



type AccountType = "customer" | "staff";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

type RegistrationNotice = {

  kind: "success" | "error" | "warning";

  title: string;

  message: string;

} | null;



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





function FormInput({

  label,

  placeholder,

  value,

  onChangeText,

  secure = false,

  keyboardType = "default",

  autoCapitalize = "sentences",

  iconName,

  invalid = false,

}: {

  label: string;

  placeholder: string;

  value: string;

  onChangeText: (value: string) => void;

  secure?: boolean;

  keyboardType?: "default" | "email-address" | "phone-pad";

  autoCapitalize?: "none" | "sentences" | "words";

  iconName?: IconName;

  invalid?: boolean;

}) {

  const [visible, setVisible] = useState(false);



  return (

    <View style={styles.field}>

      <Text style={styles.fieldLabel}>{label}</Text>



      <View style={[styles.inputBox, invalid && styles.invalidInputBox]}>

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





export default function RegisterScreen() {

  const router = useRouter();

  const [accountType, setAccountType] = useState<AccountType>("customer");

  const [fullName, setFullName] = useState("");

  const [registerEmail, setRegisterEmail] = useState("");

  const [mobileNumber, setMobileNumber] = useState("");

  const [address, setAddress] = useState("");

  const [registerPassword, setRegisterPassword] = useState("");

  const [confirmPassword, setConfirmPassword] = useState("");

  const [registrationNotice, setRegistrationNotice] = useState<RegistrationNotice>(null);

  const [registering, setRegistering] = useState(false);

  const [successDestination, setSuccessDestination] = useState<"customer" | "login">("customer");

  const [invalidFields, setInvalidFields] = useState<string[]>([]);

  const noticeClosingRef = useRef(false);
  const [noticeClosing, setNoticeClosing] = useState(false);



  function showWarning(title: string, message: string) {

    setRegistrationNotice({ kind: "warning", title, message });

  }



  function closeRegistrationNotice() {
    if (!registrationNotice || noticeClosingRef.current) return;

    const isSuccess = registrationNotice.kind === "success";
    const destination = successDestination === "login" ? "/login" : "/customer";

    noticeClosingRef.current = true;
    // Hide the modal while retaining its success/warning/error content
    // throughout the fade animation, so an empty error card never flashes.
    setNoticeClosing(true);

    setTimeout(() => {
      setRegistrationNotice(null);
      noticeClosingRef.current = false;
      setNoticeClosing(false);
      if (isSuccess) {
        router.replace(destination);
      }
    }, 350);
  }

  const [staffIdUri, setStaffIdUri] = useState("");

  const [staffIdBase64, setStaffIdBase64] = useState("");

  const [staffIdName, setStaffIdName] = useState("");

  const [staffIdSize, setStaffIdSize] = useState(0);

  const [staffIdError, setStaffIdError] = useState("");

  const [staffIdLoading, setStaffIdLoading] = useState(false);

  function clearStaffId() {

    setStaffIdUri("");

    setStaffIdBase64("");

    setStaffIdName("");

    setStaffIdSize(0);

    setStaffIdError("");

  }



  // Select a JPG/JPEG image and compress to Base64.

  async function chooseStaffId() {

    if (staffIdLoading) return;



    try {

      const selected = await ImagePicker.launchImageLibraryAsync({

        mediaTypes: ["images"],

        allowsEditing: false,

        allowsMultipleSelection: false,

        quality: 1,

      });



      if (selected.canceled || !selected.assets?.length) {

        return;

      }



      const asset = selected.assets[0];

      clearStaffId();



      const name = asset.fileName ?? "verification.jpg";

      const lowerName = name.toLowerCase();

      const mime = asset.mimeType?.toLowerCase();



      if (

        (mime && mime !== "image/jpeg") ||

        (asset.fileName &&

          !lowerName.endsWith(".jpg") &&

          !lowerName.endsWith(".jpeg"))

      ) {

        setStaffIdError("Please choose a JPG or JPEG image.");

        return;

      }



      if (

        asset.fileSize !== undefined &&

        (asset.fileSize <= 0 || asset.fileSize > 15 * 1024 * 1024)

      ) {

        setStaffIdError(

          "Choose a JPG/JPEG image smaller than 15 MB."

        );

        return;

      }



      if (

        !asset.width ||

        !asset.height ||

        asset.width * asset.height > 50000000

      ) {

        setStaffIdError("Please select a valid image.");

        return;

      }



      setStaffIdLoading(true);



      const longSide = Math.max(asset.width, asset.height);

      const maxDimensions = [1600, 1400, 1200, 1000, 800, 640];

      const qualities = [0.85, 0.75, 0.65, 0.5, 0.4];



      for (const dimension of maxDimensions) {

        const ratio = Math.min(1, dimension / longSide);

        const width = Math.max(

          1,

          Math.round(asset.width * ratio)

        );



        for (const quality of qualities) {

          const result = await ImageManipulator.manipulateAsync(

            asset.uri,

            [{ resize: { width } }],

            {

              compress: quality,

              format: ImageManipulator.SaveFormat.JPEG,

              base64: true,

            }

          );



          if (!result.base64) continue;



          const size = Math.floor(

            (result.base64.length * 3) / 4

          );



          if (

            size > 0 &&

            size <= 350 * 1024 &&

            result.base64.length < 500000

          ) {

            setStaffIdUri(result.uri);

            setStaffIdBase64(

              `data:image/jpeg;base64,${result.base64}`

            );

            setStaffIdName(name);

            setStaffIdSize(size);

            setStaffIdError("");

            return;

          }

        }

      }



      setStaffIdError(

        "The image could not be compressed below 350 KB. Try another JPG."

      );

    } catch (error) {

      setStaffIdError(

        "Unable to process this image. Try another JPG file."

      );

    } finally {

      setStaffIdLoading(false);

    }

  }



  async function register() {

    if (registering) return;



    if (staffIdLoading) {

      showWarning(

        "Verification Processing",

        "Please allow the verification image to finish processing before submitting."

      );

      return;

    }



    const missing: string[] = [];

    if (!fullName.trim()) missing.push("Full Name");

    if (!registerEmail.trim()) missing.push("Email Address");

    if (!mobileNumber.trim()) missing.push("Mobile Number");

    if (!address.trim()) missing.push("Complete Address");

    if (!registerPassword) missing.push("Password");

    if (!confirmPassword) missing.push("Confirm Password");

    if (accountType === "staff" && !staffIdBase64) {

      missing.push("Verification ID");

    }



    if (missing.length > 0) {

      setInvalidFields(missing);

      showWarning(

        "Required Information Missing",

        `Please complete the following before submitting: ${missing.join(", ")}.`

      );

      return;

    }



    setInvalidFields([]);



    const emailValue = registerEmail.trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {

      setInvalidFields(["Email Address"]);

      showWarning("Invalid Email Address", "Please enter a valid email address.");

      return;

    }



    if (mobileNumber.trim().length > 30) {

      setInvalidFields(["Mobile Number"]);

      showWarning("Invalid Mobile Number", "Please enter a mobile number with 30 characters or fewer.");

      return;

    }



    if (fullName.trim().length > 150 || address.trim().length > 500) {

      showWarning("Information Too Long", "Your name must be at most 150 characters and your address at most 500 characters.");

      return;

    }



    if (registerPassword.length < 6) {

      setInvalidFields(["Password"]);

      showWarning("Password Too Short", "Please use at least 6 characters for your password.");

      return;

    }



    if (registerPassword !== confirmPassword) {

      setInvalidFields(["Password", "Confirm Password"]);

      showWarning("Password Mismatch", "Your passwords do not match.");

      return;

    }



    let createdAccount = false;

    setRegistering(true);



    try {

      const credentials = await createUserWithEmailAndPassword(

        auth,

        registerEmail.trim().toLowerCase(),

        registerPassword

      );

      createdAccount = true;



      if (accountType === "staff") {

        // Atomic Firestore write: an applicant cannot assign a staff/admin role.

        // Security Rules must restrict both creation and reading of ID documents.

        const uid = credentials.user.uid;

        const batch = writeBatch(db);

        batch.set(doc(db, "users", uid), {

          uid,

          fullName: fullName.trim(),

          email: credentials.user.email ?? registerEmail.trim(),

          phoneNumber: mobileNumber.trim(),

          address: address.trim(),

          role: "staffApplicant",

          applicationStatus: "pending",

          createdAt: serverTimestamp(),

        });

        batch.set(doc(db, "staffApplications", uid), {

          applicantUid: uid,

          fullName: fullName.trim(),

          email: credentials.user.email ?? registerEmail.trim(),

          phoneNumber: mobileNumber.trim(),

          address: address.trim(),

          status: "pending",

          verificationIdName: staffIdName,

          verificationIdSize: staffIdSize,

          createdAt: serverTimestamp(),

        });

        // Firestore document < 1 MiB; ID is separate from searchable application metadata.

        // Sensitive ID must be administrator-readable ONLY in Firestore Rules.

        batch.set(doc(db, "staffVerificationIds", uid), {

          applicantUid: uid,

          imageData: staffIdBase64,

          mimeType: "image/jpeg",

          createdAt: serverTimestamp(),

        });

        await batch.commit();

      } else {

        await setDoc(doc(db, "users", credentials.user.uid), {

          uid: credentials.user.uid,

          fullName: fullName.trim(),

          email: credentials.user.email ?? registerEmail.trim(),

          phoneNumber: mobileNumber.trim(),

          address: address.trim(),

          role: "customer",

          createdAt: serverTimestamp(),

        });

      }



      // Firebase display name is supplementary to the Firestore customer record.

      try {

        await updateProfile(credentials.user, {

          displayName: fullName.trim(),

        });

      } catch {

        // The account and customer document are already saved.

      }



      if (accountType === "staff") {

        // Do not leave a pending applicant signed in as an approved staff member.

        try {

          await signOut(auth);

        } catch {

          // Registration has been saved; login will still reject pending applicants.

          // Do not misreport a successful application as an incomplete registration.

        }

        setSuccessDestination("login");

        setRegistrationNotice({

          kind: "success",

          title: "Application Submitted",

          message: "Your staff application is pending review by an administrator or approved staff member. You can sign in after approval.",

        });

      } else {

        setSuccessDestination("customer");

        setRegistrationNotice({

          kind: "success",

          title: "Account Created!",

          message: "Your SilkMart customer account is ready.",

        });

      }

    } catch (error: unknown) {

      const code =

        typeof error === "object" && error !== null && "code" in error

          ? String(error.code)

          : "";



      // If Authentication succeeded but a Firestore write failed,

      // do not leave an incomplete staff applicant signed in.

      if (createdAccount && accountType === "staff") {

        try {

          await signOut(auth);

        } catch {

          // Keep the incomplete-setup warning visible.

        }

      }



      setRegistrationNotice({

        kind: createdAccount ? "warning" : "error",

        title: createdAccount ? "Account Created, Setup Incomplete" : "Registration Failed",

        message: createdAccount

          ? "Your Firebase account exists, but the Firestore record was not fully saved. Do not register again with the same email. Check Firestore rules and contact the administrator."

          : code === "auth/email-already-in-use"

            ? "This email already has an account. Please sign in instead."

            : code === "auth/invalid-email"

              ? "Please enter a valid email address."

              : code === "auth/weak-password"

                ? "Please choose a stronger password."

                : code === "auth/network-request-failed"

                  ? "Please check your internet connection and try again."

                  : code === "permission-denied"

                    ? "Firestore permissions denied the profile. Please check your database rules."

                    : "Unable to create an account right now. Please try again.",

      });

    } finally {

      setRegistering(false);

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

          <View key="register" style={styles.page}>

            <View style={styles.topActions}>

              <Pressable

                onPress={() => router.push("/login")}

                accessibilityRole="button"

                style={styles.backButton}

              >

                <Ionicons

                  name="arrow-back"

                  size={19}

                  color={GREEN}

                />

                <Text style={styles.backText}>Back to login</Text>

              </Pressable>

            </View>



            <FadeView delay={60}>

              <SilkMartLogo small />

            </FadeView>



            <FadeText

              style={[styles.eyebrow, styles.registerEyebrow]}

              delay={170}

            >

              CREATE ACCOUNT

            </FadeText>



            <FadeText style={styles.heading} delay={260}>

              Join SilkMart.

            </FadeText>



            <FadeText style={styles.subheading} delay={350}>

              {accountType === "customer"

                ? "Create your customer account to start ordering silk products."

                : "Staff access requires identity verification and administrator approval."}

            </FadeText>



            <FadeView delay={440}>

              <Text style={styles.fieldLabel}>Account Type</Text>



              <View style={styles.accountOptions}>

                <Pressable

                  onPress={() => setAccountType("customer")}

                  style={[

                    styles.accountOption,

                    accountType === "customer" &&

                      styles.selectedOption,

                  ]}

                >

                  <Ionicons

                    name={

                      accountType === "customer"

                        ? "radio-button-on"

                        : "radio-button-off"

                    }

                    size={17}

                    color={GREEN}

                  />

                  <Text style={styles.accountOptionText}>

                    Customer

                  </Text>

                </Pressable>



                <Pressable

                  onPress={() => setAccountType("staff")}

                  style={[

                    styles.accountOption,

                    accountType === "staff" &&

                      styles.selectedOption,

                  ]}

                >

                  <Ionicons

                    name={

                      accountType === "staff"

                        ? "radio-button-on"

                        : "radio-button-off"

                    }

                    size={17}

                    color={GREEN}

                  />

                  <Text style={styles.accountOptionText}>

                    Admin / Staff

                  </Text>

                </Pressable>

              </View>

            </FadeView>



            <FadeView delay={500}>

              <FormInput

                label="Full Name"

                invalid={invalidFields.includes("Full Name")}

                placeholder="Enter your full name"

                value={fullName}

                onChangeText={setFullName}

                autoCapitalize="words"

                iconName="person-outline"

              />

            </FadeView>



            <FadeView delay={540}>

              <FormInput

                label="Email Address"

                invalid={invalidFields.includes("Email Address")}

                placeholder="you\@example.com"

                value={registerEmail}

                onChangeText={setRegisterEmail}

                keyboardType="email-address"

                autoCapitalize="none"

                iconName="mail-outline"

              />

            </FadeView>



            <FadeView delay={580}>

              <FormInput

                label="Mobile Number"

                invalid={invalidFields.includes("Mobile Number")}

                placeholder="09XXXXXXXXX"

                value={mobileNumber}

                onChangeText={setMobileNumber}

                keyboardType="phone-pad"

                autoCapitalize="none"

                iconName="call-outline"

              />

            </FadeView>



            <FadeView delay={620}>

              <FormInput

                label="Complete Address"

                invalid={invalidFields.includes("Complete Address")}

                placeholder="Enter your complete address"

                value={address}

                onChangeText={setAddress}

                iconName="location-outline"

              />

            </FadeView>



            <FadeView delay={660}>

              <FormInput

                label="Password"

                invalid={invalidFields.includes("Password")}

                placeholder="Minimum 6 characters"

                value={registerPassword}

                onChangeText={setRegisterPassword}

                secure

                autoCapitalize="none"

                iconName="lock-closed-outline"

              />

            </FadeView>



            <FadeView delay={700}>

              <FormInput

                label="Confirm Password"

                invalid={invalidFields.includes("Confirm Password")}

                placeholder="Confirm your password"

                value={confirmPassword}

                onChangeText={setConfirmPassword}

                secure

                autoCapitalize="none"

                iconName="shield-checkmark-outline"

              />

            </FadeView>



            {accountType === "staff" && (

              <FadeView delay={740} style={[styles.staffNotice, invalidFields.includes("Verification ID") && styles.invalidInputBox]}>

                <Text style={styles.staffNoticeTitle}>

                  Staff verification required

                </Text>



                <Text style={styles.staffNoticeText}>

                  Upload a JPG/JPEG verification ID. The image is

                  compressed automatically for staff review.

                  Administrator accounts cannot be self-registered.

                </Text>



                <Pressable

                  onPress={chooseStaffId}

                  disabled={staffIdLoading}

                  accessibilityRole="button"

                  style={styles.staffUploadButton}

                >

                  <Ionicons

                    name="cloud-upload-outline"

                    size={20}

                    color={GREEN}

                  />

                  <Text style={styles.staffUploadText}>

                    {staffIdLoading

                      ? "Compressing image..."

                      : staffIdUri

                        ? "Change verification ID"

                        : "Choose verification ID"}

                  </Text>

                </Pressable>



                {staffIdUri ? (

                  <View style={styles.staffPreviewContainer}>

                    <View style={styles.staffAttachmentRow}>

                      <View style={styles.staffAttachmentIcon}>

                        <Ionicons

                          name="document-attach-outline"

                          size={24}

                          color={GREEN}

                        />

                      </View>



                      <View style={styles.staffAttachmentInfo}>

                        <Text

                          style={styles.staffAttachmentName}

                          numberOfLines={1}

                          ellipsizeMode="middle"

                        >

                          {staffIdName}

                        </Text>



                        <Text style={styles.staffFileText}>

                          JPG · {(staffIdSize / 1024).toFixed(1)} KB · Ready

                        </Text>

                      </View>



                      <Ionicons

                        name="checkmark-circle"

                        size={22}

                        color={GREEN}

                      />

                    </View>



                    <View style={styles.staffAttachmentDivider} />



                    <View style={styles.staffAttachmentFooter}>

                      <Text style={styles.staffAttachmentHint}>

                        Image prepared as Base64

                      </Text>



                      <Pressable

                        onPress={clearStaffId}

                        accessibilityRole="button"

                        style={styles.staffRemoveButton}

                      >

                        <Ionicons

                          name="trash-outline"

                          size={17}

                          color="#A43F3F"

                        />

                        <Text style={styles.staffRemoveText}>

                          Remove

                        </Text>

                      </Pressable>

                    </View>

                  </View>

                ) : null}



                {staffIdError ? (

                  <Text style={styles.staffErrorText}>

                    {staffIdError}

                  </Text>

                ) : null}

              </FadeView>

            )}



            <FadeView delay={790} style={styles.lastButtonArea}>

              <MainButton

                label={

                  accountType === "staff"

                    ? "Submit staff application"

                    : "Create account"

                }

                onPress={register}

              />

            </FadeView>

          </View>

      </ScrollView>

      <Modal

        visible={registrationNotice !== null && !noticeClosing}

        transparent

        animationType="fade"

        onRequestClose={closeRegistrationNotice}

      >

        <View style={styles.noticeBackdrop}>

          <View style={styles.noticeCard}>

            <View

              style={[

                styles.noticeIconCircle,

                registrationNotice?.kind === "success"

                  ? styles.noticeSuccessCircle

                  : registrationNotice?.kind === "warning"

                    ? styles.noticeWarningCircle

                    : styles.noticeErrorCircle,

              ]}

            >

              <Ionicons

                name={

                  registrationNotice?.kind === "success"

                    ? "checkmark-circle-outline"

                    : registrationNotice?.kind === "warning"

                      ? "alert-circle-outline"

                      : "close-circle-outline"

                }

                size={48}

                color={

                  registrationNotice?.kind === "success"

                    ? GREEN

                    : registrationNotice?.kind === "warning"

                      ? "#A57226"

                      : "#B34343"

                }

              />

            </View>

            <Text style={styles.noticeTitle}>{registrationNotice?.title}</Text>

            <Text style={styles.noticeMessage}>{registrationNotice?.message}</Text>

            <Pressable

              accessibilityRole="button"

              style={({ pressed }) => [

                styles.noticeButton,

                registrationNotice?.kind === "success"

                  ? styles.noticeSuccessButton

                  : registrationNotice?.kind === "warning"

                    ? styles.noticeWarningButton

                    : styles.noticeErrorButton,

                pressed && { opacity: 0.84 },

              ]}

              onPress={closeRegistrationNotice}

            >

              <Text style={styles.noticeButtonText}>

                {registrationNotice?.kind === "success" ? (successDestination === "login" ? "Back to Login" : "Continue to Shop") : "OK"}

              </Text>

            </Pressable>

          </View>

        </View>

      </Modal>

    </KeyboardAvoidingView>

  );

}



const styles = StyleSheet.create({

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

  lastButtonArea: {

    marginTop: 24,

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

  registerEyebrow: {

    marginTop: 27,

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

  invalidInputBox: {

    borderColor: "#B34343",

    borderWidth: 1.5,

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

  accountOptions: {

    flexDirection: "row",

    gap: 9,

    marginBottom: 23,

  },

  accountOption: {

    flex: 1,

    minHeight: 49,

    borderRadius: 10,

    borderWidth: 1,

    borderColor: BORDER,

    alignItems: "center",

    justifyContent: "center",

    flexDirection: "row",

    gap: 6,

    paddingHorizontal: 5,

    backgroundColor: "#FFFDF8",

  },

  selectedOption: {

    borderColor: GREEN,

    backgroundColor: "#E8F0E7",

  },

  accountOptionText: {

    color: DARK,

    fontSize: 12,

    fontWeight: "600",

  },

  staffNotice: {

    borderWidth: 1,

    borderColor: "#C4D9C8",

    borderRadius: 11,

    backgroundColor: "#EAF2E8",

    padding: 13,

    marginTop: 4,

  },

  staffNoticeTitle: {

    color: GREEN,

    fontWeight: "700",

    fontSize: 13,

    marginBottom: 5,

  },

  staffNoticeText: {

    color: MUTED,

    fontSize: 12,

    lineHeight: 19,

  },

  staffUploadButton: {

    marginTop: 13,

    borderWidth: 1,

    borderColor: "#A6BDAE",

    borderRadius: 10,

    backgroundColor: "#FFFDF8",

    minHeight: 48,

    flexDirection: "row",

    alignItems: "center",

    justifyContent: "center",

    gap: 9,

  },

  staffUploadText: {

    color: GREEN,

    fontSize: 13,

    fontWeight: "700",

  },

  staffPreviewContainer: {

    marginTop: 13,

    padding: 10,

    borderRadius: 10,

    backgroundColor: "#FFFDF8",

    borderWidth: 1,

    borderColor: "#C4D9C8",

  },

  staffFileText: {

    color: MUTED,

    fontSize: 12,

    marginTop: 5,

  },

  staffRemoveButton: {

    flexDirection: "row",

    alignItems: "center",

    gap: 6,

    marginTop: 10,

  },

  staffRemoveText: {

    color: "#A43F3F",

    fontWeight: "600",

    fontSize: 12,

  },

  staffErrorText: {

    marginTop: 10,

    color: "#A43F3F",

    fontSize: 12,

    lineHeight: 18,

  },

  staffAttachmentRow: {

    flexDirection: "row",

    alignItems: "center",

    gap: 10,

  },

  staffAttachmentIcon: {

    width: 43,

    height: 43,

    borderRadius: 9,

    backgroundColor: "#E8F0E7",

    alignItems: "center",

    justifyContent: "center",

  },

  staffAttachmentInfo: {

    flex: 1,

    minWidth: 0,

  },

  staffAttachmentName: {

    color: DARK,

    fontSize: 12,

    fontWeight: "700",

  },

  staffAttachmentDivider: {

    height: 1,

    backgroundColor: "#D9E2D6",

    marginTop: 12,

    marginBottom: 10,

  },

  staffAttachmentFooter: {

    flexDirection: "row",

    alignItems: "center",

    justifyContent: "space-between",

    flexWrap: "wrap",

    gap: 8,

  },

  staffAttachmentHint: {

    color: MUTED,

    fontSize: 10,

  },

});