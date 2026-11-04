
import { Platform } from "react-native";
import { getApp, getApps, initializeApp } from "firebase/app";
import {
  getAuth,
  initializeAuth,
  // @ts-ignore React Native export is missing from browser TypeScript declarations.
  getReactNativePersistence,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import AsyncStorage from "@react-native-async-storage/async-storage";

const firebaseConfig = {
  apiKey: "AIzaSyCRlBuFOwgj7mueuZAs_OgRJg1As_b-9_A",
  authDomain: "silkmart-e0f0f.firebaseapp.com",
  projectId: "silkmart-e0f0f",
  storageBucket: "silkmart-e0f0f.firebasestorage.app",
  messagingSenderId: "988440499917",
  appId: "1:988440499917:web:1f7db4f0ae11d011187b84",
  measurementId: "G-QLPBKQTTJN",
};

export const app = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig);

function setupAuth() {
  if (Platform.OS === "web") {
    return getAuth(app);
  }

  try {
    return initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "auth/already-initialized"
    ) {
      return getAuth(app);
    }

    throw error;
  }
}

export const auth = setupAuth();

export const db = getFirestore(app);
