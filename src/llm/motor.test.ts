import { describe, expect, it, vi } from 'vitest';
import type { CharacterIntentSurface, ClipName } from '../character/intent.js';
import { type SceneState, createMotorClient, streamMotorReply } from './motor.js';
import type { ParsedToolCall } from './tools.js';

function makeSseStream(frames: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(enc.encode(`${f}\n\n`));
      controller.close();
    },
  });
}

function fakeIntent(): { surface: CharacterIntentSurface; calls: string[] } {
  const calls: string[] = [];
  const surface: CharacterIntentSurface = {
    move_to(x, y, z) {
      calls.push(`move_to(${x},${y},${z})`);
    },
    look_at(target) {
      if (target === 'camera') calls.push('look_at(camera)');
      else if ('x' in target) calls.push(`look_at(${target.x},${target.y},${target.z})`);
      else calls.push('look_at(object)');
    },
    play_animation(clip: ClipName, mode) {
      calls.push(`play_animation(${clip},${mode ?? 'queue'})`);
    },
    point_at(target) {
      if ('x' in target) calls.push(`point_at(${target.x},${target.y},${target.z})`);
      else calls.push('point_at(object)');
    },
    speak(text) {
      calls.push(`speak(${text})`);
    },
    dispatch() {
      // unused — motor calls the typed methods directly
    },
  };
  return { surface, calls };
}

const SCENE: SceneState = {
  position: { x: 1, z: 2 },
  lastClickTarget: null,
};

describe('streamMotorReply', () => {
  it('parses tool_calls SSE chunks and dispatches into the intent surface', async () => {
    // Two tool calls split across multiple chunks, then a final content delta.
    const frames = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"move_to","arguments":"{\\"x\\":3"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":",\\"y\\":0,\\"z\\":-2}"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call-2","function":{"name":"speak","arguments":"{\\"text\\":\\"on the way\\"}"}}]}}]}',
      'data: {"choices":[{"delta":{"content":"OK"}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
      'data: [DONE]',
    ];

    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      body: makeSseStream(frames),
      text: async () => '',
    })) as unknown as typeof fetch;

    const { surface, calls } = fakeIntent();
    const collected: ParsedToolCall[] = [];
    let final = { text: '', toolCalls: [] as ReadonlyArray<ParsedToolCall> };
    let firstTokenMs: number | null = null;

    await streamMotorReply({
      client: createMotorClient({ apiKey: 'k', model: 'openai/gpt-oss-120b:free' }),
      history: [],
      userMessage: 'walk forward please',
      scene: SCENE,
      intent: surface,
      fetchImpl,
      handlers: {
        onFirstToken: (ms) => {
          firstTokenMs = ms;
        },
        onTextDelta: () => {},
        onToolCall: (c) => collected.push(c),
        onToolCallParseError: (e) => {
          throw e;
        },
        onFinal: (f) => {
          final = f;
        },
        onError: (e) => {
          throw e;
        },
      },
    });

    expect(final.text).toBe('OK');
    expect(collected).toHaveLength(2);
    expect(collected[0]).toEqual({ name: 'move_to', point: { x: 3, y: 0, z: -2 } });
    expect(collected[1]).toEqual({ name: 'speak', text: 'on the way' });
    expect(calls).toEqual(['move_to(3,0,-2)', 'speak(on the way)']);
    expect(firstTokenMs).not.toBeNull();
    expect(firstTokenMs as unknown as number).toBeGreaterThanOrEqual(0);
  });

  it('reports parse errors but keeps going', async () => {
    const frames = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"a","function":{"name":"move_to","arguments":"{not json"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"b","function":{"name":"play_animation","arguments":"{\\"clip\\":\\"wave\\",\\"mode\\":\\"queue\\"}"}}]}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
      'data: [DONE]',
    ];
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      body: makeSseStream(frames),
      text: async () => '',
    })) as unknown as typeof fetch;

    const errors: string[] = [];
    const calls: ParsedToolCall[] = [];

    await streamMotorReply({
      client: createMotorClient({ apiKey: 'k' }),
      history: [],
      userMessage: 'wave',
      scene: SCENE,
      fetchImpl,
      handlers: {
        onToolCallParseError: (e) => errors.push(e.message),
        onToolCall: (c) => calls.push(c),
        onFinal: () => {},
        onError: (e) => {
          throw e;
        },
      },
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('move_to');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ name: 'play_animation', clip: 'wave', mode: 'queue' });
  });

  it('surfaces HTTP errors via onError', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      body: null,
      text: async () => 'invalid key',
    })) as unknown as typeof fetch;

    let captured: Error | null = null;
    await streamMotorReply({
      client: createMotorClient({ apiKey: 'bad' }),
      history: [],
      userMessage: 'hi',
      scene: SCENE,
      fetchImpl,
      handlers: {
        onFinal: () => {},
        onError: (e) => {
          captured = e;
        },
      },
    });
    expect(captured).not.toBeNull();
    expect((captured as unknown as Error).message).toContain('401');
  });
});
