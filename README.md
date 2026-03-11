# Memory Wallet

Local-first memory layer for Claude — imports Apple Notes, embeds them locally, and exposes semantic search and proactive suggestions via MCP.

## Quick Start

**Prerequisites:**
- macOS
- Apple Notes (with actual notes in it)
- Node.js 20+

```bash
git clone <repo-url> && cd memory-wallet
npm install --omit=dev
npm run ui         # Open dashboard at localhost:3456
```

## Connect to Claude Desktop

1. Run `npm run ui` and open the dashboard at `localhost:3456`
2. Copy the **MCP config** (includes `ANTHROPIC_API_KEY` env var) into your Claude Desktop config (`~/Library/Application\ Support/Claude/claude_desktop_config.json`)
3. Follow the **Full Disk Access** instructions on the dashboard to grant your **Node.js binary** access — so Claude Desktop can read Apple Notes
4. Copy the **User Preferences** blurb from the dashboard into Claude Desktop (Settings → General → personal preferences) so Claude proactively searches your notes
5. Open Claude Desktop and say **"Refresh my memory-wallet"** — this will import your notes and generate embeddings

> **Tip:** If the MCP server returns empty results, this is almost always a missing Full Disk Access permission. macOS silently returns empty data instead of an error.

## How It Works

1. **Import** — Reads notes from Apple Notes via its local SQLite database (read-only)
2. **Embed** — Chunks notes and generates embeddings locally using [nomic-embed-text](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF)
3. **Search** — Hybrid retrieval combining semantic vector similarity + BM25 keyword search, fused with Reciprocal Rank Fusion
4. **Suggest** — LLM-powered proactive suggestions identifying follow-ups, decisions, and opportunities from your notes

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Apple Notes   │────▶│   Sync Engine    │────▶│   SQLite DB     │
│   (read-only)   │     │  chunk + embed   │     │  notes, chunks  │
└─────────────────┘     └──────────────────┘     │  vectors, FTS   │
                                                  └────────┬────────┘
                                                           │
┌─────────────────┐     ┌──────────────────┐              │
│  Claude Desktop │◀───▶│   MCP Server     │◀─────────────┘
│                 │     │  search, suggest  │
└─────────────────┘     └──────────────────┘
```

## MCP Tools

### `search_memory_wallet`
Searches your notes using hybrid semantic + keyword matching. Supports date-range filtering.

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | string | Search query, or `"*"` to browse by recency |
| `from` | string? | ISO 8601 start date (e.g. `"2025-01-01"`) |
| `to` | string? | ISO 8601 end date |
| `limit` | number? | Max results (default 10) |

### `generate_suggestions_with_memory_wallet`
Returns proactive follow-up suggestions based on your notes. Requires `ANTHROPIC_API_KEY`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | string? | Topic to focus on, or omit for general suggestions |
| `max_suggestions` | number? | Max suggestions (default 5) |

### `refresh_memory_wallet`
Syncs notes from Apple Notes — pulls new notes, updates changed ones, removes deleted ones, and generates embeddings.

| Parameter | Type | Description |
|-----------|------|-------------|
| `days_lookback` | number? | How many days back to look for notes (default 180) |

## Project Structure

```
src/
├── mcp-server.ts    # MCP server (stdio transport)
├── search.ts        # Hybrid search (vector + FTS + RRF fusion)
├── suggest.ts       # LLM-powered suggestion generation
├── sync.ts          # Apple Notes import + embedding pipeline
├── chunker.ts       # Text chunking for long notes
├── embeddings.ts    # Local embedding model (nomic-embed-text v1.5)
├── db.ts            # SQLite + sqlite-vec database layer
├── apple-notes.ts   # Apple Notes SQLite reader
└── ui/              # Web dashboard (Express + vanilla JS)
test/
├── chunker.test.ts  # Chunker unit tests
├── search.test.ts   # FTS query escaping tests
├── helpers.ts       # Test DB setup with embedded fixture data
└── providers/       # Promptfoo custom providers for evals
```

## Testing

```bash
npm test             # Unit tests (node:test)
npm run eval         # Search quality evals (promptfoo)
```
