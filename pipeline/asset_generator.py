"""
pipeline/asset_generator.py
============================
High-level asset generation orchestrator for 'A Gift for the Forgotten City'.

This module wraps :class:`TripoClient` with game-design-aware logic: it knows
what assets each civilization needs, what prompts produce the best results, and
how to run the full optimization pipeline (retopo → PBR) transparently.

Python 3.9+ required.
"""

from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path
from typing import Optional

_repo_root = Path(__file__).resolve().parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

try:
    from .tripo_client import TripoClient, TripoAPIError, TripoTimeoutError
except (ImportError, ValueError):
    from pipeline.tripo_client import TripoClient, TripoAPIError, TripoTimeoutError

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Civilization style definitions
# ---------------------------------------------------------------------------

#: Pre-defined world-building style packs for the five civilizations
#: featured in 'A Gift for the Forgotten City'.
#:
#: Each entry maps a style key to a human-readable description that is
#: woven into every generation prompt to ensure aesthetic coherence.
CIVILIZATION_STYLES: dict[str, str] = {
    "sunken_library": (
        "ancient underwater scholars civilization with bioluminescent architecture, "
        "drowned coral-encrusted stone towers, glowing amber script carved into walls, "
        "tidal arches, sea-glass windows, and ethereal blue-green light filtering from above"
    ),
    "sky_nomads": (
        "floating cloud city civilization with crystalline towers of pale quartz and ice, "
        "wind-powered silk banners, gondola docking spires, latticed sky-bridges, "
        "iridescent aurora-lit facades, and sweeping open platforms above the cloud line"
    ),
    "deep_forge": (
        "underground volcanic craftsman civilization with obsidian and basalt architecture, "
        "rivers of cooling lava channelled through iron aqueducts, forge-fire braziers, "
        "rune-engraved metal buttresses, soot-stained stone, and ember-lit cavern ceilings"
    ),
    "memory_gardens": (
        "spiritual civilization with overgrown moss-covered stone temples, hanging gardens "
        "cascading with luminous spirit lanterns, incense-smoke pillars, lotus-filled reflecting "
        "pools, ancient gnarled sacred trees, and gossamer prayer-cloth banners"
    ),
    "grand_reunion": (
        "utopian synthesis of all four civilizations — sunken library meets sky nomad meets "
        "deep forge meets memory gardens — a radiant central meeting place with bioluminescent "
        "coral columns, crystalline spires, obsidian inlay floors, hanging garden terraces, "
        "and multi-cultural ceremonial architecture unified by warm golden light"
    ),
}

# Five core asset types generated for each civilization (total 25 game assets)
_ASSET_TYPES: list[str] = [
    "main_building",
    "secondary_building",
    "landmark",
    "artifact",
    "vegetation",
]

#: Complete specification and bespoke, architecturally distinct prompts for all 25
#: core assets across the five civilizations, optimized for Tripo V3 3D generation.
CIVILIZATION_ASSETS: dict[str, dict[str, dict]] = {
    "sunken_library": {
        "main_building": {
            "name": "main_hall",
            "title": "The Grand Archive of Ael-Maris",
            "prompt": (
                "The Grand Archive of Ael-Maris, hero building asset, ancient submerged scholar civilization. "
                "Imposing submerged stone library hall with monumental tidal arches, bioluminescent amber glyphs "
                "etched into weathered sea-stone, exterior encrusted with fan coral, central arched portal. "
                "Isolated single game-ready building, centered, neutral lighting, 3D model, clean silhouette, 8k PBR."
            ),
            "estimated_credits": {"text_to_3d": 30, "retopology": 20, "pbr": 10, "total": 60},
        },
        "secondary_building": {
            "name": "scroll_tower",
            "title": "The Submerged Scroll Tower",
            "prompt": (
                "The Submerged Scroll Tower, secondary building asset, ancient underwater scholars civilization. "
                "Slender cylindrical stone archive tower with spiraling coral buttresses, carved alcoves holding "
                "sealed waterproof cylinder canisters, glowing amber script bands around perimeter. "
                "Modular mid-sized game prop, isolated 3D asset, game-ready topology, 4k PBR."
            ),
            "estimated_credits": {"text_to_3d": 30, "retopology": 20, "pbr": 10, "total": 60},
        },
        "landmark": {
            "name": "great_lens",
            "title": "The Great Abyssal Lens",
            "prompt": (
                "The Great Abyssal Lens, monumental landmark asset, ancient underwater scholar civilization. "
                "Massive circular focusing apparatus of brass armillary rings holding a thick luminous sea-glass "
                "optical prism, mounted on an ornate coral-encrusted stone pedestal, radiating aquamarine glow. "
                "Vertical skyline focal point, isolated 3D game asset, PBR textures."
            ),
            "estimated_credits": {"text_to_3d": 30, "retopology": 20, "pbr": 10, "total": 60},
        },
        "artifact": {
            "name": "knowledge_orb",
            "title": "The Knowledge Orb",
            "prompt": (
                "The Knowledge Orb, hero artifact relic, ancient underwater scholars civilization. "
                "Spherical ornate reliquary made of etched verdigris bronze filigree encasing a glowing floating "
                "crystalline pearl, pulsing with inner cyan light and ancient floating glyph runes. "
                "Intricate small-scale prop, centered, isolated 3D model, 4k PBR textures."
            ),
            "estimated_credits": {"text_to_3d": 30, "retopology": 20, "pbr": 10, "total": 60},
        },
        "vegetation": {
            "name": "coral_growth",
            "title": "Abyssal Bioluminescent Coral Colony",
            "prompt": (
                "Abyssal Bioluminescent Coral Colony, organic environmental asset. "
                "Clustered branching staghorn and shelf coral formation with glowing turquoise polyps and phosphorescent "
                "sea anemones growing over submerged weathered stone base. "
                "Modular environment prop, game-ready low poly asset, isolated 3D model, PBR textures."
            ),
            "estimated_credits": {"text_to_3d": 30, "retopology": 20, "pbr": 10, "total": 60},
        },
    },
    "sky_nomads": {
        "main_building": {
            "name": "cloud_palace",
            "title": "The Cloud Palace",
            "prompt": (
                "The Cloud Palace, grand main hall of the Sky Nomads civilization. "
                "Magnificent central palace constructed of faceted pale quartz and crystalline ice arches, "
                "featuring an aerodynamic domed pavilion, mooring spires with fluttering wind-banners, "
                "and an ornate landing apron. Hero scale, isolated single architectural model, game-ready 3D asset, PBR."
            ),
            "estimated_credits": {"text_to_3d": 30, "retopology": 20, "pbr": 10, "total": 60},
        },
        "secondary_building": {
            "name": "crystal_spire",
            "title": "The Aether Spire",
            "prompt": (
                "The Aether Spire, secondary building of the Sky Nomads civilization. "
                "Tall needle-like watchtower made of pale blue quartz crystal and silver filigree struts, "
                "with an integrated wind-turbine vane and a small suspended observation gondola at the apex. "
                "Mid-size vertical modular game prop, isolated 3D asset, game-ready geometry, PBR textures."
            ),
            "estimated_credits": {"text_to_3d": 30, "retopology": 20, "pbr": 10, "total": 60},
        },
        "landmark": {
            "name": "wind_altar",
            "title": "The Celestial Wind Altar",
            "prompt": (
                "The Celestial Wind Altar, monumental landmark of the Sky Nomads civilization. "
                "Elevated crystalline shrine platform supporting concentric spinning aeromantic rings and "
                "tall prayer obelisks, woven with kinetic silk ribbons that catch upper currents, glowing pale cyan. "
                "Iconic skyline anchor, isolated 3D asset, game-ready mesh, PBR textures."
            ),
            "estimated_credits": {"text_to_3d": 30, "retopology": 20, "pbr": 10, "total": 60},
        },
        "artifact": {
            "name": "navigation_compass",
            "title": "The Aether Navigation Compass",
            "prompt": (
                "The Aether Navigation Compass, handheld hero relic artifact of the Sky Nomads. "
                "Ornate spherical astrolabe crafted from silver, ivory, and clear sapphire crystal, "
                "containing floating gimbaled gyro-rings and an inner levitating wind-pointer that emits a faint aurora glow. "
                "Intricate relic prop, isolated 3D model, game-ready asset, 4k PBR."
            ),
            "estimated_credits": {"text_to_3d": 30, "retopology": 20, "pbr": 10, "total": 60},
        },
        "vegetation": {
            "name": "sky_bloom",
            "title": "The Sky Bloom",
            "prompt": (
                "The Sky Bloom, floating flora environmental asset of the Sky Nomads. "
                "Aerial cloud orchid with translucent, crystalline petals in shades of iridescent lavender and sky-blue, "
                "rooted in a porous pumice floating bulb with trailing gossamer airborne rootlets. "
                "Modular organic prop, isolated 3D game asset, PBR textures."
            ),
            "estimated_credits": {"text_to_3d": 30, "retopology": 20, "pbr": 10, "total": 60},
        },
    },
    "deep_forge": {
        "main_building": {
            "name": "forge_cathedral",
            "title": "The Great Forge Cathedral of Khal-Drun",
            "prompt": (
                "The Great Forge Cathedral of Khal-Drun, grand main building, underground dwarven smith civilization. "
                "Monumental fortress-foundry crafted from faceted black obsidian and dark basalt blocks, "
                "reinforced by massive wrought-iron buttresses and glowing magma intake conduits, "
                "featuring a colossal arched entryway. Hero scale, isolated 3D building, PBR."
            ),
            "estimated_credits": {"text_to_3d": 30, "retopology": 20, "pbr": 10, "total": 60},
        },
        "secondary_building": {
            "name": "obsidian_tower",
            "title": "The Smelting Blast Tower",
            "prompt": (
                "The Smelting Blast Tower, secondary building asset, underground craftsman civilization. "
                "Heavy hexagonal obsidian furnace tower with banded iron reinforcement rings, smoking exhaust flues at the crown, "
                "glowing slag chutes at base, and rune-stamped iron access doors. "
                "Mid-size modular game prop, isolated 3D asset, game-ready mesh, PBR textures."
            ),
            "estimated_credits": {"text_to_3d": 30, "retopology": 20, "pbr": 10, "total": 60},
        },
        "landmark": {
            "name": "great_anvil",
            "title": "The Great Primordial Anvil",
            "prompt": (
                "The Great Primordial Anvil, monumental landmark monument, master craftsman civilization. "
                "Colossal monolithic anvil carved from a single piece of dark meteoric iron and black obsidian, "
                "engraved with blazing fire-runes, resting on an elevated basalt plinth surrounded by four eternal rune-braziers. "
                "Iconic visual anchor, isolated 3D asset, PBR textures."
            ),
            "estimated_credits": {"text_to_3d": 30, "retopology": 20, "pbr": 10, "total": 60},
        },
        "artifact": {
            "name": "soul_hammer",
            "title": "The Soul Hammer of Khal-Drun",
            "prompt": (
                "The Soul Hammer of Khal-Drun, handheld legendary relic artifact. "
                "Masterwork warhammer and smithing mallet forged from dark damascus steel with a faceted obsidian core, "
                "wrapped in heat-resistant dragon-leather on the haft, head etched with glowing orange volcanic runes. "
                "Hero showcase prop, isolated single object, game-ready 3D model, 4k PBR."
            ),
            "estimated_credits": {"text_to_3d": 30, "retopology": 20, "pbr": 10, "total": 60},
        },
        "vegetation": {
            "name": "lava_moss",
            "title": "Lava Moss and Pyrite Lichen Clump",
            "prompt": (
                "Lava Moss and Pyrite Lichen Clump, volcanic cave flora environmental asset. "
                "Hardened obsidian rock cluster overgrown with glowing ember-hot fungal growths, incandescent fire-moss, "
                "and crystalline sulfur blooms that smolder with gentle orange embers. "
                "Modular environment scatter prop, isolated 3D model, low poly game-ready asset, PBR."
            ),
            "estimated_credits": {"text_to_3d": 30, "retopology": 20, "pbr": 10, "total": 60},
        },
    },
    "memory_gardens": {
        "main_building": {
            "name": "spirit_temple",
            "title": "The Spirit Temple of the Seren",
            "prompt": (
                "The Spirit Temple of the Seren, grand main hall of the spiritual garden civilization. "
                "Tiered East-Asian inspired sanctuary temple crafted from weather-worn pale jade stone and dark cedar timber, "
                "featuring sweeping curved pagoda eaves, hanging bronze wind chimes, moss-covered stairways, "
                "and luminous paper lantern fixtures. Hero scale, isolated 3D building, PBR."
            ),
            "estimated_credits": {"text_to_3d": 30, "retopology": 20, "pbr": 10, "total": 60},
        },
        "secondary_building": {
            "name": "lantern_gate",
            "title": "The Torii Lantern Gate",
            "prompt": (
                "The Torii Lantern Gate, secondary architectural structure of the Memory Gardens. "
                "Ceremonial stone-and-timber archway gate draped with trailing wisteria vines and moss, "
                "featuring carved spirit niches with softly glowing tea-lanterns and hanging white prayer ribbons. "
                "Mid-size entrance prop, isolated 3D asset, game-ready topology, PBR textures."
            ),
            "estimated_credits": {"text_to_3d": 30, "retopology": 20, "pbr": 10, "total": 60},
        },
        "landmark": {
            "name": "memory_tree",
            "title": "The Great Memory Tree",
            "prompt": (
                "The Great Memory Tree, monumental centerpiece landmark. "
                "Enormous ancient gnarled sacred banyan tree with exposed twisting roots wrapped around stone meditation plinths, "
                "its lush canopy holding thousands of small glowing spirit leaf-gems and hanging spectral lanterns "
                "that cast a soft golden-green glow. Iconic skyline visual anchor, isolated 3D model, PBR."
            ),
            "estimated_credits": {"text_to_3d": 30, "retopology": 20, "pbr": 10, "total": 60},
        },
        "artifact": {
            "name": "spirit_bell",
            "title": "The Spirit Bell of Remembrance",
            "prompt": (
                "The Spirit Bell of Remembrance, handheld hero relic artifact. "
                "Ceremonial temple hand-bell cast from weathered singing bronze with intricate lotus petal reliefs, "
                "crowned with a carved jade handle in the likeness of a coiled serpent, radiating a soft emerald resonance aura. "
                "Hero showcase prop, isolated 3D model, game-ready, 4k PBR textures."
            ),
            "estimated_credits": {"text_to_3d": 30, "retopology": 20, "pbr": 10, "total": 60},
        },
        "vegetation": {
            "name": "sacred_bloom",
            "title": "The Sacred Spirit Lotus Cluster",
            "prompt": (
                "The Sacred Spirit Lotus Cluster, flora environment prop. "
                "Cluster of oversized stylized aquatic lotus blossoms with luminescent soft-pink and white petals, "
                "surrounding a glowing golden seedpod, resting atop broad mossy lily pads with small dew-droplet crystals. "
                "Modular environment asset, isolated 3D game model, clean mesh, PBR textures."
            ),
            "estimated_credits": {"text_to_3d": 30, "retopology": 20, "pbr": 10, "total": 60},
        },
    },
    "grand_reunion": {
        "main_building": {
            "name": "unity_hall",
            "title": "The Unity Hall of Convergence",
            "prompt": (
                "The Unity Hall of Convergence, monumental grand hall of the Grand Reunion. "
                "Colossal domed meeting rotunda harmonizing four civilization motifs: polished white marble porticos "
                "supported by bioluminescent coral columns, soaring crystalline spire pinnacles, obsidian floor inlay, "
                "and cascading hanging garden balconies, warm golden glow. Hero scale, isolated 3D building, PBR."
            ),
            "estimated_credits": {"text_to_3d": 30, "retopology": 20, "pbr": 10, "total": 60},
        },
        "secondary_building": {
            "name": "ceremonial_arch",
            "title": "The Ceremonial Arch of Four Paths",
            "prompt": (
                "The Ceremonial Arch of Four Paths, secondary architectural structure of the Grand Reunion. "
                "Soaring four-sided triumphal gateway where each archway is styled after one civilization "
                "(coral-engraved stone, frost-quartz crystal, runic obsidian, and sacred cedar timber), "
                "converging into a central golden keystone. Mid-size architectural prop, isolated 3D asset, PBR textures."
            ),
            "estimated_credits": {"text_to_3d": 30, "retopology": 20, "pbr": 10, "total": 60},
        },
        "landmark": {
            "name": "world_tree",
            "title": "The Cosmic World Tree of Remembrance",
            "prompt": (
                "The Cosmic World Tree of Remembrance, monumental landmark asset of the Grand Reunion. "
                "Towering ethereal tree formed of intertwined elements—crystalline trunk, glowing amber-sap veins, "
                "volcanic obsidian boughs, and leaves woven of starlight and living sea-coral, radiating a brilliant golden aura. "
                "Iconic skyline visual anchor, isolated 3D model, PBR textures."
            ),
            "estimated_credits": {"text_to_3d": 30, "retopology": 20, "pbr": 10, "total": 60},
        },
        "artifact": {
            "name": "gift_monument",
            "title": "The Gift of Memory Relic",
            "prompt": (
                "The Gift of Memory Relic, ultimate hero artifact of the Grand Reunion. "
                "Masterwork four-part harmonic talisman: an intertwined ring combining abyssal sea-glass, sky quartz, "
                "forged star-metal, and petrified sacred cedar, hovering around a central pulsing golden heart-spark. "
                "Hero showcase asset, isolated single object, game-ready 3D model, 4k PBR textures."
            ),
            "estimated_credits": {"text_to_3d": 30, "retopology": 20, "pbr": 10, "total": 60},
        },
        "vegetation": {
            "name": "harmonic_flora",
            "title": "The Harmonic Convergence Flora",
            "prompt": (
                "The Harmonic Convergence Flora, organic environment prop of the Grand Reunion. "
                "Rare synthesis plant featuring crystal-edged lotus petals, sea-coral stamen that softly pulse with bioluminescence, "
                "and warm golden fern fronds sprouting from a smooth black obsidian stone base. "
                "Modular environment scatter prop, isolated 3D asset, game-ready mesh, PBR textures."
            ),
            "estimated_credits": {"text_to_3d": 30, "retopology": 20, "pbr": 10, "total": 60},
        },
    },
}


# ---------------------------------------------------------------------------
# Asset generator
# ---------------------------------------------------------------------------


class ForgottenCityAssetGenerator:
    """Orchestrates multi-step 3D asset generation for 'A Gift for the Forgotten City'.

    Wraps :class:`~pipeline.tripo_client.TripoClient` to provide game-design
    aware helpers: civilization pack generation, NPC pipeline (rig + animate),
    concept-art-to-model conversion, and concurrent batch processing.

    Args:
        api_key: Tripo API key (typically read from ``TRIPO_API_KEY`` env var).
        output_dir: Root directory where generated ``.glb`` files are saved.
            Sub-folders are created per civilization and asset type.
    """

    def __init__(self, api_key: str, output_dir: str = "assets/models") -> None:
        self._api_key = api_key
        self.output_dir = Path(output_dir).expanduser().resolve()
        self.output_dir.mkdir(parents=True, exist_ok=True)
        # Client is instantiated fresh per major operation so that its session
        # lifecycle is tightly scoped; callers may also pass a shared client
        # via generate_* methods' optional ``client`` parameter in subclasses.
        logger.info("ForgottenCityAssetGenerator initialised — output dir: %s", self.output_dir)

    # ------------------------------------------------------------------
    # Civilization pack
    # ------------------------------------------------------------------

    async def generate_civilization_pack(
        self,
        civ_name: str,
        style_description: str,
    ) -> dict[str, str]:
        """Generate a complete set of 3D assets for one civilization.

        Runs the following asset types in parallel (up to API concurrency
        limits): ``main_building``, ``secondary_building``, ``landmark``,
        ``artifact``, ``vegetation``, ``creature``.

        Each asset goes through the full pipeline:
        text-to-3D → retopology → PBR texturing.

        Args:
            civ_name: Slug identifier for the civilization (e.g.
                ``'sunken_library'``).  Used as the output sub-folder name.
            style_description: Full prose description of the civilization's
                aesthetic, mixed into every generation prompt.

        Returns:
            A dict mapping each asset type key to the absolute path of the
            saved ``.glb`` file, e.g.::

                {
                    "main_building": "/…/sunken_library/main_building.glb",
                    "artifact": "/…/sunken_library/artifact.glb",
                    …
                }

        Raises:
            TripoAPIError: If any generation task fails.
            TripoTimeoutError: If any task exceeds its timeout.
        """
        logger.info("Generating civilization pack for: %s", civ_name)
        prompts = self._get_civilization_prompts(civ_name, style_description)
        civ_dir = self.output_dir / civ_name
        civ_dir.mkdir(parents=True, exist_ok=True)

        async with TripoClient(self._api_key) as client:
            tasks = {}
            for asset_type, prompt_text in prompts.items():
                model_name = asset_type
                if civ_name in CIVILIZATION_ASSETS and asset_type in CIVILIZATION_ASSETS[civ_name]:
                    model_name = CIVILIZATION_ASSETS[civ_name][asset_type]["name"]
                tasks[asset_type] = asyncio.create_task(
                    self._generate_and_optimize(
                        client=client,
                        name=model_name,
                        prompt=prompt_text,
                        output_path=str(civ_dir / f"{model_name}.glb"),
                    )
                )

            results: dict[str, str] = {}
            for asset_type, task in tasks.items():
                try:
                    path = await task
                    results[asset_type] = path
                    logger.info("[%s] %s → %s", civ_name, asset_type, path)
                except (TripoAPIError, TripoTimeoutError, Exception) as exc:
                    logger.error("[%s] Failed to generate %s: %s", civ_name, asset_type, exc)
                    results[asset_type] = f"ERROR: {exc}"

        return results

    # ------------------------------------------------------------------
    # Building generation
    # ------------------------------------------------------------------

    async def generate_building(
        self,
        name: str,
        style: str,
        optimize: bool = True,
    ) -> str:
        """Generate a single building asset via text-to-3D.

        Pipeline: text-to-3D → retopology (optional) → PBR (optional).

        Args:
            name: Descriptive name used as the output filename stem.
            style: Full prose description of the building appearance.
            optimize: If True, run retopology and PBR texturing after
                initial generation (recommended for game use).

        Returns:
            Absolute path to the saved ``.glb`` file.

        Raises:
            TripoAPIError: If any pipeline step fails.
            TripoTimeoutError: If any step exceeds its timeout.
        """
        output_path = str(self.output_dir / "buildings" / f"{name}.glb")
        async with TripoClient(self._api_key) as client:
            return await self._generate_and_optimize(
                client=client,
                name=name,
                prompt=style,
                output_path=output_path,
                optimize=optimize,
            )

    async def _generate_and_optimize(
        self,
        client: TripoClient,
        name: str,
        prompt: str,
        output_path: str,
        optimize: bool = True,
    ) -> str:
        """Internal helper: text-to-3D → optional retopo+PBR → download.

        Args:
            client: Active :class:`TripoClient` instance.
            name: Human-readable asset name for logging.
            prompt: Generation prompt string.
            output_path: Where to save the final ``.glb``.
            optimize: If True, run retopology + PBR after generation.

        Returns:
            Absolute path to the saved file.
        """
        # Step 1 — text to 3D
        logger.info("[%s] Step 1/3 — text-to-3D", name)
        gen_task = await client.text_to_3d(prompt, output_format="glb", pbr=True, texture_quality="detailed")
        gen_result = await client.wait_for_task(gen_task["task_id"])
        model_id: str = gen_task["task_id"]

        if optimize:
            # Step 2 — retopology
            logger.info("[%s] Step 2/3 — retopology", name)
            retopo_task = await client.retopologize(model_id, quad=True, target_faces=5000)
            retopo_result = await client.wait_for_task(retopo_task["task_id"])
            model_id = retopo_task["task_id"]

            # Step 3 — PBR texturing on optimised mesh
            logger.info("[%s] Step 3/3 — PBR texturing", name)
            pbr_task = await client.generate_pbr_textures(model_id)
            final_result = await client.wait_for_task(pbr_task["task_id"])
        else:
            final_result = gen_result

        # Download
        return await client.download_model(final_result, output_path)

    # ------------------------------------------------------------------
    # Concept-art to model
    # ------------------------------------------------------------------

    async def generate_from_concept(
        self,
        name: str,
        image_path: str,
        optimize: bool = True,
    ) -> str:
        """Convert a concept-art image into an optimized 3D game asset.

        Pipeline: image-upload → image-to-3D → retopology → PBR → download.

        Args:
            name: Descriptive name used as the output filename stem.
            image_path: Local path to the PNG/JPEG concept image.
            optimize: If True, run retopology and PBR texturing after
                initial generation.

        Returns:
            Absolute path to the saved ``.glb`` file.

        Raises:
            FileNotFoundError: If *image_path* does not exist.
            TripoAPIError: If any pipeline step fails.
            TripoTimeoutError: If any step exceeds its timeout.
        """
        output_path = str(self.output_dir / "concepts" / f"{name}.glb")
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        async with TripoClient(self._api_key) as client:
            # Step 1 — image to 3D
            logger.info("[%s] Step 1/3 — image-to-3D", name)
            gen_task = await client.image_to_3d(image_path, output_format="glb", pbr=True)
            gen_result = await client.wait_for_task(gen_task["task_id"])
            model_id: str = gen_task["task_id"]

            if optimize:
                # Step 2 — retopology
                logger.info("[%s] Step 2/3 — retopology", name)
                retopo_task = await client.retopologize(model_id, quad=True, target_faces=5000)
                await client.wait_for_task(retopo_task["task_id"])
                model_id = retopo_task["task_id"]

                # Step 3 — PBR texturing
                logger.info("[%s] Step 3/3 — PBR texturing", name)
                pbr_task = await client.generate_pbr_textures(model_id)
                final_result = await client.wait_for_task(pbr_task["task_id"])
            else:
                final_result = gen_result

            return await client.download_model(final_result, output_path)

    # ------------------------------------------------------------------
    # NPC / character generation
    # ------------------------------------------------------------------

    async def generate_npc(
        self,
        name: str,
        description: str,
        animation_preset: str = "walk",
    ) -> str:
        """Generate a rigged, animated NPC character.

        Pipeline: text-to-3D → auto-rig → animate → download.

        No retopology is run by default because Tripo's rig endpoint works
        best on the original generation topology.

        Args:
            name: Character name, used as the output filename stem.
            description: Natural-language description of the NPC's appearance.
            animation_preset: Tripo animation preset to apply after rigging.
                Common values: ``'idle'``, ``'walk'``, ``'run'``,
                ``'attack'``, ``'wave'``.

        Returns:
            Absolute path to the saved animated ``.glb`` file.

        Raises:
            TripoAPIError: If any pipeline step fails.
            TripoTimeoutError: If any step exceeds its timeout.
        """
        output_path = str(self.output_dir / "npcs" / f"{name}.glb")
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        async with TripoClient(self._api_key) as client:
            # Step 1 — generate character mesh
            logger.info("[NPC:%s] Step 1/3 — text-to-3D", name)
            gen_task = await client.text_to_3d(
                description, output_format="glb", pbr=True, texture_quality="detailed"
            )
            await client.wait_for_task(gen_task["task_id"])
            model_id: str = gen_task["task_id"]

            # Step 2 — auto-rig
            logger.info("[NPC:%s] Step 2/3 — auto-rig", name)
            rig_task = await client.rig_model(model_id)
            await client.wait_for_task(rig_task["task_id"])
            rig_id: str = rig_task["task_id"]

            # Step 3 — animate
            logger.info("[NPC:%s] Step 3/3 — animate (%s)", name, animation_preset)
            anim_task = await client.animate_model(rig_id, animation_preset)
            final_result = await client.wait_for_task(anim_task["task_id"])

            return await client.download_model(final_result, output_path)

    # ------------------------------------------------------------------
    # Batch generation
    # ------------------------------------------------------------------

    async def batch_generate(
        self,
        prompts: list[dict],
        concurrency: int = 3,
    ) -> list[str]:
        """Generate multiple 3D assets concurrently.

        Each item in *prompts* is a dict with the following keys:

        * ``name`` (str, required): output filename stem.
        * ``prompt`` (str, required): generation prompt.
        * ``output_path`` (str, optional): override output path.
        * ``optimize`` (bool, optional): run retopo+PBR (default True).

        Args:
            prompts: List of asset descriptor dicts (see above).
            concurrency: Maximum number of assets processed simultaneously.
                Keep ≤ 3 to stay within Tripo's concurrent task limits.

        Returns:
            List of absolute paths (or error strings prefixed with
            ``'ERROR:'``) in the same order as *prompts*.

        Example::

            paths = await generator.batch_generate([
                {"name": "tree_01", "prompt": "a twisted ancient oak tree, low-poly game asset"},
                {"name": "pot_01",  "prompt": "a cracked clay pot with glowing runes"},
            ])
        """
        semaphore = asyncio.Semaphore(concurrency)
        results: list[Optional[str]] = [None] * len(prompts)

        async def _run(index: int, spec: dict) -> None:
            name: str = spec["name"]
            prompt: str = spec["prompt"]
            optimize: bool = spec.get("optimize", True)
            output_path: str = spec.get(
                "output_path",
                str(self.output_dir / "batch" / f"{name}.glb"),
            )
            Path(output_path).parent.mkdir(parents=True, exist_ok=True)

            async with semaphore:
                async with TripoClient(self._api_key) as client:
                    try:
                        path = await self._generate_and_optimize(
                            client=client,
                            name=name,
                            prompt=prompt,
                            output_path=output_path,
                            optimize=optimize,
                        )
                        results[index] = path
                    except Exception as exc:
                        logger.error("batch_generate[%d] '%s' failed: %s", index, name, exc)
                        results[index] = f"ERROR: {exc}"

        await asyncio.gather(*[_run(i, spec) for i, spec in enumerate(prompts)])
        return results  # type: ignore[return-value]

    # ------------------------------------------------------------------
    # Prompt templates
    # ------------------------------------------------------------------

    def _get_civilization_prompts(
        self, civ_name: str, style_description: str
    ) -> dict[str, str]:
        """Build structured prompts for all core asset types of a civilization.

        Uses handcrafted 5/5 quality prompts from :data:`CIVILIZATION_ASSETS`
        when available, falling back to dynamic template generation.

        Args:
            civ_name: Civilization slug (used in logging only).
            style_description: Prose description of the civilization style.

        Returns:
            Dict mapping each :data:`_ASSET_TYPES` key to a full prompt string.
        """
        if civ_name in CIVILIZATION_ASSETS:
            return {
                asset_type: data["prompt"]
                for asset_type, data in CIVILIZATION_ASSETS[civ_name].items()
            }

        base = style_description.rstrip(".")

        return {
            "main_building": (
                f"Grand main hall of the {civ_name} civilization. {base}. "
                "Imposing and architecturally detailed, central entrance, "
                "symmetrical facade, hero prop scale, game-ready 3D asset."
            ),
            "secondary_building": (
                f"Residential or utility structure of the {civ_name} civilization. {base}. "
                "Smaller than the main hall, modular design with visible wear, "
                "mid-size game prop, 3D asset."
            ),
            "landmark": (
                f"Iconic landmark monument of the {civ_name} civilization. {base}. "
                "Tall, distinctive silhouette, highly decorative, "
                "functions as a visual anchor on the skyline, game-ready 3D asset."
            ),
            "artifact": (
                f"Ancient hand-held relic artifact of the {civ_name} civilization. {base}. "
                "Small object scale, rich surface detail, magical aura, "
                "hero prop suitable for inventory or showcase, 3D game asset."
            ),
            "vegetation": (
                f"Signature plant or organic environmental element of the {civ_name} civilization. {base}. "
                "Stylised foliage or coral or fungal growth appropriate to the setting, "
                "modular environment tile, game-ready 3D asset."
            ),
        }


def get_all_prompts() -> dict[str, dict[str, dict]]:
    """Return all 25 production prompts and metadata across 5 civilizations."""
    return CIVILIZATION_ASSETS

