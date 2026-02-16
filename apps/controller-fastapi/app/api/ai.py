from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from ..core.ai import ai_service

router = APIRouter()

class CellContext(BaseModel):
    type: str
    content: str

class NotebookContext(BaseModel):
    notebookName: Optional[str] = None
    cells: Optional[List[CellContext]] = None
    selectedCellId: Optional[str] = None

class AIRequest(BaseModel):
    prompt: str
    context: Optional[NotebookContext] = None

class ErrorFixRequest(BaseModel):
    cellIndex: int
    error: str
    cellContent: str
    context: Optional[NotebookContext] = None

class AIOperation(BaseModel):
    type: str
    params: Dict[str, Any]

class AIResponse(BaseModel):
    text: str
    operations: Optional[List[AIOperation]] = None
    tokenInfo: Optional[Dict[str, int]] = None

@router.post('/assist', response_model=AIResponse)
async def assist(request: AIRequest):
    """AI assistant for code generation and notebook help."""
    try:
        result = await ai_service.generate(
            prompt=request.prompt,
            context=request.context.model_dump() if request.context else None,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post('/fix_error', response_model=AIResponse)
async def fix_error(request: ErrorFixRequest):
    """Analyze and fix execution errors in notebook cells."""
    try:
        error_info = {
            "cellIndex": request.cellIndex,
            "error": request.error,
            "cellContent": request.cellContent,
        }
        # Force use of the NVIDIA 405B model for error fixing (higher reasoning/robustness)
        result = await ai_service.fix_error(
            error_info=error_info,
            context=request.context.model_dump() if request.context else None,
            provider="nvidia",
            model="meta/llama-3.1-405b-instruct",
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post('/generate_code')
async def generate_code(request: AIRequest):
    """Generate code based on prompt."""
    try:
        result = await ai_service.generate_code(
            prompt=request.prompt,
            context=request.context.model_dump() if request.context else None,
        )
        return {"code": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
