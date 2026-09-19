"""Unit and regression tests for Tripo V3 pipeline batch runner and prompt validation.

Tests behavior of prompt validation rules, dry-run simulation mode, and error handling.
"""

import unittest
from unittest.mock import patch
from pipeline import asset_generator
from pipeline.batch_runner import validate_prompt, run_dry_run, get_all_prompts


class TestPromptValidation(unittest.TestCase):
    """Test suite for validate_prompt function behavior and edge cases."""

    def test_validate_prompt_with_empty_or_whitespace_string_returns_failure(self):
        """If prompt is empty, None, or whitespace, validation must fail with clear error."""
        for empty_val in ["", "   \n\t  ", None]:
            is_valid, issues = validate_prompt(empty_val)
            self.assertFalse(is_valid)
            self.assertTrue(any("empty" in issue.lower() for issue in issues))

    def test_validate_prompt_below_minimum_length_boundary_fails(self):
        """Prompts shorter than 100 characters fail with minimum threshold message."""
        short_prompt = "Isolated 3D model with clean mesh and PBR textures."
        self.assertLess(len(short_prompt), 100)
        is_valid, issues = validate_prompt(short_prompt)
        self.assertFalse(is_valid)
        self.assertTrue(any("below minimum threshold" in issue for issue in issues))

    def test_validate_prompt_above_maximum_length_boundary_fails(self):
        """Prompts longer than 600 characters fail with maximum threshold message."""
        long_prompt = "Isolated 3D model with clean mesh and PBR textures. " * 20
        self.assertGreater(len(long_prompt), 600)
        is_valid, issues = validate_prompt(long_prompt)
        self.assertFalse(is_valid)
        self.assertTrue(any("exceeds maximum threshold" in issue for issue in issues))

    def test_validate_prompt_missing_isolation_directive_fails(self):
        """Prompts missing mesh isolation directives must fail validation."""
        prompt = (
            "An ancient underwater archive building with weathered verdigris bronze reliefs, "
            "spiral coral buttresses, luminous glyph script bands, and detailed 4k PBR materials "
            "with normal maps for realistic rendering in game engine."
        )
        self.assertGreaterEqual(len(prompt), 100)
        is_valid, issues = validate_prompt(prompt)
        self.assertFalse(is_valid)
        self.assertTrue(any("isolation directive" in issue for issue in issues))

    def test_validate_prompt_missing_pbr_directive_fails(self):
        """Prompts missing PBR/texture directives must fail validation."""
        prompt = (
            "The Grand Archive of Ael-Maris, grand main hall of the ancient underwater scholar "
            "civilization. Drowned monumental stone repository structure with soaring spiral "
            "towers encrusted with bioluminescent deep-sea coral formations, isolated 3D model, "
            "game-ready clean mesh."
        )
        self.assertGreaterEqual(len(prompt), 100)
        is_valid, issues = validate_prompt(prompt)
        self.assertFalse(is_valid)
        self.assertTrue(any("PBR/texture directive" in issue for issue in issues))

    def test_validate_prompt_with_forbidden_snake_case_civilization_id_fails(self):
        """Prompts containing raw snake_case IDs like sunken_library must fail validation."""
        prompt = (
            "A magnificent hero structure designed for the sunken_library civilization with "
            "spiral towers and luminous coral decorations, isolated 3D model, clean mesh, PBR textures."
        )
        is_valid, issues = validate_prompt(prompt)
        self.assertFalse(is_valid)
        self.assertTrue(any("snake_case" in issue for issue in issues))

    def test_validate_prompt_small_prop_with_scale_bleeding_architectural_terms_fails(self):
        """Small props (artifact, vegetation) must not inherit monumental room-scale architectural terms."""
        prop_prompt = (
            "An ancient handheld ceremonial relic talisman featuring miniature cathedral arches "
            "and monumental rotunda details, isolated single object, game-ready 3D model, 4k PBR textures."
        )
        is_valid, issues = validate_prompt(prop_prompt, asset_type="artifact")
        self.assertFalse(is_valid)
        self.assertTrue(any("scale-bleeding" in issue for issue in issues))

    def test_validate_prompt_with_mesh_contaminating_atmospheric_terms_fails(self):
        """Atmospheric noise terms (god rays, volumetric fog) must fail validation."""
        prompt = (
            "A celestial floating observatory pavilion with god rays and volumetric fog swirling "
            "around crystalline pillars, isolated 3D model, game-ready clean mesh, 4k PBR textures."
        )
        is_valid, issues = validate_prompt(prompt)
        self.assertFalse(is_valid)
        self.assertTrue(any("atmospheric term" in issue for issue in issues))

    def test_all_25_production_prompts_pass_validation(self):
        """All 25 production civilization asset prompts must pass genuine validation."""
        all_prompts = get_all_prompts()
        total_assets = 0
        for civ_name, civ_data in all_prompts.items():
            for asset_type, asset_info in civ_data.items():
                total_assets += 1
                prompt = asset_info.get("prompt", "")
                is_valid, issues = validate_prompt(prompt, asset_type=asset_type)
                self.assertTrue(
                    is_valid,
                    f"Production asset '{asset_info.get('name')}' in '{civ_name}' failed validation: {issues}",
                )
        self.assertEqual(total_assets, 25, "Expected exactly 25 production assets across 5 civilizations")


class TestDryRunBehavior(unittest.TestCase):
    """Test suite for run_dry_run exit codes and reporting."""

    def test_run_dry_run_returns_zero_on_production_prompts(self):
        """Dry-run on unmodified production prompts must exit with code 0."""
        ret = run_dry_run()
        self.assertEqual(ret, 0, "run_dry_run() should return 0 when all prompts pass")

    def test_run_dry_run_returns_one_on_invalid_prompt(self):
        """Dry-run must catch invalid prompt and exit with code 1."""
        original_prompt = asset_generator.CIVILIZATION_ASSETS["sunken_library"]["main_building"]["prompt"]
        try:
            asset_generator.CIVILIZATION_ASSETS["sunken_library"]["main_building"]["prompt"] = "bad short prompt"
            ret = run_dry_run(zone_filter="sunken_library")
            self.assertEqual(ret, 1, "run_dry_run() should return 1 when a prompt fails validation")
        finally:
            asset_generator.CIVILIZATION_ASSETS["sunken_library"]["main_building"]["prompt"] = original_prompt


from unittest.mock import AsyncMock, patch


class TestTestConnection(unittest.IsolatedAsyncioTestCase):
    """Test suite for cmd_test_connection command handler."""

    @patch("pipeline.batch_runner.TripoClient")
    async def test_cmd_test_connection_success(self, mock_client_cls):
        """cmd_test_connection should query get_balance and return 0 on success."""
        from pipeline.batch_runner import cmd_test_connection

        mock_instance = mock_client_cls.return_value
        mock_instance.__aenter__.return_value = mock_instance
        mock_instance.get_balance = AsyncMock(return_value={"balance": 23080.0, "frozen": 0.0})

        exit_code = await cmd_test_connection("fake-api-key")
        self.assertEqual(exit_code, 0)
        mock_instance.get_balance.assert_awaited_once()

    @patch("pipeline.batch_runner.TripoClient")
    async def test_cmd_test_connection_api_error(self, mock_client_cls):
        """cmd_test_connection should return 1 on TripoAPIError."""
        from pipeline.batch_runner import cmd_test_connection
        from pipeline.tripo_client import TripoAPIError

        mock_instance = mock_client_cls.return_value
        mock_instance.__aenter__.return_value = mock_instance
        mock_instance.get_balance = AsyncMock(side_effect=TripoAPIError(401, "Invalid API key"))

        exit_code = await cmd_test_connection("bad-api-key")
        self.assertEqual(exit_code, 1)


class TestTripoClientPayload(unittest.IsolatedAsyncioTestCase):
    """Test suite for TripoClient request payload construction."""

    @patch.object(asset_generator.TripoClient, "_request")
    async def test_text_to_3d_payload_structure(self, mock_request):
        """text_to_3d should construct valid Tripo V3 payload with texture and pbr flags."""
        client = asset_generator.TripoClient(api_key="dummy")
        mock_request.return_value = {"task_id": "task_123"}

        await client.text_to_3d("a stone cube", pbr=True, texture_quality="detailed")

        mock_request.assert_awaited_once()
        args, kwargs = mock_request.call_args
        self.assertEqual(args[0], "POST")
        self.assertEqual(args[1], "/generation/text-to-model")
        payload = kwargs["json"]
        self.assertEqual(payload["prompt"], "a stone cube")
        self.assertTrue(payload["texture"])
        self.assertTrue(payload["pbr"])
        self.assertEqual(payload["texture_quality"], "detailed")

    @patch.object(asset_generator.TripoClient, "_request")
    async def test_text_to_3d_fast_texture_quality_pins_texture_version(self, mock_request):
        """texture_quality='fast' must pin texture_version, not replace texture's boolean."""
        client = asset_generator.TripoClient(api_key="dummy")
        mock_request.return_value = {"task_id": "task_123"}

        await client.text_to_3d("a stone cube", texture_quality="fast")

        mock_request.assert_awaited_once()
        payload = mock_request.call_args[1]["json"]
        self.assertTrue(payload["texture"])
        self.assertEqual(payload["texture_version"], "v3.5-20260815")
        self.assertEqual(payload["texture_quality"], "fast")


if __name__ == "__main__":
    unittest.main()
