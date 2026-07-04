import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const betaDir = path.join(repoRoot, "release", "beta");
const targets = [path.join(betaDir, "win-unpacked"), path.join(betaDir, "builder-debug.yml")];

for (const target of targets) {
  const resolved = path.resolve(target);
  if (!resolved.startsWith(path.resolve(betaDir) + path.sep)) {
    throw new Error(`Refusing to clean outside beta output: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}
