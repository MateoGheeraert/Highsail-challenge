# Formcast mobile

Expo Router + TypeScript + React Native Paper + NativeWind. Email/password screens
connect to the existing NestJS Better Auth endpoints.

## Run

Use Node 22.13+ on the Node 22 line, or Node 24.3+ (recommended).

```sh
cd mobile
npm ci
```

Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_URL` to the backend origin,
without `/api/auth`. Start the backend using the root README, then run `npm start`.
On PowerShell use `npm.cmd` if script execution policy blocks `npm`.

| Target                                  | Backend URL example                                 |
| --------------------------------------- | --------------------------------------------------- |
| Web / iOS simulator on the backend host | `http://localhost:3000`                             |
| Android emulator                        | `http://10.0.2.2:3000`                              |
| Physical phone on the same network      | `http://192.168.1.20:3000` (your computer's LAN IP) |

Set backend `BETTER_AUTH_URL` to the reachable backend origin. Include `formcast://`
in backend `TRUSTED_ORIGINS`. For web, also include the exact frontend origin
(normally `http://localhost:8081`). Expo Go may need its exact `exp://...` development
origin added too. Keep any existing origins; restart both servers after environment changes.
The backend `.env.example` includes the custom scheme, but existing `.env` files must
be updated manually. Do not put secrets in `EXPO_PUBLIC_*` variables.

Use Expo Go compatible with SDK 57 or a development build. After upgrading, restart
Metro with `npx expo start --clear` before scanning the QR code. `npm run web` runs the
browser preview. Native sessions use SecureStore; browser sessions use cookies.
Use the seeded demo account to access its demo job later. New registrations create a
real account but receive no seeded job.

### Connecting from a phone

Keep the phone and computer on the same Wi-Fi network. `localhost` on the phone
refers to the phone, so use the computer's Wi-Fi IPv4 address in both the mobile
API URL and backend auth URL. If that address changes, update both `.env` files.
Add the Expo Go origin shown by Metro to backend `TRUSTED_ORIGINS`, for example
`exp://192.168.1.20:8081` and `exp://192.168.1.20:8081/**`, keeping existing origins.
Restart NestJS and restart Metro with `npx expo start --clear` after these changes.

Open `http://YOUR_COMPUTER_IP:3000/api/health` in the phone's browser:

- HTTP 200 confirms the phone can reach the backend and the database is available.
- HTTP 503 means the backend is reachable but its database check failed.
- A connection timeout means to check the server process, Wi-Fi isolation/VPN routing,
  and Windows Firewall access to TCP port 3000 on the trusted local network.

An Expo tunnel exposes Metro, not the NestJS server. The API still needs a reachable
LAN address or its own hosted HTTPS endpoint.

## Structure

- `src/app/`: routes and session guard.
- `src/features/auth/`: forms and validation.
- `src/components/`: app-owned UI exports and Paper adapter.
- `src/theme/tokens.ts`: color and spacing tokens.
- `src/lib/auth-client.ts`: Better Auth Expo client.
- `../docs/mobile-design.md`: palette, typography, layout, and component conventions.

## Verify

```sh
npm run typecheck
npx expo install --check
npm run export
```

Device smoke test with a running backend:

1. Switch between sign-in and registration; verify keyboard scrolling and password visibility.
2. Submit empty/invalid fields, a short password, and mismatched confirmation.
3. Register a unique email; expect the welcome screen. Sign out and sign in again.
4. Try invalid credentials; expect a readable error without losing the form.
5. Relaunch the app; confirm session restoration. Sign out; protected routes must close.
6. Stop the backend; verify request failures and retry after restarting it.

The app includes job CRUD and native live voice capture with transcript/proposal previews,
Finish and Cancel. Configure the two provider keys on the backend, then restart it.
Use Expo Go with SDK 57 and the audio streaming API, or rebuild a development client
after installing `expo-audio`. Voice requires microphone permission and a reachable
backend WebSocket endpoint. Keep `formcast://` in backend trusted origins. The web
preview supports CRUD; native voice is available on iPhone and Android. See the
[voice architecture](../docs/voice-architecture.md) for protocol, limits and device checks.
Password reset, social sign-in, and email verification are not implemented.
