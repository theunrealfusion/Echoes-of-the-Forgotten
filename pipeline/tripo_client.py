"""
tripo_client.py
===============
Async Python client for the Tripo AI V3 API.

Usage:
    async with TripoClient(api_key="your_key") as client:
        task = await client.text_to_3d("ancient underwater library hall, bioluminescent")
        result = await client.wait_for_task(task["task_id"])
        path = await client.download_model(result, "output/hall.glb")
"""

import asyncio
import json
import os
import time
from pathlib import Path
from typing import Any, Optional

import aiohttp

# ---------------------------------------------------------------------------
# Custom exceptions
# ---------------------------------------------------------------------------


class TripoAPIError(Exception):
    """Raised when the Tripo API returns a non-success response."""
    def __init__(self, status: int, message: str, task_id: Optional[str] = None):
        self.status = status
        self.task_id = task_id
        super().__init__(f"Tripo API Error {status}: {message}")


class TripoTimeoutError(Exception):
    """Raised when a task exceeds the maximum wait time."""
    def __init__(self, task_id: str, timeout: int):
        self.task_id = task_id
        super().__init__(f"Task {task_id} timed out after {timeout}s")


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------

TRIPO_BASE_URL = os.environ.get("TRIPO_BASE_URL", "https://openapi.tripo3d.ai/v3")
DEFAULT_MODEL = os.environ.get("TRIPO_MODEL_VERSION", "v3.0-20250812")
MAX_RETRIES = 3
RETRY_BASE_DELAY = 2.0  # seconds (doubles each retry)


class TripoClient:
    """
    Async client for the Tripo AI V3 REST API.

    Features:
    - Full pipeline: text-to-3D, image-to-3D, retopology, PBR, rigging, animation, segmentation
    - Async/await with aiohttp
    - Rate limiting: max 2 concurrent requests
    - Retry logic: 3 retries with exponential backoff
    - Context manager support
    """

    def __init__(self, api_key: str, max_concurrent: int = 2):
        """
        Initialize the Tripo client.

        Args:
            api_key: Your Tripo API key (from developers.tripo3d.ai).
            max_concurrent: Maximum simultaneous API requests (default 2 for safety).
        """
        self.api_key = api_key
        self.base_url = TRIPO_BASE_URL
        self._session: Optional[aiohttp.ClientSession] = None
        self._semaphore = asyncio.Semaphore(max_concurrent)

    # ------------------------------------------------------------------
    # Session lifecycle
    # ------------------------------------------------------------------

    async def _get_session(self) -> aiohttp.ClientSession:
        """Return or create the shared aiohttp session."""
        if self._session is None or self._session.closed:
            timeout = aiohttp.ClientTimeout(total=60, connect=10)
            self._session = aiohttp.ClientSession(
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                },
                timeout=timeout,
            )
        return self._session

    async def close(self):
        """Close the aiohttp session and release resources."""
        if self._session and not self._session.closed:
            await self._session.close()
            self._session = None

    async def __aenter__(self) -> "TripoClient":
        await self._get_session()
        return self

    async def __aexit__(self, *args):
        await self.close()

    # ------------------------------------------------------------------
    # Core HTTP helpers
    # ------------------------------------------------------------------

    async def _request(
        self,
        method: str,
        endpoint: str,
        **kwargs,
    ) -> dict[str, Any]:
        """
        Make an authenticated request with retry logic.

        Args:
            method: HTTP method (GET, POST).
            endpoint: API endpoint path (e.g. "/generation/text-to-model").
            **kwargs: Additional arguments passed to aiohttp request.

        Returns:
            Parsed JSON response body.

        Raises:
            TripoAPIError: On non-200 HTTP responses.
        """
        session = await self._get_session()
        url = f"{self.base_url}{endpoint}"
        
        headers = kwargs.pop("headers", {})
        if "Content-Type" not in headers:
            headers["Content-Type"] = "application/json"
        kwargs["headers"] = headers

        for attempt in range(MAX_RETRIES + 1):
            try:
                async with self._semaphore:
                    async with session.request(method, url, **kwargs) as resp:
                        body = await resp.json(content_type=None)

                        if resp.status == 200:
                            # Tripo wraps results in {"code": 0, "data": {...}}
                            if isinstance(body, dict) and body.get("code") == 0:
                                return body.get("data", body)
                            elif isinstance(body, dict) and "code" in body and body["code"] != 0:
                                raise TripoAPIError(
                                    resp.status,
                                    body.get("message", "Unknown error"),
                                )
                            return body

                        elif resp.status in (429, 503) and attempt < MAX_RETRIES:
                            delay = RETRY_BASE_DELAY * (2 ** attempt)
                            print(f"  ⏳ Rate limited / server busy. Retrying in {delay:.0f}s...")
                            await asyncio.sleep(delay)
                            continue

                        else:
                            raise TripoAPIError(resp.status, str(body))

            except aiohttp.ClientError as e:
                if attempt < MAX_RETRIES:
                    delay = RETRY_BASE_DELAY * (2 ** attempt)
                    print(f"  🔄 Network error ({e}). Retrying in {delay:.0f}s...")
                    await asyncio.sleep(delay)
                else:
                    raise

        raise TripoAPIError(0, "Max retries exceeded")

    # ------------------------------------------------------------------
    # Task management
    # ------------------------------------------------------------------

    async def get_balance(self) -> dict[str, Any]:
        """
        Retrieve account balance and credit status.

        Returns:
            Dict containing 'balance' and 'frozen' credit counts.
        """
        return await self._request("GET", "/account/balance")

    async def get_task(self, task_id: str) -> dict[str, Any]:
        """
        Retrieve the status and result of a task.

        Args:
            task_id: The task ID returned by a generation endpoint.

        Returns:
            Task status dict with keys: task_id, status, output, progress, etc.
        """
        return await self._request("GET", f"/tasks/{task_id}")

    async def wait_for_task(
        self,
        task_id: str,
        poll_interval: float = 3.0,
        timeout: int = 300,
        show_progress: bool = True,
    ) -> dict[str, Any]:
        """
        Poll a task until it completes or times out.

        Args:
            task_id: The task ID to poll.
            poll_interval: Seconds between status checks.
            timeout: Maximum seconds to wait.
            show_progress: Print progress dots.

        Returns:
            Completed task dict (status == "success").

        Raises:
            TripoAPIError: If the task status is "failed".
            TripoTimeoutError: If the task doesn't complete within timeout.
        """
        deadline = time.monotonic() + timeout
        dots = 0

        while time.monotonic() < deadline:
            task = await self.get_task(task_id)
            status = task.get("status", "unknown")

            if status == "success":
                if show_progress:
                    print(f" ✅ Done!")
                return task
            elif status in ("failed", "cancelled"):
                raise TripoAPIError(
                    0,
                    f"Task {task_id} failed: {task.get('message', 'Unknown reason')}",
                    task_id=task_id,
                )
            elif status in ("running", "queued", "pending"):
                if show_progress:
                    progress = task.get("progress", 0)
                    print(f"\r  ⏳ [{task_id[:8]}] {status} {progress}%... ", end="", flush=True)
            else:
                print(f"\r  ❓ Unknown status: {status}", end="", flush=True)

            await asyncio.sleep(poll_interval)

        raise TripoTimeoutError(task_id, timeout)

    async def download_model(
        self,
        task_result: dict[str, Any],
        output_path: str,
    ) -> str:
        """
        Download the generated 3D model file from a completed task.

        Args:
            task_result: Completed task dict (from wait_for_task).
            output_path: Local path to save the file.

        Returns:
            Absolute path to the saved file.
        """
        # Find the download URL in the task output
        output = task_result.get("output", {})
        url = (
            output.get("model")
            or output.get("pbr_model")
            or output.get("model_url")
            or output.get("url")
        )

        if not url:
            raise TripoAPIError(0, f"No download URL in task result: {list(output.keys())}")

        out = Path(output_path)
        out.parent.mkdir(parents=True, exist_ok=True)

        session = await self._get_session()
        async with session.get(url) as resp:
            if resp.status != 200:
                raise TripoAPIError(resp.status, f"Failed to download model from {url}")
            data = await resp.read()
            out.write_bytes(data)

        return str(out.absolute())

    # ------------------------------------------------------------------
    # Generation endpoints
    # ------------------------------------------------------------------

    async def text_to_3d(
        self,
        prompt: str,
        output_format: str = "glb",
        texture: bool = True,
        pbr: bool = True,
        texture_quality: str = "detailed",
        negative_prompt: str = "",
        model: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Generate a 3D model from a text prompt.

        Args:
            prompt: Text description of the 3D asset to generate.
            output_format: Output file format ('glb', 'fbx', 'obj', 'stl', 'usdz').
            texture: Whether to generate texture maps (default: True).
            pbr: Whether to generate PBR material maps (forces texture=True).
            texture_quality: Texture resolution ('standard', 'detailed', 'extreme').
            negative_prompt: Things to avoid in the generation.
            model: Optional model version override (e.g. 'v3.0-20250812', 'v3.1-20260211').

        Returns:
            Task dict with task_id for polling.
        """
        if pbr:
            texture = True

        payload: dict[str, Any] = {
            "model": model or DEFAULT_MODEL,
            "prompt": prompt,
            "output_format": output_format,
            "texture": texture,
            "pbr": pbr,
        }

        # Include texture_quality only if textures are enabled
        if texture:
            if texture_quality == "fast":
                # Tripo requirement: texture_quality 'fast' requires texture model 'v3.5-20260815'
                payload["texture"] = "v3.5-20260815"
                payload["texture_quality"] = "fast"
            elif texture_quality in ("standard", "detailed", "extreme"):
                payload["texture_quality"] = texture_quality
            elif texture_quality:
                payload["texture_quality"] = texture_quality

        if negative_prompt:
            payload["negative_prompt"] = negative_prompt

        return await self._request(
            "POST",
            "/generation/text-to-model",
            json=payload,
        )

    async def image_to_3d(
        self,
        image_path: str,
        output_format: str = "glb",
        texture: bool = True,
        pbr: bool = True,
        texture_quality: str = "detailed",
        model: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Generate a 3D model from a reference image.

        Args:
            image_path: Local path to the image file (PNG/JPG).
            output_format: Output file format ('glb', 'fbx', 'obj', 'stl', 'usdz').
            texture: Whether to generate texture maps (default: True).
            pbr: Whether to generate PBR textures (default: True).
            texture_quality: Texture resolution ('standard', 'detailed', 'extreme').
            model: Optional model version override.

        Returns:
            Task dict with task_id for polling.
        """
        # Step 1: Upload the image to get a file_token
        img_path = Path(image_path)
        if not img_path.exists():
            raise FileNotFoundError(f"Image not found: {image_path}")

        session = await self._get_session()

        # Upload image
        form = aiohttp.FormData()
        form.add_field("file", open(image_path, "rb"), filename=img_path.name, content_type="image/png")

        async with self._semaphore:
            async with session.post(
                f"{self.base_url}/files",
                data=form,
            ) as resp:
                upload_result = await resp.json(content_type=None)

        file_token = (
            upload_result.get("data", {}).get("file_token")
            or upload_result.get("file_token")
            or upload_result.get("data", {}).get("image_token")
            or upload_result.get("image_token")
        )
        if not file_token:
            raise TripoAPIError(0, f"Image upload failed: {upload_result}")

        # Step 2: Submit generation task
        if pbr:
            texture = True

        payload: dict[str, Any] = {
            "model": model or DEFAULT_MODEL,
            "file": {"type": "file_token", "file_token": file_token},
            "output_format": output_format,
            "texture": texture,
            "pbr": pbr,
        }
        if texture and texture_quality:
            payload["texture_quality"] = texture_quality

        return await self._request("POST", "/generation/image-to-model", json=payload)

    # ------------------------------------------------------------------
    # Mesh processing
    # ------------------------------------------------------------------

    async def retopologize(
        self,
        draft_model_task_id: str,
        quad: bool = True,
        target_faces: int = 5000,
    ) -> dict[str, Any]:
        """
        AI-powered retopology and polygon optimization for game-ready meshes.

        Args:
            draft_model_task_id: task_id of the original text/image-to-3D task.
            quad: Use quad-based remeshing (better for rigging).
            target_faces: Target polygon count.

        Returns:
            Task dict for the retopology operation.
        """
        payload = {
            "input": draft_model_task_id,
            "quad": quad,
            "face_limit": target_faces,
        }
        return await self._request("POST", "/mesh/decimate", json=payload)

    async def generate_pbr_textures(
        self,
        original_model_task_id: str,
        retopo_task_id: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Generate PBR material maps (albedo, metallic, roughness, normal, AO).

        Args:
            original_model_task_id: task_id of the source generation task.
            retopo_task_id: Optional retopologized model task_id.

        Returns:
            Task dict for the texturing operation.
        """
        task_to_texture = retopo_task_id or original_model_task_id
        payload: dict[str, Any] = {
            "input": task_to_texture,
        }

        return await self._request("POST", "/models/texture", json=payload)

    async def segment_model(self, draft_model_task_id: str) -> dict[str, Any]:
        """
        Automatically segment a model into semantic parts (for restoration mechanic).

        Args:
            draft_model_task_id: task_id of the model to segment.

        Returns:
            Task dict with segmentation result.
        """
        return await self._request(
            "POST",
            "/mesh/segment",
            json={"input": draft_model_task_id},
        )

    # ------------------------------------------------------------------
    # Rigging & Animation
    # ------------------------------------------------------------------

    async def rig_model(self, draft_model_task_id: str) -> dict[str, Any]:
        """
        Auto-rig a humanoid or creature model.

        Args:
            draft_model_task_id: task_id of the model to rig.

        Returns:
            Task dict for the rigging operation.
        """
        return await self._request(
            "POST",
            "/animations/rig",
            json={"input": draft_model_task_id, "model": "v2.5-20260210"},
        )

    async def animate_model(
        self,
        draft_model_task_id: str,
        animation_preset: str = "walk",
    ) -> dict[str, Any]:
        """
        Apply an animation preset to a rigged model.

        Args:
            draft_model_task_id: task_id of the rigged model.
            animation_preset: Animation preset name (e.g. 'idle', 'walk', 'run').

        Returns:
            Task dict for the animation operation.
        """
        return await self._request(
            "POST",
            "/animations/retarget",
            json={
                "input": draft_model_task_id,
                "animation": animation_preset,
            },
        )

    async def check_rig_compatibility(self, draft_model_task_id: str) -> bool:
        """
        Check whether a model is suitable for auto-rigging.

        Args:
            draft_model_task_id: task_id of the model to check.

        Returns:
            True if the model can be rigged, False otherwise.
        """
        try:
            result = await self._request(
                "POST",
                "/animations/rig-check",
                json={"input": draft_model_task_id}
            )
            return result.get("riggable", False)
        except TripoAPIError:
            return False

    # ------------------------------------------------------------------
    # Convenience: full pipeline
    # ------------------------------------------------------------------

    async def full_pipeline(
        self,
        prompt: str,
        output_path: str,
        optimize: bool = True,
        show_progress: bool = True,
    ) -> str:
        """
        Run the complete asset pipeline: text-to-3D → retopo → PBR → download.

        Args:
            prompt: Text description of the 3D asset.
            output_path: Where to save the final GLB.
            optimize: Apply retopology and PBR baking.
            show_progress: Print progress info.

        Returns:
            Path to the downloaded, optimized GLB file.
        """
        if show_progress:
            print(f"  🎨 Generating: {prompt[:60]}...")

        # Step 1: Generate
        task = await self.text_to_3d(prompt)
        task_id = task["task_id"]
        result = await self.wait_for_task(task_id, show_progress=show_progress)

        if not optimize:
            return await self.download_model(result, output_path)

        # Step 2: Retopology
        if show_progress:
            print(f"  🔧 Retopologizing...")
        retopo_task = await self.retopologize(task_id)
        retopo_result = await self.wait_for_task(retopo_task["task_id"], show_progress=show_progress)

        # Step 3: PBR textures on retopo'd mesh
        if show_progress:
            print(f"  🎨 Baking PBR textures...")
        pbr_task = await self.generate_pbr_textures(
            original_model_task_id=task_id,
            retopo_task_id=retopo_result["task_id"],
        )
        pbr_result = await self.wait_for_task(pbr_task["task_id"], show_progress=show_progress)

        # Step 4: Download
        path = await self.download_model(pbr_result, output_path)
        if show_progress:
            print(f"  💾 Saved: {path}")
        return path
