import { Platform } from "react-native";
import { authClient } from "./auth-client";

export const apiBase = (
  process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000"
).replace(/\/$/, "");

export async function apiRequest<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const cookie =
    Platform.OS === "web" ? undefined : await authClient.getCookie();
  const response = await fetch(`${apiBase}/api${path}`, {
    method,
    credentials: Platform.OS === "web" ? "include" : "omit",
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(
      data?.message || "Could not reach the server. Please try again.",
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
