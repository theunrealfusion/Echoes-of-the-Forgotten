# PICO VR & WebXR Setup Guide — A Gift for the Forgotten City

**Target Devices**: PICO 4, PICO 4 Ultra, PICO Neo 3 Pro / Link  
**Target Platform**: WebXR Device API & PICO Browser (Instant Launch) + PICO OpenXR Native Wrapper  
**SDK Specification**: PICO OpenXR SDK v2.4.0+ / PICO Browser WebXR 1.0 Runtime  
**Document Status**: Production Ready for Sep 15–Oct 5 Development

---

## 1. Architecture & Deployment Paths

*A Gift for the Forgotten City* offers two distinct deployment paths on PICO hardware:

1. **WebXR Instant Play (Primary)**:
   - Zero installation required. Users open the PICO Browser on the headset, navigate to the live demo URL, and click **"ENTER VR"** via Three.js `VRButton`.
   - Native stereo rendering at 72Hz / 90Hz driven directly by `this.renderer.xr.enabled = true` and `renderer.setAnimationLoop()`.
2. **Standalone PWA / APK Wrapper (Tool Track Submission)**:
   - An Android APK wrapper bundling the WebXR client via Android Trusted Web Activity (TWA) or WebView with WebXR flag enabled, distributable via SideQuest or PICO Developer Lab.

---

## 2. PICO Developer Account Checklist

To prepare for native submissions and Developer Mode sideloading:

- [ ] **Step 1: Register Developer Account**  
  Register at the [PICO Developer Platform](https://developer.picoxr.com/). Ensure account type is set to **Individual Developer** or **Organization**.
- [ ] **Step 2: Identity & Organization Verification**  
  Submit basic contact details and tax information if planning commercial distribution. Instant verification applies for test APK signing.
- [ ] **Step 3: Register New App**  
  In the PICO Developer Console:
  - Click **App Management** → **Create App**.
  - App Name: `A Gift for the Forgotten City`
  - Platform: `PICO 4 / Neo 3`
  - Category: `Exploration / Casual / Art`
  - Record your assigned `APP_ID` and `APP_KEY`.

---

## 3. Headset Developer Mode Configuration

Enable USB debugging on your PICO 4 or Neo 3 headset:

1. Put on the headset, open **Settings** → **General** → **About**.
2. Scroll to **Software Version** and click it **7 times** rapidly until the notification *"You are now in developer mode"* appears.
3. A new **Developer** tab will appear on the left menu in Settings.
4. Open **Developer** and toggle **USB Debugging** to **ON**.
5. Connect the headset to your development machine via USB-C.
6. Look inside the headset and select **Always allow from this computer** on the RSA key prompt.

Verify device detection via ADB:
```bash
adb devices
# Expected output:
# List of devices attached
# PC400000000000000    device
```

---

## 4. PICO SDK Versions & Environment Matrix

| Component | Recommended Version | Compatibility Range |
|---|---|---|
| **PICO OS** | PICO OS 5.9.2+ | PICO OS 5.4.0+ |
| **PICO Browser** | v3.3.0+ (Chromium 114+) | v2.8.0+ |
| **WebXR Device API** | WebXR Level 1 Spec | Supported out-of-the-box |
| **PICO OpenXR SDK** | v2.4.0 | v2.2.0 – v2.5.0 |
| **Node.js (Dev)** | v20.x / v22.x | v18+ |
| **Android SDK / NDK** | API Level 30 (Android 11), NDK r25c | Android 10+ |

---

## 5. Working Development & Build Commands

### 5.1 Local WebXR Testing via ADB Reverse Port Forwarding
Test the local game server directly on the PICO headset with zero latency and no external Wi-Fi routing issues:

```bash
# 1. Start the game server locally from the repository root:
python3 -m http.server 8080

# 2. Reverse port forward the 8080 port over USB to the PICO headset:
adb reverse tcp:8080 tcp:8080

# 3. Inside the PICO Browser, navigate to:
# http://127.0.0.1:8080/
# The root redirect routes to /game/index.html.
# 4. Click the "ENTER VR" button at the bottom center.
```

### 5.2 Desktop WebXR Emulation Testing
To verify WebXR session initialization without a physical headset:
1. In Google Chrome or Microsoft Edge, install the **WebXR API Emulator** extension (by Mozilla / Meta).
2. Open DevTools (`F12`), switch to the **WebXR** tab, and select **Pico Neo 3** or **Oculus Quest 2** from the device dropdown.
3. Open `http://localhost:8080/game/index.html`.
4. Observe that the `#VRButton` changes text from "VR NOT SUPPORTED" to **"ENTER VR"**.
5. Click **"ENTER VR"**. The canvas splits into stereo views with active controller raycasts.

### 5.3 Standalone APK Packaging (Bubblewrap TWA)
To generate a signed PICO-compatible APK wrapper for offline installation:

```bash
# Install Bubblewrap CLI
npm install -g @bubblewrap/cli

# Initialize Android project from manifest
bubblewrap init --manifest="https://keshav-pi.github.io/TripothonS1/game/manifest.json"

# Build signed release APK
bubblewrap build

# Install APK directly onto connected PICO headset:
adb install -r app-release-signed.apk
```

---

## 6. Controller Mapping & Immersive Controls

The Three.js engine handles standard WebXR gamepad input mapping for PICO controllers:

| PICO 4 Controller Input | Engine Function | Three.js WebXR Event |
|---|---|---|
| **Left Joystick (X/Y)** | First-Person Locomotion (Forward/Back/Strafe) | `session.inputSources[0].gamepad.axes[2,3]` |
| **Right Joystick (X/Y)** | Smooth / Snap Camera Yaw Rotation | `session.inputSources[1].gamepad.axes[2,3]` |
| **Right Trigger** | Interact / Collect Echo Proximity Trigger | `select` / `selectstart` |
| **Grip Button** | Pick up cultural relics / Inspect | `squeeze` / `squeezestart` |
| **A / X Buttons** | Reset Camera Center / Recenter | `gamepad.buttons[4]` |
| **System Button** | Open PICO OS Overlay | Handled by OS |

---

## 7. WebXR Performance Guidelines on PICO Hardware

1. **Fixed Foveated Rendering (FFR)**: PICO Browser supports standard WebGL foveated rendering extensions (`GL_EXT_multisampled_render_to_texture`).
2. **Animation Loop**: Always drive engine updates via `renderer.setAnimationLoop(callback)` to synchronize with PICO's 72Hz/90Hz hardware display refresh.
3. **Single Draw Pass in VR**: When `renderer.xr.isPresenting === true`, bypass heavy multi-pass post-processing bloom and render directly with `renderer.render(scene, camera)` to guarantee consistent 90 fps and zero latency jitter.
