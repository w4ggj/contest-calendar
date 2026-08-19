/**
 * Generates the Python side of the parity fixture, in Node, before workerd starts.
 *
 * The parity check has to run *inside* workerd -- that is the whole point, since
 * a resolver that silently differs there is exactly the failure we are guarding
 * against -- but workerd has no child processes and no filesystem. So the Python
 * reference engine is run here, on the Node side, and its output is written to a
 * fixture that the workerd-side test imports as a module.
 *
 * Failure is loud. If Python is unreachable this throws and the whole run fails,
 * matching engine/tests/parity.test.ts: a parity check that skips looks green
 * while proving nothing, which is worse than having no check at all.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const DUMPER = resolve(REPO_ROOT, "scripts", "dump_occurrences.py");
const FIXTURE = resolve(HERE, "fixtures", "python-occurrences.json");

/** Same years as engine/tests/parity.test.ts: a normal year, the year after,
 *  a leap year, and one far enough out that any rule drift has compounded. */
export const PARITY_YEARS = [2026, 2027, 2030, 2032];

function dump(year: number): unknown[] {
  const failures: string[] = [];
  for (const python of ["python", "python3"]) {
    try {
      const out = execFileSync(python, [DUMPER, String(year)], {
        cwd: REPO_ROOT,
        encoding: "utf-8",
        maxBuffer: 64 * 1024 * 1024,
      });
      return JSON.parse(out) as unknown[];
    } catch (err) {
      failures.push(`${python}: ${(err as Error).message.split("\n")[0]}`);
    }
  }
  throw new Error(
    `Could not run scripts/dump_occurrences.py for ${year}.\n` +
      `  ${failures.join("\n  ")}\n\n` +
      "Parity with the Python engine is what makes two implementations of " +
      "contest dates safe to have, so this is a failure rather than a skip. " +
      "Activate the venv (.\\.venv\\Scripts\\Activate.ps1) and " +
      "`pip install -r requirements.txt` -- on Windows zoneinfo raises " +
      "without tzdata.",
  );
}

export default function setup(): void {
  if (!existsSync(DUMPER)) {
    throw new Error(`scripts/dump_occurrences.py not found at ${DUMPER}`);
  }

  const byYear: Record<string, unknown[]> = {};
  for (const year of PARITY_YEARS) {
    byYear[String(year)] = dump(year);
  }

  mkdirSync(dirname(FIXTURE), { recursive: true });
  // Written rather than passed through `provide()` because the workerd side
  // imports it as a module: the fixture is megabytes of JSON, and pushing that
  // through the pool's serialisation boundary on every test file is wasteful.
  writeFileSync(FIXTURE, JSON.stringify(byYear), "utf-8");
}
