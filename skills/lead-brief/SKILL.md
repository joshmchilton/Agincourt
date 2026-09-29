---
name: lead-brief
description: Writes a briefing on one qualified lead for a business development manager (BDM) who is about to contact them. It covers a company overview, why the product fits, an ROI example, and likely objections with responses. Draws on the product's technical documentation, the company's website, the contact's database record, and how they engaged with the campaign email. Used by Agincourt's Qualified Leads page.
---

# Lead brief

A contact has opened a campaign email about a product, so they're now a qualified lead. A business development manager (BDM) is about to call or email them. Write the briefing that BDM reads first: specific to this company and this person, grounded in evidence, and quick to scan.

## What you're given

- **The product**: its name, description, product page URL, and the uploaded technical documentation. The documentation is the source of truth about capabilities, pricing, benefits, ideal customers, and objection handling. It also tells you who the seller is.
- **The contact record** from the opportunity database: name, job role, company, website, employee count, industry, products they already buy from the seller, and any extra columns (for example a company description, recent news, buyer persona, or notes).
- **Campaign engagement**: whether they opened the email, how long they spent reading it, whether they clicked through to the product page, and how long they spent there.
- **The company website**, which you can fetch.

## Research

1. Fetch the company's homepage, and one or two more pages if they help (about, news, locations, careers). Don't fetch more than three pages in total.
2. Read the whole contact record, including the extra columns.
3. Read the technical documentation closely, especially any ideal customer profile, buying signals, persona messaging, industry playbooks, benefit realisation or ROI figures, pricing, and objection handling.

If the website can't be fetched, work from the record and the documentation, and say so in `research_notes`.

## The briefing

**1. Company overview.** Three to five sentences on what the company does, its size and footprint, how it's owned, how it's changing (growth, new sites, acquisitions, leadership changes), and anything else a BDM should know before the call. Only include facts from the website, the contact record, or the documentation.

**2. Why the product fits.** Three or four reasons, most compelling first. Each reason links something specific about this company (its operations, scale, sector, or a recent signal) to a capability or outcome in the documentation. Give the evidence for each: where the company fact came from, and which part of the documentation it matches. Where the documentation lists buying signals or an ideal customer profile, say which ones this company meets.

**3. ROI.** A headline figure the BDM can say out loud, then how it was reached. Use the documentation's own figures (per-invoice savings, time saved, benchmark ranges, worked examples, pricing) and apply them to this company's likely scale. Keep assumptions conservative, state them, and round the result. Every number must come from the documentation or be calculated from documentation figures and stated company facts. If the documentation has no quantified results, say so rather than inventing any.

**4. Likely objections and responses.** Three or four objections this particular contact is likely to raise, given their role, their company, and what they already use. Where the documentation covers an objection, base the response on it. Keep each response to two or three sentences a BDM could say in conversation.

**Engagement.** Read the engagement figures as intent signals and reflect them in `engagement_insight`, in one or two sentences. For example, a long read with no click suggests interest but uncertainty, and a long visit to the product page suggests they're evaluating.

Write plainly for a busy BDM: short sentences, no buzzwords or superlatives. Don't include the contact's details; the page shows them separately.

## Output

Return JSON with these fields:

- `company_overview`: the overview paragraph.
- `fit_reasons`: a list of `{ "reason", "evidence" }`.
- `roi`: `{ "headline", "explanation", "basis" }`. `basis` names the documentation figures and sections used, the company facts, the calculation, and any assumptions.
- `objections`: a list of `{ "objection", "response" }`.
- `engagement_insight`: one or two sentences.
- `research_notes`: one sentence on what was researched and any gaps, such as a website that couldn't be fetched.
