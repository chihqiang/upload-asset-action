import * as core from '@actions/core';
import * as github from '@actions/github';
import fs from 'fs';
import { info, error, success } from './log';
import { Config } from './config';
import { Collector } from './collector';
import { Release } from './release';

/**
 * 入口：配置 → 收集文件 → 创建 release → 上传 assets
 */
async function main(): Promise<void> {
  try {
    // 1. 读取并校验配置
    const config = new Config();
    config.validate();

    info(`GitHub Repository: ${config.repo}`);
    info(`Publish Tags: ${config.tag}`);

    config.validateEvent();

    // 2. 收集需要上传的文件
    const files = await new Collector().collect();
    if (files.length === 0) {
      core.setFailed('No files to upload');
      return;
    }

    info(`Total files to upload: ${files.length}`);

    // 3. 校验文件是否存在
    for (const file of files) {
      if (!fs.existsSync(file)) {
        core.setFailed(`File not found: ${file}`);
        return;
      }
    }

    // 4. 获取 release，不存在则创建
    const octokit = github.getOctokit(config.githubToken);
    const [owner, repoName] = config.parseRepo();

    const release = new Release(octokit, owner, repoName, config.tag);
    await release.ensureRelease(config.releaseBody);

    // 5. 并发上传所有文件
    const assets = await release.uploadAll(files);
    if (assets.length === 0) return;

    // 6. 输出下载地址
    const downloadUrls = assets.map(a => a.browser_download_url);
    core.setOutput('download_urls', downloadUrls.join('\n'));

    success('All assets uploaded successfully!');
  } catch (err) {
    const message = (err as Error)?.message ?? err;
    error(message as string);
    core.setFailed(String(message));
  }
}

main();
