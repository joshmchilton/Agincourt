// Agincourt server: serves the web app and writes campaign emails with
// Claude. The API key stays here, never in the browser.
//
// Two ways to reach Claude:
//   npm start            uses ANTHROPIC_API_KEY from .env (the Claude API)
//   npm run start:local  uses this machine's Claude Code sign-in, for the
//                        developer's own testing (see subscription-engine.js)

import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import mammoth from "mammoth";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as db from "./db.js";
import { NotSignedInError, runWithSubscription } from "./subscription-engine.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const MODEL = "claude-opus-5";

const hasCredentials = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const ENGINE = process.argv.includes("--subscription") ? "subscription" : hasCredentials ? "api" : null;
const client = ENGINE === "api" ? new Anthropic() : null;

// In subscription mode, product documents are saved here so Claude Code can
// read them. The folder is ignored by git.
const CACHE_DIR = path.join(here, ".agincourt-cache", "products");
const NOT_CONFIGURED = { error: "not_configured", message: "Claude isn't connected on the server." };

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

// ---------- Product descriptions ----------

const DESCRIBE_SYSTEM = `You write the short product description shown on a product card in a B2B campaign builder. Sales teams read it to understand the product at a glance.

From the product documentation, write one short sentence, or two very short ones: no more than 16 words and 110 characters in total, so it fits in two or three lines of a narrow card. Say what the product does and who it's for, and include the main benefit if it fits. Use only facts from the documentation. Write plain prose: no headings, bullet points, quotation marks, or superlatives such as "revolutionary" or "best-in-class".`;

// About three lines on a product card when three products sit side by side.
const DESCRIPTION_TARGET_CHARS = 110;
const DESCRIPTION_MAX_CHARS = 125;

const DESCRIPTION_SCHEMA = {
  type: "object",
  properties: { description: { type: "string" } },
  required: ["description"],
  additionalProperties: false,
};

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

// Product documents, loaded from Supabase and kept in memory per product so
// each contact's request reuses them (and the prompt cache).
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
  res.json({ ai: Boolean(ENGINE), engine: ENGINE, database: db.dbConfigured });
});

// ---------- Data routes (Supabase) ----------

const DB_NOT_CONFIGURED = {
  error: "db_not_configured",
  message: "The database isn't connected. Add SUPABASE_URL and SUPABASE_SECRET_KEY to .env and restart the server.",
};

// Wraps a data route: checks the database is configured and turns thrown
// errors into a JSON response.
function dataRoute(handler) {
  return async (req, res) => {
    if (!db.dbConfigured) return res.status(503).json(DB_NOT_CONFIGURED);
    try {
      await handler(req, res);
    } catch (err) {
      console.error(`${req.method} ${req.path} failed:`, err.message || err);
      res.status(500).json({ error: "db_error", message: "Your change couldn't be saved. Try again." });
    }
  };
}

const validProductId = (id) => /^p\d+$/.test(id);
const validContactId = (id) => /^\d+$/.test(id);

app.get("/api/state", dataRoute(async (req, res) => {
  res.json(await db.loadState());
}));

app.post("/api/products", dataRoute(async (req, res) => {
  res.status(201).json(await db.createProduct());
}));

app.patch("/api/products/:id", dataRoute(async (req, res) => {
  if (!validProductId(req.params.id)) return res.status(400).json({ error: "bad_product", message: "Unknown product." });
  const product = await db.updateProduct(req.params.id, req.body || {});
  if (!product) return res.status(404).json({ error: "not_found", message: "That product no longer exists." });
  res.json(product);
}));

app.delete("/api/products/:id", dataRoute(async (req, res) => {
  if (!validProductId(req.params.id)) return res.status(400).json({ error: "bad_product", message: "Unknown product." });
  await db.deleteProduct(req.params.id);
  productDocs.delete(req.params.id);
  res.status(204).end();
}));

app.post("/api/products/:id/documents", dataRoute(async (req, res) => {
  if (!validProductId(req.params.id)) return res.status(400).json({ error: "bad_product", message: "Unknown product." });
  const files = Array.isArray(req.body?.files) ? req.body.files : [];
  res.status(201).json(await db.addDocuments(req.params.id, files));
}));

app.delete("/api/products/:id/documents/:docId", dataRoute(async (req, res) => {
  if (!validProductId(req.params.id)) return res.status(400).json({ error: "bad_product", message: "Unknown product." });
  await db.deleteDocument(req.params.id, req.params.docId);
  res.status(204).end();
}));

app.post("/api/contacts", dataRoute(async (req, res) => {
  res.status(201).json(await db.createContact(req.body || {}));
}));

app.patch("/api/contacts/:id", dataRoute(async (req, res) => {
  if (!validContactId(req.params.id)) return res.status(400).json({ error: "bad_contact", message: "Unknown contact." });
  const contact = await db.updateContact(Number(req.params.id), req.body || {});
  if (!contact) return res.status(404).json({ error: "not_found", message: "That contact no longer exists." });
  res.json(contact);
}));

app.delete("/api/contacts/:id", dataRoute(async (req, res) => {
  if (!validContactId(req.params.id)) return res.status(400).json({ error: "bad_contact", message: "Unknown contact." });
  await db.deleteContact(Number(req.params.id));
  res.status(204).end();
}));

app.post("/api/contacts/import", dataRoute(async (req, res) => {
  const contacts = Array.isArray(req.body?.contacts) ? req.body.contacts : [];
  const mode = req.body?.mode === "replace" ? "replace" : "add";
  res.status(201).json(await db.importContacts(contacts, mode));
}));

// Writes the product's description from its uploaded documents and saves it.
app.post("/api/products/:id/describe", async (req, res) => {
  if (!ENGINE) return res.status(503).json(NOT_CONFIGURED);
  if (!db.dbConfigured) return res.status(503).json(DB_NOT_CONFIGURED);
  if (!validProductId(req.params.id)) return res.status(400).json({ error: "bad_product", message: "Unknown product." });

  let product;
  let stored;
  try {
    product = await db.getProduct(req.params.id);
    if (!product) return res.status(404).json({ error: "not_found", message: "That product no longer exists." });
    stored = await productContext(product);
  } catch (err) {
    console.error("Couldn't load product documents:", err.message || err);
    return res.status(500).json({ error: "db_error", message: "The product documents couldn't be loaded. Try again." });
  }
  if (stored.blocks.length === 0) {
    return res.status(422).json({ error: "no_documents", message: "Upload product information to write a description." });
  }

  // One attempt; `feedback` asks for a shorter rewrite of a previous draft.
  async function writeDescription(feedback = "") {
    const ask = `Write the description for ${product.name}.${feedback ? ` ${feedback}` : ""}`;
    if (ENGINE === "subscription") {
      const { output } = await runWithSubscription({
        system: DESCRIBE_SYSTEM,
        prompt: `${ask} The product documentation is in these files in your working directory; read them first:\n${stored.fileNames.map((n) => `- ${n}`).join("\n")}`,
        cwd: stored.dir,
        schema: DESCRIPTION_SCHEMA,
        effort: "low",
      });
      return String(output?.description || "").trim();
    }
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "low", format: { type: "json_schema", schema: DESCRIPTION_SCHEMA } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: DESCRIBE_SYSTEM,
      messages: [{ role: "user", content: [...stored.blocks, { type: "text", text: ask }] }],
    });
    if (response.stop_reason === "refusal") return null;
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    return String(parseEmail(text)?.description || "").trim();
  }

  let description;
  try {
    description = await writeDescription();
    // Keep it to two or three lines on the card: one shorter rewrite if needed.
    if (description && description.length > DESCRIPTION_MAX_CHARS) {
      const shorter = await writeDescription(
        `Your previous draft was ${description.length} characters: "${description}". Rewrite it in no more than ${DESCRIPTION_TARGET_CHARS} characters.`
      );
      if (shorter && shorter.length < description.length) description = shorter;
    }
    if (description === null) {
      return res.status(422).json({ error: "refused", message: "A description couldn't be written from these documents." });
    }
  } catch (err) {
    if (err instanceof NotSignedInError) {
      return res.status(503).json({ error: "not_signed_in", message: "Claude Code isn't signed in on this machine. Run: npm run login" });
    }
    if (err instanceof Anthropic.APIError) return sendApiError(res, err, "description");
    console.error(err);
    return res.status(502).json({ error: "describe_error", message: "The description couldn't be written. Try again." });
  }

  if (!description) return res.status(502).json({ error: "bad_output", message: "The description couldn't be written. Try again." });
  try {
    res.json(await db.updateProduct(product.id, { description }));
  } catch (err) {
    console.error("Couldn't save description:", err.message || err);
    res.status(500).json({ error: "db_error", message: "The description was written but couldn't be saved. Try again." });
  }
});

// ---------- Campaign emails ----------

// Loads a product's documents from Supabase once per set of documents, and
// in subscription mode also saves them to disk for Claude Code to read.
function productContext(product) {
  const signature = product.documents.map((d) => d.id).join(",");
  const cached = productDocs.get(product.id);
  if (cached && cached.signature === signature) return cached.promise;

  const promise = (async () => {
    const files = await db.downloadDocuments(product.id);
    const { blocks } = await toDocumentBlocks(files);
    let dir = null;
    let fileNames = [];
    if (ENGINE === "subscription") {
      dir = path.join(CACHE_DIR, product.id);
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      fileNames = await saveDocuments(dir, blocks);
    }
    return { blocks, dir, fileNames };
  })();
  promise.catch(() => productDocs.delete(product.id));
  productDocs.set(product.id, { signature, promise });
  return promise;
}

// Writes document blocks to disk as PDF or text files for Claude Code to read.
async function saveDocuments(dir, blocks) {
  const names = [];
  for (const [i, block] of blocks.entries()) {
    const base = `${i + 1}-${String(block.title).replace(/[^\w.-]+/g, "_")}`;
    if (block.source.type === "base64") {
      const name = /\.pdf$/i.test(base) ? base : `${base}.pdf`;
      await writeFile(path.join(dir, name), Buffer.from(block.source.data, "base64"));
      names.push(name);
    } else {
      const name = `${base.replace(/\.[^.]+$/, "")}.txt`;
      await writeFile(path.join(dir, name), block.source.data, "utf8");
      names.push(name);
    }
  }
  return names;
}

// Writes one contact's email using the campaign-email skill.
app.post("/api/campaign-email", async (req, res) => {
  if (!ENGINE) return res.status(503).json(NOT_CONFIGURED);

  if (!db.dbConfigured) return res.status(503).json(DB_NOT_CONFIGURED);

  const productId = String(req.body?.productId || "");
  const contact = req.body?.contact || {};
  let product;
  let stored;
  try {
    product = validProductId(productId) ? await db.getProduct(productId) : null;
    if (!product) return res.status(404).json({ error: "not_found", message: "That product no longer exists." });
    stored = await productContext(product);
  } catch (err) {
    console.error("Couldn't load product documents:", err.message || err);
    return res.status(500).json({ error: "db_error", message: "The product documents couldn't be loaded. Try again." });
  }
  const docs = stored.blocks;
  if (docs.length === 0 && !product.description) {
    return res.status(422).json({ error: "no_product_info", message: "Upload product information before creating a campaign." });
  }

  const site = companyUrl(contact.company_website || contact.website);
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

  if (ENGINE === "subscription") {
    const productLines = [
      `Product name: ${product.name || "(not given)"}`,
      `Product description: ${product.description || "(not given)"}`,
      `Product page URL: ${product.pageUrl || "(not given)"}`,
    ];
    const docList = stored.fileNames.length
      ? `The product documentation is in these files in your working directory. Read all of them before writing:\n${stored.fileNames.map((n) => `- ${n}`).join("\n")}`
      : "No product documentation was uploaded; rely on the description.";
    const prompt = [...productLines, "", docList, "", contactText].join("\n");
    try {
      const { output: email, fetchedWebsite } = await runWithSubscription({
        system: await loadSkill(),
        prompt,
        cwd: stored.dir,
        siteHost: site ? site.hostname.replace(/^www\./, "") : null,
        schema: EMAIL_SCHEMA,
      });
      if (!email || !email.subject) {
        return res.status(502).json({ error: "bad_output", message: "Claude's reply couldn't be read. Try again." });
      }
      return res.json({ email, fetchedWebsite });
    } catch (err) {
      if (err instanceof NotSignedInError) {
        return res.status(503).json({ error: "not_signed_in", message: "Claude Code isn't signed in on this machine. Run: npm run login" });
      }
      console.error(err);
      return res.status(502).json({ error: "subscription_error", message: "Claude couldn't write this email. Try again." });
    }
  }

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
  if (ENGINE === "subscription") {
    console.log("Using this machine's Claude Code sign-in (local testing only). If emails fail, run: npm run login");
  } else if (!ENGINE) {
    console.log("No ANTHROPIC_API_KEY set: campaign emails will use the basic template. Add a key to .env, or run npm run start:local to test with your Claude subscription.");
  }
});
