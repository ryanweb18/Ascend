// Ascend — game rules engine (pure logic, no networking).
//
// Rules (based on the classic Rack-O card game):
//  - Deck: 2 players use cards 1–40, 3 players 1–50, 4 players 1–60.
//  - Each player is dealt 10 cards into slots in the order dealt; slots can never be rearranged.
//  - On your turn take the top discard OR the top card of the deck.
//      * A discard you take MUST go into your rack (replacing a card, which is discarded).
//      * A deck card can go into your rack, or be discarded straight away.
//  - First player whose rack runs low → high (slot 1 to slot 10) ends the round.
//  - Scoring: the winner gets 75. Everyone else gets 5 points per card that is in
//    ascending order counting up from slot 1 until the first break.
//  - Optional bonus: the round winner adds points for their longest run of consecutive
//    numbers: 3 → 50, 4 → 100, 5 → 200, 6+ → 400.
//  - First to the target score (500 by default) wins.

const crypto = require('crypto');

const RACK_SIZE = 10;
const COLORS = ['#c4493c', '#3d6a98', '#d4a03a', '#6f8a55'];

function deckSizeFor(playerCount) {
  if (playerCount <= 2) return 40;
  if (playerCount === 3) return 50;
  return 60;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function isAscending(rack) {
  for (let i = 1; i < rack.length; i++) if (rack[i] <= rack[i - 1]) return false;
  return true;
}

// Number of cards in ascending order starting from slot 1, until the first break.
function sequenceFromFront(rack) {
  if (!rack.length) return 0;
  let n = 1;
  for (let i = 1; i < rack.length; i++) {
    if (rack[i] > rack[i - 1]) n++;
    else break;
  }
  return n;
}

// Longest run of consecutive numbers sitting next to each other (e.g. 14, 15, 16).
function longestRun(rack) {
  let best = 1, cur = 1;
  for (let i = 1; i < rack.length; i++) {
    if (rack[i] === rack[i - 1] + 1) { cur++; best = Math.max(best, cur); } else cur = 1;
  }
  return best;
}

function runBonus(len) {
  if (len >= 6) return 400;
  if (len === 5) return 200;
  if (len === 4) return 100;
  if (len === 3) return 50;
  return 0;
}

class GameError extends Error {}

function currentPlayer(room) {
  return room.players[room.turn];
}

function log(room, text) {
  room.log.push({ t: Date.now(), text });
  if (room.log.length > 30) room.log.shift();
}

function startGame(room) {
  if (room.players.length < 2) throw new GameError('You need at least 2 players.');
  room.players.forEach((p, i) => { p.score = 0; p.color = COLORS[i % COLORS.length]; });
  room.round = 0;
  room.dealer = -1;
  room.winnerId = null;
  log(room, 'A new game begins.');
  startRound(room);
}

function startRound(room) {
  const n = room.players.length;
  room.maxCard = deckSizeFor(n);
  room.deck = shuffle(Array.from({ length: room.maxCard }, (_, i) => i + 1));
  room.players.forEach(p => { p.rack = []; });
  for (let i = 0; i < RACK_SIZE; i++) {
    for (const p of room.players) p.rack.push(room.deck.pop());
  }
  room.discard = [room.deck.pop()];
  room.dealer = (room.dealer + 1) % n;
  room.turn = (room.dealer + 1) % n;
  room.held = null;
  room.round += 1;
  room.phase = 'playing';
  room.roundResult = null;
  room.lastMove = null;
  room.moveSeq = (room.moveSeq || 0) + 1;
  // If somebody is dealt a perfect rack (astronomically rare) they still need to take a turn.
  log(room, `Round ${room.round}: ${currentPlayer(room).name} goes first.`);
}

function ensureDeck(room) {
  if (room.deck.length > 0) return;
  const top = room.discard.pop();
  room.deck = shuffle(room.discard);
  room.discard = top !== undefined ? [top] : [];
  log(room, 'The deck ran out — the discard pile was reshuffled.');
}

function assertTurn(room, playerId) {
  if (room.phase !== 'playing') throw new GameError('The round is not in progress.');
  if (currentPlayer(room).id !== playerId) throw new GameError("It's not your turn.");
}

function draw(room, playerId, from) {
  assertTurn(room, playerId);
  if (room.held) throw new GameError('You are already holding a card.');
  const p = currentPlayer(room);
  if (from === 'discard') {
    if (!room.discard.length) throw new GameError('The discard pile is empty.');
    room.held = { card: room.discard.pop(), from: 'discard' };
  } else if (from === 'deck') {
    ensureDeck(room);
    room.held = { card: room.deck.pop(), from: 'deck' };
  } else {
    throw new GameError('Unknown pile.');
  }
  room.moveSeq++;
  room.lastMove = { seq: room.moveSeq, type: 'draw', playerId: p.id, from };
}

function place(room, playerId, slot) {
  assertTurn(room, playerId);
  if (!room.held) throw new GameError('Draw a card first.');
  if (!Number.isInteger(slot) || slot < 0 || slot >= RACK_SIZE) throw new GameError('Invalid slot.');
  const p = currentPlayer(room);
  const old = p.rack[slot];
  p.rack[slot] = room.held.card;
  room.discard.push(old);
  const from = room.held.from;
  const card = room.held.card;
  room.held = null;
  room.moveSeq++;
  room.lastMove = {
    seq: room.moveSeq, type: 'place', playerId: p.id, from, slot, discarded: old,
    // A card taken from the discard pile was seen by everyone; a deck card stays secret.
    card: from === 'discard' ? card : null,
  };
  log(room, from === 'discard'
    ? `${p.name} took the ${card} and discarded the ${old}.`
    : `${p.name} drew from the deck and discarded the ${old}.`);
  endTurn(room);
}

function discardHeld(room, playerId) {
  assertTurn(room, playerId);
  if (!room.held) throw new GameError('Draw a card first.');
  if (room.held.from !== 'deck') throw new GameError('A card taken from the discard pile must go in your rack.');
  const p = currentPlayer(room);
  const card = room.held.card;
  room.discard.push(card);
  room.held = null;
  room.moveSeq++;
  room.lastMove = { seq: room.moveSeq, type: 'pass', playerId: p.id, discarded: card };
  log(room, `${p.name} drew the ${card} and discarded it.`);
  endTurn(room);
}

function endTurn(room) {
  const p = currentPlayer(room);
  if (isAscending(p.rack)) {
    endRound(room, p);
  } else {
    room.turn = (room.turn + 1) % room.players.length;
  }
}

function endRound(room, winner) {
  const results = room.players.map(p => {
    let points, bonus = 0, run = 0;
    if (p === winner) {
      run = longestRun(p.rack);
      bonus = room.settings.bonus ? runBonus(run) : 0;
      points = 75 + bonus;
    } else {
      points = 5 * sequenceFromFront(p.rack);
    }
    p.score += points;
    return { playerId: p.id, points, bonus, run, rack: p.rack.slice(), total: p.score };
  });
  room.roundResult = { winnerId: winner.id, results };
  log(room, `${winner.name} ascended! Round ${room.round} is over.`);

  const top = Math.max(...room.players.map(p => p.score));
  if (top >= room.settings.target) {
    // Highest score wins; ties go to whoever just won the round, then seat order.
    const leaders = room.players.filter(p => p.score === top);
    const champ = leaders.includes(winner) ? winner : leaders[0];
    room.winnerId = champ.id;
    room.phase = 'gameOver';
    log(room, `${champ.name} wins the game with ${champ.score} points!`);
  } else {
    room.phase = 'roundOver';
  }
}

// ---- Simple computer player -------------------------------------------------
// Splits the number range into 10 bands, one per slot. A card "belongs" in the slot
// for its band. Once every slot holds a card from its own band the rack is
// guaranteed to be ascending (bands don't overlap), so this always finishes.
function botPlan(room) {
  const p = currentPlayer(room);
  const band = room.maxCard / RACK_SIZE;
  const slotFor = v => Math.min(RACK_SIZE - 1, Math.floor((v - 1) / band));
  const fits = (s) => slotFor(p.rack[s]) === s;

  if (!room.held) {
    const top = room.discard[room.discard.length - 1];
    if (top !== undefined && !fits(slotFor(top))) return { action: 'draw', from: 'discard' };
    return { action: 'draw', from: 'deck' };
  }
  const v = room.held.card;
  const target = slotFor(v);
  if (!fits(target)) return { action: 'place', slot: target };
  // Already has a good card there. Try a neighbouring slot that keeps things ordered.
  for (const s of [target - 1, target + 1]) {
    if (s < 0 || s >= RACK_SIZE || fits(s)) continue;
    const below = s > 0 ? p.rack[s - 1] : 0;
    const above = s < RACK_SIZE - 1 ? p.rack[s + 1] : Infinity;
    if (v > below && v < above) return { action: 'place', slot: s };
  }
  if (room.held.from === 'deck') return { action: 'discard' };
  return { action: 'place', slot: target };
}

module.exports = {
  RACK_SIZE, GameError, deckSizeFor, isAscending, sequenceFromFront, longestRun, runBonus,
  startGame, startRound, draw, place, discardHeld, botPlan, currentPlayer, log,
};
