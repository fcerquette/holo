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
import { LlmService } from './llm.service';
import { ConversationStore } from './conversation-store.service';
import { RagService } from './rag.service';
import { SqlService, SqlConnectionConfig } from './sql.service';
import { MemoryRagService } from './memory-rag.service';
import { PersonalityService } from './personality.service';

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

  private state: HoloState = {
    speaking: false,
    expression: 'neutral',
    glowColor: '#00f0ff',
    skinColor: '#1a1a2e',
    message: '',
    displayMode: 'hologram',
  };

  constructor(
    private readonly llmService: LlmService,
    private readonly conversationStore: ConversationStore,
    private readonly ragService: RagService,
    private readonly sqlService: SqlService,
    private readonly memoryRagService: MemoryRagService,
    private readonly personalityService: PersonalityService,
  ) {}

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);

    // Sync hologram visual state
    client.emit('state:sync', this.state);

    // Send persisted chat history
    const history = this.conversationStore.getChatHistory();
    if (history.length > 0) {
      client.emit('chat:history', history);
      this.logger.log(
        `Sent ${history.length} history messages to ${client.id}`
      );
    }

    // Send owner info or ask for name
    const ownerName = this.conversationStore.getOwnerName();
    if (ownerName) {
      client.emit('owner:info', { name: ownerName });
    } else {
      client.emit('owner:askName');
    }

    // Send RAG status
    client.emit('rag:status', this.ragService.getStatus());

    // Send SQL status
    client.emit('sql:status', this.sqlService.getStatus());

    // Send Memory RAG status
    client.emit('memory:status', this.memoryRagService.getStatus());

    // Send personality config
    client.emit('personality:status', this.personalityService.getPersonality());
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  // ── Owner Setup ────────────────────────────────────────

  @SubscribeMessage('setOwnerName')
  async handleSetOwnerName(
    @MessageBody() data: { name: string },
    @ConnectedSocket() client: Socket
  ) {
    const name = data.name?.trim();
    if (!name) return;

    this.conversationStore.setOwner(name);
    this.logger.log(`Owner set to: "${name}"`);

    // Notify all clients
    this.server.emit('owner:info', { name });

    // Holo greets the new owner via LLM
    const { text: greeting, expression } = await this.llmService.chat(
      `Mi dueño/a se acaba de presentar, se llama "${name}". Saludalo/a con cariño y decile que ahora sos su mascota holográfica.`
    );

    this.server.emit('chat:userMessage', {
      text: `Me llamo ${name}`,
    });
    this.state.speaking = true;
    this.state.message = greeting;
    this.state.expression = expression as HoloExpression;
    this.server.emit('state:expression', { expression });
    this.server.emit('chat:response', { text: greeting });
  }

  // ── Chat ───────────────────────────────────────────────

  @SubscribeMessage('chat')
  async handleChat(
    @MessageBody() data: { text: string },
    @ConnectedSocket() client: Socket
  ) {
    this.logger.log(`Chat from user: "${data.text}"`);

    // Notify all clients that user sent a message
    this.server.emit('chat:userMessage', { text: data.text });

    // Show "thinking" state
    this.server.emit('chat:thinking', { thinking: true });

    try {
      // Get LLM response with expression (also persists to ConversationStore)
      const { text: response, expression } = await this.llmService.chat(data.text);

      // Stop thinking
      this.server.emit('chat:thinking', { thinking: false });

      // Auto-set expression from LLM response
      this.state.expression = expression as HoloExpression;
      this.server.emit('state:expression', { expression });

      // Broadcast the response - display will handle TTS
      this.state.speaking = true;
      this.state.message = response;
      this.server.emit('chat:response', { text: response });
    } catch (error: unknown) {
      this.logger.error(`Chat error: ${(error as Error).message}`);
      this.server.emit('chat:thinking', { thinking: false });
      this.server.emit('chat:response', {
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
  handleClearHistory() {
    this.llmService.clearHistory();
    this.server.emit('chat:historyCleared');
    this.logger.log('Conversation history cleared');
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
}
