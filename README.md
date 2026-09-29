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

Copy `.env.example` to `.env` and add your Supabase secret key (Supabase dashboard, **Project Settings > API Keys**). All products, product documents, and contacts are stored in Supabase, so the app needs it to load.

To write campaign emails with Claude, also add an Anthropic API key. Without a key the app still runs, and the campaign preview uses a basic template.

### Testing with your Claude subscription

For your own local testing, the app can use your Claude subscription (Pro or Max) instead of an API key, through the Claude Agent SDK:

```bash
npm run login
npm run start:local
```

`npm run login` opens a browser to sign in once; `npm run login:status` checks it. In this mode Claude can only read the product's uploaded documents and fetch pages on each contact's company website, and emails are written two at a time. Anthropic doesn't allow claude.ai login in products offered to other people, so use an API key for anything beyond your own testing.

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
db.js            Supabase reads and writes (server only)
supabase/        Supabase config and migrations (schema and demo data)
js/app.js        Views, routing, and campaign flow
```

## Placeholders to replace

- Launching a campaign prepares a downloadable CSV; email sending isn't connected.

## Data

Everything is stored in the linked Supabase project:

- `products`: name, product page URL, and description for each product on the Campaign Builder.
- `product_documents`: uploaded product information; the files are in the private `product-documents` Storage bucket.
- `contacts`: the Opportunity Database, including the products each contact buys and any extra spreadsheet columns.

Row level security is on with no policies, so only the server (using the secret key) can read or write data. Schema changes live in `supabase/migrations/` and are applied with `npx supabase db push`.
