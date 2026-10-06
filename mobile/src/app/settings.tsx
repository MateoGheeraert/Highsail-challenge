import { goBack } from "@/lib/navigation";
import { useState } from "react";
import { View } from "react-native";
import { Button, IconButton, Notice, Screen, Text } from "@/components";
import { authClient } from "@/lib/auth-client";
import { colors } from "@/theme/tokens";

export default function Settings() {
  const { data: session } = authClient.useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signOut() {
    setBusy(true);
    setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) setError("Could not log out. Please try again.");
    } catch {
      setError("Could not reach Formcast. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen>
      <View style={{ gap: 24 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
          <IconButton
            icon="arrow-left"
            label="Back to jobs"
            disabled={busy}
            onPress={() => goBack()}
          />
          <Text variant="title">Settings</Text>
        </View>
        <View
          className="gap-2 py-5"
          style={{ borderBottomWidth: 1, borderColor: colors.border }}
        >
          <Text variant="label" muted>
            ACCOUNT
          </Text>
          <Text variant="heading">{session?.user.name}</Text>
          <Text muted>{session?.user.email}</Text>
        </View>
        {error ? <Notice>{error}</Notice> : null}
        <Button
          icon="logout"
          variant="secondary"
          loading={busy}
          onPress={signOut}
        >
          Log out
        </Button>
      </View>
    </Screen>
  );
}
