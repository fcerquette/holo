import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { randomUUID } from 'crypto';
import { LlmService } from './llm.service';
import { ConversationStore } from './conversation-store.service';
import { RagService } from './rag.service';
import { SqlService, SqlConnectionConfig } from './sql.service';
import { MemoryRagService } from './memory-rag.service';
import { PersonalityService } from './personality.service';
import { KnowledgeService } from './knowledge.service';

type HoloExpression = 'neutral' | 'happy' | 'surprised' | 'sad' | 'angry' | 'embarrassed';

interface HoloState {
  speaking: boolean;
  expression: HoloExpression;
  glowColor: string;
  skinColor: string;
  message: string;
  displayMode: 'hologram' | '2d';
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class HoloGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private logger = new Logger('HoloGateway');

  // Map socket.id → sessionId
  private socketToSession = new Map<string, string>();

  private state: HoloState = {
    speaking: false,
    expression: 'neutral',
    glowColor: '#00f0ff',
    skinColor: '#1a1a2e',
    message: '',
    displayMode: '2d',
  };

  constructor(
    private readonly llmService: LlmService,
    private readonly conversationStore: ConversationStore,
    private readonly ragService: RagService,
    private readonly sqlService: SqlService,
    private readonly memoryRagService: MemoryRagService,
    private readonly personalityService: PersonalityService,
    private readonly knowledgeService: KnowledgeService,
  ) {}

  /** Get sessionId for a socket */
  private getSessionId(client: Socket): string {
    return this.socketToSession.get(client.id) || '';
  }

  handleConnection(client: Socket) {
    // Resolve session: client sends existing sessionId in handshake query
    const requestedSessionId = (client.handshake.query.sessionId as string) || '';
    let sessionId: string;

    if (requestedSessionId && this.conversationStore.getSession(requestedSessionId)) {
      // Reconnecting to existing session
      sessionId = requestedSessionId;
      this.conversationStore.setSessionConnected(sessionId, true);
      this.logger.log(`Client ${client.id} reconnected to session ${sessionId}`);
    } else {
      // New session
      sessionId = randomUUID();
      this.conversationStore.getOrCreateSession(sessionId);
      this.logger.log(`Client ${client.id} → new session ${sessionId}`);
    }

    this.socketToSession.set(client.id, sessionId);

    // Tell the client its sessionId
    client.emit('session:id', { sessionId });

    // Sync hologram visual state (global)
    client.emit('state:sync', this.state);

    // Send persisted chat history for THIS session
    const history = this.conversationStore.getChatHistory(sessionId);
    if (history.length > 0) {
      client.emit('chat:history', history);
      this.logger.log(`Sent ${history.length} history messages for session ${sessionId}`);
    }

    // Send owner info or ask for name (global)
    const ownerName = this.conversationStore.getOwnerName();
    if (ownerName) {
      client.emit('owner:info', { name: ownerName });
    } else {
      client.emit('owner:askName');
    }

    // Send session name if it exists, or ask for one (only if owner is already set)
    const sessionName = this.conversationStore.getSessionName(sessionId);
    if (sessionName) {
      client.emit('session:name', { name: sessionName });
    } else if (ownerName) {
      // Owner is set but this session has no name — ask
      client.emit('session:askName');
    }

    // Send RAG status
    client.emit('rag:status', this.ragService.getStatus());

    // Send SQL status
    client.emit('sql:status', this.sqlService.getStatus());

    // Send Memory RAG status
    client.emit('memory:status', this.memoryRagService.getStatus());

    // Send personality config
    client.emit('personality:status', this.personalityService.getPersonality());

    // Send knowledge status and content
    client.emit('knowledge:status', this.knowledgeService.getStatus());
    client.emit('knowledge:content', { content: this.knowledgeService.getContent() });

    // Notify all clients about session list update
    this.server.emit('sessions:update', this.conversationStore.getSessions());
  }

  handleDisconnect(client: Socket) {
    const sessionId = this.getSessionId(client);
    this.socketToSession.delete(client.id);

    if (sessionId) {
      this.conversationStore.setSessionConnected(sessionId, false);
      this.logger.log(`Client ${client.id} disconnected (session ${sessionId})`);
      // Notify remaining clients
      this.server.emit('sessions:update', this.conversationStore.getSessions());
    }
  }

  // ── Owner Setup ────────────────────────────────────────

  @SubscribeMessage('setOwnerName')
  async handleSetOwnerName(
    @MessageBody() data: { name: string },
    @ConnectedSocket() client: Socket
  ) {
    const name = data.name?.trim();
    if (!name) return;

    const sessionId = this.getSessionId(client);

    this.conversationStore.setOwner(name);
    this.logger.log(`Owner set to: "${name}"`);

    // Also set as session name (the owner is chatting from this session)
    this.conversationStore.setSessionName(sessionId, name);
    client.emit('session:name', { name });

    // Notify all clients
    this.server.emit('owner:info', { name });
    this.server.emit('sessions:update', this.conversationStore.getSessions());

    // Holo greets the new owner via LLM (in the current session)
    const { text: greeting, expression } = await this.llmService.chat(
      `Mi dueño/a se acaba de presentar, se llama "${name}". Saludalo/a con cariño y decile que ahora sos su mascota holográfica.`,
      sessionId,
    );

    // Chat events go only to this session's socket
    client.emit('chat:userMessage', { text: `Me llamo ${name}` });

    this.state.speaking = true;
    this.state.message = greeting;
    this.state.expression = expression as HoloExpression;

    // Expression + speak go to all (global visual state)
    this.server.emit('state:expression', { expression });
    client.emit('chat:response', { text: greeting });
  }

  // ── Session ─────────────────────────────────────────────

  @SubscribeMessage('session:setName')
  handleSessionSetName(
    @MessageBody() data: { name: string },
    @ConnectedSocket() client: Socket,
  ) {
    const sessionId = this.getSessionId(client);
    const name = data.name?.trim();
    if (!sessionId || !name) return;

    this.conversationStore.setSessionName(sessionId, name);
    client.emit('session:name', { name });
    this.server.emit('sessions:update', this.conversationStore.getSessions());
    this.logger.log(`Session ${sessionId} name: "${name}"`);
  }

  @SubscribeMessage('sessions:getAll')
  handleSessionsGetAll(@ConnectedSocket() client: Socket) {
    client.emit('sessions:update', this.conversationStore.getSessions());
  }

  @SubscribeMessage('session:getHistory')
  handleSessionGetHistory(
    @MessageBody() data: { sessionId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const history = this.conversationStore.getChatHistory(data.sessionId);
    const session = this.conversationStore.getSession(data.sessionId);
    client.emit('session:history', {
      sessionId: data.sessionId,
      name: session?.name || '',
      messages: history,
    });
  }

  // ── Chat ───────────────────────────────────────────────

  @SubscribeMessage('chat')
  async handleChat(
    @MessageBody() data: { text: string },
    @ConnectedSocket() client: Socket
  ) {
    const sessionId = this.getSessionId(client);
    this.logger.log(`Chat from session ${sessionId}: "${data.text}"`);

    // Chat events go only to this session's socket
    client.emit('chat:userMessage', { text: data.text });
    client.emit('chat:thinking', { thinking: true });

    try {
      // Get LLM response (per-session history)
      const { text: response, expression } = await this.llmService.chat(data.text, sessionId);

      client.emit('chat:thinking', { thinking: false });

      // Expression is global visual state
      this.state.expression = expression as HoloExpression;
      this.server.emit('state:expression', { expression });

      // Chat response + speak go to the session's socket
      this.state.speaking = true;
      this.state.message = response;
      client.emit('chat:response', { text: response });

      // Also broadcast speak to HoloDisplay (so TTS works on display)
      this.server.emit('state:speak', { text: response });
    } catch (error: unknown) {
      this.logger.error(`Chat error: ${(error as Error).message}`);
      client.emit('chat:thinking', { thinking: false });
      client.emit('chat:response', {
        text: 'Uy, se me trabó el cerebro. Probá de nuevo.',
      });
    }
  }

  // ── Direct speak (without LLM) ────────────────────────

  @SubscribeMessage('speak')
  handleSpeak(@MessageBody() data: { text: string }) {
    this.logger.log(`Speak: ${data.text}`);
    this.state.speaking = true;
    this.state.message = data.text;
    this.server.emit('state:speak', { text: data.text });
  }

  @SubscribeMessage('speakingDone')
  handleSpeakingDone() {
    this.state.speaking = false;
    this.state.message = '';
    this.server.emit('state:stopSpeaking');
  }

  @SubscribeMessage('stopSpeaking')
  handleStopSpeaking() {
    this.state.speaking = false;
    this.state.message = '';
    this.server.emit('state:stopSpeaking');
  }

  // ── Visual state ───────────────────────────────────────

  @SubscribeMessage('setExpression')
  handleExpression(@MessageBody() data: { expression: string }) {
    this.state.expression = data.expression as HoloState['expression'];
    this.server.emit('state:expression', data);
  }

  @SubscribeMessage('setGlowColor')
  handleGlowColor(@MessageBody() data: { color: string }) {
    this.state.glowColor = data.color;
    this.server.emit('state:glowColor', data);
  }

  @SubscribeMessage('setSkinColor')
  handleSkinColor(@MessageBody() data: { color: string }) {
    this.state.skinColor = data.color;
    this.server.emit('state:skinColor', data);
  }

  @SubscribeMessage('setDisplayMode')
  handleDisplayMode(@MessageBody() data: { mode: string }) {
    this.state.displayMode = data.mode as HoloState['displayMode'];
    this.server.emit('state:displayMode', data);
    this.logger.log(`Display mode: ${data.mode}`);
  }

  // ── History management ─────────────────────────────────

  @SubscribeMessage('clearHistory')
  handleClearHistory(
    @MessageBody() data: { sessionId?: string },
    @ConnectedSocket() client: Socket,
  ) {
    const targetSession = data?.sessionId || this.getSessionId(client);
    this.llmService.clearHistory(targetSession);
    client.emit('chat:historyCleared');
    this.server.emit('sessions:update', this.conversationStore.getSessions());
    this.logger.log(`Session ${targetSession} history cleared`);
  }

  @SubscribeMessage('getState')
  handleGetState(@ConnectedSocket() client: Socket) {
    client.emit('state:sync', this.state);
  }

  // ── RAG (Base de Conocimiento) ───────────────────────

  @SubscribeMessage('rag:reindex')
  async handleRagReindex(@ConnectedSocket() client: Socket) {
    this.logger.log('RAG re-index requested');

    // Notify all clients that indexing started
    this.server.emit('rag:indexing', { indexing: true });

    const result = await this.ragService.indexDocuments();

    // Notify all clients of result
    this.server.emit('rag:indexing', { indexing: false });
    this.server.emit('rag:status', this.ragService.getStatus());
    this.server.emit('rag:indexResult', result);

    this.logger.log(`RAG re-index result: ${result.message}`);
  }

  @SubscribeMessage('rag:getStatus')
  handleRagGetStatus(@ConnectedSocket() client: Socket) {
    client.emit('rag:status', this.ragService.getStatus());
  }

  // ── SQL Agent ──────────────────────────────────────────

  @SubscribeMessage('sql:getStatus')
  handleSqlGetStatus(@ConnectedSocket() client: Socket) {
    client.emit('sql:status', this.sqlService.getStatus());
  }

  @SubscribeMessage('sql:setEnabled')
  async handleSqlSetEnabled(@MessageBody() data: { enabled: boolean }) {
    await this.sqlService.setEnabled(data.enabled);
    this.server.emit('sql:status', this.sqlService.getStatus());
    this.logger.log(`SQL Agent ${data.enabled ? 'habilitado' : 'deshabilitado'}`);
  }

  @SubscribeMessage('sql:setMode')
  async handleSqlSetMode(
    @MessageBody() data: { mode: 'query-only' | 'execute' },
  ) {
    await this.sqlService.setMode(data.mode);
    this.server.emit('sql:status', this.sqlService.getStatus());
    this.logger.log(`SQL mode: ${data.mode}`);
  }

  @SubscribeMessage('sql:setActiveConnection')
  async handleSqlSetActive(
    @MessageBody() data: { connectionId: string },
  ) {
    await this.sqlService.setActiveConnection(data.connectionId);
    this.server.emit('sql:status', this.sqlService.getStatus());
    this.logger.log(`SQL active connection: ${data.connectionId}`);
  }

  @SubscribeMessage('sql:addConnection')
  async handleSqlAddConnection(
    @MessageBody() data: SqlConnectionConfig,
    @ConnectedSocket() client: Socket,
  ) {
    this.logger.log(`Adding SQL connection: ${data.name}`);
    const result = await this.sqlService.addConnection(data);
    this.server.emit('sql:status', this.sqlService.getStatus());
    client.emit('sql:connectionResult', result);
  }

  @SubscribeMessage('sql:removeConnection')
  async handleSqlRemoveConnection(
    @MessageBody() data: { connectionId: string },
  ) {
    await this.sqlService.removeConnection(data.connectionId);
    this.server.emit('sql:status', this.sqlService.getStatus());
    this.logger.log(`SQL connection removed: ${data.connectionId}`);
  }

  @SubscribeMessage('sql:testConnection')
  async handleSqlTestConnection(
    @MessageBody() data: { connectionId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const result = await this.sqlService.testConnection(data.connectionId);
    client.emit('sql:testResult', result);
  }

  @SubscribeMessage('sql:refreshSchema')
  async handleSqlRefreshSchema(
    @MessageBody() data: { connectionId: string },
    @ConnectedSocket() client: Socket,
  ) {
    this.server.emit('sql:refreshing', { refreshing: true });
    const result = await this.sqlService.refreshSchema(data.connectionId);
    this.server.emit('sql:refreshing', { refreshing: false });
    this.server.emit('sql:status', this.sqlService.getStatus());
    client.emit('sql:refreshResult', result);
    this.logger.log(`SQL schema refresh: ${result.message}`);
  }

  // ── Personality ──────────────────────────────────────

  @SubscribeMessage('personality:set')
  handleSetPersonality(
    @MessageBody() data: { category: string; preset: string },
  ) {
    this.personalityService.setPersonality(data.category, data.preset);
    const personality = this.personalityService.getPersonality();
    this.server.emit('personality:status', personality);
    this.logger.log(`Personality set to: ${data.category}/${data.preset}`);
  }

  @SubscribeMessage('personality:getStatus')
  handleGetPersonality(@ConnectedSocket() client: Socket) {
    client.emit('personality:status', this.personalityService.getPersonality());
  }

  // ── Memory RAG ──────────────────────────────────────

  @SubscribeMessage('memory:getStatus')
  handleMemoryGetStatus(@ConnectedSocket() client: Socket) {
    client.emit('memory:status', this.memoryRagService.getStatus());
  }

  @SubscribeMessage('memory:forget')
  handleMemoryForget(
    @MessageBody() data: { keyword: string },
    @ConnectedSocket() client: Socket,
  ) {
    const removed = this.memoryRagService.forgetByKeyword(data.keyword);
    client.emit('memory:forgetResult', {
      keyword: data.keyword,
      removed,
    });
    this.server.emit('memory:status', this.memoryRagService.getStatus());
    this.logger.log(`Memory forget: "${data.keyword}" → ${removed} removed`);
  }

  // ── Knowledge Base ──────────────────────────────────

  @SubscribeMessage('knowledge:get')
  handleKnowledgeGet(@ConnectedSocket() client: Socket) {
    client.emit('knowledge:content', { content: this.knowledgeService.getContent() });
    client.emit('knowledge:status', this.knowledgeService.getStatus());
  }

  @SubscribeMessage('knowledge:save')
  handleKnowledgeSave(
    @MessageBody() data: { content: string },
    @ConnectedSocket() client: Socket,
  ) {
    const status = this.knowledgeService.setContent(data.content);
    this.server.emit('knowledge:status', status);
    client.emit('knowledge:saved', { success: true });
    this.logger.log(`Knowledge saved: ${status.contentLength} chars, ${status.chunkCount} chunks`);
  }
}
