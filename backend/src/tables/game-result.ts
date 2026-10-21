import type { TableGameState } from './table.entity.js';

export interface CompletedGame {
  gameNumber: number;
  participantIds: number[];
  winnerIds: number[];
  draw: boolean;
  summary: string;
}

/** Extracts public result facts only; private cards and tiles stay in the table. */
export function completedGame(
  slug: string,
  state: TableGameState | null,
): CompletedGame | null {
  if (!state?.lastResult) return null;

  switch (slug) {
    case 'poker': {
      const game = state as import('../poker/poker-engine.js').GameState;
      const result = game.lastResult;
      if (!result) return null;
      return {
        gameNumber: result.handNumber,
        participantIds: game.players.map((player) => player.userId),
        winnerIds: result.winners.map((winner) => winner.userId),
        draw: false,
        summary: `Hand ${result.handNumber}`,
      };
    }
    case 'ludo': {
      const game = state as import('../ludo/ludo-engine.js').LudoState;
      return {
        gameNumber: game.gameNumber,
        participantIds: game.lastResult!.homeCounts.map((player) => player.userId),
        winnerIds: [game.lastResult!.winnerUserId],
        draw: false,
        summary: 'Race finished',
      };
    }
    case 'dominoes': {
      const game = state as import('../dominoes/dominoes-engine.js').DominoesState;
      const result = game.lastResult!;
      return {
        gameNumber: game.gameNumber,
        participantIds: result.scores.map((player) => player.userId),
        winnerIds: result.winnerUserIds,
        draw: result.winnerUserIds.length > 1,
        summary: result.reason === 'blocked' ? 'Blocked round' : result.reason === 'forfeit' ? 'Opponent left' : 'Hand finished',
      };
    }
    case 'chess': {
      const game = state as import('../chess/chess-engine.js').ChessState;
      const result = game.lastResult!;
      return {
        gameNumber: game.gameNumber,
        participantIds: game.players.map((player) => player.userId),
        winnerIds: result.winnerUserId == null ? [] : [result.winnerUserId],
        draw: result.draw,
        summary: result.reason.replaceAll('-', ' '),
      };
    }
    case 'uno': {
      const game = state as import('../uno/uno-engine.js').UnoState;
      const result = game.lastResult!;
      return {
        gameNumber: game.gameNumber,
        participantIds: result.remaining.map((player) => player.userId),
        winnerIds: [result.winnerUserId],
        draw: false,
        summary: `${result.points} points`,
      };
    }
    default:
      return null;
  }
}
