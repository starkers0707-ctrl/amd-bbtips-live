/* ========================================================================== */
/* AMD LIVE - Squad 3/5                                                       */
/* Divide as 20 colunas em quatro blocos e encontra os tres melhores tiros.   */
/* ========================================================================== */
(function (root, factory) {
  'use strict';

  var api = factory(root || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SquadGrade = api;

  if (root && root.document) {
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', api.iniciar);
    } else {
      api.iniciar();
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ENV) {
  'use strict';

  var CHAVE = 'amd.squad.grade.v1';
  var TAMANHO = 5;
  var TIROS = 3;
  var iniciado = false;
  var ativo = false;
  var selecionado = null;
  var selecaoManual = false;
  var assinaturaContexto = '';
  var resultadoAtual = null;
  var timer = null;
  var observer = null;
  var alterandoGrade = false;
  var ultimaAssinaturaRender = '';

  function numero(v) {
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function lerPreferencia() {
    try {
      var salvo = JSON.parse(ENV.localStorage.getItem(CHAVE) || '{}');
      ativo = salvo.ativo === true;
      selecionado = Number.isInteger(salvo.selecionado) ? salvo.selecionado : null;
      selecaoManual = salvo.manual === true;
    } catch (e) {
      ativo = false;
      selecionado = null;
      selecaoManual = false;
    }
  }

  function salvarPreferencia() {
    try {
      ENV.localStorage.setItem(CHAVE, JSON.stringify({
        ativo: ativo,
        selecionado: selecionado,
        manual: selecaoManual
      }));
    } catch (e) {}
  }

  function wilson(acertos, total) {
    if (!total) return { taxa: 0, inferior: 0, superior: 1 };
    var z = 1.96;
    var p = acertos / total;
    var z2 = z * z;
    var den = 1 + z2 / total;
    var centro = (p + z2 / (2 * total)) / den;
    var margem = z * Math.sqrt(
      p * (1 - p) / total + z2 / (4 * total * total)
    ) / den;
    return {
      taxa: p,
      inferior: Math.max(0, centro - margem),
      superior: Math.min(1, centro + margem)
    };
  }

  function combinacoes(inicio, tamanho, quantidade) {
    var saida = [];
    function montar(proximo, atual) {
      if (atual.length === quantidade) {
        saida.push(atual.slice());
        return;
      }
      for (var i = proximo; i < inicio + tamanho; i++) {
        atual.push(i);
        montar(i + 1, atual);
        atual.pop();
      }
    }
    montar(inicio, []);
    return saida;
  }

  function combinacoesDaLista(valores, quantidade) {
    var saida = [];
    function montar(proximo, atual) {
      if (atual.length === quantidade) {
        saida.push(atual.slice());
        return;
      }
      for (var i = proximo; i < valores.length; i++) {
        atual.push(valores[i]);
        montar(i + 1, atual);
        atual.pop();
      }
    }
    montar(0, []);
    return saida;
  }

  function resolvido(jogo) {
    return !!jogo && jogo.resolvido !== false &&
      numero(jogo.gh) !== null && numero(jogo.ga) !== null;
  }

  function linhasDosJogos(jogos) {
    var linhas = Object.create(null);
    (Array.isArray(jogos) ? jogos : []).forEach(function (jogo) {
      var linha = numero(jogo && jogo.gradeLinha);
      var coluna = numero(jogo && jogo.gradeColuna);
      if (linha === null || coluna === null) return;
      if (!linhas[linha]) linhas[linha] = Object.create(null);
      linhas[linha][coluna] = jogo;
    });
    return linhas;
  }

  function estatisticasColunas(jogos, pagar) {
    var stats = Object.create(null);
    (Array.isArray(jogos) ? jogos : []).forEach(function (jogo) {
      var coluna = numero(jogo && jogo.gradeColuna);
      if (coluna === null || !resolvido(jogo)) return;
      var st = stats[coluna] || (stats[coluna] = { total: 0, acertos: 0 });
      st.total++;
      try { if (pagar(jogo)) st.acertos++; } catch (e) {}
    });
    Object.keys(stats).forEach(function (chave) {
      var st = stats[chave];
      st.taxa = st.total ? st.acertos / st.total : 0;
      st.wilson = wilson(st.acertos, st.total);
    });
    return stats;
  }

  function avaliarCombinacao(jogos, colunas, pagar, statsProntas) {
    var linhas = linhasDosJogos(jogos);
    var total = 0;
    var acertos = 0;
    var porTiro = [0, 0, 0];
    var falhas = 0;

    Object.keys(linhas).forEach(function (chave) {
      var linha = linhas[chave];
      var ciclo = colunas.map(function (coluna) { return linha[coluna]; });

      /* Uma linha incompleta nao vira red; ela simplesmente ainda nao entrou. */
      if (!ciclo.every(resolvido)) return;
      total++;

      var tiroPago = -1;
      for (var i = 0; i < ciclo.length; i++) {
        try {
          if (pagar(ciclo[i])) { tiroPago = i; break; }
        } catch (e) {}
      }
      if (tiroPago >= 0) {
        acertos++;
        porTiro[tiroPago]++;
      } else {
        falhas++;
      }
    });

    var stats = statsProntas || estatisticasColunas(jogos, pagar);
    var mediaColunas = colunas.reduce(function (soma, coluna) {
      return soma + ((stats[coluna] && stats[coluna].taxa) || 0);
    }, 0) / Math.max(1, colunas.length);
    var intervalo = wilson(acertos, total);
    var precocidade = acertos
      ? (porTiro[0] * 3 + porTiro[1] * 2 + porTiro[2]) / (acertos * 3)
      : 0;

    return {
      colunas: colunas.slice(),
      total: total,
      acertos: acertos,
      falhas: falhas,
      taxa: total ? acertos / total : 0,
      inferior: intervalo.inferior,
      superior: intervalo.superior,
      porTiro: porTiro,
      precocidade: precocidade,
      mediaColunas: mediaColunas
    };
  }

  function comparar(a, b) {
    var campos = ['inferior', 'taxa', 'precocidade', 'mediaColunas', 'total'];
    for (var i = 0; i < campos.length; i++) {
      var chave = campos[i];
      if (a[chave] !== b[chave]) return b[chave] - a[chave];
    }
    return a.colunas.join('-').localeCompare(b.colunas.join('-'));
  }

  function melhorCombinacao(jogos, inicio, pagar, colunasPermitidas) {
    var stats = estatisticasColunas(jogos, pagar);
    var universo = (Array.isArray(colunasPermitidas) ? colunasPermitidas : [])
      .map(Number)
      .filter(function (coluna, pos, lista) {
        return Number.isInteger(coluna) && coluna >= inicio &&
          coluna < inicio + TAMANHO && lista.indexOf(coluna) === pos;
      })
      .sort(function (a, b) { return a - b; });
    if (universo.length < TIROS) {
      universo = [];
      for (var u = inicio; u < inicio + TAMANHO; u++) universo.push(u);
    }
    var candidatas = combinacoesDaLista(universo, TIROS).map(function (cols) {
      return avaliarCombinacao(jogos, cols, pagar, stats);
    });
    candidatas.sort(comparar);

    /* Sem uma hora completa, ainda ordena pelas colunas resolvidas individuais. */
    if (!candidatas.length || candidatas[0].total === 0) {
      var cols = universo.slice();
      cols.sort(function (a, b) {
        var sa = stats[a] || { taxa: 0, total: 0 };
        var sb = stats[b] || { taxa: 0, total: 0 };
        return sb.taxa - sa.taxa || sb.total - sa.total || a - b;
      });
      return avaliarCombinacao(jogos, cols.slice(0, TIROS).sort(function (a, b) {
        return a - b;
      }), pagar, stats);
    }
    return candidatas[0];
  }

  function calcularSquads(jogos, totalColunas, pagar) {
    totalColunas = Math.max(0, Math.floor(numero(totalColunas) || 0));
    var grupos = [];
    for (var inicio = 0; inicio + TAMANHO <= totalColunas; inicio += TAMANHO) {
      var pendentes = (Array.isArray(jogos) ? jogos : []).filter(function (jogo) {
        return numero(jogo && jogo.gradeLinha) === 0 && !resolvido(jogo) &&
          numero(jogo && jogo.gradeColuna) >= inicio &&
          numero(jogo && jogo.gradeColuna) < inicio + TAMANHO;
      }).map(function (jogo) {
        return numero(jogo.gradeColuna);
      }).filter(function (coluna, pos, lista) {
        return lista.indexOf(coluna) === pos;
      }).sort(function (a, b) { return a - b; });
      var historico = melhorCombinacao(jogos, inicio, pagar);
      grupos.push({
        indice: grupos.length,
        inicio: inicio,
        fim: inicio + TAMANHO - 1,
        pendentes: pendentes,
        historico: historico,
        melhor: pendentes.length >= TIROS
          ? melhorCombinacao(jogos, inicio, pagar, pendentes)
          : historico
      });
    }
    var ordenados = grupos.slice().sort(function (a, b) {
      return comparar(a.historico, b.historico);
    });
    var automatico = grupos.filter(function (grupo) {
      return grupo.pendentes.length >= TIROS;
    })[0] || null;
    return {
      grupos: grupos,
      melhorIndice: ordenados.length ? ordenados[0].indice : null,
      automaticoIndice: automatico ? automatico.indice : null
    };
  }

  function mercadoAtual() {
    var botao = ENV.document && ENV.document.getElementById('mktBtn');
    return String(botao ? botao.textContent : 'Over 2.5')
      .replace(/Mercado:\s*/i, '')
      .replace(/[\u2304\u02c5\u25be\u25bc]/g, '')
      .trim();
  }

  function periodoAtual() {
    var botao = ENV.document && ENV.document.querySelector('#horas .active');
    return botao ? botao.textContent.trim() : '3h';
  }

  function ligaAtual() {
    if (ENV.Real && typeof ENV.Real.liga === 'function') {
      return String(ENV.Real.liga() || '').toLowerCase();
    }
    return '';
  }

  function assinatura() {
    return [ligaAtual(), periodoAtual(), mercadoAtual()].join('|');
  }

  function assinaturaDosJogos(jogos, colunas) {
    return [ativo ? '1' : '0', assinatura(), colunas,
      selecaoManual ? 'm' : 'a', selecionado == null ? '-' : selecionado]
      .concat((Array.isArray(jogos) ? jogos : []).map(function (jogo) {
        return [jogo.gradeLinha, jogo.gradeColuna, jogo.resolvido ? 'r' : 'p',
          jogo.gh == null ? '-' : jogo.gh, jogo.ga == null ? '-' : jogo.ga].join(':');
      })).join('|');
  }

  function jogosDaGrade() {
    if (ENV.Real && typeof ENV.Real.gradeJogos === 'function') {
      try { return ENV.Real.gradeJogos() || []; } catch (e) {}
    }

    var jogos = [];
    var limite = parseInt(periodoAtual(), 10) || 3;
    var rows = [].slice.call(ENV.document.querySelectorAll('#grade .gridrow'))
      .slice(0, limite);
    rows.forEach(function (row, linha) {
      var label = row.previousElementSibling;
      while (label && !label.classList.contains('hour-label')) {
        label = label.previousElementSibling;
      }
      var check = label && label.querySelector('input[type="checkbox"]');
      if (check && !check.checked) return;

      [].slice.call(row.querySelectorAll('.match')).forEach(function (cell, coluna) {
        if (!cell.__realJogo) return;
        jogos.push(Object.assign({}, cell.__realJogo, {
          gradeLinha: linha,
          gradeColuna: coluna
        }));
      });
    });
    return jogos;
  }

  function totalColunas() {
    var row = ENV.document && ENV.document.querySelector('#grade .gridrow');
    return row ? row.querySelectorAll('.match').length : 0;
  }

  function minutos() {
    var saida = [];
    [].slice.call(ENV.document.querySelectorAll('#grade .grid-headrow')).some(function (row) {
      var lead = row.querySelector('.gh.lead,.lead');
      if (!lead || lead.textContent.trim().toUpperCase() !== 'MIN') return false;
      [].slice.call(row.children).forEach(function (cell) {
        if (!cell.classList.contains('lead')) saida.push(cell.textContent.trim());
      });
      return true;
    });
    return saida;
  }

  function pagarDoMercado(mercado) {
    return function (jogo) {
      return typeof ENV.pagou === 'function' && !!ENV.pagou(mercado, jogo);
    };
  }

  function limparClasses(grade) {
    grade.classList.remove('squad-mode');
    var faixa = grade.querySelector('.squad-row');
    if (faixa) faixa.remove();
    [].slice.call(grade.querySelectorAll('[data-squad-base-title]')).forEach(function (el) {
      var marcador = el.title.lastIndexOf(' · Squad ');
      if (marcador >= 0) el.title = el.title.slice(0, marcador);
      el.removeAttribute('data-squad-base-title');
    });
    [].slice.call(grade.querySelectorAll(
      '.squad-break,.squad-shot,.squad-group-active'
    )).forEach(function (el) {
      el.classList.remove('squad-break', 'squad-shot', 'squad-group-active');
      el.removeAttribute('data-squad-tiro');
    });
  }

  function marcarDivisoes(grade) {
    [].slice.call(grade.querySelectorAll('.grid-headrow')).forEach(function (row) {
      var cells = [].slice.call(row.children).filter(function (cell) {
        return !cell.classList.contains('lead');
      });
      cells.forEach(function (cell, indice) {
        if (indice > 0 && indice % TAMANHO === 0) cell.classList.add('squad-break');
      });
    });
    [].slice.call(grade.querySelectorAll('.gridrow')).forEach(function (row) {
      [].slice.call(row.querySelectorAll('.match')).forEach(function (cell, indice) {
        if (indice > 0 && indice % TAMANHO === 0) cell.classList.add('squad-break');
      });
    });
  }

  function textoMinutos(cols, lista) {
    return cols.map(function (coluna) {
      var valor = lista[coluna];
      return valor || String(coluna + 1).padStart(2, '0');
    }).join(' · ');
  }

  function criarFaixa(grade, calculo, listaMinutos, mercado, periodo) {
    var referencia = grade.querySelector('.grid-headrow');
    if (!referencia) return null;
    var faixa = ENV.document.createElement('div');
    faixa.className = 'squad-row';
    faixa.style.gridTemplateColumns = referencia.style.gridTemplateColumns ||
      '46px repeat(20,minmax(0,1fr))';

    var rotulo = ENV.document.createElement('div');
    rotulo.className = 'squad-label';
    rotulo.textContent = 'SQUAD';
    faixa.appendChild(rotulo);

    calculo.grupos.forEach(function (grupo) {
      var melhor = grupo.melhor;
      var botao = ENV.document.createElement('button');
      botao.type = 'button';
      botao.className = 'squad-card';
      botao.dataset.squad = String(grupo.indice);
      if (grupo.indice === selecionado) botao.classList.add('is-active');
      if (grupo.indice === calculo.melhorIndice) botao.classList.add('is-best');

      var intervalo = textoMinutos([
        grupo.inicio, grupo.fim
      ], listaMinutos).replace(' · ', '-');
      var tiros = textoMinutos(melhor.colunas, listaMinutos);
      var taxa = melhor.total ? Math.round(melhor.taxa * 100) + '%' : 'sem base';
      botao.innerHTML = '<b>' + (grupo.indice === calculo.melhorIndice ? '★ ' : '') +
        'Squad ' + (grupo.indice + 1) + ' <em>' + intervalo + '</em></b>' +
        '<span>' + tiros + '</span>' +
        '<small>3 tiros · ' + taxa + (melhor.total ? ' · n' + melhor.total : '') + '</small>';
      botao.title = 'Melhores 3 tiros deste bloco para ' + mercado + ' em ' + periodo +
        (melhor.total
          ? ': o ciclo pagou ' + melhor.acertos + ' de ' + melhor.total + ' horas completas.'
          : ': aguardando uma hora completa para medir o ciclo.');
      if (grupo.pendentes.length >= TIROS) {
        botao.title += ' Foram considerados somente os jogos que ainda nao comecaram nesta hora.';
      }
      faixa.appendChild(botao);
    });

    referencia.before(faixa);
    return faixa;
  }

  function marcarTiros(grade, grupo, listaMinutos) {
    if (!grupo || !grupo.melhor) return;
    var cols = grupo.melhor.colunas;
    var primeiraLinha = grade.querySelector('.gridrow');

    [].slice.call(grade.querySelectorAll('.grid-headrow')).forEach(function (row) {
      var cells = [].slice.call(row.children).filter(function (cell) {
        return !cell.classList.contains('lead');
      });
      cols.forEach(function (coluna) {
        if (cells[coluna]) cells[coluna].classList.add('squad-shot');
      });
    });

    [].slice.call(grade.querySelectorAll('.gridrow')).forEach(function (row) {
      var cells = row.querySelectorAll('.match');
      for (var col = grupo.inicio; col <= grupo.fim; col++) {
        if (cells[col]) cells[col].classList.add('squad-group-active');
      }
      cols.forEach(function (coluna, indice) {
        if (!cells[coluna]) return;
        cells[coluna].classList.add('squad-shot');
        if (cells[coluna].title.indexOf(' · Squad ') < 0) {
          cells[coluna].dataset.squadBaseTitle = cells[coluna].title || '';
          cells[coluna].title = (cells[coluna].title ? cells[coluna].title + ' · ' : '') +
            'Squad ' + (grupo.indice + 1) + ', tiro ' + (indice + 1) +
            ' (' + (listaMinutos[coluna] || coluna + 1) + ' min)';
        }
        if (row === primeiraLinha) {
          cells[coluna].dataset.squadTiro = String(indice + 1);
        }
      });
    });
  }

  function atualizarBotao() {
    var botao = ENV.document && ENV.document.getElementById('btnSquad');
    if (!botao) return;
    botao.classList.toggle('on', ativo);
    botao.setAttribute('aria-pressed', ativo ? 'true' : 'false');
    botao.textContent = ativo ? '👥 Squad 3/5' : '👥 Squad';
    botao.title = 'Separar os 20 jogos em quatro blocos e marcar os melhores 3 tiros';
  }

  function renderizar() {
    if (!ENV.document || alterandoGrade) return null;
    var grade = ENV.document.getElementById('grade');
    if (!grade) return null;

    var colunasAntes = totalColunas();
    var jogosAntes = ativo ? jogosDaGrade() : [];
    var assinaturaRender = assinaturaDosJogos(jogosAntes, colunasAntes);
    if (assinaturaRender === ultimaAssinaturaRender) {
      atualizarBotao();
      if (!ativo && !grade.querySelector('.squad-row')) return null;
      if (ativo && grade.querySelector('.squad-row') && resultadoAtual) {
        grade.classList.add('squad-mode');
        marcarDivisoes(grade);
        marcarTiros(grade,
          resultadoAtual.calculo.grupos[resultadoAtual.selecionado], minutos());
        return resultadoAtual;
      }
    }

    alterandoGrade = true;
    try {
      limparClasses(grade);
      atualizarBotao();
      if (!ativo) {
        resultadoAtual = null;
        ultimaAssinaturaRender = assinaturaRender;
        return null;
      }

      var colunas = colunasAntes;
      if (colunas !== 20) {
        resultadoAtual = null;
        ultimaAssinaturaRender = assinaturaRender;
        var botao = ENV.document.getElementById('btnSquad');
        if (botao) botao.title = 'O Squad fica disponivel nas ligas com 20 jogos por hora.';
        return null;
      }

      var contexto = assinatura();
      if (contexto !== assinaturaContexto) {
        assinaturaContexto = contexto;
        /* Mercado, liga ou periodo novo sempre volta a escolher o melhor bloco. */
        selecionado = null;
        selecaoManual = false;
      }

      var mercado = mercadoAtual();
      var periodo = periodoAtual();
      var jogos = jogosAntes;
      var calculo = calcularSquads(jogos, colunas, pagarDoMercado(mercado));
      if (!selecaoManual) {
        selecionado = calculo.automaticoIndice !== null
          ? calculo.automaticoIndice : calculo.melhorIndice;
      } else if (selecionado === null || !calculo.grupos[selecionado]) {
        selecionado = calculo.automaticoIndice !== null
          ? calculo.automaticoIndice : calculo.melhorIndice;
      }
      resultadoAtual = {
        liga: ligaAtual(),
        mercado: mercado,
        periodo: periodo,
        selecionado: selecionado,
        calculo: calculo
      };

      grade.classList.add('squad-mode');
      marcarDivisoes(grade);
      var listaMinutos = minutos();
      criarFaixa(grade, calculo, listaMinutos, mercado, periodo);
      marcarTiros(grade, calculo.grupos[selecionado], listaMinutos);
      /* selecionado pode ter mudado automaticamente depois da assinatura inicial. */
      ultimaAssinaturaRender = assinaturaDosJogos(jogos, colunas);
      salvarPreferencia();
      return resultadoAtual;
    } finally {
      setTimeout(function () { alterandoGrade = false; }, 0);
    }
  }

  function agendar(atraso) {
    clearTimeout(timer);
    timer = setTimeout(renderizar, atraso == null ? 120 : atraso);
  }

  function definirAtivo(valor) {
    ativo = valor == null ? !ativo : !!valor;
    if (!ativo) {
      selecionado = null;
      selecaoManual = false;
    }
    salvarPreferencia();
    agendar(0);
    return ativo;
  }

  function selecionarSquad(indice) {
    indice = Number(indice);
    if (!Number.isInteger(indice) || indice < 0 || indice > 3) return false;
    selecionado = indice;
    selecaoManual = true;
    salvarPreferencia();
    agendar(0);
    return true;
  }

  function ligarEventos() {
    var botao = ENV.document.getElementById('btnSquad');
    if (botao) {
      botao.addEventListener('click', function () { definirAtivo(); });
    }

    ENV.document.addEventListener('click', function (evento) {
      var card = evento.target.closest && evento.target.closest('.squad-card');
      if (card) {
        selecionarSquad(parseInt(card.dataset.squad, 10));
        return;
      }
      if (evento.target.closest && evento.target.closest(
        '#horas,#mktMenu,#cmktMenu,#leagues,#realBar'
      )) agendar(350);
    }, true);

    ENV.addEventListener('amd:grade-data', function () { agendar(80); });
    ENV.addEventListener('amd:real-data', function () { agendar(180); });

    var grade = ENV.document.getElementById('grade');
    if (grade && typeof MutationObserver === 'function') {
      observer = new MutationObserver(function () {
        if (!alterandoGrade) agendar(80);
      });
      observer.observe(grade, { childList: true });
    }
  }

  function iniciar() {
    if (iniciado || !ENV.document) return;
    iniciado = true;
    lerPreferencia();
    atualizarBotao();
    ligarEventos();
    agendar(250);
    ENV.setInterval(function () { if (ativo) agendar(0); }, 5000);
  }

  return {
    iniciar: iniciar,
    atualizar: renderizar,
    ativar: definirAtivo,
    selecionar: selecionarSquad,
    estado: function () { return resultadoAtual; },
    wilson: wilson,
    combinacoes: combinacoes,
    combinacoesDaLista: combinacoesDaLista,
    avaliarCombinacao: avaliarCombinacao,
    melhorCombinacao: melhorCombinacao,
    calcularSquads: calcularSquads
  };
});
