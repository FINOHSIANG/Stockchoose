const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function cargoCandidates() {
  const exe = process.platform === "win32" ? "cargo.exe" : "cargo";
  const home = process.env.USERPROFILE || process.env.HOME || "";
  return [
    process.env.CARGO,
    home ? path.join(home, ".cargo", "bin", exe) : "",
    exe
  ].filter(Boolean);
}

function findCargo() {
  for (const candidate of cargoCandidates()) {
    if (candidate === "cargo" || candidate === "cargo.exe") return candidate;
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // Keep looking.
    }
  }
  return process.platform === "win32" ? "cargo.exe" : "cargo";
}

const cargo = findCargo();
const result = spawnSync(cargo, process.argv.slice(2), {
  cwd: path.join(__dirname, ".."),
  stdio: "inherit",
  shell: false
});

if (result.error) {
  console.error(`Failed to run Cargo at ${cargo}: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
