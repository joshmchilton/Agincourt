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

To generate product descriptions with Claude, copy `.env.example` to `.env` and add an Anthropic API key. Without a key the app still runs, and descriptions fall back to a basic summary of any uploaded text files.

## Sections

- **Qualified Leads**: coming soon.
- **Campaign Builder**: one card per product. Upload product information (PDF, Word .docx, or text files) and Claude writes the product description automatically, then click **Generate Campaign**.
- **Opportunity Database**: contacts with company website, employee count, industry, and ticks for the products they buy. Add contacts one at a time or upload an Excel/CSV file (a template is available from the upload dialog); contacts are saved in the browser. When a campaign is started, everyone who doesn't buy that product is preselected; adjust the selection and click **Continue**.
- **Campaign preview**: a tailored message per selected contact, and **Approve and Launch Campaign**.

## Project layout

```
server.js        Serves the app and calls Claude for product descriptions
index.html       Page shell and navigation
css/styles.css   Herald theme
js/data.js       Placeholder products (the opportunity database starts empty)
js/app.js        Views, routing, and campaign flow
```

## Placeholders to replace

- Product names in `js/data.js` (product names can also be renamed in the UI).
- `generateEmail` in `js/app.js`: currently a template based on job role. It will be replaced by the campaign skill using product documentation, company websites, and job roles.
- Launching a campaign prepares a downloadable CSV; email sending isn't connected.
