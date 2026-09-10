# Original User Request

## Initial Request — 2026-09-10T14:52:17Z

A Tripothon S1 hackathon entry called "A Gift for the Forgotten City" is already scaffolded at `/storage/Repositories/TripothonS1`. The entire codebase (5,498 lines: Three.js game engine, Tripo V3 API pipeline, 5-civilization world config, scripts) is in place. Submissions open Sep 15, 2026. Between now (Sep 10) and Sep 14 EOD, a team must complete all 8 pre-launch workstreams so that Sep 15–Oct 5 is purely implementation and content generation with zero setup overhead.

Working directory: `/storage/Repositories/TripothonS1`
Integrity mode: demo

Codebase context: The game uses Three.js (CDN via import map), a Python async pipeline calling the Tripo V3 API, and WebXR for PICO VR. The five civilizations are: Sunken Library, Sky Nomads, Deep Forge, Memory Gardens, Grand Reunion. Each has 5–6 3D assets to generate + 1 NPC.

## Requirements

### R1. Browser game validated and hosted on a live URL
The Three.js game (`game/index.html`) must load without errors on desktop Chrome/Firefox and mobile Safari/Chrome. All 5 zone configs from `assets/manifests/zones.json` must render with placeholder geometry when GLB files are absent. A live public URL (GitHub Pages or Vercel) must be deployed and accessible so judges can click and play on Day 1 of submissions.

### R2. Tripo API pipeline dry-run validated
Every one of the 25 asset prompts in `pipeline/batch_runner.py` and `pipeline/asset_generator.py` must be reviewed and scored for quality (clear, architecturally specific, style-consistent). A dry-run mode must be added to `batch_runner.py` (`--dry-run` flag) that validates prompt structure and estimated credit cost without making real API calls. A prompt quality report must be saved to `docs/prompt_review.md`.

### R3. Concept art generated for all civilizations
All 11 concept images must be generated via `pipeline/concept_generator.py` (uses Pollinations.ai — free, no API key) and saved under `assets/concepts/{civ_id}/`. These images feed the Tripo image-to-3D pipeline as reference art for hero assets. Any failed generations must be retried or substituted with an alternative free image source.

### R4. Performance baseline meets 60 fps target
The game must sustain ≥ 60 fps on a mid-range device simulation (Chrome DevTools CPU 4× throttle, no GPU throttle). Any Three.js bottlenecks (draw calls, overdraw, unoptimized particle counts) must be fixed. Results must be documented in `docs/performance_baseline.md` with before/after metrics.

### R5. WebXR/PICO entry point verified
The game must enter WebXR session successfully in a browser that supports WebXR (Chrome with WebXR emulator extension). A PICO developer account checklist and SDK integration notes must be written to `docs/pico_setup.md` so the PICO VR build can start immediately on Sep 15.

### R6. Submission document written
A 500–600 word project description must be written to `docs/submission.md` that explicitly addresses all 5 judging criteria: Creativity (30%), Completeness (25%), Theme Fit (20%), Viral Potential (15%), Commercial Value (10%). A separate Tool Track section must explicitly name Tripo, PICO, and World Labs and describe how each is used. This document must be paste-ready for the Tripothon submission form on Sep 15.

### R7. Social media launch content prepared
All Sep 15 launch posts must be drafted and saved to `social/launch_posts/`:
- `twitter_thread.md` — 8-tweet thread with GIF descriptions and hashtags
- `tiktok_script.md` — 30-second video script for the first transformation clip
- `instagram_caption.md` — Caption + hashtag set for the launch Reel
- `youtube_description.md` — Dev diary #1 video description and timestamps

The posts must follow the content calendar at `social/content_calendar.md` and include all required Tripothon hashtags.

### R8. Asset generation checklist and credit budget calculated
A master asset checklist must be created at `docs/asset_checklist.md` listing all 25+ assets across 5 civilizations, their generation order (dependency graph), estimated Tripo credit cost per asset (text-to-3D + retopo + PBR), and total budget. A recommended generation schedule must be included that fits within the Sep 15–Oct 5 window, prioritising assets needed for the earliest zones. Any prompt that would likely produce a poor result must be flagged with a suggested revision.

## Acceptance Criteria

### Game & Hosting
- [ ] `game/index.html` loads with zero console errors on Chrome 125+ and Firefox 126+
- [ ] All 5 zones render placeholder geometry when GLB files are absent
- [ ] Mobile viewport shows correct layout with virtual joystick visible
- [ ] A public URL is live and accessible (GitHub Pages or Vercel)
- [ ] The URL is recorded in `docs/hosting.md`

### Tripo Pipeline
- [ ] `python3 pipeline/batch_runner.py --dry-run` runs without errors and prints all 25 prompts with estimated credit costs
- [ ] `docs/prompt_review.md` exists with a score (1–5) and brief rationale for each prompt
- [ ] At least 20 of 25 prompts score ≥ 4/5; any scoring < 3 must have a revised version included

### Concept Art
- [ ] All 11 concept images exist in `assets/concepts/` as non-zero PNG files
- [ ] Each image is ≥ 512×512 px
- [ ] `assets/concepts/concept_manifest.json` lists all generated paths

### Performance
- [ ] Chrome DevTools Performance trace (4× CPU throttle) shows ≥ 60 fps average in the Sunken Library zone
- [ ] `docs/performance_baseline.md` contains before/after fps numbers and a list of optimizations applied

### WebXR / PICO
- [ ] The game launches a WebXR session via the "Enter VR" button in Chrome with WebXR emulator (or a native WebXR-capable browser)
- [ ] `docs/pico_setup.md` exists with account setup steps, SDK version, and a working build command

### Submission Document
- [ ] `docs/submission.md` is 500–600 words
- [ ] Each of the 5 judging criteria is explicitly addressed with at least 2 sentences
- [ ] The Tool Track section names Tripo, PICO, and World Labs with usage descriptions

### Social Media
- [ ] All 4 launch post files exist in `social/launch_posts/`
- [ ] The Twitter thread contains ≥ 6 tweets with hashtags `#Tripothon #TripothonS1 #TripoAI`
- [ ] TikTok script has a hook line, visual cues, and a CTA

### Asset Checklist
- [ ] `docs/asset_checklist.md` covers all 25+ assets with: name, civilization, prompt, estimated credits, priority order
- [ ] Total estimated credit cost is calculated and a recommended daily generation schedule is included
