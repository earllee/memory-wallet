import Anthropic from '@anthropic-ai/sdk';
import { getDb } from './db';
import { search } from './search';


export interface Suggestion {
  action: string;
  reasoning: string;
  evidence: { noteTitle: string; excerpt: string }[];
}

interface SuggestOptions {
  maxSuggestions?: number;
}

function getRecentNotes(days: number = 7, limit: number = 20): { title: string; content: string; modifiedAt: number }[] {
  const db = getDb();
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

  return db.prepare(`
    SELECT title, content, modified_at as modifiedAt
    FROM documents
    WHERE modified_at > ?
    ORDER BY modified_at DESC
    LIMIT ?
  `).all(cutoff, limit) as { title: string; content: string; modifiedAt: number }[];
}

export async function suggest(query?: string, options: SuggestOptions = {}): Promise<Suggestion[]> {
  const maxSuggestions = options.maxSuggestions ?? 5;
  const isWildcard = !query || query === '*';

  // Gather note context
  let noteContext: { title: string; content: string }[];

  if (isWildcard) {
    noteContext = getRecentNotes();
  } else {
    const results = await search(query, { limit: 10 });
    noteContext = results.map((r) => ({ title: r.title, content: r.content }));
  }

  if (noteContext.length === 0) {
    return [];
  }

  // Format notes for the prompt
  const notesText = noteContext
    .map((n, i) => `--- Note ${i + 1}: "${n.title}" ---\n${n.content}`)
    .join('\n\n');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not found. Set it as an environment variable.');
  }

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: `You are analyzing a user's personal notes to identify actionable follow-ups and suggestions.

Here are the notes:

${notesText}

Based on these notes, identify up to ${maxSuggestions} actionable suggestions. For each, consider:
- Unresolved decisions that need to be made
- Commitments or promises that need follow-up
- Tasks or to-dos that were mentioned but may not be completed
- Opportunities to synthesize or connect ideas across notes
- Hidden opportunities to help the user be more effective

Rank suggestions by recency and actionability (most urgent/actionable first).

Respond with a JSON array (no markdown fencing) where each item has:
- "action": a clear, specific action the user should take (imperative form)
- "reasoning": why this action matters or is timely
- "evidence": array of {"noteTitle": string, "excerpt": string} showing the source

Example format:
[{"action": "Follow up with Sarah on pricing feedback", "reasoning": "She mentioned needing a response by Friday and no follow-up is recorded", "evidence": [{"noteTitle": "Meeting Notes 3/5", "excerpt": "Sarah asked for pricing feedback by EOW"}]}]

Return only the JSON array.`,
      },
    ],
  });

  // Parse response
  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    // Try to extract JSON from the response (handle potential markdown wrapping)
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as Suggestion[];
    return parsed.slice(0, maxSuggestions);
  } catch {
    return [];
  }
}
