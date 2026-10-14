# ProximDB (Local Embedded Search & Relationship Engine)

ProximDB is a high-performance, plug-and-play middleware search and relationship engine designed for backend developers. It connects directly to a primary database (PostgreSQL, MySQL, MongoDB), mirrors targeted entities and relationships into an embedded local storage layer (SQLite), and provides multi-mode search capabilities (fuzzy text matching and graph-based proximity recommendations) with zero network overhead.

---

## 1. Core Architecture & Philosophy

- **The Separation of Concerns:** Heavy search queries, multi-table joins, and graph pathfinding algorithms (like "People You May Know") run entirely against a fast, local embedded SQLite engine. This prevents high search traffic from choking the primary production database.
- **Developer-Controlled Modes:** End-users never select search modes. The developer defines search pipelines on backend routes, executing multiple engines (e.g., `fuzzy` + `proximity`) simultaneously.
- **Zero Configuration for End-Users:** Embedded SQLite runs inside the Node.js process using `better-sqlite3`. No external servers (like Redis or Neo4j) are required.

---

## 2. Project Directory Structure

```text
📁 ProximDB/
│
├── 📁 docs/                        <-- Architectural Notes & Specs
│   ├── 01-Overview.md
│   ├── 02-Search-Modes.md
│   └── 03-Sync-Engine.md
│
├── 📁 src/
│   ├── 📁 adapters/                <-- Primary Database Source Connectors
│   │   ├── postgres.adapter.ts
│   │   ├── mysql.adapter.ts
│   │   └── mongodb.adapter.ts
│   │
│   ├── 📁 engine/                  <-- Embedded Local Engine Core
│   │   ├── embedded.db.ts          <-- Manages local SQLite lifecycle
│   │   ├── indexer.ts              <-- Maps and syncs rows into local tables
│   │   └── cache.manager.ts        <-- Handles incremental syncs and TTL
│   │
│   ├── 📁 strategies/              <-- Search Algorithms
│   │   ├── fuzzy.strategy.ts       <-- Text matching, typos, and partial phrases
│   │   └── proximity.strategy.ts   <-- Graph traversals & mutual connection scoring
│   │
│   ├── index.ts                    <-- Main entry point (ProximDB class)
│   └── types.ts                    <-- TypeScript interfaces and configurations
│
├── package.json
└── tsconfig.json
```

---

## 3. Configuration & Schema Mapping Specification

When initializing ProximDB, the developer defines a selective projection mapping that tells the engine which tables, attributes, and relationships to mirror.

### TypeScript Initialization Example:

```typescript
import { ProximDB } from 'proximdb';

const searchEngine = new ProximDB({
  source: {
    client: 'postgres',
    uri: process.env.DATABASE_URL,
  },
  embeddedStoragePath: './cache/search.db',
  mapping: {
    nodes: {
      user: {
        table: 'users',
        id: 'id',
        attributes: ['username', 'bio', 'city'] // Targeted fields only
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

await searchEngine.initialize();
```

---

## 4. Multi-Mode Query Pipeline Specification

When an incoming search request hits the backend, the developer invokes a multi-mode query. The engine executes the requested strategies locally and returns a structured response object.

### Query Execution Example:

```typescript
const searchResults = await searchEngine.query({
  queryText: "John",
  forUser: "user_101", // Context user for graph proximity recommendations
  modes: ['fuzzy', 'proximity'],
  limits: {
    fuzzy: 5,
    proximity: 3
  }
});
```

### Expected Response Format:

```json
{
  "query": "John",
  "results": {
    "fuzzy": [
      { "id": "u_201", "username": "JohnDoe", "city": "Paris" },
      { "id": "u_305", "username": "Johnny", "city": "Lyon" }
    ],
    "proximity": [
      { "id": "u_410", "username": "AlexSmith", "mutualCount": 4, "reason": "You have 4 mutual connections" }
    ]
  }
}
```

---

## 5. Build and Implementation Phases

1. **Phase 1 (Core Setup):** Set up TypeScript, configure `better-sqlite3` embedded storage wrapper, and establish the internal SQLite schema (`search_nodes` and `search_edges`).
2. **Phase 2 (Adapters & Sync):** Implement the PostgreSQL source adapter and write the bulk-sync function that pulls targeted attributes into the local cache.
3. **Phase 3 (Strategy Engines):** 
   - Write `FuzzyStrategy` using SQL `LIKE` or local text indexing.
   - Write `ProximityStrategy` using SQLite recursive CTEs to calculate mutual connections/paths.
4. **Phase 4 (Query Orchestrator):** Implement the multi-mode pipeline handler inside `index.ts` to return unified JSON payloads.