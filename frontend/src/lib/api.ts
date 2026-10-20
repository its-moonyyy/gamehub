import axios from 'axios'
import type {
  ChessPromotion,
  DominoesEnd,
  FriendsOverview,
  Game,
  PendingInvite,
  PlayerSearchResult,
  TableDetails,
  TableInvite,
  TableSummary,
  UnoColor,
  User,
  UserProfile,
} from './types'

const TOKEN_KEY = 'gamehub_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token)
  } else {
    localStorage.removeItem(TOKEN_KEY)
  }
}

// In development Vite proxies /api to the NestJS server. In production the
// frontend is served as a static site, so point it at the deployed API with
// VITE_API_URL (inlined at build time by Vite).
const apiBaseUrl = import.meta.env.VITE_API_URL?.replace(/\/$/, '') || '/api'

export const api = axios.create({ baseURL: apiBaseUrl })

api.interceptors.request.use((config) => {
  const token = getToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const url: string = error.config?.url ?? ''
    const isAuthRoute = url.startsWith('/auth/')
    if (error.response?.status === 401) {
      // A 401 on the session check (`/auth/me`) or on any data call means the
      // stored token is dead — drop it. Credential routes are the exception:
      // a wrong password on the login form must not sign you out of a session
      // that is still perfectly valid.
      if (!isAuthRoute || url.startsWith('/auth/me')) {
        setToken(null)
      }
      // Only data calls bounce you to the login screen; the boot-time session
      // check stays put and lets the router decide (a visitor with a stale
      // token should still be able to read the home page).
      if (!isAuthRoute && !window.location.pathname.startsWith('/login')) {
        window.location.assign('/login')
      }
    }
    return Promise.reject(error)
  },
)

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string | string[] } | undefined
    const message = data?.message
    if (Array.isArray(message)) return message.join(', ')
    if (typeof message === 'string') return message
    if (!error.response) return 'Cannot reach the server. Is the backend running?'
  }
  return fallback
}

/** The HTTP status of an API error, or undefined for network failures. */
export function getApiStatus(error: unknown): number | undefined {
  return axios.isAxiosError(error) ? error.response?.status : undefined
}

export interface AuthResponse {
  accessToken: string
  user: User
}

export interface RegisterInput {
  phoneNumber: string
  password: string
  displayName: string
}

export interface LoginInput {
  phoneNumber: string
  password: string
}

export interface ChangePasswordInput {
  currentPassword: string
  newPassword: string
}

export const authApi = {
  async register(input: RegisterInput): Promise<AuthResponse> {
    const { data } = await api.post<AuthResponse>('/auth/register', input)
    return data
  },

  async login(input: LoginInput): Promise<AuthResponse> {
    const { data } = await api.post<AuthResponse>('/auth/login', input)
    return data
  },

  async me(): Promise<User> {
    const { data } = await api.get<User>('/auth/me')
    return data
  },

  /** Changing the password requires the current one. */
  async changePassword(input: ChangePasswordInput): Promise<void> {
    await api.post('/auth/password', input)
  },
}

export interface UpdateProfileInput {
  displayName?: string
  phoneNumber?: string
}

export const usersApi = {
  /** The signed-in user plus the stats the profile page shows. */
  async me(): Promise<UserProfile> {
    const { data } = await api.get<UserProfile>('/users/me')
    return data
  },

  async update(input: UpdateProfileInput): Promise<User> {
    const { data } = await api.patch<User>('/users/me', input)
    return data
  },
}

export const gamesApi = {
  async list(): Promise<Game[]> {
    const { data } = await api.get<Game[]>('/games')
    return data
  },

  async get(slug: string): Promise<Game> {
    const { data } = await api.get<Game>(`/games/${slug}`)
    return data
  },
}

export interface CreateTableInput {
  name: string
  maxSeats?: number
  /** Chess only: an id from CHESS_TIME_CONTROLS, e.g. "3+2". */
  timeControl?: string
  /** In cents, e.g. 100 = $1. */
  smallBlind?: number
  bigBlind?: number
}

export type TableActionType =
  | 'ready'
  | 'fold'
  | 'check'
  | 'call'
  | 'raise'
  | 'allin'
  | 'roll'
  | 'move'
  | 'play'
  | 'draw'
  | 'pass'
  | 'resign'
  | 'offer_draw'
  | 'accept_draw'
  | 'decline_draw'
  | 'call_uno'
  | 'catch_uno'
  | 'challenge_wf4'

export const tablesApi = {
  async listByGame(slug: string): Promise<TableSummary[]> {
    const { data } = await api.get<TableSummary[]>(`/games/${slug}/tables`)
    return data
  },

  async create(slug: string, input: CreateTableInput): Promise<TableDetails> {
    const { data } = await api.post<TableDetails>(
      `/games/${slug}/tables`,
      input,
    )
    return data
  },

  async get(tableId: number | string): Promise<TableDetails> {
    const { data } = await api.get<TableDetails>(`/tables/${tableId}`)
    return data
  },

  async join(tableId: number | string): Promise<TableDetails> {
    const { data } = await api.post<TableDetails>(`/tables/${tableId}/join`)
    return data
  },

  /**
   * Ready up, or make a move: poker (fold / check / call / raise / all-in),
   * Ludo (roll / move a token), Dominoes (play / draw / pass), chess
   * (move a piece, resign) or Uno (play a card / draw / pass / call or
   * catch a missing UNO).
   */
  async act(
    tableId: number | string,
    action: {
      type: TableActionType
      amount?: number
      tokenId?: number
      tileId?: number
      end?: DominoesEnd
      from?: string
      to?: string
      promotion?: ChessPromotion
      card?: string
      color?: UnoColor
      /** Uno challenge_wf4: true = accept the WF4 (draw 4), false = challenge. */
      accept?: boolean
    },
  ): Promise<TableDetails> {
    const { data } = await api.post<TableDetails>(
      `/tables/${tableId}/action`,
      action,
    )
    return data
  },

  async leave(tableId: number | string): Promise<void> {
    await api.post(`/tables/${tableId}/leave`)
  },
}

export const friendsApi = {
  /** Friends, incoming requests and sent requests in one payload. */
  async overview(): Promise<FriendsOverview> {
    const { data } = await api.get<FriendsOverview>('/friends')
    return data
  },

  /** Finds players by name or phone; short queries answer with nobody. */
  async search(query: string): Promise<PlayerSearchResult[]> {
    const { data } = await api.get<PlayerSearchResult[]>('/friends/search', {
      params: { q: query },
    })
    return data
  },

  /** Sends a request — or accepts theirs, if they asked first. */
  async sendRequest(userId: number): Promise<FriendsOverview> {
    const { data } = await api.post<FriendsOverview>('/friends/requests', {
      userId,
    })
    return data
  },

  async acceptRequest(requestId: number): Promise<FriendsOverview> {
    const { data } = await api.post<FriendsOverview>(
      `/friends/requests/${requestId}/accept`,
    )
    return data
  },

  async declineRequest(requestId: number): Promise<FriendsOverview> {
    const { data } = await api.post<FriendsOverview>(
      `/friends/requests/${requestId}/decline`,
    )
    return data
  },

  /** Takes back a request you sent. */
  async cancelRequest(requestId: number): Promise<FriendsOverview> {
    const { data } = await api.delete<FriendsOverview>(
      `/friends/requests/${requestId}`,
    )
    return data
  },

  async remove(friendId: number): Promise<FriendsOverview> {
    const { data } = await api.delete<FriendsOverview>(`/friends/${friendId}`)
    return data
  },
}

export const invitesApi = {
  /** Open invitations addressed to you, newest first. */
  async listMine(): Promise<TableInvite[]> {
    const { data } = await api.get<TableInvite[]>('/invites')
    return data
  },

  /** The open invites on one table — the invite dialog's "Invited" state. */
  async listForTable(tableId: number | string): Promise<PendingInvite[]> {
    const { data } = await api.get<PendingInvite[]>(
      `/tables/${tableId}/invites`,
    )
    return data
  },

  /** Only friends can be invited; answers with the table's open invites. */
  async send(
    tableId: number | string,
    userId: number,
  ): Promise<PendingInvite[]> {
    const { data } = await api.post<PendingInvite[]>(
      `/tables/${tableId}/invites`,
      { userId },
    )
    return data
  },

  /** Seats you at the table and closes the invite. */
  async accept(inviteId: number): Promise<TableDetails> {
    const { data } = await api.post<TableDetails>(`/invites/${inviteId}/accept`)
    return data
  },

  async decline(inviteId: number): Promise<void> {
    await api.post(`/invites/${inviteId}/decline`)
  },
}
