/**
 * dsh-thinking —— Host 侧：配置 schema + 读写路由。
 *
 * GET  /dsh-thinking/config   → { intervalSec, volume }
 * POST /dsh-thinking/config   → 通过 configEditor 把自己的这行配置持久化
 *
 * 浏览器端（client.js）在 设置 里渲染表单，并每次响铃前读取该配置。
 */
import z from '@deepseek-ai/schemastery';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** 自己的状态文件（DSH 配置的持久化走不通时用它兜底）。 */
function statePath() {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh');
  return join(home, 'dsh-thinking.config.json');
}

export const name = 'dsh-thinking';

export const Config = z.object({
  intervalSec: z.number().min(0.5).max(5.0).default(1.2)
    .description('滴滴声间隔（秒）：0.5 到 5.0，默认 1.2'),
  volume: z.number().min(0).max(1).default(0.08)
    .description('提示音音量：0 到 1，默认 0.08'),
});

function readBody(req, limit = 8 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function apply(ctx, config) {
  const state = Config(config ?? {});
  // 载入上次保存的值（状态文件优先）
  (async () => {
    try {
      const raw = await readFile(statePath(), 'utf8');
      const saved = JSON.parse(raw);
      if (Number.isFinite(Number(saved.intervalSec))) {
        state.intervalSec = Math.min(5, Math.max(0.5, Number(saved.intervalSec)));
      }
      if (Number.isFinite(Number(saved.volume))) {
        state.volume = Math.min(1, Math.max(0, Number(saved.volume)));
      }
    } catch {
      /* 没有状态文件就用默认值 */
    }
  })();

  const clamp = (v, lo, hi, fallback) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, n));
  };

  async function save(next) {
    const intervalSec = clamp(next.intervalSec, 0.5, 5.0, state.intervalSec);
    const volume = clamp(next.volume, 0, 1, state.volume);
    state.intervalSec = intervalSec;
    state.volume = volume;
    // 先写自己的状态文件：DSH 的 configEditor 在本 profile 可能不可用
    let persisted = false;
    try {
      const file = statePath();
      await mkdir(join(file, '..'), { recursive: true });
      const tmp = file + '.' + process.pid + '.tmp';
      await writeFile(tmp, JSON.stringify({ intervalSec, volume }, null, 2) + '\n', 'utf8');
      await rename(tmp, file);
      persisted = true;
    } catch (error) {
      ctx.logger?.warn?.('[dsh-thinking] 保存配置失败: ' + String(error));
    }
    return { saved: persisted, intervalSec, volume };
  }

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/dsh-thinking/config',
      handler: async (req, res) => {
        const send = (code, data) => {
          res.statusCode = code;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.setHeader('cache-control', 'no-store');
          res.end(JSON.stringify(data));
        };
        try {
          if (req.method === 'GET' || req.method === 'HEAD') {
            send(200, { intervalSec: state.intervalSec, volume: state.volume });
            return;
          }
          if (req.method === 'POST') {
            const raw = await readBody(req);
            let body = {};
            try { body = JSON.parse(raw || '{}'); } catch { send(400, { error: 'bad json' }); return; }
            const result = await save(body ?? {});
            send(200, result);
            return;
          }
          res.statusCode = 405;
          res.setHeader('allow', 'GET, HEAD, POST');
          res.end();
        } catch (error) {
          send(500, { error: String(error && error.message ? error.message : error) });
        }
      },
    }), 'dsh-thinking: config route');
  });
}
