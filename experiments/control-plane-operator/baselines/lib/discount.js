/** Intentionally incomplete discount rules. */
export function discountAmount(price) {
  if (price > 200) return price * 0.05;
  return 0;
}
