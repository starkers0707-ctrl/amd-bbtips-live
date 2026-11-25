/* ============================================================
   AMD LIVE - analise-kpis-real.js
   O analise.js original SORTEAVA (gerador aleatorio semeado):
     - "Sinais ativos", "Confianca media" e "EV projetado" do topo
     - a tabela "maxima de reds" e a "seca atual"
   Isso mostrava 74% de confianca e EV +18% em qualquer cenario.
   Aqui: o topo mostra so o que e medido (acumulado 00h do Over 2.5
   da liga) e a tabela de reds e calculada nos jogos reais.
   REGRA: nenhum numero e gerado. Sem dado, mostra travessao.
   ============================================================ */
(function () {
  'use strict';
  var HORAS_JOGO = 20;   /* ~1 jogo a cada 3 min */
  var cache = {};

  function ligaSel() { return String(window.liga || 'ENG').toLowerCase(); }
  function paga(m) { return typeof window.evCfg === 'function' ? window.evCfg(m).paga : null; }

  function busca(l) {
    if (cache[l] && Date.now() - cache[l].t < 60000) return Promise.resolve(cache[l].j);
    return fetch('/api/grade?liga=' + l + '&horas=24&compacto=1&_=' + Date.now(), { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : { partidas: [] }; })
      .then(function (j) {
        var lista = (j.partidas || []).filter(function (g) { return g.resultado_ft && g.gols_a != null; })
          .sort(function (a, b) { return Date.parse(a.slot_em) - Date.parse(b.slot_em); });
        cache[l] = { t: Date.now(), j: lista }; return lista;
      }).catch(function () { return []; });
  }

  function maxRedsReal(lista, fn, n) {
    var js = lista.slice(-n), max = 0, cur = 0;
    js.forEach(function (g) { if (fn(+g.gols_a, +g.gols_b)) cur = 0; else { cur++; if (cur > max) max = cur; } });
    return max;
  }
  function secaAtual(lista, fn) {
    var c = 0;
    for (var i = lista.length - 1; i >= 0; i--) { if (fn(+lista[i].gols_a, +lista[i].gols_b)) break; c++; }
    return c;
  }

  function topo(lista) {
    var set = function (id, v, t) { var e = document.getElementById(id); if (e) { e.textContent = v; e.title = t || ''; } };
    var ac = window.AcumGuard ? window.AcumGuard.estado(ligaSel(), 'Over 2.5') : null;
    set('kSinais', '—', 'removido: o número antigo era sorteado, não calculado');
    set('kConf', ac && ac.conhecido ? (ac.ok ? '▲ 00h' : '▼ 00h') : '—', ac ? ac.txt : '');
    set('kEv', '—', 'removido: o EV antigo era sorteado e nunca ficava negativo');
  }

  function reds() {
    var corpo = document.getElementById('redsBody');
    if (!corpo || !window.GRUPOS || !window.JAN) return;
    var lista = window.GRUPOS[window.rkGrupo] || [];
    busca(ligaSel()).then(function (jogos) {
      corpo.innerHTML = lista.map(function (m) {
        var fn = paga(m);
        if (!fn || !jogos.length) return '<tr><td>' + m + '</td>' + window.JAN.map(function () { return '<td>—</td>'; }).join('') + '<td>—</td></tr>';
        var cels = window.JAN.map(function (w) {
          var horas = parseInt(w[0], 10) || 3;
          return '<td>' + maxRedsReal(jogos, fn, horas * HORAS_JOGO) + '</td>';
        }).join('');
        return '<tr><td>' + m + '</td>' + cels + '<td><b>' + secaAtual(jogos, fn) + '</b></td></tr>';
      }).join('');
    });
  }

  function aplica() { topo(); reds(); }
  ['renderTudo', 'renderRanking'].forEach(function (nome) {
    var orig = window[nome];
    if (typeof orig !== 'function') return;
    window[nome] = function () { var r = orig.apply(this, arguments); setTimeout(aplica, 0); return r; };
  });
  aplica();
  setTimeout(aplica, 3000);
  setInterval(aplica, 60000);
})();
