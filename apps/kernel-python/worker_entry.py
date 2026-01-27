"""
Standalone Worker Entry Point for Isolated Code Execution
Communicates via JSON-RPC over stdin/stderr (to avoid conflicts with stdout capture)
"""

import os
import sys

# Suppress TensorFlow and other library logging BEFORE any imports
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'  # Suppress TensorFlow C++ warnings
os.environ['TF_ENABLE_ONEDNN_OPTS'] = '0'  # Disable oneDNN custom ops messages
os.environ['CUDA_VISIBLE_DEVICES'] = '-1'  # Disable CUDA to avoid GPU messages
os.environ['NUMEXPR_MAX_THREADS'] = '1'  # Suppress numexpr threading messages
os.environ['OMP_NUM_THREADS'] = '1'  # Suppress OpenMP messages

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


def _magic_run(cmd: str):
    """Helper to run magic commands like !pip with real-time output streaming"""
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
    
    # Stream output line by line in real-time
    def stream_output():
        try:
            for line in iter(process.stdout.readline, ''):
                if line:
                    print(line, end='', flush=True)
        except Exception:
            pass
    
    # Run streaming in the current thread (blocking) to ensure output is captured
    stream_output()
    
    # Wait for process to complete
    return_code = process.wait()
    
    if return_code != 0:
        raise RuntimeError(f"Command failed with exit code {return_code}")


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
    
    outputs = []
    
    try:
        start_time = time.perf_counter()
        
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
        
        subprocess.Popen = CapturedPopen
        
        try:
            with redirect_stdout(stdout_buffer), redirect_stderr(stderr_buffer):
                exec(processed_code, namespace)
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
            'duration': 0.0,
            'namespace_vars': {},
            'outputs': []
        }
        
    except Exception:
        tb = traceback.format_exc()
        return {
            'status': 'error',
            'stdout': stdout_buffer.getvalue(),
            'stderr': stderr_buffer.getvalue(),
            'error_details': tb,
            'duration': 0.0,
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


def set_resource_limits(max_memory_mb: int):
    """Set resource limits for the worker process (Unix only)"""
    if max_memory_mb and sys.platform != 'win32':
        try:
            import resource
            max_bytes = max_memory_mb * 1024 * 1024
            resource.setrlimit(resource.RLIMIT_AS, (max_bytes, max_bytes))
        except (ImportError, OSError) as e:
            print(f"Warning: Could not set resource limits: {e}", file=sys.stderr)


def worker_main():
    """Main worker loop - reads JSON-RPC requests from stdin, executes, writes results to stderr"""
    
    # Read configuration from first line
    try:
        config_line = sys.stdin.readline()
        config = json.loads(config_line)
        max_memory_mb = config.get('max_memory_mb')
        
        if max_memory_mb:
            set_resource_limits(max_memory_mb)
        
        # Send ready signal via stderr
        _write_response({"status": "ready"})
        
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
                result = execute_with_capture(code, local_namespace)
                
                # Write result to stderr as JSON
                _write_response(result)
            
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
