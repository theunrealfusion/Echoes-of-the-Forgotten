"""
Unit tests for World Labs API client and unified pipeline configuration.
"""

import asyncio
import json
import os
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from pipeline import config
from pipeline.worldlabs_client import (
    WorldLabsAPIError,
    WorldLabsClient,
    WorldLabsTimeoutError,
)
from pipeline.batch_runner import _load_api_key, cmd_test_connection


class TestPipelineConfig(unittest.TestCase):
    """Test suite for pipeline/config.py."""

    def setUp(self):
        self._orig_env = dict(os.environ)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._orig_env)

    def test_default_provider_is_tripo(self):
        os.environ.pop("MODEL_PROVIDER", None)
        os.environ.pop("ASSET_MODEL_PROVIDER", None)
        self.assertEqual(config.get_active_provider(), "tripo")

    def test_env_override_provider_to_worldlab(self):
        os.environ["MODEL_PROVIDER"] = "worldlab"
        self.assertEqual(config.get_active_provider(), "worldlab")

    def test_override_argument_precedence(self):
        os.environ["MODEL_PROVIDER"] = "tripo"
        self.assertEqual(config.get_active_provider("worldlab"), "worldlab")

    def test_invalid_provider_raises_error(self):
        with self.assertRaises(ValueError):
            config.get_active_provider("unsupported_ai")

    def test_get_api_key_worldlab(self):
        os.environ["WORLD_LABS_API_KEY"] = "wlt_test_secret_123"
        key = config.get_api_key("worldlab")
        self.assertEqual(key, "wlt_test_secret_123")

    def test_get_api_key_missing_raises_value_error(self):
        os.environ.pop("WORLD_LABS_API_KEY", None)
        os.environ.pop("WORLDLAB_API_KEY", None)
        with self.assertRaises(ValueError):
            config.get_api_key("worldlab")

    def test_set_active_provider(self):
        config.set_active_provider("worldlab")
        self.assertEqual(os.environ.get("MODEL_PROVIDER"), "worldlab")


class TestWorldLabsClient(unittest.IsolatedAsyncioTestCase):
    """Test suite for pipeline/worldlabs_client.py."""

    async def test_client_init_requires_key(self):
        with self.assertRaises(ValueError):
            WorldLabsClient(api_key="")

    async def test_text_to_3d_submits_correct_payload(self):
        client = WorldLabsClient(api_key="test_key")
        client._request = AsyncMock(return_value={"operation_id": "op-12345", "done": False})

        res = await client.text_to_3d("crystal palace above clouds", display_name="Cloud Palace")
        self.assertEqual(res["operation_id"], "op-12345")
        client._request.assert_awaited_once_with(
            "POST",
            "/marble/v1/worlds:generate",
            json_data={
                "display_name": "Cloud Palace",
                "model": "marble-1.1",
                "world_prompt": {
                    "type": "text",
                    "text_prompt": "crystal palace above clouds",
                },
            },
        )
        await client.close()

    async def test_wait_for_operation_success(self):
        client = WorldLabsClient(api_key="test_key")
        mock_responses = [
            {"done": False, "metadata": {"progress": {"status": "IN_PROGRESS"}}},
            {
                "done": True,
                "response": {
                    "world_id": "world-999",
                    "assets": {
                        "mesh": {"collider_mesh_url": "https://cdn.worldlabs.ai/collider.glb"}
                    },
                },
            },
        ]
        client._request = AsyncMock(side_effect=mock_responses)

        result = await client.wait_for_operation("op-123", timeout=10, poll_interval=0.01, show_progress=False)
        self.assertTrue(result["done"])
        self.assertEqual(result["response"]["world_id"], "world-999")
        await client.close()

    async def test_wait_for_operation_error_raises_api_error(self):
        client = WorldLabsClient(api_key="test_key")
        client._request = AsyncMock(return_value={
            "done": True,
            "error": {"code": 500, "message": "Failed internal render"}
        })

        with self.assertRaises(WorldLabsAPIError):
            await client.wait_for_operation("op-fail", timeout=10, poll_interval=0.01, show_progress=False)
        await client.close()

    async def test_resolve_model_url_collider(self):
        client = WorldLabsClient(api_key="test_key")
        op_data = {
            "response": {
                "assets": {
                    "mesh": {
                        "collider_mesh_url": "https://cdn.worldlabs.ai/collider.glb",
                        "hq_mesh_url": "https://cdn.worldlabs.ai/hq.glb",
                    }
                }
            }
        }
        url = await client.resolve_model_url(op_data, mesh_type="collider")
        self.assertEqual(url, "https://cdn.worldlabs.ai/collider.glb")
        await client.close()

    @patch("pipeline.batch_runner.WorldLabsClient")
    async def test_cmd_test_connection_worldlab_success(self, mock_worldlabs_cls):
        mock_instance = AsyncMock()
        mock_worldlabs_cls.return_value.__aenter__.return_value = mock_instance
        mock_instance.test_connection = AsyncMock(return_value={
            "status": "connected",
            "base_url": "https://api.worldlabs.ai",
            "model": "marble-1.1",
        })

        code = await cmd_test_connection(api_key="test_wlt_key", provider="worldlab")
        self.assertEqual(code, 0)
        mock_instance.test_connection.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
