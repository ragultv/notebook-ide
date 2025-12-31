# Kernel - Main entry point for the Python kernel
# This can be run as a standalone process for subprocess-based execution
import sys
import json
from .execution import execute_code, reset_kernel, get_variables
from .state import kernel_state

class Kernel:
    """Python execution kernel."""
    
    def __init__(self):
        self.running = False
    
    def start(self):
        """Start the kernel."""
        self.running = True
        reset_kernel()
        return {"status": "started", "execution_count": 0}
    
    def stop(self):
        """Stop the kernel."""
        self.running = False
        reset_kernel()
        return {"status": "stopped"}
    
    def restart(self):
        """Restart the kernel."""
        self.stop()
        return self.start()
    
    def execute(self, code: str, cell_id: str = "") -> dict:
        """Execute code and return result."""
        if not self.running:
            self.start()
        
        result = execute_code(code)
        return {
            "cellId": cell_id,
            **result.to_dict(),
        }
    
    def get_status(self) -> dict:
        """Get kernel status."""
        return {
            "running": self.running,
            "execution_count": kernel_state.execution_count,
            "variables": get_variables(),
        }


# Singleton kernel instance
kernel = Kernel()


def main():
    """Main entry point for standalone kernel process."""
    kernel.start()
    print(json.dumps({"status": "ready"}), flush=True)
    
    try:
        for line in sys.stdin:
            try:
                request = json.loads(line.strip())
                action = request.get("action")
                
                if action == "execute":
                    result = kernel.execute(
                        request.get("code", ""),
                        request.get("cell_id", ""),
                    )
                    print(json.dumps(result), flush=True)
                    
                elif action == "restart":
                    result = kernel.restart()
                    print(json.dumps(result), flush=True)
                    
                elif action == "status":
                    result = kernel.get_status()
                    print(json.dumps(result), flush=True)
                    
                elif action == "stop":
                    kernel.stop()
                    print(json.dumps({"status": "stopped"}), flush=True)
                    break
                    
                else:
                    print(json.dumps({"error": f"Unknown action: {action}"}), flush=True)
                    
            except json.JSONDecodeError as e:
                print(json.dumps({"error": f"Invalid JSON: {str(e)}"}), flush=True)
                
    except KeyboardInterrupt:
        pass
    finally:
        kernel.stop()


if __name__ == "__main__":
    main()