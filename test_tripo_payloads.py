import asyncio
import os
from dotenv import load_dotenv
from pipeline.tripo_client import TripoClient

load_dotenv()

async def test():
    api_key = os.environ.get("TRIPO_API_KEY")
    if not api_key:
        print("No TRIPO_API_KEY found")
        return

    async with TripoClient(api_key) as client:
        # Generate a very fast, low-quality draft to use its task_id
        print("Generating a quick draft...")
        draft_task = await client.text_to_3d("a cube", texture=False, pbr=False)
        draft_id = draft_task["task_id"]
        await client.wait_for_task(draft_id)
        
        print(f"Draft task ID: {draft_id}")

        # Test 1: Current format
        print("\nTest 1: current format")
        payload1 = {
            "input": {"type": "task_id", "task_id": draft_id},
        }
        try:
            res = await client._request("POST", "/mesh/decimate", json=payload1)
            print("Test 1 success:", res)
        except Exception as e:
            print("Test 1 failed:", e)

        # Test 2: format 2 (direct string?)
        print("\nTest 2: direct string input")
        payload2 = {
            "input": draft_id
        }
        try:
            res = await client._request("POST", "/mesh/decimate", json=payload2)
            print("Test 2 success:", res)
        except Exception as e:
            print("Test 2 failed:", e)

        # Test 3: format 3 (input with just task_id)
        print("\nTest 3: input object without 'type'")
        payload3 = {
            "input": {"task_id": draft_id}
        }
        try:
            res = await client._request("POST", "/mesh/decimate", json=payload3)
            print("Test 3 success:", res)
        except Exception as e:
            print("Test 3 failed:", e)
            
        # Test 4: format 4 (file_token, just to see if it complains about type)
        print("\nTest 4: model_task_id directly (no input)")
        payload4 = {
            "task_id": draft_id
        }
        try:
            res = await client._request("POST", "/mesh/decimate", json=payload4)
            print("Test 4 success:", res)
        except Exception as e:
            print("Test 4 failed:", e)

if __name__ == "__main__":
    asyncio.run(test())
