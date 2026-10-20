import { describe, expect, it } from 'vitest';
import {
  createDominoesState,
  DOMINOES_TILES,
  DominoesError,
  dominoesPips,
  dominoesTile,
  drawDominoes,
  everyoneDominoesReady,
  legalDominoesActions,
  leaveDominoes,
  markDominoesReady,
  movesForDominoes,
  passDominoes,
  playDominoes,
  startDominoes,
  tickDominoes,
  type DominoesPlayer,
  type DominoesState,
} from './dominoes-engine.js';

const TURN_MS = 45_000;

function seats(...userIds: number[]) {
  return userIds.map((userId, seatIndex) => ({ userId, seatIndex }));
}

function tileId(a: number, b: number): number {
  const tile = DOMINOES_TILES.find(
    (candidate) =>
      (candidate.a === a && candidate.b === b) ||
      (candidate.a === b && candidate.b === a),
  );
  if (!tile) throw new Error(`no tile ${a}-${b}`);
  return tile.id;
}

/** A state with the shuffle pinned, so every test starts from a known deal. */
function game(count = 2, now = 1_000): DominoesState {
  const state = createDominoesState();
  startDominoes(state, {
    seats: seats(...Array.from({ length: count }, (_, i) => i + 1)),
    turnMs: TURN_MS,
    now,
    random: () => 0.42,
  });
  return state;
}

function player(state: DominoesState, userId: number): DominoesPlayer {
  const found = state.players.find((candidate) => candidate.userId === userId);
  if (!found) {
    throw new Error(`no player ${userId}`);
  }
  return found;
}

describe('startDominoes', () => {
  it('deals seven tiles each and leaves fourteen in the boneyard', () => {
    const state = game(2);
    expect(state.phase).toBe('playing');
    expect(state.gameNumber).toBe(1);
    expect(state.players).toHaveLength(2);
    expect(state.players.map((p) => p.hand.length)).toEqual([7, 7]);
    expect(state.boneyard).toHaveLength(14);
    expect(state.chain).toEqual([]);

    const dealt = [
      ...state.players.flatMap((p) => p.hand),
      ...state.boneyard,
    ].sort((a, b) => a - b);
    expect(dealt).toHaveLength(28);
    expect(dealt).toEqual(DOMINOES_TILES.map((tile) => tile.id));
  });

  it('deals seven tiles each, whatever the table size', () => {
    const two = game(2);
    expect(two.players.map((p) => p.hand.length)).toEqual([7, 7]);
    expect(two.boneyard).toHaveLength(14);

    const three = game(3);
    expect(three.players.map((p) => p.hand.length)).toEqual([7, 7, 7]);
    expect(three.boneyard).toHaveLength(7);

    const four = game(4);
    expect(four.players.map((p) => p.hand.length)).toEqual([7, 7, 7, 7]);
    expect(four.boneyard).toHaveLength(0);
  });

  it('starts with the holder of the highest double', () => {
    const state = game(4);
    let expected: DominoesPlayer | null = null;
    for (let pip = 6; pip >= 0 && !expected; pip -= 1) {
      expected =
        state.players.find((candidate) =>
          candidate.hand.includes(tileId(pip, pip)),
        ) ?? null;
    }
    expect(expected).not.toBeNull();
    expect(state.turnUserId).toBe(expected?.userId);
    expect(state.turnDeadline).toBe(1_000 + TURN_MS);
  });

  it('refuses one player and more than four', () => {
    const state = createDominoesState();
    expect(() =>
      startDominoes(state, { seats: seats(1), turnMs: TURN_MS, now: 0 }),
    ).toThrow(DominoesError);
    expect(() =>
      startDominoes(state, {
        seats: seats(1, 2, 3, 4, 5),
        turnMs: TURN_MS,
        now: 0,
      }),
    ).toThrow(DominoesError);
  });
});

describe('playing tiles', () => {
  it('opens the chain with any tile', () => {
    const state = game(2);
    const starter = player(state, state.turnUserId ?? 0);
    const legal = legalDominoesActions(state, starter.userId);
    expect(legal?.moves).toHaveLength(starter.hand.length);
    expect(legal?.moves.every((move) => move.end === 'start')).toBe(true);
    expect(legal?.draw).toBe(false);
    expect(legal?.pass).toBe(false);

    const first = starter.hand[0];
    playDominoes(state, starter.userId, first, 'start', 1_100);
    const tile = dominoesTile(first);
    expect(state.chain).toEqual([
      { tileId: first, left: tile.a, right: tile.b },
    ]);
    expect(starter.hand).not.toContain(first);
    expect(state.turnUserId).not.toBe(starter.userId);
  });

  it('turns a matching half toward the chain on either end', () => {
    const state = game(2);
    state.chain = [{ tileId: tileId(3, 3), left: 3, right: 3 }];
    state.turnUserId = 1;
    player(state, 1).hand = [tileId(3, 5)];
    player(state, 2).hand = [tileId(0, 1)];

    playDominoes(state, 1, tileId(3, 5), 'left', 1_100);
    // The 3 faces the old chain, so 5 becomes the new left end.
    expect(state.chain[0]).toEqual({
      tileId: tileId(3, 5),
      left: 5,
      right: 3,
    });
    expect(state.chain[1]).toEqual({
      tileId: tileId(3, 3),
      left: 3,
      right: 3,
    });

    const stateRight = game(2);
    stateRight.chain = [
      { tileId: tileId(5, 5), left: 5, right: 5 },
      { tileId: tileId(3, 5), left: 5, right: 3 },
    ];
    stateRight.turnUserId = 1;
    player(stateRight, 1).hand = [tileId(3, 5)];
    player(stateRight, 2).hand = [tileId(0, 1)];
    playDominoes(stateRight, 1, tileId(3, 5), 'right', 1_100);
    // The 3 faces the old chain, so 5 becomes the new right end.
    expect(stateRight.chain[2]).toEqual({
      tileId: tileId(3, 5),
      left: 3,
      right: 5,
    });
  });

  it('offers both ends when a tile matches different open pips', () => {
    const state = game(2);
    state.chain = [
      { tileId: tileId(5, 5), left: 5, right: 5 },
      { tileId: tileId(3, 3), left: 5, right: 3 },
    ];
    state.turnUserId = 1;
    player(state, 1).hand = [tileId(3, 5)];
    const moves = movesForDominoes(state, player(state, 1));
    expect(moves).toEqual([
      { tileId: tileId(3, 5), end: 'left' },
      { tileId: tileId(3, 5), end: 'right' },
    ]);
  });

  it('refuses a tile that does not fit and a player off turn', () => {
    const state = game(2);
    state.chain = [{ tileId: tileId(6, 6), left: 6, right: 6 }];
    state.turnUserId = 1;
    player(state, 1).hand = [tileId(0, 1)];
    player(state, 2).hand = [tileId(6, 0)];

    expect(() =>
      playDominoes(state, 2, tileId(6, 0), 'left', 1_100),
    ).toThrow('It is not your turn');
    expect(() =>
      playDominoes(state, 1, tileId(0, 1), 'left', 1_100),
    ).toThrow('does not fit');
  });
});

describe('drawing and passing', () => {
  function stuck() {
    const state = game(2);
    state.chain = [{ tileId: tileId(6, 6), left: 6, right: 6 }];
    state.turnUserId = 1;
    player(state, 1).hand = [tileId(0, 1)];
    player(state, 2).hand = [tileId(2, 3)];
    state.boneyard = [tileId(6, 0), tileId(1, 2)];
    return state;
  }

  it('only draws when no tile fits', () => {
    const state = stuck();
    const legal = legalDominoesActions(state, 1);
    expect(legal).toEqual({ moves: [], draw: true, pass: false });

    const drawn = drawDominoes(state, 1, 1_100);
    expect(drawn.id).toBe(tileId(6, 0));
    expect(player(state, 1).hand).toContain(tileId(6, 0));
    expect(state.turnUserId).toBe(1);
    expect(state.turnDeadline).toBe(1_100 + TURN_MS);

    // The drawn six fits the chain now (both ends read six, so one choice).
    expect(movesForDominoes(state, player(state, 1))).toEqual([
      { tileId: tileId(6, 0), end: 'left' },
    ]);

    const state2 = stuck();
    player(state2, 1).hand = [tileId(6, 2)];
    expect(() => drawDominoes(state2, 1, 1_100)).toThrow(
      'Play a tile before drawing',
    );
  });

  it('will not pass while the boneyard still has tiles', () => {
    const state = stuck();
    expect(() => passDominoes(state, 1, 1_100)).toThrow(
      'Draw from the boneyard',
    );
  });

  it('passes when no tile fits and the boneyard is empty', () => {
    const state = stuck();
    state.boneyard = [];
    const legal = legalDominoesActions(state, 1);
    expect(legal).toEqual({ moves: [], draw: false, pass: true });
    passDominoes(state, 1, 1_100);
    expect(player(state, 1).lastAction).toBe('Passed');
    expect(state.turnUserId).toBe(2);
  });

  it('blocks the round after a full lap of passes and picks fewest pips', () => {
    const state = stuck();
    state.boneyard = [];
    player(state, 1).hand = [tileId(0, 1)];
    player(state, 2).hand = [tileId(5, 5)];
    passDominoes(state, 1, 1_100);
    expect(state.turnUserId).toBe(2);
    passDominoes(state, 2, 1_200);

    expect(state.phase).toBe('finished');
    expect(state.lastResult?.reason).toBe('blocked');
    expect(state.lastResult?.winnerUserIds).toEqual([1]);
    expect(state.lastResult?.scores).toEqual([
      { userId: 1, pips: 1 },
      { userId: 2, pips: 10 },
    ]);
    expect(state.turnUserId).toBeNull();
  });

  it('shares a blocked win on tied pips', () => {
    const state = stuck();
    state.boneyard = [];
    player(state, 1).hand = [tileId(0, 4)];
    player(state, 2).hand = [tileId(1, 3)];
    passDominoes(state, 1, 1_100);
    passDominoes(state, 2, 1_200);
    expect(state.lastResult?.winnerUserIds).toEqual([1, 2]);
  });
});

describe('winning', () => {
  it('finishes when a player plays their last tile', () => {
    const state = game(2);
    state.chain = [{ tileId: tileId(6, 6), left: 6, right: 6 }];
    state.turnUserId = 1;
    player(state, 1).hand = [tileId(6, 0)];
    player(state, 2).hand = [tileId(1, 2), tileId(3, 4)];

    playDominoes(state, 1, tileId(6, 0), 'left', 1_100);
    expect(state.phase).toBe('finished');
    expect(state.lastResult?.reason).toBe('hand');
    expect(state.lastResult?.winnerUserIds).toEqual([1]);
    expect(state.lastResult?.scores).toEqual([
      { userId: 1, pips: 0 },
      { userId: 2, pips: 10 },
    ]);
    expect(state.turnUserId).toBeNull();
    expect(state.turnDeadline).toBeNull();
  });
});

describe('timeouts', () => {
  it('plays the first legal tile when the clock runs out', () => {
    const state = game(2);
    const starter = state.turnUserId;
    state.turnDeadline = 1_000;
    expect(tickDominoes(state, 999)).toBe(false);
    expect(tickDominoes(state, 1_000)).toBe(true);
    expect(state.chain).toHaveLength(1);
    expect(state.turnUserId).not.toBe(starter);
  });

  it('draws until something fits, then plays it', () => {
    const state = game(2);
    state.chain = [{ tileId: tileId(6, 6), left: 6, right: 6 }];
    state.turnUserId = 1;
    player(state, 1).hand = [tileId(0, 1)];
    player(state, 2).hand = [tileId(2, 3)];
    state.boneyard = [tileId(1, 2), tileId(6, 0)];
    state.turnDeadline = 1_000;

    expect(tickDominoes(state, 1_000)).toBe(true);
    // The unplayable 1-2 was drawn and kept too, then 6-0 was played.
    expect(state.boneyard).toEqual([]);
    expect(player(state, 1).hand).toEqual([tileId(0, 1), tileId(1, 2)]);
    expect(state.chain.some((entry) => entry.tileId === tileId(6, 0))).toBe(
      true,
    );
  });
});

describe('leaving', () => {
  it('hands the turn on when the player to act leaves', () => {
    const state = game(3);
    state.turnUserId = 1;
    leaveDominoes(state, 1, 2_000);
    expect(state.players).toHaveLength(2);
    expect(state.turnUserId).toBe(2);
  });

  it('ends the round when only one player is left', () => {
    const state = game(2);
    leaveDominoes(state, 2, 2_000);
    expect(state.phase).toBe('finished');
    expect(state.lastResult?.reason).toBe('forfeit');
    expect(state.lastResult?.winnerUserIds).toEqual([1]);
    expect(state.turnUserId).toBeNull();
  });
});

describe('ready-up', () => {
  it('needs every seated player ready, with at least two seats', () => {
    const state = createDominoesState();
    expect(everyoneDominoesReady(state, [1, 2])).toBe(false);
    markDominoesReady(state, 1);
    expect(everyoneDominoesReady(state, [1, 2])).toBe(false);
    markDominoesReady(state, 2);
    expect(everyoneDominoesReady(state, [1, 2])).toBe(true);
    expect(everyoneDominoesReady(state, [1])).toBe(false);
  });

  it('counts pips on a hand', () => {
    expect(dominoesPips([tileId(6, 6), tileId(2, 3)])).toBe(17);
    expect(dominoesPips([])).toBe(0);
  });
});

describe('three-player games never draw from the boneyard', () => {
  function stuckThree() {
    const state = game(3);
    state.chain = [{ tileId: tileId(6, 6), left: 6, right: 6 }];
    state.turnUserId = 1;
    player(state, 1).hand = [tileId(0, 1)];
    player(state, 2).hand = [tileId(2, 3)];
    player(state, 3).hand = [tileId(4, 5)];
    state.boneyard = [tileId(6, 0), tileId(1, 2)];
    return state;
  }

  it('offers no draw and allows a pass even with a full boneyard', () => {
    const state = stuckThree();
    const legal = legalDominoesActions(state, 1);
    expect(legal).toEqual({ moves: [], draw: false, pass: true });
  });

  it('refuses a draw outright', () => {
    const state = stuckThree();
    expect(() => drawDominoes(state, 1, 1_100)).toThrow(
      'No draws in a three-player game',
    );
    // The boneyard is untouched.
    expect(state.boneyard).toHaveLength(2);
  });

  it('lets a player pass even though the boneyard still has tiles', () => {
    const state = stuckThree();
    passDominoes(state, 1, 1_100);
    expect(player(state, 1).lastAction).toBe('Passed');
    expect(state.turnUserId).toBe(2);
  });

  it('passes for whoever ran out of time, instead of drawing', () => {
    const state = stuckThree();
    state.turnDeadline = 0;
    tickDominoes(state, 1_000);
    expect(player(state, 1).lastAction).toBe('Passed');
    expect(state.turnUserId).toBe(2);
    expect(state.boneyard).toHaveLength(2);
  });
});
