# Execution - Code execution engine
import io
import sys
import traceback
from contextlib import redirect_stdout, redirect_stderr
from typing import Dict, Any, Optional
from dataclasses import dataclass
from .state import kernel_state

@dataclass
class ExecutionResult:
    """Result of code execution."""
    success: bool
    output: Optional[str] = None
    error: Optional[str] = None
    execution_count: int = 0
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "success": self.success,
            "output": self.output,
            "error": self.error,
            "executionCount": self.execution_count,
        }


def execute_code(code: str) -> ExecutionResult:
    """Execute Python code and return result."""
    
    if not code.strip():
        return ExecutionResult(success=True, execution_count=kernel_state.execution_count)
    
    # Increment execution count
    exec_count = kernel_state.increment_execution()
    
    # Capture stdout and stderr
    stdout_buffer = io.StringIO()
    stderr_buffer = io.StringIO()
    
    try:
        with redirect_stdout(stdout_buffer), redirect_stderr(stderr_buffer):
            # Try to compile as expression first (for REPL-like behavior)
            try:
                compiled = compile(code, '<cell>', 'eval')
                result = eval(compiled, kernel_state.globals_dict)
                if result is not None:
                    print(repr(result))
            except SyntaxError:
                # Not an expression, execute as statements
                exec(code, kernel_state.globals_dict)
        
        output = stdout_buffer.getvalue()
        stderr_output = stderr_buffer.getvalue()
        
        # Combine outputs
        if stderr_output:
            output = (output + "\n" + stderr_output).strip() if output else stderr_output.strip()
        
        # Add to history
        kernel_state.add_to_history(code, exec_count)
        
        return ExecutionResult(
            success=True,
            output=output.strip() if output else None,
            execution_count=exec_count,
        )
        
    except Exception as e:
        error_msg = traceback.format_exc()
        return ExecutionResult(
            success=False,
            error=error_msg,
            execution_count=exec_count,
        )


def reset_kernel():
    """Reset the kernel state."""
    kernel_state.reset()


def get_variables() -> Dict[str, str]:
    """Get list of user-defined variables."""
    return kernel_state.list_variables()