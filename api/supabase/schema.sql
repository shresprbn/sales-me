-- Sales / inventory / invoicing schema for shop.shresprbn.com.
-- This is a brand new, separate Supabase project from the one behind the
-- blog/playground — nothing here is shared with that database.
--
-- Everything in this app is private (single admin login), so unlike the
-- blog's tables, NOTHING here gets an anon-read policy. RLS is enabled with
-- zero policies on every table, meaning anon/authenticated get no access at
-- all — only the Worker's SUPABASE_SERVICE_ROLE_KEY (which bypasses RLS)
-- can read or write. The frontend never talks to Supabase directly; every
-- request goes through the Worker, which checks the admin login token first.

create extension if not exists pgcrypto;

-- A product is the thing you sell in general (e.g. "Fevicol"); each product
-- can have one or more variants (e.g. "1kg", "500g", "200ml") that carry
-- their own price and stock count.
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  variant_label text not null, -- "1kg", "500g", "Small", etc.
  sku text,
  -- What unit_price is *per* — "pcs" for a fixed pack/piece, or "kg"/"g"/"l"
  -- for something sold by loose weight/volume (price per kg, sold as
  -- however many grams or kilos the customer wants). Free text on purpose,
  -- purely for display and to size the invoice quantity field sensibly —
  -- nothing in the backend branches on specific values.
  unit text not null default 'pcs',
  unit_price numeric(10,2) not null check (unit_price >= 0),
  stock_qty numeric(10,2) not null default 0 check (stock_qty >= 0),
  low_stock_threshold numeric(10,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists product_variants_product_idx on product_variants (product_id);

-- One row per invoice. Line items snapshot the product/variant name and
-- unit price at the time of invoicing, so editing or deleting a product
-- later never changes a past invoice's numbers.
create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  customer_name text,
  customer_phone text,
  customer_address text,
  subtotal numeric(10,2) not null default 0,
  tax_percent numeric(5,2) not null default 0,
  tax_amount numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  notes text,
  status text not null default 'unpaid' check (status in ('unpaid', 'paid', 'void')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists invoices_created_idx on invoices (created_at desc);

create table if not exists invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  variant_id uuid references product_variants(id) on delete set null,
  product_name text not null,
  variant_label text not null,
  unit text not null default 'pcs', -- snapshotted alongside price/label, same reasoning
  unit_price numeric(10,2) not null,
  qty numeric(10,2) not null check (qty > 0),
  line_total numeric(10,2) not null
);

create index if not exists invoice_items_invoice_idx on invoice_items (invoice_id);

-- Called once per line item when an invoice is created, so the stock
-- decrement happens atomically in the database instead of a
-- read-then-write from the Worker (which would race under concurrent
-- invoices). Never lets stock go negative.
create or replace function decrement_stock(p_variant_id uuid, p_qty numeric)
returns void
language sql
as $$
  update product_variants
  set stock_qty = greatest(0, stock_qty - p_qty),
      updated_at = now()
  where id = p_variant_id;
$$;

-- The reverse of decrement_stock — used when an invoice is deleted and you
-- choose to put its items back into inventory.
create or replace function increment_stock(p_variant_id uuid, p_qty numeric)
returns void
language sql
as $$
  update product_variants
  set stock_qty = stock_qty + p_qty,
      updated_at = now()
  where id = p_variant_id;
$$;

alter table products enable row level security;
alter table product_variants enable row level security;
alter table invoices enable row level security;
alter table invoice_items enable row level security;
-- No policies on any of the four tables on purpose: anon/authenticated get
-- zero access. Only the Worker's service_role key touches this data.
