(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HackerModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function limitar(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function wilson(p, n) {
    if (!(n > 0)) return 0;
    var z = 1.0; // faixa antecipada de 68%; a confirmação gráfica continua obrigatória
    var den = 1 + z * z / n;
    var centro = p + z * z / (2 * n);
    var margem = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n);
    return limitar((centro - margem) / den, 0, 1);
  }

  function arredondar1(v) { return Math.round(Number(v) * 10) / 10; }

  /* Reconhece a correção H-L-H que a tela identifica como A-B-C. Depois da
     segunda máxima (C), a perda do fundo B confirma que o reteste falhou. */
  function detectarRetesteABC(serie, passoInformado) {
    var s = (Array.isArray(serie) ? serie : []).map(Number)
      .filter(Number.isFinite);
    if (s.length < 16) return { encontrado: false };
    var passo = Math.max(.1, Number(passoInformado) || .1);
    var inicio = Math.max(0, s.length - 80), compacta = [];
    for (var i = inicio; i < s.length; i += 1) {
      var ultimo = compacta[compacta.length - 1];
      if (ultimo && Math.abs(ultimo.v - s[i]) <= passo * .05) ultimo.i = i;
      else compacta.push({ i: i, v: s[i] });
    }
    var ps = [];
    for (var p = 1; p < compacta.length - 1; p += 1) {
      var q = compacta[p];
      var esq = compacta.slice(Math.max(0, p - 2), p);
      var dir = compacta.slice(p + 1, Math.min(compacta.length, p + 3));
      if (esq.concat(dir).every(function (x) { return q.v > x.v; }))
        ps.push({ i: q.i, v: q.v, t: 'H' });
      else if (esq.concat(dir).every(function (x) { return q.v < x.v; }))
        ps.push({ i: q.i, v: q.v, t: 'L' });
    }
    for (var c = ps.length - 1; c >= 2; c -= 1) {
      if (ps[c].t !== 'H' || s.length - 1 - ps[c].i > 18) continue;
      var ondaC = ps[c], ondaB = ps[c - 1], ondaA = ps[c - 2];
      if (ondaB.t !== 'L' || ondaA.t !== 'H') continue;
      var toleranciaTopo = Math.max(.6, passo * 2.2);
      var amplitudeMinima = Math.max(.7, passo * 1.8);
      if (ondaC.v > ondaA.v + toleranciaTopo) continue;
      if (Math.min(ondaA.v, ondaC.v) - ondaB.v < amplitudeMinima) continue;
      var atual = s[s.length - 1];
      var perdeuB = atual < ondaB.v - Math.max(.15, passo * .25);
      var afastouC = ondaC.v - atual >= Math.max(.8, passo * 2);
      var buscaInicio = Math.max(0, ondaA.i - 40);
      var anteriores = s.slice(buscaInicio, ondaA.i + 1);
      var alvo = anteriores.length ? Math.min.apply(null, anteriores) : NaN;
      if (!(Number.isFinite(alvo) && alvo < ondaB.v && alvo < atual)) alvo = NaN;
      return {
        encontrado: true, confirmado: perdeuB && afastouC, perdeuB: perdeuB,
        a: arredondar1(ondaA.v), b: arredondar1(ondaB.v),
        c: arredondar1(ondaC.v), atual: arredondar1(atual),
        alvo: Number.isFinite(alvo) ? arredondar1(alvo) : null,
        topoMaisBaixo: ondaC.v < ondaA.v - passo * .15
      };
    }
    return { encontrado: false };
  }

  /*
   * Localiza dois fundos separados por uma reação real. A série é uma taxa
   * móvel e contém muitos pontos repetidos; por isso comprimimos os patamares
   * antes de procurar as viradas. O segundo fundo pode ficar um pouco acima
   * ou abaixo do primeiro, dentro da tolerância da janela selecionada.
   */
  function detectarFundoDuplo(serie, passoInformado) {
    var s = (Array.isArray(serie) ? serie : []).map(Number)
      .filter(Number.isFinite);
    if (s.length < 14) return { encontrado: false };
    var passo = Math.max(.1, Number(passoInformado) || .1);
    var inicio = Math.max(0, s.length - 120);
    var mudancas = [];
    for (var i = inicio; i < s.length; i += 1) {
      var ultimo = mudancas[mudancas.length - 1];
      if (!ultimo || Math.abs(s[i] - ultimo.v) > passo * .05)
        mudancas.push({ i: i, v: s[i] });
      else ultimo.i = i; // conserva o fim do patamar para medir a separacao
    }
    var fundos = [];
    for (var m = 1; m < mudancas.length - 1; m += 1) {
      if (mudancas[m].v < mudancas[m - 1].v &&
          mudancas[m].v < mudancas[m + 1].v) fundos.push(mudancas[m]);
    }
    if (fundos.length < 2) return { encontrado: false };
    var recorte = s.slice(inicio);
    var amplitude = Math.max.apply(null, recorte) - Math.min.apply(null, recorte);
    var tolerancia = Math.max(.6, passo * 2.2, amplitude * .08);
    var reacaoMinima = Math.max(.8, passo * 2.2, amplitude * .07);
    for (var b = fundos.length - 1; b >= 1; b -= 1) {
      var fundo2 = fundos[b];
      for (var a = b - 1; a >= 0; a -= 1) {
        var fundo1 = fundos[a], separacao = fundo2.i - fundo1.i;
        if (separacao < 5) continue;
        if (separacao > 60) break;
        if (Math.abs(fundo1.v - fundo2.v) > tolerancia) continue;
        var entre = s.slice(fundo1.i, fundo2.i + 1);
        var linha = Math.max.apply(null, entre);
        if (linha - Math.max(fundo1.v, fundo2.v) < reacaoMinima) continue;
        var atual = s[s.length - 1];
        var reagindo = atual >= fundo2.v + Math.max(.3, passo * .8);
        var confirmado = atual >= linha + passo * .10;
        return {
          encontrado: true, reagindo: reagindo, confirmado: confirmado,
          fundo1: arredondar1(fundo1.v), fundo2: arredondar1(fundo2.v),
          linha: arredondar1(linha), atual: arredondar1(atual),
          separacao: separacao
        };
      }
    }
    return { encontrado: false };
  }

  /* Reconhece a subida em escada: ganho real, deslocamento eficiente e
     máximas/fundos ascendentes em três blocos consecutivos. */
  function detectarTendenciaDefinida(serie, passoInformado) {
    var s = (Array.isArray(serie) ? serie : []).map(Number)
      .filter(Number.isFinite);
    if (s.length < 24) return { definida: false };
    var passo = Math.max(.1, Number(passoInformado) || .1);
    var janela = s.slice(-Math.min(72, s.length));
    var tamanho = Math.floor(janela.length / 3);
    var blocos = [janela.slice(0, tamanho), janela.slice(tamanho, tamanho * 2),
      janela.slice(tamanho * 2)];
    var minimos = blocos.map(function (b) { return Math.min.apply(null, b); });
    var maximos = blocos.map(function (b) { return Math.max.apply(null, b); });
    var ganho = janela[janela.length - 1] - janela[0];
    var caminho = 0;
    for (var i = 1; i < janela.length; i += 1)
      caminho += Math.abs(janela[i] - janela[i - 1]);
    var eficiencia = caminho ? Math.abs(ganho) / caminho : 0;
    var tolerancia = Math.max(.2, passo * .6);
    var fundosAscendentes = minimos[1] >= minimos[0] - tolerancia &&
      minimos[2] >= minimos[1] - tolerancia &&
      minimos[2] > minimos[0] + passo;
    var maximasAscendentes = maximos[1] >= maximos[0] - tolerancia &&
      maximos[2] >= maximos[1] - tolerancia &&
      maximos[2] > maximos[0] + passo;
    var definida = ganho >= Math.max(1.2, passo * 4) && eficiencia >= .18 &&
      fundosAscendentes && maximasAscendentes;
    return {
      definida: definida, fundosAscendentes: fundosAscendentes,
      maximasAscendentes: maximasAscendentes, ganho: arredondar1(ganho),
      eficiencia: Math.round(eficiencia * 100), pontos: janela.length
    };
  }

  function quantil(valores, q) {
    if (!valores.length) return NaN;
    var ordenados = valores.slice().sort(function (a, b) { return a - b; });
    var indice = Math.max(0, Math.min(ordenados.length - 1,
      Math.round((ordenados.length - 1) * q)));
    return ordenados[indice];
  }

  /* Aprende as faixas onde as altas realmente começaram no histórico visível.
     Não existe corte universal: 45/50 pode aparecer quando o próprio mercado
     repetir isso, mas cada liga/mercado recebe seus níveis observados. */
  function aprenderLimites(serie, passoInformado) {
    var s = (Array.isArray(serie) ? serie : []).map(Number)
      .filter(Number.isFinite);
    var passo = Math.max(.1, Number(passoInformado) || .1);
    if (s.length < 14) return { pronto: false };
    var niveisComAlta = [];
    for (var i = 0; i <= s.length - 4; i += 1) {
      var projecao = (s[i + 1] - s[i]) * .2 +
        (s[i + 2] - s[i]) * .3 + (s[i + 3] - s[i]) * .5;
      if (projecao >= Math.max(.05, passo * .12)) niveisComAlta.push(s[i]);
    }
    var base = niveisComAlta.length >= 8 ? niveisComAlta : s;
    var ativacao = quantil(base, niveisComAlta.length >= 8 ? .60 : .55);
    var confirmacao = quantil(base, niveisComAlta.length >= 8 ? .85 : .75);
    confirmacao = Math.max(confirmacao, ativacao + passo * 1.5);
    return {
      pronto: true, ativacao: arredondar1(ativacao),
      confirmacao: arredondar1(confirmacao), casos: niveisComAlta.length,
      fonte: niveisComAlta.length >= 8 ? 'movimentos repetidos' : 'distribuição recente'
    };
  }

  function aprender(serie, quantidade) {
    var s = (Array.isArray(serie) ? serie : []).map(Number).filter(Number.isFinite);
    var tamanhos = [3, 4, 6, 8, 12], horizonte = 3, n = s.length;
    var minimo = tamanhos[0] + horizonte + 5;
    if (n < minimo) return { pronto: false, faltam: minimo - n };
    var passo = Math.max(.1, 100 / Math.max(2, Number(quantidade) || 20));
    function distancia(a, b) {
      var soma = 0;
      for (var i = 0; i < a.length; i += 1) {
        var peso = i === a.length - 1 ? .65 : 1;
        soma += Math.pow((a[i] - b[i]) * peso, 2);
      }
      return Math.sqrt(soma / a.length);
    }
    function analisarTamanho(tamanho) {
      if (n < tamanho + horizonte + 2) return null;
      function vetor(fim) {
        var inicio = fim - tamanho + 1, deltas = [];
        for (var i = inicio + 1; i <= fim; i += 1)
          deltas.push((s[i] - s[i - 1]) / passo);
        var local = s.slice(Math.max(0, fim - 19), fim + 1);
        var min = Math.min.apply(null, local), max = Math.max.apply(null, local);
        deltas.push(max > min ? (s[fim] - min) / (max - min) : .5);
        return deltas;
      }
      var atual = vetor(n - 1), candidatos = [];
      var pesoBase = 0, somaBase = 0;
      for (var fim = tamanho - 1; fim <= n - horizonte - 1; fim += 1) {
        var ganhos = [1, 2, 3].map(function (h) { return s[fim + h] - s[fim]; });
        var projecao = ganhos[0] * .2 + ganhos[1] * .3 + ganhos[2] * .5;
        /*
         * A linha e uma taxa movel. Com 240 jogos, a maioria das trocas deixa
         * a porcentagem exatamente igual (sai e entra o mesmo resultado).
         * Tratar estabilidade como fracasso derrubava a base para perto de
         * 25% e tornava o antigo corte absoluto de 54% quase inalcançavel.
         * Pontuacao direcional: alta=1, lateral=0,5 e queda=0.
         */
        var margemLateral = passo * .10;
        var positivos = ganhos.reduce(function (total, g) {
          if (g > margemLateral) return total + 1;
          if (g < -margemLateral) return total;
          return total + .5;
        }, 0) / 3;
        var acordo = ganhos.filter(function (g) { return projecao >= 0 ? g >= 0 : g <= 0; }).length / 3;
        var recencia = .75 + .25 * fim / n;
        candidatos.push({ distancia: distancia(atual, vetor(fim)), projecao: projecao,
          positivos: positivos, acordo: acordo, recencia: recencia });
        pesoBase += recencia;
        somaBase += positivos * recencia;
      }
      candidatos.sort(function (a, b) { return a.distancia - b.distancia; });
      var k = Math.min(18, Math.max(6, Math.round(Math.sqrt(candidatos.length) * 1.7)));
      var vizinhos = candidatos.slice(0, k);
      var sw = 0, sw2 = 0, sucesso = 0, ganho = 0, acordo = 0, similaridade = 0;
      vizinhos.forEach(function (item) {
        var sim = 1 / (1 + item.distancia);
        var peso = sim * sim * item.recencia;
        sw += peso; sw2 += peso * peso;
        sucesso += peso * item.positivos;
        ganho += peso * item.projecao;
        acordo += peso * item.acordo;
        similaridade += sim;
      });
      return {
        tamanho: tamanho,
        taxa: sw ? sucesso / sw : .5,
        base: pesoBase ? somaBase / pesoBase : .5,
        nEfetiva: sw2 ? sw * sw / sw2 : 0,
        similaridade: vizinhos.length ? similaridade / vizinhos.length : 0,
        projecao: sw ? ganho / sw : 0,
        consistencia: sw ? acordo / sw : 0,
        amostra: vizinhos.length
      };
    }
    var modelos = tamanhos.map(analisarTamanho).filter(Boolean);
    var confiabilidades = { 3: .72, 4: .82, 6: .9, 8: .96, 12: 1 };
    var somaPesos = 0, taxa = 0, taxaBase = 0, proj = 0;
    var consistencia = 0, simMedia = 0, nEfetiva = 0, amostra = 0;
    modelos.forEach(function (modelo) {
      var pesoModelo = confiabilidades[modelo.tamanho] * modelo.similaridade *
        Math.min(1, modelo.nEfetiva / 7);
      somaPesos += pesoModelo;
      taxa += modelo.taxa * pesoModelo;
      taxaBase += modelo.base * pesoModelo;
      proj += modelo.projecao * pesoModelo;
      consistencia += modelo.consistencia * pesoModelo;
      simMedia += modelo.similaridade * pesoModelo;
      nEfetiva += modelo.nEfetiva * pesoModelo;
      amostra += modelo.amostra;
    });
    if (somaPesos) {
      taxa /= somaPesos; taxaBase /= somaPesos; proj /= somaPesos;
      consistencia /= somaPesos; simMedia /= somaPesos; nEfetiva /= somaPesos;
    } else {
      taxa = taxaBase = .5;
    }
    var vantagem = taxa - taxaBase;
    var fator = simMedia * Math.min(1, nEfetiva / 7);
    var probAjustada = taxaBase + vantagem * fator;
    var inferior = wilson(taxa, nEfetiva);
    var ultimos = s.slice(-3);
    var impulso = n > 1 ? s[n - 1] - s[n - 2] : 0;
    var deltaAnterior = n > 2 ? s[n - 2] - s[n - 3] : 0;
    var aceleracao = impulso - deltaAnterior;
    var fundoDuplo = detectarFundoDuplo(s, passo);
    var retesteABC = detectarRetesteABC(s, passo);
    var tendenciaDefinida = detectarTendenciaDefinida(s, passo);
    var limitesAdaptativos = aprenderLimites(s, passo);
    return {
      pronto: true,
      confianca: Math.round(limitar(probAjustada, .05, .95) * 100),
      limiteInferior: Math.round(inferior * 100),
      projecao: Math.round(proj * 10) / 10,
      amostra: amostra,
      amostraEfetiva: Math.round(nEfetiva * 10) / 10,
      similaridade: Math.round(simMedia * 100),
      consistencia: Math.round(consistencia * 100),
      taxaBase: Math.round(taxaBase * 100),
      vantagemPadrao: Math.round(vantagem * 1000) / 10,
      janelas: modelos.map(function (m) { return m.tamanho; }).join('/'),
      impulso: Math.round(impulso * 100) / 100,
      aceleracao: Math.round(aceleracao * 100) / 100,
      fundoDuplo: fundoDuplo,
      retesteABC: retesteABC,
      tendenciaDefinida: tendenciaDefinida,
      limitesAdaptativos: limitesAdaptativos,
      fundoRecente: ultimos.length ? s[n - 1] <= Math.min.apply(null, ultimos) + passo * .15 : false,
      validado: nEfetiva >= 5 && vantagem >= .04 && inferior >= taxaBase - .07 &&
        proj >= passo * .08 && consistencia >= .52,
      forte: nEfetiva >= 6 && vantagem >= .07 && inferior >= taxaBase - .04 &&
        proj >= passo * .15 && consistencia >= .55
    };
  }

  function avaliar(leitura, zona, passoMercado, sinaisGrafico) {
    var passo = Math.max(.1, Number(passoMercado) || .1);
    var foraDoTopo = Number(zona.zonaPct) < 78;
    var mediasCoerentes = Number(zona.mm1) >= Number(zona.mm2);
    var rompeuLTB = !!(sinaisGrafico && sinaisGrafico.quebrouLTB);
    var reversaoAntecipada = Number(zona.zonaPct) <= 25 && Number(leitura.impulso) > 0 &&
      Number(leitura.aceleracao) >= 0 && Number(zona.macd) >= -passo * .10;
    var tendenciaConfirmada = rompeuLTB || reversaoAntecipada ||
      (!!zona.subindo && Number(zona.macd) > 0 && mediasCoerentes);
    var projecaoUtil = Number(leitura.projecao) >= Math.max(.1, passo * .20);
    var fundoDuplo = leitura.fundoDuplo || { encontrado: false };
    var atual = Number(zona.atual);
    var ativacao = Number(zona.limiarAtivacao);
    var confirmacao = Number(zona.limiarConfirmacao);
    var amostraEstrutural = Number(leitura.amostraEfetiva) >= 5;
    /* Para a estrutura, importa se os vizinhos projetam continuidade e
       concordam entre os horizontes. A vantagem contra a média pode ficar
       negativa numa tendência longa simplesmente porque toda a base já sobe. */
    var padraoNaoContraria = Number(leitura.projecao) > 0 &&
      Number(leitura.consistencia) >= 52;
    var padraoAceitaPreparacao = Number(leitura.projecao) >= 0 &&
      Number(leitura.consistencia) >= 48;
    var estruturaReagindo = fundoDuplo.encontrado && fundoDuplo.reagindo &&
      amostraEstrutural;
    var tendencia = leitura.tendenciaDefinida || { definida: false };
    var tendenciaEstrutural = tendencia.definida && amostraEstrutural;
    var acimaAtivacao = Number.isFinite(atual) && Number.isFinite(ativacao) &&
      atual >= ativacao;
    var acimaConfirmacao = Number.isFinite(atual) && Number.isFinite(confirmacao) &&
      atual >= confirmacao;
    var retesteABC = leitura.retesteABC || { encontrado: false };
    var ltaFalhou = !!(sinaisGrafico && sinaisGrafico.retesteLTAFalhou);
    var perdeuLTA = !!(sinaisGrafico && sinaisGrafico.rompeuLTA);
    var mediasDeBaixa = Number(zona.mm1) < Number(zona.mm2);
    var macdDeBaixa = Number(zona.macd) < 0;
    var confluenciasBaixa = (retesteABC.encontrado ? 1 : 0) +
      (ltaFalhou ? 1 : 0) + (retesteABC.perdeuB ? 1 : 0) +
      (mediasDeBaixa ? 1 : 0) + (macdDeBaixa ? 1 : 0) +
      (zona.descendo ? 1 : 0);

    /* Risco estrutural tem prioridade sobre a estatística de alta. Ele não é
       tratado como entrada: é um aviso para proteger/aguardar a busca do fundo. */
    if (retesteABC.confirmado && ltaFalhou && confluenciasBaixa >= 4) {
      return { forte: false, alertaRisco: true, antecipado: true,
        classe: 'sem-entrada', sinal: 'ALERTA DE QUEDA',
        confluencias: confluenciasBaixa, totalConfluencias: 6,
        alvo: retesteABC.alvo,
        motivo: 'onda C rejeitou a LTA e perdeu o fundo B em ' + retesteABC.b +
          '%' + (retesteABC.alvo !== null ? '; possível busca de ' + retesteABC.alvo + '%' : '') };
    }
    if (retesteABC.encontrado && ltaFalhou && !retesteABC.perdeuB) {
      return { forte: false, alertaRisco: false, antecipado: true,
        classe: 'atencao', sinal: 'MONITORAR RETESTE',
        confluencias: confluenciasBaixa, totalConfluencias: 6,
        alvo: retesteABC.alvo,
        motivo: 'onda C rejeitou a LTA; confirmar se perder B em ' + retesteABC.b + '%' };
    }
    if (retesteABC.encontrado && perdeuLTA && mediasDeBaixa && macdDeBaixa) {
      return { forte: false, alertaRisco: false, antecipado: true,
        classe: 'atencao', sinal: 'RETESTE EM RISCO',
        confluencias: confluenciasBaixa, totalConfluencias: 6,
        alvo: retesteABC.alvo,
        motivo: 'abaixo da LTA com A-B-C corretivo; aguardar rejeição ou perda de B' };
    }

    if (estruturaReagindo && fundoDuplo.confirmado && acimaConfirmacao &&
        mediasCoerentes && Number(zona.macd) > 0 && padraoNaoContraria) {
      return { forte: true, antecipado: false, classe: 'entrada',
        sinal: 'ENTRADA VALIDADA', motivo: 'fundo duplo confirmado acima de ' +
          arredondar1(confirmacao) + '%' };
    }
    if (estruturaReagindo && (fundoDuplo.confirmado || acimaAtivacao) &&
        padraoAceitaPreparacao) {
      return { forte: false, antecipado: true, alertaOportunidade: true,
        classe: 'atencao', sinal: 'OPORTUNIDADE ANTECIPADA', motivo: fundoDuplo.confirmado
          ? 'fundo duplo rompeu ' + fundoDuplo.linha + '%; aguardando confirmação'
          : 'fundo duplo recuperou ' + arredondar1(ativacao) + '%' };
    }
    if (estruturaReagindo) return { forte: false, antecipado: true,
      classe: 'aguardar', sinal: 'MONITORAR FUNDO DUPLO',
      motivo: 'fundos ' + fundoDuplo.fundo1 + '/' + fundoDuplo.fundo2 +
        '%; aguardar ' + arredondar1(ativacao) + '%' };

    if (tendenciaEstrutural && acimaConfirmacao && mediasCoerentes &&
        Number(zona.macd) > 0 && padraoNaoContraria) {
      return { forte: true, antecipado: false, classe: 'entrada',
        sinal: 'ENTRADA VALIDADA', motivo: 'tendência definida acima de ' +
          arredondar1(confirmacao) + '%' };
    }
    if (tendenciaEstrutural && acimaAtivacao && mediasCoerentes &&
        padraoAceitaPreparacao) {
      return { forte: false, antecipado: true, alertaOportunidade: true,
        classe: 'atencao', sinal: 'OPORTUNIDADE ANTECIPADA', motivo: 'tendência em escada acima de ' +
          arredondar1(ativacao) + '%; alvo ' + arredondar1(confirmacao) + '%' };
    }
    if (tendenciaEstrutural) return { forte: false, antecipado: true,
      classe: 'aguardar', sinal: 'MONITORAR TENDÊNCIA',
      motivo: acimaAtivacao
        ? 'movimento bem definido; aguardando repetição confirmar continuidade'
        : 'movimento bem definido; atual ' + arredondar1(atual) +
          '%, aproximação aprendida ' + arredondar1(ativacao) + '%' };

    if (!foraDoTopo) return { forte: false, antecipado: false, classe: 'sem-entrada',
      sinal: 'SEM ENTRADA', motivo: 'topo de risco' };
    if (leitura.forte && tendenciaConfirmada && projecaoUtil) return { forte: true,
      antecipado: reversaoAntecipada && !rompeuLTB, classe: 'entrada', sinal: 'ENTRADA VALIDADA',
      motivo: reversaoAntecipada && !rompeuLTB ? 'reversão antecipada validada' : 'padrão e gráfico confirmados' };
    if (leitura.validado && projecaoUtil) {
      var confirmacoes = 1; /* o próprio padrão histórico já é uma confirmação */
      if (foraDoTopo) confirmacoes++;
      if (Number(leitura.projecao) > 0) confirmacoes++;
      if (tendenciaConfirmada) confirmacoes++;
      if (mediasCoerentes) confirmacoes++;
      if (Number(zona.macd) > 0 || zona.subindo) confirmacoes++;
      return { forte: false, antecipado: true, alertaOportunidade: confirmacoes >= 3,
        classe: 'atencao', sinal: confirmacoes >= 3 ? 'OPORTUNIDADE ANTECIPADA' : 'PRÉ-SINAL',
        motivo: (tendenciaConfirmada ? 'padrão positivo; confirmação parcial' : 'reação provável') +
          ' · ' + confirmacoes + '/6 confirmações' };
    }
    /* Compara o padrao com a propria taxa-base; mercados diferentes nao
       precisam mais superar o mesmo corte absoluto de 54%. */
    if (Number(leitura.amostraEfetiva) >= 4 &&
        Number(leitura.vantagemPadrao) >= 1.5 &&
        Number(leitura.projecao) > 0) return { forte: false,
      antecipado: false, classe: 'aguardar', sinal: 'MONITORAR', motivo: 'vantagem inicial ainda instável' };
    return { forte: false, antecipado: false, classe: 'sem-entrada', sinal: 'SEM ENTRADA',
      motivo: 'padrões semelhantes não sustentaram alta' };
  }

  return { aprender: aprender, avaliar: avaliar, wilson: wilson,
    detectarFundoDuplo: detectarFundoDuplo,
    detectarRetesteABC: detectarRetesteABC,
    detectarTendenciaDefinida: detectarTendenciaDefinida,
    aprenderLimites: aprenderLimites };
});
