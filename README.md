# Agincourt

**More Win. Less Admin**

- **Pipeline:** charge ahead of rivals
- **Deals:** break through faster
- **Admin:** nothing slows the advance

## Running locally

Requires Node.js 22 or later.

```bash
npm install
npm start
```

Then open http://localhost:8080.

To write campaign emails with Claude, copy `.env.example` to `.env` and add an Anthropic API key. Without a key the app still runs, and the campaign preview uses a basic template.

## Sections

- **Qualified Leads**: coming soon.
- **Campaign Builder**: one card per product, and **Add product** to promote more. For each product, enter the product page URL (for the "Learn more" link) and a description, and upload product information (PDF, Word .docx, or text files) for the campaign email skill. Then click **Create Campaign**. Each product gets its own column in the Opportunity Database.
- **Opportunity Database**: contacts with company website, employee count, industry, and ticks for the products they buy. Add contacts one at a time or upload an Excel/CSV file (a template is available from the upload dialog); contacts are saved in the browser. When a campaign is started, everyone who doesn't buy that product is preselected; adjust the selection and click **Continue**.
- **Campaign preview**: the `campaign-email` skill writes a bespoke email for each selected contact from the product documents, the company's website, and the contact's record (including any extra columns from the upload). Review them, then **Approve and Launch Campaign**.

## Project layout

```
server.js        Serves the app and calls Claude for campaign emails
skills/campaign-email/SKILL.md   Instructions Claude follows to write each campaign email
index.html       Page shell and navigation
css/styles.css   Herald theme
js/data.js       Placeholder products (the opportunity database starts empty)
js/app.js        Views, routing, and campaign flow
```

## Placeholders to replace

- Starting products in `js/data.js`. Products can be renamed, added, and removed in the UI.
- Launching a campaign prepares a downloadable CSV; email sending isn't connected.
