import { useRef, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { BrandMark, Button, Notice, Screen, Text, TextField } from '@/components';
import { authClient } from '@/lib/auth-client';
import { colors } from '@/theme/tokens';
import { validateAuth, type AuthErrors, type AuthValues } from './validation';

export function AuthScreen({ mode }: { mode: 'sign-in' | 'register' }) {
  const register = mode === 'register';
  const [values, setValues] = useState<AuthValues>({ name: '', email: '', password: '', confirmPassword: '' });
  const [errors, setErrors] = useState<AuthErrors>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false);
  const change = (key: keyof AuthValues) => (value: string) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => ({ ...previous, [key]: undefined }));
    setError('');
  };

  async function submit() {
    if (submitting.current) return;
    const nextErrors = validateAuth(values, register);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    submitting.current = true;
    setLoading(true);
    setError('');
    try {
      const credentials = { email: values.email.trim(), password: values.password };
      const result = register
        ? await authClient.signUp.email({ ...credentials, name: values.name.trim() })
        : await authClient.signIn.email(credentials);
      if (result.error) {
        setError(result.error.status === 429 ? 'Too many attempts. Wait a moment and try again.'
          : register ? (result.error.message || 'We could not create your account. Please try again.')
          : 'Unable to sign in. Check your email and password and try again.');
      }
      // The root route guard switches screens when Better Auth publishes the session.
    } catch {
      setError('Could not reach Formcast. Check your connection and try again.');
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  return <Screen>
    <View className="flex-row items-center gap-3"><BrandMark /><Text variant="heading" style={{ fontWeight: '700' }}>formcast</Text></View>
    <View className="mb-8 mt-10 gap-3">
      <Text variant="label" style={{ color: colors.primary, letterSpacing: 1.5 }}>LESS TYPING. MORE DOING.</Text>
      <Text variant="hero" style={{ fontWeight: '700' }}>{register ? 'Your work.\nIn your words.' : 'Good to have\nyou back.'}</Text>
      <Text muted>{register ? 'Create an account to turn your field notes into clear, structured job reports.' : 'Sign in to pick up your jobs and let your voice do the paperwork.'}</Text>
    </View>
    <View className="gap-4">
      <Text variant="heading">{register ? 'Create your account' : 'Sign in to Formcast'}</Text>
      {error ? <Notice>{error}</Notice> : null}
      {register && <TextField label="Full name" value={values.name} onChangeText={change('name')} autoComplete="name" textContentType="name" autoCapitalize="words" error={errors.name} disabled={loading} maxLength={100} />}
      <TextField label="Email address" value={values.email} onChangeText={change('email')} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" autoCapitalize="none" error={errors.email} disabled={loading} />
      <TextField label="Password" value={values.password} onChangeText={change('password')} password autoCapitalize="none"
        autoComplete={register ? 'new-password' : 'current-password'} textContentType={register ? 'newPassword' : 'password'}
        error={errors.password} hint={register ? 'At least 12 characters.' : undefined} disabled={loading}
        returnKeyType={register ? 'next' : 'go'} onSubmitEditing={register ? undefined : submit} />
      {register && <TextField label="Confirm password" value={values.confirmPassword} onChangeText={change('confirmPassword')} password autoCapitalize="none"
        autoComplete="new-password" textContentType="newPassword" error={errors.confirmPassword} disabled={loading} returnKeyType="go" onSubmitEditing={submit} />}
      <Button onPress={submit} loading={loading}>{loading ? (register ? 'Creating account…' : 'Signing in…') : (register ? 'Create account' : 'Sign in')}</Button>
      <View className="items-center gap-1 pt-2">
        <Text variant="caption" muted>{register ? 'Already have an account?' : 'New to Formcast?'}</Text>
        <Button variant="text" disabled={loading} onPress={() => router.replace(register ? '/sign-in' : '/register')}>{register ? 'Sign in' : 'Create an account'}</Button>
      </View>
    </View>
    <View className="mt-8 gap-2 rounded-2xl p-5" style={{ backgroundColor: colors.primarySoft }}>
      <Text variant="label" style={{ color: colors.primary }}>Speak it. Review it. Finish it.</Text>
      <Text variant="caption" muted>Your voice drafts the report. You stay in control of what gets saved.</Text>
    </View>
  </Screen>;
}
