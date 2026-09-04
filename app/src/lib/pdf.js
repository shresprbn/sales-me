import { jsPDF } from 'jspdf'
import { formatMoney } from './currency'

// Edit this to your actual business details — it's what shows in the
// letterhead at the top of every generated invoice PDF. Kept as a plain
// constant on purpose (no settings page/DB table) to keep this lightweight.
export const BUSINESS_INFO = {
  name: 'Kantipur Hardware Trade Link',
  address: 'Duwakot, Changunarayan-2, Bhaktapur',
  phone: '9843625922',
  email: '',
  vatNo: '119446944',
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function formatPrintTimestamp(ms) {
  const d = new Date(ms)
  const date = d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' })
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return `${date} ${time}`
}

// ── Amount in words (Indian/Nepali grouping — crore/lakh/thousand) ──────
const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
]
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function twoDigitsToWords(n) {
  if (n < 20) return ONES[n]
  const tens = TENS[Math.floor(n / 10)]
  const ones = n % 10
  return ones ? `${tens}-${ONES[ones]}` : tens
}

function threeDigitsToWords(n) {
  const parts = []
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred`)
    n %= 100
  }
  if (n > 0) parts.push(twoDigitsToWords(n))
  return parts.join(' ')
}

function numberToWords(num) {
  num = Math.floor(num)
  if (num === 0) return 'Zero'
  const crore = Math.floor(num / 10000000)
  num %= 10000000
  const lakh = Math.floor(num / 100000)
  num %= 100000
  const thousand = Math.floor(num / 1000)
  num %= 1000
  const hundred = num

  const parts = []
  if (crore) parts.push(`${threeDigitsToWords(crore)} Crore`)
  if (lakh) parts.push(`${threeDigitsToWords(lakh)} Lakh`)
  if (thousand) parts.push(`${threeDigitsToWords(thousand)} Thousand`)
  if (hundred) parts.push(threeDigitsToWords(hundred))
  return parts.join(' ')
}

function amountInWords(amount) {
  const rupees = Math.floor(amount)
  const paise = Math.round((amount - rupees) * 100)
  let words = `Rs. ${numberToWords(rupees)}`
  if (paise > 0) words += ` And ${numberToWords(paise)} Paise`
  return `${words} Only`
}

function billTypeFor(status) {
  if (status === 'paid') return 'Cash'
  if (status === 'void') return 'Void'
  return 'Credit'
}

const PAGE_W = 595.28
const MARGIN_X = 40
const RIGHT_X = 555

function drawTableHeader(doc, y) {
  doc.setFillColor(245, 246, 248)
  doc.setDrawColor(180)
  doc.rect(MARGIN_X, y, RIGHT_X - MARGIN_X, 20, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(80)
  doc.text('S.N.', MARGIN_X + 6, y + 14)
  doc.text('Particulars', MARGIN_X + 40, y + 14)
  doc.text('Qty', 388, y + 14, { align: 'right' })
  doc.text('Unit', 415, y + 14, { align: 'center' })
  doc.text('Rate', 480, y + 14, { align: 'right' })
  doc.text('Amount', RIGHT_X - 6, y + 14, { align: 'right' })
  return y + 20
}

export function buildInvoicePdf(invoice) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  let y = 42

  // ── Letterhead ──────────────────────────────────────────────────────
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(9)
  doc.setTextColor(100)
  doc.text('|| Shree Ganeshaya: Namah ||', PAGE_W / 2, y, { align: 'center' })
  y += 18

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(20)
  doc.text(BUSINESS_INFO.name, PAGE_W / 2, y, { align: 'center' })
  y += 16

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(70)
  doc.text(`Address: ${BUSINESS_INFO.address}`, PAGE_W / 2, y, { align: 'center' })
  y += 13
  const contactLine = BUSINESS_INFO.email
    ? `Ph No.: ${BUSINESS_INFO.phone}   Email: ${BUSINESS_INFO.email}`
    : `Ph No.: ${BUSINESS_INFO.phone}`
  doc.text(contactLine, PAGE_W / 2, y, { align: 'center' })

  // VAT No, boxed digits, top-left — same row as the business name block
  if (BUSINESS_INFO.vatNo) {
    const vatLabelY = 46
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(90)
    doc.text('VAT No.:', MARGIN_X, vatLabelY)
    const boxY = vatLabelY + 6
    const boxSize = 13
    doc.setDrawColor(130)
    doc.setFontSize(9)
    let bx = MARGIN_X
    for (const digit of String(BUSINESS_INFO.vatNo)) {
      doc.rect(bx, boxY, boxSize, boxSize)
      doc.setTextColor(20)
      doc.text(digit, bx + boxSize / 2, boxY + boxSize - 3.5, { align: 'center' })
      bx += boxSize
    }
  }

  y += 16
  doc.setDrawColor(20)
  doc.setLineWidth(1.1)
  doc.line(MARGIN_X, y, RIGHT_X, y)
  doc.setLineWidth(1)

  y += 18
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(20)
  doc.text('TAX INVOICE', PAGE_W / 2, y, { align: 'center' })
  y += 14

  // ── Customer Details / Bill Details boxes ────────────────────────────
  const boxTop = y
  const boxHeight = 92
  const boxGap = 10
  const boxWidth = (RIGHT_X - MARGIN_X - boxGap) / 2
  const leftBoxX = MARGIN_X
  const rightBoxX = MARGIN_X + boxWidth + boxGap

  doc.setDrawColor(150)
  doc.setLineWidth(0.75)
  doc.rect(leftBoxX, boxTop, boxWidth, boxHeight)
  doc.rect(rightBoxX, boxTop, boxWidth, boxHeight)

  let cy = boxTop + 15
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(110)
  doc.text('CUSTOMER DETAILS', leftBoxX + 8, cy)
  cy += 16
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(20)
  doc.text(invoice.customer_name || 'Walk-in customer', leftBoxX + 8, cy)
  cy += 15
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(70)
  if (invoice.customer_phone) {
    doc.text(`Ph No.: ${invoice.customer_phone}`, leftBoxX + 8, cy)
    cy += 13
  }
  if (invoice.customer_address) {
    doc.text(doc.splitTextToSize(invoice.customer_address, boxWidth - 16), leftBoxX + 8, cy)
  }

  let ry = boxTop + 18
  const labelX = rightBoxX + 8
  const valueX = rightBoxX + boxWidth - 8
  const billRows = [
    ['Bill No', invoice.invoice_number],
    ['Bill Date', formatDate(invoice.created_at || Date.now())],
    ['Bill Type', billTypeFor(invoice.status)],
  ]
  for (const [label, value] of billRows) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(90)
    doc.text(label, labelX, ry)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(20)
    doc.text(String(value), valueX, ry, { align: 'right' })
    ry += 18
  }

  y = boxTop + boxHeight + 20

  // ── Item table ────────────────────────────────────────────────────
  y = drawTableHeader(doc, y)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  const items = invoice.invoice_items || []
  items.forEach((item, i) => {
    if (y > 760) {
      doc.addPage()
      y = 48
      y = drawTableHeader(doc, y)
    }
    y += 20
    doc.setTextColor(20)
    doc.text(String(i + 1), MARGIN_X + 6, y - 6)
    doc.text(`${item.product_name} — ${item.variant_label}`, MARGIN_X + 40, y - 6)
    doc.text(String(item.qty), 388, y - 6, { align: 'right' })
    doc.text(item.unit || '', 415, y - 6, { align: 'center' })
    doc.text(formatMoney(item.unit_price).replace('Rs. ', ''), 480, y - 6, { align: 'right' })
    doc.text(formatMoney(item.line_total).replace('Rs. ', ''), RIGHT_X - 6, y - 6, { align: 'right' })
    doc.setDrawColor(210)
    doc.line(MARGIN_X, y, RIGHT_X, y)
  })
  // close the table's side/bottom borders
  const tableBottom = y
  doc.setDrawColor(180)
  doc.line(MARGIN_X, boxTop + boxHeight + 20, MARGIN_X, tableBottom)
  doc.line(RIGHT_X, boxTop + boxHeight + 20, RIGHT_X, tableBottom)

  y = tableBottom + 22

  if (y > 700) {
    doc.addPage()
    y = 48
  }

  // ── In words ──────────────────────────────────────────────────────
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(9.5)
  doc.setTextColor(60)
  doc.text(doc.splitTextToSize(`In Words: ${amountInWords(invoice.total)}`, 340), MARGIN_X, y)

  if (invoice.notes) {
    y += 26
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(110)
    doc.text('REMARKS', MARGIN_X, y)
    y += 13
    doc.setTextColor(60)
    doc.setFontSize(9.5)
    doc.text(doc.splitTextToSize(invoice.notes, 340), MARGIN_X, y)
  }

  // ── Totals box ────────────────────────────────────────────────────
  let ty = tableBottom + 16
  const totalsLabelX = 420
  const totalsRows = [['Basic Total', formatMoney(invoice.subtotal)]]
  if (Number(invoice.discount_amount) > 0) {
    const label = invoice.discount_type === 'percent' ? `Discount (${invoice.discount_value}%)` : 'Discount'
    totalsRows.push([label, `-${formatMoney(invoice.discount_amount)}`])
    totalsRows.push(['Taxable', formatMoney(Number(invoice.subtotal) - Number(invoice.discount_amount))])
  }
  if (Number(invoice.tax_percent) > 0) {
    totalsRows.push([`VAT @ ${invoice.tax_percent}%`, formatMoney(invoice.tax_amount)])
  }
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  for (const [label, value] of totalsRows) {
    doc.setTextColor(90)
    doc.text(label, totalsLabelX, ty)
    doc.setTextColor(20)
    doc.text(value, RIGHT_X - 6, ty, { align: 'right' })
    ty += 15
  }
  ty += 3
  doc.setDrawColor(150)
  doc.line(totalsLabelX - 10, ty, RIGHT_X, ty)
  ty += 18
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(20)
  doc.text('Net Total', totalsLabelX, ty)
  doc.text(formatMoney(invoice.total), RIGHT_X - 6, ty, { align: 'right' })

  y = Math.max(y, ty) + 34
  if (y > 740) {
    doc.addPage()
    y = 48
  }

  // ── Footer notes ──────────────────────────────────────────────────
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(110)
  const footerNotes = [
    '* Goods once sold will not be taken back.',
    '* For Credit Bills, please make sure to take Money Receipt for Payment made.',
    '* E&OE',
  ]
  footerNotes.forEach((line, i) => doc.text(line, MARGIN_X, y + i * 11))

  doc.setFontSize(8)
  doc.text(`Print Date & Time: ${formatPrintTimestamp(Date.now())}`, RIGHT_X, y, { align: 'right' })

  y += footerNotes.length * 11 + 34
  if (y > 780) {
    doc.addPage()
    y = 60
  }

  doc.setDrawColor(150)
  doc.setFontSize(9)
  doc.setTextColor(60)
  const signColW = (RIGHT_X - MARGIN_X) / 3
  const signLabels = ['Prepared By', 'Received By', `For ${BUSINESS_INFO.name}`]
  signLabels.forEach((label, i) => {
    const x0 = MARGIN_X + i * signColW
    doc.line(x0, y, x0 + signColW - 20, y)
    doc.text(label, x0, y + 12)
  })

  return doc
}

export function downloadInvoicePdf(invoice) {
  const doc = buildInvoicePdf(invoice)
  doc.save(`${invoice.invoice_number}.pdf`)
}
