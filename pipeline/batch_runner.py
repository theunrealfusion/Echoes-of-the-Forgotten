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

from .asset_generator import CIVILIZATION_STYLES, ForgottenCityAssetGenerator
from .tripo_client import TripoAPIError, TripoClient, TripoTimeoutError

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


logger = logging.getLogger(__name__)
console = Console() if _HAS_RICH else None


def _print(msg: str) -> None:
    """Print via Rich console when available, else plain print."""
    if console:
        console.print(msg)
    else:
        print(msg)


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

async def cmd_test_connection(api_key: str) -> int:
    """Verify API connectivity by submitting a minimal probe request.

    Args:
        api_key: Tripo API key to validate.

    Returns:
        Exit code (0 = success, 1 = failure).
    """
    _print("\n[bold cyan]Testing Tripo API connection…[/bold cyan]" if _HAS_RICH else "Testing Tripo API connection…")
    try:
        async with TripoClient(api_key) as client:
            # A lightweight prompt — deliberately kept minimal to save credits.
            task = await client.text_to_3d(
                "a single smooth stone cube",
                output_format="glb",
                pbr=False,
                texture_quality="low",
            )
            task_id = task.get("task_id", "?")
            _print(
                f"[green]✓ Connection successful.[/green]  Task ID: [dim]{task_id}[/dim]"
                if _HAS_RICH
                else f"✓ Connection successful. Task ID: {task_id}"
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

def _build_parser() -> argparse.ArgumentParser:
    """Build and return the top-level argument parser."""
    parser = argparse.ArgumentParser(
        prog="batch_runner",
        description="'A Gift for the Forgotten City' — Tripo AI asset batch runner",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
examples:
  python -m pipeline.batch_runner test-connection
  python -m pipeline.batch_runner generate-civ --civ sky_nomads
  python -m pipeline.batch_runner generate-all --output-dir assets/models
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

    subparsers = parser.add_subparsers(dest="command", required=True)

    # test-connection
    subparsers.add_parser(
        "test-connection",
        help="Verify TRIPO_API_KEY and API reachability.",
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

    return parser


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    """Parse CLI args and dispatch to the appropriate async command handler."""
    parser = _build_parser()
    args = parser.parse_args()

    _configure_logging(verbose=args.verbose)
    api_key = _load_api_key()

    exit_code: int = 0

    if args.command == "test-connection":
        exit_code = asyncio.run(cmd_test_connection(api_key))

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
