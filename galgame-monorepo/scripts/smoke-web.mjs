#!/usr/bin/env node
/**
 * Web 冒烟测试：构建 Web 产物、启动 vite preview，用无头 Chrome 通过 CDP 跑
 * 标题 → 推进 → 存读档 → 选项 → 分支，并截图到 scripts/.smoke。
 *
 * 用法：node scripts/smoke-web.mjs [--url http://localhost:5176/]
 * 可用 CHROME_PATH 指定浏览器；默认探测 Chrome / Edge / Chromium。
 * 每次运行使用临时浏览器 profile，结束后删除，不污染本机浏览器数据。
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

/** 按 CHROME_PATH → 常见安装路径 → PATH 的顺序探测可执行浏览器。 */
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

/** 轮询直到 URL 返回成功响应，用于等待 vite preview 就绪。 */
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

/** 轮询 Chrome 的调试端口直到出现页面目标；超时抛错。 */
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

/**
 * 最小 CDP 客户端：按 id 匹配请求响应，无 id 的事件消息交给 onMessage 监听器。
 * 与 smoke-app.mjs 中的实现保持一致，只是连接对象不同。
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

/** Windows 下 pnpm 是 .cmd，必须经 cmd.exe /c 调用；含空格的参数手动补引号。 */
function pnpmCommand(args) {
  const command = [pnpm, ...args]
    .map((part) => (/\s/.test(part) ? `"${part}"` : part))
    .join(' ');
  return { file: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', command] };
}

/** 同步执行 pnpm 命令，输出直接继承到当前终端（构建日志可见）。 */
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

/**
 * 后台启动 pnpm 命令。
 * POSIX 下 detached 让 preview 拥有独立进程组，stopProcess 才能一次结束子进程。
 */
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

/** Windows 用 taskkill /T /F 结束进程树；POSIX 先杀进程组，失败再杀单个进程。 */
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

/** 构建 → 启动 preview → 启动无头浏览器 → 按剧本驱动 UI；finally 清理所有子进程。 */
async function main() {
  await mkdir(OUT, { recursive: true });
  // 临时 profile 确保每次都是干净存档；结束时连同缓存一起删除。
  const profile = await mkdtemp(path.join(os.tmpdir(), 'sylvie-smoke-web-'));
  // 运行期错误汇总：流程跑完后统一决定退出码，避免首个错误中断后续截图。
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

    // 无头模式 + 固定窗口尺寸 + 独立调试端口；--no-sandbox 便于在 CI / 容器中运行。
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

    // 截图按序号命名并加 web- 前缀，与桌面端冒烟截图区分。
    let index = 0;
    const shot = async (name) => {
      index += 1;
      const { data } = await client.send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(OUT, `web-${String(index).padStart(2, '0')}-${name}.png`);
      await writeFile(file, Buffer.from(data, 'base64'));
      console.log(`截图：${path.relative(ROOT, file)}`);
    };

    /** 轮询表达式直到为真；用于等待渲染完成、按钮可用等界面状态。 */
    const waitFor = async (expression, timeoutMs = 15000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await evaluate(expression)) return true;
        await sleep(150);
      }
      throw new Error(`等待条件超时：${expression}`);
    };

    /** 按文本包含匹配并点击按钮；找不到返回 false。 */
    const clickButton = (text) =>
      evaluate(`(() => {
        const button = [...document.querySelectorAll('button')].find((item) =>
          (item.textContent ?? '').includes(${JSON.stringify(text)}),
        );
        if (!button) return false;
        button.click();
        return true;
      })()`);

    /** 点击选项区域（aria-label="选择"）的第一个按钮。 */
    const clickFirstChoice = () =>
      evaluate(`(() => {
        const button = document.querySelector('[aria-label="选择"] button');
        if (!button) return false;
        button.click();
        return true;
      })()`);

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

    /** 在 window 上派发空格 keydown，模拟玩家推进对话。 */
    const pressSpace = () =>
      evaluate(
        `window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }))`,
      );

    /** 抓取当前界面快照：视图、弹窗文字、选项是否出现、当前台词与可见按钮。 */
    const state = () =>
      evaluate(`(() => ({
        view: document.querySelector('[data-view]')?.dataset.view ?? null,
        dialog: [...document.querySelectorAll('[role="dialog"]')].map((item) => (item.textContent ?? '')).join('\\n'),
        choice: Boolean(document.querySelector('[aria-label="选择"]')),
        dialogue: document.querySelector('.z-20')?.textContent?.trim().slice(0, 160) ?? null,
        buttons: [...document.querySelectorAll('button')].map((item) => (item.textContent ?? '').trim()).filter(Boolean),
      }))()`);

    /** 轮询到同一句台词连续两次一致，规避打字机动画造成的状态抖动。 */
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
    // React 受控输入不响应直接赋值，需调用原型上的 value setter 再派发 input 事件。
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

    // 沿 book 路线推进到旧音乐教室，验证小游戏入口与结果回写。
    let reachedEchoChoice = false;
    for (let step = 0; step < 100; step += 1) {
      const current = await state();
      if (current.choice) {
        const options = await evaluate(
          `[...document.querySelectorAll('[aria-label="选择"] button')].map((item) => (item.textContent ?? '').trim())`,
        );
        if (options.some((text) => text.includes('八个音'))) {
          reachedEchoChoice = true;
          break;
        }
        await clickFirstChoice();
        await sleep(500);
        continue;
      }
      await pressSpace();
      await sleep(260);
    }
    if (!reachedEchoChoice) throw new Error('未能到达回声小游戏入口');
    await shot('minigame-choice');

    const openedEcho = await evaluate(`(() => {
      const button = [...document.querySelectorAll('[aria-label="选择"] button')].find((item) =>
        (item.textContent ?? '').includes('八个音'),
      );
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!openedEcho) throw new Error('无法进入回声小游戏');
    await waitFor(`Boolean(document.querySelector('[aria-label^="小游戏"]'))`);
    await waitFor(`Boolean(document.querySelector('[aria-label^="小游戏"] canvas'))`);
    await sleep(400);
    await shot('minigame');

    // 点击画布中央开始演示；之后用 CDP 原生键盘事件按回八个音。
    await client.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: 640,
      y: 300,
      button: 'left',
      clickCount: 1,
    });
    await client.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: 640,
      y: 300,
      button: 'left',
      clickCount: 1,
    });
    await sleep(6400);

    const dispatchKey = async (key, code, keyCode) => {
      await client.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key,
        code,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode,
      });
      await client.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key,
        code,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode,
      });
    };

    // 旋律 [0, 2, 1, 3, 1, 2, 0, 1] 对应界面数字 1、3、2、4、2、3、1、2。
    const echoKeys = [
      ['1', 'Digit1', 49],
      ['3', 'Digit3', 51],
      ['2', 'Digit2', 50],
      ['4', 'Digit4', 52],
      ['2', 'Digit2', 50],
      ['3', 'Digit3', 51],
      ['1', 'Digit1', 49],
      ['2', 'Digit2', 50],
    ];
    for (const [key, code, keyCode] of echoKeys) {
      await dispatchKey(key, code, keyCode);
      await sleep(360);
    }

    await waitFor(`!document.querySelector('[aria-label^="小游戏"]')`, 20000);
    await sleep(500);
    const afterMinigame = await state();
    if (!afterMinigame.dialogue?.includes('一个都没听错')) {
      throw new Error(`小游戏结果未接入剧情分支：${afterMinigame.dialogue ?? '(无对话)'}`);
    }
    await shot('minigame-result');
    console.log('小游戏验证：', afterMinigame.dialogue.slice(0, 80));

    if (errors.length > 0) {
      console.error(`\n发现 ${errors.length} 条运行时错误：`);
      for (const error of errors) console.error(`  - ${error}`);
      process.exitCode = 1;
    } else {
      console.log('\nWeb 冒烟通过，运行期无错误。');
    }
  } finally {
    // 清理顺序：断开 CDP → 结束浏览器 → 结束 preview → 删除临时 profile。
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
