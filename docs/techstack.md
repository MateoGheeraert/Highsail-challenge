Updated frontend stack:

- Expo + React Native + TypeScript — mobile app foundation.
- Expo Router — navigation.
- NativeWind — Tailwind CSS syntax in React Native, e.g. className="flex-1 bg-white px-4".
- React Native Paper — ready-made components such as buttons, inputs, chips, dialogs and activity indicators.
- TanStack Query — fetching committed job data and handling mutations like Finish.
- expo-audio — live microphone PCM streaming.
- Native WebSocket — realtime audio upload + proposal/transcript updates.
- Better Auth + @better-auth/expo — authentication if we have enough time.
  So for styling/component responsibilities:
  React Native Paper
  → functional components
  → Button, TextInput, Chip, Dialog, ActivityIndicator...

NativeWind
→ layout + custom visual styling
→ spacing, flex, borders, colors, proposed states...

For example, the proposal UI could be something like:
<View className="rounded-xl border-2 border-dashed border-amber-400 bg-amber-50 p-4">
<Text className="text-xs font-semibold uppercase text-amber-700">
Proposed
</Text>

  <Text className="mt-1 text-lg font-semibold">
    10:00
  </Text>
</View>

That combination is a good fit because Paper saves time on standard controls, while NativeWind lets us quickly make the proposal/committed distinction visually clear without fighting Paper's styling system.
So our final main stack is:
Frontend
Expo
React Native
TypeScript
Expo Router
React Native Paper
NativeWind / Tailwind
TanStack Query
expo-audio

Realtime
WebSocket

Backend
NestJS
@nestjs/platform-ws
Zod
Better Auth

AI
Deepgram Nova-3 → speech-to-text
GPT-5 mini → structured proposal generation

Database
Prisma
PostgreSQL

Temporary proposal state
NestJS in-memory Map

I would consider that stack locked in now; there isn't much benefit to adding Redux, Zustand, LiveKit, Socket.IO or another UI framework for this challenge.
