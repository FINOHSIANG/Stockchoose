import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const token = process.env.STOCKCHOOSE_BUN_API_TOKEN || randomBytes(32).toString("hex");
const authFile = path.resolve(process.env.STOCKCHOOSE_AGENT_AUTH_FILE || path.join("tmp", "agent-runtime", "sidecar-auth"));
mkdirSync(path.dirname(authFile), { recursive: true });
writeFileSync(authFile, token, { encoding: "utf8", mode: 0o600 });

const env = {
  ...process.env,
  STOCKCHOOSE_BUN_API_TOKEN: token,
  STOCKCHOOSE_AGENT_AUTH_FILE: authFile
};

console.error(`STOCKCHOOSE Agent auth file: ${authFile}`);

const child = spawn("bun", ["run", "bun-api/server.ts"], {
  cwd: process.cwd(),
  env,
  stdio: "inherit",
  windowsHide: true
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  console.error("Failed to start Bun data API:", error.message);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  rmSync(authFile, { force: true });
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
