import type { JsonObject, JsonSchema, JsonValue } from "./types.js";

export interface SchemaValidationIssue {
  readonly path: string;
  readonly message: string;
}

export interface SchemaValidationResult {
  readonly valid: boolean;
  readonly issues: readonly SchemaValidationIssue[];
}

const isObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isJsonArray = (value: JsonValue | undefined): value is readonly JsonValue[] =>
  Array.isArray(value);

const asObject = (value: JsonValue | undefined): JsonObject | undefined =>
  value !== undefined && isObject(value) ? value : undefined;

const jsonType = (value: JsonValue): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
};

const matchesType = (value: JsonValue, expected: string): boolean =>
  expected === "integer"
    ? typeof value === "number" && Number.isInteger(value)
    : jsonType(value) === expected;

const deepEqual = (left: JsonValue, right: JsonValue): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const push = (issues: SchemaValidationIssue[], path: string, message: string): void => {
  issues.push({ path, message });
};

const annotationKeywords = new Set([
  "$comment",
  "$id",
  "$schema",
  "default",
  "deprecated",
  "description",
  "example",
  "examples",
  "readOnly",
  "title",
  "writeOnly",
]);

const validationKeywords = new Set([
  "additionalProperties",
  "allOf",
  "anyOf",
  "const",
  "enum",
  "items",
  "maximum",
  "maxItems",
  "maxLength",
  "maxProperties",
  "minimum",
  "minItems",
  "minLength",
  "minProperties",
  "oneOf",
  "pattern",
  "properties",
  "required",
  "type",
]);

const jsonTypes = new Set(["array", "boolean", "integer", "null", "number", "object", "string"]);

const schemaPath = (path: string, key: string): string =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;

const isSchema = (value: JsonValue | undefined): value is JsonSchema =>
  typeof value === "boolean" || isObject(value);

const inspectSubschema = (
  value: JsonValue,
  path: string,
  issues: SchemaValidationIssue[],
): void => {
  if (!isSchema(value)) {
    push(issues, path, "must contain a JSON Schema object or boolean schema");
    return;
  }
  inspectSchemaNode(value, path, issues);
};

const inspectSchemaArray = (
  value: JsonValue,
  path: string,
  issues: SchemaValidationIssue[],
): void => {
  if (!isJsonArray(value) || value.length === 0) {
    push(issues, path, "must contain a non-empty array of JSON Schemas");
    return;
  }
  value.forEach((entry, index) => inspectSubschema(entry, `${path}[${index}]`, issues));
};

const inspectNonNegativeInteger = (
  value: JsonValue,
  path: string,
  issues: SchemaValidationIssue[],
): void => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    push(issues, path, "must be a non-negative integer");
  }
};

function inspectSchemaNode(
  schema: JsonSchema,
  path: string,
  issues: SchemaValidationIssue[],
): void {
  if (typeof schema === "boolean") return;
  for (const [keyword, value] of Object.entries(schema)) {
    const keywordPath = schemaPath(path, keyword);
    if (annotationKeywords.has(keyword)) continue;
    if (!validationKeywords.has(keyword)) {
      push(issues, keywordPath, `unsupported JSON Schema validation keyword "${keyword}"`);
      continue;
    }
    switch (keyword) {
      case "type": {
        const types = typeof value === "string" ? [value] : isJsonArray(value) ? value : [];
        if (
          types.length === 0 ||
          types.some((entry) => typeof entry !== "string" || !jsonTypes.has(entry)) ||
          new Set(types).size !== types.length
        ) {
          push(issues, keywordPath, "must name one or more unique supported JSON types");
        }
        break;
      }
      case "enum":
        if (
          !isJsonArray(value) ||
          value.length === 0 ||
          value.some((entry, index) => value.slice(0, index).some((seen) => deepEqual(seen, entry)))
        ) {
          push(issues, keywordPath, "must contain one or more unique JSON values");
        }
        break;
      case "allOf":
      case "anyOf":
      case "oneOf":
        inspectSchemaArray(value, keywordPath, issues);
        break;
      case "properties":
        if (!isObject(value)) {
          push(issues, keywordPath, "must contain an object of property schemas");
        } else {
          Object.entries(value).forEach(([key, child]) =>
            inspectSubschema(child, schemaPath(keywordPath, key), issues),
          );
        }
        break;
      case "additionalProperties":
      case "items":
        inspectSubschema(value, keywordPath, issues);
        break;
      case "required":
        if (
          !isJsonArray(value) ||
          value.some((entry) => typeof entry !== "string") ||
          new Set(value).size !== value.length
        ) {
          push(issues, keywordPath, "must contain unique property names");
        }
        break;
      case "minProperties":
      case "maxProperties":
      case "minItems":
      case "maxItems":
      case "minLength":
      case "maxLength":
        inspectNonNegativeInteger(value, keywordPath, issues);
        break;
      case "pattern":
        if (typeof value !== "string") {
          push(issues, keywordPath, "must contain a regular expression string");
        } else {
          try {
            void new RegExp(value);
          } catch {
            push(issues, keywordPath, "must contain a valid regular expression");
          }
        }
        break;
      case "minimum":
      case "maximum":
        if (typeof value !== "number" || !Number.isFinite(value)) {
          push(issues, keywordPath, "must contain a finite number");
        }
        break;
      case "const":
        break;
    }
  }
}

/** Checks whether the local validator can enforce every assertion in a schema. */
export const validateJsonSchemaSupport = (schema: JsonSchema): SchemaValidationResult => {
  const issues: SchemaValidationIssue[] = [];
  inspectSchemaNode(schema, "$", issues);
  return { valid: issues.length === 0, issues };
};

const validateNode = (
  value: JsonValue,
  schema: JsonSchema,
  path: string,
  issues: SchemaValidationIssue[],
): void => {
  if (schema === true) return;
  if (schema === false) {
    push(issues, path, "value is disallowed by schema");
    return;
  }

  if ("const" in schema && !deepEqual(value, schema.const)) {
    push(issues, path, "value does not match const");
  }
  const enumValues = schema.enum;
  if (isJsonArray(enumValues) && !enumValues.some((candidate) => deepEqual(value, candidate))) {
    push(issues, path, "value is not in enum");
  }

  const expectedType = schema.type;
  if (typeof expectedType === "string" && !matchesType(value, expectedType)) {
    push(issues, path, `expected ${expectedType}, received ${jsonType(value)}`);
    return;
  }
  if (
    isJsonArray(expectedType) &&
    !expectedType.some(
      (candidate) => typeof candidate === "string" && matchesType(value, candidate),
    )
  ) {
    push(issues, path, `received unsupported type ${jsonType(value)}`);
    return;
  }

  if (isJsonArray(schema.allOf)) {
    schema.allOf.forEach((child) => {
      if (typeof child === "boolean" || isObject(child)) validateNode(value, child, path, issues);
    });
  }
  if (isJsonArray(schema.anyOf)) {
    const valid = schema.anyOf.some((child) => {
      if (typeof child !== "boolean" && !isObject(child)) return false;
      const childIssues: SchemaValidationIssue[] = [];
      validateNode(value, child, path, childIssues);
      return childIssues.length === 0;
    });
    if (!valid) push(issues, path, "value does not match anyOf");
  }
  if (isJsonArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((child) => {
      if (typeof child !== "boolean" && !isObject(child)) return false;
      const childIssues: SchemaValidationIssue[] = [];
      validateNode(value, child, path, childIssues);
      return childIssues.length === 0;
    }).length;
    if (matches !== 1) push(issues, path, "value must match exactly one oneOf schema");
  }

  if (isObject(value)) {
    const required = isJsonArray(schema.required)
      ? schema.required.filter((entry): entry is string => typeof entry === "string")
      : [];
    for (const key of required) {
      if (!(key in value)) push(issues, `${path}.${key}`, "required property is missing");
    }
    const properties = asObject(schema.properties) ?? {};
    for (const [key, propertyValue] of Object.entries(value)) {
      const propertySchema = properties[key];
      if (typeof propertySchema === "boolean" || isObject(propertySchema)) {
        validateNode(propertyValue, propertySchema, `${path}.${key}`, issues);
      } else if (schema.additionalProperties === false) {
        push(issues, `${path}.${key}`, "additional property is not allowed");
      } else if (
        typeof schema.additionalProperties === "boolean" ||
        isObject(schema.additionalProperties)
      ) {
        validateNode(propertyValue, schema.additionalProperties, `${path}.${key}`, issues);
      }
    }
    if (
      typeof schema.minProperties === "number" &&
      Object.keys(value).length < schema.minProperties
    ) {
      push(issues, path, `requires at least ${schema.minProperties} properties`);
    }
    if (
      typeof schema.maxProperties === "number" &&
      Object.keys(value).length > schema.maxProperties
    ) {
      push(issues, path, `allows at most ${schema.maxProperties} properties`);
    }
  }

  if (isJsonArray(value)) {
    const itemSchema = schema.items;
    if (typeof itemSchema === "boolean" || isObject(itemSchema)) {
      value.forEach((item, index) => validateNode(item, itemSchema, `${path}[${index}]`, issues));
    }
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      push(issues, path, `requires at least ${schema.minItems} items`);
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      push(issues, path, `allows at most ${schema.maxItems} items`);
    }
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      push(issues, path, `requires at least ${schema.minLength} characters`);
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      push(issues, path, `allows at most ${schema.maxLength} characters`);
    }
    if (typeof schema.pattern === "string") {
      try {
        if (!new RegExp(schema.pattern).test(value)) push(issues, path, "does not match pattern");
      } catch {
        push(issues, path, "schema contains an invalid pattern");
      }
    }
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      push(issues, path, `must be >= ${schema.minimum}`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      push(issues, path, `must be <= ${schema.maximum}`);
    }
  }
};

export const validateJsonSchema = (
  value: JsonValue,
  schema: JsonSchema,
): SchemaValidationResult => {
  const support = validateJsonSchemaSupport(schema);
  if (!support.valid) return support;
  const issues: SchemaValidationIssue[] = [];
  validateNode(value, schema, "$", issues);
  return { valid: issues.length === 0, issues };
};

export const parseJson = (text: string): JsonValue => JSON.parse(text) as JsonValue;

const strippedMetaKeys = new Set(["$schema", "$comment", "$id", "title"]);

export function pruneJsonSchema(schema: JsonSchema): JsonSchema {
  if (typeof schema === "boolean") return schema;
  if (!isObject(schema)) return schema;

  const result: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (strippedMetaKeys.has(key)) continue;
    if (key === "description" && typeof value === "string" && value.trim() === "") continue;

    if (key === "properties" && isObject(value)) {
      const prunedProps: Record<string, JsonValue> = {};
      for (const [propKey, propVal] of Object.entries(value)) {
        if (isSchema(propVal)) {
          prunedProps[propKey] = pruneJsonSchema(propVal);
        } else if (propVal !== undefined) {
          prunedProps[propKey] = propVal;
        }
      }
      result["properties"] = prunedProps;
    } else if (key === "items") {
      if (isSchema(value)) {
        result["items"] = pruneJsonSchema(value);
      } else if (isJsonArray(value)) {
        result["items"] = value.map(
          (item: JsonValue): JsonValue => (isSchema(item) ? pruneJsonSchema(item) : item),
        );
      } else if (value !== undefined) {
        result["items"] = value;
      }
    } else if ((key === "allOf" || key === "anyOf" || key === "oneOf") && isJsonArray(value)) {
      result[key] = value.map(
        (item: JsonValue): JsonValue => (isSchema(item) ? pruneJsonSchema(item) : item),
      );
    } else if (key === "additionalProperties" && isSchema(value)) {
      result["additionalProperties"] = pruneJsonSchema(value);
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}
