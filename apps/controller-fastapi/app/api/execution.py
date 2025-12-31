from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List
import json
from ..core.kernel_manager import kernel_manager

router = APIRouter()

class CellExecutionRequest(BaseModel):
    cellId: str
    code: str
    notebookId: Optional[str] = None

class RunAllRequest(BaseModel):
    cells: List[CellExecutionRequest]

@router.post('/run_cell')
async def run_cell(request: CellExecutionRequest):
    """Execute a single cell."""
    if not request.code.strip():
        return {
            "cellId": request.cellId,
            "success": True,
            "output": None,
            "outputs": [],
            "executionCount": kernel_manager.execution_count,
        }
    
    try:
        result = await kernel_manager.execute(request.code, request.cellId)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post('/run_cell_stream')
async def run_cell_stream(request: CellExecutionRequest):
    """Execute a single cell with streaming output (SSE)."""
    if not request.code.strip():
        async def empty_gen():
            yield f"data: {json.dumps({'type': 'complete', 'result': {'cellId': request.cellId, 'success': True, 'output': None, 'outputs': [], 'executionCount': kernel_manager.execution_count}})}\n\n"
        return StreamingResponse(empty_gen(), media_type="text/event-stream")
    
    async def generate():
        try:
            async for item in kernel_manager.execute_streaming(request.code, request.cellId):
                yield f"data: {json.dumps(item)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
    
    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"  # Disable nginx buffering
        }
    )

@router.post('/run_all')
async def run_all(request: RunAllRequest):
    """Execute all cells in order."""
    results = []
    for cell in request.cells:
        if cell.code.strip():
            try:
                result = await kernel_manager.execute(cell.code, cell.cellId)
                results.append(result)
                if not result.get("success"):
                    break  # Stop on error
            except Exception as e:
                results.append({
                    "cellId": cell.cellId,
                    "success": False,
                    "error": str(e),
                    "outputs": [],
                    "executionCount": kernel_manager.execution_count,
                })
                break
    return results

@router.post('/interrupt')
async def interrupt():
    """Interrupt current execution."""
    return await kernel_manager.interrupt()
