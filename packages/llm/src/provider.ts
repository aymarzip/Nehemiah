import { LlmError } from "./errors.js";
import {
  parseJson,
  pruneJsonSchema,
  validateJsonSchema,
  validateJsonSchemaSupport,
} from "./schema.js";
import {
  responseText,
  type GenerateRequest,
  type JsonValue,
  type LlmCallOptions,
  type LlmResponse,
  type LlmStreamEvent,
  type ModelCapabilities,
  type StructuredGenerateRequest,
  type StructuredLlmResponse,
} from "./types.js";

export interface LlmProvider {
  readonly id: string;
  readonly kind: string;
  capabilities(model?: string): ModelCapabilities;
  generate(request: GenerateRequest, options?: LlmCallOptions): Promise<LlmResponse>;
  generateStructured<T = JsonValue>(
    request: StructuredGenerateRequest,
    options?: LlmCallOptions,
  ): Promise<StructuredLlmResponse<T>>;
  stream(request: GenerateRequest, options?: LlmCallOptions): AsyncIterable<LlmStreamEvent>;
}

export abstract class BaseLlmProvider implements LlmProvider {
  abstract readonly id: string;
  abstract readonly kind: string;
  abstract capabilities(model?: string): ModelCapabilities;
  abstract generate(request: GenerateRequest, options?: LlmCallOptions): Promise<LlmResponse>;
  abstract stream(
    request: GenerateRequest,
    options?: LlmCallOptions,
  ): AsyncIterable<LlmStreamEvent>;

  async generateStructured<T = JsonValue>(
    request: StructuredGenerateRequest,
    options?: LlmCallOptions,
  ): Promise<StructuredLlmResponse<T>> {
    const { schema, schemaName, schemaDescription, strict, ...generateRequest } = request;
    const support = this.capabilities(request.model).structuredOutput;
    if (support === "none") {
      throw new LlmError({
        code: "unsupported_capability",
        message: `${this.id} does not support structured output for the selected model`,
        provider: this.id,
        ...(request.model === undefined ? {} : { model: request.model }),
      });
    }
    const localSchemaSupport = validateJsonSchemaSupport(schema);
    if (!localSchemaSupport.valid) {
      throw new LlmError({
        code: "unsupported_capability",
        message: `${this.id} cannot locally validate the requested JSON Schema: ${localSchemaSupport.issues
          .map((issue) => `${issue.path} ${issue.message}`)
          .join("; ")}`,
        provider: this.id,
        ...(request.model === undefined ? {} : { model: request.model }),
      });
    }
    const response = await this.generate(
      {
        ...generateRequest,
        ...(generateRequest.tools === undefined
          ? {}
          : {
              tools: generateRequest.tools.map((tool) => ({
                ...tool,
                inputSchema: pruneJsonSchema(tool.inputSchema),
              })),
            }),
        responseFormat:
          support === "json_object"
            ? { type: "json_object" }
            : {
                type: "json_schema",
                name: schemaName ?? "response",
                schema: pruneJsonSchema(schema),
                ...(schemaDescription === undefined ? {} : { description: schemaDescription }),
                ...(strict === undefined ? {} : { strict }),
              },
      },
      options,
    );
    const output = responseText(response);
    let value: JsonValue;
    try {
      value = parseJson(output);
    } catch (cause) {
      throw new LlmError({
        code: "invalid_response",
        message: `${this.id} returned invalid JSON for a structured request`,
        provider: this.id,
        model: response.model,
        partialOutput: output,
        cause,
      });
    }
    const validation = validateJsonSchema(value, schema);
    if (!validation.valid) {
      throw new LlmError({
        code: "invalid_response",
        message: `${this.id} returned JSON that does not match the requested schema: ${validation.issues
          .map((issue) => `${issue.path} ${issue.message}`)
          .join("; ")}`,
        provider: this.id,
        model: response.model,
        partialOutput: output,
      });
    }
    return { value: value as T, response };
  }
}

export const resolveModel = (
  requestedModel: string | undefined,
  defaultModel: string | undefined,
  provider: string,
): string => {
  const model = requestedModel ?? defaultModel;
  if (model === undefined || model.trim() === "") {
    throw new LlmError({
      code: "invalid_request",
      message: `No model was configured for provider ${provider}`,
      provider,
    });
  }
  return model;
};

export const assertRequestCapabilities = (
  request: GenerateRequest,
  capabilities: ModelCapabilities,
  provider: string,
): void => {
  const unsupported = (feature: string): never => {
    throw new LlmError({
      code: "unsupported_capability",
      message: `${provider} model ${capabilities.model} does not support ${feature}`,
      provider,
      model: capabilities.model,
    });
  };
  if ((request.tools?.length ?? 0) > 0 && !capabilities.toolCalling) unsupported("tool calling");
  if (
    request.toolChoice !== undefined &&
    request.toolChoice.type !== "none" &&
    (request.tools?.length ?? 0) === 0
  ) {
    throw new LlmError({
      code: "invalid_request",
      message: `${provider} received a tool choice without any tools`,
      provider,
      model: capabilities.model,
    });
  }
  if (request.reasoning?.enabled === true && !capabilities.reasoning) unsupported("reasoning");
  if (
    request.messages.some((entry) => entry.content.some((part) => part.type === "image")) &&
    !capabilities.vision
  ) {
    unsupported("image input");
  }
  if (
    request.responseFormat?.type === "json_schema" &&
    capabilities.structuredOutput !== "json_schema"
  ) {
    unsupported("JSON Schema structured output");
  }
  if (request.responseFormat?.type === "json_object" && capabilities.structuredOutput === "none") {
    unsupported("JSON structured output");
  }
};
