# Kernel State - Holds execution context
from dataclasses import dataclass, field
from typing import Dict, Any, Optional
from datetime import datetime

@dataclass
class ExecutionState:
    """Holds the state of the Python kernel."""
    
    # Global namespace for code execution
    globals_dict: Dict[str, Any] = field(default_factory=lambda: {"__builtins__": __builtins__})
    
    # Local namespace (usually empty, using globals)
    locals_dict: Dict[str, Any] = field(default_factory=dict)
    
    # Execution counter
    execution_count: int = 0
    
    # Last execution time
    last_execution: Optional[datetime] = None
    
    # History of executed code
    history: list = field(default_factory=list)
    
    def reset(self):
        """Reset the kernel state."""
        self.globals_dict = {"__builtins__": __builtins__}
        self.locals_dict = {}
        self.execution_count = 0
        self.last_execution = None
        self.history = []
    
    def increment_execution(self) -> int:
        """Increment and return execution count."""
        self.execution_count += 1
        self.last_execution = datetime.now()
        return self.execution_count
    
    def add_to_history(self, code: str, exec_count: int):
        """Add executed code to history."""
        self.history.append({
            "code": code,
            "execution_count": exec_count,
            "timestamp": datetime.now().isoformat(),
        })
    
    def get_variable(self, name: str) -> Any:
        """Get a variable from the namespace."""
        return self.globals_dict.get(name)
    
    def set_variable(self, name: str, value: Any):
        """Set a variable in the namespace."""
        self.globals_dict[name] = value
    
    def list_variables(self) -> Dict[str, str]:
        """List all user-defined variables with their types."""
        return {
            k: type(v).__name__
            for k, v in self.globals_dict.items()
            if not k.startswith('_') and k != '__builtins__'
        }


# Singleton state
kernel_state = ExecutionState()