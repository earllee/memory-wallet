import express from 'express';
import path from 'path';
import { getDb } from '../db';

const app = express();
const PORT = 3456;

const PROJECT_ROOT = path.join(__dirname, '..', '..');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// GET /api/status
app.get('/api/status', (_req, res) => {
  const db = getDb();
  const noteCount = (db.prepare('SELECT COUNT(*) as count FROM notes').get() as { count: number }).count;
  const chunkCount = (db.prepare('SELECT COUNT(*) as count FROM document_chunks').get() as { count: number }).count;
  const lastSyncRow = db.prepare("SELECT value FROM sync_state WHERE key = 'last_sync_ts'").get() as { value: string } | undefined;
  const lastSyncTime = lastSyncRow?.value ?? null;

  res.json({ noteCount, chunkCount, lastSyncTime });
});

// GET /api/config
app.get('/api/config', (_req, res) => {
  res.json({
    projectPath: PROJECT_ROOT,
    nodePath: process.execPath,
  });
});

// GET /api/notes
app.get('/api/notes', (_req, res) => {
  const db = getDb();
  const notes = db.prepare(`
    SELECT id, title, json_extract(metadata, '$.folder') as folder, modified_at,
      (SELECT COUNT(*) FROM document_chunks WHERE document_id = documents.id) as chunk_count
    FROM documents ORDER BY modified_at DESC
  `).all();
  res.json(notes);
});

app.listen(PORT, () => {
  console.log(`Memory Wallet UI running at http://localhost:${PORT}`);
});
