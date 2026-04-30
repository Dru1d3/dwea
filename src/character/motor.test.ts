import { describe, expect, it } from 'vitest';
import { type MotorTurn, createMotorClient, streamMotor } from './motor.js';
import type { ToolCall } from './schema.js';

/**
 * Build a Response whose body streams a fixed sequence of Anthropic SSE
 * frames (split arbitrarily so the parser must reassemble across reads).
 */
function makeSseResponse(frames: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(enc.encode(frame));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const sseFrame = (event: string, data: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

describe('streamMotor', () => {
  it('dispatches each tool_use block on its content_block_stop, in order', async () => {
    const calls: ToolCall[] = [];
    const events: string[] = [];

    const frames: string[] = [
      sseFrame('message_start', {
        type: 'message_start',
        message: { id: 'm', role: 'assistant' },
      }),
      // Block 0: text greeting.
      sseFrame('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      }),
      sseFrame('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'On my way.' },
      }),
      sseFrame('content_block_stop', { type: 'content_block_stop', index: 0 }),
      // Block 1: move_to. Input arrives in two json deltas to simulate
      // partial streaming.
      sseFrame('content_block_start', {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'tu_1', name: 'move_to', input: {} },
      }),
      sseFrame('content_block_delta', {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"x":2,' },
      }),
      sseFrame('content_block_delta', {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '"y":0,"z":3}' },
      }),
      sseFrame('content_block_stop', { type: 'content_block_stop', index: 1 }),
      // Block 2: point_at — fully formed input in one delta.
      sseFrame('content_block_start', {
        type: 'content_block_start',
        index: 2,
        content_block: { type: 'tool_use', id: 'tu_2', name: 'point_at', input: {} },
      }),
      sseFrame('content_block_delta', {
        type: 'content_block_delta',
        index: 2,
        delta: { type: 'input_json_delta', partial_json: '{"target_id":"rock"}' },
      }),
      sseFrame('content_block_stop', { type: 'content_block_stop', index: 2 }),
      sseFrame('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use' },
      }),
      sseFrame('message_stop', { type: 'message_stop' }),
    ];

    let final: MotorTurn | undefined;
    const client = createMotorClient({ apiKey: 'test', model: 'claude-opus-4-7' });

    await streamMotor({
      client,
      systemPrompt: 'sys',
      history: [],
      userMessage: 'walk to the rock and point at it',
      fetchImpl: async () => makeSseResponse(frames),
      handlers: {
        onText: (delta) => events.push(`text:${delta}`),
        onToolCall: (call) => {
          events.push(`tool:${call.name}`);
          calls.push(call);
        },
        onFinal: (turn) => {
          final = turn;
        },
        onError: (err) => {
          throw err;
        },
      },
    });

    expect(events).toEqual(['text:On my way.', 'tool:move_to', 'tool:point_at']);
    expect(calls.map((c) => c.name)).toEqual(['move_to', 'point_at']);
    expect(calls[0]?.input).toEqual({ x: 2, y: 0, z: 3 });
    expect(calls[1]?.input).toEqual({ target_id: 'rock' });
    expect(final?.role).toBe('assistant');
    expect(final?.text).toContain('On my way.');
    expect(final?.text).toContain('<move_to');
    expect(final?.text).toContain('<point_at');
  });

  it('reports invalid tool input through onToolCallParseError', async () => {
    const frames: string[] = [
      sseFrame('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'tu_1', name: 'play_animation', input: {} },
      }),
      sseFrame('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"clip_id":"wave","mode":"maybe"}' },
      }),
      sseFrame('content_block_stop', { type: 'content_block_stop', index: 0 }),
      sseFrame('message_stop', { type: 'message_stop' }),
    ];

    const calls: ToolCall[] = [];
    const errors: string[] = [];
    await streamMotor({
      client: createMotorClient({ apiKey: 'test' }),
      systemPrompt: 'sys',
      history: [],
      userMessage: 'wave please',
      fetchImpl: async () => makeSseResponse(frames),
      handlers: {
        onToolCall: (call) => calls.push(call),
        onToolCallParseError: (err) => errors.push(err.message),
      },
    });
    expect(calls).toEqual([]);
    expect(errors[0]).toContain('mode');
  });

  it('surfaces a non-2xx response via onError', async () => {
    const errors: string[] = [];
    await streamMotor({
      client: createMotorClient({ apiKey: 'test' }),
      systemPrompt: 'sys',
      history: [],
      userMessage: 'hi',
      fetchImpl: async () =>
        new Response(
          '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
          {
            status: 401,
            headers: { 'content-type': 'application/json' },
          },
        ),
      handlers: {
        onToolCall: () => {
          throw new Error('should not dispatch');
        },
        onError: (err) => errors.push(err.message),
      },
    });
    expect(errors[0]).toContain('Anthropic 401');
  });
});
