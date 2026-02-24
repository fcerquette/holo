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
    ragStatus,
    ragIndexing,
    sqlStatus,
    sqlRefreshing,
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
  };
});
