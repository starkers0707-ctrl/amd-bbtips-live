/* ============================================================
   AMD LIVE 2 — adaptador motor <-> dados reais
   Carregar DEPOIS de motor.js e ANTES de analise.js.

   PROBLEMA QUE ISTO RESOLVE
   O motor.js foi portado do AMD Live 1 e espera jogos no
   formato { a, b, total, odds: { o25, o35, ge5, ambs, ... } }.
   O AMD_ANALISE_DADOS.buscar() devolve o formato do coletor:
   { gols_a, gols_b, resultado_ft, odds: { 'odd_over_2.5', ... } }.

   Como os campos nunca batiam, AMD_MOTOR.pays() devolvia false
   para 100% dos jogos: 0 greens em 475, streak de 80 REDs,
   prob 0, odd null, "sem base". Com o adaptador, os mesmos
   475 jogos dao Over 2.5 = 43.4%, Over 3.5 = 22.7%, 5+ = 9.7%.

   Nada aqui inventa numero: so renomeia campo.
   ============================================================ */

(function (raiz) {
  'use strict';

  /* Mercado do motor -> chave de odd do coletor. */
  var MAPA_ODDS = {
    o15: 'odd_over_1.5',
    o25: 'odd_over_2.5',
    o35: 'odd_over_3.5',
    u05: 'odd_under_0.5',
    u15: 'odd_under_1.5',
    u25: 'odd_under_2.5',
    ambs: 'odd_ambas_sim'
    /* ATENCAO: 'ge5' (5 ou mais gols) fica de fora de proposito.
       A unica chave proxima no coletor e 'odd_total_gols_extatos_5',
       que e GOLS EXATAMENTE 5 - mercado diferente. Usar essa odd
       daria um EV errado. Enquanto o coletor nao trouxer a odd de
       5+, ge5 fica sem odd e o motor mostra "sem base", que e o
       comportamento honesto. */
  };

  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function temResultado(j) {
    return j.resultado_ft !== null &&
           j.resultado_ft !== undefined &&
           j.resultado_ft !== '';
  }

  /* Converte UM jogo do formato coletor para o formato motor.
     Preserva todos os campos originais: nada e perdido. */
  function adaptarJogo(j) {
    var fim = temResultado(j);
    var a = num(j.gols_a);
    var b = num(j.gols_b);

    var odds = {};
    for (var k in MAPA_ODDS) {
      if (!Object.prototype.hasOwnProperty.call(MAPA_ODDS, k)) continue;
      var v = j.odds ? num(j.odds[MAPA_ODDS[k]]) : null;
      odds[k] = (v !== null && v > 1) ? v : null;
    }

    var saida = Object.assign({}, j, {
      a: fim ? a : null,
      b: fim ? b : null,
      total: (fim && a !== null && b !== null) ? (a + b) : null,
      odds: odds,
      nome: (j.time_a || '?') + ' x ' + (j.time_b || '?')
    });

    saida.oddsOriginais = j.odds || null;
    return saida;
  }

  /* Separa a lista ja adaptada em resolvidos e por jogar. */
  function normalizar(jogosBrutos) {
    var todos = (jogosBrutos || []).map(adaptarJogo);
    return {
      todos: todos,
      passados: todos.filter(function (j) { return j.total !== null; }),
      futuros: todos.filter(function (j) { return j.total === null; })
    };
  }

  /* Analise completa de um mercado. Devolve exatamente o que o
     motor calcula, sem pos-processamento. Se faltar dado, os
     campos vem null - quem renderiza deve mostrar "-", nao zero. */
  function analisar(jogosBrutos, mkt) {
    if (!raiz.AMD_MOTOR) {
      return { erro: 'AMD_MOTOR nao carregado', confrontos: [], ciclo: null };
    }

    var d = normalizar(jogosBrutos);

    if (!d.passados.length) {
      return { erro: 'sem jogos resolvidos', confrontos: [], ciclo: null, amostra: 0 };
    }

    var confrontos = [];
    var ciclo = null;
    var pagamento = null;

    try {
      var r = raiz.AMD_MOTOR.fullEvalUpcoming(d.futuros, d.passados, mkt);
      confrontos = Array.isArray(r) ? r : (r ? [r] : []);
    } catch (e) {
      confrontos = [];
    }

    try {
      ciclo = raiz.AMD_MOTOR.cycleStats(d.passados, mkt);
    } catch (e) {
      ciclo = null;
    }

    try {
      var verdes = d.passados.filter(function (j) {
        return raiz.AMD_MOTOR.pays(j, mkt);
      }).length;
      pagamento = Math.round(verdes / d.passados.length * 1000) / 10;
    } catch (e) {
      pagamento = null;
    }

    return {
      mercado: mkt,
      amostra: d.passados.length,
      porJogar: d.futuros.length,
      pagamento: pagamento,
      ciclo: ciclo,
      confrontos: confrontos
    };
  }

  /* Base historica de um time e de uma faixa de odd.
     Sao as funcoes por tras de "Base dos times" e "Base dessa odd". */
  function baseDoTime(jogosBrutos, nome, mkt) {
    var d = normalizar(jogosBrutos);
    try { return raiz.AMD_MOTOR.teamPayPct(d.passados, nome, mkt); }
    catch (e) { return { g: 0, j: 0, p: null }; }
  }

  function baseDaOdd(jogosBrutos, odd, mkt) {
    var d = normalizar(jogosBrutos);
    try { return raiz.AMD_MOTOR.oddPayPct(d.passados, odd, mkt); }
    catch (e) { return { g: 0, j: 0, p: null }; }
  }

  /* Formatacao segura: null NUNCA vira 0 ou numero inventado. */
  function pct(v, casas) {
    if (v === null || v === undefined || !isFinite(v)) return '-';
    return v.toFixed(casas === undefined ? 1 : casas) + '%';
  }

  function pctSinal(v) {
    if (v === null || v === undefined || !isFinite(v)) return '-';
    return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  }

  function odd(v) {
    if (v === null || v === undefined || !isFinite(v) || v <= 1) return '-';
    return v.toFixed(2);
  }

  raiz.AMD_ADAPTADOR = {
    MAPA_ODDS: MAPA_ODDS,
    adaptarJogo: adaptarJogo,
    normalizar: normalizar,
    analisar: analisar,
    baseDoTime: baseDoTime,
    baseDaOdd: baseDaOdd,
    fmt: { pct: pct, pctSinal: pctSinal, odd: odd }
  };
})(window);
