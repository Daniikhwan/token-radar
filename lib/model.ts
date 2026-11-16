// The token radar's model, radar-2: one snapshot of the protocol universe in, one ranked board out.
//
// The board ranks every protocol that records no token AND is not a wrapped, staked or bridged
// product of a token that already trades, at any TVL the snapshot carries (the watchlist's rule,
// applied to the whole snapshot, not just above the floor). The watchlist is the floor: all 40 of
// its slugs are on the board, and the board adds every other protocol that passes the same rule
// below the floor. Protocols that fail the rule are set aside with their reason, never ranked:
// WBTC is Bitcoin on Ethereum, a staked-ETH product is ETH in a staking wrapper, and neither is a
// protocol still waiting on a launch of its own. Live-token protocols are set aside too, with the
// market's own value, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures, never from a hand-kept list of names:
//
//   multiple     = the median mcap / TVL of the live-token protocols in the same category
//                  (at least 3 comparables, else the whole market's median), clamped to [0.02, 1.5]
//   growth       = clamp(change_7d, -60, 120) per cent
//   growthMult   = 1 + (growth / 100) x 0.5
//   maturity     = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age unknown: 365 days)
//   breadth      = 1 + 0.05 x min(chains - 1, 4)            (wider distribution, worth more)
//   implied      = max(1, round(tvl_usd x multiple x growthMult x maturity x breadth))
//
// A category's multiple is what the market already pays for a token in that business: a DEX token
// trades near a third of its TVL, a lending token near an eighth, a basis-trading token near
// two-thirds. The same function scores every row, and the dashboard states the multiples table.

import { readFileSync } from 'node:fs';

/** The model's constants, as the dashboard states them. */
export const MODEL = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_step: 0.05,
  breadth_max_extra_chains: 4,
  multiple_floor: 0.02,
  multiple_cap: 1.5,
  min_comps: 3,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 32;

/** How many set-aside protocols the dashboard lists, by TVL. */
export const SET_ASIDE_ROWS = 40;

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf, listedAt) {
  if (listedAt === null || listedAt === undefined) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word wrapped, staked or staking in a name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** Categories that are a wrapped, staked or bridged product, or a centralised exchange. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** An exchange's name at the start of a protocol's name. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function isPreToken(p) {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Why a protocol is set aside instead of ranked, or null when it may be ranked: the watchlist's
 * own rule, stated in the snapshot's field guide. A reason is a fact about the record, never a name.
 */
export function exclusionReason(p) {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) {
    if (p.category === 'CEX') return 'a centralised exchange, not a protocol launch';
    if (p.category === 'Bridge' || p.category === 'Canonical Bridge') return 'a bridge: it moves a token that already trades';
    return 'a staked product of an asset that already trades';
  }
  if (VERSIONED.test(p.name)) return 'a versioned pool of another protocol';
  if (WRAPPED_WORD.test(p.name)) return 'a wrapped or staked product by name';
  for (const x of EXCHANGE_PREFIXES) if (p.name.startsWith(x)) return 'an exchange product';
  return null;
}

/** Whether a protocol is one the board may rank: pre-token and not set aside by the rule. */
export function isBoardable(p) {
  return isPreToken(p) && exclusionReason(p) === null;
}

/** The median of a sorted list of numbers. */
function median(sorted) {
  const n = sorted.length;
  if (n === 0) return null;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Every category's FDV multiple from the live-token protocols in the snapshot: the median
 * mcap / TVL of the category's live protocols, at least `min_comps` of them, else the whole
 * market's median, clamped to the model's floor and cap. Returns the table and the global median.
 */
export function categoryMultiples(protocols, model = MODEL) {
  const live = protocols.filter(
    (p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const global = median(live.map((p) => p.mcap_usd / p.tvl_usd).sort((a, b) => a - b));
  const byCategory = new Map();
  for (const p of live) {
    const key = p.category === null ? 'Other' : p.category;
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(p.mcap_usd / p.tvl_usd);
  }
  const table = new Map();
  for (const [cat, ratios] of byCategory) {
    const sorted = ratios.sort((a, b) => a - b);
    const m = sorted.length >= model.min_comps ? median(sorted) : global;
    table.set(cat, {
      multiple: Math.max(model.multiple_floor, Math.min(model.multiple_cap, m)),
      comps: sorted.length,
      used_global: sorted.length < model.min_comps,
    });
  }
  return { table, global: Math.max(model.multiple_floor, Math.min(model.multiple_cap, global)) };
}

/** The multiple one protocol's category gets, from the table, else the global median. */
export function multipleFor(p, multiples) {
  const key = p.category === null ? 'Other' : p.category;
  const row = multiples.table.get(key);
  if (row !== undefined) return row.multiple;
  return multiples.global;
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(p, asOf, multiples, model = MODEL) {
  const age = ageDays(asOf, p.listed_at);
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age === null || age === undefined ? model.unknown_age_days : age;
  const maturityMult =
    model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = Math.min(Math.max((p.chains || []).length - 1, 0), model.breadth_max_extra_chains);
  const breadthMult = 1 + model.breadth_step * extraChains;
  const categoryMultiple = multipleFor(p, multiples);
  const base = p.tvl_usd * categoryMultiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * breadthMult));
  return { implied, growthPct, growthMult, maturityMult, breadthMult, categoryMultiple, age };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols) {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const round4 = (n) => Math.round(n * 1e4) / 1e4;

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p) {
  return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p) {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age) {
  if (age === null || age === undefined) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * The category's two actions, in the words a farmer can follow: the core position and a second
 * qualifying action. Keys are matched against the category's lower-cased words, in order; the
 * first key that appears wins, and a category no key matches takes the deposit. %C is the capital,
 * %N the protocol's name, %H its first chain.
 */
export const ACTIONS = [
  ['curator', 'Deposit $%C into a %N vault on %H and keep the shares.', 'Deposit into a second %N vault on another chain it supports and keep both shares.'],
  ['allocator', 'Deposit $%C into a %N vault on %H and keep the shares.', 'Deposit into a second %N vault on another chain it supports and keep both shares.'],
  ['lend', 'Supply $%C of USDC to %N on %H and keep the position open.', 'Borrow a small amount against the supply, then repay it, to activate the borrow side.'],
  ['cdp', 'Deposit $%C of collateral into %N on %H and mint its stable asset.', 'Adjust the collateral once, such as adding a small amount, to record a second position.'],
  ['dex', "Provide $%C of liquidity to %N's main pool on %H and keep the position open.", 'Swap a small amount through the pool each week so the wallet shows trading activity.'],
  ['yield', 'Deposit $%C into a %N vault on %H and keep the shares.', 'Claim the vault rewards once and deposit them back into the same vault.'],
  ['leveraged farm', 'Open a $%C leveraged position on %N on %H and keep it open.', 'Close and reopen a small part of the position once to record a second action.'],
  ['perpetual', 'Deposit $%C of USDC as margin on %N and open one small hedge.', 'Open a second small position in the opposite direction and close it within the week.'],
  ['derivative', 'Deposit $%C of USDC as margin on %N and open one small hedge.', 'Open a second small position in the opposite direction and close it within the week.'],
  ['basis', 'Deposit $%C into a %N basis position on %H and keep it open.', 'Roll the position once when its funding window resets.'],
  ['rwa', "Mint $%C of the protocol's yield asset on %H and hold it.", 'Claim the yield once and hold the payout in the same wallet.'],
  ['stable', 'Mint or deposit $%C of the stable asset through %N on %H.', 'Provide $%C of the stable asset to a pool on %H and keep the position open.'],
  ['staking', "Stake $%C of the chain's staking asset through %N and keep the receipt.", 'Restake the receipt once so the wallet shows a second staking action.'],
  ['restak', "Stake $%C of the chain's staking asset through %N and keep the receipt.", 'Restake the receipt once so the wallet shows a second staking action.'],
  ['prediction', 'Fund $%C and place one market position on %N.', 'Place a second position on a different market the same week.'],
  ['bridge', 'Bridge $%C of USDC to %H through %N and use the bridged funds in its app.', 'Bridge a small amount back the other way so the wallet shows both directions.'],
  ['insurance', 'Buy $%C of cover from %N on %H and keep the policy.', 'Renew or top up the cover once before it lapses.'],
  ['payment', 'Pay $%C through %N on %H and keep the receipt.', 'Make a second payment the following week from the same wallet.'],
  ['card', 'Load $%C onto the %N card and spend a small amount on %H.', 'Top the card up once more the following week.'],
  ['index', 'Buy $%C of the %N index token on %H and hold it.', 'Rebalance the index position once when its weights change.'],
  ['governance', 'Deposit $%C into %N on %H and vote on one proposal.', 'Vote on a second proposal the following week from the same wallet.'],
  ['otc', 'List a $%C offer on %N on %H and settle one trade.', 'Settle a second small trade the following week.'],
  ['btc', 'Deposit $%C of a BTC-backed asset into %N on %H and keep the position open.', 'Use the deposit as collateral in one lending market on %H.'],
  ['chain', "Bridge $%C to %H through its official bridge and use one native app.", 'Interact with a second native app on %H the following week.'],
  ['farm', 'Deposit $%C into a %N farm on %H and keep the position open.', 'Harvest the farm rewards once and deposit them back into the same farm.'],
  ['liquidity manager', "Deposit $%C into a %N managed pool on %H and keep the shares.", 'Rebalance the managed position once when its range moves.'],
  ['collateral', 'Supply $%C of collateral to %N on %H and keep the position open.', 'Borrow a small amount against the collateral, then repay it.'],
  ['default', 'Deposit $%C of USDC into %N on %H and keep the position open.', 'Make one more qualifying action, such as a deposit, a swap or a vote, the following week.'],
];

/** The two actions a category gets, with %C, %N and %H filled in. */
export function actionsFor(p, capital, chain) {
  const c = (p.category || '').toLowerCase();
  for (const [key, core, second] of ACTIONS) {
    if (key === 'default') continue;
    if (c.indexOf(key) >= 0) {
      const fill = (s) => s.split('%C').join(String(capital)).split('%N').join(p.name).split('%H').join(chain);
      return [fill(core), fill(second)];
    }
  }
  const d = ACTIONS[ACTIONS.length - 1];
  const fill = (s) => s.split('%C').join(String(capital)).split('%N').join(p.name).split('%H').join(chain);
  return [fill(d[1]), fill(d[2])];
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step) {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names: the category picks the two actions, the TVL picks the capital, the age picks the hold.
 */
export function farmSteps(p, age) {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const [core, second] = actionsFor(p, capital, chain);
  const gas = capital >= 150 ? 8 : 4;
  return [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    { text: core, cost: `$${capital} of capital and about $${gas} of gas`, time: '15 minutes to set up' },
    { text: second, cost: `about $${gas} of gas on top of the $${capital} position`, time: '15 minutes' },
    {
      text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.',
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.",
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: 'Write the wallet, the dates and every transaction in a farm log, then unwind in reverse: claim, withdraw, and keep the log for the next launch.',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ].map(stepText);
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot, model = MODEL) {
  const index = bySlug(snapshot.protocols);
  const multiples = categoryMultiples(snapshot.protocols, model);
  const chosen = new Map();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot,
  // but the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other boardable protocol below the floor. Never a replacement for a
  // watchlist row: a chosen protocol stays chosen.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isBoardable(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, multiples, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      // Full precision here, never rounded: the page recomputes the row from these figures
      // and must land on the same number board.json carries.
      category_multiple: s.categoryMultiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot) {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** The pre-token protocols set aside by the rule, by TVL, with the reason each was set aside. */
export function setAsideRows(snapshot) {
  return snapshot.protocols
    .filter((p) => isPreToken(p) && exclusionReason(p) !== null)
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .slice(0, SET_ASIDE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      reason: exclusionReason(p),
    }));
}

/** A board row's compact form for data.js, with the model breakdown the page shows. */
export function radarRow(row, watchlist) {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    watchlist: watchlist === true,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot, model = MODEL) {
  const board = buildBoard(snapshot, model);
  const multiples = categoryMultiples(snapshot.protocols, model);
  const live = liveRows(snapshot);
  const setAside = setAsideRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const multiplesTable = [...multiples.table.entries()]
    .map(([category, v]) => ({ category, multiple: v.multiple, comps: v.comps, used_global: v.used_global }))
    .sort((a, b) => b.multiple - a.multiple || (a.category < b.category ? -1 : 1));
  const radar = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    set_aside_size: setAside.length,
    global_multiple: multiples.global,
    multiples: multiplesTable,
    rows: board.map((r) => radarRow(r, snapshot.watchlist.includes(r.slug))),
    live,
    setAside,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c) => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board, snapshot) {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i].implied_value_usd > board[i - 1].implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0].implied_value_usd === board[board.length - 1].implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0].implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar) {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
