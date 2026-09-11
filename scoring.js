'use strict';

// Fantasy Sales League scoring engine — JS port of update-scores-skill/score.py.
// Pure and deterministic: given a staging dict (raw per-rep metrics) and the
// existing month document (for its drafted slot assignments), produce a new
// month document with per-player scores, stats, bars, lines, and team totals.

(function (global) {

  // --- position palette (must match the app / score.py) ------------------
  const C_QB  = '#4aa8ff';
  const C_RB  = '#35d07f';
  const C_WR  = '#f5c451';
  const C_TE  = '#9d7bff';
  const C_K   = '#ff5c5c';
  const C_DEF = '#35d07f';

  const COLORS = { QB: C_QB, RB: C_RB, WR: C_WR, TE: C_TE, K: C_K, DEF: C_DEF };

  const ROLES = {
    QB:  'Quarterback · Revenue : Customers : Pipe',
    RB:  'Running Back · Create-Close : Velocity',
    WR:  'Wide Receiver · Revenue : Big Bets',
    TE:  'Tight End · Team Plays : Upgrades',
    K:   'Kicker · Participation',
    DEF: 'Defense · Pipe Generation',
  };
  const FLEX_ROLE = {
    RB: 'Flex (RB) · Create-Close : Velocity',
    WR: 'Flex (WR) · Revenue : Big Bets',
    TE: 'Flex (TE) · Team Plays : Upgrades',
  };

  // --- helpers -----------------------------------------------------------
  function usd (n) {
    if (!n) return '$0';
    if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000)     return '$' + Math.round(n / 1_000) + 'K';
    return '$' + Math.trunc(n);
  }
  function initials (name) {
    const parts = String(name || '').split(/\s+/).filter(Boolean);
    if (!parts.length) return '??';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  const g = (m, k, dflt) => (m && m[k] != null ? m[k] : (dflt !== undefined ? dflt : 0));
  const round1 = n => Math.round(n * 10) / 10;

  // --- per-position scorers ---------------------------------------------
  // Each returns { score, stats, bars, lines }, matching the app's player object.

  function scoreQB (m) {
    const rev   = g(m, 'closed_won_amount', 0);
    const cust  = g(m, 'distinct_customers', 0);
    const pipe  = g(m, 'pipe_gen_amount', 0);
    const deals = g(m, 'deal_count', 0);
    const lines = [];
    let s = 0;
    const revPts = rev / 10_000;   // 1 pt / 10K ACV
    const custPts = cust * 5;      // 5 pts per distinct customer
    s += revPts + custPts;
    if (revPts)  lines.push([`Revenue ${usd(rev)}`, `+${Math.round(revPts)}`, 'p']);
    if (custPts) lines.push([`${cust} distinct customers`, `+${custPts}`, 'p']);
    if (pipe < 100_000) { s -= 20; lines.push(['Below $100K pipe gen', '-20', 'm']); }
    const stats = [['Revenue', usd(rev)], ['Distinct Cust.', String(cust)],
                   ['Pipe Gen', usd(pipe)], ['Deals', String(deals)]];
    const bars = [['Revenue', Math.round(rev), 130000, C_QB],
                  ['Customers', cust, 16, C_TE],
                  ['Pipe Gen', Math.round(pipe), 300000, C_RB]];
    return { score: round1(s), stats, bars, lines };
  }

  function scoreRB (m) {
    const cc       = g(m, 'create_close_amount', 0);
    const fast     = g(m, 'fast_closes', 0);
    const flexAcv  = g(m, 'flex_credit_amount', 0);
    const ccDeals  = g(m, 'create_close_deals', 0);
    const top      = g(m, 'top_deal_amount', 0);
    const lines = [];
    let s = 0;
    const ccPts   = cc / 1_000;   // 1 pt / 1K C&C ACV
    const fastPts = fast * 25;    // 25 pts / fast close
    const flexPts = flexAcv / 5_000;
    s += ccPts + fastPts + flexPts;
    if (ccPts)   lines.push([`Create & close ${usd(cc)}`, `+${Math.round(ccPts)}`, 'p']);
    if (fastPts) lines.push([`${fast} closes before the 21st`, `+${fastPts}`, 'p']);
    if (flexPts) lines.push([`Flex credits ${usd(flexAcv)}`, `+${Math.round(flexPts)}`, 'p']);
    const stats = [['Create & Close', usd(cc)], ['Fast Closes', String(fast)],
                   ['C&C Deals', String(ccDeals)], ['Top Deal', usd(top)]];
    const bars = [['Create & Close', Math.round(cc), 120000, C_RB],
                  ['Fast closes < 21st', fast, 5, C_WR]];
    return { score: round1(s), stats, bars, lines };
  }

  function scoreWR (m) {
    const bigBets  = g(m, 'big_bets', 0);
    const acvAbove = g(m, 'acv_above_50k', 0);
    const rev      = g(m, 'closed_won_amount', 0);
    const top      = g(m, 'top_deal_amount', 0);
    const lines = [];
    let s = 0;
    const betPts  = bigBets * 30;
    const overPts = acvAbove / 1_000;
    s += betPts + overPts;
    if (betPts)  lines.push([`${bigBets} big bets > $50K`, `+${betPts}`, 'p']);
    if (overPts) lines.push([`ACV above $50K ${usd(acvAbove)}`, `+${Math.round(overPts)}`, 'p']);
    const stats = [['Revenue', usd(rev)], ['Big Bets > $50K', String(bigBets)],
                   ['Top Deal', usd(top)], ['Above $50K', usd(acvAbove)]];
    const bars = [['Big bets', bigBets, 3, C_WR],
                  ['ACV above $50K', Math.round(acvAbove), 50000, C_TE]];
    return { score: round1(s), stats, bars, lines };
  }

  function scoreTE (m) {
    const tags     = g(m, 'tagged_plays', 0);
    const upgrades = g(m, 'upgrades', 0);
    const capacity = g(m, 'capacity_upgrades', 0);
    const signal   = g(m, 'top_signal', '–');
    const deal     = g(m, 'signal_deal', '–');
    const lines = [];
    let s = 0;
    const tagPts = tags * 25;
    const upPts  = upgrades * 10;
    const capPts = capacity * 25;
    s += tagPts + upPts + capPts;
    if (tagPts) lines.push([`${tags} tagged team plays`, `+${tagPts}`, 'p']);
    if (upPts)  lines.push([`${upgrades} Tableau+/Cloud+ upgrades`, `+${upPts}`, 'p']);
    if (capPts) lines.push([`${capacity} capacity upgrades`, `+${capPts}`, 'p']);
    const stats = [['Tagged Plays', String(tags)], ['Upgrades', String(upgrades + capacity)],
                   ['Signal', signal], ['Deal', deal]];
    const bars = [['Team plays', tags, 4, C_TE],
                  ['Upgrades', upgrades + capacity, 3, C_RB]];
    return { score: round1(s), stats, bars, lines };
  }

  function scoreK (m) {
    const rev      = g(m, 'closed_won_amount', 0);
    const cust     = g(m, 'distinct_customers', 0);
    const smallest = g(m, 'smallest_deal_amount', 0);
    const lines = [['Start', '+20', 'p']];
    let s = 20;
    if (smallest > 0 && smallest < 10_000) {
      s -= 50; lines.push(['Closing < $10K ACV', '-50', 'm']);
    } else if (smallest > 0 && smallest < 25_000) {
      s -= 20; lines.push(['Closing < $25K ACV', '-20', 'm']);
    } else if (smallest === 0) {
      s -= 50; lines.push(['No qualifying close', '-50', 'm']);
    }
    const stats = [['Revenue', usd(rev)], ['Distinct Cust.', String(cust)],
                   ['Smallest', usd(smallest)], ['Start', '20 pts']];
    const bars = [['Participation floor', Math.max(Math.trunc(s), 0), 20, C_K]];
    return { score: round1(s), stats, bars, lines };
  }

  function scoreDEF (m) {
    const pipe = g(m, 'pipe_gen_amount', 0);
    const lines = [['Start', '+30', 'p']];
    let s = 30;
    if (pipe === 0)               { s -= 90; lines.push(['$0 pipe gen', '-90', 'm']); }
    else if (pipe < 50_000)       { s -= 60; lines.push(['Under $50K pipe gen', '-60', 'm']); }
    else if (pipe < 100_000)      { s -= 30; lines.push(['Under $100K pipe gen', '-30', 'm']); }
    const stats = [['Pipe Gen', usd(pipe)], ['Pipe Deals', '–'],
                   ['Floor', '$100K'], ['Start', '30 pts']];
    const bars = [['Pipe vs $100K floor', Math.round(pipe), 100000, C_DEF]];
    return { score: round1(s), stats, bars, lines };
  }

  const SCORERS = { QB: scoreQB, RB: scoreRB, WR: scoreWR, TE: scoreTE, K: scoreK, DEF: scoreDEF };

  function flexKindFromRole (role) {
    role = String(role || '');
    if (role.includes('Flex (RB)')) return 'RB';
    if (role.includes('Flex (WR)')) return 'WR';
    if (role.includes('Flex (TE)')) return 'TE';
    return 'WR';
  }

  function buildPlayer (name, pos, metrics, flexKind) {
    const scoringPos = pos === 'FLEX' ? flexKind : pos;
    const { score, stats, bars, lines } = SCORERS[scoringPos](metrics || {});
    const role = pos === 'FLEX' ? FLEX_ROLE[flexKind] : ROLES[pos];
    return {
      name, init: initials(name), pos, role,
      color: COLORS[scoringPos], score, stats, bars, lines,
    };
  }

  // --- top-level entry ---------------------------------------------------
  //   scoreMonth(staging, prevMonthDoc) -> new month doc, same shape as data/month-<id>.json
  // staging: { "<app name>": { closed_won_amount, ..., inactive? }, ... }
  // prevMonthDoc: the existing month-<id>.json — its standings[].roster carries
  //               the drafted slot assignments we reuse verbatim.
  function scoreMonth (staging, prevMonthDoc) {
    const month = JSON.parse(JSON.stringify(prevMonthDoc));
    for (const team of month.standings) {
      if (team.inactive || !team.roster || !team.roster.length) {
        team.total = 0;
        continue;
      }
      let total = 0;
      const newRoster = [];
      for (const slot of team.roster) {
        const name = slot.name;
        const pos  = slot.pos;
        let metrics = staging[name] || {};
        if (metrics.inactive) metrics = {};
        const flexKind = pos === 'FLEX' ? flexKindFromRole(slot.role) : null;
        const player = buildPlayer(name, pos, metrics, flexKind);
        total += player.score;
        newRoster.push(player);
      }
      team.roster = newRoster;
      team.total  = round1(total);
    }
    month.standings.sort((a, b) => {
      const ai = a.inactive ? 0 : 1;
      const bi = b.inactive ? 0 : 1;
      if (ai !== bi) return bi - ai;
      return b.total - a.total;
    });
    return month;
  }

  global.FSLScoring = { scoreMonth, buildPlayer, SCORERS };
})(window);
