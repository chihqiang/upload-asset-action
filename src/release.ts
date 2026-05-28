import * as core from '@actions/core';
import { GitHub } from '@actions/github/lib/utils';
import fs from 'fs';
import path from 'path';
import { info, warning, error, success, step } from './log';

export interface Asset {
  name: string;
  browser_download_url: string;
}

/**
 * Release 管理，负责目标仓库的 tag 创建、release 创建、文件上传
 */
export class Release {
  private octokit: InstanceType<typeof GitHub>;
  private owner: string;
  private repoName: string;
  private tag: string;
  private releaseId!: number;

  constructor(octokit: InstanceType<typeof GitHub>, owner: string, repoName: string, tag: string) {
    this.octokit = octokit;
    this.owner = owner;
    this.repoName = repoName;
    this.tag = tag;
  }

  /**
   * 确保 release 存在：
   * 1. 按 tag 查找已有 release
   * 2. 没有则先创建 tag，再创建 release
   */
  async ensureRelease(releaseBody: string): Promise<number> {
    const existing = await this.getRelease();
    if (existing) {
      this.releaseId = existing;
    } else {
      await this.ensureTag();
      this.releaseId = await this.doCreate(releaseBody);
    }
    success(`Successfully obtained Release ID ${this.releaseId}`);
    return this.releaseId;
  }

  /** 并发上传所有文件，任一失败则终止 */
  async uploadAll(files: string[]): Promise<Asset[]> {
    const results = await Promise.allSettled(
      files.map(file => this.uploadAsset(file))
    );

    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length > 0) {
      for (const f of failed) {
        const reason = (f as PromiseRejectedResult).reason;
        error(`Upload failed: ${reason?.message ?? reason}`);
      }
      core.setFailed(`${failed.length} file(s) failed to upload`);
      return [];
    }

    return (results as PromiseFulfilledResult<Asset>[]).map(r => r.value);
  }

  /**
   * 确保目标仓库存在该 tag
   * 目标仓库可能没有该 tag，需要基于默认分支的最新 commit 创建
   */
  private async ensureTag(): Promise<void> {
    // 先检查 tag 是否已存在
    try {
      await this.octokit.rest.git.getRef({
        owner: this.owner,
        repo: this.repoName,
        ref: `tags/${this.tag}`,
      });
      info(`Tag "${this.tag}" already exists on ${this.owner}/${this.repoName}`);
      return;
    } catch (err: unknown) {
      const httpError = err as { status?: number };
      if (httpError.status !== 404) {
        throw new Error(`检查 tag 失败: ${(err as Error)?.message ?? err}`);
      }
    }

    // 取目标仓库默认分支的最新 commit 来打 tag
    step(`Creating tag "${this.tag}" on ${this.owner}/${this.repoName}...`);
    const { data: repo } = await this.octokit.rest.repos.get({
      owner: this.owner,
      repo: this.repoName,
    });
    const { data: ref } = await this.octokit.rest.git.getRef({
      owner: this.owner,
      repo: this.repoName,
      ref: `heads/${repo.default_branch}`,
    });
    await this.octokit.rest.git.createRef({
      owner: this.owner,
      repo: this.repoName,
      ref: `refs/tags/${this.tag}`,
      sha: ref.object.sha,
    });
    success(`Created tag "${this.tag}" on ${this.owner}/${this.repoName}`);
  }

  /** 按 tag 查找已有 release */
  private async getRelease(): Promise<number | null> {
    try {
      const response = await this.octokit.rest.repos.getReleaseByTag({
        owner: this.owner,
        repo: this.repoName,
        tag: this.tag,
      });
      info(`Found existing release with ID: ${response.data.id}`);
      return response.data.id;
    } catch (err: unknown) {
      const httpError = err as { status?: number };
      if (httpError.status !== 404) {
        throw new Error(`获取 release 失败: ${(err as Error)?.message ?? err}`);
      }
      return null;
    }
  }

  /** 创建 release，未传 release_body 时自动生成 release notes */
  private async doCreate(releaseBody: string): Promise<number> {
    let body = releaseBody;
    if (!body) {
      step('Generating release notes...');
      const notes = await this.octokit.rest.repos.generateReleaseNotes({
        owner: this.owner,
        repo: this.repoName,
        tag_name: this.tag,
      });
      body = notes.data.body;
      info(`Generated release notes:\n${body}`);
    }

    step('Creating new release...');
    const response = await this.octokit.rest.repos.createRelease({
      owner: this.owner,
      repo: this.repoName,
      tag_name: this.tag,
      name: this.tag,
      body,
      draft: false,
      prerelease: false,
    });

    success(`Created release with ID: ${response.data.id}`);
    return response.data.id;
  }

  /** 上传单个文件，先清理同名 asset，失败时指数退避重试 */
  private async uploadAsset(filePath: string): Promise<Asset> {
    const baseName = path.basename(filePath);

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    step(`Checking existing assets: ${baseName}`);

    // 查找同名 asset 并删除
    const assetsResponse = await this.octokit.rest.repos.listReleaseAssets({
      owner: this.owner,
      repo: this.repoName,
      release_id: this.releaseId,
    });

    const existingAsset = assetsResponse.data.find(asset => asset.name === baseName);

    if (existingAsset) {
      await this.octokit.rest.repos.deleteReleaseAsset({
        owner: this.owner,
        repo: this.repoName,
        asset_id: existingAsset.id,
      });
      success(`Deleted existing asset: ${baseName}`);
    }

    step(`Uploading file: ${filePath}`);
    const fileContent = fs.readFileSync(filePath);

    const uploadResponse = await this.withRetry(() => this.octokit.rest.repos.uploadReleaseAsset({
      owner: this.owner,
      repo: this.repoName,
      release_id: this.releaseId,
      name: baseName,
      data: fileContent as unknown as string,
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': fileContent.length,
      },
    }));

    const asset = uploadResponse.data as Asset;
    success(`Upload successful: ${baseName}`);
    success(`Download URL: ${asset.browser_download_url}`);

    return asset;
  }

  /** 指数退避重试（1s → 2s → 4s），最多 3 次 */
  private async withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        warning(`Upload failed (attempt ${attempt}/${maxRetries}): ${(err as Error)?.message ?? err}`);
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt - 1) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    throw new Error(`上传失败，已重试 ${maxRetries} 次: ${(lastError as Error)?.message ?? lastError}`);
  }
}
