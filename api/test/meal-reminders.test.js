import test from 'node:test';
import assert from 'node:assert/strict';
import { dueMeals, mealKey } from '../meal-reminders.js';
import { mealReminderPush } from '../push-messages.js';

const meals = { on: true, items: [{ time: '08:00', label: 'Breakfast' }, { time: '12:30', label: 'Lunch' }] };

test('sends an item at its time and for the catch-up window after it', () => {
  assert.deepEqual(dueMeals(meals, { date: '2026-11-19', hhmm: '12:30' }), [meals.items[1]]);
  assert.equal(dueMeals(meals, { date: '2026-11-19', hhmm: '12:45' }).length, 1);
});

test('skips before the time and after the window', () => {
  assert.deepEqual(dueMeals(meals, { date: '2026-11-19', hhmm: '12:29' }), []);
  assert.deepEqual(dueMeals(meals, { date: '2026-11-19', hhmm: '12:46' }), []);
});

test('sends each item once per local date', () => {
  const now = { date: '2026-11-19', hhmm: '12:31' };
  const sent = { date: '2026-11-19', keys: [mealKey(meals.items[1])] };
  assert.deepEqual(dueMeals(meals, now, sent), []);
  // a record from yesterday does not suppress today
  assert.equal(dueMeals(meals, now, { date: '2026-11-18', keys: sent.keys }).length, 1);
});

test('is quiet when off, malformed, or the zone could not be resolved', () => {
  const now = { date: '2026-11-19', hhmm: '12:30' };
  assert.deepEqual(dueMeals({ ...meals, on: false }, now), []);
  assert.deepEqual(dueMeals({ on: true, items: 'x' }, now), []);
  assert.deepEqual(dueMeals({ on: true, items: [null, { time: 'noon' }] }, now), []);
  assert.deepEqual(dueMeals(meals, null), []);
});

test('meal push uses the label, with localized fallback', () => {
  assert.deepEqual(mealReminderPush('en', ' Lunch '), { title: '🍽️ Lunch', body: 'Log what you ate in openGym.', tag: 'meal-reminder' });
  assert.equal(mealReminderPush('pt-BR', '').title, 'Hora da refeição 🍽️');
});
