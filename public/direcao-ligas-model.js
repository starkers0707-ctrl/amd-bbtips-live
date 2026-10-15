(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DirecaoLigasModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var MERCADOS = ['over25', 'over35', 'over5'];

  function finito(v) {
    return Number.isFinite(Number(v));
  }

  function limitar(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function inclinacao(valores, periodo) {
    var s = (valores || []).filter(finito).map(Number)
      .slice(-Math.max(3, periodo || 18));
    if (s.length < 3) return 0;
    var meio = (s.length - 1) / 2;
    var media = s.reduce(function (a, b) { return a + b; }, 0) / s.length;
    var topo = 0;
    var base = 0;
    s.forEach(function (y, i) {
      topo += (i - meio) * (y - media);
      base += (i - meio) * (i - meio);
    });
    return base ? topo / base : 0;
  }

  function faixa(valores, periodo) {
    var s = (valores || []).filter(finito).map(Number)
      .slice(-Math.max(12, periodo || 120));
    if (!s.length) return { posicao: 0.5 };
    var atual = s[s.length - 1];
    var min = Math.min.apply(null, s);
    var max = Math.max.apply(null, s);
    return { posicao: (atual - min) / Math.max(0.1, max - min) };
  }

  function porLiga(pacotes) {
    var mapa = {};
    MERCADOS.forEach(function (mercado) {
      var pacote = pacotes && pacotes[mercado];
      ((pacote && pacote.ligas) || []).forEach(function (liga) {
        if (!Array.isArray(liga.serie) || liga.serie.length < 18) return;
        var id = liga.id || liga.liga;
        if (!mapa[id]) {
          mapa[id] = { id: id, nome: liga.nome || id, cor: liga.cor, mercados: {} };
        }
        var serie = liga.serie.map(Number).filter(finito);
        var curta = inclinacao(serie, 9);
        var longa = inclinacao(serie, 18);
        var anterior = inclinacao(serie.slice(0, -9), 18);
        mapa[id].mercados[mercado] = {
          atual: serie[serie.length - 1],
          curta: curta,
          longa: longa,
          aceleracao: curta - anterior,
          posicao: faixa(serie, 120).posicao
        };
      });
    });
    return mapa;
  }

  function analisar(pacotes, opcoes) {
    opcoes = opcoes || {};
    var mapa = porLiga(pacotes);
    var ligas = Object.keys(mapa).map(function (chave) { return mapa[chave]; });
    if (ligas.length < 4 || ligas.some(function (liga) {
      return MERCADOS.some(function (mercado) { return !liga.mercados[mercado]; });
    })) {
      return { pronto: false, motivo: 'aguardando os três mercados das quatro ligas' };
    }

    var liderAtual = ligas.slice().sort(function (a, b) {
      return b.mercados.over25.atual - a.mercados.over25.atual;
    })[0];

    ligas.forEach(function (liga) {
      var mercados = liga.mercados;
      var positivos = MERCADOS.filter(function (chave) {
        return mercados[chave].longa > 0;
      }).length;
      var acelerando = MERCADOS.filter(function (chave) {
        return mercados[chave].aceleracao > 0;
      }).length;
      var momento = mercados.over25.longa * 50 +
        mercados.over35.longa * 35 + mercados.over5.longa * 25;
      var aceleracao = mercados.over25.aceleracao * 24 +
        mercados.over35.aceleracao * 18 + mercados.over5.aceleracao * 12;
      var cascata = positivos * 5 + acelerando * 3;
      var reversao = mercados.over25.posicao < 0.72 &&
        mercados.over25.posicao > 0.12 && mercados.over25.longa > 0 ? 8 : 0;
      var exaustao = mercados.over25.posicao > 0.92 &&
        mercados.over25.aceleracao < 0 ? -9 : 0;
      var liderPerde = liderAtual.id !== liga.id &&
        liderAtual.mercados.over25.longa < 0 ? 5 : 0;

      liga.indice = Math.round(limitar(
        45 + momento + aceleracao + cascata + reversao + exaustao + liderPerde,
        5, 95
      ));
      liga.confirmacoes = positivos;
      liga.evidencias = [];
      if (mercados.over25.longa > 0) liga.evidencias.push('Over 2.5 virou para cima');
      if (mercados.over35.longa > 0) liga.evidencias.push('Over 3.5 confirma');
      if (mercados.over5.longa > 0) liga.evidencias.push('5+ acompanha');
      if (acelerando >= 2) liga.evidencias.push('aceleração em ' + acelerando + ' mercados');
      if (liderPerde) liga.evidencias.push(liderAtual.nome + ' desacelerando');
      liga.status = liga.id === liderAtual.id
        ? (liga.indice >= 66 ? 'LÍDER FORTE' : 'LÍDER PERDENDO FORÇA')
        : (liga.indice >= 60 && positivos >= 2
          ? 'PRÉ-VIRADA' : liga.indice >= 52 ? 'OBSERVAÇÃO' : 'SEM DIREÇÃO');
      liga.horizonte = liga.indice >= 75 ? '1–2h' : liga.indice >= 60 ? '2–4h' : '4–6h';
    });

    ligas.sort(function (a, b) { return b.indice - a.indice; });
    var candidata = ligas[0];
    return {
      pronto: true,
      atual: liderAtual,
      candidata: candidata,
      ranking: ligas,
      alerta: candidata.id !== liderAtual.id && candidata.status === 'PRÉ-VIRADA',
      mercados: 3,
      janela: opcoes.janela || null
    };
  }

  return { inclinacao: inclinacao, analisar: analisar };
});
