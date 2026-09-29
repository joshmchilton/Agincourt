// Signs the Agent SDK's bundled Claude Code in to your Claude account, so
// `npm run start:local` can write campaign emails with your subscription.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const scope = path.join(root, "node_modules", "@anthropic-ai");
const binary = process.platform === "win32" ? "claude.exe" : "claude";

const candidates = existsSync(scope)
  ? readdirSync(scope)
      .filter((name) => name.startsWith("claude-agent-sdk-"))
      .map((name) => path.join(scope, name, binary))
      .filter(existsSync)
  : [];

if (candidates.length === 0) {
  console.error("Claude Code wasn't found in node_modules. Run npm install first.");
  process.exit(1);
}

const command = process.argv[2] === "status" ? ["auth", "status"] : ["auth", "login"];
const result = spawnSync(candidates[0], command, { stdio: "inherit" });
process.exit(result.status ?? 1);
