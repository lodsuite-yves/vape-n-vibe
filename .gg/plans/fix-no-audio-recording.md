# Fix: Packaged App Stopped Recording Audio

## Diagnosis

The installed app used to work but stopped capturing audio. Pressing the hotkey activates the overlay, but the visualizer doesn't animate and nothing gets transcribed/pasted.

### Root Cause: macOS Revoked Microphone Permission After App Update

macOS ties microphone permissions to an app's **code signature** via its TCC (Transparency, Consent, and Control) system. When the app was first installed, `getUserMedia()` in the renderer implicitly triggered the system permission dialog — the user granted it and everything worked.

When the app was subsequently **updated** (rebuilt and re-signed), the code signature changed. macOS invalidates TCC permissions when a signature changes, so the previously granted microphone access was silently revoked.

The app has **no explicit microphone permission handling** — it never calls `systemPreferences.getMediaAccessStatus('microphone')` or `systemPreferences.askForMediaAccess('microphone')`. So after the permission is revoked, there's no mechanism to detect this or re-request it. The renderer's `getUserMedia()` call alone cannot re-trigger the system dialog once TCC has invalidated the grant.

Meanwhile the app *does* properly handle Accessibility and System Events permissions with check/request UI — microphone just wasn't included.

**Why it fails silently:**
- In Electron 40, `getUserMedia()` rejects with `NotAllowedError` when mic permission is denied. The error is caught in the recording promise chain and `sendRecordingError()` fires — but the overlay just briefly appears then disappears with no user-facing explanation of what went wrong.

### Evidence
- `src/main/ipc.js` — no `getMediaAccessStatus` or `askForMediaAccess` calls anywhere
- `src/renderer/renderer.js` line 298 — `getUserMedia` called with no prior permission check
- `src/main/hotkey.js` lines 259-281 — Accessibility permission is checked/requested, but mic is not
- `scripts/entitlements.mac.plist` — has `com.apple.security.device.audio-input` (correct entitlement, but entitlements don't *grant* permission — user must also approve in System Settings)
- `src/renderer/index.html` lines 68-79 — Accessibility row exists, no equivalent Microphone row

## Fix

Add microphone permission checking and requesting, mirroring the existing Accessibility/System Events permission pattern. Add a "Microphone" permission row in settings, request permission on startup, and improve error diagnostics.

### Files to modify:
- `src/main/ipc.js` — add `check-microphone` and `request-microphone` IPC handlers
- `src/main/preload.js` — expose `checkMicrophone` and `requestMicrophone` to renderer
- `src/renderer/index.html` — add Microphone permission row in settings
- `src/renderer/renderer.js` — add mic permission UI logic
- `main.js` — request mic permission on startup

## Steps

1. In `src/main/ipc.js`, add two new IPC handlers: `check-microphone` (uses `systemPreferences.getMediaAccessStatus('microphone')` on macOS, returns `true` on other platforms) and `request-microphone` (calls `systemPreferences.askForMediaAccess('microphone')` on macOS), both with `validateSender` checks. Import `systemPreferences` from `electron` at the top of the file alongside the existing electron imports.
2. In `src/main/preload.js`, expose `checkMicrophone` and `requestMicrophone` methods on the `window.vapenvibe` bridge object, invoking the new IPC channels via `ipcRenderer.invoke`.
3. In `src/renderer/index.html`, add a new "Microphone" permission setting row between the "Dictionary" and "Accessibility" rows, following the exact same HTML pattern as the Accessibility row (lines 68-79): a setting div with label "Microphone", a `<span class="status-badge granted hidden" id="mic-perm-status">Granted</span>`, and a `<button class="setting-btn hidden" id="grant-mic-btn">Grant</button>`. Also add an `id="mic-perm-setting"` on the outer div for platform-hiding.
4. In `src/renderer/renderer.js`, add microphone permission UI logic following the same pattern as Accessibility (lines 563-601): get the `mic-perm-status` and `grant-mic-btn` elements; write an `updateMicUI(granted)` function that toggles visibility; hide the row on non-darwin platforms; on load call `checkMicrophone()` and update UI; on "Grant" click call `requestMicrophone()` then poll `checkMicrophone()` every 2 seconds until granted; pause polling on `visibilitychange` hidden (like accessibility polling at line 641-652).
5. In `main.js` inside `app.whenReady()`, add `if (process.platform === 'darwin') { const { systemPreferences } = require('electron'); systemPreferences.askForMediaAccess('microphone').catch(() => {}); }` early (before window creation) so the system permission dialog appears on first launch.
6. In `src/renderer/renderer.js` recording error catch block (lines 420-427), change the `console.error` to log `err.name` and `err.message` explicitly, so `NotAllowedError` mic permission denials are clearly identifiable in console output.
7. Run `npm run lint` and `npm run format:check` and fix any issues.
