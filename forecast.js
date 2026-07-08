// forecast.js — transparent burn-rate/reorder heuristic (not a trained model).
// burn rate = total lbs logged in the trailing window / window length.
// This is intentionally explainable: every number traces back to logged usage,
// which matters more for a small roaster's trust than a black-box forecast.
const { db } = require('./db');

const BURN_WINDOW_DAYS = 21; // trailing window used to compute burn rate

async function burnRatePerWeek(lotId) {
  const row = await db.get(
    `SELECT COALESCE(SUM(lbs_used), 0) AS total
     FROM usage_logs
     WHERE lot_id = ? AND logged_at >= now() - (? * INTERVAL '1 day')`,
    [lotId, BURN_WINDOW_DAYS]
  );
  const lbsPerDay = row.total / BURN_WINDOW_DAYS;
  return lbsPerDay * 7;
}

async function forecastForLot(lot) {
  const weeklyBurn = await burnRatePerWeek(lot.id);
  const hasUsageData = weeklyBurn > 0;
  const daysUntilEmpty = hasUsageData ? lot.lbs_on_hand / (weeklyBurn / 7) : null;
  const atRisk = hasUsageData && daysUntilEmpty < lot.lead_time_days;
  const suggestedReorderLbs = hasUsageData
    ? Math.round(weeklyBurn * lot.buffer_weeks)
    : null;

  let reason;
  if (!hasUsageData) {
    reason = 'No usage logged yet in the last 3 weeks — log a roast session to get a forecast.';
  } else if (atRisk) {
    const shortfall = Math.round(lot.lead_time_days - daysUntilEmpty);
    reason = `At current pace, runs out in ${Math.round(daysUntilEmpty)} days — that's ${shortfall} day(s) short of ${lot.supplier}'s ${lot.lead_time_days}-day lead time.`;
  } else {
    reason = `At current pace, runs out in ${Math.round(daysUntilEmpty)} days — comfortably inside ${lot.supplier}'s ${lot.lead_time_days}-day lead time.`;
  }

  return {
    weeklyBurn: Math.round(weeklyBurn * 10) / 10,
    daysUntilEmpty: daysUntilEmpty === null ? null : Math.round(daysUntilEmpty),
    atRisk,
    suggestedReorderLbs,
    reason,
  };
}

async function forecastAllLots() {
  const lots = await db.all('SELECT * FROM lots');
  const out = [];
  for (const lot of lots) {
    out.push({ lot, forecast: await forecastForLot(lot) });
  }
  return out;
}

function reorderNote(lot, forecast) {
  const qty = forecast.suggestedReorderLbs ?? 'TBD (no usage data yet)';
  return [
    `To: ${lot.supplier_contact}`,
    `Subject: Reorder — ${lot.origin}`,
    ``,
    `Hi ${lot.supplier},`,
    ``,
    `We'd like to place a reorder for ${lot.origin} (${lot.variety}).`,
    `Requested quantity: ${qty} lbs.`,
    `Current on-hand: ${lot.lbs_on_hand} lbs, estimated to last ${forecast.daysUntilEmpty ?? 'unknown'} more day(s) at our current roast pace.`,
    `Your stated lead time is ${lot.lead_time_days} days, so we'd appreciate confirmation on timing.`,
    ``,
    `Thanks,`,
    `[Your roastery]`,
  ].join('\n');
}

module.exports = { forecastForLot, forecastAllLots, reorderNote, BURN_WINDOW_DAYS };
