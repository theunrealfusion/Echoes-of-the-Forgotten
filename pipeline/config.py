"""
pipeline/config.py
==================
Centralized configuration manager for 3D model generation in 'A Gift for the Forgotten City'.

Supports switching between Tripo3D API and World Labs API via:
  1. Config file (pipeline/config.json)
  2. Environment variables (.env: MODEL_PROVIDER=tripo or MODEL_PROVIDER=worldlab)
  3. CLI flags (--provider tripo / --provider worldlab)
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Optional

try:
    from dotenv import load_dotenv
    _HAS_DOTENV = True
except ImportError:
    _HAS_DOTENV = False

# Ensure .env is loaded if present
if _HAS_DOTENV:
    env_path = Path(".env")
    if env_path.exists():
        load_dotenv(dotenv_path=env_path)
    else:
        for parent in Path.cwd().parents:
            candidate = parent / ".env"
            if candidate.exists():
                load_dotenv(dotenv_path=candidate)
                break

DEFAULT_CONFIG_PATH = Path(__file__).resolve().parent / "config.json"

DEFAULT_CONFIG: dict[str, Any] = {
    "provider": "tripo",
    "output_dir": "assets/models",
    "tripo": {
        "base_url": "https://openapi.tripo3d.ai/v3",
        "model_version": "v3.1-20260211",
        "retopology": True,
        "target_faces": 5000,
        "pbr": True,
    },
    "worldlab": {
        "base_url": "https://api.worldlabs.ai",
        "model": "marble-1.1",
        "mesh_type": "collider",  # "collider" (fast, available immediately) or "hq" (high quality textured export)
        "export_format": "glb",
        "timeout_seconds": 900,
    },
}

SUPPORTED_PROVIDERS = ("tripo", "worldlab")


def load_config(config_path: Optional[str | Path] = None) -> dict[str, Any]:
    """Load and merge configuration from JSON file and environment variables.

    Precedence:
      1. Explicit environment variables (e.g. MODEL_PROVIDER, WORLD_LABS_API_KEY)
      2. Config file (default: pipeline/config.json)
      3. Built-in defaults
    """
    path = Path(config_path) if config_path else DEFAULT_CONFIG_PATH
    config = json.loads(json.dumps(DEFAULT_CONFIG))

    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                user_config = json.load(f)
                if isinstance(user_config, dict):
                    # Shallow merge top-level
                    for k, v in user_config.items():
                        if k in config and isinstance(config[k], dict) and isinstance(v, dict):
                            config[k].update(v)
                        else:
                            config[k] = v
        except Exception:
            pass

    # Environment variable overrides
    env_provider = os.environ.get("MODEL_PROVIDER") or os.environ.get("ASSET_MODEL_PROVIDER")
    if env_provider:
        env_provider = env_provider.strip().lower()
        if env_provider in SUPPORTED_PROVIDERS:
            config["provider"] = env_provider

    if os.environ.get("ASSET_OUTPUT_DIR"):
        config["output_dir"] = os.environ["ASSET_OUTPUT_DIR"].strip()

    # Tripo overrides
    if os.environ.get("TRIPO_BASE_URL"):
        config["tripo"]["base_url"] = os.environ["TRIPO_BASE_URL"].strip()
    if os.environ.get("TRIPO_MODEL_VERSION"):
        config["tripo"]["model_version"] = os.environ["TRIPO_MODEL_VERSION"].strip()

    # World Labs overrides
    if os.environ.get("WORLD_LABS_BASE_URL"):
        config["worldlab"]["base_url"] = os.environ["WORLD_LABS_BASE_URL"].strip()
    if os.environ.get("WORLD_LABS_MODEL"):
        config["worldlab"]["model"] = os.environ["WORLD_LABS_MODEL"].strip()
    if os.environ.get("WORLD_LABS_MESH_TYPE"):
        config["worldlab"]["mesh_type"] = os.environ["WORLD_LABS_MESH_TYPE"].strip().lower()

    return config


def get_active_provider(override: Optional[str] = None) -> str:
    """Return the currently active 3D model provider ('tripo' or 'worldlab')."""
    if override:
        provider = override.strip().lower()
        if provider in SUPPORTED_PROVIDERS:
            return provider
        raise ValueError(
            f"Unsupported provider: '{override}'. Supported: {', '.join(SUPPORTED_PROVIDERS)}"
        )
    config = load_config()
    return config.get("provider", "tripo").strip().lower()


def get_api_key(provider: Optional[str] = None) -> str:
    """Resolve the API key for the specified provider (or active provider).

    For 'tripo': reads TRIPO_API_KEY.
    For 'worldlab': reads WORLD_LABS_API_KEY (or WORLDLAB_API_KEY).
    """
    prov = get_active_provider(provider)
    if prov == "worldlab":
        key = os.environ.get("WORLD_LABS_API_KEY", "") or os.environ.get("WORLDLAB_API_KEY", "")
        if not key:
            raise ValueError(
                "WORLD_LABS_API_KEY not found in environment or .env file.\n"
                "Please add: WORLD_LABS_API_KEY=your_key_here to your .env"
            )
        return key

    key = os.environ.get("TRIPO_API_KEY", "")
    if not key:
        raise ValueError(
            "TRIPO_API_KEY not found in environment or .env file.\n"
            "Please add: TRIPO_API_KEY=your_key_here to your .env"
        )
    return key


def get_provider_config(provider: Optional[str] = None) -> dict[str, Any]:
    """Return provider-specific configuration dict."""
    prov = get_active_provider(provider)
    config = load_config()
    return config.get(prov, {})


def set_active_provider(provider: str, save_to_file: bool = False, config_path: Optional[str | Path] = None) -> None:
    """Set the active provider in memory (and optionally persist to pipeline/config.json)."""
    prov = provider.strip().lower()
    if prov not in SUPPORTED_PROVIDERS:
        raise ValueError(
            f"Unsupported provider '{provider}'. Must be one of: {', '.join(SUPPORTED_PROVIDERS)}"
        )
    os.environ["MODEL_PROVIDER"] = prov

    if save_to_file:
        path = Path(config_path) if config_path else DEFAULT_CONFIG_PATH
        config = load_config(path)
        config["provider"] = prov
        with open(path, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2)
