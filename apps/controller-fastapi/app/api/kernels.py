from fastapi import APIRouter, HTTPException
import sys
from pathlib import Path

# Add kernel-python directory to path
kernel_path = Path(__file__).parent.parent.parent.parent / "kernel-python"
sys.path.insert(0, str(kernel_path))

from kernel_manager import kernel_manager

try:
    import psutil
    PSUTIL_AVAILABLE = True
except ImportError:
    PSUTIL_AVAILABLE = False

router = APIRouter()
# Kernel metrics endpoints added for monitoring

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


@router.get('/metrics/{notebook_id}')
async def get_notebook_metrics(notebook_id: str):
    """Get metrics (PID, memory, CPU) for a specific notebook's kernel."""
    try:
        if notebook_id not in kernel_manager.notebook_kernels:
            return {
                "notebook_id": notebook_id,
                "available": False,
                "error": "No kernel found for this notebook"
            }
        
        kernel = kernel_manager.notebook_kernels[notebook_id]
        
        if not kernel.worker or not kernel._is_alive():
            return {
                "notebook_id": notebook_id,
                "available": False,
                "error": "Kernel process not running"
            }
        
        pid = kernel.worker.pid
        
        # Get process metrics
        if PSUTIL_AVAILABLE:
            try:
                process = psutil.Process(pid)
                memory_info = process.memory_info()
                cpu_percent = process.cpu_percent(interval=0.1)
                
                return {
                    "notebook_id": notebook_id,
                    "available": True,
                    "pid": pid,
                    "memory_mb": round(memory_info.rss / (1024 * 1024), 2),
                    "memory_percent": round(process.memory_percent(), 2),
                    "cpu_percent": round(cpu_percent, 2),
                    "status": "running"
                }
            except psutil.NoSuchProcess:
                return {
                    "notebook_id": notebook_id,
                    "available": False,
                    "error": "Process no longer exists"
                }
        else:
            return {
                "notebook_id": notebook_id,
                "available": True,
                "pid": pid,
                "memory_mb": None,
                "cpu_percent": None,
                "status": "running",
                "warning": "psutil not installed - metrics unavailable"
            }
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/metrics')
async def get_all_kernel_metrics():
    """Get metrics for all running notebook kernels."""
    results = {}
    
    for notebook_id, kernel in kernel_manager.notebook_kernels.items():
        if kernel.worker and kernel._is_alive():
            pid = kernel.worker.pid
            
            if PSUTIL_AVAILABLE:
                try:
                    process = psutil.Process(pid)
                    memory_info = process.memory_info()
                    cpu_percent = process.cpu_percent(interval=0.05)
                    
                    results[notebook_id] = {
                        "pid": pid,
                        "memory_mb": round(memory_info.rss / (1024 * 1024), 2),
                        "cpu_percent": round(cpu_percent, 2),
                        "status": "running"
                    }
                except psutil.NoSuchProcess:
                    results[notebook_id] = {"status": "dead"}
            else:
                results[notebook_id] = {
                    "pid": pid,
                    "status": "running"
                }
        else:
            results[notebook_id] = {"status": "stopped"}
    
    return {
        "kernels": results,
        "total_count": len(results),
        "running_count": sum(1 for k in results.values() if k.get("status") == "running")
    }

