/**
 * Table defaults from the settings page. These are a browser preference, not
 * account data: they only prefill the create-table dialog on this device.
 */
const STORAGE_KEY = 'gamehub_table_defaults'

/** Seat counts above this are ignored (no game has more seats). */
const MAX_SEATS = 8
const MAX_BLIND = 1_000_000

export interface TableDefaults {
  /** Preferred seat count; the dialog clamps it to the game's maximum. */
  maxSeats?: number
  /** Dollars, exactly as the create-table dialog shows them (poker only). */
  smallBlind?: number
  bigBlind?: number
}

function asSeats(value: unknown): number | undefined {
  const seats = Number(value)
  if (!Number.isInteger(seats) || seats < 2) return undefined
  return Math.min(seats, MAX_SEATS)
}

function asBlind(value: unknown): number | undefined {
  const blind = Number(value)
  if (!Number.isFinite(blind) || blind < 0) return undefined
  return Math.min(blind, MAX_BLIND)
}

/** Stored defaults, sanitised — a broken store never breaks a form. */
export function getTableDefaults(): TableDefaults {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return {}
  }
  if (!raw) return {}

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const record = parsed as Record<string, unknown>

    const defaults: TableDefaults = {}
    const maxSeats = asSeats(record.maxSeats)
    if (maxSeats !== undefined) defaults.maxSeats = maxSeats
    const smallBlind = asBlind(record.smallBlind)
    if (smallBlind !== undefined) defaults.smallBlind = smallBlind
    const bigBlind = asBlind(record.bigBlind)
    if (bigBlind !== undefined) defaults.bigBlind = bigBlind
    return defaults
  } catch {
    return {}
  }
}

/** Saves the defaults; an empty object clears them again. */
export function saveTableDefaults(defaults: TableDefaults): void {
  try {
    if (Object.keys(defaults).length === 0) {
      localStorage.removeItem(STORAGE_KEY)
      return
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults))
  } catch {
    // Private mode: the preference simply does not stick.
  }
}
