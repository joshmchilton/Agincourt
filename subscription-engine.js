// Local testing mode: writes campaign emails through the Claude Agent SDK,
// which uses the Claude Code sign-in on this machine (a Claude subscription)
// instead of an API key. Anthropic doesn't allow offering claude.ai login in
// products for other people, so this is for the developer's own testing only.

import { query } from "@anthropic-ai/claude-agent-sdk";

// Subscriptions have tighter rate limits than the API, so run fewer at once.
const MAX_CONCURRENT = 2;
let running = 0;
const waiting = [];

async function withSlot(fn) {
  if (running >= MAX_CONCURRENT) await new Promise((resolve) => waiting.push(resolve));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

export class NotSignedInError extends Error {}

function isNotSignedIn(text) {
  return /not logged in|\/login/i.test(String(text || ""));
}

// Runs one task that returns JSON matching `schema`. Claude may only read
// files in `cwd` (the product's documents) and, when `siteHost` is given,
// fetch pages on that website; every other tool call is denied.
export function runWithSubscription({ system, prompt, cwd, siteHost, schema, effort = "high" }) {
  return withSlot(async () => {
    const tools = ["Read", "Glob"];
    const allowedTools = ["Read", "Glob"];
    if (siteHost) {
      tools.push("WebFetch");
      allowedTools.push(`WebFetch(domain:${siteHost})`, `WebFetch(domain:www.${siteHost})`);
    }

    // Leave any API key out so the subscription sign-in is used, and keep the
    // account's claude.ai connectors (email, calendar, and so on) out of the
    // session entirely.
    const env = { ...process.env, ENABLE_CLAUDEAI_MCP_SERVERS: "false" };
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;

    const q = query({
      prompt,
      options: {
        systemPrompt: system,
        tools,
        allowedTools,
        permissionMode: "dontAsk",
        cwd,
        env,
        settingSources: [],
        mcpServers: {},
        strictMcpConfig: true,
        persistSession: false,
        model: "opus",
        effort,
        maxTurns: 15,
        outputFormat: { type: "json_schema", schema },
      },
    });

    const webFetchIds = new Set();
    let fetchedWebsite = false;
    let result;
    try {
      for await (const message of q) {
        if (message.type === "assistant") {
          for (const block of message.message.content) {
            if (block.type === "tool_use" && block.name === "WebFetch") webFetchIds.add(block.id);
          }
        } else if (message.type === "user" && Array.isArray(message.message.content)) {
          for (const block of message.message.content) {
            if (block.type === "tool_result" && webFetchIds.has(block.tool_use_id) && !block.is_error) fetchedWebsite = true;
          }
        } else if (message.type === "result") {
          result = message;
        }
      }
    } catch (err) {
      // The SDK throws when Claude Code reports an error, including not
      // being signed in.
      if (isNotSignedIn(err?.message)) throw new NotSignedInError("Claude Code isn't signed in on this machine.");
      throw err;
    }

    if (!result) throw new Error("Claude Code ended without a result.");
    if (result.is_error || result.subtype !== "success") {
      if (isNotSignedIn(result.result)) throw new NotSignedInError("Claude Code isn't signed in on this machine.");
      throw new Error(`Claude Code error (${result.subtype}): ${String(result.result || "").slice(0, 300)}`);
    }
    return { output: result.structured_output, fetchedWebsite };
  });
}
