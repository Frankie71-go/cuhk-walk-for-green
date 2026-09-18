/**
 * Walk for Green — 学长姐捷径投稿 · 云端后端
 *
 * 设计目标：给一个「公开读写」的后端，让 CUHK 同学打开同一张 HTML 链接就能
 * 看到彼此的投稿与点赞，零注册、零装 app（不依赖飞书，因为 CUHK 同学大多用
 * WhatsApp / 微信 / Telegram，不装飞书）。
 *
 * 部署形态：CloudBase 云函数（腾讯云开发）。也可直接 `node index.js` 本地测。
 * 数据存：CloudBase 云数据库集合 `wfg_tips`；无凭证时退回内存（仅本地测试用）。
 */

let cloud = null;
let db = undefined; // 懒加载，undefined = 尚未尝试；null = 加载失败
let collectionReady = false;

async function getDb() {
  if (typeof db !== 'undefined') return db;
  try {
    cloud = require('@cloudbase/node-sdk');
    const env = process.env.TCB_ENV || cloud.SYMBOL_CURRENT_ENV;
    const app = cloud.init({ env });
    db = app.database();
  } catch (e) {
    console.warn('[tips-backend] CloudBase 未配置，使用内存存储（仅本地测试）:', e.message);
    db = null;
  }
  return db;
}

// 首次使用时确保集合存在（幂等，已存在则忽略报错）
async function ensureCollection(database) {
  if (collectionReady) return;
  try {
    await database.createCollection('wfg_tips');
  } catch (e) {
    // 集合可能已存在，忽略
  }
  collectionReady = true;
}

// 本地内存兜底（无 CloudBase 凭证时）
let MEM = [];

function parseEvent(event) {
  // CloudBase 通过 API 网关 / HTTP 触发时，event 常见字段：
  // event.httpMethod, event.path, event.body, event.headers
  const method = (event.httpMethod || event.method || 'GET').toUpperCase();
  const path = event.path || event.pathname || '/tips';
  let body = event.body || '{}';
  if (typeof body === 'string') {
    try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; }
  } else if (body && typeof body === 'object') {
    // ok
  } else {
    body = {};
  }
  return { method, path, body };
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}

async function listTips() {
  const database = await getDb();
  if (database) {
    await ensureCollection(database);
    const res = await database.collection('wfg_tips').orderBy('ts', 'desc').limit(200).get();
    return res.data || [];
  }
  return MEM.slice();
}

async function createTip({ name, text, route }) {
  const tip = {
    id: 't' + Date.now() + Math.random().toString(36).slice(2, 7),
    name: name || '',
    text: text || '',
    route: route || '',
    up: 0,
    down: 0,
    ts: Date.now(),
  };
  const database = await getDb();
  if (database) {
    await ensureCollection(database);
    await database.collection('wfg_tips').add(tip);
    return tip;
  }
  MEM.unshift(tip);
  return tip;
}

async function voteTip(id, dir) {
  const database = await getDb();
  if (database) {
    await ensureCollection(database);
    const cmd = database.command;
    const inc = dir === 'up' ? { up: cmd.inc(1) } : { down: cmd.inc(1) };
    await database.collection('wfg_tips').where({ id }).update(inc);
    const r = await database.collection('wfg_tips').where({ id }).get();
    return (r.data && r.data[0]) || { id };
  }
  const tp = MEM.find((t) => t.id === id);
  if (tp) { if (dir === 'up') tp.up++; else tp.down++; }
  return tp || { id };
}

async function deleteTip(id) {
  const database = await getDb();
  if (database) {
    await ensureCollection(database);
    await database.collection('wfg_tips').where({ id }).remove();
    return { ok: true };
  }
  MEM = MEM.filter((t) => t.id !== id);
  return { ok: true };
}

async function handler(event) {
  // 预检
  if (event.httpMethod && event.httpMethod.toUpperCase() === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }
  const { method, path, body } = parseEvent(event);
  try {
    if (path === '/tips' && method === 'GET') {
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(await listTips()) };
    }
    if (path === '/tips' && method === 'POST') {
      const t = await createTip(body);
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(t) };
    }
    const m = path.match(/^\/tips\/([^/]+)\/vote$/);
    if (m && method === 'POST') {
      const t = await voteTip(m[1], body.dir);
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(t) };
    }
    const m2 = path.match(/^\/tips\/([^/]+)$/);
    if (m2 && method === 'DELETE') {
      await deleteTip(m2[1]);
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok: true }) };
    }
    return { statusCode: 404, headers: corsHeaders(), body: JSON.stringify({ error: 'not found', path }) };
  } catch (e) {
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: String((e && e.stack) || e) }) };
  }
}

// CloudBase 云函数入口
exports.main = async (event, context) => {
  return await handler(event);
};

// 本地测试：`node index.js` 起一个内存版 HTTP 服务（端口 3000）
if (require.main === module) {
  const http = require('http');
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', async () => {
      const event = { httpMethod: req.method, path: req.url, body: b };
      try {
        const r = await handler(event);
        res.writeHead(r.statusCode, r.headers);
        res.end(r.body);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e) }));
      }
    });
  });
  server.listen(3000, () => console.log('local tips server on http://localhost:3000 (in-memory)'));
}
