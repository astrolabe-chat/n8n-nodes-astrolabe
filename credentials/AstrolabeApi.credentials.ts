import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from "n8n-workflow";

export class AstrolabeApi implements ICredentialType {
  name = "astrolabeApi";

  displayName = "Astrolabe API";

  documentationUrl = "https://docs.astrolabe.chat/quickstart/";

  properties: INodeProperties[] = [
    {
      displayName: "API Key",
      name: "apiKey",
      type: "string",
      typeOptions: { password: true },
      required: true,
      default: "",
      placeholder: "sk-astrolabe-...",
      description: "Your Astrolabe API key, created from the developer portal.",
    },
    {
      displayName: "Base URL",
      name: "baseUrl",
      type: "string",
      default: "https://api.astrolabe.chat/v1",
      description:
        "OpenAI-compatible API base URL. Only change this for a self-hosted instance.",
    },
  ];

  // Injects the key as a Bearer token on every request the node makes.
  authenticate: IAuthenticateGeneric = {
    type: "generic",
    properties: {
      headers: {
        Authorization: "=Bearer {{$credentials.apiKey}}",
      },
    },
  };

  // Connection test: list models (GET /models — no credit cost).
  test: ICredentialTestRequest = {
    request: {
      baseURL: "={{$credentials.baseUrl}}",
      url: "/models",
    },
  };
}
