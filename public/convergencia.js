(function () {
  'use strict';
  var LIGAS = ['copa', 'euro', 'super', 'premier'];
  var NOMES = { copa: 'Copa', euro: 'Euro', super: 'Super', premier: 'Premier' };
  var liga = localStorage.getItem('amd_liga') || 'copa';
  var mercado = localStorage.getItem('amd_convergencia_mercado') || 'over25';
  var horas = Number(localStorage.getItem('amd_convergencia_horas')) || 6;
  var modo = localStorage.getItem('amd_convergencia_modo') || 'cliente';
  var partidas = [], leituras = [], selecionada = null, carregando = false, timer = null;
  if (LIGAS.indexOf(liga) < 0) liga = 'copa';

  function el(id) { return document.getElementById(id); }
  function esc(valor) { return String(valor == null ? '' : valor).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function pct(valor) { return Number.isFinite(valor) ? (valor * 100).toFixed(1) + '%' : '—'; }
  function hora(jogo) {
    var d = new Date(jogo.slot_em || jogo.criado_em || '');
    if (!isNaN(d.getTime())) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return String(jogo.horario || jogo.hora || '—');
  }
  function nomeMercado() {
    var item = FiltroOddModel.MERCADOS.find(function (m) { return m.id === mercado; });
    return item ? item.nome : mercado;
  }
  function classe(status) { return String(status || '').toLowerCase(); }
  function statusCliente(status) {
    return status === 'CONFIRMADO' ? 'ENTRADA CONFIRMADA' :
      status === 'OBSERVANDO' ? 'OPORTUNIDADE EM FORMAÇÃO' : 'NÃO ENTRAR';
  }
  function oddMinima(x) {
    return x && x.valor && Number.isFinite(x.valor.inferior) && x.valor.inferior > 0
      ? 1 / x.valor.inferior : null;
  }

  function salvar() {
    localStorage.setItem('amd_liga', liga);
    localStorage.setItem('amd_convergencia_mercado', mercado);
    localStorage.setItem('amd_convergencia_horas', horas);
    localStorage.setItem('amd_convergencia_modo', modo);
  }

  function renderControles() {
    el('cvLigas').innerHTML = LIGAS.map(function (l) { return '<button class="' + (l === liga ? 'on' : '') + '" data-liga="' + l + '">' + NOMES[l] + '</button>'; }).join('');
    el('cvLigaNome').textContent = NOMES[liga];
    el('cvMercado').innerHTML = FiltroOddModel.MERCADOS.map(function (m) { return '<option value="' + m.id + '"' + (m.id === mercado ? ' selected' : '') + '>' + esc(m.nome) + '</option>'; }).join('');
    el('cvHoras').innerHTML = [3, 6, 12, 24].map(function (h) { return '<button class="' + (h === horas ? 'on' : '') + '" data-horas="' + h + '">' + h + 'h</button>'; }).join('');
    document.querySelectorAll('[data-mode]').forEach(function (b) { b.classList.toggle('on', b.dataset.mode === modo); });
    document.body.classList.toggle('profissional', modo === 'profissional');
  }

  function card(x, indice) {
    var motivo = x.status === 'CONFIRMADO' ? 'Todos os filtros essenciais confirmaram esta leitura.' :
      (x.bloqueios[0] || 'Aguardando uma confirmação adicional.');
    return '<article class="cv-card ' + classe(x.status) + '">' +
      '<div class="cv-card-head"><span class="cv-status">' + esc(statusCliente(x.status)) + '</span><span class="cv-time">' + esc(hora(x.jogo)) + '</span></div>' +
      '<div class="cv-game"><h3>' + esc(x.jogo.time_a) + ' × ' + esc(x.jogo.time_b) + '</h3><span>' + esc(nomeMercado()) + (x.odd ? ' · odd ' + x.odd.toFixed(2) : ' · odd pendente') + '</span></div>' +
      '<div class="cv-confidence"><strong>' + x.confianca + '%</strong><span>força da<br>convergência</span></div><div class="cv-progress"><i style="width:' + x.confianca + '%"></i></div>' +
      '<div class="cv-mini cv-professional"><div><small>MANDANTE · CASA</small><b>' + pct(x.casa.ajustada) + ' · GF ' + x.casa.mediaMarcados.toFixed(1) + ' · GS ' + x.casa.mediaSofridos.toFixed(1) + '</b></div><div><small>VISITANTE · FORA</small><b>' + pct(x.fora.ajustada) + ' · GF ' + x.fora.mediaMarcados.toFixed(1) + ' · GS ' + x.fora.mediaSofridos.toFixed(1) + '</b></div><div><small>ENCAIXE ATAQUE × DEFESA</small><b>' + pct(x.comportamento.probMercado) + ' · ' + x.comportamento.golsEsperados.toFixed(2) + ' gols</b></div><div><small>HISTÓRICO TOTAL</small><b>' + pct((x.totalCasa.ajustada + x.totalFora.ajustada) / 2) + '</b></div><div><small>COLUNA</small><b>' + pct(x.coluna.ajustada) + ' · n=' + x.coluna.n + '</b></div><div><small>GRÁFICO</small><b>' + esc(x.grafico.zona) + ' · MACD ' + x.grafico.macd.toFixed(2) + '</b></div></div>' +
      '<div class="cv-reason">' + esc(motivo) + '</div><button type="button" data-proof="' + indice + '">Ver provas</button></article>';
  }

  function renderBanner() {
    var banner = el('cvBanner'), confirmada = leituras.find(function (x) { return x.status === 'CONFIRMADO'; });
    var observada = leituras.find(function (x) { return x.status === 'OBSERVANDO'; });
    banner.className = 'cv-banner ' + (confirmada ? 'confirmado' : observada ? 'observando' : leituras.length ? 'descartado' : '');
    if (confirmada) {
      banner.innerHTML = '<div class="cv-banner-icon">✓</div><div><small>DESTAQUE DO MOMENTO</small><strong>' + esc(confirmada.jogo.time_a) + ' × ' + esc(confirmada.jogo.time_b) + ' · ' + esc(nomeMercado()) + '</strong><span>Convergência confirmada em ' + confirmada.confianca + '/100. Confira as provas antes de qualquer decisão.</span></div>';
    } else if (observada) {
      banner.innerHTML = '<div class="cv-banner-icon">◌</div><div><small>MELHOR LEITURA EM FORMAÇÃO</small><strong>' + esc(observada.jogo.time_a) + ' × ' + esc(observada.jogo.time_b) + ' · ' + observada.confianca + '/100</strong><span>' + esc(observada.bloqueios[0] || 'Aguardando a última confirmação técnica.') + '. Ainda não é entrada.</span></div>';
    } else {
      banner.innerHTML = '<div class="cv-banner-icon">◎</div><div><small>LEITURA DO MOMENTO</small><strong>Sem confirmação completa agora</strong><span>Os jogos continuam organizados abaixo, com o motivo exato de cada bloqueio.</span></div>';
    }
  }

  function renderTudo() {
    leituras = ConvergenciaModel.analisar(partidas, mercado);
    var confirmados = leituras.filter(function (x) { return x.status === 'CONFIRMADO'; }).length;
    var observando = leituras.filter(function (x) { return x.status === 'OBSERVANDO'; }).length;
    el('cvTotal').textContent = leituras.length;
    el('cvConfirmados').textContent = confirmados;
    el('cvObservando').textContent = observando;
    el('cvBase').textContent = pct(FiltroOddModel.taxaBase(partidas, mercado));
    el('cvResumo').textContent = NOMES[liga] + ' · ' + nomeMercado() + ' · ' + horas + 'h';
    el('cvCards').innerHTML = leituras.length ? leituras.map(card).join('') : '<div class="cv-empty">Nenhum jogo futuro disponível nesta liga agora.</div>';
    renderBanner();
    if (selecionada) {
      var chaveAtual = [selecionada.jogo.slot_em || selecionada.jogo.criado_em, selecionada.jogo.time_a, selecionada.jogo.time_b].join('|');
      selecionada = leituras.find(function (x) { return [x.jogo.slot_em || x.jogo.criado_em, x.jogo.time_a, x.jogo.time_b].join('|') === chaveAtual; }) || null;
      if (selecionada) renderProva(selecionada);
    }
  }

  function renderProva(x) {
    selecionada = x;
    var rotuloStatus = statusCliente(x.status);
    var minima = oddMinima(x);
    var oddAtual = x.odd ? x.odd.toFixed(2) : 'aguardando';
    var oddRecomendada = minima ? minima.toFixed(2) : '—';
    var motivoPrincipal = x.status === 'CONFIRMADO'
      ? 'Todos os critérios essenciais foram confirmados.'
      : (x.bloqueios[0] || 'A leitura ainda precisa de confirmação adicional.') + '.';
    el('cvProofStatus').className = 'cv-proof-status ' + classe(x.status);
    el('cvProofStatus').textContent = rotuloStatus + ' · ' + x.confianca + '/100';
    var passos = x.estagios.map(function (p) {
      var tipo = p.ok ? 'ok' : p.pendente ? 'pending' : 'no';
      var nomePasso = p.id === 'odd' ? 'Odd compensou o risco' : p.id === 'liberacao' ? 'Decisão final' : p.nome;
      return '<div class="cv-step ' + tipo + '"><span class="cv-step-dot">' + (p.ok ? '✓' : p.pendente ? '…' : '×') + '</span><b>' + esc(nomePasso) + '</b><small>' + esc(p.detalhe) + '</small></div>';
    }).join('');
    var bloqueios = x.bloqueios.length ? x.bloqueios.join(' · ') : 'Nenhum bloqueio: todos os filtros essenciais confirmaram.';
    el('cvProofBody').className = 'cv-proof-body';
    el('cvProofBody').innerHTML = '<div class="cv-client-decision ' + classe(x.status) + '"><div><small>RECOMENDAÇÃO</small><strong>' + esc(rotuloStatus) + '</strong><p>' + esc(motivoPrincipal) + '</p></div><div class="cv-decision-metrics"><span><small>ODD ATUAL</small><b>' + oddAtual + '</b></span><span><small>ODD MÍNIMA RECOMENDADA</small><b>' + oddRecomendada + '</b></span><span><small>CONFIANÇA</small><b>' + x.confianca + '/100</b></span></div></div>' +
      '<div class="cv-proof-title"><div><h3>' + esc(x.jogo.time_a) + ' × ' + esc(x.jogo.time_b) + '</h3><p>' + esc(nomeMercado()) + ' · ' + esc(NOMES[liga]) + ' · minuto ' + esc(x.jogo.minuto == null ? '—' : x.jogo.minuto) + '</p></div></div>' +
      '<div class="cv-timeline">' + passos + '</div>' +
      '<div class="cv-detail-grid"><div><small>MANDANTE EM CASA</small><b>' + pct(x.casa.ajustada) + ' · GF ' + x.casa.mediaMarcados.toFixed(2) + ' · GS ' + x.casa.mediaSofridos.toFixed(2) + ' · n=' + x.casa.n + '</b></div><div><small>VISITANTE FORA</small><b>' + pct(x.fora.ajustada) + ' · GF ' + x.fora.mediaMarcados.toFixed(2) + ' · GS ' + x.fora.mediaSofridos.toFixed(2) + ' · n=' + x.fora.n + '</b></div><div><small>ENCAIXE ATAQUE × DEFESA</small><b>' + pct(x.comportamento.probMercado) + ' · esperado ' + x.comportamento.lambdaCasa.toFixed(2) + ' × ' + x.comportamento.lambdaFora.toFixed(2) + '</b></div><div><small>COMPORTAMENTO COMBINADO</small><b>' + pct(x.probTimes) + ' · pesos 30/30/20/10/10</b></div><div><small>HISTÓRICO TOTAL DOS TIMES</small><b>' + pct((x.totalCasa.ajustada + x.totalFora.ajustada) / 2) + '</b></div><div><small>COLUNA / MINUTO</small><b>' + pct(x.coluna.ajustada) + ' · n=' + x.coluna.n + '</b></div><div><small>ANÁLISE GRÁFICA</small><b>' + esc(x.grafico.zona) + ' · ' + esc(x.grafico.direcao) + ' · MACD ' + x.grafico.macd.toFixed(2) + '</b></div><div><small>PROBABILIDADE CONSERVADORA / EV</small><b>' + pct(x.valor.inferior) + ' · ' + (x.valor.evSeguro == null ? 'EV —' : 'EV ' + (x.valor.evSeguro >= 0 ? '+' : '') + pct(x.valor.evSeguro)) + '</b></div></div>' +
      '<div class="cv-blockers ' + (x.bloqueios.length ? '' : 'ok') + '"><b>' + (x.bloqueios.length ? 'Bloqueios: ' : 'Leitura completa: ') + '</b>' + esc(bloqueios) + '</div>';
    el('cvProof').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function carregar() {
    if (carregando) return;
    carregando = true;
    el('cvAtualizacao').textContent = 'Atualizando ' + NOMES[liga] + '…';
    try {
      var opcoes = { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } };
      var baseUrl = '/api/grade?liga=' + encodeURIComponent(liga);
      var respostas = await Promise.all([
        fetch(baseUrl + '&horas=' + horas + '&dia=atual', opcoes),
        fetch(baseUrl + '&horas=168', opcoes)
      ]);
      if (respostas.some(function (r) { return r.status === 401; })) { location.href = 'index.html'; return; }
      if (respostas.some(function (r) { return !r.ok; })) throw new Error('Falha ao carregar a grade');
      var pacotes = await Promise.all(respostas.map(function (r) { return r.json(); }));
      var historico = Array.isArray(pacotes[0].partidas) ? pacotes[0].partidas : [];
      var gradeAmpla = Array.isArray(pacotes[1].partidas) ? pacotes[1].partidas : [];
      var vistos = Object.create(null);
      function chaveJogo(j) { return [j.slot_em || j.horario || '', j.time_a || '', j.time_b || ''].join('|').toLowerCase(); }
      partidas = historico.slice();
      partidas.forEach(function (j) { vistos[chaveJogo(j)] = true; });
      gradeAmpla.filter(function (j) { return !FiltroOddModel.resolvido(j); }).forEach(function (j) {
        var chave = chaveJogo(j);
        if (!vistos[chave]) { vistos[chave] = true; partidas.push(j); }
      });
      selecionada = null;
      renderTudo();
      el('cvAtualizacao').textContent = 'Atualizado ' + new Date().toLocaleTimeString('pt-BR') + ' · histórico do dia + próximos';
    } catch (_) {
      el('cvAtualizacao').textContent = 'Falha temporária · mantendo a tela';
      if (!partidas.length) el('cvCards').innerHTML = '<div class="cv-empty">Não foi possível carregar os dados agora.</div>';
    } finally { carregando = false; }
  }

  el('cvLigas').addEventListener('click', function (e) { var b = e.target.closest('[data-liga]'); if (!b || b.dataset.liga === liga) return; liga = b.dataset.liga; salvar(); renderControles(); carregar(); });
  el('cvHoras').addEventListener('click', function (e) { var b = e.target.closest('[data-horas]'); if (!b || Number(b.dataset.horas) === horas) return; horas = Number(b.dataset.horas); salvar(); renderControles(); carregar(); });
  el('cvMercado').addEventListener('change', function () { mercado = this.value; salvar(); selecionada = null; renderTudo(); });
  document.querySelector('.cv-mode').addEventListener('click', function (e) { var b = e.target.closest('[data-mode]'); if (!b) return; modo = b.dataset.mode; salvar(); renderControles(); });
  el('cvRefresh').addEventListener('click', carregar);
  el('cvCards').addEventListener('click', function (e) { var b = e.target.closest('[data-proof]'); if (!b) return; renderProva(leituras[Number(b.dataset.proof)]); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) carregar(); });
  window.addEventListener('focus', carregar);

  renderControles();
  carregar();
  timer = setInterval(function () { if (!document.hidden) carregar(); }, 60000);
  window.addEventListener('beforeunload', function () { clearInterval(timer); });
}());
