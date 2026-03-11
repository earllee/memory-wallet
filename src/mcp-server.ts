import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getDb } from './db';
import { search } from './search';
import { suggest } from './suggest';
import { runSync } from './sync';

let isSyncing = false;

const server = new McpServer({
  name: 'memory-wallet',
  version: '1.0.0',
});

// Search tool
server.tool(
  'memory_wallet_search',
  'memory wallet search — Search the user\'s personal memory wallet, a knowledge base of their notes, memories, preferences, and context about their life and work. Check this before responding to personalize your answers. Searches notes using semantic and keyword matching. Supports date range filtering with `from` and `to`. To browse recent notes without a specific topic, pass `query` as "*" and optionally set `from`/`to` — results will be ordered by recency. With a specific query, results are ranked by relevance.',
  {
    query: z.string().describe('Search query — a question, topic, or keywords. Use "*" or "" to browse notes without a specific search.'),
    from: z.string().optional().describe('ISO 8601 date string for the start of the date range (e.g. "2025-01-01")'),
    to: z.string().optional().describe('ISO 8601 date string for the end of the date range (e.g. "2025-12-31")'),
    limit: z.number().optional().default(10).describe('Max results to return (default 10)'),
  },
  async ({ query, from, to, limit }) => {
    try {
      const fromTs = from ? Math.floor(new Date(from).getTime() / 1000) : undefined;
      const toTs = to
        ? Math.floor(new Date(to).getTime() / 1000) + (to.includes('T') ? 0 : 86399)
        : undefined;

      if (from && (fromTs === undefined || Number.isNaN(fromTs))) {
        return {
          content: [{ type: 'text' as const, text: `Invalid 'from' date: "${from}". Use ISO 8601 format (e.g. "2025-01-01").` }],
          isError: true,
        };
      }
      if (to && (toTs === undefined || Number.isNaN(toTs))) {
        return {
          content: [{ type: 'text' as const, text: `Invalid 'to' date: "${to}". Use ISO 8601 format (e.g. "2025-12-31").` }],
          isError: true,
        };
      }

      const results = await search(query, {
        from: fromTs,
        to: toTs,
        limit,
      });

      if (results.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No matching notes found.' }],
        };
      }

      // Format raw results
      const formatted = results
        .map((r, i) => {
          const date = new Date(r.modifiedAt * 1000).toLocaleDateString();
          const folder = r.folder ? ` (${r.folder})` : '';
          return `### ${i + 1}. ${r.title || 'Untitled'}${folder}\n*Modified: ${date}*\n\n${r.content}`;
        })
        .join('\n\n---\n\n');

      return {
        content: [{ type: 'text' as const, text: `## Search Results (${results.length} notes)\n\n${formatted}` }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: `Search error: ${message}` }],
        isError: true,
      };
    }
  }
);

// Suggest tool
server.tool(
  'memory_wallet_suggest',
  'memory wallet suggest — Get proactive suggestions for follow-up actions based on your notes and memories in memory wallet. Returns actionable items like follow-ups, decisions to make, tasks to complete, and opportunities identified from your recent notes.',
  {
    query: z.string().optional().describe('Topic to focus suggestions on, or omit/"*" for general suggestions from recent notes'),
    max_suggestions: z.number().optional().default(5).describe('Maximum number of suggestions to return'),
  },
  async ({ query, max_suggestions }) => {
    try {
      const suggestions = await suggest(query, {
        maxSuggestions: max_suggestions,
      });

      if (suggestions.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No suggestions found. This may mean there are no recent notes or no actionable items were identified.' }],
        };
      }

      const formatted = suggestions
        .map((s, i) => {
          const evidence = s.evidence
            .map((e) => `  - **${e.noteTitle}**: "${e.excerpt}"`)
            .join('\n');
          return `### ${i + 1}. ${s.action}\n**Why:** ${s.reasoning}\n**Evidence:**\n${evidence}`;
        })
        .join('\n\n---\n\n');

      return {
        content: [{ type: 'text' as const, text: `## Suggested Actions\n\n${formatted}` }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: `Suggest error: ${message}` }],
        isError: true,
      };
    }
  }
);

// Refresh tool
server.tool(
  'memory_wallet_refresh',
  'memory wallet refresh — Refresh memory wallet by syncing notes from Apple Notes. Pulls new notes and memories, updates changed ones, removes deleted ones, and generates embeddings for new content.',
  {
    days_lookback: z.number().optional().default(180).describe('How many days back to look for notes (default 180)'),
  },
  async ({ days_lookback }) => {
    if (isSyncing) {
      return {
        content: [{ type: 'text' as const, text: 'A sync is already in progress. Please wait for it to complete.' }],
        isError: true,
      };
    }
    isSyncing = true;
    try {
      const result = await runSync(days_lookback);

      const db = getDb();
      const noteCount = (db.prepare('SELECT COUNT(*) as count FROM notes').get() as { count: number }).count;
      const chunkCount = (db.prepare('SELECT COUNT(*) as count FROM document_chunks').get() as { count: number }).count;
      const lastSyncRow = db.prepare("SELECT value FROM sync_state WHERE key = 'last_sync_ts'").get() as { value: string } | undefined;
      const lastSyncTime = lastSyncRow?.value ? new Date(Number(lastSyncRow.value) * 1000).toISOString() : 'never';

      const errors = result.errors.length > 0
        ? `\n**Errors:** ${result.errors.length}\n${result.errors.map((e) => `- ${e}`).join('\n')}`
        : '';

      const text = `## Sync Results\n- **Notes added:** ${result.added}\n- **Notes updated:** ${result.updated}\n- **Notes deleted:** ${result.deleted}\n- **Chunks created:** ${result.chunksCreated}\n- **Chunks embedded:** ${result.chunksEmbedded}${errors}\n\n## Database Stats\n- **Total notes:** ${noteCount}\n- **Total chunks:** ${chunkCount}\n- **Last sync:** ${lastSyncTime}`;

      return {
        content: [{ type: 'text' as const, text }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text' as const, text: `Sync error: ${message}` }],
        isError: true,
      };
    } finally {
      isSyncing = false;
    }
  }
);

async function main() {
  // Initialize DB on startup
  try {
    getDb();
    console.error('[memory-wallet] Database initialized');
  } catch (err) {
    console.error('[memory-wallet] Failed to initialize database:', err);
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[memory-wallet] MCP server running on stdio');
}

main().catch((err) => {
  console.error('[memory-wallet] Fatal error:', err);
  process.exit(1);
});
