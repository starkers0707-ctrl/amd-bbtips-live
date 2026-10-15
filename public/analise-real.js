/* ============================================================
   AMD LIVE 2 - analise-real.js
   Substitui CONFRONTOS e ANALISE DE CONFRONTO pelo calculo real.

   COMO FUNCIONA
   Carrega DEPOIS do analise.js. Nao altera o analise.js.
   Esconde os dois containers originais (#confr e #leitura), que
   continuam existindo para o analise.js escrever sem dar erro,
   e desenha o conteudo real em containers irmaos.

   Para reverter: remover a tag <script> deste arquivo do
   analise.html. Nada mais precisa ser desfeito.

   REGRA: nenhum numero e gerado. Sem dado, mostra travessao.
   ============================================================ */

(function () {
  'use strict';

  var API = '/api/grade';
  var MERCADOS = [
    ['o25', 'Over 2.5'],
    ['o35', 'Over 3.5'],
    ['ge5', '5+ Gols'],
    ['ambs', 'Ambas marcam']
  ];
  var ROTULO = {};
  MERCADOS.forEach(function (m) { ROTULO[m[0]] = m[1]; });

  /* Abaixo disso o percentual e ruido: 1 de 2 jogos nao e 50%. */
  var MIN_AMOSTRA = 10;
  var HORAS = 24;
  var RECARGA_MS = 60000;

  var estado = { jogos: [], liga: null, mkt: 'o25', selecionado: null, carregando: false };

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  function fmtPct(v, casas) {
    if (v === null || v === undefined || !isFinite(v)) return '\u2014';
    return v.toFixed(casas === undefined ? 1 : casas) + '%';
  }
  function fmtSinal(v) {
    if (v === null || v === undefined || !isFinite(v)) return '\u2014';
    return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  }
  function fmtOdd(v) {
    if (v === null || v === undefined || !isFinite(v) || v <= 1) return '\u2014';
    return v.toFixed(2);
  }
  function cor(v) {
    if (v === null || v === undefined || !isFinite(v)) return 'var(--muted)';
    return v >= 0 ? 'var(--green)' : 'var(--red)';
  }

  /* ---------- liga vem do seletor global da pagina ---------- */

  var LIGAS = { 'copa': 1, 'euro': 1, 'super': 1, 'premier': 1 };

  function ligaAtual() {
    var chips = document.querySelectorAll('.opts .opt');
    for (var i = 0; i < chips.length; i++) {
      var txt = (chips[i].textContent || '').trim().toLowerCase();
      if (LIGAS[txt] && /\bon\b/.test(chips[i].className)) return txt;
    }
    return 'super';
  }

  function vigiarLiga() {
    setInterval(function () {
      var l = ligaAtual();
      if (l !== estado.liga) {
        estado.liga = l;
        estado.selecionado = null;
        carregar();
      }
    }, 1500);
  }

  /* ---------- montagem dos containers ---------- */

  function montar() {
    var orig = $('confr');
    var origL = $('leitura');
    if (!orig || !origL) return false;
    if ($('confr-real')) return true;

    orig.style.display = 'none';
    origL.style.display = 'none';

    var barra = document.createElement('div');
    barra.className = 'opts';
    barra.id = 'confr-mkts';
    barra.style.margin = '8px 0';
    barra.innerHTML = MERCADOS.map(function (m) {
      return '<div class="opt' + (m[0] === estado.mkt ? ' on' : '') + '" data-mkt="' + m[0] + '">' + esc(m[1]) + '</div>';
    }).join('');
    orig.parentNode.insertBefore(barra, orig);

    var novo = document.createElement('div');
    novo.className = 'confr';
    novo.id = 'confr-real';
    orig.parentNode.insertBefore(novo, orig.nextSibling);

    var novoL = document.createElement('div');
    novoL.className = 'leitura';
    novoL.id = 'leitura-real';
    origL.parentNode.insertBefore(novoL, origL.nextSibling);

    barra.addEventListener('click', function (ev) {
      var alvo = ev.target.closest('.opt');
      if (!alvo) return;
      estado.mkt = alvo.getAttribute('data-mkt');
      [].forEach.call(barra.querySelectorAll('.opt'), function (o) {
        o.className = 'opt' + (o.getAttribute('data-mkt') === estado.mkt ? ' on' : '');
      });
      render();
    });

    return true;
  }

  /* ---------- dados ---------- */

  function carregar() {
    if (estado.carregando) return;
    estado.carregando = true;

    var q = API + '?liga=' + encodeURIComponent(estado.liga) + '&horas=' + HORAS + '&compacto=1';

    return fetch(q, { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (j) {
        estado.jogos = Array.isArray(j) ? j
          : (j && Array.isArray(j.partidas)) ? j.partidas
          : (j && Array.isArray(j.jogos)) ? j.jogos
          : [];
        estado.carregando = false;
        render();
      })
      .catch(function (e) {
        estado.carregando = false;
        var alvo = $('confr-real');
        if (alvo) alvo.innerHTML = '<div style="padding:14px;color:var(--muted)">Nao foi possivel carregar a grade: ' + esc(e.message) + '</div>';
      });
  }

  /* ---------- base por time ---------- */

  function baseTime(passados, nome, mkt) {
    if (!window.AMD_MOTOR || !nome) return { p: null, j: 0, g: 0 };
    try { return window.AMD_MOTOR.teamPayPct(passados, nome, mkt) || { p: null, j: 0, g: 0 }; }
    catch (e) { return { p: null, j: 0, g: 0 }; }
  }

  function celula(base) {
    if (!base || base.j < MIN_AMOSTRA || base.p === null) {
      return '<b style="color:var(--muted)">\u2014</b>';
    }
    return '<b>' + fmtPct(base.p, 0) + '</b>';
  }

  /* ---------- cards ---------- */

  function card(av, jogo, passados, mkt) {
    var casa = jogo.time_a, fora = jogo.time_b;
    var nome = casa + ' x ' + fora;

    var lado = function (time) {
      var b25 = baseTime(passados, time, 'o25');
      var b35 = baseTime(passados, time, 'o35');
      var b5 = baseTime(passados, time, 'ge5');
      var n = Math.max(b25.j, b35.j, b5.j);
      return '<div class="r"><span>Over 2.5</span>' + celula(b25) + '</div>' +
             '<div class="r"><span>Over 3.5</span>' + celula(b35) + '</div>' +
             '<div class="r"><span>5+ Gols</span>' + celula(b5) + '</div>' +
             '<div class="r" style="opacity:.55"><span>amostra</span><b>' + n + ' jogos</b></div>';
    };

    var st = (av && av.status) ? av.status : '\u2014';
    var classeSt = /VANTAGEM|ENTRA/i.test(st) ? 'status vig' : 'status obs';
    /* O status do motor e dominado pela zona, que e do mercado:
       vinha igual em todos os cards. Aqui o selo passa a mostrar
       o que muda de jogo para jogo, que e o EV. O veredito de
       mercado ficou no cabecalho da secao. */
    if (av && av.ev !== null && av.ev !== undefined && isFinite(av.ev)) {
      st = (av.ev > 0 ? 'EV POSITIVO ' : 'EV NEGATIVO ') + fmtSinal(av.ev);
      classeSt = 'status ' + (av.ev > 0 ? 'vig' : 'obs');
    } else {
      st = 'SEM ODD - SEM EV';
      classeSt = 'status obs';
    }

    return '<div class="cf">' +
      '<div class="hora">' + esc(jogo.horario || jogo.hora || '') + '</div>' +
      '<div class="times">' + esc(nome) + '</div>' +
      '<div class="meta">' + esc(estado.liga) + ' - ' + esc(ROTULO[mkt] || mkt) + ' - ' + passados.length + ' jogos de base</div>' +
      '<div class="anc">EV ' + fmtSinal(av ? av.ev : null) + '</div>' +
      '<div class="lados">' +
        '<div class="lado"><div class="t">Casa: ' + esc(casa) + '</div>' + lado(casa) + '</div>' +
        '<div class="vs">x</div>' +
        '<div class="lado"><div class="t">Fora: ' + esc(fora) + '</div>' + lado(fora) + '</div>' +
      '</div>' +
      '<div class="conf">Odd ' + fmtOdd(av ? av.odd : null) + ' - justa ' + fmtOdd(av ? av.justa : null) + ' - score ' + ((av && av.score != null) ? av.score : '\u2014') + '</div>' +
      '<div class="' + classeSt + '">' + esc(st) + '</div>' +
      '<button class="abrir" data-cf="' + esc(nome) + '">Abrir confronto</button>' +
    '</div>';
  }

  /* ---------- render ---------- */

  function render() {
    var alvo = $('confr-real');
    if (!alvo) return;

    if (!window.AMD_ADAPTADOR || !window.AMD_MOTOR) {
      alvo.innerHTML = '<div style="padding:14px;color:var(--red)">motor.js ou motor-adaptador.js nao carregou.</div>';
      return;
    }

    var mkt = estado.mkt;
    var d = window.AMD_ADAPTADOR.normalizar(estado.jogos);
    var passados = d.passados, futuros = d.futuros;

    if (!passados.length) {
      alvo.innerHTML = '<div style="padding:14px;color:var(--muted)">Sem jogos resolvidos nesta janela.</div>';
      return;
    }
    if (!futuros.length) {
      alvo.innerHTML = '<div style="padding:14px;color:var(--muted)">Nenhum jogo por disputar agora.</div>';
      renderLeitura({}, passados, mkt);
      return;
    }

    var avals = [];
    try {
      var r = window.AMD_MOTOR.fullEvalUpcoming(futuros, passados, mkt);
      avals = Array.isArray(r) ? r : (r ? [r] : []);
    } catch (e) { avals = []; }

    var porNome = {};
    avals.forEach(function (a) { if (a && a.nome) porNome[a.nome] = a; });

    /* Leitura de zona: e do MERCADO, nao de cada confronto.
       O zoneSignal recebe UMA serie da liga+mercado, entao o
       veredito e o mesmo para todos os jogos. Por isso vai uma
       vez no cabecalho, e nao repetido dentro de cada card. */
    try {
      var serie = window.AMD_MOTOR.chartSeries(passados, mkt, 20);
      var z = window.AMD_MOTOR.zoneSignal(serie);
      var cab = document.getElementById('confr-zona');
      if (!cab) {
        cab = document.createElement('div');
        cab.className = 'meta';
        cab.id = 'confr-zona';
        cab.style.margin = '2px 0 10px';
        var barra0 = document.getElementById('confr-mkts');
        if (barra0 && barra0.parentNode) barra0.parentNode.insertBefore(cab, barra0.nextSibling);
      }
      if (cab) {
        cab.innerHTML =
          'Mercado ' + esc(ROTULO[mkt] || mkt) +
          ' - zona <b>' + esc(z.zona) + ' ' + z.zonaPct + '%</b>' +
          ' - ' + esc(z.direcao) +
          ' - MACD ' + (z.macd != null ? z.macd : '-') +
          ' - MM ' + (z.mm1 != null ? z.mm1 : '-') + '/' + (z.mm2 != null ? z.mm2 : '-') +
          ' - <b>' + esc(z.sinal) + '</b>' +
          ' <span style="opacity:.55">(leitura do mercado, vale para todos os confrontos abaixo)</span>';
      }
    } catch (e) {}
    alvo.innerHTML = futuros.slice(0, 6).map(function (j) {
      return card(porNome[j.nome], j, passados, mkt);
    }).join('');

    [].forEach.call(alvo.querySelectorAll('.abrir'), function (b) {
      b.addEventListener('click', function () {
        estado.selecionado = b.getAttribute('data-cf');
        renderLeitura(porNome, passados, mkt);
        var sec = $('secLeitura');
        if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    if (!estado.selecionado || !porNome[estado.selecionado]) {
      estado.selecionado = futuros[0] ? futuros[0].nome : null;
    }
    renderLeitura(porNome, passados, mkt);
  }

  function renderLeitura(porNome, passados, mkt) {
    var alvo = $('leitura-real');
    if (!alvo) return;

    var av = estado.selecionado ? porNome[estado.selecionado] : null;
    if (!av) {
      alvo.innerHTML = '<div style="padding:14px;color:var(--muted)">Selecione um confronto acima.</div>';
      return;
    }

    var ciclo = null;
    try { ciclo = window.AMD_MOTOR.cycleStats(passados, mkt); } catch (e) { ciclo = null; }

    var pag = null;
    try {
      var v = passados.filter(function (j) { return window.AMD_MOTOR.pays(j, mkt); }).length;
      pag = passados.length ? Math.round(v / passados.length * 1000) / 10 : null;
    } catch (e) { pag = null; }

    var partes = av.nome.split(' x ');
    var bA = baseTime(passados, partes[0], mkt);
    var bB = baseTime(passados, partes[1], mkt);

    var txtCiclo = ciclo
      ? (ciclo.streak + ' ' + ciclo.cur + ' - ' + (ciclo.fase || '\u2014') + ' - pressao ' + (ciclo.pressao != null ? ciclo.pressao : '\u2014'))
      : '\u2014';

    var h = '';
    h += '<div class="linha">Alvo: ' + esc(av.nome) + ' - ' + esc(ROTULO[mkt] || mkt) + ' - odd de mercado ' + fmtOdd(av.odd) + '</div>';
    h += '<div class="linha">Mercado pagou ' + fmtPct(pag) + ' em ' + passados.length + ' jogos nas ultimas ' + HORAS + 'h</div>';

    h += '<div class="metr">' +
      '<div><div class="k">Prob. calibrada</div><div class="v" style="color:var(--green)">' + fmtPct(av.prob) + '</div></div>' +
      '<div><div class="k">Odd justa</div><div class="v">' + fmtOdd(av.justa) + '</div></div>' +
      '<div><div class="k">EV real</div><div class="v" style="color:' + cor(av.ev) + '">' + fmtSinal(av.ev) + '</div></div>' +
      '<div><div class="k">Edge</div><div class="v" style="color:' + cor(av.edge) + '">' + fmtSinal(av.edge) + '</div></div>' +
      '<div><div class="k">Score</div><div class="v">' + (av.score != null ? av.score : '\u2014') + '</div></div>' +
    '</div>';

    h += '<div class="base">' +
      '<span>Base dessa odd <b>' + esc(av.oddBase || 'sem base') + '</b></span>' +
      '<span>' + esc(partes[0]) + ' <b>' + (bA.j >= MIN_AMOSTRA ? bA.g + '/' + bA.j + ' - ' + fmtPct(bA.p, 0) : '\u2014 (' + bA.j + 'j)') + '</b></span>' +
      '<span>' + esc(partes[1]) + ' <b>' + (bB.j >= MIN_AMOSTRA ? bB.g + '/' + bB.j + ' - ' + fmtPct(bB.p, 0) : '\u2014 (' + bB.j + 'j)') + '</b></span>' +
      '<span>Ciclo <b>' + esc(txtCiclo) + '</b></span>' +
      '<span>Status <b>' + esc(av.status || '\u2014') + '</b></span>' +
    '</div>';

    alvo.innerHTML = h;
  }

  /* ---------- inicio ---------- */

  function iniciar() {
    var tentativas = 0;
    var t = setInterval(function () {
      tentativas++;
      if (montar()) {
        clearInterval(t);
        estado.liga = ligaAtual();
        carregar();
        vigiarLiga();
        setInterval(carregar, RECARGA_MS);
      } else if (tentativas > 40) {
        clearInterval(t);
      }
    }, 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
