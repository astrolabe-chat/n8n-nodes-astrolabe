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

| Operation | Description |
| --- | --- |
| **Message a Model** | Chat completion. The model is picked from a dropdown loaded live from the Astrolabe catalogue. Returns `content` + `reasoning_content` (internal reasoning) + `usage`. |
| **Create an Embedding** | Turns text into a vector for semantic search or RAG. The embedding model is picked from the same live catalogue. |

> ⚠️ `astrolabe-base` reasons before answering: keep **Max Tokens ≥ 600** or the reply may come back empty. The node already defaults to 600.

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
