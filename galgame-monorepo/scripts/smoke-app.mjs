#!/usr/bin/env node
/**
 * 桌面端冒烟测试：启动已打包的 exe，通过 Chrome DevTools Protocol 驱动界面并截图。
 *
 * 流程：标题 → 开始新游戏 → 空格推进 → PageUp 回退 → 选项 → 存读档 → 设置，
 * 截图输出到 scripts/.smoke，并收集 console error / 未捕获异常 / Log error 统一报告。
 * 需要先执行 pnpm package；默认读取 apps/electron/out 下的免安装产物。
 *
 * 用法：node scripts/smoke-app.mjs [exe路径]
 */
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// EXE 可通过第一个参数覆盖；OUT 固定为 scripts/.smoke，与 Web 冒烟共用目录。
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

/** 轮询 /json/list 直到出现可调试的页面目标；超时抛错。 */
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

/**
 * 最小 CDP 客户端：在 WebSocket 上按 id 匹配请求与响应；
 * 没有 id 的事件消息交给 onMessage 监听器（用于收集 console / 异常）。
 */
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

/** 启动应用并按剧本路径驱动 UI；任何一步失败都会在 finally 中结束进程树。 */
async function main() {
  await mkdir(OUT, { recursive: true });
  // 运行期错误汇总：只记录，流程跑完后统一决定退出码，避免首个错误中断后续截图。
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

    // 在页面内执行表达式：awaitPromise + returnByValue 便于直接拿回 JSON 结果。
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

    // 截图按序号命名，保证文件顺序与操作顺序一致。
    let index = 0;
    const shot = async (name) => {
      index += 1;
      const { data } = await client.send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(OUT, `${String(index).padStart(2, '0')}-${name}.png`);
      await writeFile(file, Buffer.from(data, 'base64'));
      console.log(`截图：${path.relative(ROOT, file)}`);
    };

    /** 轮询表达式直到为真；用于等待渲染完成、按钮可用等界面状态。 */
    const waitFor = async (expression, timeoutMs = 8000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await evaluate(expression)) return true;
        await sleep(150);
      }
      throw new Error(`等待条件超时：${expression}`);
    };

    /** 按文本包含匹配并点击按钮；找不到返回 false，由调用方决定是否报错。 */
    const clickButton = (text) =>
      evaluate(`(() => {
        const button = [...document.querySelectorAll('button')].find((item) =>
          (item.textContent ?? '').includes(${JSON.stringify(text)}),
        );
        if (!button) return false;
        button.click();
        return true;
      })()`);

    /** 在 window 上派发空格 keydown，模拟玩家推进对话。 */
    const pressSpace = () =>
      evaluate(`(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
        return true;
      })()`);

    /** 抓取当前界面快照：视图、弹窗 / 选项是否出现、当前台词与可见按钮。 */
    const state = () =>
      evaluate(`(() => ({
        view: document.querySelector('[data-view]')?.dataset.view ?? null,
        overlay: Boolean(document.querySelector('[class*="z-[100]"]')),
        choice: Boolean(document.querySelector('.z-30')),
        dialogue: document.querySelector('.z-20')?.textContent?.trim().slice(0, 160) ?? null,
        buttons: [...document.querySelectorAll('button')].map((item) => (item.textContent ?? '').trim()).filter(Boolean),
      }))()`);

    const waitDialogueChange = async (previous, timeoutMs = 8000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const current = (await state()).dialogue;
        if (current && current !== previous) return current;
        await sleep(150);
      }
      return null;
    };
    const stableDialogue = async () => {
      let previous = null;
      for (let attempt = 0; attempt < 24; attempt += 1) {
        const current = (await state()).dialogue;
        if (current && current === previous) return current;
        previous = current;
        await sleep(250);
      }
      return previous;
    };
    const pressUntilDialogueChanges = async (previous) => {
      await pressSpace();
      let next = await waitDialogueChange(previous);
      if (next) return next;
      // 第一下可能只是补全打字，仍未推进；再按一次。
      await pressSpace();
      next = await waitDialogueChange(previous);
      if (!next) throw new Error('空格未能推进到下一句');
      return next;
    };

    await waitFor(`Boolean(document.querySelector('[data-view]'))`);
    await waitFor(
      `[...document.querySelectorAll('button')].some((item) => (item.textContent ?? '').includes('开始新游戏') && !item.disabled)`,
    );
    await sleep(400);
    await shot('title');

    await clickButton('开始新游戏');
    const firstLine = await stableDialogue();
    if (!firstLine) throw new Error('开始后没有出现对话');
    await shot('first-line');

    const secondLine = await pressUntilDialogueChanges(firstLine);
    console.log('推进验证：', `${firstLine.slice(0, 24)} -> ${secondLine.slice(0, 24)}`);
    await shot('second-line');

    // 回退：第二句 -> 第一句，验证历史快照与舞台恢复。
    await evaluate(
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', code: 'PageUp', bubbles: true }))`,
    );
    const changed = await waitDialogueChange(secondLine);
    if (!changed) throw new Error('PageUp 回退未生效');
    // 回退后台词会重新走打字机，等它稳定后再与第一句比较。
    const rolledBack = await stableDialogue();
    if (rolledBack !== firstLine) throw new Error(`PageUp 回退到了意外台词：${rolledBack}`);
    console.log('回退验证：', `${secondLine.slice(0, 24)} -> ${rolledBack.slice(0, 24)}`);
    await shot('rollback');

    // 推进到选项
    for (let step = 0; step < 120; step += 1) {
      const current = await state();
      if (current.choice) break;
      await pressSpace();
      await sleep(500);
    }
    const atChoice = await state();
    if (!atChoice.choice) throw new Error('未能到达选项界面');
    await shot('choice');
    console.log('选项按钮：', atChoice.buttons.filter((text) => text !== '◆').join(' | '));

    await clickButton('把十元硬币放进她手心');
    await sleep(900);
    await shot('branch-text');

    for (let step = 0; step < 120; step += 1) {
      const current = await state();
      if (current.choice) break;
      await pressSpace();
      await sleep(500);
    }
    const secondChoice = await state();
    if (!secondChoice.choice) throw new Error('未能到达第二个选项界面');
    console.log('第二组选项：', secondChoice.buttons.filter((text) => text !== '◆').join(' | '));
    await clickButton('把《回声》哼给她听');
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

    /** 点击存档卡槽（data-slot 为 "01" 这类两位编号）。 */
    const clickSlot = (title) =>
      evaluate(`(() => {
        const card = [...document.querySelectorAll('[data-slot]')].find(
          (item) => item.getAttribute('data-slot') === ${JSON.stringify(title)},
        );
        if (!card) return false;
        card.click();
        return true;
      })()`);

    // 先清空槽位 01：已有存档时播放器会弹应用内覆盖确认框，挡住后续自动化步骤。
    await evaluate(`window.sylvieGame ? window.sylvieGame.storageDelete('save:slot:1') : null`);

    await clickButton('存档');
    await sleep(600);
    await shot('save-panel');
    if (!(await clickSlot('01'))) throw new Error('存档面板中未找到槽位 01');
    await sleep(400);
    // 保存前会弹出备注输入框，确认后才写入。
    if (!(await clickButton('保存'))) throw new Error('未找到备注确认按钮');
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
    // 无论成功失败都断开 CDP，并结束应用进程树（/T 连同渲染进程一起终止）。
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
