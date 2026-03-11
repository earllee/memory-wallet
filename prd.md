# PRD: Memory Wallet MVP v1

## Summary

Memory Wallet is a local-first memory layer for AI assistants. It ingests a user’s Apple Notes, indexes them into a searchable memory store, and exposes that memory to Claude via MCP so Claude can retrieve relevant personal context and suggest proactive follow-up actions.

The MVP is designed to prove one core thesis: **personal notes are a high-signal, deeply personal source of context that can materially improve assistant usefulness even before building full “deep memory.”**

## Goal

Build a simple product that demonstrates three things:

1. **More accurate context retrieval** than raw keyword search over notes
2. **Faster context retrieval** than AppleScript-powered Apple Notes MCP
2. **Useful prompt enrichment** for Claude via MCP
3. **Early proactive assistance** via suggested tasks derived from recent or relevant notes

## Problem

Today’s assistants are mostly reactive and stateless. Users must repeatedly restate context, manually search across notes and tools, and direct the assistant step by step.

Apple Notes is a valuable but underutilized source of personal context. Existing access patterns are slow, shallow, and not optimized for AI retrieval. Users cannot easily turn their notes into an efficient memory layer that makes assistants feel personalized and proactive.

## Target User

Initial users are knowledge workers with high context-switching costs, especially:

* Product managers
* Founders / small business owners
* Executive assistants
* Heavy note-takers using Apple Notes

These users are likely to have rich note archives, fragmented workstreams, and recurring needs for synthesis, recall, and follow-up.

## MVP Hypothesis

If we ingest Apple Notes into a local semantic memory store and expose it to Claude through MCP, then users will get noticeably better responses and more helpful follow-up suggestions with minimal setup.

## Non-Goals

This MVP does **not** try to solve:

* Full lifelong memory
* Multi-source ingestion beyond Apple Notes
* Autonomous task execution
* Perfect factual grounding across messy notes
* Fine-grained user editing of the memory representation
* Complex hierarchical / graph memory beyond lightweight optional experiments

## User Stories

### Prompt enrichment

As a user, I want Claude to retrieve relevant context from my notes automatically so I do not need to restate background information every time.

### Memory search

As a user, I want Claude to search my notes semantically, not just by exact keyword, so it can find relevant ideas even when wording differs.

### Proactive suggestions

As a user, I want Claude to suggest useful next actions based on my recent or relevant notes so it feels more like an assistant than a chatbot.

## Core Product Experience

The user installs a desktop app, grants access to Apple Notes, and syncs notes into a local memory database.

Claude connects to the Memory Wallet MCP.

When the user prompts Claude, Claude can call:

* `search(query)` to retrieve distilled context from relevant notes
* `suggest(query | wildcard)` to retrieve possible proactive follow-up actions based on matching or recent notes

Example:

User asks Claude: “Help me prepare for my 1:1 with design.”

Claude calls `search("1:1 with design")`.

The MCP returns relevant note summaries, key entities, and possible open threads from Apple Notes.

Claude uses that context in its response.

Separately, Claude or another connected tool can call `suggest("*")` to get recent possible actions such as:

* Draft update to stakeholders
* Follow up on a decision discussed in notes
* Create a task from a note that contains an unresolved commitment

## Functional Requirements

### 1. Apple Notes import

* Import local Apple Notes from the user’s Mac
* Pull note title, body text, folder, created date, updated date
* Support initial full import and incremental re-sync
* Run locally on device

### 2. Note processing

* Clean note text
* Chunk long notes into retrievable segments
* Generate embeddings locally
* Store raw note metadata plus chunk embeddings

### 3. Search endpoint

MCP endpoint: `search`

Input:

* user query
* optional time range filter
* optional limit with 10 as default

Output:

* top matching note chunks
* note metadata
* optional - concise distilled context synthesized from matches using haiku 
* keyword + semantic match support

### 4. Suggest endpoint

MCP endpoint: `suggest`

Input:

* query or wildcard
* optional recency window
* optional max suggestions

Output:

* ranked suggestions for actions or follow-ups
* evidence notes for why each suggestion exists

Examples:

* “Follow up with Sarah on pricing feedback”
* “Summarize your product decision for stakeholders”
* “Turn this planning note into a task list”

### 5. Local database

* Store notes, chunks, embeddings, metadata, and optional summaries
* Support fast lookup and incremental updates
* All user data remains local in MVP

### 6. Claude / MCP integration

* Expose MCP server locally
* Make tools callable by Claude desktop
* Strongly encourage use of `search` for prompt enrichment
* Make `suggest` available for proactive workflows

### 7. Simple UI

* Sync notes
* Supply Anthropic API key for summarization
* View notes database stats

## Optional v1.5 Enhancements

If time allows:

* Distilled “note summaries” layered above raw chunks
* Lightweight hierarchical grouping of related notes
* Entity extraction for people / projects / topics

## Success Metrics

### Primary

* User reports Claude responses are more context-aware and useful
* Users successfully retrieve relevant note context that basic search would likely miss
* Users find at least some `suggest` outputs genuinely helpful

### Secondary

* Search latency feels fast enough for conversational use
* Sync works reliably
* Prompt enrichment reduces manual context entry
* Users reconnect and reuse the wallet over multiple sessions

## Risks

### Relevance quality

Semantic retrieval from messy notes may surface irrelevant context.

### Suggestion quality

Proactive suggestions may feel obvious, noisy, or intrusive.

### Apple Notes ingestion

Apple Notes access may be brittle depending on implementation.

### Trust / privacy

Because notes are highly personal, users need confidence that data stays local and understandable.

### Illusion vs depth

This MVP may feel useful without actually proving “deep memory” in the research sense. That is acceptable as long as it proves user value and informs the next version.

## Technical Plan

### Architecture

#### Client

Desktop app on macOS

Responsibilities:

* Read Apple Notes locally
* Process notes into chunks
* Generate embeddings locally
* Store notes + vectors in local DB
* Run or bundle local MCP server

#### Storage

Local database with:

* notes table
* chunks table
* embeddings index
* optional summaries table
* suggestion candidates / cache

Possible stack:

* SQLite + vector extension
* or SQLite + external vector store if needed

#### Retrieval pipeline

1. User query arrives
2. Run keyword search + vector search
3. Merge and rank results
4. Return top evidence
5. Optionally synthesize distilled context

#### Suggestion pipeline

1. Pull recent or relevant notes
2. Detect action-oriented language, unresolved decisions, follow-ups, reminders
3. Rank by recency + salience + likely usefulness
4. Return suggestions with supporting evidence

## Recommended Scope Cuts

To keep MVP tight, do **not** start with:

* graph memory
* true hierarchical memory
* background agent loops
* multi-app ingestion
* task completion / write-back into external apps
* deep observability or memory editing UI

Start with:

* ingestion
* embeddings
* hybrid retrieval
* synthesized search results
* lightweight suggestion generation

## Build Plan

### Phase 1: Working retrieval foundation

Goal: make Apple Notes searchable through Claude

Deliverables:

* Apple Notes importer
* local DB schema
* note chunking
* local embeddings
* MCP `search` endpoint
* Claude integration test

Definition of done:

* User can ask Claude a question and Claude retrieves relevant context from notes

### Phase 2: Distilled context

Goal: improve readability and usefulness of retrieval output

Deliverables:

* synthesis layer over top matches
* note metadata in results
* hybrid ranking improvements
* basic recency filtering

Definition of done:

* `search` returns concise, grounded context rather than only raw note excerpts

### Phase 3: Proactive suggestions

Goal: make the product feel assistant-like, not just searchable

Deliverables:

* MCP `suggest` endpoint
* heuristics or LLM-based suggestion generation
* evidence-backed suggestions from recent / relevant notes

Definition of done:

* User sees plausible next-step suggestions that map back to real notes

### Phase 4: Product hardening

Goal: make MVP usable by early testers

Deliverables:

* incremental sync
* better error handling
* basic settings UI
* logs / debugging
* privacy messaging and onboarding

Definition of done:

* early testers can install, sync, connect Claude, and use without handholding

## v1 Product Principle

**Do not try to prove deep memory academically in v1. Prove that personal notes can become a practical memory layer that makes Claude feel more context-aware, faster, and more helpful.**

