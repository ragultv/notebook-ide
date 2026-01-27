# Kernel Python Package
# Handles isolated kernel execution for notebook cells

from .kernel_manager import kernel_manager, KernelManager
from .isolated_kernel import TrulyIsolatedKernel, ExecutionResult

__all__ = [
    'kernel_manager',
    'KernelManager',
    'TrulyIsolatedKernel',
    'ExecutionResult',
]
