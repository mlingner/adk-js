/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Schema, Type} from '@google/genai';
import {z as z3} from 'zod/v3';
import {toJSONSchema as toJSONSchemaV4, z as z4} from 'zod/v4';

type ZodSchema<T = any> = z3.ZodType<T> | z4.ZodType<T>;

function isZodSchema(obj: unknown): obj is ZodSchema {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    'parse' in obj &&
    typeof (obj as {parse: unknown}).parse === 'function' &&
    'safeParse' in obj &&
    typeof (obj as {safeParse: unknown}).safeParse === 'function'
  );
}

function isZodV3Schema(obj: unknown): obj is z3.ZodTypeAny {
  return isZodSchema(obj) && !('_zod' in obj);
}

function isZodV4Schema(obj: unknown): obj is z4.ZodType {
  return isZodSchema(obj) && '_zod' in obj;
}

function getZodTypeName(
  schema: z3.ZodTypeAny | z4.ZodType,
): string | undefined {
  const schemaAny = schema as any;

  if (schemaAny._def?.typeName) {
    return schemaAny._def.typeName;
  }

  const zod4Type = schemaAny._def?.type;
  if (typeof zod4Type === 'string' && zod4Type) {
    return 'Zod' + zod4Type.charAt(0).toUpperCase() + zod4Type.slice(1);
  }

  return undefined;
}

/**
 * Returns true if the given object is a ZodObject (supports both Zod v3 and v4).
 */
export function isZodObject(
  obj: unknown,
): obj is z3.ZodObject<any> | z4.ZodObject<any> {
  return isZodSchema(obj) && getZodTypeName(obj) === 'ZodObject';
}

// TODO(b/425992518): consider conversion to FunctionDeclaration directly.
function parseZodV3Type(zodType: z3.ZodTypeAny): Schema | undefined {
  const def = zodType._def;
  if (!def) {
    return {};
  }
  const description = def.description;
  const result: Schema = {};
  if (description) result.description = description;

  const returnResult = (result: Schema) => {
    if (result.description === undefined) {
      delete result.description;
    }
    return result;
  };

  switch (def.typeName) {
    case z3.ZodFirstPartyTypeKind.ZodString:
      result.type = Type.STRING;
      for (const check of def.checks || []) {
        if (check.kind === 'min') result.minLength = check.value.toString();
        else if (check.kind === 'max')
          result.maxLength = check.value.toString();
        else if (check.kind === 'email') {
          result.format = 'email';
          result.pattern = `^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$`;
        } else if (check.kind === 'uuid') {
          result.format = 'uuid';
          result.pattern =
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$';
        } else if (check.kind === 'url') {
          result.format = 'uri';
        } else if (check.kind === 'regex') {
          result.pattern = check.regex.source;
        }
      }
      return returnResult(result);

    case z3.ZodFirstPartyTypeKind.ZodNumber:
      result.type = Type.NUMBER;
      for (const check of def.checks || []) {
        if (check.kind === 'min') result.minimum = check.value;
        else if (check.kind === 'max') result.maximum = check.value;
        else if (check.kind === 'int') {
          result.type = Type.INTEGER;
          result.minimum = Number.MIN_SAFE_INTEGER;
          result.maximum = Number.MAX_SAFE_INTEGER;
        }
      }
      return returnResult(result);

    case z3.ZodFirstPartyTypeKind.ZodBoolean:
      result.type = Type.BOOLEAN;
      return returnResult(result);

    case z3.ZodFirstPartyTypeKind.ZodArray:
      result.type = Type.ARRAY;
      result.items = parseZodV3Type(def.type);
      if (def.minLength) result.minItems = def.minLength.value.toString();
      if (def.maxLength) result.maxItems = def.maxLength.value.toString();
      return returnResult(result);

    case z3.ZodFirstPartyTypeKind.ZodObject: {
      const nestedSchema = zodObjectToSchema(zodType as z3.ZodObject<any>);
      return nestedSchema as Schema;
    }

    case z3.ZodFirstPartyTypeKind.ZodLiteral:
      const literalType = typeof def.value;
      result.enum = [def.value.toString()];

      if (literalType === 'string') {
        result.type = Type.STRING;
      } else if (literalType === 'number') {
        result.type = Type.NUMBER;
      } else if (literalType === 'boolean') {
        result.type = Type.BOOLEAN;
      } else if (def.value === null) {
        result.type = Type.NULL;
      } else {
        throw new Error(`Unsupported ZodLiteral value type: ${literalType}`);
      }

      return returnResult(result);

    case z3.ZodFirstPartyTypeKind.ZodEnum:
      result.type = Type.STRING;
      result.enum = def.values;
      return returnResult(result);

    case z3.ZodFirstPartyTypeKind.ZodNativeEnum:
      result.type = Type.STRING;
      result.enum = Object.values(def.values);
      return returnResult(result);

    case z3.ZodFirstPartyTypeKind.ZodUnion:
      result.anyOf = def.options.map(parseZodV3Type);
      return returnResult(result);

    case z3.ZodFirstPartyTypeKind.ZodOptional:
      return parseZodV3Type(def.innerType);
    case z3.ZodFirstPartyTypeKind.ZodNullable:
      const nullableInner = parseZodV3Type(def.innerType);
      return nullableInner
        ? returnResult({
            ...nullableInner,
            nullable: true,
            ...(description && {description}),
          })
        : returnResult({type: Type.NULL, ...(description && {description})});
    case z3.ZodFirstPartyTypeKind.ZodDefault:
      const defaultInner = parseZodV3Type(def.innerType);
      if (defaultInner) {
        defaultInner.default = def.defaultValue();
      }

      return defaultInner;
    case z3.ZodFirstPartyTypeKind.ZodBranded:
      return parseZodV3Type(def.type);
    case z3.ZodFirstPartyTypeKind.ZodReadonly:
      return parseZodV3Type(def.innerType);
    case z3.ZodFirstPartyTypeKind.ZodNull:
      result.type = Type.NULL;
      result.nullable = true;
      return returnResult(result);
    case z3.ZodFirstPartyTypeKind.ZodAny:
    case z3.ZodFirstPartyTypeKind.ZodUnknown:
      return returnResult({...(description && {description})});
    default:
      throw new Error(`Unsupported Zod type: ${def.typeName}`);
  }
}

function toJsonSchemaZ3(schema: z3.ZodObject<z3.ZodRawShape>): Schema {
  const shape = schema.shape;
  const properties: Record<string, Schema> = {};
  const required: string[] = [];

  for (const key in shape) {
    const fieldSchema = shape[key];
    const parsedField = parseZodV3Type(fieldSchema);
    if (parsedField) {
      properties[key] = parsedField;
    }

    let currentSchema = fieldSchema;
    let isOptional = false;
    while (
      currentSchema._def.typeName === z3.ZodFirstPartyTypeKind.ZodOptional ||
      currentSchema._def.typeName === z3.ZodFirstPartyTypeKind.ZodDefault
    ) {
      isOptional = true;
      currentSchema = currentSchema._def.innerType;
    }
    if (!isOptional) {
      required.push(key);
    }
  }

  return {
    type: Type.OBJECT,
    properties,
    required: required.length > 0 ? required : [],
    ...(schema._def.description ? {description: schema._def.description} : {}),
  };
}

export function zodObjectToSchema(
  schema: z3.ZodObject<z3.ZodRawShape> | z4.ZodObject<z4.ZodRawShape>,
): Schema {
  if (!isZodObject(schema)) {
    throw new Error('Expected a Zod Object');
  }

  if (isZodV4Schema(schema)) {
    return toJSONSchemaV4(schema, {
      target: 'openapi-3.0',
      override(ctx) {
        if (ctx.jsonSchema.additionalProperties !== undefined) {
          delete ctx.jsonSchema.additionalProperties;
        }

        if (ctx.jsonSchema.type !== undefined) {
          ctx.jsonSchema.type = ctx.jsonSchema.type.toUpperCase() as
            | 'object'
            | 'array'
            | 'string'
            | 'number'
            | 'boolean'
            | 'null'
            | 'integer';
        }

        if (ctx.jsonSchema.readOnly !== undefined) {
          delete ctx.jsonSchema.readOnly;
        }

        if (ctx.jsonSchema.maxItems !== undefined) {
          (ctx.jsonSchema as Schema).maxItems =
            ctx.jsonSchema.maxItems.toString();
        }

        if (ctx.jsonSchema.minItems !== undefined) {
          (ctx.jsonSchema as Schema).minItems =
            ctx.jsonSchema.minItems.toString();
        }

        if (ctx.jsonSchema.minLength !== undefined) {
          (ctx.jsonSchema as Schema).minLength =
            ctx.jsonSchema.minLength.toString();
        }

        if (ctx.jsonSchema.maxLength !== undefined) {
          (ctx.jsonSchema as Schema).maxLength =
            ctx.jsonSchema.maxLength.toString();
        }

        if (
          ctx.jsonSchema.enum?.length === 1 &&
          ctx.jsonSchema.enum[0] === null
        ) {
          (ctx.jsonSchema as Schema).type = Type.NULL;
          delete ctx.jsonSchema.enum;
        }
      },
    }) as Schema;
  }

  if (isZodV3Schema(schema)) {
    return toJsonSchemaZ3(schema);
  }

  throw new Error('Unsupported Zod schema version.');
}
