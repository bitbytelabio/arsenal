/**
 * Ajv 8 (JSON Schema 2020-12) Schema Validator & Compiler for Arsenal
 * Configured with useDefaults: false, removeAdditional: false, coerceTypes: false
 */

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { ErrorObject } from "ajv";

export interface ValidationResult<T = unknown> {
  valid: boolean;
  data: T;
  errors: string[];
}

export const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  useDefaults: false,
  removeAdditional: false,
  coerceTypes: false,
});

addFormats(ajv);

export const SCOPE_SCHEMA = {
  $id: "https://arsenal.security/schemas/scope.json",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: [
    "schema_version",
    "engagement_id",
    "name",
    "created_at",
    "domain",
    "auth",
    "in_scope",
    "out_of_scope",
    "disallowed_actions",
    "window",
  ],
  properties: {
    schema_version: { const: 1 },
    engagement_id: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    created_at: { type: "string", format: "date-time" },
    domain: { enum: ["re", "webapp", "mobile", "red"] },
    auth: {
      type: "object",
      required: ["status", "ready_for_act"],
      properties: {
        status: { enum: ["incomplete", "granted", "expired", "revoked"] },
        basis: { type: ["string", "null"] },
        reference: { type: ["string", "null"] },
        ready_for_act: { type: "boolean" },
      },
      additionalProperties: false,
    },
    in_scope: {
      type: "array",
      items: { type: "string" },
    },
    out_of_scope: {
      type: "array",
      items: { type: "string" },
    },
    disallowed_actions: {
      type: "array",
      items: { type: "string" },
    },
    window: {
      type: "object",
      required: ["start", "end", "timezone"],
      properties: {
        start: { type: "string", format: "date-time" },
        end: { type: "string", format: "date-time" },
        timezone: { type: "string" },
        allowed_hours: {
          type: "array",
          items: { type: "string" },
        },
      },
      additionalProperties: false,
    },
    environment_id: { type: ["string", "null"] },
    charter_path: { type: ["string", "null"] },
    charter_sha256: { type: ["string", "null"] },
    budget_usd: { type: ["string", "number", "null"] },
  },
  additionalProperties: false,
} as const;

export const ENGAGEMENT_SCHEMA = {
  $id: "https://arsenal.security/schemas/engagement.json",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: [
    "schema_version",
    "engagement_id",
    "name",
    "domain",
    "created_at",
    "auth",
    "status",
  ],
  properties: {
    schema_version: { const: 1 },
    engagement_id: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    domain: { enum: ["re", "webapp", "mobile", "red"] },
    created_at: { type: "string", format: "date-time" },
    auth: {
      type: "object",
      required: ["status", "ready_for_act"],
      properties: {
        status: { enum: ["incomplete", "granted", "expired", "revoked"] },
        basis: { type: ["string", "null"] },
        reference: { type: ["string", "null"] },
        ready_for_act: { type: "boolean" },
      },
      additionalProperties: false,
    },
    status: {
      enum: ["prepared", "active", "stopped", "completed", "failed"],
    },
  },
  additionalProperties: false,
} as const;

export const ENVIRONMENT_SCHEMA = {
  $id: "https://arsenal.security/schemas/environment.json",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: [
    "schema_version",
    "id",
    "kind",
    "name",
    "working_root",
  ],
  properties: {
    schema_version: { const: 1 },
    id: { type: "string", minLength: 1 },
    kind: { enum: ["local", "container", "vm", "remote"] },
    name: { type: "string", minLength: 1 },
    address: { type: ["string", "null"] },
    access_method: { type: ["string", "null"] },
    working_root: { type: "string" },
    proxy_url: { type: ["string", "null"] },
    ca_path: { type: ["string", "null"] },
    browser_trust_path: { type: ["string", "null"] },
    tool_index_path: { type: ["string", "null"] },
    path_overrides: {
      type: ["array", "null"],
      items: { type: "string" },
    },
    observed_at: { type: ["string", "null"], format: "date-time" },
  },
  additionalProperties: false,
} as const;

export const EVIDENCE_RECEIPT_SCHEMA = {
  $id: "https://arsenal.security/schemas/evidence-receipt.json",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: [
    "schema_version",
    "engagement_id",
    "seq",
    "event_key",
    "kind",
    "entity_id",
    "session_id",
    "actor",
    "recorded_at",
    "prev_hash",
    "data",
  ],
  properties: {
    schema_version: { const: 1 },
    engagement_id: { type: "string", minLength: 1 },
    seq: { type: "integer", minimum: 1 },
    event_key: { type: "string", minLength: 1 },
    kind: { const: "evidence_receipt" },
    entity_id: { type: "string", pattern: "^E-[0-9]{6,}$" },
    session_id: { type: "string", minLength: 1 },
    actor: { type: "string", minLength: 1 },
    recorded_at: { type: "string", format: "date-time" },
    prev_hash: { type: "string", pattern: "^[0-9a-f]{64}$" },
    data: {
      type: "object",
      required: [
        "tool_name",
        "requested_target",
        "observed_endpoint",
        "scope_attribution",
        "scope_revision_sha256",
        "artifacts",
      ],
      properties: {
        tool_name: { type: "string" },
        requested_target: { type: "string" },
        observed_endpoint: { type: "string" },
        scope_attribution: { enum: ["in_scope", "out_of_scope", "unknown"] },
        scope_revision_sha256: {
          oneOf: [
            { type: "string", pattern: "^([0-9a-f]{64}|unk-[a-z0-9_-]+)$" },
            { type: "null" },
          ],
        },
        artifacts: {
          type: "array",
          items: {
            type: "object",
            required: [
              "artifact_id",
              "path",
              "media_type",
              "byte_length",
              "sha256",
              "fidelity",
            ],
            properties: {
              artifact_id: { type: "string" },
              path: { type: "string" },
              media_type: { type: "string" },
              byte_length: { type: "integer", minimum: 0 },
              sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
              fidelity: {
                enum: [
                  "raw",
                  "tool_result",
                  "host_sanitized",
                  "host_truncated",
                  "unavailable",
                ],
              },
            },
            additionalProperties: false,
          },
        },
        capture_gap: { type: ["string", "null"] },
        attribution_reason: { type: ["string", "null"] },
        matching_selector: { type: ["string", "null"] },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

export const FINDING_SCHEMA = {
  $id: "https://arsenal.security/schemas/finding.json",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: [
    "schema_version",
    "finding_id",
    "engagement_id",
    "title",
    "description",
    "severity",
    "affected_target",
    "discoverer",
    "evidence_ids",
    "validation_status",
  ],
  properties: {
    schema_version: { const: 1 },
    finding_id: { type: "string", pattern: "^F-[0-9]{6,}$" },
    engagement_id: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1 },
    description: { type: "string", minLength: 1 },
    severity: { enum: ["info", "low", "medium", "high", "critical"] },
    affected_target: { type: "string", minLength: 1 },
    cwe_id: { type: ["string", "null"] },
    rule_id: { type: ["string", "null"] },
    discoverer: {
      type: "object",
      required: ["role", "session_id"],
      properties: {
        role: { type: "string" },
        session_id: { type: "string" },
      },
      additionalProperties: false,
    },
    evidence_ids: {
      type: "array",
      minItems: 1,
      items: { type: "string" },
    },
    related_propositions: {
      type: "array",
      items: { type: "string" },
    },
    related_unknowns: {
      type: "array",
      items: { type: "string" },
    },
    validation_status: {
      enum: ["validated", "unvalidated", "rejected", "partial", "error"],
    },
  },
  additionalProperties: false,
} as const;

export const VERIFICATION_RESULT_SCHEMA = {
  $id: "https://arsenal.security/schemas/verification-result.json",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: [
    "schema_version",
    "finding_id",
    "verifier",
    "oracle_name",
    "oracle_version",
    "expected_behavior",
    "observed_behavior",
    "reproduction_evidence_ids",
    "outcome",
    "rationale",
    "verified_at",
  ],
  properties: {
    schema_version: { const: 1 },
    finding_id: { type: "string", pattern: "^F-[0-9]{6,}$" },
    verifier: {
      type: "object",
      required: ["role", "session_id"],
      properties: {
        role: { type: "string" },
        session_id: { type: "string" },
      },
      additionalProperties: false,
    },
    oracle_name: { type: "string", minLength: 1 },
    oracle_version: { type: "string", minLength: 1 },
    input_artifact_refs: {
      type: "array",
      items: { type: "string" },
    },
    expected_behavior: { type: "string" },
    observed_behavior: { type: "string" },
    reproduction_evidence_ids: {
      type: "array",
      items: { type: "string" },
    },
    outcome: {
      enum: ["validated", "unvalidated", "rejected", "partial", "error"],
    },
    rationale: { type: "string" },
    counterevidence_ids: {
      type: "array",
      items: { type: "string" },
    },
    execution_error: { type: ["string", "null"] },
    verified_at: { type: "string", format: "date-time" },
  },
  additionalProperties: false,
} as const;

export const MANIFEST_SCHEMA = {
  $id: "https://arsenal.security/schemas/manifest.json",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: [
    "schema_version",
    "generator",
    "files",
  ],
  properties: {
    schema_version: { const: 1 },
    generator: { type: "string", minLength: 1 },
    created_at: { type: ["string", "null"] },
    files: {
      type: "array",
      items: {
        type: "object",
        required: ["path", "sha256", "bytes"],
        properties: {
          path: { type: "string" },
          sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
          bytes: { type: "integer", minimum: 0 },
        },
        additionalProperties: false,
      },
    },
    overrides: {
      type: "array",
      items: {
        type: "object",
        required: ["capability_kind", "name", "source_path", "replaces_path", "reason"],
        properties: {
          capability_kind: { type: "string" },
          name: { type: "string" },
          source_path: { type: "string" },
          replaces_path: { type: "string" },
          reason: { type: "string" },
          owner: { type: "string" },
          approved_hash: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
} as const;

export const BUDGET_RECORD_SCHEMA = {
  $id: "https://arsenal.security/schemas/budget-record.json",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: [
    "schema_version",
    "engagement_id",
    "known_spend_usd",
    "unknown_usage_count",
    "token_totals",
    "warned_bands",
    "reserve_active",
  ],
  properties: {
    schema_version: { const: 1 },
    engagement_id: { type: "string", minLength: 1 },
    allowance_usd: { type: ["string", "null"] },
    known_spend_usd: { type: "string" },
    unknown_usage_count: { type: "integer", minimum: 0 },
    token_totals: {
      type: "object",
      required: ["input", "output", "cacheRead", "cacheWrite"],
      properties: {
        input: { type: "integer", minimum: 0 },
        output: { type: "integer", minimum: 0 },
        cacheRead: { type: "integer", minimum: 0 },
        cacheWrite: { type: "integer", minimum: 0 },
      },
      additionalProperties: false,
    },
    warned_bands: {
      type: "array",
      items: { type: "integer" },
    },
    reserve_active: { type: "boolean" },
    in_flight_spawns: {
      type: "array",
      items: { type: "string" },
    },
    ledger_head_hash: { type: ["string", "null"] },
  },
  additionalProperties: false,
} as const;

export const CLI_ENVELOPE_SCHEMA = {
  $id: "https://arsenal.security/schemas/cli-envelope.json",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: [
    "$schema",
    "version",
    "command",
    "status",
    "exitCode",
    "timestamp",
    "mode",
    "data",
    "warnings",
    "errors",
  ],
  properties: {
    $schema: { type: "string" },
    version: { const: "3.0.0" },
    command: { type: "string" },
    status: { enum: ["success", "failure"] },
    exitCode: { type: "integer" },
    timestamp: { type: "string", format: "date-time" },
    mode: { enum: ["preview", "write", "check"] },
    data: { type: "object" },
    warnings: {
      type: "array",
      items: { type: "string" },
    },
    errors: {
      type: "array",
      items: { type: "string" },
    },
  },
  additionalProperties: false,
} as const;

export const SKILL_FRONTMATTER_SCHEMA = {
  $id: "https://arsenal.security/schemas/skill-frontmatter.json",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: [
    "name",
    "description",
    "domain",
    "category",
    "hide",
    "license",
    "metadata",
  ],
  properties: {
    name: {
      type: "string",
      pattern: "^(re|webapp|mobile|red)-[a-z0-9]+(-[a-z0-9]+)*$",
      maxLength: 64,
    },
    description: {
      type: "string",
      minLength: 40,
      maxLength: 300,
      not: {
        pattern: "[\r\n]",
      },
    },
    domain: {
      enum: ["re", "webapp", "mobile", "red"],
    },
    category: {
      type: "string",
      minLength: 1,
    },
    hide: {
      type: "boolean",
    },
    license: {
      type: "string",
      pattern: "^[a-zA-Z0-9-.]+(\\+|( (AND|OR|WITH) [a-zA-Z0-9-.]+))*$",
    },
    metadata: {
      type: "object",
      required: ["manifest_entry"],
      properties: {
        manifest_entry: {
          type: "string",
          minLength: 1,
        },
      },
      not: {
        anyOf: [
          { required: ["upstream"] },
          { required: ["source_path"] },
          { required: ["source_sha256"] },
        ],
      },
      additionalProperties: true,
    },
  },
  additionalProperties: true,
} as const;

export const CORPUS_MANIFEST_SCHEMA = {
  $id: "https://arsenal.security/schemas/corpus-manifest.json",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: [
    "schema_version",
    "generator",
    "created_at",
    "summary",
    "sources",
    "files",
  ],
  properties: {
    schema_version: { const: 1 },
    generator: { type: "string", minLength: 1 },
    created_at: { type: "null" },
    summary: {
      type: "object",
      required: ["total_considered", "admitted", "quarantined", "excluded", "deduplicated"],
      properties: {
        total_considered: { type: "integer", minimum: 0 },
        admitted: { type: "integer", minimum: 0 },
        quarantined: { type: "integer", minimum: 0 },
        excluded: { type: "integer", minimum: 0 },
        deduplicated: { type: "integer", minimum: 0 },
      },
      additionalProperties: false,
    },
    sources: {
      type: "object",
      additionalProperties: {
        type: "object",
        required: ["repo", "rev", "license"],
        properties: {
          repo: { type: "string", minLength: 1 },
          rev: { type: ["string", "null"] },
          license: {
            type: "string",
            pattern: "^[a-zA-Z0-9-.]+(\\+|( (AND|OR|WITH) [a-zA-Z0-9-.]+))*$",
          },
        },
        additionalProperties: false,
      },
      propertyNames: { type: "string", minLength: 1 },
      patternProperties: {
        "^arsenal-local$": {
          type: "object",
          required: ["repo", "rev", "license"],
          properties: {
            repo: { type: "string", minLength: 1 },
            rev: { type: "null" },
            license: {
              type: "string",
              pattern: "^[a-zA-Z0-9-.]+(\\+|( (AND|OR|WITH) [a-zA-Z0-9-.]+))*$",
            },
          },
          additionalProperties: false,
        },
        "^(?!arsenal-local$).*": {
          type: "object",
          required: ["repo", "rev", "license"],
          properties: {
            repo: { type: "string", minLength: 1 },
            rev: { type: "string", pattern: "^[0-9a-f]{7,64}$" },
            license: {
              type: "string",
              pattern: "^[a-zA-Z0-9-.]+(\\+|( (AND|OR|WITH) [a-zA-Z0-9-.]+))*$",
            },
          },
          additionalProperties: false,
        },
      },
    },
    files: {
      type: "array",
      items: {
        type: "object",
        required: [
          "path",
          "source",
          "source_rev",
          "license",
          "status",
        ],
        properties: {
          path: { type: "string", minLength: 1 },
          source: { type: "string", minLength: 1 },
          source_rev: { type: ["string", "null"] },
          license: {
            type: "string",
            pattern: "^[a-zA-Z0-9-.]+(\\+|( (AND|OR|WITH) [a-zA-Z0-9-.]+))*$",
          },
          status: {
            enum: ["admitted", "deduplicated", "quarantined", "excluded"],
          },
          reason: { type: "string" },
          destination_path: { type: "string" },
          sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
          bytes: { type: "integer", minimum: 0 },
          superseded_by: { type: "string" },
          source_path: { type: "string" },
          source_sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
          support_files: {
            type: "array",
            items: {
              type: "object",
              required: ["path", "source_path", "sha256", "bytes"],
              properties: {
                path: { type: "string", minLength: 1 },
                source_path: { type: "string", minLength: 1 },
                sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
                bytes: { type: "integer", minimum: 0 },
              },
              additionalProperties: false,
            },
          },
        },
        allOf: [
          {
            if: {
              properties: { status: { const: "deduplicated" } },
            },
            then: {
              required: ["superseded_by", "reason"],
              not: {
                anyOf: [
                  { required: ["destination_path"] },
                  { required: ["sha256"] },
                  { required: ["bytes"] },
                ],
              },
            },
          },
          {
            if: {
              properties: { status: { enum: ["quarantined", "excluded"] } },
            },
            then: {
              required: ["reason"],
            },
          },
          {
            if: {
              properties: { status: { const: "admitted" } },
            },
            then: {
              required: ["destination_path", "sha256", "bytes"],
            },
          },
          {
            if: {
              properties: { source: { const: "arsenal-local" } },
            },
            then: {
              properties: {
                source_rev: { type: "null" },
              },
            },
            else: {
              properties: {
                source_rev: { type: "string", pattern: "^[0-9a-f]{7,64}$" },
              },
            },
          },
        ],
        additionalProperties: false,
      },
    },
    dedup_groups: {
      type: "array",
      items: {
        type: "object",
        required: [
          "key",
          "tier",
          "members",
          "rationale",
          "applied",
        ],
        properties: {
          key: { type: "string", minLength: 1 },
          tier: { enum: ["A", "B"] },
          members: {
            type: "array",
            minItems: 2,
            items: { type: "string", minLength: 1 },
          },
          winner: { type: "string", minLength: 1 },
          rationale: { type: "string", minLength: 1 },
          applied: { type: "boolean" },
        },
        allOf: [
          {
            if: {
              properties: { tier: { const: "A" } },
            },
            then: {
              required: ["winner"],
            },
          },
        ],
        additionalProperties: false,
      },
    },
    support_files: {
      type: "object",
      additionalProperties: {
        type: "array",
        items: {
          type: "object",
          required: ["path", "source_path", "sha256", "bytes"],
          properties: {
            path: { type: "string", minLength: 1 },
            source_path: { type: "string", minLength: 1 },
            sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
            bytes: { type: "integer", minimum: 0 },
          },
          additionalProperties: false,
        },
      },
    },
  },
  additionalProperties: false,
} as const;

export const ROUTING_TABLE_SCHEMA = {
  $id: "https://arsenal.security/schemas/routing-table.json",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: ["schemaVersion", "meta", "categories", "priority", "routes"],
  properties: {
    schemaVersion: { const: "1.1" },
    meta: {
      type: "object",
      required: ["domain", "description"],
      properties: {
        domain: { enum: ["re", "webapp", "mobile", "red"] },
        description: { type: "string", minLength: 1 },
        fallbackId: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
    categories: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { type: "string", minLength: 1 },
    },
    priority: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { type: "string", pattern: "^[A-Z][0-9]+$" },
    },
    routes: {
      type: "object",
      minProperties: 1,
      additionalProperties: {
        type: "object",
        required: ["id", "leaf", "category", "must"],
        properties: {
          id: { type: "string", pattern: "^[A-Z][0-9]+$" },
          leaf: { type: "string", pattern: "^(re|webapp|mobile|red)-[a-z0-9-]+$" },
          category: { type: "string", minLength: 1 },
          must: { type: "string", minLength: 1 },
          mustAll: {
            type: "array",
            minItems: 1,
            items: { type: "string", minLength: 1 },
          },
          exclude: { type: "string", minLength: 1 },
          note: { type: "string", minLength: 1 },
          crossDomain: {
            type: "object",
            required: ["reason"],
            properties: { reason: { type: "string", minLength: 1 } },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
} as const;

export const COVERAGE_BASELINE_SCHEMA = {
  $id: "https://arsenal.security/schemas/coverage-baseline.json",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: ["schemaVersion", "domain", "standard", "extracted_from", "license", "capabilities"],
  properties: {
    schemaVersion: { const: "1.0" },
    domain: { enum: ["re", "webapp", "mobile", "red"] },
    standard: {
      type: "object",
      required: ["name", "url", "revision"],
      properties: {
        name: { type: "string", minLength: 1 },
        url: { type: "string", minLength: 1 },
        revision: { type: "string", minLength: 1 },
        version: { type: ["string", "null"] },
      },
      additionalProperties: false,
    },
    extracted_from: {
      type: "object",
      required: ["path", "sha256"],
      properties: {
        path: { type: "string", minLength: 1 },
        sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
      },
      additionalProperties: false,
    },
    license: { type: "string", minLength: 1 },
    capabilities: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "title", "category", "source_ref"],
        properties: {
          id: { type: "string", minLength: 1 },
          title: { type: "string", minLength: 1 },
          category: { type: "string", minLength: 1 },
          source_ref: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
} as const;

export interface ExtensionBundleArtifact {
  name: "bounding" | "ledger" | "budget" | "routing";
  entrypoint: string;
  outputPath: string;
  byteLength: number;
  sha256: string;
  externalImports: string[];
}

export const EXTENSION_BUNDLE_ARTIFACT_SCHEMA = {
  $id: "https://arsenal.security/schemas/extension-bundle-artifact.json",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: [
    "name",
    "entrypoint",
    "outputPath",
    "byteLength",
    "sha256",
    "externalImports",
  ],
  properties: {
    name: {
      type: "string",
      enum: ["bounding", "ledger", "budget", "routing"],
    },
    entrypoint: {
      type: "string",
      minLength: 1,
    },
    outputPath: {
      type: "string",
      minLength: 1,
    },
    byteLength: {
      type: "integer",
      exclusiveMinimum: 0,
    },
    sha256: {
      type: "string",
      pattern: "^[0-9a-f]{64}$",
    },
    externalImports: {
      type: "array",
      maxItems: 0,
      items: { type: "string" },
    },
  },
  additionalProperties: false,
} as const;

export interface VerificationOraclePayload {
  oracle_type: "timing_differential" | "authz_matrix" | "path_traversal";
  parameters: Record<string, unknown>;
}

export const VERIFICATION_ORACLE_SCHEMA = {
  $id: "https://arsenal.security/schemas/verification-oracle.json",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: ["oracle_type", "parameters"],
  properties: {
    oracle_type: {
      type: "string",
      enum: ["timing_differential", "authz_matrix", "path_traversal"],
    },
    parameters: {
      type: "object",
    },
  },
  additionalProperties: false,
} as const;

// Register schemas with Ajv2020
ajv.addSchema(SCOPE_SCHEMA);
ajv.addSchema(ENGAGEMENT_SCHEMA);
ajv.addSchema(ENVIRONMENT_SCHEMA);
ajv.addSchema(EVIDENCE_RECEIPT_SCHEMA);
ajv.addSchema(FINDING_SCHEMA);
ajv.addSchema(VERIFICATION_RESULT_SCHEMA);
ajv.addSchema(MANIFEST_SCHEMA);
ajv.addSchema(BUDGET_RECORD_SCHEMA);
ajv.addSchema(CLI_ENVELOPE_SCHEMA);
ajv.addSchema(SKILL_FRONTMATTER_SCHEMA);
ajv.addSchema(CORPUS_MANIFEST_SCHEMA);
ajv.addSchema(ROUTING_TABLE_SCHEMA);
ajv.addSchema(COVERAGE_BASELINE_SCHEMA);
ajv.addSchema(EXTENSION_BUNDLE_ARTIFACT_SCHEMA);
ajv.addSchema(VERIFICATION_ORACLE_SCHEMA);

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  if (!errors || errors.length === 0) return [];
  return errors.map((err) => `${err.instancePath || "/"}: ${err.message ?? "validation error"}`);
}

export function validateSchema<T>(schemaId: string, data: unknown): ValidationResult<T> {
  const validator = ajv.getSchema<T>(schemaId);
  if (!validator) {
    return {
      valid: false,
      data: data as T,
      errors: [`Schema not found: ${schemaId}`],
    };
  }
  const valid = validator(data);
  return {
    valid: Boolean(valid),
    data: data as T,
    errors: formatErrors(validator.errors),
  };
}
