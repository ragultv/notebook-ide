# Isolated Kernel - Production-grade process isolation for notebooks
# Each notebook gets its own worker process for true isolation

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
    """Real-time resource usage metrics"""
    peak_memory_mb: float = 0.0
    avg_memory_mb: float = 0.0
    peak_cpu_percent: float = 0.0
    avg_cpu_percent: float = 0.0
    samples_count: int = 0


@dataclass
class ExecutionResult:
    status: str  # 'success' | 'error' | 'timeout' | 'killed' | 'crashed'
    stdout: str = ""
    stderr: str = ""
    error_details: Optional[str] = None
    execution_time: float = 0.0
    metrics: ResourceMetrics = field(default_factory=ResourceMetrics)
    namespace_vars: Dict[str, str] = field(default_factory=dict)
    outputs: List[Dict[str, Any]] = field(default_factory=list)


class ResourceMonitor:
    """Monitors resource usage in real-time during execution"""
    
    def __init__(self, pid: int, interval: float = 0.05):
        self.pid = pid
        self.interval = interval
        self.metrics = ResourceMetrics()
        self._stop_event = threading.Event()
        self._thread = None
        
    def start(self):
        """Start monitoring in background thread"""
        if not PSUTIL_AVAILABLE:
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self._thread.start()
    
    def stop(self) -> ResourceMetrics:
        """Stop monitoring and return collected metrics"""
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
                    mem_mb = process.memory_info().rss / (1024 * 1024)
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
    Production-ready isolated kernel with:
    - Real-time resource monitoring
    - Memory/CPU limits
    - Proper cleanup
    - Crash recovery
    - Namespace inspection
    - Uses subprocess instead of multiprocessing for PyInstaller compatibility
    """
    
    def __init__(
        self, 
        notebook_id: str, 
        timeout: int = 0,  # 0 = no timeout (for long-running operations like model downloads)
        max_memory_mb: Optional[int] = None,
        monitor_interval: float = 0.05,
        python_path: Optional[str] = None
    ):
        self.notebook_id = notebook_id
        self.timeout = timeout  # 0 means no timeout
        self.max_memory_mb = max_memory_mb
        self.monitor_interval = monitor_interval
        self.python_path = python_path or sys.executable
        
        self.worker = None
        self.monitor = None
        
        self._start_worker()
        logger.info(f"Created isolated kernel for notebook {notebook_id}")

    def _start_worker(self):
        """Spawns the isolated worker process using subprocess"""
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
        
        # Send configuration
        config = {"max_memory_mb": self.max_memory_mb}
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
        """Check if worker process is still alive"""
        return self.worker is not None and self.worker.poll() is None

    def execute(self, code: str) -> ExecutionResult:
        """Execute code with real-time monitoring and proper error handling"""
        
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
            read_thread = threading.Thread(target=self._read_result, args=(self.worker.stderr,))
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
    
    def _read_result(self, stderr_stream):
        """Helper to read result from stderr in a separate thread"""
        try:
            # Read first line from stderr
            result_line = stderr_stream.readline()
            
            if not result_line or not result_line.strip():
                self._last_result = {
                    'status': 'error',
                    'error_details': 'No response received from worker'
                }
                return
            
            # Try to parse the line as JSON
            try:
                self._last_result = json.loads(result_line.strip())
            except json.JSONDecodeError as e:
                # Provide detailed error info
                self._last_result = {
                    'status': 'error',
                    'error_details': f"Failed to parse worker response: {e}. Received: {result_line.strip()[:100]}"
                }
        except Exception as e:
            self._last_result = {
                'status': 'error',
                'error_details': f"Failed to read result: {e}"
            }

    def get_namespace_info(self) -> Dict[str, str]:
        """Get current namespace variable summary (from last execution)"""
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
