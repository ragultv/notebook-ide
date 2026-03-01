"""
kernel_manager.py

Manages Python kernel lifecycle with notebook isolation.
Uses TrulyIsolatedKernel for process-level isolation per notebook.
"""

import asyncio
import io
import traceback
import uuid
import base64
import sys
import subprocess
import time
import hashlib
import os
import logging
from datetime import datetime
from typing import Optional, List, Dict, Any, AsyncGenerator, Callable
from dataclasses import dataclass, field
from enum import Enum
from contextlib import redirect_stdout, redirect_stderr
from copy import deepcopy

from isolated_kernel import TrulyIsolatedKernel, ExecutionResult as IsolatedExecutionResult

logger = logging.getLogger(__name__)

# Feature flag for isolated kernels
USE_ISOLATED_KERNELS = os.getenv('USE_ISOLATED_KERNELS', 'true').lower() == 'true'


class KernelStatus(str, Enum):
    """
    Enumeration of possible kernel states.
    """
    DISCONNECTED = "disconnected"
    STARTING = "starting"
    IDLE = "idle"
    BUSY = "busy"
    ERROR = "error"


@dataclass
class RichOutput:
    """
    Container for rich output data (images, HTML, etc.).

    Attributes:
        type (str): Output type ('text', 'image', 'html', 'error', 'stream').
        data (str): The actual data content (often base64 or raw string).
        mimeType (str | None): Optional MIME type for the data.
        stream (str | None): Stream source ('stdout' or 'stderr') if type is 'stream'.
    """
    type: str  # 'text', 'image', 'html', 'error', 'stream'
    data: str
    mimeType: Optional[str] = None
    stream: Optional[str] = None  # 'stdout', 'stderr'


@dataclass
class ExecutionLog:
    """Audit log for each execution."""
    timestamp: str
    notebookId: str
    cellId: str
    executionCount: int
    queueOrder: int
    codeHash: str
    duration: float
    success: bool


@dataclass
class ExecutionRequest:
    """
    Data associated with a queued code execution request.

    Args:
        notebook_id (str): ID of the notebook making the request.
        cell_id (str): ID of the cell to execute.
        code (str): Source code to run.
        future (asyncio.Future): Future to resolve with the execution result.
        streaming (bool): Whether to stream output in real-time.
        output_callback (Callable | None): Optional callback for output chunks.
        submitted_at (float): Timing info for queue wait tracking.
        device (str): Device selection ('cpu' or 'cuda').
    """
    notebook_id: str
    cell_id: str
    code: str
    future: asyncio.Future
    streaming: bool = False
    output_callback: Optional[Callable] = None
    submitted_at: float = field(default_factory=time.time)
    device: str = 'cpu'  # 'cpu' or 'cuda'


@dataclass
class KernelState:
    id: str = ""
    status: KernelStatus = KernelStatus.DISCONNECTED
    execution_count: int = 0


class StreamCapture:
    """Captures print output and yields it line by line for streaming."""
    def __init__(self, callback, stream_type='stdout'):
        self.callback = callback
        self.stream_type = stream_type
        self.buffer = ''
        
    def write(self, text):
        if text:
            self.buffer += text
            while '\n' in self.buffer:
                line, self.buffer = self.buffer.split('\n', 1)
                if self.callback:
                    self.callback(RichOutput(
                        type='stream',
                        data=line + '\n',
                        stream=self.stream_type
                    ))
    
    def flush(self):
        if self.buffer and self.callback:
            self.callback(RichOutput(
                type='stream',
                data=self.buffer,
                stream=self.stream_type
            ))
            self.buffer = ''


class KernelManager:
    """
    Orchestrates Python kernel processes with per-notebook isolation.
    
    Manages a pool of TrulyIsolatedKernel instances, handles an asynchronous 
    execution queue, and provides APIs for kernel lifecycle management.
    """
    
    def __init__(self):
        self.state = KernelState()
        
        # Isolated kernels per notebook (new approach)
        self.notebook_kernels: Dict[str, TrulyIsolatedKernel] = {}
        
        # Legacy: Per-notebook isolated namespaces (fallback if USE_ISOLATED_KERNELS=false)
        self.notebook_vars: Dict[str, dict] = {}
        
        # Execution queue + single consumer worker
        self._execution_queue: asyncio.Queue = None
        self._queue_worker_task: Optional[asyncio.Task] = None
        self._auto_suspend_task: Optional[asyncio.Task] = None
        self._queue_order: int = 0
        self._max_queue_size: int = 100
        
        # Current execution info
        self._current_execution: Optional[ExecutionRequest] = None
        
        # Execution logs for auditing
        self.execution_logs: List[ExecutionLog] = []
        self._max_logs = 1000
        
        # Kernel configuration
        # 0 = no timeout, allows long-running operations like model downloads
        self._kernel_timeout = int(os.getenv('KERNEL_TIMEOUT', '0'))
        self._kernel_max_memory_mb = int(os.getenv('KERNEL_MAX_MEMORY_MB', '0')) or None
    
    @property
    def status(self) -> KernelStatus:
        """
        Global status indicator for the manager.
        """
        return self.state.status
    
    @property
    def execution_count(self) -> int:
        return self.state.execution_count
    
    def _get_isolated_kernel(self, notebook_id: str, device: str = 'cpu') -> TrulyIsolatedKernel:
        """
        Get or create isolated kernel for a notebook. 
        
        Restarts the kernel if the requested device has changed.

        Args:
            notebook_id (str): Unique notebook identifier.
            device (str): Requested compute device ('cpu' or 'cuda').

        Returns:
            TrulyIsolatedKernel: The kernel instance for this notebook.
        """
        existing = self.notebook_kernels.get(notebook_id)
        if existing is not None:
            # If device changed, shut down and recreate the kernel so CUDA env is correct
            if getattr(existing, 'device', 'cpu') != device:
                logger.info(f"Device changed to '{device}' for notebook {notebook_id} — restarting kernel")
                try:
                    existing.shutdown()
                except Exception:
                    pass
                del self.notebook_kernels[notebook_id]
            else:
                return existing
        logger.info(f"Creating isolated kernel for notebook {notebook_id} (device={device})")
        self.notebook_kernels[notebook_id] = TrulyIsolatedKernel(
            notebook_id=notebook_id,
            timeout=self._kernel_timeout,
            max_memory_mb=self._kernel_max_memory_mb,
            device=device
        )
        return self.notebook_kernels[notebook_id]
    
    def _get_notebook_vars(self, notebook_id: str) -> dict:
        """Get or create isolated namespace for a notebook (legacy fallback)."""
        if notebook_id not in self.notebook_vars:
            self.notebook_vars[notebook_id] = {"__builtins__": __builtins__}
        return self.notebook_vars[notebook_id]
    
    def _hash_code(self, code: str) -> str:
        """Generate hash of code for logging."""
        return hashlib.sha256(code.encode()).hexdigest()[:16]
    
    def _log_execution(self, notebook_id: str, cell_id: str, exec_count: int, 
                       queue_order: int, code: str, duration: float, success: bool):
        """Log execution for auditing."""
        log = ExecutionLog(
            timestamp=datetime.utcnow().isoformat(),
            notebookId=notebook_id,
            cellId=cell_id,
            executionCount=exec_count,
            queueOrder=queue_order,
            codeHash=self._hash_code(code),
            duration=round(duration, 4),
            success=success
        )
        self.execution_logs.append(log)
        if len(self.execution_logs) > self._max_logs:
            self.execution_logs = self.execution_logs[-self._max_logs:]
    
    async def _queue_worker(self):
        """Single consumer worker that processes execution requests in order."""
        print("[Kernel] Queue worker started")
        while True:
            try:
                request: ExecutionRequest = await self._execution_queue.get()
                self._current_execution = request
                
                self.state.status = KernelStatus.BUSY
                self.state.execution_count += 1
                self._queue_order += 1
                exec_count = self.state.execution_count
                queue_order = self._queue_order
                
                wait_time = time.time() - request.submitted_at
                print(f"[Kernel] Processing: {request.cell_id} (waited {wait_time:.2f}s, queue size: {self._execution_queue.qsize()})")
                
                try:
                    if USE_ISOLATED_KERNELS:
                        # Use isolated kernel
                        result = await self._run_code_isolated(
                            request.code, 
                            request.cell_id, 
                            request.notebook_id,
                            exec_count,
                            queue_order,
                            request.output_callback if request.streaming else None,
                            device=request.device
                        )
                    else:
                        # Legacy execution
                        if request.streaming:
                            result = await self._run_code_streaming_internal(
                                request.code, 
                                request.cell_id, 
                                request.notebook_id,
                                exec_count,
                                queue_order,
                                request.output_callback
                            )
                        else:
                            result = await self._run_code(
                                request.code, 
                                request.cell_id, 
                                request.notebook_id,
                                exec_count,
                                queue_order
                            )
                    
                    if not request.future.done():
                        request.future.set_result(result)
                        
                except Exception as e:
                    if not request.future.done():
                        request.future.set_exception(e)
                finally:
                    self._current_execution = None
                    self.state.status = KernelStatus.IDLE
                    self._execution_queue.task_done()
                    
            except asyncio.CancelledError:
                print("[Kernel] Queue worker cancelled")
                break
            except Exception as e:
                print(f"[Kernel] Queue worker error: {e}")
                traceback.print_exc()

    async def _auto_suspend_worker(self):
        """Background task that suspends kernels that have been idle for more than 10 minutes."""
        print("[Kernel] Auto-suspend daemon started (Timeout: 10m)")
        while True:
            try:
                await asyncio.sleep(60) # check every minute
                current_time = time.time()
                for notebook_id, kernel in list(self.notebook_kernels.items()):
                    if kernel and kernel._is_alive() and not kernel.is_suspended:
                        # 600 seconds = 10 minutes
                        if (current_time - kernel.last_activity) > 600:
                            logger.info(f"Auto-suspending idle kernel for notebook {notebook_id}")
                            kernel.suspend()
            except asyncio.CancelledError:
                print("[Kernel] Auto-suspend daemon cancelled")
                break
            except Exception as e:
                logger.error(f"[Kernel] Auto-suspend error: {e}")
    
    async def start(self) -> dict:
        """
        Start the kernel manager and background worker tasks.

        Returns:
            dict: Initialization status and ID.
        """
        if self.state.status in [KernelStatus.IDLE, KernelStatus.BUSY]:
            return self._get_info()
        
        self.state = KernelState(
            id=str(uuid.uuid4()),
            status=KernelStatus.IDLE,
            execution_count=0,
        )
        self.notebook_vars.clear()
        self._queue_order = 0
        
        self._execution_queue = asyncio.Queue(maxsize=self._max_queue_size)
        self._queue_worker_task = asyncio.create_task(self._queue_worker())
        self._auto_suspend_task = asyncio.create_task(self._auto_suspend_worker())
        
        print(f"[Kernel] Started with ID: {self.state.id} (isolated={USE_ISOLATED_KERNELS})")
        return self._get_info()
    
    async def stop(self) -> dict:
        """Stop the kernel and all isolated notebook kernels."""
        # Cancel queue worker
        if self._queue_worker_task and not self._queue_worker_task.done():
            self._queue_worker_task.cancel()
            try:
                await self._queue_worker_task
            except asyncio.CancelledError:
                pass
        
        if self._auto_suspend_task and not self._auto_suspend_task.done():
            self._auto_suspend_task.cancel()
            try:
                await self._auto_suspend_task
            except asyncio.CancelledError:
                pass
        
        # Cancel any pending requests
        if self._execution_queue:
            while not self._execution_queue.empty():
                try:
                    request = self._execution_queue.get_nowait()
                    if not request.future.done():
                        request.future.cancel()
                except asyncio.QueueEmpty:
                    break
        
        # Shutdown all isolated kernels
        for notebook_id, kernel in list(self.notebook_kernels.items()):
            try:
                kernel.shutdown()
            except Exception as e:
                logger.warning(f"Error shutting down kernel for {notebook_id}: {e}")
        self.notebook_kernels.clear()
        
        self.notebook_vars.clear()
        self._current_execution = None
        self.state = KernelState()
        print("[Kernel] Stopped")
        return {"status": "stopped"}
    
    async def restart(self) -> dict:
        """Restart the kernel (clears all state)."""
        await self.stop()
        return await self.start()
    
    def shutdown_notebook_kernel(self, notebook_id: str) -> dict:
        """Shutdown a specific notebook's isolated kernel."""
        if notebook_id in self.notebook_kernels:
            self.notebook_kernels[notebook_id].shutdown()
            del self.notebook_kernels[notebook_id]
            logger.info(f"Shutdown kernel for notebook {notebook_id}")
            return {"success": True, "notebook_id": notebook_id, "status": "shutdown"}
        return {"success": False, "error": f"Notebook {notebook_id} kernel not found"}
    
    # === Queue Visibility APIs ===
    
    def get_queue_status(self) -> dict:
        """Get execution queue status for visibility."""
        return {
            "queue_size": self._execution_queue.qsize() if self._execution_queue else 0,
            "max_queue_size": self._max_queue_size,
            "is_full": self._execution_queue.full() if self._execution_queue else False,
            "current_execution": {
                "cell_id": self._current_execution.cell_id,
                "notebook_id": self._current_execution.notebook_id,
                "waiting_since": time.time() - self._current_execution.submitted_at
            } if self._current_execution else None,
            "isolated_kernels": list(self.notebook_kernels.keys()),
            "use_isolated_kernels": USE_ISOLATED_KERNELS,
        }
    
    # === Notebook Management APIs ===
    
    def reset_notebook(self, notebook_id: str) -> dict:
        """Reset a specific notebook's namespace / kernel."""
        # Shutdown isolated kernel if exists
        if notebook_id in self.notebook_kernels:
            self.notebook_kernels[notebook_id].shutdown()
            del self.notebook_kernels[notebook_id]
        
        # Clear legacy namespace
        if notebook_id in self.notebook_vars:
            self.notebook_vars[notebook_id] = {"__builtins__": __builtins__}
        
        return {"success": True, "notebook_id": notebook_id, "status": "reset"}
    
    def get_notebook_vars_keys(self, notebook_id: str) -> List[str]:
        if notebook_id not in self.notebook_vars:
            return []
        ns = self.notebook_vars[notebook_id]
        return [k for k in ns.keys() if not k.startswith('_')]
    
    def get_execution_logs(self, notebook_id: str = None, limit: int = 100) -> List[dict]:
        logs = self.execution_logs
        if notebook_id:
            logs = [l for l in logs if l.notebookId == notebook_id]
        logs = logs[-limit:]
        return [
            {
                "timestamp": l.timestamp,
                "notebookId": l.notebookId,
                "cellId": l.cellId,
                "executionCount": l.executionCount,
                "queueOrder": l.queueOrder,
                "codeHash": l.codeHash,
                "duration": l.duration,
                "success": l.success
            }
            for l in logs
        ]
    
    # === Execution Methods (queued) ===
    
    async def execute(self, code: str, cell_id: str, notebook_id: str = "default", device: str = 'cpu') -> dict:
        """
        Queue code for execution in the kernel (non-streaming).

        Args:
            code (str): Source code to execute.
            cell_id (str): Source cell identifier.
            notebook_id (str): Target notebook ID.
            device (str): Device to use for execution.

        Returns:
            dict: The final execution result.
        """
        if self.state.status == KernelStatus.DISCONNECTED:
            await self.start()
        
        if self._execution_queue.full():
            return {
                "cellId": cell_id,
                "notebookId": notebook_id,
                "success": False,
                "error": f"Execution queue is full ({self._max_queue_size} pending). Please wait.",
                "outputs": [],
                "executionCount": self.state.execution_count,
            }
        
        loop = asyncio.get_event_loop()
        future = loop.create_future()
        
        request = ExecutionRequest(
            notebook_id=notebook_id,
            cell_id=cell_id,
            code=code,
            future=future,
            streaming=False,
            device=device
        )
        
        await self._execution_queue.put(request)
        
        return await future
    
    async def execute_streaming(self, code: str, cell_id: str, notebook_id: str = "default", device: str = 'cpu') -> AsyncGenerator[Dict[str, Any], None]:
        """Execute code with streaming output (queued)."""
        if self.state.status == KernelStatus.DISCONNECTED:
            await self.start()
        
        if self._execution_queue.full():
            yield {
                "type": "complete",
                "result": {
                    "cellId": cell_id,
                    "notebookId": notebook_id,
                    "success": False,
                    "error": f"Execution queue is full ({self._max_queue_size} pending). Please wait.",
                    "outputs": [],
                    "executionCount": self.state.execution_count,
                }
            }
            return
        
        output_queue: asyncio.Queue = asyncio.Queue()
        
        loop = asyncio.get_event_loop()
        future = loop.create_future()
        
        def output_callback(output: RichOutput):
            try:
                loop.call_soon_threadsafe(output_queue.put_nowait, output)
            except:
                pass
        
        request = ExecutionRequest(
            notebook_id=notebook_id,
            cell_id=cell_id,
            code=code,
            future=future,
            streaming=True,
            output_callback=output_callback,
            device=device
        )
        
        await self._execution_queue.put(request)
        
        done = False
        while not done:
            try:
                output = await asyncio.wait_for(output_queue.get(), timeout=0.1)
                yield {
                    "type": "output",
                    "output": {
                        "type": output.type,
                        "data": output.data,
                        "mimeType": output.mimeType,
                        "stream": output.stream
                    }
                }
            except asyncio.TimeoutError:
                if future.done():
                    done = True
        
        while not output_queue.empty():
            output = output_queue.get_nowait()
            yield {
                "type": "output",
                "output": {
                    "type": output.type,
                    "data": output.data,
                    "mimeType": output.mimeType,
                    "stream": output.stream
                }
            }
        
        try:
            result = await future
            yield {"type": "complete", "result": result}
        except Exception as e:
            yield {
                "type": "complete",
                "result": {
                    "cellId": cell_id,
                    "notebookId": notebook_id,
                    "success": False,
                    "error": str(e),
                    "outputs": [],
                }
            }

    async def _run_code_isolated(self, code: str, cell_id: str, notebook_id: str,
                                  exec_count: int, queue_order: int,
                                  output_callback: Optional[Callable] = None,
                                  device: str = 'cpu') -> dict:
        """Run code using TrulyIsolatedKernel."""
        loop = asyncio.get_event_loop()
        start_time = time.time()
        outputs = []
        
        kernel = self._get_isolated_kernel(notebook_id, device=device)
        
        def run_sync():
            return kernel.execute(code, output_callback=output_callback)
        
        result: IsolatedExecutionResult = await loop.run_in_executor(None, run_sync)
        duration = time.time() - start_time
        
        # Convert result to our format
        if result.stdout:
            output = RichOutput(type='stream', data=result.stdout, stream='stdout')
            outputs.append(output)
            if output_callback:
                output_callback(output)
        
        if result.stderr:
            output = RichOutput(type='stream', data=result.stderr, stream='stderr')
            outputs.append(output)
            if output_callback:
                output_callback(output)

        # Process image outputs from the isolated kernel
        if hasattr(result, 'outputs') and result.outputs:
            for out_dict in result.outputs:
                output = RichOutput(
                    type=out_dict.get('type', 'text'),
                    data=out_dict.get('data', ''),
                    mimeType=out_dict.get('mimeType')
                )
                outputs.append(output)
                if output_callback:
                    output_callback(output)
        
        # Log execution
        success = result.status == 'success'
        self._log_execution(notebook_id, cell_id, exec_count, queue_order, code, duration, success)
        
        if result.status == 'success':
            return {
                "cellId": cell_id,
                "notebookId": notebook_id,
                "success": True,
                "output": result.stdout.strip() if result.stdout else None,
                "outputs": [{"type": o.type, "data": o.data, "mimeType": o.mimeType, "stream": o.stream} for o in outputs],
                "executionCount": exec_count,
                "queueOrder": queue_order,
                "duration": round(duration, 2),
                "metrics": {
                    "peak_memory_mb": result.metrics.peak_memory_mb,
                    "avg_memory_mb": result.metrics.avg_memory_mb,
                    "peak_cpu_percent": result.metrics.peak_cpu_percent,
                },
                "variables": result.namespace_vars,
            }
        elif result.status == 'error':
            outputs.append(RichOutput(type='error', data=result.error_details or "Unknown error"))
            return {
                "cellId": cell_id,
                "notebookId": notebook_id,
                "success": False,
                "error": result.error_details,
                "outputs": [{"type": o.type, "data": o.data, "mimeType": o.mimeType, "stream": o.stream} for o in outputs],
                "executionCount": exec_count,
                "queueOrder": queue_order,
                "duration": round(duration, 2),
            }
        elif result.status == 'timeout':
            return {
                "cellId": cell_id,
                "notebookId": notebook_id,
                "success": False,
                "error": f"Execution timed out: {result.error_details}",
                "outputs": [{"type": o.type, "data": o.data, "mimeType": o.mimeType, "stream": o.stream} for o in outputs],
                "executionCount": exec_count,
                "queueOrder": queue_order,
                "duration": round(result.execution_time, 2),
            }
        elif result.status in ['crashed', 'killed']:
            return {
                "cellId": cell_id,
                "notebookId": notebook_id,
                "success": False,
                "error": f"Kernel {result.status}: {result.error_details}",
                "outputs": [{"type": o.type, "data": o.data, "mimeType": o.mimeType, "stream": o.stream} for o in outputs],
                "executionCount": exec_count,
                "queueOrder": queue_order,
                "duration": round(duration, 2),
            }
        else:
            return {
                "cellId": cell_id,
                "notebookId": notebook_id,
                "success": False,
                "error": f"Unknown status: {result.status}",
                "outputs": [],
                "executionCount": exec_count,
                "queueOrder": queue_order,
                "duration": round(duration, 2),
            }

    def _capture_figures(self) -> List[RichOutput]:
        """Capture matplotlib figures as base64 PNG images."""
        figures = []
        try:
            import matplotlib.pyplot as plt
            if plt.get_fignums():
                for fig_num in plt.get_fignums():
                    fig = plt.figure(fig_num)
                    buf = io.BytesIO()
                    fig.savefig(buf, format='png', bbox_inches='tight', 
                               facecolor='#1a1a1a', edgecolor='none', dpi=100)
                    buf.seek(0)
                    img_base64 = base64.b64encode(buf.read()).decode('utf-8')
                    figures.append(RichOutput(
                        type='image',
                        data=img_base64,
                        mimeType='image/png'
                    ))
                    plt.close(fig)
        except ImportError:
            pass
        except Exception as e:
            print(f"Error capturing figure: {e}")
        return figures

    async def _run_code_streaming_internal(self, code: str, cell_id: str, notebook_id: str,
                                           exec_count: int, queue_order: int,
                                           output_callback: Callable) -> dict:
        """Internal: Run code with streaming output via callback (legacy)."""
        loop = asyncio.get_event_loop()
        start_time = time.time()
        outputs = []
        
        ns = self._get_notebook_vars(notebook_id)
        
        def on_output(output: RichOutput):
            outputs.append(output)
            if output_callback:
                output_callback(output)
        
        def run_shell_command(cmd: str):
            try:
                process = subprocess.Popen(
                    cmd,
                    shell=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1,
                    universal_newlines=True
                )
                
                for line in iter(process.stdout.readline, ''):
                    if line:
                        on_output(RichOutput(type='stream', data=line, stream='stdout'))
                
                process.wait()
                return None if process.returncode == 0 else f"Command exited with code {process.returncode}"
            except Exception as e:
                return str(e)
        
        def run_sync():
            stdout_capture = StreamCapture(on_output, 'stdout')
            stderr_capture = StreamCapture(on_output, 'stderr')
            old_stdout = sys.stdout
            old_stderr = sys.stderr
            
            try:
                lines = code.strip().split('\n')
                python_code = []
                
                for line in lines:
                    stripped = line.strip()
                    if stripped.startswith('!'):
                        if python_code:
                            sys.stdout = stdout_capture
                            sys.stderr = stderr_capture
                            try:
                                exec('\n'.join(python_code), ns)
                            finally:
                                sys.stdout = old_stdout
                                sys.stderr = old_stderr
                            python_code = []
                        
                        cmd = stripped[1:].strip()
                        error = run_shell_command(cmd)
                        if error:
                            return error
                    else:
                        python_code.append(line)
                
                if python_code:
                    remaining_code = '\n'.join(python_code)
                    if remaining_code.strip():
                        sys.stdout = stdout_capture
                        sys.stderr = stderr_capture
                        
                        try:
                            try:
                                import matplotlib
                                matplotlib.use('Agg')
                                import matplotlib.pyplot as plt
                                plt.ioff()
                            except ImportError:
                                pass
                            
                            try:
                                exec(remaining_code, ns)
                            except SyntaxError:
                                try:
                                    result = eval(remaining_code, ns)
                                    if result is not None:
                                        stdout_capture.write(repr(result) + '\n')
                                except:
                                    raise
                                    
                            stdout_capture.flush()
                            stderr_capture.flush()
                        finally:
                            sys.stdout = old_stdout
                            sys.stderr = old_stderr
                
                return None
                
            except Exception as e:
                if sys.stdout != old_stdout:
                    stdout_capture.flush()
                    stderr_capture.flush()
                    sys.stdout = old_stdout
                    sys.stderr = old_stderr
                return traceback.format_exc()
        
        error = await loop.run_in_executor(None, run_sync)
        duration = time.time() - start_time
        
        figures = self._capture_figures()
        for fig in figures:
            outputs.append(fig)
            if output_callback:
                output_callback(fig)
        
        self._log_execution(notebook_id, cell_id, exec_count, queue_order, code, duration, error is None)
        
        if error:
            outputs.append(RichOutput(type='error', data=error))
            return {
                "cellId": cell_id,
                "notebookId": notebook_id,
                "success": False,
                "error": error,
                "outputs": [{"type": o.type, "data": o.data, "mimeType": o.mimeType, "stream": o.stream} for o in outputs],
                "executionCount": exec_count,
                "queueOrder": queue_order,
                "duration": round(duration, 2),
            }
        else:
            return {
                "cellId": cell_id,
                "notebookId": notebook_id,
                "success": True,
                "outputs": [{"type": o.type, "data": o.data, "mimeType": o.mimeType, "stream": o.stream} for o in outputs],
                "executionCount": exec_count,
                "queueOrder": queue_order,
                "duration": round(duration, 2),
            }

    async def _run_code(self, code: str, cell_id: str, notebook_id: str,
                         exec_count: int, queue_order: int) -> dict:
        """Run code and capture output (non-streaming, legacy)."""
        stdout_buffer = io.StringIO()
        stderr_buffer = io.StringIO()
        outputs = []
        start_time = time.time()
        
        ns = self._get_notebook_vars(notebook_id)
        
        try:
            loop = asyncio.get_event_loop()
            
            def run_shell_command(cmd: str) -> tuple:
                try:
                    result = subprocess.run(
                        cmd,
                        shell=True,
                        capture_output=True,
                        text=True
                    )
                    return result.stdout, result.stderr, result.returncode
                except Exception as e:
                    return "", str(e), 1
            
            def run_sync():
                lines = code.strip().split('\n')
                all_stdout = []
                all_stderr = []
                
                for line in lines:
                    stripped = line.strip()
                    if stripped.startswith('!'):
                        cmd = stripped[1:].strip()
                        stdout, stderr, retcode = run_shell_command(cmd)
                        if stdout:
                            all_stdout.append(stdout)
                        if stderr:
                            all_stderr.append(stderr)
                        if retcode != 0:
                            raise Exception(f"Command '{cmd}' failed with exit code {retcode}")
                    else:
                        if stripped:
                            with redirect_stdout(stdout_buffer), redirect_stderr(stderr_buffer):
                                try:
                                    import matplotlib
                                    matplotlib.use('Agg')
                                    import matplotlib.pyplot as plt
                                    plt.ioff()
                                except ImportError:
                                    pass
                                
                                try:
                                    exec(stripped, ns)
                                except SyntaxError:
                                    try:
                                        result = eval(stripped, ns)
                                        if result is not None:
                                            print(repr(result))
                                    except:
                                        raise
                
                if all_stdout:
                    stdout_buffer.write('\n'.join(all_stdout))
                if all_stderr:
                    stderr_buffer.write('\n'.join(all_stderr))
            
            await loop.run_in_executor(None, run_sync)
            
            duration = time.time() - start_time
            stdout_text = stdout_buffer.getvalue()
            stderr_text = stderr_buffer.getvalue()
            
            if stdout_text:
                outputs.append(RichOutput(type='stream', data=stdout_text, stream='stdout'))
            if stderr_text:
                outputs.append(RichOutput(type='stream', data=stderr_text, stream='stderr'))
            
            figures = self._capture_figures()
            outputs.extend(figures)
            
            combined_output = stdout_text
            if stderr_text:
                combined_output = combined_output + stderr_text if combined_output else stderr_text
            
            self._log_execution(notebook_id, cell_id, exec_count, queue_order, code, duration, True)
            
            return {
                "cellId": cell_id,
                "notebookId": notebook_id,
                "success": True,
                "output": combined_output.strip() if combined_output else None,
                "outputs": [{"type": o.type, "data": o.data, "mimeType": o.mimeType, "stream": o.stream} for o in outputs],
                "executionCount": exec_count,
                "queueOrder": queue_order,
                "duration": round(duration, 2),
            }
            
        except Exception as e:
            duration = time.time() - start_time
            error_msg = traceback.format_exc()
            outputs.append(RichOutput(type='error', data=error_msg))
            
            self._log_execution(notebook_id, cell_id, exec_count, queue_order, code, duration, False)
            
            return {
                "cellId": cell_id,
                "notebookId": notebook_id,
                "success": False,
                "error": error_msg,
                "outputs": [{"type": o.type, "data": o.data, "mimeType": o.mimeType, "stream": o.stream} for o in outputs],
                "executionCount": exec_count,
                "queueOrder": queue_order,
                "duration": round(duration, 2),
            }
    
    async def interrupt(self) -> dict:
        """Interrupt current execution."""
        # TODO: Implement actual interruption via thread signal
        return {"status": "interrupt_sent"}
    
    def _get_info(self) -> dict:
        return {
            "id": self.state.id,
            "status": self.state.status.value,
            "executionCount": self.state.execution_count,
            "notebooks": list(self.notebook_vars.keys()),
            "queue": self.get_queue_status(),
            "useIsolatedKernels": USE_ISOLATED_KERNELS,
        }
    
    def get_info(self) -> dict:
        return self._get_info()


# Singleton instance
kernel_manager = KernelManager()
