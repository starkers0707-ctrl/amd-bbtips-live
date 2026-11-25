/* ============================================================================
 * TRAVA DO ACUMULADO 00h
 * ----------------------------------------------------------------------------
 * Fonte unica de verdade para "o grafico esta subindo?". Usa o grafico
 * ACUMULADO desde 00h (o mesmo que o usuario olha), com MM9 e MM21:
 *   sobe = MM9 acima da MM21, MM9 subindo e a linha acima da MM9.
 * Com menos de 60 jogos no dia (madrugada) nada e confirmado.
 * Qualquer alerta de entrada/oportunidade/subida consulta isto antes de aparecer.
 * ========================================================================== */
(function (root) {
  'use strict';
  var LIGAS = ['eng', 'ita', 'spa', 'mnd', 'bra', 'lat', 'cam', 'cop', 'ame'];
  var MIN_JOGOS = 60, INTERVALO = 60000;
  var jogos = {}, carregado = {};

  function regra(mercado) {
    var m = String(mercado || '').toLowerCase().replace(',', '.').replace(/^(over|under)_?(\d)(\d)$/, '$1 $2.$3');
    var x;
    if ((x = m.match(/over\s*(\d+(?:\.\d+)?)/))) { var o = Number(x[1]); return function (g) { return g.a + g.b > o; }; }
    if ((x = m.match(/under\s*(\d+(?:\.\d+)?)/))) { var u = Number(x[1]); return function (g) { return g.a + g.b < u; }; }
    if (/^o(\d)(\d)$/.test(m)) { var oo = Number(m[1] + '.' + m[2]); return function (g) { return g.a + g.b > oo; }; }
    if (/ambas|btts|ambs/.test(m)) {
      if (/n[ãa]o|nao/.test(m)) return function (g) { return !(g.a > 0 && g.b > 0); };
      return function (g) { return g.a > 0 && g.b > 0; };
    }
    if (/5\+|ge5/.test(m)) return function (g) { return g.a + g.b >= 5; };
    return null;
  }

  function carrega(liga) {
    return fetch('/api/grade?liga=' + liga + '&horas=24&compacto=1&_=' + Date.now(), { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j) return;
        jogos[liga] = (j.partidas || []).filter(function (g) { return g.resultado_ft && g.gols_a != null && g.gols_b != null; })
          .sort(function (a, b) { return Date.parse(a.slot_em) - Date.parse(b.slot_em); })
          .map(function (g) { return { a: Number(g.gols_a), b: Number(g.gols_b), dia: String(g.slot_em || '').slice(0, 10) }; });
        carregado[liga] = Date.now();
      }).catch(function () {});
  }
  function atualiza() { LIGAS.forEach(carrega); }

  function estado(liga, mercado) {
    liga = String(liga || '').toLowerCase().slice(0, 3);
    var paga = regra(mercado), lista = jogos[liga];
    if (!paga) return { conhecido: false, ok: true, txt: '' };
    if (!lista || !lista.length) return { conhecido: false, ok: true, txt: '' };
    var dia = lista[lista.length - 1].dia, h = lista.filter(function (g) { return g.dia === dia; });
    if (h.length < MIN_JOGOS) return { conhecido: true, ok: false, motivo: 'madrugada', txt: 'madrugada: só ' + h.length + ' jogos no dia, gráfico 00h ainda engana' };
    var s = 0, line = h.map(function (g, i) { s += paga(g) ? 1 : 0; return s / (i + 1) * 100; });
    var n = line.length - 1;
    function mm(p, i) { var t = 0; for (var k = i - p + 1; k <= i; k++) t += line[k]; return t / p; }
    var m9 = mm(9, n), m21 = mm(21, n), m9a = mm(9, n - 1);
    var cruzou = m9 > m21, m9sobe = m9 >= m9a, acima = line[n] >= m9;
    var ok = cruzou && m9sobe && acima;
    var motivo = ok ? 'subindo' : !cruzou ? 'caindo' : !acima ? 'linha abaixo da MM9' : 'MM9 perdendo força';
    return { conhecido: true, ok: ok, motivo: motivo, linha: +line[n].toFixed(2), m9: +m9.toFixed(2), m21: +m21.toFixed(2),
      txt: 'acumulado 00h ' + (ok ? '▲ subindo' : '▼ ' + motivo) + ' (' + line[n].toFixed(1) + '% · MM9 ' + m9.toFixed(2) + ' · MM21 ' + m21.toFixed(2) + ')' };
  }

  /* Taxa normal REAL da liga no mercado (ultimas 24h carregadas). */
  function normal(liga, mercado) {
    liga = String(liga || '').toLowerCase().slice(0, 3);
    var paga = regra(mercado), lista = jogos[liga];
    if (!paga || !lista || lista.length < 200) return null;
    var c = 0; lista.forEach(function (g) { if (paga(g)) c++; });
    return Math.round(c / lista.length * 1000) / 10;
  }
  root.AcumGuard = { estado: estado, atualiza: atualiza, regra: regra, normal: normal };
  atualiza();
  setInterval(atualiza, INTERVALO);
})(typeof window !== 'undefined' ? window : this);
