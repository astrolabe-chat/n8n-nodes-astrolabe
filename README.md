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
| **Message a Model** | Chat completion. The model is picked from a dropdown loaded live from the Astrolabe catalogue. Returns `content` + `reasoning_content` (internal reasoning) + `usage`. Optionally **grounds the answer on one or more knowledge bases** (RAG) — the extracts used come back in `astrolabe_sources`. |
| **Create an Embedding** | Turns text into a vector for semantic search or RAG. The embedding model is picked from the same live catalogue. |

> ⚠️ `astrolabe-base` reasons before answering: keep **Max Tokens ≥ 600** or the reply may come back empty. The node already defaults to 600.

### Knowledge Base

| Operation | Endpoint |
| --- | --- |
| **List** | `GET /kb` |
| **Create** | `POST /kb` (name, intent, facet schema) |
| **Update** | `PATCH /kb/{slug}` (rename / re-slug) |
| **Delete** | `DELETE /kb/{slug}` |
| **Search** | `POST /kb/{slug}/search` — direct semantic search, no model call |

### Document

| Operation | Endpoint |
| --- | --- |
| **List** | `GET /kb/{slug}/documents` |
| **Add** | `POST /kb/{slug}/documents` — text, date, external ID, **upsert**, **simple / AI chunking** |
| **Get** | `GET …/documents/{id}` — by UUID **or** external ID |
| **Update** | `PATCH …/documents/{id}` — title / date / external ID |
| **Delete** | `DELETE …/documents/{id}` |

### Chunk

| Operation | Endpoint |
| --- | --- |
| **List** | `GET …/documents/{id}/chunks` (decrypted) |
| **Add** | `POST …/documents/{id}/chunks` (facets, date) |
| **Update** | `PATCH …/chunks/{chunkId}` |
| **Delete** | `DELETE …/chunks/{chunkId}` |

### Notes

- **List & Search** operations fan out one n8n item per result, so you can map over them directly.
- **Documents and chunks are addressable by UUID *or* your own `external_id`.** Adding a document with an existing `external_id` **replaces** it (idempotent upsert).
- **Chunking (Add Document)**: `Simple` (paragraphs, default) or `AI (intent-driven)`. AI chunking reveals a **Chunking Model** dropdown (default `mistral-small`) used to split the text along the base's intent — metered on your key, **on top of** the embedding cost.
- **RAG on chat**: select one or more **Knowledge Base(s)**; optionally set the *Knowledge Base Query*, *Facet Filter (JSON)* and *Retrieved Extracts (Top K)* in **Options**. Empty fields are omitted, so a plain chat call is unchanged.
- **JSON fields** (facets, facet schema): pass a JSON object as text, e.g. `{"theme":"billing"}`. The API accepts a JSON string or a real object.

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
