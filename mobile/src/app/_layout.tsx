import '../../global.css';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { UIProvider, Loading } from '@/components';
import { authClient } from '@/lib/auth-client';

export default function RootLayout() {
  const { data: session, isPending } = authClient.useSession();
  return <SafeAreaProvider><UIProvider><StatusBar style="dark" />
    {isPending ? <Loading /> : <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="sign-in" /><Stack.Screen name="register" />
      </Stack.Protected>
      <Stack.Protected guard={!!session}><Stack.Screen name="index" /><Stack.Screen name="jobs" /></Stack.Protected>
    </Stack>}
  </UIProvider></SafeAreaProvider>;
}
