(function () {
  'use strict';

  var ROBOTS_KEY = 'amd:robos-manuais:v2';
  var HISTORY_KEY = 'amd:robos-manuais-historico:v2';
  var SIGNALS_KEY = 'amd:robos-manuais-sinais:v2';
  var PROFILE_TARGETS = { agressivo: 50, equilibrado: 65, cauteloso: 80 };
  var ODD_LABELS = {
    'odd_over_0.5': 'Over 0.5', 'odd_over_1.5': 'Over 1.5',
    'odd_over_2.5': 'Over 2.5', 'odd_over_3.5': 'Over 3.5',
    'odd_under_0.5': 'Under 0.5', 'odd_under_1.5': 'Under 1.5',
    'odd_under_2.5': 'Under 2.5', 'odd_under_3.5': 'Under 3.5',
    odd_ambas_sim: 'Ambas Marcam (Sim)', odd_ambas_nao: 'Ambas Marcam (Não)',
    odd_total_gols_extatos_5: '5+ Gols', odd_resultado_final_casa: 'Casa FT',
    odd_resultado_final_empate: 'Empate FT', odd_resultado_final_fora: 'Fora FT'
  };
  var ODD_KEY_BY_MARKET = Object.keys(ODD_LABELS).reduce(function (acc, key) {
    acc[ODD_LABELS[key]] = key;
    return acc;
  }, {});

  var games = [];
  var editingId = '';
  function newRobotId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return String(Date.now()) + '-' + Math.random().toString(36).slice(2, 10);
  }
  var toastTimer = null;
  var patternCells = {};
  var selectedPatternKey = '';
  var loadingPatternCell = false;
  var pageSignals = [];

  function q(selector, base) { return (base || document).querySelector(selector); }
  function qa(selector, base) { return Array.prototype.slice.call((base || document).querySelectorAll(selector)); }
  function selectedLeagues() {
    return qa('input[name="rbLiga"]:checked').map(function (input) { return input.value; });
  }
  function robotLeagues(robot) {
    var values = robot && Array.isArray(robot.leagues) && robot.leagues.length
      ? robot.leagues : [robot && robot.league || 'copa'];
    return Array.from(new Set(values.map(function (value) {
      return String(value || '').toLowerCase();
    }).filter(function (value) {
      return ['copa', 'euro', 'super', 'premier'].indexOf(value) >= 0;
    })));
  }
  function setSelectedLeagues(values) {
    values = Array.isArray(values) && values.length ? values : ['copa'];
    qa('input[name="rbLiga"]').forEach(function (input) {
      input.checked = values.indexOf(input.value) >= 0;
    });
  }
  function readJson(key) {
    try { var value = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value : []; }
    catch (_) { return []; }
  }
  function writeJson(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  function showToast(message) {
    var el = q('#toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }
  function makeOption(value, text) {
    var option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    return option;
  }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }
  function cellMarket(position) {
    if (!position) return '';
    var market = position.markType === 'entry'
      ? (position.entryMarket || position.market || 'Mercado não definido')
      : (position.market || 'Mercado não definido');
    var hasExactScore = position.markType !== 'entry' && position.scoreA !== '' && position.scoreA != null &&
      position.scoreB !== '' && position.scoreB != null;
    return hasExactScore ? market + ' · ' + position.scoreA + '–' + position.scoreB : market;
  }
  function numberOrNull(value) {
    var n = Number(String(value).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  function gameId(game, index) {
    return String(game._rbLeague || '') + '|' + String(game.id || [game.slot_em || '', game.hora || '', game.minuto || '',
      game.time_a || '', game.time_b || '', index].join('|'));
  }
  function gameLabel(game) {
    var hh = String(game.hora == null ? '--' : game.hora).padStart(2, '0');
    var mm = String(game.minuto == null ? '--' : game.minuto).padStart(2, '0');
    var score = game.resultado_ft ? ' · ' + game.resultado_ft : ' · aguardando';
    var league = game._rbLeague ? '[' + String(game._rbLeague).toUpperCase() + '] · ' : '';
    return league + hh + ':' + mm + ' · ' + (game.time_a || '?') + ' x ' + (game.time_b || '?') + score;
  }
  function selectedGame() {
    var id = q('#rbGame').value;
    if (!id) return null;
    for (var i = 0; i < games.length; i++) {
      if (gameId(games[i], i) === id) return games[i];
    }
    return null;
  }
  function filteredGames() {
    var exact = selectedGame();
    if (exact) return [exact];
    var teamA = q('#rbTeamA').value;
    var teamB = q('#rbTeamB').value;
    return games.filter(function (game) {
      var names = [String(game.time_a || ''), String(game.time_b || '')];
      return (!teamA || names.indexOf(teamA) >= 0) && (!teamB || names.indexOf(teamB) >= 0);
    });
  }
  function setDataStatus(kind, text) {
    var el = q('#dataStatus');
    el.className = 'data-status' + (kind ? ' ' + kind : '');
    q('span', el).textContent = text;
  }

  function populateNumbers() {
    var minuteFrom = q('#rbMinuteFrom');
    var minuteTo = q('#rbMinuteTo');
    for (var i = 0; i <= 90; i++) {
      minuteFrom.appendChild(makeOption(String(i), String(i) + "'"));
      minuteTo.appendChild(makeOption(String(i), String(i) + "'"));
    }
    minuteFrom.value = '15';
    minuteTo.value = '30';

    [q('#rbScoreA'), q('#rbScoreB')].forEach(function (select) {
      select.appendChild(makeOption('', 'Não fixar'));
      for (var n = 0; n <= 8; n++) select.appendChild(makeOption(String(n), String(n) + (n === 1 ? ' gol' : ' gols')));
    });
  }

  function setupPatternControls() {
    var market = q('#rbMarket');
    var entryMarket = q('#rbEntryMarket');
    var marketSlot = q('#rbQuickMarketSlot');
    var entrySlot = q('#rbQuickEntrySlot');
    if (!market || !entryMarket || !marketSlot || !entrySlot) return;

    /* A entrada precisa oferecer exatamente o mesmo catálogo completo usado
       nas condições. Assim não existem dois conjuntos de mercados diferentes. */
    entryMarket.innerHTML = market.innerHTML;
    entryMarket.value = 'Over 2.5';

    var marketField = market.closest('label');
    var entryField = entryMarket.closest('label');
    marketField.classList.remove('wide');
    entryField.classList.remove('wide');
    marketField.classList.add('pattern-rule-field');
    entryField.classList.add('pattern-entry-field');
    q('span', marketField).textContent = 'Mercado da condição selecionada';
    q('span', entryField).textContent = 'Mercado que será enviado na entrada';
    marketSlot.appendChild(marketField);
    entrySlot.appendChild(entryField);
  }
  function updateNotificationStatus() {
    var status = q('#notificationStatus');
    if (!status) return;
    if (!('Notification' in window)) status.textContent = 'Este navegador não oferece notificações.';
    else if (Notification.permission === 'granted') status.textContent = 'Ativada · o aviso será enviado assim que a entrada confirmar.';
    else if (Notification.permission === 'denied') status.textContent = 'Bloqueada nas permissões do navegador.';
    else status.textContent = 'Permissão ainda não ativada.';
  }
  function renderSignals() {
    var list = q('#signalList'); if (!list) return;
    var signals = readJson(SIGNALS_KEY).slice(0, 100);
    q('#signalCount').textContent = String(signals.length); list.innerHTML = '';
    list.classList.toggle('empty', !signals.length);
    if (!signals.length) { list.textContent = 'Nenhuma entrada enviada ainda.'; return; }
    signals.forEach(function (signal) {
      var row = document.createElement('article'); row.className = 'history-row';
      var copy = document.createElement('div'), title = document.createElement('h3'), text = document.createElement('p');
      title.textContent = (signal.robotName || 'Robô manual') + ' · ' + (signal.market || 'Entrada');
      var maximum = Math.max(1, Number(signal.shots || 1));
      var current = Math.max(1, Number(signal.winningShot || signal.currentShot || 1));
      var gameAt = signal.gameSlot ? new Date(signal.gameSlot).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'horário aguardando';
      var attemptList = Array.isArray(signal.attempts) ? signal.attempts : [];
      text.textContent = String(signal.league || 'copa').toUpperCase() + ' · ' + (signal.timeA || '?') + ' x ' + (signal.timeB || '?') +
        ' · TIRO ' + current + '/' + maximum + ' · jogo ' + gameAt + (signal.score ? ' · placar ' + signal.score : '');
      var cycle = document.createElement('div'); cycle.className = 'result-cycle';
      attemptList.forEach(function (attempt) {
        var at = String(attempt.gameHour || '');
        if (!at && attempt.gameSlot) {
          var dt = new Date(attempt.gameSlot);
          if (!isNaN(dt.getTime())) at = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        }
        var item = document.createElement('span');
        item.className = 'result-attempt ' + String(attempt.status || '').toLowerCase();
        var jogo = (attempt.timeA || '?') + ' × ' + (attempt.timeB || '?');
        var cabecalho = document.createElement('small');
        var resultado = document.createElement('b');
        var confronto = document.createElement('em');
        cabecalho.textContent = 'TIRO ' + attempt.number + ' · JOGO ' + (at || '--:--');
        resultado.textContent = String(attempt.status || 'PENDENTE') + (attempt.score ? ' · ' + attempt.score : '');
        confronto.textContent = jogo;
        item.appendChild(cabecalho); item.appendChild(resultado); item.appendChild(confronto);
        cycle.appendChild(item);
      });
      var badge = document.createElement('b'); badge.className = 'result-badge ' + String(signal.status || 'PENDENTE').toLowerCase(); badge.textContent = signal.status || 'PENDENTE';
      copy.appendChild(title); copy.appendChild(text); if (attemptList.length) copy.appendChild(cycle);
      row.appendChild(copy); row.appendChild(badge); list.appendChild(row);
    });
  }

  function positionFields() {
    var markType = q('#rbMarkType').value;
    var minuteOp = q('#rbMinuteOp').value;
    return {
      markType: markType,
      join: q('#rbCellJoin').value,
      teamOrder: q('#rbTeamOrder').value,
      teamA: q('#rbTeamA').value,
      teamB: q('#rbTeamB').value,
      market: markType === 'entry' ? q('#rbEntryMarket').value : q('#rbMarket').value,
      entryMarket: q('#rbEntryMarket').value,
      game: q('#rbGame').value,
      minuteConfigured: minuteOp !== 'any',
      minuteOp: minuteOp,
      minuteFrom: minuteOp === 'any' ? '' : q('#rbMinuteFrom').value,
      minuteTo: minuteOp === 'any' ? '' : q('#rbMinuteTo').value,
      scoreResult: q('#rbScoreResult').value,
      scoreA: q('#rbScoreA').value,
      scoreB: q('#rbScoreB').value,
      odd: q('#rbOdd').value
    };
  }

  function saveSelectedPosition() {
    if (!selectedPatternKey || loadingPatternCell) return;
    var coords = selectedPatternKey.split(':');
    patternCells[selectedPatternKey] = Object.assign({ key: selectedPatternKey,
      row: Number(coords[0]), column: Number(coords[1]) }, positionFields());
    renderPatternGrid();
  }

  function applyPosition(position) {
    loadingPatternCell = true;
    position = position || {};
    q('#rbMarkType').value = position.markType || 'pattern';
    q('#rbCellJoin').value = position.join || 'all';
    q('#rbTeamOrder').value = position.teamOrder || 'random';
    if ((position.markType || 'pattern') === 'entry') {
      q('#rbEntryMarket').value = position.entryMarket || position.market || q('#rbEntryMarket').value || 'Over 2.5';
    } else {
      q('#rbMarket').value = position.market || 'Over 2.5';
    }
    var legacyDefaultMinute = position.minuteConfigured == null &&
      (position.minuteOp || 'equal') === 'equal' && String(position.minuteFrom == null ? 15 : position.minuteFrom) === '15' &&
      String(position.minuteTo == null ? 30 : position.minuteTo) === '30';
    var minuteEnabled = position.minuteConfigured === true ||
      (position.minuteConfigured == null && !legacyDefaultMinute && position.minuteFrom !== '' && position.minuteFrom != null);
    q('#rbMinuteOp').value = minuteEnabled ? (position.minuteOp || 'equal') : 'any';
    q('#rbMinuteFrom').value = position.minuteFrom == null ? '15' : String(position.minuteFrom);
    q('#rbMinuteTo').value = position.minuteTo == null ? '30' : String(position.minuteTo);
    q('#rbScoreResult').value = position.scoreResult || '';
    q('#rbScoreA').value = position.scoreA == null ? '' : String(position.scoreA);
    q('#rbScoreB').value = position.scoreB == null ? '' : String(position.scoreB);
    if (qa('option', q('#rbTeamA')).some(function (o) { return o.value === position.teamA; })) q('#rbTeamA').value = position.teamA || '';
    else q('#rbTeamA').value = '';
    if (qa('option', q('#rbTeamB')).some(function (o) { return o.value === position.teamB; })) q('#rbTeamB').value = position.teamB || '';
    else q('#rbTeamB').value = '';
    fillOdds(position.odd || '');
    updateMinuteVisibility();
    loadingPatternCell = false;
    renderPreview();
  }

  function selectPatternCell(key) {
    saveSelectedPosition();
    selectedPatternKey = key;
    if (patternCells[key]) {
      applyPosition(patternCells[key]);
    } else {
      /* Uma célula nova usa as escolhas que estão visíveis no topo do quadro.
         Antes elas eram apagadas ao clicar, por isso "Entrada" virava padrão. */
      var coords = key.split(':');
      patternCells[key] = Object.assign({ key: key,
        row: Number(coords[0]), column: Number(coords[1]) }, positionFields());
    }
    renderPatternGrid();
    renderPreview();
  }

  function renderPatternGrid() {
    var grid = q('#rbPatternGrid');
    if (!grid) return;
    grid.innerHTML = '';
    for (var row = 8; row >= 1; row--) {
      var label = document.createElement('div');
      label.className = 'pattern-cell row-label'; label.textContent = String(row);
      grid.appendChild(label);
      for (var column = 1; column <= 20; column++) {
        (function (key, col) {
          var button = document.createElement('button');
          var saved = patternCells[key];
          button.type = 'button'; button.className = 'pattern-cell';
          button.innerHTML = saved
            ? '<small>' + col + '</small><b>' + escapeHtml(cellMarket(saved)) + '</b>'
            : '<span>' + col + '</span>';
          button.dataset.patternKey = key;
          if (saved) button.classList.add(saved.markType === 'entry' ? 'entry' : 'selected');
          if (key === selectedPatternKey) button.classList.add('current');
          button.setAttribute('aria-label', saved
            ? ('Linha ' + row + ', posição ' + col + ', ' + (saved.markType === 'entry' ? 'disparo da entrada ' + (saved.entryMarket || saved.market || '') : 'condição ' + (saved.market || '')))
            : ('Linha ' + row + ', posição ' + col + ', vazia'));
          button.addEventListener('click', function () { selectPatternCell(key); });
          grid.appendChild(button);
        })(row + ':' + column, column);
      }
    }
    var positions = Object.keys(patternCells);
    var entries = positions.filter(function (key) { return patternCells[key].markType === 'entry'; });
    q('#rbPatternSummary').innerHTML = positions.length
      ? '<strong>' + (positions.length - entries.length) + '</strong> condição(ões) · <strong>' + entries.length + '</strong> disparo(s) de entrada'
      : 'Clique em uma posição para começar a configurar.';
    var selected = q('#selectedPosition');
    if (selectedPatternKey) {
      var coords = selectedPatternKey.split(':');
      selected.classList.remove('empty');
      q('b', selected).textContent = 'LINHA ' + coords[0] + ' · POSIÇÃO ' + coords[1];
      q('span', selected).textContent = q('#rbMarkType').value === 'entry'
        ? 'DISPARO · envia ' + q('#rbEntryMarket').value + ' no próximo jogo.'
        : 'CONDIÇÃO · exige ' + q('#rbMarket').value + ' neste jogo.';
    } else {
      selected.classList.add('empty');
      q('b', selected).textContent = 'NENHUMA POSIÇÃO';
      q('span', selected).textContent = 'Clique em uma célula do quadro acima.';
    }
  }

  function removePatternCell() {
    if (!selectedPatternKey) return showToast('Selecione uma posição para remover.');
    delete patternCells[selectedPatternKey];
    selectedPatternKey = '';
    renderPatternGrid(); renderPreview();
  }

  function clearPatternGrid() {
    patternCells = {}; selectedPatternKey = '';
    renderPatternGrid(); renderPreview(); showToast('Quadro limpo.');
  }

  function searchRecentPattern() {
    var complete = games.filter(function (game) {
      return game.resultado_ft && Number(game.gols_a) <= 8 && Number(game.gols_b) <= 8;
    }).slice(-8);
    if (!complete.length) return showToast('Ainda não há resultados reais disponíveis para buscar um padrão.');
    patternCells = {};
    complete.forEach(function (game, index) {
      var a = Number(game.gols_a), b = Number(game.gols_b), key = '1:' + (index + 1);
      patternCells[key] = { key: key, row: 1, column: index + 1, markType: 'pattern', join: 'all',
        teamOrder: 'random', teamA: '', teamB: '', market: 'Total Gols (FT)', game: '',
        minuteOp: 'equal', minuteFrom: String(game.minuto || 0), minuteTo: '30',
        scoreResult: a > b ? 'home' : a < b ? 'away' : 'draw', scoreA: String(a), scoreB: String(b), odd: '' };
    });
    var entryColumn = Math.min(20, complete.length + 1);
    var entryKey = '1:' + entryColumn;
    patternCells[entryKey] = Object.assign({}, patternCells[entryKey] || {}, {
      key: entryKey,
      row: 1,
      column: entryColumn,
      markType: 'entry',
      market: q('#rbEntryMarket').value,
      entryMarket: q('#rbEntryMarket').value
    });
    selectedPatternKey = entryKey;
    applyPosition(patternCells[entryKey]); renderPatternGrid();
    showToast('Últimos ' + complete.length + ' resultados colocados na primeira linha para edição.');
  }

  function scoreCondition() {
    var result = q('#rbScoreResult').value;
    var rawA = q('#rbScoreA').value;
    var rawB = q('#rbScoreB').value;
    var hasA = rawA !== '';
    var hasB = rawB !== '';
    if (hasA !== hasB) {
      return { valid: false, message: 'Escolha também o placar do outro time para formar um placar fixo.' };
    }
    if (!hasA) return { valid: true, fixed: false, result: result };
    var a = Number(rawA);
    var b = Number(rawB);
    var actual = a > b ? 'home' : a < b ? 'away' : 'draw';
    if (result && result !== actual) {
      return { valid: false, fixed: true, result: result, a: a, b: b,
        message: 'O placar ' + a + '–' + b + ' não corresponde ao resultado escolhido.' };
    }
    return { valid: true, fixed: true, result: result || actual, a: a, b: b };
  }

  function renderScoreHelp() {
    var condition = scoreCondition();
    var help = q('#scoreHelp');
    help.dataset.state = condition.valid ? 'ok' : 'error';
    if (!condition.valid) {
      help.textContent = condition.message;
      return condition;
    }
    if (condition.fixed) {
      help.textContent = 'Placar fixo selecionado: ' + condition.a + '–' + condition.b + '. O limite é de 0 a 8 gols por time.';
    } else if (condition.result) {
      help.textContent = 'Resultado selecionado sem placar exato. Os gols podem variar de 0 a 8.';
    } else {
      help.textContent = 'Para usar placar fixo, escolha os dois números. Ex.: 2 e 1 cria o placar 2–1.';
    }
    return condition;
  }

  function marketOddKey(market) {
    return ODD_KEY_BY_MARKET[market] || '';
  }

  function fillTeams(previousA, previousB) {
    var names = {};
    games.forEach(function (game) {
      if (game.time_a) names[String(game.time_a)] = true;
      if (game.time_b) names[String(game.time_b)] = true;
    });
    var list = Object.keys(names).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
    var a = q('#rbTeamA');
    var b = q('#rbTeamB');
    a.innerHTML = '';
    b.innerHTML = '';
    a.appendChild(makeOption('', 'Qualquer time'));
    b.appendChild(makeOption('', 'Qualquer adversário'));
    list.forEach(function (name) {
      a.appendChild(makeOption(name, name));
      b.appendChild(makeOption(name, name));
    });
    if (list.indexOf(previousA) >= 0) a.value = previousA;
    if (list.indexOf(previousB) >= 0) b.value = previousB;
    return list.length;
  }

  function fillGames(previous) {
    var select = q('#rbGame');
    select.innerHTML = '';
    select.appendChild(makeOption('', 'Todas as partidas disponíveis'));
    games.slice().sort(function (a, b) {
      return String(b.slot_em || b.criado_em || '').localeCompare(String(a.slot_em || a.criado_em || ''));
    }).slice(0, 350).forEach(function (game) {
      var index = games.indexOf(game);
      select.appendChild(makeOption(gameId(game, index), gameLabel(game)));
    });
    if (qa('option', select).some(function (o) { return o.value === previous; })) select.value = previous;
  }

  function fillOdds(previous) {
    var select = q('#rbOdd');
    var help = q('#oddHelp');
    var market = q('#rbMarket').value;
    var key = marketOddKey(market);
    select.innerHTML = '';
    select.appendChild(makeOption('', 'Qualquer odd real disponível'));

    if (!key) {
      select.disabled = true;
      select.innerHTML = '';
      select.appendChild(makeOption('', 'Sem cotação publicada para este mercado'));
      help.textContent = 'O mercado pode ser usado no padrão, mas a grade não publica uma odd própria para ele. Nenhum número foi inventado.';
      return 0;
    }

    var values = {};
    filteredGames().forEach(function (game) {
      var raw = game.odds && game.odds[key];
      var odd = numberOrNull(raw);
      if (odd == null || odd <= 1 || odd >= 100) return;
      var fixed = odd.toFixed(2);
      values[fixed] = (values[fixed] || 0) + 1;
    });
    var sorted = Object.keys(values).sort(function (a, b) { return Number(a) - Number(b); });
    sorted.forEach(function (value) {
      var count = values[value];
      select.appendChild(makeOption(value, value + ' · disponível em ' + count + (count === 1 ? ' jogo' : ' jogos')));
    });
    select.disabled = false;
    if (sorted.indexOf(previous) >= 0) select.value = previous;
    help.textContent = sorted.length
      ? sorted.length + ' odds exatas de ' + market + ' encontradas nos jogos filtrados. Não existe faixa de odd.'
      : 'Nenhuma odd de ' + market + ' está publicada agora para os jogos filtrados.';
    return sorted.length;
  }

  async function loadData(preserve) {
    var ligas = selectedLeagues();
    var teamA = preserve && preserve.teamA != null ? preserve.teamA : q('#rbTeamA').value;
    var teamB = preserve && preserve.teamB != null ? preserve.teamB : q('#rbTeamB').value;
    var game = preserve && preserve.game != null ? preserve.game : q('#rbGame').value;
    var odd = preserve && preserve.odd != null ? preserve.odd : q('#rbOdd').value;
    if (!ligas.length) {
      games = [];
      fillTeams('', ''); fillGames(''); fillOdds('');
      setDataStatus('error', 'Marque pelo menos uma liga para carregar os dados reais.');
      renderPreview();
      return;
    }
    setDataStatus('loading', 'Carregando times e odds reais de ' + ligas.length +
      (ligas.length === 1 ? ' liga…' : ' ligas…'));
    q('#rbRefresh').disabled = true;
    try {
      var results = await Promise.all(ligas.map(function (liga) {
        var request = window.AMDGradeTabs && typeof window.AMDGradeTabs.request === 'function'
          ? window.AMDGradeTabs.request({ liga: liga, horas: 168, compacto: true, maxAgeMs: 1500 })
          : fetch('/api/grade?liga=' + encodeURIComponent(liga) +
              '&horas=168&compacto=1&_=' + Date.now(), {
              cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' }
            }).then(function (response) {
              if (!response.ok) throw new Error('HTTP ' + response.status);
              return response.json();
            });
        return request.then(function (payload) {
          return { liga: liga, payload: payload };
        }).catch(function (error) {
          return { liga: liga, error: error };
        });
      }));
      var ok = results.filter(function (result) {
        return result.payload && Array.isArray(result.payload.partidas);
      });
      if (!ok.length) throw new Error('nenhuma liga respondeu');
      games = [];
      ok.forEach(function (result) {
        result.payload.partidas.forEach(function (gameItem) {
          if (gameItem && (gameItem.time_a || gameItem.time_b)) {
            games.push(Object.assign({}, gameItem, { _rbLeague: result.liga }));
          }
        });
      });
      var teams = fillTeams(teamA, teamB);
      fillGames(game);
      var odds = fillOdds(odd);
      setDataStatus(ok.length < ligas.length ? 'error' : '', ok.length + '/' + ligas.length +
        ' ligas · ' + games.length + ' jogos · ' + teams + ' times · ' + odds +
        ' odds exatas disponíveis no filtro atual');
    } catch (error) {
      games = [];
      fillTeams('', '');
      fillGames('');
      fillOdds('');
      setDataStatus('error', 'Não foi possível ler a grade agora: ' + error.message +
        '. Nenhuma odd simulada será mostrada.');
    } finally {
      q('#rbRefresh').disabled = false;
      renderPreview();
    }
  }

  function metricRules() {
    return qa('.metric-card').map(function (card) {
      return {
        key: card.dataset.key,
        name: q('b', card).textContent,
        weight: Number(card.dataset.weight || 0),
        use: q('.metric-use', card).checked,
        expected: q('.metric-now', card).classList.contains('on')
      };
    });
  }
  function scoreResult() {
    var rules = metricRules().filter(function (rule) { return rule.use; });
    var confirmed = rules.filter(function (rule) { return rule.expected; });
    var points = confirmed.reduce(function (sum, rule) { return sum + rule.weight; }, 0);
    var maximum = rules.reduce(function (sum, rule) { return sum + rule.weight; }, 0);
    var target = Number(q('#rbThreshold').value || 65);
    var status = points >= target ? 'ENTRADA' : points >= target - 15 ? 'OBSERVAR' : 'AGUARDAR';
    return { points: Math.min(100, points), maximum: Math.min(100, maximum), target: target, status: status };
  }

  function conditionSummary() {
    var parts = [];
    var ligas = selectedLeagues();
    parts.push(ligas.length ? 'Ligas: ' + ligas.map(function (liga) {
      return liga.charAt(0).toUpperCase() + liga.slice(1);
    }).join(', ') : 'Nenhuma liga');
    var teamA = q('#rbTeamA').value;
    var teamB = q('#rbTeamB').value;
    var positions = Object.keys(patternCells);
    if (positions.length) parts.push(positions.length + ' posições no quadro');
    parts.push(teamA ? 'Time: ' + teamA : 'Qualquer time');
    if (teamB) parts.push('Adversário: ' + teamB);
    parts.push(q('#rbMarket').value);
    parts.push('Entrada: ' + q('#rbEntryMarket').value);
    var op = q('#rbMinuteOp').value;
    var from = q('#rbMinuteFrom').value;
    var to = q('#rbMinuteTo').value;
    parts.push(op === 'any' ? 'qualquer minuto' : op === 'equal' ? "minuto " + from : op === 'from' ? "a partir de " + from + "'"
      : op === 'until' ? "até " + from + "'" : "entre " + from + "' e " + to + "'");
    var resultLabels = { home: 'mandante vence', draw: 'empate', away: 'visitante vence' };
    var score = scoreCondition();
    if (score.result) parts.push(resultLabels[score.result]);
    if (score.fixed) parts.push((score.valid ? 'placar fixo ' : 'placar incompatível ') + score.a + '-' + score.b);
    if (q('#rbOdd').value) parts.push('odd exata ' + Number(q('#rbOdd').value).toFixed(2));
    return parts.join(' · ');
  }

  function renderPreview() {
    var result = scoreResult();
    var name = q('#rbName').value.trim();
    q('#previewName').textContent = name || 'Robô sem nome';
    q('#previewStatus').textContent = result.status;
    q('#previewScore').textContent = result.points + '/100';
    q('#previewTarget').textContent = 'alvo ' + result.target + ' · máximo ' + result.maximum;
    q('#previewSummary').textContent = conditionSummary();
    q('#previewCard').dataset.status = result.status.toLowerCase();
    renderScoreHelp();
    qa('.metric-card').forEach(function (card) {
      card.classList.toggle('disabled', !q('.metric-use', card).checked);
    });
  }

  function collectConfig() {
    var leagues = selectedLeagues();
    return {
      id: editingId || newRobotId(),
      name: q('#rbName').value.trim(),
      leagues: leagues,
      league: leagues[0] || '',
      join: q('#rbJoin').value,
      profile: q('#rbProfile').value,
      threshold: Number(q('#rbThreshold').value),
      metrics: metricRules(),
      pattern: Object.keys(patternCells).map(function (key) { return patternCells[key]; }),
      teamA: q('#rbTeamA').value,
      teamB: q('#rbTeamB').value,
      market: q('#rbMarket').value,
      game: q('#rbGame').value,
      gameLabel: q('#rbGame').selectedOptions[0] ? q('#rbGame').selectedOptions[0].textContent : '',
      minuteConfigured: q('#rbMinuteOp').value !== 'any',
      minuteOp: q('#rbMinuteOp').value,
      minuteFrom: q('#rbMinuteOp').value === 'any' ? '' : q('#rbMinuteFrom').value,
      minuteTo: q('#rbMinuteOp').value === 'any' ? '' : q('#rbMinuteTo').value,
      scoreResult: q('#rbScoreResult').value,
      scoreA: q('#rbScoreA').value,
      scoreB: q('#rbScoreB').value,
      odd: q('#rbOdd').value,
      oddLabel: q('#rbOdd').selectedOptions[0] ? q('#rbOdd').selectedOptions[0].textContent : '',
      entryMarket: q('#rbEntryMarket').value,
      shots: Number(q('#rbShots').value || 1),
      active: q('#rbActive').checked,
      activatedAt: q('#rbActive').checked ? new Date().toISOString() : null,
      updatedAt: new Date().toISOString()
    };
  }

  function saveRobot(forceActive) {
    if (forceActive === true) q('#rbActive').checked = true;
    var wasEditing = !!editingId;
    var robot = collectConfig();
    if (!robot.leagues.length) {
      showToast('Marque pelo menos uma liga para salvar o robô.');
      return;
    }
    if (!robot.name) {
      q('#rbName').focus();
      showToast('Digite um nome para salvar o robô.');
      return;
    }
    var score = scoreCondition();
    if (!score.valid) {
      q('#rbScoreA').focus();
      showToast(score.message);
      return;
    }
    if (robot.active && !robot.pattern.some(function (position) { return position.markType === 'entry'; })) {
      showToast('Marque pelo menos uma posição do quadro como Entrada.');
      return;
    }
    var robots = readJson(ROBOTS_KEY);
    var index = robots.findIndex(function (item) { return item.id === robot.id; });
    if (index >= 0 && robots[index].active && robot.active) robot.activatedAt = robots[index].activatedAt || robots[index].updatedAt;
    if (index >= 0) robots[index] = robot;
    else robots.unshift(robot);
    writeJson(ROBOTS_KEY, robots.slice(0, 100));
    /* Um robo recem-criado nao deve deixar o formulario preso ao ID salvo.
       Antes, o proximo Salvar substituia esse robo em vez de acrescentar outro.
       Somente o fluxo iniciado pelo botao Editar continua ligado ao mesmo ID. */
    if (wasEditing) editingId = robot.id;
    else resetForm(true);
    renderSaved();
    var savedPanel = q('#savedList') && q('#savedList').closest('details');
    if (savedPanel) savedPanel.open = true;
    showToast(robot.active ? 'Robô salvo e ATIVO. Ele já está vigiando novas entradas.' : 'Robô salvo como DESATIVADO.');
  }

  function resetForm(silent) {
    editingId = '';
    q('#rbName').value = '';
    setSelectedLeagues(['copa']);
    q('#rbJoin').value = 'all';
    q('#rbProfile').value = 'equilibrado';
    q('#rbThreshold').value = '65';
    q('#rbMarket').value = 'Over 2.5';
    q('#rbMinuteOp').value = 'any';
    q('#rbMinuteFrom').value = '15';
    q('#rbMinuteTo').value = '30';
    q('#rbScoreResult').value = '';
    q('#rbScoreA').value = '';
    q('#rbScoreB').value = '';
    q('#rbEntryMarket').value = 'Over 2.5';
    q('#rbShots').value = '3';
    q('#rbActive').checked = false;
    patternCells = {}; selectedPatternKey = ''; renderPatternGrid();
    qa('.metric-card').forEach(function (card, index) {
      q('.metric-use', card).checked = true;
      var now = q('.metric-now', card);
      var on = index < 3;
      now.classList.toggle('on', on);
      now.setAttribute('aria-pressed', on ? 'true' : 'false');
      now.textContent = 'Exigir: ' + (on ? 'SIM' : 'NÃO');
    });
    updateMinuteVisibility();
    loadData({ teamA: '', teamB: '', game: '', odd: '' });
    renderPreview();
    if (silent !== true) showToast('Novo padrão iniciado.');
  }

  async function loadRobot(id) {
    var robot = readJson(ROBOTS_KEY).find(function (item) { return item.id === id; });
    if (!robot) return;
    editingId = robot.id;
    q('#rbName').value = robot.name || '';
    setSelectedLeagues(robotLeagues(robot));
    q('#rbJoin').value = robot.join || 'all';
    q('#rbProfile').value = robot.profile || 'equilibrado';
    q('#rbThreshold').value = String(robot.threshold || 65);
    q('#rbMarket').value = robot.market || 'Over 2.5';
    var legacyDefaultMinute = robot.minuteConfigured == null &&
      (robot.minuteOp || 'equal') === 'equal' && String(robot.minuteFrom == null ? 15 : robot.minuteFrom) === '15' &&
      String(robot.minuteTo == null ? 30 : robot.minuteTo) === '30';
    q('#rbMinuteOp').value = robot.minuteConfigured === true ||
      (robot.minuteConfigured == null && !legacyDefaultMinute && robot.minuteFrom !== '' && robot.minuteFrom != null)
      ? (robot.minuteOp || 'equal') : 'any';
    q('#rbMinuteFrom').value = String(robot.minuteFrom == null ? 15 : robot.minuteFrom);
    q('#rbMinuteTo').value = String(robot.minuteTo == null ? 30 : robot.minuteTo);
    q('#rbScoreResult').value = robot.scoreResult || '';
    q('#rbScoreA').value = robot.scoreA == null ? '' : String(robot.scoreA);
    q('#rbScoreB').value = robot.scoreB == null ? '' : String(robot.scoreB);
    q('#rbEntryMarket').value = robot.entryMarket || 'Over 2.5';
    q('#rbShots').value = String(robot.shots || 3);
    q('#rbActive').checked = !!robot.active;
    patternCells = {};
    (robot.pattern || []).forEach(function (position) { if (position && position.key) patternCells[position.key] = position; });
    selectedPatternKey = Object.keys(patternCells)[0] || '';
    renderPatternGrid();
    qa('.metric-card').forEach(function (card) {
      var saved = (robot.metrics || []).find(function (rule) { return rule.key === card.dataset.key; });
      if (!saved) return;
      q('.metric-use', card).checked = saved.use !== false;
      var now = q('.metric-now', card);
      now.classList.toggle('on', !!saved.expected);
      now.setAttribute('aria-pressed', saved.expected ? 'true' : 'false');
      now.textContent = 'Exigir: ' + (saved.expected ? 'SIM' : 'NÃO');
    });
    updateMinuteVisibility();
    await loadData({ teamA: robot.teamA || '', teamB: robot.teamB || '',
      game: robot.game || '', odd: robot.odd || '' });
    if (selectedPatternKey && patternCells[selectedPatternKey]) applyPosition(patternCells[selectedPatternKey]);
    renderPreview();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    showToast('Robô carregado para edição.');
  }

  function deleteRobot(id) {
    var robots = readJson(ROBOTS_KEY).filter(function (item) { return item.id !== id; });
    writeJson(ROBOTS_KEY, robots);
    if (editingId === id) editingId = '';
    renderSaved();
    showToast('Robô removido.');
  }

  function renderSaved() {
    var robots = readJson(ROBOTS_KEY);
    var list = q('#savedList');
    q('#savedCount').textContent = String(robots.length);
    list.innerHTML = '';
    list.classList.toggle('empty', !robots.length);
    if (!robots.length) {
      list.textContent = 'Nenhum robô salvo.';
      return;
    }
    robots.forEach(function (robot) {
      var row = document.createElement('article');
      row.className = 'saved-row';
      var copy = document.createElement('div');
      var title = document.createElement('h3');
      title.textContent = robot.name;
      var text = document.createElement('p');
      var conditions = (robot.pattern || []).filter(function (position) {
        return position.markType !== 'entry';
      }).map(cellMarket).filter(Boolean);
      var entries = (robot.pattern || []).filter(function (position) {
        return position.markType === 'entry';
      }).map(cellMarket).filter(Boolean);
      conditions = Array.from(new Set(conditions));
      entries = Array.from(new Set(entries));
      text.textContent = robotLeagues(robot).map(function (liga) { return liga.toUpperCase(); }).join(', ') +
        ' · CONDIÇÃO: ' + (conditions.join(' + ') || robot.market || 'não definida') +
        ' · ENTRADA: ' + (entries.join(' + ') || robot.entryMarket || 'não definida') +
        ' · ' + (robot.active ? 'ATIVO' : 'DESATIVADO');
      copy.appendChild(title);
      copy.appendChild(text);
      var actions = document.createElement('div');
      actions.className = 'row-actions';
      var edit = document.createElement('button');
      edit.type = 'button'; edit.textContent = 'Editar';
      edit.addEventListener('click', function () { loadRobot(robot.id); });
      var toggle = document.createElement('button');
      toggle.type = 'button'; toggle.textContent = robot.active ? 'Desativar' : 'Ativar';
      toggle.className = robot.active ? 'danger' : 'active';
      toggle.addEventListener('click', function () {
        var all = readJson(ROBOTS_KEY);
        var current = all.find(function (item) { return item.id === robot.id; });
        if (!current) return;
        current.active = !current.active;
        current.updatedAt = new Date().toISOString();
        if (current.active) current.activatedAt = current.updatedAt;
        writeJson(ROBOTS_KEY, all);
        renderSaved();
        showToast(current.active ? 'Robô ATIVADO.' : 'Robô DESATIVADO.');
      });
      var remove = document.createElement('button');
      remove.type = 'button'; remove.textContent = 'Excluir robô'; remove.className = 'danger';
      remove.addEventListener('click', function () { deleteRobot(robot.id); });
      actions.appendChild(toggle); actions.appendChild(edit); actions.appendChild(remove);
      row.appendChild(copy); row.appendChild(actions); list.appendChild(row);
    });
  }

  function runTest() {
    var config = collectConfig();
    var score = scoreCondition();
    if (!score.valid) {
      q('#rbScoreA').focus();
      showToast(score.message);
      return;
    }
    var result = scoreResult();
    var history = readJson(HISTORY_KEY);
    history.unshift({
      id: String(Date.now()), name: config.name || 'Robô sem nome',
      status: result.status, points: result.points, target: result.target,
      summary: conditionSummary(), createdAt: new Date().toISOString()
    });
    writeJson(HISTORY_KEY, history.slice(0, 200));
    renderHistory();
    renderPreview();
    showToast('Teste registrado: ' + result.status + ' · ' + result.points + '/100.');
  }

  function renderHistory() {
    var history = readJson(HISTORY_KEY);
    var list = q('#historyList');
    q('#historyCount').textContent = String(history.length);
    list.innerHTML = '';
    list.classList.toggle('empty', !history.length);
    if (!history.length) {
      list.textContent = 'Nenhum teste realizado.';
      return;
    }
    history.forEach(function (item) {
      var row = document.createElement('article');
      row.className = 'history-row';
      var copy = document.createElement('div');
      var title = document.createElement('h3');
      var date = new Date(item.createdAt);
      title.textContent = item.name + ' · ' + date.toLocaleString('pt-BR');
      var text = document.createElement('p');
      text.textContent = item.summary;
      copy.appendChild(title); copy.appendChild(text);
      var badge = document.createElement('span');
      badge.className = 'result-badge';
      badge.textContent = item.status + ' · ' + item.points + '/' + item.target;
      row.appendChild(copy); row.appendChild(badge); list.appendChild(row);
    });
  }

  function clearHistory() {
    var history = readJson(HISTORY_KEY);
    if (!history.length) {
      showToast('O histórico de testes já está vazio.');
      return;
    }
    if (!window.confirm('Apagar todo o histórico de testes? Os robôs salvos não serão excluídos.')) return;
    writeJson(HISTORY_KEY, []);
    renderHistory();
    showToast('Histórico de testes apagado.');
  }

  function updateMinuteVisibility() {
    var op = q('#rbMinuteOp').value;
    q('#minuteFromField').classList.toggle('hidden', op === 'any');
    q('#minuteToField').classList.toggle('hidden', op !== 'between');
  }

  function bindEvents() {
    q('#rbNew').addEventListener('click', resetForm);
    q('#rbSave').addEventListener('click', saveRobot);
    q('#rbSaveActivate').addEventListener('click', function () { saveRobot(true); });
    q('#rbTest').addEventListener('click', runTest);
    q('#rbClearHistory').addEventListener('click', clearHistory);
    q('#rbRefresh').addEventListener('click', function () { loadData(); });
    q('#rbPatternRemove').addEventListener('click', removePatternCell);
    q('#rbPatternClear').addEventListener('click', clearPatternGrid);
    q('#rbPatternSearch').addEventListener('click', searchRecentPattern);
    q('#rbEnableNotifications').addEventListener('click', async function () {
      var permission = window.AMDManualMonitor ? await window.AMDManualMonitor.enable() : 'unsupported';
      updateNotificationStatus();
      showToast(permission === 'granted' ? 'Notificações ativadas.' : 'Não foi possível ativar as notificações.');
    });
    q('#rbMarkType').addEventListener('change', function () { saveSelectedPosition(); renderPatternGrid(); renderPreview(); });
    qa('input[name="rbLiga"]').forEach(function (input) {
      input.addEventListener('change', function () {
        loadData({ teamA: '', teamB: '', game: '', odd: '' });
      });
    });
    q('#rbMarket').addEventListener('change', function () {
      fillOdds('');
      saveSelectedPosition();
      renderPatternGrid();
      renderPreview();
    });
    q('#rbEntryMarket').addEventListener('change', function () {
      saveSelectedPosition();
      renderPatternGrid();
      renderPreview();
    });
    q('#rbGame').addEventListener('change', function () {
      fillOdds('');
      renderPreview();
    });
    q('#rbTeamA').addEventListener('change', function () {
      q('#rbGame').value = '';
      fillOdds('');
      renderPreview();
    });
    q('#rbTeamB').addEventListener('change', function () {
      q('#rbGame').value = '';
      fillOdds('');
      renderPreview();
    });
    q('#rbMinuteOp').addEventListener('change', function () {
      updateMinuteVisibility();
      renderPreview();
    });
    q('#rbProfile').addEventListener('change', function () {
      q('#rbThreshold').value = String(PROFILE_TARGETS[q('#rbProfile').value] || 65);
      renderPreview();
    });
    qa('input,select', q('.builder-grid')).forEach(function (el) {
      if (el.name === 'rbLiga' || ['rbMarket','rbEntryMarket','rbGame','rbTeamA','rbTeamB','rbMinuteOp','rbProfile'].indexOf(el.id) >= 0) return;
      el.addEventListener('input', renderPreview);
      el.addEventListener('change', function () { saveSelectedPosition(); renderPreview(); });
    });
    qa('.metric-now').forEach(function (button) {
      button.addEventListener('click', function () {
        var on = !button.classList.contains('on');
        button.classList.toggle('on', on);
        button.setAttribute('aria-pressed', on ? 'true' : 'false');
        button.textContent = 'Exigir: ' + (on ? 'SIM' : 'NÃO');
        renderPreview();
      });
    });
  }

  setupPatternControls();
  populateNumbers();
  renderPatternGrid();
  bindEvents();
  updateMinuteVisibility();
  renderSaved();
  renderHistory();
  updateNotificationStatus();
  renderSignals();
  window.addEventListener('amd:manual-entry', renderSignals);
  window.addEventListener('amd:manual-status-changed', renderSignals);
  window.addEventListener('storage', function (event) { if (event.key === SIGNALS_KEY || event.key === ROBOTS_KEY) { renderSignals(); renderSaved(); } });
  renderPreview();
  loadData();
})();
