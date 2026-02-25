import { ref } from 'vue';
import { io, Socket } from 'socket.io-client';
import { useHoloStore, type HoloExpression, type SessionInfo, type ChatMessage } from '../stores/holo';

// Auto-detect API URL: match protocol + hostname from current page (avoids Mixed Content block on mobile)
const protocol = window.location.protocol === 'https:' ? 'https' : 'http';
const API_URL = import.meta.env.VITE_API_URL || `${protocol}://${window.location.hostname}:3000`;

const SESSION_KEY = 'holo-session-id';

let socket: Socket | null = null;
const connected = ref(false);

// Multiple callbacks for TTS (both display and control can register)
const chatResponseCallbacks: Array<(text: string) => void> = [];

export function useSocket() {
  const holo = useHoloStore();

  function connect() {
    if (socket?.connected) return;

    // Send existing sessionId if we have one (for reconnection)
    const storedSessionId = localStorage.getItem(SESSION_KEY) || '';

    socket = io(API_URL, {
      transports: ['websocket', 'polling'],
      query: storedSessionId ? { sessionId: storedSessionId } : {},
    });

    socket.on('connect', () => {
      connected.value = true;
      console.log('[Socket] Connected to', API_URL);
    });

    socket.on('disconnect', () => {
      connected.value = false;
      console.log('[Socket] Disconnected');
    });

    // Session events
    socket.on('session:id', (data: { sessionId: string }) => {
      console.log('[Socket] session:id:', data.sessionId);
      localStorage.setItem(SESSION_KEY, data.sessionId);
      holo.setSessionId(data.sessionId);
    });

    socket.on('session:name', (data: { name: string }) => {
      console.log('[Socket] session:name:', data.name);
      holo.setSessionName(data.name);
      holo.showSessionSetup = false;
    });

    socket.on('session:askName', () => {
      console.log('[Socket] session:askName — need to ask user for session name');
      holo.showSessionSetup = true;
    });

    socket.on('sessions:update', (sessions: SessionInfo[]) => {
      console.log('[Socket] sessions:update:', sessions.length, 'sessions');
      holo.updateSessions(sessions);
    });

    socket.on('session:history', (data: { sessionId: string; name: string; messages: ChatMessage[] }) => {
      console.log('[Socket] session:history for', data.sessionId, ':', data.messages.length, 'messages');
      holo.setViewingSession(data.sessionId, data.name, data.messages);
    });

    // State sync
    socket.on('state:sync', (state) => {
      holo.speaking = state.speaking;
      holo.expression = state.expression;
      holo.glowColor = state.glowColor;
      holo.skinColor = state.skinColor;
      holo.message = state.message;
      if (state.displayMode) holo.displayMode = state.displayMode;
    });

    // Direct speak
    socket.on('state:speak', (data: { text: string }) => {
      console.log('[Socket] state:speak received:', data.text);
      holo.speaking = true;
      holo.message = data.text;
      triggerTTS(data.text);
    });

    socket.on('state:stopSpeaking', () => {
      holo.speaking = false;
      holo.message = '';
    });

    socket.on('state:expression', (data: { expression: string }) => {
      holo.expression = data.expression as HoloExpression;
    });

    socket.on('state:glowColor', (data: { color: string }) => {
      holo.glowColor = data.color;
    });

    socket.on('state:skinColor', (data: { color: string }) => {
      holo.skinColor = data.color;
    });

    socket.on('state:displayMode', (data: { mode: string }) => {
      holo.displayMode = data.mode as 'hologram' | '2d';
    });

    // Chat events
    socket.on('chat:userMessage', (data: { text: string }) => {
      console.log('[Socket] chat:userMessage:', data.text);
      holo.addChatMessage('user', data.text);
    });

    socket.on('chat:thinking', (data: { thinking: boolean }) => {
      console.log('[Socket] chat:thinking:', data.thinking);
      holo.thinking = data.thinking;
    });

    socket.on('chat:response', (data: { text: string }) => {
      console.log('[Socket] chat:response received:', data.text);
      holo.addChatMessage('assistant', data.text);
      // TTS is handled by state:speak (broadcast) — don't duplicate here
    });

    socket.on('chat:historyCleared', () => {
      holo.clearChat();
    });

    // Persisted chat history (sent on connect)
    socket.on(
      'chat:history',
      (
        messages: Array<{
          role: 'user' | 'assistant';
          text: string;
          timestamp: number;
        }>
      ) => {
        console.log(
          '[Socket] chat:history received:',
          messages.length,
          'messages'
        );
        holo.loadChatHistory(messages);
      }
    );

    // Owner events
    socket.on('owner:info', (data: { name: string }) => {
      console.log('[Socket] owner:info:', data.name);
      holo.ownerName = data.name;
      holo.showOwnerSetup = false;
    });

    socket.on('owner:askName', () => {
      console.log('[Socket] owner:askName — need to ask user for name');
      holo.showOwnerSetup = true;
    });

    // RAG events
    socket.on('rag:status', (status) => {
      console.log('[Socket] rag:status:', status);
      holo.updateRagStatus(status);
    });

    socket.on('rag:indexing', (data: { indexing: boolean }) => {
      console.log('[Socket] rag:indexing:', data.indexing);
      holo.setRagIndexing(data.indexing);
    });

    socket.on('rag:indexResult', (data: { success: boolean; message: string }) => {
      console.log('[Socket] rag:indexResult:', data);
    });

    // SQL events
    socket.on('sql:status', (status) => {
      console.log('[Socket] sql:status:', status);
      holo.updateSqlStatus(status);
    });

    socket.on('sql:refreshing', (data: { refreshing: boolean }) => {
      holo.setSqlRefreshing(data.refreshing);
    });

    socket.on('sql:connectionResult', (data: { success: boolean; message: string }) => {
      console.log('[Socket] sql:connectionResult:', data);
    });

    socket.on('sql:testResult', (data: { success: boolean; message: string }) => {
      console.log('[Socket] sql:testResult:', data);
    });

    socket.on('sql:refreshResult', (data: { success: boolean; message: string }) => {
      console.log('[Socket] sql:refreshResult:', data);
    });

    // Personality events
    socket.on('personality:status', (status) => {
      console.log('[Socket] personality:status:', status);
      holo.updatePersonality(status);
    });

    // Knowledge events
    socket.on('knowledge:status', (status: { chunkCount: number }) => {
      console.log('[Socket] knowledge:status:', status);
      holo.updateKnowledgeStatus(status);
    });

    socket.on('knowledge:content', (data: { content: string }) => {
      console.log('[Socket] knowledge:content received, length:', data.content.length);
      holo.updateKnowledgeContent(data.content);
    });

    socket.on('knowledge:saved', (data: { success: boolean }) => {
      console.log('[Socket] knowledge:saved:', data);
    });
  }

  function triggerTTS(text: string) {
    console.log(
      '[Socket] Triggering TTS, callbacks registered:',
      chatResponseCallbacks.length
    );
    chatResponseCallbacks.forEach((cb) => cb(text));
  }

  function disconnect() {
    socket?.disconnect();
    socket = null;
    connected.value = false;
  }

  function chat(text: string) {
    console.log('[Socket] Sending chat:', text);
    socket?.emit('chat', { text });
  }

  function speak(text: string) {
    socket?.emit('speak', { text });
  }

  function speakingDone() {
    socket?.emit('speakingDone');
  }

  function stopSpeaking() {
    socket?.emit('stopSpeaking');
  }

  function setExpression(expression: string) {
    socket?.emit('setExpression', { expression });
  }

  function setGlowColor(color: string) {
    socket?.emit('setGlowColor', { color });
  }

  function setSkinColor(color: string) {
    socket?.emit('setSkinColor', { color });
  }

  function setDisplayMode(mode: string) {
    socket?.emit('setDisplayMode', { mode });
  }

  function clearHistory(sessionId?: string) {
    socket?.emit('clearHistory', { sessionId });
  }

  function setOwnerName(name: string) {
    console.log('[Socket] Setting owner name:', name);
    socket?.emit('setOwnerName', { name });
  }

  function ragReindex() {
    socket?.emit('rag:reindex');
  }

  function ragGetStatus() {
    socket?.emit('rag:getStatus');
  }

  // SQL methods
  function sqlSetEnabled(enabled: boolean) {
    socket?.emit('sql:setEnabled', { enabled });
  }

  function sqlSetMode(mode: 'query-only' | 'execute') {
    socket?.emit('sql:setMode', { mode });
  }

  function sqlSetActiveConnection(connectionId: string) {
    socket?.emit('sql:setActiveConnection', { connectionId });
  }

  function sqlAddConnection(config: {
    id: string;
    name: string;
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  }) {
    socket?.emit('sql:addConnection', config);
  }

  function sqlRemoveConnection(connectionId: string) {
    socket?.emit('sql:removeConnection', { connectionId });
  }

  function sqlTestConnection(connectionId: string) {
    socket?.emit('sql:testConnection', { connectionId });
  }

  function sqlRefreshSchema(connectionId: string) {
    socket?.emit('sql:refreshSchema', { connectionId });
  }

  function sqlGetStatus() {
    socket?.emit('sql:getStatus');
  }

  // Personality methods
  function personalitySet(category: string, preset: string) {
    socket?.emit('personality:set', { category, preset });
  }

  function personalityGetStatus() {
    socket?.emit('personality:getStatus');
  }

  // Knowledge methods
  function knowledgeSave(content: string) {
    socket?.emit('knowledge:save', { content });
  }

  function knowledgeGet() {
    socket?.emit('knowledge:get');
  }

  // Session methods
  function sessionSetName(name: string) {
    socket?.emit('session:setName', { name });
  }

  function sessionsGetAll() {
    socket?.emit('sessions:getAll');
  }

  function sessionGetHistory(sessionId: string) {
    socket?.emit('session:getHistory', { sessionId });
  }

  // Register callback for TTS — supports multiple listeners
  function onChatResponse(callback: (text: string) => void) {
    // Avoid duplicates
    if (!chatResponseCallbacks.includes(callback)) {
      chatResponseCallbacks.push(callback);
      console.log(
        '[Socket] TTS callback registered, total:',
        chatResponseCallbacks.length
      );
    }
  }

  // Unregister callback
  function offChatResponse(callback: (text: string) => void) {
    const idx = chatResponseCallbacks.indexOf(callback);
    if (idx !== -1) {
      chatResponseCallbacks.splice(idx, 1);
    }
  }

  return {
    connected,
    connect,
    disconnect,
    chat,
    speak,
    speakingDone,
    stopSpeaking,
    setExpression,
    setGlowColor,
    setSkinColor,
    setDisplayMode,
    clearHistory,
    setOwnerName,
    ragReindex,
    ragGetStatus,
    sqlSetEnabled,
    sqlSetMode,
    sqlSetActiveConnection,
    sqlAddConnection,
    sqlRemoveConnection,
    sqlTestConnection,
    sqlRefreshSchema,
    sqlGetStatus,
    personalitySet,
    personalityGetStatus,
    knowledgeSave,
    knowledgeGet,
    sessionSetName,
    sessionsGetAll,
    sessionGetHistory,
    onChatResponse,
    offChatResponse,
  };
}
