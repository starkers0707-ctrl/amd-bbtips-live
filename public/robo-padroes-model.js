(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RoboPadroesModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MERCADOS_SUPORTADOS = [
    'Over 2.5',
    'Over 3.5',
    '5+ Gols',
    'Ambas Marcam (Sim)',
    'Ambas Marcam (Não)',
    'Under 1.5',
    'Under 0.5'
  ];

  function normalizarMercado(nome) {
    return String(nome || '').toLowerCase().replace(/á/g, 'a').replace(/ã/g, 'a')
      .replace(/â/g, 'a').replace(/é/g, 'e').replace(/ê/g, 'e')
      .replace(/í/g, 'i').replace(/ó/g, 'o').replace(/ô/g, 'o')
      .replace(/ú/g, 'u').replace(/ç/g, 'c').replace(/\s+/g, ' ').trim();
  }

  function regraMercado(nome) {
    var mercado = normalizarMercado(nome);
    if (mercado.indexOf('over 3.5') >= 0)
      return { suportado: true, limiar: 0.55, grupo: 'raro' };
    if (mercado.indexOf('5+ gols') >= 0)
      return { suportado: true, limiar: 0.50, grupo: 'raro' };
    if (mercado.indexOf('ambas sim') >= 0 || mercado.indexOf('ambas nao') >= 0 ||
        mercado.indexOf('ambas marcam (sim)') >= 0 ||
        mercado.indexOf('ambas marcam (nao)') >= 0 ||
        mercado.indexOf('over 2.5') >= 0 || mercado.indexOf('under 1.5') >= 0 ||
        mercado.indexOf('under 0.5') >= 0)
      return { suportado: true, limiar: 0.90, grupo: 'alto' };
    return { suportado: false, limiar: 1, grupo: 'fora' };
  }

  function mercadosSuportados() {
    return MERCADOS_SUPORTADOS.slice();
  }

  function cicloPodeSerSubstituido(ciclo) {
    return !ciclo || ciclo.status !== 'EM ANDAMENTO';
  }

  function pontuarCandidato(candidato) {
    if (!candidato || !candidato.analise) return -Infinity;
    var analise = candidato.analise;
    var confirmacoes = Array.isArray(analise.confirmacoes) ? analise.confirmacoes : [];
    var amostra = confirmacoes.reduce(function (menor, item) {
      var n = Number(item.ocorrencias) || 0;
      return menor === null ? n : Math.min(menor, n);
    }, null) || 0;
    /* A margem compara mercados com limites diferentes; quantidade de
       confirmações e a menor amostra desempatem padrões igualmente fortes. */
    return (Number(analise.forca) - Number(analise.limiar)) * 1000 +
      confirmacoes.length * 10 + Math.min(9, Math.log(1 + amostra) * 2);
  }

  function ordenarCandidatos(candidatos) {
    return (Array.isArray(candidatos) ? candidatos.slice() : []).sort(function (a, b) {
      var diferenca = pontuarCandidato(b) - pontuarCandidato(a);
      if (diferenca) return diferenca;
      return Number(b.analise && b.analise.forca) - Number(a.analise && a.analise.forca);
    });
  }

  function chavePadrao(valores) {
    return valores.map(function (v) { return v ? 'G' : 'R'; }).join('');
  }

  function iguais(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
    return true;
  }

  function avaliarPadrao(resultados, padrao) {
    var total = 0, pagaram = 0;
    for (var i = padrao.length; i + 2 < resultados.length; i += 1) {
      if (!iguais(resultados.slice(i - padrao.length, i), padrao)) continue;
      total += 1;
      if (resultados[i] || resultados[i + 1] || resultados[i + 2]) pagaram += 1;
    }
    return {
      padrao: chavePadrao(padrao), tamanho: padrao.length,
      ocorrencias: total, pagaram: pagaram,
      taxa: total ? pagaram / total : 0
    };
  }

  function texto(v) {
    return String(v == null ? '' : v).toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function placar(v) {
    var m = String(v || '').match(/(\d+)\s*[-x]\s*(\d+)/i);
    return m ? parseInt(m[1], 10) + '-' + parseInt(m[2], 10) : '';
  }

  function faixaGols(v) {
    var p = placar(v).split('-').map(Number);
    if (p.length !== 2 || p.some(isNaN)) return '';
    var total = p[0] + p[1];
    return total <= 1 ? '0-1 gol' : total <= 3 ? '2-3 gols' : '4+ gols';
  }

  function chaveJogo(jogo) {
    if (!jogo) return '';
    /* O fornecedor pode criar outro id quando substitui a partida futura pelo
       resultado. Horário + times continuam estáveis durante essa troca. */
    if (jogo.slot != null && (texto(jogo.timeA) || texto(jogo.timeB))) {
      return ['slot:' + String(jogo.slot), texto(jogo.timeA), texto(jogo.timeB)].join('|');
    }
    if (jogo.id != null && String(jogo.id).trim()) return 'id:' + String(jogo.id).trim();
    return '';
  }

  /* Mantém o ciclo de três tiros vivo entre as atualizações da grade. O ciclo
     só termina no primeiro pagamento (GREEN) ou depois de três REDs. */
  function atualizarCiclo(ciclo, jogos, avaliarPagamento) {
    if (!ciclo || !Array.isArray(ciclo.tiros)) return ciclo;
    var lista = Array.isArray(jogos) ? jogos : [];
    var porChave = {};
    lista.forEach(function (jogo) {
      var chave = chaveJogo(jogo);
      if (chave) porChave[chave] = jogo;
      if (jogo && jogo.id != null && String(jogo.id).trim())
        porChave['id:' + String(jogo.id).trim()] = jogo;
    });
    var encontrouGreen = false, todosResolvidos = true, tiroVencedor = null;
    ciclo.tiros.forEach(function (tiro, indice) {
      if (encontrouGreen) {
        if (tiro.status === 'AGUARDANDO') tiro.status = 'CANCELADO';
        return;
      }
      /* chaveJogo(tiro) migra automaticamente ciclos antigos que haviam sido
         salvos pelo id provisório, pois cada tiro também guarda slot e times. */
      var jogo = porChave[chaveJogo(tiro)] || porChave[tiro.chave];
      if (!jogo && (texto(tiro.timeA) || texto(tiro.timeB))) {
        /* Último recurso para fornecedores que também corrigem o timestamp:
           mesmo confronto no mesmo horário/minuto exibido. */
        jogo = lista.filter(function (candidato) {
          return texto(candidato.timeA) === texto(tiro.timeA) &&
            texto(candidato.timeB) === texto(tiro.timeB) &&
            Number(candidato.hora) === Number(tiro.hora) &&
            Number(candidato.minuto) === Number(tiro.minuto);
        }).sort(function (a, b) {
          return Number(b.resolvido) - Number(a.resolvido);
        })[0];
      }
      if (!jogo || !jogo.resolvido) {
        /* Um resultado já confirmado não volta a pendente se a API trocar de
           janela ou omitir temporariamente o jogo numa atualização. */
        if (tiro.status === 'RED') return;
        todosResolvidos = false;
        tiro.status = 'AGUARDANDO';
        return;
      }
      var pagou = typeof avaliarPagamento === 'function'
        ? !!avaliarPagamento(jogo, ciclo.mercado)
        : !!jogo.pago;
      tiro.status = pagou ? 'GREEN' : 'RED';
      tiro.placar = jogo.placar || '';
      if (pagou) {
        encontrouGreen = true;
        tiroVencedor = indice + 1;
      }
    });
    if (encontrouGreen) {
      ciclo.status = 'GREEN'; ciclo.tiroVencedor = tiroVencedor;
      ciclo.concluidoEm = ciclo.concluidoEm || Date.now();
    } else if (todosResolvidos && ciclo.tiros.length === 3) {
      ciclo.status = 'RED'; ciclo.tiroVencedor = null;
      ciclo.concluidoEm = ciclo.concluidoEm || Date.now();
    } else {
      ciclo.status = 'EM ANDAMENTO'; ciclo.tiroVencedor = null;
    }
    ciclo.atualizadoEm = Date.now();
    return ciclo;
  }

  function resultadoEmTres(registros, indice) {
    return !!((registros[indice] && registros[indice].pago) ||
      (registros[indice + 1] && registros[indice + 1].pago) ||
      (registros[indice + 2] && registros[indice + 2].pago));
  }

  function avaliarFamilia(registros, descritor) {
    var total = 0, pagaram = 0;
    for (var i = 4; i + 2 < registros.length; i += 1) {
      if (!descritor.combina(registros, i)) continue;
      total += 1;
      if (resultadoEmTres(registros, i)) pagaram += 1;
    }
    return {
      grupo: descritor.grupo, tipo: descritor.tipo, nome: descritor.nome,
      ocorrencias: total, pagaram: pagaram, taxa: total ? pagaram / total : 0
    };
  }

  function descritores(registros, alvo) {
    var anterior = registros[registros.length - 1] || {};
    var out = [];
    [4, 3, 2].forEach(function (tamanho) {
      var padrao = registros.slice(-tamanho).map(function (r) { return !!r.pago; });
      var chave = chavePadrao(padrao);
      out.push({ grupo: 'fita', tipo: 'contexto', nome: 'Fita ' + chave,
        combina: function (lista, i) {
          return chavePadrao(lista.slice(i - tamanho, i).map(function (r) {
            return !!r.pago;
          })) === chave;
        } });
    });

    if (isFinite(Number(alvo.minuto))) {
      out.push({ grupo: 'posicao', tipo: 'alvo', nome: 'Minuto ' + alvo.minuto,
        combina: function (lista, i) { return Number(lista[i].minuto) === Number(alvo.minuto); } });
    }
    if (isFinite(Number(alvo.coluna))) {
      out.push({ grupo: 'posicao', tipo: 'alvo', nome: 'Coluna ' + (Number(alvo.coluna) + 1),
        combina: function (lista, i) { return Number(lista[i].coluna) === Number(alvo.coluna); } });
    }
    if (isFinite(Number(alvo.odd)) && Number(alvo.odd) > 1) {
      out.push({ grupo: 'odd', tipo: 'alvo', nome: 'Odd ' + Number(alvo.odd).toFixed(2) + ' ±0.15',
        combina: function (lista, i) {
          return isFinite(Number(lista[i].odd)) && Math.abs(Number(lista[i].odd) - Number(alvo.odd)) <= 0.15;
        } });
    }

    var casa = texto(alvo.timeA), fora = texto(alvo.timeB);
    if (casa) {
      out.push({ grupo: 'time', tipo: 'alvo', nome: 'Casa ' + alvo.timeA,
        combina: function (lista, i) { return texto(lista[i].timeA) === casa; } });
      out.push({ grupo: 'time', tipo: 'alvo', nome: 'Time ' + alvo.timeA,
        combina: function (lista, i) {
          return texto(lista[i].timeA) === casa || texto(lista[i].timeB) === casa;
        } });
    }
    if (fora) {
      out.push({ grupo: 'time', tipo: 'alvo', nome: 'Fora ' + alvo.timeB,
        combina: function (lista, i) { return texto(lista[i].timeB) === fora; } });
      out.push({ grupo: 'time', tipo: 'alvo', nome: 'Time ' + alvo.timeB,
        combina: function (lista, i) {
          return texto(lista[i].timeA) === fora || texto(lista[i].timeB) === fora;
        } });
    }
    if (casa && fora) {
      out.push({ grupo: 'confronto', tipo: 'alvo', nome: alvo.timeA + ' x ' + alvo.timeB,
        combina: function (lista, i) {
          return texto(lista[i].timeA) === casa && texto(lista[i].timeB) === fora;
        } });
    }

    var ft = placar(anterior.placar), ht = placar(anterior.placarHT);
    var gols = faixaGols(anterior.placar);
    if (ft) out.push({ grupo: 'placar', tipo: 'contexto', nome: 'FT anterior ' + ft,
      combina: function (lista, i) { return placar((lista[i - 1] || {}).placar) === ft; } });
    if (ht) out.push({ grupo: 'placar', tipo: 'contexto', nome: 'HT anterior ' + ht,
      combina: function (lista, i) { return placar((lista[i - 1] || {}).placarHT) === ht; } });
    if (gols) out.push({ grupo: 'placar', tipo: 'contexto', nome: 'Placar anterior ' + gols,
      combina: function (lista, i) { return faixaGols((lista[i - 1] || {}).placar) === gols; } });
    return out;
  }

  function analisarCompleto(registros, alvo, mercado, minimo) {
    var regra = regraMercado(mercado);
    var min = Math.max(5, Math.round(Number(minimo) || 5));
    var lista = (Array.isArray(registros) ? registros : []).filter(function (r) {
      return r && typeof r.pago === 'boolean';
    });
    if (!regra.suportado) return { suportado: false, sinal: false, minimo: min };
    if (!alvo || !alvo.timeA || !alvo.timeB || !isFinite(Number(alvo.minuto)) ||
        !isFinite(Number(alvo.odd)) || Number(alvo.odd) <= 1) {
      return { suportado: true, sinal: false, minimo: min, limiar: regra.limiar,
        motivo: 'próximo jogo ainda sem time, minuto ou odd completos' };
    }
    if (lista.length < min + 7) return { suportado: true, sinal: false, minimo: min,
      limiar: regra.limiar, motivo: 'amostra insuficiente' };

    var familias = descritores(lista, alvo).map(function (d) {
      return avaliarFamilia(lista, d);
    });
    var utilizaveis = familias.filter(function (f) { return f.ocorrencias >= min; });
    var melhores = {};
    utilizaveis.forEach(function (f) {
      var atual = melhores[f.grupo];
      if (!atual || f.taxa > atual.taxa ||
          (f.taxa === atual.taxa && f.ocorrencias > atual.ocorrencias)) melhores[f.grupo] = f;
    });
    var confirmacoes = Object.keys(melhores).map(function (g) { return melhores[g]; })
      .filter(function (f) { return f.taxa >= regra.limiar; })
      .sort(function (a, b) { return b.taxa - a.taxa || b.ocorrencias - a.ocorrencias; });
    var deAlvo = confirmacoes.filter(function (f) { return f.tipo === 'alvo'; }).length;
    var deContexto = confirmacoes.filter(function (f) { return f.tipo === 'contexto'; }).length;
    var peso = 0, soma = 0;
    confirmacoes.forEach(function (f) {
      var w = Math.log(1 + f.ocorrencias); peso += w; soma += f.taxa * w;
    });
    return {
      suportado: true,
      sinal: confirmacoes.length >= 2 && deAlvo >= 1 && deContexto >= 1,
      minimo: min, limiar: regra.limiar,
      familias: familias, utilizaveis: utilizaveis, confirmacoes: confirmacoes,
      confirmacoesAlvo: deAlvo, confirmacoesContexto: deContexto,
      forca: peso ? soma / peso : 0,
      alvo: { timeA: alvo.timeA, timeB: alvo.timeB, minuto: alvo.minuto,
        coluna: alvo.coluna, odd: alvo.odd }
    };
  }

  function analisar(resultados, mercado, minimo) {
    var regra = regraMercado(mercado);
    var min = Math.max(5, Math.round(Number(minimo) || 5));
    var serie = (Array.isArray(resultados) ? resultados : []).filter(function (v) {
      return typeof v === 'boolean';
    });
    if (!regra.suportado) return { suportado: false, sinal: false, minimo: min };
    if (serie.length < min + 5) return {
      suportado: true, sinal: false, minimo: min, limiar: regra.limiar,
      motivo: 'amostra insuficiente'
    };

    var candidatos = [4, 3, 2].map(function (tamanho) {
      return avaliarPadrao(serie, serie.slice(-tamanho));
    }).filter(function (item) { return item.ocorrencias >= min; });
    candidatos.sort(function (a, b) {
      return b.taxa - a.taxa || b.tamanho - a.tamanho || b.ocorrencias - a.ocorrencias;
    });
    var melhor = candidatos[0] || null;
    return {
      suportado: true,
      sinal: !!melhor && melhor.taxa >= regra.limiar,
      minimo: min,
      limiar: regra.limiar,
      melhor: melhor,
      candidatos: candidatos
    };
  }

  return {
    analisar: analisar,
    analisarCompleto: analisarCompleto,
    regraMercado: regraMercado,
    mercadosSuportados: mercadosSuportados,
    cicloPodeSerSubstituido: cicloPodeSerSubstituido,
    ordenarCandidatos: ordenarCandidatos,
    chaveJogo: chaveJogo,
    atualizarCiclo: atualizarCiclo,
    _internals: { avaliarPadrao: avaliarPadrao, chavePadrao: chavePadrao,
      avaliarFamilia: avaliarFamilia, descritores: descritores,
      pontuarCandidato: pontuarCandidato }
  };
});
