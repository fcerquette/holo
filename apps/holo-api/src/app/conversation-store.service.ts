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

export interface Session {
  id: string;
  name: string;
  llmHistory: LlmMessage[];
  chatHistory: DisplayMessage[];
  lastActive: number;
  connected: boolean;
}

export interface SessionInfo {
  id: string;
  name: string;
  lastActive: number;
  connected: boolean;
  messageCount: number;
}

interface ConversationData {
  ownerName: string | null;
  sessions: Record<string, Session>;
}

// Legacy format (pre-sessions) for migration
interface LegacyConversationData {
  ownerName: string | null;
  llmHistory: LlmMessage[];
  chatHistory: DisplayMessage[];
}

@Injectable()
export class ConversationStore {
  private logger = new Logger('ConversationStore');
  private data: ConversationData = {
    ownerName: null,
    sessions: {},
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
        const parsed = JSON.parse(raw);

        // Check if this is the new format (has sessions) or legacy format
        if (parsed.sessions && typeof parsed.sessions === 'object') {
          // New format
          this.data = {
            ownerName: parsed.ownerName || null,
            sessions: parsed.sessions,
          };
          const sessionCount = Object.keys(this.data.sessions).length;
          this.logger.log(`Loaded ${sessionCount} sessions from disk`);
        } else {
          // Legacy format — migrate
          const legacy = parsed as LegacyConversationData;
          this.data = {
            ownerName: legacy.ownerName || null,
            sessions: {},
          };

          // Migrate existing history to a "legacy" session
          const legacyLlm = Array.isArray(legacy.llmHistory) ? legacy.llmHistory : [];
          const legacyChat = Array.isArray(legacy.chatHistory) ? legacy.chatHistory : [];
          if (legacyLlm.length > 0 || legacyChat.length > 0) {
            this.data.sessions['legacy'] = {
              id: 'legacy',
              name: legacy.ownerName || 'Usuario',
              llmHistory: legacyLlm,
              chatHistory: legacyChat,
              lastActive: Date.now(),
              connected: false,
            };
            this.logger.log(
              `Migrated legacy history (${legacyLlm.length} LLM, ${legacyChat.length} chat messages) to "legacy" session`
            );
          }

          // Save migrated data
          this.scheduleSave();
        }
      } else {
        this.logger.log('No conversation file found, starting fresh');
      }
    } catch (error: unknown) {
      this.logger.warn(`Failed to load conversations: ${(error as Error).message}`);
      this.data = { ownerName: null, sessions: {} };
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

  // ── Session Management ─────────────────────────────────

  /** Get or create a session */
  getOrCreateSession(sessionId: string, name = ''): Session {
    if (!this.data.sessions[sessionId]) {
      this.data.sessions[sessionId] = {
        id: sessionId,
        name,
        llmHistory: [],
        chatHistory: [],
        lastActive: Date.now(),
        connected: true,
      };
      this.logger.log(`New session created: ${sessionId} (name: "${name}")`);
      this.scheduleSave();
    }
    return this.data.sessions[sessionId];
  }

  /** Mark session as connected/disconnected */
  setSessionConnected(sessionId: string, connected: boolean): void {
    const session = this.data.sessions[sessionId];
    if (session) {
      session.connected = connected;
      session.lastActive = Date.now();
      this.scheduleSave();
    }
  }

  /** Update session name */
  setSessionName(sessionId: string, name: string): void {
    const session = this.data.sessions[sessionId];
    if (session) {
      session.name = name.trim();
      session.lastActive = Date.now();
      this.logger.log(`Session ${sessionId} name set to: "${session.name}"`);
      this.scheduleSave();
    }
  }

  /** Get session name */
  getSessionName(sessionId: string): string {
    return this.data.sessions[sessionId]?.name || '';
  }

  /** Get all sessions as summary info (for Control Panel) */
  getSessions(): SessionInfo[] {
    return Object.values(this.data.sessions).map((s) => ({
      id: s.id,
      name: s.name,
      lastActive: s.lastActive,
      connected: s.connected,
      messageCount: s.chatHistory.length,
    }));
  }

  /** Get a specific session */
  getSession(sessionId: string): Session | null {
    return this.data.sessions[sessionId] || null;
  }

  // ── Conversation History (per-session) ──────────────────

  /** Get LLM history for a session */
  getLlmHistory(sessionId: string): LlmMessage[] {
    const session = this.data.sessions[sessionId];
    return session ? [...session.llmHistory] : [];
  }

  /** Get display chat history for a session */
  getChatHistory(sessionId: string): DisplayMessage[] {
    const session = this.data.sessions[sessionId];
    return session ? [...session.chatHistory] : [];
  }

  /** Add a user message to a session */
  addUserMessage(sessionId: string, content: string): void {
    const session = this.getOrCreateSession(sessionId);
    const timestamp = Date.now();

    session.llmHistory.push({ role: 'user', content });
    if (session.llmHistory.length > 20) {
      session.llmHistory = session.llmHistory.slice(-20);
    }

    session.chatHistory.push({ role: 'user', text: content, timestamp });
    if (session.chatHistory.length > 50) {
      session.chatHistory = session.chatHistory.slice(-50);
    }

    session.lastActive = timestamp;
    this.scheduleSave();
  }

  /** Add an assistant message to a session */
  addAssistantMessage(sessionId: string, content: string): void {
    const session = this.getOrCreateSession(sessionId);
    const timestamp = Date.now();

    session.llmHistory.push({ role: 'assistant', content });
    if (session.llmHistory.length > 20) {
      session.llmHistory = session.llmHistory.slice(-20);
    }

    session.chatHistory.push({
      role: 'assistant',
      text: content,
      timestamp,
    });
    if (session.chatHistory.length > 50) {
      session.chatHistory = session.chatHistory.slice(-50);
    }

    session.lastActive = timestamp;
    this.scheduleSave();
  }

  /** Clear conversation history for a session (keeps session metadata) */
  clearSession(sessionId: string): void {
    const session = this.data.sessions[sessionId];
    if (session) {
      session.llmHistory = [];
      session.chatHistory = [];
      this.logger.log(`Session ${sessionId} history cleared`);
    }

    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    this.saveToDisk();
  }
}
