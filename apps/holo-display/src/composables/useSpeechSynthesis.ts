import { ref, onMounted } from 'vue';

const voices = ref<SpeechSynthesisVoice[]>([]);
const spanishVoices = ref<SpeechSynthesisVoice[]>([]);
const isSpeaking = ref(false);
const currentUtterance = ref<SpeechSynthesisUtterance | null>(null);

export function useSpeechSynthesis() {
  // Slightly faster + higher pitch = more lively mascot personality
  const rate = ref(1.05);
  const pitch = ref(1.1);
  const selectedVoiceName = ref('');

  function pickBestSpanishVoice(allVoices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
    const spanish = allVoices.filter(v => v.lang.startsWith('es'));
    spanishVoices.value = spanish;

    if (spanish.length === 0) return null;

    // Priority order: best quality first
    // 1. Google online voices (best free quality)
    const googleOnline = spanish.find(v => v.name.toLowerCase().includes('google') && !v.localService);
    if (googleOnline) return googleOnline;

    // 2. Microsoft Online / Neural voices (Edge/Windows)
    const msOnline = spanish.find(v =>
      (v.name.toLowerCase().includes('microsoft') || v.name.toLowerCase().includes('neural'))
      && !v.localService
    );
    if (msOnline) return msOnline;

    // 3. Any non-local (online) Spanish voice — usually better than local
    const anyOnline = spanish.find(v => !v.localService);
    if (anyOnline) return anyOnline;

    // 4. Local voices — prefer ones with "natural" or "enhanced" in name
    const enhanced = spanish.find(v =>
      v.name.toLowerCase().includes('natural') || v.name.toLowerCase().includes('enhanced')
    );
    if (enhanced) return enhanced;

    // 5. Any local Spanish voice as last resort
    return spanish[0];
  }

  function loadVoices() {
    const allVoices = window.speechSynthesis.getVoices();
    voices.value = allVoices;

    // Log ALL available voices for debug
    console.log('[TTS] All voices (' + allVoices.length + '):');
    allVoices
      .filter(v => v.lang.startsWith('es'))
      .forEach(v => console.log(`  [TTS]  ${v.localService ? '💻 LOCAL' : '☁️ ONLINE'} ${v.name} (${v.lang})`));

    if (!selectedVoiceName.value && allVoices.length > 0) {
      const best = pickBestSpanishVoice(allVoices);
      if (best) {
        selectedVoiceName.value = best.name;
        console.log(`[TTS] ✅ Selected: "${best.name}" (${best.lang}) [${best.localService ? 'local' : 'online'}]`);
      } else {
        selectedVoiceName.value = allVoices[0].name;
        console.log('[TTS] ⚠️ No Spanish voice found, using:', allVoices[0].name);
      }
    }
  }

  onMounted(() => {
    loadVoices();
    // Chrome loads voices asynchronously
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
    // Retry loading voices after a short delay (some browsers need this)
    setTimeout(loadVoices, 500);
  });

  function speak(
    text: string,
    onStart?: () => void,
    onEnd?: () => void,
    onBoundary?: (charIndex: number) => void
  ): Promise<void> {
    return new Promise((resolve) => {
      console.log('[TTS] speak() called with:', text);

      // Ensure voices are loaded
      if (voices.value.length === 0) {
        loadVoices();
      }

      // Cancel any ongoing speech
      stop();

      // Chrome bug workaround: resume if paused
      window.speechSynthesis.resume();

      const utterance = new SpeechSynthesisUtterance(text);
      currentUtterance.value = utterance;

      // Set voice
      if (selectedVoiceName.value) {
        const voice = voices.value.find((v) => v.name === selectedVoiceName.value);
        if (voice) {
          utterance.voice = voice;
          console.log('[TTS] Using voice:', voice.name, voice.lang);
        }
      }

      utterance.lang = 'es-AR';
      utterance.rate = rate.value;
      utterance.pitch = pitch.value;
      utterance.volume = 1;

      utterance.onstart = () => {
        console.log('[TTS] Audio started playing');
        isSpeaking.value = true;
        onStart?.();
      };

      utterance.onend = () => {
        console.log('[TTS] Audio finished');
        isSpeaking.value = false;
        currentUtterance.value = null;
        onEnd?.();
        resolve();
      };

      utterance.onerror = (event) => {
        console.error('[TTS] Error:', event.error);
        isSpeaking.value = false;
        currentUtterance.value = null;
        onEnd?.();
        resolve();
      };

      utterance.onboundary = (event) => {
        onBoundary?.(event.charIndex);
      };

      window.speechSynthesis.speak(utterance);
      console.log('[TTS] utterance queued, speechSynthesis.speaking:', window.speechSynthesis.speaking);

      // Mobile Chrome workarounds: speech can get stuck/paused
      // Check multiple times in the first second
      const checkIntervals = [100, 300, 600, 1000, 2000];
      checkIntervals.forEach(delay => {
        setTimeout(() => {
          if (window.speechSynthesis.paused) {
            console.log(`[TTS] Resuming paused speech (after ${delay}ms)`);
            window.speechSynthesis.resume();
          }
          // Detect if utterance never started (mobile issue)
          if (delay >= 2000 && !isSpeaking.value && currentUtterance.value === utterance) {
            console.warn('[TTS] Speech never started after 2s — possible mobile block');
            // Try cancelling and re-speaking
            window.speechSynthesis.cancel();
            setTimeout(() => {
              console.log('[TTS] Retrying speech...');
              window.speechSynthesis.speak(utterance);
            }, 100);
          }
        }, delay);
      });
    });
  }

  function stop() {
    window.speechSynthesis.cancel();
    isSpeaking.value = false;
    currentUtterance.value = null;
  }

  return {
    voices,
    spanishVoices,
    isSpeaking,
    rate,
    pitch,
    selectedVoiceName,
    speak,
    stop,
  };
}
