// """
// Memory types for frontend TypeScript.
// """

export type TypeCategory = 
  | 'tensor' 
  | 'array' 
  | 'model' 
  | 'scalar' 
  | 'collection' 
  | 'function' 
  | 'object' 
  | 'module'
  | 'generator';

export interface VariableMetadata {
  name: string;
  type_name: string;
  type_category: TypeCategory;
  size_bytes: number;
  ref_count: number;
  creation_time: number;
  last_access_time: number;
  is_mutable: boolean;
  shape?: number[];
  dependencies: string[];
  defined_in_cell?: string;
  module_path?: string;
}

export interface MemorySnapshot {
  timestamp: number;
  variables: VariableMetadata[];
  coordinates_2d: [number, number][];
  total_memory_bytes: number;
  algorithm: 'umap' | 'pca' | 'tsne';
  feature_names?: string[];
  variance_explained?: number;
}

export interface MemoryPoint {
  metadata: VariableMetadata;
  x: number;
  y: number;
  color: string;
  radius: number;
  opacity: number;
}

export interface DependencyEdge {
  source: string;
  target: string;
  relationship_type: 'derived' | 'reference' | 'contains';
  strength: number;
}

export interface MemoryDiff {
  added_variables: VariableMetadata[];
  removed_variables: string[];
  modified_variables: [VariableMetadata, VariableMetadata][];
  memory_delta_bytes: number;
  timestamp_before: number;
  timestamp_after: number;
}

export interface MemoryMapFilters {
  type_categories: Set<TypeCategory>;
  min_size_bytes: number;
  max_size_bytes: number;
  recent_only: boolean;
  recent_threshold_seconds: number;
  search_query: string;
}

export interface MemoryMapViewport {
  centerX: number;
  centerY: number;
  scale: number;
  width: number;
  height: number;
}
