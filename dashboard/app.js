// Momentum Radar dashboard: renders window.RADAR (written by main.ts as data.js) with no network.
//
// Filters, sorting, a per-protocol detail view and a model sandbox that re-ranks the board live.
// Hash routes: #detail=<slug> opens a protocol, #class=<BREAKOUT|HEATING|STEADY|COOLING|FADING>
// filters by class, #hot=1 keeps Breakout + Heating only, #watch=1 keeps the watchlist only,
// and #shot=detail shows the detail view alone (the detail screenshot's mode).

(function () {
  'use strict';
  var R = window.RADAR;
  if (!R || !Array.isArray(R.rows)) {
    document.body.innerHTML = '<p style="padding:24px">No radar data: data.js did not load.</p>';
    return;
  }

  var model = R.model;
  var CLASSES = ['BREAKOUT', 'HEATING', 'STEADY', 'COOLING', 'FADING'];

  var state = { q: '', chain: '', category: '', minTvl: 0, sort: 'implied', cls: null, watch: false, hot: false };
  var sandbox = { growth: model.growth_weight, base: model.base_multiple, bonus: model.breakout_bonus, active: false };
  var selectedSlug = null;

  function $(id) { return document.getElementById(id); }
  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n;
  }
  function pct(v) {
    if (v === null || v === undefined) return '—';
    return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
  }
  function pctClass(v) { return v === null || v === undefined ? 'mut' : v > 0 ? 'pos' : v < 0 ? 'neg' : 'mut'; }
  function ageText(days) {
    if (days === null || days === undefined) return '—';
    if (days < 365) return days + 'd';
    return (days / 365).toFixed(1) + 'y';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- model, re-run in the page so the sandbox can re-rank ----
  function clampGrowth(g) { return Math.min(model.growth_cap, Math.max(model.growth_floor, g)); }
  function scoreRow(row) {
    var g = clampGrowth(row.change_7d === null ? 0 : row.change_7d);
    var growthMult = Math.max(model.growth_min_mult, 1 + (g / 100) * sandbox.growth);
    var age = row.age_days === null ? model.unknown_age_days : row.age_days;
    var runway = model.runway_floor + (Math.min(Math.max(age, 0), model.runway_days) / model.runway_days) * model.runway_range;
    var bonus = 1;
    if (row.momentum_class === 'BREAKOUT') bonus = sandbox.bonus;
    else if (row.momentum_class === 'HEATING') bonus = model.heating_bonus;
    else if (row.momentum_class === 'COOLING') bonus = model.cooling_penalty;
    else if (row.momentum_class === 'FADING') bonus = model.fading_penalty;
    var base = row.tvl_usd * sandbox.base;
    return {
      implied: Math.max(1, Math.round(base * growthMult * runway * bonus)),
      growthPct: g, growthMult: growthMult, runway: runway, bonus: bonus, base: base,
    };
  }

  // ---- farm plan, generated in the page from the same rules as the model ----
  function capitalFor(tvl) {
    if (tvl >= 5e9) return 250;
    if (tvl >= 1e9) return 150;
    if (tvl >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(row, capital, chain) {
    var c = (row.category || '').toLowerCase();
    var name = row.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function momentumLine(cls) {
    if (cls === 'BREAKOUT') return 'TVL is breaking out, up 25% or more in 7 days: repeat the qualifying action weekly while the move stays hot, and never chase it with fresh size after a single week.';
    if (cls === 'HEATING') return 'TVL is heating, up 5% or more in 7 days: repeat the qualifying action weekly while growth stays above 5%, and check the 7-day figure again before adding size.';
    if (cls === 'STEADY') return 'TVL is steady, inside 5% either way in 7 days: one qualifying action a week is enough, and size is set by the position, not by the week.';
    if (cls === 'COOLING') return 'TVL is cooling, down more than 5% in 7 days: keep the position small, do one qualifying action a week, and wait for the 7-day figure to turn before adding size.';
    return 'TVL is fading, down 25% or more in 7 days: farm the minimum, keep the position small, and only add size if the 7-day figure turns positive for two weeks running.';
  }
  function farmPlan(row) {
    var chain = row.chains && row.chains.length ? row.chains[0] : 'its main chain';
    var capital = capitalFor(row.tvl_usd);
    var hold = holdDaysFor(row.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(row, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: momentumLine(row.momentum_class), cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
    ];
  }

  // ---- header, strip, filters ----
  $('meta').innerHTML =
    '<b>' + R.board_size + '</b> protocols ranked · <b>' + R.watchlist_size + '</b> on the watchlist · ' +
    '<b>' + R.early_size + '</b> early finds below the floor<br>Snapshot <b>' + esc(R.as_of) + '</b> · model <b>' + esc(R.model_version) + '</b> · floor <b>' + money(R.floor_usd) + '</b>';
  $('asOf').textContent = R.as_of;
  $('watchMedian').textContent = R.watchlist_median_7d === null ? 'not reported' : (R.watchlist_median_7d > 0 ? '+' : '') + R.watchlist_median_7d.toFixed(1) + '% in 7 days';

  var strip = $('classStrip');
  var stripDefs = [
    ['BREAKOUT', '7d ≥ +25%', 'Act while it moves'],
    ['HEATING', '7d +5% to +25%', 'Warming up'],
    ['STEADY', '7d −5% to +5%', 'Holding'],
    ['COOLING', '7d −25% to −5%', 'Cooling off'],
    ['FADING', '7d < −25%', 'Fading fast'],
  ];
  strip.innerHTML = stripDefs.map(function (d) {
    return '<div class="cell"><b>' + (R.class_counts[d[0]] || 0) + '</b><span class="tag ' + d[0] + '">' + d[0] + '</span><small>' + d[1] + ' · ' + d[2] + '</small></div>';
  }).join('');

  function fillSelect(id, values) {
    var sel = $(id);
    values.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v; o.textContent = v;
      sel.appendChild(o);
    });
  }
  var chains = {}, cats = {};
  R.rows.forEach(function (r) {
    (r.chains || []).forEach(function (c) { chains[c] = true; });
    if (r.category) cats[r.category] = true;
  });
  fillSelect('chain', Object.keys(chains).sort());
  fillSelect('category', Object.keys(cats).sort());

  var chipsEl = $('classChips');
  var allChip = document.createElement('button');
  allChip.type = 'button'; allChip.className = 'chip'; allChip.textContent = 'All classes';
  allChip.setAttribute('aria-pressed', 'true');
  allChip.onclick = function () { state.cls = null; state.hot = false; syncChips(); renderBoard(); };
  chipsEl.appendChild(allChip);
  CLASSES.forEach(function (c) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = c;
    b.setAttribute('aria-pressed', 'false');
    b.onclick = function () { state.cls = (state.cls === c ? null : c); state.hot = false; syncChips(); renderBoard(); };
    chipsEl.appendChild(b);
  });
  function syncChips() {
    var btns = chipsEl.querySelectorAll('.chip');
    btns[0].setAttribute('aria-pressed', state.cls === null && !state.hot ? 'true' : 'false');
    CLASSES.forEach(function (c, i) {
      btns[i + 1].setAttribute('aria-pressed', state.cls === c ? 'true' : 'false');
    });
    $('hotOnly').checked = state.hot;
    $('watchOnly').checked = state.watch;
  }

  // ---- board ----
  function isWatch(row) { return row.watchlist === true; }

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    var list = R.rows.filter(function (r) {
      if (state.hot && !(r.momentum_class === 'BREAKOUT' || r.momentum_class === 'HEATING')) return false;
      if (state.cls && r.momentum_class !== state.cls) return false;
      if (state.watch && !isWatch(r)) return false;
      if (state.chain && !(r.chains || []).includes(state.chain)) return false;
      if (state.category && r.category !== state.category) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (q && (r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0)) return false;
      return true;
    });
    var scored = list.map(function (r) { return { row: r, score: scoreRow(r) }; });
    var by = state.sort;
    scored.sort(function (a, b) {
      if (by === 'growth') return (b.row.change_7d || 0) - (a.row.change_7d || 0);
      if (by === 'tvl') return b.row.tvl_usd - a.row.tvl_usd;
      if (by === 'age') return (b.row.age_days === null ? -1 : b.row.age_days) - (a.row.age_days === null ? -1 : a.row.age_days);
      if (by === 'name') return a.row.name.localeCompare(b.row.name);
      return b.score.implied - a.score.implied;
    });
    return scored;
  }

  function renderBoard() {
    var scored = visibleRows();
    var body = $('boardBody');
    body.innerHTML = '';
    $('boardEmpty').hidden = scored.length > 0;
    $('count').textContent = scored.length + ' of ' + R.board_size + ' shown';
    scored.forEach(function (item) {
      var r = item.row;
      var tr = document.createElement('tr');
      if (r.slug === selectedSlug) tr.className = 'selected';
      tr.innerHTML =
        '<td class="num">' + r.rank + '</td>' +
        '<td class="name">' + esc(r.name) + '<small>' + esc(r.slug) + (r.category ? ' · ' + esc(r.category) : '') + '</small></td>' +
        '<td><span class="tag ' + r.momentum_class + '">' + r.momentum_class + '</span></td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + pctClass(r.change_7d) + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td>' +
        '<td class="num"><b>' + money(item.score.implied) + '</b></td>';
      tr.onclick = function () { openDetail(r.slug); };
      body.appendChild(tr);
    });
  }

  // ---- detail ----
  function openDetail(slug) {
    var found = null;
    R.rows.forEach(function (r) { if (r.slug === slug) found = r; });
    if (!found) return;
    selectedSlug = slug;
    var s = scoreRow(found);
    $('detail').hidden = false;
    $('detailTitle').textContent = '#' + found.rank + ' — ' + found.name;
    var plan = farmPlan(found);
    $('detailBody').innerHTML =
      '<div class="detail-grid"><div>' +
      '<dl class="kv">' +
      '<dt>Momentum</dt><dd><span class="tag ' + found.momentum_class + '">' + found.momentum_class + '</span></dd>' +
      '<dt>TVL</dt><dd>' + money(found.tvl_usd) + '</dd>' +
      '<dt>7-day change</dt><dd class="' + pctClass(found.change_7d) + '">' + pct(found.change_7d) + '</dd>' +
      '<dt>Listed</dt><dd>' + esc(found.listed_at || 'not reported') + ' (' + ageText(found.age_days) + ')</dd>' +
      '<dt>Chains</dt><dd>' + esc((found.chains || []).join(', ') || '—') + '</dd>' +
      '<dt>Category</dt><dd>' + esc(found.category || '—') + '</dd>' +
      '<dt>Token</dt><dd>records no token</dd>' +
      '</dl>' +
      '<h3 style="margin:16px 0 6px">Model breakdown</h3>' +
      '<dl class="kv">' +
      '<dt>Base (TVL × ' + sandbox.base.toFixed(2) + ')</dt><dd>' + money(s.base) + '</dd>' +
      '<dt>Growth ×' + s.growthMult.toFixed(2) + '</dt><dd>' + (s.growthPct > 0 ? '+' : '') + s.growthPct.toFixed(1) + '% in 7d</dd>' +
      '<dt>Runway ×' + s.runway.toFixed(2) + '</dt><dd>' + (found.age_days === null ? 'age unknown' : found.age_days + ' days, no token') + '</dd>' +
      '<dt>Breakout bonus ×' + s.bonus.toFixed(2) + '</dt><dd>' + found.momentum_class + '</dd>' +
      '<dt><b>Implied value</b></dt><dd><b>' + money(s.implied) + '</b></dd>' +
      '</dl></div>' +
      '<div><h3 style="margin:0 0 6px">Farm plan — 6 steps</h3>' +
      '<ol class="steps">' + plan.map(function (st) {
        return '<li>' + esc(st.text) + '<small>Cost: ' + esc(st.cost) + ' · Time: ' + esc(st.time) + '</small></li>';
      }).join('') + '</ol></div></div>';
    renderBoard();
    document.getElementById('detail').scrollIntoView({ behavior: 'instant', block: 'start' });
    if (location.hash !== '#detail=' + slug) history.replaceState(null, '', '#detail=' + slug);
  }
  $('detailClose').onclick = function () {
    selectedSlug = null;
    $('detail').hidden = true;
    history.replaceState(null, '', location.pathname + location.search);
    renderBoard();
  };

  // ---- live tokens ----
  var liveBody = $('liveBody');
  R.live.forEach(function (r) {
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td class="name">' + esc(r.name) + '<small>' + esc(r.slug) + (r.category ? ' · ' + esc(r.category) : '') + '</small></td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td>' +
      '<td class="num">' + (r.mcap_usd === null ? '—' : money(r.mcap_usd)) + '</td>' +
      '<td class="num ' + pctClass(r.change_7d) + '">' + pct(r.change_7d) + '</td>';
    liveBody.appendChild(tr);
  });

  // ---- controls ----
  $('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  $('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
  $('category').addEventListener('change', function (e) { state.category = e.target.value; renderBoard(); });
  $('minTvl').addEventListener('change', function (e) { state.minTvl = Number(e.target.value); renderBoard(); });
  $('sort').addEventListener('change', function (e) { state.sort = e.target.value; renderBoard(); });
  $('watchOnly').addEventListener('change', function (e) { state.watch = e.target.checked; renderBoard(); });
  $('hotOnly').addEventListener('change', function (e) { state.hot = e.target.checked; if (state.hot) state.cls = null; syncChips(); renderBoard(); });

  // ---- sandbox ----
  function sandboxChanged() {
    sandbox.active =
      sandbox.growth !== model.growth_weight ||
      sandbox.base !== model.base_multiple ||
      sandbox.bonus !== model.breakout_bonus;
    var badge = $('sandboxBadge');
    badge.textContent = sandbox.active ? 'live — re-ranked' : 'defaults';
    badge.className = 'badge' + (sandbox.active ? ' live' : '');
    renderBoard();
  }
  $('inGrowth').addEventListener('input', function (e) {
    sandbox.growth = Number(e.target.value);
    $('outGrowth').textContent = sandbox.growth.toFixed(2);
    sandboxChanged();
  });
  $('inBase').addEventListener('input', function (e) {
    sandbox.base = Number(e.target.value);
    $('outBase').textContent = sandbox.base.toFixed(2);
    sandboxChanged();
  });
  $('inBonus').addEventListener('input', function (e) {
    sandbox.bonus = Number(e.target.value);
    $('outBonus').textContent = sandbox.bonus.toFixed(2);
    sandboxChanged();
  });
  $('sandboxReset').addEventListener('click', function () {
    sandbox.growth = model.growth_weight;
    sandbox.base = model.base_multiple;
    sandbox.bonus = model.breakout_bonus;
    $('inGrowth').value = sandbox.growth;
    $('inBase').value = sandbox.base;
    $('inBonus').value = sandbox.bonus;
    $('outGrowth').textContent = sandbox.growth.toFixed(2);
    $('outBase').textContent = sandbox.base.toFixed(2);
    $('outBonus').textContent = sandbox.bonus.toFixed(2);
    sandboxChanged();
  });

  // ---- hash routes ----
  function applyHash() {
    var h = location.hash.replace(/^#/, '');
    if (!h) return;
    var params = {};
    h.split('&').forEach(function (part) {
      var kv = part.split('=');
      if (kv[0]) params[kv[0]] = decodeURIComponent(kv[1] || '');
    });
    if (params['class'] && CLASSES.indexOf(params['class']) >= 0) state.cls = params['class'];
    if (params.hot === '1') { state.hot = true; state.cls = null; }
    if (params.watch === '1') state.watch = true;
    // Screenshot mode: detail-only view, so the detail screenshot needs no scrolling.
    if (params.shot === 'detail') document.body.classList.add('shot-detail');
    syncChips();
    renderBoard();
    if (params.detail) openDetail(params.detail);
  }
  window.addEventListener('hashchange', applyHash);

  syncChips();
  renderBoard();
  applyHash();
})();
