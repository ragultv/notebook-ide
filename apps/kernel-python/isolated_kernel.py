"""
isolated_kernel.py

Provides production-grade process isolation for notebooks.
Each notebook gets its own worker process for true isolation.
"""

import subprocess
import sys
import os
import time
import traceback
import io
import threading
import logging
import json
from dataclasses import dataclass, field
from typing import Any, Dict, Optional, List
from pathlib import Path

try:
    import psutil
    PSUTIL_AVAILABLE = True
except ImportError:
    PSUTIL_AVAILABLE = False

logger = logging.getLogger(__name__)

# Platform-specific handling
IS_WINDOWS = sys.platform == 'win32'


@dataclass
class ResourceMetrics:
    """
    Real-time resource usage metrics for a kernel process.

    Attributes:
        peak_memory_mb (float): Maximum memory used in MB.
        avg_memory_mb (float): Average memory usage in MB.
        peak_cpu_percent (float): Peak CPU utilization percentage.
        avg_cpu_percent (float): Average CPU utilization percentage.
        samples_count (int): Number of metrics samples collected.
    """
    peak_memory_mb: float = 0.0
    avg_memory_mb: float = 0.0
    peak_cpu_percent: float = 0.0
    avg_cpu_percent: float = 0.0
    samples_count: int = 0


@dataclass
class ExecutionResult:
    """
    Result object containing details about a code execution.

    Attributes:
        status (str): Status of execution ('success', 'error', 'timeout', etc.).
        stdout (str): Captured standard output.
        stderr (str): Captured standard error.
        error_details (str | None): Detailed error message if failed.
        execution_time (float): Time taken for execution in seconds.
        metrics (ResourceMetrics): Resource usage statistics during execution.
        namespace_vars (Dict[str, str]): Summary of variables in the namespace.
        outputs (List[Dict[str, Any]]): List of rich outputs (images, etc.).
    """
    status: str  # 'success' | 'error' | 'timeout' | 'killed' | 'crashed'
    stdout: str = ""
    stderr: str = ""
    error_details: Optional[str] = None
    execution_time: float = 0.0
    metrics: ResourceMetrics = field(default_factory=ResourceMetrics)
    namespace_vars: Dict[str, str] = field(default_factory=dict)
    outputs: List[Dict[str, Any]] = field(default_factory=list)


class ResourceMonitor:
    """
    Monitors resource usage in real-time during execution using psutil.

    Args:
        pid (int): Process ID to monitor.
        interval (float): Monitoring polling interval in seconds.
    """
    
    def __init__(self, pid: int, interval: float = 0.05):
        self.pid = pid
        self.interval = interval
        self.metrics = ResourceMetrics()
        self._stop_event = threading.Event()
        self._thread = None
        
    def start(self):
        """
        Start monitoring in a background thread.
        
        Note:
            Does nothing if psutil is not available.
        """
        if not PSUTIL_AVAILABLE:
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self._thread.start()
    
    def stop(self) -> ResourceMetrics:
        """
        Stop monitoring and return collected metrics.

        Returns:
            ResourceMetrics: The collected memory and CPU usage metrics.
        """
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=1)
        return self.metrics
    
    def _monitor_loop(self):
        """Background monitoring loop"""
        if not PSUTIL_AVAILABLE:
            return
        try:
            process = psutil.Process(self.pid)
            memory_samples = []
            cpu_samples = []
            
            while not self._stop_event.is_set():
                try:
                    mem_info = process.memory_info()
                    total_bytes = getattr(mem_info, 'vms', mem_info.rss)
                    for child in process.children(recursive=True):
                        try:
                            child_mem = child.memory_info()
                            total_bytes += getattr(child_mem, 'vms', child_mem.rss)
                        except (psutil.NoSuchProcess, psutil.AccessDenied):
                            pass
                    mem_mb = total_bytes / (1024 * 1024)
                    cpu_pct = process.cpu_percent(interval=None)
                    
                    memory_samples.append(mem_mb)
                    cpu_samples.append(cpu_pct)
                    
                    self.metrics.peak_memory_mb = max(self.metrics.peak_memory_mb, mem_mb)
                    self.metrics.peak_cpu_percent = max(self.metrics.peak_cpu_percent, cpu_pct)
                    
                    time.sleep(self.interval)
                    
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    break
            
            if memory_samples:
                self.metrics.avg_memory_mb = sum(memory_samples) / len(memory_samples)
                self.metrics.samples_count = len(memory_samples)
            if cpu_samples:
                self.metrics.avg_cpu_percent = sum(cpu_samples) / len(cpu_samples)
                
        except Exception as e:
            logger.warning(f"Monitor error: {e}")


class TrulyIsolatedKernel:
    """
    Production-ready isolated kernel with process isolation.
    
    Features:
    - Real-time resource monitoring
    - Memory/CPU limits
        - Proper cleanup and crash recovery
        - Namespace inspection via JSON-RPC
        - Uses subprocess for platform compatibility (incl. PyInstaller)

    Args:
        notebook_id (str): Unique identifier for the notebook.
        timeout (int): Global execution timeout in seconds.
        max_memory_mb (int | None): RAM limit per process in MB.
        monitor_interval (float): Poll interval for resource monitoring.
        python_path (str | None): Path to the executable; defaults to sys.executable.
        device (str): Compute device selection ('cpu' or 'cuda').
    """
    
    def __init__(
        self, 
        notebook_id: str, 
        timeout: int = 0,
        max_memory_mb: Optional[int] = None,
        monitor_interval: float = 0.05,
        python_path: Optional[str] = None,
        device: str = 'cpu'  # 'cpu' or 'cuda'
    ):
        self.notebook_id = notebook_id
        self.timeout = timeout
        self.max_memory_mb = max_memory_mb
        self.monitor_interval = monitor_interval
        self.python_path = python_path or sys.executable
        self.device = device
        
        self.worker = None
        self.monitor = None
        self.last_activity = time.time()
        self.is_suspended = False
        
        self._start_worker()
        logger.info(f"Created isolated kernel for notebook {notebook_id} (device={device})")

    def _start_worker(self):
        """
        Spawns the isolated worker process using subprocess.
        
        Initializes the communication pipe via stdin/stdout and waits 
        for the 'ready' signal from the worker.

        Raises:
            RuntimeError: If worker script is missing or fails to initialize.
        """
        # Get path to worker_entry.py
        worker_script = Path(__file__).parent / "worker_entry.py"
        
        if not worker_script.exists():
            raise RuntimeError(f"Worker script not found: {worker_script}")
        
        # Start subprocess with stdin/stdout/stderr pipes for JSON-RPC communication
        # Note: JSON-RPC responses come via stderr to avoid conflicts with code output on stdout
        self.worker = subprocess.Popen(
            [self.python_path, str(worker_script)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            universal_newlines=True
        )
        
        # Send configuration (including device so the worker sets CUDA_VISIBLE_DEVICES)
        config = {"max_memory_mb": self.max_memory_mb, "device": self.device}
        self.worker.stdin.write(json.dumps(config) + "\n")
        self.worker.stdin.flush()
        
        # Wait for ready signal (comes via stderr)
        try:
            ready_line = self.worker.stderr.readline()
            ready_response = json.loads(ready_line.strip())
            
            if ready_response.get("status") != "ready":
                raise RuntimeError(f"Worker failed to start: {ready_response}")
        except Exception as e:
            if self.worker.poll() is not None:
                stderr = self.worker.stderr.read()
                raise RuntimeError(f"Worker process failed to start: {stderr}")
            raise RuntimeError(f"Worker initialization error: {e}")
        
        logger.info(f"Worker process started with PID {self.worker.pid}")

    def _is_alive(self) -> bool:
        """
        Check if the worker process is still alive and running.

        Returns:
            bool: True if process exists and is not exited, False otherwise.
        """
        return self.worker is not None and self.worker.poll() is None

    def suspend(self):
        """
        Suspend the worker process at the OS level.
        
        Stops CPU usage while preserving RAM contents mapping.
        Requires psutil to be available.
        """
        if self._is_alive() and PSUTIL_AVAILABLE and not self.is_suspended:
            try:
                psutil.Process(self.worker.pid).suspend()
                self.is_suspended = True
                logger.info(f"Kernel {self.notebook_id} suspended due to inactivity")
            except Exception as e:
                logger.warning(f"Failed to suspend kernel {self.notebook_id}: {e}")

    def resume(self):
        """Resume a suspended worker"""
        if self._is_alive() and PSUTIL_AVAILABLE and self.is_suspended:
            try:
                psutil.Process(self.worker.pid).resume()
                self.is_suspended = False
                logger.info(f"Kernel {self.notebook_id} resumed")
            except Exception as e:
                logger.warning(f"Failed to resume kernel {self.notebook_id}: {e}")

    def execute(self, code: str, output_callback: Optional[Callable] = None) -> ExecutionResult:
        """
        Execute code with real-time monitoring and error handling.

        Args:
            code (str): The Python source code to execute.
            output_callback (Callable | None): Optional callback for streaming output chunks.

        Returns:
            ExecutionResult: Contains status, stdout, stderr, and resource metrics.
        """
        
        self.last_activity = time.time()
        if self.is_suspended:
            self.resume()
        
        if not self._is_alive():
            try:
                self._start_worker()
            except Exception as e:
                logger.error(f"Kernel {self.notebook_id} crashed: {e}")
                return ExecutionResult(
                    status='crashed',
                    error_details=f"Failed to restart worker: {e}"
                )
        
        monitor = ResourceMonitor(self.worker.pid, self.monitor_interval)
        monitor.start()
        
        start_time = time.time()
        
        try:
            # Send execution request via JSON-RPC
            request = {
                "command": "EXECUTE",
                "code": code
            }
            self.worker.stdin.write(json.dumps(request) + "\n")
            self.worker.stdin.flush()
            
            # Read result with timeout (0 = no timeout)
            result_data = None
            read_thread = threading.Thread(target=self._read_result, args=(self.worker.stderr, output_callback))
            read_thread.daemon = True
            read_thread.start()
            # Use None for join timeout when self.timeout is 0 (no timeout)
            read_thread.join(timeout=self.timeout if self.timeout > 0 else None)
            
            if read_thread.is_alive():
                # Timeout occurred
                monitor.stop()
                logger.warning(f"Kernel {self.notebook_id} timeout after {self.timeout}s")
                
                # Terminate worker
                if self._is_alive():
                    self.worker.terminate()
                    time.sleep(1)
                    if self._is_alive():
                        self.worker.kill()
                
                try:
                    self._start_worker()
                except Exception:
                    pass
                
                return ExecutionResult(
                    status='timeout',
                    error_details=f"Execution exceeded {self.timeout} seconds timeout",
                    execution_time=time.time() - start_time,
                    metrics=monitor.metrics
                )
            
            # Get result from thread
            if hasattr(self, '_last_result'):
                result_data = self._last_result
                delattr(self, '_last_result')
            
            if not result_data:
                raise RuntimeError("No result received from worker")
            
            metrics = monitor.stop()
            
            return ExecutionResult(
                status=result_data['status'],
                stdout=result_data.get('stdout', ''),
                stderr=result_data.get('stderr', ''),
                error_details=result_data.get('error_details'),
                execution_time=result_data.get('duration', 0.0),
                metrics=metrics,
                namespace_vars=result_data.get('namespace_vars', {}),
                outputs=result_data.get('outputs', [])
            )
            
        except Exception as e:
            monitor.stop()
            logger.error(f"Kernel {self.notebook_id} error: {e}")
            return ExecutionResult(
                status='error',
                error_details=f"Execution error: {traceback.format_exc()}",
                metrics=monitor.metrics
            )
    def _read_result(self, stderr_stream, output_callback=None):
        """
        Listen to the worker's stderr stream for JSON-RPC messages.

        Args:
            stderr_stream (IO): The stream to read from.
            output_callback (Callable | None): Callback for intermediate output streams.
        """
        try:
            while True:
                # Read line from stderr
                result_line = stderr_stream.readline()
                
                if not result_line or not result_line.strip():
                    self._last_result = {
                        'status': 'error',
                        'error_details': 'No response received from worker'
                    }
                    return
                
                # Try to parse the line as JSON
                try:
                    data = json.loads(result_line.strip())
                    
                    if data.get("type") == "stream":
                        if output_callback:
                            try:
                                # We construct a minimal dictionary or object that matches RichOutput structure
                                # Since python is duck typed, kernel_manager just needs `output.type`, `output.data`, `output.stream` etc.
                                class DummyRichOutput:
                                    def __init__(self, t, d, s):
                                        self.type = t
                                        self.data = d
                                        self.stream = s
                                        self.mimeType = None
                                out = DummyRichOutput('stream', data.get("data", ""), data.get("stream", "stdout"))
                                output_callback(out)
                            except Exception as ex:
                                pass
                        continue
                    
                    # It's the final result data message 
                    self._last_result = data
                    break
                except json.JSONDecodeError as e:
                    # Provide detailed error info
                    self._last_result = {
                        'status': 'error',
                        'error_details': f"Failed to parse worker response: {e}. Received: {result_line.strip()[:100]}"
                    }
                    break
        except Exception as e:
            self._last_result = {
                'status': 'error',
                'error_details': f'Exception reading worker output: {str(e)}'
            }

    def get_namespace_info(self) -> Dict[str, str]:
        """
        Retrieve summary info of variables in the last execution's namespace.

        Returns:
            Dict[str, str]: Map of variable names to their string representations.
        """
        return {}

    def shutdown(self):
        """Gracefully shutdown the worker process"""
        if self._is_alive():
            try:
                # Send shutdown command
                request = {"command": "SHUTDOWN"}
                self.worker.stdin.write(json.dumps(request) + "\n")
                self.worker.stdin.flush()
                
                # Wait for process to exit
                self.worker.wait(timeout=2)
            except Exception:
                pass
            finally:
                if self._is_alive():
                    self.worker.terminate()
                    time.sleep(1)
                    if self._is_alive():
                        self.worker.kill()
        logger.info(f"Shutdown isolated kernel for notebook {self.notebook_id}")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.shutdown()
