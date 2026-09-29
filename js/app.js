(function () {
  "use strict";

  const data = window.AGINCOURT_DATA;
  const app = document.getElementById("app");
  const NAMES_KEY = "agincourt.productNames";

  const state = {
    products: data.products.map((p) => ({ ...p, files: [], description: "" })),
    customers: data.customers,
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
    const first = contact.name.split(" ")[0];
    const productLine = product.description
      ? `${product.name} is built for exactly that. ${product.description}`
      : `${product.name} is built to help with exactly that.`;
    return {
      subject: `${product.name} for ${contact.company}`,
      paragraphs: [
        `Hi ${first},`,
        `I've been looking at what ${contact.company} is working on, and as ${contact.role} I imagine ${roleAngle(contact.role)} to you.`,
        productLine,
        `Would a 20-minute call next week be useful to see how it would fit ${contact.company}?`,
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
          <p>Upload product information, then generate a campaign for customers who don't yet buy that product.</p>
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
    location.hash = "#customers";
  }

  function renderCustomers() {
    const campaign = state.campaign;
    const product = campaign && productById(campaign.productId);

    app.innerHTML = `
      <div class="page-head">
        <div>
          <h1>Customer Database</h1>
          <p>${campaign
            ? `Customers who don't buy ${esc(product.name)} are selected. Add or remove anyone before continuing.`
            : `All customers and the products they currently buy.`}</p>
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
        <input class="search" type="search" placeholder="Search name, company or email" value="${esc(state.search)}" aria-label="Search customers">
      </div>
      <div class="table-wrap"><table id="customer-table"></table></div>`;

    renderCustomerTable();

    app.querySelector(".search").addEventListener("input", (e) => {
      state.search = e.target.value;
      renderCustomerTable();
    });

    if (campaign) {
      app.querySelector("#continue").addEventListener("click", () => {
        if (campaign.selected.size === 0) {
          alert("Select at least one customer to continue.");
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
      !q || [c.name, c.company, c.email, c.role].some((v) => v.toLowerCase().includes(q))
    );

    const allSelected = campaign && rows.length > 0 && rows.every((c) => campaign.selected.has(c.id));

    table.innerHTML = `
      <thead>
        <tr>
          ${campaign ? `<th class="center"><input type="checkbox" id="select-all" ${allSelected ? "checked" : ""} aria-label="Select all"></th>` : ""}
          <th>Contact name</th>
          <th>Contact company</th>
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
            <td>${esc(c.company)}<span class="sub">${esc(c.website)}</span></td>
            <td>${esc(c.email)}</td>
            <td style="white-space:nowrap">${esc(c.phone)}</td>
            ${state.products.map((p) => c.products.includes(p.id)
              ? `<td class="center"><span class="mark yes" title="Buys ${esc(p.name)}">✓</span></td>`
              : `<td class="center"><span class="mark no" title="Doesn't buy ${esc(p.name)}">✕</span></td>`).join("")}
          </tr>`;
        }).join("")}
        ${rows.length === 0 ? `<tr><td colspan="${campaign ? 8 : 7}" class="empty-note">No customers match your search.</td></tr>` : ""}
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
    if (el) el.textContent = `${state.campaign.selected.size} of ${state.customers.length} customers selected`;
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
          <button class="btn" id="back">Back to customers</button>
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
              <span>${esc(c.role)}, ${esc(c.company)} <span class="chip">${esc(c.website)}</span></span>
            </div>
            <div class="email-body">
              <p class="subject">${esc(email.subject)}</p>
              ${email.paragraphs.map((para) => `<p>${esc(para)}</p>`).join("")}
            </div>
          </article>`;
        }).join("")}
      </div>`;

    app.querySelector("#back").addEventListener("click", () => { location.hash = "#customers"; });

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
    customers: renderCustomers,
    preview: renderPreview,
  };

  function route() {
    const name = location.hash.replace("#", "") || "campaigns";
    const view = routes[name] || renderCampaigns;
    const activeTab = name === "preview" ? "customers" : (routes[name] ? name : "campaigns");
    document.querySelectorAll(".tabs a").forEach((a) => {
      a.classList.toggle("active", a.dataset.tab === activeTab);
    });
    view();
    window.scrollTo(0, 0);
  }

  window.addEventListener("hashchange", route);
  route();
})();
