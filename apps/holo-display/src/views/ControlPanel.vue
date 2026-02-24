<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { useHoloStore } from '../stores/holo';
import { useSocket } from '../composables/useSocket';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import ColorPicker from 'primevue/colorpicker';
import ToggleSwitch from 'primevue/toggleswitch';
import Password from 'primevue/password';
import Tabs from 'primevue/tabs';
import TabList from 'primevue/tablist';
import Tab from 'primevue/tab';
import TabPanels from 'primevue/tabpanels';
import TabPanel from 'primevue/tabpanel';

const holo = useHoloStore();
const socket = useSocket();

const textToSend = ref('');
const chatContainer = ref<HTMLElement | null>(null);

onMounted(() => {
  socket.connect();
});

onUnmounted(() => {
  socket.disconnect();
});

// Auto-scroll chat to bottom
watch(
  () => holo.chatHistory.length,
  async () => {
    await nextTick();
    if (chatContainer.value) {
      chatContainer.value.scrollTop = chatContainer.value.scrollHeight;
    }
  }
);

const expressions = [
  { label: 'Neutral', value: 'neutral' },
  { label: 'Feliz', value: 'happy' },
  { label: 'Sorprendido', value: 'surprised' },
  { label: 'Triste', value: 'sad' },
  { label: 'Enojado', value: 'angry' },
  { label: 'Avergonzado', value: 'embarrassed' },
];

const selectedExpression = ref(expressions[0]);

function handleSend() {
  const text = textToSend.value.trim();
  if (!text) return;
  socket.chat(text);
  textToSend.value = '';
}

function handleExpressionChange() {
  socket.setExpression(selectedExpression.value.value);
}

function onGlowColorChange(color: string) {
  socket.setGlowColor(`#${color}`);
}

function onSkinColorChange(color: string) {
  socket.setSkinColor(`#${color}`);
}

// ── SQL Agent ────────────────────────────────────────────

const showAddSqlConnection = ref(false);
const newSqlConn = ref({
  name: '',
  host: 'localhost',
  port: '5432',
  database: '',
  user: '',
  password: '',
});

function handleSqlToggle(value: boolean) {
  socket.sqlSetEnabled(value);
}

function handleSqlModeChange(mode: 'query-only' | 'execute') {
  socket.sqlSetMode(mode);
}

function handleSqlActiveChange(event: { value: string }) {
  socket.sqlSetActiveConnection(event.value);
}

function handleAddSqlConnection() {
  const name = newSqlConn.value.name.trim();
  if (!name || !newSqlConn.value.database.trim()) return;

  socket.sqlAddConnection({
    id: `conn-${Date.now()}`,
    name,
    host: newSqlConn.value.host || 'localhost',
    port: parseInt(newSqlConn.value.port) || 5432,
    database: newSqlConn.value.database,
    user: newSqlConn.value.user,
    password: newSqlConn.value.password,
  });

  showAddSqlConnection.value = false;
  newSqlConn.value = {
    name: '',
    host: 'localhost',
    port: '5432',
    database: '',
    user: '',
    password: '',
  };
}
</script>

<template>
  <div class="control-panel dark-mode">
    <div class="panel-header">
      <h1 class="text-2xl font-bold text-cyan-400">
        <i class="pi pi-cog mr-2"></i>
        Holo Control
      </h1>
      <div class="flex items-center gap-2 mt-1">
        <span
          class="inline-block w-2 h-2 rounded-full"
          :class="socket.connected.value ? 'bg-green-400' : 'bg-red-400'"
        ></span>
        <p class="text-gray-400 text-sm">
          {{ socket.connected.value ? 'Conectado' : 'Desconectado' }}
        </p>
      </div>
    </div>

    <Tabs value="0" class="holo-tabs">
      <TabList>
        <Tab value="0"><i class="pi pi-palette mr-1"></i> Apariencia</Tab>
        <Tab value="1"><i class="pi pi-comments mr-1"></i> Chat</Tab>
        <Tab value="2"><i class="pi pi-cog mr-1"></i> Config</Tab>
        <Tab value="3"><i class="pi pi-user mr-1"></i> Personalidad</Tab>
      </TabList>

      <TabPanels>
        <!-- ═══════════════════════════════════════════════ -->
        <!-- TAB 1: Apariencia                              -->
        <!-- ═══════════════════════════════════════════════ -->
        <TabPanel value="0">
          <div class="panel-content">
            <!-- Display Mode toggle -->
            <div class="section">
              <h2 class="section-title">
                <i class="pi pi-desktop mr-2"></i> Modo de vista
              </h2>
              <div class="mode-toggle">
                <button
                  class="mode-btn"
                  :class="{ active: holo.displayMode === 'hologram' }"
                  @click="socket.setDisplayMode('hologram')"
                >
                  <i class="pi pi-th-large mr-1"></i>
                  Holografico
                </button>
                <button
                  class="mode-btn"
                  :class="{ active: holo.displayMode === '2d' }"
                  @click="socket.setDisplayMode('2d')"
                >
                  <i class="pi pi-user mr-1"></i>
                  2D
                </button>
              </div>
            </div>

            <!-- Expression section -->
            <div class="section">
              <h2 class="section-title">
                <i class="pi pi-face-smile mr-2"></i> Expresion (manual)
              </h2>
              <Select
                v-model="selectedExpression"
                :options="expressions"
                optionLabel="label"
                class="w-full"
                @change="handleExpressionChange"
              />
              <p class="text-xs text-gray-500 mt-2">
                Se ajusta sola durante el chat, o cambiala aca
              </p>
            </div>

            <!-- Colors section -->
            <div class="section">
              <h2 class="section-title">
                <i class="pi pi-palette mr-2"></i> Colores
              </h2>
              <div class="color-row">
                <span class="text-gray-300">Glow:</span>
                <ColorPicker
                  :modelValue="holo.glowColor.replace('#', '')"
                  @update:modelValue="onGlowColorChange"
                />
                <span class="text-xs text-gray-500">{{ holo.glowColor }}</span>
              </div>
              <div class="color-row mt-3">
                <span class="text-gray-300">Skin:</span>
                <ColorPicker
                  :modelValue="holo.skinColor.replace('#', '')"
                  @update:modelValue="onSkinColorChange"
                />
                <span class="text-xs text-gray-500">{{ holo.skinColor }}</span>
              </div>
            </div>

            <!-- Quick presets -->
            <div class="section">
              <h2 class="section-title">
                <i class="pi pi-bolt mr-2"></i> Presets
              </h2>
              <div class="flex flex-wrap gap-2">
                <Button label="Cyan" size="small" severity="info" @click="socket.setGlowColor('#00f0ff')" />
                <Button label="Verde" size="small" severity="success" @click="socket.setGlowColor('#00ff88')" />
                <Button label="Rosa" size="small" severity="help" @click="socket.setGlowColor('#ff00ff')" />
                <Button label="Naranja" size="small" severity="warn" @click="socket.setGlowColor('#ff8800')" />
                <Button label="Rojo" size="small" severity="danger" @click="socket.setGlowColor('#ff2222')" />
              </div>
            </div>
          </div>
        </TabPanel>

        <!-- ═══════════════════════════════════════════════ -->
        <!-- TAB 2: Chat                                    -->
        <!-- ═══════════════════════════════════════════════ -->
        <TabPanel value="1">
          <div class="panel-content">
            <!-- Chat section -->
            <div class="section chat-section">
              <h2 class="section-title">
                <i class="pi pi-comments mr-2"></i> Chat
              </h2>

              <!-- Chat messages -->
              <div ref="chatContainer" class="chat-messages">
                <div v-if="holo.chatHistory.length === 0" class="text-gray-500 text-sm text-center py-4">
                  Escribi algo o apreta el microfono para hablar con Holo
                </div>
                <div
                  v-for="(msg, i) in holo.chatHistory"
                  :key="i"
                  class="chat-bubble"
                  :class="msg.role === 'user' ? 'chat-user' : 'chat-assistant'"
                >
                  <span class="chat-role">{{ msg.role === 'user' ? 'Vos' : 'Holo' }}</span>
                  <p>{{ msg.text }}</p>
                </div>
                <div v-if="holo.thinking" class="chat-bubble chat-assistant thinking">
                  <span class="chat-role">Holo</span>
                  <p class="animate-pulse">Pensando...</p>
                </div>
              </div>

              <!-- Input row -->
              <div class="chat-input-row">
                <InputText
                  v-model="textToSend"
                  placeholder="Escribi un mensaje..."
                  class="flex-1"
                  @keyup.enter="handleSend"
                />
                <Button
                  icon="pi pi-send"
                  @click="handleSend"
                  :disabled="!textToSend.trim() || holo.thinking"
                />
              </div>
            </div>

            <!-- Actions -->
            <div class="section">
              <h2 class="section-title">
                <i class="pi pi-sliders-h mr-2"></i> Acciones
              </h2>
              <div class="flex gap-2">
                <Button
                  label="Limpiar chat"
                  icon="pi pi-trash"
                  size="small"
                  severity="secondary"
                  @click="socket.clearHistory()"
                />
                <Button
                  v-if="holo.speaking"
                  label="Parar"
                  icon="pi pi-stop"
                  size="small"
                  severity="danger"
                  @click="socket.stopSpeaking()"
                />
              </div>
            </div>
          </div>
        </TabPanel>

        <!-- ═══════════════════════════════════════════════ -->
        <!-- TAB 3: Configuracion                           -->
        <!-- ═══════════════════════════════════════════════ -->
        <TabPanel value="2">
          <div class="panel-content">
            <!-- Base de Conocimiento (RAG) -->
            <div class="section">
              <h2 class="section-title">
                <i class="pi pi-database mr-2"></i> Base de Conocimiento
              </h2>

              <!-- Status indicator -->
              <div class="flex items-center gap-2 mb-3">
                <span
                  class="inline-block w-2 h-2 rounded-full"
                  :class="holo.ragStatus.available ? 'bg-green-400' : 'bg-yellow-500'"
                ></span>
                <span class="text-sm text-gray-300">
                  {{ holo.ragStatus.available ? 'RAG activo' : 'RAG inactivo' }}
                </span>
              </div>

              <!-- Stats when available -->
              <div v-if="holo.ragStatus.available" class="text-sm text-gray-400 mb-3 space-y-1">
                <p>
                  <i class="pi pi-file mr-1"></i>
                  {{ holo.ragStatus.documentCount }} archivo(s) indexado(s)
                </p>
                <p>
                  <i class="pi pi-list mr-1"></i>
                  {{ holo.ragStatus.chunkCount }} fragmentos en memoria
                </p>
              </div>

              <!-- Info when Ollama not connected -->
              <div v-if="!holo.ragStatus.ollamaConnected" class="text-sm text-gray-500 mb-3">
                <p>Ollama no detectado. Para activar RAG:</p>
                <code class="block text-xs text-cyan-400 mt-1 bg-gray-800 p-2 rounded">
                  ollama serve<br />
                  ollama pull nomic-embed-text
                </code>
              </div>

              <!-- Info when connected but no docs -->
              <div v-else-if="!holo.ragStatus.available && holo.ragStatus.documentCount === 0" class="text-sm text-gray-500 mb-3">
                <p>No hay documentos indexados.</p>
              </div>

              <!-- Actions -->
              <div class="flex gap-2 flex-wrap">
                <Button
                  label="Re-indexar"
                  icon="pi pi-refresh"
                  size="small"
                  severity="info"
                  :loading="holo.ragIndexing"
                  :disabled="holo.ragIndexing"
                  @click="socket.ragReindex()"
                />
              </div>

              <!-- Info text -->
              <p class="text-xs text-gray-600 mt-3">
                Archivos .txt o .md en
                <code class="text-cyan-500">apps/holo-api/knowledge/</code>
              </p>
            </div>

            <!-- Agent SQL -->
            <div class="section">
              <h2 class="section-title">
                <i class="pi pi-server mr-2"></i> Agent SQL
              </h2>

              <!-- Toggle activar/desactivar -->
              <div class="flex items-center justify-between mb-3">
                <span class="text-sm text-gray-300">Habilitado</span>
                <ToggleSwitch
                  :modelValue="holo.sqlStatus.enabled"
                  @update:modelValue="handleSqlToggle"
                />
              </div>

              <!-- Contenido cuando esta habilitado -->
              <div v-if="holo.sqlStatus.enabled">

                <!-- Toggle modo -->
                <div class="mb-3">
                  <span class="text-xs text-gray-400 block mb-1">Modo</span>
                  <div class="mode-toggle">
                    <button
                      class="mode-btn"
                      :class="{ active: holo.sqlStatus.mode === 'query-only' }"
                      @click="handleSqlModeChange('query-only')"
                    >
                      <i class="pi pi-code mr-1"></i>
                      Solo SQL
                    </button>
                    <button
                      class="mode-btn"
                      :class="{ active: holo.sqlStatus.mode === 'execute' }"
                      @click="handleSqlModeChange('execute')"
                    >
                      <i class="pi pi-play mr-1"></i>
                      Ejecutar
                    </button>
                  </div>
                  <p class="text-xs mt-1" :class="holo.sqlStatus.mode === 'execute' ? 'text-yellow-500' : 'text-gray-500'">
                    {{
                      holo.sqlStatus.mode === 'query-only'
                        ? 'Holo genera el SQL pero NO lo ejecuta'
                        : 'Holo ejecuta el query - los datos viajan a Groq'
                    }}
                  </p>
                </div>

                <!-- Conexion activa -->
                <div v-if="holo.sqlStatus.connections.length > 0" class="mb-3">
                  <span class="text-xs text-gray-400 block mb-1">Base de datos activa</span>
                  <Select
                    :modelValue="holo.sqlStatus.activeConnectionId"
                    :options="holo.sqlStatus.connections"
                    optionLabel="name"
                    optionValue="id"
                    placeholder="Seleccionar BD..."
                    class="w-full"
                    @change="handleSqlActiveChange"
                  />
                </div>

                <!-- Schema loaded indicator -->
                <div v-if="holo.sqlStatus.activeConnectionId" class="flex items-center gap-2 mb-3">
                  <span
                    class="inline-block w-2 h-2 rounded-full"
                    :class="holo.sqlStatus.schemaLoaded ? 'bg-green-400' : 'bg-yellow-500'"
                  ></span>
                  <span class="text-xs text-gray-400">
                    {{ holo.sqlStatus.schemaLoaded ? 'Esquema cargado' : 'Esquema no disponible' }}
                  </span>
                </div>

                <!-- Lista de conexiones -->
                <div class="mb-3">
                  <span class="text-xs text-gray-400 block mb-2">Conexiones</span>
                  <div
                    v-for="conn in holo.sqlStatus.connections"
                    :key="conn.id"
                    class="sql-conn-item"
                  >
                    <div class="flex items-center gap-2 flex-1 min-w-0">
                      <span
                        class="inline-block w-2 h-2 rounded-full flex-shrink-0"
                        :class="conn.connected ? 'bg-green-400' : 'bg-red-400'"
                      ></span>
                      <div class="min-w-0">
                        <span class="text-sm text-gray-300 block truncate">{{ conn.name }}</span>
                        <span class="text-xs text-gray-500 block truncate">
                          {{ conn.host }}:{{ conn.port }}/{{ conn.database }}
                        </span>
                      </div>
                    </div>
                    <div class="flex gap-1 flex-shrink-0">
                      <Button
                        icon="pi pi-refresh"
                        size="small"
                        text
                        :loading="holo.sqlRefreshing"
                        @click="socket.sqlRefreshSchema(conn.id)"
                      />
                      <Button
                        icon="pi pi-trash"
                        size="small"
                        text
                        severity="danger"
                        @click="socket.sqlRemoveConnection(conn.id)"
                      />
                    </div>
                  </div>
                  <div
                    v-if="holo.sqlStatus.connections.length === 0"
                    class="text-sm text-gray-500"
                  >
                    No hay conexiones configuradas
                  </div>
                </div>

                <!-- Boton agregar conexion -->
                <Button
                  :label="showAddSqlConnection ? 'Cancelar' : 'Agregar conexion'"
                  :icon="showAddSqlConnection ? 'pi pi-times' : 'pi pi-plus'"
                  size="small"
                  :severity="showAddSqlConnection ? 'secondary' : 'info'"
                  @click="showAddSqlConnection = !showAddSqlConnection"
                />

                <!-- Formulario agregar conexion -->
                <div v-if="showAddSqlConnection" class="sql-form mt-3">
                  <InputText
                    v-model="newSqlConn.name"
                    placeholder="Nombre (ej: mi-erp)"
                    class="w-full"
                  />
                  <div class="flex gap-2">
                    <InputText
                      v-model="newSqlConn.host"
                      placeholder="Host"
                      class="flex-1"
                    />
                    <InputText
                      v-model="newSqlConn.port"
                      placeholder="Puerto"
                      class="w-20"
                    />
                  </div>
                  <InputText
                    v-model="newSqlConn.database"
                    placeholder="Base de datos"
                    class="w-full"
                  />
                  <InputText
                    v-model="newSqlConn.user"
                    placeholder="Usuario"
                    class="w-full"
                  />
                  <Password
                    v-model="newSqlConn.password"
                    placeholder="Contrasena"
                    class="w-full"
                    :feedback="false"
                    toggleMask
                  />
                  <Button
                    label="Conectar"
                    icon="pi pi-link"
                    size="small"
                    severity="success"
                    :disabled="!newSqlConn.name.trim() || !newSqlConn.database.trim()"
                    @click="handleAddSqlConnection"
                  />
                </div>
              </div>

              <!-- Info cuando esta desactivado -->
              <p v-else class="text-xs text-gray-600">
                Activa Agent SQL para que Holo consulte bases de datos PostgreSQL.
              </p>
            </div>
          </div>
        </TabPanel>
        <!-- ═══════════════════════════════════════════════ -->
        <!-- TAB 4: Personalidad                            -->
        <!-- ═══════════════════════════════════════════════ -->
        <TabPanel value="3">
          <div class="panel-content">
            <!-- Empresarial -->
            <div class="section">
              <h2 class="section-title">
                <i class="pi pi-briefcase mr-2"></i> Empresarial
              </h2>
              <div class="personality-grid">
                <button
                  class="personality-btn"
                  :class="{ active: holo.personalityStatus.category === 'empresarial' && holo.personalityStatus.preset === 'formal' }"
                  @click="socket.personalitySet('empresarial', 'formal')"
                >
                  <i class="pi pi-building mr-1"></i>
                  Formal
                  <span class="personality-desc">Usted, profesional, conciso</span>
                </button>
                <button
                  class="personality-btn"
                  :class="{ active: holo.personalityStatus.category === 'empresarial' && holo.personalityStatus.preset === 'informal' }"
                  @click="socket.personalitySet('empresarial', 'informal')"
                >
                  <i class="pi pi-users mr-1"></i>
                  Informal
                  <span class="personality-desc">Cercano, amable, tutea</span>
                </button>
              </div>
            </div>

            <!-- Cotidiano -->
            <div class="section">
              <h2 class="section-title">
                <i class="pi pi-home mr-2"></i> Cotidiano
              </h2>
              <div class="personality-grid">
                <button
                  class="personality-btn"
                  :class="{ active: holo.personalityStatus.category === 'cotidiano' && holo.personalityStatus.preset === 'standard' }"
                  @click="socket.personalitySet('cotidiano', 'standard')"
                >
                  <i class="pi pi-star mr-1"></i>
                  Standard
                  <span class="personality-desc">Mascota argentina copada</span>
                </button>
                <button
                  class="personality-btn"
                  :class="{ active: holo.personalityStatus.category === 'cotidiano' && holo.personalityStatus.preset === 'nino' }"
                  @click="socket.personalitySet('cotidiano', 'nino')"
                >
                  <i class="pi pi-face-smile mr-1"></i>
                  Niño
                  <span class="personality-desc">Simple, divertido, entusiasta</span>
                </button>
                <button
                  class="personality-btn"
                  :class="{ active: holo.personalityStatus.category === 'cotidiano' && holo.personalityStatus.preset === 'adulto-mayor' }"
                  @click="socket.personalitySet('cotidiano', 'adulto-mayor')"
                >
                  <i class="pi pi-heart mr-1"></i>
                  Adulto Mayor
                  <span class="personality-desc">Paciente, claro, respetuoso</span>
                </button>
              </div>
            </div>

            <!-- Info -->
            <div class="section">
              <p class="text-xs text-gray-500">
                <i class="pi pi-info-circle mr-1"></i>
                La expresion de Holo se ajusta automaticamente segun la conversacion.
                Tambien podes cambiarla manualmente en la pestaña Apariencia.
              </p>
            </div>
          </div>
        </TabPanel>
      </TabPanels>
    </Tabs>
  </div>
</template>

<style scoped>
.control-panel {
  min-height: 100vh;
  background: #111827;
  padding: 1.5rem;
  color: #e5e7eb;
}

.panel-header {
  padding-bottom: 1rem;
  border-bottom: 1px solid #374151;
  margin-bottom: 1rem;
}

.panel-content {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  max-width: 500px;
  padding-top: 1rem;
}

.section {
  background: #1f2937;
  border-radius: 0.75rem;
  padding: 1.25rem;
  border: 1px solid #374151;
}

.section-title {
  font-size: 1rem;
  font-weight: 600;
  color: #9ca3af;
  margin-bottom: 0.75rem;
  display: flex;
  align-items: center;
}

.color-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

/* Mode toggle */
.mode-toggle {
  display: flex;
  gap: 0;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #374151;
}

.mode-btn {
  flex: 1;
  padding: 0.6rem 1rem;
  font-size: 0.85rem;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: all 0.2s;
  background: #111827;
  color: #6b7280;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mode-btn:first-child {
  border-right: 1px solid #374151;
}

.mode-btn.active {
  background: rgba(0, 240, 255, 0.1);
  color: #00f0ff;
  font-weight: 600;
}

.mode-btn:hover:not(.active) {
  background: #1f2937;
  color: #9ca3af;
}

/* Chat styles */
.chat-section {
  display: flex;
  flex-direction: column;
}

.chat-messages {
  max-height: 400px;
  overflow-y: auto;
  margin-bottom: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-right: 0.25rem;
}

.chat-messages::-webkit-scrollbar {
  width: 4px;
}

.chat-messages::-webkit-scrollbar-thumb {
  background: #374151;
  border-radius: 4px;
}

.chat-bubble {
  padding: 0.5rem 0.75rem;
  border-radius: 0.75rem;
  max-width: 85%;
  font-size: 0.875rem;
}

.chat-bubble p {
  margin: 0;
}

.chat-role {
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  opacity: 0.6;
  display: block;
  margin-bottom: 2px;
}

.chat-user {
  background: #1e3a5f;
  color: #93c5fd;
  align-self: flex-end;
  border-bottom-right-radius: 4px;
}

.chat-assistant {
  background: #1a3a2e;
  color: #6ee7b7;
  align-self: flex-start;
  border-bottom-left-radius: 4px;
}

.chat-assistant.thinking {
  opacity: 0.6;
}

.chat-input-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.mic-active {
  animation: mic-pulse 1.5s ease-in-out infinite;
}

@keyframes mic-pulse {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4);
  }
  50% {
    box-shadow: 0 0 0 8px rgba(239, 68, 68, 0);
  }
}

/* SQL Agent styles */
.sql-conn-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0;
  border-bottom: 1px solid #374151;
}

.sql-conn-item:last-child {
  border-bottom: none;
}

.sql-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

/* Tabs dark theme overrides */
.holo-tabs :deep(.p-tablist) {
  background: transparent;
  border-bottom: 1px solid #374151;
}

.holo-tabs :deep(.p-tab) {
  background: transparent;
  color: #6b7280;
  border: none;
  padding: 0.75rem 1rem;
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.2s;
}

.holo-tabs :deep(.p-tab:hover) {
  color: #9ca3af;
}

.holo-tabs :deep(.p-tab-active) {
  color: #00f0ff !important;
  border-bottom: 2px solid #00f0ff;
}

.holo-tabs :deep(.p-tabpanels) {
  background: transparent;
  padding: 0;
}

.holo-tabs :deep(.p-tabpanel) {
  padding: 0;
}

/* Personality styles */
.personality-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.personality-btn {
  flex: 1 1 calc(50% - 0.25rem);
  min-width: 120px;
  padding: 0.75rem;
  background: #111827;
  border: 1px solid #374151;
  border-radius: 8px;
  color: #6b7280;
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.875rem;
  font-weight: 500;
}

.personality-btn:hover:not(.active) {
  background: #1f2937;
  color: #9ca3af;
  border-color: #4b5563;
}

.personality-btn.active {
  background: rgba(0, 240, 255, 0.08);
  color: #00f0ff;
  border-color: #00f0ff;
  font-weight: 600;
}

.personality-desc {
  font-size: 0.7rem;
  font-weight: 400;
  opacity: 0.6;
}
</style>
