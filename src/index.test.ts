import { describe, expect, it } from 'vitest';
import { greet, projectName } from './index.js';

describe('smoke', () => {
  it('exposes the project name', () => {
    expect(projectName).toBe('dwea');
  });

  it('greets by name', () => {
    expect(greet('world')).toBe('Hello, world.');
  });
});
