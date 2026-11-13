#!/usr/bin/env node
/**
 * 冒烟测试：启动已打包的桌面应用，通过 Chrome DevTools Protocol 驱动界面并截图。
 * 用法：node scripts/smoke-app.mjs [exe路径]
 */
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const EXE = path.resolve(
  process.argv[2] ?? path.join(ROOT, 'apps/electron/out/SylvieGalGame-win32-x64/SylvieGalGame.exe'),
);
const OUT = path.join(HERE, '.smoke');
const PORT = 9333;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url) {
  const response = await fetch(url);
  return response.json();
}

async function waitForTarget(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${PORT}/json/list`);
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // 端口尚未就绪
    }
    await sleep(250);
  }
  throw new Error('等待调试目标超时');
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

async function main() {
  await mkdir(OUT, { recursive: true });
  const errors = [];

  // 某些环境会导出 ELECTRON_RUN_AS_NODE=1，会让 Electron 以纯 Node 模式启动。
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(EXE, [`--remote-debugging-port=${PORT}`], {
    stdio: 'ignore',
    cwd: path.dirname(EXE),
    env,
  });
  child.on('error', (error) => errors.push(`spawn: ${error.message}`));

  let client;
  try {
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
      const file = path.join(OUT, `${String(index).padStart(2, '0')}-${name}.png`);
      await writeFile(file, Buffer.from(data, 'base64'));
      console.log(`截图：${path.relative(ROOT, file)}`);
    };

    const waitFor = async (expression, timeoutMs = 8000) => {
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

    const pressSpace = () =>
      evaluate(`(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
        return true;
      })()`);

    const state = () =>
      evaluate(`(() => ({
        view: document.querySelector('[data-view]')?.dataset.view ?? null,
        overlay: Boolean(document.querySelector('[class*="z-[100]"]')),
        choice: Boolean(document.querySelector('.z-30')),
        dialogue: document.querySelector('.z-20')?.textContent?.trim().slice(0, 160) ?? null,
        buttons: [...document.querySelectorAll('button')].map((item) => (item.textContent ?? '').trim()).filter(Boolean),
      }))()`);

    await waitFor(`Boolean(document.querySelector('[data-view]'))`);
    await waitFor(
      `[...document.querySelectorAll('button')].some((item) => (item.textContent ?? '').includes('开始新游戏') && !item.disabled)`,
    );
    await sleep(400);
    await shot('title');

    await clickButton('开始新游戏');
    await sleep(1200);
    await shot('first-line');

    await pressSpace();
    await sleep(600);
    await shot('second-line');

    // 回退：第二句 -> 第一句，验证历史快照与舞台恢复。
    const beforeRollback = await state();
    await evaluate(
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', code: 'PageUp', bubbles: true }))`,
    );
    await sleep(700);
    const afterRollback = await state();
    if (beforeRollback.dialogue === afterRollback.dialogue) throw new Error('PageUp 回退未生效');
    console.log('回退验证：', `${beforeRollback.dialogue} -> ${afterRollback.dialogue}`);
    await shot('rollback');

    // 推进到选项
    for (let step = 0; step < 40; step += 1) {
      const current = await state();
      if (current.choice) break;
      await pressSpace();
      await sleep(500);
    }
    const atChoice = await state();
    if (!atChoice.choice) throw new Error('未能到达选项界面');
    await shot('choice');
    console.log('选项按钮：', atChoice.buttons.filter((text) => text !== '◆').join(' | '));

    await clickButton('问她手中的那本书');
    await sleep(900);
    await shot('branch-text');

    for (let step = 0; step < 40; step += 1) {
      const current = await state();
      if (current.choice) break;
      await pressSpace();
      await sleep(500);
    }
    const secondChoice = await state();
    if (!secondChoice.choice) throw new Error('未能到达第二个选项界面');
    console.log('第二组选项：', secondChoice.buttons.filter((text) => text !== '◆').join(' | '));
    await clickButton('把刚才那段旋律哼给她听');
    await sleep(900);
    await shot('after-choice');

    await evaluate(
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))`,
    );
    await sleep(700);
    await shot('menu');

    await clickButton('继续游戏');
    await sleep(400);
    await clickButton('历史');
    await sleep(800);
    await shot('backlog');

    await clickButton('×');
    await sleep(500);

    const clickSlot = (title) =>
      evaluate(`(() => {
        const card = [...document.querySelectorAll('[role="button"]')].find((item) =>
          (item.textContent ?? '').includes(${JSON.stringify(title)}),
        );
        if (!card) return false;
        card.click();
        return true;
      })()`);

    // 清空槽位 01，避免覆盖已有存档时弹出会阻塞 CDP 的 window.confirm。
    await evaluate(`window.sylvieGame ? window.sylvieGame.storageDelete('save:slot:1') : null`);

    await clickButton('存档');
    await sleep(600);
    await shot('save-panel');
    if (!(await clickSlot('01'))) throw new Error('存档面板中未找到槽位 01');
    await sleep(1200);
    await shot('saved-slot');
    await clickButton('×');
    await sleep(500);

    await clickButton('读档');
    await sleep(900);
    await shot('load-panel');
    if (!(await clickSlot('01'))) throw new Error('读档面板中未找到槽位 01');
    await sleep(900);
    await shot('loaded');

    await evaluate(
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))`,
    );
    await sleep(600);
    await clickButton('设置');
    await sleep(800);
    await shot('settings');
    await clickButton('×');
    await sleep(400);

    console.log('\n最终状态：', JSON.stringify(await state()));

    if (errors.length > 0) {
      console.error(`\n发现 ${errors.length} 条运行时错误：`);
      for (const error of errors) console.error(`  - ${error}`);
      process.exitCode = 1;
    } else {
      console.log('\n运行期无错误。');
    }
  } finally {
    client?.close();
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // 进程已退出
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
