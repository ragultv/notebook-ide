from fastapi import APIRouter, HTTPException
from ..core.kernel_manager import kernel_manager

router = APIRouter()

@router.post('/start')
async def start_kernel():
    """Start or connect to kernel."""
    try:
        info = await kernel_manager.start()
        return info
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post('/stop')
async def stop_kernel():
    """Stop the kernel."""
    try:
        return await kernel_manager.stop()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post('/restart')
async def restart_kernel():
    """Restart the kernel (clears all state)."""
    try:
        return await kernel_manager.restart()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get('/status')
async def get_kernel_status():
    """Get current kernel status."""
    return kernel_manager.get_info()
