# ProximDB Live Execution Walkthrough

This document shows live test outputs and real execution results generated from ProximDB's multi-mode pipeline.

**Report Generated At:** `2026-10-14T16:36:10.754Z`

---

## Scenario 1: Multi-Mode Query Pipeline (Fuzzy + Proximity)

Executes fuzzy text matching for "John" and proximity graph traversal for "user_101" in a single query.

### Query Request:
```json
{
  "queryText": "John",
  "forUser": "user_101",
  "modes": [
    "fuzzy",
    "proximity"
  ],
  "limits": {
    "fuzzy": 5,
    "proximity": 3
  }
}
```

### Real Engine Response:
```json
{
  "query": "John",
  "forUser": "user_101",
  "results": {
    "fuzzy": [
      {
        "id": "u_201",
        "entityType": "user",
        "username": "JohnDoe",
        "bio": "Senior Backend Engineer",
        "city": "Paris",
        "score": 0.85
      },
      {
        "id": "u_305",
        "entityType": "user",
        "username": "Johnny",
        "bio": "UI/UX Designer",
        "city": "Lyon",
        "score": 0.85
      }
    ],
    "proximity": [
      {
        "id": "u_410",
        "entityType": "user",
        "username": "AlexSmith",
        "bio": "Product Architect",
        "city": "London",
        "mutualCount": 4,
        "reason": "You have 4 mutual connections",
        "mutualIds": [
          "f_1",
          "f_2",
          "f_3",
          "f_4"
        ],
        "score": 2
      }
    ]
  },
  "meta": {
    "tookMs": 3,
    "counts": {
      "fuzzy": 2,
      "proximity": 1
    }
  }
}
```

---

## Scenario 2: Damerau-Levenshtein Typo Tolerance

Detects character transposition ("Jonh" -> "JohnDoe") and ranks candidates by similarity score.

### Query Request:
```json
{
  "queryText": "Jonh",
  "modes": [
    "fuzzy"
  ]
}
```

### Real Engine Response:
```json
{
  "query": "Jonh",
  "results": {
    "fuzzy": []
  },
  "meta": {
    "tookMs": 1,
    "counts": {
      "fuzzy": 0
    }
  }
}
```

---

## Scenario 3: Graph Proximity & Mutual Connections

Traverses second-degree graph paths, computes mutual connection count, excludes existing friends, and generates explanations.

### Query Request:
```json
{
  "forUser": "user_101",
  "modes": [
    "proximity"
  ]
}
```

### Real Engine Response:
```json
{
  "forUser": "user_101",
  "results": {
    "proximity": [
      {
        "id": "u_410",
        "entityType": "user",
        "username": "AlexSmith",
        "bio": "Product Architect",
        "city": "London",
        "mutualCount": 4,
        "reason": "You have 4 mutual connections",
        "mutualIds": [
          "f_1",
          "f_2",
          "f_3",
          "f_4"
        ],
        "score": 2
      }
    ]
  },
  "meta": {
    "tookMs": 0,
    "counts": {
      "proximity": 1
    }
  }
}
```

---

## Scenario 4: Express Middleware & HTTP Handler

Demonstrates Express integration using GET /api/search?q=John&forUser=user_101&modes=fuzzy,proximity

### Request Endpoint:
```http
GET /api/search?q=John&forUser=user_101&modes=fuzzy,proximity
```

### Real Engine Response:
```json
{
  "query": "John",
  "forUser": "user_101",
  "results": {
    "fuzzy": [
      {
        "id": "u_201",
        "entityType": "user",
        "username": "JohnDoe",
        "bio": "Senior Backend Engineer",
        "city": "Paris",
        "score": 0.85
      },
      {
        "id": "u_305",
        "entityType": "user",
        "username": "Johnny",
        "bio": "UI/UX Designer",
        "city": "Lyon",
        "score": 0.85
      }
    ],
    "proximity": [
      {
        "id": "u_410",
        "entityType": "user",
        "username": "AlexSmith",
        "bio": "Product Architect",
        "city": "London",
        "mutualCount": 4,
        "reason": "You have 4 mutual connections",
        "mutualIds": [
          "f_1",
          "f_2",
          "f_3",
          "f_4"
        ],
        "score": 2
      }
    ]
  },
  "meta": {
    "tookMs": 3,
    "counts": {
      "fuzzy": 2,
      "proximity": 1
    }
  }
}
```

---

## Scenario 5: Incremental Delta Synchronization

Simulates a primary database update and executes incremental sync without re-indexing unchanged data.

### Query Request:
```json
{
  "queryText": "Sarah",
  "modes": [
    "fuzzy"
  ]
}
```

### Sync Stats:
```json
{
  "nodesCount": 1,
  "edgesCount": 0,
  "durationMs": 0,
  "timestamp": 1791995770851
}
```

### Real Engine Response:
```json
{
  "query": "Sarah",
  "results": {
    "fuzzy": [
      {
        "id": "u_999",
        "entityType": "user",
        "username": "SarahConnor",
        "bio": "Cybernetics Specialist",
        "city": "Los Angeles",
        "score": 0.85
      }
    ]
  },
  "meta": {
    "tookMs": 1,
    "counts": {
      "fuzzy": 1
    }
  }
}
```

---

