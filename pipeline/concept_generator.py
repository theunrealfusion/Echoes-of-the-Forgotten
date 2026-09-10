"""
concept_generator.py
====================
Generates concept art images for each civilization using Pollinations.ai
(free, no API key required) and prepares them for Tripo image-to-3D.

Civilizations:
    - Sunken Library:  ancient underwater scholars, bioluminescent architecture
    - Sky Nomads:      floating cloud city, crystalline towers
    - Deep Forge:      underground volcanic craftsmen, obsidian structures
    - Memory Gardens:  spiritual temples, hanging gardens, spirit lanterns
    - Grand Reunion:   utopian synthesis of all four styles
"""

import asyncio
import aiohttp
import json
import os
from pathlib import Path
from typing import Optional
from urllib.parse import quote


# ---------------------------------------------------------------------------
# Concept prompts — optimised for architectural 3D reference shots
# ---------------------------------------------------------------------------

CIVILIZATION_CONCEPTS: dict[str, list[dict]] = {
    "sunken_library": [
        {
            "asset": "main_hall",
            "prompt": (
                "ancient underwater library hall, bioluminescent blue-green glowing architecture, "
                "coral encrusted stone columns, submerged flooded interior, volumetric god rays through "
                "water, scrolls floating, detailed 3D render, front orthographic reference view, "
                "dark indigo water, highly detailed, 8k"
            ),
        },
        {
            "asset": "scroll_tower",
            "prompt": (
                "tall underwater tower made of stacked scrolls and stone, bioluminescent runes, "
                "coral and seaweed growing on surface, 3D asset reference, side orthographic view, "
                "teal and gold color palette, photorealistic render"
            ),
        },
        {
            "asset": "knowledge_orb",
            "prompt": (
                "magical glowing orb artifact, ancient knowledge contained inside, floating geometric "
                "patterns of light, underwater atmosphere, 3D asset concept art, turntable view, "
                "purple and cyan glow, transparent crystal shell"
            ),
        },
    ],
    "sky_nomads": [
        {
            "asset": "cloud_palace",
            "prompt": (
                "floating cloud city palace made of crystalline blue-white towers, wisps of cloud "
                "threading through spires, windmill mechanisms, light and airy architecture, "
                "3D reference render front view, sky blue and silver palette, epic scale"
            ),
        },
        {
            "asset": "wind_altar",
            "prompt": (
                "ancient wind altar on floating island, spinning crystal rings, prayer flags, "
                "sky nomad culture, 3D asset reference side view, ethereal blue-white glow, "
                "detailed surface engravings, photorealistic"
            ),
        },
    ],
    "deep_forge": [
        {
            "asset": "forge_cathedral",
            "prompt": (
                "massive underground forge cathedral, obsidian black walls with rivers of lava, "
                "giant industrial furnaces, dwarven gothic architecture, 3D reference front view, "
                "orange and black palette, volumetric smoke, highly detailed, dark fantasy"
            ),
        },
        {
            "asset": "great_anvil",
            "prompt": (
                "monumental divine anvil artifact, glowing hot metal, ancient runes etched in obsidian, "
                "surrounded by floating hammers, lava light, 3D asset concept turntable view, "
                "orange glow, epic scale"
            ),
        },
    ],
    "memory_gardens": [
        {
            "asset": "spirit_temple",
            "prompt": (
                "ancient east-asian style spirit temple, overgrown with sacred vines and glowing flowers, "
                "spirit lanterns floating around it, serene misty atmosphere, 3D reference render, "
                "jade green and gold palette, highly detailed, photorealistic"
            ),
        },
        {
            "asset": "memory_tree",
            "prompt": (
                "enormous sacred memory tree, luminous leaves each containing a tiny glowing scene, "
                "spirit wisps circling the trunk, 3D asset side reference view, soft green and gold "
                "palette, magical realism style, detailed bark texture"
            ),
        },
    ],
    "grand_reunion": [
        {
            "asset": "unity_hall",
            "prompt": (
                "grand unified hall combining underwater coral, crystal spires, obsidian forge, "
                "and garden temple architecture, golden light pouring from center, utopian mega-structure, "
                "3D reference front view, warm gold and white palette, epic fantasy, 8k"
            ),
        },
        {
            "asset": "gift_monument",
            "prompt": (
                "monumental gift sculpture, abstract swirling forms representing four civilizations united, "
                "golden ethereal light, floating fragments orbiting the core, 3D asset concept art, "
                "centered view, warm gold and white glow, ultra detailed"
            ),
        },
    ],
}


# ---------------------------------------------------------------------------
# Pollinations.ai free image API (no key needed)
# ---------------------------------------------------------------------------

POLLINATIONS_URL = "https://image.pollinations.ai/prompt/{prompt}?width=1024&height=1024&model=flux&nologo=true&seed={seed}"


async def generate_concept_image(
    session: aiohttp.ClientSession,
    prompt: str,
    output_path: Path,
    seed: int = 42,
) -> Optional[Path]:
    """
    Generate a concept art image via Pollinations.ai (free, no key).

    Args:
        session: Shared aiohttp session.
        prompt: Text description for image generation.
        output_path: Where to save the PNG file.
        seed: Random seed for reproducibility.

    Returns:
        Path to saved image, or None on failure.
    """
    encoded = quote(prompt, safe="")
    url = POLLINATIONS_URL.format(prompt=encoded, seed=seed)

    try:
        print(f"  → Generating: {output_path.name} ...")
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=90)) as resp:
            if resp.status == 200:
                output_path.parent.mkdir(parents=True, exist_ok=True)
                data = await resp.read()
                output_path.write_bytes(data)
                print(f"  ✅ Saved: {output_path}")
                return output_path
            else:
                print(f"  ❌ HTTP {resp.status} for {output_path.name}")
                return None
    except asyncio.TimeoutError:
        print(f"  ⏰ Timeout generating {output_path.name}")
        return None
    except Exception as e:
        print(f"  💥 Error generating {output_path.name}: {e}")
        return None


async def generate_all_concepts(
    output_dir: str = "assets/concepts",
    concurrency: int = 3,
) -> dict[str, list[str]]:
    """
    Generate concept art for all civilizations concurrently.

    Args:
        output_dir: Directory to save concept images.
        concurrency: Max simultaneous requests.

    Returns:
        Manifest dict mapping civilization → list of image paths.
    """
    base = Path(output_dir)
    manifest: dict[str, list[str]] = {}
    semaphore = asyncio.Semaphore(concurrency)

    async def bounded_generate(session, prompt, path, seed):
        async with semaphore:
            return await generate_concept_image(session, prompt, path, seed)

    print("\n🎨 Generating concept art for all civilizations...")
    print("=" * 60)

    connector = aiohttp.TCPConnector(limit=10)
    async with aiohttp.ClientSession(connector=connector) as session:
        tasks = []
        meta = []  # (civ_id, asset_name, path)

        seed = 100
        for civ_id, assets in CIVILIZATION_CONCEPTS.items():
            civ_dir = base / civ_id
            civ_dir.mkdir(parents=True, exist_ok=True)
            print(f"\n[{civ_id.upper()}]")

            for asset in assets:
                out_path = civ_dir / f"{asset['asset']}_concept.png"
                if out_path.exists():
                    print(f"  ⏭️  Already exists: {out_path.name}")
                    meta.append((civ_id, asset["asset"], str(out_path)))
                    continue

                task = bounded_generate(session, asset["prompt"], out_path, seed)
                tasks.append(task)
                meta.append((civ_id, asset["asset"], str(out_path)))
                seed += 7

        results = await asyncio.gather(*tasks, return_exceptions=False) if tasks else []

    # Build manifest
    result_iter = iter(results) if results else iter([])
    for civ_id, asset_name, path in meta:
        if civ_id not in manifest:
            manifest[civ_id] = []
        if Path(path).exists():
            manifest[civ_id].append(path)

    # Save manifest
    manifest_path = base / "concept_manifest.json"
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"\n✅ Concept manifest saved: {manifest_path}")
    return manifest


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys

    output_dir = sys.argv[1] if len(sys.argv) > 1 else "assets/concepts"
    result = asyncio.run(generate_all_concepts(output_dir))

    total = sum(len(v) for v in result.values())
    print(f"\n🎨 Done! Generated {total} concept images across {len(result)} civilizations.")
    print("Next step: python pipeline/batch_runner.py generate-all")
