#!/usr/bin/env -S deno run --allow-run --allow-read
/**
 * setup_check.ts — sanity-checks the content-dashboard environment.
 *
 * Verifies that required tools are installed at suitable versions, that
 * content_dashboard.yaml is present, and that htdocs/dev-config.js exists
 * for local development.
 *
 * Usage:
 *   deno task check-setup
 *
 * Exit codes:
 *   0  All required checks passed (warnings may be present)
 *   1  One or more errors — something required is missing or wrong
 */

// ── ANSI colour helpers ────────────────────────────────────────────
const green  = (s: string) => `\x1b[32m${s}\x1b[0m`;
const orange = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red    = (s: string) => `\x1b[31m${s}\x1b[0m`;

// ── Version helpers ────────────────────────────────────────────────
type SemVer = [number, number, number];

/** Extract the first X.Y.Z triple found in a string. */
function parseVersion(s: string): SemVer | null {
  const m = s.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

/** Return true if actual >= min. */
function meetsMin(actual: SemVer, min: SemVer): boolean {
  for (let i = 0; i < 3; i++) {
    if (actual[i] > min[i]) return true;
    if (actual[i] < min[i]) return false;
  }
  return true;
}

function fmt(v: SemVer): string {
  return v.join(".");
}

// ── I/O helpers ────────────────────────────────────────────────────

/** Run a command, returning combined stdout+stderr output, or null if not found. */
async function runCmd(bin: string, ...args: string[]): Promise<string | null> {
  try {
    const cmd = new Deno.Command(bin, {
      args,
      stdout: "piped",
      stderr: "piped",
    });
    const { stdout, stderr } = await cmd.output();
    const out = new TextDecoder().decode(stdout).trim();
    const err = new TextDecoder().decode(stderr).trim();
    return out || err || null;
  } catch {
    return null; // binary not found / not executable
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch {
    return false;
  }
}

/** Read NAME=value or export NAME=value from a .env-style file, trimming quotes. */
function readEnvVar(text: string, name: string): string | null {
  const m = text.match(new RegExp(`^\\s*(?:export\\s+)?${name}=(.*)$`, "m"));
  if (!m) return null;
  return m[1].trim().replace(/^["']|["']$/g, "");
}

// ── Collect results ────────────────────────────────────────────────
const errors:   string[] = [];
const warnings: string[] = [];

function error(msg: string)   { errors.push(msg); }
function warning(msg: string) { warnings.push(msg); }

// ── 1. dataset CLI ─────────────────────────────────────────────────
const DATASET_MIN: SemVer = [2, 4, 1];

for (const bin of ["dataset", "datasetd"]) {
  const out = await runCmd(bin, "--version");
  if (out === null) {
    error(`${bin}: not found\n` +
          `  Install from https://github.com/caltechlibrary/dataset/releases`);
  } else {
    const v = parseVersion(out);
    if (!v) {
      error(`${bin}: could not parse version from: "${out}"`);
    } else if (!meetsMin(v, DATASET_MIN)) {
      error(`${bin}: found ${fmt(v)}, need >= ${fmt(DATASET_MIN)}\n` +
            `  Upgrade from https://github.com/caltechlibrary/dataset/releases`);
    }
  }
}

// ── 2. Deno or compiled proxy binary ──────────────────────────────
const DENO_MIN: SemVer = [2, 8, 0];

const denoOut = await runCmd("deno", "--version");
let denoVersionOk = false;

if (denoOut !== null) {
  const v = parseVersion(denoOut.split("\n")[0]);
  if (v && meetsMin(v, DENO_MIN)) {
    denoVersionOk = true;
  } else if (v) {
    warning(`deno: found ${fmt(v)}, need >= ${fmt(DENO_MIN)} to run the proxy via deno task\n` +
            `  Checking for a compiled proxy in bin/ as fallback…`);
  }
}

if (!denoVersionOk) {
  const proxyBin = await fileExists("bin/proxy");
  if (proxyBin) {
    warning(denoOut === null
      ? "deno: not found — using compiled proxy at bin/proxy"
      : "deno: version too old — using compiled proxy at bin/proxy");
  } else {
    error((denoOut === null
      ? `deno: not found and no compiled proxy at bin/proxy`
      : `deno: version too old and no compiled proxy at bin/proxy`) +
      `\n  Install Deno >= ${fmt(DENO_MIN)} from https://deno.com\n` +
      `  or compile the proxy:\n` +
      `    deno compile --output bin/proxy --allow-net --allow-env --allow-read proxy/main.ts`);
  }
}

// ── 3. content_dashboard.yaml ─────────────────────────────────────
if (!await fileExists("content_dashboard.yaml")) {
  error("content_dashboard.yaml: not found\n" +
        "  This file must exist in the directory where you run datasetd.\n" +
        "  See SETUP.md for a full annotated example.");
}

// ── 3b. proxy_config.yaml ─────────────────────────────────────────
if (!await fileExists("proxy_config.yaml")) {
  error("proxy_config.yaml: not found\n" +
        "  This file must exist in the directory where you run the Deno proxy.\n" +
        "  See SETUP.md for a full annotated example.");
}

// ── 4. htdocs/dev-config.js (development only) ────────────────────
if (!await fileExists("htdocs/dev-config.js")) {
  warning("htdocs/dev-config.js: not found (only needed for local development)\n" +
          "  Create htdocs/dev-config.js with:\n" +
          "    window.__DEV_CONFIG__ = {\n" +
          "      apiBase:     'http://localhost:8080',\n" +
          "      datasetBase: 'http://localhost:8200',\n" +
          "    };");
}

// ── 5. .env (LibGuides credentials) ────────────────────────────────
const REQUIRED_ENV = ["LIBGUIDES_CLIENT_ID", "LIBGUIDES_CLIENT_SECRET"];

if (!await fileExists(".env")) {
  warning(".env: not found\n" +
          "  Required for LibGuides API access (LIBGUIDES_CLIENT_ID, LIBGUIDES_CLIENT_SECRET).\n" +
          "  /content-dashboard/api/libguides/* will return errors until it exists.\n" +
          "  See DEPLOYMENT.md.");
} else {
  const envText = await Deno.readTextFile(".env");
  const missing = REQUIRED_ENV.filter((name) => !readEnvVar(envText, name));
  if (missing.length > 0) {
    warning(`.env: missing or empty ${missing.join(", ")}\n` +
            "  /content-dashboard/api/libguides/* will return errors until set.\n" +
            "  See DEPLOYMENT.md.");
  }
}

// ── Report ─────────────────────────────────────────────────────────
for (const w of warnings) {
  console.error(orange(`warning: ${w}`));
}
for (const e of errors) {
  console.error(red(`error: ${e}`));
}

if (errors.length === 0) {
  console.log(green("setup OK"));
  Deno.exit(0);
} else {
  Deno.exit(1);
}
