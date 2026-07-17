import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultData } from './src/seed.js';
import { todayKey } from './src/logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'focusflow.json');

function ensureSeed() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    const seed = defaultData();
    seed.activeDate = todayKey();
    fs.writeFileSync(DATA_FILE, JSON.stringify(seed, null, 2), 'utf8');
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

// Local JSON persistence. Registered FIRST in the plugins array so its
// middleware intercepts /api/data before any other plugin can touch it.
function dataApiPlugin() {
  return {
    name: 'focusflow-data-api',
    configureServer(server) {
      server.middlewares.use('/api/data', async (req, res) => {
        try {
          if (req.method === 'GET') {
            ensureSeed();
            const body = fs.readFileSync(DATA_FILE, 'utf8');
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.end(body);
            return;
          }
          if (req.method === 'PUT') {
            ensureSeed();
            const raw = await readBody(req);
            let parsed;
            try {
              parsed = JSON.parse(raw);
            } catch {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ ok: false, error: 'invalid JSON' }));
              return;
            }
            fs.writeFileSync(DATA_FILE, JSON.stringify(parsed, null, 2), 'utf8');
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ ok: true }));
            return;
          }
          res.statusCode = 405;
          res.end('Method Not Allowed');
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: false, error: String(err && err.message || err) }));
        }
      });
    },
  };
}

export default defineConfig({
  // dataApiPlugin MUST stay first (known env gotcha: register the persistence
  // middleware ahead of the framework plugin so /api/data is intercepted).
  plugins: [dataApiPlugin(), react()],
});
