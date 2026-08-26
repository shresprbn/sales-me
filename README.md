# Shop — inventory & invoicing

A lightweight, single-admin inventory + invoicing tool for **shop.shresprbn.com**.
Completely separate from the `website-me` / `website-me-be` blog project — its
own Supabase project, its own Cloudflare Worker, its own domain.

```
sales-me/
  app/   — React + Vite frontend (the actual shop UI)
  api/   — Cloudflare Worker backend (talks to its own Supabase project)
```

Everything in this app is private. There's one admin password (no user
accounts, no signup) — see **Auth** below.

## 1. Create the Supabase project

1. Create a **new** Supabase project (do not reuse the blog's project — this
   should be fully separate, per your request).
2. Open the SQL editor and run `api/supabase/schema.sql` in full. It creates
   `products`, `product_variants`, `invoices`, `invoice_items`, a
   `decrement_stock()` helper function, and locks every table down with RLS
   and **zero** policies — anon/authenticated get no access at all. Only the
   Worker's service-role key can read or write.
3. From Project Settings → API, copy:
   - the **Project URL**
   - the **service_role** key (not the anon key — this app never uses anon)

## 2. Backend (Worker)

```bash
cd api
npm install
cp .dev.vars.example .dev.vars
```

Fill in `.dev.vars`:

- `SUPABASE_SERVICE_ROLE_KEY` — from step 1
- `ADMIN_PASSWORD` — the one password that logs into the whole app. Pick
  something real; it's stored as a Cloudflare secret, never committed.
- `ADMIN_TOKEN_SECRET` — any long random string (e.g. `openssl rand -hex 32`).
  Used to sign login tokens — changing it instantly logs everyone out.

Edit `wrangler.toml` and set `SUPABASE_URL` to your new project's URL.

Test locally:

```bash
npm run dev        # starts the Worker on http://localhost:8787
```

Deploy:

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put ADMIN_TOKEN_SECRET
npm run deploy
```

Then point a subdomain at it — e.g. **shop-api.shresprbn.com** — from the
Cloudflare dashboard: Workers & Pages → your worker → Settings → Domains &
Routes → Add Custom Domain. Update `ALLOWED_ORIGINS` in `wrangler.toml` if
your frontend domain changes, and redeploy.

## 3. Frontend (the actual shop UI)

```bash
cd app
npm install
cp .env.example .env.local   # set VITE_API_BASE_URL to your deployed Worker URL
npm run dev
```

Before your first invoice, edit `src/lib/pdf.js` → `BUSINESS_INFO` with your
real business name, address, phone, and email — that's what prints on every
invoice PDF's letterhead. There's no settings page on purpose; it's one
constant you edit once.

### Hosting on shop.shresprbn.com (GitHub Pages, same pattern as the blog)

This repo already includes `.github/workflows/deploy.yml` and
`app/public/CNAME` (set to `shop.shresprbn.com`), mirroring exactly how
`website-me` deploys to `shresprbn.com`. To wire it up:

1. Push this repo to GitHub, enable **Pages** in repo Settings → set source
   to **GitHub Actions**.
2. In repo Settings → Secrets and variables → Actions, add a secret
   `VITE_API_BASE_URL` set to your deployed Worker's URL (e.g.
`https://shop-api.shresprbn.com`).
3. Push to `main` — the workflow builds `app/` and deploys `app/dist` to
   Pages automatically.
4. In your DNS (wherever `shresprbn.com` is managed), add a `CNAME` record
   for `shop` pointing at your GitHub Pages hostname
   (`<username>.github.io`), same as the root domain's setup.

If you'd rather use Cloudflare Pages instead of GitHub Pages, that works too
— just set the build command to `npm run build` (from `app/`), output
directory `app/dist`, and add `VITE_API_BASE_URL` as a Pages environment
variable instead of a GitHub secret. Skip the CNAME file in that case.

## Auth

There's no user table — logging in just checks the submitted password
against the `ADMIN_PASSWORD` secret and, on success, issues a signed token
(HMAC over an expiry timestamp, verified with `ADMIN_TOKEN_SECRET`) that's
valid for 30 days. The frontend stores it in `localStorage` and sends it as
`Authorization: Bearer <token>` on every request. There's nothing to rotate
or revoke per-user since there's only the one account — if you ever need to
force a logout everywhere, just change `ADMIN_TOKEN_SECRET` and redeploy.

## Notes on the data model

- A **product** (e.g. "Fevicol") can have several **variants** (e.g. "1kg",
  "500g"), each with its own price and stock count — this is what the
  "fevicol 1kg / half kg" case maps to.
- Invoice line items **snapshot** the product name, variant label, and unit
  price at the moment of invoicing, so editing or deleting a product later
  never changes a past invoice's numbers.
- Stock is decremented atomically in Postgres (`decrement_stock()`) when an
  invoice is created, and never goes below zero. It's a best-effort
  deduction — an invoice still saves even if a stock update happens to fail.
- Invoice numbers are sequential (`INV-0001`, `INV-0002`, …), computed from
  the current row count with a one-time retry on collision. Fine for a
  single-admin tool; not built for high concurrent write volume.
