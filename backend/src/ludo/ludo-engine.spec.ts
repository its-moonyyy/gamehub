import { describe, expect, it } from 'vitest';
import {
  absoluteCell,
  capturesAt,
  createLudoState,
  everyoneLudoReady,
  homeCount,
  legalLudoActions,
  leaveLudo,
  LudoError,
  LUDO_HOME_STEP,
  LUDO_START_INDEX,
  markLudoReady,
  moveLudo,
  movesFor,
  rollLudo,
  startLudo,
  tickLudo,
  type LudoPlayer,
  type LudoState,
} from './ludo-engine.js';

const TURN_MS = 45_000;

function seats(...userIds: number[]) {
  return userIds.map((userId, seatIndex) => ({ userId, seatIndex }));
}

function game(count = 2, now = 1_000): LudoState {
  const state = createLudoState();
  startLudo(state, {
    seats: seats(...Array.from({ length: count }, (_, i) => i + 1)),
    turnMs: TURN_MS,
    now,
  });
  return state;
}

function player(state: LudoState, userId: number): LudoPlayer {
  const found = state.players.find((p) => p.userId === userId);
  if (!found) {
    throw new Error(`no player ${userId}`);
  }
  return found;
}

/** Progress that puts a token of `quadrant` on an absolute track cell. */
function stepsOnCell(quadrant: number, cell: number): number {
  return (cell - LUDO_START_INDEX[quadrant] + 52) % 52;
}

describe('startLudo', () => {
  it('seats two players opposite each other', () => {
    const state = game(2);
    expect(state.phase).toBe('playing');
    expect(state.players.map((p) => p.quadrant)).toEqual([0, 2]);
    expect(state.players[0].tokens).toHaveLength(4);
    expect(state.players[0].tokens.every((t) => t.steps === -1)).toBe(true);
    expect(state.turnUserId).toBe(1);
    expect(state.turnDeadline).toBe(1_000 + TURN_MS);
  });

  it('uses three and four quadrants for bigger tables', () => {
    expect(game(3).players.map((p) => p.quadrant)).toEqual([0, 1, 2]);
    expect(game(4).players.map((p) => p.quadrant)).toEqual([0, 1, 2, 3]);
  });

  it('rotates the starting player between games', () => {
    const state = game(4);
    expect(state.turnUserId).toBe(1);
    // Finish the first game, ready up again and check the next starter.
    for (const held of state.players[0].tokens) {
      held.steps = LUDO_HOME_STEP;
    }
    state.phase = 'finished';
    startLudo(state, { seats: seats(1, 2, 3, 4), turnMs: TURN_MS, now: 2_000 });
    expect(state.turnUserId).toBe(2);
    expect(state.gameNumber).toBe(2);
  });

  it('refuses one player and more than four', () => {
    const state = createLudoState();
    expect(() =>
      startLudo(state, { seats: seats(1), turnMs: TURN_MS, now: 0 }),
    ).toThrow(LudoError);
    expect(() =>
      startLudo(state, {
        seats: seats(1, 2, 3, 4, 5),
        turnMs: TURN_MS,
        now: 0,
      }),
    ).toThrow(LudoError);
  });
});

describe('rolling', () => {
  it('only lets a token leave the base on a six', () => {
    const state = game(2);
    rollLudo(state, 1, 1_100, 3);
    expect(state.dice).toBeNull();
    // No token could move, so the turn passed to the other player.
    expect(state.turnUserId).toBe(2);

    rollLudo(state, 2, 1_200, 6);
    expect(state.dice).toBe(6);
    const moves = movesFor(state, player(state, 2));
    expect(moves).toHaveLength(4);
    expect(moves.every((move) => move.steps === 0)).toBe(true);
  });

  it('gives another roll after a six', () => {
    const state = game(2);
    rollLudo(state, 1, 1_100, 6);
    moveLudo(state, 1, 0, 1_200);
    expect(state.turnUserId).toBe(1);
    expect(state.dice).toBeNull();
    expect(absoluteCell(0, player(state, 1).tokens[0].steps)).toBe(12);
  });

  it('passes the turn after a normal move', () => {
    const state = game(2);
    rollLudo(state, 1, 1_100, 6);
    moveLudo(state, 1, 0, 1_200);
    rollLudo(state, 1, 1_300, 4);
    moveLudo(state, 1, 0, 1_400);
    expect(state.turnUserId).toBe(2);
    expect(absoluteCell(0, player(state, 1).tokens[0].steps)).toBe(16);
  });

  it('loses the turn on three sixes in a row', () => {
    const state = game(2);
    for (let roll = 0; roll < 2; roll += 1) {
      rollLudo(state, 1, 1_100 + roll * 100, 6);
      moveLudo(state, 1, 0, 1_150 + roll * 100);
    }
    rollLudo(state, 1, 1_500, 6);
    expect(state.players[0].lastAction).toBe('Three sixes — turn lost');
    expect(state.turnUserId).toBe(2);
    expect(state.dice).toBeNull();
  });

  it('refuses to roll twice and to move without a roll', () => {
    const state = game(2);
    expect(() => moveLudo(state, 1, 0, 1_100)).toThrow('Roll the dice first');
    rollLudo(state, 1, 1_100, 6);
    expect(() => rollLudo(state, 1, 1_200, 2)).toThrow(
      'Move a token before rolling again',
    );
    expect(() => rollLudo(state, 2, 1_200, 2)).toThrow('It is not your turn');
    expect(() => moveLudo(state, 1, 0, 1_200)).not.toThrow();
  });
});

describe('home column', () => {
  it('needs the exact roll to come home', () => {
    const state = game(2);
    const tokens = player(state, 1).tokens;
    tokens[0].steps = 51;

    rollLudo(state, 1, 1_100, 6);
    expect(movesFor(state, player(state, 1)).some((m) => m.tokenId === 0)).toBe(
      true,
    );
    moveLudo(state, 1, 0, 1_200);
    expect(tokens[0].steps).toBe(LUDO_HOME_STEP);
    expect(homeCount(player(state, 1))).toBe(1);

    // A token one step short needs a one, six would overshoot.
    tokens[1].steps = 56;
    rollLudo(state, 1, 1_300, 6);
    expect(movesFor(state, player(state, 1)).some((m) => m.tokenId === 1)).toBe(
      false,
    );
    // The token that is still in the base keeps the six useful.
    expect(movesFor(state, player(state, 1)).some((m) => m.tokenId === 2)).toBe(
      true,
    );
  });

  it('never enters the home column of another quadrant', () => {
    const state = game(2);
    const tokens = player(state, 1).tokens;
    tokens[0].steps = 51;
    rollLudo(state, 1, 1_100, 1);
    moveLudo(state, 1, 0, 1_200);
    expect(tokens[0].steps).toBe(52);
    expect(absoluteCell(0, tokens[0].steps)).toBeNull();
  });
});

describe('captures', () => {
  it('sends an opponent token on the same cell back to its base', () => {
    const state = game(2);
    const mine = player(state, 1).tokens;
    const theirs = player(state, 2).tokens;
    // Both quadrants on cell 20 (= start + 8, but also a star square: skip it)
    const cell = 22;
    mine[0].steps = stepsOnCell(0, cell) - 3;
    theirs[0].steps = stepsOnCell(2, cell);

    rollLudo(state, 1, 1_100, 3);
    const move = movesFor(state, player(state, 1)).find(
      (m) => m.tokenId === 0,
    );
    expect(move?.capture).toBe(true);
    moveLudo(state, 1, 0, 1_200);
    expect(theirs[0].steps).toBe(-1);
    // A capture earns another roll.
    expect(state.turnUserId).toBe(1);
    expect(state.players[0].lastAction).toBe('Captured a token!');
  });

  it('leaves tokens alone on star squares and in home columns', () => {
    const state = game(2);
    const mine = player(state, 1).tokens;
    const theirs = player(state, 2).tokens;
    const safe = 20;
    mine[0].steps = stepsOnCell(0, safe) - 2;
    theirs[0].steps = stepsOnCell(2, safe);

    expect(capturesAt(state, player(state, 1), stepsOnCell(0, safe))).toEqual(
      [],
    );
    rollLudo(state, 1, 1_100, 2);
    moveLudo(state, 1, 0, 1_200);
    expect(theirs[0].steps).toBe(stepsOnCell(2, safe));
    expect(state.turnUserId).toBe(2);

    // Home column tokens are untouchable too.
    expect(capturesAt(state, player(state, 2), 53)).toEqual([]);
  });
});

describe('winning', () => {
  it('finishes when all four tokens are home', () => {
    const state = game(2);
    const tokens = player(state, 1).tokens;
    tokens[0].steps = LUDO_HOME_STEP;
    tokens[1].steps = LUDO_HOME_STEP;
    tokens[2].steps = LUDO_HOME_STEP;
    tokens[3].steps = 56;

    rollLudo(state, 1, 1_100, 1);
    moveLudo(state, 1, 3, 1_200);

    expect(state.phase).toBe('finished');
    expect(state.lastResult?.winnerUserId).toBe(1);
    expect(state.turnUserId).toBeNull();
    expect(state.dice).toBeNull();
    expect(homeCount(player(state, 1))).toBe(4);
  });
});

describe('timeouts', () => {
  it('rolls for a player who ran out of time', () => {
    const state = game(2);
    let rolled = 0;
    const random = () => (rolled++ === 0 ? 0.5 : 0.9); // 4 then 6
    expect(tickLudo(state, 1_000 + TURN_MS - 1, random)).toBe(false);
    expect(tickLudo(state, 1_000 + TURN_MS, random)).toBe(true);
    expect(state.lastRoll).toBe(4);
    expect(state.turnUserId).toBe(2);
  });

  it('moves the first legal token when the roll times out', () => {
    const state = game(2);
    rollLudo(state, 1, 1_100, 6);
    const deadline = state.turnDeadline;
    expect(deadline).not.toBeNull();
    expect(tickLudo(state, deadline ?? 0, () => 0.9)).toBe(true);
    const tokens = player(state, 1).tokens;
    expect(tokens[0].steps).toBe(0);
    // A six keeps the turn, waiting for the next roll.
    expect(state.turnUserId).toBe(1);
    expect(state.dice).toBeNull();
  });
});

describe('leaving', () => {
  it('hands the turn on when the player to act leaves', () => {
    const state = game(3);
    leaveLudo(state, 1, 2_000);
    expect(state.players).toHaveLength(2);
    expect(state.turnUserId).toBe(2);
  });

  it('ends the game when only one player is left', () => {
    const state = game(2);
    leaveLudo(state, 2, 2_000);
    expect(state.phase).toBe('finished');
    expect(state.lastResult?.winnerUserId).toBe(1);
    expect(state.turnUserId).toBeNull();
  });
});

describe('ready-up and legality', () => {
  it('needs every seated player ready', () => {
    const state = createLudoState();
    expect(everyoneLudoReady(state, [1, 2])).toBe(false);
    markLudoReady(state, 1);
    expect(everyoneLudoReady(state, [1, 2])).toBe(false);
    markLudoReady(state, 2);
    expect(everyoneLudoReady(state, [1, 2])).toBe(true);
    // One player alone can never start a game.
    expect(everyoneLudoReady(state, [1])).toBe(false);
  });

  it('only offers actions to the player on the clock', () => {
    const state = game(2);
    expect(legalLudoActions(state, 2)).toBeNull();
    expect(legalLudoActions(state, 1)).toEqual({
      roll: true,
      dice: null,
      moves: [],
    });
    rollLudo(state, 1, 1_100, 6);
    const legal = legalLudoActions(state, 1);
    expect(legal?.roll).toBe(false);
    expect(legal?.moves).toHaveLength(4);
  });
});
