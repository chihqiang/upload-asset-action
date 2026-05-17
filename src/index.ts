import * as core from '@actions/core';
import * as github from '@actions/github';
import { GitHub } from '@actions/github/lib/utils';
import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

const info = core.info;
const warning = core.warning;
const error = core.error;
const success = (message: string) => core.info(`✅ ${message}`);
const step = (message: string) => core.info(`🚀 ${message}`);

interface Asset {
  name: string;
  browser_download_url: string;
}

interface Config {
  githubToken: string;
  tag: string;
  repo: string;
  releaseBody: string;
  eventName: string;
  ref: string;
}

// 解析 owner/repo
function parseRepo(repo: string): [owner: string, repoName: string] {
  const parts = repo.split('/');
  if (parts.length !== 2) {
    throw new Error(`Invalid repo format: ${repo}, expected "owner/repo"`);
  }
  return parts as [string, string];
}

// 检查路径是否包含通配符
function isGlobPattern(pattern: string): boolean {
  return pattern.includes('*') || pattern.includes('?') || pattern.includes('[');
}

// 展开通配符为文件列表（自动去重）
async function expandGlobFiles(patterns: string[]): Promise<string[]> {
  const files: string[] = [];
  const seen = new Set<string>();

  for (const pattern of patterns) {
    if (isGlobPattern(pattern)) {
      const matches = await glob(pattern, { nodir: true });
      if (matches.length === 0) {
        warning(`Glob pattern "${pattern}" matched no files`);
      } else {
        info(`Glob "${pattern}" matched ${matches.length} file(s): ${matches.join(', ')}`);
        for (const file of matches) {
          if (!seen.has(file)) {
            seen.add(file);
            files.push(file);
          }
        }
      }
    } else {
      if (!seen.has(pattern)) {
        seen.add(pattern);
        files.push(pattern);
      }
    }
  }
  return files;
}

// 获取需要上传的文件列表
async function getUploadFiles(): Promise<string[]> {
  const filesInput = core.getInput('files');
  const envFiles = process.env.GOBUILD_FILES?.split(/\s+/).filter(f => f.trim()) || [];
  const inputFiles = filesInput.split(/\s+/).filter(f => f.trim() !== '');
  const allFiles = [...inputFiles, ...envFiles];

  if (envFiles.length > 0) {
    info(`Additional files from GOBUILD_FILES: ${envFiles.join(', ')}`);
  }

  const files = await expandGlobFiles(allFiles);
  return files;
}

function getConfig(): Config {
  const githubToken = core.getInput('github_token') || process.env.GITHUB_TOKEN || '';
  const tag = core.getInput('tag') || process.env.GITHUB_REF_NAME || '';
  const repo = core.getInput('repo') || process.env.GITHUB_REPOSITORY || '';
  const releaseBody = core.getInput('release_body') || `chihqiang/upload-asset-action for ${tag}`;
  const eventName = process.env.GITHUB_EVENT_NAME || '';
  const ref = process.env.GITHUB_REF || '';

  if (!githubToken) {
    core.setFailed('github_token is required. Please set it via input or GITHUB_TOKEN environment variable');
    process.exit(1);
  }

  return {
    githubToken,
    tag,
    repo,
    releaseBody,
    eventName,
    ref,
  };
}

function validateEvent(config: Config): void {
  if (config.eventName !== 'release' && config.eventName !== 'push') {
    error(`Must be triggered by a 'release' or 'push' event, the current event is: ${config.eventName}`);
    process.exit(1);
  }

  if (config.eventName === 'push' && !config.ref.startsWith('refs/tags/')) {
    warning('Push event is not a tag push, skip uploading');
    process.exit(0);
  }
}

async function getOrCreateRelease(
  octokit: InstanceType<typeof GitHub>,
  repo: string,
  tag: string,
  releaseBody: string
): Promise<number> {
  const [owner, repoName] = parseRepo(repo);

  // Try to get existing release
  try {
    const response = await octokit.rest.repos.getReleaseByTag({
      owner,
      repo: repoName,
      tag,
    });
    info(`Found existing release with ID: ${response.data.id}`);
    return response.data.id;
  } catch (err: unknown) {
    const httpError = err as { status?: number };
    if (httpError.status !== 404) {
      throw err;
    }
  }

  // Create new release
  step('Creating new release...');
  const response = await octokit.rest.repos.createRelease({
    owner,
    repo: repoName,
    tag_name: tag,
    name: tag,
    body: releaseBody,
    draft: false,
    prerelease: false,
  });

  success(`Created release with ID: ${response.data.id}`);
  return response.data.id;
}

async function uploadAsset(
  octokit: InstanceType<typeof GitHub>,
  repo: string,
  releaseId: number,
  filePath: string
): Promise<Asset> {
  const [owner, repoName] = parseRepo(repo);
  const baseName = path.basename(filePath);

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  step(`Checking existing assets: ${baseName}`);

  // Find and delete existing asset with same name
  const assetsResponse = await octokit.rest.repos.listReleaseAssets({
    owner,
    repo: repoName,
    release_id: releaseId,
  });

  const existingAsset = assetsResponse.data.find(asset => asset.name === baseName);

  if (existingAsset) {
    await octokit.rest.repos.deleteReleaseAsset({
      owner,
      repo: repoName,
      asset_id: existingAsset.id,
    });
    success(`Deleted existing asset: ${baseName}`);
  }

  // Upload new asset
  step(`Uploading file: ${filePath}`);
  const fileContent = fs.readFileSync(filePath);

  const uploadResponse = await octokit.rest.repos.uploadReleaseAsset({
    owner,
    repo: repoName,
    release_id: releaseId,
    name: baseName,
    data: fileContent as unknown as string,
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': fileContent.length,
    },
  });

  const asset = uploadResponse.data as Asset;
  success(`Upload successful: ${baseName}`);
  success(`Download URL: ${asset.browser_download_url}`);

  return asset;
}

async function main(): Promise<void> {
  const config = getConfig();

  info(`GitHub Repository: ${config.repo}`);
  info(`Publish Tags: ${config.tag}`);

  validateEvent(config);

  // 获取需要上传的文件
  const files = await getUploadFiles();
  if (files.length === 0) {
    core.setFailed('No files to upload');
    return;
  }

  info(`Total files to upload: ${files.length}`);

  // Validate files exist
  for (const file of files) {
    if (!fs.existsSync(file)) {
      core.setFailed(`File not found: ${file}`);
      return;
    }
  }

  const octokit = github.getOctokit(config.githubToken);

  const releaseId = await getOrCreateRelease(
    octokit,
    config.repo,
    config.tag,
    config.releaseBody
  );

  success(`Successfully obtained Release ID ${releaseId}`);

  // 并发上传所有文件
  const results = await Promise.allSettled(
    files.map(file => uploadAsset(octokit, config.repo, releaseId, file))
  );

  const failed = results.filter(r => r.status === 'rejected');
  if (failed.length > 0) {
    core.setFailed(`${failed.length} file(s) failed to upload`);
    return;
  }

  // 设置输出
  const downloadUrls = (results as PromiseFulfilledResult<Asset>[])
    .map(r => r.value.browser_download_url);
  core.setOutput('download_urls', downloadUrls.join('\n'));

  success('All assets uploaded successfully!');
}

main();
