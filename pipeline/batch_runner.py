#!/usr/bin/env python3
"""
pipeline/batch_runner.py
========================
CLI entry point for bulk 3D asset generation in 'A Gift for the Forgotten City'.

Commands
--------
generate-all        Generate all five civilization packs concurrently.
generate-civ        Generate assets for a single named civilization.
test-connection     Verify API key and connectivity with a lightweight request.

Usage
-----
::

    # Full world generation
    python -m pipeline.batch_runner generate-all --output-dir assets/models

    # Single civilization
    python -m pipeline.batch_runner generate-civ --civ sky_nomads

    # Connectivity check
    python -m pipeline.batch_runner test-connection

Configuration
-------------
Set ``TRIPO_API_KEY`` in a ``.env`` file (or as an environment variable).
``python-dotenv`` is used to load ``.env`` automatically.

Python 3.9+ required.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# Optional dependencies — degrade gracefully if missing.
# ---------------------------------------------------------------------------
try:
    from dotenv import load_dotenv  # type: ignore
    _HAS_DOTENV = True
except ImportError:
    _HAS_DOTENV = False

try:
    from rich.console import Console
    from rich.logging import RichHandler
    from rich.progress import (
        BarColumn,
        Progress,
        SpinnerColumn,
        TaskProgressColumn,
        TextColumn,
        TimeElapsedColumn,
    )
    from rich.table import Table
    _HAS_RICH = True
except ImportError:
    _HAS_RICH = False

# Ensure repo root is on sys.path for direct script execution
_repo_root = Path(__file__).resolve().parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

try:
    from pipeline.asset_generator import (
        CIVILIZATION_ASSETS,
        CIVILIZATION_STYLES,
        ForgottenCityAssetGenerator,
        get_all_prompts,
    )
    from pipeline.tripo_client import TripoAPIError, TripoClient, TripoTimeoutError
except ImportError:
    from asset_generator import (
        CIVILIZATION_ASSETS,
        CIVILIZATION_STYLES,
        ForgottenCityAssetGenerator,
        get_all_prompts,
    )
    from tripo_client import TripoAPIError, TripoClient, TripoTimeoutError

# ---------------------------------------------------------------------------
# Logging setup
# ---------------------------------------------------------------------------

def _configure_logging(verbose: bool = False) -> None:
    """Configure logging with Rich handler when available, else basicConfig."""
    level = logging.DEBUG if verbose else logging.INFO
    if _HAS_RICH:
        logging.basicConfig(
            level=level,
            format="%(message)s",
            datefmt="[%X]",
            handlers=[RichHandler(rich_tracebacks=True, markup=True)],
        )
    else:
        logging.basicConfig(level=level, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")


# Configure UTF-8 encoding on Windows console if supported
if sys.platform == "win32":
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    if hasattr(sys.stderr, "reconfigure"):
        try:
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

logger = logging.getLogger(__name__)
console = Console(legacy_windows=False) if _HAS_RICH else None


def _print(msg: str) -> None:
    """Print via Rich console when available, with encoding fallback."""
    if console:
        try:
            console.print(msg)
            return
        except Exception:
            pass
    try:
        print(msg)
    except UnicodeEncodeError:
        print(msg.encode("ascii", errors="replace").decode("ascii"))


# ---------------------------------------------------------------------------
# API key loading
# ---------------------------------------------------------------------------

def _load_api_key() -> str:
    """Resolve the Tripo API key.

    Resolution order:
    1. ``TRIPO_API_KEY`` environment variable (already set).
    2. ``TRIPO_API_KEY`` in ``.env`` file in the current working directory.

    Returns:
        The API key string.

    Raises:
        SystemExit: If no key is found.
    """
    # Try environment first
    key = os.environ.get("TRIPO_API_KEY", "")
    if key:
        return key

    # Try .env file
    if _HAS_DOTENV:
        env_path = Path(".env")
        if env_path.exists():
            load_dotenv(dotenv_path=env_path)
            key = os.environ.get("TRIPO_API_KEY", "")
        else:
            # Try parent directories up to project root
            for parent in Path.cwd().parents:
                candidate = parent / ".env"
                if candidate.exists():
                    load_dotenv(dotenv_path=candidate)
                    key = os.environ.get("TRIPO_API_KEY", "")
                    break

    if not key:
        _print(
            "[bold red]Error:[/bold red] TRIPO_API_KEY not found.\n"
            "Set it in your environment or in a .env file:\n"
            "  TRIPO_API_KEY=your_key_here"
            if _HAS_RICH
            else "Error: TRIPO_API_KEY not found. Set it in your environment or .env file."
        )
        sys.exit(1)

    return key


# ---------------------------------------------------------------------------
# Manifest helpers
# ---------------------------------------------------------------------------

def _save_manifest(
    output_dir: str,
    results: dict,
    command: str,
    elapsed: float,
) -> str:
    """Write a ``manifest.json`` file summarising the generation run.

    Args:
        output_dir: Root assets directory.
        results: Dict of results from the generation run.
        command: CLI command that was executed.
        elapsed: Total wall-clock seconds for the run.

    Returns:
        Absolute path to the written manifest file.
    """
    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "command": command,
        "elapsed_seconds": round(elapsed, 2),
        "output_dir": str(Path(output_dir).resolve()),
        "assets": results,
    }
    manifest_path = Path(output_dir) / "manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    with open(manifest_path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2, ensure_ascii=False)
    logger.info("Manifest saved → %s", manifest_path)
    return str(manifest_path)


# ---------------------------------------------------------------------------
# Command implementations
# ---------------------------------------------------------------------------

async def cmd_test_connection(api_key: str, probe: bool = False) -> int:
    """Verify API connectivity and authentication.

    By default, checks account balance and active credits via GET /account/balance
    (zero credit cost). If probe is True, also submits a lightweight generation request.

    Args:
        api_key: Tripo API key to validate.
        probe: Whether to submit an actual test generation probe.

    Returns:
        Exit code (0 = success, 1 = failure).
    """
    _print("\n[bold cyan]Testing Tripo API connection…[/bold cyan]" if _HAS_RICH else "Testing Tripo API connection…")
    try:
        async with TripoClient(api_key) as client:
            balance_data = await client.get_balance()
            balance = balance_data.get("balance", 0.0)
            frozen = balance_data.get("frozen", 0.0)
            _print(
                f"[green]✓ Connection & Authentication successful![/green]\n"
                f"  Available Balance: [bold cyan]{balance:,.1f}[/bold cyan] credits "
                f"(${balance * 0.01:,.2f} USD) | Frozen: {frozen:,.1f}"
                if _HAS_RICH
                else f"✓ Connection & Authentication successful!\n"
                     f"  Available Balance: {balance:,.1f} credits (${balance * 0.01:,.2f} USD) | Frozen: {frozen:,.1f}"
            )

            if probe:
                _print("\n  Submitting lightweight text-to-3D probe generation...")
                task = await client.text_to_3d(
                    "a single smooth stone cube",
                    output_format="glb",
                    texture=True,
                    pbr=True,
                    texture_quality="standard",
                )
                task_id = task.get("task_id", "?")
                _print(
                    f"  [green]✓ Probe generation submitted.[/green] Task ID: [dim]{task_id}[/dim]"
                    if _HAS_RICH
                    else f"  ✓ Probe generation submitted. Task ID: {task_id}"
                )
            return 0
    except TripoAPIError as exc:
        _print(
            f"[bold red]✗ API Error:[/bold red] {exc}"
            if _HAS_RICH
            else f"✗ API Error: {exc}"
        )
        return 1
    except Exception as exc:
        _print(
            f"[bold red]✗ Unexpected error:[/bold red] {exc}"
            if _HAS_RICH
            else f"✗ Unexpected error: {exc}"
        )
        return 1


async def cmd_generate_civ(
    api_key: str,
    civ_name: str,
    output_dir: str,
) -> int:
    """Generate the full asset pack for a single civilization.

    Args:
        api_key: Tripo API key.
        civ_name: One of the keys in :data:`CIVILIZATION_STYLES`.
        output_dir: Root output directory.

    Returns:
        Exit code (0 = success, 1 = failure).
    """
    if civ_name not in CIVILIZATION_STYLES:
        valid = ", ".join(CIVILIZATION_STYLES.keys())
        _print(
            f"[bold red]Unknown civilization:[/bold red] '{civ_name}'\nValid options: {valid}"
            if _HAS_RICH
            else f"Unknown civilization: '{civ_name}'\nValid options: {valid}"
        )
        return 1

    style_description = CIVILIZATION_STYLES[civ_name]
    generator = ForgottenCityAssetGenerator(api_key=api_key, output_dir=output_dir)

    _print(
        f"\n[bold magenta]Generating civilization pack:[/bold magenta] [cyan]{civ_name}[/cyan]"
        if _HAS_RICH
        else f"\nGenerating civilization pack: {civ_name}"
    )
    _print(f"  Style: {style_description[:100]}…" if len(style_description) > 100 else f"  Style: {style_description}")

    t0 = time.monotonic()
    try:
        results = await generator.generate_civilization_pack(civ_name, style_description)
    except Exception as exc:
        _print(
            f"[bold red]Generation failed:[/bold red] {exc}"
            if _HAS_RICH
            else f"Generation failed: {exc}"
        )
        return 1

    elapsed = time.monotonic() - t0

    # Print results table
    if _HAS_RICH:
        table = Table(title=f"{civ_name} — Generation Results", show_lines=True)
        table.add_column("Asset Type", style="cyan", no_wrap=True)
        table.add_column("Path / Status", style="white")
        for asset_type, path in results.items():
            status_style = "red" if str(path).startswith("ERROR") else "green"
            table.add_row(asset_type, f"[{status_style}]{path}[/{status_style}]")
        console.print(table)  # type: ignore[union-attr]
    else:
        for asset_type, path in results.items():
            print(f"  {asset_type}: {path}")

    manifest_path = _save_manifest(output_dir, {civ_name: results}, "generate-civ", elapsed)
    _print(
        f"\n[green]Done in {elapsed:.1f}s.[/green]  Manifest: [dim]{manifest_path}[/dim]"
        if _HAS_RICH
        else f"\nDone in {elapsed:.1f}s. Manifest: {manifest_path}"
    )
    return 0


async def cmd_generate_all(api_key: str, output_dir: str, max_workers: int = 2) -> int:
    """Generate asset packs for all five civilizations concurrently.

    Concurrency is limited to *max_workers* civilization packs running
    simultaneously to avoid exceeding Tripo's per-account rate limits.

    Args:
        api_key: Tripo API key.
        output_dir: Root output directory.
        max_workers: Maximum simultaneously running civilization packs.

    Returns:
        Exit code (0 = all succeeded, 1 = at least one failure).
    """
    _print(
        "\n[bold magenta]Generating ALL civilization packs[/bold magenta]"
        if _HAS_RICH
        else "\nGenerating ALL civilization packs"
    )
    _print(f"  Civilizations: {list(CIVILIZATION_STYLES.keys())}")
    _print(f"  Output dir:    {output_dir}")

    generator = ForgottenCityAssetGenerator(api_key=api_key, output_dir=output_dir)
    semaphore = asyncio.Semaphore(max_workers)
    all_results: dict[str, dict] = {}
    any_error = False

    async def _generate_one(civ_name: str, style: str) -> None:
        nonlocal any_error
        async with semaphore:
            _print(
                f"[bold]→ Starting:[/bold] [cyan]{civ_name}[/cyan]"
                if _HAS_RICH
                else f"→ Starting: {civ_name}"
            )
            try:
                results = await generator.generate_civilization_pack(civ_name, style)
                all_results[civ_name] = results
                errors = [v for v in results.values() if str(v).startswith("ERROR")]
                if errors:
                    any_error = True
                    _print(
                        f"[yellow]⚠ {civ_name}:[/yellow] {len(errors)} asset(s) failed"
                        if _HAS_RICH
                        else f"⚠ {civ_name}: {len(errors)} asset(s) failed"
                    )
                else:
                    _print(
                        f"[green]✓ {civ_name}[/green] — all assets generated"
                        if _HAS_RICH
                        else f"✓ {civ_name} — all assets generated"
                    )
            except Exception as exc:
                any_error = True
                all_results[civ_name] = {"error": str(exc)}
                _print(
                    f"[red]✗ {civ_name}[/red] — {exc}"
                    if _HAS_RICH
                    else f"✗ {civ_name} — {exc}"
                )

    t0 = time.monotonic()

    if _HAS_RICH:
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TaskProgressColumn(),
            TimeElapsedColumn(),
            console=console,  # type: ignore[arg-type]
        ) as progress:
            overall = progress.add_task("All civilizations", total=len(CIVILIZATION_STYLES))
            coros = []
            for civ_name, style in CIVILIZATION_STYLES.items():
                async def _wrap(cn=civ_name, st=style):
                    await _generate_one(cn, st)
                    progress.advance(overall)
                coros.append(_wrap())
            await asyncio.gather(*coros)
    else:
        await asyncio.gather(*[
            _generate_one(cn, st) for cn, st in CIVILIZATION_STYLES.items()
        ])

    elapsed = time.monotonic() - t0
    manifest_path = _save_manifest(output_dir, all_results, "generate-all", elapsed)

    _print(
        f"\n[bold green]All done in {elapsed:.1f}s.[/bold green]  Manifest: [dim]{manifest_path}[/dim]"
        if _HAS_RICH
        else f"\nAll done in {elapsed:.1f}s. Manifest: {manifest_path}"
    )
    return 1 if any_error else 0


# ---------------------------------------------------------------------------
# CLI argument parsing
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Dry-run execution & Prompt Validation
# ---------------------------------------------------------------------------

def validate_prompt(prompt: str, asset_type: str = "") -> tuple[bool, list[str]]:
    """Validate 3D generation prompt against geometric, isolation, and scale constraints.

    Args:
        prompt: Generation prompt text.
        asset_type: Core category (e.g., main_building, artifact, vegetation).

    Returns:
        Tuple of (is_valid: bool, issues: list[str]).
    """
    issues: list[str] = []
    if not prompt or not isinstance(prompt, str) or not prompt.strip():
        return False, ["Prompt is empty or contains only whitespace"]

    p_clean = prompt.strip()
    p_len = len(p_clean)

    # 1. Character length boundaries (100 <= len <= 600)
    if p_len < 100:
        issues.append(
            f"Prompt length ({p_len} chars) is below minimum threshold of 100 chars "
            "(insufficient geometric specificity for Tripo V3)"
        )
    elif p_len > 600:
        issues.append(
            f"Prompt length ({p_len} chars) exceeds maximum threshold of 600 chars "
            "(risks token truncation or prompt drift)"
        )

    p_lower = p_clean.lower()

    # 2. Required isolation keywords
    isolation_keywords = (
        "isolated",
        "game-ready",
        "clean mesh",
        "clean silhouette",
        "single object",
    )
    if not any(kw in p_lower for kw in isolation_keywords):
        issues.append(
            "Missing required mesh isolation directive (must include one of: "
            "'isolated', 'game-ready', 'clean mesh', 'clean silhouette', 'single object')"
        )

    # 3. Required PBR / texture directives
    pbr_keywords = ("pbr", "textures", "normal", "material")
    if not any(kw in p_lower for kw in pbr_keywords):
        issues.append(
            "Missing required PBR/texture directive (must include one of: "
            "'PBR', 'textures', 'normal', 'material')"
        )

    # 4. Forbidden tokens: raw snake_case civilization identifiers
    snake_case_matches = re.findall(
        r"\b(?:sunken_library|sky_nomads|deep_forge|memory_gardens|grand_reunion)\b",
        prompt,
    )
    if snake_case_matches:
        unique_matches = list(set(snake_case_matches))
        issues.append(
            f"Contains forbidden raw snake_case identifier(s): {unique_matches} "
            "(use natural language civilization titles instead)"
        )

    # 5. Scale bleed: small props cannot inherit monumental room-scale architectural terms
    if asset_type.lower() in ("artifact", "vegetation"):
        scale_bleed_terms = (
            "cavern ceilings",
            "tidal arches",
            "sky-bridges",
            "monumental",
            "grand hall",
            "palace",
            "cathedral",
            "spire",
            "rotunda",
        )
        found_scale_bleed = [term for term in scale_bleed_terms if term in p_lower]
        if found_scale_bleed:
            issues.append(
                f"Small prop ({asset_type}) contains scale-bleeding architectural term(s): {found_scale_bleed}"
            )

    # 6. Mesh contamination: atmospheric noise terms
    atmospheric_terms = (
        "god rays",
        "light filtering",
        "volumetric fog",
        "volumetric light",
    )
    found_atmos = [term for term in atmospheric_terms if term in p_lower]
    if found_atmos:
        issues.append(
            f"Contains mesh-contaminating atmospheric term(s): {found_atmos} "
            "(causes non-manifold geometry or ground plane synthesis)"
        )

    return len(issues) == 0, issues


def run_dry_run(zone_filter: Optional[str] = None) -> int:
    """Validate all prompts and display detailed credit cost breakdown without API calls.

    Args:
        zone_filter: Optional civilization slug to filter output to one zone.

    Returns:
        Exit code: 0 if all prompts pass validation, 1 if any prompt fails.
    """
    _print("=" * 78)
    _print("  TRIPO V3 PIPELINE — ASSET GENERATION DRY-RUN & PROMPT AUDIT")
    _print("  Project: 'A Gift for the Forgotten City' (Tripothon S1)")
    _print("=" * 78)
    _print("Mode: SIMULATION / DRY-RUN (No API key required, 0 real credits consumed)")
    _print("Unit Cost per Asset: 30c (Text-to-3D) + 20c (Quad Retopo) + 10c (PBR Bake) = 60 credits\n")

    all_prompts = get_all_prompts()
    selected_civs = [zone_filter] if zone_filter and zone_filter in all_prompts else list(all_prompts.keys())

    total_assets_count = 0
    total_credits_count = 0
    failed_prompts: list[dict] = []

    for civ_idx, civ_name in enumerate(selected_civs, 1):
        civ_data = all_prompts[civ_name]
        style_desc = CIVILIZATION_STYLES.get(civ_name, "")
        _print("-" * 78)
        _print(f"CIVILIZATION {civ_idx}/5: [{civ_name.upper()}]")
        _print(f"Theme / Aesthetic: {style_desc[:110]}...")
        _print("-" * 78)

        civ_credits = 0
        for asset_type, asset_info in civ_data.items():
            total_assets_count += 1
            name = asset_info.get("name", asset_type)
            title = asset_info.get("title", name)
            prompt = asset_info.get("prompt", "")
            cost_info = asset_info.get("estimated_credits", {"text_to_3d": 30, "retopology": 20, "pbr": 10, "total": 60})
            asset_total = cost_info.get("total", 60)
            civ_credits += asset_total
            total_credits_count += asset_total

            is_valid, validation_errors = validate_prompt(prompt, asset_type=asset_type)

            _print(f"  Asset #{total_assets_count:02d}: [{asset_type}] -> {name}.glb ('{title}')")
            _print(f"    • Cost: {cost_info.get('text_to_3d', 30)}c Text-to-3D + {cost_info.get('retopology', 20)}c Retopo + {cost_info.get('pbr', 10)}c PBR = {asset_total} credits")
            _print(f"    • Prompt: \"{prompt}\"")
            if is_valid:
                _print(f"    • Validation: [PASS] Length: {len(prompt)} chars, isolation & PBR directives verified\n")
            else:
                failed_prompts.append({
                    "civ": civ_name,
                    "asset_type": asset_type,
                    "name": name,
                    "issues": validation_errors,
                })
                _print(f"    • Validation: [FAIL] Length: {len(prompt)} chars | Issues:")
                for err in validation_errors:
                    _print(f"        - {err}")
                _print("")

        _print(f"  Subtotal for [{civ_name}]: {len(civ_data)} assets | {civ_credits} credits\n")

    _print("=" * 78)
    _print("DRY-RUN SUMMARY BREAKDOWN")
    _print("=" * 78)
    _print(f"  • Civilizations Processed : {len(selected_civs)} of 5")
    _print(f"  • Total Game Assets       : {total_assets_count} assets")
    _print("  • Pipeline Per Asset      : 30c (Text-to-3D) + 20c (Quad Retopo) + 10c (PBR Bake) = 60 credits")
    _print(f"  • Total Estimated Credits : {total_credits_count:,} credits (${total_credits_count * 0.01:.2f} USD)")
    if failed_prompts:
        _print(f"  • Validation Status       : FAILED ({len(failed_prompts)} prompts failed validation) (Exit 1)")
        _print("=" * 78)
        return 1
    else:
        _print("  • Validation Status       : ALL PROMPTS VALIDATED (Exit 0)")
        _print("=" * 78)
        return 0


# ---------------------------------------------------------------------------
# CLI argument parsing
# ---------------------------------------------------------------------------

def _build_parser() -> argparse.ArgumentParser:
    """Build and return the top-level argument parser."""
    parser = argparse.ArgumentParser(
        prog="batch_runner",
        description="'A Gift for the Forgotten City' — Tripo AI asset batch runner",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
examples:
  python pipeline/batch_runner.py --dry-run
  python pipeline/batch_runner.py test-connection
  python pipeline/batch_runner.py generate-civ --civ sky_nomads
  python pipeline/batch_runner.py generate-all --output-dir assets/models
        """,
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Enable DEBUG-level logging.",
    )
    parser.add_argument(
        "--output-dir",
        default="assets/models",
        metavar="DIR",
        help="Root directory for generated model files (default: assets/models).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate all 25 asset prompts and print credit cost estimates without calling the API.",
    )

    subparsers = parser.add_subparsers(dest="command", required=False)

    # dry-run subparser
    dry_parser = subparsers.add_parser(
        "dry-run",
        help="Validate all 25 asset prompts and print credit cost estimates without calling the API.",
    )
    dry_parser.add_argument(
        "--zone",
        choices=list(CIVILIZATION_STYLES.keys()),
        metavar="ZONE",
        help="Filter dry-run to a specific civilization zone.",
    )

    # test-connection
    test_conn_parser = subparsers.add_parser(
        "test-connection",
        help="Verify TRIPO_API_KEY and API reachability (queries account balance).",
    )
    test_conn_parser.add_argument(
        "--probe",
        action="store_true",
        help="Also submit a lightweight generation probe task (consumes credits).",
    )

    # generate-civ
    gen_civ = subparsers.add_parser(
        "generate-civ",
        help="Generate a full asset pack for one civilization.",
    )
    gen_civ.add_argument(
        "--civ",
        required=True,
        choices=list(CIVILIZATION_STYLES.keys()),
        metavar="NAME",
        help=(
            "Civilization to generate. "
            f"Choices: {{'{chr(39).join(CIVILIZATION_STYLES.keys())}'}}"
        ),
    )
    gen_civ.add_argument(
        "--dry-run",
        action="store_true",
        help="Perform dry run without calling API.",
    )

    # generate-all
    gen_all = subparsers.add_parser(
        "generate-all",
        help="Generate all five civilization packs.",
    )
    gen_all.add_argument(
        "--max-workers",
        type=int,
        default=2,
        metavar="N",
        help="Max concurrent civilization packs (default: 2).",
    )
    gen_all.add_argument(
        "--dry-run",
        action="store_true",
        help="Perform dry run without calling API.",
    )
    gen_all.add_argument(
        "--zone",
        choices=list(CIVILIZATION_STYLES.keys()),
        metavar="ZONE",
        help="Filter generation to a specific civilization zone.",
    )

    return parser


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    """Parse CLI args and dispatch to the appropriate async command handler."""
    parser = _build_parser()
    args = parser.parse_args()

    _configure_logging(verbose=args.verbose)

    is_dry_run = (
        getattr(args, "dry_run", False)
        or args.command == "dry-run"
    )

    if is_dry_run:
        zone = getattr(args, "civ", None) or getattr(args, "zone", None)
        exit_code = run_dry_run(zone_filter=zone)
        sys.exit(exit_code)

    if not args.command:
        parser.print_help()
        sys.exit(1)

    api_key = _load_api_key()

    exit_code: int = 0

    if args.command == "test-connection":
        exit_code = asyncio.run(
            cmd_test_connection(api_key, probe=getattr(args, "probe", False))
        )

    elif args.command == "generate-civ":
        exit_code = asyncio.run(
            cmd_generate_civ(api_key, civ_name=args.civ, output_dir=args.output_dir)
        )

    elif args.command == "generate-all":
        exit_code = asyncio.run(
            cmd_generate_all(
                api_key,
                output_dir=args.output_dir,
                max_workers=args.max_workers,
            )
        )

    sys.exit(exit_code)


if __name__ == "__main__":
    main()
