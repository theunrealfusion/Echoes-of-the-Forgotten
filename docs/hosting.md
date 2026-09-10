# Deployment and Hosting Guide — A Gift for the Forgotten City

**Project**: A Gift for the Forgotten City (Tripothon S1 Hackathon Entry)  
**Status**: Pre-Launch Validated (Local Preview); Public Hosting Configured for Day 1 Activation (Sep 15, 2026)  
**Target Public Production URL**: `https://keshav-pi.github.io/TripothonS1/` (GitHub Pages)  
**Target Mirror URL**: `https://tripothon-s1.vercel.app/` (Vercel)  
**Direct Client Path**: `https://keshav-pi.github.io/TripothonS1/game/index.html`  
**Current Verification**: Empirically verified locally (`http://localhost:8080/`) with 0 console errors across 5 zones.

---

## 1. Hosting Architecture

*A Gift for the Forgotten City* is designed as a zero-overhead, purely static client application. It requires no backend server runtime for gameplay:

1. **Engine**: Three.js r160 modular ES builds loaded via browser-native `<script type="importmap">` targeting `https://esm.sh/three@0.160.0`.
2. **Audio**: 100% procedural sound synthesizer utilizing the browser Web Audio API. Zero external audio file network dependencies.
3. **World Manifests & Data**: JSON manifests located under `assets/manifests/` fetched via relative HTTP requests (`../assets/manifests/zones.json`).
4. **Procedural Geometry Stand-in Fallbacks**: In the absence of heavy GLB files or during network throttling, procedural shader geometry seamlessly renders all 5 civilizations with zero console errors or failed network requests.
5. **Root Entrypoint Routing**: The root `index.html` issues an immediate client-side redirect (`window.location.replace("game/index.html")` and `<meta http-equiv="refresh">`) to route judges and players directly to the game experience.

---

## 2. Configuration Files

The repository root includes complete, production-ready hosting configurations:

### 2.1 Root Redirect (`index.html`)
- Handles direct visits to the root domain (`/`) or repository path on GitHub Pages (`https://<user>.github.io/<repo>/`).
- Implements OpenGraph and Twitter card metadata for rich previews when shared on Discord, Twitter/X, and social media.
- Provides an accessible fallback button for browsers with JavaScript redirects disabled.

### 2.2 Vercel Configuration (`vercel.json`)
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "cleanUrls": true,
  "rewrites": [
    {
      "source": "/",
      "destination": "/game/index.html"
    }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Access-Control-Allow-Origin", "value": "*" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "SAMEORIGIN" }
      ]
    },
    {
      "source": "/assets/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
      ]
    },
    {
      "source": "/game/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=86400, stale-while-revalidate=604800" }
      ]
    }
  ]
}
```

### 2.3 Jekyll Bypass (`.nojekyll`)
- Placed at the repository root to prevent GitHub Pages' default Jekyll engine from stripping folders or files that begin with underscores or containing specific patterns.

---

## 3. Pre-Launch Local Verification (Current Status)

During the pre-launch workstream window (Sep 10–14, 2026), the application runs in a local sandbox without remote write credentials. Local static hosting has been verified using Python's built-in HTTP server:

```bash
# Start local preview server from repository root:
python3 -m http.server 8080

# Verify local endpoints:
curl -I http://127.0.0.1:8080/
# Returns: HTTP/1.0 200 OK (Content-type: text/html)

curl -I http://127.0.0.1:8080/game/index.html
# Returns: HTTP/1.0 200 OK (Content-type: text/html)

curl -I http://127.0.0.1:8080/assets/manifests/zones.json
# Returns: HTTP/1.0 200 OK (Content-type: application/json)
```

Browser runtime verification via Chromium DevTools Protocol confirmed:
- Zero JavaScript console errors on cold load.
- All 5 zone configurations render successfully with procedural fallback shaders.
- WebXR subsystem initializes and displays the `#VRButton` in DOM.
- Mobile touch controls and virtual joystick adapt automatically under touch emulation.

---

## 4. Public Deployment Runbook (Day 1 Activation: Sep 15, 2026)

When the submission window opens on Sep 15, 2026, activate public hosting using either of the following methods:

### Option A: GitHub Pages (Primary Production Host)
1. Configure the remote repository and push:
   ```bash
   git remote add origin https://github.com/keshav-pi/TripothonS1.git
   git branch -M main
   git push -u origin main
   ```
2. In the GitHub repository settings:
   - Navigate to **Settings** → **Pages**.
   - Under **Build and deployment**:
     - **Source**: `Deploy from a branch`
     - **Branch**: `main`, Folder: `/ (root)`
     - Click **Save**.
3. Within 1–2 minutes, the live game will be publicly accessible at:
   `https://keshav-pi.github.io/TripothonS1/`

### Option B: Vercel (Alternative CDN Mirror)
1. Deploy using Vercel CLI via npx:
   ```bash
   npx vercel --prod
   ```
2. Accept the default project settings; Vercel automatically detects `vercel.json` and routes the root request to `/game/index.html`.
3. The mirror site will be live at:
   `https://tripothon-s1.vercel.app/`

---

## 5. Verification Matrix

| Check | Target / Environment | Expected Result | Verification Command | Pre-Launch Status |
|---|---|---|---|:---:|
| **Root Redirect** | Local Preview | HTTP 200 (serves root redirect) | `curl -I http://127.0.0.1:8080/` | **PASS** |
| **Direct Game Client** | Local Preview | HTTP 200 OK | `curl -I http://127.0.0.1:8080/game/index.html` | **PASS** |
| **Zone Manifests** | Local Preview | HTTP 200 (`application/json`) | `curl -I http://127.0.0.1:8080/assets/manifests/zones.json` | **PASS** |
| **Console Errors** | Chromium CDP | Exactly 0 errors | DevTools Console cold load | **PASS** |
| **Zone Fallbacks** | Chromium CDP | 5 of 5 zones procedural geometry | `window.__game.world.zones` inspection | **PASS** |
| **WebXR Support** | Chromium CDP | `#VRButton` present and active | DOM inspection `#VRButton` | **PASS** |
| **Public GitHub Pages** | Public Internet | HTTP 200 | `curl -I https://keshav-pi.github.io/TripothonS1/` | *Scheduled Sep 15* |
| **Public Vercel Mirror** | Public Internet | HTTP 200 | `curl -I https://tripothon-s1.vercel.app/` | *Scheduled Sep 15* |
