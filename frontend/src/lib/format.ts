/** Formats a balance stored in cents, e.g. 250000 -> "$2,500.00". */
export function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100)
}

/** "Ada Lovelace" -> "AL" */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  const result = parts.map((part) => part.charAt(0).toUpperCase()).join('')
  return result || '?'
}

/** Strips spaces, dashes and parens from a phone number. */
export function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-()]/g, '')
}

/** Digits only, optional leading +, 9–15 digits — matches the API's DTO. */
export const PHONE_PATTERN = /^\+?[0-9]{9,15}$/

/** True when the typed number looks like a phone number the API accepts. */
export function isValidPhone(phone: string): boolean {
  return PHONE_PATTERN.test(normalizePhone(phone))
}

/** Formats chips without cents when whole, e.g. 100 -> "$1". */
function formatChips(cents: number): string {
  const dollars = cents / 100
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`
}

/** "100, 200" -> "$1/$2". Returns null when a game has no blinds. */
export function formatBlinds(
  smallBlind: number | null,
  bigBlind: number | null,
): string | null {
  if (smallBlind == null || bigBlind == null) return null
  return `${formatChips(smallBlind)} · ${formatChips(bigBlind)}`
}
