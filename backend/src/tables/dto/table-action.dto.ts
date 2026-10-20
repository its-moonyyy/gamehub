import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

export const TABLE_ACTION_TYPES = [
  'ready',
  'fold',
  'check',
  'call',
  'raise',
  'allin',
  'roll',
  'move',
  'play',
  'draw',
  'pass',
  'resign',
  'offer_draw',
  'accept_draw',
  'decline_draw',
  'call_uno',
  'catch_uno',
  'challenge_wf4',
] as const;

export type TableActionType = (typeof TABLE_ACTION_TYPES)[number];

export const DOMINOES_ENDS = ['left', 'right', 'start'] as const;

export type DominoesEnd = (typeof DOMINOES_ENDS)[number];

export const CHESS_PROMOTION_PIECES = ['q', 'r', 'b', 'n'] as const;

export type ChessPromotionPiece = (typeof CHESS_PROMOTION_PIECES)[number];

/** The colours a wild Uno card can take. */
export const UNO_CARD_COLORS = ['R', 'Y', 'G', 'B'] as const;

export type UnoCardColor = (typeof UNO_CARD_COLORS)[number];

export class TableActionDto {
  @IsIn(TABLE_ACTION_TYPES)
  type: TableActionType;

  /** Street-bet total for raise/bet actions, in cents. */
  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number;

  /** Which of your four Ludo tokens to move (0..3). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3)
  tokenId?: number;

  /** Which of your Dominoes tiles to play. */
  @IsOptional()
  @IsInt()
  @Min(0)
  tileId?: number;

  /** Dominoes: which open end the tile is played on. */
  @IsOptional()
  @IsIn(DOMINOES_ENDS)
  end?: DominoesEnd;

  /** Chess: the square the piece leaves, e.g. "e2". */
  @IsOptional()
  @Matches(/^[a-h][1-8]$/, { message: 'from must be a square like e2' })
  from?: string;

  /** Chess: the square the piece lands on, e.g. "e4". */
  @IsOptional()
  @Matches(/^[a-h][1-8]$/, { message: 'to must be a square like e4' })
  to?: string;

  /** Chess: the piece a pawn promotes to (defaults to a queen). */
  @IsOptional()
  @IsIn(CHESS_PROMOTION_PIECES)
  promotion?: ChessPromotionPiece;

  /** Uno: the card code being played, e.g. "R5" or "WF". */
  @IsOptional()
  @Matches(/^[RYGB][0-9SRD]$|^WF?$/, {
    message: 'card must be a card code like R5, GS or WF',
  })
  card?: string;

  /** Uno: the colour a wild card takes. */
  @IsOptional()
  @IsIn(UNO_CARD_COLORS)
  color?: UnoCardColor;

  /** Uno challenge_wf4: true = accept the WF4 (draw 4), false = challenge it. */
  @IsOptional()
  accept?: boolean;
}
