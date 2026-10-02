(function () {
  'use strict';

  var MARKET_NAMES = {
    o35: 'Over 3.5', ge5: '5+ Gols', o25: 'Over 2.5', ambas: 'Ambas Marcam',
    u25: 'Under 2.5', u15: 'Under 1.5', u05: 'Under 0.5', totft: 'Total Gols (FT)'
  };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function number(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  function shortTeam(value) {
    var clean = String(value || '').trim();
    if (!clean) return '---';
    var words = clean.split(/\s+/).filter(Boolean);
    if (words.length === 1) return words[0].slice(0, 4).toUpperCase();
    return words.slice(0, 3).map(function (word) { return word[0]; }).join('').toUpperCase();
  }
  function scoreParts(game) {
    var match = String(game && game.placar || '').match(/(\d+)\s*[-x]\s*(\d+)/i);
    return match ? [Number(match[1]), Number(match[2])] : null;
  }
  function paid(game, market) {
    var score = scoreParts(game);
    if (!score) return null;
    var total = Number.isFinite(Number(game.total)) ? Number(game.total) : score[0] + score[1];
    if (market === 'o25') return total >= 3;
    if (market === 'o35') return total >= 4;
    if (market === 'ge5') return total >= 5;
    if (market === 'ambas') return score[0] > 0 && score[1] > 0;
    if (market === 'u05') return total <= 0;
    if (market === 'u15') return total <= 1;
    if (market === 'u25') return total <= 2;
    return null;
  }
  function marketOdd(game, market) {
    var odds = game && game.odds || {};
    if (market === 'ambas') return odds.ambs == null ? odds.ambas : odds.ambs;
    return odds[market];
  }
  function opportunityCard(game) {
    var status = String(game.status || 'OBSERVAR');
    var entry = /ENTRADA/.test(status);
    var score = number(game.score, null), prob = number(game.prob, null);
    var odd = number(game.odd, null), ev = number(game.ev, null);
    return '<article class="amd-opp-card' + (entry ? ' entry' : '') + '">' +
      '<div class="amd-opp-top"><span class="amd-opp-badge">' +
        (entry ? 'Entrada confirmada' : 'Oportunidade') + '</span>' +
        '<span class="amd-opp-time">' + esc(game.horario || '--:--') + '</span></div>' +
      '<div class="amd-opp-game">' + esc(game.nome || 'Jogo aguardando') + '</div>' +
      '<div class="amd-opp-stats">' +
        '<span>Prob. ML<b>' + (prob == null ? '—' : prob.toFixed(1) + '%') + '</b></span>' +
        '<span>Odd<b>' + (odd == null ? '—' : '@' + odd.toFixed(2)) + '</b></span>' +
        '<span>EV<b class="' + (ev != null && ev > 0 ? 'good' : '') + '">' +
          (ev == null ? '—' : (ev > 0 ? '+' : '') + ev.toFixed(1) + '%') + '</b></span>' +
      '</div>' +
      '<div class="amd-opp-reason">' + esc(status) + (score == null ? '' : ' · score ' + score) +
        (game.motivo ? '<br>' + esc(game.motivo) : '') + '</div>' +
    '</article>';
  }
  function opportunities(data) {
    var games = (data.proximos || []).filter(function (game) { return game && !game.erro && !game.semEV; });
    games.sort(function (a, b) {
      var ae = /ENTRADA/.test(String(a.status || '')) ? 1 : 0;
      var be = /ENTRADA/.test(String(b.status || '')) ? 1 : 0;
      return be - ae || number(b.score, -999) - number(a.score, -999);
    });
    var html = games.slice(0, 4).map(opportunityCard).join('');
    if (!html) html = '<div class="amd-ribbon-empty">Aguardando oportunidades calculadas para a próxima rodada.</div>';
    return '<section class="amd-panel" id="oportunidades"><div class="amd-panel-head">' +
      '<span class="amd-panel-title">Oportunidades em tempo real</span>' +
      '<span class="amd-panel-meta">modelo + preço + momento da liga</span></div>' +
      '<div class="amd-opportunities">' + html + '</div></section>';
  }
  function ribbon(data) {
    var market = data.mercado;
    var passed = data.mosaico && Array.isArray(data.mosaico.passados) ? data.mosaico.passados : [];
    var chips = passed.map(function (game) { return { game: game, result: paid(game, market) }; })
      .filter(function (item) { return item.result != null; }).slice(-28)
      .map(function (item) {
        var minute = String(item.game.h || '').split(':')[1] || '';
        return '<span class="amd-ribbon-chip ' + (item.result ? 'g' : 'r') + '" title="' +
          esc((item.game.casa || '') + ' x ' + (item.game.fora || '') + ' ' + (item.game.placar || '')) + '">' +
          (item.result ? 'G' : 'R') + (minute ? '<small style="font-size:6px">' + esc(minute) + '</small>' : '') + '</span>';
      }).join('');
    return '<section class="amd-panel" id="ultimos-resultados"><div class="amd-panel-head">' +
      '<span class="amd-panel-title">Fita dos últimos resultados</span>' +
      '<span class="amd-panel-meta">' + esc(MARKET_NAMES[market] || market) + '</span></div>' +
      (chips ? '<div class="amd-ribbon">' + chips + '</div>' : '<div class="amd-ribbon-empty">Aguardando resultados da liga.</div>') +
      '</section>';
  }
  function gameCard(game, market) {
    if (!game) return '<div class="amd-game-card empty"></div>';
    var result = paid(game, market);
    var cls = result == null ? 'pending' : result ? 'pay' : 'nopay';
    var odd = marketOdd(game, market), score = game.placar || '—', time = game.h || '--:--';
    var odds = game.odds || {}, lines = [];
    if (odd != null) lines.push(esc((MARKET_NAMES[market] || market).replace('Over ', 'O').replace('Under ', 'U')) + ' ' + esc(odd));
    if (odds.o25 != null && market !== 'o25') lines.push('O2.5 ' + esc(odds.o25));
    if (odds.o35 != null && market !== 'o35') lines.push('O3.5 ' + esc(odds.o35));
    return '<div class="amd-game-card ' + cls + '" title="' + esc((game.casa || '') + ' x ' + (game.fora || '')) + '">' +
      '<div class="amd-game-time">' + esc(time) + '</div>' +
      '<div class="amd-game-teams"><span>' + esc(shortTeam(game.casa)) + '</span><span>' + esc(shortTeam(game.fora)) + '</span></div>' +
      '<div class="amd-game-score">' + esc(score) + '</div>' +
      '<div class="amd-game-odds">' + (lines.length ? lines.slice(0, 2).join('<br>') : 'odds —') + '</div></div>';
  }
  function grid(data) {
    var market = data.mercado, mosaic = data.mosaico || {};
    var all = (mosaic.passados || []).slice(-80).concat((mosaic.futuros || []).slice(0, 30));
    var seen = Object.create(null);
    all = all.filter(function (game) {
      var key = [game.h, game.casa, game.fora].join('|');
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
    var groups = Object.create(null), order = [];
    all.forEach(function (game) {
      var hour = String(game.h || '--').split(':')[0];
      if (!groups[hour]) { groups[hour] = []; order.push(hour); }
      groups[hour].push(game);
    });
    order = order.slice(-5);
    var cols = Math.max(1, Math.min(20, order.reduce(function (max, hour) { return Math.max(max, groups[hour].length); }, 0)));
    var template = 'grid-template-columns:72px repeat(' + cols + ',68px)';
    var headerSource = order.reduce(function (best, hour) {
      return groups[hour].length > best.length ? groups[hour] : best;
    }, []);
    var headOrder = '<div class="amd-grid-row" style="' + template + '"><div class="amd-grid-label">COL</div>';
    var headMinutes = '<div class="amd-grid-row" style="' + template + '"><div class="amd-grid-label">MIN</div>';
    for (var col = 0; col < cols; col += 1) {
      var minute = headerSource[col] ? String(headerSource[col].h || '').split(':')[1] : '';
      headOrder += '<div class="amd-grid-head order">' + (col + 1) + '</div>';
      headMinutes += '<div class="amd-grid-head minute">' + esc(minute || '—') + '</div>';
    }
    headOrder += '</div>'; headMinutes += '</div>';
    var rows = order.map(function (hour) {
      var games = groups[hour].slice(-cols);
      var resolved = games.map(function (game) { return paid(game, market); }).filter(function (value) { return value != null; });
      var greens = resolved.filter(Boolean).length, reds = resolved.length - greens;
      var pct = resolved.length ? Math.round(greens / resolved.length * 100) : 0, cells = '';
      for (var i = 0; i < cols; i += 1) cells += gameCard(games[i], market);
      return '<div class="amd-hour-label"><span>☑</span><b>' + esc(hour) + 'h</b>' +
        '<span class="amd-hour-summary"><span class="g">' + greens + 'G</span> · <span class="r">' + reds + 'R</span> · ' + pct + '%</span></div>' +
        '<div class="amd-grid-row" style="' + template + '"><div class="amd-grid-label">' + pct + '%</div>' + cells + '</div>';
    }).join('');
    if (!rows) rows = '<div class="amd-ribbon-empty">Aguardando a grade de jogos desta liga.</div>';
    return '<section class="amd-panel" id="grade-jogos"><div class="amd-panel-head">' +
      '<span class="amd-panel-title">Grade de jogos — ' + esc(MARKET_NAMES[market] || market) + '</span>' +
      '<span class="amd-panel-meta">últimas horas + próxima rodada</span></div>' +
      '<div class="amd-grid-toolbar"><span class="amd-grid-chip on">Dados reais</span><span class="amd-grid-chip on">Times ON</span>' +
      '<span>🟩 pagou</span><span>🟥 não pagou</span><span>🟦 aguardando</span></div>' +
      '<div class="amd-grid-scroll"><div class="amd-grid-table">' + headOrder + headMinutes + rows + '</div></div>' +
      '<div class="amd-grid-foot">Os cartões preservam os dados e cálculos do AMD Live atual; somente a leitura foi reorganizada no formato da referência.</div></section>';
  }
  function updateSide(data) {
    var count = document.getElementById('sideAlertCount');
    if (count) count.textContent = String((data.analise && data.analise.alertas || []).length);
    var rank = document.getElementById('sideRank');
    if (rank) {
      var marketRanks = data.rankTimes && data.rankTimes[data.mercado];
      var list = marketRanks && (marketRanks.h3 || marketRanks.h6) || [];
      rank.innerHTML = '<div class="amd-side-rank-title">Ranking real · ' + esc(MARKET_NAMES[data.mercado] || data.mercado) + '</div>' +
        list.slice(0, 6).map(function (item, index) {
          return '<div class="amd-side-rank-row"><span>' + (index + 1) + 'º ' + esc(item.time) + '</span><b>' + esc(item.pct) + '%</b></div>';
        }).join('');
    }
    var server = document.getElementById('sideServerGames');
    if (server && data.analise) server.textContent = String(data.analise.total || '—');
  }
  function backtestHtml(data) {
    var rows = (data && data.ultimos10indicados || []).slice().reverse().slice(0, 10);
    if (!rows.length) return '<div class="amd-ribbon-empty">Nenhuma indicação na janela avaliada.</div>';
    return '<div class="amd-backtest-wrap"><table class="amd-backtest"><thead><tr>' +
      '<th>Hora</th><th>Jogo</th><th>Placar</th><th>Score</th><th>EV</th><th>Resultado</th></tr></thead><tbody>' +
      rows.map(function (row) {
        var green = row.resultado === 'GREEN';
        return '<tr><td>' + esc(row.horario || '—') + '</td><td>' + esc(row.nome || '—') + '</td><td>' + esc(row.placar || '—') +
          '</td><td>' + esc(row.score == null ? '—' : row.score) + '</td><td>' + esc(row.ev == null ? '—' : (row.ev > 0 ? '+' : '') + row.ev + '%') +
          '</td><td class="' + (green ? 'green' : 'red') + '">' + (green ? '✓ GREEN' : '× RED') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function render(data) {
    updateSide(data);
    var cached = window.__btC && window.__btC[data.liga + '|' + data.mercado];
    return '<div class="amd-compact" id="compact-dashboard">' + opportunities(data) + ribbon(data) +
      '<section class="amd-panel" id="backtest-compact"><div class="amd-panel-head"><span class="amd-panel-title">Backtest · ' +
      esc(MARKET_NAMES[data.mercado] || data.mercado) + '</span><span class="amd-panel-meta">últimas indicações</span></div>' +
      '<div id="compactBacktest">' + (cached && cached.data ? backtestHtml(cached.data) : '<div class="amd-ribbon-empty">Calculando histórico…</div>') + '</div></section>' +
      grid(data) + '</div><div class="amd-analysis-divider" id="analise-avancada">Análise avançada do mercado</div>';
  }
  function renderBacktest(data) {
    var target = document.getElementById('compactBacktest');
    if (target) target.innerHTML = backtestHtml(data);
  }

  window.AMDReferenceUI = { render: render, renderBacktest: renderBacktest, backtestHtml: backtestHtml };
}());
