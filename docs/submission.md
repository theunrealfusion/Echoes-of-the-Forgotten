# A Gift for the Forgotten City — Tripothon S1 Submission

## Project Overview
A Gift for the Forgotten City is an atmospheric 3D exploration and cultural restoration experience built for web browsers and WebXR headsets. Players embody The Rememberer, a wanderer navigating a fractured, monochromatic void where four ancient civilizations vanished because their stories were forgotten. By discovering scattered cultural Echoes, players trigger real-time shader transitions that restore color, architecture, and procedural music, culminating in an unlockable fifth sanctuary—The Grand Reunion—where representatives of all four peoples converge in celebration.

## Judging Criteria Coverage

### Creativity (30%)
Instead of conventional combat or resource grinding, our experience reimagines gameplay as poetic archaeological restoration. The contrast between desaturated void architecture and radiant bioluminescent life forms a dynamic narrative canvas driven directly by player discovery. Each civilization expresses a distinct visual dialect, ranging from submerged coral archives to floating sky spires, proving how generative 3D pipelines build emotional fantasy universes.

### Completeness (25%)
The project represents a finished, standalone browser game featuring zero server overhead and instant execution via Three.js. Players experience a complete narrative arc across five modeled zones, complete with procedural fallback geometry, responsive mobile touch controls with virtual joysticks, and dynamic soundscapes synthesized in real time via the Web Audio API. Every system—from zone loading and collision detection to echo triggers and full restoration transitions—is thoroughly tested and immediately playable.

### Theme Fit (20%)
Responding directly to the hackathon prompt "A Gift for ______", our project establishes that the purest gift one can offer to those erased by history is remembrance. Players do not plunder ancient ruins for personal gain; instead, they serve as custodians of memory, returning identity to each erased culture. This premise culminates at The Grand Reunion, where all restored peoples unite to celebrate the gift of enduring memory.

### Viral Potential (15%)
The game features an arresting transformation mechanic where desaturated grey worlds dynamically burst into vibrant color, volumetric rays, and floating light particles. This dramatic before-and-after contrast provides a shareable hook engineered specifically for TikTok, Instagram Reels, and X feeds. Short fifteen-second transformation clips capture immediate viewer attention, driving high replay value and community sharing across game development channels.

### Commercial Value (10%)
Built upon open-standards WebGL and WebXR, this game proves that high-fidelity 3D worlds can deploy cost-effectively across billions of desktop, mobile, and VR browsers without app store friction. The automated asset generation and retopology pipeline serves as a commercial blueprint for rapid prototyping in indie studios, interactive exhibits, and brand activations, drastically lowering production expenditures while accelerating delivery.

## Tool Track
- **Tripo AI**: Serves as our 3D generative backbone through the Tripo V3 API. Tripo powered text-to-3D generation of all 25+ architectural landmarks and relics, followed by automated quad retopology to 5,000 polygon game-ready meshes, high-fidelity PBR texture rebaking, and automatic rigging with animation presets for character NPCs.
- **PICO**: Powers native virtual reality immersion through the WebXR Device API on PICO 4 and PICO Neo 3 headsets via the PICO Browser. The implementation provides responsive 6DoF head and hand-controller tracking, true scale appreciation, and spatialized audio, allowing players to physically walk through restored halls.
- **World Labs**: Utilized to generate panoramic spatial environment foundations, atmospheric skyboxes, and distant horizon geometry. These large-scale spatial representations frame each localized Three.js zone, establishing a breathtaking sense of monumental scale and ethereal isolation across the surrounding void.
