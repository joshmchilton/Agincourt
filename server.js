// Agincourt server: serves the web app and writes campaign emails with
// Claude. The API key stays here, never in the browser.

import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import mammoth from "mammoth";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const MODEL = "claude-opus-5";

const hasCredentials = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const client = hasCredentials ? new Anthropic() : null;

const TEXT_EXTENSIONS = /\.(txt|md|csv|html?|json)$/i;

// Turns one uploaded file into a Claude document block, or null if the
// file type can't be read.
async function toDocumentBlock(file) {
  const buffer = Buffer.from(file.data, "base64");
  const name = String(file.name || "file");

  if (/\.pdf$/i.test(name) || file.type === "application/pdf") {
    return {
      type: "document",
      title: name,
      source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") },
    };
  }

  let text = null;
  if (/\.docx$/i.test(name)) {
    text = (await mammoth.extractRawText({ buffer })).value;
  } else if (TEXT_EXTENSIONS.test(name) || String(file.type).startsWith("text/")) {
    text = buffer.toString("utf8");
  }
  if (!text || !text.trim()) return null;
  return { type: "document", title: name, source: { type: "text", media_type: "text/plain", data: text } };
}

async function toDocumentBlocks(files) {
  const blocks = [];
  const skipped = [];
  for (const file of files) {
    try {
      const block = await toDocumentBlock(file);
      if (block) blocks.push(block);
      else skipped.push(file.name);
    } catch (err) {
      console.error(`Couldn't read ${file.name}:`, err.message);
      skipped.push(file.name);
    }
  }
  return { blocks, skipped };
}

// Maps an Anthropic SDK error to an HTTP response for the browser.
function sendApiError(res, err, what) {
  if (err instanceof Anthropic.AuthenticationError) {
    res.status(502).json({ error: "auth", message: "The server's Anthropic API key was rejected." });
  } else if (err instanceof Anthropic.RateLimitError) {
    res.status(429).json({ error: "rate_limited", message: "Too many requests. Try again in a minute." });
  } else if (err instanceof Anthropic.BadRequestError) {
    console.error(`Anthropic bad request (${what}):`, err.message);
    res.status(400).json({ error: "bad_request", message: `Claude couldn't process the ${what} request. The files may be too large.` });
  } else if (err instanceof Anthropic.APIError) {
    console.error(`Anthropic API error ${err.status} (${what}):`, err.message);
    res.status(502).json({ error: "api_error", message: "The Claude service is unavailable. Try again shortly." });
  } else {
    console.error(err);
    res.status(500).json({ error: "server_error", message: `Something went wrong with the ${what}.` });
  }
}

// ---------- Campaign email skill ----------

const SKILL_PATH = path.join(here, "skills", "campaign-email", "SKILL.md");

// Read on each request so edits to the skill apply without a restart.
async function loadSkill() {
  const text = await readFile(SKILL_PATH, "utf8");
  return text.replace(/^---[\s\S]*?---\s*/, "").trim();
}

const EMAIL_SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string" },
    greeting: { type: "string" },
    paragraphs: { type: "array", items: { type: "string" } },
    learn_more_url: { type: "string" },
    call_to_action: { type: "string" },
    research_notes: { type: "string" },
    roi_basis: { type: "string" },
  },
  required: ["subject", "greeting", "paragraphs", "learn_more_url", "call_to_action", "research_notes", "roi_basis"],
  additionalProperties: false,
};

// Product documents, kept in memory per product so each contact's request
// reuses them (and the prompt cache) instead of re-uploading.
const productDocs = new Map();

function companyUrl(site) {
  const value = String(site || "").trim();
  if (!value) return null;
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
}

function parseEmail(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  }
}

const app = express();
app.use(express.json({ limit: "40mb" }));

app.get("/api/status", (req, res) => {
  res.json({ ai: hasCredentials });
});

// Stores a product's documents for the campaign that's about to run.
app.post("/api/products/:id/documents", async (req, res) => {
  if (!client) {
    return res.status(503).json({ error: "not_configured", message: "No Anthropic API key is set on the server." });
  }
  const files = Array.isArray(req.body?.files) ? req.body.files : [];
  const { blocks, skipped } = await toDocumentBlocks(files);
  productDocs.set(req.params.id, blocks);
  res.json({ documents: blocks.length, skipped });
});

// Writes one contact's email using the campaign-email skill.
app.post("/api/campaign-email", async (req, res) => {
  if (!client) {
    return res.status(503).json({ error: "not_configured", message: "No Anthropic API key is set on the server." });
  }

  const productId = String(req.body?.productId || "");
  const product = req.body?.product || {};
  const contact = req.body?.contact || {};
  const docs = productDocs.get(productId);
  if (!docs) {
    return res.status(409).json({ error: "no_documents", message: "Product documents haven't been sent for this campaign." });
  }
  if (docs.length === 0 && !product.description) {
    return res.status(422).json({ error: "no_product_info", message: "Upload product information before creating a campaign." });
  }

  const site = companyUrl(contact.website);
  const productText = [
    `Product name: ${product.name || "(not given)"}`,
    `Product description: ${product.description || "(not given)"}`,
    `Product page URL: ${product.pageUrl || "(not given)"}`,
    docs.length ? "The product documentation follows." : "No product documentation was uploaded; rely on the description.",
  ].join("\n");

  // Product text and documents are identical for every contact in the
  // campaign, so they sit before the cache breakpoint; the contact follows.
  const productBlocks = [{ type: "text", text: productText }, ...docs.map((d) => ({ ...d }))];
  productBlocks[productBlocks.length - 1].cache_control = { type: "ephemeral" };

  const contactText = [
    "Write the email for this contact.",
    "",
    "Contact record:",
    JSON.stringify(contact, null, 2),
    "",
    site ? `Company website: ${site.href}` : "No company website is recorded for this contact.",
  ].join("\n");

  const tools = site
    ? [{
        type: "web_fetch_20260209",
        name: "web_fetch",
        max_uses: 3,
        allowed_domains: [site.hostname.replace(/^www\./, "")],
      }]
    : [];

  try {
    const system = await loadSkill();
    const messages = [{ role: "user", content: [...productBlocks, { type: "text", text: contactText }] }];
    let response;
    for (let turn = 0; turn < 5; turn++) {
      response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        // High effort: the ROI example needs careful reading and arithmetic.
        output_config: { effort: "high", format: { type: "json_schema", schema: EMAIL_SCHEMA } },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system,
        ...(tools.length ? { tools } : {}),
        messages,
      });
      if (response.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: response.content });
    }

    if (response.stop_reason === "refusal") {
      return res.status(422).json({ error: "refused", message: "An email couldn't be written for this contact." });
    }
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const email = text ? parseEmail(text) : null;
    if (!email || !email.subject) {
      console.error("Unexpected email output:", response.stop_reason, text.slice(0, 500));
      return res.status(502).json({ error: "bad_output", message: "Claude's reply couldn't be read. Try again." });
    }
    const allBlocks = [...messages.slice(1).flatMap((m) => m.content), ...response.content];
    const fetched = allBlocks.some((b) => b.type === "web_fetch_tool_result" && !b.content?.error_code);
    res.json({ email, fetchedWebsite: fetched });
  } catch (err) {
    sendApiError(res, err, "campaign email");
  }
});

// Serve only the web app's own files, not the server code or .env.
app.use("/css", express.static(path.join(here, "css")));
app.use("/js", express.static(path.join(here, "js")));
app.get("/", (req, res) => res.sendFile(path.join(here, "index.html")));

app.listen(PORT, () => {
  console.log(`Agincourt running at http://localhost:${PORT}`);
  if (!hasCredentials) {
    console.log("No ANTHROPIC_API_KEY set: campaign emails will use the basic template. Add a key to .env to enable Claude.");
  }
});
