import { ref } from 'vue';

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

const isListening = ref(false);
const transcript = ref('');
const debugStatus = ref('idle');

export function useSpeechRecognition() {
  let recognition: any = null;
  let onResultCallback: ((text: string) => void) | null = null;
  let shouldAutoRestart = false;
  let currentLang = 'es-AR';
  let restartCount = 0;

  function isSupported(): boolean {
    return !!(
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition
    );
  }

  function startRecognition() {
    // Always create a FRESH instance — reusing old ones causes issues in Chrome
    if (recognition) {
      try { recognition.abort(); } catch {}
      recognition = null;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    const rec = new SpeechRecognition();
    rec.lang = currentLang;
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      isListening.value = true;
      debugStatus.value = 'listening';
      console.log('[STT] Listening... (restart #' + restartCount + ')');
    };

    rec.onaudiostart = () => {
      debugStatus.value = 'audio-active';
      console.log('[STT] Audio capture started — mic is active');
    };

    rec.onsoundstart = () => {
      debugStatus.value = 'sound-detected';
      console.log('[STT] Sound detected');
    };

    rec.onspeechstart = () => {
      debugStatus.value = 'speech-detected';
      console.log('[STT] Speech detected!');
    };

    rec.onspeechend = () => {
      debugStatus.value = 'speech-ended';
      console.log('[STT] Speech ended');
    };

    rec.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimTranscript += result[0].transcript;
        }
      }

      if (interimTranscript) {
        transcript.value = interimTranscript;
        debugStatus.value = 'hearing: ' + interimTranscript;
        console.log('[STT] Interim:', interimTranscript);
      }

      if (finalTranscript) {
        transcript.value = finalTranscript;
        debugStatus.value = 'final: ' + finalTranscript.trim();
        console.log('[STT] Final:', finalTranscript.trim());
        onResultCallback?.(finalTranscript.trim());
      }
    };

    rec.onerror = (event: any) => {
      console.warn('[STT] Error:', event.error, '(restart #' + restartCount + ')');
      debugStatus.value = 'error: ' + event.error;

      // no-speech and aborted are normal — just let onend handle restart
      if (event.error === 'no-speech' || event.error === 'aborted') {
        return;
      }

      // not-allowed = permission denied or insecure context → STOP retrying
      if (event.error === 'not-allowed') {
        console.error('[STT] Mic access denied. Stopping auto-restart.');
        shouldAutoRestart = false;
        debugStatus.value = 'mic-blocked';
        isListening.value = false;
        return;
      }

      // For other errors, mark as not listening (onend will still auto-restart)
      isListening.value = false;
    };

    rec.onend = () => {
      isListening.value = false;
      console.log('[STT] Ended. Auto-restart:', shouldAutoRestart);

      if (shouldAutoRestart) {
        restartCount++;
        debugStatus.value = 'restarting...';
        // Create a FRESH instance on restart — this is key for Chrome
        setTimeout(() => {
          if (shouldAutoRestart) {
            startRecognition();
          }
        }, 200);
      } else {
        debugStatus.value = 'stopped';
      }
    };

    recognition = rec;

    try {
      rec.start();
    } catch (e) {
      console.error('[STT] Failed to start recognition:', e);
      debugStatus.value = 'start-failed';
      // Retry once after a delay
      setTimeout(() => {
        if (shouldAutoRestart) {
          startRecognition();
        }
      }, 1000);
    }
  }

  function start(onResult: (text: string) => void, lang = 'es-AR'): boolean {
    if (!isSupported()) {
      console.error('[STT] Not supported in this browser');
      debugStatus.value = 'not-supported';
      return false;
    }

    onResultCallback = onResult;
    currentLang = lang;
    shouldAutoRestart = true;
    restartCount = 0;

    console.log('[STT] Starting with lang:', lang);
    startRecognition();
    return true;
  }

  function stop() {
    shouldAutoRestart = false;
    if (recognition) {
      try { recognition.abort(); } catch {}
      recognition = null;
    }
    isListening.value = false;
    debugStatus.value = 'stopped';
  }

  function pause() {
    shouldAutoRestart = false;
    if (recognition) {
      try { recognition.abort(); } catch {}
      recognition = null;
    }
    isListening.value = false;
    debugStatus.value = 'paused';
    console.log('[STT] Paused');
  }

  function resume() {
    if (!onResultCallback) return;
    shouldAutoRestart = true;
    console.log('[STT] Resuming...');
    startRecognition();
  }

  return {
    isListening,
    transcript,
    debugStatus,
    isSupported,
    start,
    stop,
    pause,
    resume,
  };
}
