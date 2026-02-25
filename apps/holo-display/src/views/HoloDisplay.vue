<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useHoloStore } from '../stores/holo';
import { useSocket } from '../composables/useSocket';
import { useSpeechSynthesis } from '../composables/useSpeechSynthesis';
import { useSpeechRecognition } from '../composables/useSpeechRecognition';
import HoloAvatar from '../components/HoloAvatar.vue';

const holo = useHoloStore();
const socket = useSocket();
const tts = useSpeechSynthesis();
const stt = useSpeechRecognition();

// User must click once to unlock audio/mic in the browser
const activated = ref(false);
const micAllowed = ref(false);
const activateError = ref('');

// For 2D mode: keep last response visible
const lastResponse = ref('');

// Owner setup
const ownerNameInput = ref('');

// Session name setup
const sessionNameInput = ref('');

const is2D = computed(() => holo.displayMode === '2d');

async function activate() {
  console.log('[Holo] Activating...');
  console.log('[Holo] Secure context:', window.isSecureContext);

  // Check if we're in a secure context (required for mic access)
  if (!window.isSecureContext) {
    activateError.value = 'Conexión no segura. Necesitás HTTPS con certificado confiable.';
    activated.value = true;
    return;
  }

  // Unlock TTS on mobile — must call speak() during a user gesture
  try {
    const silentUtterance = new SpeechSynthesisUtterance('');
    silentUtterance.volume = 0;
    window.speechSynthesis.speak(silentUtterance);
    console.log('[Holo] TTS unlocked with silent utterance');
  } catch (e) {
    console.warn('[Holo] TTS unlock failed:', e);
  }

  // Request microphone permission
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Stop the stream — we just needed the permission grant
    stream.getTracks().forEach(track => track.stop());
    console.log('[Holo] Microphone permission granted');
    micAllowed.value = true;
  } catch (err: any) {
    console.error('[Holo] Microphone access failed:', err.name, err.message);
    if (err.name === 'NotAllowedError') {
      activateError.value = 'Micrófono bloqueado. Permitilo en la config del navegador.';
    } else if (err.name === 'NotFoundError') {
      activateError.value = 'No se encontró micrófono.';
    } else {
      activateError.value = 'Error de micrófono: ' + err.message;
    }
    // Continue anyway — TTS still works (control panel can send text)
  }

  activated.value = true;

  // Register TTS: when Holo responds, speak and move mouth
  socket.onChatResponse((text) => {
    console.log('[Holo] Response received, speaking:', text);
    lastResponse.value = text;
    // Pause mic while speaking to avoid feedback
    if (micAllowed.value) stt.pause();

    tts.speak(
      text,
      // onStart
      () => {
        console.log('[Holo] TTS started');
        holo.speaking = true;
      },
      // onEnd
      () => {
        console.log('[Holo] TTS ended');
        holo.speaking = false;
        holo.message = '';
        socket.speakingDone();
        // Resume listening after Holo finishes
        if (micAllowed.value) setTimeout(() => stt.resume(), 500);
      }
    );
  });

  // Only start STT if mic permission was granted
  if (micAllowed.value) {
    // Give the browser a moment after releasing the getUserMedia stream
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('[Holo] Starting STT...');
    const started = stt.start((recognizedText) => {
      console.log('[Holo] You said:', recognizedText);
      socket.chat(recognizedText);
    });
    console.log('[Holo] STT started:', started);
  } else {
    console.warn('[Holo] STT not started — mic not available');
  }
}

function submitOwnerName() {
  const name = ownerNameInput.value.trim();
  if (!name) return;
  socket.setOwnerName(name);
  holo.showOwnerSetup = false;
  holo.ownerName = name;
}

function submitSessionName() {
  const name = sessionNameInput.value.trim();
  if (!name) return;
  socket.sessionSetName(name);
  holo.showSessionSetup = false;
  holo.setSessionName(name);
}

onMounted(() => {
  socket.connect();
});

onUnmounted(() => {
  tts.stop();
  stt.stop();
  socket.disconnect();
});
</script>

<template>
  <div class="hologram-container" @click="!activated && activate()">
    <!-- Activate overlay — single tap to unlock audio+mic -->
    <div v-if="!activated" class="activate-overlay">
      <div class="activate-btn">
        <div class="activate-icon">
          <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="#00f0ff" stroke-width="1.5">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
        </div>
        <span class="activate-text">Toca para activar</span>
      </div>
    </div>

    <!-- Owner setup overlay — shown after activation if no owner configured -->
    <div v-if="activated && holo.showOwnerSetup" class="owner-setup-overlay">
      <div class="owner-setup-card">
        <div class="owner-holo-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#00f0ff" stroke-width="1.5">
            <circle cx="12" cy="8" r="4"/>
            <path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/>
          </svg>
        </div>
        <p class="owner-setup-title">Hola! Soy Holo</p>
        <p class="owner-setup-subtitle">Como te llamas?</p>
        <div class="owner-input-row">
          <input
            v-model="ownerNameInput"
            type="text"
            placeholder="Tu nombre..."
            class="owner-input"
            @keyup.enter="submitOwnerName"
            autofocus
          />
          <button class="owner-submit-btn" @click="submitOwnerName" :disabled="!ownerNameInput.trim()">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Session name setup — shown when owner is set but this session has no name -->
    <div v-if="activated && !holo.showOwnerSetup && holo.showSessionSetup" class="owner-setup-overlay">
      <div class="owner-setup-card">
        <div class="owner-holo-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#00f0ff" stroke-width="1.5">
            <circle cx="12" cy="8" r="4"/>
            <path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/>
          </svg>
        </div>
        <p class="owner-setup-title">Hola!</p>
        <p class="owner-setup-subtitle">Como te llamas?</p>
        <div class="owner-input-row">
          <input
            v-model="sessionNameInput"
            type="text"
            placeholder="Tu nombre..."
            class="owner-input"
            @keyup.enter="submitSessionName"
            autofocus
          />
          <button class="owner-submit-btn" @click="submitSessionName" :disabled="!sessionNameInput.trim()">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Error message if mic failed -->
    <div v-if="activated && activateError" class="error-indicator">
      {{ activateError }}
    </div>

    <!-- Listening indicator + debug status -->
    <div v-if="activated && micAllowed" class="listening-indicator">
      <span v-if="stt.isListening.value" class="listening-dot"></span>
      <span class="debug-status">{{ stt.debugStatus.value }}</span>
    </div>

    <!-- Interim transcript (shows what STT is hearing in real-time) -->
    <div v-if="activated && stt.transcript.value" class="transcript-indicator">
      {{ stt.transcript.value }}
    </div>

    <!-- ============ MODE: HOLOGRAM (4 faces for pyramid) ============ -->
    <template v-if="!is2D">
      <div class="face face-top">
        <HoloAvatar
          :speaking="holo.speaking"
          :expression="holo.expression"
          :glow-color="holo.glowColor"
          :skin-color="holo.skinColor"
          :size="280"
        />
      </div>

      <div class="face face-right">
        <HoloAvatar
          :speaking="holo.speaking"
          :expression="holo.expression"
          :glow-color="holo.glowColor"
          :skin-color="holo.skinColor"
          :size="280"
        />
      </div>

      <div class="face face-bottom">
        <HoloAvatar
          :speaking="holo.speaking"
          :expression="holo.expression"
          :glow-color="holo.glowColor"
          :skin-color="holo.skinColor"
          :size="280"
        />
      </div>

      <div class="face face-left">
        <HoloAvatar
          :speaking="holo.speaking"
          :expression="holo.expression"
          :glow-color="holo.glowColor"
          :skin-color="holo.skinColor"
          :size="280"
        />
      </div>
    </template>

    <!-- ============ MODE: 2D (single avatar + subtitles) ============ -->
    <template v-else>
      <div class="mode-2d">
        <HoloAvatar
          :speaking="holo.speaking"
          :expression="holo.expression"
          :glow-color="holo.glowColor"
          :skin-color="holo.skinColor"
          :size="350"
        />

        <!-- Subtitle: Holo's response text -->
        <div v-if="lastResponse" class="subtitle" :class="{ 'subtitle-speaking': holo.speaking }">
          <span class="subtitle-label">Holo:</span>
          {{ lastResponse }}
        </div>
      </div>
    </template>

    <!-- Thinking indicator (both modes) -->
    <div v-if="holo.thinking" class="thinking-indicator">
      <span class="dot"></span>
      <span class="dot"></span>
      <span class="dot"></span>
    </div>
  </div>
</template>

<style scoped>
.hologram-container {
  width: 100vw;
  height: 100vh;
  background: #000;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

/* Activate overlay */
.activate-overlay {
  position: absolute;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.activate-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  animation: activate-pulse 2s ease-in-out infinite;
}

.activate-icon {
  width: 100px;
  height: 100px;
  border-radius: 50%;
  border: 2px solid #00f0ff;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 240, 255, 0.05);
}

.activate-text {
  color: #00f0ff;
  font-size: 1.1rem;
  font-family: monospace;
  letter-spacing: 1px;
}

@keyframes activate-pulse {
  0%, 100% { opacity: 0.7; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.05); }
}

/* Error indicator */
.error-indicator {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  color: #ef4444;
  font-size: 0.8rem;
  font-family: monospace;
  background: rgba(0, 0, 0, 0.8);
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid #ef4444;
  text-align: center;
  max-width: 90%;
}

/* Listening indicator */
.listening-indicator {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 6px;
}

.listening-dot {
  display: block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #ef4444;
  animation: blink 1.5s ease-in-out infinite;
}

.debug-status {
  color: #00f0ff;
  font-size: 0.7rem;
  font-family: monospace;
  opacity: 0.7;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.transcript-indicator {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  color: #facc15;
  font-size: 0.9rem;
  font-family: monospace;
  background: rgba(0, 0, 0, 0.7);
  padding: 6px 16px;
  border-radius: 8px;
  max-width: 80%;
  text-align: center;
  pointer-events: none;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.face {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
}

.face-top {
  top: 2%;
  left: 50%;
  transform: translateX(-50%) rotate(180deg);
}

.face-bottom {
  bottom: 2%;
  left: 50%;
  transform: translateX(-50%);
}

.face-left {
  left: 2%;
  top: 50%;
  transform: translateY(-50%) rotate(90deg);
}

.face-right {
  right: 2%;
  top: 50%;
  transform: translateY(-50%) rotate(-90deg);
}

/* ===== 2D Mode ===== */
.mode-2d {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.5rem;
  max-width: 90%;
}

.subtitle {
  color: #00f0ff;
  font-size: 1.1rem;
  font-family: monospace;
  line-height: 1.5;
  text-align: center;
  background: rgba(0, 240, 255, 0.06);
  border: 1px solid rgba(0, 240, 255, 0.15);
  border-radius: 12px;
  padding: 12px 20px;
  max-width: 100%;
  max-height: 150px;
  overflow-y: auto;
  transition: border-color 0.3s, background 0.3s;
}

.subtitle-speaking {
  border-color: rgba(0, 240, 255, 0.4);
  background: rgba(0, 240, 255, 0.1);
}

.subtitle-label {
  font-weight: bold;
  color: #00f0ff;
  margin-right: 6px;
  opacity: 0.7;
}

.thinking-indicator {
  position: absolute;
  bottom: 40%;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 6px;
  z-index: 10;
}

.thinking-indicator .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #00f0ff;
  animation: thinking-bounce 1.4s ease-in-out infinite;
}

.thinking-indicator .dot:nth-child(2) {
  animation-delay: 0.2s;
}

.thinking-indicator .dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes thinking-bounce {
  0%, 80%, 100% {
    opacity: 0.3;
    transform: scale(0.8);
  }
  40% {
    opacity: 1;
    transform: scale(1.2);
  }
}

/* ===== Owner Setup ===== */
.owner-setup-overlay {
  position: absolute;
  inset: 0;
  z-index: 90;
  background: rgba(0, 0, 0, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fadeIn 0.5s ease;
}

.owner-setup-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 2rem;
  max-width: 320px;
  width: 90%;
}

.owner-holo-icon {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  border: 2px solid #00f0ff;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 240, 255, 0.05);
  animation: activate-pulse 2s ease-in-out infinite;
}

.owner-setup-title {
  color: #00f0ff;
  font-size: 1.4rem;
  font-family: monospace;
  font-weight: bold;
  margin: 0;
}

.owner-setup-subtitle {
  color: #6ee7b7;
  font-size: 1.1rem;
  font-family: monospace;
  margin: 0;
  opacity: 0.9;
}

.owner-input-row {
  display: flex;
  gap: 0.5rem;
  width: 100%;
  margin-top: 0.5rem;
}

.owner-input {
  flex: 1;
  background: rgba(0, 240, 255, 0.08);
  border: 1px solid rgba(0, 240, 255, 0.3);
  border-radius: 10px;
  padding: 10px 14px;
  color: #e5e7eb;
  font-size: 1rem;
  font-family: monospace;
  outline: none;
  transition: border-color 0.2s;
}

.owner-input:focus {
  border-color: #00f0ff;
}

.owner-input::placeholder {
  color: rgba(0, 240, 255, 0.3);
}

.owner-submit-btn {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  border: 1px solid #00f0ff;
  background: rgba(0, 240, 255, 0.1);
  color: #00f0ff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.owner-submit-btn:hover:not(:disabled) {
  background: rgba(0, 240, 255, 0.2);
}

.owner-submit-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
</style>
