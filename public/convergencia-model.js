(function (root, factory) {
  'use strict';
  var oddModel = typeof module === 'object' && module.exports
    ? require('./filtro-odd-model.js') : root.FiltroOddModel;
  var motor = typeof module === 'object' && module.exports
    ? require('./motor.js') : root.AMD_MOTOR;
  var api = factory(oddModel, motor);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ConvergenciaModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (OddModel, Motor) {
  'use strict';

  var PRIOR_TIME = 8;
  var PRIOR_MINUTO = 6;

  function numero(valor) {
    var n = Number(valor);
    return Number.isFinite(n) ? n : null;
  }

  function texto(valor) { return String(valor || '').trim(); }
  function chave(valor) { return texto(valor).toLocaleLowerCase('pt-BR'); }
  function resolvido(jogo) { return OddModel.resolvido(jogo); }

  function cronologico(lista) {
    return (lista || []).slice().sort(function (a, b) {
      return Date.parse(a.slot_em || a.criado_em || 0) - Date.parse(b.slot_em || b.criado_em || 0);
    });
  }

  function jogosDoTime(lista, time) {
    var alvo = chave(time);
    return cronologico(lista).filter(function (jogo) {
      return resolvido(jogo) && (chave(jogo.time_a) === alvo || chave(jogo.time_b) === alvo);
    }).slice(-40);
  }

  function estatisticaTime(lista, time, mercado, base) {
    var jogos = jogosDoTime(lista, time);
    return estatisticaDosJogos(jogos, time, mercado, base, 'geral');
  }

  function estatisticaDosJogos(jogos, time, mercado, base, posicao) {
    var recentes = jogos.slice(-10);
    var anteriores = jogos.slice(Math.max(0, jogos.length - 20), Math.max(0, jogos.length - 10));
    var pagos = jogos.reduce(function (soma, jogo) {
      return soma + (OddModel.pagou(jogo, mercado) ? 1 : 0);
    }, 0);
    function taxa(fatia) {
      if (!fatia.length) return base;
      return fatia.reduce(function (soma, jogo) {
        return soma + (OddModel.pagou(jogo, mercado) ? 1 : 0);
      }, 0) / fatia.length;
    }
    var atual = taxa(recentes);
    var previa = anteriores.length ? taxa(anteriores) : atual;
    var alvo = chave(time);
    var golsPro = 0, golsContra = 0, marcou = 0, sofreu = 0;
    jogos.forEach(function (jogo) {
      var timeEhCasa = chave(jogo.time_a) === alvo;
      var pro = numero(timeEhCasa ? jogo.gols_a : jogo.gols_b) || 0;
      var contra = numero(timeEhCasa ? jogo.gols_b : jogo.gols_a) || 0;
      golsPro += pro; golsContra += contra;
      marcou += pro > 0 ? 1 : 0; sofreu += contra > 0 ? 1 : 0;
    });
    return {
      time: time,
      posicao: posicao,
      n: jogos.length,
      pagos: pagos,
      ajustada: (pagos + base * PRIOR_TIME) / Math.max(1, jogos.length + PRIOR_TIME),
      mediaMarcados: jogos.length ? golsPro / jogos.length : 0,
      mediaSofridos: jogos.length ? golsContra / jogos.length : 0,
      marcouPct: jogos.length ? marcou / jogos.length : 0,
      sofreuPct: jogos.length ? sofreu / jogos.length : 0,
      recente: atual,
      delta: atual - previa,
      tendencia: jogos.length < 8 ? 'amostra curta' : atual - previa >= .08 ? 'melhorando' :
        atual - previa <= -.08 ? 'piorando' : 'estável'
    };
  }

  function estatisticaPosicao(lista, time, mercado, base, posicao) {
    var alvo = chave(time);
    var jogos = cronologico(lista).filter(function (jogo) {
      if (!resolvido(jogo)) return false;
      return posicao === 'casa' ? chave(jogo.time_a) === alvo : chave(jogo.time_b) === alvo;
    }).slice(-40);
    return estatisticaDosJogos(jogos, time, mercado, base, posicao);
  }

  function mediaLigaGols(lista) {
    var jogos = (lista || []).filter(resolvido);
    if (!jogos.length) return { casa: 1.2, fora: 1.2 };
    var casa = 0, fora = 0;
    jogos.forEach(function (jogo) {
      casa += numero(jogo.gols_a) || 0;
      fora += numero(jogo.gols_b) || 0;
    });
    return { casa: casa / jogos.length, fora: fora / jogos.length };
  }

  function estabilizarMedia(valor, n, referencia) {
    var peso = 6;
    return (valor * n + referencia * peso) / Math.max(1, n + peso);
  }

  function poisson(k, lambda) {
    var fatorial = 1;
    for (var i = 2; i <= k; i += 1) fatorial *= i;
    return Math.exp(-lambda) * Math.pow(lambda, k) / fatorial;
  }

  function probabilidadeMercado(mercado, lambdaCasa, lambdaFora) {
    var lambdaTotal = lambdaCasa + lambdaFora;
    function abaixo(limite) {
      var soma = 0;
      for (var i = 0; i < limite; i += 1) soma += poisson(i, lambdaTotal);
      return limitar(soma, 0, 1);
    }
    if (mercado === 'ambas') return (1 - Math.exp(-lambdaCasa)) * (1 - Math.exp(-lambdaFora));
    if (mercado === 'ambasnao') return 1 - (1 - Math.exp(-lambdaCasa)) * (1 - Math.exp(-lambdaFora));
    if (mercado === 'over05') return 1 - abaixo(1);
    if (mercado === 'over15') return 1 - abaixo(2);
    if (mercado === 'over25') return 1 - abaixo(3);
    if (mercado === 'over35') return 1 - abaixo(4);
    if (mercado === 'cincomais') return 1 - abaixo(5);
    if (mercado === 'under05') return abaixo(1);
    if (mercado === 'under15') return abaixo(2);
    if (mercado === 'under25') return abaixo(3);
    if (mercado === 'under35') return abaixo(4);
    return .5;
  }

  function encaixeComportamental(lista, casa, fora, totalCasa, totalFora, mercado) {
    var liga = mediaLigaGols(lista);
    var ataqueCasa = estabilizarMedia(casa.mediaMarcados, casa.n, liga.casa);
    var defesaCasa = estabilizarMedia(casa.mediaSofridos, casa.n, liga.fora);
    var ataqueFora = estabilizarMedia(fora.mediaMarcados, fora.n, liga.fora);
    var defesaFora = estabilizarMedia(fora.mediaSofridos, fora.n, liga.casa);
    var lambdaCasa = limitar(ataqueCasa * defesaFora / Math.max(.35, liga.casa), .08, 5);
    var lambdaFora = limitar(ataqueFora * defesaCasa / Math.max(.35, liga.fora), .08, 5);
    var probEncaixe = probabilidadeMercado(mercado, lambdaCasa, lambdaFora);
    var probCombinada = .30 * casa.ajustada + .30 * fora.ajustada +
      .20 * probEncaixe + .10 * totalCasa.ajustada + .10 * totalFora.ajustada;
    return {
      lambdaCasa: lambdaCasa,
      lambdaFora: lambdaFora,
      golsEsperados: lambdaCasa + lambdaFora,
      probMercado: probEncaixe,
      probCombinada: probCombinada,
      ataqueCasa: ataqueCasa,
      defesaCasa: defesaCasa,
      ataqueFora: ataqueFora,
      defesaFora: defesaFora
    };
  }

  function analiseGrafica(lista, mercado) {
    var jogos = cronologico(lista).filter(resolvido);
    var janela = Math.max(5, Math.min(20, Math.floor(jogos.length / 2)));
    var serie = [];
    if (!Motor || jogos.length < janela) {
      return { ok: false, suficiente: false, serie: [], zona: '—', zonaPct: 0,
        direcao: '—', macd: 0, mmRapida: 0, mmLenta: 0, rompimento: null,
        topoRisco: false, motivo: 'Gráfico com pouca amostra' };
    }
    for (var i = janela; i <= jogos.length; i += 1) {
      var bloco = jogos.slice(i - janela, i);
      var pagos = bloco.reduce(function (soma, item) {
        return soma + (OddModel.pagou(item, mercado) ? 1 : 0);
      }, 0);
      serie.push(Math.round(pagos / bloco.length * 1000) / 10);
    }
    var zona = Motor.zoneSignal(serie);
    var linhas = null;
    try { linhas = Motor.trendLines(serie); } catch (_) { linhas = null; }
    var hist = Motor.macdData(serie).hist;
    var macd = hist.length ? hist[hist.length - 1] : 0;
    var macdAnterior = hist.length > 3 ? hist[hist.length - 4] : macd;
    var atual = serie.length ? serie[serie.length - 1] : 0;
    var anterior = serie.length > 1 ? serie[serie.length - 2] : atual;
    var rompeuLtb = !!(linhas && linhas.rompimento && linhas.rompimento.tipo === 'ROMPEU_LTB_CIMA');
    var topoRisco = zona.zonaPct >= 78;
    var mediasCoerentes = zona.mm1 >= zona.mm2 && macd >= macdAnterior;
    var continuidade = atual >= anterior && macd > 0 && mediasCoerentes;
    var reversao = zona.zonaPct <= 45 && atual > anterior && macd >= macdAnterior;
    var suficiente = serie.length >= 8;
    var ok = suficiente && !topoRisco && (rompeuLtb || continuidade || reversao);
    var motivo = topoRisco ? 'Gráfico em topo arriscado' : !suficiente ? 'Gráfico com pouca amostra' :
      rompeuLtb ? 'Quebra de LTB confirmada' : continuidade ? 'Continuação confirmada pelas médias e MACD' :
        reversao ? 'Reversão confirmada no fundo' : 'Gráfico ainda sem confirmação';
    return { ok: ok, suficiente: suficiente, serie: serie, zona: zona.zona,
      zonaPct: zona.zonaPct, direcao: zona.direcao, macd: macd,
      mmRapida: zona.mm1, mmLenta: zona.mm2, rompimento: rompeuLtb ? 'LTB' : null,
      topoRisco: topoRisco, motivo: motivo };
  }

  function estatisticaMinuto(lista, minuto, mercado, base) {
    var alvo = numero(minuto);
    var jogos = (lista || []).filter(function (jogo) {
      return resolvido(jogo) && numero(jogo.minuto) === alvo;
    }).slice(-40);
    var pagos = jogos.reduce(function (soma, jogo) {
      return soma + (OddModel.pagou(jogo, mercado) ? 1 : 0);
    }, 0);
    return {
      minuto: alvo,
      n: jogos.length,
      pagos: pagos,
      taxa: jogos.length ? pagos / jogos.length : base,
      ajustada: (pagos + base * PRIOR_MINUTO) / Math.max(1, jogos.length + PRIOR_MINUTO)
    };
  }

  function limitar(valor, minimo, maximo) { return Math.max(minimo, Math.min(maximo, valor)); }

  function analisarJogo(lista, jogo, mercado) {
    var base = OddModel.taxaBase(lista, mercado);
    var casa = estatisticaPosicao(lista, jogo.time_a, mercado, base, 'casa');
    var fora = estatisticaPosicao(lista, jogo.time_b, mercado, base, 'fora');
    var totalCasa = estatisticaTime(lista, jogo.time_a, mercado, base);
    var totalFora = estatisticaTime(lista, jogo.time_b, mercado, base);
    var comportamento = encaixeComportamental(lista, casa, fora, totalCasa, totalFora, mercado);
    var coluna = estatisticaMinuto(lista, jogo.minuto, mercado, base);
    var grafico = analiseGrafica(lista, mercado);
    var odd = OddModel.odd(jogo, mercado);
    var valor = OddModel.analisar(lista, mercado, odd);
    var mediaTimes = comportamento.probCombinada;
    var amostra = Math.min(casa.n, fora.n);
    var amostraTotal = Math.min(totalCasa.n, totalFora.n);
    var amostraSuficiente = amostra >= 5 || (amostra >= 3 && amostraTotal >= 8);
    var amostraParcial = amostra >= 2 && amostraTotal >= 5;

    var timesSinal = amostraParcial && comportamento.probMercado >= base - .05 && mediaTimes >= base;
    var timesOk = amostraSuficiente && comportamento.probMercado >= base - .03 && mediaTimes >= base + .02 &&
      !(casa.tendencia === 'piorando' && fora.tendencia === 'piorando');
    var colunaOk = coluna.n >= 5 && coluna.ajustada >= base;
    var colunaSinal = coluna.n >= 3 && coluna.ajustada >= base - .02;
    var graficoOk = grafico.ok;
    var graficoSinal = graficoOk || (grafico.suficiente && !grafico.topoRisco);
    var oddOk = valor.status === 'VALOR CONFIRMADO';
    var oddPendente = valor.status === 'SEM ODD';
    var oddSinal = !!odd && valor.ev != null && valor.ev > 0;

    var pontosTimes = amostraParcial ? limitar(12 + (mediaTimes - base) * 120, 0, 30) : 0;
    var pontosColuna = coluna.n < 3 ? 0 : limitar(6 + (coluna.ajustada - base) * 80, 0, 15);
    var pontosGrafico = graficoOk ? 20 : grafico.suficiente && !grafico.topoRisco ? 10 : grafico.topoRisco ? 3 : 0;
    var pontosOdd = oddOk ? 25 : valor.status === 'OBSERVAR' ? 17 : oddSinal ? 10 : 0;
    var pontosAmostra = limitar(amostra * 1.5 + amostraTotal * .2, 0, 10);
    var confianca = Math.round(pontosTimes + pontosColuna + pontosGrafico + pontosOdd + pontosAmostra);

    var bloqueios = [];
    if (!amostraParcial) bloqueios.push('Histórico do confronto ainda insuficiente');
    else if (!amostraSuficiente) bloqueios.push('Amostra posicional curta; usando o total apenas para observação');
    if (amostraSuficiente && !timesOk) bloqueios.push('Comportamento casa/fora e ataque × defesa não convergiu');
    if (coluna.n < 3) bloqueios.push('Coluna com pouca amostra');
    else if (!colunaOk) bloqueios.push('Coluna abaixo da média da liga');
    if (!graficoOk) bloqueios.push(grafico.motivo);
    if (oddPendente) bloqueios.push('Odd ainda não disponível');
    else if (!oddOk) bloqueios.push(valor.status === 'OBSERVAR' ? 'Odd positiva, mas sem margem segura' : 'Odd sem valor conservador');

    var evidencias = [timesSinal, colunaSinal, graficoSinal, oddSinal].filter(Boolean).length;
    var apoioTecnico = graficoOk || (colunaOk && grafico.suficiente && !grafico.topoRisco);
    var riscoGrave = !amostraSuficiente || oddPendente || valor.evSeguro == null ||
      valor.evSeguro < .03 || grafico.topoRisco;
    var status = !riscoGrave && timesOk && apoioTecnico && oddOk && confianca >= 68
      ? 'CONFIRMADO'
      : (amostraParcial && confianca >= 40 && evidencias >= 2 && !(!oddPendente && valor.evSeguro < -.20)
        ? 'OBSERVANDO' : 'DESCARTADO');

    var estagios = [
      { id: 'times', nome: 'Comportamento confirmou', ok: timesOk,
        detalhe: Math.round(mediaTimes * 1000) / 10 + '% · gols ' + comportamento.golsEsperados.toFixed(2) },
      { id: 'coluna', nome: 'Coluna confirmou', ok: colunaOk, detalhe: coluna.n + ' jogos' },
      { id: 'grafico', nome: 'Gráfico confirmou', ok: graficoOk,
        detalhe: grafico.zona + ' · MACD ' + grafico.macd.toFixed(2) },
      { id: 'odd', nome: 'Odd ofereceu valor', ok: oddOk, pendente: oddPendente,
        detalhe: odd ? odd.toFixed(2) : 'aguardando' },
      { id: 'liberacao', nome: 'Leitura liberada', ok: status === 'CONFIRMADO', detalhe: confianca + '/100' }
    ];

    return {
      jogo: jogo,
      mercado: mercado,
      status: status,
      confianca: confianca,
      base: base,
      casa: casa,
      fora: fora,
      totalCasa: totalCasa,
      totalFora: totalFora,
      comportamento: comportamento,
      probTimes: mediaTimes,
      coluna: coluna,
      grafico: grafico,
      odd: odd,
      valor: valor,
      timesOk: timesOk,
      colunaOk: colunaOk,
      graficoOk: graficoOk,
      tendenciaOk: graficoOk,
      oddOk: oddOk,
      evidencias: evidencias,
      amostraSuficiente: amostraSuficiente,
      riscoGrave: riscoGrave,
      bloqueios: bloqueios,
      estagios: estagios
    };
  }

  function futuros(lista) {
    var vistos = Object.create(null);
    var ultimoResolvido = (lista || []).filter(resolvido).reduce(function (maior, jogo) {
      var instante = Date.parse(jogo.slot_em || jogo.criado_em || 0);
      return Number.isFinite(instante) && instante > maior ? instante : maior;
    }, 0);
    return (lista || []).filter(function (jogo) {
      if (resolvido(jogo) || !texto(jogo.time_a) || !texto(jogo.time_b)) return false;
      var instante = Date.parse(jogo.slot_em || jogo.criado_em || 0);
      var vistoEm = Date.parse(jogo.visto_em || '');
      /* Na grade virtual o slot pode atravessar a virada do relógio e ficar
         numericamente anterior ao último FT. Se o coletor acabou de ver o
         cartão, ele é um futuro válido; o slot antigo só é usado como fallback
         para registros sem visto_em (fixtures e dados legados). */
      if (Number.isFinite(vistoEm)) {
        if (Date.now() - vistoEm >= 25 * 60 * 1000) return false;
      } else if (ultimoResolvido && Number.isFinite(instante) && instante <= ultimoResolvido) {
        return false;
      }
      var id = [jogo.slot_em || jogo.criado_em || jogo.horario, jogo.time_a, jogo.time_b].join('|');
      if (vistos[id]) return false;
      vistos[id] = true;
      return true;
    }).sort(function (a, b) {
      return Date.parse(a.slot_em || a.criado_em || 0) - Date.parse(b.slot_em || b.criado_em || 0);
    }).slice(0, 6);
  }

  function analisar(lista, mercado) {
    var ordem = { CONFIRMADO: 3, OBSERVANDO: 2, DESCARTADO: 1 };
    return futuros(lista).map(function (jogo) { return analisarJogo(lista, jogo, mercado); })
      .sort(function (a, b) {
        return ordem[b.status] - ordem[a.status] || b.confianca - a.confianca;
      });
  }

  return {
    analisar: analisar,
    analisarJogo: analisarJogo,
    estatisticaTime: estatisticaTime,
    estatisticaPosicao: estatisticaPosicao,
    encaixeComportamental: encaixeComportamental,
    estatisticaMinuto: estatisticaMinuto,
    analiseGrafica: analiseGrafica,
    futuros: futuros
  };
});
