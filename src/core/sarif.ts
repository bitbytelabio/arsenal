/**
 * OASIS SARIF v2.1.0 Report Exporter
 * Implements contracts/evidence-reporting.md §4.1 & T048
 * Generates SARIF v2.1.0 document representing all 5 verification outcomes
 */

import type { Finding, FindingSuppression } from "./findings.ts";
import { VERSION } from "./version.ts";

export interface SarifDocument {
  $schema: string;
  version: "2.1.0";
  runs: Array<{
    tool: {
      driver: {
        name: string;
        version: string;
        informationUri: string;
        rules: Array<{
          id: string;
          name: string;
          shortDescription: { text: string };
          defaultConfiguration?: { level: "error" | "warning" | "note" };
        }>;
      };
    };
    results: Array<{
      ruleId: string;
      level: "error" | "warning" | "note";
      message: { text: string };
      locations?: Array<{
        physicalLocation: {
          artifactLocation: { uri: string };
        };
      }>;
      properties: {
        finding_id: string;
        validation_status: string;
        evidence_ids: string[];
      };
      suppressions?: Array<{
        kind: "external";
        justification: string;
      }>;
    }>;
  }>;
}

function mapSeverityToSarifLevel(severity: string): "error" | "warning" | "note" {
  switch (severity) {
    case "critical":
    case "high":
      return "error";
    case "medium":
      return "warning";
    default:
      return "note";
  }
}

export function exportToSarif(
  findings: Finding[],
  suppressions: Record<string, FindingSuppression> = {}
): SarifDocument {
  const rulesMap: Record<string, { id: string; name: string; desc: string }> = {};

  const results = findings.map((f) => {
    const ruleId = f.rule_id ?? f.cwe_id ?? "ARSENAL-FINDING";
    if (!rulesMap[ruleId]) {
      rulesMap[ruleId] = {
        id: ruleId,
        name: f.title,
        desc: f.description,
      };
    }

    const level = mapSeverityToSarifLevel(f.severity);
    const supp = suppressions[f.finding_id];

    return {
      ruleId,
      level,
      message: { text: `${f.title}: ${f.description}` },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: f.affected_target },
          },
        },
      ],
      properties: {
        finding_id: f.finding_id,
        validation_status: f.validation_status,
        evidence_ids: f.evidence_ids,
      },
      suppressions: supp
        ? [
            {
              kind: "external" as const,
              justification: supp.reason,
            },
          ]
        : undefined,
    };
  });

  const rules = Object.values(rulesMap).map((r) => ({
    id: r.id,
    name: r.name,
    shortDescription: { text: r.desc },
  }));

  return {
    $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "Arsenal Security Harness",
            version: VERSION,
            informationUri: "https://github.com/bitbytelabio/arsenal",
            rules,
          },
        },
        results,
      },
    ],
  };
}
