"""
Memory Snapshot Schemas for Oprel Studio

Data classes for memory visualization system.
Tracks variables, metadata, and 2D projections.
"""

from dataclasses import dataclass, field, asdict
from typing import List, Optional, Tuple, Dict, Any
from enum import Enum


class TypeCategory(str, Enum):
    """Variable type categories for visualization."""
    TENSOR = "tensor"
    ARRAY = "array"
    MODEL = "model"
    SCALAR = "scalar"
    COLLECTION = "collection"
    FUNCTION = "function"
    OBJECT = "object"
    MODULE = "module"
    GENERATOR = "generator"


@dataclass
class VariableMetadata:
    """
    Metadata for a single variable in kernel memory.
    
    Attributes:
        name: Variable name from globals()
        type_name: str(type(obj).__name__)
        type_category: High-level category for visualization
        size_bytes: Memory size via sys.getsizeof (deep)
        ref_count: sys.getrefcount()
        creation_time: Unix timestamp when first seen
        last_access_time: Unix timestamp of last read/write
        is_mutable: Whether object supports mutation
        shape: Dimensions for arrays/tensors
        dependencies: Variable names this depends on
        defined_in_cell: Cell ID where variable was created
        module_path: For imported modules
    """
    name: str
    type_name: str
    type_category: TypeCategory
    size_bytes: int
    ref_count: int
    creation_time: float
    last_access_time: float
    is_mutable: bool
    shape: Optional[Tuple[int, ...]] = None
    dependencies: List[str] = field(default_factory=list)
    defined_in_cell: Optional[str] = None
    module_path: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to JSON-serializable dict."""
        data = asdict(self)
        data['type_category'] = self.type_category.value
        return data


@dataclass
class MemorySnapshot:
    """
    Complete memory state snapshot with 2D projections.
    
    Attributes:
        timestamp: Unix timestamp of snapshot
        variables: List of all tracked variables
        coordinates_2d: 2D UMAP/PCA coordinates (same order as variables)
        total_memory_bytes: Sum of all variable sizes
        algorithm: Dimensionality reduction method used
        feature_names: Names of features used for reduction
        variance_explained: For PCA, percentage of variance
    """
    timestamp: float
    variables: List[VariableMetadata]
    coordinates_2d: List[Tuple[float, float]]
    total_memory_bytes: int
    algorithm: str  # 'umap', 'pca', 'tsne'
    feature_names: List[str] = field(default_factory=list)
    variance_explained: Optional[float] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to JSON-serializable dict."""
        return {
            'timestamp': self.timestamp,
            'variables': [v.to_dict() for v in self.variables],
            'coordinates_2d': self.coordinates_2d,
            'total_memory_bytes': self.total_memory_bytes,
            'algorithm': self.algorithm,
            'feature_names': self.feature_names,
            'variance_explained': self.variance_explained,
        }


@dataclass
class DependencyEdge:
    """
    Represents a dependency relationship between variables.
    
    For example: df_filtered depends on df_raw
    """
    source: str  # Variable name
    target: str  # Variable name
    relationship_type: str  # 'derived', 'reference', 'contains'
    strength: float = 1.0  # 0.0 to 1.0


@dataclass
class MemoryDiff:
    """
    Difference between two memory snapshots.
    
    Useful for showing memory changes after cell execution.
    """
    added_variables: List[VariableMetadata]
    removed_variables: List[str]  # Just names
    modified_variables: List[Tuple[VariableMetadata, VariableMetadata]]  # (old, new)
    memory_delta_bytes: int  # Positive = increase, negative = decrease
    timestamp_before: float
    timestamp_after: float


@dataclass
class FeatureVector:
    """
    Numeric feature representation for dimensionality reduction.
    
    Attributes:
        variable_name: Name of variable
        features: Numeric array for UMAP/PCA input
        feature_names: Labels for each feature dimension
    """
    variable_name: str
    features: List[float]
    feature_names: List[str]
    
    def to_array(self):
        """Convert to numpy array."""
        import numpy as np
        return np.array(self.features)
