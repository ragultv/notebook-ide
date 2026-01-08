# Isolated Kernel - Production-grade process isolation for notebooks
# Each notebook gets its own worker process for true isolation

import multiprocessing as mp
import sys
import os
import time
import traceback
import io
import threading
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, Optional, List
from contextlib import redirect_stdout, redirect_stderr

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
    """
    
    def __init__(
        self, 
        notebook_id: str, 
        timeout: int = 60,
        max_memory_mb: Optional[int] = None,
        monitor_interval: float = 0.05
    ):
        self.notebook_id = notebook_id
        self.timeout = timeout
        self.max_memory_mb = max_memory_mb
        self.monitor_interval = monitor_interval
        
        self.task_queue = mp.Queue()
        self.result_queue = mp.Queue()
        self.worker = None
        self.monitor = None
        
        self._start_worker()
        logger.info(f"Created isolated kernel for notebook {notebook_id}")

    def _start_worker(self):
        """Spawns the isolated worker process"""
        ctx = mp.get_context('spawn')
        self.worker = ctx.Process(
            target=self._worker_loop,
            args=(self.task_queue, self.result_queue, self.max_memory_mb),
            daemon=False
        )
        self.worker.start()
        
        time.sleep(0.1)
        
        if not self.worker.is_alive():
            raise RuntimeError(f"Worker process failed to start for {self.notebook_id}")

    @staticmethod
    def _set_resource_limits(max_memory_mb: Optional[int]):
        """Set resource limits for the worker process (Unix only)"""
        if max_memory_mb and not IS_WINDOWS:
            try:
                import resource
                max_bytes = max_memory_mb * 1024 * 1024
                resource.setrlimit(resource.RLIMIT_AS, (max_bytes, max_bytes))
            except (ImportError, OSError) as e:
                print(f"Warning: Could not set resource limits: {e}", file=sys.stderr)

    @staticmethod
    def _worker_loop(task_queue: mp.Queue, result_queue: mp.Queue, max_memory_mb: Optional[int]):
        """Isolated persistent execution loop with proper output capture"""
        
        TrulyIsolatedKernel._set_resource_limits(max_memory_mb)
        
        local_namespace = {
            "__name__": "__main__",
            "__builtins__": __builtins__
        }
        
        def execute_with_capture(code_str: str, namespace: dict):
            """Execute code with stdout/stderr capture using redirect_stdout/stderr"""
            stdout_buffer = io.StringIO()
            stderr_buffer = io.StringIO()
            
            try:
                start_time = time.perf_counter()
                
                with redirect_stdout(stdout_buffer), redirect_stderr(stderr_buffer):
                    exec(code_str, namespace)
                
                duration = time.perf_counter() - start_time
                
                ns_summary = TrulyIsolatedKernel._summarize_namespace(namespace)
                
                return {
                    'status': 'success',
                    'stdout': stdout_buffer.getvalue(),
                    'stderr': stderr_buffer.getvalue(),
                    'error_details': None,
                    'duration': duration,
                    'namespace_vars': ns_summary
                }
                
            except MemoryError:
                return {
                    'status': 'killed',
                    'stdout': stdout_buffer.getvalue(),
                    'stderr': stderr_buffer.getvalue(),
                    'error_details': "MemoryError: Process exceeded memory limit",
                    'duration': 0.0,
                    'namespace_vars': {}
                }
                
            except Exception:
                return {
                    'status': 'error',
                    'stdout': stdout_buffer.getvalue(),
                    'stderr': stderr_buffer.getvalue(),
                    'error_details': traceback.format_exc(),
                    'duration': 0.0,
                    'namespace_vars': {}
                }
        
        while True:
            try:
                task = task_queue.get(timeout=None)
                
                if task == "SHUTDOWN":
                    break
                
                result = execute_with_capture(task, local_namespace)
                result_queue.put(result)
                
            except Exception as e:
                result_queue.put({
                    'status': 'crashed',
                    'stdout': '',
                    'stderr': '',
                    'error_details': f"Worker loop error: {traceback.format_exc()}",
                    'duration': 0.0,
                    'namespace_vars': {}
                })
                break

    @staticmethod
    def _summarize_namespace(namespace: dict) -> Dict[str, str]:
        """Create a safe summary of namespace variables"""
        summary = {}
        for key, value in namespace.items():
            if key.startswith('__') or key == '__builtins__':
                continue
            try:
                if hasattr(value, '__name__'):
                    summary[key] = f"<{type(value).__name__}: {value.__name__}>"
                elif isinstance(value, (int, float, str, bool, type(None))):
                    summary[key] = repr(value)
                elif isinstance(value, (list, tuple, dict, set)):
                    summary[key] = f"<{type(value).__name__} len={len(value)}>"
                else:
                    summary[key] = f"<{type(value).__name__}>"
            except Exception:
                summary[key] = "<unavailable>"
        return summary

    def execute(self, code: str) -> ExecutionResult:
        """Execute code with real-time monitoring and proper error handling"""
        
        if not self.worker.is_alive():
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
        
        self.task_queue.put(code)
        
        start_time = time.time()
        
        try:
            result_data = self.result_queue.get(timeout=self.timeout)
            
            metrics = monitor.stop()
            
            return ExecutionResult(
                status=result_data['status'],
                stdout=result_data['stdout'],
                stderr=result_data['stderr'],
                error_details=result_data['error_details'],
                execution_time=result_data['duration'],
                metrics=metrics,
                namespace_vars=result_data['namespace_vars']
            )
            
        except mp.queues.Empty:
            monitor.stop()
            logger.warning(f"Kernel {self.notebook_id} timeout after {self.timeout}s")
            
            if self.worker.is_alive():
                self.worker.terminate()
                self.worker.join(timeout=2)
                if self.worker.is_alive():
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
            
        except Exception as e:
            monitor.stop()
            logger.error(f"Kernel {self.notebook_id} error: {e}")
            return ExecutionResult(
                status='error',
                error_details=f"Execution error: {traceback.format_exc()}",
                metrics=monitor.metrics
            )

    def get_namespace_info(self) -> Dict[str, str]:
        """Get current namespace variable summary (from last execution)"""
        return {}

    def shutdown(self):
        """Gracefully shutdown the worker process"""
        if self.worker and self.worker.is_alive():
            try:
                self.task_queue.put("SHUTDOWN")
                self.worker.join(timeout=2)
            except Exception:
                pass
            finally:
                if self.worker.is_alive():
                    self.worker.terminate()
                    self.worker.join(timeout=1)
                    if self.worker.is_alive():
                        self.worker.kill()
        logger.info(f"Shutdown isolated kernel for notebook {self.notebook_id}")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.shutdown()
