import * as core from '@actions/core';
import { error, warning } from './log';

/**
 * 配置类，从 GitHub Actions 输入和环境变量读取参数
 */
export class Config {
  readonly githubToken: string;
  readonly tag: string;
  readonly repo: string;
  readonly releaseBody: string;
  readonly eventName: string;
  readonly ref: string;

  constructor() {
    // 从 input 或环境变量读取
    this.githubToken = core.getInput('github_token') || process.env.GITHUB_TOKEN || '';
    this.tag = core.getInput('tag') || process.env.GITHUB_REF_NAME || '';
    this.repo = core.getInput('repo') || process.env.GITHUB_REPOSITORY || '';
    this.releaseBody = core.getInput('release_body');
    this.eventName = process.env.GITHUB_EVENT_NAME || '';
    this.ref = process.env.GITHUB_REF || '';
  }

  /** 校验 github_token 必填 */
  validate(): void {
    if (!this.githubToken) {
      core.setFailed('github_token is required. Please set it via input or GITHUB_TOKEN environment variable');
      process.exit(1);
    }
  }

  /** 校验事件类型，仅支持 release 和 tag push */
  validateEvent(): void {
    if (this.eventName !== 'release' && this.eventName !== 'push') {
      error(`Must be triggered by a 'release' or 'push' event, the current event is: ${this.eventName}`);
      process.exit(1);
    }

    if (this.eventName === 'push' && !this.ref.startsWith('refs/tags/')) {
      warning('Push event is not a tag push, skip uploading');
      process.exit(0);
    }
  }

  /** 解析 owner/repo 格式 */
  parseRepo(): [owner: string, repoName: string] {
    const parts = this.repo.split('/');
    if (parts.length !== 2) {
      throw new Error(`Invalid repo format: ${this.repo}, expected "owner/repo"`);
    }
    return parts as [string, string];
  }
}
