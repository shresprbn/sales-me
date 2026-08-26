// Nepali Rupee — used everywhere money is displayed, in the UI and on the
// generated PDF. Change this one function if that ever needs to differ.
export function formatMoney(amount) {
  return `Rs. ${Number(amount).toFixed(2)}`
}
