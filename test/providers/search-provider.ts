import { setupTestDb, type TestDb } from '../helpers';
import { search } from '../../src/search';

let testDb: TestDb | null = null;

async function ensureTestDb(): Promise<void> {
  if (!testDb) {
    testDb = await setupTestDb();
    process.on('exit', () => testDb?.cleanup());
  }
}

export default class SearchProvider {
  id() {
    return 'memory-wallet-search';
  }

  async callApi(prompt: string) {
    await ensureTestDb();

    const results = await search(prompt, { limit: 5 });

    const output = results
      .map((r, i) => `${i + 1}. ${r.title} (score: ${r.score.toFixed(4)})\n${r.content}`)
      .join('\n\n---\n\n');

    return {
      output: output || 'No results found',
    };
  }
}
