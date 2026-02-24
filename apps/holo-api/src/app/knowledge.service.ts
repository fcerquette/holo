import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

interface KnowledgeChunk {
  content: string;
  index: number;
}

export interface KnowledgeStatus {
  hasContent: boolean;
  contentLength: number;
  chunkCount: number;
}

@Injectable()
export class KnowledgeService {
  private logger = new Logger('KnowledgeService');
  private content = '';
  private chunks: KnowledgeChunk[] = [];
  private filePath: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.filePath = path.join(
      process.cwd(),
      'apps',
      'holo-api',
      'data',
      'knowledge.txt',
    );
    this.loadSync();
  }

  // ── Public Methods ───────────────────────────────────

  getContent(): string {
    return this.content;
  }

  setContent(text: string): KnowledgeStatus {
    this.content = text;
    this.chunks = this.chunkText(text);
    this.scheduleSave();
    this.logger.log(
      `Knowledge updated: ${text.length} chars, ${this.chunks.length} chunks`,
    );
    return this.getStatus();
  }

  getStatus(): KnowledgeStatus {
    return {
      hasContent: this.content.length > 0,
      contentLength: this.content.length,
      chunkCount: this.chunks.length,
    };
  }

  /**
   * Retrieve relevant context from the knowledge document using keyword matching.
   * Compatible interface with ragService.retrieveContext().
   */
  retrieveContext(query: string): string | null {
    if (this.chunks.length === 0) return null;

    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0) return null;

    // Score each chunk by keyword overlap
    const scored = this.chunks.map((chunk) => {
      const chunkTokens = this.tokenize(chunk.content);
      let score = 0;
      for (const qt of queryTokens) {
        for (const ct of chunkTokens) {
          if (ct === qt) {
            score += 2; // exact match
          } else if (ct.includes(qt) || qt.includes(ct)) {
            score += 1; // partial match
          }
        }
      }
      // Normalize by query length to avoid bias toward longer chunks
      return { content: chunk.content, score: score / queryTokens.length };
    });

    // Sort by score descending, take top 4
    scored.sort((a, b) => b.score - a.score);
    const relevant = scored.slice(0, 4).filter((r) => r.score >= 1);

    if (relevant.length === 0) return null;

    return relevant.map((r) => r.content).join('\n\n');
  }

  // ── Private Methods ──────────────────────────────────

  private tokenize(text: string): string[] {
    // Lowercase, remove punctuation, split by whitespace, filter short words
    return text
      .toLowerCase()
      .replace(/[^\wáéíóúüñ\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2);
  }

  private chunkText(text: string): KnowledgeChunk[] {
    if (!text.trim()) return [];

    const chunkSize = 500;
    const overlap = 50;
    const chunks: KnowledgeChunk[] = [];

    // First split by double newlines (paragraphs)
    const paragraphs = text.split(/\n\n+/);
    let buffer = '';
    let index = 0;

    for (const para of paragraphs) {
      if (buffer.length + para.length > chunkSize && buffer.length > 0) {
        chunks.push({ content: buffer.trim(), index: index++ });
        // Keep overlap from end of previous chunk
        buffer = buffer.slice(-overlap) + '\n\n' + para;
      } else {
        buffer += (buffer ? '\n\n' : '') + para;
      }
    }

    if (buffer.trim()) {
      chunks.push({ content: buffer.trim(), index: index });
    }

    return chunks;
  }

  // ── Persistence ──────────────────────────────────────

  private loadSync(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        this.content = fs.readFileSync(this.filePath, 'utf-8');
        this.chunks = this.chunkText(this.content);
        this.logger.log(
          `Knowledge loaded: ${this.content.length} chars, ${this.chunks.length} chunks`,
        );
      } else {
        this.logger.log('No knowledge file found, starting empty');
      }
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to load knowledge: ${(error as Error).message}`,
      );
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveToDisk(), 500);
  }

  private async saveToDisk(): Promise<void> {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      await fs.promises.writeFile(this.filePath, this.content, 'utf-8');
      this.logger.debug('Knowledge saved to disk');
    } catch (error: unknown) {
      this.logger.error(
        `Failed to save knowledge: ${(error as Error).message}`,
      );
    }
  }
}
