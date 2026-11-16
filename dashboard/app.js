// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail view with the model's own
// inputs and the protocol's farm plan, and the model itself. No network: every byte it shows is
// in data.js. The farm plan is the same derivation main.ts writes to board.json: category,
// chains, TVL and age decide the actions, the capital, the hold and every cost and time.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', minTvl: 0, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };
  var M = DATA.model;

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return (n === null || n === undefined || !isFinite(n)) ? 'n/a' : n.toFixed(3) + 'x'; }

  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  function multipleFor(row) {
    var found = null;
    for (var i = 0; i < DATA.multiples.length; i++) if (DATA.multiples[i].category === row.category) { found = DATA.multiples[i]; break; }
    if (found) return found.multiple;
    return DATA.global_multiple;
  }
  function impliedOf(row) {
    var growth = Math.min(M.growth_cap, Math.max(M.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * M.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? M.unknown_age_days : row.age_days;
    var maturity = M.maturity_floor + (Math.min(Math.max(age, 0), M.maturity_days) / M.maturity_days) * M.maturity_range;
    var extra = Math.min(Math.max((row.chains || []).length - 1, 0), M.breadth_max_extra_chains);
    var breadth = 1 + M.breadth_step * extra;
    return Math.max(1, Math.round(row.tvl_usd * multipleFor(row) * growthMult * maturity * breadth));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan, the same derivation as lib/model.ts: category picks the two actions, TVL the
  // capital, age the hold. %C is the capital, %N the protocol's name, %H its first chain.
  var ACTIONS = [
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
    ['liquidity manager', 'Deposit $%C into a %N managed pool on %H and keep the shares.', 'Rebalance the managed position once when its range moves.'],
    ['collateral', 'Supply $%C of collateral to %N on %H and keep the position open.', 'Borrow a small amount against the collateral, then repay it.'],
    ['default', 'Deposit $%C of USDC into %N on %H and keep the position open.', 'Make one more qualifying action, such as a deposit, a swap or a vote, the following week.']
  ];
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionsFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var fill = function (s) { return s.split('%C').join(String(capital)).split('%N').join(p.name).split('%H').join(chain); };
    for (var i = 0; i < ACTIONS.length; i++) {
      if (ACTIONS[i][0] === 'default') continue;
      if (c.indexOf(ACTIONS[i][0]) >= 0) return [fill(ACTIONS[i][1]), fill(ACTIONS[i][2])];
    }
    var d = ACTIONS[ACTIONS.length - 1];
    return [fill(d[1]), fill(d[2])];
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var pair = actionsFor(p, capital, chain);
    var gas = capital >= 150 ? 8 : 4;
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: pair[0], cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' },
      { text: pair[1], cost: 'about $' + gas + ' of gas on top of the $' + capital + ' position', time: '15 minutes' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log, then unwind in reverse: claim, withdraw, and keep the log for the next launch.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('mintvl')) state.minTvl = Number(params.get('mintvl')) || 0;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.minTvl > 0) params.set('mintvl', String(state.minTvl));
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (state.minTvl > 0 && r.tvl_usd < state.minTvl) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark', 'aria-hidden': 'true' }),
        el('span', { class: 'brand-name' }, el('small', { text: 'Token launch radar' }), 'Token Radar')),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'DefiLlama protocol index'),
        el('span', null, el('b', { text: DATA.model_version }), ' model')
      )
    );
  }

  function lede() {
    var top = DATA.rows[0];
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', null, el('span', { text: DATA.watchlist_size + ' watchlist protocols, ' }), el('em', { text: 'ranked by what a launch would be worth' })),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL that records no token and is no wrapped, staked or bridged product of one that trades. The early radar adds ' + DATA.early_size + ' more pre-token protocols below that floor. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Top implied value' }), el('b', { text: top ? fmtUsd(top.implied_value_usd) : 'n/a' })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function selectField(id, label, options, value, onChange) {
    var select = el('select', { id: id, 'aria-label': label },
      options.map(function (o) { return el('option', { value: String(o.value), text: o.label, selected: String(o.value) === String(value) ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { onChange(select.value); });
    return el('div', { class: 'field' }, el('label', { for: id, text: label }), select);
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var tabs = ['pre-token', 'live', 'set-aside', 'model'].map(function (t) {
      var label = t === 'pre-token' ? 'Pre-token board' : t === 'live' ? 'Live token' : t === 'set-aside' ? 'Set aside' : 'The model';
      return el('button', { type: 'button', 'aria-pressed': state.tab === t ? 'true' : 'false', text: label, onclick: function () { state.tab = t; state.selected = null; writeHash(); render(); } });
    });
    var countText = state.tab === 'pre-token' ? rows().length + ' of ' + DATA.board_size + ' rows shown'
      : state.tab === 'live' ? DATA.live.length + ' live-token protocols'
      : state.tab === 'set-aside' ? DATA.setAside.length + ' set aside, largest first'
      : DATA.multiples.length + ' categories priced';
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      selectField('category', 'Category', [{ value: 'all', label: 'All categories' }].concat(categories.map(function (c) { return { value: c, label: c }; })), state.category, function (v) { state.category = v; writeHash(); render(); }),
      selectField('chain', 'Chain', [{ value: 'all', label: 'All chains' }].concat(chains.map(function (c) { return { value: c, label: c }; })), state.chain, function (v) { state.chain = v; writeHash(); render(); }),
      selectField('mintvl', 'Min TVL', [{ value: 0, label: 'Any TVL' }, { value: 1e8, label: '$100M and up' }, { value: 5e8, label: '$500M and up' }, { value: 1e9, label: '$1B and up' }], state.minTvl, function (v) { state.minTvl = Number(v); writeHash(); render(); }),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'View' }), el('div', { class: 'tabs' }, tabs)),
      el('span', { class: 'count' }, el('b', { text: countText }))
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var nameCell = el('div', { class: 'name' }, el('b', { text: r.name }));
      if (r.watchlist) nameCell.appendChild(el('span', { class: 'badge watch', text: 'WATCHLIST' }));
      nameCell.appendChild(el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }));
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, nameCell),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking, and their market caps price the categories.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function setAsideTable() {
    var tbody = el('tbody');
    DATA.setAside.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'set aside' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: r.reason }),
        el('td', null, el('span', { class: 'status set', text: 'not a launch' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Set aside: pre-token by the record, but a wrapped, staked or bridged product of a token that already trades, a versioned pool, or an exchange product. Largest first.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Why it is set aside' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var mults = DATA.multiples.map(function (m) {
      return el('div', { class: 'mult' }, el('span', { text: m.category + (m.used_global ? ' *' : '') }), el('b', null, fmtMult(m.multiple), el('small', { text: '  n=' + m.comps })));
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        el('span', { text: 'implied = round( tvl_usd x ' }),
        el('b', { text: 'category multiple' }),
        el('span', { text: ' x (1 + clamp(change_7d, ' + M.growth_floor + ', ' + M.growth_cap + ') / 100 x ' + M.growth_weight + ') x (' + M.maturity_floor + ' + min(age_days, ' + M.maturity_days + ') / ' + M.maturity_days + ' x ' + M.maturity_range + ') x (1 + ' + M.breadth_step + ' x min(chains - 1, ' + M.breadth_max_extra_chains + ')) )' })
      ),
      el('p', { class: 'sub', text: 'The category multiple is the median market cap / TVL of the live-token protocols in that category, at least ' + M.min_comps + ' of them, else the whole market median of ' + fmtMult(DATA.global_multiple) + ', clamped to [' + M.multiple_floor + ', ' + M.multiple_cap + ']. A category marked * has fewer than ' + M.min_comps + ' live comparables, so it uses the market median. TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + M.unknown_age_days + ' days. Breadth rewards protocols live on more chains.' }),
      el('div', { class: 'mult-grid' }, mults),
      el('p', { class: 'sub', text: 'What this does not say: it does not predict whether or when a token is issued, and a protocol on the board records no token, never has none. A protocol may still hold a token its record does not carry. Implied value is the entry\u2019s own claim, never a price.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row);
    var compRow = null;
    for (var i = 0; i < DATA.multiples.length; i++) if (DATA.multiples[i].category === row.category) { compRow = DATA.multiples[i]; break; }
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name' }, el('small', { text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? '  ·  Watchlist' : '') })),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple' }), el('b', { class: 'num', text: fmtMult(multipleFor(row)) + (compRow ? ' (n=' + compRow.comps + ')' : '') })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Growth x maturity x breadth' }), el('b', { class: 'num', text: row.growth_multiplier.toFixed(3) + ' x ' + row.maturity_multiplier.toFixed(3) + ' x ' + row.breadth_multiplier.toFixed(3) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan: seven steps' }),
      el('p', { class: 'note', text: 'Farm the protocol, not the rumour: a token may never come, and a snapshot may reward only activity it can see. Never pay to claim, and never share a seed phrase.' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at + 1) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function foot() {
    return el('footer', { class: 'foot' },
      el('p', { text: 'Source: ' + DATA.source + '. The snapshot is frozen: every run of the program and the grade read the same bytes.' }),
      el('p', { text: 'A protocol on this board records no token. That is the record, not proof it has none. Implied value is a model of what a launch would be worth if the record stayed as it is, never a prediction that one comes.' })
    );
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    if (state.tab === 'pre-token') shell.appendChild(boardTable());
    else if (state.tab === 'live') shell.appendChild(liveTable());
    else if (state.tab === 'set-aside') shell.appendChild(setAsideTable());
    else shell.appendChild(modelPanel());
    shell.appendChild(foot());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
    window.__radarReady = true;
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
