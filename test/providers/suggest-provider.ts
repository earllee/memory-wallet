import { setupTestDb, type TestDb } from '../helpers';
import { suggest } from '../../src/suggest';

let testDb: TestDb | null = null;

async function ensureTestDb(): Promise<void> {
  if (!testDb) {
    testDb = await setupTestDb();
    process.on('exit', () => testDb?.cleanup());
  }
}

export default class SuggestProvider {
  id() {
    return 'memory-wallet-suggest';
  }

  async callApi(prompt: string) {
    await ensureTestDb();

    const query = prompt === '*' || prompt.trim() === '' ? undefined : prompt;
    const suggestions = await suggest(query, { maxSuggestions: 5 });

    return {
      output: JSON.stringify(suggestions, null, 2),
    };
  }
}
