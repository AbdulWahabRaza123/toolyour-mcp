/**
 * Lightweight JSON Schema required-field validation for invoke_tool.
 * Does not attempt full draft-07 compliance — rejects obvious missing/invalid inputs early.
 */

export interface SchemaValidationIssue {
  path: string;
  message: string;
}

export interface SchemaValidationResult {
  ok: boolean;
  missing: string[];
  issues: SchemaValidationIssue[];
}

function isObjectSchema(schema: unknown): schema is Record<string, unknown> {
  return !!schema && typeof schema === "object" && !Array.isArray(schema);
}

function resolveRootSchema(schema: unknown): Record<string, unknown> | null {
  if (!isObjectSchema(schema)) return null;
  // OpenAPI / MCP registry wrappers
  if (schema.properties || schema.required || Array.isArray(schema.oneOf)) {
    return schema;
  }
  if (isObjectSchema(schema.request)) return resolveRootSchema(schema.request);
  if (isObjectSchema(schema.body)) return resolveRootSchema(schema.body);
  if (isObjectSchema(schema.requestBody)) return resolveRootSchema(schema.requestBody);
  if (isObjectSchema(schema.input)) return resolveRootSchema(schema.input);
  if (isObjectSchema(schema.schema)) return resolveRootSchema(schema.schema);
  return schema;
}

function validateObjectBranch(
  branch: Record<string, unknown>,
  input: Record<string, unknown>
): SchemaValidationResult {
  const required = Array.isArray(branch.required)
    ? branch.required.map(String)
    : [];
  const properties = isObjectSchema(branch.properties)
    ? (branch.properties as Record<string, unknown>)
    : {};

  const missing: string[] = [];
  const issues: SchemaValidationIssue[] = [];

  for (const key of required) {
    const value = input[key];
    if (value === undefined || value === null || value === "") {
      missing.push(key);
      issues.push({ path: key, message: `Missing required field: ${key}` });
      continue;
    }
    const prop = properties[key];
    if (isObjectSchema(prop) && typeof prop.type === "string") {
      const okType = checkType(prop.type, value);
      if (!okType) {
        issues.push({
          path: key,
          message: `Expected type ${prop.type} for ${key}`,
        });
      }
    }
  }

  // Nested inputs wrapper: { inputs: { url } }
  if (
    missing.includes("inputs") === false &&
    input.inputs &&
    typeof input.inputs === "object" &&
    !Array.isArray(input.inputs) &&
    isObjectSchema(properties.inputs)
  ) {
    const nested = properties.inputs as Record<string, unknown>;
    if (Array.isArray(nested.required) || nested.properties) {
      const nestedResult = validateObjectBranch(
        nested,
        input.inputs as Record<string, unknown>
      );
      if (!nestedResult.ok) {
        return {
          ok: false,
          missing: nestedResult.missing.map((m) => `inputs.${m}`),
          issues: nestedResult.issues.map((i) => ({
            ...i,
            path: `inputs.${i.path}`,
          })),
        };
      }
    }
  }

  return {
    ok: missing.length === 0 && issues.length === 0,
    missing,
    issues,
  };
}

export function validateInputAgainstSchema(
  schema: unknown,
  input: Record<string, unknown>
): SchemaValidationResult {
  const root = resolveRootSchema(schema);
  if (!root) {
    return { ok: true, missing: [], issues: [] };
  }

  // oneOf: accept if any branch validates (flat fields OR { inputs: {...} })
  if (Array.isArray(root.oneOf) && root.oneOf.length > 0) {
    const results: SchemaValidationResult[] = [];
    for (const branch of root.oneOf) {
      if (!isObjectSchema(branch)) continue;
      const result = validateObjectBranch(branch, input);
      if (result.ok) return result;
      results.push(result);
    }
    // Prefer reporting the flat-branch miss (usually first)
    return (
      results[0] || {
        ok: false,
        missing: ["(oneOf)"],
        issues: [{ path: "", message: "Input matched no schema oneOf branch" }],
      }
    );
  }

  return validateObjectBranch(root, input);
}

function checkType(expected: string, value: unknown): boolean {
  switch (expected) {
    case "string":
      return typeof value === "string";
    case "number":
    case "integer":
      return typeof value === "number" && !Number.isNaN(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      if (Array.isArray(value)) return true;
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed.startsWith("[")) return false;
        try {
          return Array.isArray(JSON.parse(trimmed));
        } catch {
          return false;
        }
      }
      return false;
    case "object":
      return !!value && typeof value === "object" && !Array.isArray(value);
    default:
      return true;
  }
}
