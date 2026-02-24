import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface DisplayMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

interface ConversationData {
  ownerName: string | null;
  llmHistory: LlmMessage[];
  chatHistory: DisplayMessage[];
}

@Injectable()
export class ConversationStore {
  private logger = new Logger('ConversationStore');
  private data: ConversationData = {
    ownerName: null,
    llmHistory: [],
    chatHistory: [],
  };
  private filePath: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.filePath = path.join(
      process.cwd(),
      'apps',
      'holo-api',
      'data',
      'conversations.json'
    );

    // Load from disk first
    this.loadSync();

    // ENV variable takes priority over saved name
    const envOwner = process.env.HOLO_OWNER?.trim();
    if (envOwner) {
      this.data.ownerName = envOwner;
      this.logger.log(`Owner from .env: "${envOwner}"`);
    } else if (this.data.ownerName) {
      this.logger.log(`Owner from saved data: "${this.data.ownerName}"`);
    } else {
      this.logger.log('No owner configured — will ask on first connection');
    }
  }

  /** Load conversation data from disk synchronously (called once at startup) */
  private loadSync(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw) as ConversationData;
        this.data = {
          ownerName: parsed.ownerName || null,
          llmHistory: Array.isArray(parsed.llmHistory)
            ? parsed.llmHistory
            : [],
          chatHistory: Array.isArray(parsed.chatHistory)
            ? parsed.chatHistory
            : [],
        };
        this.logger.log(
          `Loaded ${this.data.llmHistory.length} LLM messages, ` +
            `${this.data.chatHistory.length} chat messages from disk`
        );
      } else {
        this.logger.log('No conversation file found, starting fresh');
      }
    } catch (error: unknown) {
      this.logger.warn(`Failed to load conversations: ${(error as Error).message}`);
      this.data = { ownerName: null, llmHistory: [], chatHistory: [] };
    }
  }

  /** Schedule an async save (debounced 500ms) */
  private scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveToDisk();
    }, 500);
  }

  /** Actually write to disk */
  private async saveToDisk(): Promise<void> {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      await fs.promises.writeFile(
        this.filePath,
        JSON.stringify(this.data, null, 2),
        'utf-8'
      );
    } catch (error: unknown) {
      this.logger.error(`Failed to save conversations: ${(error as Error).message}`);
    }
  }

  // ── Owner ──────────────────────────────────────────────

  /** Get the owner's name, or null if not configured yet */
  getOwnerName(): string | null {
    return this.data.ownerName;
  }

  /** Set the owner's name and persist immediately */
  setOwner(name: string): void {
    this.data.ownerName = name.trim();
    this.logger.log(`Owner set to: "${this.data.ownerName}"`);
    this.scheduleSave();
  }

  // ── Conversation History ───────────────────────────────

  /** Get LLM history (for building the messages array for Groq) */
  getLlmHistory(): LlmMessage[] {
    return [...this.data.llmHistory];
  }

  /** Get display chat history (for sending to frontend clients) */
  getChatHistory(): DisplayMessage[] {
    return [...this.data.chatHistory];
  }

  /** Add a user message to both histories */
  addUserMessage(content: string): void {
    const timestamp = Date.now();

    this.data.llmHistory.push({ role: 'user', content });
    if (this.data.llmHistory.length > 20) {
      this.data.llmHistory = this.data.llmHistory.slice(-20);
    }

    this.data.chatHistory.push({ role: 'user', text: content, timestamp });
    if (this.data.chatHistory.length > 50) {
      this.data.chatHistory = this.data.chatHistory.slice(-50);
    }

    this.scheduleSave();
  }

  /** Add an assistant message to both histories */
  addAssistantMessage(content: string): void {
    const timestamp = Date.now();

    this.data.llmHistory.push({ role: 'assistant', content });
    if (this.data.llmHistory.length > 20) {
      this.data.llmHistory = this.data.llmHistory.slice(-20);
    }

    this.data.chatHistory.push({
      role: 'assistant',
      text: content,
      timestamp,
    });
    if (this.data.chatHistory.length > 50) {
      this.data.chatHistory = this.data.chatHistory.slice(-50);
    }

    this.scheduleSave();
  }

  /** Clear conversation history (keeps owner name) */
  clear(): void {
    this.data.llmHistory = [];
    this.data.chatHistory = [];

    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    // Save immediately with empty history (but keep owner)
    this.saveToDisk();
    this.logger.log('Conversation history cleared (owner preserved)');
  }
}
