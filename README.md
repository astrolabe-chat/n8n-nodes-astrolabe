# n8n-nodes-astrolabe

[n8n](https://n8n.io) community node for **[Astrolabe](https://astrolabe.chat)** — sovereign EU AI for the social and solidarity economy. Astrolabe's API is OpenAI-compatible, so this node talks to `api.astrolabe.chat` with no code.

[Installation](#installation) · [Credential](#credential) · [Operations](#operations) · [Development](#development) · [License](#license)

## Installation

Follow the [n8n community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/).

In n8n: **Settings → Community Nodes → Install**, then enter `n8n-nodes-astrolabe`.

## Credential

1. **Credentials → New → Astrolabe API**
2. **API Key**: your `sk-astrolabe-...` key (from the [developer portal](https://app.astrolabe.chat))
3. **Base URL**: `https://api.astrolabe.chat/v1` (default)

## Operations

The node is organised by **resource**. Every knowledge-base dropdown is loaded live from your account.

### AI

| Operation | Description |
| --- | --- |
| **Message a Model** | Chat completion. The model is picked from a dropdown loaded live from the Astrolabe catalogue. Returns `content` + `reasoning_content` (internal reasoning) + `usage`. Optionally **grounds the answer on one or more knowledge bases** (RAG) — the extracts used come back in `astrolabe_sources`. RAG supports **static or agentic** mode (the model searches on its own, multi-step — trace in `astrolabe_steps`), plus facet filter, date range, graph expansion, history window and source-link citation. |
| **Create an Embedding** | Turns text into a vector for semantic search or RAG. The embedding model is picked from the same live catalogue. |

> ⚠️ `astrolabe-base` reasons before answering: keep **Max Tokens ≥ 600** or the reply may come back empty. The node already defaults to 600.

### Knowledge Base

| Operation | Endpoint |
| --- | --- |
| **List** | `GET /kb` |
| **Create** | `POST /kb` (name, intent, **type `data` / `process`**, facet schema) |
| **Update** | `PATCH /kb/{slug}` (rename / re-slug / change type) |
| **Delete** | `DELETE /kb/{slug}` |
| **Search** | `POST /kb/{slug}/search` — **semantic** (with a query) **and/or analytic** (filters, sort, group by, offset, date range, graph expansion, numeric aggregates), no model call |

### Document

| Operation | Endpoint |
| --- | --- |
| **List** | `GET /kb/{slug}/documents` |
| **Add** | `POST /kb/{slug}/documents` — text, date, external ID, source URL, facet overrides, **upsert**, **simple / AI chunking** |
| **Get** | `GET …/documents/{id}` — by UUID **or** external ID |
| **Update** | `PATCH …/documents/{id}` — title / date / external ID / source URL |
| **Delete** | `DELETE …/documents/{id}` |

### Chunk

| Operation | Endpoint |
| --- | --- |
| **List** | `GET …/documents/{id}/chunks` (decrypted) |
| **Add** | `POST …/documents/{id}/chunks` (facets, date) |
| **Update** | `PATCH …/chunks/{chunkId}` |
| **Delete** | `DELETE …/chunks/{chunkId}` |

### Notes

- **List** operations fan out one n8n item per result, so you can map over them directly.
- **Search** returns a **single structured item** — `results` (the rows) plus the analytic metadata `group_by`, `total` (exact count at the chosen granularity), `truncated` (page incomplete → paginate with *Offset*), `distinct_documents` (date mode) and `aggregates` (`{field, count, sum, avg, min, max}` per numeric facet). Use a *Split Out* node on `results` to fan them out. To **count records**, set *Return* = `Documents` and read `total`; to **sum/average** a numeric facet, set *Aggregate* and read `aggregates`.
- **Analytic search**: leave *Query* empty to list/filter only (no score, no embedding cost). Compose typed *Filters* (`eq/neq/gt/gte/lt/lte/in/contains`), exact-match *Facets*, *Date Range*, *Sort* and *Offset* freely.
- **Documents and chunks are addressable by UUID *or* your own `external_id`.** Adding a document with an existing `external_id` **replaces** it (idempotent upsert).
- **Chunking (Add Document)**: `Simple` (paragraphs, default) or `AI (intent-driven)`. AI chunking reveals a **Chunking Model** dropdown (default `mistral-small`) used to split the text along the base's intent — metered on your key, **on top of** the embedding cost. *Facet Overrides (JSON)* forces facet values on every chunk (takes priority over AI-extracted ones).
- **Knowledge base type**: a base is `data` (facts, default) or `process` (playbooks describing how to run an analysis — consulted first in agentic RAG).
- **RAG on chat**: select one or more **Knowledge Base(s)**; in **Options** set the *Knowledge Base Mode* (`static` / `agentic`), *Query*, *Facet Filter (JSON)*, *Top K*, *Date Range*, *Graph Expansion (JSON)*, *Cite Source Links*, *Search Conversation Turns* and *Max Tool Calls* (agentic). Empty fields are omitted, so a plain chat call is unchanged.
- **JSON fields** (facets, filters, facet schema, facet overrides, graph expansion, aggregate): pass a JSON value as text, e.g. `{"theme":"billing"}`. The API accepts a JSON string or a real object.

## Sovereignty

Data flows through Astrolabe's infrastructure (France / EU). Routing to a cloud model (Claude/GPT/Mistral) moves data outside the EU and is opt-in only.

## Development

```bash
npm install
npm run build   # tsc + icon copy
npm run lint    # verified community node rules
```

To test locally, link the package into your n8n custom folder (`~/.n8n/custom`) with `npm link`.

### Releasing

CI publishes to npm **with a provenance statement** when `version` in `package.json` is new (idempotent otherwise). To release: bump the version and merge to `main`. Requires the repo secret `NPM_TOKEN` (npm Automation token).

## License

[MIT](LICENSE)
