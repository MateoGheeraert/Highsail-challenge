# Formcast mobile design

## Direction

A calm, practical interface for field technicians: warm backgrounds, deep teal actions,
clear labels, and generous touch targets. Copy is direct and friendly. The authentication
screens introduce the promise: “Speak it. Review it. Finish it.”

## Palette

The source of truth is `mobile/src/theme/tokens.ts`.

| Token | Hex | Use |
| --- | --- | --- |
| primary | `#16665C` | Primary actions, brand mark, focus |
| primaryPressed | `#104D46` | Reserved pressed-state color |
| primarySoft | `#E4F0EC` | Supporting panels |
| background | `#F7F8F4` | Warm screen background |
| surface | `#FFFFFF` | Inputs and cards |
| ink | `#182D2A` | Headings and main text |
| muted | `#526661` | Secondary text and hints |
| border | `#C5D1CB` | Input outlines and separators |
| error | `#B3261E` | Validation and failure text |
| errorSoft | `#FCEBE9` | Error panels |
| proposed | `#805500` | Future proposal text/badges |
| proposedSoft | `#FFF4D6` | Future proposal backgrounds |
| success | `#226341` | Future committed/success indicators |

Use white text on primary actions and ink on light surfaces. Do not use the border
color for text. Proposed changes will use amber plus a dashed border and “Proposed”
label; committed values will use a solid surface. Color alone must never convey state.

## Type and layout

- System fonts through Paper's Material 3 type scale; no font download required.
- Hero: 36/44, bold. Page title: 28/36. Section heading: 22/28.
- Body: 16/24. Supporting text: 14/20. Labels: 14/20, medium.
- Spacing scale: 4, 8, 16, 24, 32, 48 points.
- Screen gutter: 24 points; authentication content max width: 480 points.
- Controls: 12-point corners and at least 52-point button height.
- Supporting panels: 16-point corners; larger future cards: 24 points.
- Scrollable safe-area layouts with keyboard avoidance; allow font scaling and text wrapping.
- Light theme is intentional for this first version.

## Components and ownership

Import UI controls from `@/components`. Only `src/components/ui.tsx` imports
`react-native-paper`; it maps app-owned props onto Paper components and supplies the
theme. The barrel exports `Button`, `Text`, `TextField`, `Notice`, `Loading`,
`BrandMark`, `Screen`, and `UIProvider`.

Keep Paper types, variants, and compound components out of feature code. A library
replacement should change the adapter implementation while preserving the public
props. NativeWind handles layout on React Native views; shared tokens and the adapter
handle colors and control styling. Add shared wrappers as features need them.

## Authentication behavior

Visible labels, email keyboard/autofill, hidden passwords with accessible visibility
toggles, and inline validation. Registration asks for full name, email, password, and
confirmation. New passwords must be 12–128 characters, matching Better Auth defaults
and the backend minimum. Sign-in only checks that a password is present.

Submitting disables the form and navigation action. Request errors preserve input and
offer a retry. Better Auth manages sessions with SecureStore on native platforms and
browser cookies on web. Protected routes prevent returning to auth screens while signed
in. The initial authenticated screen is a welcome/sign-out screen; job UI is future work.

## Implementation references

- [Better Auth Expo integration](https://better-auth.com/docs/integrations/expo)
- [NativeWind v4 installation](https://www.nativewind.dev/docs/getting-started/installation)
- [Expo SDK 57](https://expo.dev/changelog/sdk-57)

The app targets Expo SDK 57 and NativeWind 4 / Tailwind 3. Use a compatible
Expo Go version or a development build; upgrade the SDK and native packages together.
