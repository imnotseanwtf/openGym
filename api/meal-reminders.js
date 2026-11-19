// Meal reminders: "log your meal" pushes at times the user picks (S.meals), independent of the
// workout-day reminder. Pure so the tick in server.js stays thin and this is unit-testable.
//
// S.meals = { on, tz, items: [{ time: 'HH:MM', label: 'Lunch' }, ...] }

const MAX_ITEMS = 12;
// Same catch-up idea as the workout reminder: a due meal is still sent this long after its time
// (a restart across the minute must not lose it), but never later.
export const MEAL_WINDOW_MIN = 15;

const hhmmToMin = v => {
  const m = /^(\d{2}):(\d{2})$/.exec(v || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

// Stable per-day key for one item, so each is sent at most once per local date.
export const mealKey = it => `${it.time}|${it.label || ''}`;

/**
 * Items owed right now. `now` is { date, hhmm } on the user's clock; `sent` is the
 * `{ date, keys }` record from the last send (anything for another date is ignored).
 */
export function dueMeals(meals, now, sent) {
  if (!meals?.on || !Array.isArray(meals.items) || !now) return [];
  const done = new Set(sent?.date === now.date && Array.isArray(sent.keys) ? sent.keys : []);
  const at = hhmmToMin(now.hhmm);
  return meals.items.slice(0, MAX_ITEMS).filter(it => {
    if (!it || typeof it !== 'object') return false;
    const late = at - hhmmToMin(it.time);
    return late >= 0 && late <= MEAL_WINDOW_MIN && !done.has(mealKey(it));
  });
}
