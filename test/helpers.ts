import os from 'os';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { chunkText } from '../src/chunker';
import { getDb, _setTestDb } from '../src/db';
import { ensureModel, embedText, embeddingToBuffer } from '../src/embeddings';

const FIXTURE_NOTES = [
  {
    title: 'Meeting with Sarah about pricing',
    content: `Met with Sarah from sales to discuss our Q3 pricing strategy. She presented competitor analysis showing we're 20% below market rate for enterprise features.

Key decisions needed:
- Whether to increase enterprise tier by 15% or 10%
- How to handle existing contracts (grandfather vs. gradual increase)
- Timeline for rollout (July vs September)

Sarah's main concern is churn risk for mid-market customers who might downgrade. She'll gather feedback from our top 10 accounts by next week.

Action items:
- I'll prepare a pricing comparison deck by Friday
- Sarah will schedule calls with key accounts
- Review competitor feature matrices`,
    folder: 'Work',
  },
  {
    title: 'Q2 roadmap planning',
    content: `Product roadmap session for Q2. Main themes: platform stability, self-serve onboarding, and API v2.

Priority 1: Fix the onboarding drop-off. Analytics show 40% of new users abandon setup at the integration step. Plan: simplify OAuth flow, add setup wizard, create video tutorials.

Priority 2: API v2 with breaking changes. Need to communicate migration timeline to developers. Greg suggested a 6-month deprecation window.

Priority 3: Performance improvements. Dashboard load time is averaging 3.2 seconds, target is under 1 second. Backend team will focus on query optimization and caching.

Deferred to Q3: mobile app redesign, advanced analytics dashboard, SSO for business tier.`,
    folder: 'Work',
  },
  {
    title: 'Recipe for sourdough bread',
    content: `My go-to sourdough recipe after months of experimentation.

Ingredients:
- 500g bread flour
- 350g water (70% hydration)
- 100g active starter
- 10g salt

Process:
1. Mix flour and water, autolyse 30 minutes
2. Add starter and salt, mix well
3. Stretch and fold every 30 min for 2 hours (4 sets)
4. Bulk ferment 4-6 hours at room temp until doubled
5. Shape and place in banneton
6. Cold retard in fridge 12-16 hours
7. Bake at 500°F in Dutch oven: 20 min covered, 25 min uncovered

Tips: The key is patience during bulk fermentation. Under-fermented dough leads to dense crumb. The poke test is more reliable than timing.`,
    folder: 'Personal',
  },
  {
    title: 'Workout routine - March',
    content: `Updated my training split for March. Focusing on strength gains after the cut.

Monday - Upper Push:
- Bench press 4x6
- OHP 3x8
- Incline dumbbell press 3x10
- Lateral raises 3x15
- Tricep pushdowns 3x12

Wednesday - Lower:
- Squats 4x6
- Romanian deadlifts 3x8
- Leg press 3x12
- Calf raises 4x15
- Ab wheel 3x10

Friday - Upper Pull:
- Deadlifts 3x5
- Barbell rows 4x8
- Pull-ups 3xAMRAP
- Face pulls 3x15
- Barbell curls 3x10

Current maxes: Bench 225, Squat 315, Deadlift 405. Goal by June: 245/335/425.`,
    folder: 'Personal',
  },
  {
    title: 'JavaScript async patterns',
    content: `Notes from deep-diving into async patterns for the refactoring project.

Promise.allSettled vs Promise.all:
- Use allSettled when you want all results regardless of failures
- Use all when any failure should abort the operation

Async iterators are perfect for streaming data:
const stream = getDataStream();
for await (const chunk of stream) { process(chunk); }

Error handling patterns:
- Always use try/catch in async functions, not .catch()
- Create custom error classes for different failure modes
- Use AbortController for cancellable operations

Key insight: our API layer should use a queue-based approach for rate limiting instead of simple delays. This would improve throughput by 3x based on benchmarks.`,
    folder: 'Learning',
  },
  {
    title: 'Travel plans for Japan trip',
    content: `Planning a 2-week trip to Japan in October.

Week 1 - Tokyo:
- Shinjuku area hotel (booked)
- Day trips: Shibuya, Akihabara, Asakusa
- Tsukiji outer market for breakfast sushi
- teamLab Borderless (need tickets)
- Day trip to Kamakura

Week 2 - Kyoto/Osaka:
- Kyoto: Fushimi Inari, Arashiyama bamboo grove, tea ceremony
- Day trip to Nara (deer park)
- Osaka: Dotonbori street food, Osaka Castle
- Possibly Hiroshima day trip via shinkansen

Budget estimate: $4,000 for flights + $3,000 for hotels + $2,000 for food/activities.

Need to get: Japan Rail Pass (14-day), pocket WiFi, travel insurance.`,
    folder: 'Personal',
  },
  {
    title: 'Book notes: Thinking, Fast and Slow',
    content: `Daniel Kahneman's masterwork on cognitive biases and decision-making.

System 1 (fast, automatic, emotional) vs System 2 (slow, deliberate, logical). Most of our daily decisions use System 1, which is efficient but prone to systematic errors.

Key biases to remember:
- Anchoring: first number you see influences subsequent judgments
- Availability heuristic: we overweight easily recalled events
- Loss aversion: losses feel ~2x more painful than equivalent gains feel good
- Sunk cost fallacy: we irrationally continue investing in failing projects
- WYSIATI (What You See Is All There Is): we make decisions based on available info without considering what we don't know

Application to product work: when estimating project timelines, use reference class forecasting (base rates from similar past projects) instead of inside-view planning. Our Q1 estimates were 40% optimistic, consistent with planning fallacy research.`,
    folder: 'Reading',
  },
  {
    title: 'Home renovation ideas',
    content: `Brainstorming home improvement projects for this year.

Kitchen (priority):
- Replace countertops with quartz (estimate: $3,500)
- Add under-cabinet lighting
- New backsplash tile (subway tile, white or light grey)
- Fix the leaky faucet (DIY)

Bathroom:
- Retile the shower floor
- Replace vanity mirror
- Add heated towel rack

Garden/Outdoor:
- Build raised garden beds for vegetables
- Install drip irrigation system
- String lights on the patio
- Replace the worn deck boards

Need contractor quotes for kitchen countertops. Maria recommended her contractor — text her for the contact. Budget cap: $15,000 total for the year.`,
    folder: 'Personal',
  },
  {
    title: '1:1 with design team',
    content: `Weekly design sync with Alex and the UX team.

Current sprint: redesigning the settings page. Alex showed wireframes for the new layout — much cleaner, grouped by category instead of flat list. Feedback: consider adding a search bar for settings since we have 40+ options.

Design system updates:
- New color palette approved (more accessible, WCAG AA compliant)
- Component library migration to the new design tokens is 60% complete
- Dark mode is on track for Q2 release

User research findings:
- 65% of users never customize their dashboard
- Power users want keyboard shortcuts for common actions
- Mobile usage is up 25% quarter over quarter — need to prioritize responsive design

Action items:
- Alex will revise settings wireframes by Thursday
- I'll review and approve the new color palette implementation
- Schedule usability testing for next sprint`,
    folder: 'Work',
  },
  {
    title: 'Weekly reflection - March 3',
    content: `Reflecting on the past week.

What went well:
- Finally shipped the search feature after two weeks of iteration
- Had a productive brainstorm with the team about Q2 priorities
- Started the sourdough habit — third successful loaf in a row

What could improve:
- Too many context switches between projects this week
- Need to block focused time in the mornings for deep work
- Fell behind on exercise — only trained twice instead of three times

Key insight: I'm most productive when I batch similar tasks together. Mixing strategic planning with tactical bug fixes kills my flow state.

Goals for next week:
- Finalize Q2 roadmap document
- Schedule 1:1s with all direct reports
- Three workout sessions, no excuses
- Read two more chapters of Kahneman's book`,
    folder: 'Personal',
  },
];

export interface TestDb {
  dbPath: string;
  cleanup: () => void;
}

export async function setupTestDb(): Promise<TestDb> {
  await ensureModel();

  const dbPath = path.join(os.tmpdir(), `memory-wallet-test-${uuidv4()}.db`);
  const db = getDb(dbPath);

  for (const note of FIXTURE_NOTES) {
    const docId = uuidv4();
    const now = Math.floor(Date.now() / 1000);
    const sourceId = uuidv4();
    const metadata = note.folder ? JSON.stringify({ folder: note.folder }) : null;

    db.prepare(`
      INSERT INTO documents (id, source, source_id, title, content, created_at, modified_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(docId, 'notes', sourceId, note.title, note.content, now, now, metadata);

    const chunks = chunkText(note.content);
    const insertChunk = db.prepare(
      'INSERT INTO document_chunks (id, document_id, chunk_index, content) VALUES (?, ?, ?, ?)'
    );
    const insertFts = db.prepare(
      'INSERT INTO fts_document_chunks (rowid, content) SELECT rowid, content FROM document_chunks WHERE id = ?'
    );

    for (let i = 0; i < chunks.length; i++) {
      const chunkId = uuidv4();
      insertChunk.run(chunkId, docId, i, chunks[i]);
      insertFts.run(chunkId);

      const embedding = await embedText(chunks[i], 'document');
      const buffer = embeddingToBuffer(embedding);
      db.prepare('INSERT INTO vec_document_chunks (chunk_id, embedding) VALUES (?, ?)').run(chunkId, buffer);
    }
  }

  // Set as the active DB so search()/suggest() use it
  _setTestDb(db);

  return {
    dbPath,
    cleanup: () => {
      _setTestDb(null);
      db.close();
      try { fs.unlinkSync(dbPath); } catch {}
      try { fs.unlinkSync(dbPath + '-wal'); } catch {}
      try { fs.unlinkSync(dbPath + '-shm'); } catch {}
    },
  };
}
