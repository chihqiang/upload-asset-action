import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Config } from '../src/config';

vi.mock('@actions/core', () => {
  const mockGetInput = vi.fn();
  const mockSetFailed = vi.fn();
  // 保留原始 info 等，让 log.ts 能正常导入
  const mockInfo = vi.fn();
  const mockWarning = vi.fn();
  const mockError = vi.fn();
  return {
    getInput: mockGetInput,
    setFailed: mockSetFailed,
    info: mockInfo,
    warning: mockWarning,
    error: mockError,
    export: { getInput: mockGetInput, setFailed: mockSetFailed, info: mockInfo, warning: mockWarning, error: mockError },
  };
});

import * as core from '@actions/core';

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_REF_NAME;
  delete process.env.GITHUB_REPOSITORY;
  delete process.env.GITHUB_EVENT_NAME;
  delete process.env.GITHUB_REF;
});

describe('Config', () => {
  it('should read from inputs', () => {
    vi.mocked(core.getInput).mockImplementation((name) => {
      const map: Record<string, string> = {
        github_token: 'my-token',
        tag: 'v1.0.0',
        repo: 'owner/my-repo',
        release_body: 'my release notes',
      };
      return map[name] ?? '';
    });

    const config = new Config();
    expect(config.githubToken).toBe('my-token');
    expect(config.tag).toBe('v1.0.0');
    expect(config.repo).toBe('owner/my-repo');
    expect(config.releaseBody).toBe('my release notes');
  });

  it('should fallback to env vars when input is empty', () => {
    vi.mocked(core.getInput).mockReturnValue('');
    process.env.GITHUB_TOKEN = 'env-token';
    process.env.GITHUB_REF_NAME = 'v2.0.0';
    process.env.GITHUB_REPOSITORY = 'org/other-repo';

    const config = new Config();
    expect(config.githubToken).toBe('env-token');
    expect(config.tag).toBe('v2.0.0');
    expect(config.repo).toBe('org/other-repo');
    expect(config.releaseBody).toBe('');
  });

  it('should validate github_token', () => {
    vi.mocked(core.getInput).mockReturnValue('');

    const config = new Config();
    expect(() => config.validate()).toThrow();
    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('github_token')
    );
  });

  it('should pass validate with token', () => {
    vi.mocked(core.getInput).mockImplementation((name) =>
      name === 'github_token' ? 'valid-token' : ''
    );

    const config = new Config();
    expect(() => config.validate()).not.toThrow();
  });

  it('should parseRepo correctly', () => {
    vi.mocked(core.getInput).mockImplementation((name) =>
      name === 'github_token' ? 'token' : ''
    );
    process.env.GITHUB_REPOSITORY = 'owner/the-repo';

    const config = new Config();
    const [owner, repo] = config.parseRepo();
    expect(owner).toBe('owner');
    expect(repo).toBe('the-repo');
  });

  it('should throw on invalid repo format', () => {
    vi.mocked(core.getInput).mockImplementation((name) =>
      name === 'github_token' ? 'token' : ''
    );
    process.env.GITHUB_REPOSITORY = 'no-slash';

    const config = new Config();
    expect(() => config.parseRepo()).toThrow('Invalid repo format');
  });

  it('should validateEvent for release event', () => {
    process.env.GITHUB_EVENT_NAME = 'release';
    process.env.GITHUB_REF = 'refs/tags/v1.0.0';
    vi.mocked(core.getInput).mockImplementation((name) =>
      name === 'github_token' ? 'token' : ''
    );

    const config = new Config();
    expect(() => config.validateEvent()).not.toThrow();
  });

  it('should validateEvent for tag push', () => {
    process.env.GITHUB_EVENT_NAME = 'push';
    process.env.GITHUB_REF = 'refs/tags/v1.0.0';
    vi.mocked(core.getInput).mockImplementation((name) =>
      name === 'github_token' ? 'token' : ''
    );

    const config = new Config();
    expect(() => config.validateEvent()).not.toThrow();
  });

  it('should reject non-tag push', () => {
    process.env.GITHUB_EVENT_NAME = 'push';
    process.env.GITHUB_REF = 'refs/heads/main';
    vi.mocked(core.getInput).mockImplementation((name) =>
      name === 'github_token' ? 'token' : ''
    );

    const config = new Config();
    expect(() => config.validateEvent()).toThrow();
  });

  it('should reject unsupported event', () => {
    process.env.GITHUB_EVENT_NAME = 'pull_request';
    vi.mocked(core.getInput).mockImplementation((name) =>
      name === 'github_token' ? 'token' : ''
    );

    const config = new Config();
    expect(() => config.validateEvent()).toThrow();
  });
});
