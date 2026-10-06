import { useState } from 'react';
import { View } from 'react-native';
import { BrandMark, Button, Notice, Screen, Text } from '@/components';
import { authClient } from '@/lib/auth-client';

export default function Welcome() {
  const { data: session } = authClient.useSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  async function signOut() {
    setLoading(true);
    setError('');
    try {
      const result = await authClient.signOut();
      if (result.error) setError('Could not sign out. Please try again.');
    } catch { setError('Could not reach Formcast. Please try again.'); }
    finally { setLoading(false); }
  }
  return <Screen><View className="flex-1 justify-center gap-6">
    <BrandMark />
    <Text variant="title">Welcome, {session?.user.name}.</Text>
    <Text muted>You’re signed in to Formcast. Your account is ready; the job workspace is coming next.</Text>
    {error ? <Notice>{error}</Notice> : null}
    <Button variant="secondary" onPress={signOut} loading={loading}>Sign out</Button>
  </View></Screen>;
}
