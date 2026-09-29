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

### Production

```bash
npm run start:production
```

Production uses the Claude API (`ANTHROPIC_API_KEY`) for campaign emails, product descriptions, and lead briefings. The server refuses to start in production (`--production`, or `NODE_ENV=production`) unless `ANTHROPIC_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SECRET_KEY` are all set, and it never allows subscription mode. On a hosting platform, set those three as environment variables rather than uploading `.env`, and set `PORT` if the platform requires it.

### Testing with your Claude subscription

For your own local testing, the app can use your Claude subscription (Pro or Max) instead of an API key, through the Claude Agent SDK:

```bash
npm run login
npm run start:local
```

`npm run login` opens a browser to sign in once; `npm run login:status` checks it. In this mode Claude can only read the product's uploaded documents and fetch pages on each contact's company website, and emails are written two at a time. Anthropic doesn't allow claude.ai login in products offered to other people, so use an API key for anything beyond your own testing.

## Sections

The tabs are numbered in the order they're used:

1. **Campaign Builder**: one card per product, and **Add product** to promote more. For each product, add the product page URL (for the "Learn more" link) and upload product information (PDF, Word .docx, or text files); Claude writes a short description from the documents, which you can edit. Then click **Create Campaign**.
2. **Opportunity Database**: contacts with company website, employee count, industry, and ticks for the products they buy. Add, edit, delete, or upload contacts from Excel/CSV. When a campaign is started, everyone who doesn't buy that product is preselected; adjust the selection and click **Continue**. The campaign preview then has the `campaign-email` skill write a bespoke email for each contact; **Approve and Launch Campaign** records the campaign and its recipients.
3. **Qualified Leads**: contacts who opened a campaign email, with time spent reading it, whether they clicked through, and time on the website. Select a lead for a briefing written by the `lead-brief` skill: company overview, why the product fits, ROI, likely objections and responses, and contact details. Briefings are saved, and can be rewritten.

Email sending and open/click tracking aren't connected yet, so the Qualified Leads page currently shows a demo campaign with random engagement data for 10 contacts.

## Project layout

```
server.js        Serves the app and calls Claude for campaign emails
skills/campaign-email/SKILL.md   Instructions Claude follows to write each campaign email
skills/lead-brief/SKILL.md       Instructions Claude follows to write each lead briefing
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
- `campaigns` and `campaign_engagements`: launched campaigns, their recipients, and whether each opened the email, time spent reading, click-through, and time on the website.
- `lead_briefs`: saved briefings for qualified leads.

Row level security is on with no policies, so only the server (using the secret key) can read or write data. Schema changes live in `supabase/migrations/` and are applied with `npx supabase db push`.
