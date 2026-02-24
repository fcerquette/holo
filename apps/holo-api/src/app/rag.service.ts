import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { OllamaEmbeddings } from '@langchain/ollama';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

interface VectorEntry {
  content: string;
  embedding: number[];
  source: string;
}

interface VectorStoreCache {
  entries: VectorEntry[];
  indexedFiles: Record<string, number>; // filename → lastModified timestamp
  embeddingModel: string;
}

export interface RagStatus {
  available: boolean;
  ollamaConnected: boolean;
  documentCount: number;
  chunkCount: number;
  indexedFiles: string[];
  lastIndexed: number | null;
}

@Injectable()
export class RagService implements OnModuleInit {
  private logger = new Logger('RagService');
  private entries: VectorEntry[] = [];
  private embeddings: OllamaEmbeddings | null = null;
  private ollamaConnected = false;
  private indexedFiles: Record<string, number> = {};
  private lastIndexed: number | null = null;
  private indexing = false;

  private readonly knowledgePath: string;
  private readonly cachePath: string;
  private readonly ollamaBaseUrl: string;
  private readonly embeddingModel = 'nomic-embed-text';

  constructor() {
    this.knowledgePath = path.join(
      process.cwd(),
      'apps',
      'holo-api',
      'knowledge'
    );
    this.cachePath = path.join(
      process.cwd(),
      'apps',
      'holo-api',
      'data',
      'vector-store.json'
    );
    this.ollamaBaseUrl =
      process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  }

  async onModuleInit(): Promise<void> {
    // Non-blocking: initialize RAG in background
    this.initializeAsync();
  }

  // ── Initialization ─────────────────────────────────────

  private async initializeAsync(): Promise<void> {
    try {
      this.ollamaConnected = await this.checkOllama();
      if (!this.ollamaConnected) {
        this.logger.warn(
          'Ollama no está corriendo. RAG desactivado. ' +
            'Para activarlo: ollama serve && ollama pull nomic-embed-text'
        );
        return;
      }

      this.embeddings = new OllamaEmbeddings({
        model: this.embeddingModel,
        baseUrl: this.ollamaBaseUrl,
      });

      // Try loading from cache first
      const loaded = await this.loadFromCache();
      if (loaded) {
        this.logger.log(
          `Vector store cargado desde cache: ${this.entries.length} chunks de ${Object.keys(this.indexedFiles).length} archivos`
        );
        return;
      }

      // No cache → index documents
      await this.indexDocuments();
    } catch (error: unknown) {
      this.logger.error(`Error inicializando RAG: ${(error as Error).message}`);
      this.ollamaConnected = false;
    }
  }

  private async checkOllama(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(`${this.ollamaBaseUrl}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) {
        const data = (await response.json()) as {
          models: Array<{ name: string }>;
        };
        const hasModel = data.models?.some((m) =>
          m.name.includes(this.embeddingModel)
        );
        if (!hasModel) {
          this.logger.warn(
            `Modelo "${this.embeddingModel}" no encontrado en Ollama. ` +
              `Ejecutá: ollama pull ${this.embeddingModel}`
          );
          return false;
        }
        this.logger.log('Ollama conectado, modelo de embeddings disponible');
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // ── Indexing ────────────────────────────────────────────

  async indexDocuments(): Promise<{ success: boolean; message: string }> {
    if (this.indexing) {
      return { success: false, message: 'Ya se está indexando...' };
    }

    // Re-check Ollama if needed
    if (!this.ollamaConnected || !this.embeddings) {
      this.ollamaConnected = await this.checkOllama();
      if (!this.ollamaConnected) {
        return { success: false, message: 'Ollama no está disponible' };
      }
      this.embeddings = new OllamaEmbeddings({
        model: this.embeddingModel,
        baseUrl: this.ollamaBaseUrl,
      });
    }

    this.indexing = true;
    try {
      // Ensure knowledge directory exists
      if (!fs.existsSync(this.knowledgePath)) {
        fs.mkdirSync(this.knowledgePath, { recursive: true });
        this.logger.log(`Carpeta knowledge/ creada en: ${this.knowledgePath}`);
        this.indexing = false;
        return {
          success: true,
          message:
            'Carpeta knowledge/ creada. Poné archivos .txt o .md ahí y hacé click en Re-indexar.',
        };
      }

      // Read files
      const files = fs
        .readdirSync(this.knowledgePath)
        .filter((f) => f.endsWith('.txt') || f.endsWith('.md'));

      if (files.length === 0) {
        this.logger.log('No hay archivos en knowledge/');
        this.entries = [];
        this.indexedFiles = {};
        this.indexing = false;
        return {
          success: true,
          message: 'No hay archivos .txt o .md en knowledge/',
        };
      }

      // Load and split documents
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 500,
        chunkOverlap: 50,
        separators: ['\n\n', '\n', '. ', ' ', ''],
      });

      const allChunks: Array<{ content: string; source: string }> = [];
      const newIndexedFiles: Record<string, number> = {};

      for (const file of files) {
        const filePath = path.join(this.knowledgePath, file);
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const stat = await fs.promises.stat(filePath);
        newIndexedFiles[file] = stat.mtimeMs;

        const chunks = await splitter.splitText(content);
        for (const chunk of chunks) {
          allChunks.push({ content: chunk, source: file });
        }
      }

      this.logger.log(
        `${files.length} archivos → ${allChunks.length} chunks. Generando embeddings...`
      );

      // Generate embeddings in batches of 10
      const newEntries: VectorEntry[] = [];
      const batchSize = 10;

      for (let i = 0; i < allChunks.length; i += batchSize) {
        const batch = allChunks.slice(i, i + batchSize);
        const texts = batch.map((c) => c.content);
        const embeddings = await this.embeddings.embedDocuments(texts);

        for (let j = 0; j < batch.length; j++) {
          newEntries.push({
            content: batch[j].content,
            embedding: embeddings[j],
            source: batch[j].source,
          });
        }
      }

      this.entries = newEntries;
      this.indexedFiles = newIndexedFiles;
      this.lastIndexed = Date.now();

      // Save cache to disk
      await this.saveToCache();

      const msg = `Indexados ${files.length} archivos (${newEntries.length} chunks)`;
      this.logger.log(msg);
      this.indexing = false;
      return { success: true, message: msg };
    } catch (error: unknown) {
      this.logger.error(`Error indexando: ${(error as Error).message}`);
      this.indexing = false;
      return { success: false, message: `Error: ${(error as Error).message}` };
    }
  }

  // ── Retrieval ──────────────────────────────────────────

  async retrieveContext(query: string): Promise<string | null> {
    if (!this.isAvailable() || !this.embeddings) {
      return null;
    }

    try {
      // Generate embedding for the query
      const queryEmbedding = await this.embeddings.embedQuery(query);

      // Calculate cosine similarity with all entries
      const scored = this.entries.map((entry) => ({
        content: entry.content,
        source: entry.source,
        score: this.cosineSimilarity(queryEmbedding, entry.embedding),
      }));

      // Sort by similarity (highest first) and take top 4
      scored.sort((a, b) => b.score - a.score);
      const topResults = scored.slice(0, 4);

      // Filter by minimum relevance threshold
      const relevant = topResults.filter((r) => r.score >= 0.3);

      if (relevant.length === 0) {
        return null;
      }

      const contextParts = relevant.map(
        (r) => `[${r.source}]: ${r.content}`
      );

      return contextParts.join('\n\n');
    } catch (error: unknown) {
      this.logger.error(`Error buscando contexto: ${(error as Error).message}`);
      return null;
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;

    return dotProduct / denominator;
  }

  // ── Cache ──────────────────────────────────────────────

  private async saveToCache(): Promise<void> {
    try {
      const dir = path.dirname(this.cachePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const cache: VectorStoreCache = {
        entries: this.entries,
        indexedFiles: this.indexedFiles,
        embeddingModel: this.embeddingModel,
      };

      await fs.promises.writeFile(
        this.cachePath,
        JSON.stringify(cache),
        'utf-8'
      );
      this.logger.log('Vector store guardado en cache');
    } catch (error: unknown) {
      this.logger.error(`Error guardando cache: ${(error as Error).message}`);
    }
  }

  private async loadFromCache(): Promise<boolean> {
    try {
      if (!fs.existsSync(this.cachePath)) {
        return false;
      }

      const raw = await fs.promises.readFile(this.cachePath, 'utf-8');
      const cache = JSON.parse(raw) as VectorStoreCache;

      // Verify same embedding model
      if (cache.embeddingModel !== this.embeddingModel) {
        this.logger.log('Cache usa modelo diferente, re-indexando...');
        return false;
      }

      // Check if knowledge files changed
      if (fs.existsSync(this.knowledgePath)) {
        const currentFiles = fs
          .readdirSync(this.knowledgePath)
          .filter((f) => f.endsWith('.txt') || f.endsWith('.md'));
        const cachedFileNames = Object.keys(cache.indexedFiles);

        // Different file count → re-index
        if (currentFiles.length !== cachedFileNames.length) {
          this.logger.log('Cantidad de archivos cambió, re-indexando...');
          return false;
        }

        // Check modification times
        for (const file of currentFiles) {
          const filePath = path.join(this.knowledgePath, file);
          const stat = fs.statSync(filePath);
          if (
            !cache.indexedFiles[file] ||
            cache.indexedFiles[file] !== stat.mtimeMs
          ) {
            this.logger.log(`Archivo "${file}" modificado, re-indexando...`);
            return false;
          }
        }
      }

      // Restore from cache
      this.entries = Array.isArray(cache.entries) ? cache.entries : [];
      this.indexedFiles = cache.indexedFiles || {};
      this.lastIndexed = Date.now();

      return this.entries.length > 0;
    } catch (error: unknown) {
      this.logger.error(`Error cargando cache: ${(error as Error).message}`);
      return false;
    }
  }

  // ── Status ─────────────────────────────────────────────

  isAvailable(): boolean {
    return this.ollamaConnected && this.entries.length > 0;
  }

  isIndexing(): boolean {
    return this.indexing;
  }

  getStatus(): RagStatus {
    return {
      available: this.isAvailable(),
      ollamaConnected: this.ollamaConnected,
      documentCount: Object.keys(this.indexedFiles).length,
      chunkCount: this.entries.length,
      indexedFiles: Object.keys(this.indexedFiles),
      lastIndexed: this.lastIndexed,
    };
  }

  // ── Shared access (for MemoryRagService) ────────────

  /** Expose embeddings instance for shared use */
  getEmbeddingsInstance(): OllamaEmbeddings | null {
    return this.embeddings;
  }

  /** Check if Ollama is currently connected */
  isOllamaConnected(): boolean {
    return this.ollamaConnected;
  }
}
