/**
 * 主进程运行日志。
 *
 * 按 UTC 日期切分 runtime-YYYY-MM-DD.log，只保留最近 7 天；写入串行排队，
 * 单次失败只打印到控制台，不影响游戏。也在此注册进程级兜底日志。
 */
import { appendFile, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

import { app } from 'electron';

const LOG_RETENTION_DAYS = 7;
const MAX_LOG_MESSAGE_LENGTH = 4000;

/** 运行日志目录：Windows 下为 %APPDATA%/SylvieGalGame/logs。 */
export function logDirectory(): string {
  return path.join(app.getPath('userData'), 'logs');
}

// 串行化日志写入，避免并发 appendFile / mkdir 交错；单次失败只打印到控制台，不影响游戏。
let logWriteQueue: Promise<void> = Promise.resolve();

/**
 * 追加一行运行日志。
 * 单条消息截断到 MAX_LOG_MESSAGE_LENGTH，换行替换为字面量 `\n`，保证一条记录只占一行。
 */
export function logLine(scope: string, level: string, message: string): void {
  const text =
    message.length > MAX_LOG_MESSAGE_LENGTH
      ? `${message.slice(0, MAX_LOG_MESSAGE_LENGTH)}…`
      : message;
  const timestamp = new Date();
  const day = timestamp.toISOString().slice(0, 10);
  const line = `${timestamp.toISOString()} [${level}] [${scope}] ${text.replace(/\r?\n/g, '\\n')}\n`;
  logWriteQueue = logWriteQueue
    .then(async () => {
      await mkdir(logDirectory(), { recursive: true });
      await appendFile(path.join(logDirectory(), `runtime-${day}.log`), line, 'utf8');
    })
    .catch((error: unknown) => {
      console.error('[日志] 写入失败', error);
    });
}

/** 按修改时间删除超过保留期的 runtime-*.log；目录不存在或不可读时静默跳过。 */
export async function cleanupOldLogs(): Promise<void> {
  const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  try {
    const entries = await readdir(logDirectory(), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !/^runtime-\d{4}-\d{2}-\d{2}\.log$/.test(entry.name)) continue;
      const file = path.join(logDirectory(), entry.name);
      const info = await stat(file).catch(() => null);
      if (info && info.mtimeMs < cutoff) await unlink(file).catch(() => undefined);
    }
  } catch {
    // 日志目录尚未创建或不可读，忽略。
  }
}

// 主进程兜底日志：未捕获异常与未处理 Promise 都落盘，便于排查打包环境问题。
process.on('uncaughtException', (error) => {
  logLine('main', 'error', error.stack ?? `${error.name}: ${error.message}`);
});
process.on('unhandledRejection', (reason) => {
  logLine(
    'main',
    'error',
    `未处理 Promise：${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`,
  );
});
