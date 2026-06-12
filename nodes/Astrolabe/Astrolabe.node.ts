import type {
  IExecuteFunctions,
  IDataObject,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  IHttpRequestMethods,
} from "n8n-workflow";
import { NodeOperationError } from "n8n-workflow";

export class Astrolabe implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Astrolabe",
    name: "astrolabe",
    icon: "file:astrolabe.svg",
    group: ["transform"],
    version: 1,
    subtitle: '={{ $parameter["operation"] }}',
    description: "Sovereign EU AI for the social economy — chat and embeddings (OpenAI-compatible API)",
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
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        options: [
          {
            name: "Message a Model",
            value: "chat",
            description: "Send messages and get a chat completion",
            action: "Message a model",
          },
          {
            name: "Create an Embedding",
            value: "embedding",
            description: "Turn text into a vector for semantic search or RAG",
            action: "Create an embedding",
          },
        ],
        default: "chat",
      },

      // ----- Chat -----
      {
        displayName: "Model",
        name: "model",
        type: "string",
        default: "astrolabe-base",
        required: true,
        description: "Public model name. In Phase 1, only astrolabe-base is available.",
        displayOptions: { show: { operation: ["chat"] } },
      },
      {
        displayName: "Messages",
        name: "messages",
        type: "fixedCollection",
        typeOptions: { multipleValues: true, sortable: true },
        placeholder: "Add Message",
        default: { message: [{ role: "user", content: "" }] },
        displayOptions: { show: { operation: ["chat"] } },
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
        displayName: "Options",
        name: "options",
        type: "collection",
        placeholder: "Add Option",
        default: {},
        displayOptions: { show: { operation: ["chat"] } },
        options: [
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
            displayName: "Stop Sequences",
            name: "stop",
            type: "string",
            default: "",
            description: "Sequences that stop generation, comma-separated",
          },
          {
            displayName: "Temperature",
            name: "temperature",
            type: "number",
            typeOptions: { minValue: 0, maxValue: 2, numberPrecision: 2 },
            default: 0.7,
            description: "0 = deterministic (extraction), 0.7 = creative (writing)",
          },
          {
            displayName: "Top P",
            name: "topP",
            type: "number",
            typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 2 },
            default: 1,
          },
        ],
      },

      // ----- Embedding -----
      {
        displayName: "Model",
        name: "embeddingModel",
        type: "string",
        default: "astrolabe-embed",
        required: true,
        displayOptions: { show: { operation: ["embedding"] } },
      },
      {
        displayName: "Text",
        name: "input",
        type: "string",
        typeOptions: { rows: 3 },
        default: "",
        required: true,
        description: "Text to embed",
        displayOptions: { show: { operation: ["embedding"] } },
      },

      // ----- Common -----
      {
        displayName: "Simplify Output",
        name: "simplify",
        type: "boolean",
        default: true,
        description:
          "Whether to return only the useful fields (content, reasoning_content, usage) instead of the full API response",
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    const credentials = await this.getCredentials("astrolabeApi");
    const baseUrl = (credentials.baseUrl as string).replace(/\/+$/, "");

    for (let i = 0; i < items.length; i++) {
      try {
        const operation = this.getNodeParameter("operation", i) as string;
        const simplify = this.getNodeParameter("simplify", i, true) as boolean;

        let url: string;
        const body: IDataObject = {};

        if (operation === "chat") {
          const model = this.getNodeParameter("model", i) as string;
          const messagesUi = this.getNodeParameter("messages.message", i, []) as Array<{
            role: string;
            content: string;
          }>;
          const options = this.getNodeParameter("options", i, {}) as IDataObject;

          if (messagesUi.length === 0) {
            throw new NodeOperationError(this.getNode(), "At least one message is required.", {
              itemIndex: i,
            });
          }

          url = `${baseUrl}/chat/completions`;
          body.model = model;
          body.messages = messagesUi.map((m) => ({ role: m.role, content: m.content }));
          if (options.maxTokens) body.max_tokens = options.maxTokens;
          if (options.temperature !== undefined) body.temperature = options.temperature;
          if (options.topP !== undefined) body.top_p = options.topP;
          if (options.responseFormat && options.responseFormat !== "text") {
            body.response_format = { type: options.responseFormat };
          }
          if (options.stop) {
            body.stop = (options.stop as string)
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
          }
        } else {
          const model = this.getNodeParameter("embeddingModel", i) as string;
          const input = this.getNodeParameter("input", i) as string;
          url = `${baseUrl}/embeddings`;
          body.model = model;
          body.input = input;
        }

        const response = (await this.helpers.httpRequestWithAuthentication.call(
          this,
          "astrolabeApi",
          {
            method: "POST" as IHttpRequestMethods,
            url,
            body,
            json: true,
          },
        )) as IDataObject;

        let output: IDataObject = response;
        if (simplify) {
          if (operation === "chat") {
            const choice = ((response.choices as IDataObject[]) ?? [])[0] ?? {};
            const message = (choice.message as IDataObject) ?? {};
            output = {
              content: message.content ?? "",
              reasoning_content: message.reasoning_content ?? null,
              finish_reason: choice.finish_reason ?? null,
              usage: response.usage ?? null,
            };
          } else {
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
        throw error;
      }
    }

    return [returnData];
  }
}
