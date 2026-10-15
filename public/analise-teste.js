/* ============================================================
   AMD LIVE 2 - analise-teste.js
   CONFRONTOS + ANALISE DE CONFRONTO com calculo real.

   REGRA DESTE ARQUIVO
   Nenhum numero e gerado. Se o dado nao existe, mostra travessao.
   Nao existe Math.random nem semente aqui - de proposito.
   ============================================================ */

(function () {
  'use strict';

  var API = '/api/grade';
  var MERCADOS = { o25: 'Over 2.5', o35: 'Over 3.5', ge5: '5+ Gols', ambs: 'Ambas marcam' };

  /* Amostra minima para exibir um percentual. Abaixo disso o
     numero e ruido: 2 de 3 jogos da 67% e nao significa nada. */
  var MIN_AMOSTRA = 10;

  var estado = { jogos: [], liga: 'super', mkt: 'o35', horas: 24, selecionado: null };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  function fmtPct(v, casas) {
    if (v === null || v === undefined || !isFinite(v)) return '-';
    return v.toFixed(casas === undefined ? 1 : casas) + '%';
  }
  function fmtSinal(v) {
    if (v === null || v === undefined || !isFinite(v)) return '-';
    return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  }
  function fmtOdd(v) {
    if (v === null || v === undefined || !isFinite(v) || v <= 1) return '-';
    return v.toFixed(2);
  }
  function cor(v) {
    if (v === null || v === undefined || !isFinite(v)) return 'var(--muted)';
    return v >= 0 ? 'var(--green)' : 'var(--red)';
  }

  /* ---------- dados ---------- */

  function carregar() {
    var q = API + '?liga=' + encodeURIComponent(estado.liga) +
            '&horas=' + encodeURIComponent(estado.horas) + '&compacto=1';
    $('estado').textContent = 'carregando...';

    return fetch(q, { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (j) {
        var lista = Array.isArray(j) ? j
          : (j && Array.isArray(j.partidas)) ? j.partidas
          : (j && Array.isArray(j.jogos)) ? j.jogos
          : (j && Array.isArray(j.rows)) ? j.rows
          : (j && Array.isArray(j.dados)) ? j.dados
          : [];
        estado.jogos = lista;
        $('estado').textContent = lista.length + ' jogos';
        render();
      })
      .catch(function (e) {
        $('estado').textContent = 'erro: ' + e.message;
        $('confr').innerHTML = '<div style="padding:14px;color:var(--muted)">Nao foi possivel carregar a grade.</div>';
        $('leitura').innerHTML = '';
      });
  }

  /* ---------- base por time, com amostra ---------- */

  function baseTime(passados, nome, mkt) {
    if (!window.AMD_MOTOR || !nome) return { p: null, j: 0, g: 0 };
    try { return window.AMD_MOTOR.teamPayPct(passados, nome, mkt) || { p: null, j: 0, g: 0 }; }
    catch (e) { return { p: null, j: 0, g: 0 }; }
  }

  function celula(base) {
    if (!base || base.j < MIN_AMOSTRA || base.p === null) {
      return '<b>-</b><span class="amostra">' + (base && base.j ? base.j + 'j' : 'sem base') + '</span>';
    }
    return '<b>' + fmtPct(base.p, 0) + '</b><span class="amostra">' + base.j + 'j</span>';
  }

  /* ---------- render dos cards ---------- */

  function cardConfronto(av, jogo, passados, mkt) {
    var casa = jogo.time_a, fora = jogo.time_b;
    var hora = jogo.horario || jogo.hora || '';
    var nome = casa + ' x ' + fora;

    var linhasLado = function (time) {
      return '<div class="r"><span>' + esc(MERCADOS.o25) + '</span>' + celula(baseTime(passados, time, 'o25')) + '</div>' +
             '<div class="r"><span>' + esc(MERCADOS.o35) + '</span>' + celula(baseTime(passados, time, 'o35')) + '</div>' +
             '<div class="r"><span>' + esc(MERCADOS.ge5) + '</span>' + celula(baseTime(passados, time, 'ge5')) + '</div>';
    };

    var st = av && av.status ? av.status : '-';
    var classeSt = /VANTAGEM|ENTRA/i.test(st) ? 'status vig' : 'status obs';

    return '<div class="cf">' +
      '<div class="hora">' + esc(hora) + '</div>' +
      '<div class="times">' + esc(nome) + '</div>' +
      '<div class="meta">' + esc(estado.liga) + ' - ' + esc(MERCADOS[mkt] || mkt) + ' - base ' + passados.length + ' jogos</div>' +
      '<div class="anc">ancora -</div>' +
      '<div class="lados">' +
        '<div class="lado"><div class="t">Casa: ' + esc(casa) + '</div>' + linhasLado(casa) + '</div>' +
        '<div class="vs">x</div>' +
        '<div class="lado"><div class="t">Fora: ' + esc(fora) + '</div>' + linhasLado(fora) + '</div>' +
      '</div>' +
      '<div class="conf">Score do motor: ' + (av && av.score != null ? av.score : '-') + '</div>' +
      '<div class="' + classeSt + '">' + esc(st) + '</div>' +
      '<button class="abrir" data-cf="' + esc(nome) + '">Abrir confronto</button>' +
    '</div>';
  }

  function render() {
    if (!window.AMD_ADAPTADOR || !window.AMD_MOTOR) {
      $('confr').innerHTML = '<div style="padding:14px;color:var(--red)">motor.js ou motor-adaptador.js nao carregou.</div>';
      return;
    }

    var mkt = estado.mkt;
    var d = window.AMD_ADAPTADOR.normalizar(estado.jogos);
    var passados = d.passados, futuros = d.futuros;

    if (!futuros.length) {
      $('confr').innerHTML = '<div style="padding:14px;color:var(--muted)">Nenhum jogo por disputar nesta janela.</div>';
      $('leitura').innerHTML = '';
      notas(passados, mkt, null);
      return;
    }

    var avals = [];
    try {
      var r = window.AMD_MOTOR.fullEvalUpcoming(futuros, passados, mkt);
      avals = Array.isArray(r) ? r : (r ? [r] : []);
    } catch (e) { avals = []; }

    var porNome = {};
    avals.forEach(function (a) { if (a && a.nome) porNome[a.nome] = a; });

    $('confr').innerHTML = futuros.slice(0, 6).map(function (j) {
      return cardConfronto(porNome[j.nome], j, passados, mkt);
    }).join('');

    [].forEach.call($('confr').querySelectorAll('.abrir'), function (b) {
      b.addEventListener('click', function () {
        estado.selecionado = b.getAttribute('data-cf');
        renderLeitura(porNome, passados, mkt);
        $('secLeitura').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    if (!estado.selecionado || !porNome[estado.selecionado]) {
      estado.selecionado = futuros[0] ? futuros[0].nome : null;
    }
    renderLeitura(porNome, passados, mkt);
    notas(passados, mkt, avals.length);
  }

  /* ---------- render da analise ---------- */

  function renderLeitura(porNome, passados, mkt) {
    var av = estado.selecionado ? porNome[estado.selecionado] : null;
    if (!av) {
      $('leitura').innerHTML = '<div style="padding:14px;color:var(--muted)">Selecione um confronto.</div>';
      return;
    }

    var ciclo = null;
    try { ciclo = window.AMD_MOTOR.cycleStats(passados, mkt); } catch (e) { ciclo = null; }

    var partes = av.nome.split(' x ');
    var bA = baseTime(passados, partes[0], mkt);
    var bB = baseTime(passados, partes[1], mkt);

    var textoCiclo = ciclo
      ? (ciclo.streak + ' ' + ciclo.cur + ' - ' + (ciclo.fase || '-') + ' - pressao ' + (ciclo.pressao != null ? ciclo.pressao : '-'))
      : '-';

    var h = '';
    h += '<div class="linha">Alvo: ' + esc(av.nome) + ' - ' + esc(MERCADOS[mkt] || mkt) + ' - odd de mercado ' + fmtOdd(av.odd) + '</div>';
    h += '<div class="linha">Base de calculo: ' + passados.length + ' jogos resolvidos nas ultimas ' + estado.horas + 'h</div>';

    h += '<div class="metr">' +
      '<div><div class="k">Prob. calibrada</div><div class="v" style="color:var(--green)">' + fmtPct(av.prob) + '</div></div>' +
      '<div><div class="k">Odd justa</div><div class="v">' + fmtOdd(av.justa) + '</div></div>' +
      '<div><div class="k">EV real</div><div class="v" style="color:' + cor(av.ev) + '">' + fmtSinal(av.ev) + '</div></div>' +
      '<div><div class="k">Edge</div><div class="v" style="color:' + cor(av.edge) + '">' + fmtSinal(av.edge) + '</div></div>' +
      '<div><div class="k">Score</div><div class="v">' + (av.score != null ? av.score : '-') + '</div></div>' +
    '</div>';

    h += '<div class="base">' +
      '<span>Base dessa odd <b>' + esc(av.oddBase || 'sem base') + '</b></span>' +
      '<span>Base ' + esc(partes[0]) + ' <b>' + (bA.j >= MIN_AMOSTRA ? bA.g + '/' + bA.j + ' ' + fmtPct(bA.p, 0) : '-') + '</b></span>' +
      '<span>Base ' + esc(partes[1]) + ' <b>' + (bB.j >= MIN_AMOSTRA ? bB.g + '/' + bB.j + ' ' + fmtPct(bB.p, 0) : '-') + '</b></span>' +
      '<span>Ciclo <b>' + esc(textoCiclo) + '</b></span>' +
      '<span>Status <b>' + esc(av.status || '-') + '</b></span>' +
    '</div>';

    $('leitura').innerHTML = h;
  }

  /* ---------- rodape honesto ---------- */

  function notas(passados, mkt, qtdAvaliados) {
    var pag = null;
    try {
      var v = passados.filter(function (j) { return window.AMD_MOTOR.pays(j, mkt); }).length;
      pag = passados.length ? Math.round(v / passados.length * 1000) / 10 : null;
    } catch (e) { pag = null; }

    var t = '';
    t += '<b>Como ler esta pagina</b><br>';
    t += 'Pagamento medido de ' + (MERCADOS[mkt] || mkt) + ' na janela: <b>' + fmtPct(pag) + '</b> em ' + passados.length + ' jogos resolvidos.<br>';
    t += 'Cada percentual vem seguido do tamanho da amostra. Abaixo de ' + MIN_AMOSTRA + ' jogos mostro travessao, porque o numero seria ruido.<br>';
    t += 'EV real = prob x odd - 1. Sem odd de mercado nao ha EV, e o campo fica vazio.<br>';
    t += 'Ancora e Confluencia estao vazios de proposito: nao existem no motor.js e eu nao sei a sua definicao. Me diga a regra e eu implemento.<br>';
    t += 'Mercado 5+ Gols: o percentual e real, mas o EV fica vazio porque o coletor nao traz a odd de 5+ (so a de exatamente 5 gols, que e outro mercado).<br>';
    if (qtdAvaliados != null) t += 'Confrontos avaliados pelo motor nesta carga: ' + qtdAvaliados + '.<br>';
    t += 'Futebol virtual e RNG: sequencia de reds nao aumenta a chance do proximo green. Estes numeros descrevem o passado, nao preveem o proximo jogo.';
    $('notas').innerHTML = t;
  }

  /* ---------- eventos ---------- */

  function iniciar() {
    $('selLiga').addEventListener('change', function () { estado.liga = this.value; estado.selecionado = null; carregar(); });
    $('selMkt').addEventListener('change', function () { estado.mkt = this.value; render(); });
    $('selHoras').addEventListener('change', function () { estado.horas = +this.value; carregar(); });
    $('btnRecarregar').addEventListener('click', carregar);
    carregar();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
