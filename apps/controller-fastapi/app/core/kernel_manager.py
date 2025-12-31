# Kernel Manager - Manages Python kernel lifecycle
import asyncio
import io
import traceback
import uuid
import base64
import sys
import subprocess
import time
import re
from typing import Optional, List, Dict, Any, AsyncGenerator
from dataclasses import dataclass, field
from enum import Enum
from contextlib import redirect_stdout, redirect_stderr

class KernelStatus(str, Enum):
    DISCONNECTED = "disconnected"
    STARTING = "starting"
    IDLE = "idle"
    BUSY = "busy"
    ERROR = "error"

@dataclass
class RichOutput:
    type: str  # 'text', 'image', 'html', 'error', 'stream'
    data: str
    mimeType: Optional[str] = None
    stream: Optional[str] = None  # 'stdout', 'stderr'

@dataclass
class KernelState:
    id: str = ""
    status: KernelStatus = KernelStatus.DISCONNECTED
    execution_count: int = 0
    globals_dict: dict = field(default_factory=dict)
    
class StreamCapture:
    """Captures print output and yields it line by line for streaming."""
    def __init__(self, callback, stream_type='stdout'):
        self.callback = callback
        self.stream_type = stream_type
        self.buffer = ''
        
    def write(self, text):
        if text:
            self.buffer += text
            # Yield complete lines immediately
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
    """Manages a single Python kernel process."""
    
    def __init__(self):
        self.state = KernelState()
        self._lock = asyncio.Lock()
    
    @property
    def status(self) -> KernelStatus:
        return self.state.status
    
    @property
    def execution_count(self) -> int:
        return self.state.execution_count
    
    async def start(self) -> dict:
        """Start the kernel."""
        async with self._lock:
            if self.state.status in [KernelStatus.IDLE, KernelStatus.BUSY]:
                return self._get_info()
            
            self.state = KernelState(
                id=str(uuid.uuid4()),
                status=KernelStatus.IDLE,
                execution_count=0,
                globals_dict={"__builtins__": __builtins__},
            )
            
            return self._get_info()
    
    async def stop(self) -> dict:
        """Stop the kernel."""
        async with self._lock:
            self.state = KernelState()
            return {"status": "stopped"}
    
    async def restart(self) -> dict:
        """Restart the kernel (clears state)."""
        await self.stop()
        return await self.start()
    
    async def execute(self, code: str, cell_id: str) -> dict:
        """Execute code in the kernel (non-streaming)."""
        if self.state.status == KernelStatus.DISCONNECTED:
            await self.start()
        
        async with self._lock:
            self.state.status = KernelStatus.BUSY
            self.state.execution_count += 1
            exec_count = self.state.execution_count
        
        result = await self._run_code(code, cell_id, exec_count)
        
        async with self._lock:
            self.state.status = KernelStatus.IDLE
        
        return result
    
    async def execute_streaming(self, code: str, cell_id: str) -> AsyncGenerator[Dict[str, Any], None]:
        """Execute code with streaming output."""
        if self.state.status == KernelStatus.DISCONNECTED:
            await self.start()
        
        async with self._lock:
            self.state.status = KernelStatus.BUSY
            self.state.execution_count += 1
            exec_count = self.state.execution_count
        
        outputs = []
        
        async for item in self._run_code_streaming(code, cell_id, exec_count, outputs):
            yield item
        
        async with self._lock:
            self.state.status = KernelStatus.IDLE

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

    async def _run_code_streaming(self, code: str, cell_id: str, exec_count: int, outputs: list) -> AsyncGenerator[Dict[str, Any], None]:
        """Run code with streaming output."""
        loop = asyncio.get_event_loop()
        output_queue = asyncio.Queue()
        start_time = time.time()
        
        def on_output(output: RichOutput):
            loop.call_soon_threadsafe(output_queue.put_nowait, output)
        
        def run_shell_command(cmd: str):
            """Execute a shell command with streaming output."""
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
                # Check for shell commands (lines starting with !)
                lines = code.strip().split('\n')
                shell_commands = []
                python_code = []
                
                for line in lines:
                    stripped = line.strip()
                    if stripped.startswith('!'):
                        # Execute any pending Python code first
                        if python_code:
                            sys.stdout = stdout_capture
                            sys.stderr = stderr_capture
                            try:
                                exec('\n'.join(python_code), self.state.globals_dict)
                            finally:
                                sys.stdout = old_stdout
                                sys.stderr = old_stderr
                            python_code = []
                        
                        # Execute shell command
                        cmd = stripped[1:].strip()
                        error = run_shell_command(cmd)
                        if error:
                            return error
                    else:
                        python_code.append(line)
                
                # Execute remaining Python code
                if python_code:
                    remaining_code = '\n'.join(python_code)
                    if remaining_code.strip():
                        sys.stdout = stdout_capture
                        sys.stderr = stderr_capture
                        
                        try:
                            # Set matplotlib to non-interactive backend
                            try:
                                import matplotlib
                                matplotlib.use('Agg')
                                import matplotlib.pyplot as plt
                                plt.ioff()
                            except ImportError:
                                pass
                            
                            try:
                                exec(remaining_code, self.state.globals_dict)
                            except SyntaxError:
                                try:
                                    result = eval(remaining_code, self.state.globals_dict)
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
        
        # Start execution in thread
        error_future = loop.run_in_executor(None, run_sync)
        
        # Stream outputs while waiting
        done = False
        while not done:
            try:
                output = await asyncio.wait_for(output_queue.get(), timeout=0.1)
                outputs.append(output)
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
                if error_future.done():
                    done = True
        
        # Get any remaining outputs
        while not output_queue.empty():
            output = output_queue.get_nowait()
            outputs.append(output)
            yield {
                "type": "output", 
                "output": {
                    "type": output.type,
                    "data": output.data,
                    "mimeType": output.mimeType,
                    "stream": output.stream
                }
            }
        
        error = await error_future
        duration = time.time() - start_time
        
        # Capture figures after execution
        figures = self._capture_figures()
        for fig in figures:
            outputs.append(fig)
            yield {
                "type": "output",
                "output": {
                    "type": fig.type,
                    "data": fig.data,
                    "mimeType": fig.mimeType
                }
            }
        
        if error:
            outputs.append(RichOutput(type='error', data=error))
            yield {
                "type": "complete",
                "result": {
                    "cellId": cell_id,
                    "success": False,
                    "error": error,
                    "outputs": [{"type": o.type, "data": o.data, "mimeType": o.mimeType, "stream": o.stream} for o in outputs],
                    "executionCount": exec_count,
                    "duration": round(duration, 2),
                }
            }
        else:
            yield {
                "type": "complete",
                "result": {
                    "cellId": cell_id,
                    "success": True,
                    "outputs": [{"type": o.type, "data": o.data, "mimeType": o.mimeType, "stream": o.stream} for o in outputs],
                    "executionCount": exec_count,
                    "duration": round(duration, 2),
                }
            }

    async def _run_code(self, code: str, cell_id: str, exec_count: int) -> dict:
        """Run code and capture output (non-streaming)."""
        stdout_buffer = io.StringIO()
        stderr_buffer = io.StringIO()
        outputs = []
        start_time = time.time()
        
        try:
            loop = asyncio.get_event_loop()
            
            def run_shell_command(cmd: str) -> tuple:
                """Execute shell command, return (stdout, stderr, returncode)."""
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
                # Check for shell commands (lines starting with !)
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
                        # Regular Python code
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
                                    exec(stripped, self.state.globals_dict)
                                except SyntaxError:
                                    try:
                                        result = eval(stripped, self.state.globals_dict)
                                        if result is not None:
                                            print(repr(result))
                                    except:
                                        raise
                
                # Add shell command outputs
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
            
            # Capture figures
            figures = self._capture_figures()
            outputs.extend(figures)
            
            # Build combined text output for backward compatibility
            combined_output = stdout_text
            if stderr_text:
                combined_output = combined_output + stderr_text if combined_output else stderr_text
            
            return {
                "cellId": cell_id,
                "success": True,
                "output": combined_output.strip() if combined_output else None,
                "outputs": [{"type": o.type, "data": o.data, "mimeType": o.mimeType, "stream": o.stream} for o in outputs],
                "executionCount": exec_count,
                "duration": round(duration, 2),
            }
            
        except Exception as e:
            duration = time.time() - start_time
            error_msg = traceback.format_exc()
            outputs.append(RichOutput(type='error', data=error_msg))
            return {
                "cellId": cell_id,
                "success": False,
                "error": error_msg,
                "outputs": [{"type": o.type, "data": o.data, "mimeType": o.mimeType, "stream": o.stream} for o in outputs],
                "executionCount": exec_count,
                "duration": round(duration, 2),
            }
    
    async def interrupt(self) -> dict:
        """Interrupt current execution."""
        return {"status": "interrupt_sent"}
    
    def _get_info(self) -> dict:
        return {
            "id": self.state.id,
            "status": self.state.status.value,
            "executionCount": self.state.execution_count,
        }
    
    def get_info(self) -> dict:
        return self._get_info()

# Singleton instance
kernel_manager = KernelManager()
