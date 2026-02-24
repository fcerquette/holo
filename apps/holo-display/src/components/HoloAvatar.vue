<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';

import type { HoloExpression } from '../stores/holo';

const props = withDefaults(
  defineProps<{
    speaking?: boolean;
    expression?: HoloExpression;
    glowColor?: string;
    skinColor?: string;
    size?: number;
  }>(),
  {
    speaking: false,
    expression: 'neutral',
    glowColor: '#00f0ff',
    skinColor: '#1a1a2e',
    size: 200,
  }
);

const mouthOpen = ref(0);
const blinking = ref(false);
const pupilOffsetX = ref(0);
const pupilOffsetY = ref(0);
const headSwayX = ref(0);
const headSwayY = ref(0);
const breathScale = ref(1);

let speakInterval: ReturnType<typeof setInterval> | undefined;
let blinkTimeout: ReturnType<typeof setTimeout> | undefined;
let pupilInterval: ReturnType<typeof setInterval> | undefined;
let idleFrame: number | undefined;
let idleTime = 0;

// Mouth animation when speaking
function animateMouth() {
  if (props.speaking) {
    mouthOpen.value = Math.random() * 0.8 + 0.2;
  } else {
    mouthOpen.value = 0;
  }
}

// Blink: close eyes briefly, then schedule next blink at random interval (3-6s)
function scheduleBlink() {
  const delay = 3000 + Math.random() * 3000;
  blinkTimeout = setTimeout(() => {
    blinking.value = true;
    setTimeout(() => {
      blinking.value = false;
      scheduleBlink();
    }, 150);
  }, delay);
}

// Pupil micro-movement: subtle random drift every 1-3s
function schedulePupilMove() {
  pupilInterval = setInterval(() => {
    pupilOffsetX.value = (Math.random() - 0.5) * 2.5;
    pupilOffsetY.value = (Math.random() - 0.5) * 1.5;
  }, 1500 + Math.random() * 1500);
}

// Idle loop: head sway + breathing
function idleLoop(timestamp: number) {
  idleTime = timestamp * 0.001;
  // Gentle head sway (sine wave, very subtle)
  headSwayX.value = Math.sin(idleTime * 0.6) * 1.2;
  headSwayY.value = Math.sin(idleTime * 0.4 + 1) * 0.8;
  // Breathing: subtle scale on torso
  breathScale.value = 1 + Math.sin(idleTime * 1.8) * 0.012;
  idleFrame = requestAnimationFrame(idleLoop);
}

onMounted(() => {
  speakInterval = setInterval(animateMouth, 120);
  scheduleBlink();
  schedulePupilMove();
  idleFrame = requestAnimationFrame(idleLoop);
});

onUnmounted(() => {
  if (speakInterval) clearInterval(speakInterval);
  if (blinkTimeout) clearTimeout(blinkTimeout);
  if (pupilInterval) clearInterval(pupilInterval);
  if (idleFrame) cancelAnimationFrame(idleFrame);
});

// ── Computed face geometry ──────────────────────────────

const mouthPath = computed(() => {
  const open = mouthOpen.value;
  const w = 18;
  const h = open * 10;
  const my = 118; // mouth Y center — well inside the head, below the nose

  if (props.expression === 'happy') {
    // Resting: gentle smile. Speaking: wider smile.
    const curve = open < 0.1 ? 5 : h + 8;
    return `M ${100 - w} ${my} Q 100 ${my + curve} ${100 + w} ${my}`;
  }
  if (props.expression === 'surprised') {
    if (open < 0.1) {
      // Resting: small "o" shape
      return `M ${100 - 6} ${my} Q ${100 - 6} ${my + 6} 100 ${my + 6} Q ${100 + 6} ${my + 6} ${100 + 6} ${my} Q ${100 + 6} ${my - 6} 100 ${my - 6} Q ${100 - 6} ${my - 6} ${100 - 6} ${my}`;
    }
    const ow = 8 + open * 5;
    return `M ${100 - ow} ${my - ow} Q ${100 - ow} ${my + ow} 100 ${my + ow} Q ${100 + ow} ${my + ow} ${100 + ow} ${my - ow} Q ${100 + ow} ${my - ow * 2} 100 ${my - ow} Q ${100 - ow} ${my - ow * 2} ${100 - ow} ${my - ow}`;
  }
  if (props.expression === 'sad') {
    // Resting: slight frown. Speaking: deeper frown.
    const frown = open < 0.1 ? 3 : 4 + h * 0.5;
    return `M ${100 - w} ${my + 2} Q 100 ${my - frown} ${100 + w} ${my + 2}`;
  }
  if (props.expression === 'angry') {
    const aw = 14;
    if (open < 0.1) {
      // Resting: tense flat line, slightly pressed
      return `M ${100 - aw} ${my} Q 100 ${my + 2} ${100 + aw} ${my}`;
    }
    return `M ${100 - aw} ${my} Q 100 ${my + h * 0.5} ${100 + aw} ${my}`;
  }
  if (props.expression === 'embarrassed') {
    // Resting: small wobbly nervous smile. Speaking: wider wavy smile.
    const sw = 12;
    const curve = open < 0.1 ? 4 : h + 5;
    return `M ${100 - sw} ${my + 1} Q ${100 - 5} ${my - 1} 100 ${my + curve} Q ${100 + 5} ${my - 1} ${100 + sw} ${my + 1}`;
  }
  // neutral
  if (open < 0.1) {
    // Resting: gentle natural curve (slight smile)
    return `M ${100 - w} ${my} Q 100 ${my + 3} ${100 + w} ${my}`;
  }
  return `M ${100 - w} ${my} Q 100 ${my + h} ${100 + w} ${my} Q 100 ${my + h * 0.3} ${100 - w} ${my}`;
});

const eyeScale = computed(() => {
  if (props.expression === 'surprised') return 1.3;
  if (props.expression === 'angry') return 0.85;
  if (props.expression === 'sad') return 0.95;
  if (props.expression === 'embarrassed') return 0.9;
  return 1;
});

// Eyebrows for ALL expressions
const eyebrows = computed(() => {
  switch (props.expression) {
    case 'angry':
      return {
        show: true,
        left:  { x1: 72, y1: 69, x2: 92, y2: 73 },   // inner end lower → V frown
        right: { x1: 108, y1: 73, x2: 128, y2: 69 },
      };
    case 'sad':
      return {
        show: true,
        left:  { x1: 72, y1: 74, x2: 92, y2: 69 },   // outer end lower → droopy
        right: { x1: 108, y1: 69, x2: 128, y2: 74 },
      };
    case 'surprised':
      return {
        show: true,
        left:  { x1: 72, y1: 66, x2: 92, y2: 66 },
        right: { x1: 108, y1: 66, x2: 128, y2: 66 },
      };
    case 'happy':
      return {
        show: true,
        left:  { x1: 74, y1: 70, x2: 90, y2: 68 },
        right: { x1: 110, y1: 68, x2: 126, y2: 70 },
      };
    case 'embarrassed':
      return {
        show: true,
        left:  { x1: 74, y1: 72, x2: 90, y2: 67 },   // inner end raised → worried/shy
        right: { x1: 110, y1: 67, x2: 126, y2: 72 },
      };
    default: // neutral
      return {
        show: true,
        left:  { x1: 74, y1: 71, x2: 90, y2: 71 },
        right: { x1: 110, y1: 71, x2: 126, y2: 71 },
      };
  }
});

// Hair spikes — stylized holographic "hair" paths
const hairPaths = computed(() => {
  return [
    'M 68 58 Q 72 28 85 38 Q 78 30 82 20',
    'M 82 48 Q 88 18 95 32 Q 90 14 98 10',
    'M 98 44 Q 100 12 105 30 Q 102 8 110 14',
    'M 112 48 Q 116 20 120 35 Q 118 18 125 25',
    'M 125 58 Q 130 32 128 45 Q 132 28 135 38',
  ];
});

// Nose path — subtle small line
const nosePath = 'M 97 102 Q 100 108 103 102';

// Head transform for idle sway
const headTransform = computed(() => {
  return `translate(${headSwayX.value}, ${headSwayY.value})`;
});

// Torso transform for breathing
const torsoTransform = computed(() => {
  return `translate(100, 170) scale(${breathScale.value}) translate(-100, -170)`;
});
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 200 200"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <!-- Glow filter -->
      <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="4" result="coloredBlur" />
        <feMerge>
          <feMergeNode in="coloredBlur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>

      <!-- Outer glow -->
      <filter id="outerGlow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="8" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>

      <!-- Soft blur for cheek blush -->
      <filter id="blush" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="5" />
      </filter>

      <radialGradient id="headGradient" cx="50%" cy="40%" r="50%">
        <stop offset="0%" :stop-color="skinColor" stop-opacity="0.9" />
        <stop offset="100%" :stop-color="skinColor" stop-opacity="0.6" />
      </radialGradient>
    </defs>

    <!-- Body glow aura -->
    <ellipse
      cx="100"
      cy="175"
      rx="35"
      ry="20"
      :fill="glowColor"
      opacity="0.15"
      filter="url(#outerGlow)"
    />

    <!-- Body / torso (with breathing) -->
    <g :transform="torsoTransform">
      <path
        d="M 70 155 Q 70 145 85 140 L 115 140 Q 130 145 130 155 L 135 185 Q 100 195 65 185 Z"
        :fill="skinColor"
        :stroke="glowColor"
        stroke-width="1.5"
        opacity="0.8"
        filter="url(#glow)"
      />
    </g>

    <!-- ============ HEAD GROUP (with idle sway) ============ -->
    <g :transform="headTransform" class="head-group">

      <!-- Head -->
      <ellipse
        cx="100"
        cy="90"
        rx="42"
        ry="48"
        fill="url(#headGradient)"
        :stroke="glowColor"
        stroke-width="1.5"
        filter="url(#glow)"
      />

      <!-- Ears -->
      <path
        d="M 58 88 Q 50 82 52 92 Q 50 100 58 96"
        fill="none"
        :stroke="glowColor"
        stroke-width="1.2"
        opacity="0.6"
        filter="url(#glow)"
      />
      <path
        d="M 142 88 Q 150 82 148 92 Q 150 100 142 96"
        fill="none"
        :stroke="glowColor"
        stroke-width="1.2"
        opacity="0.6"
        filter="url(#glow)"
      />

      <!-- Hair — holographic spikes -->
      <g filter="url(#glow)" opacity="0.7">
        <path
          v-for="(d, i) in hairPaths"
          :key="'hair-' + i"
          :d="d"
          fill="none"
          :stroke="glowColor"
          stroke-width="1.8"
          stroke-linecap="round"
          class="hair-strand"
          :style="{ animationDelay: (i * 0.4) + 's' }"
        />
      </g>

      <!-- Eyebrows (all expressions) -->
      <g v-if="eyebrows.show" filter="url(#glow)" class="eyebrow-group">
        <line
          :x1="eyebrows.left.x1"
          :y1="eyebrows.left.y1"
          :x2="eyebrows.left.x2"
          :y2="eyebrows.left.y2"
          :stroke="glowColor"
          stroke-width="2.2"
          stroke-linecap="round"
          opacity="0.8"
        />
        <line
          :x1="eyebrows.right.x1"
          :y1="eyebrows.right.y1"
          :x2="eyebrows.right.x2"
          :y2="eyebrows.right.y2"
          :stroke="glowColor"
          stroke-width="2.2"
          stroke-linecap="round"
          opacity="0.8"
        />
      </g>

      <!-- Eyes -->
      <g filter="url(#glow)" class="eyes-group">
        <!-- Left eye -->
        <ellipse
          :cx="82"
          :cy="85"
          :rx="8 * eyeScale"
          :ry="(blinking ? 1 : 6) * eyeScale"
          :fill="glowColor"
          opacity="0.9"
          class="eye-iris"
        />
        <!-- Left pupil -->
        <ellipse
          v-if="!blinking"
          :cx="83 + pupilOffsetX"
          :cy="85 + pupilOffsetY"
          :rx="3 * eyeScale"
          :ry="4 * eyeScale"
          fill="#fff"
          opacity="0.9"
          class="eye-pupil"
        />
        <!-- Left eye highlight -->
        <circle
          v-if="!blinking"
          :cx="80 + pupilOffsetX * 0.3"
          :cy="83 + pupilOffsetY * 0.3"
          r="1.5"
          fill="#fff"
          opacity="0.95"
        />

        <!-- Right eye -->
        <ellipse
          :cx="118"
          :cy="85"
          :rx="8 * eyeScale"
          :ry="(blinking ? 1 : 6) * eyeScale"
          :fill="glowColor"
          opacity="0.9"
          class="eye-iris"
        />
        <!-- Right pupil -->
        <ellipse
          v-if="!blinking"
          :cx="119 + pupilOffsetX"
          :cy="85 + pupilOffsetY"
          :rx="3 * eyeScale"
          :ry="4 * eyeScale"
          fill="#fff"
          opacity="0.9"
          class="eye-pupil"
        />
        <!-- Right eye highlight -->
        <circle
          v-if="!blinking"
          :cx="116 + pupilOffsetX * 0.3"
          :cy="83 + pupilOffsetY * 0.3"
          r="1.5"
          fill="#fff"
          opacity="0.95"
        />
      </g>

      <!-- Nose -->
      <path
        :d="nosePath"
        fill="none"
        :stroke="glowColor"
        stroke-width="1"
        stroke-linecap="round"
        opacity="0.4"
      />

      <!-- Cheek blush (happy) -->
      <g v-if="expression === 'happy'" class="blush-group">
        <ellipse
          cx="68"
          cy="105"
          rx="8"
          ry="5"
          :fill="glowColor"
          opacity="0.15"
          filter="url(#blush)"
        />
        <ellipse
          cx="132"
          cy="105"
          rx="8"
          ry="5"
          :fill="glowColor"
          opacity="0.15"
          filter="url(#blush)"
        />
      </g>

      <!-- Cheek blush (embarrassed) — stronger, pinkish -->
      <g v-if="expression === 'embarrassed'" class="blush-group">
        <ellipse
          cx="66"
          cy="104"
          rx="12"
          ry="6"
          fill="#ff6b9d"
          opacity="0.35"
          filter="url(#blush)"
        />
        <ellipse
          cx="134"
          cy="104"
          rx="12"
          ry="6"
          fill="#ff6b9d"
          opacity="0.35"
          filter="url(#blush)"
        />
      </g>

      <!-- Mouth -->
      <path
        :d="mouthPath"
        fill="none"
        :stroke="glowColor"
        stroke-width="2"
        stroke-linecap="round"
        filter="url(#glow)"
      />

      <!-- Speaking indicator (sound waves) -->
      <g v-if="speaking" opacity="0.4">
        <path
          d="M 145 85 Q 155 85 155 95"
          fill="none"
          :stroke="glowColor"
          stroke-width="1.5"
          class="sound-wave wave-1"
        />
        <path
          d="M 148 80 Q 162 85 162 100"
          fill="none"
          :stroke="glowColor"
          stroke-width="1"
          class="sound-wave wave-2"
        />
      </g>
    </g>
  </svg>
</template>

<style scoped>
/* Smooth transitions for expression changes */
.eye-iris {
  transition: ry 0.08s ease-in-out, rx 0.3s ease;
}

.eye-pupil {
  transition: cx 0.6s ease-out, cy 0.6s ease-out, rx 0.3s ease, ry 0.3s ease;
}

.eyebrow-group line {
  transition: x1 0.4s ease, y1 0.4s ease, x2 0.4s ease, y2 0.4s ease;
}

.head-group {
  transition: transform 0.1s linear;
}

/* Blush fade in/out */
.blush-group {
  animation: blushFade 0.5s ease-in forwards;
}

@keyframes blushFade {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* Hair subtle float */
.hair-strand {
  animation: hairFloat 4s ease-in-out infinite;
}

@keyframes hairFloat {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-1.5px); }
}

/* Sound waves */
.sound-wave {
  animation: pulse 0.8s ease-in-out infinite;
}
.wave-1 {
  animation-delay: 0s;
}
.wave-2 {
  animation-delay: 0.3s;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0;
  }
  50% {
    opacity: 0.6;
  }
}
</style>
