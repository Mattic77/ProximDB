# ProximDB (Search & Relationship Engine)

ProximDB is an embedded, zero-network-latency search and recommendation middleware built for **Node.js** and **Express.js**.

Instead of running slow wildcard text searches (`LIKE '%...%'`) or expensive multi-table graph joins on your primary production database (Postgres, MySQL, MongoDB), ProximDB mirrors targeted data into an in-process, memory-cached SQLite engine (`better-sqlite3`).

---

## 🗺️ Visual Architecture & Data Flow

```mermaid
flowchart TD
    subgraph Primary_Databases["1. Primary Database Source"]
        PG["PostgreSQL"]
        MY["MySQL"]
        MG["MongoDB"]
    end

    subgraph Adapters_Layer["2. Adapters (src/adapters/)"]
        PA["postgres.adapter.ts"]
        MA["mysql.adapter.ts"]
        MOA["mongodb.adapter.ts"]
        MEM["memory.adapter.ts"]
    end

    subgraph Engine_Layer["3. Embedded Engine Core (src/engine/)"]
        CM["cache.manager.ts<br/>(Delta Sync & Timers)"]
        IDX["indexer.ts<br/>(Atomic Transactions)"]
        EDB["embedded.db.ts<br/>(SQLite + WAL Mode + Levenshtein)"]
    end

    subgraph Strategies_Layer["4. Query Strategies (src/strategies/)"]
        FZ["fuzzy.strategy.ts<br/>(Typo & Substring Search)"]
        PRX["proximity.strategy.ts<br/>(Recursive CTE Graph Recommendations)"]
    end

    subgraph Express_Layer["5. Express Middleware (src/middleware/)"]
        MW["express.ts<br/>(req.proxim & /api/search)"]
        CLT["Client / Browser Request"]
    end

    Primary_Databases --> Adapters_Layer
    Adapters_Layer --> CM
    CM --> IDX
    IDX --> EDB
    CLT --> MW
    MW --> FZ & PRX
    FZ & PRX --> EDB
```

---

## 📁 Complete Folder & File Breakdown

Here is an explanation of what each file does and why it exists:

```text
dbsearchengine/
│
├── 📁 src/                             # Core TypeScript source code
│   │
│   ├── 📁 adapters/                    # Connectors that pull data from your primary DB
│   │   ├── base.adapter.ts             # Abstract class defining the contract & text normalizer
│   │   ├── postgres.adapter.ts         # Pulls rows/relations from PostgreSQL tables
│   │   ├── mysql.adapter.ts            # Pulls rows/relations from MySQL tables
│   │   ├── mongodb.adapter.ts          # Pulls documents/relations from MongoDB collections
│   │   ├── memory.adapter.ts           # In-memory mock adapter (used for testing without DB servers)
│   │   └── index.ts                    # Exports all database adapters
│   │
│   ├── 📁 engine/                      # The local SQLite embedded storage brain
│   │   ├── embedded.db.ts              # Initializes better-sqlite3, sets WAL mode & registers custom functions
│   │   ├── indexer.ts                  # High-speed atomic batch writing for nodes and edges
│   │   └── cache.manager.ts            # Coordinates initial sync, incremental delta sync & background timers
│   │
│   ├── 📁 strategies/                  # Search & recommendation algorithms
│   │   ├── strategy.interface.ts       # Interface for creating pluggable search strategies
│   │   ├── fuzzy.strategy.ts           # Text search with typo tolerance (Damerau-Levenshtein)
│   │   ├── proximity.strategy.ts       # "People You May Know" graph traversal via recursive CTEs
│   │   └── index.ts                    # Exports all query strategies
│   │
│   ├── 📁 middleware/                  # Express.js developer tools
│   │   └── express.ts                  # Provides proximMiddleware() & turnkey createSearchHandler()
│   │
│   ├── index.ts                        # Main library entry point (ProximDB class orchestrator)
│   └── types.ts                        # TypeScript interfaces (configs, query schemas, records)
│
├── 📁 docs/                            # Deep-dive architectural documentation
│   ├── 01-Overview.md                  # Principles, zero-network overhead & internal SQLite schema
│   ├── 02-Search-Modes.md              # Detailed breakdown of fuzzy matching and recursive CTEs
│   └── 03-Sync-Engine.md               # Projection mapping, delta sync & adapter specs
│
├── 📁 scripts/                         # Practical runnable tools
│   └── run-demo.ts                     # Script that executes 5 real-world search scenarios
│
├── 📁 results/                         # Live test output & verification artifacts
│   ├── WALKTHROUGH.md                  # Full Markdown log showing real queries and 2ms responses
│   ├── demo-queries.json               # JSON export of all demo requests and responses
│   ├── test-results.json               # Vitest JSON test report
│   └── test-summary.txt                # Console output for the 19 passing tests
│
├── 📁 tests/                           # Vitest automated test suite (19 tests, 100% passing)
│   ├── embedded.db.test.ts             # Tests SQLite initialization & custom SQL functions
│   ├── indexer.test.ts                 # Tests bulk upserts, on-conflict updates & deletes
│   ├── fuzzy.strategy.test.ts          # Tests exact matches, prefixes, and typo tolerance
│   ├── proximity.strategy.test.ts      # Tests mutual connection scoring & direct friend exclusions
│   ├── proximdb.test.ts                # End-to-end multi-mode pipeline & incremental sync test
│   └── express.test.ts                 # Tests Express middleware & HTTP route handlers
│
├── package.json                        # Scripts, dependencies (better-sqlite3) & optional DB drivers
├── tsconfig.json                       # TypeScript compiler settings
└── tsup.config.ts                      # Multi-format bundler config (generates CJS, ESM & .d.ts)
```

---

## ⚙️ How the Code Works: Step-by-Step

### 1. Selective Projection Mapping
You don't replicate your whole database. You define **selective projection**, picking only the tables and fields you want to search or relate:
```typescript
const engine = new ProximDB({
  source: { client: 'postgres', uri: process.env.DATABASE_URL },
  // embeddedStoragePath is OPTIONAL (defaults to './.proximdb/search.db')
  // embeddedStoragePath: './cache/search.db', 
  mapping: {
    nodes: {
      user: {
        table: 'users',
        id: 'id',
        attributes: ['username', 'bio', 'city'], // Only index these 3 fields
        updatedAt: 'updated_at'                  // Enables incremental delta sync
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
```

### 2. The In-Process SQLite Engine (`src/engine/embedded.db.ts`)
- Opens an embedded SQLite database using native C bindings (`better-sqlite3`).
- Sets **WAL Mode (`PRAGMA journal_mode = WAL`)** for maximum read/write concurrency.
- Sets `synchronous = NORMAL` and 64MB memory caching.
- Registers a custom SQLite scalar function:
  `fuzzy_similarity(s1, s2)`: Computes Damerau-Levenshtein edit distance (handling character swaps like `"Jonh"` $\rightarrow$ `"John"`).

### 3. Bulk Indexing (`src/engine/indexer.ts`)
- Uses prepared statements wrapped in a **single SQLite transaction** (`db.transaction(...)`).
- This allows indexing **10,000+ records in under 30 milliseconds**.
- Automatically flattens attributes into `search_text` for instant matching.

### 4. Search Execution (`src/engine/` & `src/strategies/`)
When your Express route receives a search query, it calls:
```typescript
const results = await engine.query({
  queryText: 'John',
  forUser: 'user_101',
  modes: ['fuzzy', 'proximity'],
  limits: { fuzzy: 5, proximity: 3 }
});
```

Here is what happens inside:
1. **Fuzzy Strategy:**
   - Scans local `search_nodes` using `search_text LIKE '%john%'` and `fuzzy_similarity(...) >= 0.65`.
   - Scores and ranks exact matches $\rightarrow$ prefix matches $\rightarrow$ substring matches $\rightarrow$ typo matches.
2. **Proximity Strategy:**
   - Runs a **Recursive Common Table Expression (CTE)** against `search_edges`.
   - Discovers friends-of-friends connected to `user_101`.
   - Excludes the user themselves and existing direct friends.
   - Calculates `mutualCount` and human-friendly reasons: `"You have 4 mutual connections"`.
3. Returns a unified JSON response in **~2 milliseconds**.

---

## 🚀 Express.js Integration

### Option A: Turnkey Search Route
```typescript
import express from 'express';
import { ProximDB, createSearchHandler } from 'proximdb';

const app = express();
const engine = new ProximDB({ /* config */ });
await engine.initialize();

// Automatically handles GET /api/search?q=John&forUser=user_101&modes=fuzzy,proximity
app.get('/api/search', createSearchHandler(engine));

app.listen(3000);
```

### Option B: Custom Route via `req.proxim`
```typescript
import express from 'express';
import { ProximDB, proximMiddleware } from 'proximdb';

const app = express();
const engine = new ProximDB({ /* config */ });
await engine.initialize();

// Attaches engine to req.proxim
app.use(proximMiddleware(engine));

app.get('/search-users', async (req, res) => {
  const data = await req.proxim.query({
    queryText: req.query.name as string,
    forUser: req.user?.id,
    modes: ['fuzzy', 'proximity']
  });
  res.json(data);
});
```

---

## 🛡️ Security Architecture & Database Protection

ProximDB is engineered with defense-in-depth protections to guarantee hackers cannot exploit or attack your primary database:

1. **Zero Mutation Guarantee (Read-Only Isolation):**
   - ProximDB never issues `INSERT`, `UPDATE`, `DELETE`, or `DROP` statements to your production database.
   - All external connectors only run targeted `SELECT` statements. Developers can safely grant read-only user credentials to ProximDB.

2. **SQL & NoSQL Identifier Validation:**
   - All table, column, and attribute identifiers are validated against strict alphanumeric/underscore whitelists (`^[a-zA-Z_][a-zA-Z0-9_]*$`).
   - Any malicious injection payload (such as `users"; DROP TABLE users; --` or `$where`) immediately triggers a `SecurityError` before any database connection or query is initiated.

3. **Strict Recursive CTE Graph Bounds:**
   - Graph pathfinding in SQLite is strictly capped to a safe maximum of 5 hops (`maxHops <= 5`).
   - This prevents attackers from submitting payloads like `maxHops: 9999` that could trigger combinatorial path explosions and freeze server CPU or memory.

4. **DoS & Memory Exhaustion Clamping:**
   - Search strings are capped to 250 characters with null-byte (`\0`) stripping to prevent ReDoS.
   - Result limits are strictly clamped between `1` and `1,000` rows, blocking memory exhaustion attacks.

5. **Express Input Hardening:**
   - Query parameters from Express (`req.query.q`, `req.query.modes`, `req.query.forUser`) are typed, sanitized, and filtered against an allowed alphanumeric regex to prevent prototype pollution or array injection.

---

## 🧪 Testing & Verification

All automated tests are pre-configured with **Vitest**:

```bash
# 1. Run all 19 automated tests
npm test

# 2. Run tests and export structured JSON & console logs to results/
npm run test:report

# 3. Run the live demo script and update results/WALKTHROUGH.md
npm run demo

# 4. Check TypeScript types
npm run typecheck

# 5. Build CJS & ESM release bundles in dist/
npm run build
```

---

## 📚 Further Reading

- [Architecture & Principles](docs/01-Overview.md)
- [Search Modes & Recursive CTEs](docs/02-Search-Modes.md)
- [Sync Engine & Adapters](docs/03-Sync-Engine.md)
- [Live Test Walkthrough & Latency](results/WALKTHROUGH.md)
