import { readAppleNotes } from './apple-notes';
import { parseNoteData } from './proto-parser';
import { convertToMarkdown } from './markdown';
import { chunkText } from './chunker';
import {
  upsertNote,
  upsertDocument,
  deleteNoteByAppleId,
  deleteDocumentBySource,
  getLocalNotes,
  getUnembeddedChunks,
  insertEmbedding,
  setSyncState,
} from './db';
import { ensureModel, embedText, embeddingToBuffer } from './embeddings';

export interface SyncResult {
  added: number;
  updated: number;
  deleted: number;
  chunksCreated: number;
  chunksEmbedded: number;
  errors: string[];
}

export async function runSync(daysLookback: number = 180): Promise<SyncResult> {
  const result: SyncResult = {
    added: 0,
    updated: 0,
    deleted: 0,
    chunksCreated: 0,
    chunksEmbedded: 0,
    errors: [],
  };

  // 1. Read notes from Apple Notes
  const appleNotes = readAppleNotes(daysLookback);
  console.error(`Found ${appleNotes.length} notes from Apple Notes (last ${daysLookback} days)`);

  // 2. Build lookup maps
  const appleNotesMap = new Map(appleNotes.map((n) => [n.appleId, n]));

  const localNotes = getLocalNotes();
  const localNotesMap = new Map(localNotes.map((n) => [n.appleId, n.modifiedAt]));

  // 3. Compute diff
  const toAdd: number[] = [];
  const toUpdate: number[] = [];
  const toDelete: number[] = [];

  for (const [appleId, note] of appleNotesMap) {
    const localModifiedAt = localNotesMap.get(appleId);
    if (localModifiedAt === undefined) {
      toAdd.push(appleId);
    } else if (note.modifiedAt !== localModifiedAt) {
      toUpdate.push(appleId);
    }
  }

  for (const [localAppleId] of localNotesMap) {
    if (!appleNotesMap.has(localAppleId)) {
      toDelete.push(localAppleId);
    }
  }

  console.error(`Sync diff: ${toAdd.length} to add, ${toUpdate.length} to update, ${toDelete.length} to delete`);

  // 4. Process additions and updates
  for (const appleId of [...toAdd, ...toUpdate]) {
    const isNew = !localNotesMap.has(appleId);
    try {
      const note = appleNotesMap.get(appleId)!;

      // Parse protobuf and convert to markdown
      const parsed = parseNoteData(note.data);
      const markdown = convertToMarkdown(parsed);

      const title = note.title || 'Untitled';
      const folder = note.folder || null;

      // Upsert into notes table
      upsertNote({
        appleId: note.appleId,
        title,
        content: markdown,
        createdAt: note.createdAt,
        modifiedAt: note.modifiedAt,
        folder,
      });

      // Chunk content and upsert into documents table
      const chunks = chunkText(markdown);
      upsertDocument(
        {
          source: 'notes',
          sourceId: String(note.appleId),
          title,
          content: markdown,
          createdAt: note.createdAt,
          modifiedAt: note.modifiedAt,
          metadata: folder ? { folder } : null,
        },
        chunks
      );

      result.chunksCreated += chunks.length;
      if (isNew) {
        result.added++;
      } else {
        result.updated++;
      }
    } catch (err: any) {
      const action = isNew ? 'adding' : 'updating';
      const msg = `Error ${action} note ${appleId}: ${err.message}`;
      console.error(msg);
      result.errors.push(msg);
    }
  }

  // 5. Process deletions
  for (const appleId of toDelete) {
    try {
      deleteDocumentBySource('notes', String(appleId));
      deleteNoteByAppleId(appleId);
      result.deleted++;
    } catch (err: any) {
      const msg = `Error deleting note ${appleId}: ${err.message}`;
      console.error(msg);
      result.errors.push(msg);
    }
  }

  // 6. Embed unembedded chunks
  console.error('Ensuring embedding model is available...');
  await ensureModel();

  const failedChunkIds = new Set<string>();
  let unembedded = getUnembeddedChunks(100);
  while (unembedded.length > 0) {
    // Filter out permanently failed chunks
    const toEmbed = unembedded.filter((c) => !failedChunkIds.has(c.id));
    if (toEmbed.length === 0) break;

    console.error(`Embedding ${toEmbed.length} chunks...`);

    for (const chunk of toEmbed) {
      try {
        const embedding = await embedText(chunk.content, 'document');
        const buffer = embeddingToBuffer(embedding);
        insertEmbedding(chunk.id, buffer);
        result.chunksEmbedded++;
      } catch (err: any) {
        const msg = `Error embedding chunk ${chunk.id}: ${err.message}`;
        console.error(msg);
        result.errors.push(msg);
        failedChunkIds.add(chunk.id);
      }
    }

    unembedded = getUnembeddedChunks(100);
  }

  // 7. Record sync timestamp
  const now = Math.floor(Date.now() / 1000);
  setSyncState('last_sync_ts', String(now));

  console.error(
    `Sync complete: ${result.added} added, ${result.updated} updated, ${result.deleted} deleted, ` +
    `${result.chunksCreated} chunks created, ${result.chunksEmbedded} chunks embedded` +
    (result.errors.length > 0 ? `, ${result.errors.length} errors` : '')
  );

  return result;
}
