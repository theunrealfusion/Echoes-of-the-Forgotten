# 🌌 A Gift for the Forgotten City

### *Tripothon S1 Entry | A Gift for ______*

> *"Every civilization that vanishes leaves behind an echo. You are the one who listens."*

[![Python 3.9+](https://img.shields.io/badge/Python-3.9%2B-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r158-black?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Tripo AI](https://img.shields.io/badge/Tripo-V3%20API-7c3aed?logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSI4IiBjeT0iOCIgcj0iOCIgZmlsbD0id2hpdGUiLz48L3N2Zz4=)](https://developers.tripo3d.ai/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![WebXR Ready](https://img.shields.io/badge/WebXR-Ready-00c853?logo=googlevr&logoColor=white)](https://immersiveweb.dev/)

---

## 📖 About the Game

**A Gift for the Forgotten City** is a contemplative exploration game built for the Tripothon S1 hackathon. You inhabit a vast, fractured world where four ancient civilizations have been erased — not by war or disaster in the conventional sense, but by the slow, quiet violence of being forgotten. Their cities still exist, frozen in a colourless void, their architecture perfect but empty, their voices silent.

Your role is not that of a conqueror or a saviour. You are a **Rememberer** — an entity that exists only in the space between memory and oblivion. By finding **Echoes** (fragments of cultural memory scattered through each zone), you gradually restore colour, sound, and life to each civilization. Buildings solidify from translucent ghosts into vivid structures. Music returns. The wind carries voices again.

The game culminates in **The Grand Reunion**: a fifth zone that materialises only when all four civilizations have been sufficiently restored. Here, representatives of each people finally meet — in your presence, through you — for the first and last time. The Gift you bring is simply the act of remembering them.

---

## 🖼️ Screenshots

> *(Asset generation via Tripo V3 in progress — screenshots will appear here once models are generated)*

| Void State | Restoration in Progress | Fully Restored |
|:---:|:---:|:---:|
| `[placeholder]` | `[placeholder]` | `[placeholder]` |

*Run `./scripts/generate_assets.sh` then open `game/index.html` to see the world.*

---

## ✨ Features

- 🏛️ **Four forgotten civilizations** — each with unique architecture, colour palette, lore, and ambient soundscape
- 🌫️ **Void-to-vivid restoration** — zones transition from desaturated grey to full colour as you collect Echoes
- 🎵 **Generative audio** — Web Audio API drives zone-specific music that builds as restoration progresses
- 🔮 **Echo collection mechanic** — find and "remember" cultural fragments hidden throughout each zone
- 🌳 **Grand Reunion ending** — an unlockable fifth zone that only appears when all four civilizations are restored
- 🚀 **Tripo V3 3D assets** — all architecture, landmarks, and artifacts are AI-generated `.glb` models
- 🥽 **WebXR-ready** — full VR support via the WebXR Device API (where hardware is available)
- 📦 **Zero server dependencies** — the game runs entirely in the browser from a single `index.html`

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **3D Engine** | [Three.js](https://threejs.org/) r158 | Scene graph, rendering, camera |
| **Asset Pipeline** | Python 3.9 + aiohttp | Async batch generation via Tripo API |
| **AI Models** | [Tripo V3 API](https://developers.tripo3d.ai/) | Text-to-3D `.glb` generation |
| **Audio** | Web Audio API | Generative, state-driven soundscapes |
| **VR** | WebXR Device API | Immersive mode on compatible devices |
| **Environment** | python-dotenv | API key management |
| **Terminal UI** | Rich + tqdm | Pipeline progress and status output |

---

## ⚡ Quick Start

### Prerequisites
- Python 3.9+
- A modern browser (Chrome 112+, Firefox 110+, Safari 16.4+)
- A [Tripo AI API key](https://developers.tripo3d.ai/) (free tier available)

### Steps

**1. Clone the repository**
```bash
git clone https://github.com/your-username/tripothon-s1.git
cd tripothon-s1
```

**2. Configure your environment**
```bash
cp .env.example .env
# Open .env and set TRIPO_API_KEY=<your key>
```

**3. Install Python dependencies**
```bash
pip install -r requirements.txt
```

**4. Verify your API connection**
```bash
python pipeline/batch_runner.py test-connection
```
You should see a green ✅ confirming your key is valid and the Tripo V3 endpoint is reachable.

**5. Generate all 3D assets**
```bash
python pipeline/batch_runner.py generate-all
# Or use the convenience script:
./scripts/generate_assets.sh
```
This will generate ~23 `.glb` model files across all five zones and write them to `assets/models/`.  
Estimated time: **8–15 minutes** depending on API queue depth.

**6. Launch the game**
```bash
# Option A — Quick open (may have CORS issues with some browsers)
open game/index.html

# Option B — Recommended: local HTTP server
python -m http.server 8080 --directory game/
# Then visit http://localhost:8080
```

---

## 📁 Project Structure

```
tripothon-s1/
├── .env.example               # Environment variable template
├── .gitignore                 # Excludes .env, generated assets, etc.
├── README.md                  # This file
├── requirements.txt           # Python dependencies
│
├── pipeline/                  # Python asset generation pipeline
│   ├── __init__.py
│   ├── batch_runner.py        # CLI entry point (test-connection, generate-all)
│   ├── tripo_client.py        # Async Tripo V3 API client
│   ├── prompt_builder.py      # Text-to-3D prompt construction per zone
│   └── manifest_writer.py     # Writes asset_manifest.json after generation
│
├── game/                      # Browser game (pure HTML/CSS/JS)
│   ├── index.html             # Entry point — open this to play
│   ├── style.css              # UI overlay styling
│   └── js/
│       ├── main.js            # Three.js scene initialisation
│       ├── world.js           # Zone loading from zones.json
│       ├── echo.js            # Echo collection mechanics
│       ├── restoration.js     # Void→colour transition system
│       ├── audio.js           # Web Audio API soundscape engine
│       └── xr.js              # WebXR session management
│
├── assets/
│   ├── manifests/
│   │   ├── zones.json         # Zone config (civilizations, models, positions)
│   │   └── asset_manifest.json # Generated asset registry (auto-updated)
│   ├── models/                # Generated .glb files (gitignored)
│   ├── concepts/              # Concept art (gitignored)
│   └── exports/               # Packaged builds (gitignored)
│
└── scripts/
    ├── setup.sh               # One-shot project setup
    ├── generate_assets.sh     # Full asset pipeline runner
    └── serve.sh               # Local dev server
```

---

## 🔄 How It Works

### The Restoration Mechanic

Each zone exists in two simultaneous states: **Void** and **Restored**. When a zone is first entered, all geometry is rendered using only the zone's `void` colour — a flat, desaturated tone that drains the world of life. Shaders sample `restoration_progress` (a float from 0.0 to 1.0) to linearly interpolate between the void and restored colour palettes.

**Echo Collection** is the core gameplay loop:
1. Echoes are small, glowing fragments placed around a zone — hidden in architectural details, beneath landmarks, atop spires.
2. When the player walks within range, a soft chime plays and the Echo "activates."
3. Interacting with an Echo triggers a brief first-person vision: a 5-second memory of the civilization at its peak.
4. After the vision, `restoration_progress` increases by `1 / echo_count` for that zone.
5. At `required_echoes / echo_count`, the zone "flips" — a timed shader transition over ~8 seconds restores full colour, music swells, and ambient voices return.

### The Grand Reunion Unlock

The `grand_reunion` zone's position in `zones.json` is `[0, 0, 0]` — the same as `sunken_library`. It is overlaid on the world but hidden (opacity 0, collisions disabled) until all four prerequisite zones are fully restored. When the final restoration completes, a convergence animation draws light from all four cardinal zones toward the centre, and the Reunion zone fades in over the existing world geometry.

---

## 🏆 Judging Criteria

This entry targets all four Tripothon S1 criteria:

| Criterion | Implementation |
|---|---|
| **Creative use of Tripo V3** | All 23 game models are AI-generated via text-to-3D prompts. Each prompt is carefully engineered in `prompt_builder.py` to produce architecturally coherent, stylistically distinct assets per civilization. |
| **Technical execution** | Async Python pipeline with retry logic, progress tracking, and manifest output. Three.js game with shader-based restoration transitions, procedural audio, and WebXR support. |
| **Gameplay / Experience** | A complete arc: explore → collect → restore → unlock. The Grand Reunion provides a meaningful emotional payoff and a definitive ending. |
| **Theme alignment** | The hackathon theme ("A Gift for ______") is the literal core of the game: the Gift you give is memory. Each civilization's name in the ending screen fills the blank. |

---

## 📜 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- **[Tripo AI](https://tripo3d.ai/)** — for providing the V3 text-to-3D API that makes this project's asset pipeline possible. The quality and speed of Tripo V3 generation is what makes a game like this achievable in a hackathon timeframe.
- **[Three.js](https://threejs.org/)** — the gold-standard WebGL framework that powers every polygon on screen. Thanks to the maintainers and the community for 15+ years of open-source 3D on the web.
- **The Tripothon S1 organisers** — for creating a challenge that pushes AI-generated content into playable, emotional experiences.

---

*Built with ❤️ for Tripothon S1 — September 2026*
