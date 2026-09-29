(function () {
  "use strict";

  const data = window.AGINCOURT_DATA;
  const app = document.getElementById("app");
  const NAMES_KEY = "agincourt.productNames";
  const CUSTOMERS_KEY = "agincourt.opportunities";

  const state = {
    products: data.products.map((p) => ({ ...p, pageUrl: "", files: [], description: "" })),
    customers: loadCustomers(),
    // Active campaign: { productId, selected: Set<customerId>, launched: bool }
    campaign: null,
    search: "",
  };

  loadProductNames();

  // ---------- Helpers ----------

  function esc(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function productById(id) {
    return state.products.find((p) => p.id === id);
  }

  // Saved per product as { name, pageUrl }; older saves hold just the name.
  function loadProductNames() {
    try {
      const saved = JSON.parse(localStorage.getItem(NAMES_KEY) || "{}");
      state.products.forEach((p) => {
        const entry = saved[p.id];
        if (typeof entry === "string") p.name = entry;
        else if (entry) {
          if (entry.name) p.name = entry.name;
          p.pageUrl = entry.pageUrl || "";
        }
      });
    } catch (e) { /* storage unavailable */ }
  }

  function loadCustomers() {
    try {
      const saved = JSON.parse(localStorage.getItem(CUSTOMERS_KEY));
      if (Array.isArray(saved)) return saved;
    } catch (e) { /* storage unavailable */ }
    return data.customers.slice();
  }

  function saveCustomers() {
    try {
      localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(state.customers));
    } catch (e) { /* storage unavailable */ }
  }

  function nextCustomerId() {
    return state.customers.reduce((max, c) => Math.max(max, c.id), 0) + 1;
  }

  function formatEmployees(value) {
    if (value === "" || value == null) return "";
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString("en-GB") : String(value);
  }

  function websiteHref(site) {
    return /^https?:\/\//i.test(site) ? site : "https://" + site;
  }

  function saveProductNames() {
    try {
      const names = {};
      state.products.forEach((p) => { names[p.id] = { name: p.name, pageUrl: p.pageUrl || "" }; });
      localStorage.setItem(NAMES_KEY, JSON.stringify(names));
    } catch (e) { /* storage unavailable */ }
  }

  // ---------- Description generation ----------
  // Uploaded files go to the server, which asks Claude for a description.
  // If the server has no API key (or isn't running), a basic summary of any
  // text files is used instead.

  const TEXT_TYPES = /\.(txt|md|csv|html?|json)$/i;

  function readAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function describeProduct(p) {
    const requestId = (p.requestId || 0) + 1;
    p.requestId = requestId;
    p.descriptionNote = "";

    if (p.files.length === 0) {
      p.description = "";
      p.descriptionStatus = "idle";
      return refreshCampaigns();
    }

    p.descriptionStatus = "generating";
    refreshCampaigns();

    let result;
    try {
      const files = await Promise.all(p.files.map(async (f) => ({
        name: f.name,
        type: f.file.type,
        data: await readAsBase64(f.file),
      })));
      const res = await fetch("/api/describe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productName: p.name, files }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) result = { description: body.description, skipped: body.skipped || [] };
      else if (res.status === 503 || res.status === 404 || res.status === 501) result = { fallback: true };
      else result = { error: body.message || "The description couldn't be generated." };
    } catch (e) {
      result = { fallback: true };
    }

    if (p.requestId !== requestId) return; // a newer upload has taken over

    if (result.fallback) {
      p.description = await buildLocalDescription(p);
      p.descriptionStatus = "fallback";
      p.descriptionNote = p.description
        ? "Basic summary. Connect Claude to generate descriptions from PDFs and Word files."
        : "Connect Claude to generate a description from these files.";
    } else if (result.error) {
      p.descriptionStatus = "error";
      p.descriptionNote = result.error;
    } else {
      p.description = result.description;
      p.descriptionStatus = "done";
      if (result.skipped.length) p.descriptionNote = `Couldn't read: ${result.skipped.join(", ")}.`;
    }
    refreshCampaigns();
  }

  function refreshCampaigns() {
    if ((location.hash.replace("#", "") || "campaigns") === "campaigns") renderCampaigns();
  }

  async function buildLocalDescription(product) {
    if (product.files.length === 0) return "";
    const textFiles = product.files.filter((f) => TEXT_TYPES.test(f.name));
    for (const f of textFiles) {
      const text = (await f.file.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (text) {
        const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
        let summary = sentences.slice(0, 2).join(" ").trim();
        if (summary.length > 240) summary = summary.slice(0, 237).trimEnd() + "…";
        return summary;
      }
    }
    return "";
  }

  // ---------- Marketing content generation ----------
  // Emails are written by the campaign-email skill on the server
  // (skills/campaign-email/SKILL.md). This template is only used when the
  // server has no Anthropic API key.

  function roleAngle(role) {
    if (/financ|CFO|controller|procurement/i.test(role)) return "keeping costs predictable and proving the return on every investment matters";
    if (/\b(IT|CTO)\b|technolog|systems|digital/.test(role)) return "finding tools that integrate cleanly and stay secure matters";
    if (/operations/i.test(role)) return "removing manual steps so your team gets more done matters";
    if (/sales|commercial|marketing|customer/i.test(role)) return "helping your team win and keep more customers matters";
    if (/chief executive|managing director|CEO/i.test(role)) return "growing the business without adding overhead matters";
    return "making day-to-day work simpler matters";
  }

  function templateEmail(contact, product) {
    const first = (contact.name || "").split(" ")[0] || "there";
    const role = contact.role || "";
    const company = contact.company || "your team";
    const productLine = product.description
      ? `${product.name} is built for exactly that. ${product.description}`
      : `${product.name} is built to help with exactly that.`;
    const opener = role
      ? `As ${role} at ${company}, I imagine ${roleAngle(role)} to you.`
      : `I imagine ${roleAngle(role)} to ${company}.`;
    return {
      subject: contact.company ? `${product.name} for ${contact.company}` : product.name,
      greeting: `Hi ${first},`,
      paragraphs: [opener, productLine],
      learn_more_url: product.pageUrl || "",
      call_to_action: `Would a 15-minute call next week be useful to see how it would fit ${company}?`,
      research_notes: "",
    };
  }

  function emailPlainText(email) {
    const parts = [email.greeting, ...email.paragraphs];
    if (email.learn_more_url) parts.push(`Learn more: ${email.learn_more_url}`);
    parts.push(email.call_to_action);
    return parts.filter(Boolean).join("\n\n");
  }

  // ---------- Campaign email writing ----------
  // Sends the product's documents to the server once, then asks the skill
  // for each selected contact's email, a few at a time.

  const EMAIL_CONCURRENCY = 4;

  async function postJson(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { res, body: await res.json().catch(() => ({})) };
  }

  async function syncProductDocuments(campaign, product) {
    try {
      const files = await Promise.all(product.files.map(async (f) => ({
        name: f.name,
        type: f.file.type,
        data: await readAsBase64(f.file),
      })));
      const { res } = await postJson(`/api/products/${product.id}/documents`, { files });
      if (res.ok) return "ai";
      return "template"; // no API key on the server
    } catch (e) {
      return "template"; // server not reachable
    }
  }

  function contactForSkill(c) {
    const contact = {
      name: c.name,
      job_role: c.role,
      company: c.company,
      company_website: c.website,
      employees: c.employees,
      industry: c.industry,
      buys_from_seller: c.products.map((id) => productById(id)?.name).filter(Boolean),
    };
    if (c.extra && Object.keys(c.extra).length) contact.additional_information = c.extra;
    return contact;
  }

  async function writeEmail(campaign, product, contact) {
    const entry = campaign.emails.get(contact.id);
    entry.status = "writing";
    updateEmailCard(contact.id);

    const payload = {
      productId: product.id,
      product: { name: product.name, description: product.description, pageUrl: product.pageUrl },
      contact: contactForSkill(contact),
    };
    try {
      let { res, body } = await postJson("/api/campaign-email", payload);
      if (res.status === 409) {
        // Server restarted and lost the documents: send them again once.
        await syncProductDocuments(campaign, product);
        ({ res, body } = await postJson("/api/campaign-email", payload));
      }
      if (res.ok) {
        entry.status = "done";
        entry.email = body.email;
        entry.fetchedWebsite = body.fetchedWebsite;
      } else {
        entry.status = "error";
        entry.error = body.message || "This email couldn't be written.";
      }
    } catch (e) {
      entry.status = "error";
      entry.error = "The server couldn't be reached.";
    }
    updateEmailCard(contact.id);
  }

  async function runEmailWriting() {
    const campaign = state.campaign;
    if (!campaign || campaign.running) return;
    campaign.running = true;
    const product = productById(campaign.productId);

    let changed = false;
    if (!campaign.mode) {
      campaign.mode = await syncProductDocuments(campaign, product);
      if (state.campaign !== campaign) return;
      if (location.hash === "#preview") renderPreview();
      changed = true;
    }

    const queue = selectedContacts().filter((c) => {
      const entry = campaign.emails.get(c.id);
      return !entry || entry.status === "pending";
    });
    if (queue.length) changed = true;
    queue.forEach((c) => {
      if (campaign.mode === "template") {
        campaign.emails.set(c.id, { status: "done", email: templateEmail(c, product), template: true });
      } else if (!campaign.emails.has(c.id)) {
        campaign.emails.set(c.id, { status: "pending" });
      }
    });

    if (campaign.mode === "ai") {
      const worker = async () => {
        while (queue.length && state.campaign === campaign) {
          await writeEmail(campaign, product, queue.shift());
        }
      };
      await Promise.all(Array.from({ length: EMAIL_CONCURRENCY }, worker));
    }
    campaign.running = false;
    // Re-render only when this run did something, or renderPreview (which
    // starts a run) would loop.
    if (changed && location.hash === "#preview" && state.campaign === campaign) renderPreview();
  }

  function progressText(counts, total) {
    return `${counts.done} of ${total} written${counts.error ? `, ${counts.error} failed` : ""}`;
  }

  function safeUrl(url) {
    return /^https?:\/\//i.test(String(url || "")) ? url : "";
  }

  function emailCounts(campaign, contacts) {
    const counts = { done: 0, error: 0, waiting: 0 };
    contacts.forEach((c) => {
      const status = campaign.emails.get(c.id)?.status;
      if (status === "done") counts.done++;
      else if (status === "error") counts.error++;
      else counts.waiting++;
    });
    return counts;
  }

  // ---------- Views ----------

  function renderLeads() {
    app.innerHTML = `
      <div class="page-head">
        <div>
          <h1>Qualified Leads</h1>
          <p>This section is coming soon.</p>
        </div>
      </div>
      <div class="pillars">
        <div class="card pillar"><h2>Pipeline</h2><p>Charge ahead of rivals.</p></div>
        <div class="card pillar"><h2>Deals</h2><p>Break through faster.</p></div>
        <div class="card pillar"><h2>Admin</h2><p>Nothing slows the advance.</p></div>
      </div>`;
  }

  function renderCampaigns() {
    app.innerHTML = `
      <div class="page-head">
        <div>
          <h1>Campaign Builder</h1>
          <p>Upload product information, then create a campaign for contacts who don't yet buy that product.</p>
        </div>
      </div>
      <div class="product-grid">
        ${state.products.map(productCard).join("")}
      </div>`;

    app.querySelectorAll(".product-name").forEach((input) => {
      input.addEventListener("input", () => {
        productById(input.dataset.id).name = input.value;
        saveProductNames();
      });
      input.addEventListener("blur", () => {
        const p = productById(input.dataset.id);
        if (!p.name.trim()) {
          p.name = data.products.find((d) => d.id === p.id).name;
          input.value = p.name;
          saveProductNames();
        }
      });
    });

    app.querySelectorAll(".product-url").forEach((input) => {
      input.addEventListener("input", () => {
        productById(input.dataset.id).pageUrl = input.value.trim();
        saveProductNames();
      });
    });

    app.querySelectorAll("input[type=file]").forEach((input) => {
      input.addEventListener("change", () => {
        const p = productById(input.dataset.id);
        Array.from(input.files).forEach((file) => {
          p.files.push({ name: file.name, size: file.size, file });
        });
        describeProduct(p);
      });
    });

    app.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = productById(btn.dataset.id);
        p.files.splice(Number(btn.dataset.remove), 1);
        describeProduct(p);
      });
    });

    app.querySelectorAll("[data-generate]").forEach((btn) => {
      btn.addEventListener("click", () => startCampaign(btn.dataset.generate));
    });
  }

  function productCard(p) {
    const files = p.files.length
      ? `<ul class="file-list">${p.files.map((f, i) => `
          <li>
            <span class="file-name" title="${esc(f.name)}">${esc(f.name)}</span>
            <span class="file-size">${formatSize(f.size)}</span>
            <button class="icon-btn" data-id="${p.id}" data-remove="${i}" aria-label="Remove ${esc(f.name)}">×</button>
          </li>`).join("")}</ul>`
      : `<p class="empty-note" style="margin-top:10px">No product information uploaded yet.</p>`;

    let description;
    if (p.descriptionStatus === "generating") description = `<span class="generating">Generating description…</span>`;
    else if (p.description) description = esc(p.description);
    else if (!p.files.length) description = `<span class="empty-note">Upload product information to generate a description.</span>`;
    else description = "";
    if (p.descriptionNote && p.descriptionStatus !== "generating") {
      description += `<span class="description-note ${p.descriptionStatus === "error" ? "is-error" : ""}">${esc(p.descriptionNote)}</span>`;
    }

    return `
      <article class="card product-card">
        <input class="product-name" data-id="${p.id}" value="${esc(p.name)}" aria-label="Product name">
        <label class="field">
          <span class="section-label" style="margin-bottom:0">Product page</span>
          <input class="product-url" type="url" data-id="${p.id}" value="${esc(p.pageUrl || "")}" placeholder="https://example.com/product" aria-describedby="url-help-${p.id}">
          <span class="empty-note" id="url-help-${p.id}">Used for the "Learn more" link in campaign emails.</span>
        </label>
        <div>
          <div class="section-label">Product information</div>
          <label class="btn btn-block" style="display:block;text-align:center">
            Upload product information
            <input type="file" multiple data-id="${p.id}" hidden>
          </label>
          ${files}
        </div>
        <div>
          <div class="section-label">Description</div>
          <p class="description">${description}</p>
        </div>
        <button class="btn btn-primary btn-block" data-generate="${p.id}">Create Campaign</button>
      </article>`;
  }

  function startCampaign(productId) {
    const selected = new Set(
      state.customers.filter((c) => !c.products.includes(productId)).map((c) => c.id)
    );
    // emails: contactId -> { status: pending|writing|done|error, email, error }
    // mode: "ai" once documents reach the server, "template" without an API key
    state.campaign = { productId, selected, launched: false, emails: new Map(), mode: null, running: false };
    state.search = "";
    location.hash = "#opportunities";
  }

  function renderCustomers() {
    const campaign = state.campaign;
    const product = campaign && productById(campaign.productId);

    app.innerHTML = `
      <div class="page-head">
        <div>
          <h1>Opportunity Database</h1>
          <p>${campaign
            ? `Contacts who don't buy ${esc(product.name)} are selected. Add or remove anyone before continuing.`
            : `All contacts and the products they currently buy.`}</p>
        </div>
        ${campaign ? `
          <div class="actions">
            <button class="btn" id="cancel-campaign">Cancel campaign</button>
            <button class="btn btn-primary" id="continue">Continue</button>
          </div>` : ""}
      </div>
      ${campaign ? `
        <div class="campaign-bar">
          <div>
            <strong>Campaign: ${esc(product.name)}</strong>
            <p id="selected-count"></p>
          </div>
        </div>` : ""}
      <div class="toolbar">
        <input class="search" type="search" placeholder="Search name, company, industry or email" value="${esc(state.search)}" aria-label="Search contacts">
        <div class="actions toolbar-actions">
          <button class="btn" id="add-contact">Add contact</button>
          <button class="btn" id="import-contacts">Upload from file</button>
        </div>
      </div>
      <div class="table-wrap"><table id="customer-table"></table></div>
      ${addContactDialog()}
      ${importDialog()}`;

    renderCustomerTable();

    app.querySelector(".search").addEventListener("input", (e) => {
      state.search = e.target.value;
      renderCustomerTable();
    });

    wireAddContact();
    wireImport();

    if (campaign) {
      app.querySelector("#continue").addEventListener("click", () => {
        if (campaign.selected.size === 0) {
          alert("Select at least one contact to continue.");
          return;
        }
        location.hash = "#preview";
      });
      app.querySelector("#cancel-campaign").addEventListener("click", () => {
        state.campaign = null;
        location.hash = "#campaigns";
      });
    }
  }

  function renderCustomerTable() {
    const campaign = state.campaign;
    const table = app.querySelector("#customer-table");
    const q = state.search.trim().toLowerCase();
    const rows = state.customers.filter((c) =>
      !q || [c.name, c.company, c.email, c.role, c.industry, c.website].some((v) => String(v || "").toLowerCase().includes(q))
    );
    const columnCount = 9 + state.products.length + (campaign ? 1 : 0);

    const allSelected = campaign && rows.length > 0 && rows.every((c) => campaign.selected.has(c.id));

    table.innerHTML = `
      <thead>
        <tr>
          ${campaign ? `<th class="center"><input type="checkbox" id="select-all" ${allSelected ? "checked" : ""} aria-label="Select all"></th>` : ""}
          <th>Contact name</th>
          <th>Contact company</th>
          <th>Company website</th>
          <th class="num"># Employees</th>
          <th>Industry</th>
          <th>Contact email</th>
          <th>Contact phone number</th>
          ${state.products.map((p) => `<th class="center ${campaign && campaign.productId === p.id ? "highlight" : ""}">${esc(p.name)}</th>`).join("")}
          <th class="row-actions"><span class="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((c) => {
          const isSelected = campaign && campaign.selected.has(c.id);
          return `
          <tr class="${isSelected ? "selected" : ""}">
            ${campaign ? `<td class="center"><input type="checkbox" data-customer="${c.id}" ${isSelected ? "checked" : ""} aria-label="Select ${esc(c.name)}"></td>` : ""}
            <td>${esc(c.name)}<span class="sub">${esc(c.role)}</span></td>
            <td>${esc(c.company)}</td>
            <td>${c.website ? `<a class="site-link" href="${esc(websiteHref(c.website))}" target="_blank" rel="noopener">${esc(c.website)}</a>` : ""}</td>
            <td class="num">${esc(formatEmployees(c.employees))}</td>
            <td>${esc(c.industry || "")}</td>
            <td>${esc(c.email)}</td>
            <td style="white-space:nowrap">${esc(c.phone)}</td>
            ${state.products.map((p) => c.products.includes(p.id)
              ? `<td class="center"><span class="mark yes" title="Buys ${esc(p.name)}">✓</span></td>`
              : `<td class="center"><span class="mark no" title="Doesn't buy ${esc(p.name)}">✕</span></td>`).join("")}
            <td class="row-actions">
              <button class="btn btn-small" data-edit="${c.id}" aria-label="Edit ${esc(c.name)}">Edit</button>
              <button class="btn btn-small btn-danger" data-delete="${c.id}" aria-label="Delete ${esc(c.name)}">Delete</button>
            </td>
          </tr>`;
        }).join("")}
        ${rows.length === 0 ? `<tr><td colspan="${columnCount}" class="empty-note">${state.customers.length === 0 ? "No contacts yet. Add a contact or upload a file to get started." : "No contacts match your search."}</td></tr>` : ""}
      </tbody>`;

    table.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => openContactForm(Number(btn.dataset.edit)));
    });
    table.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", () => deleteContact(Number(btn.dataset.delete)));
    });

    if (!campaign) return;

    updateSelectedCount();

    table.querySelectorAll("[data-customer]").forEach((box) => {
      box.addEventListener("change", () => {
        const id = Number(box.dataset.customer);
        if (box.checked) campaign.selected.add(id);
        else campaign.selected.delete(id);
        renderCustomerTable();
      });
    });

    table.querySelector("#select-all").addEventListener("change", (e) => {
      rows.forEach((c) => {
        if (e.target.checked) campaign.selected.add(c.id);
        else campaign.selected.delete(c.id);
      });
      renderCustomerTable();
    });
  }

  function updateSelectedCount() {
    const el = app.querySelector("#selected-count");
    if (el) el.textContent = `${state.campaign.selected.size} of ${state.customers.length} contacts selected`;
  }

  // ---------- Adding contacts ----------

  // A new contact joins an active campaign if they don't buy its product,
  // matching how the campaign's suggested list was built.
  function addToCampaignIfEligible(contact) {
    const campaign = state.campaign;
    if (campaign && !contact.products.includes(campaign.productId)) {
      campaign.selected.add(contact.id);
    }
  }

  function addContactDialog() {
    const field = (name, label, type = "text", placeholder = "") => `
      <label class="field">
        <span>${label}</span>
        <input name="${name}" type="${type}" placeholder="${placeholder}">
      </label>`;
    return `
      <dialog id="add-dialog" class="dialog">
        <form method="dialog" novalidate>
          <h2 id="contact-form-title">Add contact</h2>
          <div class="field-grid">
            ${field("name", "Contact name *", "text", "Jane Smith")}
            ${field("role", "Job role", "text", "Operations Director")}
            ${field("company", "Contact company", "text", "Acme Ltd")}
            ${field("website", "Company website", "text", "acme.co.uk")}
            ${field("employees", "# Employees", "text", "250 or 201-500")}
            ${field("industry", "Industry", "text", "Manufacturing")}
            ${field("email", "Contact email *", "email", "jane.smith@acme.co.uk")}
            ${field("phone", "Contact phone number", "tel", "01632 960 000")}
          </div>
          <fieldset class="product-checks">
            <legend>Products they currently buy</legend>
            ${state.products.map((p) => `
              <label><input type="checkbox" name="products" value="${p.id}"> ${esc(p.name)}</label>`).join("")}
          </fieldset>
          <p class="form-error" id="add-error" role="alert"></p>
          <div class="dialog-actions">
            <button type="button" class="btn" data-close>Cancel</button>
            <button type="submit" class="btn btn-primary" id="contact-form-submit">Add contact</button>
          </div>
        </form>
      </dialog>`;
  }

  // Numbers like "1,500" become 1500; ranges like "501-1,000" stay as text.
  function parseEmployees(raw) {
    const value = String(raw == null ? "" : raw).trim();
    const count = Number(value.replace(/,/g, ""));
    return value !== "" && Number.isFinite(count) ? count : value;
  }

  const CONTACT_TEXT_FIELDS = ["name", "role", "company", "website", "employees", "industry", "email", "phone"];

  // Set by wireAddContact; opens the contact form, prefilled when given an id.
  let openContactForm = () => {};

  function wireAddContact() {
    const dialog = app.querySelector("#add-dialog");
    const form = dialog.querySelector("form");
    const error = dialog.querySelector("#add-error");
    let editingId = null;

    openContactForm = (id = null) => {
      editingId = id;
      form.reset();
      error.textContent = "";
      const contact = id != null && state.customers.find((c) => c.id === id);
      dialog.querySelector("#contact-form-title").textContent = contact ? "Edit contact" : "Add contact";
      dialog.querySelector("#contact-form-submit").textContent = contact ? "Save changes" : "Add contact";
      if (contact) {
        CONTACT_TEXT_FIELDS.forEach((f) => { form.elements[f].value = contact[f] == null ? "" : contact[f]; });
        form.querySelectorAll("[name=products]").forEach((box) => { box.checked = contact.products.includes(box.value); });
      }
      dialog.showModal();
    };

    app.querySelector("#add-contact").addEventListener("click", () => openContactForm());
    dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
    form.addEventListener("input", () => { error.textContent = ""; });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const values = Object.fromEntries(new FormData(form));
      const name = (values.name || "").trim();
      const email = (values.email || "").trim();
      if (!name) { error.textContent = "Enter a contact name."; return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { error.textContent = "Enter a valid email address."; return; }

      const fields = {
        name,
        role: (values.role || "").trim(),
        company: (values.company || "").trim(),
        website: (values.website || "").trim(),
        employees: parseEmployees(values.employees),
        industry: (values.industry || "").trim(),
        email,
        phone: (values.phone || "").trim(),
        products: new FormData(form).getAll("products"),
      };

      const existing = editingId != null && state.customers.find((c) => c.id === editingId);
      if (existing) {
        Object.assign(existing, fields);
      } else {
        const contact = { id: nextCustomerId(), ...fields };
        state.customers.push(contact);
        addToCampaignIfEligible(contact);
      }
      saveCustomers();
      dialog.close();
      renderCustomerTable();
      if (existing) showToast("Contact updated");
    });
  }

  function deleteContact(id) {
    const contact = state.customers.find((c) => c.id === id);
    if (!contact) return;
    if (!confirm(`Delete ${contact.name || contact.email}? This can't be undone.`)) return;
    state.customers = state.customers.filter((c) => c.id !== id);
    if (state.campaign) state.campaign.selected.delete(id);
    saveCustomers();
    renderCustomerTable();
    showToast("Contact deleted");
  }

  // ---------- Importing contacts ----------
  // Reads .xlsx, .xls or .csv with SheetJS. Column headers are matched
  // loosely so small differences in the customer's spreadsheet still work.

  const HEADER_ALIASES = {
    name: ["contactname", "name", "fullname"],
    role: ["jobrole", "jobtitle", "role", "title", "position"],
    company: ["contactcompany", "company", "companyname", "organisation", "organization", "account"],
    website: ["companywebsite", "website", "url", "domain", "web"],
    employees: ["employees", "numberofemployees", "noofemployees", "employeecount", "headcount", "companysize"],
    industry: ["industry", "sector"],
    email: ["contactemail", "email", "emailaddress"],
    phone: ["contactphonenumber", "phone", "phonenumber", "telephone", "tel", "mobile"],
  };
  const TEMPLATE_HEADERS = ["Contact name", "Job role", "Contact company", "Company website", "# Employees", "Industry", "Contact email", "Contact phone number"];

  function normaliseHeader(h) {
    return String(h).toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function isYes(value) {
    return /^(y|yes|true|1|x|✓|✔|tick)$/i.test(String(value).trim());
  }

  function rowToContact(row) {
    const byHeader = {};
    Object.keys(row).forEach((h) => { byHeader[normaliseHeader(h)] = row[h]; });
    const pick = (key) => {
      const alias = HEADER_ALIASES[key].find((a) => a in byHeader);
      return alias ? String(byHeader[alias]).trim() : "";
    };

    const productKeys = state.products.map((p) => [normaliseHeader(p.name), normaliseHeader(p.id), "product" + p.id.slice(1)]);
    const products = state.products
      .filter((p, i) => productKeys[i].some((k) => k in byHeader && isYes(byHeader[k])))
      .map((p) => p.id);

    // Columns that aren't standard fields are kept as extra context for
    // the campaign email skill (company description, recent news, etc.).
    const known = new Set([...Object.values(HEADER_ALIASES).flat(), ...productKeys.flat()]);
    const extra = {};
    Object.keys(row).forEach((h) => {
      const value = String(row[h]).trim();
      if (value && !known.has(normaliseHeader(h))) extra[String(h).trim()] = value;
    });

    const employees = parseEmployees(pick("employees"));
    return {
      extra,
      name: pick("name"),
      role: pick("role"),
      company: pick("company"),
      website: pick("website"),
      employees,
      industry: pick("industry"),
      email: pick("email"),
      phone: pick("phone"),
      products,
    };
  }

  function importDialog() {
    return `
      <dialog id="import-dialog" class="dialog">
        <form method="dialog" novalidate>
          <h2>Upload contacts</h2>
          <p class="dialog-note">Upload an Excel (.xlsx, .xls) or CSV file. The first sheet is read and the first row should be column headers.</p>
          <p class="dialog-note">Expected columns: ${TEMPLATE_HEADERS.join(", ")}, plus one column per product (${state.products.map((p) => esc(p.name)).join(", ")}) marked Yes or No.</p>
          <label class="field">
            <span>File</span>
            <input type="file" name="file" accept=".xlsx,.xls,.csv">
          </label>
          <fieldset class="product-checks">
            <legend>Existing contacts</legend>
            <label><input type="radio" name="mode" value="add" checked> Add to existing contacts</label>
            <label><input type="radio" name="mode" value="replace"> Replace all existing contacts</label>
          </fieldset>
          <p class="form-error" id="import-error" role="alert"></p>
          <div class="dialog-actions">
            <button type="button" class="btn btn-link" id="download-template">Download template</button>
            <button type="button" class="btn" data-close>Cancel</button>
            <button type="submit" class="btn btn-primary">Upload</button>
          </div>
        </form>
      </dialog>`;
  }

  function wireImport() {
    const dialog = app.querySelector("#import-dialog");
    const form = dialog.querySelector("form");
    const error = dialog.querySelector("#import-error");

    app.querySelector("#import-contacts").addEventListener("click", () => {
      form.reset();
      error.textContent = "";
      dialog.showModal();
    });
    dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
    form.addEventListener("change", () => { error.textContent = ""; });

    dialog.querySelector("#download-template").addEventListener("click", () => {
      if (!window.XLSX) { error.textContent = "The spreadsheet reader didn't load. Check your connection and reload."; return; }
      const headers = TEMPLATE_HEADERS.concat(state.products.map((p) => p.name));
      const example = ["Jane Smith", "Operations Director", "Acme Ltd", "acme.co.uk", 250, "Manufacturing", "jane.smith@acme.co.uk", "01632 960 000"]
        .concat(state.products.map((_, i) => (i === 0 ? "Yes" : "No")));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, example]), "Contacts");
      XLSX.writeFile(wb, "agincourt-contacts-template.xlsx");
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const file = form.file.files[0];
      if (!file) { error.textContent = "Choose a file to upload."; return; }
      if (!window.XLSX) { error.textContent = "The spreadsheet reader didn't load. Check your connection and reload."; return; }

      let rows;
      try {
        const wb = XLSX.read(await file.arrayBuffer());
        rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      } catch (err) {
        error.textContent = "That file couldn't be read. Upload an .xlsx, .xls or .csv file.";
        return;
      }

      const parsed = rows.map(rowToContact);
      const valid = parsed.filter((c) => c.name || c.email);
      if (valid.length === 0) {
        error.textContent = "No contacts found. Check the first row has headers such as Contact name and Contact email.";
        return;
      }

      if (form.mode.value === "replace") {
        state.customers = [];
        if (state.campaign) state.campaign.selected.clear();
      }
      let id = nextCustomerId();
      valid.forEach((c) => {
        const contact = { id: id++, ...c };
        state.customers.push(contact);
        addToCampaignIfEligible(contact);
      });
      saveCustomers();
      dialog.close();
      renderCustomerTable();

      const skipped = parsed.length - valid.length;
      showToast(`${valid.length} ${valid.length === 1 ? "contact" : "contacts"} uploaded${skipped ? `, ${skipped} empty ${skipped === 1 ? "row" : "rows"} skipped` : ""}`);
    });
  }

  function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.setAttribute("role", "status");
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  function selectedContacts() {
    return state.customers.filter((c) => state.campaign.selected.has(c.id));
  }

  function renderPreview() {
    const campaign = state.campaign;
    if (!campaign || campaign.selected.size === 0) {
      location.hash = "#campaigns";
      return;
    }
    const product = productById(campaign.productId);
    const contacts = selectedContacts();
    const counts = emailCounts(campaign, contacts);
    const launchedCount = campaign.launched ? contacts.filter((c) => campaign.emails.get(c.id)?.status === "done").length : 0;

    let intro;
    if (!campaign.mode) intro = "Preparing the product information…";
    else if (campaign.mode === "template") intro = `Sample content for ${contacts.length} ${contacts.length === 1 ? "contact" : "contacts"}. Connect Claude (add an API key on the server) to write each email from the product documents, the company's website, and the contact's record.`;
    else intro = `Each email is written by Claude from the product documents, the company's website, and the contact's record. <strong id="email-progress">${progressText(counts, contacts.length)}</strong>.`;

    app.innerHTML = `
      <div class="page-head">
        <div>
          <h1>Campaign preview: ${esc(product.name)}</h1>
          <p>${intro}</p>
        </div>
        <div class="actions">
          <button class="btn" id="back">Back to opportunities</button>
          ${campaign.launched
            ? `<button class="btn btn-primary" id="download">Download campaign content</button>`
            : `<button class="btn btn-primary" id="launch">Approve and Launch Campaign</button>`}
        </div>
      </div>
      ${campaign.launched ? `
        <div class="notice">
          <strong>Campaign launched.</strong> Content is ready for ${launchedCount} of ${contacts.length} selected contacts.
          Email sending isn't connected yet, so download the content to send it.
        </div>` : ""}
      <div class="preview-list">
        ${contacts.map((c) => emailCard(c)).join("")}
      </div>`;

    app.querySelector("#back").addEventListener("click", () => { location.hash = "#opportunities"; });
    app.querySelector(".preview-list").addEventListener("click", (e) => {
      const retry = e.target.closest("[data-retry]");
      if (retry) {
        const contact = state.customers.find((c) => c.id === Number(retry.dataset.retry));
        if (contact) writeEmail(campaign, product, contact).then(() => updateProgress());
      }
    });

    const launch = app.querySelector("#launch");
    if (launch) launch.addEventListener("click", () => {
      const now = emailCounts(campaign, contacts);
      if (now.waiting) {
        showToast(`Emails are still being written: ${now.done} of ${contacts.length} done`);
        return;
      }
      if (now.error && !confirm(`${now.error} ${now.error === 1 ? "email" : "emails"} couldn't be written and will be left out. Launch anyway?`)) return;
      campaign.launched = true;
      renderPreview();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    const download = app.querySelector("#download");
    if (download) download.addEventListener("click", () => downloadCampaign(product, contacts));

    runEmailWriting();
  }

  function emailCard(c) {
    const entry = state.campaign.emails.get(c.id) || { status: "pending" };
    const meta = `
      <div class="email-meta">
        <span>To <strong>${esc(c.name)}</strong> &lt;${esc(c.email)}&gt;</span>
        <span>${esc([c.role, c.company].filter(Boolean).join(", "))} ${c.website ? `<span class="chip">${esc(c.website)}</span>` : ""}</span>
      </div>`;

    let body;
    if (entry.status === "done") {
      const email = { ...entry.email, learn_more_url: safeUrl(entry.email.learn_more_url) };
      body = `
        <p class="subject">${esc(email.subject)}</p>
        <p>${esc(email.greeting)}</p>
        ${email.paragraphs.map((para) => `<p>${esc(para)}</p>`).join("")}
        ${email.learn_more_url
          ? `<p><a class="learn-more" href="${esc(email.learn_more_url)}" target="_blank" rel="noopener">Learn more</a></p>`
          : `<p class="empty-note">No product page URL, so there's no "Learn more" link. Add one on the Campaign Builder.</p>`}
        <p>${esc(email.call_to_action)}</p>
        ${email.research_notes ? `
          <div class="research-notes">
            <span class="section-label">Why this angle ${entry.fetchedWebsite === false ? "(website not reached)" : ""}</span>
            ${esc(email.research_notes)}
          </div>` : ""}
        ${email.roi_basis ? `
          <div class="research-notes">
            <span class="section-label">How the ROI was worked out</span>
            ${esc(email.roi_basis)}
          </div>` : ""}
        ${entry.template ? `
          <div class="research-notes template-note">
            Basic template, not written by Claude: no website review or ROI example. Add an API key on the server to use the campaign email skill.
          </div>` : ""}`;
    } else if (entry.status === "error") {
      body = `<p class="description-note is-error">${esc(entry.error)}</p>
        <button class="btn btn-small" data-retry="${c.id}">Try again</button>`;
    } else if (entry.status === "writing") {
      body = `<p class="generating">Reviewing ${esc(c.website || "the company")} and writing the email…</p>`;
    } else {
      body = `<p class="empty-note">Waiting to be written…</p>`;
    }
    return `<article class="card email-card" id="email-${c.id}">${meta}<div class="email-body">${body}</div></article>`;
  }

  function updateEmailCard(contactId) {
    if (location.hash !== "#preview") return;
    const el = document.getElementById(`email-${contactId}`);
    const contact = state.customers.find((c) => c.id === contactId);
    if (el && contact) el.outerHTML = emailCard(contact);
    updateProgress();
  }

  function updateProgress() {
    const el = document.getElementById("email-progress");
    if (!el || !state.campaign) return;
    const contacts = selectedContacts();
    const counts = emailCounts(state.campaign, contacts);
    el.textContent = progressText(counts, contacts.length);
  }

  function downloadCampaign(product, contacts) {
    const csvCell = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const lines = [["Name", "Email", "Company", "Job role", "Subject", "Body", "Learn more URL", "Research notes", "ROI basis"].map(csvCell).join(",")];
    contacts.forEach((c) => {
      const entry = state.campaign.emails.get(c.id);
      if (!entry || entry.status !== "done") return;
      const email = entry.email;
      lines.push([c.name, c.email, c.company, c.role, email.subject, emailPlainText(email), email.learn_more_url, email.research_notes, email.roi_basis].map(csvCell).join(","));
    });
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${product.name.replace(/[^\w-]+/g, "_")}_campaign.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  // ---------- Routing ----------

  const routes = {
    leads: renderLeads,
    campaigns: renderCampaigns,
    opportunities: renderCustomers,
    preview: renderPreview,
  };

  function route() {
    const name = location.hash.replace("#", "") || "campaigns";
    const view = routes[name] || renderCampaigns;
    const activeTab = name === "preview" ? "opportunities" : (routes[name] ? name : "campaigns");
    document.querySelectorAll(".tabs a").forEach((a) => {
      a.classList.toggle("active", a.dataset.tab === activeTab);
    });
    view();
    window.scrollTo(0, 0);
  }

  window.addEventListener("hashchange", route);
  route();
})();
