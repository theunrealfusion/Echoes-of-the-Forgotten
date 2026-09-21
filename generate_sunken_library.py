import asyncio
import sys

from pipeline.batch_runner import cmd_generate_civ, _load_api_key

async def main():
    api_key = _load_api_key()
    exit_code = await cmd_generate_civ(
        api_key=api_key,
        civ_name="sunken_library",
        output_dir="assets/models"
    )
    sys.exit(exit_code)

if __name__ == "__main__":
    asyncio.run(main())
