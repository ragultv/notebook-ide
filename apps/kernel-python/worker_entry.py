"""
Standalone Worker Entry Point for Isolated Code Execution
Communicates via JSON-RPC over stdin/stderr (to avoid conflicts with stdout capture)
"""

import os
import sys

# Suppress TensorFlow and other library logging BEFORE any imports

# NOTE: CUDA_VISIBLE_DEVICES is set AFTER reading the config from stdin,
# because whether to enable GPU depends on the device selection from the UI.
# We do NOT set it here — it's handled in worker_main() based on the config.
os.environ['NUMEXPR_MAX_THREADS'] = '1'  # Suppress numexpr threading messages
os.environ['OMP_NUM_THREADS'] = '1'      # Suppress OpenMP messages
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
os.environ['TF_ENABLE_ONEDNN_OPTS'] = '0'

import io
import time
import traceback
import json
import warnings
from contextlib import redirect_stdout, redirect_stderr

# Suppress all warnings to keep stderr clean for JSON-RPC communication
warnings.filterwarnings('ignore')


# Use a separate file descriptor for JSON-RPC communication
# This prevents conflicts with stdout/stderr redirection during code execution
def _write_response(data: dict):
    """Write JSON response to stderr for IPC"""
    # Write to original stderr before any redirection
    sys.__stderr__.write(json.dumps(data) + "\n")
    sys.__stderr__.flush()


import builtins
_original_input = builtins.input

def custom_input(prompt=""):
    _write_response({
        "type": "input_request",
        "prompt": str(prompt)
    })
    line = sys.stdin.readline()
    if not line:
        return ""
    try:
        req = json.loads(line)
        if req.get("command") == "INPUT_REPLY":
            return req.get("value", "")
    except Exception:
        pass
    return line.strip("\n")

builtins.input = custom_input


def _magic_run(cmd: str, timeout_seconds: float = 300):
    """Helper to run magic commands like !pip with real-time output streaming.

    Returns the full output and raises on failure with the captured output included.
    """
    import subprocess
    import threading

    # Special handling for pip to ensure we use the same python environment
    if cmd.strip().startswith('pip '):
        cmd = f'"{sys.executable}" -m {cmd}'

    # Use Popen for real-time streaming output
    process = subprocess.Popen(
        cmd,
        shell=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,  # Merge stderr into stdout for unified streaming
        text=True,
        bufsize=1,  # Line buffered
        universal_newlines=True
    )

    output_lines: list[str] = []

    # Stream output line by line in real-time
    def stream_output():
        try:
            for line in iter(process.stdout.readline, ''):
                if line:
                    output_lines.append(line)
                    # Send real-time output back to the controller
                    _write_response({
                        "type": "stream",
                        "stream": "stdout",
                        "data": line
                    })
        except Exception:
            pass

    # Run streaming in the current thread (blocking) to ensure output is captured
    stream_thread = threading.Thread(target=stream_output)
    stream_thread.daemon = True
    stream_thread.start()

    # Wait for process to complete with a timeout to avoid hangs
    try:
        return_code = process.wait(timeout=timeout_seconds)
    except subprocess.TimeoutExpired:
        process.kill()
        raise RuntimeError(
            f"Command timed out after {timeout_seconds}s. Output so far:\n{''.join(output_lines)}"
        )

    # Ensure the streaming thread is finished
    stream_thread.join(timeout=1)

    output = ''.join(output_lines)
    if return_code != 0:
        raise RuntimeError(f"Command failed with exit code {return_code}. Output:\n{output}")

    return output


def execute_with_capture(code_str: str, namespace: dict):
    """Execute code with stdout/stderr capture"""
    stdout_buffer = io.StringIO()
    stderr_buffer = io.StringIO()
    
    # Pre-process code to handle magic commands (!)
    processed_lines = []
    for line in code_str.splitlines():
        stripped = line.lstrip()
        if stripped.startswith('!'):
            indent = line[:len(line) - len(stripped)]
            cmd = stripped[1:]
            # Escape quotes for python string
            cmd_esc = cmd.replace("'", "\\'").replace('"', '\\"')
            # Replace with _magic_run call
            processed_lines.append(f"{indent}_magic_run('{cmd_esc}')")
        else:
            processed_lines.append(line)
    
    processed_code = "\n".join(processed_lines)
    
    # Try to import matplotlib and set backend to Agg (non-interactive)
    try:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        
        # Custom figure tracking to capture ALL plots
        if not hasattr(plt, '_captured_figures'):
            plt._captured_figures = []
            
        original_figure = plt.figure
        def captured_figure(*args, **kwargs):
            fig = original_figure(*args, **kwargs)
            if fig not in plt._captured_figures:
                plt._captured_figures.append(fig)
            return fig
        
        plt.figure = captured_figure
        
        # Patch plt.show to prevent "non-interactive" warnings
        plt.show = lambda *args, **kwargs: None
        
        HAS_MATPLOTLIB = True
    except ImportError:
        HAS_MATPLOTLIB = False
    
    class LiveStream(io.StringIO):
        def __init__(self, stream_type='stdout'):
            super().__init__()
            self._stream_type = stream_type
            
        def write(self, s):
            super().write(s)
            if s:
                _write_response({
                    "type": "stream",
                    "stream": self._stream_type,
                    "data": s
                })
            return len(s)

        def isatty(self):
            return True

    stdout_buffer = LiveStream('stdout')
    stderr_buffer = LiveStream('stderr')
    
    outputs = []
    start_time = time.perf_counter()  # Start timing HERE, before exec(), accessible in all except blocks
    
    try:
        # Monkey-patch subprocess to capture output from spawned processes
        import subprocess
        import threading
        original_popen = subprocess.Popen
        
        class CapturedPopen(original_popen):
            """Subclass of Popen that redirects stdout/stderr to our buffers"""
            def __init__(self, *args, **kwargs):
                # Check if stdout/stderr are being redirected to DEVNULL or files
                stdout_arg = kwargs.get('stdout')
                stderr_arg = kwargs.get('stderr')
                
                # Only capture if not explicitly suppressed (DEVNULL, file handles, etc.)
                should_capture = (
                    (stdout_arg is None or stdout_arg == subprocess.PIPE) and
                    (stderr_arg is None or stderr_arg == subprocess.PIPE)
                )
                
                if should_capture:
                    # Force pipe capture
                    kwargs['stdout'] = subprocess.PIPE
                    kwargs['stderr'] = subprocess.PIPE
                    if 'text' not in kwargs:
                        kwargs['text'] = True
                    
                    # Create process
                    super().__init__(*args, **kwargs)
                    
                    # Stream output in background threads
                    def stream_stdout():
                        try:
                            if self.stdout:
                                for line in iter(self.stdout.readline, ''):
                                    if line:
                                        print(line, end='', flush=True)
                        except Exception:
                            pass
                    
                    def stream_stderr():
                        try:
                            if self.stderr:
                                for line in iter(self.stderr.readline, ''):
                                    if line:
                                        print(line, end='', file=sys.stderr, flush=True)
                        except Exception:
                            pass
                    
                    # Start streaming threads
                    stdout_thread = threading.Thread(target=stream_stdout)
                    stderr_thread = threading.Thread(target=stream_stderr)
                    stdout_thread.daemon = True
                    stderr_thread.daemon = True
                    stdout_thread.start()
                    stderr_thread.start()
                    
                    # Store threads on process for potential cleanup
                    self._output_threads = (stdout_thread, stderr_thread)
                else:
                    super().__init__(*args, **kwargs)
        
        # Keep a reference to the original Popen so we can restore it after
        # patching for user code execution. If we don't restore it, pip installs
        # (and other subprocess usage) can accidentally use our custom Popen.
        original_popen = subprocess.Popen

        attempted_installs = set()
        pip_upgraded = False

        def _run_execution():
            nonlocal stdout_buffer, stderr_buffer

            # Patch subprocess.Popen so user code (and any subprocesses it spawns)
            # are captured in the worker output.
            subprocess.Popen = CapturedPopen

            try:
                stdout_buffer = LiveStream('stdout')
                stderr_buffer = LiveStream('stderr')
                with redirect_stdout(stdout_buffer), redirect_stderr(stderr_buffer):
                    _write_response({"type": "execution_start"})
                    exec(processed_code, namespace)
                    _write_response({"type": "execution_end"})
            finally:
                # Restore the original Popen after the user code runs
                subprocess.Popen = original_popen

        try:
            try:
                _run_execution()
            except ModuleNotFoundError as mnfe:
                missing = getattr(mnfe, 'name', None) or None
                if not missing:
                    msg = str(mnfe)
                    if "No module named" in msg and "'" in msg:
                        missing = msg.split("'")[1]

                if missing and missing not in attempted_installs:
                    attempted_installs.add(missing)
                    _write_response({
                        "type": "stream",
                        "stream": "stderr",
                        "data": f"Module '{missing}' not found. Installing...\n"
                    })

                    # Keep pip/up-to-date to improve compatibility for many packages
                    if not pip_upgraded:
                        try:
                            _write_response({
                                "type": "stream",
                                "stream": "stderr",
                                "data": "Ensuring pip/setuptools/wheel are up to date...\n"
                            })
                            _magic_run("pip install --upgrade pip setuptools wheel")
                        except Exception as pip_err:
                            err_text = str(pip_err)
                            # If pip is in an externally-managed environment, retry with the breaker flag.
                            if "externally-managed-environment" in err_text or "externally managed" in err_text:
                                try:
                                    _write_response({
                                        "type": "stream",
                                        "stream": "stderr",
                                        "data": "Detected externally-managed environment; retrying upgrade with --break-system-packages...\n"
                                    })
                                    _magic_run("pip install --break-system-packages --upgrade pip setuptools wheel")
                                except Exception as pip_err2:
                                    raise RuntimeError(
                                        f"Automatic pip upgrade failed: {pip_err}\nRetry also failed: {pip_err2}"
                                    ) from pip_err2
                            else:
                                raise RuntimeError(
                                    f"Automatic pip upgrade failed: {pip_err}"
                                ) from pip_err
                        pip_upgraded = True

                    try:
                        _magic_run(f"pip install {missing}")
                    except Exception as pip_err:
                        err_text = str(pip_err)

                        # If pip can't find the package on PyPI, give a clear message.
                        if "No matching distribution found" in err_text:
                            raise RuntimeError(
                                f"Auto-install failed: package '{missing}' is not available on PyPI. "
                                "Check the module name or install it manually if it exists outside PyPI.\n"
                                f"Pip output:\n{err_text}"
                            ) from pip_err

                        # In system-managed environments (PEP 668), pip refuses installs.
                        # Retry once using --break-system-packages to allow installs.
                        if "externally-managed-environment" in err_text or "externally managed" in err_text:
                            try:
                                _write_response({
                                    "type": "stream",
                                    "stream": "stderr",
                                    "data": "Detected externally-managed environment; retrying install with --break-system-packages...\n"
                                })
                                _magic_run(f"pip install --break-system-packages {missing}")
                            except Exception as pip_err2:
                                raise RuntimeError(
                                    f"Auto-install failed for module '{missing}': {pip_err}\nRetry also failed: {pip_err2}"
                                ) from pip_err2
                        else:
                            raise RuntimeError(
                                f"Auto-install failed for module '{missing}': {pip_err}"
                            ) from pip_err

                    _run_execution()
                else:
                    raise
        finally:
            # Restore original Popen
            subprocess.Popen = original_popen
        
        # Check for matplotlib plots
        if HAS_MATPLOTLIB:
            try:
                import base64
                
                # Collect all unique figures
                figures_to_capture = []
                
                # Add figures from our custom tracker
                if hasattr(plt, '_captured_figures'):
                    figures_to_capture.extend(plt._captured_figures)
                
                # Add any other active figures (e.g. from plt.subplots)
                for i in plt.get_fignums():
                    fig = plt.figure(i)
                    if fig not in figures_to_capture:
                        figures_to_capture.append(fig)
                
                # Process all unique figures
                for fig in figures_to_capture:
                    try:
                        buf = io.BytesIO()
                        fig.savefig(buf, format='png', bbox_inches='tight')
                        buf.seek(0)
                        img_str = base64.b64encode(buf.read()).decode('utf-8')
                        outputs.append({
                            'type': 'image',
                            'mimeType': 'image/png',
                            'data': img_str
                        })
                    except Exception as e:
                        print(f"Error saving figure: {e}", file=sys.stderr)
                    finally:
                        plt.close(fig)
                
                # Clear our custom tracker for next run
                if hasattr(plt, '_captured_figures'):
                    plt._captured_figures = []
                    
            except Exception as e:
                print(f"Error capturing plot: {e}", file=sys.stderr)
        
        duration = time.perf_counter() - start_time
        
        ns_summary = summarize_namespace(namespace)
        
        # Aggressively collect garbage to free any unreferenced temporary variables
        import gc
        gc.collect()
        
        return {
            'status': 'success',
            'stdout': stdout_buffer.getvalue(),
            'stderr': stderr_buffer.getvalue(),
            'error_details': None,
            'duration': duration,
            'namespace_vars': ns_summary,
            'outputs': outputs
        }
        
    except MemoryError:
        return {
            'status': 'killed',
            'stdout': stdout_buffer.getvalue(),
            'stderr': stderr_buffer.getvalue(),
            'error_details': "MemoryError: Process exceeded memory limit",
            'duration': time.perf_counter() - start_time,
            'namespace_vars': {},
            'outputs': []
        }
        
    except KeyboardInterrupt:
        return {
            'status': 'error',
            'stdout': stdout_buffer.getvalue(),
            'stderr': stderr_buffer.getvalue(),
            'error_details': "KeyboardInterrupt: Execution interrupted by user",
            'duration': time.perf_counter() - start_time,
            'namespace_vars': {},
            'outputs': []
        }
        
    except Exception:
        import gc
        gc.collect()
        tb = traceback.format_exc()
        return {
            'status': 'error',
            'stdout': stdout_buffer.getvalue(),
            'stderr': stderr_buffer.getvalue(),
            'error_details': tb,
            'duration': time.perf_counter() - start_time,
            'namespace_vars': {},
            'outputs': []
        }


def summarize_namespace(namespace: dict) -> dict:
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


def get_memory_snapshot(namespace: dict) -> dict:
    """Collect detailed memory information for variables in the namespace"""
    import inspect
    import types
    import random
    
    variables = []
    coordinates = []
    total_size = 0
    now = time.time()
    
    # Simple mapping of Python types to frontend categories
    def categorize(obj):
        # AI/ML Specifics
        if hasattr(obj, '__module__'):
            mod = obj.__module__
            if mod.startswith('torch') or mod.startswith('tensorflow'):
                return 'tensor'
            if mod.startswith('pandas') or mod.startswith('numpy'):
                return 'array'
            if 'sklearn' in mod or 'transformers' in mod:
                return 'model'
        
        if isinstance(obj, (int, float, str, bool, complex)) or obj is None:
            return 'scalar'
        if isinstance(obj, (list, tuple, dict, set)):
            return 'collection'
        if isinstance(obj, (types.FunctionType, types.MethodType, types.BuiltinFunctionType)):
            return 'function'
        if isinstance(obj, types.ModuleType):
            return 'module'
        if isinstance(obj, types.GeneratorType):
            return 'generator'
        return 'object'

    def get_size(obj):
        try:
            # Handle numpy/torch tensors specifically for accurate size
            if hasattr(obj, 'nbytes'):
                return int(obj.nbytes)
            if hasattr(obj, 'element_size') and hasattr(obj, 'nelement'):
                return int(obj.element_size() * obj.nelement())
            return sys.getsizeof(obj)
        except:
            return 0

    def get_shape(obj):
        if hasattr(obj, 'shape'):
            try:
                s = obj.shape
                if hasattr(s, 'tolist'):
                    return s.tolist()
                return list(s)
            except:
                pass
        return None

    for name, value in namespace.items():
        if name.startswith('__') or name == '_magic_run':
            continue
            
        size = get_size(value)
        total_size += size
        category = categorize(value)
        
        # Metadata
        var_data = {
            "name": name,
            "type_name": type(value).__name__,
            "type_category": category,
            "size_bytes": size,
            "ref_count": sys.getrefcount(value) - 1, # -1 for the ref in this loop
            "creation_time": now, # Stub: true creation time not available
            "last_access_time": now, # Stub
            "is_mutable": not isinstance(value, (int, float, str, bool, tuple, frozenset, type(None))),
            "shape": get_shape(value),
            "dependencies": [] # For future: static/dynamic analysis of refs
        }
        
        variables.append(var_data)
        
        # Mock coordinates using a simple organic distribution
        # In a real app, this would use UMAP/PCA on variable features
        angle = random.uniform(0, 2 * 3.14159)
        dist = random.uniform(1, 100)
        if category == 'tensor': dist *= 0.5 # Clusters
        elif category == 'scalar': dist *= 1.5 # Scattered
        
        coordinates.append([
            dist * (0.5 + random.random()) * 0.1, # Small scale for visualization
            dist * (0.5 + random.random()) * 0.1
        ])

    return {
        "timestamp": now,
        "variables": variables,
        "coordinates_2d": coordinates,
        "total_memory_bytes": total_size,
        "algorithm": 'umap' # Mocked
    }


def set_resource_limits(max_memory_mb: int):
    """Set resource limits for the worker process (Unix only)"""
    if max_memory_mb and sys.platform != 'win32':
        try:
            import resource
            max_bytes = max_memory_mb * 1024 * 1024
            resource.setrlimit(resource.RLIMIT_AS, (max_bytes, max_bytes))
        except (ImportError, OSError) as e:
            print(f"Warning: Could not set resource limits: {e}", file=sys.stderr)


def get_completions(code: str, cursor_pos: int, namespace: dict, context_code: str = "") -> list:
    """Get code completions using Jedi if available, otherwise fallback to namespace keys"""
    try:
        import jedi
        # Prepend context code if available to provide cross-cell completions
        full_code = context_code + "\n" + code if context_code else code
        adjusted_cursor_pos = cursor_pos + (len(context_code) + 1 if context_code else 0)

        # Jedi uses 1-based line numbers and 0-based column numbers
        lines = full_code[:adjusted_cursor_pos].splitlines(keepends=True)
        if not lines:
            line_num = 1
            col_num = 0
        else:
            line_num = len(lines)
            col_num = len(lines[-1])
            if full_code[adjusted_cursor_pos-1:adjusted_cursor_pos] == '\n':
                line_num += 1
                col_num = 0

        # Create interpreter with the full context
        interpreter = jedi.Interpreter(full_code, [namespace])
        completions = interpreter.complete(line_num, col_num)
        
        return [
            {
                "name": c.name,
                "type": c.type,
                "description": c.description,
                "docstring": c.docstring() if hasattr(c, 'docstring') else "",
                "complete": c.complete
            }
            for c in completions
        ]
    except ImportError:
        # Fallback: very basic completion based on namespace keys
        prefix = ""
        # Try to find the word being typed
        import re
        match = re.search(r'([a-zA-Z_][a-zA-Z0-9_]*)$', code[:cursor_pos])
        if match:
            prefix = match.group(1).lower()
        
        results = []
        for key in namespace.keys():
            if not key.startswith('_') and key.lower().startswith(prefix):
                results.append({
                    "name": key,
                    "type": "variable",
                    "description": f"Variable: {key}",
                    "complete": key[len(prefix):]
                })
        return results
    except Exception as e:
        return [{"name": f"Error: {str(e)}", "type": "error", "complete": ""}]


def worker_main():
    """Main worker loop - reads JSON-RPC requests from stdin, executes, writes results to stderr"""
    
    # Read configuration from first line
    try:
        config_line = sys.stdin.readline()
        config = json.loads(config_line)
        max_memory_mb = config.get('max_memory_mb')
        device = config.get('device', 'cpu')  # 'cpu' or 'cuda'

        # ── Configure CUDA visibility based on selected runtime ──────────────
        # This MUST happen before any ML library imports so they see the right device.
        if device == 'cuda':
            # Clear any inherited CUDA_VISIBLE_DEVICES restriction
            os.environ.pop('CUDA_VISIBLE_DEVICES', None)
        else:
            # '-1' = hide all GPUs (CPU-only execution)
            os.environ['CUDA_VISIBLE_DEVICES'] = '-1'
        # ─────────────────────────────────────────────────────────────────────

        if max_memory_mb:
            set_resource_limits(max_memory_mb)

        # ── Pre-flight CUDA check ─────────────────────────────────────────────
        # If GPU runtime is requested, verify torch can see a CUDA device BEFORE
        # we accept the first cell execution. This surfaces a clear, actionable
        # error instead of a cryptic unsloth/torch traceback later.
        if device == 'cuda':
            try:
                import torch
                if not torch.cuda.is_available():
                    # Detect whether torch was built without CUDA at all
                    cuda_in_build = '+cu' in torch.__version__ or 'cuda' in torch.__version__.lower()
                    if not cuda_in_build:
                        problem = (
                            f"Your PyTorch is CPU-only ({torch.__version__}).\n\n"
                            "To use GPU runtime you need a CUDA-enabled PyTorch. "
                            "Run the following command, then restart the kernel:\n\n"
                            "    pip install torch torchvision torchaudio "
                            "--index-url https://download.pytorch.org/whl/cu121"
                        )
                    else:
                        problem = (
                            f"CUDA not available (PyTorch {torch.__version__}).\n\n"
                            "Make sure:\n"
                            "  1. You have an NVIDIA GPU\n"
                            "  2. NVIDIA drivers are installed (run: nvidia-smi)\n"
                            "  3. The CUDA toolkit version matches your PyTorch build\n\n"
                            "GPU device count: 0"
                        )
                    _write_response({"status": "ready"})
                    _CUDA_PREFLIGHT_ERROR = problem
                else:
                    # CUDA is available — get GPU info and do a deeper vendor check
                    # that matches what unsloth_zoo does internally.
                    gpu_name = torch.cuda.get_device_name(0)
                    gpu_mem_gb = torch.cuda.get_device_properties(0).total_memory // (1024 ** 3)

                    # Mimic unsloth_zoo's vendor detection — it checks for NVIDIA/AMD/Intel.
                    # If it can't classify, it raises NotImplementedError. We catch that here
                    # so the user gets a clear message instead of a stacktrace.
                    gpu_vendor = gpu_name.upper()
                    known_vendor = any(v in gpu_vendor for v in ['NVIDIA', 'AMD', 'RADEON', 'INTEL', 'GEFORCE', 'RTX', 'GTX', 'QUADRO', 'TESLA'])

                    if not known_vendor:
                        problem = (
                            f"GPU detected: {gpu_name}\n\n"
                            "Unsloth requires an NVIDIA, AMD, or Intel GPU but could not "
                            f"classify '{gpu_name}' as a supported device.\n\n"
                            "If this is an NVIDIA GPU, make sure the NVIDIA CUDA toolkit and "
                            "drivers are properly installed and try reinstalling PyTorch:\n\n"
                            "    pip install torch torchvision torchaudio "
                            "--index-url https://download.pytorch.org/whl/cu121"
                        )
                        _write_response({"status": "ready"})
                        _CUDA_PREFLIGHT_ERROR = problem
                    else:
                        _write_response({
                            "status": "ready",
                            "gpu": f"{gpu_name} ({gpu_mem_gb} GB VRAM)"
                        })
                        _CUDA_PREFLIGHT_ERROR = None
            except ImportError:
                _write_response({"status": "ready"})
                _CUDA_PREFLIGHT_ERROR = (
                    "PyTorch is not installed. Install it with:\n\n"
                    "    pip install torch torchvision torchaudio "
                    "--index-url https://download.pytorch.org/whl/cu121"
                )
        else:
            _write_response({"status": "ready"})
            _CUDA_PREFLIGHT_ERROR = None
        # ─────────────────────────────────────────────────────────────────────

    except Exception as e:
        _write_response({"status": "error", "message": str(e)})
        sys.exit(1)
    
    # Initialize namespace
    local_namespace = {
        "__name__": "__main__",
        "__builtins__": __builtins__,
        "_magic_run": _magic_run
    }
    
    # Main execution loop
    while True:
        try:
            # Read request from stdin
            line = sys.stdin.readline()
            if not line:
                break
            
            request = json.loads(line.strip())
            
            if request.get("command") == "SHUTDOWN":
                break
            
            if request.get("command") == "EXECUTE":
                code = request.get("code", "")

                # If the CUDA preflight check failed, report the error directly
                # instead of running user code (which would give a cryptic traceback)
                if _CUDA_PREFLIGHT_ERROR:
                    _write_response({
                        'status': 'error',
                        'stdout': '',
                        'stderr': '',
                        'error_details': _CUDA_PREFLIGHT_ERROR,
                        'duration': 0.0,
                        'namespace_vars': {},
                        'outputs': []
                    })
                else:
                    result = execute_with_capture(code, local_namespace)
                    # Write result to stderr as JSON
                    _write_response(result)

            if request.get("command") == "COMPLETE":
                code = request.get("code", "")
                cursor_pos = request.get("cursor_pos", len(code))
                context_code = request.get("context_code", "")
                
                completions = get_completions(code, cursor_pos, local_namespace, context_code)
                _write_response({
                    "type": "completions",
                    "completions": completions
                })

            if request.get("command") == "SNAPSHOT":
                snapshot = get_memory_snapshot(local_namespace)
                _write_response(snapshot)
            
        except Exception as e:
            error_result = {
                'status': 'crashed',
                'stdout': '',
                'stderr': '',
                'error_details': f"Worker loop error: {traceback.format_exc()}",
                'duration': 0.0,
                'namespace_vars': {}
            }
            _write_response(error_result)
            break


if __name__ == "__main__":
    worker_main()
