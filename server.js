// Agincourt server: serves the web app and generates product descriptions
// with Claude. The API key stays here, never in the browser.

import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import mammoth from "mammoth";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const MODEL = "claude-opus-5";

const hasCredentials = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const client = hasCredentials ? new Anthropic() : null;

const DESCRIBE_SYSTEM = `You write short product descriptions for a B2B campaign builder. Sales teams read them to understand a product at a glance before building a marketing campaign for it.

From the product information provided, write 2 to 3 sentences (under 70 words) covering what the product does, who it is for, and the main benefit to that buyer. Write plain prose: no headings, bullet points, quotation marks, or superlatives such as "revolutionary" or "best-in-class". Use only facts found in the documents.

If the documents don't contain enough information to describe the product, reply with one sentence saying what is missing.

Reply with the description only.`;

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

const app = express();
app.use(express.json({ limit: "40mb" }));

app.get("/api/status", (req, res) => {
  res.json({ ai: hasCredentials });
});

app.post("/api/describe", async (req, res) => {
  if (!client) {
    return res.status(503).json({ error: "not_configured", message: "No Anthropic API key is set on the server." });
  }

  const files = Array.isArray(req.body?.files) ? req.body.files : [];
  const productName = String(req.body?.productName || "this product");

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
  if (blocks.length === 0) {
    return res.status(422).json({
      error: "unsupported",
      message: "None of the uploaded files could be read. Upload PDF, Word (.docx), or text files.",
      skipped,
    });
  }

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: DESCRIBE_SYSTEM,
      messages: [{
        role: "user",
        content: [...blocks, { type: "text", text: `Write the description for ${productName}.` }],
      }],
    });

    if (response.stop_reason === "refusal") {
      return res.status(422).json({ error: "refused", message: "A description couldn't be generated from these files." });
    }
    const description = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    res.json({ description, skipped });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      res.status(502).json({ error: "auth", message: "The server's Anthropic API key was rejected." });
    } else if (err instanceof Anthropic.RateLimitError) {
      res.status(429).json({ error: "rate_limited", message: "Too many requests. Try again in a minute." });
    } else if (err instanceof Anthropic.BadRequestError) {
      res.status(400).json({ error: "bad_request", message: "Claude couldn't process these files. They may be too large." });
    } else if (err instanceof Anthropic.APIError) {
      console.error(`Anthropic API error ${err.status}:`, err.message);
      res.status(502).json({ error: "api_error", message: "The description service is unavailable. Try again shortly." });
    } else {
      console.error(err);
      res.status(500).json({ error: "server_error", message: "Something went wrong generating the description." });
    }
  }
});

// Serve only the web app's own files, not the server code or .env.
app.use("/css", express.static(path.join(here, "css")));
app.use("/js", express.static(path.join(here, "js")));
app.get("/", (req, res) => res.sendFile(path.join(here, "index.html")));

app.listen(PORT, () => {
  console.log(`Agincourt running at http://localhost:${PORT}`);
  if (!hasCredentials) {
    console.log("No ANTHROPIC_API_KEY set: product descriptions will use the basic fallback. Add a key to .env to enable Claude.");
  }
});
