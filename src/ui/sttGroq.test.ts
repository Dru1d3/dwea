import { describe, expect, it, vi } from 'vitest';
import type { MicSnapshot } from './micCapture.js';
import {
  type MediaRecorderLike,
  type MediaStreamLike,
  createGroqSttController,
} from './sttGroq.js';

class FakeMediaRecorder implements MediaRecorderLike {
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: MediaRecorderLike['ondataavailable'] = null;
  onstop: MediaRecorderLike['onstop'] = null;
  onerror: MediaRecorderLike['onerror'] = null;

  start(): void {
    this.state = 'recording';
  }
  stop(): void {
    if (this.state !== 'recording') return;
    this.state = 'inactive';
    this.ondataavailable?.({
      data: new Blob([new Uint8Array([1, 2, 3, 4])], { type: this.mimeType }),
    });
    this.onstop?.();
  }
}

function makeStream(): MediaStreamLike {
  return {
    getTracks: () => [{ stop: vi.fn() }],
  };
}

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

describe('createGroqSttController', () => {
  it('records, transcribes, and emits the final transcript', async () => {
    const recorder = new FakeMediaRecorder();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ text: '  Hallo, wie geht es dir?  ' }),
      text: async () => '',
      statusText: 'OK',
    })) as unknown as typeof fetch;

    const snapshots: MicSnapshot[] = [];
    let final = '';
    const ctrl = createGroqSttController({
      apiKey: 'test-key',
      language: 'de',
      fetchImpl,
      getUserMedia: async () => makeStream(),
      mediaRecorderFactory: () => recorder,
      onChange: (snap) => snapshots.push(snap),
      onTranscript: (text) => {
        final = text;
      },
    });

    ctrl.start();
    await flush();
    expect(recorder.state).toBe('recording');

    ctrl.stop();
    await flush();
    await flush();

    expect(final).toBe('Hallo, wie geht es dir?');
    expect(snapshots.map((s) => s.state)).toContain('listening');
    expect(snapshots.map((s) => s.state)).toContain('processing');
    expect(snapshots.at(-1)?.state).toBe('idle');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const req = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(req?.[0]).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    const init = req?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get('model')).toBe('whisper-large-v3-turbo');
    expect(form.get('language')).toBe('de');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('treats empty Whisper output as a no-speech error', async () => {
    const recorder = new FakeMediaRecorder();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ text: '   ' }),
      text: async () => '',
      statusText: 'OK',
    })) as unknown as typeof fetch;

    const snapshots: MicSnapshot[] = [];
    const ctrl = createGroqSttController({
      apiKey: 'k',
      fetchImpl,
      getUserMedia: async () => makeStream(),
      mediaRecorderFactory: () => recorder,
      onChange: (snap) => snapshots.push(snap),
    });

    ctrl.start();
    await flush();
    ctrl.stop();
    await flush();
    await flush();

    expect(snapshots.at(-1)?.state).toBe('error');
    expect(snapshots.at(-1)?.errorKind).toBe('no-speech');
  });

  it('classifies a denied permission error', async () => {
    const ctrl = createGroqSttController({
      apiKey: 'k',
      fetchImpl: vi.fn() as unknown as typeof fetch,
      getUserMedia: async () => {
        throw new DOMException('denied', 'NotAllowedError');
      },
      mediaRecorderFactory: () => new FakeMediaRecorder(),
      onChange: () => {},
    });

    const last: MicSnapshot[] = [];
    ctrl.start();
    await flush();
    last.push(ctrl.snapshot());
    expect(last.at(-1)?.state).toBe('error');
    expect(last.at(-1)?.errorKind).toBe('permission-denied');
  });

  it('surfaces Groq API errors as a network/unknown failure', async () => {
    const recorder = new FakeMediaRecorder();
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => '{"error":{"message":"Invalid API key"}}',
      statusText: 'Unauthorized',
    })) as unknown as typeof fetch;

    const snapshots: MicSnapshot[] = [];
    const ctrl = createGroqSttController({
      apiKey: 'bad',
      fetchImpl,
      getUserMedia: async () => makeStream(),
      mediaRecorderFactory: () => recorder,
      onChange: (snap) => snapshots.push(snap),
    });

    ctrl.start();
    await flush();
    ctrl.stop();
    await flush();
    await flush();

    const last = snapshots.at(-1);
    expect(last?.state).toBe('error');
    expect(last?.errorMessage ?? '').toContain('Invalid API key');
  });
});
