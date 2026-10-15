(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TimesModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MERCADOS = [
    { id: 'over15', nome: 'Over 1.5' },
    { id: 'over25', nome: 'Over 2.5' },
    { id: 'over35', nome: 'Over 3.5' },
    { id: 'cincomais', nome: '5+ Gols' },
    { id: 'ambas', nome: 'Ambas Marcam (Sim)' },
    { id: 'ambasnao', nome: 'Ambas Marcam (Não)' },
    { id: 'under05', nome: 'Under 0.5' },
    { id: 'under15', nome: 'Under 1.5' },
    { id: 'under25', nome: 'Under 2.5' }
  ];

  function numero(v) { var n = Number(v); return Number.isFinite(n) ? n : null; }
  function nome(v) { return String(v || '').trim(); }
  function chave(v) { return nome(v).toLocaleLowerCase('pt-BR'); }
  function resolvido(j) {
    return !!(j && j.resultado_ft != null && j.resultado_ft !== '' &&
      numero(j.gols_a) != null && numero(j.gols_b) != null);
  }
  function pagou(j, mercado) {
    if (!resolvido(j)) return false;
    var a = numero(j.gols_a), b = numero(j.gols_b), total = a + b;
    if (mercado === 'over15') return total >= 2;
    if (mercado === 'over25') return total >= 3;
    if (mercado === 'over35') return total >= 4;
    if (mercado === 'cincomais') return total >= 5;
    if (mercado === 'ambas') return a > 0 && b > 0;
    if (mercado === 'ambasnao') return !(a > 0 && b > 0);
    if (mercado === 'under05') return total < 1;
    if (mercado === 'under15') return total < 2;
    if (mercado === 'under25') return total < 3;
    return false;
  }
  function jogosResolvidos(lista) { return (lista || []).filter(resolvido); }
  function taxa(lista, mercado) {
    if (!lista.length) return 0;
    return lista.reduce(function (s, j) { return s + (pagou(j, mercado) ? 1 : 0); }, 0) / lista.length;
  }
  function mediaGols(lista) {
    if (!lista.length) return 0;
    return lista.reduce(function (s, j) { return s + numero(j.gols_a) + numero(j.gols_b); }, 0) / lista.length;
  }
  function nomesTimes(lista) {
    var mapa = Object.create(null);
    jogosResolvidos(lista).forEach(function (j) {
      [j.time_a, j.time_b].forEach(function (t) { if (nome(t)) mapa[chave(t)] = nome(t); });
    });
    return Object.keys(mapa).map(function (k) { return mapa[k]; }).sort(function (a, b) {
      return a.localeCompare(b, 'pt-BR');
    });
  }
  function normalizarPosicao(posicao) {
    return posicao === 'casa' || posicao === 'fora' ? posicao : 'normal';
  }
  function jogosDoTime(lista, time, posicao) {
    var alvo = chave(time);
    var modo = normalizarPosicao(posicao);
    return jogosResolvidos(lista).filter(function (j) {
      if (modo === 'casa') return chave(j.time_a) === alvo;
      if (modo === 'fora') return chave(j.time_b) === alvo;
      return chave(j.time_a) === alvo || chave(j.time_b) === alvo;
    });
  }
  function melhorColuna(lista, mercado) {
    var grupos = Object.create(null);
    lista.forEach(function (j) {
      var minuto = numero(j.minuto);
      if (minuto == null) return;
      var k = String(minuto).padStart(2, '0');
      if (!grupos[k]) grupos[k] = { minuto: k, n: 0, pagos: 0 };
      grupos[k].n++;
      if (pagou(j, mercado)) grupos[k].pagos++;
    });
    var elegiveis = Object.keys(grupos).map(function (k) {
      var g = grupos[k]; g.taxa = g.pagos / g.n; return g;
    }).filter(function (g) { return g.n >= 3; });
    elegiveis.sort(function (a, b) { return b.taxa - a.taxa || b.n - a.n; });
    return elegiveis[0] || null;
  }
  function estatistica(lista, time, mercado, baseLiga, posicao) {
    var modo = normalizarPosicao(posicao);
    var todos = jogosDoTime(lista, time, modo).slice(-40);
    var ult10 = todos.slice(-10), ult20 = todos.slice(-20), ult40 = todos.slice(-40);
    var anteriores = todos.slice(Math.max(0, todos.length - 20), Math.max(0, todos.length - 10));
    var t10 = taxa(ult10, mercado), t20 = taxa(ult20, mercado), t40 = taxa(ult40, mercado);
    var prior = Number.isFinite(baseLiga) ? baseLiga : taxa(jogosResolvidos(lista), mercado);
    /* Oito jogos equivalentes da média da liga estabilizam amostras pequenas. */
    var pagos = todos.reduce(function (s, j) { return s + (pagou(j, mercado) ? 1 : 0); }, 0);
    var ajustada = (pagos + prior * 8) / Math.max(1, todos.length + 8);
    var tendenciaBase = anteriores.length >= 5 ? taxa(anteriores, mercado) : t20;
    var delta = t10 - tendenciaBase;
    var tendencia = todos.length < 10 ? 'amostra curta' : delta >= .08 ? 'melhorando' : delta <= -.08 ? 'piorando' : 'estável';
    return {
      time: time, n: todos.length, pagos: pagos, taxa: todos.length ? pagos / todos.length : 0,
      ajustada: ajustada, vantagem: ajustada - prior, mediaGols: mediaGols(todos),
      ult10: t10, n10: ult10.length, ult20: t20, n20: ult20.length,
      ult40: t40, n40: ult40.length, tendencia: tendencia, delta: delta,
      coluna: melhorColuna(todos, mercado), posicao: modo
    };
  }
  function resumoLiga(lista, mercado) {
    var resolvidos = jogosResolvidos(lista);
    return { n: resolvidos.length, taxa: taxa(resolvidos, mercado), mediaGols: mediaGols(resolvidos), times: nomesTimes(resolvidos).length };
  }
  function ranking(lista, mercado, posicao) {
    var modo = normalizarPosicao(posicao);
    var liga = resumoLiga(lista, mercado);
    return nomesTimes(lista).map(function (time) { return estatistica(lista, time, mercado, liga.taxa, modo); })
      .filter(function (s) { return s.n >= 3; })
      .sort(function (a, b) { return b.ajustada - a.ajustada || b.n - a.n; });
  }
  function rankPuxadores(lista, mercado) {
    var resolvidos = jogosResolvidos(lista);
    var base = taxa(resolvidos, mercado);
    var mapa = Object.create(null);
    resolvidos.forEach(function (j) {
      var time = nome(j.time_b);
      if (!time) return;
      var k = chave(time);
      var s = mapa[k] || (mapa[k] = { time: time, n: 0, greens: 0 });
      s.n++;
      if (pagou(j, mercado)) s.greens++;
    });
    return Object.keys(mapa).map(function (k) {
      var s = mapa[k];
      s.reds = s.n - s.greens;
      s.taxa = s.n ? s.greens / s.n : 0;
      s.ajustada = (s.greens + base * 6) / Math.max(1, s.n + 6);
      return s;
    }).filter(function (s) { return s.n >= 3; })
      .sort(function (a, b) {
        return b.ajustada - a.ajustada || b.taxa - a.taxa || b.n - a.n;
      });
  }
  function rankAntesNeleDepois(lista, mercado) {
    var jogos = jogosResolvidos(lista).slice().sort(function (a, b) {
      var ta = Date.parse(a.slot_em || a.criado_em || '') || 0;
      var tb = Date.parse(b.slot_em || b.criado_em || '') || 0;
      return ta - tb;
    });
    var mapa = Object.create(null);
    for (var i = 1; i < jogos.length - 1; i++) {
      var vistos = Object.create(null);
      [jogos[i].time_a, jogos[i].time_b].forEach(function (valor) {
        var time = nome(valor), k = chave(time);
        if (!time || vistos[k]) return;
        vistos[k] = true;
        var s = mapa[k] || (mapa[k] = {
          time: time, n: 0, antes: 0, nele: 0, depois: 0, algum: 0
        });
        var antes = pagou(jogos[i - 1], mercado);
        var nele = pagou(jogos[i], mercado);
        var depois = pagou(jogos[i + 1], mercado);
        s.n++;
        if (antes) s.antes++;
        if (nele) s.nele++;
        if (depois) s.depois++;
        if (antes || nele || depois) s.algum++;
      });
    }
    return Object.keys(mapa).map(function (k) {
      var s = mapa[k];
      s.taxaAntes = s.n ? s.antes / s.n : 0;
      s.taxaNele = s.n ? s.nele / s.n : 0;
      s.taxaDepois = s.n ? s.depois / s.n : 0;
      s.taxaAlgum = s.n ? s.algum / s.n : 0;
      return s;
    }).filter(function (s) { return s.n >= 3; })
      .sort(function (a, b) {
        return b.taxaAlgum - a.taxaAlgum || b.n - a.n;
      });
  }

  function comparar(lista, timeA, timeB, mercado) {
    var liga = resumoLiga(lista, mercado);
    var a = estatistica(lista, timeA, mercado, liga.taxa);
    var b = estatistica(lista, timeB, mercado, liga.taxa);
    var amostra = Math.min(a.n, b.n);
    var ambosAcima = a.ajustada >= liga.taxa && b.ajustada >= liga.taxa;
    var ambosFortes = a.ajustada >= liga.taxa + .05 && b.ajustada >= liga.taxa + .05;
    var status = amostra < 8 ? 'Amostra insuficiente' : ambosFortes ? 'Convergência forte' :
      ambosAcima ? 'Convergência moderada' : (a.ajustada >= liga.taxa || b.ajustada >= liga.taxa) ?
        'Somente um time compatível' : 'Times incompatíveis';
    return { a: a, b: b, liga: liga, status: status, taxaConjunta: (a.ajustada + b.ajustada) / 2 };
  }
  function futurosAtuais(lista) {
    return (lista || []).filter(function (j) {
      if (resolvido(j) || !nome(j.time_a) || !nome(j.time_b)) return false;
      var visto = Date.parse(j.visto_em || '');
      return isNaN(visto) || Date.now() - visto < 25 * 60 * 1000;
    }).sort(function (a, b) {
      return Date.parse(a.slot_em || a.criado_em || 0) - Date.parse(b.slot_em || b.criado_em || 0);
    }).slice(0, 12);
  }
  function confrontos(lista, mercado) {
    return futurosAtuais(lista).map(function (j) {
      var c = comparar(lista, j.time_a, j.time_b, mercado);
      return { jogo: j, a: c.a, b: c.b, liga: c.liga, status: c.status,
        taxaConjunta: c.taxaConjunta };
    }).sort(function (a, b) {
      var ordem = { 'Convergência forte': 4, 'Convergência moderada': 3,
        'Somente um time compatível': 2, 'Times incompatíveis': 1, 'Amostra insuficiente': 0 };
      return (ordem[b.status] || 0) - (ordem[a.status] || 0) || b.taxaConjunta - a.taxaConjunta;
    });
  }

  return { MERCADOS: MERCADOS, resolvido: resolvido, pagou: pagou,
    resumoLiga: resumoLiga, estatistica: estatistica, ranking: ranking,
    comparar: comparar, confrontos: confrontos, nomesTimes: nomesTimes,
    jogosDoTime: jogosDoTime, rankPuxadores: rankPuxadores,
    rankAntesNeleDepois: rankAntesNeleDepois };
});
