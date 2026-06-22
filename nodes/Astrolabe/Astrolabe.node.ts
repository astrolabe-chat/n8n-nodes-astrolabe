import type {
  IExecuteFunctions,
  IDataObject,
  GenericValue,
  ILoadOptionsFunctions,
  INodeExecutionData,
  INodePropertyOptions,
  INodeType,
  INodeTypeDescription,
  IHttpRequestMethods,
  JsonObject,
} from "n8n-workflow";
import { NodeApiError, NodeOperationError } from "n8n-workflow";

// Loads the live model list for a given mode and maps it to dropdown options.
// The pricing catalogue lives on the integrated API and requires the API key.
async function loadModels(
  ctx: ILoadOptionsFunctions,
  mode: "chat" | "embedding",
): Promise<INodePropertyOptions[]> {
  const credentials = await ctx.getCredentials("astrolabeApi");
  const baseUrl = (credentials.baseUrl as string).replace(/\/+$/, "");
  // The pricing catalogue is served at /v1/pricing (under the base URL, but
  // outside the /v1/models/* namespace owned by the gateway).
  const response = (await ctx.helpers.httpRequestWithAuthentication.call(ctx, "astrolabeApi", {
    method: "GET",
    url: `${baseUrl}/pricing`,
    json: true,
  })) as { data?: IDataObject[] };

  return (response.data ?? [])
    .filter((m) => m.mode === mode)
    .map((m) => {
      const pricing = (m.pricing ?? {}) as IDataObject;
      const origin = m.sovereign ? "Sovereign EU" : "Cloud passthrough";
      const inPrice = pricing.input_per_million_tokens;
      const outPrice = pricing.output_per_million_tokens;
      // Embedding models have no output price; show input only in that case.
      const price =
        outPrice != null ? `${inPrice}/${outPrice}` : `${inPrice}`;
      return {
        name: (m.name as string) || (m.id as string),
        value: m.id as string,
        description: `${origin} · ${m.context_max} ctx · ${price} ${pricing.currency}/M tokens`,
      };
    });
}

// Loads the account's knowledge bases for the base/slug dropdowns.
async function loadKnowledgeBases(
  ctx: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
  const credentials = await ctx.getCredentials("astrolabeApi");
  const baseUrl = (credentials.baseUrl as string).replace(/\/+$/, "");
  const response = (await ctx.helpers.httpRequestWithAuthentication.call(ctx, "astrolabeApi", {
    method: "GET",
    url: `${baseUrl}/kb`,
    json: true,
  })) as { data?: IDataObject[] };

  return (response.data ?? []).map((b) => ({
    name: `${b.name as string} (${b.slug as string})`,
    value: b.slug as string,
    description: (b.intent as string) || undefined,
  }));
}

// Facet/schema fields are free-text JSON in the UI. The Astrolabe API accepts a
// JSON string or a real object for these — parse when possible, send as-is
// otherwise, and drop empty values entirely.
type ApiValue = GenericValue | IDataObject | GenericValue[] | IDataObject[];

function jsonMaybe(value: unknown): ApiValue | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return value as ApiValue;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  try {
    return JSON.parse(trimmed) as ApiValue;
  } catch {
    return trimmed;
  }
}

// Drops undefined/empty-string entries so optional fields are omitted from the
// request body (the API treats "absent" and "empty" differently for some paths).
function compact(body: IDataObject): IDataObject {
  const out: IDataObject = {};
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    out[k] = v;
  }
  return out;
}

// Builds a nested object (e.g. `sort` { by, dir } or `date_range` { from, to })
// from its parts, returning undefined when nothing is set so compact() drops the
// whole key instead of sending an empty object the API would reject.
function nested(obj: IDataObject): IDataObject | undefined {
  const out = compact(obj);
  return Object.keys(out).length > 0 ? out : undefined;
}

export class Astrolabe implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Astrolabe",
    name: "astrolabe",
    icon: "file:astrolabe.svg",
    group: ["transform"],
    version: 1,
    subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
    description:
      "Sovereign EU AI for the social economy — chat, embeddings and knowledge bases (OpenAI-compatible API)",
    defaults: {
      name: "Astrolabe",
    },
    inputs: ["main"],
    outputs: ["main"],
    credentials: [
      {
        name: "astrolabeApi",
        required: true,
      },
    ],
    properties: [
      {
        displayName: "Resource",
        name: "resource",
        type: "options",
        noDataExpression: true,
        options: [
          { name: "AI", value: "model", description: "Chat completions and embeddings" },
          { name: "Chunk", value: "chunk", description: "Individual extracts inside a document" },
          { name: "Document", value: "document", description: "Documents inside a knowledge base" },
          { name: "Knowledge Base", value: "knowledgeBase", description: "RAG knowledge bases" },
        ],
        default: "model",
      },

      // ===================== AI (chat + embedding) =====================
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        displayOptions: { show: { resource: ["model"] } },
        options: [
          {
            name: "Create an Embedding",
            value: "embedding",
            description: "Turn text into a vector for semantic search or RAG",
            action: "Create an embedding",
          },
          {
            name: "Message a Model",
            value: "chat",
            description: "Send messages and get a chat completion",
            action: "Message a model",
          },
        ],
        default: "chat",
      },

      // ----- Chat -----
      {
        displayName: 'Model Name or ID',
        name: "model",
        type: "options",
        typeOptions: { loadOptionsMethod: "getChatModels" },
        default: "astrolabe-base",
        required: true,
        description:
          'Chat model to use. The list is loaded live from the Astrolabe catalogue. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
        displayOptions: { show: { resource: ["model"], operation: ["chat"] } },
      },
      {
        displayName: "Messages",
        name: "messages",
        type: "fixedCollection",
        typeOptions: { multipleValues: true, sortable: true },
        placeholder: "Add Message",
        default: { message: [{ role: "user", content: "" }] },
        displayOptions: { show: { resource: ["model"], operation: ["chat"] } },
        options: [
          {
            name: "message",
            displayName: "Message",
            values: [
              {
                displayName: "Role",
                name: "role",
                type: "options",
                options: [
                  { name: "System", value: "system" },
                  { name: "User", value: "user" },
                  { name: "Assistant", value: "assistant" },
                ],
                default: "user",
              },
              {
                displayName: "Content",
                name: "content",
                type: "string",
                typeOptions: { rows: 3 },
                default: "",
              },
            ],
          },
        ],
      },
      {
        displayName: "Knowledge Base Names or IDs",
        name: "knowledgeBases",
        type: "multiOptions",
        typeOptions: { loadOptionsMethod: "getKnowledgeBases" },
        default: [],
        description:
          'Optional RAG: ground the answer on one or more knowledge bases. The extracts used are returned in <code>astrolabe_sources</code>. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
        displayOptions: { show: { resource: ["model"], operation: ["chat"] } },
      },
      {
        displayName: "Options",
        name: "options",
        type: "collection",
        placeholder: "Add Option",
        default: {},
        displayOptions: { show: { resource: ["model"], operation: ["chat"] } },
        options: [
          {
            displayName: "Cite Source Links",
            name: "knowledgeBaseCiteSources",
            type: "boolean",
            default: false,
            description:
              "Whether to let the model include each extract's source link (source_url, when set) in its answer, so the reader can reach the original resource. Only used when a knowledge base is selected.",
          },
          {
            displayName: "Date Range From (YYYY-MM-DD)",
            name: "kbDateFrom",
            type: "string",
            default: "",
            description:
              "Keep only extracts whose business date is on/after this date. Only used when a knowledge base is selected.",
          },
          {
            displayName: "Date Range To (YYYY-MM-DD)",
            name: "kbDateTo",
            type: "string",
            default: "",
            description:
              "Keep only extracts whose business date is on/before this date. Only used when a knowledge base is selected.",
          },
          {
            displayName: "Facet Filter (JSON)",
            name: "knowledgeBaseFacets",
            type: "string",
            default: "",
            description:
              'Optional JSON object to filter retrieved extracts, e.g. {"theme":"billing"}. Only used when a knowledge base is selected.',
          },
          {
            displayName: "Graph Expansion (JSON)",
            name: "knowledgeBaseExpand",
            type: "string",
            default: "",
            description:
              'Pull in extracts linked by FACETS (business relation), on top of semantic ones. JSON object: seeds (default 3), facets (which facet keys to follow; omit = all), match ("all" = shares every facet, "any" = shares at least one), depth (levels, default 1), max_chunks (hard cap, default 30). Example: {"facets":["dossier"],"match":"any","depth":3,"max_chunks":60}. Only used when a knowledge base is selected.',
          },
          {
            displayName: "Knowledge Base Max Tool Calls (Agentic)",
            name: "knowledgeBaseMaxSteps",
            type: "number",
            default: 8,
            description:
              "Agentic mode only: max number of search rounds the model may run (default 8, max 15). Only used when a knowledge base is selected.",
          },
          {
            displayName: "Knowledge Base Mode",
            name: "knowledgeBaseMode",
            type: "options",
            options: [
              { name: "Static (Retrieve Once)", value: "static" },
              { name: "Agentic (Model Searches On Its Own)", value: "agentic" },
            ],
            default: "static",
            description:
              "Agentic lets the model decide when/what to search and loop (more calls, non-streaming). Static retrieves once before answering. Only used when a knowledge base is selected.",
          },
          {
            displayName: "Knowledge Base Query",
            name: "knowledgeBaseRequest",
            type: "string",
            default: "",
            description:
              "Targeted text used to search the base(s). Defaults to the last message. Only used when a knowledge base is selected.",
          },
          {
            displayName: "Max Tokens",
            name: "maxTokens",
            type: "number",
            default: 600,
            description:
              "Tokens allotted to the response (reasoning included). astrolabe-base reasons before answering: with fewer than 300, the reply can come back empty. 600 minimum is recommended.",
          },
          {
            displayName: "Response Format",
            name: "responseFormat",
            type: "options",
            options: [
              { name: "Text", value: "text" },
              { name: "JSON Object", value: "json_object" },
            ],
            default: "text",
            description:
              "JSON Object forces valid JSON output (internal reasoning is then disabled server-side)",
          },
          {
            displayName: "Retrieved Extracts (Top K)",
            name: "knowledgeBaseTopK",
            type: "number",
            default: 8,
            description:
              "How many extracts to retrieve from the knowledge base(s). Only used when a knowledge base is selected.",
          },
          {
            displayName: "Search Conversation Turns",
            name: "knowledgeBaseHistory",
            type: "number",
            default: 3,
            description:
              "How many recent user turns to fold into the retrieval query, so short follow-ups keep the subject (default 3). Set 1 to search on the last message only. Only used when a knowledge base is selected.",
          },
          {
            displayName: "Temperature",
            name: "temperature",
            type: "number",
            typeOptions: { minValue: 0, maxValue: 2, numberPrecision: 2 },
            default: 0.7,
            description: "0 = deterministic (extraction), 0.7 = creative (writing)",
          },
        ],
      },

      // ----- Embedding -----
      {
        displayName: 'Model Name or ID',
        name: "embeddingModel",
        type: "options",
        typeOptions: { loadOptionsMethod: "getEmbeddingModels" },
        default: "mistral-embed",
        required: true,
        description:
          'Embedding model to use. The list is loaded live from the Astrolabe catalogue. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
        displayOptions: { show: { resource: ["model"], operation: ["embedding"] } },
      },
      {
        displayName: "Text",
        name: "input",
        type: "string",
        typeOptions: { rows: 3 },
        default: "",
        required: true,
        description: "Text to embed",
        displayOptions: { show: { resource: ["model"], operation: ["embedding"] } },
      },

      // ===================== Knowledge Base =====================
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        displayOptions: { show: { resource: ["knowledgeBase"] } },
        options: [
          {
            name: "Create",
            value: "create",
            description: "Create a knowledge base",
            action: "Create a knowledge base",
          },
          {
            name: "Delete",
            value: "delete",
            description: "Delete a knowledge base and all its content",
            action: "Delete a knowledge base",
          },
          {
            name: "List",
            value: "list",
            description: "List all knowledge bases",
            action: "List knowledge bases",
          },
          {
            name: "Search",
            value: "search",
            description: "Semantic search over a base (no model call)",
            action: "Search a knowledge base",
          },
          {
            name: "Update",
            value: "update",
            description: "Rename or re-slug a knowledge base",
            action: "Update a knowledge base",
          },
        ],
        default: "list",
      },
      {
        displayName: "Knowledge Base Name or ID",
        name: "slug",
        type: "options",
        typeOptions: { loadOptionsMethod: "getKnowledgeBases" },
        default: "",
        required: true,
        description: 'The base to act on. Choose from the list, or specify a slug using an <a href="https://docs.n8n.io/code/expressions/">expression</a>. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
        displayOptions: {
          show: { resource: ["knowledgeBase"], operation: ["update", "delete", "search"] },
        },
      },
      // KB create
      {
        displayName: "Name",
        name: "name",
        type: "string",
        default: "",
        required: true,
        description: "Display name of the knowledge base",
        displayOptions: { show: { resource: ["knowledgeBase"], operation: ["create"] } },
      },
      {
        displayName: "Additional Fields",
        name: "additionalFields",
        type: "collection",
        placeholder: "Add Field",
        default: {},
        displayOptions: { show: { resource: ["knowledgeBase"], operation: ["create"] } },
        options: [
          {
            displayName: "Facet Schema (JSON)",
            name: "facetSchema",
            type: "string",
            default: "",
            description:
              'Optional JSON. Each facet: key, optional type (text|number|boolean|date), description (what the AI should put in it), values (enum, text only), default. e.g. {"facets":[{"key":"theme","values":["billing","support"]},{"key":"amount","type":"number","description":"Total in euros"}]}',
          },
          {
            displayName: "Intent",
            name: "intent",
            type: "string",
            default: "",
            description: "Describes the base's purpose; guides AI chunking",
          },
          {
            displayName: "Type",
            name: "role",
            type: "options",
            options: [
              { name: "Data", value: "data" },
              { name: "Process (Playbooks)", value: "process" },
            ],
            default: "data",
            description:
              "Data (default): a regular knowledge base of facts. Process: a base of playbooks describing, step by step, how to run an analysis. In agentic mode the AI consults it first to follow the right method.",
          },
        ],
      },
      // KB update
      {
        displayName: "Update Fields",
        name: "updateFields",
        type: "collection",
        placeholder: "Add Field",
        default: {},
        displayOptions: { show: { resource: ["knowledgeBase"], operation: ["update"] } },
        options: [
          {
            displayName: "New Intent",
            name: "intent",
            type: "string",
            default: "",
            description: "New intent description",
          },
          {
            displayName: "New Name",
            name: "name",
            type: "string",
            default: "",
            description: "New display name",
          },
          {
            displayName: "New Slug",
            name: "newSlug",
            type: "string",
            default: "",
            description: "Rename the base's API identifier (normalised, unique)",
          },
          {
            displayName: "Type",
            name: "role",
            type: "options",
            options: [
              { name: "Data", value: "data" },
              { name: "Process (Playbooks)", value: "process" },
            ],
            default: "data",
            description:
              "Process = a base of playbooks the AI consults first in agentic mode. Leave as Data for a regular base.",
          },
        ],
      },
      // KB search
      {
        displayName: "Query",
        name: "query",
        type: "string",
        default: "",
        description:
          "Semantic search query (no model call) when set. Leave EMPTY to list/filter only (no score, no embedding cost), useful with Filters and Sort.",
        displayOptions: { show: { resource: ["knowledgeBase"], operation: ["search"] } },
      },
      {
        displayName: "Options",
        name: "searchOptions",
        type: "collection",
        placeholder: "Add Option",
        default: {},
        displayOptions: { show: { resource: ["knowledgeBase"], operation: ["search"] } },
        options: [
          {
            displayName: "Aggregate (Numeric Facet, JSON)",
            name: "aggregate",
            type: "string",
            default: "",
            description:
              'Numeric facet name, or a JSON array of names, to SUM/AVERAGE exactly server-side. The "aggregates" output holds {field, count, sum, avg, min, max} per field. Analytic regime only (leave Query empty). Example: "montant_ttc" or ["montant_ht","tva"].',
          },
          {
            displayName: "Date Range From (YYYY-MM-DD)",
            name: "dateFrom",
            type: "string",
            default: "",
            description: "Keep only chunks whose business date is on/after this date",
          },
          {
            displayName: "Date Range To (YYYY-MM-DD)",
            name: "dateTo",
            type: "string",
            default: "",
            description: "Keep only chunks whose business date is on/before this date",
          },
          {
            displayName: "Facets Equality (JSON)",
            name: "facets",
            type: "string",
            default: "",
            description:
              'Optional JSON object for exact-match metadata, e.g. {"theme":"billing"}',
          },
          {
            displayName: "Filters (JSON)",
            name: "filters",
            type: "string",
            default: "",
            description:
              'Optional JSON array of typed facet comparisons. Each item: {"key":…, "op":…, "value":…}. Operators: eq, neq, gt, gte, lt, lte, in, contains. Dates are ISO YYYY-MM-DD. Example: [{"key":"montant","op":"gte","value":1000},{"key":"categorie","op":"in","value":["A","B"]}]',
          },
          {
            displayName: "Graph Expansion (JSON)",
            name: "expand",
            type: "string",
            default: "",
            description:
              'Also return chunks linked by FACETS (business relation), on top of semantic ones (requires a Query). JSON object: seeds (default 3), facets (which facet keys to follow; omit = all), match ("all" | "any"), depth (default 1), max_chunks (default 30). Example: {"facets":["dossier"],"match":"any","depth":3,"max_chunks":60}',
          },
          {
            displayName: "Max Results (Top K)",
            name: "topK",
            type: "number",
            default: 8,
            description:
              "Max results (capped at 50). For exhaustive listings, set 50 and paginate with Offset.",
          },
          {
            displayName: "Offset (Pagination)",
            name: "offset",
            type: "number",
            default: 0,
            description:
              "Skip N results (0, 50, 100…) to page through a large set exhaustively (listing mode)",
          },
          {
            displayName: "Return (Group By)",
            name: "groupBy",
            type: "options",
            options: [
              { name: "Chunks (One Result Per Excerpt)", value: "chunk" },
              { name: "Documents (Excerpts Grouped) — Read Total to Count", value: "document" },
              { name: "Dates (One Result Per Business Day) — Read Distinct Documents to Count", value: "date" },
            ],
            default: "chunk",
            description:
              '"document" groups excerpts by parent document (each once). "date" returns one result per distinct business date. To COUNT records, use "document" and read the total output; for a chronological view use "date" and read distinct_documents.',
          },
          {
            displayName: "Sort By",
            name: "sortBy",
            type: "options",
            options: [
              { name: "Relevance (Score)", value: "relevance" },
              { name: "Business Date", value: "date" },
              { name: "Creation Date (Added to Base)", value: "created" },
              { name: "Document Name (A→Z)", value: "alpha" },
            ],
            default: "relevance",
            description:
              '"relevance" requires a Query; without a query it falls back to date desc',
          },
          {
            displayName: "Sort Direction",
            name: "sortDir",
            type: "options",
            options: [
              { name: "Descending", value: "desc" },
              { name: "Ascending", value: "asc" },
            ],
            default: "desc",
          },
        ],
      },

      // ===================== Document =====================
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        displayOptions: { show: { resource: ["document"] } },
        options: [
          {
            name: "Add",
            value: "add",
            description: "Add a text document (chunked, embedded and encrypted server-side)",
            action: "Add a document",
          },
          {
            name: "Delete",
            value: "delete",
            description: "Delete a document and its chunks",
            action: "Delete a document",
          },
          {
            name: "Get",
            value: "get",
            description: "Get a document by UUID or external ID",
            action: "Get a document",
          },
          {
            name: "List",
            value: "list",
            description: "List a base's documents",
            action: "List documents",
          },
          {
            name: "Update",
            value: "update",
            description: "Update a document's metadata",
            action: "Update a document",
          },
        ],
        default: "list",
      },
      {
        displayName: "Knowledge Base Name or ID",
        name: "slug",
        type: "options",
        typeOptions: { loadOptionsMethod: "getKnowledgeBases" },
        default: "",
        required: true,
        description: 'The base the document lives in. Choose from the list, or specify a slug using an <a href="https://docs.n8n.io/code/expressions/">expression</a>. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
        displayOptions: { show: { resource: ["document"] } },
      },
      {
        displayName: "Document (UUID or External ID)",
        name: "documentId",
        type: "string",
        default: "",
        required: true,
        description: "The document's UUID returned by the API, or your own external ID",
        displayOptions: {
          show: { resource: ["document"], operation: ["get", "update", "delete"] },
        },
      },
      // Document add
      {
        displayName: "Text",
        name: "text",
        type: "string",
        typeOptions: { rows: 4 },
        default: "",
        required: true,
        description: "Plain text; chunked, embedded and encrypted server-side",
        displayOptions: { show: { resource: ["document"], operation: ["add"] } },
      },
      {
        displayName: "Additional Fields",
        name: "additionalFields",
        type: "collection",
        placeholder: "Add Field",
        default: {},
        displayOptions: { show: { resource: ["document"], operation: ["add"] } },
        options: [
          {
            displayName: "Business Date",
            name: "date",
            type: "dateTime",
            default: "",
            description: "Date of the content (chunks inherit it)",
          },
          {
            displayName: "Chunking",
            name: "chunking",
            type: "options",
            default: "simple",
            description: "How the text is split into chunks before embedding",
            options: [
              { name: "Simple (Paragraphs)", value: "simple" },
              { name: "AI (Intent-Driven)", value: "ai" },
            ],
          },
          {
            displayName: "Chunking Model Name or ID",
            name: "chunkModel",
            type: "options",
            typeOptions: { loadOptionsMethod: "getChatModels" },
            default: "mistral-small",
            description:
              'Chat model used to split the text along the base\'s intent (metered on your key), when chunking is AI. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
          },
          {
            displayName: "External ID",
            name: "externalId",
            type: "string",
            default: "",
            description: "Your own identifier. If it already exists, the document is replaced (upsert).",
          },
          {
            displayName: "Facet Overrides (JSON)",
            name: "facetOverrides",
            type: "string",
            default: "",
            description:
              'Optional JSON object of facet values to force on every chunk (e.g. {"categorie":"compte-rendu"}). In AI chunking mode, the model only fills in the remaining facets; in simple mode these values are applied as-is. Always takes priority over AI-extracted values.',
          },
          {
            displayName: "Skip Compliance (PII)",
            name: "bypassConformite",
            type: "boolean",
            default: false,
            description:
              "Whether to ingest verbatim, without PII masking. Only if compliance is active on the account.",
          },
          {
            displayName: "Source URL",
            name: "sourceUrl",
            type: "string",
            default: "",
            description:
              "Link to the original resource. Informational; returned in search results and RAG sources.",
          },
          {
            displayName: "Title",
            name: "title",
            type: "string",
            default: "",
            description: "Title / filename of the document",
          },
        ],
      },
      // Document update
      {
        displayName: "Update Fields",
        name: "updateFields",
        type: "collection",
        placeholder: "Add Field",
        default: {},
        displayOptions: { show: { resource: ["document"], operation: ["update"] } },
        options: [
          {
            displayName: "New Business Date",
            name: "date",
            type: "dateTime",
            default: "",
            description: "New date of the content",
          },
          {
            displayName: "New External ID",
            name: "externalId",
            type: "string",
            default: "",
            description: "New external identifier",
          },
          {
            displayName: "New Source URL",
            name: "sourceUrl",
            type: "string",
            default: "",
            description: "Link to the original resource. Leave empty to clear it.",
          },
          {
            displayName: "New Title",
            name: "filename",
            type: "string",
            default: "",
            description: "New title / filename",
          },
        ],
      },

      // ===================== Chunk =====================
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        displayOptions: { show: { resource: ["chunk"] } },
        options: [
          {
            name: "Add",
            value: "add",
            description: "Add a chunk to a document by hand",
            action: "Add a chunk",
          },
          {
            name: "Delete",
            value: "delete",
            description: "Delete a chunk",
            action: "Delete a chunk",
          },
          {
            name: "List",
            value: "list",
            description: "List a document's chunks (decrypted)",
            action: "List chunks",
          },
          {
            name: "Update",
            value: "update",
            description: "Update a chunk",
            action: "Update a chunk",
          },
        ],
        default: "list",
      },
      {
        displayName: "Knowledge Base Name or ID",
        name: "slug",
        type: "options",
        typeOptions: { loadOptionsMethod: "getKnowledgeBases" },
        default: "",
        required: true,
        description: 'The base the chunk lives in. Choose from the list, or specify a slug using an <a href="https://docs.n8n.io/code/expressions/">expression</a>. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
        displayOptions: { show: { resource: ["chunk"] } },
      },
      {
        displayName: "Document (UUID or External ID)",
        name: "documentId",
        type: "string",
        default: "",
        required: true,
        description: "The document's UUID returned by the API, or your own external ID",
        displayOptions: { show: { resource: ["chunk"] } },
      },
      {
        displayName: "Chunk ID",
        name: "chunkId",
        type: "string",
        default: "",
        required: true,
        description: "The chunk's UUID",
        displayOptions: { show: { resource: ["chunk"], operation: ["update", "delete"] } },
      },
      // Chunk add
      {
        displayName: "Content",
        name: "content",
        type: "string",
        typeOptions: { rows: 3 },
        default: "",
        required: true,
        description: "The chunk's text (embedded and encrypted server-side)",
        displayOptions: { show: { resource: ["chunk"], operation: ["add"] } },
      },
      {
        displayName: "Additional Fields",
        name: "additionalFields",
        type: "collection",
        placeholder: "Add Field",
        default: {},
        displayOptions: { show: { resource: ["chunk"], operation: ["add"] } },
        options: [
          {
            displayName: "Facets (JSON)",
            name: "facets",
            type: "string",
            default: "",
            description: 'Optional JSON object of metadata, e.g. {"theme":"billing"}',
          },
          {
            displayName: "Business Date",
            name: "date",
            type: "dateTime",
            default: "",
            description: "Defaults to the document's date",
          },
          {
            displayName: "Skip Compliance (PII)",
            name: "bypassConformite",
            type: "boolean",
            default: false,
            description: "Whether to ingest verbatim, without PII masking",
          },
        ],
      },
      // Chunk update
      {
        displayName: "Update Fields",
        name: "updateFields",
        type: "collection",
        placeholder: "Add Field",
        default: {},
        displayOptions: { show: { resource: ["chunk"], operation: ["update"] } },
        options: [
          {
            displayName: "New Content",
            name: "content",
            type: "string",
            typeOptions: { rows: 3 },
            default: "",
            description: "Editing the content re-embeds the chunk (billed)",
          },
          {
            displayName: "New Facets (JSON)",
            name: "facets",
            type: "string",
            default: "",
            description: 'Optional JSON object of metadata, e.g. {"theme":"billing"}',
          },
          {
            displayName: "New Business Date",
            name: "date",
            type: "dateTime",
            default: "",
            description: "New date of the content",
          },
        ],
      },

      // ===================== Common =====================
      {
        displayName: "Simplify Output",
        name: "simplify",
        type: "boolean",
        default: true,
        description:
          "Whether to return only the useful fields instead of the full API response",
        displayOptions: { show: { resource: ["model"] } },
      },
    ],
  };

  methods = {
    loadOptions: {
      async getChatModels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        return loadModels(this, "chat");
      },
      async getEmbeddingModels(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        return loadModels(this, "embedding");
      },
      async getKnowledgeBases(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        return loadKnowledgeBases(this);
      },
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    const credentials = await this.getCredentials("astrolabeApi");
    const baseUrl = (credentials.baseUrl as string).replace(/\/+$/, "");
    const enc = encodeURIComponent;

    for (let i = 0; i < items.length; i++) {
      try {
        const resource = this.getNodeParameter("resource", i, "model") as string;
        const operation = this.getNodeParameter("operation", i) as string;

        let method: IHttpRequestMethods = "POST";
        let url: string;
        let body: IDataObject | undefined;
        // List/search operations return an array under `data`; we fan them out
        // to one n8n item each. `listField` names that array, undefined = single.
        let listField: string | undefined;
        // Shapes the single-item output of `model` operations when simplify is on.
        let simplifyKind: "chat" | "embedding" | undefined;
        // KB search returns a single structured item (analytic metadata preserved).
        let kbSearch = false;

        if (resource === "model") {
          if (operation === "chat") {
            const model = this.getNodeParameter("model", i) as string;
            const messagesUi = this.getNodeParameter("messages.message", i, []) as Array<{
              role: string;
              content: string;
            }>;
            const knowledgeBases = this.getNodeParameter("knowledgeBases", i, []) as string[];
            const options = this.getNodeParameter("options", i, {}) as IDataObject;

            if (messagesUi.length === 0) {
              throw new NodeOperationError(this.getNode(), "At least one message is required.", {
                itemIndex: i,
              });
            }

            url = `${baseUrl}/chat/completions`;
            const reqBody: IDataObject = {
              model,
              messages: messagesUi.map((m) => ({ role: m.role, content: m.content })),
            };
            if (options.maxTokens) reqBody.max_tokens = options.maxTokens;
            if (options.temperature !== undefined) reqBody.temperature = options.temperature;
            if (options.responseFormat && options.responseFormat !== "text") {
              reqBody.response_format = { type: options.responseFormat };
            }
            // RAG: pass the knowledge base params; the gateway does the retrieval
            // and returns the extracts used in `astrolabe_sources`.
            if (knowledgeBases.length > 0) {
              reqBody.knowledge_base = knowledgeBases;
              if (options.knowledgeBaseMode) {
                reqBody.knowledge_base_mode = options.knowledgeBaseMode;
              }
              if (options.knowledgeBaseMaxSteps !== undefined) {
                reqBody.knowledge_base_max_steps = options.knowledgeBaseMaxSteps;
              }
              if (options.knowledgeBaseRequest) {
                reqBody.knowledge_base_request = options.knowledgeBaseRequest;
              }
              const facets = jsonMaybe(options.knowledgeBaseFacets);
              if (facets !== undefined) reqBody.knowledge_base_facets = facets;
              if (options.knowledgeBaseTopK !== undefined) {
                reqBody.knowledge_base_top_k = options.knowledgeBaseTopK;
              }
              if (options.knowledgeBaseCiteSources) {
                reqBody.knowledge_base_cite_sources = true;
              }
              if (options.knowledgeBaseHistory !== undefined) {
                reqBody.knowledge_base_history = options.knowledgeBaseHistory;
              }
              const dateRange = nested({
                from: options.kbDateFrom,
                to: options.kbDateTo,
              });
              if (dateRange) reqBody.knowledge_base_date_range = dateRange;
              const expand = jsonMaybe(options.knowledgeBaseExpand);
              if (expand !== undefined) reqBody.knowledge_base_expand = expand;
            }
            body = reqBody;
            simplifyKind = "chat";
          } else {
            const model = this.getNodeParameter("embeddingModel", i) as string;
            const input = this.getNodeParameter("input", i) as string;
            url = `${baseUrl}/embeddings`;
            body = { model, input };
            simplifyKind = "embedding";
          }
        } else if (resource === "knowledgeBase") {
          if (operation === "list") {
            method = "GET";
            url = `${baseUrl}/kb`;
            listField = "data";
          } else if (operation === "create") {
            const name = this.getNodeParameter("name", i) as string;
            const fields = this.getNodeParameter("additionalFields", i, {}) as IDataObject;
            url = `${baseUrl}/kb`;
            body = compact({
              name,
              intent: fields.intent,
              role: fields.role,
              facet_schema: jsonMaybe(fields.facetSchema),
            });
          } else if (operation === "update") {
            const slug = this.getNodeParameter("slug", i) as string;
            const fields = this.getNodeParameter("updateFields", i, {}) as IDataObject;
            method = "PATCH";
            url = `${baseUrl}/kb/${enc(slug)}`;
            body = compact({
              name: fields.name,
              intent: fields.intent,
              role: fields.role,
              slug: fields.newSlug,
            });
          } else if (operation === "delete") {
            const slug = this.getNodeParameter("slug", i) as string;
            method = "DELETE";
            url = `${baseUrl}/kb/${enc(slug)}`;
          } else {
            // search — semantic (with query) and/or analytic (filters, sort,
            // group_by, aggregate). Returns a single structured item so the
            // analytic metadata (total, truncated, aggregates…) is preserved.
            const slug = this.getNodeParameter("slug", i) as string;
            const query = this.getNodeParameter("query", i, "") as string;
            const opts = this.getNodeParameter("searchOptions", i, {}) as IDataObject;
            url = `${baseUrl}/kb/${enc(slug)}/search`;
            body = compact({
              query,
              group_by: opts.groupBy,
              top_k: opts.topK,
              offset: opts.offset,
              sort: nested({ by: opts.sortBy, dir: opts.sortDir }),
              facets: jsonMaybe(opts.facets),
              filters: jsonMaybe(opts.filters),
              date_range: nested({ from: opts.dateFrom, to: opts.dateTo }),
              expand: jsonMaybe(opts.expand),
              aggregate: jsonMaybe(opts.aggregate),
            });
            kbSearch = true;
          }
        } else if (resource === "document") {
          const slug = this.getNodeParameter("slug", i) as string;
          if (operation === "list") {
            method = "GET";
            url = `${baseUrl}/kb/${enc(slug)}/documents`;
            listField = "data";
          } else if (operation === "add") {
            const text = this.getNodeParameter("text", i) as string;
            const fields = this.getNodeParameter("additionalFields", i, {}) as IDataObject;
            url = `${baseUrl}/kb/${enc(slug)}/documents`;
            body = compact({
              text,
              title: fields.title,
              date: fields.date,
              external_id: fields.externalId,
              source_url: fields.sourceUrl,
              bypass_conformite: fields.bypassConformite || undefined,
              chunking: fields.chunking,
              chunk_model: fields.chunking === "ai" ? fields.chunkModel : undefined,
              facet_overrides: jsonMaybe(fields.facetOverrides),
            });
          } else if (operation === "get") {
            const documentId = this.getNodeParameter("documentId", i) as string;
            method = "GET";
            url = `${baseUrl}/kb/${enc(slug)}/documents/${enc(documentId)}`;
          } else if (operation === "update") {
            const documentId = this.getNodeParameter("documentId", i) as string;
            const fields = this.getNodeParameter("updateFields", i, {}) as IDataObject;
            method = "PATCH";
            url = `${baseUrl}/kb/${enc(slug)}/documents/${enc(documentId)}`;
            body = compact({
              filename: fields.filename,
              date: fields.date,
              external_id: fields.externalId,
              source_url: fields.sourceUrl,
            });
          } else {
            // delete
            const documentId = this.getNodeParameter("documentId", i) as string;
            method = "DELETE";
            url = `${baseUrl}/kb/${enc(slug)}/documents/${enc(documentId)}`;
          }
        } else {
          // resource === "chunk"
          const slug = this.getNodeParameter("slug", i) as string;
          const documentId = this.getNodeParameter("documentId", i) as string;
          const docBase = `${baseUrl}/kb/${enc(slug)}/documents/${enc(documentId)}/chunks`;
          if (operation === "list") {
            method = "GET";
            url = docBase;
            listField = "data";
          } else if (operation === "add") {
            const content = this.getNodeParameter("content", i) as string;
            const fields = this.getNodeParameter("additionalFields", i, {}) as IDataObject;
            url = docBase;
            body = compact({
              content,
              facets: jsonMaybe(fields.facets),
              date: fields.date,
              bypass_conformite: fields.bypassConformite || undefined,
            });
          } else if (operation === "update") {
            const chunkId = this.getNodeParameter("chunkId", i) as string;
            const fields = this.getNodeParameter("updateFields", i, {}) as IDataObject;
            method = "PATCH";
            url = `${docBase}/${enc(chunkId)}`;
            body = compact({
              content: fields.content,
              facets: jsonMaybe(fields.facets),
              date: fields.date,
            });
          } else {
            // delete
            const chunkId = this.getNodeParameter("chunkId", i) as string;
            method = "DELETE";
            url = `${docBase}/${enc(chunkId)}`;
          }
        }

        const response = (await this.helpers.httpRequestWithAuthentication.call(
          this,
          "astrolabeApi",
          {
            method,
            url,
            body,
            json: true,
          },
        )) as IDataObject;

        // KB search: one structured item mirroring the Make/Zapier output, so the
        // analytic fields (total, truncated, distinct_documents, aggregates) are
        // not lost when the array would otherwise be fanned out.
        if (kbSearch) {
          returnData.push({
            json: {
              group_by: response.group_by ?? null,
              total: response.total ?? null,
              truncated: response.truncated ?? null,
              distinct_documents: response.distinct_documents ?? null,
              aggregates: response.aggregates ?? null,
              results: response.data ?? [],
            },
            pairedItem: { item: i },
          });
          continue;
        }

        // List: fan the array out to one item each.
        if (listField) {
          const rows = (response[listField] as IDataObject[]) ?? [];
          for (const row of rows) {
            returnData.push({ json: row, pairedItem: { item: i } });
          }
          continue;
        }

        let output: IDataObject = response;
        if (simplifyKind) {
          const simplify = this.getNodeParameter("simplify", i, true) as boolean;
          if (simplify && simplifyKind === "chat") {
            const choice = ((response.choices as IDataObject[]) ?? [])[0] ?? {};
            const message = (choice.message as IDataObject) ?? {};
            output = {
              content: message.content ?? "",
              reasoning_content: message.reasoning_content ?? null,
              finish_reason: choice.finish_reason ?? null,
              astrolabe_sources: response.astrolabe_sources ?? null,
              astrolabe_steps: response.astrolabe_steps ?? null,
              usage: response.usage ?? null,
            };
          } else if (simplify && simplifyKind === "embedding") {
            const data = ((response.data as IDataObject[]) ?? [])[0] ?? {};
            output = {
              embedding: data.embedding ?? [],
              usage: response.usage ?? null,
            };
          }
        }

        returnData.push({ json: output, pairedItem: { item: i } });
      } catch (error) {
        if (this.continueOnFail()) {
          returnData.push({
            json: { error: (error as Error).message },
            pairedItem: { item: i },
          });
          continue;
        }
        // Already-typed node errors pass through; wrap raw HTTP errors so n8n
        // can surface the status code and response body in the error panel.
        if (error instanceof NodeApiError || error instanceof NodeOperationError) {
          throw error;
        }
        throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
      }
    }

    return [returnData];
  }
}
