/**
 * Assessment Scope Decomposition & Target Clustering Engine
 * Implements T034 & Research Design Patterns
 */

export interface EndpointCluster {
  id: string;
  endpoints: string[];
  requiresThreatChecklist: boolean;
  category: "recon" | "auth" | "financial" | "state_changing" | "general";
}

const EXCLUDED_PATH_PATTERNS = [
  /node_modules\//i,
  /vendor\//i,
  /dist\//i,
  /build\//i,
  /\.git\//i,
  /\.min\.(js|css)$/i,
  /\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/i,
];

export function isExcludedAsset(targetPath: string): boolean {
  const norm = targetPath.replace(/\\/g, "/");
  return EXCLUDED_PATH_PATTERNS.some((p) => p.test(norm));
}

export function filterAssessmentTargets(targets: string[]): string[] {
  return targets.filter((t) => !isExcludedAsset(t));
}

export function clusterEndpoints(endpoints: string[], maxGroupSize: number = 10): EndpointCluster[] {
  const filtered = filterAssessmentTargets(endpoints);
  const clusters: EndpointCluster[] = [];
  let clusterIndex = 1;

  for (let i = 0; i < filtered.length; i += maxGroupSize) {
    const chunk = filtered.slice(i, i + maxGroupSize);

    // Determine if high-risk category requires threat checklist
    let requiresChecklist = false;
    let category: "recon" | "auth" | "financial" | "state_changing" | "general" = "general";

    for (const ep of chunk) {
      const lower = ep.toLowerCase();
      if (lower.includes("login") || lower.includes("auth") || lower.includes("token") || lower.includes("oauth")) {
        requiresChecklist = true;
        category = "auth";
        break;
      }
      if (lower.includes("pay") || lower.includes("billing") || lower.includes("checkout") || lower.includes("wallet")) {
        requiresChecklist = true;
        category = "financial";
        break;
      }
      if (lower.includes("delete") || lower.includes("update") || lower.includes("create") || lower.includes("admin")) {
        requiresChecklist = true;
        category = "state_changing";
        break;
      }
      if (lower.includes("robots.txt") || lower.includes("sitemap") || lower.includes("health")) {
        category = "recon";
      }
    }

    clusters.push({
      id: `cluster-${String(clusterIndex++).padStart(3, "0")}`,
      endpoints: chunk,
      requiresThreatChecklist: requiresChecklist,
      category,
    });
  }

  return clusters;
}
