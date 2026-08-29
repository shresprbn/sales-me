// Quick-amount buttons for a quantity field, scaled to the item's unit —
// used both when adding an invoice line item and when logging a purchase.
const WEIGHT_PRESETS = { g: [200, 500, 1000, 2000], kg: [0.2, 0.5, 1, 2] }
const VOLUME_PRESETS = { ml: [200, 500, 1000, 2000], l: [0.2, 0.5, 1, 2], litre: [0.2, 0.5, 1, 2] }
const WEIGHT_LABELS = ['200g', '500g', '1kg', '2kg']
const VOLUME_LABELS = ['200ml', '500ml', '1l', '2l']
const COUNT_PRESETS = [1, 2, 5, 10]

export function qtyPresets(unit) {
  const u = (unit || 'pcs').toLowerCase()
  if (WEIGHT_PRESETS[u]) return WEIGHT_PRESETS[u].map((value, i) => ({ label: WEIGHT_LABELS[i], value }))
  if (VOLUME_PRESETS[u]) return VOLUME_PRESETS[u].map((value, i) => ({ label: VOLUME_LABELS[i], value }))
  return COUNT_PRESETS.map((value) => ({ label: String(value), value }))
}
