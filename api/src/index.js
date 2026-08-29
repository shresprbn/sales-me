// Sales / inventory / invoicing API for shop.shresprbn.com.
// Separate Cloudflare Worker + separate Supabase project from the
// blog/playground's backend — nothing here is shared with that codebase.
//
// This is a single-admin private tool, not a public site: every route
// except /auth/login requires a valid signed token (see requireAuth below).
// The frontend never talks to Supabase directly — it only ever talks to
// this Worker, which holds the service_role key as a secret.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const INVOICE_STATUSES = ['unpaid', 'paid', 'void']
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days — this is just for you, favor convenience over rotation

function cleanText(value, maxLen) {
  return String(value ?? '').trim().slice(0, maxLen)
}

function corsHeaders(origin, allowedOrigins) {
  const allow = allowedOrigins.includes(origin) ? origin : allowedOrigins[0]
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  }
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function supabaseHeaders(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  }
}

// page is 1-indexed. pageSize is capped so a bad/huge value from the
// client can't force one request to pull the whole table.
function parsePaging(url, defaultSize) {
  const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1)
  const pageSize = Math.min(500, Math.max(1, parseInt(url.searchParams.get('pageSize'), 10) || defaultSize))
  const offset = (page - 1) * pageSize
  return { page, pageSize, offset }
}

// Fetches one page via PostgREST's Range header and reads the total row
// count back out of Content-Range (via Prefer: count=exact), so the
// frontend can page through a table without ever pulling it all at once.
async function fetchPage(env, path, offset, pageSize) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: supabaseHeaders(env, { Prefer: 'count=exact', Range: `${offset}-${offset + pageSize - 1}` }),
  })
  if (!res.ok) return { ok: false }
  const range = res.headers.get('content-range') || '0-0/0'
  const total = Number(range.split('/')[1]) || 0
  return { ok: true, rows: await res.json(), total }
}

// A few callers (Stats' totals, the item pickers on New Invoice/Purchases
// that need to search the whole catalog) legitimately need everything, not
// one page of it — ?all=true opts out of pagination for those.
async function fetchAll(env, path) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { headers: supabaseHeaders(env) })
  if (!res.ok) return { ok: false }
  const rows = await res.json()
  return { ok: true, rows }
}

async function handleListPaged(env, headers, url, path, defaultSize) {
  if (url.searchParams.get('all') === 'true') {
    const { ok, rows } = await fetchAll(env, path)
    if (!ok) return null
    return { rows, total: rows.length, page: 1, pageSize: rows.length }
  }
  const { page, pageSize, offset } = parsePaging(url, defaultSize)
  const { ok, rows, total } = await fetchPage(env, path, offset, pageSize)
  if (!ok) return null
  return { rows, total, page, pageSize }
}

// ── Auth — one admin password, a signed opaque token, no user table ─────
// token shape: "<expiresAtMs>.<hex hmac of expiresAtMs>". Verifying just
// means recomputing the HMAC and checking it matches plus hasn't expired —
// no session storage needed anywhere.
async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function createToken(env) {
  const expiresAt = Date.now() + TOKEN_TTL_MS
  const sig = await hmacHex(env.ADMIN_TOKEN_SECRET, String(expiresAt))
  return { token: `${expiresAt}.${sig}`, expiresAt }
}

async function verifyToken(env, token) {
  if (!token || !token.includes('.')) return false
  const [expiresAtStr, sig] = token.split('.')
  const expiresAt = Number(expiresAtStr)
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false
  const expected = await hmacHex(env.ADMIN_TOKEN_SECRET, expiresAtStr)
  return timingSafeEqual(expected, sig)
}

async function requireAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  return verifyToken(env, token)
}

async function handleLogin(request, env, headers) {
  let payload
  try {
    payload = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, headers)
  }
  const password = String(payload.password || '')
  if (!env.ADMIN_PASSWORD || !timingSafeEqual(password, env.ADMIN_PASSWORD)) {
    return json({ error: 'Invalid password' }, 401, headers)
  }
  const { token, expiresAt } = await createToken(env)
  return json({ token, expiresAt }, 200, headers)
}

// ── Products + variants ──────────────────────────────────────────────
async function handleListProducts(env, headers, url) {
  const result = await handleListPaged(env, headers, url, 'products?select=*,product_variants(*)&order=name.asc', 25)
  if (!result) return json({ error: 'Could not load products' }, 502, headers)
  return json(result, 200, headers)
}

async function handleCreateProduct(request, env, headers) {
  let payload
  try {
    payload = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, headers)
  }

  const name = cleanText(payload.name, 200)
  if (!name) return json({ error: 'Product name is required' }, 400, headers)
  const category = cleanText(payload.category, 100)
  const description = cleanText(payload.description, 1000)
  const variants = Array.isArray(payload.variants) ? payload.variants : []

  const productRes = await fetch(`${env.SUPABASE_URL}/rest/v1/products`, {
    method: 'POST',
    headers: supabaseHeaders(env, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({ name, category: category || null, description: description || null }),
  })
  if (!productRes.ok) {
    const detail = await productRes.text()
    return json({ error: 'Could not create product', detail }, 502, headers)
  }
  const [product] = await productRes.json()

  const variantRows = variants
    .map((v) => ({
      product_id: product.id,
      variant_label: cleanText(v.variantLabel, 60),
      sku: cleanText(v.sku, 60) || null,
      unit: cleanText(v.unit, 20) || 'pcs',
      purchase_price: Number(v.purchasePrice) || 0,
      unit_price: Number(v.unitPrice),
      stock_qty: Number(v.stockQty) || 0,
      low_stock_threshold: Number(v.lowStockThreshold) || 0,
    }))
    .filter((v) => v.variant_label && Number.isFinite(v.unit_price) && v.unit_price >= 0)

  let insertedVariants = []
  if (variantRows.length) {
    const variantRes = await fetch(`${env.SUPABASE_URL}/rest/v1/product_variants`, {
      method: 'POST',
      headers: supabaseHeaders(env, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
      body: JSON.stringify(variantRows),
    })
    if (variantRes.ok) insertedVariants = await variantRes.json()
  }

  return json({ ...product, product_variants: insertedVariants }, 201, headers)
}

async function handleUpdateProduct(request, env, headers, id) {
  if (!UUID_RE.test(id)) return json({ error: 'Invalid product id' }, 400, headers)
  let payload
  try {
    payload = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, headers)
  }

  const fields = {}
  if (payload.name != null) fields.name = cleanText(payload.name, 200)
  if (payload.category != null) fields.category = cleanText(payload.category, 100) || null
  if (payload.description != null) fields.description = cleanText(payload.description, 1000) || null
  fields.updated_at = new Date().toISOString()

  const productRes = await fetch(`${env.SUPABASE_URL}/rest/v1/products?id=eq.${id}`, {
    method: 'PATCH',
    headers: supabaseHeaders(env, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify(fields),
  })
  if (!productRes.ok) return json({ error: 'Could not update product' }, 502, headers)
  const [product] = await productRes.json()
  if (!product) return json({ error: 'Product not found' }, 404, headers)

  // Variants: each entry with an id gets updated, entries without an id get
  // inserted as new variants. removedVariantIds get deleted outright.
  const variants = Array.isArray(payload.variants) ? payload.variants : []
  for (const v of variants) {
    const row = {
      variant_label: cleanText(v.variantLabel, 60),
      sku: cleanText(v.sku, 60) || null,
      unit: cleanText(v.unit, 20) || 'pcs',
      purchase_price: Number(v.purchasePrice) || 0,
      unit_price: Number(v.unitPrice),
      stock_qty: Number(v.stockQty) || 0,
      low_stock_threshold: Number(v.lowStockThreshold) || 0,
      updated_at: new Date().toISOString(),
    }
    if (!row.variant_label || !Number.isFinite(row.unit_price) || row.unit_price < 0) continue

    if (v.id && UUID_RE.test(v.id)) {
      await fetch(`${env.SUPABASE_URL}/rest/v1/product_variants?id=eq.${v.id}`, {
        method: 'PATCH',
        headers: supabaseHeaders(env, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(row),
      })
    } else {
      await fetch(`${env.SUPABASE_URL}/rest/v1/product_variants`, {
        method: 'POST',
        headers: supabaseHeaders(env, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ ...row, product_id: id }),
      })
    }
  }

  const removedIds = Array.isArray(payload.removedVariantIds) ? payload.removedVariantIds.filter((x) => UUID_RE.test(x)) : []
  for (const variantId of removedIds) {
    await fetch(`${env.SUPABASE_URL}/rest/v1/product_variants?id=eq.${variantId}`, {
      method: 'DELETE',
      headers: supabaseHeaders(env),
    })
  }

  const freshRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/products?id=eq.${id}&select=*,product_variants(*)`,
    { headers: supabaseHeaders(env) },
  )
  const [fresh] = freshRes.ok ? await freshRes.json() : [product]
  return json(fresh, 200, headers)
}

async function handleDeleteProduct(env, headers, id) {
  if (!UUID_RE.test(id)) return json({ error: 'Invalid product id' }, 400, headers)
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/products?id=eq.${id}`, {
    method: 'DELETE',
    headers: supabaseHeaders(env),
  })
  if (!res.ok) return json({ error: 'Could not delete product' }, 502, headers)
  return json({ ok: true }, 200, headers)
}

async function handleDeleteVariant(env, headers, id) {
  if (!UUID_RE.test(id)) return json({ error: 'Invalid variant id' }, 400, headers)
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/product_variants?id=eq.${id}`, {
    method: 'DELETE',
    headers: supabaseHeaders(env),
  })
  if (!res.ok) return json({ error: 'Could not delete variant' }, 502, headers)
  return json({ ok: true }, 200, headers)
}

// ── Invoices ──────────────────────────────────────────────────────────
async function handleListInvoices(env, headers, url) {
  const result = await handleListPaged(env, headers, url, 'invoices?select=*&order=created_at.desc', 25)
  if (!result) return json({ error: 'Could not load invoices' }, 502, headers)
  return json(result, 200, headers)
}

// Flat feed of every line item ever billed, with the parent invoice's
// status/date embedded — lets the frontend build a per-product sales
// breakdown without an N+1 fetch per invoice.
async function handleListInvoiceItems(env, headers) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/invoice_items?select=product_name,variant_label,unit,unit_price,qty,line_total,invoices(status,created_at)`,
    { headers: supabaseHeaders(env) },
  )
  if (!res.ok) return json({ error: 'Could not load invoice items' }, 502, headers)
  return json(await res.json(), 200, headers)
}

async function handleGetInvoice(env, headers, id) {
  if (!UUID_RE.test(id)) return json({ error: 'Invalid invoice id' }, 400, headers)
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/invoices?id=eq.${id}&select=*,invoice_items(*)`,
    { headers: supabaseHeaders(env) },
  )
  if (!res.ok) return json({ error: 'Could not load invoice' }, 502, headers)
  const [invoice] = await res.json()
  if (!invoice) return json({ error: 'Invoice not found' }, 404, headers)
  return json(invoice, 200, headers)
}

async function handleDeleteInvoice(env, headers, id, restock) {
  if (!UUID_RE.test(id)) return json({ error: 'Invalid invoice id' }, 400, headers)

  if (restock) {
    const itemsRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/invoice_items?invoice_id=eq.${id}&select=variant_id,qty`,
      { headers: supabaseHeaders(env) },
    )
    if (itemsRes.ok) {
      const items = await itemsRes.json()
      // Best-effort — the invoice still gets deleted below even if one of
      // these hiccups, same trade-off as the decrement on creation.
      await Promise.all(
        items
          .filter((it) => it.variant_id)
          .map((it) =>
            fetch(`${env.SUPABASE_URL}/rest/v1/rpc/increment_stock`, {
              method: 'POST',
              headers: supabaseHeaders(env, { 'Content-Type': 'application/json' }),
              body: JSON.stringify({ p_variant_id: it.variant_id, p_qty: it.qty }),
            }).catch(() => {}),
          ),
      )
    }
  }

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/invoices?id=eq.${id}`, {
    method: 'DELETE',
    headers: supabaseHeaders(env),
  })
  if (!res.ok) return json({ error: 'Could not delete invoice' }, 502, headers)
  return json({ ok: true, restocked: Boolean(restock) }, 200, headers)
}

async function nextInvoiceNumber(env) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/invoices?select=id`, {
    headers: supabaseHeaders(env, { Prefer: 'count=exact', Range: '0-0' }),
  })
  const range = res.headers.get('content-range') || '0/0'
  const total = Number(range.split('/')[1]) || 0
  return `INV-${String(total + 1).padStart(4, '0')}`
}

async function handleCreateInvoice(request, env, headers) {
  let payload
  try {
    payload = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, headers)
  }

  const items = Array.isArray(payload.items) ? payload.items : []
  if (!items.length) return json({ error: 'Invoice needs at least one item' }, 400, headers)

  const cleanItems = []
  for (const it of items) {
    const unitPrice = Number(it.unitPrice)
    const qty = Number(it.qty)
    const productName = cleanText(it.productName, 200)
    const variantLabel = cleanText(it.variantLabel, 60)
    if (!productName || !variantLabel || !Number.isFinite(unitPrice) || unitPrice < 0 || !Number.isFinite(qty) || qty <= 0) {
      return json({ error: 'Each item needs a valid product, variant, price, and quantity' }, 400, headers)
    }
    cleanItems.push({
      variant_id: it.variantId && UUID_RE.test(it.variantId) ? it.variantId : null,
      product_name: productName,
      variant_label: variantLabel,
      unit: cleanText(it.unit, 20) || 'pcs',
      unit_price: unitPrice,
      qty,
      line_total: Math.round(unitPrice * qty * 100) / 100,
    })
  }

  const subtotal = Math.round(cleanItems.reduce((sum, it) => sum + it.line_total, 0) * 100) / 100

  const discountType = payload.discountType === 'flat' ? 'flat' : 'percent'
  const discountValueRaw = Math.max(0, Number(payload.discountValue) || 0)
  const discountAmount =
    discountType === 'percent'
      ? Math.round(subtotal * (Math.min(100, discountValueRaw) / 100) * 100) / 100
      : Math.round(Math.min(discountValueRaw, subtotal) * 100) / 100
  const discountValue = discountType === 'percent' ? Math.min(100, discountValueRaw) : discountValueRaw
  const discounted = Math.round((subtotal - discountAmount) * 100) / 100

  const taxPercent = Math.max(0, Math.min(100, Number(payload.taxPercent) || 0))
  const taxAmount = Math.round(discounted * (taxPercent / 100) * 100) / 100
  const total = Math.round((discounted + taxAmount) * 100) / 100

  const invoiceRow = {
    invoice_number: await nextInvoiceNumber(env),
    customer_name: cleanText(payload.customerName, 200) || null,
    customer_phone: cleanText(payload.customerPhone, 40) || null,
    customer_address: cleanText(payload.customerAddress, 400) || null,
    subtotal,
    discount_type: discountType,
    discount_value: discountValue,
    discount_amount: discountAmount,
    tax_percent: taxPercent,
    tax_amount: taxAmount,
    total,
    notes: cleanText(payload.notes, 500) || null,
    status: 'unpaid',
  }

  let invoiceRes = await fetch(`${env.SUPABASE_URL}/rest/v1/invoices`, {
    method: 'POST',
    headers: supabaseHeaders(env, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify(invoiceRow),
  })
  if (invoiceRes.status === 409) {
    // Invoice number collided with a concurrent request — bump and retry once.
    invoiceRow.invoice_number = await nextInvoiceNumber(env)
    invoiceRes = await fetch(`${env.SUPABASE_URL}/rest/v1/invoices`, {
      method: 'POST',
      headers: supabaseHeaders(env, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
      body: JSON.stringify(invoiceRow),
    })
  }
  if (!invoiceRes.ok) {
    const detail = await invoiceRes.text()
    return json({ error: 'Could not create invoice', detail }, 502, headers)
  }
  const [invoice] = await invoiceRes.json()

  const itemRows = cleanItems.map((it) => ({ ...it, invoice_id: invoice.id }))
  const itemsRes = await fetch(`${env.SUPABASE_URL}/rest/v1/invoice_items`, {
    method: 'POST',
    headers: supabaseHeaders(env, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify(itemRows),
  })
  const insertedItems = itemsRes.ok ? await itemsRes.json() : []

  // Best-effort stock decrement per line item — an invoice already exists
  // at this point even if one of these calls hiccups, so failures here
  // don't roll back the sale, just leave stock counts slightly stale.
  await Promise.all(
    cleanItems
      .filter((it) => it.variant_id)
      .map((it) =>
        fetch(`${env.SUPABASE_URL}/rest/v1/rpc/decrement_stock`, {
          method: 'POST',
          headers: supabaseHeaders(env, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({ p_variant_id: it.variant_id, p_qty: it.qty }),
        }).catch(() => {}),
      ),
  )

  return json({ ...invoice, invoice_items: insertedItems }, 201, headers)
}

async function handleUpdateInvoiceStatus(request, env, headers, id) {
  if (!UUID_RE.test(id)) return json({ error: 'Invalid invoice id' }, 400, headers)
  let payload
  try {
    payload = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, headers)
  }
  const status = String(payload.status || '')
  if (!INVOICE_STATUSES.includes(status)) {
    return json({ error: `status must be one of ${INVOICE_STATUSES.join(', ')}` }, 400, headers)
  }

  // Voiding an invoice returns its items to stock — but only on the
  // transition INTO void, so flipping it back and forth can't double-credit
  // inventory.
  if (status === 'void') {
    const currentRes = await fetch(`${env.SUPABASE_URL}/rest/v1/invoices?id=eq.${id}&select=status`, {
      headers: supabaseHeaders(env),
    })
    const [current] = currentRes.ok ? await currentRes.json() : []
    if (current && current.status !== 'void') {
      const itemsRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/invoice_items?invoice_id=eq.${id}&select=variant_id,qty`,
        { headers: supabaseHeaders(env) },
      )
      if (itemsRes.ok) {
        const items = await itemsRes.json()
        await Promise.all(
          items
            .filter((it) => it.variant_id)
            .map((it) =>
              fetch(`${env.SUPABASE_URL}/rest/v1/rpc/increment_stock`, {
                method: 'POST',
                headers: supabaseHeaders(env, { 'Content-Type': 'application/json' }),
                body: JSON.stringify({ p_variant_id: it.variant_id, p_qty: it.qty }),
              }).catch(() => {}),
            ),
        )
      }
    }
  }

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/invoices?id=eq.${id}`, {
    method: 'PATCH',
    headers: supabaseHeaders(env, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
  })
  if (!res.ok) return json({ error: 'Could not update invoice' }, 502, headers)
  const [invoice] = await res.json()
  if (!invoice) return json({ error: 'Invoice not found' }, 404, headers)
  return json(invoice, 200, headers)
}

// ── Purchases ─────────────────────────────────────────────────────────
async function handleListPurchases(env, headers, url) {
  const result = await handleListPaged(env, headers, url, 'purchases?select=*&order=created_at.desc', 25)
  if (!result) return json({ error: 'Could not load purchases' }, 502, headers)
  return json(result, 200, headers)
}

async function handleCreatePurchase(request, env, headers) {
  let payload
  try {
    payload = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, headers)
  }

  const productName = cleanText(payload.productName, 200)
  const variantLabel = cleanText(payload.variantLabel, 60)
  const qty = Number(payload.qty)
  const costPrice = Number(payload.costPrice)
  if (!productName || !variantLabel || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(costPrice) || costPrice < 0) {
    return json({ error: 'A purchase needs a valid product, variant, quantity, and cost price' }, 400, headers)
  }
  const variantId = payload.variantId && UUID_RE.test(payload.variantId) ? payload.variantId : null

  const row = {
    variant_id: variantId,
    product_name: productName,
    variant_label: variantLabel,
    supplier: cleanText(payload.supplier, 200) || null,
    qty,
    cost_price: costPrice,
    total_cost: Math.round(qty * costPrice * 100) / 100,
    notes: cleanText(payload.notes, 500) || null,
  }

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/purchases`, {
    method: 'POST',
    headers: supabaseHeaders(env, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify(row),
  })
  if (!res.ok) {
    const detail = await res.text()
    return json({ error: 'Could not record purchase', detail }, 502, headers)
  }
  const [purchase] = await res.json()

  // Best-effort, same trade-off as invoice stock decrement — the purchase
  // record already exists even if one of these hiccups.
  if (variantId) {
    await Promise.all([
      fetch(`${env.SUPABASE_URL}/rest/v1/rpc/increment_stock`, {
        method: 'POST',
        headers: supabaseHeaders(env, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ p_variant_id: variantId, p_qty: qty }),
      }).catch(() => {}),
      fetch(`${env.SUPABASE_URL}/rest/v1/product_variants?id=eq.${variantId}`, {
        method: 'PATCH',
        headers: supabaseHeaders(env, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ purchase_price: costPrice, updated_at: new Date().toISOString() }),
      }).catch(() => {}),
    ])
  }

  return json(purchase, 201, headers)
}

export default {
  async fetch(request, env) {
    const allowedOrigins = (env.ALLOWED_ORIGINS || '').split(',').filter(Boolean)
    const origin = request.headers.get('Origin') || ''
    const headers = corsHeaders(origin, allowedOrigins)

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers })
    }

    const url = new URL(request.url)

    if (url.pathname === '/auth/login' && request.method === 'POST') {
      return handleLogin(request, env, headers)
    }

    // Everything below this line requires a valid admin token.
    if (!(await requireAuth(request, env))) {
      return json({ error: 'Unauthorized' }, 401, headers)
    }

    if (url.pathname === '/products' && request.method === 'GET') {
      return handleListProducts(env, headers, url)
    }
    if (url.pathname === '/products' && request.method === 'POST') {
      return handleCreateProduct(request, env, headers)
    }
    const productMatch = url.pathname.match(/^\/products\/([^/]+)$/)
    if (productMatch && request.method === 'PATCH') {
      return handleUpdateProduct(request, env, headers, productMatch[1])
    }
    if (productMatch && request.method === 'DELETE') {
      return handleDeleteProduct(env, headers, productMatch[1])
    }
    const variantMatch = url.pathname.match(/^\/variants\/([^/]+)$/)
    if (variantMatch && request.method === 'DELETE') {
      return handleDeleteVariant(env, headers, variantMatch[1])
    }

    if (url.pathname === '/invoices' && request.method === 'GET') {
      return handleListInvoices(env, headers, url)
    }
    if (url.pathname === '/invoice-items' && request.method === 'GET') {
      return handleListInvoiceItems(env, headers)
    }
    if (url.pathname === '/invoices' && request.method === 'POST') {
      return handleCreateInvoice(request, env, headers)
    }
    const invoiceMatch = url.pathname.match(/^\/invoices\/([^/]+)$/)
    if (invoiceMatch && request.method === 'GET') {
      return handleGetInvoice(env, headers, invoiceMatch[1])
    }
    if (invoiceMatch && request.method === 'DELETE') {
      return handleDeleteInvoice(env, headers, invoiceMatch[1], url.searchParams.get('restock') === 'true')
    }
    const invoiceStatusMatch = url.pathname.match(/^\/invoices\/([^/]+)\/status$/)
    if (invoiceStatusMatch && request.method === 'PATCH') {
      return handleUpdateInvoiceStatus(request, env, headers, invoiceStatusMatch[1])
    }

    if (url.pathname === '/purchases' && request.method === 'GET') {
      return handleListPurchases(env, headers, url)
    }
    if (url.pathname === '/purchases' && request.method === 'POST') {
      return handleCreatePurchase(request, env, headers)
    }

    return json({ error: 'Not found' }, 404, headers)
  },
}
