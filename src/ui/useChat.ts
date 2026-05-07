import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type MonsterBible, defaultBible } from '../llm/bible.js';
import { type ChatTurn, type SceneState, prewarmBrain, runMonsterBrain } from '../llm/brain.js';
import { pickGreeting } from '../llm/personality.js';
import { rotateGreetingSeed } from '../llm/storage.js';
import { type VoiceHandle, createVoice } from '../llm/voice.js';
import { type WorldModelLogger, createWorldModelLogger } from '../llm/worldModelLog.js';
import type { EmotionState } from '../npc/emotion.js';
import { DEFAULT_EMOTION } from '../npc/emotion.js';
import type { NpcIntentSurface } from '../npc/intent.js';
import type { ChatMessage } from './ChatPanel.js';

const LATENCY_AVERAGE_WINDOW = 5;

function uid(): string {
  return Math.random().toString(36).slice(2) + performance.now().toString(36);
}

export interface UseChatArgs {
  apiKey: string;
  getScene: () => SceneState;
  /** Brain dispatch target. Optional so tests can omit it. */
  intent?: NpcIntentSurface;
  /** Override the bible at config time; defaults to Mara. */
  bible?: MonsterBible;
}

/**
 * Single owner of chat state, the brain lifecycle, and latency stats.
 *
 * Each user turn:
 *   1. Calls `runMonsterBrain` and awaits a strict JSON envelope.
 *   2. Pushes the `utterance` into the transcript.
 *   3. Speaks `utterance` through Web Speech TTS, recording first-audio ms.
 *   4. Dispatches `actions[]` against the supplied [NpcIntentSurface](../npc/intent.ts),
 *      which steers Mara's body in the scene.
 */
export function useChat(args: UseChatArgs) {
  const { apiKey, getScene, intent } = args;
  const bible = args.bible ?? defaultBible;

  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: 'greeting',
      role: 'assistant',
      text: pickGreeting(rotateGreetingSeed()),
    },
  ]);
  const [busy, setBusy] = useState(false);
  const [lastFirstAudioMs, setLastFirstAudioMs] = useState<number | null>(null);
  const [emotion, setEmotion] = useState<EmotionState>(DEFAULT_EMOTION);
  const recentLatenciesRef = useRef<number[]>([]);
  const emotionRef = useRef<EmotionState>(DEFAULT_EMOTION);
  emotionRef.current = emotion;

  const voiceRef = useRef<VoiceHandle | null>(null);
  if (!voiceRef.current) voiceRef.current = createVoice(bible);

  // One world_model logger per (bible) chat session. Recreated when the
  // bible swaps so turn indexes reset alongside the persona.
  const logger: WorldModelLogger = useMemo(
    () => createWorldModelLogger({ bibleId: bible.id }),
    [bible.id],
  );

  // Cancel in-flight TTS on unmount so navigating away never leaks a
  // talking voice into the next page.
  useEffect(() => {
    const handle = voiceRef.current;
    return () => {
      handle?.cancel();
    };
  }, []);

  // Pre-warm OpenRouter's free-tier provider routing the first time we see
  // an API key. The free model has a 3-8 s cold start on the first real
  // call; firing a 1-token ping while the user is still looking at the
  // scene means the first chat turn lands on a hot path. We only warm
  // once per (apiKey, bible.model) pair so user-key edits or bible swaps
  // each get exactly one warmup, not every render.
  const warmedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!apiKey) return;
    const tag = `${apiKey}::${bible.model}`;
    if (warmedKeyRef.current === tag) return;
    warmedKeyRef.current = tag;
    const ctrl = new AbortController();
    void prewarmBrain(apiKey, bible, ctrl.signal);
    return () => {
      ctrl.abort();
    };
  }, [apiKey, bible]);

  const intentRef = useRef<NpcIntentSurface | undefined>(intent);
  intentRef.current = intent;

  const send = useCallback(
    async (text: string) => {
      if (!apiKey || busy) return;

      const userMsg: ChatMessage = { id: uid(), role: 'user', text };
      const assistantId = uid();
      const placeholder: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        text: '',
        pending: true,
      };
      setMessages((prev) => [...prev, userMsg, placeholder]);
      setBusy(true);

      const priorTurns: ChatTurn[] = messages
        .filter(
          (m): m is ChatMessage & { role: 'user' | 'assistant' } => !m.pending && m.text.length > 0,
        )
        .map((m) => ({ role: m.role, text: m.text }));

      try {
        const result = await runMonsterBrain({
          apiKey,
          bible,
          history: priorTurns,
          userMessage: text,
          scene: getScene(),
        });

        const { response } = result;

        // Log the world_model block before any UI side-effects so the QA
        // harness sees every successful turn even if TTS or dispatch later
        // throws. driftWarning logs at console.warn for v1 visibility; once
        // the v1.5 QA harness lands it can switch to the structured sink.
        logger.recordTurn(response);

        // Update transcript first so the user sees text even if TTS fails.
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, text: response.utterance, pending: false } : m,
          ),
        );

        // Emotion field — drives both the floating face badge and the
        // intensity baseline used by any later set_face actions.
        setEmotion({
          expression: response.emotion,
          intensity: 0.85,
          updatedAt: performance.now(),
        });

        // Dispatch body actions before we kick off TTS so movement starts
        // visibly in parallel with audio.
        if (intentRef.current) {
          intentRef.current.dispatchAll(response.actions);
        }

        // Speak. First-audio latency is what the issue's success criterion
        // ("monster replies in voice within ~1 s") actually grades us on.
        voiceRef.current?.speak(response.utterance, {
          onFirstAudio: (audioMs) => {
            const total = result.totalMs + audioMs;
            setLastFirstAudioMs(total);
            const buf = recentLatenciesRef.current;
            buf.push(total);
            if (buf.length > LATENCY_AVERAGE_WINDOW) buf.shift();
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  text: `(${bible.name} wavers — ${message})`,
                  pending: false,
                }
              : m,
          ),
        );
      } finally {
        setBusy(false);
      }
    },
    [apiKey, busy, messages, getScene, bible, logger],
  );

  // Re-derived each render from the rolling buffer. The reference to
  // lastFirstAudioMs keeps React reactive to the same state change that
  // mutated the ref'd buffer.
  const buf = recentLatenciesRef.current;
  const averageFirstAudioMs = buf.length === 0 ? null : buf.reduce((a, b) => a + b, 0) / buf.length;
  void lastFirstAudioMs;

  return {
    messages,
    busy,
    send,
    emotion,
    /** ms from submit to first audible TTS frame on the most recent turn. */
    lastFirstAudioMs,
    /** Rolling mean of `lastFirstAudioMs` over the last few turns. */
    averageFirstAudioMs,
    /** Bible the chat is currently bound to. Surface for debug HUDs. */
    bible,
  };
}
