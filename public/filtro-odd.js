(function () {
  'use strict';
  var liga = localStorage.getItem('amd_liga') || 'copa';
  var mercado = localStorage.getItem('amd_filtro_odd_mercado') || 'over25';
  var horas = Number(localStorage.getItem('amd_filtro_odd_horas')) || 6;
  var quantidade = Number(localStorage.getItem('amd_filtro_odd_quantidade')) || 1;
  var partidas = [];
  var LIGAS = ['copa', 'euro', 'super', 'premier'];
  var NOMES = { copa: 'Copa', euro: 'Euro', super: 'Super', premier: 'Premier' };
  function el(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function pct(v, casas) { return Number.isFinite(v) ? (v * 100).toFixed(casas == null ? 1 : casas) + '%' : '—'; }
  function num(v, casas) { return Number.isFinite(v) ? Number(v).toFixed(casas == null ? 2 : casas) : '—'; }
  function ev(v) { return Number.isFinite(v) ? (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%' : '—'; }
  function hora(j) {
    var texto = String(j.horario || '');
    if (/^\d{1,2}:\d{2}/.test(texto)) return texto.slice(0, 5);
    if (j.hora != null && j.minuto != null) return String(j.hora).padStart(2, '0') + ':' + String(j.minuto).padStart(2, '0');
    return '—';
  }
  function classe(status) {
    if (status === 'VALOR CONFIRMADO') return 'confirmado';
    if (status === 'OBSERVAR') return 'observar';
    if (status === 'AMOSTRA FRACA') return 'fraca';
    return 'semvalor';
  }
  function salvar() {
    localStorage.setItem('amd_liga', liga);
    localStorage.setItem('amd_filtro_odd_mercado', mercado);
    localStorage.setItem('amd_filtro_odd_horas', horas);
    localStorage.setItem('amd_filtro_odd_quantidade', quantidade);
  }
  function renderControles() {
    el('foLigas').innerHTML = LIGAS.map(function (l) { return '<button data-liga="' + l + '" class="' + (l === liga ? 'on' : '') + '">' + NOMES[l] + '</button>'; }).join('');
    el('foLigaNome').textContent = NOMES[liga];
    el('foMercado').innerHTML = FiltroOddModel.MERCADOS.map(function (m) { return '<option value="' + m.id + '"' + (m.id === mercado ? ' selected' : '') + '>' + esc(m.nome) + '</option>'; }).join('');
    el('foHoras').innerHTML = [3, 6, 12, 24].map(function (h) { return '<button data-horas="' + h + '" class="' + (h === horas ? 'on' : '') + '">' + h + 'h</button>'; }).join('');
    el('foQuantidade').innerHTML = [1, 2, 3].map(function (q) { return '<button data-quantidade="' + q + '" class="' + (q === quantidade ? 'on' : '') + '">' + q + (q === 1 ? ' odd' : ' odds') + '</button>'; }).join('');
  }
  function renderSequencia() {
    var seq = FiltroOddModel.sequencias(partidas, mercado, quantidade);
    el('foSequenciaTitulo').textContent = quantidade === 1 ? 'Leitura da próxima odd' : 'Sequência das próximas ' + quantidade + ' odds';
    if (!seq) {
      el('foSequenciaStatus').className = 'fo-status fraca';
      el('foSequenciaStatus').textContent = 'SEM JOGOS/ODDS';
      el('foSequencia').innerHTML = '<div class="fo-empty">Não há ' + quantidade + ' próximos jogos com odd disponível neste mercado.</div>';
      return;
    }
    var a = seq.analise;
    el('foSequenciaStatus').className = 'fo-status ' + classe(a.status);
    el('foSequenciaStatus').textContent = a.status;
    var jogos = seq.alvos.map(function (x) { return '<div class="fo-sequence-game"><small>' + esc(hora(x.jogo)) + '</small><b>' + esc(x.jogo.time_a) + ' × ' + esc(x.jogo.time_b) + '</b><span>Odd <strong>' + num(x.odd) + '</strong></span></div>'; }).join('');
    el('foSequencia').innerHTML = '<div class="fo-sequence-body"><div class="fo-sequence-games">' + jogos + '</div>' +
      '<div class="fo-metric"><small>Probabilidade ajustada</small><b>' + pct(a.prob) + '</b></div>' +
      '<div class="fo-metric"><small>Faixa segura (90%)</small><b>' + pct(a.inferior) + '</b></div>' +
      '<div class="fo-metric"><small>Amostra efetiva</small><b>' + num(a.nEfetiva, 1) + '</b></div>' +
      '<div class="fo-metric"><small>EV seguro</small><b class="' + (a.evSeguro >= 0 ? 'fo-pos' : 'fo-neg') + '">' + ev(a.evSeguro) + '</b></div></div>';
  }
  function renderTabela() {
    var lista = FiltroOddModel.analisarFuturos(partidas, mercado);
    var ordem = { 'VALOR CONFIRMADO': 4, 'OBSERVAR': 3, 'AMOSTRA FRACA': 2, 'SEM VALOR': 1, 'SEM ODD': 0 };
    lista.sort(function (a, b) { return (ordem[b.analise.status] || 0) - (ordem[a.analise.status] || 0) || b.analise.evSeguro - a.analise.evSeguro; });
    var comOdd = lista.filter(function (x) { return x.odd > 1; }).length;
    el('foFuturos').textContent = comOdd + ' / ' + lista.length;
    if (!lista.length) {
      el('foTabela').innerHTML = '<tr><td colspan="10"><div class="fo-empty">Nenhum próximo jogo com odd neste mercado e janela.</div></td></tr>';
      return;
    }
    el('foTabela').innerHTML = lista.map(function (x) {
      var a = x.analise, temOdd = x.odd > 1;
      return '<tr><td><div class="fo-game"><small>' + esc(hora(x.jogo)) + '</small><b>' + esc(x.jogo.time_a) + ' × ' + esc(x.jogo.time_b) + '</b></div></td>' +
        '<td class="fo-num">' + (temOdd ? num(x.odd) : '<small>aguardando</small>') + '</td><td>' + (temOdd ? a.encontrados + ' <small>(n ef. ' + num(a.nEfetiva, 1) + ')</small>' : '—') + '</td>' +
        '<td class="fo-num">' + pct(a.prob) + '</td><td class="fo-num">' + pct(a.inferior) + '</td><td class="fo-num">' + num(a.oddJusta) + '</td>' +
        '<td class="fo-num ' + (a.ev >= 0 ? 'fo-pos' : 'fo-neg') + '">' + ev(a.ev) + '</td><td class="fo-num ' + (a.evSeguro >= 0 ? 'fo-pos' : 'fo-neg') + '">' + ev(a.evSeguro) + '</td>' +
        '<td>' + esc(a.tendencia) + '</td><td><span class="fo-tag ' + classe(a.status) + '">' + a.status + '</span></td></tr>';
    }).join('');
  }
  function bolinhas(lista) {
    return '<div class="fo-dots">' + lista.map(function (x) { return '<span class="fo-dot' + (x ? ' green' : '') + '" title="' + (x ? 'Green' : 'Red') + '"></span>'; }).join('') + '</div>';
  }
  function renderPeDeGalinha() {
    var lista = FiltroOddModel.peDeGalinha(partidas, mercado);
    el('foPeResumo').textContent = lista.length + ' odds analisadas';
    if (!lista.length) {
      el('foPeTabela').innerHTML = '<tr><td colspan="8"><div class="fo-empty">Ainda não há trios completos com odd para este mercado.</div></td></tr>';
      return;
    }
    el('foPeTabela').innerHTML = lista.map(function (g) {
      var ultimos = g.ultimos.map(function (trio) {
        return trio.map(function (pago) { return pago ? 'G' : 'R'; }).join('-');
      }).join(' · ');
      return '<tr><td><span class="fo-pattern">' + num(g.odd, 1) + '</span></td>' +
        '<td>' + g.n + '</td><td>' + g.antes + '/' + g.n + ' · <b>' + pct(g.taxaAntes) + '</b></td>' +
        '<td>' + g.nela + '/' + g.n + ' · <b>' + pct(g.taxaNela) + '</b></td>' +
        '<td>' + g.depois + '/' + g.n + ' · <b>' + pct(g.taxaDepois) + '</b></td>' +
        '<td class="fo-pos">' + g.algum + '/' + g.n + ' · <b>' + pct(g.taxaAlgum) + '</b></td>' +
        '<td><small>' + esc(ultimos) + '</small></td><td><span class="fo-tag ' +
        (g.status === 'PÉ FORTE' ? 'confirmado' : g.status === 'OBSERVAR' ? 'observar' : 'fraca') + '">' +
        esc(g.status) + '</span></td></tr>';
    }).join('');
  }
  function renderPadroes() {
    var lista = FiltroOddModel.rankingSequencias(partidas, mercado, quantidade);
    el('foPadraoResumo').textContent = lista.length + ' padrões · ' + quantidade + (quantidade === 1 ? ' odd' : ' odds');
    if (!lista.length) {
      el('foPadroes').innerHTML = '<tr><td colspan="11"><div class="fo-empty">Ainda não há resultados suficientes para formar padrões.</div></td></tr>';
      return;
    }
    el('foPadroes').innerHTML = lista.map(function (g) {
      return '<tr><td><span class="fo-pattern">' + esc(g.padrao) + '</span></td><td>' + g.n + ' <small>(n ef. ' + num(g.nEfetiva, 1) + ')</small></td>' +
        '<td>' + g.todosGreens + '/' + g.n + ' · <b>' + pct(g.taxaTodos) + '</b></td><td>' + g.greens + '/' + g.totalJogos + ' · ' + pct(g.taxaJogos) + '</td>' +
        '<td>' + bolinhas(g.ultimos) + '</td><td class="fo-num">' + pct(g.prob) + '</td><td class="fo-num">' + pct(g.inferior) + '</td>' +
        '<td class="fo-num">' + num(g.oddCombinada) + '</td><td class="fo-num ' + (g.evSeguro >= 0 ? 'fo-pos' : 'fo-neg') + '">' + ev(g.evSeguro) + '</td>' +
        '<td>' + esc(g.tendencia) + '</td><td><span class="fo-tag ' + classe(g.status) + '">' + g.status + '</span></td></tr>';
    }).join('');
  }
  function renderReversao() {
    var futuros = FiltroOddModel.analisarFuturos(partidas, mercado), alvo = futuros[0];
    if (!alvo) {
      el('foReversaoResumo').textContent = 'sem próxima odd';
      el('foReversao').innerHTML = '<div class="fo-empty">Nenhuma próxima odd disponível para comparar a reversão.</div>';
      return;
    }
    var r = FiltroOddModel.analisarReversao(partidas, mercado, alvo.odd);
    el('foReversaoResumo').textContent = r.status;
    var odds = r.oddsReds.length ? r.oddsReds.map(function (o) { return '<span>' + num(o) + '</span>'; }).join('') : '<span>sem Reds</span>';
    el('foReversao').innerHTML = '<div class="fo-red-chain"><small>SEQUÊNCIA ATUAL</small><strong>' + r.reds + ' Reds</strong><div class="fo-red-odds">' + odds + '</div></div>' +
      '<div class="fo-metric"><small>Contexto histórico</small><b>' + esc(r.faixa) + '</b><span>' + r.n + ' ocorrências</span></div>' +
      '<div class="fo-metric"><small>Pagou no jogo seguinte</small><b>' + r.pagos + '/' + r.n + '</b><span>' + pct(r.taxa) + ' bruto</span></div>' +
      '<div class="fo-metric"><small>Probabilidade corrigida</small><b>' + pct(r.prob) + '</b><span>média ' + pct(r.base) + '</span></div>' +
      '<div class="fo-metric"><small>Efeito dos Reds</small><b class="' + (r.uplift > 0 ? 'fo-pos' : 'fo-neg') + '">' + (r.uplift >= 0 ? '+' : '') + pct(r.uplift) + '</b><span>' + esc(r.status) + '</span></div>';
  }
  function renderTudo() {
    var resolvidos = partidas.filter(FiltroOddModel.resolvido);
    var comOdd = resolvidos.filter(function (j) { return FiltroOddModel.odd(j, mercado); });
    var m = FiltroOddModel.MERCADOS.find(function (x) { return x.id === mercado; });
    el('foAmostra').textContent = resolvidos.length;
    el('foBase').textContent = pct(FiltroOddModel.taxaBase(partidas, mercado));
    el('foComOdd').textContent = comOdd.length;
    el('foMercadoNome').textContent = (m ? m.nome : '') + ' · ' + horas + 'h';
    renderSequencia(); renderPeDeGalinha(); renderPadroes(); renderTabela(); renderReversao();
  }
  async function carregar() {
    el('foAtualizacao').textContent = 'Atualizando ' + horas + 'h…';
    try {
      var opcoes = { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } };
      var baseUrl = '/api/grade?liga=' + encodeURIComponent(liga);
      var respostas = await Promise.all([
        fetch(baseUrl + '&horas=' + horas + '&dia=atual', opcoes),
        fetch(baseUrl + '&horas=168', opcoes)
      ]);
      if (respostas.some(function (x) { return x.status === 401; })) { location.href = 'index.html'; return; }
      if (respostas.some(function (x) { return !x.ok; })) throw new Error('Falha ao carregar a grade');
      var pacotes = await Promise.all(respostas.map(function (x) { return x.json(); }));
      var historico = Array.isArray(pacotes[0].partidas) ? pacotes[0].partidas : [];
      var gradeAmpla = Array.isArray(pacotes[1].partidas) ? pacotes[1].partidas : [];
      var vistos = Object.create(null);
      function chave(j) { return [j.slot_em || j.horario || '', j.time_a || '', j.time_b || ''].join('|').toLowerCase(); }
      partidas = historico.slice();
      partidas.forEach(function (j) { vistos[chave(j)] = true; });
      gradeAmpla.filter(function (j) { return !FiltroOddModel.resolvido(j); }).forEach(function (j) {
        var k = chave(j); if (!vistos[k]) { vistos[k] = true; partidas.push(j); }
      });
      renderTudo();
      el('foAtualizacao').textContent = 'Atualizado ' + new Date().toLocaleTimeString('pt-BR') + ' · dia do jogo 00:00–23:59';
    } catch (e) {
      el('foAtualizacao').textContent = 'Falha temporária · nova tentativa automática';
      el('foTabela').innerHTML = '<tr><td colspan="10"><div class="fo-empty">Dados temporariamente indisponíveis.</div></td></tr>';
    }
  }
  el('foLigas').addEventListener('click', function (e) { var b = e.target.closest('[data-liga]'); if (!b) return; liga = b.dataset.liga; salvar(); renderControles(); carregar(); });
  el('foHoras').addEventListener('click', function (e) { var b = e.target.closest('[data-horas]'); if (!b) return; horas = Number(b.dataset.horas); salvar(); renderControles(); carregar(); });
  el('foQuantidade').addEventListener('click', function (e) { var b = e.target.closest('[data-quantidade]'); if (!b) return; quantidade = Number(b.dataset.quantidade); salvar(); renderControles(); renderSequencia(); renderPadroes(); });
  el('foMercado').addEventListener('change', function () { mercado = this.value; salvar(); renderTudo(); });
  el('foRefresh').addEventListener('click', carregar);
  renderControles(); carregar(); setInterval(carregar, 60000);
})();
