(function () {
  'use strict';

  var API = '/api/robos/historico';
  var enviados = Object.create(null);
  var atualizando = false;

  function escapar(valor) {
    return String(valor == null ? '' : valor).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;',
        '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function numero(valor) {
    var n = Number(valor);
    return isFinite(n) ? n : null;
  }

  function unidade(valor, comSinal) {
    var n = numero(valor);
    if (n === null) return 'não calculada';
    return (comSinal && n > 0 ? '+' : '') + n.toFixed(2) + ' un.';
  }

  function dataHora(valor) {
    var d = new Date(valor);
    return isNaN(d.getTime()) ? '—' :
      d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }

  function statusTexto(status) {
    if (status === 'green') return 'GREEN';
    if (status === 'red') return 'RED';
    if (status === 'cancelado') return 'CANCELADO';
    return 'PENDENTE';
  }

  function garantirPainel() {
    var existente = document.getElementById('rbHistorico');
    if (existente) return existente;
    var entradas = document.querySelector('.rb-entries');
    if (!entradas) return null;
    var secao = document.createElement('section');
    secao.id = 'rbHistorico';
    secao.className = 'rb-card rb-history';
    secao.innerHTML =
      '<div class="rb-card-head"><div><small>HISTÓRICO INDIVIDUAL</small>' +
      '<h2>Greens, Reds e unidades</h2></div>' +
      '<span id="rbHistoryUpdated">Carregando...</span></div>' +
      '<div class="rb-history-summary">' +
      '<div><small>GREENS</small><b id="rbHistGreen">0</b></div>' +
      '<div><small>REDS</small><b id="rbHistRed">0</b></div>' +
      '<div><small>PENDENTES</small><b id="rbHistPending">0</b></div>' +
      '<div><small>SALDO</small><b id="rbHistUnits">0.00 un.</b></div></div>' +
      '<p class="rb-history-rule">Tiro 1: 1 unidade. Gales seguintes calculados ' +
      'pela odd real para recuperar as perdas e buscar +1 unidade líquida.</p>' +
      '<div id="rbHistoryList" class="rb-history-list">' +
      '<div class="rb-history-empty">Nenhuma entrada registrada neste login.</div></div>';
    entradas.insertAdjacentElement('afterend', secao);

    var estilo = document.createElement('style');
    estilo.id = 'rb-history-css';
    estilo.textContent =
      '.rb-history{margin-top:20px}.rb-history-summary{display:grid;' +
      'grid-template-columns:repeat(4,minmax(110px,1fr));gap:10px;margin:14px 0}' +
      '.rb-history-summary>div{background:#061821;border:1px solid #173745;' +
      'border-radius:10px;padding:12px}.rb-history-summary small{display:block;' +
      'color:#78a8bb;font:700 10px ui-monospace;letter-spacing:1px}' +
      '.rb-history-summary b{display:block;font-size:22px;margin-top:5px}' +
      '#rbHistGreen{color:#20ed73}#rbHistRed{color:#ff4e62}' +
      '.rb-history-rule{color:#8db0be;font-size:12px;margin:0 0 12px}' +
      '.rb-history-list{display:grid;gap:10px}.rb-history-item{border:1px solid #1c3a47;' +
      'border-left:5px solid #647985;background:#06151d;border-radius:10px;padding:12px}' +
      '.rb-history-item.green{border-left-color:#20ed73}.rb-history-item.red{' +
      'border-left-color:#ff4e62}.rb-history-item header{display:flex;' +
      'justify-content:space-between;gap:12px}.rb-history-item header b{' +
      'font-family:ui-monospace}.rb-history-item.green header b{color:#20ed73}' +
      '.rb-history-item.red header b{color:#ff4e62}.rb-history-meta{color:#83a8b8;' +
      'font-size:12px;margin:5px 0 9px}.rb-history-shots{display:grid;gap:5px}' +
      '.rb-history-shot{display:grid;grid-template-columns:65px 1fr auto auto auto;' +
      'gap:9px;align-items:center;background:#081d27;border:1px solid #163440;' +
      'border-radius:7px;padding:8px;font-size:12px}.rb-history-shot>strong{' +
      'color:#ffc72c}.rb-history-shot em{font-style:normal;color:#9fc0cc}' +
      '.rb-history-shot .green{color:#20ed73}.rb-history-shot .red{color:#ff4e62}' +
      '.rb-history-shot .cancelado{color:#788b94}.rb-history-total{text-align:right;' +
      'margin-top:9px;font-weight:800}.rb-history-empty{padding:20px;text-align:center;' +
      'color:#77939f;border:1px dashed #21414e;border-radius:9px}' +
      '@media(max-width:800px){.rb-history-summary{grid-template-columns:1fr 1fr}' +
      '.rb-history-shot{grid-template-columns:55px 1fr}.rb-history-shot em,' +
      '.rb-history-shot span:last-child{grid-column:auto}}';
    document.head.appendChild(estilo);
    return secao;
  }

  function tiroHtml(tiro) {
    var resultado = tiro.resultado_ft || tiro.resultado_ht || 'aguardando';
    var odd = numero(tiro.odd);
    var entrada = numero(tiro.entrada_unidades);
    return '<div class="rb-history-shot"><strong>TIRO ' + escapar(tiro.ordem) +
      '</strong><span>' + escapar(tiro.time_a) + ' × ' + escapar(tiro.time_b) +
      '</span><em>' + escapar(tiro.horario || '—') + '</em><span>' +
      (entrada === null ? 'gale não calculado' : entrada.toFixed(2) + ' un. @ ' +
      (odd === null ? 'odd ausente' : odd.toFixed(2))) + '</span><span class="' +
      escapar(tiro.status) + '">' + statusTexto(tiro.status) + ' · ' +
      escapar(resultado) + '</span></div>';
  }

  function cicloHtml(ciclo) {
    var status = statusTexto(ciclo.status);
    var total = ciclo.status === 'pendente' ? 'Em andamento' :
      unidade(ciclo.unidade_liquida, true);
    return '<article class="rb-history-item ' + escapar(ciclo.status) + '">' +
      '<header><span><strong>' + escapar(ciclo.nome_padrao || 'Meu padrão') +
      '</strong> · ' + escapar(String(ciclo.liga || '').toUpperCase()) + ' · ' +
      escapar(ciclo.mercado) + '</span><b>' + status + '</b></header>' +
      '<div class="rb-history-meta">' + ciclo.tiros + ' tiros · sinal ' +
      escapar(ciclo.pontuacao) + '/100 · ' + dataHora(ciclo.criado_em) + '</div>' +
      '<div class="rb-history-shots">' +
      (ciclo.detalhes || []).map(tiroHtml).join('') + '</div>' +
      '<div class="rb-history-total">Resultado: ' + escapar(total) + '</div></article>';
  }

  function renderizar(dados) {
    garantirPainel();
    var resumo = dados && dados.resumo || {};
    document.getElementById('rbHistGreen').textContent = resumo.greens || 0;
    document.getElementById('rbHistRed').textContent = resumo.reds || 0;
    document.getElementById('rbHistPending').textContent = resumo.pendentes || 0;
    var saldo = numero(resumo.unidades) || 0;
    var saldoEl = document.getElementById('rbHistUnits');
    saldoEl.textContent = (saldo > 0 ? '+' : '') + saldo.toFixed(2) + ' un.';
    saldoEl.style.color = saldo > 0 ? '#20ed73' : saldo < 0 ? '#ff4e62' : '';
    var lista = dados && Array.isArray(dados.ciclos) ? dados.ciclos : [];
    document.getElementById('rbHistoryList').innerHTML = lista.length
      ? lista.map(cicloHtml).join('')
      : '<div class="rb-history-empty">Nenhuma entrada registrada neste login.</div>';
    var aviso = Number(resumo.sem_unidade || 0);
    document.getElementById('rbHistoryUpdated').textContent =
      'Atualizado agora' + (aviso ? ' · ' + aviso + ' sem odd real' : '');
  }

  function atualizar() {
    if (atualizando) return Promise.resolve();
    atualizando = true;
    return fetch(API + '?_=' + Date.now(), {
      cache: 'no-store', credentials: 'same-origin'
    }).then(function (resposta) {
      if (!resposta.ok) throw new Error('HTTP ' + resposta.status);
      return resposta.json();
    }).then(renderizar).catch(function () {
      var el = document.getElementById('rbHistoryUpdated');
      if (el) el.textContent = 'Falha ao carregar histórico';
    }).then(function () { atualizando = false; });
  }

  function registrar(entradas, mercado, totalTiros) {
    garantirPainel();
    var nome = document.getElementById('rbNome');
    var limiar = document.getElementById('rbLimiar');
    var validas = (entradas || []).filter(function (entrada) {
      return entrada && entrada.entrada &&
        entrada.futuros && entrada.futuros.length >= totalTiros;
    });
    validas.forEach(function (entrada) {
      var jogos = entrada.futuros.slice(0, totalTiros);
      var ids = jogos.map(function (jogo) { return String(jogo.id || ''); });
      if (ids.some(function (id) { return !id; })) return;
      var assinatura = [entrada.liga, mercado].concat(ids).join('|');
      if (enviados[assinatura]) return;
      enviados[assinatura] = true;
      fetch(API, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome_padrao: nome ? nome.value : 'Meu padrão',
          liga: String(entrada.liga || '').toLowerCase(),
          mercado: mercado,
          tiros: totalTiros,
          pontuacao: entrada.pontos,
          limiar: limiar ? Number(limiar.value) : 0,
          partidas: jogos.map(function (jogo) { return { id: jogo.id }; })
        })
      }).then(function (resposta) {
        if (!resposta.ok) {
          return resposta.json().catch(function () { return {}; }).then(function (e) {
            throw new Error(e.erro || ('HTTP ' + resposta.status));
          });
        }
        return resposta.json();
      }).then(atualizar).catch(function (e) {
        delete enviados[assinatura];
        var el = document.getElementById('rbHistoryUpdated');
        if (el) el.textContent = 'Entrada não salva: ' + e.message;
      });
    });
  }

  function iniciar() {
    garantirPainel();
    atualizar();
    setInterval(function () {
      if (!document.hidden) atualizar();
    }, 30000);
  }

  window.RobosHistorico = { registrar: registrar, atualizar: atualizar };
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
