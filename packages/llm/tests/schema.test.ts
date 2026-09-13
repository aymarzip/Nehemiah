import { describe, expect, it } from "vitest";

import type { LlmError } from "../src/errors.js";
import { FakeProvider, fakeJsonResponse } from "../src/fake-provider.js";
import { pruneJsonSchema, validateJsonSchema, validateJsonSchemaSupport } from "../src/schema.js";
import { message } from "../src/types.js";

describe("local JSON Schema dialect", () => {
  it("prunes redundant metadata while preserving structural validation", () => {
    const rawSchema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "https://example.com/schema.json",
      $comment: "Internal developer comment",
      title: "MySchema",
      description: "",
      type: "object",
      properties: {
        id: {
          type: "string",
          $comment: "id field",
          title: "ID",
          description: "Unique ID",
        },
        items: {
          type: "array",
          items: {
            $comment: "item subschema",
            type: "number",
          },
        },
      },
      required: ["id"],
    } as const;

    const pruned = pruneJsonSchema(rawSchema);
    expect(pruned).toEqual({
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Unique ID",
        },
        items: {
          type: "array",
          items: {
            type: "number",
          },
        },
      },
      required: ["id"],
    });
  });
  it("allows common non-validating annotation keywords at every schema level", () => {
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "Annotated response",
      description: "Annotations do not alter validation.",
      type: "object",
      properties: {
        status: {
          type: "string",
          description: "Current state",
          default: "ready",
          examples: ["ready"],
          readOnly: true,
        },
      },
      required: ["status"],
      additionalProperties: false,
    } as const;

    expect(validateJsonSchemaSupport(schema)).toEqual({ valid: true, issues: [] });
    expect(validateJsonSchema({ status: "ready" }, schema)).toEqual({ valid: true, issues: [] });
  });

  it.each(["not", "$ref", "uniqueItems", "exclusiveMinimum", "format"])(
    "fails closed on unsupported validation keyword %s",
    (keyword) => {
      const schema = { type: "string", [keyword]: keyword === "$ref" ? "#/$defs/value" : true };

      expect(validateJsonSchema("unsafe", schema)).toMatchObject({
        valid: false,
        issues: [
          {
            message: `unsupported JSON Schema validation keyword "${keyword}"`,
          },
        ],
      });
    },
  );

  it("finds unsupported assertions inside property and item schemas", () => {
    const validation = validateJsonSchema(
      { contacts: ["not-an-email"] },
      {
        type: "object",
        properties: {
          contacts: { type: "array", items: { type: "string", format: "email" } },
        },
      },
    );

    expect(validation).toMatchObject({
      valid: false,
      issues: [
        {
          path: "$.properties.contacts.items.format",
          message: 'unsupported JSON Schema validation keyword "format"',
        },
      ],
    });
  });

  it("rejects an unsupported schema before invoking a provider", async () => {
    const provider = new FakeProvider({
      scenarios: [{ response: fakeJsonResponse({ status: "unsafe" }) }],
    });

    await expect(
      provider.generateStructured({
        messages: [message("user", "status")],
        schema: {
          type: "object",
          properties: { status: { type: "string" } },
          not: { required: ["secret"] },
        },
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<LlmError>>({
        code: "unsupported_capability",
        provider: "fake",
      }),
    );
    expect(provider.invocations).toHaveLength(0);
  });
});
