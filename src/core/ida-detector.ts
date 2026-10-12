/**
 * IDA Pro & idalib Auto-Detection Engine
 * Automatically discovers local IDA Pro installations and idalib Python environments
 * to configure OMP native IDA integration.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface DetectedIdaConfig {
  found: boolean;
  installDir?: string;
  python?: string;
  hasIdalib: boolean;
  version?: string;
}

/**
 * Scans host workstation for IDA Pro 9+ installations and compatible idalib Python environments.
 */
export function detectIdaInstallation(customBaseDir?: string): DetectedIdaConfig {
  const homeDir = os.homedir();
  const platform = os.platform();
  const candidateDirs: string[] = [];

  // 1. Explicit environment overrides
  if (process.env.IDA_DIR) candidateDirs.push(process.env.IDA_DIR);
  if (process.env.IDA_INSTALL_DIR) candidateDirs.push(process.env.IDA_INSTALL_DIR);
  if (customBaseDir) candidateDirs.push(customBaseDir);

  // 2. Platform-specific candidate discovery
  if (platform === "darwin") {
    const appRoots = ["/Applications", path.join(homeDir, "Applications")];
    for (const root of appRoots) {
      if (fs.existsSync(root)) {
        try {
          const entries = fs.readdirSync(root);
          // Prefer newest version, e.g. 9.4 before 9.3
          const idaApps = entries
            .filter((e) => /IDA.*\.app$/i.test(e))
            .sort((a, b) => b.localeCompare(a));

          for (const app of idaApps) {
            candidateDirs.push(path.join(root, app, "Contents/MacOS"));
          }

          const idaDirs = entries.filter((e) => /^IDA/i.test(e) && !e.endsWith(".app"));
          for (const d of idaDirs) {
            candidateDirs.push(path.join(root, d, "ida64.app/Contents/MacOS"));
            candidateDirs.push(path.join(root, d, "Contents/MacOS"));
          }
        } catch {
          // ignore directory read errors
        }
      }
    }
  } else if (platform === "linux") {
    const linuxRoots = ["/opt", homeDir, path.join(homeDir, ".idapro")];
    for (const root of linuxRoots) {
      if (fs.existsSync(root)) {
        try {
          const entries = fs.readdirSync(root);
          const idaDirs = entries
            .filter((e) => /ida.*9/i.test(e) || /^ida/i.test(e))
            .sort((a, b) => b.localeCompare(a));
          for (const d of idaDirs) {
            candidateDirs.push(path.join(root, d));
          }
        } catch {
          // ignore directory read errors
        }
      }
    }
  } else if (platform === "win32") {
    const progFiles = [process.env["ProgramFiles"], process.env["ProgramFiles(x86)"]].filter(
      (p): p is string => Boolean(p)
    );
    for (const pf of progFiles) {
      if (fs.existsSync(pf)) {
        try {
          const entries = fs.readdirSync(pf);
          const idaDirs = entries
            .filter((e) => /^IDA/i.test(e))
            .sort((a, b) => b.localeCompare(a));
          for (const d of idaDirs) {
            candidateDirs.push(path.join(pf, d));
          }
        } catch {
          // ignore directory read errors
        }
      }
    }
  }

  // 3. Resolve first directory with valid idalib or ida binary
  let resolvedInstallDir: string | undefined;
  let hasIdalib = false;
  let detectedVersion: string | undefined;

  for (const dir of candidateDirs) {
    if (!fs.existsSync(dir)) continue;

    const dylibName =
      platform === "darwin"
        ? "libidalib.dylib"
        : platform === "win32"
          ? "idalib.dll"
          : "libidalib.so";

    const hasLib = fs.existsSync(path.join(dir, dylibName));
    const hasBinary =
      fs.existsSync(path.join(dir, "ida")) ||
      fs.existsSync(path.join(dir, "ida64")) ||
      fs.existsSync(path.join(dir, "ida.exe")) ||
      fs.existsSync(path.join(dir, "ida64.exe"));

    if (hasLib || hasBinary) {
      resolvedInstallDir = dir;
      hasIdalib = hasLib;

      const verMatch = dir.match(/9\.\d+/);
      if (verMatch) {
        detectedVersion = verMatch[0];
      }
      break;
    }
  }

  if (!resolvedInstallDir) {
    return { found: false, hasIdalib: false };
  }

  // 4. Locate compatible Python environment
  const candidatePythons: string[] = [];
  if (process.env.IDA_PYTHON) candidatePythons.push(process.env.IDA_PYTHON);

  candidatePythons.push(
    path.join(homeDir, ".idapro/venv/bin/python"),
    path.join(homeDir, ".idapro/venv/bin/python3"),
    path.join(homeDir, ".idapro/venv/Scripts/python.exe"),
    path.join(resolvedInstallDir, "venv/bin/python"),
    path.join(resolvedInstallDir, "venv/bin/python3"),
    path.join(resolvedInstallDir, "python/bin/python")
  );

  let resolvedPython: string | undefined;
  for (const py of candidatePythons) {
    if (fs.existsSync(py)) {
      resolvedPython = py;
      break;
    }
  }

  if (!resolvedPython) {
    const sysPy = Bun.which("python3") ?? Bun.which("python");
    if (sysPy) resolvedPython = sysPy;
  }

  return {
    found: true,
    installDir: resolvedInstallDir,
    python: resolvedPython,
    hasIdalib,
    version: detectedVersion,
  };
}
