"""
Memory Visualization API Endpoints

FastAPI routes for memory snapshot retrieval and streaming.
"""

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
import asyncio
import json
from pathlib import Path
from uuid import uuid4

from kernel_manager import kernel_manager


KERNEL_SRC_PATH = (Path(__file__).parent.parent.parent.parent / "kernel-python" / "src").resolve()
KERNEL_SRC_JSON = json.dumps(str(KERNEL_SRC_PATH))


async def _execute_kernel_code(kernel_id: str, code: str) -> dict:
    """Execute code inside the isolated kernel for a notebook and return the result."""
    try:
        result = await kernel_manager.execute(code, f"memory-{uuid4()}", kernel_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Kernel execution failed: {exc}") from exc

    if not result.get("success", False):
        error_detail = result.get("error") or "Kernel reported failure"
        # Include stderr if available for better debugging
        if result.get("outputs"):
            for output in result["outputs"]:
                if output.get("type") == "stream" and output.get("stream") == "stderr":
                    error_detail += f"\nStderr: {output.get('data')}"
        raise HTTPException(status_code=500, detail=error_detail)

    return result


def _extract_stdout_json(result: dict) -> object:
    """Extract first JSON payload from kernel stdout."""
    stdout_chunks = []
    
    # First try to get stdout from outputs array
    for output in result.get("outputs", []):
        if output.get("type") == "stream" and output.get("stream") == "stdout":
            stdout_chunks.append(output.get("data", ""))
    
    # Then check for single output field
    if not stdout_chunks and result.get("output"):
        stdout_chunks.append(result.get("output", ""))
    
    stdout_text = "".join(stdout_chunks).strip()

    if not stdout_text:
        # Debug: Show what we got
        raise HTTPException(
            status_code=500, 
            detail=f"Kernel did not return any data. Result keys: {list(result.keys())}. Success: {result.get('success')}"
        )

    # Try to find and parse a JSON object from the output
    # This handles cases where there's extra output mixed with JSON
    lines = stdout_text.splitlines()
    
    # Try each line in reverse order (JSON is likely to be at the end)
    for line in reversed(lines):
        line = line.strip()
        if not line:
            continue
        try:
            # Try to parse this line as JSON
            return json.loads(line)
        except json.JSONDecodeError:
            continue
    
    # If no valid JSON found in individual lines, try the whole text
    try:
        return json.loads(stdout_text)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to parse kernel output as JSON: {exc}. Output was: {stdout_text[:200]}"
        ) from exc

router = APIRouter(prefix="/api/memory", tags=["memory"])


@router.get("/snapshot")
async def get_memory_snapshot(
    kernel_id: str,
    method: str = "umap",
    force_refresh: bool = False
):
    """
    Get current memory snapshot for a kernel.
    
    Args:
        kernel_id: Kernel instance ID
        method: Dimensionality reduction method ('umap' or 'pca')
        force_refresh: Force recomputation of embedding
        
    Returns:
        MemorySnapshot as JSON
    """
    refresh_stmt = "collector.clear_registry()\n" if force_refresh else ""
    code = f"""
import sys, json, warnings, traceback
warnings.filterwarnings('ignore')
_kernel_src = {KERNEL_SRC_JSON}
if _kernel_src not in sys.path:
    sys.path.insert(0, _kernel_src)

try:
    from memory_collector import get_memory_collector
    from dim_reducer import create_memory_snapshot
    
    collector = get_memory_collector()
    {refresh_stmt}variables = collector.snapshot(globals())
    snapshot = create_memory_snapshot(variables, method={json.dumps(method)})
    print(json.dumps(snapshot.to_dict()))
except Exception as e:
    print(json.dumps({{"error": str(e), "traceback": traceback.format_exc()}}))
    raise
"""

    result = await _execute_kernel_code(kernel_id, code)
    return _extract_stdout_json(result)


@router.get("/variable/{variable_name}")
async def get_variable_details(
    kernel_id: str,
    variable_name: str
):
    """
    Get detailed information about a specific variable.
    
    Args:
        kernel_id: Kernel instance ID
        variable_name: Name of the variable
        
    Returns:
        VariableMetadata as JSON
    """
    code = f"""
import sys, json, warnings
warnings.filterwarnings('ignore')
_kernel_src = {KERNEL_SRC_JSON}
if _kernel_src not in sys.path:
    sys.path.insert(0, _kernel_src)

from memory_collector import get_memory_collector

collector = get_memory_collector()
variables = collector.snapshot(globals())
var = next((v for v in variables if v.name == {json.dumps(variable_name)}), None)
print(json.dumps(var.to_dict() if var else None))
"""

    result = await _execute_kernel_code(kernel_id, code)
    data = _extract_stdout_json(result)

    if data is None:
        raise HTTPException(status_code=404, detail="Variable not found")

    return data


@router.post("/refresh")
async def refresh_memory_tracking(kernel_id: str):
    """
    Force a refresh of memory tracking.
    Clears cache and recomputes embeddings.
    
    Args:
        kernel_id: Kernel instance ID
        
    Returns:
        Success message
    """
    code = f"""
import sys
_kernel_src = {KERNEL_SRC_JSON}
if _kernel_src not in sys.path:
    sys.path.insert(0, _kernel_src)

from memory_collector import get_memory_collector

collector = get_memory_collector()
collector.clear_registry()
"""

    await _execute_kernel_code(kernel_id, code)
    return {"status": "success", "message": "Memory tracking refreshed"}


@router.websocket("/stream")
async def websocket_memory_stream(websocket: WebSocket):
    """
    WebSocket endpoint for real-time memory updates.
    
    Sends memory snapshots whenever kernel state changes.
    
    Protocol:
        Client -> Server: {"kernel_id": "...", "method": "umap", "interval_ms": 1000}
        Server -> Client: MemorySnapshot JSON every interval
    """
    await websocket.accept()
    
    try:
        # Receive configuration
        config = await websocket.receive_json()
        kernel_id = config.get('kernel_id')
        method = config.get('method', 'umap')
        interval_ms = config.get('interval_ms', 1000)
        
        if not kernel_id:
            await websocket.send_json({"error": "kernel_id required"})
            await websocket.close()
            return
        
        # Stream loop
        while True:
            try:
                code = f"""
import sys, json
_kernel_src = {KERNEL_SRC_JSON}
if _kernel_src not in sys.path:
    sys.path.insert(0, _kernel_src)

from memory_collector import get_memory_collector
from dim_reducer import create_memory_snapshot

collector = get_memory_collector()
variables = collector.snapshot(globals())
snapshot = create_memory_snapshot(variables, method={json.dumps(method)})
print(json.dumps(snapshot.to_dict()))
"""

                result = await _execute_kernel_code(kernel_id, code)
                snapshot_data = _extract_stdout_json(result)
                await websocket.send_json(snapshot_data)

                # Wait for next interval
                await asyncio.sleep(interval_ms / 1000.0)
                
            except WebSocketDisconnect:
                break
            except Exception as e:
                await websocket.send_json({"error": str(e)})
                await asyncio.sleep(1)
        
    except WebSocketDisconnect:
        pass
    finally:
        await websocket.close()
