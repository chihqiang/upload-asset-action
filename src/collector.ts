import * as core from '@actions/core';
import { glob } from 'glob';
import { info, warning } from './log';

/**
 * 文件收集器，支持 glob 通配符展开
 */
export class Collector {
  /** 收集所有需上传的文件列表 */
  async collect(): Promise<string[]> {
    // 从 input 和环境变量获取文件列表
    const filesInput = core.getInput('files');
    const envFiles = process.env.GOBUILD_FILES?.split(/\s+/).filter(f => f.trim()) || [];
    const inputFiles = filesInput.split(/\s+/).filter(f => f.trim() !== '');
    const allFiles = [...inputFiles, ...envFiles];

    if (envFiles.length > 0) {
      info(`Additional files from GOBUILD_FILES: ${envFiles.join(', ')}`);
    }

    return this.expandGlob(allFiles);
  }

  /** 判断是否包含通配符 */
  private isGlob(pattern: string): boolean {
    return pattern.includes('*') || pattern.includes('?') || pattern.includes('[');
  }

  /** 展开通配符为文件列表（自动去重） */
  private async expandGlob(patterns: string[]): Promise<string[]> {
    const files: string[] = [];
    const seen = new Set<string>();

    for (const pattern of patterns) {
      if (this.isGlob(pattern)) {
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
        // 非通配符路径直接加入
        if (!seen.has(pattern)) {
          seen.add(pattern);
          files.push(pattern);
        }
      }
    }
    return files;
  }
}
