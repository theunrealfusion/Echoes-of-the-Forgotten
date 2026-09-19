import asyncio
import os
import sys
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass
from pipeline.tripo_client import TripoClient

async def main():
    api_key = os.environ.get("TRIPO_API_KEY")
    if not api_key:
        print("TRIPO_API_KEY environment variable is not set.")
        print("Please set it before running this script.")
        sys.exit(1)

    # A very short prompt to use minimal text tokens
    prompt = "a cube"
    output_path = "test_generation_output.glb"
    
    print(f"Starting test generation with prompt: '{prompt}'...")
    
    async with TripoClient(api_key) as client:
        try:
            # Setting texture=False and pbr=False uses fewer generation credits/resources,
            # keeping it minimal for testing purposes.
            print("Submitting text_to_3d task...")
            task = await client.text_to_3d(
                prompt=prompt,
                texture=False,
                pbr=False
            )
            
            task_id = task["task_id"]
            print(f"Task submitted successfully! Task ID: {task_id}")
            print("Waiting for generation to complete...")
            
            # Wait for the task to finish
            result = await client.wait_for_task(task_id, show_progress=False)
            
            print(f"\nDownloading the result to {output_path}...")
            # Download the resulting model
            saved_path = await client.download_model(result, output_path)
            
            print(f"Success! Model saved to: {saved_path}")
            
        except Exception as e:
            print(f"\nAn error occurred during generation: {e}")
            sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
