import { describe, expect, it } from 'vitest';
import { TOOLS, TOOL_RESOURCES, ToolCallParseError, parseToolCall } from './schema.js';

describe('schema.TOOLS', () => {
  it('exposes the five plan tools with required arg names', () => {
    expect(TOOLS.map((t) => t.name)).toEqual([
      'move_to',
      'look_at',
      'play_animation',
      'point_at',
      'speak',
    ]);
    const byName = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
    expect(byName.move_to?.input_schema.required).toEqual(['x', 'y', 'z']);
    expect(byName.look_at?.input_schema.required).toEqual(['target_id']);
    expect(byName.play_animation?.input_schema.required).toEqual(['clip_id', 'mode']);
    expect(byName.point_at?.input_schema.required).toEqual(['target_id']);
    expect(byName.speak?.input_schema.required).toEqual(['text']);
  });

  it('declares per-resource locks per the plan', () => {
    expect(TOOL_RESOURCES.move_to).toEqual(['legs']);
    expect(TOOL_RESOURCES.look_at).toEqual(['head']);
    expect(TOOL_RESOURCES.point_at).toEqual(['arms']);
    expect(TOOL_RESOURCES.play_animation).toEqual(['head', 'arms', 'legs']);
    expect(TOOL_RESOURCES.speak).toEqual(['voice']);
  });
});

describe('parseToolCall', () => {
  it('parses move_to', () => {
    expect(parseToolCall('move_to', { x: 1, y: 0, z: -2 })).toEqual({
      name: 'move_to',
      input: { x: 1, y: 0, z: -2 },
    });
  });

  it('parses play_animation with mode', () => {
    expect(parseToolCall('play_animation', { clip_id: 'idle', mode: 'interrupt' })).toEqual({
      name: 'play_animation',
      input: { clip_id: 'idle', mode: 'interrupt' },
    });
  });

  it('rejects move_to with missing args', () => {
    expect(() => parseToolCall('move_to', { x: 1 })).toThrow(ToolCallParseError);
  });

  it('rejects play_animation with bad mode', () => {
    expect(() => parseToolCall('play_animation', { clip_id: 'wave', mode: 'maybe' })).toThrow(
      ToolCallParseError,
    );
  });

  it('rejects unknown tool name', () => {
    expect(() => parseToolCall('teleport', {})).toThrow(ToolCallParseError);
  });
});
