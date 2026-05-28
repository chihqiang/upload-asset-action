import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as core from '@actions/core';
import { Collector } from '../src/collector';

vi.mock('@actions/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@actions/core')>();
  return {
    ...actual,
    getInput: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  };
});

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.GOBUILD_FILES;
});

describe('Collector', () => {
  it('should return files from input', async () => {
    vi.mocked(core.getInput).mockReturnValue('file1.txt file2.txt');

    const collector = new Collector();
    const files = await collector.collect();

    expect(files).toEqual(['file1.txt', 'file2.txt']);
  });

  it('should include files from GOBUILD_FILES env', async () => {
    vi.mocked(core.getInput).mockReturnValue('');
    process.env.GOBUILD_FILES = 'env-file1.txt env-file2.txt';

    const collector = new Collector();
    const files = await collector.collect();

    expect(files).toEqual(['env-file1.txt', 'env-file2.txt']);
  });

  it('should merge input and env files and deduplicate', async () => {
    vi.mocked(core.getInput).mockReturnValue('common.txt a.txt');
    process.env.GOBUILD_FILES = 'common.txt b.txt';

    const collector = new Collector();
    const files = await collector.collect();

    expect(files).toEqual(['common.txt', 'a.txt', 'b.txt']);
  });

  it('should return empty array when no files specified', async () => {
    vi.mocked(core.getInput).mockReturnValue('');

    const collector = new Collector();
    const files = await collector.collect();

    expect(files).toEqual([]);
  });
});
