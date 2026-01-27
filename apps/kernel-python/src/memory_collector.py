"""
Memory Collector for Oprel Studio Kernel

Introspects Python runtime to collect variable metadata.
Tracks creation times, dependencies, and memory usage.
"""

import sys
import gc
import time
import types
import weakref
import threading
from typing import Dict, List, Any, Optional, Set
from weakref import WeakValueDictionary
from memory_schema import VariableMetadata, TypeCategory


class MemoryCollector:
    """
    Collects memory metadata from kernel's global namespace.
    
    Features:
    - Deep size calculation (recursive)
    - Dependency tracking via reference analysis
    - Creation/access time tracking
    - Thread-safe snapshot generation
    """
    
    def __init__(self):
        self._var_registry: Dict[str, Dict[str, Any]] = {}
        self._snapshot_lock = threading.Lock()
        self._current_cell_id: Optional[str] = None
        
    def set_current_cell(self, cell_id: str):
        """Set the currently executing cell for tracking."""
        self._current_cell_id = cell_id
        
    def snapshot(self, namespace: Dict[str, Any], max_depth: int = 3) -> List[VariableMetadata]:
        """
        Generate memory snapshot from namespace.
        
        Args:
            namespace: globals() dict from kernel
            max_depth: Maximum depth for size calculation
            
        Returns:
            List of variable metadata
        """
        with self._snapshot_lock:
            current_time = time.time()
            metadata_list = []
            
            # Filter out builtins and private vars
            for name, obj in namespace.items():
                if name.startswith('_') or self._is_builtin_module(obj):
                    continue
                    
                try:
                    meta = self._analyze_variable(name, obj, current_time, max_depth)
                    if meta:
                        metadata_list.append(meta)
                except Exception as e:
                    # Skip problematic objects
                    print(f"Warning: Could not analyze {name}: {e}")
                    continue
                    
            return metadata_list
    
    def _analyze_variable(
        self, 
        name: str, 
        obj: Any, 
        current_time: float,
        max_depth: int
    ) -> Optional[VariableMetadata]:
        """Analyze a single variable and extract metadata."""
        
        # Get or create registry entry
        if name not in self._var_registry:
            self._var_registry[name] = {
                'creation_time': current_time,
                'defined_in_cell': self._current_cell_id,
            }
        
        registry_entry = self._var_registry[name]
        
        # Update last access time
        registry_entry['last_access_time'] = current_time
        
        # Determine type category
        type_category = self._categorize_type(obj)
        
        # Calculate size (with depth limit to avoid infinite recursion)
        size_bytes = self._get_deep_size(obj, max_depth=max_depth)
        
        # Get reference count
        ref_count = sys.getrefcount(obj) - 1  # Subtract 1 for temp reference
        
        # Check mutability
        is_mutable = self._is_mutable(obj)
        
        # Extract shape for arrays/tensors
        shape = self._get_shape(obj)
        
        # Analyze dependencies
        dependencies = self._find_dependencies(obj, namespace=None)
        
        # Get module path for imports
        module_path = self._get_module_path(obj)
        
        return VariableMetadata(
            name=name,
            type_name=type(obj).__name__,
            type_category=type_category,
            size_bytes=size_bytes,
            ref_count=ref_count,
            creation_time=registry_entry['creation_time'],
            last_access_time=registry_entry['last_access_time'],
            is_mutable=is_mutable,
            shape=shape,
            dependencies=dependencies,
            defined_in_cell=registry_entry.get('defined_in_cell'),
            module_path=module_path,
        )
    
    def _categorize_type(self, obj: Any) -> TypeCategory:
        """Determine high-level type category."""
        type_name = type(obj).__name__
        
        # NumPy arrays
        if hasattr(obj, '__array__') and hasattr(obj, 'shape'):
            return TypeCategory.ARRAY
        
        # PyTorch/TensorFlow tensors
        if 'torch' in type(obj).__module__ or 'tensorflow' in type(obj).__module__:
            return TypeCategory.TENSOR
        
        # ML models
        if hasattr(obj, 'fit') and hasattr(obj, 'predict'):
            return TypeCategory.MODEL
        
        # Functions/methods
        if callable(obj) and not isinstance(obj, type):
            return TypeCategory.FUNCTION
        
        # Generators
        if isinstance(obj, types.GeneratorType):
            return TypeCategory.GENERATOR
        
        # Modules
        if isinstance(obj, types.ModuleType):
            return TypeCategory.MODULE
        
        # Collections
        if isinstance(obj, (list, tuple, set, frozenset, dict)):
            return TypeCategory.COLLECTION
        
        # Scalars
        if isinstance(obj, (int, float, complex, bool, str, bytes)):
            return TypeCategory.SCALAR
        
        # Default
        return TypeCategory.OBJECT
    
    def _get_deep_size(self, obj: Any, seen: Optional[Set[int]] = None, max_depth: int = 3, current_depth: int = 0) -> int:
        """
        Calculate deep memory size of object.
        
        Args:
            obj: Object to measure
            seen: Set of object IDs already counted
            max_depth: Maximum recursion depth
            current_depth: Current recursion depth
            
        Returns:
            Size in bytes
        """
        if seen is None:
            seen = set()
        
        obj_id = id(obj)
        if obj_id in seen or current_depth >= max_depth:
            return 0
        
        seen.add(obj_id)
        size = sys.getsizeof(obj)
        
        # Recursively measure containers
        if isinstance(obj, dict):
            size += sum(self._get_deep_size(k, seen, max_depth, current_depth + 1) for k in obj.keys())
            size += sum(self._get_deep_size(v, seen, max_depth, current_depth + 1) for v in obj.values())
        elif isinstance(obj, (list, tuple, set, frozenset)):
            size += sum(self._get_deep_size(item, seen, max_depth, current_depth + 1) for item in obj)
        elif hasattr(obj, '__dict__'):
            size += self._get_deep_size(obj.__dict__, seen, max_depth, current_depth + 1)
        elif hasattr(obj, '__slots__'):
            size += sum(self._get_deep_size(getattr(obj, slot, None), seen, max_depth, current_depth + 1) 
                       for slot in obj.__slots__ if hasattr(obj, slot))
        
        return size
    
    def _is_mutable(self, obj: Any) -> bool:
        """Check if object is mutable."""
        # Common immutable types
        if isinstance(obj, (int, float, complex, bool, str, bytes, tuple, frozenset, type(None))):
            return False
        # Assume mutable by default
        return True
    
    def _get_shape(self, obj: Any) -> Optional[tuple]:
        """Extract shape for arrays/tensors."""
        if hasattr(obj, 'shape'):
            shape = obj.shape
            if isinstance(shape, tuple):
                return shape
            # Convert to tuple for consistency
            try:
                return tuple(shape)
            except:
                return None
        return None
    
    def _find_dependencies(self, obj: Any, namespace: Optional[Dict] = None) -> List[str]:
        """
        Find variables that this object depends on.
        
        Uses gc.get_referents() to find referenced objects,
        then matches them against namespace.
        
        Note: This is a heuristic and may not catch all dependencies.
        """
        if namespace is None:
            return []
        
        dependencies = []
        referents = gc.get_referents(obj)
        
        for ref in referents:
            # Check if referent is a variable in namespace
            for name, var in namespace.items():
                if var is ref and not name.startswith('_'):
                    dependencies.append(name)
                    break
        
        return list(set(dependencies))  # Remove duplicates
    
    def _get_module_path(self, obj: Any) -> Optional[str]:
        """Get module path for imported modules."""
        if isinstance(obj, types.ModuleType):
            return obj.__name__
        return None
    
    def _is_builtin_module(self, obj: Any) -> bool:
        """Check if object is a builtin module."""
        if isinstance(obj, types.ModuleType):
            return obj.__name__ in sys.builtin_module_names
        return False
    
    def clear_registry(self):
        """Clear the variable registry (useful for testing)."""
        self._var_registry.clear()


# Global instance for kernel
_memory_collector = MemoryCollector()


def get_memory_collector() -> MemoryCollector:
    """Get the global memory collector instance."""
    return _memory_collector
