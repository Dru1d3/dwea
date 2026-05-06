import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type MicSnapshot,
  type SpeechRecognitionAlternativeLike,
  type SpeechRecognitionErrorEventLike,
  type SpeechRecognitionEventLike,
  type SpeechRecognitionLike,
  type SpeechRecognitionResultLike,
  type SpeechRecognitionResultListLike,
  createMicController,
} from './micCapture.js';

class MockSpeechRecognition implements SpeechRecognitionLike {
  continuous = false;
  interimResults = false;
  lang = '';
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null = null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null = null;

  startCalls = 0;
  stopCalls = 0;
  abortCalls = 0;
  startThrows: Error | null = null;

  start(): void {
    this.startCalls += 1;
    if (this.startThrows) throw this.startThrows;
    queueMicrotask(() => this.onstart?.());
  }
  stop(): void {
    this.stopCalls += 1;
  }
  abort(): void {
    this.abortCalls += 1;
  }

  // Persistent result list — real SpeechRecognition keeps the running list
  // across events. Mirror that so the controller sees realistic state.
  private _results: SpeechRecognitionResultLike[] = [];

  /**
   * Append new utterance segments. Mirrors what Chrome does when fresh
   * audio is recognized as a new segment.
   */
  emitResult(parts: ReadonlyArray<{ text: string; final: boolean }>): void {
    const startIndex = this._results.length;
    for (const p of parts) {
      this._results.push(this._mkResult(p));
    }
    this._fireResultEvent(startIndex);
  }
  /**
   * Replace the segment at `index`. Mirrors what Chrome does when an
   * interim segment flips to final or the recognizer revises a phrase.
   */
  reviseResult(index: number, part: { text: string; final: boolean }): void {
    this._results[index] = this._mkResult(part);
    this._fireResultEvent(index);
  }
  private _mkResult(p: { text: string; final: boolean }): SpeechRecognitionResultLike {
    const alt: SpeechRecognitionAlternativeLike = { transcript: p.text };
    return { isFinal: p.final, length: 1, 0: alt };
  }
  private _fireResultEvent(resultIndex: number): void {
    const list: SpeechRecognitionResultListLike = {
      length: this._results.length,
      ...Object.fromEntries(this._results.map((r, i) => [i, r])),
    } as SpeechRecognitionResultListLike;
    const event: SpeechRecognitionEventLike = { results: list, resultIndex };
    this.onresult?.(event);
  }
  emitError(code: string, message?: string): void {
    const event: SpeechRecognitionErrorEventLike =
      message === undefined ? { error: code } : { error: code, message };
    this.onerror?.(event);
  }
  emitEnd(): void {
    this.onend?.();
  }
}

describe('createMicController', () => {
  let mock: MockSpeechRecognition;
  let snapshots: MicSnapshot[];
  let transcripts: string[];

  beforeEach(() => {
    mock = new MockSpeechRecognition();
    snapshots = [];
    transcripts = [];
  });

  function build() {
    return createMicController({
      factory: () => mock,
      onChange: (s) => {
        snapshots.push(s);
      },
      onTranscript: (t) => {
        transcripts.push(t);
      },
    });
  }

  it('starts in idle when supported', () => {
    const ctl = build();
    expect(ctl.snapshot()).toEqual({
      state: 'idle',
      transcript: '',
      errorKind: null,
      errorMessage: null,
    });
  });

  it('immediately reports unsupported when factory is null', () => {
    const ctl = createMicController({
      factory: null,
      onChange: (s) => snapshots.push(s),
    });
    const snap = ctl.snapshot();
    expect(snap.state).toBe('error');
    expect(snap.errorKind).toBe('unsupported');
    expect(snapshots[0]?.state).toBe('error');
    // start/stop are no-ops in unsupported mode.
    ctl.start();
    ctl.stop();
    expect(ctl.snapshot()).toBe(snap);
  });

  it('transitions idle → listening → processing → idle on a normal utterance', async () => {
    const ctl = build();
    ctl.start();
    expect(ctl.snapshot().state).toBe('listening');
    expect(mock.startCalls).toBe(1);

    mock.emitResult([{ text: 'walk', final: false }]);
    expect(ctl.snapshot().transcript).toBe('walk');

    mock.reviseResult(0, { text: 'walk forward', final: true });
    expect(ctl.snapshot().transcript).toBe('walk forward');

    ctl.stop();
    expect(ctl.snapshot().state).toBe('processing');
    expect(mock.stopCalls).toBe(1);

    mock.emitEnd();
    expect(ctl.snapshot().state).toBe('idle');
    expect(transcripts).toEqual(['walk forward']);
  });

  it('does not fire onTranscript when nothing was finalized', () => {
    const ctl = build();
    ctl.start();
    ctl.stop();
    mock.emitEnd();
    expect(ctl.snapshot().state).toBe('idle');
    expect(transcripts).toEqual([]);
  });

  it('classifies a permission denial as a recoverable error state', () => {
    const ctl = build();
    ctl.start();
    mock.emitError('not-allowed');
    expect(ctl.snapshot().state).toBe('error');
    expect(ctl.snapshot().errorKind).toBe('permission-denied');
    expect(ctl.snapshot().errorMessage).toMatch(/permission/i);

    // Restarting clears the error.
    ctl.start();
    expect(ctl.snapshot().state).toBe('listening');
    expect(ctl.snapshot().errorKind).toBeNull();
  });

  it('suppresses an `aborted` error fired after a clean stop()', () => {
    const ctl = build();
    ctl.start();
    mock.emitResult([{ text: 'hello', final: true }]);
    ctl.stop();
    mock.emitError('aborted');
    mock.emitEnd();
    expect(ctl.snapshot().state).toBe('idle');
    expect(ctl.snapshot().errorKind).toBeNull();
    expect(transcripts).toEqual(['hello']);
  });

  it('handles a thrown start() by entering the error state', () => {
    const ctl = build();
    mock.startThrows = new Error('boom');
    ctl.start();
    expect(ctl.snapshot().state).toBe('error');
    expect(ctl.snapshot().errorMessage).toBe('boom');
  });

  it('start() is a no-op while already listening', () => {
    const ctl = build();
    ctl.start();
    ctl.start();
    expect(mock.startCalls).toBe(1);
  });

  it('appends streaming interim text to the running final transcript', () => {
    const ctl = build();
    ctl.start();
    mock.emitResult([{ text: 'walk', final: true }]);
    expect(ctl.snapshot().transcript).toBe('walk');
    // New interim segment "forward" appears.
    mock.emitResult([{ text: 'forward', final: false }]);
    expect(ctl.snapshot().transcript).toBe('walk forward');
    // The recognizer revises the same segment to a longer phrase, then
    // flips it to final — exactly the shape Chrome produces.
    mock.reviseResult(1, { text: 'forward please', final: false });
    expect(ctl.snapshot().transcript).toBe('walk forward please');
    mock.reviseResult(1, { text: 'forward please', final: true });
    ctl.stop();
    mock.emitEnd();
    expect(transcripts).toEqual(['walk forward please']);
  });

  it('abort() clears state without firing a transcript', () => {
    const ctl = build();
    ctl.start();
    mock.emitResult([{ text: 'cancel me', final: true }]);
    ctl.abort();
    expect(mock.abortCalls).toBe(1);
    expect(ctl.snapshot().state).toBe('idle');
    expect(ctl.snapshot().transcript).toBe('');
    expect(transcripts).toEqual([]);
  });

  it('destroy() prevents further start() calls', () => {
    const ctl = build();
    ctl.destroy();
    ctl.start();
    expect(mock.startCalls).toBe(0);
  });

  it('emits onChange snapshots on every transition', () => {
    const ctl = build();
    ctl.start();
    mock.emitResult([{ text: 'go', final: true }]);
    ctl.stop();
    mock.emitEnd();
    const states = snapshots.map((s) => s.state);
    expect(states).toEqual(['listening', 'listening', 'processing', 'idle']);
  });

  it('configures the recognition object with sane push-to-talk defaults', () => {
    const spy = vi.spyOn(mock, 'start');
    const ctl = build();
    ctl.start();
    expect(mock.continuous).toBe(false);
    expect(mock.interimResults).toBe(true);
    expect(mock.lang).toBe('en-US');
    expect(spy).toHaveBeenCalledTimes(1);
    ctl.destroy();
  });
});
