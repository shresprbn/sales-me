// Nepali Rupee — used everywhere money is displayed, in the UI and on the
// generated PDF. Change this one function if that ever needs to differ.
export function formatMoney(amount) {
  return `Rs. ${Number(amount).toFixed(2)}`
}

// "Rs. 250.00/kg" for anything sold by weight/volume, "Rs. 250.00/pcs" for a
// plain fixed-pack item — always shows the unit so it's obvious which kind
// of variant you're looking at.
export function formatUnitPrice(amount, unit) {
  return `${formatMoney(amount)}/${unit || 'pcs'}`
}
