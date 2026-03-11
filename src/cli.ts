import { runSync } from './sync';
import { search } from './search';
import { suggest } from './suggest';

const args = process.argv.slice(2);
const command = args[0];

function printUsage() {
  console.log(`
Memory Wallet CLI

Usage:
  npx tsx src/cli.ts <command> [options]

Commands:
  sync [--days N]       Import/sync Apple Notes (default: 180 days)
  search <query>        Search your notes
  suggest [query]       Get suggestions (default: recent notes)
  ui                    Start the settings UI server

Examples:
  npx tsx src/cli.ts sync --days 30
  npx tsx src/cli.ts search "1:1 with design team"
  npx tsx src/cli.ts suggest "project updates"
  npx tsx src/cli.ts suggest
  npx tsx src/cli.ts ui
`);
}

async function main() {
  if (!command) {
    printUsage();
    process.exit(0);
  }

  switch (command) {
    case 'sync': {
      let days = 180;
      const daysIdx = args.indexOf('--days');
      if (daysIdx !== -1 && args[daysIdx + 1]) {
        days = parseInt(args[daysIdx + 1], 10);
      }
      console.log(`Syncing Apple Notes (last ${days} days)...\n`);
      const result = await runSync(days);
      console.log('\nSync Results:');
      console.log(`  Added:    ${result.added}`);
      console.log(`  Updated:  ${result.updated}`);
      console.log(`  Deleted:  ${result.deleted}`);
      console.log(`  Chunks:   ${result.chunksCreated}`);
      console.log(`  Embedded: ${result.chunksEmbedded}`);
      if (result.errors.length > 0) {
        console.log(`  Errors:   ${result.errors.length}`);
      }
      break;
    }

    case 'search': {
      const query = args.slice(1).join(' ');
      if (!query) {
        console.error('Usage: search <query>');
        process.exit(1);
      }
      console.log(`Searching for: "${query}"\n`);
      const results = await search(query, { limit: 10 });
      if (results.length === 0) {
        console.log('No results found.');
      } else {
        for (const r of results) {
          const date = new Date(r.modifiedAt * 1000).toLocaleDateString();
          const folder = r.folder ? ` [${r.folder}]` : '';
          console.log(`--- ${r.title}${folder} (${date}) ---`);
          console.log(`Score: ${(r.score * 100).toFixed(1)}%`);
          console.log(r.content.substring(0, 300) + (r.content.length > 300 ? '...' : ''));
          console.log();
        }
      }
      break;
    }

    case 'suggest': {
      const query = args.slice(1).join(' ') || '*';
      console.log(query === '*' ? 'Getting suggestions from recent notes...\n' : `Getting suggestions for: "${query}"\n`);
      const suggestions = await suggest(query);
      if (suggestions.length === 0) {
        console.log('No suggestions found.');
      } else {
        for (let i = 0; i < suggestions.length; i++) {
          const s = suggestions[i];
          console.log(`${i + 1}. ${s.action}`);
          console.log(`   Why: ${s.reasoning}`);
          for (const e of s.evidence) {
            console.log(`   From: "${e.noteTitle}" - "${e.excerpt.substring(0, 80)}..."`);
          }
          console.log();
        }
      }
      break;
    }

    case 'ui': {
      require('./ui/server');
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
