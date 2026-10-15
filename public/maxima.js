/*
 * AMD LIVE — máxima, mínima e rank real por intervalo
 *
 * Substitui maxima.js. Carregue depois de dados-reais.js ou redirecione:
 *   https://amd-live-dashboard.onrender.com/maxima.js
 * para este arquivo.
 *
 * Fonte de verdade:
 *   - somente células #grade .match[data-real="1"];
 *   - somente linhas/horas atualmente visíveis na grade;
 *   - nome integral em .tm[title];
 *   - mercado selecionado em #mktBtn;
 *   - odds pré-jogo de window.Real.jogos().
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RankingGradeReal = api;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', api.iniciar);
    } else {
      api.iniciar();
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ENV = typeof globalThis !== 'undefined' ? globalThis :
    (typeof window !== 'undefined' ? window : {});
  var CFG = {
    minRank: 3,
    minPainel: 5,
    topN: 5,
    z: 1.96,
    debounce: 450,
    intervalo: 5000,
    atualizacaoDados: 5000,
    intervaloColunas: 15000
  };
  var iniciado = false;
  var observer = null;
  var timer = null;
  var refreshTimer = null;
  var debounceTimer = null;
  var pintando = false;
  var atualizandoDados = false;
  var ultimaAtualizacaoDados = 0;
  var ultimaAtualizacaoColunas = 0;
  var escopoColunas = '';
  /*
   * Uma chave por conteudo selecionado. Antes havia somente `selecaoAtual`,
   * entao todo clique substituia o anterior. O Map preserva a ordem dos
   * cliques e permite combinar times, placares FT/HT e odds exatas.
   */
  var selecoesAtuais = new Map();
  var colunasSelecionadas = new Set();
  var estatisticasColunas = [];
  var cliquesLigados = false;

  var CSS = [
    '#maxBox{padding:10px 12px;border-top:1px solid #16242e;margin-top:6px}',
    '#maxBox .mx-tit{display:flex;justify-content:space-between;align-items:center;font-size:10px;letter-spacing:.8px;text-transform:uppercase;color:#5a6b78;margin-bottom:7px}',
    '#maxBox .mx-per{color:#32a4ff;font-weight:800}',
    '#maxBox .mx-sub{font-size:9px;letter-spacing:.6px;text-transform:uppercase;color:#617684;margin:8px 0 4px}',
    '#maxBox .mx-lin{display:flex;align-items:baseline;gap:4px;font:600 11px/1.7 ui-monospace,monospace;color:#c6d2da}',
    '#maxBox .mx-lin[data-sel-chave]{cursor:pointer;border-radius:4px;margin:0 -4px;padding:0 4px;transition:background .15s ease,outline-color .15s ease}',
    '#maxBox .mx-lin[data-sel-chave]:hover,#maxBox .mx-lin[data-sel-chave]:focus-visible{background:rgba(255,212,0,.10);outline:1px solid rgba(255,212,0,.45)}',
    '#maxBox .mx-lin.mx-selecionado{background:rgba(255,212,0,.18);outline:1px solid #ffd400}',
    '#maxBox .mx-nome{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#maxBox .mx-pct{color:#e7edf1}.mx-n{color:#536773;font-size:9px}',
    '#maxBox .mx-hot .mx-pct{color:#22dd55}',
    '#maxBox .mx-cold .mx-pct{color:#ff5964}',
    '#maxBox .mx-pe{font-size:9px;line-height:1.5;color:#536773;margin-top:9px;border-top:1px solid #16242e;padding-top:7px}',
    '#maxBox .mx-vazio{font-size:10px;color:#617684;line-height:1.5}',
    '#grade .rk.rank-real{font-style:normal;font-weight:800}',
    '#grade .rk.rank-real.rank-top{color:#ff5964}',
    '#grade .rk.rank-real.rank-quente{color:#22dd55}',
    '#grade .rk.rank-real.rank-sem-base{color:#52636e}',
    '#grade .score,#grade .htline{cursor:pointer;border-radius:3px;padding:0 2px}',
    '#grade .score.sel,#grade .htline.sel{background:#ffd400;color:#07151e;font-weight:800}',
    '#grade .gh[data-amostra]{font-variant-numeric:tabular-nums;transition:color 1.2s ease,background-color 1.2s ease}',
    '#grade .gh[data-amostra="0"]{color:#52636e}',
    '#selInfo .sel-real-label{display:flex;align-items:center;gap:8px;flex-wrap:wrap;color:#ffd400;font-family:ui-monospace,monospace;font-weight:800}',
    '#selInfo .sel-item{display:inline-flex;align-items:center;white-space:normal}',
    '#selInfo .sel-item+.sel-item{padding-left:8px;border-left:1px solid #35434c}',
    '#selInfo .sel-colunas{color:#9eb0bb;font-family:ui-monospace,monospace}'
  ].join('');

  function num(v) {
    if (typeof v === 'string') v = v.replace(',', '.');
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function wilson(k, n, z) {
    z = z || CFG.z;
    if (!n) return { rate: 0, low: 0, high: 1 };
    var p = k / n, z2 = z * z, den = 1 + z2 / n;
    var center = (p + z2 / (2 * n)) / den;
    var margin = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / den;
    return {
      rate: p,
      low: Math.max(0, center - margin),
      high: Math.min(1, center + margin)
    };
  }

  function mercadoAtual() {
    var b = document.getElementById('mktBtn');
    return b ? (b.textContent || '')
      .replace(/Mercado:\s*/i, '')
      .replace(/[\u2304\u02c5\u25be\u25bc]/g, '')
      .trim() : '';
  }

  function oddKey(mercado) {
    var m = String(mercado || '').match(/^Over\s*([\d.]+)$/i);
    if (m) return 'odd_over_' + m[1];
    m = String(mercado || '').match(/^Under\s*([\d.]+)$/i);
    if (m) return 'odd_under_' + m[1];
    if (/ambas.*n[aã]o/i.test(mercado)) return 'odd_ambas_nao';
    if (/ambas.*(sim|marcam)/i.test(mercado)) return 'odd_ambas_sim';
    if (/^(5\+|5\+\s*gols)$/i.test(mercado)) return 'odd_total_gols_extatos_5';
    if (/^(casa vence|casa ft)$/i.test(mercado)) return 'odd_resultado_final_casa';
    if (/^(empate|empate ft)$/i.test(mercado)) return 'odd_resultado_final_empate';
    if (/^(fora vence|fora ft)$/i.test(mercado)) return 'odd_resultado_final_fora';
    return null;
  }

  function rotuloOddPorChave(chave) {
    var m = String(chave || '').match(/^odd_over_(.+)$/);
    if (m) return 'O' + m[1];
    m = String(chave || '').match(/^odd_under_(.+)$/);
    if (m) return 'U' + m[1];
    var mapa = {
      odd_ambas_sim: 'AS',
      odd_ambas_nao: 'AN',
      odd_total_gols_extatos_5: '5+',
      odd_resultado_final_casa: 'CASA',
      odd_resultado_final_empate: 'EMPATE',
      odd_resultado_final_fora: 'FORA'
    };
    return mapa[chave] || '';
  }

  function chaveOddPorRotulo(rotulo) {
    var r = String(rotulo || '').trim().toUpperCase();
    var m = r.match(/^O([\d.]+)$/); if (m) return 'odd_over_' + m[1];
    m = r.match(/^U([\d.]+)$/); if (m) return 'odd_under_' + m[1];
    var mapa = {
      AS: 'odd_ambas_sim', AN: 'odd_ambas_nao', '5+': 'odd_total_gols_extatos_5',
      CASA: 'odd_resultado_final_casa', EMPATE: 'odd_resultado_final_empate',
      FORA: 'odd_resultado_final_fora'
    };
    return mapa[r] || '';
  }

  /*
   * A odd do ranking é a cotação exata do mercado, nunca uma faixa.
   * Normalizar em centavos evita separar 2, 2.0 e 2.00 e também evita
   * erros de ponto flutuante na chave do Map.
   */
  function oddExata(odd) {
    var valor = num(odd);
    if (valor == null) return null;
    var centavos = Math.round((valor + Number.EPSILON) * 100);
    valor = centavos / 100;
    return {
      key: String(centavos),
      valor: valor,
      label: valor.toFixed(2)
    };
  }

  /* Compatibilidade com integrações antigas; agora também devolve odd exata. */
  function bucketOdd(odd) {
    return oddExata(odd);
  }

  function periodo() {
    var a = document.querySelector('#horas .active');
    return a ? a.textContent.trim() : '—';
  }

  function horasSelecionadas() {
    var n = parseInt(periodo().replace(/\D/g, ''), 10);
    return Number.isFinite(n) && n > 0 ? n : 3;
  }

  function linhasAnaliticas() {
    var linhasVisiveis = [].slice.call(document.querySelectorAll('#grade .gridrow'))
      .filter(function (row) { return !row.hidden; });
    if (/^0*0\s*h/i.test(periodo())) return linhasVisiveis;
    return linhasVisiveis.slice(0, horasSelecionadas());
  }

  function linhaHabilitada(row) {
    var p = row && row.previousElementSibling;
    while (p && !p.classList.contains('hour-label')) p = p.previousElementSibling;
    if (!p) return true;
    var cb = p.querySelector('input[type="checkbox"]');
    return !cb || cb.checked;
  }

  function estatisticaColuna(itens) {
    var total = 0, acertos = 0, gols = 0;
    (itens || []).forEach(function (item) {
      if (!item || !item.resolvido) return;
      total++;
      if (item.pago) acertos++;
      gols += Number.isFinite(item.gols) ? item.gols : 0;
    });
    return {
      total: total,
      acertos: acertos,
      gols: gols,
      taxa: total ? acertos / total * 100 : null
    };
  }

  function linhaCabecalho(rotulo) {
    var achada = null;
    [].slice.call(document.querySelectorAll('#grade .grid-headrow'))
      .some(function (row) {
        var lead = row.querySelector('.gh.lead,.lead');
        if (!lead || !rotulo(lead.textContent.trim())) return false;
        achada = row;
        return true;
      });
    return achada;
  }

  function celulasCabecalho(row) {
    return row ? [].slice.call(row.children).filter(function (el) {
      return !el.classList.contains('lead');
    }) : [];
  }

  function formatarTaxa(taxa) {
    return taxa == null ? '' : taxa.toFixed(2) + '%';
  }

  /*
   * O app desenha N+1 linhas: uma linha extra mantém a hora mais antiga
   * completa. Ela é útil visualmente, mas não pertence ao cálculo escolhido.
   * Aqui 3h significa exatamente as três primeiras linhas da grade.
   */
  function recalcularColunas(forcar) {
    var agora = Date.now();
    var ligaEscopo = ENV.Real && typeof ENV.Real.liga === 'function'
      ? ENV.Real.liga() : '';
    var linhasEscopo = linhasAnaliticas().map(function (row) {
      return linhaHabilitada(row) ? '1' : '0';
    }).join('');
    var escopo = ligaEscopo + '|' + periodo() + '|' + mercadoAtual() +
      '|' + linhasEscopo;
    var usarCache = !forcar && escopo === escopoColunas &&
      agora - ultimaAtualizacaoColunas < CFG.intervaloColunas &&
      estatisticasColunas.some(function (st) {
        return st && st.total > 0;
      });
    var stats = usarCache ? estatisticasColunas : [];

    if (!usarCache) {
      var rows = linhasAnaliticas().filter(linhaHabilitada);
      var nCols = rows.reduce(function (maior, row) {
        return Math.max(maior, row.querySelectorAll('.match').length);
      }, 0);

      for (var col = 0; col < nCols; col++) {
        var itens = rows.map(function (row) {
          var cells = row.querySelectorAll('.match');
          var cell = cells[col];
          if (!cell || cell.dataset.real !== '1') return null;
          var score = cell.querySelector('.score');
          var m = score ? score.textContent.trim().match(/^(\d+)\s*[-x]\s*(\d+)$/i) : null;
          return {
            resolvido: !!m && (cell.classList.contains('pay') ||
              cell.classList.contains('nopay')),
            pago: cell.classList.contains('pay'),
            gols: m ? Number(m[1]) + Number(m[2]) : 0
          };
        });
        stats.push(estatisticaColuna(itens));
      }
      ultimaAtualizacaoColunas = agora;
      escopoColunas = escopo;
      estatisticasColunas = stats;
    }

    var pctCells = celulasCabecalho(linhaCabecalho(function (t) {
      return t === '%';
    }));
    var greenCells = celulasCabecalho(linhaCabecalho(function (t) {
      return /GREEN/i.test(t);
    }));
    var golsCells = celulasCabecalho(linhaCabecalho(function (t) {
      return /GOLS/i.test(t);
    }));

    pctCells.forEach(function (cell, i) {
      var st = stats[i] || estatisticaColuna([]);
      var texto = formatarTaxa(st.taxa);
      if (cell.textContent !== texto) cell.textContent = texto;
      var classe = cell.className.replace(/\s*(baixa|media|alta)/g, '');
      if (st.taxa != null) {
        classe += st.taxa >= 60 ? ' alta' : (st.taxa >= 35 ? ' media' : ' baixa');
      }
      if (cell.className !== classe) cell.className = classe;
      cell.dataset.amostra = String(st.total);
      cell.title = st.total
        ? st.acertos + '/' + st.total + ' no mercado ' + mercadoAtual() +
          ' durante ' + periodo()
        : 'sem resultado resolvido nesta coluna durante ' + periodo();
    });

    greenCells.forEach(function (cell, i) {
      var st = stats[i] || estatisticaColuna([]);
      var texto = st.total ? String(st.acertos) : '';
      if (cell.textContent !== texto) cell.textContent = texto;
      cell.dataset.amostra = String(st.total);
      cell.title = st.total
        ? st.acertos + ' greens de ' + st.total + ' jogos no mercado ' +
          mercadoAtual() + ' durante ' + periodo()
        : 'sem resultado resolvido nesta coluna durante ' + periodo();
    });

    golsCells.forEach(function (cell, i) {
      var st = stats[i] || estatisticaColuna([]);
      var texto = st.total ? String(st.gols) : '';
      if (cell.textContent !== texto) cell.textContent = texto;
      cell.dataset.amostra = String(st.total);
      cell.title = st.total
        ? st.gols + ' gols em ' + st.total + ' jogos durante ' + periodo()
        : 'sem resultado resolvido nesta coluna durante ' + periodo();
    });

    return stats;
  }

  function linhaAtiva(cell) {
    var row = cell.closest('.gridrow');
    if (!row) return false;
    return linhaHabilitada(row);
  }

  function nomeTime(tm) {
    if (!tm) return '';
    if (tm.title) return tm.title.trim();
    var clone = tm.cloneNode(true);
    var rank = clone.querySelector('.rk');
    if (rank) rank.remove();
    return (clone.textContent || '').trim();
  }

  function chaveJogo(hora, minuto, a, b) {
    return [hora, minuto, String(a || '').trim(), String(b || '').trim()].join('|');
  }

  function horaMinutoDaCelula(cell) {
    var title = cell.title || '';
    var m = title.match(/[·]\s*(\d{1,2}):(\d{2})/);
    if (m) return { hora: Number(m[1]), minuto: Number(m[2]) };

    var row = cell.closest('.gridrow');
    var p = row && row.previousElementSibling;
    while (p && !p.classList.contains('hour-label')) p = p.previousElementSibling;
    var hm = p ? (p.textContent || '').match(/(\d{1,2})h/) : null;
    var col = Number(cell.dataset.col);
    var mins = [].slice.call(document.querySelectorAll('#grade .grid-headrow'))
      .find(function (r) {
        var lead = r.querySelector('.lead');
        return lead && /MIN/i.test(lead.textContent || '');
      });
    var cells = mins ? [].slice.call(mins.children).filter(function (e) {
      return !e.classList.contains('lead');
    }) : [];
    var minute = cells[col] ? num(cells[col].textContent) : null;
    return hm && minute != null ? { hora: Number(hm[1]), minuto: minute } : null;
  }

  function indiceReal() {
    var map = new Map();
    if (!ENV.Real || typeof ENV.Real.jogos !== 'function') return map;
    (ENV.Real.jogos() || []).forEach(function (j) {
      if (!j || !j.resolvido) return;
      map.set(chaveJogo(j.hora, j.minuto, j.timeA, j.timeB), j);
    });
    return map;
  }

  function coletar() {
    var realMap = indiceReal();
    var mercado = mercadoAtual();
    var oKey = oddKey(mercado);
    var out = [];
    /*
     * app.js cria uma linha extra. dados-reais.js reaproveita essa linha para
     * outra hora real; por isso "3h" acabava contando até 4 linhas (70 jogos
     * no meio da hora). Limite estrito às N primeiras linhas da grade.
     */
    var rows = linhasAnaliticas();
    var allowedRows = new Set(rows);

    [].slice.call(document.querySelectorAll('#grade .match[data-real="1"]'))
      .forEach(function (cell) {
        if (!allowedRows.has(cell.closest('.gridrow'))) return;
        if (!linhaAtiva(cell)) return;
        var pago = cell.classList.contains('pay');
        var naoPago = cell.classList.contains('nopay');
        if (!pago && !naoPago) return;
        var tms = [].slice.call(cell.querySelectorAll('.tm'));
        if (tms.length < 2) return;
        var a = nomeTime(tms[0]), b = nomeTime(tms[1]);
        var hm = horaMinutoDaCelula(cell);
        /*
         * A célula já guarda a partida exata com slot absoluto. O mapa por
         * hora/minuto é apenas compatibilidade; sozinho colide em 24h/48h
         * quando o mesmo confronto reaparece no mesmo minuto em outro dia.
         */
        var real = cell.__realJogo ||
          (hm ? realMap.get(chaveJogo(hm.hora, hm.minuto, a, b)) : null);
        var odd = real && oKey ? num((real.odds || {})[oKey]) : null;

        /* Fallback: lê apenas a odd do mercado selecionado exibida no card. */
        if (odd == null && oKey) {
          var rotulo = rotuloOddPorChave(oKey);
          [].slice.call(cell.querySelectorAll('.od')).some(function (el) {
            var texto = (el.textContent || '').split('@')[0].trim();
            if (texto !== rotulo) return false;
            odd = num(el.dataset.odd);
            return odd != null;
          });
        }

        out.push({
          pago: pago,
          times: [a, b],
          odd: odd,
          cell: cell,
          teamEls: tms,
          hora: hm ? hm.hora : null,
          minuto: hm ? hm.minuto : null
        });
      });
    return { jogos: out, mercado: mercado, oddKey: oKey };
  }

  function agregar(coleta) {
    var times = new Map(), odds = new Map();
    coleta.jogos.forEach(function (j) {
      j.times.forEach(function (t) {
        if (!t) return;
        if (!times.has(t)) times.set(t, { nome: t, k: 0, n: 0, cells: [] });
        var x = times.get(t);
        x.n++;
        if (j.pago) x.k++;
        x.cells.push(j);
      });
      var b = oddExata(j.odd);
      if (b) {
        if (!odds.has(b.key)) odds.set(b.key, {
          nome: b.label, valor: b.valor, k: 0, n: 0
        });
        var o = odds.get(b.key);
        o.n++;
        if (j.pago) o.k++;
      }
    });
    function finalizar(map) {
      return Array.from(map.values()).map(function (x) {
        var w = wilson(x.k, x.n);
        return Object.assign(x, {
          taxa: w.rate,
          low: w.low,
          high: w.high
        });
      });
    }
    return { times: finalizar(times), odds: finalizar(odds) };
  }

  function ordenarQuentes(items) {
    return items.slice().sort(function (a, b) {
      return b.low - a.low || b.taxa - a.taxa || b.n - a.n ||
        a.nome.localeCompare(b.nome);
    });
  }

  /*
   * Para "menos pagaram", o menor limite SUPERIOR de Wilson é mais seguro
   * que a taxa crua: uma faixa 0/1 não vira automaticamente a mais fria.
   */
  function ordenarFrios(items) {
    return items.slice().sort(function (a, b) {
      return a.high - b.high || a.taxa - b.taxa || b.n - a.n ||
        a.nome.localeCompare(b.nome);
    });
  }

  function aplicarRanks(teamStats, base) {
    var elegiveis = ordenarFrios(teamStats.filter(function (t) {
      return t.n >= CFG.minRank;
    }));
    var rank = new Map();
    elegiveis.forEach(function (t, i) { rank.set(t.nome, i + 1); });
    var stats = new Map(teamStats.map(function (t) { return [t.nome, t]; }));

    [].slice.call(document.querySelectorAll('#grade .match[data-real="1"] .tm'))
      .forEach(function (tm) {
        var nome = nomeTime(tm);
        var rk = tm.querySelector('.rk');
        if (!rk) {
          rk = document.createElement('i');
          rk.className = 'rk';
          tm.appendChild(document.createTextNode(' '));
          tm.appendChild(rk);
        }
        var st = stats.get(nome), pos = rank.get(nome);
        var texto = pos ? '(' + pos + ')' : '(—)';
        if (rk.textContent !== texto) rk.textContent = texto;
        var classeRank = 'rk rank-real ' + (!st || st.n < CFG.minRank ?
          'rank-sem-base' : pos <= 3 ? 'rank-top' : st.taxa > base ? 'rank-quente' : '');
        if (rk.className !== classeRank) rk.className = classeRank;
        rk.title = st ?
          nome + ': ' + st.k + '/' + st.n + ' (' + (st.taxa * 100).toFixed(1) +
          '%), Wilson ' + (st.low * 100).toFixed(1) + '–' +
          (st.high * 100).toFixed(1) +
          '% · rank dos que menos pagaram no intervalo ' + periodo() :
          'sem amostra no intervalo';
      });
  }

  function idOdd(el) {
    if (!el) return '';
    var rotulo = (el.dataset.rot || (el.textContent || '').split('@')[0])
      .trim().toUpperCase();
    var valor = num(el.dataset.odd);
    return rotulo && valor != null ? rotulo + '|' + valor.toFixed(2) : '';
  }

  function limparMarcacoesDom() {
    [].slice.call(document.querySelectorAll(
      '#grade .tm.sel,#grade .od.sel,#grade .score.sel,#grade .htline.sel'
    )).forEach(function (el) { el.classList.remove('sel'); });
    [].slice.call(document.querySelectorAll('#grade .match.hit,#grade .match.sel'))
      .forEach(function (el) {
        el.classList.remove('hit');
        el.classList.remove('sel');
      });
  }

  function aplicarColunasSelecionadas() {
    [].slice.call(document.querySelectorAll('#grade [data-col]'))
      .forEach(function (el) {
        var ligada = colunasSelecionadas.has(Number(el.dataset.col));
        el.classList.toggle('colsel', ligada);
      });
  }

  function normalizarTexto(v) {
    return String(v || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
  }

  function normalizarPlacar(v) {
    if (/^(?:HT\s+)?OUT(?:\s+HT)?$/i.test(String(v || '').trim())) return 'OUT';
    var m = String(v || '').match(/(?:^|\s)(\d+)\s*[-x]\s*(\d+)(?:\s|$)/i);
    return m ? Number(m[1]) + '-' + Number(m[2]) : '';
  }

  function mesmaEquipe(a, b) {
    return !!a && !!b && normalizarTexto(a) === normalizarTexto(b);
  }

  function valorNormalizadoSelecao(tipo, valor) {
    return tipo === 'ft' || tipo === 'ht'
      ? normalizarPlacar(valor) : String(valor || '').trim();
  }

  function chaveSelecao(tipo, valor) {
    var normalizado = valorNormalizadoSelecao(tipo, valor);
    if (!normalizado) return '';
    return tipo + '|' + (tipo === 'time'
      ? normalizarTexto(normalizado) : normalizado);
  }

  function rotuloSelecao(selecao) {
    if (!selecao) return '';
    if (selecao.tipo === 'time') return 'Time: ' + selecao.valor;
    if (selecao.tipo === 'ft') return 'FT: ' + selecao.valor;
    if (selecao.tipo === 'ht') return 'HT: ' + selecao.valor;
    if (selecao.tipo === 'odd') {
      var p = selecao.valor.split('|');
      return 'Odd ' + p[0] + ' @' + p[1];
    }
    return selecao.valor;
  }

  function matchesDoPeriodo() {
    var out = [];
    linhasAnaliticas().filter(linhaHabilitada).forEach(function (row) {
      [].slice.call(row.querySelectorAll('.match[data-real="1"]'))
        .forEach(function (match) { out.push(match); });
    });
    return out;
  }

  function jogosDoPeriodo() {
    var vistos = new Set();
    return matchesDoPeriodo().map(function (match) {
      var j = match.__realJogo;
      if (!j) return null;
      var chave = match.dataset.gameId || [j.slot, j.timeA, j.timeB].join('|');
      if (vistos.has(chave)) return null;
      vistos.add(chave);
      return j;
    }).filter(Boolean);
  }

  /* Soma somente os gols FEITOS pela equipe, nunca os gols totais do jogo. */
  function estatisticaTimeEmJogos(nome, lista) {
    var jogos = 0, finalizados = 0, gols = 0;
    (lista || []).forEach(function (j) {
      if (!j) return;
      var casa = mesmaEquipe(j.timeA != null ? j.timeA : j.a, nome);
      var fora = mesmaEquipe(j.timeB != null ? j.timeB : j.b, nome);
      if (!casa && !fora) return;
      jogos++;
      if (!j.resolvido) return;
      finalizados++;
      var gh = num(j.gh), ga = num(j.ga);
      if (casa && gh != null) gols += gh;
      if (fora && ga != null) gols += ga;
    });
    return {
      jogos: jogos,
      finalizados: finalizados,
      pendentes: Math.max(0, jogos - finalizados),
      gols: gols
    };
  }

  function alvosDaSelecao(match, selecao) {
    if (!match || !selecao) return [];
    if (selecao.tipo === 'time') {
      return [].slice.call(match.querySelectorAll('.tm')).filter(function (tm) {
        return mesmaEquipe(nomeTime(tm), selecao.valor);
      });
    }
    if (selecao.tipo === 'ft') {
      var score = match.querySelector('.score');
      return score && normalizarPlacar(score.textContent) === selecao.valor
        ? [score] : [];
    }
    if (selecao.tipo === 'ht') {
      var ht = match.querySelector('.htline');
      return ht && normalizarPlacar(ht.textContent) === selecao.valor ? [ht] : [];
    }
    if (selecao.tipo === 'odd') {
      var visiveis = [].slice.call(match.querySelectorAll('.od')).filter(function (od) {
        return idOdd(od) === selecao.valor;
      });
      if (visiveis.length) return visiveis;

      /*
       * Se a odd do mercado não estiver entre as linhas visíveis do card,
       * ainda marca o jogo usando a odd real guardada na própria célula.
       */
      var partes = selecao.valor.split('|');
      var chaveOdd = chaveOddPorRotulo(partes[0]);
      var jogo = match.__realJogo;
      var valor = jogo && chaveOdd ? num((jogo.odds || {})[chaveOdd]) : null;
      return valor != null && valor.toFixed(2) === partes[1] ? [match] : [];
    }
    return [];
  }

  function estatisticaSelecao(selecao, matches, jogos) {
    if (selecao.tipo === 'time') {
      return estatisticaTimeEmJogos(selecao.valor, jogos);
    }
    return {
      jogos: (matches || []).filter(function (match) {
        return alvosDaSelecao(match, selecao).length > 0;
      }).length,
      finalizados: null,
      pendentes: null,
      gols: null
    };
  }

  function atualizarBarraSelecao() {
    var bar = document.getElementById('selInfo');
    if (!bar) return;
    var partes = [];
    var matches = matchesDoPeriodo();
    var jogos = jogosDoPeriodo();

    selecoesAtuais.forEach(function (selecao) {
      var st = estatisticaSelecao(selecao, matches, jogos);
      var texto = rotuloSelecao(selecao) + ' · ' + st.jogos +
        (st.jogos === 1 ? ' jogo' : ' jogos');
      if (selecao.tipo === 'time') {
        texto += ' · ' + st.gols + ' gols feitos';
        if (st.pendentes) {
          texto += ' (' + st.finalizados +
            (st.finalizados === 1 ? ' finalizado, ' : ' finalizados, ') +
            st.pendentes + (st.pendentes === 1 ? ' pendente)' : ' pendentes)');
        }
      }
      partes.push({ classe: 'sel-item', texto: texto });
    });

    if (colunasSelecionadas.size) {
      var indices = Array.from(colunasSelecionadas).sort(function (a, b) {
        return a - b;
      });
      var validas = indices.map(function (i) {
        return estatisticasColunas[i];
      }).filter(function (st) {
        return st && st.taxa != null;
      });
      var soma = validas.reduce(function (acc, st) { return acc + st.taxa; }, 0);
      var acertos = validas.reduce(function (acc, st) { return acc + st.acertos; }, 0);
      var total = validas.reduce(function (acc, st) { return acc + st.total; }, 0);
      var nomes = indices.map(function (i) {
        return String(i + 1).padStart(2, '0');
      }).join(' + ');
      partes.push({ classe: 'sel-colunas', texto: 'Colunas ' + nomes +
        ' · soma ' + soma.toFixed(2) + '%' +
        ' · média ' + (validas.length ? soma / validas.length : 0).toFixed(2) + '%' +
        (total ? ' · conjunto ' + acertos + '/' + total + ' = ' +
          (acertos / total * 100).toFixed(2) + '%' : '') });
    }

    while (bar.firstChild) bar.removeChild(bar.firstChild);
    if (!partes.length) return;
    var label = document.createElement('span');
    label.className = 'sel-real-label';
    partes.forEach(function (parte) {
      var item = document.createElement('span');
      item.className = parte.classe;
      item.textContent = parte.texto;
      label.appendChild(item);
    });
    bar.appendChild(label);
    var limpar = document.createElement('button');
    limpar.type = 'button';
    limpar.className = 'chip';
    limpar.textContent = 'limpar';
    limpar.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      selecoesAtuais.clear();
      colunasSelecionadas.clear();
      aplicarMarcacao();
    });
    bar.appendChild(limpar);
  }

  function aplicarMarcacao() {
    limparMarcacoesDom();

    matchesDoPeriodo().forEach(function (match) {
      var marcou = false;
      selecoesAtuais.forEach(function (selecao) {
        var alvos = alvosDaSelecao(match, selecao);
        if (!alvos.length) return;
        marcou = true;
        alvos.forEach(function (alvo) { alvo.classList.add('sel'); });
      });
      if (marcou) match.classList.add('hit');
    });

    aplicarColunasSelecionadas();
    atualizarEstadoRanking();
    atualizarBarraSelecao();
  }

  function alternarSelecao(tipo, valor) {
    valor = valorNormalizadoSelecao(tipo, valor);
    if (!valor) return;
    var chave = chaveSelecao(tipo, valor);
    if (selecoesAtuais.has(chave)) selecoesAtuais.delete(chave);
    else selecoesAtuais.set(chave, { tipo: tipo, valor: valor });
    aplicarMarcacao();
  }

  function limparSelecoes() {
    selecoesAtuais.clear();
    colunasSelecionadas.clear();
    aplicarMarcacao();
  }

  function ligarCliques() {
    var grade = document.getElementById('grade');
    if (!grade || cliquesLigados) return;
    cliquesLigados = true;

    /*
     * Captura antes dos listeners antigos. Sem isto o clique correto pelo nome
     * real era seguido pelo clique legado no código/rank sintético da posição.
     */
    grade.addEventListener('click', function (ev) {
      var alvo = ev.target;
      var coluna = alvo.closest ? alvo.closest('.gh.col') : null;
      if (coluna && grade.contains(coluna)) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        var indice = Number(coluna.dataset.col);
        if (!Number.isFinite(indice)) return;
        if (colunasSelecionadas.has(indice)) colunasSelecionadas.delete(indice);
        else colunasSelecionadas.add(indice);
        aplicarMarcacao();
        return;
      }

      var match = alvo.closest ? alvo.closest('.match[data-real="1"]') : null;
      if (!match) return;
      var tm = alvo.closest('.tm');
      var score = alvo.closest('.score');
      var ht = alvo.closest('.htline');
      var odd = alvo.closest('.od');
      if (!tm && !score && !ht && !odd) return;

      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (tm) alternarSelecao('time', (tm.title || '').trim());
      else if (score) {
        var ftValor = score.textContent.trim();
        if (/^\d+\s*[-x]\s*\d+$/i.test(ftValor))
          alternarSelecao('ft', ftValor);
      } else if (ht) {
        var htValor = ht.textContent.trim();
        if (/^HT\s+(?:\d+\s*[-x]\s*\d+|OUT)$/i.test(htValor))
          alternarSelecao('ht', htValor);
      }
      else alternarSelecao('odd', idOdd(odd));
    }, true);
  }

  function atualizarDados(forcar) {
    if (!ENV.Real || typeof ENV.Real.buscar !== 'function' ||
        typeof ENV.Real.pintar !== 'function') return Promise.resolve(false);
    var agora = Date.now();
    if (atualizandoDados) return Promise.resolve(false);
    if (!forcar && agora - ultimaAtualizacaoDados < CFG.atualizacaoDados - 500) {
      return Promise.resolve(false);
    }
    atualizandoDados = true;
    ultimaAtualizacaoDados = agora;
    return Promise.resolve(ENV.Real.buscar())
      .then(function () {
        ENV.Real.pintar();
        agendar();
        return true;
      })
      .catch(function (e) {
        console.warn('[RankingGradeReal] atualização:', e);
        return false;
      })
      .finally(function () { atualizandoDados = false; });
  }

  function ligarAtualizacaoRapida() {
    if (refreshTimer) return;
    // dados-reais.js já mantém um único poll sequencial e sem sobreposição.
    if (ENV.Real && ENV.Real.atualizacaoAutomatica) return;
    refreshTimer = setInterval(function () {
      if (typeof document === 'undefined' || !document.hidden) atualizarDados(false);
    }, CFG.atualizacaoDados);
    setTimeout(function () { atualizarDados(false); }, 5000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) atualizarDados(true);
    });
    if (ENV.addEventListener) {
      ENV.addEventListener('focus', function () { atualizarDados(true); });
    }
  }

  function criarBox() {
    var old = document.getElementById('maxBox');
    if (old) { ligarCliquesRanking(old); return old; }
    var nav = document.querySelector('nav.sidebar');
    if (!nav) return null;
    var box = document.createElement('div');
    box.id = 'maxBox';
    var server = nav.querySelector('.server');
    if (server) nav.insertBefore(box, server);
    else nav.appendChild(box);
    ligarCliquesRanking(box);
    return box;
  }

  function cabecalho(box, total) {
    var h = document.createElement('div');
    h.className = 'mx-tit';
    var a = document.createElement('span');
    a.textContent = 'Ranking real';
    var b = document.createElement('span');
    b.className = 'mx-per';
    b.textContent = periodo() + ' · ' + total + 'j';
    h.appendChild(a); h.appendChild(b);
    box.appendChild(h);
  }

  function atualizarEstadoRanking() {
    [].slice.call(document.querySelectorAll('#maxBox .mx-lin[data-sel-chave]'))
      .forEach(function (line) {
        var ativa = selecoesAtuais.has(line.dataset.selChave);
        line.classList.toggle('mx-selecionado', ativa);
        line.setAttribute('aria-pressed', ativa ? 'true' : 'false');
      });
  }

  function ligarCliquesRanking(box) {
    if (!box || box.dataset.cliqueSelecao === '1') return;
    box.dataset.cliqueSelecao = '1';
    var ativar = function (ev) {
      var line = ev.target && ev.target.closest
        ? ev.target.closest('.mx-lin[data-sel-chave]') : null;
      if (!line || !box.contains(line) || !line.__selecaoRanking) return;
      if (ev.type === 'keydown' && ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      ev.stopPropagation();
      alternarSelecao(line.__selecaoRanking.tipo, line.__selecaoRanking.valor);
    };
    box.addEventListener('click', ativar);
    box.addEventListener('keydown', ativar);
  }

  function tornarLinhaSelecionavel(line, selecao) {
    if (!line || !selecao) return;
    var chave = chaveSelecao(selecao.tipo, selecao.valor);
    if (!chave) return;
    line.dataset.selChave = chave;
    line.setAttribute('role', 'button');
    line.setAttribute('tabindex', '0');
    line.setAttribute('aria-pressed', selecoesAtuais.has(chave) ? 'true' : 'false');
    line.title += ' · clique para marcar/desmarcar na grade';
    line.__selecaoRanking = selecao;
  }

  function lista(box, titulo, items, tipo, base, criarSelecao) {
    var h = document.createElement('div');
    h.className = 'mx-sub';
    h.textContent = titulo;
    box.appendChild(h);
    var filtrados = items.filter(function (x) { return x.n >= CFG.minPainel; });
    if (!filtrados.length) {
      var empty = document.createElement('div');
      empty.className = 'mx-vazio';
      empty.textContent = 'amostra menor que ' + CFG.minPainel;
      box.appendChild(empty);
      return;
    }
    filtrados.slice(0, CFG.topN).forEach(function (x) {
      var line = document.createElement('div');
      line.className = 'mx-lin ' + (tipo === 'cold' ? 'mx-cold' : 'mx-hot');
      line.title = x.nome + ': ' + x.k + '/' + x.n +
        ' · taxa ' + (x.taxa * 100).toFixed(1) + '%' +
        ' · Wilson ' + (x.low * 100).toFixed(1) + '–' +
        (x.high * 100).toFixed(1) + '%' +
        ' · base ' + (base * 100).toFixed(1) + '%';
      var name = document.createElement('span');
      name.className = 'mx-nome'; name.textContent = x.nome;
      var rate = document.createElement('span');
      rate.className = 'mx-pct'; rate.textContent = (x.taxa * 100).toFixed(0) + '%';
      var n = document.createElement('span');
      n.className = 'mx-n'; n.textContent = 'n' + x.n;
      line.appendChild(name); line.appendChild(rate); line.appendChild(n);
      if (typeof criarSelecao === 'function') {
        tornarLinhaSelecionavel(line, criarSelecao(x));
      }
      box.appendChild(line);
    });
  }

  function pintar() {
    if (pintando) return null;
    pintando = true;
    try {
      var box = criarBox();
      if (!box) return null;
      recalcularColunas();
      var coleta = coletar();
      if (!coleta.jogos.length) {
        box.innerHTML = '<div class="mx-vazio">aguardando a grade real…</div>';
        aplicarMarcacao();
        return null;
      }
      var agg = agregar(coleta);
      var pagos = coleta.jogos.filter(function (j) { return j.pago; }).length;
      var base = pagos / coleta.jogos.length;
      aplicarRanks(agg.times, base);

      while (box.firstChild) box.removeChild(box.firstChild);
      cabecalho(box, coleta.jogos.length);
      lista(box, 'Times · menos pagaram', ordenarFrios(agg.times), 'cold', base,
        function (x) { return { tipo: 'time', valor: x.nome }; });
      if (coleta.oddKey) {
        lista(box, 'Odds · menos pagaram · ' + coleta.mercado,
          ordenarFrios(agg.odds), 'cold', base, function (x) {
            var rotulo = rotuloOddPorChave(coleta.oddKey);
            return rotulo ? { tipo: 'odd', valor: rotulo + '|' + x.nome } : null;
          });
      } else {
        var warn = document.createElement('div');
        warn.className = 'mx-vazio';
        warn.textContent = 'mercado sem chave de odd compatível';
        box.appendChild(warn);
      }

      var foot = document.createElement('div');
      foot.className = 'mx-pe';
      foot.textContent = 'base ' + (base * 100).toFixed(1) + '% · ' +
        coleta.jogos.length + ' jogos resolvidos reais · intervalo ' +
        periodo() + ' · menos pagaram pelo teto de Wilson';
      box.appendChild(foot);
      aplicarMarcacao();
      return { coleta: coleta, agregado: agg, base: base };
    } catch (e) {
      console.warn('[RankingGradeReal]', e);
      return null;
    } finally {
      pintando = false;
    }
  }

  function agendar() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(pintar, CFG.debounce);
  }

  function observar() {
    var grade = document.getElementById('grade');
    if (!grade || observer) return;
    ligarCliques();
    observer = new MutationObserver(agendar);
    observer.observe(grade, {
      childList: true,
      subtree: true,
      attributes: true,
      /* Não observa class: a própria seleção alterna sel/hit/colsel. */
      attributeFilter: ['data-real', 'data-odd', 'checked']
    });
    document.addEventListener('change', function (e) {
      if (e.target.closest('#horas') || e.target.closest('#grade')) agendar();
    });
    document.addEventListener('click', function (e) {
      if (e.target.closest('#horas,#mktBtn,#realBar,#leagues')) agendar();
      if (e.target.closest('#horas')) {
        setTimeout(function () { atualizarDados(true); }, 80);
      }
    }, true);
  }

  function iniciar() {
    if (iniciado) return;
    iniciado = true;
    var oldStyle = document.getElementById('maxima-css');
    if (oldStyle) oldStyle.remove();
    var style = document.createElement('style');
    style.id = 'maxima-ranking-real-css';
    style.textContent = CSS;
    document.head.appendChild(style);

    var tentativas = 0;
    var boot = setInterval(function () {
      var grade = document.getElementById('grade');
      if ((grade && criarBox()) || ++tentativas > 60) {
        clearInterval(boot);
        observar();
        ligarAtualizacaoRapida();
        agendar();
        timer = setInterval(pintar, CFG.intervalo);
      }
    }, 250);
  }

  return {
    cfg: CFG,
    iniciar: iniciar,
    pintar: pintar,
    coletar: coletar,
    agregar: agregar,
    estatisticaColuna: estatisticaColuna,
    recalcularColunas: recalcularColunas,
    wilson: wilson,
    oddExata: oddExata,
    bucketOdd: bucketOdd,
    oddKey: oddKey,
    rotuloOddPorChave: rotuloOddPorChave,
    chaveOddPorRotulo: chaveOddPorRotulo,
    chaveSelecao: chaveSelecao,
    ordenarQuentes: ordenarQuentes,
    ordenarFrios: ordenarFrios,
    idOdd: idOdd,
    aplicarMarcacao: aplicarMarcacao,
    limparSelecoes: limparSelecoes,
    estatisticaTimeEmJogos: estatisticaTimeEmJogos,
    atualizarDados: atualizarDados
  };
});
