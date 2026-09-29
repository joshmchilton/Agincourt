(function () {
  "use strict";

  const data = window.AGINCOURT_DATA;
  const app = document.getElementById("app");
  const NAMES_KEY = "agincourt.productNames";
  const CUSTOMERS_KEY = "agincourt.opportunities";

  const state = {
    products: data.products.map((p) => ({ ...p, files: [], description: "" })),
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

  function loadProductNames() {
    try {
      const saved = JSON.parse(localStorage.getItem(NAMES_KEY) || "{}");
      state.products.forEach((p) => { if (saved[p.id]) p.name = saved[p.id]; });
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
      state.products.forEach((p) => { names[p.id] = p.name; });
      localStorage.setItem(NAMES_KEY, JSON.stringify(names));
    } catch (e) { /* storage unavailable */ }
  }

  // ---------- Description generation ----------
  // Placeholder: summarises readable text files locally. Swap for the
  // AI generation step once the product information skill is connected.

  const TEXT_TYPES = /\.(txt|md|csv|html?|json)$/i;

  async function buildDescription(product) {
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
  // Placeholder template. The campaign skill will replace this with content
  // written from the product documentation, company website and job role.

  function roleAngle(role) {
    if (/financ|CFO|controller|procurement/i.test(role)) return "keeping costs predictable and proving the return on every investment matters";
    if (/\b(IT|CTO)\b|technolog|systems|digital/.test(role)) return "finding tools that integrate cleanly and stay secure matters";
    if (/operations/i.test(role)) return "removing manual steps so your team gets more done matters";
    if (/sales|commercial|marketing|customer/i.test(role)) return "helping your team win and keep more customers matters";
    if (/chief executive|managing director|CEO/i.test(role)) return "growing the business without adding overhead matters";
    return "making day-to-day work simpler matters";
  }

  function generateEmail(contact, product) {
    const first = (contact.name || "").split(" ")[0] || "there";
    const role = contact.role || "";
    const company = contact.company || "your team";
    const productLine = product.description
      ? `${product.name} is built for exactly that. ${product.description}`
      : `${product.name} is built to help with exactly that.`;
    const opener = role
      ? `I've been looking at what ${company} is working on, and as ${role} I imagine ${roleAngle(role)} to you.`
      : `I've been looking at what ${company} is working on, and I imagine ${roleAngle(role)} to you.`;
    return {
      subject: contact.company ? `${product.name} for ${contact.company}` : product.name,
      paragraphs: [
        `Hi ${first},`,
        opener,
        productLine,
        `Would a 20-minute call next week be useful to see how it would fit ${company}?`,
      ],
    };
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
          <p>Upload product information, then generate a campaign for contacts who don't yet buy that product.</p>
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

    app.querySelectorAll("input[type=file]").forEach((input) => {
      input.addEventListener("change", async () => {
        const p = productById(input.dataset.id);
        Array.from(input.files).forEach((file) => {
          p.files.push({ name: file.name, size: file.size, file });
        });
        p.description = await buildDescription(p);
        renderCampaigns();
      });
    });

    app.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const p = productById(btn.dataset.id);
        p.files.splice(Number(btn.dataset.remove), 1);
        p.description = await buildDescription(p);
        renderCampaigns();
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
    if (p.description) description = esc(p.description);
    else if (p.files.length) description = `<span class="empty-note">A description will be generated from the uploaded information.</span>`;
    else description = `<span class="empty-note">Upload product information to generate a description.</span>`;

    return `
      <article class="card product-card">
        <input class="product-name" data-id="${p.id}" value="${esc(p.name)}" aria-label="Product name">
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
        <button class="btn btn-primary btn-block" data-generate="${p.id}">Generate Campaign</button>
      </article>`;
  }

  function startCampaign(productId) {
    const selected = new Set(
      state.customers.filter((c) => !c.products.includes(productId)).map((c) => c.id)
    );
    state.campaign = { productId, selected, launched: false };
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
    const columnCount = 8 + state.products.length + (campaign ? 1 : 0);

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
          </tr>`;
        }).join("")}
        ${rows.length === 0 ? `<tr><td colspan="${columnCount}" class="empty-note">${state.customers.length === 0 ? "No contacts yet. Add a contact or upload a file to get started." : "No contacts match your search."}</td></tr>` : ""}
      </tbody>`;

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
          <h2>Add contact</h2>
          <div class="field-grid">
            ${field("name", "Contact name *", "text", "Jane Smith")}
            ${field("role", "Job role", "text", "Operations Director")}
            ${field("company", "Contact company", "text", "Acme Ltd")}
            ${field("website", "Company website", "text", "acme.co.uk")}
            ${field("employees", "# Employees", "number", "250")}
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
            <button type="submit" class="btn btn-primary">Add contact</button>
          </div>
        </form>
      </dialog>`;
  }

  function wireAddContact() {
    const dialog = app.querySelector("#add-dialog");
    const form = dialog.querySelector("form");
    const error = dialog.querySelector("#add-error");

    app.querySelector("#add-contact").addEventListener("click", () => {
      form.reset();
      error.textContent = "";
      dialog.showModal();
    });
    dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
    form.addEventListener("input", () => { error.textContent = ""; });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const values = Object.fromEntries(new FormData(form));
      const name = (values.name || "").trim();
      const email = (values.email || "").trim();
      if (!name) { error.textContent = "Enter a contact name."; return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { error.textContent = "Enter a valid email address."; return; }

      const contact = {
        id: nextCustomerId(),
        name,
        role: (values.role || "").trim(),
        company: (values.company || "").trim(),
        website: (values.website || "").trim(),
        employees: values.employees === "" ? "" : Number(values.employees),
        industry: (values.industry || "").trim(),
        email,
        phone: (values.phone || "").trim(),
        products: new FormData(form).getAll("products"),
      };
      state.customers.push(contact);
      addToCampaignIfEligible(contact);
      saveCustomers();
      dialog.close();
      renderCustomerTable();
    });
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

    const products = state.products
      .filter((p) => {
        const keys = [normaliseHeader(p.name), normaliseHeader(p.id), "product" + p.id.slice(1)];
        return keys.some((k) => k in byHeader && isYes(byHeader[k]));
      })
      .map((p) => p.id);

    const employees = pick("employees").replace(/,/g, "");
    return {
      name: pick("name"),
      role: pick("role"),
      company: pick("company"),
      website: pick("website"),
      employees: employees !== "" && Number.isFinite(Number(employees)) ? Number(employees) : employees,
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

    app.innerHTML = `
      <div class="page-head">
        <div>
          <h1>Campaign preview: ${esc(product.name)}</h1>
          <p>Sample content for ${contacts.length} ${contacts.length === 1 ? "contact" : "contacts"}. Once the campaign skill is connected, each message will be written from the product information, the company's website, and the contact's job role.</p>
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
          <strong>Campaign launched.</strong> Content is ready for all ${contacts.length} selected contacts.
          Email sending isn't connected yet, so download the content to send it.
        </div>` : ""}
      <div class="preview-list">
        ${contacts.map((c) => {
          const email = generateEmail(c, product);
          return `
          <article class="card email-card">
            <div class="email-meta">
              <span>To <strong>${esc(c.name)}</strong> &lt;${esc(c.email)}&gt;</span>
              <span>${esc([c.role, c.company].filter(Boolean).join(", "))} ${c.website ? `<span class="chip">${esc(c.website)}</span>` : ""}</span>
            </div>
            <div class="email-body">
              <p class="subject">${esc(email.subject)}</p>
              ${email.paragraphs.map((para) => `<p>${esc(para)}</p>`).join("")}
            </div>
          </article>`;
        }).join("")}
      </div>`;

    app.querySelector("#back").addEventListener("click", () => { location.hash = "#opportunities"; });

    const launch = app.querySelector("#launch");
    if (launch) launch.addEventListener("click", () => {
      campaign.launched = true;
      renderPreview();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    const download = app.querySelector("#download");
    if (download) download.addEventListener("click", () => downloadCampaign(product, contacts));
  }

  function downloadCampaign(product, contacts) {
    const csvCell = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [["Name", "Email", "Company", "Job role", "Subject", "Body"].map(csvCell).join(",")];
    contacts.forEach((c) => {
      const email = generateEmail(c, product);
      lines.push([c.name, c.email, c.company, c.role, email.subject, email.paragraphs.join("\n\n")].map(csvCell).join(","));
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
