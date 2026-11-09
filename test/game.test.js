// Plays many all-bot games to make sure the rules engine always finishes and scores correctly.
const assert = require('assert');
const G = require('../game');

assert.strictEqual(G.sequenceFromFront([3, 9, 12, 2, 40]), 3);
assert.strictEqual(G.longestRun([1, 5, 6, 7, 8, 20]), 4);
assert.strictEqual(G.runBonus(3), 50);
assert.strictEqual(G.runBonus(7), 400);
assert.ok(G.isAscending([1, 2, 5, 9]));
assert.ok(!G.isAscending([1, 5, 5, 9]));

function checkWinner(room) {
  const w = room.players.find(p => p.id === room.roundResult.winnerId);
  assert.ok(G.isAscending(w.rack));
  if (room.players.length === 2) assert.ok(G.longestRun(w.rack) >= 3, 'two-player winner needs a run of 3');
}

for (let n = 2; n <= 4; n++) {
  for (let game = 0; game < 50; game++) {
    const room = { players: [], settings: { target: 500, bonus: game % 2 === 0 }, log: [] };
    for (let i = 0; i < n; i++) room.players.push({ id: 'p' + i, name: 'P' + i, score: 0, rack: [] });
    G.startGame(room);
    assert.strictEqual(room.maxCard, G.deckSizeFor(n));
    let steps = 0;
    while (room.phase !== 'gameOver') {
      if (room.phase === 'roundOver') { checkWinner(room); G.startRound(room); continue; }
      const p = G.currentPlayer(room);
      const plan = G.botPlan(room);
      if (plan.action === 'draw') G.draw(room, p.id, plan.from);
      else if (plan.action === 'place') G.place(room, p.id, plan.slot);
      else G.discardHeld(room, p.id);
      // Card conservation: every card is in exactly one place.
      const all = [...room.deck, ...room.discard, ...room.players.flatMap(x => x.rack), ...(room.held ? [room.held.card] : [])];
      assert.strictEqual(all.length, room.maxCard);
      assert.strictEqual(new Set(all).size, room.maxCard);
      assert.ok(++steps < 200000, 'game did not finish');
    }
    checkWinner(room);
    assert.ok(room.players.some(p => p.score >= 500));
  }
}
// Rule: discard-pile card must be placed, not discarded.
const r = { players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], settings: { target: 500, bonus: false }, log: [] };
G.startGame(r);
const first = G.currentPlayer(r).id;
G.draw(r, first, 'discard');
assert.throws(() => G.discardHeld(r, first), /must go in your rack/);
// Two-player rule: an in-order rack without a run of 3 does not win; with one it does.
const two = { players: [{ id: 'a' }, { id: 'b' }] };
const three = { players: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
assert.ok(!G.isWinningRack(two, [1, 3, 5, 7, 9, 11, 13, 15, 17, 19]));
assert.ok(G.isWinningRack(two, [1, 3, 5, 6, 7, 11, 13, 15, 17, 19]));
assert.ok(G.isWinningRack(three, [1, 3, 5, 7, 9, 11, 13, 15, 17, 19]));
console.log('All game tests passed ✓');
