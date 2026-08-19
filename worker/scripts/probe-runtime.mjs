/**
 * Run probe/temporal-probe.js inside real workerd, at several compatibility
 * dates, and print what the runtime actually reports.
 *
 * Run: npm run probe        (from worker/)
 *
 * This exists because "is Temporal available at our compatibility date" is a
 * question about a runtime, and the only honest way to answer it is to ask that
 * runtime. Node's answer is irrelevant -- V8 in Node and V8 in workerd ship
 * different globals, and workerd gates some of them on the compat date.
 *
 * Caveat, and it is the important one: this drives the LOCAL workerd that
 * wrangler downloads. It is the same open-source runtime the fleet builds from,
 * but it is not the fleet. See TIMEZONE_BRIEF.md.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE = join(HERE, "..", "probe", "temporal-probe.js");

/** Compat dates worth asking about, oldest to newest. */
const DATES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "2024-01-01", // before most recent gating
      "2025-01-01",
      "2026-01-01",
      "2026-08-13", // ours
    ];

// Spawn wrangler's JS entry through node rather than the .cmd shim. The shim
// needs shell: true, and this repo's path contains a space -- which the shell
// splits on, so the shim silently never starts.
const WRANGLER = join(HERE, "..", "node_modules", "wrangler", "bin", "wrangler.js");

async function probeAt(compatDate, port) {
  const args = [
    WRANGLER,
    "dev",
    PROBE,
    `--compatibility-date=${compatDate}`,
    `--port=${port}`,
    "--ip=127.0.0.1",
    "--log-level=error",
  ];

  const child = spawn(process.execPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" },
  });

  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  child.stdout.on("data", () => {});

  try {
    const body = await waitForServer(`http://127.0.0.1:${port}/`, 60_000);
    body.compatibilityDate = compatDate;
    return body;
  } catch (err) {
    return { compatibilityDate: compatDate, error: String(err), stderr: stderr.slice(-2000) };
  } finally {
    child.kill();
    // Give workerd a moment to release the port before the next iteration.
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = String(err);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`worker never became ready: ${last}`);
}

const results = [];
let port = 8799;
for (const date of DATES) {
  process.stderr.write(`probing compat date ${date} ...\n`);
  results.push(await probeAt(date, port++));
}

console.log(JSON.stringify(results, null, 2));
