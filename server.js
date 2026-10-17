'use strict';

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 4173;
const ROOT = __dirname;
const HUB_DIR = path.join(ROOT, 'dist');
const DIARY_DIR = path.join(ROOT, 'diary');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'entries.json');
const MAX_BODY_BYTES = 1024 * 1024;
// DNS 리바인딩과 다른 사이트의 요청(CSRF)을 막기 위해 허용할 Host와 Origin
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`, `${HOST}:${PORT}`]);
const ALLOWED_ORIGINS = new Set([...ALLOWED_HOSTS].map((host) => `http://${host}`));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
};

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, '[]\n', 'utf8');
  }
}

async function readEntries() {
  await ensureDataFile();
  const raw = await fs.readFile(DATA_FILE, 'utf8');
  const entries = JSON.parse(raw);
  return Array.isArray(entries) ? entries : [];
}

async function writeEntries(entries) {
  const tempFile = `${DATA_FILE}.tmp`;
  await fs.writeFile(tempFile, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
  await fs.rename(tempFile, DATA_FILE);
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('요청 크기가 너무 큽니다.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(Object.assign(new Error('올바른 JSON이 아닙니다.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function cleanEntry(body, current = {}) {
  const date = String(body.date || '').trim();
  const title = String(body.title || '').trim();
  const content = String(body.content || '').trim();
  const mood = String(body.mood || '평온').trim().slice(0, 12);
  const tags = Array.isArray(body.tags)
    ? body.tags.map((tag) => String(tag).trim().replace(/^#/, '')).filter(Boolean).slice(0, 8)
    : [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Object.assign(new Error('날짜를 확인해 주세요.'), { status: 400 });
  if (!title || title.length > 80) throw Object.assign(new Error('제목은 1~80자로 입력해 주세요.'), { status: 400 });
  if (!content || content.length > 20000) throw Object.assign(new Error('내용은 1~20,000자로 입력해 주세요.'), { status: 400 });
  const now = new Date().toISOString();
  return {
    id: current.id || crypto.randomUUID(),
    date,
    title,
    content,
    mood,
    tags,
    createdAt: current.createdAt || now,
    updatedAt: now
  };
}

async function handleApi(req, res, pathname) {
  if (req.method !== 'GET') {
    const origin = req.headers.origin;
    if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: '허용되지 않은 요청입니다.' });
    const contentType = String(req.headers['content-type'] || '');
    if (!contentType.startsWith('application/json')) return json(res, 415, { error: 'JSON 요청만 처리할 수 있습니다.' });
  }

  if (pathname === '/api/entries' && req.method === 'GET') {
    const entries = await readEntries();
    entries.sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt));
    return json(res, 200, { entries });
  }

  if (pathname === '/api/entries' && req.method === 'POST') {
    const entries = await readEntries();
    const entry = cleanEntry(await readBody(req));
    entries.push(entry);
    await writeEntries(entries);
    return json(res, 201, { entry });
  }

  const match = pathname.match(/^\/api\/entries\/([a-f0-9-]+)$/i);
  if (match && (req.method === 'PUT' || req.method === 'DELETE')) {
    const entries = await readEntries();
    const index = entries.findIndex((entry) => entry.id === match[1]);
    if (index < 0) return json(res, 404, { error: '일기를 찾을 수 없습니다.' });
    if (req.method === 'DELETE') {
      const [deleted] = entries.splice(index, 1);
      await writeEntries(entries);
      return json(res, 200, { entry: deleted });
    }
    entries[index] = cleanEntry(await readBody(req), entries[index]);
    await writeEntries(entries);
    return json(res, 200, { entry: entries[index] });
  }

  return json(res, 404, { error: '요청한 API를 찾을 수 없습니다.' });
}

async function serveFile(res, baseDir, relativePath) {
  const safePath = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
  const filePath = path.join(baseDir, safePath);
  if (!filePath.startsWith(baseDir)) throw Object.assign(new Error('올바르지 않은 경로입니다.'), { status: 403 });
  const data = await fs.readFile(filePath);
  res.writeHead(200, {
    'content-type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'content-length': data.length,
    'x-content-type-options': 'nosniff'
  });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  try {
    if (!ALLOWED_HOSTS.has(req.headers.host)) return json(res, 403, { error: '허용되지 않은 주소입니다.' });
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
    if (pathname === '/diary' || pathname === '/diary/') return await serveFile(res, DIARY_DIR, 'index.html');
    if (pathname.startsWith('/diary/')) return await serveFile(res, DIARY_DIR, pathname.slice('/diary/'.length));
    return await serveFile(res, HUB_DIR, pathname === '/' ? 'index.html' : pathname.slice(1));
  } catch (error) {
    if (error.code === 'ENOENT') return json(res, 404, { error: '파일을 찾을 수 없습니다.' });
    console.error(error);
    return json(res, error.status || 500, { error: error.message || '서버 오류가 발생했습니다.' });
  }
});

ensureDataFile().then(() => {
  server.listen(PORT, HOST, () => {
    console.log(`교실 도구함: http://${HOST}:${PORT}`);
    console.log(`일기 저장 파일: ${DATA_FILE}`);
  });
}).catch((error) => {
  console.error('데이터 폴더를 준비하지 못했습니다.', error);
  process.exitCode = 1;
});
