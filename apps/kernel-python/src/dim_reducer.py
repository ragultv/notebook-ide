"""
Dimensionality Reduction Service for Memory Visualization

Converts high-dimensional feature vectors to 2D coordinates
using UMAP (preferred) or PCA (fallback).

Supports incremental updates and caching.
"""

import numpy as np
import time
from typing import List, Tuple, Optional, Dict
from memory_schema import VariableMetadata, FeatureVector, MemorySnapshot
import pickle
import hashlib


class DimensionalityReducer:
    """
    Reduces feature vectors to 2D for visualization.
    
    Features:
    - UMAP for non-linear reduction (preserves clusters)
    - PCA fallback (linear, faster)
    - Incremental projection for new variables
    - Caching to avoid recomputation
    """
    
    def __init__(self, method: str = 'umap', random_state: int = 42):
        """
        Initialize reducer.
        
        Args:
            method: 'umap' or 'pca'
            random_state: Random seed for reproducibility
        """
        self.method = method
        self.random_state = random_state
        self._fitted_model = None
        self._fitted_features_hash = None
        self._scaler = None
        
    def reduce(
        self, 
        variables: List[VariableMetadata],
        force_refit: bool = False
    ) -> Tuple[np.ndarray, List[str]]:
        """
        Reduce variable metadata to 2D coordinates.
        
        Args:
            variables: List of variable metadata
            force_refit: Force refitting even if cached model exists
            
        Returns:
            Tuple of (coordinates_2d, feature_names)
            coordinates_2d: np.ndarray of shape (n_vars, 2)
            feature_names: List of feature names
        """
        if len(variables) == 0:
            return np.array([]).reshape(0, 2), []
        
        # Extract features
        feature_vectors, feature_names = self._extract_features(variables)
        
        # Normalize features
        feature_vectors = self._normalize(feature_vectors)
        
        # Check if we can use cached model
        features_hash = self._hash_features(feature_vectors)
        can_use_cache = (
            not force_refit 
            and self._fitted_model is not None 
            and self._fitted_features_hash == features_hash
        )
        
        if can_use_cache:
            # Use existing model
            coordinates_2d = self._fitted_model.transform(feature_vectors)
        else:
            # Fit new model
            if len(variables) < 3:
                # Not enough points for UMAP, use identity or simple scaling
                coordinates_2d = self._simple_2d_projection(feature_vectors)
            else:
                coordinates_2d = self._fit_and_transform(feature_vectors)
                self._fitted_features_hash = features_hash
        
        return coordinates_2d, feature_names
    
    def reduce_incremental(
        self,
        new_variables: List[VariableMetadata],
        existing_snapshot: Optional[MemorySnapshot] = None
    ) -> np.ndarray:
        """
        Project new variables onto existing embedding.
        
        Args:
            new_variables: New variables to project
            existing_snapshot: Previous snapshot with fitted model
            
        Returns:
            coordinates_2d for new variables
        """
        if self._fitted_model is None:
            raise ValueError("No fitted model available. Call reduce() first.")
        
        feature_vectors, _ = self._extract_features(new_variables)
        feature_vectors = self._normalize(feature_vectors)
        
        return self._fitted_model.transform(feature_vectors)
    
    def _extract_features(
        self, 
        variables: List[VariableMetadata]
    ) -> Tuple[np.ndarray, List[str]]:
        """
        Convert variable metadata to numeric feature vectors.
        
        Features:
        - Log size (bytes)
        - Reference count
        - Age (seconds since creation)
        - Recency (seconds since last access)
        - Type category (one-hot encoded)
        - Dependency count
        - Mutability flag
        - Shape features (for arrays/tensors)
        """
        current_time = time.time()
        feature_names = [
            'log_size',
            'ref_count',
            'age_seconds',
            'recency_seconds',
            'dependency_count',
            'is_mutable',
            'shape_dim',
            'shape_size',
            # Type categories (one-hot)
            'type_tensor',
            'type_array',
            'type_model',
            'type_scalar',
            'type_collection',
            'type_function',
            'type_object',
        ]
        
        features = []
        for var in variables:
            vec = [
                np.log1p(var.size_bytes),  # Log transform for size
                var.ref_count,
                current_time - var.creation_time,
                current_time - var.last_access_time,
                len(var.dependencies),
                1.0 if var.is_mutable else 0.0,
                len(var.shape) if var.shape else 0,
                np.prod(var.shape) if var.shape else 0,
                # One-hot encode type
                1.0 if var.type_category.value == 'tensor' else 0.0,
                1.0 if var.type_category.value == 'array' else 0.0,
                1.0 if var.type_category.value == 'model' else 0.0,
                1.0 if var.type_category.value == 'scalar' else 0.0,
                1.0 if var.type_category.value == 'collection' else 0.0,
                1.0 if var.type_category.value == 'function' else 0.0,
                1.0 if var.type_category.value == 'object' else 0.0,
            ]
            features.append(vec)
        
        return np.array(features), feature_names
    
    def _normalize(self, features: np.ndarray) -> np.ndarray:
        """Normalize features using StandardScaler."""
        from sklearn.preprocessing import StandardScaler
        
        if self._scaler is None or features.shape[0] != self._scaler.n_samples_seen_:
            self._scaler = StandardScaler()
            return self._scaler.fit_transform(features)
        else:
            return self._scaler.transform(features)
    
    def _fit_and_transform(self, features: np.ndarray) -> np.ndarray:
        """Fit dimensionality reduction model and transform."""
        if self.method == 'umap':
            return self._fit_umap(features)
        elif self.method == 'pca':
            return self._fit_pca(features)
        else:
            raise ValueError(f"Unknown method: {self.method}")
    
    def _fit_umap(self, features: np.ndarray) -> np.ndarray:
        """Fit UMAP model."""
        try:
            import umap
            
            n_neighbors = min(15, len(features) - 1)
            self._fitted_model = umap.UMAP(
                n_components=2,
                n_neighbors=n_neighbors,
                min_dist=0.1,
                metric='euclidean',
                random_state=self.random_state,
            )
            coordinates_2d = self._fitted_model.fit_transform(features)
            return coordinates_2d
        except ImportError:
            print("Warning: UMAP not installed, falling back to PCA")
            return self._fit_pca(features)
    
    def _fit_pca(self, features: np.ndarray) -> np.ndarray:
        """Fit PCA model."""
        from sklearn.decomposition import PCA
        
        self._fitted_model = PCA(n_components=2, random_state=self.random_state)
        coordinates_2d = self._fitted_model.fit_transform(features)
        return coordinates_2d
    
    def _simple_2d_projection(self, features: np.ndarray) -> np.ndarray:
        """
        Simple 2D projection for very small datasets.
        Just use first two principal components.
        """
        if features.shape[1] >= 2:
            # Use first two features
            return features[:, :2]
        else:
            # Pad with zeros
            return np.hstack([features, np.zeros((features.shape[0], 2 - features.shape[1]))])
    
    def _hash_features(self, features: np.ndarray) -> str:
        """Generate hash of feature array for caching."""
        return hashlib.md5(features.tobytes()).hexdigest()
    
    def get_variance_explained(self) -> Optional[float]:
        """Get variance explained (for PCA only)."""
        if self.method == 'pca' and self._fitted_model is not None:
            return np.sum(self._fitted_model.explained_variance_ratio_)
        return None
    
    def save_model(self, filepath: str):
        """Save fitted model to disk."""
        with open(filepath, 'wb') as f:
            pickle.dump({
                'model': self._fitted_model,
                'scaler': self._scaler,
                'method': self.method,
                'hash': self._fitted_features_hash,
            }, f)
    
    def load_model(self, filepath: str):
        """Load fitted model from disk."""
        with open(filepath, 'rb') as f:
            data = pickle.load(f)
            self._fitted_model = data['model']
            self._scaler = data['scaler']
            self.method = data['method']
            self._fitted_features_hash = data['hash']


def create_memory_snapshot(
    variables: List[VariableMetadata],
    reducer: Optional[DimensionalityReducer] = None,
    method: str = 'umap'
) -> MemorySnapshot:
    """
    Create a complete memory snapshot with 2D projections.
    
    Args:
        variables: List of variable metadata
        reducer: Optional existing reducer (for caching)
        method: 'umap' or 'pca'
        
    Returns:
        MemorySnapshot with coordinates
    """
    if reducer is None:
        reducer = DimensionalityReducer(method=method)
    
    coordinates_2d, feature_names = reducer.reduce(variables)
    
    # Convert to list of tuples
    coords_list = [(float(x), float(y)) for x, y in coordinates_2d]
    
    return MemorySnapshot(
        timestamp=time.time(),
        variables=variables,
        coordinates_2d=coords_list,
        total_memory_bytes=sum(v.size_bytes for v in variables),
        algorithm=method,
        feature_names=feature_names,
        variance_explained=reducer.get_variance_explained(),
    )
