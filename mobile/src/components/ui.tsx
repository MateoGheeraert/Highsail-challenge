// Keep all UI-library imports and mappings behind this app-owned interface.
import { useState, type PropsWithChildren } from 'react';
import { View, type TextInputProps, type StyleProp, type TextStyle } from 'react-native';
import {
  ActivityIndicator, Button as PaperButton, HelperText, Icon,
  MD3LightTheme, PaperProvider, Text as PaperText, TextInput as PaperInput,
} from 'react-native-paper';
import { colors, radius } from '@/theme/tokens';

const theme = {
  ...MD3LightTheme,
  roundness: radius.control,
  colors: {
    ...MD3LightTheme.colors, primary: colors.primary, onPrimary: colors.surface,
    primaryContainer: colors.primarySoft, onPrimaryContainer: colors.ink,
    background: colors.background, surface: colors.surface, onSurface: colors.ink,
    onSurfaceVariant: colors.muted, outline: colors.border, error: colors.error,
    surfaceVariant: colors.primarySoft,
  },
};

export function UIProvider({ children }: PropsWithChildren) {
  return <PaperProvider theme={theme}>{children}</PaperProvider>;
}

type TextVariant = 'hero' | 'title' | 'heading' | 'body' | 'caption' | 'label';
const variants = { hero: 'displaySmall', title: 'headlineMedium', heading: 'titleLarge', body: 'bodyLarge', caption: 'bodyMedium', label: 'labelLarge' } as const;
export function Text({ children, variant = 'body', muted, style }: PropsWithChildren<{
  variant?: TextVariant; muted?: boolean; style?: StyleProp<TextStyle>;
}>) {
  return <PaperText variant={variants[variant]} style={[{ color: muted ? colors.muted : colors.ink }, style]}>{children}</PaperText>;
}

export function Button({ children, onPress, variant = 'primary', loading, disabled, accessibilityLabel }: PropsWithChildren<{
  onPress: () => void; variant?: 'primary' | 'secondary' | 'text'; loading?: boolean;
  disabled?: boolean; accessibilityLabel?: string;
}>) {
  return <PaperButton mode={{ primary: 'contained', secondary: 'outlined', text: 'text' }[variant] as 'contained' | 'outlined' | 'text'}
    onPress={onPress} loading={loading} disabled={disabled || loading} accessibilityLabel={accessibilityLabel}
    contentStyle={{ minHeight: 52 }} style={{ borderRadius: radius.control }} labelStyle={{ fontSize: 16, fontWeight: '600' }}>
    {children}
  </PaperButton>;
}

type FieldProps = Pick<TextInputProps, 'value' | 'onChangeText' | 'autoComplete' | 'textContentType' | 'keyboardType' | 'returnKeyType' | 'onSubmitEditing' | 'autoCapitalize' | 'maxLength' | 'multiline'> & {
  label: string; password?: boolean; error?: string; hint?: string; disabled?: boolean;
};
export function TextField({ label, password, error, hint, disabled, ...props }: FieldProps) {
  const [visible, setVisible] = useState(false);
  return <View>
    <PaperInput {...props} label={label} accessibilityLabel={label} mode="outlined" error={!!error}
      disabled={disabled} autoCorrect={false} secureTextEntry={password && !visible}
      style={{ backgroundColor: colors.surface }} outlineStyle={{ borderRadius: radius.control }}
      right={password ? <PaperInput.Icon icon={visible ? 'eye-off-outline' : 'eye-outline'}
        accessibilityLabel={visible ? 'Hide password' : 'Show password'} onPress={() => setVisible(!visible)} /> : undefined} />
    {(error || hint) && <View accessibilityLiveRegion="polite"><HelperText type={error ? 'error' : 'info'} visible style={{ paddingHorizontal: 0 }}>{error || hint}</HelperText></View>}
  </View>;
}

export function Notice({ children }: PropsWithChildren) {
  return <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ padding: 16, borderRadius: 12, backgroundColor: colors.errorSoft }}>
    <Text variant="caption" style={{ color: colors.error }}>{children}</Text>
  </View>;
}

export function Loading({ label = 'Opening Formcast…' }: { label?: string }) {
  return <View className="flex-1 items-center justify-center gap-4" style={{ backgroundColor: colors.background }}>
    <ActivityIndicator accessibilityLabel={label} /><Text muted>{label}</Text>
  </View>;
}

export function BrandMark() {
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
    <Icon source="waveform" size={30} color={colors.surface} />
  </View>;
}
