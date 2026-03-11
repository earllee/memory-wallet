import { getDb } from './db';
import { embedText, embeddingToBuffer } from './embeddings';

export interface SearchResult {
  chunkId: string;
  documentId: string;
  title: string;
  content: string;
  folder: string | null;
  modifiedAt: number;
  score: number;
  source: string;
}

interface SearchOptions {
  from?: number;   // unix timestamp lower bound
  to?: number;     // unix timestamp upper bound
  limit?: number;  // defaults to 10
}

interface RawSearchRow {
  chunk_id: string;
  document_id: string;
  source: string;
  title: string;
  content: string;
  source_id: string;
  score: number;
  modified_at: number;
  folder: string | null;
}

export function escapeFtsQuery(query: string): string {
  return query
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => `"${w.replace(/"/g, '')}"`)
    .join(' ');
}

function vectorSearch(queryEmbedding: Buffer, k: number, from?: number, to?: number): RawSearchRow[] {
  const db = getDb();

  // sqlite-vec requires a simple query for MATCH - do the join in a second step
  try {
    const vecRows = db.prepare(`
      SELECT chunk_id, distance as score
      FROM vec_document_chunks
      WHERE embedding MATCH ? AND k = ?
      ORDER BY distance
    `).all(queryEmbedding, k) as { chunk_id: string; score: number }[];

    if (vecRows.length === 0) return [];

    // Now join with document data
    const placeholders = vecRows.map(() => '?').join(',');
    let sql = `
      SELECT
        document_chunks.id as chunk_id,
        document_chunks.document_id,
        documents.source,
        documents.title,
        document_chunks.content,
        documents.source_id,
        documents.modified_at,
        json_extract(documents.metadata, '$.folder') as folder
      FROM document_chunks
      JOIN documents ON documents.id = document_chunks.document_id
      WHERE document_chunks.id IN (${placeholders})
    `;

    const params: any[] = vecRows.map((r) => r.chunk_id);

    if (from !== undefined) {
      sql += ` AND documents.modified_at >= ?`;
      params.push(from);
    }
    if (to !== undefined) {
      sql += ` AND documents.modified_at <= ?`;
      params.push(to);
    }

    const rows = db.prepare(sql).all(...params) as Omit<RawSearchRow, 'score'>[];

    // Merge distance scores back
    const scoreMap = new Map(vecRows.map((r) => [r.chunk_id, r.score]));
    return rows.map((r) => ({ ...r, score: scoreMap.get(r.chunk_id) ?? 1, source_id: '' }));
  } catch (err: any) {
    console.error('Vector search error:', err.message);
    return [];
  }
}

function ftsSearch(query: string, limit: number, from?: number, to?: number): RawSearchRow[] {
  const db = getDb();
  const ftsQuery = escapeFtsQuery(query);
  if (!ftsQuery) return [];

  let sql = `
    SELECT
      document_chunks.id as chunk_id,
      document_chunks.document_id,
      documents.source,
      documents.title,
      document_chunks.content,
      documents.source_id,
      bm25(fts_document_chunks) as score,
      documents.modified_at,
      json_extract(documents.metadata, '$.folder') as folder
    FROM fts_document_chunks
    JOIN document_chunks ON document_chunks.rowid = fts_document_chunks.rowid
    JOIN documents ON documents.id = document_chunks.document_id
    WHERE fts_document_chunks MATCH ?
  `;

  const params: (string | number)[] = [ftsQuery];

  if (from !== undefined) {
    sql += ` AND documents.modified_at >= ?`;
    params.push(from);
  }
  if (to !== undefined) {
    sql += ` AND documents.modified_at <= ?`;
    params.push(to);
  }

  sql += ` ORDER BY bm25(fts_document_chunks) LIMIT ?`;
  params.push(limit);

  try {
    return db.prepare(sql).all(...params) as RawSearchRow[];
  } catch (err: any) {
    console.error('FTS search error:', err.message);
    return [];
  }
}

export async function search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
  const limit = options.limit ?? 10;
  const { from, to } = options;

  // If query is empty or wildcard, browse by recency (no embedding needed)
  if (!query || query.trim() === '' || query.trim() === '*') {
    const db = getDb();
    const conditions: string[] = [];
    const params: any[] = [];

    if (from !== undefined) {
      conditions.push('documents.modified_at >= ?');
      params.push(from);
    }
    if (to !== undefined) {
      conditions.push('documents.modified_at <= ?');
      params.push(to);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Fetch extra rows to account for multi-chunk documents being deduplicated
    params.push(limit * 5);

    const rows = db.prepare(`
      SELECT
        document_chunks.id as chunk_id,
        document_chunks.document_id,
        documents.source,
        documents.title,
        document_chunks.content,
        documents.modified_at,
        json_extract(documents.metadata, '$.folder') as folder
      FROM document_chunks
      JOIN documents ON documents.id = document_chunks.document_id
      ${whereClause}
      ORDER BY documents.modified_at DESC
      LIMIT ?
    `).all(...params) as {
      chunk_id: string; document_id: string; source: string;
      title: string; content: string; modified_at: number; folder: string | null;
    }[];

    // Deduplicate by document_id, keep first (most recent) chunk
    const seen = new Set<string>();
    const results: SearchResult[] = [];

    for (const row of rows) {
      if (seen.has(row.document_id)) continue;
      seen.add(row.document_id);

      results.push({
        chunkId: row.chunk_id,
        documentId: row.document_id,
        title: row.title || '',
        content: row.content,
        folder: row.folder,
        modifiedAt: row.modified_at,
        score: 1,
        source: row.source,
      });

      if (results.length >= limit) break;
    }

    return results;
  }

  const k = 60; // RRF constant
  const candidates = limit * 2;

  // Generate query embedding
  const queryVector = await embedText(query, 'query');
  const queryEmbedding = embeddingToBuffer(queryVector);

  // Run both searches
  const vecResults = vectorSearch(queryEmbedding, candidates, from, to);
  const ftsResults = ftsSearch(query, candidates, from, to);

  // RRF fusion
  const SEMANTIC_WEIGHT = 0.6;
  const KEYWORD_WEIGHT = 0.4;

  const scores = new Map<string, { score: number; row: RawSearchRow }>();

  // Score vector results
  vecResults.forEach((row, rank) => {
    const rrfScore = SEMANTIC_WEIGHT / (k + rank);
    scores.set(row.chunk_id, { score: rrfScore, row });
  });

  // Score FTS results
  ftsResults.forEach((row, rank) => {
    const rrfScore = KEYWORD_WEIGHT / (k + rank);
    const existing = scores.get(row.chunk_id);
    if (existing) {
      existing.score += rrfScore;
    } else {
      scores.set(row.chunk_id, { score: rrfScore, row });
    }
  });

  // Sort by combined score descending
  const sorted = Array.from(scores.values()).sort((a, b) => b.score - a.score);

  // Deduplicate by document_id (keep best chunk per document)
  const seen = new Set<string>();
  const results: SearchResult[] = [];

  for (const entry of sorted) {
    if (seen.has(entry.row.document_id)) continue;
    seen.add(entry.row.document_id);

    results.push({
      chunkId: entry.row.chunk_id,
      documentId: entry.row.document_id,
      title: entry.row.title || '',
      content: entry.row.content,
      folder: entry.row.folder,
      modifiedAt: entry.row.modified_at,
      score: entry.score,
      source: entry.row.source,
    });

    if (results.length >= limit) break;
  }

  return results;
}

