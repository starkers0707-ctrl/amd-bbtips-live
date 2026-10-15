/* ============================================================================
 *  DADOS REAIS — troca os números do Poisson pelos jogos do banco
 * ============================================================================
 *  O renderGrade() do app.js gera a grade com makeRng/poisson e monta a lista
 *  de jogos numa variável LOCAL — não dá pra trocar por fora como foi feito
 *  com serie() no gráfico. Então a estratégia é outra: deixa ele desenhar a
 *  moldura e reescreve as células com o que veio do /api/grade.
 *
 *  O encaixe que torna isso barato: pagou(mkt, j) do app.js é global e usa
 *  SÓ quatro campos — j.gh, j.ga (gols FT) e j.hh, j.ha (gols HT). Os 69
 *  mercados saem daí. Então não reimplemento mercado nenhum: monto o jogo
 *  real nesse formato e o próprio app classifica pagou/não pagou.
 *
 *  Não toca em app.js. <script src="dados-reais.js"></script> e pronto.
 * ========================================================================== */
(function () {
  'use strict';

  var API  = '';
  var LS_LIGA = 'amd_liga';
  // express saiu: 60 jogos/hora estourava a cota e nao cabe em 20 colunas
  var LIGAS = ['copa', 'euro', 'super', 'premier'];

  var ligaParametro = '';
  try { ligaParametro = new URLSearchParams(location.search).get('liga') || ''; }
  catch (_) { ligaParametro = ''; }
  var liga = String(ligaParametro || localStorage.getItem(LS_LIGA) || 'copa').toLowerCase();
  if (LIGAS.indexOf(liga) < 0) liga = 'copa';
  // A API pode mapear a aba classica para uma liga descoberta pela extensao
  // (por exemplo, playpix-spa). Nesse caso a cadencia deve vir dos jogos reais,
  // e nao da tabela fixa da antiga copa/euro/super/premier.
  var ligaFonteAtual = liga;
  var jogos = [];          // ordem cronológica pelo relógio absoluto do jogo
  var jogosDaGrade = [];   // somente os jogos realmente posicionados na grade
  var pintando = false;
  var graficoNosso = false;
  var horaBase = 0;
  var obs = null;
  var ultimaBusca = 0;
  var buscaEmVoo = null;
  var escopoDaBusca = null;
  var controleBusca = null;
  var buscaCompartilhadaEmVoo = null;
  var escopoCompartilhado = null;
  var pollTimer = null;
  var authBloqueada = false;
  var alertaMercadoAtivo = '';
  var cursoresPorEscopo = Object.create(null);
  var ultimaCompletaPorEscopo = Object.create(null);
  var escopoDosJogos = '';
  var RECONCILIAR_MS = 15 * 60 * 1000;
  /*
   * O snapshot pode chegar por alguns ciclos com a ancora uma hora atrasada
   * (ou adiantada) enquanto resultados e futuros sao atualizados. No
   * modo 00h isso nao pode fazer o relogio voltar: cada retorno reconstruia a
   * grade, apagava os futuros e logo depois os colocava de novo. Guardamos o
   * topo absoluto mais recente por liga; ele so avanca e a virada do dia fica
   * natural porque o slot inclui a data.
   */
  var topoHoraEstavelPorLiga = Object.create(null);

  var CSS = ''
    + '#realBar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;'
    + 'font-size:12px;margin-left:auto}'
    + '#realBar .rb-tag{font:700 9px/1 ui-monospace,monospace;letter-spacing:.6px;'
    + 'text-transform:uppercase;padding:3px 6px;border-radius:4px;'
    + 'background:#0d2818;color:#22dd55;border:1px solid #1c4d2f}'
    + '#realBar .rb-off{background:#2a1414;color:#ff5555;border-color:#4d1c1c}'
    + '#realBar .rb-info{color:#5a6b78;font-size:11px}'
    + 'table.bt-rolagem{display:block;max-height:280px;overflow-y:auto}'
    + 'table.bt-rolagem thead th{position:sticky;top:0;background:#0a1218;z-index:2}'
    + '.bt-pos{color:#22dd55}.bt-neg{color:#ff5555}';

  // ─────────────────────────────────────────────────────────────
  //  1. BUSCA
  // ─────────────────────────────────────────────────────────────
  function horasDaGrade() {
    var a = document.querySelector('#horas .active');
    var n = a ? parseInt((a.textContent || '').replace(/\D/g, ''), 10) : 48;
    return Math.min(isNaN(n) ? 48 : n, 168);
  }

  /**
   * Busco 1 hora ALEM do que a grade mostra. Sem isso a linha mais antiga
   * chegava cortada no meio — metade com jogo, metade vazia — porque a janela
   * de 3h corta no meio de uma hora. Com folga, toda linha visivel vem inteira.
   */
  function horasDaBusca() {
    /* O alerta sempre compara as últimas 3 horas, mesmo quando a grade está
       em 00h logo após a virada. Quatro horas dão a janela + a folga visual. */
    return Math.min(Math.max(horasDaGrade() + 1, 4), 168);
  }

  /** O botao HT da barra manda: aceso mostra o HT, apagado esconde. */
  function htLigado() {
    var b = document.getElementById('btnHT');
    if (!b) return true;
    return /(^|\s)(on|active)(\s|$)/.test(b.className) ||
           b.getAttribute('aria-pressed') === 'true';
  }

  /*
   * Converte hora/minuto do relógio virtual em um instante absoluto, usando
   * criado_em apenas para descobrir o dia mais próximo. Assim 20:13 de hoje
   * não colide com 20:13 de ontem quando a grade passa de 24 horas.
   */
  function slotAbsoluto(p) {
    var informado = Date.parse(p.slot_em || '');
    if (!isNaN(informado)) return informado;
    var criado = Date.parse(p.criado_em || '') || Date.now();
    var ref = new Date(criado);
    var h = parseInt(p.hora, 10);
    var m = parseInt(p.minuto, 10);
    if (isNaN(h) || isNaN(m)) return criado;
    var slot = Date.UTC(
      ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(), h, m, 0, 0
    );
    var metadeDia = 12 * 60 * 60 * 1000;
    var dia = 24 * 60 * 60 * 1000;
    while (slot - criado > metadeDia) slot -= dia;
    while (criado - slot > metadeDia) slot += dia;
    return slot;
  }

  function paraJogo(p) {
    var ht = String(p.resultado_ht || '').match(/(\d+)\s*[-x]\s*(\d+)/i);
    var criadoTs = Date.parse(p.criado_em || '') || 0;
    return {
      // o contrato do pagou():
      gh: p.gols_a == null ? 0 : p.gols_a,
      ga: p.gols_b == null ? 0 : p.gols_b,
      hh: ht ? parseInt(ht[1], 10) : null,
      ha: ht ? parseInt(ht[2], 10) : null,
      // o resto, pra desenhar:
      timeA: p.time_a || '', timeB: p.time_b || '',
      placar: p.resultado_ft || '',
      placarHT: p.resultado_ht || '',
      odds: p.odds || {},
      hora: p.hora, minuto: p.minuto,
      id: String(p.id || ''),
      criado: p.criado_em,
      criadoTs: criadoTs,
      slot: slotAbsoluto(p),
      resolvido: p.resultado_ft != null && p.resultado_ft !== ''
    };
  }

  function chaveJogo(j) {
    return [j.slot, String(j.timeA || '').toLowerCase(),
      String(j.timeB || '').toLowerCase()].join('|');
  }

  /*
   * A API pode devolver a mesma partida duas vezes: primeiro pendente e depois
   * resolvida. A resolvida sempre vence, independentemente da ordem do JSON.
   */
  function normalizarPartidas(partidas) {
    var unicos = Object.create(null);
    (partidas || []).forEach(function (p) {
      var j = paraJogo(p);
      var chave = chaveJogo(j);
      var atual = unicos[chave];
      if (!atual ||
          (j.resolvido && !atual.resolvido) ||
          (j.resolvido === atual.resolvido && j.criadoTs >= atual.criadoTs)) {
        unicos[chave] = j;
      }
    });
    return Object.keys(unicos).map(function (k) { return unicos[k]; })
      .sort(function (a, b) {
        return a.slot - b.slot || a.criadoTs - b.criadoTs ||
          String(a.id).localeCompare(String(b.id));
      });
  }

  /*
   * Entre duas conferencias completas, a API entrega somente partidas que
   * mudaram no banco. Mesclamos pelo jogo, e o FT sempre substitui a versao
   * pendente. Assim a tela continua imediata sem baixar centenas de partidas
   * iguais a cada ciclo.
   */
  function mesclarPartidas(atuais, alteradas) {
    var unicos = Object.create(null);
    (atuais || []).concat(alteradas || []).forEach(function (j) {
      var chave = chaveJogo(j);
      var atual = unicos[chave];
      if (!atual ||
          (j.resolvido && !atual.resolvido) ||
          (j.resolvido === atual.resolvido && j.criadoTs >= atual.criadoTs)) {
        unicos[chave] = j;
      }
    });
    return Object.keys(unicos).map(function (k) { return unicos[k]; })
      .sort(function (a, b) {
        return a.slot - b.slot || a.criadoTs - b.criadoTs ||
          String(a.id).localeCompare(String(b.id));
      });
  }

  function buscarDireto() {
    var alvo = liga;
    var horas = horasDaBusca();
    var escopo = alvo + '|' + horas;
    var agora = Date.now();
    var cursor = cursoresPorEscopo[escopo] || '';
    var precisaCompleta = !cursor || !jogos.length ||
      escopoDosJogos !== escopo ||
      agora - (ultimaCompletaPorEscopo[escopo] || 0) >= RECONCILIAR_MS;

    if (buscaEmVoo) {
      if (escopoDaBusca === escopo) return buscaEmVoo;
      if (controleBusca) controleBusca.abort();
      return buscaEmVoo.then(function () { return buscarDireto(); });
    }

    /* A primeira carga e a auditoria de 15 minutos sao completas. Nos demais
       ciclos pedimos apenas registros alterados desde o cursor do banco. */
    escopoDaBusca = escopo;
    controleBusca = typeof AbortController !== 'undefined'
      ? new AbortController() : null;
    var expirou = setTimeout(function () {
      if (controleBusca) controleBusca.abort();
    }, 30000);
    var url = API + '/api/grade?liga=' + encodeURIComponent(alvo)
             + '&horas=' + horas
             + '&compacto=1'
             + (!precisaCompleta ? '&desde=' + encodeURIComponent(cursor) : '')
             + '&_=' + Date.now();

    var op = fetch(url, {
      cache: 'no-store',
      signal: controleBusca ? controleBusca.signal : undefined
    })
      .then(function (r) {
        if (!r.ok) {
          var erroHttp = new Error('HTTP ' + r.status);
          erroHttp.status = r.status;
          throw erroHttp;
        }
        return r.json();
      })
      .then(function (d) {
        if (alvo !== liga || escopo !== liga + '|' + horasDaBusca()) return false;
        ligaFonteAtual = String((d && d.liga) || alvo).toLowerCase();
        var novos = normalizarPartidas(d.partidas || []);
        jogos = precisaCompleta ? novos : mesclarPartidas(jogos, novos);
        escopoDosJogos = escopo;
        if (d.cursor) cursoresPorEscopo[escopo] = String(d.cursor);
        if (precisaCompleta) ultimaCompletaPorEscopo[escopo] = Date.now();
        authBloqueada = false;
        ultimaBusca = Date.now();
        try {
          var topoEvento = topoHoraDoJogo();
          var topoEventoValido = topoEvento != null && isFinite(topoEvento);
          window.dispatchEvent(new CustomEvent('amd:real-data', {
            detail: {
               liga: liga,
               jogos: jogos.length,
               incremental: !precisaCompleta,
               alterados: novos.length,
               atualizadoEm: ultimaBusca,
              topoHoraSlot: topoEventoValido ? topoEvento : null,
              horaAtual: topoEventoValido
                ? new Date(topoEvento).getUTCHours() : null
            }
          }));
        } catch (e) {}
        return true;
      })
      .catch(function (e) {
        if (e && e.status === 401) {
          if (!authBloqueada) {
            authBloqueada = true;
            try {
              window.dispatchEvent(new CustomEvent('amd:auth-required'));
            } catch (eventoErro) {}
          }
        }
        if (e && e.name !== 'AbortError')
          console.warn('[real] busca:', e.message);
        // Falha temporária nunca apaga o último snapshot bom.
        return false;
      })
      .then(function (ok) {
        clearTimeout(expirou);
        buscaEmVoo = null;
        escopoDaBusca = null;
        controleBusca = null;
        return ok;
      });
    buscaEmVoo = op;
    return op;
  }

  function publicarAtualizacao(dados, alvo, horas, escopo) {
    if (alvo !== liga || escopo !== liga + '|' + horasDaBusca()) return false;
    jogos = normalizarPartidas((dados && dados.partidas) || []);
    escopoDosJogos = escopo;
    if (dados && dados.cursor) cursoresPorEscopo[escopo] = String(dados.cursor);
    if (!dados || !dados.incremental) ultimaCompletaPorEscopo[escopo] = Date.now();
    authBloqueada = false;
    ultimaBusca = Number(dados && dados.atualizadoEm) || Date.now();
    try {
      var topoEvento = topoHoraDoJogo();
      var topoEventoValido = topoEvento != null && isFinite(topoEvento);
      window.dispatchEvent(new CustomEvent('amd:real-data', {
        detail: {
          liga: liga,
          jogos: jogos.length,
          incremental: !!(dados && dados.incremental),
          alterados: Number(dados && dados.alterados) || 0,
          atualizadoEm: ultimaBusca,
          compartilhadoEntreAbas: true,
          topoHoraSlot: topoEventoValido ? topoEvento : null,
          horaAtual: topoEventoValido
            ? new Date(topoEvento).getUTCHours() : null
        }
      }));
    } catch (e) {}
    return true;
  }

  /*
   * Apenas a aba eleita consulta /api/grade. As outras recebem exatamente o
   * mesmo snapshot pelo BroadcastChannel; trocar de aba nao multiplica HTTP,
   * autenticacao, rate limit ou leituras no PostgreSQL.
   */
  function buscarCompartilhado() {
    var alvo = liga;
    var horas = horasDaBusca();
    var escopo = alvo + '|' + horas;
    if (buscaCompartilhadaEmVoo) {
      if (escopoCompartilhado === escopo) return buscaCompartilhadaEmVoo;
      return buscaCompartilhadaEmVoo.then(function () {
        return buscarCompartilhado();
      });
    }
    escopoCompartilhado = escopo;
    buscaCompartilhadaEmVoo = window.AMDGradeTabs.request({
      liga: alvo,
      horas: horas,
      compacto: true,
      maxAgeMs: 1500
    }).then(function (dados) {
      return publicarAtualizacao(dados, alvo, horas, escopo);
    }).catch(function (e) {
      if (e && e.status === 401) authBloqueada = true;
      if (e && e.name !== 'AbortError')
        console.warn('[real] busca compartilhada:', e.message);
      return false;
    }).then(function (ok) {
      buscaCompartilhadaEmVoo = null;
      escopoCompartilhado = null;
      return ok;
    });
    return buscaCompartilhadaEmVoo;
  }

  function buscar() {
    return window.AMDGradeTabs && typeof window.AMDGradeTabs.request === 'function'
      ? buscarCompartilhado()
      : buscarDireto();
  }

  // ─────────────────────────────────────────────────────────────
  //  2. MERCADO E ODDS
  // ─────────────────────────────────────────────────────────────
  function mercadoAtual() {
    var b = document.getElementById('mktBtn');
    if (!b) return '';
    return (b.textContent || '')
      .replace(/Mercado:\s*/i, '')
      .replace(/[\u2304\u02c5\u25be\u25bc]/g, '')
      .trim();
  }

  /** Rótulo do card -> chave da odd na API. O2.5 -> odd_over_2.5 */
  function chaveDaOdd(rotulo) {
    var m = rotulo.match(/^O\s*([\d.]+)$/i);
    if (m) return 'odd_over_' + m[1];
    m = rotulo.match(/^U\s*([\d.]+)$/i);
    if (m) return 'odd_under_' + m[1];
    if (/^AS$/i.test(rotulo)) return 'odd_ambas_sim';
    if (/^AN$/i.test(rotulo)) return 'odd_ambas_nao';
    if (/^CASA$/i.test(rotulo)) return 'odd_resultado_final_casa';
    if (/^FORA$/i.test(rotulo)) return 'odd_resultado_final_fora';
    if (/^5\+$/i.test(rotulo)) return 'odd_total_gols_extatos_5';
    return null;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // ─────────────────────────────────────────────────────────────
  //  3. PINTURA — sobrescreve as células que o renderGrade desenhou
  // ─────────────────────────────────────────────────────────────
  function celulas() {
    // ordem cronológica: a grade desenha a hora mais nova em cima
    var rows = [].slice.call(document.querySelectorAll('#grade .gridrow'));
    var out = [];
    rows.slice().reverse().forEach(function (row) {
      [].slice.call(row.children).forEach(function (el) {
        if (el.classList.contains('match')) out.push({ el: el, row: row });
      });
    });
    return out;
  }

  /**
   * O rotulo da odd (AS, O2.5, O3.5) vinha do texto da propria celula. Quando
   * o esvaziar passou a limpar tudo, o rotulo sumia junto e a odd nunca mais
   * era escrita — por isso as ultimas celulas ficavam sem odd. Agora fica
   * guardado no proprio elemento, na primeira vez que e visto.
   */
  function rotuloDaOdd(o) {
    if (!o.dataset.rot) {
      var t = (o.textContent || '').split('@')[0].trim();
      if (t) o.dataset.rot = t;
    }
    return o.dataset.rot || '';
  }

  /**
   * A cadencia certa nao precisa ser adivinhada: o proprio app.js tem a tabela
   * LIGACFG com {ini, passo, cols} de cada liga. Copa 1/3, Super 1/3, Euro 2/3,
   * Premier 0/3. Eu vinha deduzindo dos dados e errava quando faltava jogo.
   */
  /**
   * Cadencia de cada liga: minuto da primeira coluna e passo entre colunas.
   * Conferidos contra a grade de referencia. Estao aqui e nao lidos do app.js
   * porque o LIGACFG de la e um const dentro de uma funcao — nao existe em
   * window nem como identificador global, entao nenhum outro script o alcanca.
   */
  var CADENCIA = {
    copa:    { ini: 1, passo: 3 },
    super:   { ini: 1, passo: 3 },
    euro:    { ini: 2, passo: 3 },
    premier: { ini: 0, passo: 3 }
  };

  function configDaLiga() {
    return ligaFonteAtual === liga ? (CADENCIA[liga] || null) : null;
  }

  /**
   * Cadencia da liga, medida no proprio dado. A express roda 60 jogos por hora
   * (1 por minuto); copa, super, euro e premier rodam 20 (1 a cada 3 min).
   * Eu tinha isso como constante fixa 20 e nunca conferi — era a raiz do
   * desalinhamento que fazia a hora 1 mostrar jogo que nao foi da hora 1.
   */
  function cadencia(js) {
    var difs = {};
    for (var i = 1; i < js.length; i++) {
      if (js[i].hora !== js[i - 1].hora) continue;
      var d = js[i].minuto - js[i - 1].minuto;
      if (d > 0) difs[d] = (difs[d] || 0) + 1;
    }
    var passo = 3, max = 0;
    for (var k in difs) if (difs[k] > max) { max = difs[k]; passo = parseInt(k, 10); }
    return passo;
  }

  /**
   * De onde a primeira coluna comeca. A copa cai em 1,4,7...; a euro em 2,5,8...
   * Eu usava o MENOR resto — bastava um jogo fora do padrao pra deslocar a
   * coluna inteira, e era isso que deixava euro e premier com minuto errado.
   * Agora vale o resto MAIS FREQUENTE, que ignora o ponto solto.
   */
  function minutoBase(js, passo) {
    var contagem = {};
    js.forEach(function (j) {
      if (j.minuto == null) return;
      var r = j.minuto % passo;
      contagem[r] = (contagem[r] || 0) + 1;
    });
    var base = 0, max = 0;
    for (var r in contagem) {
      if (contagem[r] > max) { max = contagem[r]; base = parseInt(r, 10); }
    }
    return base;
  }

  function matches(row) {
    return [].slice.call(row.children).filter(function (el) {
      return el.classList.contains('match');
    });
  }

  /**
   * A linha MIN do cabecalho e desenhada pelo app com passo fixo e nunca
   * mudava de liga. Na euro os jogos saem em 02,05,08... e o cabecalho
   * continuava 01,04,07 — a coluna inteira parecia da copa.
   */
  function rotularMinutos(base, passo) {
    var linhas = [].slice.call(document.querySelectorAll('#grade .grid-headrow'));
    var alvo = null;
    linhas.forEach(function (h) {
      var lead = h.querySelector('.gh.lead, .lead');
      if (lead && /MIN/i.test(lead.textContent)) alvo = h;
    });
    if (!alvo) return;
    var cels = [].slice.call(alvo.children).filter(function (c) {
      return !/lead/.test(c.className);
    });
    cels.forEach(function (c, i) {
      c.textContent = pad2(base + i * passo);
    });
  }

  /**
   * As linhas % e GOLS do cabecalho continuavam vindo do gerador — por isso uma
   * coluna toda verde aparecia como 33%. Agora sao contadas em cima dos jogos
   * que estao de fato na tela, no mercado escolhido.
   */
  /*
   * A seleção por conteúdo pertence ao maxima.js. Este módulo só reage às
   * linhas ligadas/desligadas; assim não existe um segundo estado apagando as
   * várias marcações feitas pelo usuário.
   */
  function ligarMarcacao() {
    var g = document.getElementById('grade');
    if (!g || g.dataset.marcaOn === '1') return;
    g.dataset.marcaOn = '1';
    g.addEventListener('change', function (ev) {
      var alvo = ev.target;
      if (alvo && alvo.matches &&
          alvo.matches('.hour-label input[type="checkbox"]')) {
        pintar();
      }
    });
  }

  /**
   * Fita e backtest tambem vinham do gerador.
   *
   * A fita e facil: renderFita() chama resultados(), que e global. Troco a
   * funcao pela sequencia real de G/R do mercado escolhido, deixo ele desenhar
   * e devolvo — mesmo truque do grafico.
   *
   * O backtest monta a tabela por dentro e nao consulta nada, entao esse eu
   * remonto: hora do jogo, times, placar, odd, EV e o resultado pelo pagou().
   * O EV e a conta de verdade: (taxa historica x odd) - 1.
   */
  function alimentarFita(mkt) {
    if (typeof window.renderFita !== 'function') return;
    if (typeof window.resultados !== 'function') return;
    var seq = jogos.filter(function (j) { return j.resolvido; })
      .map(function (j) {
        var ok = false;
        try { ok = !!window.pagou(mkt, j); } catch (e) {}
        return ok ? 'G' : 'R';
      });
    if (!seq.length) return;
    var original = window.resultados;
    try {
      window.resultados = function (n) {
        return seq.slice(-Math.max(1, n || 30));
      };
      window.renderFita();
    } finally {
      window.resultados = original;
    }
  }

  function oddDoMercado(j, mkt) {
    var m = mkt.match(/over\s*([\d.]+)/i);
    if (m) return parseFloat(j.odds['odd_over_' + m[1]]);
    m = mkt.match(/under\s*([\d.]+)/i);
    if (m) return parseFloat(j.odds['odd_under_' + m[1]]);
    if (/ambas.*(sim|yes)/i.test(mkt)) return parseFloat(j.odds['odd_ambas_sim']);
    if (/ambas.*(n[a\u00e3]o|no)/i.test(mkt)) return parseFloat(j.odds['odd_ambas_nao']);
    if (/^(casa vence|casa ft)$/i.test(mkt)) {
      return parseFloat(j.odds['odd_resultado_final_casa']);
    }
    if (/^(fora vence|fora ft)$/i.test(mkt)) {
      return parseFloat(j.odds['odd_resultado_final_fora']);
    }
    if (/^(5\+|5\+\s*gols)$/i.test(mkt)) {
      return parseFloat(j.odds['odd_total_gols_extatos_5']);
    }
    return NaN;
  }

  function alimentarBacktest(mkt) {
    var alvo = document.getElementById('backtest');
    if (!alvo) return;
    var resolvidos = jogos.filter(function (j) { return j.resolvido; });
    if (resolvidos.length < 3) return;

    var pagos = 0;
    resolvidos.forEach(function (j) {
      try { if (window.pagou(mkt, j)) pagos++; } catch (e) {}
    });
    var taxa = pagos / resolvidos.length;

    var linhas = resolvidos.slice(-120).reverse().map(function (j) {
      var ok = false;
      try { ok = !!window.pagou(mkt, j); } catch (e) {}
      var odd = oddDoMercado(j, mkt);
      var ev = isNaN(odd) ? null : (taxa * odd - 1) * 100;
      return {
        hora: pad2(j.hora) + ':' + pad2(j.minuto),
        jogo: j.timeA + ' x ' + j.timeB,
        placar: j.placar || '',
        odd: isNaN(odd) ? '' : odd.toFixed(2),
        ev: ev,
        ok: ok
      };
    });

    // #backtest e um <tbody> de uma tabela que ja existe, com 7 colunas.
    // Eu injetava uma <table> inteira dentro dele — HTML invalido, e o painel
    // esticava pra 2.669px. Agora escrevo so as linhas, e a rolagem fica na
    // tabela, com o cabecalho original preservado.
    alvo.innerHTML = linhas.map(function (l) {
      var cor = l.ev == null ? '' : (l.ev >= 0 ? 'bt-pos' : 'bt-neg');
      return '<tr><td>' + l.hora + '</td><td>' + l.jogo + '</td>'
        + '<td>' + l.placar + '</td><td>' + l.odd + '</td>'
        + '<td class="' + cor + '">' + (l.ev == null ? '' :
            (l.ev >= 0 ? '+' : '') + l.ev.toFixed(1) + '%') + '</td>'
        + '<td class="' + (l.ok ? 'bt-pos' : 'bt-neg') + '">'
        + (l.ok ? '\u2713' : '\u2717') + '</td>'
        + '<td>' + liga + '</td></tr>';
    }).join('');

    var tab = alvo.closest('table');
    if (tab) tab.classList.add('bt-rolagem');
  }

  function rotularColunas(mapa, linhas, base, passo, mkt) {
    var cabecas = [].slice.call(document.querySelectorAll('#grade .grid-headrow'));
    var linhaPct = null, linhaGols = null;
    cabecas.forEach(function (h) {
      var lead = h.querySelector('.gh.lead, .lead');
      if (!lead) return;
      var t = lead.textContent.trim();
      if (t === '%') linhaPct = h;
      if (/GOLS/i.test(t)) linhaGols = h;
    });
    if (!linhaPct && !linhaGols) return;

    var nCols = 0;
    linhas.forEach(function (row) {
      var n = matches(row).length;
      if (n > nCols) nCols = n;
    });

    var pcts = [], golsCol = [];
    for (var c = 0; c < nCols; c++) {
      var pagou = 0, resolvidos = 0, gols = 0;
      linhas.forEach(function (row, r) {
        var hora = ((horaBase - r) % 24 + 24) % 24;
        var j = mapa[hora * 100 + (base + c * passo)];
        if (!j || !j.resolvido) return;
        resolvidos++;
        gols += (j.gh || 0) + (j.ga || 0);
        try { if (window.pagou(mkt, j)) pagou++; } catch (e) {}
      });
      pcts.push(resolvidos ? Math.round(pagou / resolvidos * 100) : null);
      golsCol.push(resolvidos ? gols : null);
    }

    escreverCabeca(linhaPct, pcts, true);
    escreverCabeca(linhaGols, golsCol, false);
  }

  function escreverCabeca(linha, valores, ehPct) {
    if (!linha) return;
    var cels = [].slice.call(linha.children).filter(function (c) {
      return !/lead/.test(c.className);
    });
    cels.forEach(function (c, i) {
      var v = valores[i];
      if (v == null) { c.textContent = ''; return; }
      c.textContent = ehPct ? (v + '%') : String(v);
      if (ehPct) {
        c.className = c.className.replace(/\s*(baixa|media|alta)/g, '');
        c.className += v >= 60 ? ' alta' : (v >= 35 ? ' media' : ' baixa');
      }
    });
  }

  function rotularHora(row, hora) {
    var p = row.previousElementSibling;
    while (p && !p.classList.contains('hour-label')) p = p.previousElementSibling;
    if (!p) return;
    var texto = p.querySelector('.hour-text');
    if (!texto) {
      texto = document.createElement('span');
      texto.className = 'hour-text';
      p.appendChild(texto);
    }
    texto.textContent = pad2(hora) + 'h';
  }

  /*
   * Percentual da HORA: jogos resolvidos que pagaram o mercado escolhido
   * dividido por todos os jogos resolvidos daquela linha. Jogos ainda azuis
   * não entram no denominador, então a linha em curso cresce jogo a jogo.
   */
  function rotularPercentualLinha(row, itens, mkt) {
    var alvo = row.querySelector('.row-pct');
    if (!alvo) return;

    var total = 0;
    var pagos = 0;
    (itens || []).forEach(function (j) {
      if (!j || !j.resolvido) return;
      total++;
      try {
        if (window.pagou(mkt, j)) pagos++;
      } catch (e) {}
    });

    alvo.className = 'row-pct';
    alvo.removeAttribute('data-pagos');
    alvo.removeAttribute('data-total');
    alvo.removeAttribute('data-taxa');
    if (!total) {
      alvo.textContent = '—';
      alvo.title = 'Nenhum jogo resolvido nesta hora';
      return;
    }

    var taxa = pagos / total * 100;
    alvo.textContent = taxa.toFixed(2).replace(/\.00$/, '') + '%';
    alvo.classList.add(taxa >= 60 ? 'alta' : (taxa >= 35 ? 'media' : 'baixa'));
    alvo.dataset.pagos = String(pagos);
    alvo.dataset.total = String(total);
    alvo.dataset.taxa = taxa.toFixed(2);
    alvo.title = pagos + '/' + total + ' pagaram ' + mkt + ' nesta hora';
  }

  function atualizarResumoGrade(mkt) {
    var resolvidos = jogosDaGrade.filter(function (j) { return j.resolvido; });
    var gols = 0;
    var pagos = 0;
    resolvidos.forEach(function (j) {
      gols += Number(j.gh || 0) + Number(j.ga || 0);
      try { if (window.pagou(mkt, j)) pagos++; } catch (e) {}
    });
    var total = resolvidos.length;
    var taxa = total ? pagos / total * 100 : 0;
    var taxaTexto = taxa.toFixed(2).replace(/\.00$/, '');

    var elGols = document.getElementById('gGols');
    var elMedia = document.getElementById('gMedia');
    var titulo = document.getElementById('gradeTitle');
    var destaque = document.getElementById('pctMercado');
    if (elGols) elGols.textContent = String(gols);
    if (elMedia) elMedia.textContent = total ? (gols / total).toFixed(2) : '—';
    if (titulo) titulo.textContent = 'Grade de jogos — ' + mkt;
    if (destaque) {
      destaque.innerHTML = mkt +
        ' — <b style="color:var(--green)">' + taxaTexto +
        '%</b> pagando · ' + total + ' jogos resolvidos · ' +
        (ehModo00() ? 'desde 00h' : horasDaGrade() + 'h');
    }
    atualizarMaximaNegativa(mkt);
    atualizarAlertaMercado(mkt);
  }

  function atualizarMaximaNegativa(mkt) {
    var alvo = document.getElementById('marketMaxima');
    if (!alvo) return;
    var resolvidos = jogosDaGrade.filter(function (j) {
      return j && j.resolvido;
    });
    if (!resolvidos.length) {
      alvo.textContent = 'Máxima negativa —';
      alvo.title = 'Aguardando resultados do mercado selecionado.';
      return;
    }
    var atual = 0;
    var maxima = 0;
    resolvidos.forEach(function (j) {
      var pagou = false;
      try { pagou = !!window.pagou(mkt, j); } catch (e) {}
      if (pagou) atual = 0;
      else {
        atual++;
        if (atual > maxima) maxima = atual;
      }
    });
    var periodo = ehModo00() ? '00h' : horasDaGrade() + 'h';
    alvo.textContent = 'Máxima negativa ' + maxima +
      (maxima === 1 ? ' jogo' : ' jogos') + ' · ' + periodo;
    alvo.title = 'Maior sequência sem pagar ' + mkt + ' na liga ' + liga +
      ' dentro do período ' + periodo + ' (' + resolvidos.length +
      ' jogos resolvidos).';
  }

  /* O Over 3.5 e os demais mercados adaptativos usam media × 0,70.
     Os outros Overs e Ambas usam piso absoluto de 35%.
     Exigimos 20 FT para não reagir a uma amostra pequena no começo da hora. */
  function normalDoMercado(mkt) {
    var normal = typeof window.normalDe === 'function'
      ? Number(window.normalDe(mkt)) : NaN;
    if (isFinite(normal) && normal >= 0) return normal;
    var base = jogos.filter(function (j) { return j && j.resolvido; });
    if (!base.length) return null;
    var pagos = 0;
    base.forEach(function (j) {
      try { if (window.pagou(mkt, j)) pagos++; } catch (e) {}
    });
    return pagos / base.length * 100;
  }

  function estatisticaUltimas3h(mkt) {
    var resolvidos = jogos.filter(function (j) {
      return j && j.resolvido && isFinite(Number(j.slot));
    });
    if (!resolvidos.length) return { total: 0, pagos: 0, taxa: null };
    var ultimo = resolvidos[resolvidos.length - 1];
    var proximo = null;
    jogos.some(function (j) {
      if (j && !j.resolvido && Number(j.slot) > Number(ultimo.slot)) {
        proximo = j;
        return true;
      }
      return false;
    });
    var fim = Number(proximo ? proximo.slot : ultimo.slot);
    var inicio = fim - 3 * 60 * 60 * 1000;
    var amostra = resolvidos.filter(function (j) {
      var slot = Number(j.slot);
      return slot >= inicio && slot <= fim;
    });
    var pagos = 0;
    amostra.forEach(function (j) {
      try { if (window.pagou(mkt, j)) pagos++; } catch (e) {}
    });
    return {
      total: amostra.length,
      pagos: pagos,
      taxa: amostra.length ? pagos / amostra.length * 100 : null
    };
  }

  function limiteDoAlerta(mkt, normal) {
    var nome = String(mkt || '').trim();
    var over35 = /^Over 3\.5(?:\s|$)/i.test(nome);
    var over = /^Over(?:\s|$)/i.test(nome);
    var ambas = /^Ambas(?:\s|$)/i.test(nome);
    if (!over35 && (over || ambas)) {
      return {
        valor: 35,
        descricao: 'O alerta dispara quando o pagamento fica abaixo de 35%.'
      };
    }
    return {
      valor: normal == null ? null : normal * 0.70,
      descricao: 'O alerta dispara quando a taxa fica pelo menos 30% abaixo da média.'
    };
  }

  function atualizarAlertaMercado(mkt) {
    var alvo = document.getElementById('marketLowAlert');
    if (!alvo) return;
    var normal = normalDoMercado(mkt);
    var st = estatisticaUltimas3h(mkt);
    var regra = limiteDoAlerta(mkt, normal);
    var limite = regra.valor;
    var amostraUtil = st.total >= 20;
    var disparou = amostraUtil && st.taxa != null && limite != null &&
      st.taxa < limite;
    var escopo = liga + '|' + mkt;

    alvo.hidden = !disparou;
    alvo.classList.toggle('is-active', disparou);
    if (disparou) {
      alvo.textContent = '🔔 ALERTA 3h · ' + st.taxa.toFixed(1) +
        '% · média ' + normal.toFixed(1) + '% · limite ' +
        limite.toFixed(1) + '%';
      alvo.title = st.pagos + '/' + st.total + ' pagaram nas últimas 3 horas. ' +
        regra.descricao;
      if (alertaMercadoAtivo !== escopo) {
        alertaMercadoAtivo = escopo;
        try {
          window.dispatchEvent(new CustomEvent('amd:market-low-alert', {
            detail: {
              liga: liga, mercado: mkt, taxa: st.taxa, normal: normal,
              limite: limite, pagos: st.pagos, total: st.total
            }
          }));
        } catch (e) {}
      }
    } else {
      alvo.textContent = '';
      alvo.removeAttribute('title');
      if (alertaMercadoAtivo === escopo) alertaMercadoAtivo = '';
    }
    window.__amdMarketLowAlert = {
      ativo: disparou, liga: liga, mercado: mkt, taxa: st.taxa,
      normal: normal, limite: limite, pagos: st.pagos, total: st.total
    };
  }

  function definirVisibilidadeLinha(row, ocultar) {
    if (!row) return;
    row.hidden = !!ocultar;
    var label = row.previousElementSibling;
    while (label && !label.classList.contains('hour-label'))
      label = label.previousElementSibling;
    if (label) label.hidden = !!ocultar;
  }

  function pintar() {
    if (pintando) return;
    if (typeof window.pagou !== 'function') return;
    pintando = true;
    try {
      var linhas = [].slice.call(document.querySelectorAll('#grade .gridrow'));
      if (!linhas.length) return;

      if (!jogos.length) {
        linhas.forEach(function (row) {
          matches(row).forEach(esvaziar);
          rotularPercentualLinha(row, [], mercadoAtual());
        });
        jogosDaGrade = [];
        atualizarResumoGrade(mercadoAtual());
        marcarBarra(false);
        if (typeof window.renderKpis === 'function') window.renderKpis();
        if (typeof window.renderRadar === 'function') window.renderRadar();
        if (typeof window.renderFita === 'function') window.renderFita();
        if (typeof window.renderBacktest === 'function') window.renderBacktest();
        if (typeof window.renderChart === 'function') window.renderChart();
        if (window.RankingGradeReal &&
            typeof window.RankingGradeReal.aplicarMarcacao === 'function') {
          window.RankingGradeReal.aplicarMarcacao();
        }
        return;
      }

      var mkt = mercadoAtual();
      var cfg = configDaLiga();
      var passo = cfg ? cfg.passo : cadencia(jogos);
      var base  = cfg ? cfg.ini   : minutoBase(jogos, passo);

      // Índice pelo instante absoluto do relógio do jogo. Usar só hora/minuto
      // colidia quando a grade atravessava a virada do dia.
      var mapa = {};
      jogos.forEach(function (j) {
        if (j.slot == null) return;
        var anterior = mapa[j.slot];
        if (!anterior || (j.resolvido && !anterior.resolvido) ||
            (j.resolvido === anterior.resolvido &&
             j.criadoTs >= anterior.criadoTs)) {
          mapa[j.slot] = j;
        }
      });

      /*
       * Ancora no próximo jogo após o último FT, não no sexto futuro. Ancorar
       * no futuro mais distante adiantava a grade até uma hora e fazia 3h
       * contar uma linha vazia, expulsando uma hora real do rank/gráfico.
       */
      var topoHoraSlot = topoHoraDoJogo();
      if (topoHoraSlot == null || !isFinite(topoHoraSlot)) return;
      horaBase = new Date(topoHoraSlot).getUTCHours();
      var somenteDia = ehModo00();
      var inicioDiaSlot = topoHoraSlot - horaBase * 60 * 60 * 1000;
      var fimDiaSlot = inicioDiaSlot + 24 * 60 * 60 * 1000;

      var usados = 0;
      var porLinha = [];
      var limiteLinhas = Math.min(horasDaGrade(), linhas.length);
      linhas.forEach(function (row, r) {
        var inicioLinha = topoHoraSlot - r * 60 * 60 * 1000;
        definirVisibilidadeLinha(row, somenteDia &&
          (inicioLinha < inicioDiaSlot || inicioLinha >= fimDiaSlot));
        var hora = new Date(inicioLinha).getUTCHours();
        porLinha[r] = [];
        matches(row).forEach(function (el, c) {
          var slot = inicioLinha + (base + c * passo) * 60000;
          var j = mapa[slot];
          if (!j) { esvaziar(el); return; }
          preencher(el, j, mkt);
          porLinha[r][c] = j;
          usados++;
        });
        rotularPercentualLinha(row, porLinha[r], mkt);
        rotularHora(row, hora);
      });

      // O gráfico consome exatamente as células reais e linhas habilitadas.
      jogosDaGrade = [];
      /*
       * O app desenha uma linha extra para completar a borda do período. Ela
       * fica visível, mas 3h/6h/etc. devem usar exatamente as N primeiras
       * linhas, igual ao ranking e às porcentagens por coluna.
      */
      limiteLinhas = Math.min(horasDaGrade(), porLinha.length);
      for (var rr = porLinha.length - 1; rr >= 0; rr--) {
        if (somenteDia ? linhas[rr].hidden : rr >= limiteLinhas) continue;
        var label = linhas[rr].previousElementSibling;
        while (label && !label.classList.contains('hour-label'))
          label = label.previousElementSibling;
        var check = label && label.querySelector('input[type="checkbox"]');
        if (check && !check.checked) continue;
        (porLinha[rr] || []).forEach(function (j, cc) {
          if (!j) return;
          jogosDaGrade.push(Object.assign({}, j, {
            gradeLinha: rr, gradeColuna: cc
          }));
        });
      }

      rotularMinutos(base, passo);
      /*
       * O cabeçalho %/GOLS é calculado por maxima.js, que respeita exatamente
       * o período e o mercado selecionados. Escrever aqui também fazia este
       * módulo substituir o valor exato por um arredondamento de 0–100%.
       */
      rotularLiga();
      atualizarResumoGrade(mkt);
      alimentarGrafico();
      if (typeof window.renderKpis === 'function') window.renderKpis();
      if (typeof window.renderRadar === 'function') window.renderRadar();
      alimentarFita(mkt);
      alimentarBacktest(mkt);
      marcarBarra(true, usados, passo);
      /* Reaplica imediatamente as seleções depois de atualizar o conteúdo. */
      if (window.RankingGradeReal &&
          typeof window.RankingGradeReal.aplicarMarcacao === 'function') {
        window.RankingGradeReal.aplicarMarcacao();
      }
      try {
        window.dispatchEvent(new CustomEvent('amd:grade-data', {
          detail: {
            liga: liga, mercado: mkt, jogos: jogosDaGrade.length,
            atualizadoEm: ultimaBusca
          }
        }));
      } catch (e) {}
    } catch (e) {
      console.warn('[real] pintar:', e);
    } finally {
      setTimeout(function () { pintando = false; }, 120);
    }
  }

  /**
   * Celula sem jogo real fica VAZIA de verdade. Antes eu apagava so o placar e
   * deixava o nome que o gerador tinha escrito — por isso sobrava time
   * brasileiro numa grade da premier, parecendo jogo inventado.
   */
  function esvaziar(el) {
    el.classList.remove('pay', 'nopay');
    el.classList.add('neutral');
    [].slice.call(el.querySelectorAll('.tm')).forEach(function (tm) {
      var rk = tm.querySelector('.rk');
      while (tm.firstChild) tm.removeChild(tm.firstChild);
      if (rk) { rk.textContent = ''; tm.appendChild(rk); }
      tm.removeAttribute('title');
      tm.removeAttribute('data-team');
    });
    var ht = el.querySelector('.htline');
    if (ht) ht.textContent = '';
    var sc = el.querySelector('.score');
    if (sc) sc.textContent = '';
    [].slice.call(el.querySelectorAll('.od')).forEach(function (o) {
      rotuloDaOdd(o);          // guarda o rotulo ANTES de limpar
      o.textContent = '';
      o.removeAttribute('data-odd');
    });
    el.removeAttribute('title');
    el.removeAttribute('data-real');
    el.removeAttribute('data-game-id');
    el.removeAttribute('data-slot');
    el.__realJogo = null;
  }

  function preencher(el, j, mkt) {
    // times
    var tms = [].slice.call(el.querySelectorAll('.tm'));
    if (tms[0]) escreverTime(tms[0], j.timeA);
    if (tms[1]) escreverTime(tms[1], j.timeB);

    // placar
    // O "A SAIR" do gerador ficava por cima do placar que eu escrevia.
    // A .htline passa a mostrar o HT de verdade.
    var linhaHt = el.querySelector('.htline');
    if (linhaHt) {
      linhaHt.textContent = htLigado() && j.placarHT
        ? 'HT ' + j.placarHT : '';
    }
    var sc = el.querySelector('.score');
    if (sc) sc.textContent = j.placar || '\u2014';

    // odds reais nos mesmos rótulos que o card já usa
    [].slice.call(el.querySelectorAll('.od')).forEach(function (o) {
      var rot = rotuloDaOdd(o);
      var ch = chaveDaOdd(rot);
      var v = ch ? j.odds[ch] : null;
      o.textContent = rot;
      o.removeAttribute('data-odd');
      if (v == null || v === '') return;
      var num = parseFloat(v);
      if (isNaN(num)) return;
      o.dataset.odd = num.toFixed(2);
      o.textContent = rot + ' @' + num.toFixed(2);
    });

    // pagou / não pagou, pela própria função do app
    el.classList.remove('pay', 'nopay', 'neutral');
    if (!j.resolvido) { el.classList.add('neutral'); }
    else {
      var ok = false;
      try { ok = !!window.pagou(mkt, j); } catch (e) { ok = false; }
      el.classList.add(ok ? 'pay' : 'nopay');
    }

    el.dataset.real = '1';
    el.dataset.gameId = j.id || chaveJogo(j);
    el.dataset.slot = String(j.slot);
    el.__realJogo = j;
    el.title = j.timeA + ' x ' + j.timeB + '  ' + (j.placar || '—')
      + (j.placarHT ? '  (HT ' + j.placarHT + ')' : '')
      + '  ·  ' + pad2(j.hora) + ':' + pad2(j.minuto);
  }

  /**
   * Nome inteiro nao cabe em celula de 60px e come o rank. Abrevia em 3
   * letras, igual a grade de referencia, e guarda o nome cheio no title.
   */
  function abreviar(nome) {
    var s = String(nome || '').trim();
    if (!s) return '';
    var partes = s.split(/[\s\-]+/).filter(Boolean);
    if (partes.length > 1) {
      return partes.map(function (p) { return p.charAt(0); })
        .join('').slice(0, 3).toUpperCase();
    }
    return s.slice(0, 3).toUpperCase();
  }

  function escreverTime(tm, nome) {
    var rk = tm.querySelector('.rk');
    var nomeNovo = String(nome || '').trim();
    var nomeAtual = String(tm.dataset.team || tm.title || '').trim();

    // O poll repinta os mesmos jogos a cada poucos segundos. Quando o time
    // continua na mesma célula e o rank já é real, não toca no conteúdo:
    // maxima.js mantém exatamente o mesmo cálculo e o número não pisca.
    if (rk && rk.classList.contains('rank-real') && nomeAtual === nomeNovo) {
      tm.title = nome;
      tm.dataset.team = nome;
      return;
    }

    while (tm.firstChild) tm.removeChild(tm.firstChild);
    tm.appendChild(document.createTextNode(abreviar(nome)));
    if (rk) {
      // Só descarta o rank de demonstração quando a célula/time realmente
      // mudou. A fórmula e a ordem do ranking permanecem em maxima.js.
      rk.textContent = '';
      rk.className = 'rk';
      rk.removeAttribute('title');
      tm.appendChild(rk);
    }
    tm.title = nome;
    tm.dataset.team = nome;
  }

  /**
   * O titulo da grade e o "Liga X" sao do gerador do app e nao sabem de qual
   * liga vieram os dados. Sem isto, o cabecalho dizia "Copa" com jogo da
   * express embaixo — parecia dado inventado, era so rotulo desencontrado.
   */
  function rotularLiga() {
    var nome = liga.charAt(0).toUpperCase() + liga.slice(1);
    [].slice.call(document.querySelectorAll('span, b, div'))
      .forEach(function (e) {
        if (e.children.length) return;
        var t = (e.textContent || '').trim();
        if (/^(Express|Copa|Super|Euro|Premier)$/i.test(t) && t.toLowerCase() !== liga)
          e.textContent = nome;
      });
  }

  /**
   * O grafico de linha vinha do gerador e nao tinha relacao com a grade.
   * O renderChart() do app chama serie() uma vez; entao troco serie() pela
   * taxa real de acerto do mercado escolhido, deixo ele desenhar, e devolvo
   * a funcao. Mesmo truque do acumulado — por isso respeito o modo dele:
   * se o usuario estiver na aba Acumulado, nao mexo.
   */
  function alimentarGrafico() {
    if (window.GraficoReal &&
        typeof window.GraficoReal.atualizar === 'function') {
      window.GraficoReal.atualizar();
      return;
    }
    if (typeof window.renderChart === 'function') window.renderChart();
  }

  function janelaGrafico() {
    var a = document.querySelector('#qtd .active');
    var n = a ? parseInt((a.textContent || '').replace(/\D/g, ''), 10) : 20;
    return Math.max(2, isNaN(n) ? 20 : n);
  }

  // ─────────────────────────────────────────────────────────────
  //  4. BARRA: seletor de liga + estado
  // ─────────────────────────────────────────────────────────────
  function marcarBarra(ok, usados, passo) {
    var tag = document.querySelector('#realBar .rb-tag');
    var inf = document.querySelector('#realBar .rb-info');
    if (tag) {
      tag.classList.toggle('rb-off', !ok || !jogos.length);
      tag.textContent = (ok && jogos.length) ? 'dados reais' : 'sem dados';
    }
    if (inf) {
      inf.textContent = jogos.length + ' jogos · ' + liga
        + (passo ? ' · 1/' + passo + 'min' : '')
        + (usados != null ? ' · ' + usados + ' na grade' : '');
    }
  }

  function sincronizarBotoesLiga() {
    if (typeof window.definirLigaApp === 'function') {
      window.definirLigaApp(liga);
    }
    [].slice.call(document.querySelectorAll('#realBar .tab')).forEach(function (b) {
      b.classList.toggle('active', b.textContent.trim().toLowerCase() === liga);
    });
    [].slice.call(document.querySelectorAll('#leagues .tab')).forEach(function (b) {
      var nome = String(b.dataset.v || b.textContent || '').trim().toLowerCase();
      b.classList.toggle('active', nome === liga);
    });
    var ativa = document.getElementById('ligaAtiva');
    if (ativa) ativa.textContent = liga.charAt(0).toUpperCase() + liga.slice(1);
  }

  function trocarLiga(novaLiga) {
    var nova = String(novaLiga || '').trim().toLowerCase();
    if (LIGAS.indexOf(nova) < 0) return Promise.resolve(false);
    if (typeof window.definirLigaApp === 'function') {
      window.definirLigaApp(nova);
    }
    if (nova === liga && jogos.length) {
      sincronizarBotoesLiga();
      pintar();
      return Promise.resolve(true);
    }
    liga = nova;
    ligaFonteAtual = nova;
    localStorage.setItem(LS_LIGA, liga);
    jogos = [];
    jogosDaGrade = [];
    sincronizarBotoesLiga();
    pintar();
    return buscar().then(function (ok) {
      if (ok) pintar();
      return ok;
    });
  }

  function criarBarra() {
    if (document.getElementById('realBar')) return true;
    var horas = document.getElementById('horas');
    var barra = horas && horas.parentElement;
    if (!barra) return false;

    var wrap = document.createElement('div');
    wrap.id = 'realBar';

    var tag = document.createElement('span');
    tag.className = 'rb-tag rb-off';
    tag.textContent = 'sem dados';
    wrap.appendChild(tag);

    var sel = document.createElement('div');
    sel.className = 'tabrow';
    LIGAS.forEach(function (l) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'tab sm' + (l === liga ? ' active' : '');
      b.textContent = l;
      b.addEventListener('click', function () {
        trocarLiga(l);
      });
      sel.appendChild(b);
    });
    wrap.appendChild(sel);

    var inf = document.createElement('span');
    inf.className = 'rb-info';
    wrap.appendChild(inf);

    barra.appendChild(wrap);
    sincronizarBotoesLiga();
    return true;
  }

  // ─────────────────────────────────────────────────────────────
  //  5. CICLO
  //  O app redesenha a grade sozinho (troca de mercado, de hora, tick).
  //  O observer repinta por cima assim que ele termina.
  // ─────────────────────────────────────────────────────────────
  function observar() {
    var g = document.getElementById('grade');
    if (!g || obs) return;
    var deb = null;
    obs = new MutationObserver(function () {
      if (pintando) return;
      clearTimeout(deb);
      deb = setTimeout(function () {
        pintar();
      }, 200);
    });
    obs.observe(g, { childList: true, subtree: true });
  }

  function programarBusca(ms) {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(cicloBusca, ms);
  }

  /*
   * Um único ciclo, sem requisições sobrepostas. O próximo poll só começa
   * depois que o anterior terminou; com isso nenhuma resposta válida é
   * descartada por outro timer concorrente.
   */
  function cicloBusca() {
    buscar().then(function (ok) {
      if (ok) pintar();
    }).then(function () {
      programarBusca(authBloqueada ? 30000 : 2000);
    });
  }

  function buscarAgora() {
    programarBusca(0);
  }

  function iniciar() {
    var st = document.createElement('style');
    st.id = 'real-css';
    st.textContent = CSS;
    document.head.appendChild(st);

    var n = 0;
    var t = setInterval(function () {
      if (criarBarra() || ++n > 40) {
        clearInterval(t);
        observar();
        ligarMarcacao();
        pintar(); // remove imediatamente qualquer conteúdo visual de demonstração
        buscarAgora();
      }
    }, 250);

    window.Real = {
      buscar: buscar, pintar: pintar, jogos: function () { return jogos; },
      gradeJogos: function () { return jogosDaGrade.slice(); },
      horaAtual: horaDoJogoAgora,
      agoraSlot: function () { var a = ancoraDoRelogio(); return a ? Number(a.slot) : null; },
      liga: function () { return liga; },
      trocarLiga: trocarLiga,
      normalizarPartidas: normalizarPartidas,
      atualizacaoAutomatica: true,
      ultimaAtualizacao: function () { return ultimaBusca; }
    };

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) buscarAgora();
    });
    window.addEventListener('focus', buscarAgora);
  /* ------------------------------------------------------------
     ATUALIZACAO PERIODICA
     Antes daqui, buscarAgora() so era chamado em tres momentos:
     no carregamento (l.1088), no visibilitychange (l.1103) e no
     focus da janela (l.1105). Nenhum temporizador.

     Resultado: com a aba aberta e em foco, a grade desenhava uma
     vez e congelava. Os jogos entravam no banco normalmente, mas
     a tela so buscava de novo se o usuario trocasse de janela e
     voltasse, ou desse F5. Quanto mais tempo aberta, mais para
     tras ficava - foi isso que aparecia como 'chega 2 jogos
     atrasado'.

     O ciclo principal já consulta nosso banco em poucos segundos. Este
     intervalo de 20s é apenas um watchdog para recuperar uma aba cujo timer
     tenha sido suspenso pelo navegador. Não chama a RapidAPI.
     ------------------------------------------------------------ */
  setInterval(function () {
    if (!document.hidden) buscarAgora();
  }, 20000);
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
  /* ------------------------------------------------------------
     MODO 00h

     Os outros botoes contam N horas para tras a partir de agora,
     atravessando a virada da meia-noite. O 00h nao: ele conta so
     o DIA ATUAL do relogio do jogo, de 00:00 ate o momento.

     Como a grade desenha uma linha por hora cheia, basta informar
     'hora atual do jogo + 1' e as linhas saem exatamente 00, 01,
     ... ate a hora corrente. Na virada da meia-noite o valor cai
     para 1 sozinho e a grade recomeca.

     A hora do jogo e lida do ultimo jogo carregado, nao do relogio
     do computador: o relogio do jogo corre adiantado em relacao ao
     local, e o corte tem que ser o que aparece na grade.

     Esta declaracao de horasDaGrade substitui a anterior: em
     JavaScript, quando duas funcoes tem o mesmo nome no mesmo
     escopo, vale a ultima.
     ------------------------------------------------------------ */

  function ehModo00() {
    var a = document.querySelector('#horas .active');
    if (!a) return false;
    return /^0*0\s*h/i.test((a.textContent || '').trim());
  }

  function horaDoJogoAgora() {
    if (!jogos || !jogos.length) return null;
    for (var i = jogos.length - 1; i >= 0; i--) {
      var p = String(jogos[i].horario || '').split(/[.:]/)[0];
      var n = parseInt(p, 10);
      if (!isNaN(n) && n >= 0 && n <= 23) return n;
    }
    return null;
  }

  function horasDaGrade() {
    var a = document.querySelector('#horas .active');
    var txt = a ? (a.textContent || '').trim() : '';
    if (/^0*0\s*h/i.test(txt)) {
      var h = horaDoJogoAgora();
      /* sem dado ainda: busca o dia inteiro e ajusta na proxima volta */
      return h === null ? 24 : Math.min(h + 1, 24);
    }
    var n = a ? parseInt(txt.replace(/\D/g, ''), 10) : 48;
    return Math.min(isNaN(n) ? 48 : n, 168);
  }

  /* trocar de faixa refaz a busca na hora, sem esperar o ciclo */
  document.addEventListener('click', function (ev) {
    var b = (ev.target && ev.target.closest) ? ev.target.closest('#horas .tab') : null;
    if (b) setTimeout(buscarAgora, 60);
  });
  /* ------------------------------------------------------------
     CORRECAO: a versao acima lia j.horario, que nao existe.
     O objeto normalizado deste arquivo guarda a hora em 'hora'
     (numero inteiro) e o minuto em 'minuto'. Verifiquei ao vivo:
     com 505 jogos carregados, 'horario' vinha vazio e o modo 00h
     caia no fallback de 24h.

     Vale esta declaracao: em JavaScript, entre duas funcoes de
     mesmo nome no mesmo escopo, prevalece a ultima.
     ------------------------------------------------------------ */
  function ancoraDoRelogio() {
    if (!jogos || !jogos.length) return null;
    var ultimoResolvido = null;
    var proximo = null;
    for (var i = 0; i < jogos.length; i++) {
      var jogo = jogos[i];
      if (!jogo || !isFinite(Number(jogo.slot))) continue;
      if (jogo.resolvido && (!ultimoResolvido ||
          Number(jogo.slot) > Number(ultimoResolvido.slot))) ultimoResolvido = jogo;
    }
    for (var p = 0; p < jogos.length; p++) {
      var futuro = jogos[p];
      if (!futuro || futuro.resolvido || !ultimoResolvido) continue;
      if (Number(futuro.slot) > Number(ultimoResolvido.slot) &&
          (!proximo || Number(futuro.slot) < Number(proximo.slot))) proximo = futuro;
    }
    /*
     * A lista de futuros vem do fornecedor em um ciclo mais espaçado que os
     * resultados. Exatamente na virada da hora pode não existir `proximo`
     * ainda, embora o último FT já permita saber que o próximo tiro será três
     * minutos depois. Sem esta previsão, a linha 18h, por exemplo, só aparecia
     * no próximo ciclo de futuros.
     *
     * A previsão é somente uma âncora visual: não inventa partida, placar,
     * time ou odd. As células continuam azuis até o dado real entrar no banco
     * e, portanto, não participam de percentual, ranking ou gráfico.
     */
    if (proximo) return proximo;
    if (ultimoResolvido && isFinite(Number(ultimoResolvido.slot))) {
      var cfg = configDaLiga();
      var passo = cfg && isFinite(Number(cfg.passo))
        ? Number(cfg.passo) : cadencia(jogos);
      passo = Math.max(1, passo || 3);
      var slotPrevisto = Number(ultimoResolvido.slot) + passo * 60000;
      var dataPrevista = new Date(slotPrevisto);
      return {
        slot: slotPrevisto,
        hora: dataPrevista.getUTCHours(),
        minuto: dataPrevista.getUTCMinutes(),
        resolvido: false,
        previsto: true
      };
    }
    return ultimoResolvido || jogos[0];
  }

  function topoHoraCruDoJogo() {
    var ancora = ancoraDoRelogio();
    if (!ancora) return null;
    var slot = Number(ancora.slot);
    var minuto = parseInt(ancora.minuto, 10) || 0;
    if (isFinite(slot)) return slot - minuto * 60000;
    return null;
  }

  function topoHoraDoJogo() {
    var cru = topoHoraCruDoJogo();
    var anterior = Number(topoHoraEstavelPorLiga[liga]);
    if (!isFinite(cru)) return isFinite(anterior) ? anterior : null;
    if (!isFinite(anterior) || cru > anterior) {
      topoHoraEstavelPorLiga[liga] = cru;
      return cru;
    }
    return anterior;
  }

  function horaDoJogoAgora() {
    var slot = topoHoraDoJogo();
    var n = slot != null && isFinite(slot)
      ? new Date(slot).getUTCHours() : null;
    return isFinite(n) && n >= 0 && n <= 23 ? n : null;
  }
  /* ------------------------------------------------------------
     GOLS DA LINHA

     Mesma logica do percentual da hora, com a soma de gols dos
     jogos ja resolvidos daquela linha exibida logo abaixo, com G
     maiusculo. Jogo ainda em aberto nao entra, entao a linha em
     curso cresce conforme os resultados chegam - igual ao
     percentual, e no mesmo ciclo de atualizacao.

     Vale esta declaracao: entre duas funcoes de mesmo nome no
     mesmo escopo, o JavaScript usa a ultima.
     ------------------------------------------------------------ */
  function rotularPercentualLinha(row, itens, mkt) {
    var alvo = row.querySelector('.row-pct');
    if (!alvo) return;

    var total = 0;
    var pagos = 0;
    var gols = 0;
    (itens || []).forEach(function (j) {
      if (!j || !j.resolvido) return;
      total++;
      gols += Number(j.gh || 0) + Number(j.ga || 0);
      try { if (window.pagou(mkt, j)) pagos++; } catch (e) {}
    });

    alvo.className = 'row-pct';
    alvo.removeAttribute('data-pagos');
    alvo.removeAttribute('data-total');
    alvo.removeAttribute('data-taxa');

    if (!total) {
      alvo.textContent = '\u2014';
      alvo.title = 'Nenhum jogo resolvido nesta hora';
      return;
    }

    var taxa = pagos / total * 100;

    alvo.textContent = '';
    var elPct = document.createElement('div');
    elPct.className = 'row-taxa';
    elPct.textContent = taxa.toFixed(2).replace(/\.00$/, '') + '%';
    var elGols = document.createElement('div');
    elGols.className = 'row-gols';
    elGols.textContent = 'G ' + gols;
    var elGreens = document.createElement('div');
    elGreens.className = 'row-greens';
    elGreens.textContent = 'GREEN ' + pagos;
    alvo.appendChild(elPct);
    alvo.appendChild(elGols);
    alvo.appendChild(elGreens);

    alvo.classList.add(taxa >= 60 ? 'alta' : (taxa >= 35 ? 'media' : 'baixa'));
    alvo.dataset.pagos = String(pagos);
    alvo.dataset.total = String(total);
    alvo.dataset.taxa = taxa.toFixed(2);
    alvo.title = pagos + '/' + total + ' pagaram ' + mkt +
      ' nesta hora \u00b7 ' + gols + ' gols em ' + total + ' jogos';
  }
})();
