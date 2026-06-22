import fs from 'fs/promises';
import path from 'path';
import type { EmbeddingChunk } from '../types/index.js';

type EmbedFn = (text: string, opts: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array }>;

let _extractor: EmbedFn | null = null;

const MAX_FILE_BYTES = 1_048_576;
const SKIP_EXTENSIONS = new Set(['.csv', '.parquet', '.xlsx', '.pkl', '.npy', '.h5']);
const INDEX_FILE = 'index.bin';
const META_FILE  = 'metadata.json';
const MODEL_ID   = 'Xenova/all-MiniLM-L6-v2';

interface ChunkMeta {
  source: string;
  text: string;
  dim: number;
  offset: number;
}

async function loadExtractor(): Promise<EmbedFn> {
  if (_extractor) return _extractor;
  // Dynamic import so it doesn't block startup
  const { pipeline } = await import('@xenova/transformers');
  const pipe = await pipeline('feature-extraction', MODEL_ID);
  _extractor = (text: string, opts: { pooling: string; normalize: boolean }) =>
    pipe(text, opts as { pooling: 'mean'; normalize: boolean }) as Promise<{ data: Float32Array }>;
  return _extractor;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export class EmbeddingStore {
  private readonly dir: string;

  constructor(projectPath: string) {
    this.dir = path.join(projectPath, '.octoml', 'embeddings');
  }

  private async loadMeta(): Promise<ChunkMeta[]> {
    try {
      const raw = await fs.readFile(path.join(this.dir, META_FILE), 'utf-8');
      return JSON.parse(raw) as ChunkMeta[];
    } catch {
      return [];
    }
  }

  private async readVector(meta: ChunkMeta): Promise<Float32Array> {
    const fd  = await fs.open(path.join(this.dir, INDEX_FILE), 'r');
    const buf = Buffer.alloc(meta.dim * 4);
    try {
      await fd.read(buf, 0, buf.length, meta.offset);
    } finally {
      await fd.close();
    }
    return new Float32Array(buf.buffer);
  }

  async embed(text: string): Promise<Float32Array> {
    const fn = await loadExtractor();
    const out = await fn(text, { pooling: 'mean', normalize: true });
    return out.data;
  }

  async search(query: string, topK: number): Promise<EmbeddingChunk[]> {
    const meta = await this.loadMeta();
    if (meta.length === 0) return [];

    const qVec = await this.embed(query);
    const scored = await Promise.all(
      meta.map(async m => ({ m, score: cosine(qVec, await this.readVector(m)) })),
    );

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(({ m, score }) => ({ source: m.source, text: m.text, score }));
  }

  async addChunk(source: string, text: string): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const vec  = await this.embed(text);
    const meta = await this.loadMeta();

    const indexPath = path.join(this.dir, INDEX_FILE);
    let offset = 0;
    try {
      const stat = await fs.stat(indexPath);
      offset = stat.size;
    } catch { /* first write */ }

    await fs.appendFile(indexPath, Buffer.from(vec.buffer));
    meta.push({ source, text, dim: vec.length, offset });
    await fs.writeFile(path.join(this.dir, META_FILE), JSON.stringify(meta, null, 2));
  }

  static shouldSkip(filePath: string, sizeBytes: number): boolean {
    return SKIP_EXTENSIONS.has(path.extname(filePath).toLowerCase()) || sizeBytes > MAX_FILE_BYTES;
  }
}
