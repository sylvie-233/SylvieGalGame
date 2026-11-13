#!/usr/bin/env node
/**
 * Web 冒烟测试：构建 Web 产物、启动 vite preview，用无头 Chrome 跑
 * 标题 → 推进 → 选项 → 存读档，并截图到 scripts/.smoke。
 *
 * 用法：node scripts/smoke-web.mjs [--url http://localhost:5176/]
 * 可用 CHROME_PATH 指定浏览器；默认探测 Chrome / Edge / Chromium。
 */
import { execFileSync, spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(HERE, '.smoke');
const PORT = 5176;
const DEBUG_PORT = 9341;
const URL = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : `http://localhost:${PORT}/`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates =
    process.platform === 'win32'
      ? [
          'C:/Program Files/Google/Chrome/Application/chrome.exe',
          'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
          'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
          'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          ]
        : [];
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // 继续探测
    }
  }
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try {
      const found = execFileSync('which', [name], { encoding: 'utf8' }).trim();
      if (found) return found;
    } catch {
      // 继续探测
    }
  }
  throw new Error('未找到 Chrome / Edge / Chromium，请设置 CHROME_PATH');
}

async function waitForHttp(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // 服务尚未就绪
    }
    await sleep(250);
  }
  throw new Error(`等待 Web 服务超时：${url}`);
}

async function fetchJson(url) {
  const response = await fetch(url);
  return response.json();
}

async function waitForTarget(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // 端口尚未就绪
    }
    await sleep(250);
  }
  throw new Error('等待 Chrome 调试目标超时');
}

function createClient(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  const listeners = [];
  let nextId = 1;

  const opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
      return;
    }
    for (const listener of listeners) listener(message);
  });

  return {
    opened,
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    onMessage(listener) {
      listeners.push(listener);
    },
    close() {
      socket.close();
    },
  };
}

function pnpmCommand(args) {
  const command = [pnpm, ...args]
    .map((part) => (/\s/.test(part) ? `"${part}"` : part))
    .join(' ');
  return { file: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', command] };
}

function execPnpm(args) {
  if (process.platform === 'win32') {
    const { file, args: commandArgs } = pnpmCommand(args);
    execFileSync(file, commandArgs, {
      cwd: ROOT,
      stdio: 'inherit',
      windowsVerbatimArguments: true,
    });
    return;
  }
  execFileSync(pnpm, args, { cwd: ROOT, stdio: 'inherit' });
}

function spawnPnpm(args) {
  if (process.platform === 'win32') {
    const { file, args: commandArgs } = pnpmCommand(args);
    return spawn(file, commandArgs, {
      cwd: ROOT,
      stdio: 'ignore',
      windowsVerbatimArguments: true,
    });
  }
  return spawn(pnpm, args, { cwd: ROOT, stdio: 'ignore', detached: true });
}

function stopProcess(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // 进程已退出
    }
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // 进程已退出
    }
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const profile = await mkdtemp(path.join(os.tmpdir(), 'sylvie-smoke-web-'));
  const errors = [];
  let server;
  let chrome;
  let client;

  try {
    console.log('构建 Web 产物…');
    execPnpm(['--filter', '@sylvie/web', 'build']);

    try {
      await access(path.join(ROOT, 'apps/web/dist/index.html'));
    } catch {
      throw new Error('apps/web/dist/index.html 不存在，构建可能失败');
    }

    server = spawnPnpm([
      '--filter',
      '@sylvie/web',
      'preview',
      '--port',
      String(PORT),
      '--strictPort',
    ]);
    server.on('error', (error) => errors.push(`preview: ${error.message}`));
    await waitForHttp(URL);

    const executable = findChrome();
    chrome = spawn(
      executable,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--window-size=1280,720',
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=${profile}`,
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    chrome.on('error', (error) => errors.push(`chrome: ${error.message}`));

    const target = await waitForTarget();
    client = createClient(target.webSocketDebuggerUrl);
    await client.opened;
    client.onMessage((message) => {
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        errors.push(
          `console: ${message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ')}`,
        );
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails;
        errors.push(`exception: ${details.exception?.description ?? details.text}`);
      }
      if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
        errors.push(`log: ${message.params.entry.text}`);
      }
    });

    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Log.enable');

    const evaluate = async (expression) => {
      const result = await client.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text ?? 'evaluate 失败');
      }
      return result.result.value;
    };

    let index = 0;
    const shot = async (name) => {
      index += 1;
      const { data } = await client.send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(OUT, `web-${String(index).padStart(2, '0')}-${name}.png`);
      await writeFile(file, Buffer.from(data, 'base64'));
      console.log(`截图：${path.relative(ROOT, file)}`);
    };

    const waitFor = async (expression, timeoutMs = 15000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await evaluate(expression)) return true;
        await sleep(150);
      }
      throw new Error(`等待条件超时：${expression}`);
    };

    const clickButton = (text) =>
      evaluate(`(() => {
        const button = [...document.querySelectorAll('button')].find((item) =>
          (item.textContent ?? '').includes(${JSON.stringify(text)}),
        );
        if (!button) return false;
        button.click();
        return true;
      })()`);

    const clickFirstChoice = () =>
      evaluate(`(() => {
        const button = document.querySelector('[aria-label="选择"] button');
        if (!button) return false;
        button.click();
        return true;
      })()`);

    const clickSlot = (title) =>
      evaluate(`(() => {
        const card = [...document.querySelectorAll('[data-slot]')].find(
          (item) => item.getAttribute('data-slot') === ${JSON.stringify(title)},
        );
        if (!card) return false;
        card.click();
        return true;
      })()`);

    const pressSpace = () =>
      evaluate(
        `window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }))`,
      );

    const state = () =>
      evaluate(`(() => ({
        view: document.querySelector('[data-view]')?.dataset.view ?? null,
        dialog: [...document.querySelectorAll('[role="dialog"]')].map((item) => (item.textContent ?? '')).join('\\n'),
        choice: Boolean(document.querySelector('[aria-label="选择"]')),
        dialogue: document.querySelector('.z-20')?.textContent?.trim().slice(0, 160) ?? null,
        buttons: [...document.querySelectorAll('button')].map((item) => (item.textContent ?? '').trim()).filter(Boolean),
      }))()`);

    const stableDialogue = async () => {
      let previous = null;
      for (let attempt = 0; attempt < 24; attempt += 1) {
        const current = (await state()).dialogue;
        if (current !== null && current === previous) return current;
        previous = current;
        await sleep(250);
      }
      return previous;
    };

    await client.send('Page.navigate', { url: URL });
    await waitFor(`Boolean(document.querySelector('[data-view]'))`);
    await waitFor(
      `[...document.querySelectorAll('button')].some((item) => (item.textContent ?? '').includes('开始新游戏') && !item.disabled)`,
    );
    await sleep(500);
    await shot('title');

    if (!(await clickButton('开始新游戏'))) throw new Error('无法开始新游戏');
    await sleep(1200);
    await shot('first-line');
    const first = await stableDialogue();
    if (!first) throw new Error('开始后没有出现对话');

    await pressSpace();
    await sleep(600);
    const second = await stableDialogue();
    if (!second || second === first) throw new Error('空格未能推进到下一句');
    await shot('second-line');
    console.log('推进验证：', `${first.slice(0, 24)} -> ${second.slice(0, 24)}`);

    // 清空槽位 01，避免覆盖确认框打断自动化。
    await evaluate(`window.sylvieWeb.storageDelete('save:slot:1')`);
    if (!(await clickButton('存档'))) throw new Error('未找到存档按钮');
    await sleep(600);
    await shot('save-panel');
    if (!(await clickSlot('01'))) throw new Error('存档面板中未找到槽位 01');
    await sleep(400);
    // 新的保存流程会弹出备注输入框，填写后确认才写入。
    const noteValue = await evaluate(`(() => {
      const input = document.querySelector('input[type="text"]');
      if (!input) return null;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, '冒烟备注');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return input.value;
    })()`);
    if (noteValue !== '冒烟备注') throw new Error('备注输入框不可用');
    if (!(await clickButton('保存'))) throw new Error('未找到备注确认按钮');
    await sleep(1200);
    await shot('saved-slot');
    const savedPanel = await state();
    if (!savedPanel.dialog.includes('冒烟备注')) {
      throw new Error('保存后未显示自定义备注');
    }
    const keys = await evaluate('window.sylvieWeb.storageKeys()');
    if (!keys.includes('save:slot:1')) throw new Error('存档未写入 save:slot:1');
    await clickButton('×');
    await sleep(400);

    if (!(await clickButton('读档'))) throw new Error('未找到读档按钮');
    await sleep(700);
    if (!(await clickSlot('01'))) throw new Error('读档面板中未找到槽位 01');
    await sleep(900);
    const loaded = await state();
    if (loaded.view !== 'game' || loaded.dialog.includes('读取进度')) {
      throw new Error('读档后未回到游戏画面');
    }
    await shot('loaded');
    console.log('存读档验证通过。');

    // 推进到选项并选择第一项。
    for (let step = 0; step < 40; step += 1) {
      const current = await state();
      if (current.choice) break;
      await pressSpace();
      await sleep(450);
    }
    const atChoice = await state();
    if (!atChoice.choice) throw new Error('未能到达选项界面');
    await shot('choice');
    const optionButtons = await evaluate(
      `[...document.querySelectorAll('[aria-label="选择"] button')].map((item) => (item.textContent ?? '').trim())`,
    );
    console.log('选项按钮：', optionButtons.join(' | '));
    if (!(await clickFirstChoice())) throw new Error('无法选择选项');
    await sleep(900);
    await shot('branch');
    const branch = await state();
    if (branch.choice || !branch.dialogue) throw new Error('选择后未进入分支剧情');
    console.log('分支验证：', branch.dialogue.slice(0, 80));

    if (errors.length > 0) {
      console.error(`\n发现 ${errors.length} 条运行时错误：`);
      for (const error of errors) console.error(`  - ${error}`);
      process.exitCode = 1;
    } else {
      console.log('\nWeb 冒烟通过，运行期无错误。');
    }
  } finally {
    client?.close();
    stopProcess(chrome);
    stopProcess(server);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
