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
import os
from pathlib import Path
from typing import Optional

from .tripo_client import TripoClient, TripoAPIError, TripoTimeoutError

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

# Asset types generated for every civilization pack
_ASSET_TYPES: list[str] = [
    "main_building",
    "secondary_building",
    "landmark",
    "artifact",
    "vegetation",
    "creature",
]


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
            tasks = {
                asset_type: asyncio.create_task(
                    self._generate_and_optimize(
                        client=client,
                        name=asset_type,
                        prompt=prompts[asset_type],
                        output_path=str(civ_dir / f"{asset_type}.glb"),
                    )
                )
                for asset_type in _ASSET_TYPES
            }

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
        gen_task = await client.text_to_3d(prompt, output_format="glb", pbr=True, texture_quality="high")
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
        animation_preset: str = "idle",
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
                description, output_format="glb", pbr=True, texture_quality="high"
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
        """Build structured prompts for all six asset types of a civilization.

        Each prompt embeds *style_description* as an aesthetic anchor and
        appends asset-type-specific geometry guidance for best results.

        Args:
            civ_name: Civilization slug (used in logging only).
            style_description: Prose description of the civilization style.

        Returns:
            Dict mapping each :data:`_ASSET_TYPES` key to a full prompt string.
        """
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
            "creature": (
                f"Creature or wildlife native to the {civ_name} civilization. {base}. "
                "Distinctive silhouette, game-ready anatomy suitable for rigging, "
                "medium creature scale, stylised 3D asset."
            ),
        }
