import type { CardDefinition } from '../registry.js';
import { registerCardSet } from '../registry.js';

function leader(cardId: string, name: string, color: string, life: number): CardDefinition {
  return { cardId, name, category: 'leader', color, cost: 0, power: 5000, counter: null, life, keywords: [] };
}

function character(
  cardId: string,
  name: string,
  color: string,
  cost: number,
  power: number,
  counter: number | null,
): CardDefinition {
  return { cardId, name, category: 'character', color, cost, power, counter, life: 0, keywords: [] };
}

function event(cardId: string, name: string, color: string, cost: number): CardDefinition {
  return { cardId, name, category: 'event', color, cost, power: 0, counter: null, life: 0, keywords: [] };
}

function stage(cardId: string, name: string, color: string, cost: number): CardDefinition {
  return { cardId, name, category: 'stage', color, cost, power: 0, counter: null, life: 0, keywords: [] };
}

// Synthetic vanilla set. The green half mirrors the red stat lines exactly so
// equal-power matchups are guaranteed; both leaders share power 5000 so
// leader-vs-leader ties exist. No 0-cost cards (bot termination relies on it).
//
// counter: null is the printed "—" — the card cannot be played in the Counter
// Step. Only 1000 and 2000 are real Counter values here.
export const TEST_CARDS: CardDefinition[] = [
  leader('TEST-L01', 'Red Leader', 'red', 5),
  leader('TEST-L02', 'Green Leader', 'green', 4),

  character('TEST-001', 'Red Recruit', 'red', 1, 2000, 1000),
  character('TEST-002', 'Red Lookout', 'red', 1, 0, 2000),
  character('TEST-003', 'Red Brawler', 'red', 2, 3000, 1000),
  character('TEST-004', 'Red Guard', 'red', 2, 2000, 2000),
  character('TEST-005', 'Red Duelist', 'red', 3, 4000, 2000),
  character('TEST-006', 'Red Champion', 'red', 4, 5000, 1000),
  character('TEST-007', 'Red Veteran', 'red', 5, 6000, 1000),
  character('TEST-008', 'Red Enforcer', 'red', 6, 7000, null),
  character('TEST-009', 'Red Titan', 'red', 8, 9000, null),
  character('TEST-010', 'Red Colossus', 'red', 10, 12000, null),
  event('TEST-011', 'Red Tactic', 'red', 1),
  event('TEST-012', 'Red Gambit', 'red', 3),
  stage('TEST-013', 'Red Harbor', 'red', 2),

  character('TEST-101', 'Green Recruit', 'green', 1, 2000, 1000),
  character('TEST-102', 'Green Lookout', 'green', 1, 0, 2000),
  character('TEST-103', 'Green Brawler', 'green', 2, 3000, 1000),
  character('TEST-104', 'Green Guard', 'green', 2, 2000, 2000),
  character('TEST-105', 'Green Duelist', 'green', 3, 4000, 2000),
  character('TEST-106', 'Green Champion', 'green', 4, 5000, 1000),
  character('TEST-107', 'Green Veteran', 'green', 5, 6000, 1000),
  character('TEST-108', 'Green Enforcer', 'green', 6, 7000, null),
  character('TEST-109', 'Green Titan', 'green', 8, 9000, null),
  character('TEST-110', 'Green Colossus', 'green', 10, 12000, null),
  event('TEST-111', 'Green Tactic', 'green', 1),
  event('TEST-112', 'Green Gambit', 'green', 3),
  stage('TEST-113', 'Green Harbor', 'green', 2),
];

registerCardSet(TEST_CARDS);
