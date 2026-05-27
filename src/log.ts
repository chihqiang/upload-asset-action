import * as core from '@actions/core';

// 日志工具，统一输出格式
export const info = core.info;
export const warning = core.warning;
export const error = core.error;
export const success = (message: string) => core.info(`✅ ${message}`);
export const step = (message: string) => core.info(`🚀 ${message}`);
