# Agincourt

**More Win. Less Admin**

- **Pipeline:** charge ahead of rivals
- **Deals:** break through faster
- **Admin:** nothing slows the advance

## Running locally

The app is plain HTML, CSS and JavaScript with no build step. Serve the folder with any static server:

```bash
python -m http.server 8080
```

Then open http://localhost:8080.

## Sections

- **Qualified Leads**: coming soon.
- **Campaign Builder**: one card per product. Upload product information, see the uploaded files and a generated description, then click **Generate Campaign**.
- **Customer Database**: contacts with company website, employee count, industry, and ticks for the products they buy. Add contacts one at a time or upload an Excel/CSV file (a template is available from the upload dialog); contacts are saved in the browser. When a campaign is started, everyone who doesn't buy that product is preselected; adjust the selection and click **Continue**.
- **Campaign preview**: a tailored message per selected contact, and **Approve and Launch Campaign**.

## Project layout

```
index.html       Page shell and navigation
css/styles.css   Herald theme
js/data.js       Placeholder products and sample customers
js/app.js        Views, routing, and campaign flow
```

## Placeholders to replace

- Product names and customer data in `js/data.js` (product names can also be renamed in the UI).
- `buildDescription` in `js/app.js`: currently summarises uploaded text files locally.
- `generateEmail` in `js/app.js`: currently a template based on job role. It will be replaced by the campaign skill using product documentation, company websites, and job roles.
- Launching a campaign prepares a downloadable CSV; email sending isn't connected.
