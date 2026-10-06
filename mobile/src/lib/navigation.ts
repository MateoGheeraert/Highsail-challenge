import { router, type Href } from "expo-router";

// Pop the current screen so swipe-back cannot reveal a duplicated destination.
// A directly opened link has no history, so it needs a fallback destination.
export function goBack(fallback: Href = "/") {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
