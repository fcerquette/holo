import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import Groq from 'groq-sdk';
import { RagService } from './rag.service';

// ── Interfaces ─────────────────────────────────────────

interface MemoryEntry {
  id: string;
  summary: string;
  embedding: number[];
  timestamp: number;
  retrievalCount: number;
}

interface MemoryStore {
  entries: MemoryEntry[];
  embeddingModel: string;
}

export interface MemoryStatus {
  available: boolean;
  memoryCount: number;
  ollamaConnected: boolean;
}

// ── Service ────────────────────────────────────────────

@Injectable()
export class MemoryRagService implements OnModuleInit {
  private logger = new Logger('MemoryRagService');
  private entries: MemoryEntry[] = [];
  private groqClient: Groq;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly storePath: string;
  private readonly MAX_MEMORIES = 200;
  private readonly SIMILARITY_THRESHOLD = 0.55;
  private readonly DUPLICATE_THRESHOLD = 0.9;
  private readonly MIN_CONTENT_LENGTH = 30;

  constructor(private readonly ragService: RagService) {
    this.storePath = path.join(
      process.cwd(),
      'apps',
      'holo-api',
      'data',
      'memory-vectors.json',
    );
    this.groqClient = new Groq({
      apiKey: process.env.GROQ_API_KEY || '',
    });
  }

  async onModuleInit(): Promise<void> {
    this.loadFromDisk();
    // Backfill embeddings in background (non-blocking)
    this.backfillEmbeddings().catch((err) => {
      this.logger.warn(`Backfill failed: ${err.message}`);
    });
  }

  // ── Core: Add Memory ─────────────────────────────────

  async addMemory(
    userMessage: string,
    assistantResponse: string,
  ): Promise<void> {
    // Skip trivial exchanges
    if (userMessage.length + assistantResponse.length < this.MIN_CONTENT_LENGTH) {
      return;
    }

    // Skip greetings and "I don't know" responses
    if (this.isTrivialExchange(userMessage, assistantResponse)) {
      return;
    }

    try {
      // 1. Generate summary with LLM (cheap, ~50 tokens)
      const summary = await this.generateSummary(userMessage, assistantResponse);
      if (!summary || summary.length < 10) {
        this.logger.debug('Summary too short, skipping memory');
        return;
      }

      // 2. Check for duplicate against last memory
      if (this.entries.length > 0) {
        const lastEntry = this.entries[this.entries.length - 1];
        if (lastEntry.embedding.length > 0) {
          const embeddings = this.ragService.getEmbeddingsInstance();
          if (embeddings) {
            const newEmbedding = await embeddings.embedQuery(summary);
            const similarity = this.cosineSimilarity(
              newEmbedding,
              lastEntry.embedding,
            );
            if (similarity > this.DUPLICATE_THRESHOLD) {
              this.logger.debug(
                `Duplicate memory detected (sim=${similarity.toFixed(2)}), skipping`,
              );
              return;
            }
            // We already have the embedding, save it
            this.addEntry(summary, newEmbedding);
            return;
          }
        }
      }

      // 3. Generate embedding with Ollama
      const embeddings = this.ragService.getEmbeddingsInstance();
      if (embeddings && this.ragService.isOllamaConnected()) {
        const embedding = await embeddings.embedQuery(summary);
        this.addEntry(summary, embedding);
      } else {
        // Ollama down: store without embedding (will backfill later)
        this.addEntry(summary, []);
        this.logger.debug('Ollama unavailable, stored memory without embedding');
      }
    } catch (error: unknown) {
      this.logger.warn(`Failed to add memory: ${(error as Error).message}`);
    }
  }

  // ── Core: Retrieve Memories ──────────────────────────

  async retrieveMemories(
    query: string,
    topK = 3,
  ): Promise<string | null> {
    const embeddings = this.ragService.getEmbeddingsInstance();
    if (!embeddings || !this.ragService.isOllamaConnected()) {
      return null;
    }

    const validEntries = this.entries.filter((e) => e.embedding.length > 0);
    if (validEntries.length === 0) {
      return null;
    }

    try {
      const queryEmbedding = await embeddings.embedQuery(query);
      const now = Date.now();

      // Score each memory: similarity * 0.85 + recency * 0.15
      const scored = validEntries.map((entry) => {
        const similarity = this.cosineSimilarity(
          queryEmbedding,
          entry.embedding,
        );

        // Recency factor: 1.0 for now, decays to 0.0 over 7 days
        const ageMs = now - entry.timestamp;
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        const recencyFactor = Math.max(0, 1 - ageDays / 7);

        const finalScore = similarity * 0.85 + recencyFactor * 0.15;

        return { entry, similarity, finalScore };
      });

      // Sort by final score, filter by threshold, take top K
      scored.sort((a, b) => b.finalScore - a.finalScore);
      const relevant = scored
        .filter((s) => s.similarity >= this.SIMILARITY_THRESHOLD)
        .slice(0, topK);

      if (relevant.length === 0) {
        return null;
      }

      // Increment retrieval count
      for (const r of relevant) {
        r.entry.retrievalCount++;
      }
      this.scheduleSave();

      // Format as numbered list
      const lines = relevant.map(
        (r, i) => `${i + 1}. ${r.entry.summary}`,
      );

      this.logger.debug(
        `Memory retrieval: ${relevant.length} memories (top score: ${relevant[0].finalScore.toFixed(2)})`,
      );

      return (
        'Contexto relevante previo:\n' +
        lines.join('\n') +
        '\nUsá esta info solo si es relevante. Ignorala si no aplica.'
      );
    } catch (error: unknown) {
      this.logger.warn(
        `Memory retrieval failed: ${(error as Error).message}`,
      );
      return null;
    }
  }

  // ── Forget by Keyword ────────────────────────────────

  forgetByKeyword(keyword: string): number {
    const lowerKw = keyword.toLowerCase();
    const before = this.entries.length;
    this.entries = this.entries.filter(
      (e) => !e.summary.toLowerCase().includes(lowerKw),
    );
    const removed = before - this.entries.length;
    if (removed > 0) {
      this.scheduleSave();
      this.logger.log(
        `Forgot ${removed} memories matching "${keyword}"`,
      );
    }
    return removed;
  }

  // ── Clear All ────────────────────────────────────────

  clear(): void {
    this.entries = [];
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    // Save empty store immediately
    this.writeToDisk();
    this.logger.log('All memories cleared');
  }

  // ── Status ───────────────────────────────────────────

  isAvailable(): boolean {
    return (
      this.ragService.isOllamaConnected() &&
      this.entries.some((e) => e.embedding.length > 0)
    );
  }

  getStatus(): MemoryStatus {
    return {
      available: this.isAvailable(),
      memoryCount: this.entries.length,
      ollamaConnected: this.ragService.isOllamaConnected(),
    };
  }

  // ── Private: LLM Summary ─────────────────────────────

  private async generateSummary(
    userMsg: string,
    assistantMsg: string,
  ): Promise<string | null> {
    try {
      const response = await this.groqClient.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 60,
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content:
              'Resumí en una sola frase breve la información relevante de este intercambio. ' +
              'Ignorá cortesías, saludos y partes irrelevantes. Solo el dato importante. ' +
              'Respondé SOLO con la frase resumen, sin explicación.',
          },
          {
            role: 'user',
            content: `Usuario: "${userMsg}"\nAsistente: "${assistantMsg}"`,
          },
        ],
      });

      const summary = response.choices[0]?.message?.content?.trim();
      return summary || null;
    } catch (error: unknown) {
      this.logger.warn(`Summary generation failed: ${(error as Error).message}`);
      // Fallback: concatenate raw (better than nothing)
      return `${userMsg} - ${assistantMsg}`.slice(0, 150);
    }
  }

  // ── Private: Trivial Exchange Detection ──────────────

  private isTrivialExchange(userMsg: string, assistantMsg: string): boolean {
    const trivialPatterns = [
      /^(hola|chau|buenas|hey|hi|hello|buenos?\s+d[ií]as?|buenas?\s+tardes?|buenas?\s+noches?)/i,
      /^(gracias|thanks|ok|dale|genial|perfecto|listo|bien)$/i,
    ];

    const combined = userMsg.trim();
    if (trivialPatterns.some((p) => p.test(combined))) {
      return true;
    }

    // Skip if assistant doesn't know
    const dontKnowPatterns = [
      /no (sé|tengo|puedo)/i,
      /no encontr[éeó]/i,
      /se me trab[óo]/i,
      /prob[áa] de nuevo/i,
      /me qued[éeó] sin cr[ée]ditos/i,
    ];
    if (dontKnowPatterns.some((p) => p.test(assistantMsg))) {
      return true;
    }

    return false;
  }

  // ── Private: Entry Management ────────────────────────

  private addEntry(summary: string, embedding: number[]): void {
    const entry: MemoryEntry = {
      id: `mem_${Date.now()}`,
      summary,
      embedding,
      timestamp: Date.now(),
      retrievalCount: 0,
    };

    this.entries.push(entry);

    // Enforce cap: remove least useful memories
    while (this.entries.length > this.MAX_MEMORIES) {
      this.evictLeastUseful();
    }

    this.scheduleSave();
    this.logger.debug(`Memory added: "${summary.slice(0, 60)}..."`);
  }

  private evictLeastUseful(): void {
    if (this.entries.length === 0) return;

    // Find the entry with lowest retrievalCount; tie-break by oldest
    let worstIdx = 0;
    let worstScore = Infinity;

    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      // Score: retrievalCount * 1000 + recency (newer = higher)
      const score = e.retrievalCount * 1000 + e.timestamp / 1e10;
      if (score < worstScore) {
        worstScore = score;
        worstIdx = i;
      }
    }

    this.logger.debug(
      `Evicting memory: "${this.entries[worstIdx].summary.slice(0, 40)}..." (retrievals: ${this.entries[worstIdx].retrievalCount})`,
    );
    this.entries.splice(worstIdx, 1);
  }

  // ── Private: Backfill Embeddings ─────────────────────

  private async backfillEmbeddings(): Promise<void> {
    const embeddings = this.ragService.getEmbeddingsInstance();
    if (!embeddings || !this.ragService.isOllamaConnected()) {
      return;
    }

    const toBackfill = this.entries.filter((e) => e.embedding.length === 0);
    if (toBackfill.length === 0) return;

    this.logger.log(`Backfilling ${toBackfill.length} memory embeddings...`);

    let filled = 0;
    for (const entry of toBackfill) {
      try {
        entry.embedding = await embeddings.embedQuery(entry.summary);
        filled++;
      } catch {
        break; // Ollama probably went down, stop trying
      }
    }

    if (filled > 0) {
      this.scheduleSave();
      this.logger.log(`Backfilled ${filled}/${toBackfill.length} embeddings`);
    }
  }

  // ── Private: Cosine Similarity ───────────────────────

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;

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

  // ── Private: Persistence ─────────────────────────────

  private scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.writeToDisk();
    }, 500);
  }

  private writeToDisk(): void {
    try {
      const dir = path.dirname(this.storePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const store: MemoryStore = {
        entries: this.entries,
        embeddingModel: 'nomic-embed-text',
      };

      fs.writeFileSync(this.storePath, JSON.stringify(store), 'utf-8');
      this.logger.debug(`Saved ${this.entries.length} memories to disk`);
    } catch (error: unknown) {
      this.logger.error(`Failed to save memories: ${(error as Error).message}`);
    }
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.storePath)) {
        this.logger.log('No memory file found, starting fresh');
        return;
      }

      const raw = fs.readFileSync(this.storePath, 'utf-8');
      const store = JSON.parse(raw) as MemoryStore;

      // Validate model match
      if (store.embeddingModel !== 'nomic-embed-text') {
        this.logger.warn('Memory store uses different model, clearing...');
        this.entries = [];
        return;
      }

      // Load and clean entries
      this.entries = (store.entries || []).filter(
        (e) => e.id && e.summary && typeof e.timestamp === 'number',
      );

      // Ensure retrievalCount exists (migration)
      for (const entry of this.entries) {
        if (typeof entry.retrievalCount !== 'number') {
          entry.retrievalCount = 0;
        }
      }

      this.logger.log(
        `Loaded ${this.entries.length} memories from disk ` +
          `(${this.entries.filter((e) => e.embedding.length > 0).length} with embeddings)`,
      );
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to load memories: ${(error as Error).message}`,
      );
      this.entries = [];
    }
  }
}
