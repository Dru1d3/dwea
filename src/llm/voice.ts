/**
 * Web Speech TTS wrapper. Zero-spend v0 voice — runs entirely in the browser
 * and starts speaking within ~50 ms of speak(), so the issue's "~1 s
 * time-to-first-audio" budget is comfortable.
 *
 * Vendor TTS (ElevenLabs / Inworld) lands behind a separate flag once the
 * CEO picks a vendor and approves the spend; this module's surface is
 * intentionally vendor-shaped (speak / cancel / first-audio callback) so the
 * swap is one file change. See open question on [DWEA-34](/DWEA/issues/DWEA-34).
 */
import type { MonsterBible } from './bible.js';

export interface VoiceHandle {
  /** Speak the utterance; resolves when audio playback ends. */
  speak: (
    text: string,
    handlers?: {
      onFirstAudio?: (latencyMs: number) => void;
      onEnd?: () => void;
      onError?: (err: Error) => void;
    },
  ) => void;
  /** Cut current playback off so the next turn can speak immediately. */
  cancel: () => void;
  /** True if the browser exposes speechSynthesis. */
  supported: boolean;
}

let cachedVoices: SpeechSynthesisVoice[] | null = null;
function listVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !window.speechSynthesis) return [];
  if (cachedVoices && cachedVoices.length > 0) return cachedVoices;
  cachedVoices = window.speechSynthesis.getVoices();
  return cachedVoices;
}

if (typeof window !== 'undefined' && window.speechSynthesis) {
  // Voices populate asynchronously on most browsers; refresh the cache once
  // they're available so the first speak() doesn't fall through to the OS
  // default.
  window.speechSynthesis.addEventListener?.('voiceschanged', () => {
    cachedVoices = window.speechSynthesis.getVoices();
  });
}

function pickVoice(bible: MonsterBible): SpeechSynthesisVoice | null {
  const voices = listVoices();
  if (voices.length === 0) return null;
  const hint = bible.voice.voiceHint?.toLowerCase();
  const lang = bible.voice.lang?.toLowerCase();

  if (hint) {
    const match = voices.find((v) => v.name.toLowerCase().includes(hint));
    if (match) return match;
  }
  if (lang) {
    const match = voices.find((v) => v.lang.toLowerCase().startsWith(lang));
    if (match) return match;
  }
  return voices.find((v) => v.default) ?? voices[0] ?? null;
}

export function createVoice(bible: MonsterBible): VoiceHandle {
  const supported = typeof window !== 'undefined' && Boolean(window.speechSynthesis);
  if (!supported) {
    return {
      supported: false,
      speak: (_t, h) => h?.onEnd?.(),
      cancel: () => {},
    };
  }

  return {
    supported: true,
    speak: (text, handlers) => {
      if (!text.trim()) {
        handlers?.onEnd?.();
        return;
      }
      const synth = window.speechSynthesis;
      // Cancel any in-flight utterance — running monster turns should never
      // overlap their voices.
      synth.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      const voice = pickVoice(bible);
      if (voice) utterance.voice = voice;
      utterance.rate = bible.voice.rate;
      utterance.pitch = bible.voice.pitch;
      if (bible.voice.lang) utterance.lang = bible.voice.lang;

      const startedAt = performance.now();
      utterance.onstart = () => {
        handlers?.onFirstAudio?.(performance.now() - startedAt);
      };
      utterance.onend = () => {
        handlers?.onEnd?.();
      };
      utterance.onerror = (event) => {
        handlers?.onError?.(new Error(`tts: ${event.error ?? 'unknown'}`));
      };

      synth.speak(utterance);
    },
    cancel: () => {
      window.speechSynthesis.cancel();
    },
  };
}
