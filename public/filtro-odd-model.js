(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FiltroOddModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MERCADOS = [
    { id: 'over05', nome: 'Over 0.5', odd: 'odd_over_0.5' },
    { id: 'over15', nome: 'Over 1.5', odd: 'odd_over_1.5' },
    { id: 'over25', nome: 'Over 2.5', odd: 'odd_over_2.5' },
    { id: 'over35', nome: 'Over 3.5', odd: 'odd_over_3.5' },
    { id: 'cincomais', nome: '5+ Gols', odd: 'odd_total_gols_extatos_5' },
    { id: 'ambas', nome: 'Ambas Marcam (Sim)', odd: 'odd_ambas_sim' },
    { id: 'ambasnao', nome: 'Ambas Marcam (Não)', odd: 'odd_ambas_nao' },
    { id: 'under05', nome: 'Under 0.5', odd: 'odd_under_0.5' },
    { id: 'under15', nome: 'Under 1.5', odd: 'odd_under_1.5' },
    { id: 'under25', nome: 'Under 2.5', odd: 'odd_under_2.5' },
    { id: 'under35', nome: 'Under 3.5', odd: 'odd_under_3.5' }
  ];
  var PRIOR = 12;
  var Z90 = 1.645;
  var BASES_GERAIS = { over05: .90, over15: .70, over25: .45, over35: .28,
    cincomais: .13, ambas: .48, ambasnao: .52, under05: .10, under15: .30,
    under25: .55, under35: .72 };

  function numero(v) { var n = Number(v); return Number.isFinite(n) ? n : null; }
  function mercado(id) { return MERCADOS.find(function (m) { return m.id === id; }) || MERCADOS[2]; }
  function resolvido(j) {
    return !!(j && j.resultado_ft != null && j.resultado_ft !== '' &&
      numero(j.gols_a) != null && numero(j.gols_b) != null);
  }
  function pagou(j, id) {
    if (!resolvido(j)) return false;
    var a = numero(j.gols_a), b = numero(j.gols_b), total = a + b;
    if (id === 'over05') return total >= 1;
    if (id === 'over15') return total >= 2;
    if (id === 'over25') return total >= 3;
    if (id === 'over35') return total >= 4;
    if (id === 'cincomais') return total >= 5;
    if (id === 'ambas') return a > 0 && b > 0;
    if (id === 'ambasnao') return !(a > 0 && b > 0);
    if (id === 'under05') return total < 1;
    if (id === 'under15') return total < 2;
    if (id === 'under25') return total < 3;
    if (id === 'under35') return total < 4;
    return false;
  }
  function odd(j, id) {
    var n = numero(j && j.odds && j.odds[mercado(id).odd]);
    return n != null && n > 1 ? n : null;
  }
  function taxaBase(lista, id) {
    var validos = (lista || []).filter(resolvido);
    var geral = BASES_GERAIS[id] == null ? .5 : BASES_GERAIS[id];
    var pagos = validos.reduce(function (s, j) { return s + (pagou(j, id) ? 1 : 0); }, 0);
    /* A própria média da liga também é estabilizada. Assim, 2/2 não cria base de 100%. */
    return (pagos + geral * 20) / (validos.length + 20);
  }
  function pesoSimilar(valor, alvo) {
    if (!(valor > 1) || !(alvo > 1)) return 0;
    /* Distância percentual simétrica. Aproximadamente ±12% ainda contribui pouco. */
    var d = Math.log(valor / alvo);
    var largura = 0.075;
    return Math.exp(-0.5 * Math.pow(d / largura, 2));
  }
  function intervaloConservador(p, n) {
    n = Math.max(1, n);
    var den = 1 + (Z90 * Z90 / n);
    var centro = p + (Z90 * Z90 / (2 * n));
    var margem = Z90 * Math.sqrt((p * (1 - p) / n) + (Z90 * Z90 / (4 * n * n)));
    return Math.max(0, (centro - margem) / den);
  }
  function tendencia(itens) {
    if (itens.length < 10) return { nome: 'amostra curta', delta: 0 };
    var recentes = itens.slice(-5), anteriores = itens.slice(-10, -5);
    function media(a) {
      var sw = 0, sy = 0;
      a.forEach(function (x) { sw += x.peso; sy += x.peso * x.pago; });
      return sw ? sy / sw : 0;
    }
    var d = media(recentes) - media(anteriores);
    return { nome: d >= .12 ? 'melhorando' : d <= -.12 ? 'piorando' : 'estável', delta: d };
  }
  function analisar(lista, id, oddAlvo) {
    var base = taxaBase(lista, id);
    var itens = (lista || []).filter(function (j) { return resolvido(j) && odd(j, id); })
      .map(function (j) {
        return { jogo: j, odd: odd(j, id), peso: pesoSimilar(odd(j, id), oddAlvo), pago: pagou(j, id) ? 1 : 0 };
      }).filter(function (x) { return x.peso >= .05; });
    var sw = 0, sw2 = 0, sy = 0;
    itens.forEach(function (x) { sw += x.peso; sw2 += x.peso * x.peso; sy += x.peso * x.pago; });
    var nEfetiva = sw2 ? (sw * sw / sw2) : 0;
    var prob = (sy + PRIOR * base) / Math.max(1, sw + PRIOR);
    var nConservador = nEfetiva + PRIOR;
    var inferior = intervaloConservador(prob, nConservador);
    var temOdd = oddAlvo > 1;
    var ev = temOdd ? prob * oddAlvo - 1 : null;
    var evSeguro = temOdd ? inferior * oddAlvo - 1 : null;
    var t = tendencia(itens);
    var status = 'SEM VALOR';
    if (!oddAlvo) status = 'SEM ODD';
    else if (nEfetiva < 8) status = 'AMOSTRA FRACA';
    else if (nEfetiva >= 12 && evSeguro >= .03 && t.nome !== 'piorando') status = 'VALOR CONFIRMADO';
    else if (ev > 0) status = 'OBSERVAR';
    return {
      status: status, base: base, encontrados: itens.length, nEfetiva: nEfetiva,
      greensPonderados: sy, prob: prob, inferior: inferior,
      oddJusta: prob > 0 ? 1 / prob : null, ev: ev, evSeguro: evSeguro,
      tendencia: t.nome, delta: t.delta,
      faixaMin: temOdd ? oddAlvo * .88 : null, faixaMax: temOdd ? oddAlvo * 1.12 : null
    };
  }
  function futuros(lista) {
    var ultimoResolvido = (lista || []).filter(resolvido).reduce(function (maior, j) {
      var t = Date.parse(j.slot_em || j.criado_em || 0);
      return Number.isFinite(t) && t > maior ? t : maior;
    }, 0);
    return (lista || []).filter(function (j) {
      if (resolvido(j) || !String(j.time_a || '').trim() || !String(j.time_b || '').trim()) return false;
      var t = Date.parse(j.slot_em || j.criado_em || 0);
      return !ultimoResolvido || !Number.isFinite(t) || t > ultimoResolvido;
    }).sort(function (a, b) {
      return Date.parse(a.slot_em || a.criado_em || 0) - Date.parse(b.slot_em || b.criado_em || 0);
    });
  }
  function cronologico(lista, id) {
    return (lista || []).filter(function (j) { return resolvido(j) && odd(j, id); })
      .slice().sort(function (a, b) {
        return Date.parse(a.slot_em || a.criado_em || 0) - Date.parse(b.slot_em || b.criado_em || 0);
      });
  }
  function faixaOdd(valor) { return Math.round(valor * 10) / 10; }
  function peDeGalinha(lista, id) {
    var jogos = cronologico(lista, id), grupos = Object.create(null);
    for (var i = 1; i < jogos.length - 1; i++) {
      var centro = faixaOdd(odd(jogos[i], id));
      var chave = centro.toFixed(1);
      if (!grupos[chave]) grupos[chave] = {
        odd: centro, n: 0, antes: 0, nela: 0, depois: 0, algum: 0,
        ultimos: []
      };
      var g = grupos[chave];
      var antes = pagou(jogos[i - 1], id);
      var nela = pagou(jogos[i], id);
      var depois = pagou(jogos[i + 1], id);
      g.n++;
      g.antes += antes ? 1 : 0;
      g.nela += nela ? 1 : 0;
      g.depois += depois ? 1 : 0;
      /* Mede se a aparição desta odd puxou pagamento em algum ponto da janela:
         jogo anterior, jogo da própria odd ou jogo seguinte. */
      g.algum += antes || nela || depois ? 1 : 0;
      g.ultimos.push([antes, nela, depois]);
    }
    return Object.keys(grupos).map(function (chave) {
      var g = grupos[chave];
      g.taxaAntes = g.antes / g.n;
      g.taxaNela = g.nela / g.n;
      g.taxaDepois = g.depois / g.n;
      g.taxaAlgum = g.algum / g.n;
      g.media = (g.taxaAntes + g.taxaNela + g.taxaDepois) / 3;
      g.ultimos = g.ultimos.slice(-5);
      g.status = g.n < 8 ? 'AMOSTRA FRACA'
        : g.taxaAlgum >= .70 ? 'PÉ FORTE'
        : g.taxaAlgum >= .50 ? 'OBSERVAR' : 'SEM PADRÃO';
      return g;
    }).sort(function (a, b) {
      var amostraA = a.n >= 8 ? 1 : 0, amostraB = b.n >= 8 ? 1 : 0;
      return amostraB - amostraA || b.taxaAlgum - a.taxaAlgum || b.media - a.media || b.n - a.n;
    }).slice(0, 20);
  }
  function rankingSequencias(lista, id, tamanho) {
    tamanho = Math.max(1, Math.min(3, Number(tamanho) || 1));
    var jogos = cronologico(lista, id), base = taxaBase(jogos, id), grupos = Object.create(null);
    for (var i = 0; i <= jogos.length - tamanho; i++) {
      var trecho = jogos.slice(i, i + tamanho);
      var faixas = trecho.map(function (j) { return faixaOdd(odd(j, id)); });
      var chave = faixas.map(function (o) { return o.toFixed(1); }).join(' → ');
      if (!grupos[chave]) grupos[chave] = { padrao: chave, faixas: faixas, n: 0,
        todosGreens: 0, greens: 0, totalJogos: 0, produtos: 0, resultados: [] };
      var g = grupos[chave], todos = trecho.every(function (j) { return pagou(j, id); });
      g.n++; g.todosGreens += todos ? 1 : 0; g.produtos += trecho.reduce(function (s, j) { return s * odd(j, id); }, 1);
      trecho.forEach(function (j) { g.totalJogos++; if (pagou(j, id)) g.greens++; });
      g.resultados.push(todos ? 1 : 0);
    }
    return Object.keys(grupos).map(function (k) {
      var g = grupos[k], baseConjunto = Math.pow(base, tamanho), prior = 8;
      g.taxaTodos = g.todosGreens / g.n; g.taxaJogos = g.greens / g.totalJogos;
      /* Janelas consecutivas se sobrepõem. Divide a força da amostra pelo tamanho
         para não fingir que três sequências sobrepostas são três provas independentes. */
      g.nEfetiva = g.n / tamanho;
      g.prob = (g.taxaTodos * g.nEfetiva + prior * baseConjunto) / (g.nEfetiva + prior);
      g.inferior = intervaloConservador(g.prob, g.nEfetiva + prior);
      g.oddCombinada = g.produtos / g.n; g.ev = g.prob * g.oddCombinada - 1;
      g.evSeguro = g.inferior * g.oddCombinada - 1;
      g.ultimos = g.resultados.slice(-5);
      var recentes = g.ultimos.reduce(function (s, x) { return s + x; }, 0) / g.ultimos.length;
      var anteriores = g.resultados.slice(Math.max(0, g.resultados.length - 10), Math.max(0, g.resultados.length - 5));
      var taxaAnterior = anteriores.length ? anteriores.reduce(function (s, x) { return s + x; }, 0) / anteriores.length : g.taxaTodos;
      g.delta = recentes - taxaAnterior;
      g.tendencia = g.n < 5 ? 'amostra curta' : g.delta >= .15 ? 'melhorando' : g.delta <= -.15 ? 'piorando' : 'estável';
      g.status = g.nEfetiva < 5 ? 'AMOSTRA FRACA' : g.nEfetiva >= 10 && g.evSeguro >= .03 && g.tendencia !== 'piorando' ? 'VALOR CONFIRMADO' : g.ev > 0 ? 'OBSERVAR' : 'SEM VALOR';
      return g;
    }).sort(function (a, b) {
      var elegivelA = a.n >= 5 ? 1 : 0, elegivelB = b.n >= 5 ? 1 : 0;
      return elegivelB - elegivelA || b.evSeguro - a.evSeguro || b.n - a.n;
    }).slice(0, 20);
  }
  function analisarReversao(lista, id, oddAlvo) {
    var jogos = cronologico(lista, id), reds = 0, oddsReds = [];
    for (var i = jogos.length - 1; i >= 0; i--) {
      if (pagou(jogos[i], id)) break;
      reds++; oddsReds.unshift(odd(jogos[i], id));
    }
    var baseAtual = taxaBase(jogos, id);
    if (!reds) return { reds: 0, oddsReds: [], faixa: 'sem Reds', n: 0, pagos: 0,
      taxa: 0, prob: baseAtual, inferior: intervaloConservador(baseAtual, PRIOR),
      base: baseAtual, uplift: 0, status: 'SEM REDS ATUAIS' };
    var minimo = reds >= 5 ? 5 : reds >= 3 ? 3 : reds >= 1 ? 1 : 0;
    var maximo = reds >= 5 ? Infinity : reds >= 3 ? 4 : reds >= 1 ? 2 : 0;
    var contextos = [], sequenciaAnterior = 0;
    for (var x = 0; x < jogos.length; x++) {
      var candidato = jogos[x];
      if (sequenciaAnterior >= minimo && sequenciaAnterior <= maximo && pesoSimilar(odd(candidato, id), oddAlvo) >= .15) {
        contextos.push(pagou(candidato, id) ? 1 : 0);
      }
      sequenciaAnterior = pagou(candidato, id) ? 0 : sequenciaAnterior + 1;
    }
    var base = baseAtual, pagos = contextos.reduce(function (s, y) { return s + y; }, 0), prior = 10;
    var prob = (pagos + prior * base) / (contextos.length + prior);
    var inferior = intervaloConservador(prob, contextos.length + prior), uplift = prob - base;
    var comprovada = reds > 0 && contextos.length >= 12 && inferior > base + .02;
    return { reds: reds, oddsReds: oddsReds.slice(-8), faixa: minimo === 0 ? 'sem Reds' : minimo === 5 ? '5+ Reds' : minimo + '–' + maximo + ' Reds',
      n: contextos.length, pagos: pagos, taxa: contextos.length ? pagos / contextos.length : 0,
      prob: prob, inferior: inferior, base: base, uplift: uplift,
      status: comprovada ? 'REVERSÃO COMPROVADA' : contextos.length < 8 ? 'AMOSTRA FRACA' : uplift > .03 ? 'SINAL DE REVERSÃO' : 'SEM VANTAGEM COMPROVADA' };
  }
  function analisarFuturos(lista, id) {
    var vistos = Object.create(null);
    return futuros(lista).filter(function (j) {
      var chave = [j.slot_em || j.horario, j.time_a, j.time_b].join('|');
      if (vistos[chave]) return false;
      vistos[chave] = true;
      return true;
    }).slice(0, 6).map(function (j) {
      return { jogo: j, odd: odd(j, id), analise: analisar(lista, id, odd(j, id)) };
    });
  }
  function sequencias(lista, id, tamanho) {
    tamanho = Math.max(1, Math.min(3, Number(tamanho) || 1));
    var alvos = analisarFuturos(lista, id).filter(function (x) { return x.odd > 1; }).slice(0, tamanho);
    if (alvos.length < tamanho) return null;
    if (tamanho === 1) return { alvos: alvos, analise: alvos[0].analise };
    var historico = (lista || []).filter(function (j) { return resolvido(j) && odd(j, id); });
    var baseUnica = taxaBase(historico, id);
    var base = Math.pow(baseUnica, tamanho);
    var sw = 0, sw2 = 0, sy = 0, encontrados = 0;
    for (var i = 0; i <= historico.length - tamanho; i++) {
      var peso = 1, todos = 1;
      for (var k = 0; k < tamanho; k++) {
        peso *= pesoSimilar(odd(historico[i + k], id), alvos[k].odd);
        if (!pagou(historico[i + k], id)) todos = 0;
      }
      peso = Math.pow(peso, 1 / tamanho);
      if (peso < .05) continue;
      encontrados++; sw += peso; sw2 += peso * peso; sy += peso * todos;
    }
    var ne = sw2 ? sw * sw / sw2 : 0;
    var prob = (sy + PRIOR * base) / Math.max(1, sw + PRIOR);
    var oddCombinada = alvos.reduce(function (s, x) { return s * x.odd; }, 1);
    var inferior = intervaloConservador(prob, ne + PRIOR);
    var ev = prob * oddCombinada - 1, evSeguro = inferior * oddCombinada - 1;
    var status = ne < 8 ? 'AMOSTRA FRACA' : ne >= 12 && evSeguro >= .03 ? 'VALOR CONFIRMADO' : ev > 0 ? 'OBSERVAR' : 'SEM VALOR';
    return { alvos: alvos, analise: { status: status, base: base, encontrados: encontrados,
      nEfetiva: ne, prob: prob, inferior: inferior, oddJusta: prob ? 1 / prob : null,
      ev: ev, evSeguro: evSeguro, tendencia: 'sequência conjunta', delta: 0,
      faixaMin: null, faixaMax: null }, oddCombinada: oddCombinada };
  }

  return { MERCADOS: MERCADOS, resolvido: resolvido, pagou: pagou, odd: odd,
    taxaBase: taxaBase, pesoSimilar: pesoSimilar, analisar: analisar,
    analisarFuturos: analisarFuturos, sequencias: sequencias,
    rankingSequencias: rankingSequencias, analisarReversao: analisarReversao,
    peDeGalinha: peDeGalinha };
});
