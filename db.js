// Supabase data layer. Products, their documents, and contacts are stored in
// the Supabase project; documents themselves live in a private Storage
// bucket. Uses the secret key, so it must only ever run on the server.

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "product-documents";

export const dbConfigured = Boolean(url && key);
const supabase = dbConfigured
  ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

const CONTACT_FIELDS = ["name", "role", "company", "website", "employees", "industry", "email", "phone"];

// Throws the Supabase error, if any, and returns the data.
function check({ data, error }) {
  if (error) throw error;
  return data;
}

function contactFromRow(row) {
  const contact = { id: Number(row.id), products: row.products || [], extra: row.extra || {} };
  CONTACT_FIELDS.forEach((f) => { contact[f] = row[f] ?? ""; });
  return contact;
}

function contactToRow(contact) {
  const row = {};
  CONTACT_FIELDS.forEach((f) => { row[f] = contact[f] == null ? "" : String(contact[f]).trim(); });
  row.products = Array.isArray(contact.products) ? contact.products.map(String) : [];
  row.extra = contact.extra && typeof contact.extra === "object" ? contact.extra : {};
  return row;
}

function documentFromRow(row) {
  return { id: row.id, name: row.file_name, size: Number(row.size_bytes), type: row.content_type };
}

function productFromRow(row, documents = []) {
  return {
    id: row.id,
    name: row.name,
    pageUrl: row.page_url,
    description: row.description,
    documents: documents.filter((d) => d.product_id === row.id).map(documentFromRow),
  };
}

export async function loadState() {
  const [products, documents, contacts] = await Promise.all([
    supabase.from("products").select("*").order("position").order("id").then(check),
    supabase.from("product_documents").select("*").order("created_at").then(check),
    supabase.from("contacts").select("*").order("id").then(check),
  ]);
  return {
    products: products.map((p) => productFromRow(p, documents)),
    contacts: contacts.map(contactFromRow),
  };
}

// ---------- Products ----------

export async function getProduct(id) {
  const row = check(await supabase.from("products").select("*").eq("id", id).maybeSingle());
  if (!row) return null;
  const documents = check(await supabase.from("product_documents").select("*").eq("product_id", id).order("created_at"));
  return productFromRow(row, documents);
}

export async function createProduct() {
  const existing = check(await supabase.from("products").select("id, position"));
  const nextNumber = existing.reduce((max, p) => Math.max(max, Number(p.id.slice(1)) || 0), 0) + 1;
  const position = existing.reduce((max, p) => Math.max(max, p.position), -1) + 1;
  const row = check(await supabase
    .from("products")
    .insert({ id: `p${nextNumber}`, name: `Product ${existing.length + 1}`, position })
    .select()
    .single());
  return productFromRow(row);
}

export async function updateProduct(id, fields) {
  const changes = {};
  if (typeof fields.name === "string" && fields.name.trim()) changes.name = fields.name.trim();
  if (typeof fields.pageUrl === "string") changes.page_url = fields.pageUrl.trim();
  if (typeof fields.description === "string") changes.description = fields.description;
  const row = check(await supabase.from("products").update(changes).eq("id", id).select().maybeSingle());
  return row ? getProduct(id) : null;
}

// Removes the product, its documents, and its tick from every contact.
export async function deleteProduct(id) {
  const documents = check(await supabase.from("product_documents").select("storage_path").eq("product_id", id));
  if (documents.length) check(await supabase.storage.from(BUCKET).remove(documents.map((d) => d.storage_path)));

  const buyers = check(await supabase.from("contacts").select("id, products").contains("products", [id]));
  for (const c of buyers) {
    check(await supabase.from("contacts").update({ products: c.products.filter((p) => p !== id) }).eq("id", c.id));
  }
  check(await supabase.from("products").delete().eq("id", id));
}

// ---------- Product documents ----------

// files: [{ name, type, data (base64) }]
export async function addDocuments(productId, files) {
  const added = [];
  for (const file of files) {
    const name = String(file.name || "document");
    const buffer = Buffer.from(String(file.data || ""), "base64");
    const storagePath = `${productId}/${randomUUID()}-${name.replace(/[^\w.-]+/g, "_")}`;
    const contentType = file.type || "application/octet-stream";
    check(await supabase.storage.from(BUCKET).upload(storagePath, buffer, { contentType }));
    const row = check(await supabase
      .from("product_documents")
      .insert({ product_id: productId, file_name: name, storage_path: storagePath, content_type: contentType, size_bytes: buffer.length })
      .select()
      .single());
    added.push(documentFromRow(row));
  }
  return added;
}

export async function deleteDocument(productId, documentId) {
  const row = check(await supabase
    .from("product_documents")
    .select("storage_path")
    .eq("id", documentId)
    .eq("product_id", productId)
    .maybeSingle());
  if (!row) return false;
  check(await supabase.storage.from(BUCKET).remove([row.storage_path]));
  check(await supabase.from("product_documents").delete().eq("id", documentId));
  return true;
}

// Returns the product's documents with their contents, for the email skill.
export async function downloadDocuments(productId) {
  const rows = check(await supabase.from("product_documents").select("*").eq("product_id", productId).order("created_at"));
  const files = [];
  for (const row of rows) {
    const blob = check(await supabase.storage.from(BUCKET).download(row.storage_path));
    files.push({
      id: row.id,
      name: row.file_name,
      type: row.content_type,
      data: Buffer.from(await blob.arrayBuffer()).toString("base64"),
    });
  }
  return files;
}

// ---------- Contacts ----------

export async function createContact(contact) {
  const row = check(await supabase.from("contacts").insert(contactToRow(contact)).select().single());
  return contactFromRow(row);
}

export async function updateContact(id, contact) {
  const changes = contactToRow(contact);
  // Editing in the app doesn't show extra columns, so keep the stored ones
  // unless new ones are sent.
  if (!contact.extra) delete changes.extra;
  const row = check(await supabase.from("contacts").update(changes).eq("id", id).select().maybeSingle());
  return row ? contactFromRow(row) : null;
}

export async function deleteContact(id) {
  check(await supabase.from("contacts").delete().eq("id", id));
}

export async function productNames() {
  const rows = check(await supabase.from("products").select("id, name"));
  return Object.fromEntries(rows.map((r) => [r.id, r.name]));
}

// ---------- Campaigns and qualified leads ----------

// Records a launched campaign and one engagement row per recipient.
// Engagement stays at "not opened" until email tracking reports otherwise.
export async function createCampaign(productId, name, contactIds) {
  const campaign = check(await supabase
    .from("campaigns")
    .insert({ product_id: productId, name })
    .select()
    .single());
  const rows = contactIds.map((contactId) => ({ campaign_id: campaign.id, contact_id: contactId }));
  for (let i = 0; i < rows.length; i += 500) check(await supabase.from("campaign_engagements").insert(rows.slice(i, i + 500)));
  return { id: Number(campaign.id), name: campaign.name, recipients: rows.length };
}

function leadFromRow(row) {
  return {
    id: Number(row.id),
    campaign: {
      id: Number(row.campaigns.id),
      name: row.campaigns.name,
      productId: row.campaigns.product_id,
      launchedAt: row.campaigns.launched_at,
      isDemo: row.campaigns.is_demo,
    },
    contact: contactFromRow(row.contacts),
    openedAt: row.opened_at,
    readSeconds: row.read_seconds,
    clickedThrough: row.clicked_through,
    websiteSeconds: row.website_seconds,
    hasBrief: Array.isArray(row.lead_briefs) ? row.lead_briefs.length > 0 : Boolean(row.lead_briefs),
  };
}

const LEAD_SELECT = "*, campaigns(*), contacts(*), lead_briefs(engagement_id)";

// Qualified leads are recipients who at least opened the email.
export async function listLeads() {
  const [rows, campaigns] = await Promise.all([
    supabase.from("campaign_engagements").select(LEAD_SELECT).eq("email_opened", true).order("opened_at", { ascending: false }).then(check),
    supabase.from("campaigns").select("id, name, product_id, launched_at, is_demo, campaign_engagements(email_opened, clicked_through)").order("launched_at", { ascending: false }).then(check),
  ]);
  return {
    leads: rows.map(leadFromRow),
    campaigns: campaigns.map((c) => ({
      id: Number(c.id),
      name: c.name,
      productId: c.product_id,
      launchedAt: c.launched_at,
      isDemo: c.is_demo,
      sent: c.campaign_engagements.length,
      opened: c.campaign_engagements.filter((e) => e.email_opened).length,
      clicked: c.campaign_engagements.filter((e) => e.clicked_through).length,
    })),
  };
}

export async function getLead(engagementId) {
  const row = check(await supabase.from("campaign_engagements").select(LEAD_SELECT).eq("id", engagementId).maybeSingle());
  return row && row.email_opened ? leadFromRow(row) : null;
}

export async function getBrief(engagementId) {
  const row = check(await supabase.from("lead_briefs").select("brief, created_at").eq("engagement_id", engagementId).maybeSingle());
  return row ? { ...row.brief, writtenAt: row.created_at } : null;
}

export async function saveBrief(engagementId, brief) {
  const row = check(await supabase
    .from("lead_briefs")
    .upsert({ engagement_id: engagementId, brief, created_at: new Date().toISOString() })
    .select("brief, created_at")
    .single());
  return { ...row.brief, writtenAt: row.created_at };
}

// mode "replace" removes every existing contact first.
export async function importContacts(contacts, mode) {
  if (mode === "replace") check(await supabase.from("contacts").delete().gte("id", 0));
  const rows = contacts.map(contactToRow);
  const inserted = [];
  for (let i = 0; i < rows.length; i += 500) {
    inserted.push(...check(await supabase.from("contacts").insert(rows.slice(i, i + 500)).select()));
  }
  return inserted.map(contactFromRow);
}
