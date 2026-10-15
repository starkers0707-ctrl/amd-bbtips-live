(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PlacarModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MAX_GOLS = 8;
  function numero(v) { var n = Number(v); return Number.isFinite(n) ? n : null; }
  function limitar(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function nome(v) { return String(v || '').trim().toLowerCase(); }
  function resolvido(j) {
    return j && j.resultado_ft != null && j.resultado_ft !== '' &&
      numero(j.gols_a) != null && numero(j.gols_b) != null;
  }
  function poisson(k, lambda) {
    var f = 1;
    for (var i = 2; i <= k; i++) f *= i;
    return Math.exp(-lambda) * Math.pow(lambda, k) / f;
  }
  function placaresValidos() {
    var out = [];
    for (var a = 0; a <= MAX_GOLS; a++) {
      for (var b = 0; b <= MAX_GOLS - a; b++) out.push({ a: a, b: b, chave: a + '-' + b });
    }
    return out;
  }
  var PLACARES = placaresValidos();

  function mediaLiga(h) {
    var jogos = h.filter(resolvido);
    if (!jogos.length) return { casa: 1.18, fora: 1.12, total: 2.3, variancia: 2.5, ambas: .48, over25: .46, amostra: 0 };
    var casa = 0, fora = 0, ambas = 0, over25 = 0;
    jogos.forEach(function (j) {
      casa += Number(j.gols_a); fora += Number(j.gols_b);
      if (Number(j.gols_a) > 0 && Number(j.gols_b) > 0) ambas++;
      if (Number(j.gols_a) + Number(j.gols_b) >= 3) over25++;
    });
    casa /= jogos.length; fora /= jogos.length;
    var media = casa + fora;
    var variancia = jogos.reduce(function (s, j) {
      return s + Math.pow(Number(j.gols_a) + Number(j.gols_b) - media, 2);
    }, 0) / jogos.length;
    return { casa: casa, fora: fora, total: media, variancia: variancia, ambas: ambas / jogos.length, over25: over25 / jogos.length, amostra: jogos.length };
  }

  function estatisticaTime(h, alvo) {
    alvo = nome(alvo);
    var jogos = h.filter(function (j) {
      return resolvido(j) && (nome(j.time_a) === alvo || nome(j.time_b) === alvo);
    }).slice(-16);
    if (!jogos.length) return null;
    function bloco(lista) {
      var gf = 0, ga = 0, ambas = 0, over25 = 0;
      lista.forEach(function (j) {
        var casa = nome(j.time_a) === alvo;
        var feitos = Number(casa ? j.gols_a : j.gols_b);
        var sofridos = Number(casa ? j.gols_b : j.gols_a);
        gf += feitos; ga += sofridos;
        if (feitos > 0 && sofridos > 0) ambas++;
        if (feitos + sofridos >= 3) over25++;
      });
      return { gf: gf / lista.length, ga: ga / lista.length, ambas: ambas / lista.length, over25: over25 / lista.length };
    }
    var geral = bloco(jogos);
    var recente = bloco(jogos.slice(-Math.min(6, jogos.length)));
    geral.gfRecente = recente.gf; geral.gaRecente = recente.ga;
    geral.amostra = jogos.length;
    return geral;
  }

  function lambdas(h, futuro) {
    var liga = mediaLiga(h);
    var a = estatisticaTime(h, futuro.time_a);
    var b = estatisticaTime(h, futuro.time_b);
    var ataqueA = a ? .68 * a.gf + .32 * a.gfRecente : liga.casa;
    var defesaB = b ? .68 * b.ga + .32 * b.gaRecente : liga.casa;
    var ataqueB = b ? .68 * b.gf + .32 * b.gfRecente : liga.fora;
    var defesaA = a ? .68 * a.ga + .32 * a.gaRecente : liga.fora;
    var la = .30 * liga.casa + .38 * ataqueA + .32 * defesaB;
    var lb = .30 * liga.fora + .38 * ataqueB + .32 * defesaA;
    var overTimes = ((a ? a.over25 : liga.over25) + (b ? b.over25 : liga.over25)) / 2;
    var ajusteRitmo = limitar(1 + (overTimes - liga.over25) * .28, .88, 1.14);
    return {
      casa: limitar(la * ajusteRitmo, .15, 4.8),
      fora: limitar(lb * ajusteRitmo, .15, 4.8),
      liga: liga, timeA: a, timeB: b, ajusteRitmo: ajusteRitmo
    };
  }

  function distanciaMinuto(a, b) {
    var d = Math.abs(Number(a) - Number(b));
    return Math.min(d, 60 - d);
  }

  function frequenciaEmpirica(h, futuro) {
    var placares = Object.create(null), totais = Object.create(null);
    var pesoTotal = 0, semelhantes = 0, minuto = numero(futuro.minuto);
    h.filter(resolvido).slice(-650).forEach(function (j) {
      var total = Number(j.gols_a) + Number(j.gols_b);
      if (total > MAX_GOLS) return;
      var peso = 1;
      if (minuto != null && numero(j.minuto) != null) {
        var d = distanciaMinuto(minuto, Number(j.minuto));
        if (d === 0) peso += 2.2;
        else if (d <= 3) peso += .8;
      }
      var times = [nome(j.time_a), nome(j.time_b)];
      if (times.indexOf(nome(futuro.time_a)) >= 0) peso += 1.15;
      if (times.indexOf(nome(futuro.time_b)) >= 0) peso += 1.15;
      if (peso >= 2.1) semelhantes++;
      var chave = Number(j.gols_a) + '-' + Number(j.gols_b);
      placares[chave] = (placares[chave] || 0) + peso;
      totais[total] = (totais[total] || 0) + peso;
      pesoTotal += peso;
    });
    var sPlacar = .35, denPlacar = pesoTotal + sPlacar * PLACARES.length;
    var taxas = Object.create(null);
    PLACARES.forEach(function (p) { taxas[p.chave] = ((placares[p.chave] || 0) + sPlacar) / Math.max(1, denPlacar); });
    var sTotal = 1.1, denTotal = pesoTotal + sTotal * (MAX_GOLS + 1), totalTaxas = [];
    for (var t = 0; t <= MAX_GOLS; t++) totalTaxas[t] = ((totais[t] || 0) + sTotal) / Math.max(1, denTotal);
    return { taxas: taxas, totalTaxas: totalTaxas, semelhantes: semelhantes, pesoTotal: pesoTotal };
  }

  function frequenciaBase(h) {
    var contagem = Object.create(null), total = 0;
    h.filter(resolvido).slice(-700).forEach(function (j) {
      if (Number(j.gols_a) + Number(j.gols_b) > MAX_GOLS) return;
      var chave = Number(j.gols_a) + '-' + Number(j.gols_b);
      contagem[chave] = (contagem[chave] || 0) + 1; total++;
    });
    var s = .5, den = total + s * PLACARES.length, out = Object.create(null);
    PLACARES.forEach(function (p) { out[p.chave] = ((contagem[p.chave] || 0) + s) / Math.max(1, den); });
    return out;
  }

  function normalizarChave(k) {
    return String(k || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_');
  }
  function oddPlacar(odds, a, b) {
    var alvo = a + '_' + b, melhor = null;
    Object.keys(odds || {}).forEach(function (chave) {
      var k = normalizarChave(chave);
      if (!/(placar|correto|exato|correct_score|resultado_exato)/.test(k)) return;
      var nums = k.match(/\d+/g) || [];
      var par = nums.length >= 2 ? nums[nums.length - 2] + '_' + nums[nums.length - 1] : '';
      if (par !== alvo) return;
      var v = numero(odds[chave]);
      if (v && v > 1 && (!melhor || v > melhor)) melhor = v;
    });
    return melhor;
  }

  function poissonMisturada(a, b, la, lb) {
    return .60 * poisson(a, la) * poisson(b, lb) +
      .20 * poisson(a, la * .78) * poisson(b, lb * .78) +
      .20 * poisson(a, la * 1.28) * poisson(b, lb * 1.28);
  }

  function selecionarDiversos(lista, limite) {
    var escolhidos = [], totais = Object.create(null), usados = Object.create(null);
    lista.forEach(function (p) {
      var total = p.a + p.b;
      if (escolhidos.length < limite && !totais[total]) {
        escolhidos.push(p); totais[total] = true; usados[p.chave] = true;
      }
    });
    lista.forEach(function (p) {
      if (escolhidos.length < limite && !usados[p.chave]) {
        escolhidos.push(p); usados[p.chave] = true;
      }
    });
    return escolhidos;
  }

  function selecionarMercado(analise, modo, linha) {
    modo = modo === 'over' || modo === 'under' ? modo : 'todos';
    linha = [1.5, 2.5, 3.5, 4.5].indexOf(Number(linha)) >= 0 ? Number(linha) : 2.5;
    var candidatos = analise.matriz.filter(function (p) {
      var total = p.a + p.b;
      return modo === 'over' ? total > linha : (modo === 'under' ? total < linha : true);
    });
    var probMercado = candidatos.reduce(function (s, p) { return s + p.probabilidade; }, 0);
    var porProb = candidatos.slice().sort(function (x, y) { return y.probabilidade - x.probabilidade; });
    var comOdd = candidatos.filter(function (p) {
      return p.odd && p.probabilidade >= (modo === 'over' ? .012 : .015);
    }).sort(function (x, y) { return y.scoreOportunidade - x.scoreOportunidade; });
    var porContexto = candidatos.filter(function (p) { return p.probabilidade >= .006; })
      .sort(function (x, y) { return y.scoreOportunidade - x.scoreOportunidade; });
    var origem = comOdd.length ? comOdd : porContexto;
    var oportunidades = selecionarDiversos(origem, 5);
    [porContexto, porProb].forEach(function (lista) {
      lista.forEach(function (p) {
        if (oportunidades.length < 5 && !oportunidades.some(function (x) { return x.chave === p.chave; })) oportunidades.push(p);
      });
    });
    var valor = comOdd[0] || porContexto[0] || porProb[0] || null;
    var entrada = !!(valor && valor.odd && valor.evConservador >= .12 &&
      analise.semelhantes >= 30 && valor.probabilidade >= (modo === 'over' ? .012 : .02));
    var nomeMercado = modo === 'over' ? 'Over ' + linha.toFixed(1) :
      (modo === 'under' ? 'Under ' + linha.toFixed(1) : 'Todos os placares');
    return {
      modo: modo,
      linha: linha,
      nome: nomeMercado,
      probabilidade: probMercado,
      maisProvavel: porProb[0] || null,
      melhorValor: valor,
      oportunidades: oportunidades,
      temOdd: comOdd.length > 0,
      entrada: entrada,
      motivo: entrada ? nomeMercado + ': valor confirmado pela margem conservadora.' :
        (comOdd.length ? nomeMercado + ': nenhuma odd atingiu a margem segura de 12%.' : nomeMercado + ': sem odd de placar suficiente para validar entrada.')
    };
  }

  function analisar(h, futuro) {
    var l = lambdas(h, futuro), emp = frequenciaEmpirica(h, futuro), base = frequenciaBase(h);
    var bruto = [], somaPoisson = [], somaMistura = 0;
    for (var t = 0; t <= MAX_GOLS; t++) somaPoisson[t] = 0;
    PLACARES.forEach(function (p) {
      var pm = poissonMisturada(p.a, p.b, l.casa, l.fora);
      somaPoisson[p.a + p.b] += pm; somaMistura += pm;
      bruto.push({ a: p.a, b: p.b, chave: p.chave, poisson: pm, repeticao: emp.taxas[p.chave], base: base[p.chave] });
    });
    var alvoTotal = [], somaAlvo = 0;
    for (var g = 0; g <= MAX_GOLS; g++) {
      alvoTotal[g] = .58 * (somaPoisson[g] / Math.max(somaMistura, 1e-9)) + .42 * emp.totalTaxas[g];
      somaAlvo += alvoTotal[g];
    }
    alvoTotal = alvoTotal.map(function (v) { return v / Math.max(somaAlvo, 1e-9); });
    var totalProb = 0;
    bruto.forEach(function (p) {
      var dentroTotal = p.poisson / Math.max(somaPoisson[p.a + p.b], 1e-9);
      var recalibrada = dentroTotal * alvoTotal[p.a + p.b];
      p.probabilidade = .68 * recalibrada + .32 * p.repeticao;
      totalProb += p.probabilidade;
    });
    bruto.forEach(function (p) {
      p.probabilidade /= Math.max(totalProb, 1e-9);
      p.odd = oddPlacar(futuro.odds || {}, p.a, p.b);
      p.oddJusta = 1 / Math.max(p.probabilidade, 1e-9);
      p.ev = p.odd ? p.probabilidade * p.odd - 1 : null;
      p.probConservadora = .65 * p.probabilidade + .35 * p.base;
      p.evConservador = p.odd ? p.probConservadora * p.odd - 1 : null;
      p.vantagemBase = p.probabilidade - p.base;
      p.scoreOportunidade = (p.evConservador == null ? p.vantagemBase * 2 : p.evConservador) + p.vantagemBase;
    });
    var porProb = bruto.slice().sort(function (x, y) { return y.probabilidade - x.probabilidade; });
    var comOdd = bruto.filter(function (p) { return p.odd && p.probabilidade >= .015; })
      .sort(function (x, y) { return y.scoreOportunidade - x.scoreOportunidade; });
    var porContexto = bruto.filter(function (p) { return p.probabilidade >= .012; })
      .sort(function (x, y) { return y.scoreOportunidade - x.scoreOportunidade; });
    var oportunidades = selecionarDiversos(comOdd.length ? comOdd : porContexto, 5);
    if (oportunidades.length < 5) {
      selecionarDiversos(porContexto, 8).forEach(function (p) {
        if (oportunidades.length < 5 && !oportunidades.some(function (x) { return x.chave === p.chave; })) oportunidades.push(p);
      });
    }
    var valor = comOdd[0] || porContexto[0];
    var alternativo = porContexto.filter(function (p) { return p.a + p.b >= 3; })[0] || porContexto[0];
    var totaisFinais = [];
    for (var z = 0; z <= MAX_GOLS; z++) totaisFinais[z] = 0;
    bruto.forEach(function (p) { totaisFinais[p.a + p.b] += p.probabilidade; });
    var ordemTotais = totaisFinais.map(function (v, i) { return { gols: i, prob: v }; })
      .sort(function (x, y) { return y.prob - x.prob; });
    var principaisTotais = ordemTotais.slice(0, 2).map(function (x) { return x.gols; }).sort(function (x, y) { return x - y; });
    var esperado = l.casa + l.fora;
    var entrada = !!(valor && valor.odd && valor.evConservador >= .12 && emp.semelhantes >= 30 && valor.probabilidade >= .02);
    return {
      matriz: bruto,
      maisProvaveis: porProb.slice(0, 5),
      melhoresOportunidades: oportunidades,
      melhorValor: valor,
      alternativo: alternativo,
      temOddPlacar: comOdd.length > 0,
      entrada: entrada,
      motivo: entrada ? 'Valor confirmado após correção da faixa de gols e margem conservadora.' :
        (comOdd.length ? 'Sem vantagem conservadora mínima de 12%.' : 'Odd de placar correto não disponível para validar valor.'),
      lambdas: l,
      semelhantes: emp.semelhantes,
      faixaGols: principaisTotais.join('–') + ' gols',
      ritmo: esperado < 2.15 ? 'Baixo' : (esperado < 2.85 ? 'Médio' : 'Alto'),
      maxGols: MAX_GOLS
    };
  }

  return {
    MAX_GOLS: MAX_GOLS, placaresValidos: placaresValidos, poisson: poisson,
    oddPlacar: oddPlacar, analisar: analisar, resolvido: resolvido,
    selecionarDiversos: selecionarDiversos, selecionarMercado: selecionarMercado
  };
});
