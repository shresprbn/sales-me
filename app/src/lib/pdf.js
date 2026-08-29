import { jsPDF } from 'jspdf'
import { formatMoney } from './currency'

// Edit this to your actual business details — it's what shows in the
// letterhead at the top of every generated invoice PDF. Kept as a plain
// constant on purpose (no settings page/DB table) to keep this lightweight.
export const BUSINESS_INFO = {
  name: 'Your Business Name',
  address: 'Your address, City',
  phone: '+977 00-0000000',
  email: 'you@example.com',
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function buildInvoicePdf(invoice) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const marginX = 48
  let y = 56

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text(BUSINESS_INFO.name, marginX, y)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(90)
  y += 18
  doc.text(BUSINESS_INFO.address, marginX, y)
  y += 14
  doc.text(`${BUSINESS_INFO.phone}  ·  ${BUSINESS_INFO.email}`, marginX, y)

  doc.setTextColor(20)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.text('INVOICE', 547, 56, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(90)
  doc.text(invoice.invoice_number, 547, 74, { align: 'right' })
  doc.text(formatDate(invoice.created_at || Date.now()), 547, 88, { align: 'right' })

  y += 36
  doc.setDrawColor(220)
  doc.line(marginX, y, 547, y)

  y += 24
  doc.setTextColor(120)
  doc.setFontSize(9)
  doc.text('BILL TO', marginX, y)
  y += 16
  doc.setTextColor(20)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text(invoice.customer_name || 'Walk-in customer', marginX, y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(90)
  if (invoice.customer_phone) {
    y += 14
    doc.text(invoice.customer_phone, marginX, y)
  }
  if (invoice.customer_address) {
    y += 14
    doc.text(doc.splitTextToSize(invoice.customer_address, 260), marginX, y)
    y += 12
  }

  y += 26
  doc.setFillColor(245, 246, 248)
  doc.rect(marginX, y, 547 - marginX, 20, 'F')
  doc.setFontSize(9)
  doc.setTextColor(90)
  doc.text('ITEM', marginX + 8, y + 14)
  doc.text('QTY', 380, y + 14, { align: 'right' })
  doc.text('PRICE', 460, y + 14, { align: 'right' })
  doc.text('TOTAL', 547 - 8, y + 14, { align: 'right' })
  y += 20

  doc.setTextColor(20)
  doc.setFontSize(10)
  const items = invoice.invoice_items || []
  for (const item of items) {
    y += 22
    if (y > 740) {
      doc.addPage()
      y = 56
    }
    doc.setFont('helvetica', 'normal')
    doc.text(`${item.product_name} — ${item.variant_label}`, marginX + 8, y)
    doc.text(`${item.qty} ${item.unit || ''}`.trim(), 380, y, { align: 'right' })
    doc.text(formatMoney(item.unit_price), 460, y, { align: 'right' })
    doc.text(formatMoney(item.line_total), 547 - 8, y, { align: 'right' })
    doc.setDrawColor(235)
    doc.line(marginX, y + 8, 547, y + 8)
  }

  y += 34
  const totalsX = 460
  doc.setFontSize(10)
  doc.setTextColor(90)
  doc.text('Subtotal', totalsX, y, { align: 'right' })
  doc.setTextColor(20)
  doc.text(formatMoney(invoice.subtotal), 547 - 8, y, { align: 'right' })

  if (Number(invoice.discount_amount) > 0) {
    y += 16
    doc.setTextColor(90)
    const label = invoice.discount_type === 'percent' ? `Discount (${invoice.discount_value}%)` : 'Discount'
    doc.text(label, totalsX, y, { align: 'right' })
    doc.setTextColor(20)
    doc.text(`-${formatMoney(invoice.discount_amount)}`, 547 - 8, y, { align: 'right' })
  }

  if (Number(invoice.tax_percent) > 0) {
    y += 16
    doc.setTextColor(90)
    doc.text(`Tax (${invoice.tax_percent}%)`, totalsX, y, { align: 'right' })
    doc.setTextColor(20)
    doc.text(formatMoney(invoice.tax_amount), 547 - 8, y, { align: 'right' })
  }

  y += 6
  doc.setDrawColor(200)
  doc.line(totalsX - 60, y + 6, 547, y + 6)
  y += 24
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text('Total', totalsX, y, { align: 'right' })
  doc.text(formatMoney(invoice.total), 547 - 8, y, { align: 'right' })

  if (invoice.notes) {
    y += 40
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(120)
    doc.text('NOTES', marginX, y)
    y += 14
    doc.setTextColor(60)
    doc.setFontSize(10)
    doc.text(doc.splitTextToSize(invoice.notes, 500), marginX, y)
  }

  return doc
}

export function downloadInvoicePdf(invoice) {
  const doc = buildInvoicePdf(invoice)
  doc.save(`${invoice.invoice_number}.pdf`)
}
