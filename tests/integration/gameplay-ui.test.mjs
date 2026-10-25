import test from 'node:test';
import assert from 'node:assert/strict';
import { resourceSummary, corralSummary } from '../../src/ui/gameplay-data.js';
import { buildingCard } from '../../src/ui/building-card.js';
import { log } from '../../src/simulation/core/events.js';
import { calendarDate } from '../../src/simulation/ecology/climate.js';
import { DOMESTIC_SHEEP_DAILY_FEED, MEAT_NUTRITIONAL_VALUE } from '../../src/config/ecosystem.js';

const fixture = () => ({ day: 10, events: [], structures: [], animals: [], tiles: [],
  kingdoms: [{ id: 1, communityId: 2, satisfaction: .7, treasury: { stock: { food: 10, gold: 20 } }, market: { stock: { food: 5, gold: 8 } } }],
  communities: [{ id: 2, stores: { food: 3, meat: 2, feed: 8, gold: 1 } }],
  people: [{ id: 1, kingdomId: 1, alive: true, foodReserve: 20, energy: 50, hydration: 50, carriedGold: 2, militaryWallet: { stock: { gold: 4 } } }]
});
test('HUD counts food accounts once, separates personal points and counts human demographics', () => {
  const w = fixture();
  w.animals.push({ alive: false });
  w.people.push({ alive: false, kingdomId: null, deathKingdomId: 1, parents: [1, 2], birthKingdomId: 1 });
  const data = resourceSummary(w, 1);
  assert.equal(data.food, 18 + 2 * MEAT_NUTRITIONAL_VALUE);
  assert.equal(data.gold, 35);
  assert.equal(data.people, 1); assert.equal(data.births, 1); assert.equal(data.deaths, 1);
  assert.equal(data.hungry, 1); assert.equal(data.satisfaction, .7);
});
test('corral excludes nearby wild sheep and shows actual ration coverage and births', () => {
  const w = fixture(), pen = { id: 9, complete: true, type: 'curral', communityId: 2, herdBirths: 3, lastHerdBirthDay: 8 };
  w.structures.push(pen);
  w.animals.push({ speciesId: 'sheep', alive: true, herdCommunityId: 2 }, { speciesId: 'sheep', alive: true, herdCommunityId: null });
  const data = corralSummary(w, pen);
  assert.equal(data.sheep, 1); assert.equal(data.births, 3);
  assert.equal(data.dailyFeed, DOMESTIC_SHEEP_DAILY_FEED);
  assert.equal(data.feedDays, 8 / DOMESTIC_SHEEP_DAILY_FEED);
  assert.equal(data.foodProduced, 0);
  const html = buildingCard(w, pen);
  assert.match(html, /Comida produzida/); assert.doesNotMatch(html, /Custo|Localização/);
});
test('empty pen does not invent a feed runway or duplicate a community herd', () => {
  const w = fixture(), first = { id: 1, type: 'curral', complete: true, communityId: 2 }, second = { ...first, id: 2 };
  w.structures.push(first, second);
  w.animals.push({ speciesId: 'sheep', alive: true, herdCommunityId: 2 });
  assert.equal(corralSummary(w, second).sheep, 0);
  assert.equal(corralSummary(w, second).feedDays, null);
});
test('chronicle retains milestones beyond diagnostic ring and simplifies birth accounting', () => {
  const w = fixture();
  log(w, 'Nasceu Ana; foram transferidos 12 pontos de reservas.');
  for (let i = 0; i < 80; i++) log(w, 'Alimento vegetal: biomassa ' + i);
  assert.equal(w.events.length, 64); assert.equal(w.chronicle.length, 1);
  assert.equal(w.chronicle[0].text, 'Nasceu Ana.');
  log(w, 'O reino concluiu uma torre.');
  assert.equal(w.chronicle[0].category, 'Construção');
});
test('display calendar wraps at day 365 without changing absolute simulation time', () => {
  assert.equal(calendarDate(365).dayOfYear, 365);
  assert.equal(calendarDate(366).dayOfYear, 1);
  assert.equal(calendarDate(366).year, 2);
  assert.equal(calendarDate(4500).dayOfYear, 120);
});
