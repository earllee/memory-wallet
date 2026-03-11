import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

// better-sqlite3 is a native module, use require
const Database = require('better-sqlite3');
import type BetterSqlite3 from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

const DB_PATH = path.join(__dirname, '..', 'data', 'memory-wallet.db');

let _db: BetterSqlite3.Database | null = null;

export function getDb(dbPath?: string): BetterSqlite3.Database {
  if (!dbPath && _db) return _db;

  const effectivePath = dbPath ?? DB_PATH;

  // Ensure data/ directory exists
  const dataDir = path.dirname(effectivePath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const db: BetterSqlite3.Database = new Database(effectivePath);

  // Load sqlite-vec extension
  sqliteVec.load(db);

  // Set pragmas
  db.pragma('busy_timeout = 30000');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      apple_id INTEGER UNIQUE,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      modified_at INTEGER NOT NULL,
      folder TEXT
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      source_id TEXT,
      title TEXT,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      modified_at INTEGER NOT NULL,
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS document_chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS vec_document_chunks USING vec0(
      chunk_id TEXT PRIMARY KEY,
      embedding FLOAT[768]
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS fts_document_chunks USING fts5(
      content,
      content='document_chunks',
      content_rowid='rowid'
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Create indexes (use IF NOT EXISTS)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_source_id ON documents(source, source_id);
    CREATE INDEX IF NOT EXISTS idx_documents_modified ON documents(modified_at DESC);
    CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id ON document_chunks(document_id);
    CREATE INDEX IF NOT EXISTS idx_notes_modified ON notes(modified_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notes_apple_id ON notes(apple_id);
  `);

  if (!dbPath) {
    _db = db;
  }
  return db;
}

/** @internal For testing — override the singleton DB instance */
export function _setTestDb(db: BetterSqlite3.Database | null): void {
  _db = db;
}

// --- Helper query functions ---

export function upsertNote(note: {
  appleId: number;
  title: string;
  content: string;
  createdAt: number;
  modifiedAt: number;
  folder: string | null;
}): string {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM notes WHERE apple_id = ?').get(note.appleId) as { id: string } | undefined;
  const id = existing?.id ?? uuidv4();

  db.prepare(`
    INSERT INTO notes (id, apple_id, title, content, created_at, modified_at, folder)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(apple_id) DO UPDATE SET
      title = excluded.title,
      content = excluded.content,
      created_at = excluded.created_at,
      modified_at = excluded.modified_at,
      folder = excluded.folder
  `).run(id, note.appleId, note.title, note.content, note.createdAt, note.modifiedAt, note.folder);

  return id;
}

export function upsertDocument(doc: {
  source: string;
  sourceId: string;
  title: string | null;
  content: string;
  createdAt: number;
  modifiedAt: number;
  metadata: Record<string, unknown> | null;
}, chunks: string[]): string {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM documents WHERE source = ? AND source_id = ?').get(doc.source, doc.sourceId) as { id: string } | undefined;
  const docId = existing?.id ?? uuidv4();
  const metadataJson = doc.metadata ? JSON.stringify(doc.metadata) : null;

  const upsertDoc = db.transaction(() => {
    if (existing) {
      // Delete old chunks (FTS needs manual cleanup)
      const oldChunks = db.prepare('SELECT rowid FROM document_chunks WHERE document_id = ?').all(docId) as { rowid: number }[];
      for (const chunk of oldChunks) {
        db.prepare('INSERT INTO fts_document_chunks(fts_document_chunks, rowid, content) VALUES(\'delete\', ?, ?)').run(
          chunk.rowid,
          db.prepare('SELECT content FROM document_chunks WHERE rowid = ?').get(chunk.rowid) as { content: string } | undefined
            ? (db.prepare('SELECT content FROM document_chunks WHERE rowid = ?').get(chunk.rowid) as { content: string }).content
            : ''
        );
      }
      db.prepare('DELETE FROM document_chunks WHERE document_id = ?').run(docId);

      // Update document
      db.prepare(`
        UPDATE documents SET title = ?, content = ?, created_at = ?, modified_at = ?, metadata = ?
        WHERE id = ?
      `).run(doc.title, doc.content, doc.createdAt, doc.modifiedAt, metadataJson, docId);
    } else {
      db.prepare(`
        INSERT INTO documents (id, source, source_id, title, content, created_at, modified_at, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(docId, doc.source, doc.sourceId, doc.title, doc.content, doc.createdAt, doc.modifiedAt, metadataJson);
    }

    // Insert new chunks
    const insertChunk = db.prepare('INSERT INTO document_chunks (id, document_id, chunk_index, content) VALUES (?, ?, ?, ?)');
    const insertFts = db.prepare('INSERT INTO fts_document_chunks (rowid, content) SELECT rowid, content FROM document_chunks WHERE id = ?');

    for (let i = 0; i < chunks.length; i++) {
      const chunkId = uuidv4();
      insertChunk.run(chunkId, docId, i, chunks[i]);
      insertFts.run(chunkId);
    }
  });

  upsertDoc();
  return docId;
}

export function deleteNoteByAppleId(appleId: number): void {
  const db = getDb();
  db.prepare('DELETE FROM notes WHERE apple_id = ?').run(appleId);
}

export function deleteDocumentBySource(source: string, sourceId: string): void {
  const db = getDb();
  const doc = db.prepare('SELECT id FROM documents WHERE source = ? AND source_id = ?').get(source, sourceId) as { id: string } | undefined;
  if (!doc) return;

  const deleteDoc = db.transaction(() => {
    // Clean up FTS
    const oldChunks = db.prepare('SELECT rowid, content FROM document_chunks WHERE document_id = ?').all(doc.id) as { rowid: number; content: string }[];
    for (const chunk of oldChunks) {
      db.prepare('INSERT INTO fts_document_chunks(fts_document_chunks, rowid, content) VALUES(\'delete\', ?, ?)').run(chunk.rowid, chunk.content);
    }
    db.prepare('DELETE FROM document_chunks WHERE document_id = ?').run(doc.id);
    db.prepare('DELETE FROM documents WHERE id = ?').run(doc.id);
  });

  deleteDoc();
}

export function getLocalNotes(): { appleId: number; modifiedAt: number }[] {
  const db = getDb();
  return db.prepare('SELECT apple_id as appleId, modified_at as modifiedAt FROM notes').all() as { appleId: number; modifiedAt: number }[];
}

export function getSyncState(key: string): string | undefined {
  const db = getDb();
  const row = db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSyncState(key: string, value: string): void {
  const db = getDb();
  db.prepare('INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export function getUnembeddedChunks(limit: number = 100): { id: string; content: string }[] {
  const db = getDb();
  return db.prepare(`
    SELECT document_chunks.id, document_chunks.content
    FROM document_chunks
    LEFT JOIN vec_document_chunks ON vec_document_chunks.chunk_id = document_chunks.id
    WHERE vec_document_chunks.chunk_id IS NULL
    LIMIT ?
  `).all(limit) as { id: string; content: string }[];
}

export function insertEmbedding(chunkId: string, embedding: Buffer): void {
  const db = getDb();
  db.prepare('INSERT INTO vec_document_chunks (chunk_id, embedding) VALUES (?, ?)').run(chunkId, embedding);
}
