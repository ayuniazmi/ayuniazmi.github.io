# ayuniazmi.com

Personal site and progress tracker for the Business Analyst → Solutions Architect / FDE
journey. Static HTML/CSS/JS — no build step, no framework.

## Structure

```
index.html          Main site (Home, About, Projects, Journal, Resume, Contact)
cost-generator.html Project 01 — Architecture Cost & Tradeoff Generator
tracker.html        SA/FDE progress tracker (14-day launch, curriculum, projects, weekly ritual)
css/
  style.css         Styles for index.html
  cost-generator.css Styles for cost-generator.html
  tracker.css       Styles for tracker.html
js/
  main.js           Tab navigation for index.html
  cost-generator.js Pricing model, fit scoring, and rendering for cost-generator.html
  tracker.js        Tracker state, rendering, and persistence
favicon.svg         Shared favicon
```

The tracker persists progress to `localStorage` in the visitor's browser — it does not
sync across devices or save to a server.

The cost generator is a static, client-side estimator: it uses simplified public AWS
pricing baked into `cost-generator.js`, not a live pricing API, and is meant as an
architecture-reasoning demo rather than a real quote.

`rag-eval/` is a separate, self-contained Python project — Project 02, the RAG
Evaluation Framework — not part of the static site itself. See its own
[README](rag-eval/README.md) for what it does and how to run it.

`index.html` loads `css/style.css` and `js/main.js` with a `?v=N` cache-busting query
string. GitHub Pages' CDN caches assets aggressively, so **bump that version number any
time you edit `css/style.css` or `js/main.js`** — otherwise returning visitors can end up
with a stale copy of one file paired with a fresh copy of the other, which breaks in
confusing ways (e.g. new HTML/JS rendering against old CSS rules).

## Local preview

Open `index.html` directly in a browser, or serve the folder:

```
python3 -m http.server 8000
```

then visit `http://localhost:8000`.

## Deploying to GitHub Pages

1. Create a repo (e.g. `ayuniazmi.com` or `<username>.github.io`) and push this folder to it.
2. In the repo settings, enable **Pages** → deploy from the `main` branch, root folder.
3. (Optional) Point a custom domain at it via a `CNAME` file and DNS records.
