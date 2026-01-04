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
    notebookId: str = "default"  # Required for isolation

class RunAllRequest(BaseModel):
    notebookId: str = "default"
    cells: List[CellExecutionRequest]

class ExportRequest(BaseModel):
    notebookId: str
    name: str

class ImportRequest(BaseModel):
    notebookId: str
    name: str
    sourceNotebookId: Optional[str] = None

class ResetRequest(BaseModel):
    notebookId: str

@router.post('/run_cell')
async def run_cell(request: CellExecutionRequest):
    """Execute a single cell in isolated notebook namespace."""
    if not request.code.strip():
        return {
            "cellId": request.cellId,
            "notebookId": request.notebookId,
            "success": True,
            "output": None,
            "outputs": [],
            "executionCount": kernel_manager.execution_count,
        }
    
    try:
        result = await kernel_manager.execute(request.code, request.cellId, request.notebookId)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post('/run_cell_stream')
async def run_cell_stream(request: CellExecutionRequest):
    """Execute a single cell with streaming output (SSE) in isolated namespace."""
    if not request.code.strip():
        async def empty_gen():
            yield f"data: {json.dumps({'type': 'complete', 'result': {'cellId': request.cellId, 'notebookId': request.notebookId, 'success': True, 'output': None, 'outputs': [], 'executionCount': kernel_manager.execution_count}})}\n\n"
        return StreamingResponse(empty_gen(), media_type="text/event-stream")
    
    async def generate():
        try:
            async for item in kernel_manager.execute_streaming(request.code, request.cellId, request.notebookId):
                yield f"data: {json.dumps(item)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
    
    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

@router.post('/run_all')
async def run_all(request: RunAllRequest):
    """Execute all cells in order within isolated notebook namespace."""
    results = []
    for cell in request.cells:
        if cell.code.strip():
            try:
                result = await kernel_manager.execute(cell.code, cell.cellId, request.notebookId)
                results.append(result)
                if not result.get("success"):
                    break
            except Exception as e:
                results.append({
                    "cellId": cell.cellId,
                    "notebookId": request.notebookId,
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

# === Export/Import APIs ===

@router.post('/export')
async def export_variable(request: ExportRequest):
    """Export a variable from notebook to shared registry."""
    result = kernel_manager.export_var(request.notebookId, request.name)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return result

@router.post('/import')
async def import_variable(request: ImportRequest):
    """Import a variable from shared registry or another notebook."""
    result = kernel_manager.import_var(request.notebookId, request.name, request.sourceNotebookId)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return result

@router.post('/reset')
async def reset_notebook(request: ResetRequest):
    """Reset a notebook's namespace (clear all variables)."""
    result = kernel_manager.reset_notebook(request.notebookId)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return result

# === Observability APIs ===

@router.get('/logs')
async def get_execution_logs(notebookId: Optional[str] = None, limit: int = 100):
    """Get execution logs for auditing."""
    return kernel_manager.get_execution_logs(notebookId, limit)

@router.get('/shared')
async def get_shared_registry():
    """List all variables in shared registry."""
    return {"keys": kernel_manager.get_shared_registry_keys()}

@router.get('/notebooks/{notebookId}/vars')
async def get_notebook_vars(notebookId: str):
    """List all user-defined variables in a notebook."""
    return {"keys": kernel_manager.get_notebook_vars_keys(notebookId)}

@router.get('/queue')
async def get_queue_status():
    """Get execution queue status for visibility."""
    return kernel_manager.get_queue_status()
