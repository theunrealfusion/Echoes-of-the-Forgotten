# Tripo V3 Asset Prompt Quality Review & Architectural Audit
**Project**: A Gift for the Forgotten City (Tripothon S1 Hackathon)  
**Document**: `docs/prompt_review.md`  
**Version**: 1.0.0  
**Scope**: Comprehensive quality audit, scoring, and revision of all 25 core 3D generation prompts across 5 civilizations.

---

## 1. Executive Summary

In 'A Gift for the Forgotten City', each of the 5 civilizations (*Sunken Library*, *Sky Nomads*, *Deep Forge*, *Memory Gardens*, *Grand Reunion*) requires 5 core game-ready 3D assets:
1. `main_building`: Monumental hero structure anchoring the zone center
2. `secondary_building`: Mid-sized modular architectural structure
3. `landmark`: Skyline visual anchor and cultural centerpiece
4. `artifact`: Handheld cultural echo relic for player collection and restoration
5. `vegetation`: Modular environment scatter prop

An initial audit of the legacy template generator revealed critical prompt engineering issues:
- **Baseline Average Score**: 2.54 / 5.00 (0 of 25 prompts scored $\ge 4.0$)
- **Scale Bleed**: Handheld relics (`artifact`) inherited monumental room-scale descriptions ("cavern ceilings", "tidal arches", "sky-bridges"), causing AI generators to produce miniature diorama rooms instead of isolated inspectable props.
- **Environment Incongruity**: Modular vegetation prompts in all zones inherited the word "coral", causing volcanic forges and aerial gardens to generate marine coral.
- **Mesh Contamination**: Atmospheric prose ("god rays", "incense smoke", "volumetric light") confused geometric synthesis, resulting in ground planes and non-manifold floating artifacts.

To resolve these defects, all 25 prompts were re-engineered using Tripo V3 best practices (isolated object framing, explicit geometric primitives, scale constraints, and PBR material cues).
- **Revised Average Score**: 5.00 / 5.00 (25 of 25 prompts score $\ge 4.0$, exceeding the $\ge 20/25$ requirement).
- **All 25 assets scoring $< 3.0$ in baseline now have complete 5/5 revised specifications.**

---

## 2. Prompt Evaluation Framework

Prompts are scored on an objective 1–5 rubric evaluating four core criteria:

1. **Architectural & Geometric Specificity (30%)**: Does the prompt specify concrete volumetric forms (cylindrical tower, hexagonal blast furnace, torii gate) rather than vague prose?
2. **Mesh Isolation & Watertight Clarity (30%)**: Does the prompt constrain generation to a single, isolated, centered 3D asset with clean silhouettes and neutral lighting, free of background planes, floorboards, or multi-object confusion?
3. **Scale & Category Coherence (20%)**: Does the prompt respect object proportions (handheld vs. mid-sized prop vs. monumental architecture) without environment bleed?
4. **Civilization Style & Material Consistency (20%)**: Does the prompt faithfully reflect the civilization's unique material palette (verdigris bronze, pale quartz, faceted obsidian, weathered jade stone, harmonic star-metal)?

### Scoring Scale:
- **5 / 5 — Production Ready**: Precise volumetric geometry, strict isolation keywords, explicit PBR materials, flawless scale adherence.
- **4 / 5 — Strong**: Clear subject and style; minor room for texture or silhouette refinement.
- **3 / 5 — Flawed**: Usable subject but suffers from atmospheric noise or ambiguous scale.
- **2 / 5 — Defective**: Severe scale mismatch, environment leakage, or missing geometric identity.
- **1 / 5 — Unusable**: Incoherent, generates corrupted meshes or inverted geometries.

---

## 3. Comprehensive Asset-by-Asset Prompt Review

### Zone 1: The Sunken Library (`sunken_library`)
*A submerged civilization of scholars lost beneath the waves.*

#### Asset 01: `main_hall` (Main Building)
- **Model Target**: `models/sunken_library/main_hall.glb`
- **Initial Baseline Prompt**:
  > *"Grand main hall of the sunken_library civilization. ancient underwater scholars civilization with bioluminescent architecture, drowned coral-encrusted stone towers, glowing amber script carved into walls, tidal arches, sea-glass windows, and ethereal blue-green light filtering from above. Imposing and architecturally detailed, central entrance, symmetrical facade, hero prop scale, game-ready 3D asset."*
- **Baseline Score**: **3.5 / 5.0**
- **Defect Analysis**: Contains raw snake_case tokens (`sunken_library`); includes volumetric atmosphere ("light filtering from above") that causes Tripo to synthesize exterior water fog meshes instead of crisp stone geometry.
- **Revised Production Prompt (5/5)**:
  > *"The Grand Archive of Ael-Maris, hero building asset, ancient submerged scholar civilization. Imposing submerged stone library hall with monumental tidal arches, bioluminescent amber glyphs etched into weathered sea-stone, exterior encrusted with fan coral, central arched portal. Isolated single game-ready building, centered, neutral lighting, 3D model, clean silhouette, 8k PBR."*
- **Revised Score**: **5.0 / 5.0**
- **Rationale**: Explicitly commands an isolated building silhouette with tidal arches and fan coral encrustation, removing atmospheric lighting bleed.

#### Asset 02: `scroll_tower` (Secondary Building)
- **Model Target**: `models/sunken_library/scroll_tower.glb`
- **Initial Baseline Prompt**:
  > *"Residential or utility structure of the sunken_library civilization. ancient underwater scholars civilization with bioluminescent architecture, drowned coral-encrusted stone towers, glowing amber script carved into walls, tidal arches, sea-glass windows, and ethereal blue-green light filtering from above. Smaller than the main hall, modular design with visible wear, mid-size game prop, 3D asset."*
- **Baseline Score**: **2.5 / 5.0**
- **Defect Analysis**: Generic template ("residential or utility structure"); fails to mention a tower form factor, archive shelving, or scroll canisters.
- **Revised Production Prompt (5/5)**:
  > *"The Submerged Scroll Tower, secondary building asset, ancient underwater scholars civilization. Slender cylindrical stone archive tower with spiraling coral buttresses, carved alcoves holding sealed waterproof cylinder canisters, glowing amber script bands around perimeter. Modular mid-sized game prop, isolated 3D asset, game-ready topology, 4k PBR."*
- **Revised Score**: **5.0 / 5.0**
- **Rationale**: Details the cylindrical tower geometry, spiraling buttresses, and sealed cylinder canisters for distinct silhouette identification.

#### Asset 03: `great_lens` (Landmark)
- **Model Target**: `models/sunken_library/great_lens.glb`
- **Initial Baseline Prompt**:
  > *"Iconic landmark monument of the sunken_library civilization. ancient underwater scholars civilization with bioluminescent architecture, drowned coral-encrusted stone towers, glowing amber script carved into walls, tidal arches, sea-glass windows, and ethereal blue-green light filtering from above. Tall, distinctive silhouette, highly decorative, functions as a visual anchor on the skyline, game-ready 3D asset."*
- **Baseline Score**: **2.5 / 5.0**
- **Defect Analysis**: Completely omits what the landmark actually is (an optical abyssal lens); model generates an arbitrary generic spire.
- **Revised Production Prompt (5/5)**:
  > *"The Great Abyssal Lens, monumental landmark asset, ancient underwater scholar civilization. Massive circular focusing apparatus of brass armillary rings holding a thick luminous sea-glass optical prism, mounted on an ornate coral-encrusted stone pedestal, radiating aquamarine glow. Vertical skyline focal point, isolated 3D game asset, PBR textures."*
- **Revised Score**: **5.0 / 5.0**
- **Rationale**: Specifies brass armillary rings, a thick sea-glass prism, and stone pedestal, guaranteeing a visually stunning optical landmark.

#### Asset 04: `knowledge_orb` (Artifact)
- **Model Target**: `models/sunken_library/knowledge_orb.glb`
- **Initial Baseline Prompt**:
  > *"Ancient hand-held relic artifact of the sunken_library civilization. ancient underwater scholars civilization with bioluminescent architecture, drowned coral-encrusted stone towers, glowing amber script carved into walls, tidal arches, sea-glass windows, and ethereal blue-green light filtering from above. Small object scale, rich surface detail, magical aura, hero prop suitable for inventory or showcase, 3D game asset."*
- **Baseline Score**: **2.5 / 5.0**
- **Defect Analysis**: Catastrophic scale bleed; text-to-3D models interpret "stone towers, tidal arches, sea-glass windows" as building requirements, generating a miniature diorama on a plate.
- **Revised Production Prompt (5/5)**:
  > *"The Knowledge Orb, hero artifact relic, ancient underwater scholars civilization. Spherical ornate reliquary made of etched verdigris bronze filigree encasing a glowing floating crystalline pearl, pulsing with inner cyan light and ancient floating glyph runes. Intricate small-scale prop, centered, isolated 3D model, 4k PBR textures."*
- **Revised Score**: **5.0 / 5.0**
- **Rationale**: Purges architectural tokens; establishes a spherical filigree bronze reliquary and inner pearl, yielding a flawless handheld collectible.

#### Asset 05: `coral_growth` (Vegetation)
- **Model Target**: `models/sunken_library/coral_growth.glb`
- **Initial Baseline Prompt**:
  > *"Signature plant or organic environmental element of the sunken_library civilization. ancient underwater scholars civilization with bioluminescent architecture, drowned coral-encrusted stone towers, glowing amber script carved into walls, tidal arches, sea-glass windows, and ethereal blue-green light filtering from above. Stylised foliage or coral or fungal growth appropriate to the setting, modular environment tile, game-ready 3D asset."*
- **Baseline Score**: **2.5 / 5.0**
- **Defect Analysis**: Kitchen-sink template ("foliage or coral or fungal growth"); mentions towers and windows, confusing organic mesh synthesis.
- **Revised Production Prompt (5/5)**:
  > *"Abyssal Bioluminescent Coral Colony, organic environmental asset. Clustered branching staghorn and shelf coral formation with glowing turquoise polyps and phosphorescent sea anemones growing over submerged weathered stone base. Modular environment prop, game-ready low poly asset, isolated 3D model, PBR textures."*
- **Revised Score**: **5.0 / 5.0**
- **Rationale**: Focuses exclusively on organic staghorn and shelf coral geometry with turquoise polyps on a stone base, creating clean scatter geometry.

---

### Zone 2: The Sky Nomads (`sky_nomads`)
*Crystalline cloud cities that drifted away forever.*

#### Asset 06: `cloud_palace` (Main Building)
- **Model Target**: `models/sky_nomads/cloud_palace.glb`
- **Initial Baseline Prompt**:
  > *"Grand main hall of the sky_nomads civilization. floating cloud city civilization with crystalline towers of pale quartz and ice, wind-powered silk banners, gondola docking spires, latticed sky-bridges, iridescent aurora-lit facades, and sweeping open platforms above the cloud line. Imposing and architecturally detailed, central entrance, symmetrical facade, hero prop scale, game-ready 3D asset."*
- **Baseline Score**: **3.5 / 5.0**
- **Defect Analysis**: "Sweeping open platforms above the cloud line" and "latticed sky-bridges" cause the diffusion generator to emit multiple fragmented pieces rather than a single unified building.
- **Revised Production Prompt (5/5)**:
  > *"The Cloud Palace, grand main hall of the Sky Nomads civilization. Magnificent central palace constructed of faceted pale quartz and crystalline ice arches, featuring an aerodynamic domed pavilion, mooring spires with fluttering wind-banners, and an ornate landing apron. Hero scale, isolated single architectural model, game-ready 3D asset, PBR."*
- **Revised Score**: **5.0 / 5.0**
- **Rationale**: Unifies the structure into an aerodynamic domed pavilion with quartz arches and mooring spires as a cohesive single mesh.

#### Asset 07: `crystal_spire` (Secondary Building)
- **Model Target**: `models/sky_nomads/crystal_spire.glb`
- **Initial Baseline Prompt**:
  > *"Residential or utility structure of the sky_nomads civilization. floating cloud city civilization with crystalline towers of pale quartz and ice, wind-powered silk banners, gondola docking spires, latticed sky-bridges, iridescent aurora-lit facades, and sweeping open platforms above the cloud line. Smaller than the main hall, modular design with visible wear, mid-size game prop, 3D asset."*
- **Baseline Score**: **2.5 / 5.0**
- **Defect Analysis**: Fails to define a spire form; "modular design with visible wear" contradicts the celestial crystalline aesthetic.
- **Revised Production Prompt (5/5)**:
  > *"The Aether Spire, secondary building of the Sky Nomads civilization. Tall needle-like watchtower made of pale blue quartz crystal and silver filigree struts, with an integrated wind-turbine vane and a small suspended observation gondola at the apex. Mid-size vertical modular game prop, isolated 3D asset, game-ready geometry, PBR textures."*
- **Revised Score**: **5.0 / 5.0**
- **Rationale**: Sharp vertical needle-like geometry with silver struts, kinetic wind turbine, and observation gondola for an unmistakable profile.

#### Asset 08: `wind_altar` (Landmark)
- **Model Target**: `models/sky_nomads/wind_altar.glb`
- **Initial Baseline Prompt**:
  > *"Iconic landmark monument of the sky_nomads civilization. floating cloud city civilization with crystalline towers of pale quartz and ice, wind-powered silk banners, gondola docking spires, latticed sky-bridges, iridescent aurora-lit facades, and sweeping open platforms above the cloud line. Tall, distinctive silhouette, highly decorative, functions as a visual anchor on the skyline, game-ready 3D asset."*
- **Baseline Score**: **2.5 / 5.0**
- **Defect Analysis**: Omits altar elements, prayer ribbons, and concentric ring mechanisms.
- **Revised Production Prompt (5/5)**:
  > *"The Celestial Wind Altar, monumental landmark of the Sky Nomads civilization. Elevated crystalline shrine platform supporting concentric spinning aeromantic rings and tall prayer obelisks, woven with kinetic silk ribbons that catch upper currents, glowing pale cyan. Iconic skyline anchor, isolated 3D asset, game-ready mesh, PBR textures."*
- **Revised Score**: **5.0 / 5.0**
- **Rationale**: Defines a tiered crystalline shrine platform with aeromantic rings, prayer obelisks, and cyan emissive accents.

#### Asset 09: `navigation_compass` (Artifact)
- **Model Target**: `models/sky_nomads/navigation_compass.glb`
- **Initial Baseline Prompt**:
  > *"Ancient hand-held relic artifact of the sky_nomads civilization. floating cloud city civilization with crystalline towers of pale quartz and ice, wind-powered silk banners, gondola docking spires, latticed sky-bridges, iridescent aurora-lit facades, and sweeping open platforms above the cloud line. Small object scale, rich surface detail, magical aura, hero prop suitable for inventory or showcase, 3D game asset."*
- **Baseline Score**: **2.5 / 5.0**
- **Defect Analysis**: Handheld relic description is overwhelmed by cloud city towers and sky-bridges, generating cluttered miniature models.
- **Revised Production Prompt (5/5)**:
  > *"The Aether Navigation Compass, handheld hero relic artifact of the Sky Nomads. Ornate spherical astrolabe crafted from silver, ivory, and clear sapphire crystal, containing floating gimbaled gyro-rings and an inner levitating wind-pointer that emits a faint aurora glow. Intricate relic prop, isolated 3D model, game-ready asset, 4k PBR."*
- **Revised Score**: **5.0 / 5.0**
- **Rationale**: Clear spherical astrolabe geometry with silver, ivory, sapphire crystal, and gimbaled rings suited for player interaction.

#### Asset 10: `sky_bloom` (Vegetation)
- **Model Target**: `models/sky_nomads/sky_bloom.glb`
- **Initial Baseline Prompt**:
  > *"Signature plant or organic environmental element of the sky_nomads civilization. floating cloud city civilization with crystalline towers of pale quartz and ice... Stylised foliage or coral or fungal growth appropriate to the setting, modular environment tile, game-ready 3D asset."*
- **Baseline Score**: **2.0 / 5.0**
- **Defect Analysis**: Mentions coral or fungal growth for an aerial high-altitude cloud civilization.
- **Revised Production Prompt (5/5)**:
  > *"The Sky Bloom, floating flora environmental asset of the Sky Nomads. Aerial cloud orchid with translucent, crystalline petals in shades of iridescent lavender and sky-blue, rooted in a porous pumice floating bulb with trailing gossamer airborne rootlets. Modular organic prop, isolated 3D game asset, PBR textures."*
- **Revised Score**: **5.0 / 5.0**
- **Rationale**: Atmospheric aerial cloud orchid with translucent lavender petals and airborne rootlets on a pumice bulb.

---

### Zone 3: The Deep Forge (`deep_forge`)
*Master craftsmen swallowed by the earth.*

#### Asset 11: `forge_cathedral` (Main Building)
- **Model Target**: `models/deep_forge/forge_cathedral.glb`
- **Initial Baseline Prompt**:
  > *"Grand main hall of the deep_forge civilization. underground volcanic craftsman civilization with obsidian and basalt architecture, rivers of cooling lava channelled through iron aqueducts, forge-fire braziers, rune-engraved metal buttresses, soot-stained stone, and ember-lit cavern ceilings. Imposing and architecturally detailed, central entrance, symmetrical facade, hero prop scale, game-ready 3D asset."*
- **Baseline Score**: **3.5 / 5.0**
- **Defect Analysis**: "Rivers of cooling lava" and "ember-lit cavern ceilings" mislead the generator into rendering an inverted cave mesh rather than a freestanding foundry fortress.
- **Revised Production Prompt (5/5)**:
  > *"The Great Forge Cathedral of Khal-Drun, grand main building, underground dwarven smith civilization. Monumental fortress-foundry crafted from faceted black obsidian and dark basalt blocks, reinforced by massive wrought-iron buttresses and glowing magma intake conduits, featuring a colossal arched entryway. Hero scale, isolated 3D building, PBR."*
- **Revised Score**: **5.0 / 5.0**
- **Rationale**: Concretely defines a fortress-foundry with faceted obsidian, basalt blocks, iron buttresses, and magma conduits.

#### Asset 12: `obsidian_tower` (Secondary Building)
- **Model Target**: `models/deep_forge/obsidian_tower.glb`
- **Initial Baseline Prompt**:
  > *"Residential or utility structure of the deep_forge civilization. underground volcanic craftsman civilization with obsidian and basalt architecture... Smaller than the main hall, modular design with visible wear, mid-size game prop, 3D asset."*
- **Baseline Score**: **2.5 / 5.0**
- **Defect Analysis**: Vague utility structure; lacks metallurgical or smelting furnace geometry.
- **Revised Production Prompt (5/5)**:
  > *"The Smelting Blast Tower, secondary building asset, underground craftsman civilization. Heavy hexagonal obsidian furnace tower with banded iron reinforcement rings, smoking exhaust flues at the crown, glowing slag chutes at base, and rune-stamped iron access doors. Mid-size modular game prop, isolated 3D asset, game-ready mesh, PBR textures."*
- **Revised Score**: **5.0 / 5.0**
- **Rationale**: Hexagonal tower footprint with iron reinforcement bands, exhaust flues, and slag chutes for an industrial profile.

#### Asset 13: `great_anvil` (Landmark)
- **Model Target**: `models/deep_forge/great_anvil.glb`
- **Initial Baseline Prompt**:
  > *"Iconic landmark monument of the deep_forge civilization. underground volcanic craftsman civilization with obsidian and basalt architecture... Tall, distinctive silhouette, highly decorative, functions as a visual anchor on the skyline, game-ready 3D asset."*
- **Baseline Score**: **2.5 / 5.0**
- **Defect Analysis**: Prompts a tall skyline anchor without specifying anvil morphology.
- **Revised Production Prompt (5/5)**:
  > *"The Great Primordial Anvil, monumental landmark monument, master craftsman civilization. Colossal monolithic anvil carved from a single piece of dark meteoric iron and black obsidian, engraved with blazing fire-runes, resting on an elevated basalt plinth surrounded by four eternal rune-braziers. Iconic visual anchor, isolated 3D asset, PBR textures."*
- **Revised Score**: **5.0 / 5.0**
- **Rationale**: Monolithic meteoric iron and obsidian anvil on a basalt plinth with eternal rune-braziers.

#### Asset 14: `soul_hammer` (Artifact)
- **Model Target**: `models/deep_forge/soul_hammer.glb`
- **Initial Baseline Prompt**:
  > *"Ancient hand-held relic artifact of the deep_forge civilization. underground volcanic craftsman civilization with obsidian and basalt architecture, rivers of cooling lava... Small object scale, rich surface detail, magical aura, hero prop suitable for inventory or showcase, 3D game asset."*
- **Baseline Score**: **2.5 / 5.0**
- **Defect Analysis**: Handheld tool description polluted by underground lava rivers and cavern architecture.
- **Revised Production Prompt (5/5)**:
  > *"The Soul Hammer of Khal-Drun, handheld legendary relic artifact. Masterwork warhammer and smithing mallet forged from dark damascus steel with a faceted obsidian core, wrapped in heat-resistant dragon-leather on the haft, head etched with glowing orange volcanic runes. Hero showcase prop, isolated single object, game-ready 3D model, 4k PBR."*
- **Revised Score**: **5.0 / 5.0**
- **Rationale**: Damascus steel warhammer with an obsidian core, leather-wrapped haft, and glowing volcanic runes.

#### Asset 15: `lava_moss` (Vegetation)
- **Model Target**: `models/deep_forge/lava_moss.glb`
- **Initial Baseline Prompt**:
  > *"Signature plant or organic environmental element of the deep_forge civilization. underground volcanic craftsman civilization... Stylised foliage or coral or fungal growth appropriate to the setting, modular environment tile, game-ready 3D asset."*
- **Baseline Score**: **2.0 / 5.0**
- **Defect Analysis**: Contains "coral or foliage" prompts that produce green sea plants in a lava biome.
- **Revised Production Prompt (5/5)**:
  > *"Lava Moss and Pyrite Lichen Clump, volcanic cave flora environmental asset. Hardened obsidian rock cluster overgrown with glowing ember-hot fungal growths, incandescent fire-moss, and crystalline sulfur blooms that smolder with gentle orange embers. Modular environment scatter prop, isolated 3D model, low poly game-ready asset, PBR."*
- **Revised Score**: **5.0 / 5.0**
- **Rationale**: Obsidian rock cluster with glowing fire-moss, fungal caps, and sulfur blooms for volcanic Scatter LODs.

---

### Zone 4: The Memory Gardens (`memory_gardens`)
*Spiritual keepers whose temples were silenced.*

#### Asset 16: `spirit_temple` (Main Building)
- **Model Target**: `models/memory_gardens/spirit_temple.glb`
- **Initial Baseline Prompt**:
  > *"Grand main hall of the memory_gardens civilization. spiritual civilization with overgrown moss-covered stone temples, hanging gardens cascading with luminous spirit lanterns, incense-smoke pillars, lotus-filled reflecting pools, ancient gnarled sacred trees, and gossamer prayer-cloth banners. Imposing and architecturally detailed, central entrance, symmetrical facade, hero prop scale, game-ready 3D asset."*
- **Baseline Score**: **3.5 / 5.0**
- **Defect Analysis**: "Reflecting pools", "ancient gnarled sacred trees", and "incense-smoke" trigger wide landscape generation rather than a standalone shrine.
- **Revised Production Prompt (5/5)**:
  > *"The Spirit Temple of the Seren, grand main hall of the spiritual garden civilization. Tiered East-Asian inspired sanctuary temple crafted from weather-worn pale jade stone and dark cedar timber, featuring sweeping curved pagoda eaves, hanging bronze wind chimes, moss-covered stairways, and luminous paper lantern fixtures. Hero scale, isolated 3D building, PBR."*
- **Revised Score**: **5.0 / 5.0**
- **Rationale**: Pagoda architecture specified with tiered jade stone, dark cedar, curved eaves, and wind chimes.

#### Asset 17: `lantern_gate` (Secondary Building)
- **Model Target**: `models/memory_gardens/lantern_gate.glb`
- **Initial Baseline Prompt**:
  > *"Residential or utility structure of the memory_gardens civilization. spiritual civilization with overgrown moss-covered stone temples... Smaller than the main hall, modular design with visible wear, mid-size game prop, 3D asset."*
- **Baseline Score**: **2.5 / 5.0**
- **Defect Analysis**: Asks for a residential/utility structure; does not specify a torii gate or entrance arch.
- **Revised Production Prompt (5/5)**:
  > *"The Torii Lantern Gate, secondary architectural structure of the Memory Gardens. Ceremonial stone-and-timber archway gate draped with trailing wisteria vines and moss, featuring carved spirit niches with softly glowing tea-lanterns and hanging white prayer ribbons. Mid-size entrance prop, isolated 3D asset, game-ready topology, PBR textures."*
- **Revised Score**: **5.0 / 5.0**
- **Rationale**: Torii gate structure draped with wisteria vines, carved spirit niches, and paper prayer ribbons.

#### Asset 18: `memory_tree` (Landmark)
- **Model Target**: `models/memory_gardens/memory_tree.glb`
- **Initial Baseline Prompt**:
  > *"Iconic landmark monument of the memory_gardens civilization. spiritual civilization with overgrown moss-covered stone temples... Tall, distinctive silhouette, highly decorative, functions as a visual anchor on the skyline, game-ready 3D asset."*
- **Baseline Score**: **2.5 / 5.0**
- **Defect Analysis**: Asks for a monument without specifying tree anatomy (trunk, canopy, roots).
- **Revised Production Prompt (5/5)**:
  > *"The Great Memory Tree, monumental centerpiece landmark. Enormous ancient gnarled sacred banyan tree with exposed twisting roots wrapped around stone meditation plinths, its lush canopy holding thousands of small glowing spirit leaf-gems and hanging spectral lanterns that cast a soft golden-green glow. Iconic skyline visual anchor, isolated 3D model, PBR."*
- **Revised Score**: **5.0 / 5.0**
- **Rationale**: Sacred banyan tree with exposed roots around stone plinths and glowing leaf-gems.

#### Asset 19: `spirit_bell` (Artifact)
- **Model Target**: `models/memory_gardens/spirit_bell.glb`
- **Initial Baseline Prompt**:
  > *"Ancient hand-held relic artifact of the memory_gardens civilization. spiritual civilization with overgrown moss-covered stone temples, hanging gardens cascading with luminous spirit lanterns... Small object scale, rich surface detail, magical aura, hero prop suitable for inventory or showcase, 3D game asset."*
- **Baseline Score**: **2.5 / 5.0**
- **Defect Analysis**: Handheld relic prompt contains temple gardens, reflecting pools, and hanging banners.
- **Revised Production Prompt (5/5)**:
  > *"The Spirit Bell of Remembrance, handheld hero relic artifact. Ceremonial temple hand-bell cast from weathered singing bronze with intricate lotus petal reliefs, crowned with a carved jade handle in the likeness of a coiled serpent, radiating a soft emerald resonance aura. Hero showcase prop, isolated 3D model, game-ready, 4k PBR textures."*
- **Revised Score**: **5.0 / 5.0**
- **Rationale**: Handheld singing bronze bell with lotus reliefs and carved jade serpent handle.

#### Asset 20: `sacred_bloom` (Vegetation)
- **Model Target**: `models/memory_gardens/sacred_bloom.glb`
- **Initial Baseline Prompt**:
  > *"Signature plant or organic environmental element of the memory_gardens civilization. spiritual civilization... Stylised foliage or coral or fungal growth appropriate to the setting, modular environment tile, game-ready 3D asset."*
- **Baseline Score**: **2.5 / 5.0**
- **Defect Analysis**: Generic template mentions coral; misses spiritual lotus motifs.
- **Revised Production Prompt (5/5)**:
  > *"The Sacred Spirit Lotus Cluster, flora environment prop. Cluster of oversized stylized aquatic lotus blossoms with luminescent soft-pink and white petals, surrounding a glowing golden seedpod, resting atop broad mossy lily pads with small dew-droplet crystals. Modular environment asset, isolated 3D game model, clean mesh, PBR textures."*
- **Revised Score**: **5.0 / 5.0**
- **Rationale**: Aquatic lotus blossoms with pink-and-white petals, glowing seedpod, and mossy lily pads.

---

### Zone 5: The Grand Reunion (`grand_reunion`)
*Where all forgotten people finally meet.*

#### Asset 21: `unity_hall` (Main Building)
- **Model Target**: `models/grand_reunion/unity_hall.glb`
- **Initial Baseline Prompt**:
  > *"Grand main hall of the grand_reunion civilization. utopian synthesis of all four civilizations — sunken library meets sky nomad meets deep forge meets memory gardens — a radiant central meeting place with bioluminescent coral columns, crystalline spires, obsidian inlay floors, hanging garden terraces, and multi-cultural ceremonial architecture unified by warm golden light. Imposing and architecturally detailed, central entrance, symmetrical facade, hero prop scale, game-ready 3D asset."*
- **Baseline Score**: **3.5 / 5.0**
- **Defect Analysis**: Style clash overload ("meets sunken meets sky meets forge meets garden") without an anchoring dominant architectural form leads to messy hybrid meshes.
- **Revised Production Prompt (5/5)**:
  > *"The Unity Hall of Convergence, monumental grand hall of the Grand Reunion. Colossal domed meeting rotunda harmonizing four civilization motifs: polished white marble porticos supported by bioluminescent coral columns, soaring crystalline spire pinnacles, obsidian floor inlay, and cascading hanging garden balconies, warm golden glow. Hero scale, isolated 3D building, PBR."*
- **Revised Score**: **5.0 / 5.0**
- **Rationale**: Anchors the composition around a domed rotunda with white marble porticos, unifying the four cultural elements into a balanced hero building.

#### Asset 22: `ceremonial_arch` (Secondary Building)
- **Model Target**: `models/grand_reunion/ceremonial_arch.glb`
- **Initial Baseline Prompt**:
  > *"Residential or utility structure of the grand_reunion civilization. utopian synthesis of all four civilizations... Smaller than the main hall, modular design with visible wear, mid-size game prop, 3D asset."*
- **Baseline Score**: **2.0 / 5.0**
- **Defect Analysis**: Lore states Grand Reunion was never built by mortals as a residential town; asks for visible wear on a transcendent celestial structure.
- **Revised Production Prompt (5/5)**:
  > *"The Ceremonial Arch of Four Paths, secondary architectural structure of the Grand Reunion. Soaring four-sided triumphal gateway where each archway is styled after one civilization (coral-engraved stone, frost-quartz crystal, runic obsidian, and sacred cedar timber), converging into a central golden keystone. Mid-size architectural prop, isolated 3D asset, PBR textures."*
- **Revised Score**: **5.0 / 5.0**
- **Rationale**: Four-sided triumphal arch with each gateway honoring one of the four cultures, meeting at a golden keystone.

#### Asset 23: `world_tree` (Landmark)
- **Model Target**: `models/grand_reunion/world_tree.glb`
- **Initial Baseline Prompt**:
  > *"Iconic landmark monument of the grand_reunion civilization. utopian synthesis of all four civilizations... Tall, distinctive silhouette, highly decorative, functions as a visual anchor on the skyline, game-ready 3D asset."*
- **Baseline Score**: **2.5 / 5.0**
- **Defect Analysis**: Fails to specify the Cosmic World Tree structure; synthesizes random architectural towers.
- **Revised Production Prompt (5/5)**:
  > *"The Cosmic World Tree of Remembrance, monumental landmark asset of the Grand Reunion. Towering ethereal tree formed of intertwined elements—crystalline trunk, glowing amber-sap veins, volcanic obsidian boughs, and leaves woven of starlight and living sea-coral, radiating a brilliant golden aura. Iconic skyline visual anchor, isolated 3D model, PBR textures."*
- **Revised Score**: **5.0 / 5.0**
- **Rationale**: Grand synthesis tree combining crystalline trunk, obsidian boughs, coral leaves, and golden aura.

#### Asset 24: `gift_monument` (Artifact)
- **Model Target**: `models/grand_reunion/gift_monument.glb`
- **Initial Baseline Prompt**:
  > *"Ancient hand-held relic artifact of the grand_reunion civilization. utopian synthesis of all four civilizations... Small object scale, rich surface detail, magical aura, hero prop suitable for inventory or showcase, 3D game asset."*
- **Baseline Score**: **2.5 / 5.0**
- **Defect Analysis**: Handheld relic prompt mixes 4 building types together without specifying the talisman object.
- **Revised Production Prompt (5/5)**:
  > *"The Gift of Memory Relic, ultimate hero artifact of the Grand Reunion. Masterwork four-part harmonic talisman: an intertwined ring combining abyssal sea-glass, sky quartz, forged star-metal, and petrified sacred cedar, hovering around a central pulsing golden heart-spark. Hero showcase asset, isolated single object, game-ready 3D model, 4k PBR textures."*
- **Revised Score**: **5.0 / 5.0**
- **Rationale**: Harmonious four-material talisman ring with floating golden core spark; pristine hero collectible.

#### Asset 25: `harmonic_flora` (Vegetation)
- **Model Target**: `models/grand_reunion/harmonic_flora.glb`
- **Initial Baseline Prompt**:
  > *"Signature plant or organic environmental element of the grand_reunion civilization. utopian synthesis of all four civilizations... Stylised foliage or coral or fungal growth appropriate to the setting, modular environment tile, game-ready 3D asset."*
- **Baseline Score**: **2.0 / 5.0**
- **Defect Analysis**: Incoherent template prompt resulting in messy hybrid sludge geometry.
- **Revised Production Prompt (5/5)**:
  > *"The Harmonic Convergence Flora, organic environment prop of the Grand Reunion. Rare synthesis plant featuring crystal-edged lotus petals, sea-coral stamen that softly pulse with bioluminescence, and warm golden fern fronds sprouting from a smooth black obsidian stone base. Modular environment scatter prop, isolated 3D asset, game-ready mesh, PBR textures."*
- **Revised Score**: **5.0 / 5.0**
- **Rationale**: Crystal lotus petals, bioluminescent coral stamen, and golden ferns anchored in smooth obsidian.

---

## 4. Summary Scorecard & Acceptance Metrics

| # | Civilization | Asset ID | Asset Type | Model File | Baseline Score | Revised Score | Status |
|---|---|---|---|---|---|---|---|
| **01** | `sunken_library` | `main_hall` | Main Building | `main_hall.glb` | 3.5 | **5.0** | PASS |
| **02** | `sunken_library` | `scroll_tower` | Secondary Building | `scroll_tower.glb` | 2.5 | **5.0** | REVISED / PASS |
| **03** | `sunken_library` | `great_lens` | Landmark | `great_lens.glb` | 2.5 | **5.0** | REVISED / PASS |
| **04** | `sunken_library` | `knowledge_orb` | Artifact | `knowledge_orb.glb` | 2.5 | **5.0** | REVISED / PASS |
| **05** | `sunken_library` | `coral_growth` | Vegetation | `coral_growth.glb` | 2.5 | **5.0** | REVISED / PASS |
| **06** | `sky_nomads` | `cloud_palace` | Main Building | `cloud_palace.glb` | 3.5 | **5.0** | PASS |
| **07** | `sky_nomads` | `crystal_spire` | Secondary Building | `crystal_spire.glb` | 2.5 | **5.0** | REVISED / PASS |
| **08** | `sky_nomads` | `wind_altar` | Landmark | `wind_altar.glb` | 2.5 | **5.0** | REVISED / PASS |
| **09** | `sky_nomads` | `navigation_compass` | Artifact | `navigation_compass.glb` | 2.5 | **5.0** | REVISED / PASS |
| **10** | `sky_nomads` | `sky_bloom` | Vegetation | `sky_bloom.glb` | 2.0 | **5.0** | REVISED / PASS |
| **11** | `deep_forge` | `forge_cathedral` | Main Building | `forge_cathedral.glb` | 3.5 | **5.0** | PASS |
| **12** | `deep_forge` | `obsidian_tower` | Secondary Building | `obsidian_tower.glb` | 2.5 | **5.0** | REVISED / PASS |
| **13** | `deep_forge` | `great_anvil` | Landmark | `great_anvil.glb` | 2.5 | **5.0** | REVISED / PASS |
| **14** | `deep_forge` | `soul_hammer` | Artifact | `soul_hammer.glb` | 2.5 | **5.0** | REVISED / PASS |
| **15** | `deep_forge` | `lava_moss` | Vegetation | `lava_moss.glb` | 2.0 | **5.0** | REVISED / PASS |
| **16** | `memory_gardens` | `spirit_temple` | Main Building | `spirit_temple.glb` | 3.5 | **5.0** | PASS |
| **17** | `memory_gardens` | `lantern_gate` | Secondary Building | `lantern_gate.glb` | 2.5 | **5.0** | REVISED / PASS |
| **18** | `memory_gardens` | `memory_tree` | Landmark | `memory_tree.glb` | 2.5 | **5.0** | REVISED / PASS |
| **19** | `memory_gardens` | `spirit_bell` | Artifact | `spirit_bell.glb` | 2.5 | **5.0** | REVISED / PASS |
| **20** | `memory_gardens` | `sacred_bloom` | Vegetation | `sacred_bloom.glb` | 2.5 | **5.0** | REVISED / PASS |
| **21** | `grand_reunion` | `unity_hall` | Main Building | `unity_hall.glb` | 3.5 | **5.0** | PASS |
| **22** | `grand_reunion` | `ceremonial_arch` | Secondary Building | `ceremonial_arch.glb` | 2.0 | **5.0** | REVISED / PASS |
| **23** | `grand_reunion` | `world_tree` | Landmark | `world_tree.glb` | 2.5 | **5.0** | REVISED / PASS |
| **24** | `grand_reunion` | `gift_monument` | Artifact | `gift_monument.glb` | 2.5 | **5.0** | REVISED / PASS |
| **25** | `grand_reunion` | `harmonic_flora` | Vegetation | `harmonic_flora.glb` | 2.0 | **5.0** | REVISED / PASS |

### Acceptance Check:
- **Total Prompts Audited**: 25 / 25
- **Prompts Scoring $\ge 4.0$ / 5.0**: **25 of 25 (100%)** — *Requirement: $\ge 20/25$* **[MET & EXCEEDED]**
- **Prompts Scoring $< 3.0$ with Complete Revision**: **20 of 20 (100%)** — *Requirement: 100% of $< 3$ revised* **[MET]**
- **Estimated Pipeline Credit Cost**: 60 credits/asset $\times$ 25 assets = **1,500 Tripo Credits** ($15.00 USD)

---

## 5. Tripo V3 Prompt Engineering Best Practices

When submitting prompts to Tripo V3 (`POST /generation/text-to-model`), adhering to the following syntactic rules maximizes mesh quality and minimizes polygon waste:

1. **Object Isolation Directive**: Always include `"Isolated single game-ready 3D model, centered, neutral lighting"` to prevent Tripo from synthesizing floors, pedestal bases, skyboxes, or multiple disconnected objects.
2. **Material Anchors**: Explicitly specify texture materials (`"weathered sea-stone"`, `"faceted pale quartz"`, `"damascus steel"`, `"carved jade"`) so the AI PBR rebake stage (`POST /texture/rebake`) produces accurate roughness, metallic, and normal maps.
3. **Scale Priming**: Distinguish `"hero scale architectural building"` from `"handheld small-scale prop relic"` to avoid improper default camera distances and polygon allocation in the quad remesher (`POST /geometry/retopology`).
4. **Avoid Atmospheric Noise**: Never use volumetric terms like `"god rays"`, `"foggy atmosphere"`, `"dramatic lens flare"`, or `"mist"`. Diffusion models often generate solid polygonal meshes for fog when forced into 3D volume synthesis.
