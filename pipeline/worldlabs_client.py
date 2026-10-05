"""
pipeline/worldlabs_client.py
============================
Async Python client for the World Labs AI (Marble) API.

Provides:
  - Text-to-World / 3D model generation
  - Image-to-World / 3D model generation
  - Operation polling and lifecycle tracking
  - GLB Mesh retrieval (collider mesh, high-quality textured mesh export)
  - Streaming model downloads
  - API connectivity & authentication testing
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Optional

import aiohttp

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Custom exceptions
# ---------------------------------------------------------------------------


class WorldLabsAPIError(Exception):
    """Raised when the World Labs API returns an error response."""

    def __init__(
        self,
        status: int,
        message: str,
        operation_id: Optional[str] = None,
        code: Optional[str] = None,
        details: Optional[Any] = None,
    ):
        self.status = status
        self.operation_id = operation_id
        self.code = code
        self.details = details
        msg = f"World Labs API Error {status}: {message}"
        if operation_id:
            msg += f" (operation_id={operation_id})"
        if details:
            msg += f" | details: {details}"
        super().__init__(msg)


class WorldLabsTimeoutError(Exception):
    """Raised when an operation exceeds maximum wait time."""

    def __init__(self, operation_id: str, timeout: int):
        self.operation_id = operation_id
        self.timeout = timeout
        super().__init__(f"Operation {operation_id} timed out after {timeout}s")


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------

WORLD_LABS_BASE_URL = os.environ.get("WORLD_LABS_BASE_URL", "https://api.worldlabs.ai")
DEFAULT_MODEL = os.environ.get("WORLD_LABS_MODEL", "marble-1.1")
MAX_RETRIES = 3
RETRY_BASE_DELAY = 2.0


class WorldLabsClient:
    """Async client for World Labs AI Marble API.

    Features:
      - Text-to-3D / Text-to-World generation
      - Image-to-3D / Image-to-World generation
      - Operation polling with exponential / fixed intervals
      - GLB mesh extraction (collider & high-quality textured exports)
      - Stream downloading to local disk
      - Concurrency rate limiting
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = WORLD_LABS_BASE_URL,
        max_concurrent: int = 2,
    ):
        if not api_key or not api_key.strip():
            raise ValueError("WorldLabsClient requires a valid non-empty api_key.")
        self.api_key = api_key.strip()
        self.base_url = base_url.rstrip("/")
        self._session: Optional[aiohttp.ClientSession] = None
        self._semaphore = asyncio.Semaphore(max_concurrent)

    # ------------------------------------------------------------------
    # Session lifecycle
    # ------------------------------------------------------------------

    async def __aenter__(self) -> WorldLabsClient:
        await self._ensure_session()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        await self.close()

    async def _ensure_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            headers = {
                "WLT-Api-Key": self.api_key,
                "Content-Type": "application/json",
                "Accept": "application/json",
            }
            timeout = aiohttp.ClientTimeout(total=300, connect=30)
            self._session = aiohttp.ClientSession(
                headers=headers,
                timeout=timeout,
            )
        return self._session

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()
            self._session = None

    # ------------------------------------------------------------------
    # HTTP requests with retry
    # ------------------------------------------------------------------

    async def _request(
        self,
        method: str,
        endpoint: str,
        json_data: Optional[dict] = None,
        params: Optional[dict] = None,
    ) -> dict[str, Any]:
        session = await self._ensure_session()
        url = endpoint if endpoint.startswith("http") else f"{self.base_url}{endpoint}"

        for attempt in range(1, MAX_RETRIES + 1):
            async with self._semaphore:
                try:
                    async with session.request(
                        method=method,
                        url=url,
                        json=json_data,
                        params=params,
                    ) as resp:
                        content_type = resp.headers.get("Content-Type", "")
                        body_text = await resp.text()

                        if resp.status in (200, 201):
                            if "application/json" in content_type:
                                return json.loads(body_text)
                            return {"raw": body_text}

                        # Rate limiting (429) or temporary server errors (502, 503, 504)
                        if resp.status in (429, 502, 503, 504) and attempt < MAX_RETRIES:
                            delay = RETRY_BASE_DELAY * (2 ** (attempt - 1))
                            logger.warning(
                                "[World Labs] HTTP %d on %s, retry %d/%d in %.1fs",
                                resp.status, url, attempt, MAX_RETRIES, delay
                            )
                            await asyncio.sleep(delay)
                            continue

                        # Parse error payload
                        try:
                            error_payload = json.loads(body_text)
                            err_msg = error_payload.get("detail") or error_payload.get("message") or body_text
                        except Exception:
                            err_msg = body_text

                        raise WorldLabsAPIError(
                            status=resp.status,
                            message=str(err_msg),
                            details=body_text[:500],
                        )

                except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
                    if attempt < MAX_RETRIES:
                        delay = RETRY_BASE_DELAY * (2 ** (attempt - 1))
                        logger.warning(
                            "[World Labs] Network error (%s) on %s, retry %d/%d in %.1fs",
                            exc, url, attempt, MAX_RETRIES, delay
                        )
                        await asyncio.sleep(delay)
                        continue
                    raise WorldLabsAPIError(status=0, message=f"Network error: {exc}")

        raise WorldLabsAPIError(status=0, message="Max retries exceeded")

    # ------------------------------------------------------------------
    # Generation endpoints
    # ------------------------------------------------------------------

    async def text_to_3d(
        self,
        prompt: str,
        display_name: Optional[str] = None,
        model: str = DEFAULT_MODEL,
    ) -> dict[str, Any]:
        """Submit a text prompt to generate a 3D world / model via World Labs Marble API.

        Args:
            prompt: Descriptive text prompt.
            display_name: Human-friendly asset title.
            model: Model identifier (default: 'marble-1.1').

        Returns:
            Operation dict containing 'operation_id' and initial status.
        """
        payload = {
            "display_name": display_name or "Generated Asset",
            "model": model,
            "world_prompt": {
                "type": "text",
                "text_prompt": prompt,
            },
        }
        logger.info("[World Labs] Submitting text_to_3d: '%s'...", (display_name or prompt[:40]))
        return await self._request("POST", "/marble/v1/worlds:generate", json_data=payload)

    async def image_to_3d(
        self,
        image_url: str,
        display_name: Optional[str] = None,
        model: str = DEFAULT_MODEL,
    ) -> dict[str, Any]:
        """Submit an image to generate a 3D world / model via World Labs Marble API.

        Args:
            image_url: Public HTTP/HTTPS URL of the concept image.
            display_name: Human-friendly asset title.
            model: Model identifier (default: 'marble-1.1').

        Returns:
            Operation dict containing 'operation_id' and initial status.
        """
        payload = {
            "display_name": display_name or "Generated Asset from Image",
            "model": model,
            "world_prompt": {
                "type": "image",
                "image_url": image_url,
            },
        }
        logger.info("[World Labs] Submitting image_to_3d for: %s", display_name or image_url)
        return await self._request("POST", "/marble/v1/worlds:generate", json_data=payload)

    # ------------------------------------------------------------------
    # Operation polling & World retrieval
    # ------------------------------------------------------------------

    async def wait_for_operation(
        self,
        operation_id: str,
        timeout: int = 900,
        poll_interval: float = 6.0,
        show_progress: bool = True,
    ) -> dict[str, Any]:
        """Poll /marble/v1/operations/{operation_id} until completed or timed out.

        Args:
            operation_id: The UUID of the operation.
            timeout: Maximum wait time in seconds (default 900 = 15m).
            poll_interval: Seconds between poll requests.
            show_progress: Whether to log poll progress.

        Returns:
            Final operation dictionary with 'response' and 'metadata'.
        """
        start_time = time.monotonic()

        while True:
            elapsed = time.monotonic() - start_time
            if elapsed > timeout:
                raise WorldLabsTimeoutError(operation_id, timeout)

            data = await self._request("GET", f"/marble/v1/operations/{operation_id}")

            if data.get("error"):
                raise WorldLabsAPIError(
                    status=500,
                    message=f"Operation failed: {data['error']}",
                    operation_id=operation_id,
                )

            if data.get("done") is True:
                if show_progress:
                    logger.info("[World Labs] Operation %s completed in %.1fs", operation_id, elapsed)
                return data

            meta = data.get("metadata") or {}
            progress_info = meta.get("progress") or {}
            status_desc = progress_info.get("description") or progress_info.get("status") or "Processing"

            if show_progress:
                logger.info(
                    "[World Labs] Operation %s — %s (%.0fs elapsed)",
                    operation_id, status_desc, elapsed
                )

            await asyncio.sleep(poll_interval)

    async def get_world(self, world_id: str) -> dict[str, Any]:
        """Fetch current world status and asset URLs via /marble/v1/worlds/{world_id}."""
        return await self._request("GET", f"/marble/v1/worlds/{world_id}")

    # ------------------------------------------------------------------
    # Mesh Export & Resolution
    # ------------------------------------------------------------------

    async def export_mesh(
        self,
        world_id: str,
        asset_type: str = "mesh",
        format: str = "glb",
        timeout: int = 900,
    ) -> str:
        """Trigger and await a high-quality GLB mesh export for a completed world.

        Args:
            world_id: ID of the generated world.
            asset_type: Asset type to export (default: 'mesh').
            format: Export file format (default: 'glb').
            timeout: Timeout for export processing.

        Returns:
            Direct download URL for the exported GLB model.
        """
        logger.info("[World Labs] Requesting %s export for world %s...", format.upper(), world_id)
        export_op = await self._request(
            "POST",
            f"/marble/v1/worlds/{world_id}:export",
            json_data={"asset_type": asset_type, "format": format},
        )
        op_id = export_op.get("operation_id")
        if not op_id:
            raise WorldLabsAPIError(status=500, message="Export did not return operation_id")

        final_op = await self.wait_for_operation(op_id, timeout=timeout)
        response_data = final_op.get("response") or {}
        assets = response_data.get("assets") or {}
        mesh_assets = assets.get("mesh") or {}

        # Look for HQ mesh URL or collider mesh URL
        mesh_url = (
            mesh_assets.get("hq_mesh_url")
            or mesh_assets.get("full_res_mesh_url")
            or mesh_assets.get("collider_mesh_url")
        )
        if not mesh_url:
            # Fallback to direct world object
            world_data = await self.get_world(world_id)
            w_mesh = (world_data.get("assets") or {}).get("mesh") or {}
            mesh_url = w_mesh.get("hq_mesh_url") or w_mesh.get("collider_mesh_url")

        if not mesh_url:
            raise WorldLabsAPIError(
                status=500,
                message=f"Export completed but no GLB mesh URL found for world {world_id}",
                operation_id=op_id,
            )
        return mesh_url

    async def resolve_model_url(
        self,
        operation_result: dict[str, Any],
        mesh_type: str = "collider",
    ) -> str:
        """Resolve the download URL for a 3D GLB model from an operation or world object.

        Args:
            operation_result: The completed operation dict (or world dict).
            mesh_type: 'collider' for instantaneous collider mesh (default),
                       or 'hq' for high-quality textured mesh (triggers export if needed).

        Returns:
            Direct HTTP URL to the GLB file.
        """
        # Retrieve world_id and response assets
        resp = operation_result.get("response") or {}
        meta = operation_result.get("metadata") or {}
        world_id = resp.get("world_id") or meta.get("world_id") or operation_result.get("world_id")

        assets = resp.get("assets")
        if not assets and world_id:
            world_data = await self.get_world(world_id)
            assets = world_data.get("assets") or {}

        mesh_dict = (assets or {}).get("mesh") or {}

        if mesh_type == "hq":
            # If high-quality mesh is already ready
            if mesh_dict.get("hq_mesh_url"):
                return mesh_dict["hq_mesh_url"]
            # Trigger export
            if world_id:
                return await self.export_mesh(world_id, format="glb")

        # By default (or fallback), check collider mesh, then any mesh URL
        model_url = (
            mesh_dict.get("collider_mesh_url")
            or mesh_dict.get("hq_mesh_url")
            or mesh_dict.get("full_res_mesh_url")
        )

        if not model_url and world_id:
            # If no mesh was attached in initial assets, trigger export
            return await self.export_mesh(world_id, format="glb")

        if not model_url:
            raise WorldLabsAPIError(
                status=500,
                message="No GLB mesh URL available in World Labs response.",
                details=operation_result,
            )
        return model_url

    # ------------------------------------------------------------------
    # Download
    # ------------------------------------------------------------------

    async def download_model(
        self,
        model_url_or_result: Any,
        output_path: str,
        mesh_type: str = "collider",
    ) -> str:
        """Download GLB model to a local file.

        Args:
            model_url_or_result: A direct URL string or an operation/world dict.
            output_path: Local filesystem destination path.
            mesh_type: 'collider' or 'hq' (used if a dict is passed).

        Returns:
            Absolute path to the downloaded file.
        """
        if isinstance(model_url_or_result, dict):
            url = await self.resolve_model_url(model_url_or_result, mesh_type=mesh_type)
        elif isinstance(model_url_or_result, str):
            url = model_url_or_result
        else:
            raise ValueError(f"Invalid model source: {type(model_url_or_result)}")

        dest = Path(output_path).resolve()
        dest.parent.mkdir(parents=True, exist_ok=True)

        session = await self._ensure_session()
        logger.info("[World Labs] Downloading 3D model from %s -> %s", url[:60], dest.name)

        async with session.get(url) as resp:
            if resp.status != 200:
                raise WorldLabsAPIError(
                    status=resp.status,
                    message=f"Failed to download GLB: HTTP {resp.status}",
                )
            with open(dest, "wb") as f:
                while True:
                    chunk = await resp.content.read(64 * 1024)
                    if not chunk:
                        break
                    f.write(chunk)

        logger.info("[World Labs] Successfully saved GLB (%d bytes): %s", dest.stat().st_size, dest)
        return str(dest)

    # ------------------------------------------------------------------
    # Connection & authentication check
    # ------------------------------------------------------------------

    async def test_connection(self) -> dict[str, Any]:
        """Test API connectivity and key validity against World Labs API."""
        session = await self._ensure_session()
        # Query operations endpoint to test authentication
        url = f"{self.base_url}/marble/v1/operations/connectivity-check-probe"
        try:
            async with session.get(url) as resp:
                if resp.status == 401:
                    raise WorldLabsAPIError(
                        status=401,
                        message="Invalid World Labs API Key. Authentication failed.",
                    )
                # 404 is expected for a non-existent check probe, meaning authentication succeeded!
                if resp.status in (200, 404):
                    return {
                        "status": "connected",
                        "authenticated": True,
                        "base_url": self.base_url,
                        "model": DEFAULT_MODEL,
                    }
                body = await resp.text()
                return {
                    "status": "connected",
                    "http_status": resp.status,
                    "authenticated": True,
                    "details": body[:200],
                }
        except aiohttp.ClientError as exc:
            raise WorldLabsAPIError(status=0, message=f"Could not connect to World Labs: {exc}")
