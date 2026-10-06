import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import * as SecureStore from "expo-secure-store";

export const authClient = createAuthClient({
  baseURL: process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000",
  plugins: [
    expoClient({
      scheme: "formcast",
      storagePrefix: "formcast",
      storage: SecureStore,
    }),
  ],
  // Cover database connection/transaction budgets plus HTTP overhead on mobile.
  fetchOptions: { timeout: 45000 },
});
