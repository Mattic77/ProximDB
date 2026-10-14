import * as fs from 'fs';
import * as path from 'path';
import express from 'express';
import { ProximDB, MemoryAdapter, proximMiddleware, createSearchHandler } from '../src/index.js';

async function runDemo() {
  const outputData: Record<string, any> = {
    generatedAt: new Date().toISOString(),
    scenarios: []
  };

  // 1. Setup adapter and ProximDB
  const adapter = new MemoryAdapter({
    client: 'memory',
    initialNodes: [
      { id: 'user_101', entityType: 'user', attributes: { username: 'CurrentViewer', bio: 'Tech Lead', city: 'Berlin' } },
      { id: 'u_201', entityType: 'user', attributes: { username: 'JohnDoe', bio: 'Senior Backend Engineer', city: 'Paris' } },
      { id: 'u_305', entityType: 'user', attributes: { username: 'Johnny', bio: 'UI/UX Designer', city: 'Lyon' } },
      { id: 'u_410', entityType: 'user', attributes: { username: 'AlexSmith', bio: 'Product Architect', city: 'London' } },
      { id: 'f_1', entityType: 'user', attributes: { username: 'Alice' } },
      { id: 'f_2', entityType: 'user', attributes: { username: 'Bob' } },
      { id: 'f_3', entityType: 'user', attributes: { username: 'Charlie' } },
      { id: 'f_4', entityType: 'user', attributes: { username: 'David' } }
    ],
    initialEdges: [
      // user_101 connects with 4 friends
      { sourceId: 'user_101', targetId: 'f_1', edgeType: 'follows' },
      { sourceId: 'user_101', targetId: 'f_2', edgeType: 'follows' },
      { sourceId: 'user_101', targetId: 'f_3', edgeType: 'follows' },
      { sourceId: 'user_101', targetId: 'f_4', edgeType: 'follows' },

      // All 4 friends also follow AlexSmith (4 mutual connections with user_101)
      { sourceId: 'f_1', targetId: 'u_410', edgeType: 'follows' },
      { sourceId: 'f_2', targetId: 'u_410', edgeType: 'follows' },
      { sourceId: 'f_3', targetId: 'u_410', edgeType: 'follows' },
      { sourceId: 'f_4', targetId: 'u_410', edgeType: 'follows' }
    ]
  });

  const engine = new ProximDB({
    source: adapter,
    embeddedStoragePath: ':memory:',
    mapping: {
      nodes: {
        user: {
          table: 'users',
          id: 'id',
          attributes: ['username', 'bio', 'city']
        }
      },
      edges: {
        follows: {
          table: 'follows',
          sourceId: 'follower_id',
          targetId: 'following_id'
        }
      }
    }
  });

  await engine.initialize();

  // Scenario 1: Multi-Mode Search (Fuzzy + Proximity simultaneously)
  const query1 = await engine.query({
    queryText: 'John',
    forUser: 'user_101',
    modes: ['fuzzy', 'proximity'],
    limits: { fuzzy: 5, proximity: 3 }
  });
  outputData.scenarios.push({
    title: 'Scenario 1: Multi-Mode Query Pipeline (Fuzzy + Proximity)',
    description: 'Executes fuzzy text matching for "John" and proximity graph traversal for "user_101" in a single query.',
    request: { queryText: 'John', forUser: 'user_101', modes: ['fuzzy', 'proximity'], limits: { fuzzy: 5, proximity: 3 } },
    response: query1
  });

  // Scenario 2: Typo-Tolerant Search
  const query2 = await engine.query({
    queryText: 'Jonh', // Transposed typo
    modes: ['fuzzy'],
    limits: { fuzzy: 5 }
  });
  outputData.scenarios.push({
    title: 'Scenario 2: Damerau-Levenshtein Typo Tolerance',
    description: 'Detects character transposition ("Jonh" -> "JohnDoe") and ranks candidates by similarity score.',
    request: { queryText: 'Jonh', modes: ['fuzzy'] },
    response: query2
  });

  // Scenario 3: Graph Proximity Recommendations ("People You May Know")
  const query3 = await engine.query({
    forUser: 'user_101',
    modes: ['proximity'],
    limits: { proximity: 5 }
  });
  outputData.scenarios.push({
    title: 'Scenario 3: Graph Proximity & Mutual Connections',
    description: 'Traverses second-degree graph paths, computes mutual connection count, excludes existing friends, and generates explanations.',
    request: { forUser: 'user_101', modes: ['proximity'] },
    response: query3
  });

  // Scenario 4: Express.js HTTP Route Simulation
  const app = express();
  app.use(proximMiddleware(engine));
  app.get('/api/search', createSearchHandler(engine));

  const server = app.listen(0);
  const port = (server.address() as any).port;

  const res = await fetch(`http://localhost:${port}/api/search?q=John&forUser=user_101&modes=fuzzy,proximity`);
  const expressPayload = await res.json();
  server.close();

  outputData.scenarios.push({
    title: 'Scenario 4: Express Middleware & HTTP Handler',
    description: 'Demonstrates Express integration using GET /api/search?q=John&forUser=user_101&modes=fuzzy,proximity',
    requestUrl: `/api/search?q=John&forUser=user_101&modes=fuzzy,proximity`,
    response: expressPayload
  });

  // Scenario 5: Incremental Delta Synchronization
  const newUserId = 'u_999';
  adapter.addNode({
    id: newUserId,
    entityType: 'user',
    attributes: { username: 'SarahConnor', bio: 'Cybernetics Specialist', city: 'Los Angeles' },
    updatedAt: Date.now() + 1000
  });

  const syncStats = await engine.sync();
  const query5 = await engine.query({
    queryText: 'Sarah',
    modes: ['fuzzy']
  });

  outputData.scenarios.push({
    title: 'Scenario 5: Incremental Delta Synchronization',
    description: 'Simulates a primary database update and executes incremental sync without re-indexing unchanged data.',
    syncStats,
    request: { queryText: 'Sarah', modes: ['fuzzy'] },
    response: query5
  });

  await engine.close();

  // Save JSON report
  const resultsDir = path.resolve('results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const jsonPath = path.join(resultsDir, 'demo-queries.json');
  fs.writeFileSync(jsonPath, JSON.stringify(outputData, null, 2), 'utf-8');

  // Generate Markdown Walkthrough
  let markdown = `# ProximDB Live Execution Walkthrough

This document shows live test outputs and real execution results generated from ProximDB's multi-mode pipeline.

**Report Generated At:** \`${outputData.generatedAt}\`

---

`;

  for (const scenario of outputData.scenarios) {
    markdown += `## ${scenario.title}\n\n`;
    markdown += `${scenario.description}\n\n`;
    if (scenario.request) {
      markdown += `### Query Request:\n\`\`\`json\n${JSON.stringify(scenario.request, null, 2)}\n\`\`\`\n\n`;
    }
    if (scenario.requestUrl) {
      markdown += `### Request Endpoint:\n\`\`\`http\nGET ${scenario.requestUrl}\n\`\`\`\n\n`;
    }
    if (scenario.syncStats) {
      markdown += `### Sync Stats:\n\`\`\`json\n${JSON.stringify(scenario.syncStats, null, 2)}\n\`\`\`\n\n`;
    }
    markdown += `### Real Engine Response:\n\`\`\`json\n${JSON.stringify(scenario.response, null, 2)}\n\`\`\`\n\n---\n\n`;
  }

  const mdPath = path.join(resultsDir, 'WALKTHROUGH.md');
  fs.writeFileSync(mdPath, markdown, 'utf-8');

  console.log('Demo results saved to:');
  console.log(' - ' + jsonPath);
  console.log(' - ' + mdPath);
}

runDemo().catch((err) => {
  console.error(err);
  process.exit(1);
});
