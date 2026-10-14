# Search Modes & Pipeline Strategies

ProximDB provides a multi-mode query pipeline allowing developers to execute multiple search strategies simultaneously and return unified responses.

## 1. Fuzzy Strategy (`'fuzzy'`)

The fuzzy strategy handles text searches, partial phrases, prefixes, and typo tolerance.

### Key Capabilities:
- **Exact & Prefix Matches:** Ranked highest when tokens or full strings match the query.
- **Substring Match:** Fast substring identification via SQLite.
- **Damerau-Levenshtein Typo Tolerance:** Detects misspellings, substitutions, insertions, deletions, and character transpositions (e.g. `"Jonh"` matches `"John"`).
- **Customizable Threshold:** Tune sensitivity using the `threshold` parameter (default `0.65`).

### Example:
```typescript
const res = await searchEngine.query({
  queryText: 'Jonh',
  modes: ['fuzzy'],
  limits: { fuzzy: 10 },
  threshold: 0.6
});
```

---

## 2. Proximity Strategy (`'proximity'`)

The proximity strategy calculates graph-based relationship recommendations (e.g., "People You May Know", co-connections, or related entity graphs).

### Mechanism:
1. **Recursive CTE Graph Traversal:** Traverses up to `maxHops` (default: 2) across the local SQLite edge graph.
2. **Mutual Path Aggregation:** Aggregates and counts unique mutual connection intermediaries between the context user (`forUser`) and candidates.
3. **Exclusion Filter:** Excludes the user themselves and existing direct (1st degree) connections from candidate recommendations.
4. **Human-Readable Explanations:** Automatically calculates a `reason` property (e.g., `"You have 4 mutual connections"`).

### Example:
```typescript
const res = await searchEngine.query({
  forUser: 'user_101',
  modes: ['proximity'],
  limits: { proximity: 5 }
});
```

---

## 3. Combining Modes in a Single Pipeline

A key strength of ProximDB is orchestrating multiple strategies simultaneously in one local call:

```typescript
const searchResults = await searchEngine.query({
  queryText: 'John',
  forUser: 'user_101',
  modes: ['fuzzy', 'proximity'],
  limits: {
    fuzzy: 5,
    proximity: 3
  }
});
```

Response payload:
```json
{
  "query": "John",
  "forUser": "user_101",
  "results": {
    "fuzzy": [
      { "id": "u_201", "username": "JohnDoe", "city": "Paris" },
      { "id": "u_305", "username": "Johnny", "city": "Lyon" }
    ],
    "proximity": [
      { "id": "u_410", "username": "AlexSmith", "mutualCount": 4, "reason": "You have 4 mutual connections" }
    ]
  },
  "meta": {
    "tookMs": 2,
    "counts": {
      "fuzzy": 2,
      "proximity": 1
    }
  }
}
```

---

## 4. Custom Strategies

Developers can create custom strategies implementing the `SearchStrategy` interface:

```typescript
import { SearchStrategy, QueryParams } from 'proximdb';

class TrendingStrategy implements SearchStrategy {
  readonly name = 'trending';

  execute(db, params) {
    return db.prepare('SELECT * FROM search_nodes ORDER BY updated_at DESC LIMIT 5').all();
  }
}

searchEngine.registerStrategy(new TrendingStrategy());
```
