import { defineStore } from 'pinia';
import { ref } from 'vue';

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

export interface RagStatus {
  available: boolean;
  ollamaConnected: boolean;
  documentCount: number;
  chunkCount: number;
  indexedFiles: string[];
  lastIndexed: number | null;
}

export interface SqlConnectionStatus {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  user: string;
  connected: boolean;
  error?: string;
}

export interface SqlStatus {
  enabled: boolean;
  mode: 'query-only' | 'execute';
  connections: SqlConnectionStatus[];
  activeConnectionId: string | null;
  schemaLoaded: boolean;
}

export type HoloExpression = 'neutral' | 'happy' | 'surprised' | 'sad' | 'angry' | 'embarrassed';

export interface PersonalityStatus {
  category: 'empresarial' | 'cotidiano';
  preset: 'formal' | 'informal' | 'standard' | 'nino' | 'adulto-mayor';
}

export interface SessionInfo {
  id: string;
  name: string;
  lastActive: number;
  connected: boolean;
  messageCount: number;
}

export const useHoloStore = defineStore('holo', () => {
  const speaking = ref(false);
  const thinking = ref(false);
  const expression = ref<HoloExpression>('neutral');
  const glowColor = ref('#00f0ff');
  const skinColor = ref('#1a1a2e');
  const message = ref('');
  const chatHistory = ref<ChatMessage[]>([]);
  const displayMode = ref<'hologram' | '2d'>('2d');

  // Owner
  const ownerName = ref('');
  const showOwnerSetup = ref(false);

  // Session
  const sessionId = ref('');
  const sessionName = ref('');
  const showSessionSetup = ref(false);
  const sessions = ref<SessionInfo[]>([]);
  const viewingSessionId = ref('');
  const viewingSessionHistory = ref<ChatMessage[]>([]);
  const viewingSessionName = ref('');

  // RAG
  const ragStatus = ref<RagStatus>({
    available: false,
    ollamaConnected: false,
    documentCount: 0,
    chunkCount: 0,
    indexedFiles: [],
    lastIndexed: null,
  });
  const ragIndexing = ref(false);

  // SQL
  const sqlStatus = ref<SqlStatus>({
    enabled: false,
    mode: 'query-only',
    connections: [],
    activeConnectionId: null,
    schemaLoaded: false,
  });
  const sqlRefreshing = ref(false);

  // Knowledge
  const knowledgeContent = ref('');
  const knowledgeChunkCount = ref(0);

  function addChatMessage(role: 'user' | 'assistant', text: string) {
    chatHistory.value.push({ role, text, timestamp: Date.now() });
    // Keep last 50 messages
    if (chatHistory.value.length > 50) {
      chatHistory.value = chatHistory.value.slice(-50);
    }
  }

  /** Replace chat history with persisted messages from server */
  function loadChatHistory(messages: ChatMessage[]) {
    chatHistory.value = messages;
  }

  // Personality
  const personalityStatus = ref<PersonalityStatus>({
    category: 'cotidiano',
    preset: 'standard',
  });

  function setExpression(expr: HoloExpression) {
    expression.value = expr;
  }

  function updatePersonality(status: PersonalityStatus) {
    personalityStatus.value = status;
  }

  function setGlowColor(color: string) {
    glowColor.value = color;
  }

  function setSkinColor(color: string) {
    skinColor.value = color;
  }

  function stopSpeaking() {
    speaking.value = false;
    message.value = '';
  }

  function clearChat() {
    chatHistory.value = [];
  }

  function updateRagStatus(status: RagStatus) {
    ragStatus.value = status;
  }

  function setRagIndexing(indexing: boolean) {
    ragIndexing.value = indexing;
  }

  function updateSqlStatus(status: SqlStatus) {
    sqlStatus.value = status;
  }

  function setSqlRefreshing(refreshing: boolean) {
    sqlRefreshing.value = refreshing;
  }

  function updateKnowledgeContent(content: string) {
    knowledgeContent.value = content;
  }

  function updateKnowledgeStatus(status: { chunkCount: number }) {
    knowledgeChunkCount.value = status.chunkCount;
  }

  function setSessionId(id: string) {
    sessionId.value = id;
  }

  function setSessionName(name: string) {
    sessionName.value = name;
  }

  function updateSessions(list: SessionInfo[]) {
    sessions.value = list;
  }

  function setViewingSession(id: string, name: string, messages: ChatMessage[]) {
    viewingSessionId.value = id;
    viewingSessionName.value = name;
    viewingSessionHistory.value = messages;
  }

  function clearViewingSession() {
    viewingSessionId.value = '';
    viewingSessionName.value = '';
    viewingSessionHistory.value = [];
  }

  return {
    speaking,
    thinking,
    expression,
    glowColor,
    skinColor,
    message,
    chatHistory,
    displayMode,
    ownerName,
    showOwnerSetup,
    sessionId,
    sessionName,
    showSessionSetup,
    sessions,
    viewingSessionId,
    viewingSessionHistory,
    viewingSessionName,
    ragStatus,
    ragIndexing,
    sqlStatus,
    sqlRefreshing,
    knowledgeContent,
    knowledgeChunkCount,
    personalityStatus,
    addChatMessage,
    loadChatHistory,
    setExpression,
    updatePersonality,
    setGlowColor,
    setSkinColor,
    stopSpeaking,
    clearChat,
    updateRagStatus,
    setRagIndexing,
    updateSqlStatus,
    setSqlRefreshing,
    updateKnowledgeContent,
    updateKnowledgeStatus,
    setSessionId,
    setSessionName,
    updateSessions,
    setViewingSession,
    clearViewingSession,
  };
});
