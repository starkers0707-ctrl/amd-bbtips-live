/* ============================================================================
 * GRAFICO REAL — janela móvel da grade + acumulado do relógio do jogo
 * ============================================================================
 * Este arquivo não desenha o gráfico e não instala hover. Ele entrega ao
 * app.js uma série real e um contexto alinhado, ponto a ponto. Assim, o mesmo
 * renderizador do painel continua responsável pela estética, MACD, LTA/LTB,
 * Fibonacci, médias, mira e informações do jogo.
 * ========================================================================== */
(function (root) {
  'use strict';

  var API = 'https://amd-coletor.onrender.com';
  var JOGOS_HORA = 20; // ligas deste painel: um jogo a cada três minutos
  /* O histórico já vem do PostgreSQL do coletor. Jogos recém-finalizados entram
     por Real.jogos(), então não precisamos baixar 24â€“73h novamente a cada 15s. */
  var CACHE_MS = 5 * 60 * 1000;
  var CACHE_COMPARATIVO_MS = 2 * 60 * 1000;
  var TIMEOUT_MS = 10000;
  var LS_MODO = 'amd_modograf';
  var LS_FAIXA = 'amd_faixaacum';
  var LS_REPLAY_DIA = 'amd_replay_dia';
  var LIGAS_COMPARATIVO = [
    { id: 'ita', nome: 'ITA', cor: '#ff343d' }, { id: 'eng', nome: 'ENG', cor: '#32a4ff' },
    { id: 'spa', nome: 'SPA', cor: '#ffd400' }, { id: 'mnd', nome: 'MND', cor: '#18e34d' },
    { id: 'bra', nome: 'BRA', cor: '#b466ff' }, { id: 'lat', nome: 'LAT', cor: '#15c9d8' },
    { id: 'cam', nome: 'CAM', cor: '#ff9d00' }, { id: 'cop', nome: 'COP', cor: '#ff6b9a' },
    { id: 'ame', nome: 'AME', cor: '#e7edf1' }
  ];
  var FAIXAS = [
    ['h3', '3h', 3],
    ['h6', '6h', 6],
    ['h12', '12h', 12],
    ['h18', '18h', 18],
    ['h24', '24h', 24],
    ['dia', 'desde 00h', 0]
  ];

  var modoSalvo = lerLocal(LS_MODO);
  var modoAtual = modoSalvo === 'acum' || modoSalvo === 'replay' || modoSalvo === 'ligas'
    ? modoSalvo : 'janela';
  var faixaAtual = lerLocal(LS_FAIXA) || 'dia';
  var replayDia = Math.max(1, Math.min(7, parseInt(lerLocal(LS_REPLAY_DIA), 10) || 1));
  var cachePorLiga = Object.create(null);
  var voosPorLiga = Object.create(null);
  var tentativaPorLiga = Object.create(null);
  var ultimoContexto = [];
  var ultimoPacote = null;
  var renderAgendado = 0;
  var observerGrade = null;
  var timerGrade = 0;

  var CSS = ''
    + '#grafmodo{display:flex;gap:5px;align-items:center;flex-wrap:wrap}'
    + '#acumBar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;'
    + 'margin:2px 0 8px;font-size:12px}'
    + '#acumBar .acum-dir{margin-left:auto;color:#5a6b78}'
    + '#acumBar .acum-dir b{color:#e7edf1}'
    + '#acumBar .acum-status{color:#8fa3ad}'
    + '#acumBar.replay-bar{padding:7px 9px;border:1px solid #173847;'
    + 'border-radius:8px;background:#06171e}'
    + '#acumBar .replay-data{color:#29dfff;font-weight:700}';

  function lerLocal(chave) {
    try { return localStorage.getItem(chave); } catch (e) { return null; }
  }

  function gravarLocal(chave, valor) {
    try { localStorage.setItem(chave, valor); } catch (e) {}
  }

  function pad2(n) {
    n = parseInt(n, 10);
    return (n < 10 ? '0' : '') + n;
  }

  function numero(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function placar(v) {
    var m = String(v == null ? '' : v).match(/(\d+)\s*[-x:]\s*(\d+)/i);
    return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : null;
  }

  function ligaAtual() {
    if (root.Real && typeof root.Real.liga === 'function') {
      return String(root.Real.liga() || 'copa').toLowerCase();
    }
    return String(lerLocal('amd_liga') || 'copa').toLowerCase();
  }

  function mercadoDaGrade() {
    if (typeof root.mercadoGraficoAtual === 'function') {
      var selecionado = root.mercadoGraficoAtual();
      if (selecionado) return String(selecionado);
    }
    var botao = document.getElementById('cmktBtn') ||
      document.getElementById('mktBtn');
    var texto = botao ? botao.textContent : '';
    return String(texto || 'Over 2.5')
      .replace(/Mercado:\s*/i, '')
      .replace(/[\u2304\u02c5\u25be\u25bc]/g, '')
      .trim() || 'Over 2.5';
  }

  function janelaSelecionada() {
    var ativo = document.querySelector('#qtd .active');
    var n = ativo ? parseInt(String(ativo.textContent).replace(/\D/g, ''), 10) : NaN;
    return Math.max(2, isNaN(n) ? 20 : n);
  }

  function horasSelecionadas() {
    var ativo = document.querySelector('#horas .active');
    var n = ativo ? parseInt(String(ativo.textContent).replace(/\D/g, ''), 10) : NaN;
    return Math.max(1, isNaN(n) ? 6 : n);
  }

  function normalizarJogo(p, origem, ordem) {
    if (!p) return null;

    var ftLido = placar(p.resultado_ft || p.placar || p.ft || p.FT);
    /* Real.gradeJogos() entrega o intervalo como placarHT. Quando a API marca
       3+ gols no primeiro tempo, esse campo vem como "OUT" (sem hh/ha). Se o
       alias nao for preservado, o grafico converte o jogo para 0-0 e o OUT HT
       fica em 0%, embora a grade conte o green corretamente. */
    var htTexto = p.resultado_ht || p.placar_ht || p.ht_placar ||
      p.placarHT || p.HT || p.ht || '';
    var htLido = placar(htTexto);
    var gh = numero(p.gh);
    var ga = numero(p.ga);
    var hh = numero(p.hh);
    var ha = numero(p.ha);

    if (gh === null) gh = numero(p.gols_a);
    if (ga === null) ga = numero(p.gols_b);
    if (hh === null && htLido) hh = htLido[0];
    if (ha === null && htLido) ha = htLido[1];
    if (gh === null && ftLido) gh = ftLido[0];
    if (ga === null && ftLido) ga = ftLido[1];

    var relogio = String(p.rotulo || p.horario || p.hora_jogo || '');
    var hm = relogio.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
    var hora = numero(p.hora);
    var minuto = numero(p.minuto);
    if (hora === null && hm) hora = parseInt(hm[1], 10);
    if (minuto === null && hm) minuto = parseInt(hm[2], 10);
    if (hora === null || minuto === null) return null;
    hora = ((Math.floor(hora) % 24) + 24) % 24;
    minuto = ((Math.floor(minuto) % 60) + 60) % 60;

    var ftTexto = p.resultado_ft || p.placar || p.ft || p.FT || '';
    var resolvido = typeof p.resolvido === 'boolean'
      ? p.resolvido
      : String(ftTexto).trim() !== '';
    if (!resolvido || gh === null || ga === null) return null;

    if (hh === null) hh = 0;
    if (ha === null) ha = 0;

    var criado = p.criado_em || p.criado || p.data || p.timestamp || null;
    var ts = criado ? Date.parse(criado) : NaN;
    var rotulo = pad2(hora) + ':' + pad2(minuto);
    var slotAbs = numero(p.slot);
    if (slotAbs === null) {
      var slotInformado = Date.parse(p.slot_em || '');
      if (!isNaN(slotInformado)) slotAbs = slotInformado;
    }
    if (slotAbs === null && !isNaN(ts)) {
      var ref = new Date(ts);
      slotAbs = Date.UTC(
        ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(),
        hora, minuto, 0, 0
      );
      while (slotAbs - ts > 12 * 60 * 60 * 1000) slotAbs -= 24 * 60 * 60 * 1000;
      while (ts - slotAbs > 12 * 60 * 60 * 1000) slotAbs += 24 * 60 * 60 * 1000;
    }

    return {
      gh: gh,
      ga: ga,
      hh: hh,
      ha: ha,
      hora: hora,
      minuto: minuto,
      rotulo: rotulo,
      slot: rotulo,
      slotAbs: slotAbs,
      timeA: String(p.timeA || p.time_a || p.casa || p.a || ''),
      timeB: String(p.timeB || p.time_b || p.fora || p.b || ''),
      ft: String(ftTexto || (gh + '-' + ga)),
      ht: String(htTexto || (hh + '-' + ha)),
      odds: p.odds || {},
      criado: criado,
      ts: isNaN(ts) ? null : ts,
      origem: origem || 'desconhecida',
      ordem: ordem || 0,
      resolvido: true
    };
  }

  function normalizarLista(lista, origem) {
    var out = [];
    (Array.isArray(lista) ? lista : []).forEach(function (p, i) {
      var jogo = normalizarJogo(p, origem, i);
      if (jogo) out.push(jogo);
    });
    return out;
  }

  /*
   * O instante absoluto evita que, num histórico de 24h, 17:01 de ontem seja
   * confundido com 17:01 de hoje. A fonte Real vence a cópia do histórico
   * porque é a que acabou de ser atualizada na tela.
   */
  function deduplicarResolvidos(lista) {
    var out = [];
    var posicao = Object.create(null);

    lista.forEach(function (jogo) {
      if (!jogo || !jogo.resolvido || !jogo.slot) return;
      var chave = jogo.slotAbs !== null
        ? String(jogo.slotAbs)
        : [jogo.slot, jogo.timeA, jogo.timeB].join('|');
      var pos = posicao[chave];
      if (pos === undefined) {
        posicao[chave] = out.length;
        out.push(jogo);
        return;
      }

      var anterior = out[pos];
      var realVence = jogo.origem === 'real' && anterior.origem !== 'real';
      var maisNovo = jogo.ts !== null &&
        (anterior.ts === null || jogo.ts >= anterior.ts);
      if (realVence || maisNovo) out[pos] = jogo;
    });

    /*
     * criado_em acompanha a ordem real do provedor e resolve corretamente a
     * virada 23h -> 00h. Sem timestamp, preservamos a ordem recebida.
     */
    out.sort(function (a, b) {
      if (a.slotAbs !== null && b.slotAbs !== null && a.slotAbs !== b.slotAbs)
        return a.slotAbs - b.slotAbs;
      if (a.ts !== null && b.ts !== null && a.ts !== b.ts) return a.ts - b.ts;
      return a.ordem - b.ordem;
    });
    return out;
  }

  function jogosDaGrade() {
    if (!root.Real) return [];
    var lista = [];
    var temFonteDaGrade = typeof root.Real.gradeJogos === 'function';

    try {
      if (temFonteDaGrade) lista = root.Real.gradeJogos() || [];
      else if (typeof root.Real.jogos === 'function') lista = root.Real.jogos() || [];
    } catch (e) {
      console.warn('[GraficoReal] grade:', e.message);
      return [];
    }

    var jogos = deduplicarResolvidos(normalizarLista(lista, 'real'));
    if (!temFonteDaGrade) {
      var limite = horasSelecionadas() * JOGOS_HORA;
      if (jogos.length > limite) jogos = jogos.slice(-limite);
    }
    return jogos;
  }

  function jogosAtuais() {
    if (!root.Real || typeof root.Real.jogos !== 'function') return [];
    try {
      return normalizarLista(root.Real.jogos() || [], 'real');
    } catch (e) {
      console.warn('[GraficoReal] atuais:', e.message);
      return [];
    }
  }

  function cacheDaLiga(liga) {
    return cachePorLiga[liga] || { jogos: [], buscadoEm: 0, horas: 0 };
  }

  /*
   * Uma requisição por liga pode ficar em voo. Isso permite carregar as quatro
   * ligas em paralelo no comparativo sem duplicar a mesma chamada.
   */
  function buscarLiga(liga, forcar, horas, cacheMs) {
    liga = String(liga || 'copa').toLowerCase();
    horas = Math.max(1, Math.min(192, parseInt(horas, 10) || 24));
    cacheMs = Math.max(0, parseInt(cacheMs, 10) || CACHE_MS);
    var cache = cacheDaLiga(liga);
    if (!forcar && cache.jogos.length && cache.horas >= horas &&
        Date.now() - cache.buscadoEm < cacheMs) {
      return Promise.resolve(cache.jogos);
    }

    var emVoo = voosPorLiga[liga];
    if (emVoo) {
      if (emVoo.horas >= horas) return emVoo.promise;
      return emVoo.promise.then(function () {
        return buscarLiga(liga, forcar, horas, cacheMs);
      });
    }

    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timeout = setTimeout(function () {
      if (controller) controller.abort();
    }, TIMEOUT_MS);
    var registro = { liga: liga, horas: horas, promise: null };
    tentativaPorLiga[liga] = Date.now();
    var opcoes = { cache: 'no-store', headers: { Accept: 'application/json' } };
    if (controller) opcoes.signal = controller.signal;

    var fonte;
    if (root.AMDGradeTabs && typeof root.AMDGradeTabs.request === 'function') {
      fonte = root.AMDGradeTabs.request({
        liga: liga,
        horas: horas,
        compacto: true,
        /* Forcar redesenha; nao deve furar a coordenacao nem duplicar a API. */
        maxAgeMs: forcar ? 1500 : Math.min(cacheMs, 30000)
      });
    } else {
      fonte = fetch(
        API + '/api/grade?liga=' + encodeURIComponent(liga) +
          '&horas=' + horas + '&compacto=1',
        opcoes
      ).then(function (resposta) {
        if (!resposta.ok) throw new Error('HTTP ' + resposta.status);
        return resposta.json();
      });
    }

    registro.promise = fonte
      .then(function (dados) {
        var novos = deduplicarResolvidos(
          normalizarLista((dados && dados.partidas) || [], 'api')
        );
        if (novos.length) {
          var anterior = cacheDaLiga(liga);
          if (anterior.jogos.length && anterior.horas > horas) {
            novos = deduplicarResolvidos(anterior.jogos.concat(novos));
          }
          cachePorLiga[liga] = {
            jogos: novos,
            buscadoEm: Date.now(),
            horas: Math.max(horas, anterior.horas || 0)
          };
          return novos;
        }
        return cacheDaLiga(liga).jogos;
      })
      .catch(function (erro) {
        if (erro && erro.name !== 'AbortError') {
          console.warn('[GraficoReal] histórico ' + liga + ':', erro.message);
        }
        return cacheDaLiga(liga).jogos;
      })
      .then(function (jogos) {
        clearTimeout(timeout);
        if (voosPorLiga[liga] === registro) delete voosPorLiga[liga];
        return jogos;
      });

    voosPorLiga[liga] = registro;
    return registro.promise;
  }

  function buscarDia(forcar) {
    return buscarLiga(ligaAtual(), forcar, 24, CACHE_MS);
  }

  function buscarReplay(forcar) {
    /* O oitavo dia cobre o comeco do 7o dia anterior mesmo quando hoje ja esta
       avancado. O limite da rota e igualmente ampliado no servidor. */
    return buscarLiga(ligaAtual(), forcar, 192, CACHE_MS);
  }

  /*
   * Para desenhar N pontos completos de uma média móvel são necessários
   * 2N - 1 resultados. Mantemos ainda uma tela inteira antes da atual para
   * que o gráfico destravado possa ser arrastado para trás sem refazer a
   * consulta: N de aquecimento + 2N pontos = 3N - 1 resultados.
   */
  function horasParaJanela() {
    var janela = janelaSelecionada();
    var pontosFonte = 3 * janela - 1;
    return Math.min(
      168,
      Math.max(24, Math.ceil(pontosFonte / JOGOS_HORA) + 1)
    );
  }

  function buscarJanela(forcar) {
    return buscarLiga(
      ligaAtual(), forcar, horasParaJanela(), CACHE_MS
    );
  }

  function janelaPrecisaDados() {
    var liga = ligaAtual();
    var horas = horasParaJanela();
    var cache = cacheDaLiga(liga);
    var incompleto = !cache.jogos.length || cache.horas < horas;
    var ultimaTentativa = tentativaPorLiga[liga] || 0;
    return incompleto && Date.now() - ultimaTentativa >= 5000;
  }

  function horasParaComparativo() {
    var janela = janelaSelecionada();
    return Math.max(24, Math.ceil((2 * janela - 1) / JOGOS_HORA) + 1);
  }

  function buscarTodasLigas(forcar) {
    var horas = horasParaComparativo();
    return Promise.all(LIGAS_COMPARATIVO.map(function (liga) {
      return buscarLiga(
        liga.id, forcar, horas, CACHE_COMPARATIVO_MS
      );
    }));
  }

  function comparativoPrecisaDados() {
    var horas = horasParaComparativo();
    return LIGAS_COMPARATIVO.some(function (liga) {
      var cache = cacheDaLiga(liga.id);
      var incompleto = !cache.jogos.length || cache.horas < horas;
      var ultimaTentativa = tentativaPorLiga[liga.id] || 0;
      return incompleto && Date.now() - ultimaTentativa >= 5000;
    });
  }

  function mesclarAcumulado() {
    var historico = cacheDaLiga(ligaAtual()).jogos;
    return deduplicarResolvidos(historico.concat(jogosAtuais()));
  }

  /*
   * O dia é o dia do relógio do jogo. Procuramos a última queda grande de hora
   * (23h -> 00h), não a meia-noite do computador do usuário.
   */
  function cortarNoRelogioDoJogo(jogos) {
    if (jogos.length && jogos[jogos.length - 1].slotAbs !== null) {
      var ultimo = new Date(jogos[jogos.length - 1].slotAbs);
      var inicioDia = Date.UTC(
        ultimo.getUTCFullYear(), ultimo.getUTCMonth(), ultimo.getUTCDate()
      );
      return jogos.filter(function (jogo) {
        return jogo.slotAbs !== null && jogo.slotAbs >= inicioDia;
      });
    }
    var inicio = 0;
    for (var i = 1; i < jogos.length; i++) {
      if (jogos[i].hora < jogos[i - 1].hora - 12) inicio = i;
    }
    return jogos.slice(inicio);
  }

  function pagouNoMercado(jogo, mercado) {
    if (typeof root.pagou !== 'function') return false;
    try { return !!root.pagou(mercado, jogo); } catch (e) { return false; }
  }

  function oddDoMercado(jogo, mercado) {
    var odds = jogo && jogo.odds || {};
    var nome = String(mercado || '').trim();
    var chave = null;
    var total = nome.match(/^over\s*(\d+(?:\.\d+)?)/i);
    if (total) chave = 'odd_over_' + total[1];
    if (!chave) {
      total = nome.match(/^under\s*(\d+(?:\.\d+)?)/i);
      if (total) chave = 'odd_under_' + total[1];
    }
    if (!chave && (/ambas.*sim/i.test(nome) || /^ambas marcam$/i.test(nome))) {
      chave = 'odd_ambas_sim';
    }
    if (!chave && /ambas.*(n[aã]o|no)/i.test(nome)) chave = 'odd_ambas_nao';
    if (!chave && /^5\+\s*gols$/i.test(nome)) chave = 'odd_total_gols_extatos_5';
    if (!chave && /^(casa vence|casa ft)$/i.test(nome)) chave = 'odd_resultado_final_casa';
    if (!chave && /^(empate|empate ft)$/i.test(nome)) chave = 'odd_resultado_final_empate';
    if (!chave && /^(fora vence|fora ft)$/i.test(nome)) chave = 'odd_resultado_final_fora';
    if (!chave) return NaN;
    var valor = parseFloat(String(odds[chave] == null ? '' : odds[chave]).replace(',', '.'));
    return isFinite(valor) && valor > 1 ? valor : NaN;
  }

  function arredondar(valor, casas) {
    if (!isFinite(valor)) return NaN;
    var fator = Math.pow(10, casas == null ? 1 : casas);
    return Math.round(valor * fator) / fator;
  }

  /* Limite inferior de Wilson (95%). Ele reduz a falsa confiança de janelas
     pequenas: 5/5, por exemplo, não aparece como certeza absoluta. */
  function acertoConservador(pagos, total) {
    if (!total) return NaN;
    var z = 1.96;
    var p = pagos / total;
    var den = 1 + z * z / total;
    var centro = p + z * z / (2 * total);
    var margem = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total);
    return Math.max(0, (centro - margem) / den) * 100;
  }

  function metricasDaFila(fila, pagos) {
    var somaOdd = 0, nOdd = 0, somaGols = 0, somaRetorno = 0;
    fila.forEach(function (item) {
      somaGols += item.gols;
      if (isFinite(item.odd)) {
        somaOdd += item.odd;
        somaRetorno += item.pago ? item.odd - 1 : -1;
        nOdd++;
      }
    });
    var taxa = fila.length ? pagos / fila.length * 100 : NaN;
    var oddMedia = nOdd ? somaOdd / nOdd : NaN;
    return {
      pagamento: arredondar(taxa, 1),
      oddMedia: arredondar(oddMedia, 2),
      golsMedia: arredondar(fila.length ? somaGols / fila.length : NaN, 2),
      ev: arredondar(nOdd ? somaRetorno / nOdd * 100 : NaN, 1),
      acertoConservador: arredondar(acertoConservador(pagos, fila.length), 1)
    };
  }

  /*
   * Cada ponto usa a janela COMPLETA escolhida. O aquecimento anterior fica
   * fora do desenho; assim 20 jogos variam em passos de 5 p.p. e 40 jogos em
   * passos de 2,5 p.p., sem o falso 100% dos primeiros resultados.
   */
  function mediaMovel(jogos, janela, mercado) {
    var valores = [];
    var metas = [];
    var jogosPontuados = [];
    var fila = [];
    var pagos = 0;

    jogos.forEach(function (jogo, indiceFonte) {
      var pago = pagouNoMercado(jogo, mercado);
      fila.push({ pago: pago ? 1 : 0, odd: oddDoMercado(jogo, mercado),
        gols: jogo.gh + jogo.ga });
      pagos += pago ? 1 : 0;
      if (fila.length > janela) pagos -= fila.shift().pago;
      if (fila.length < janela) return;

      var metricas = metricasDaFila(fila, pagos);
      var valor = metricas.pagamento;
      valores.push(valor);
      metas.push({
        indiceFonte: indiceFonte,
        hora: jogo.rotulo,
        horaNumero: jogo.hora,
        minuto: jogo.minuto,
        rotulo: jogo.rotulo,
        timeA: jogo.timeA,
        timeB: jogo.timeB,
        FT: jogo.ft,
        HT: jogo.ht,
        ft: jogo.ft,
        ht: jogo.ht,
        placarFT: jogo.ft,
        placarHT: jogo.ht,
        mercado: mercado,
        pagou: pago,
        pagos: pagos,
        amostra: fila.length,
        golsJogo: jogo.gh + jogo.ga,
        valor: valor,
        valorPagamento: metricas.pagamento,
        oddMedia: metricas.oddMedia,
        golsMedia: metricas.golsMedia,
        ev: metricas.ev,
        acertoConservador: metricas.acertoConservador,
        slot: jogo.slot,
        slotAbs: jogo.slotAbs
      });
      jogosPontuados.push(jogo);
    });

    return { serie: valores, contexto: metas, jogos: jogosPontuados };
  }

  /*
   * Acumulado verdadeiro: cada ponto usa todos os jogos desde 00h do relógio
   * virtual. Recortar 3h/6h muda só o trecho visível, nunca o denominador.
   */
  function mediaAcumulada(jogos, mercado) {
    var valores = [];
    var metas = [];
    var pagos = 0;
    var fila = [];
    jogos.forEach(function (jogo, indiceFonte) {
      var pago = pagouNoMercado(jogo, mercado);
      if (pago) pagos++;
      fila.push({ pago: pago ? 1 : 0, odd: oddDoMercado(jogo, mercado),
        gols: jogo.gh + jogo.ga });
      var amostra = indiceFonte + 1;
      var metricas = metricasDaFila(fila, pagos);
      var valor = metricas.pagamento;
      valores.push(valor);
      metas.push({
        indiceFonte: indiceFonte,
        hora: jogo.rotulo,
        horaNumero: jogo.hora,
        minuto: jogo.minuto,
        rotulo: jogo.rotulo,
        timeA: jogo.timeA,
        timeB: jogo.timeB,
        FT: jogo.ft,
        HT: jogo.ht,
        ft: jogo.ft,
        ht: jogo.ht,
        placarFT: jogo.ft,
        placarHT: jogo.ht,
        mercado: mercado,
        pagou: pago,
        pagos: pagos,
        amostra: amostra,
        golsJogo: jogo.gh + jogo.ga,
        valor: valor,
        valorPagamento: metricas.pagamento,
        oddMedia: metricas.oddMedia,
        golsMedia: metricas.golsMedia,
        ev: metricas.ev,
        acertoConservador: metricas.acertoConservador,
        slot: jogo.slot,
        slotAbs: jogo.slotAbs
      });
    });
    return { serie: valores, contexto: metas, jogos: jogos };
  }

  function resumoMetas(contexto) {
    var resumo = { quantidade: 0, gols: 0, pagos: 0 };
    (contexto || []).forEach(function (meta) {
      resumo.quantidade++;
      resumo.gols += Number(meta && meta.golsJogo) || 0;
      if (meta && meta.pagou) resumo.pagos++;
    });
    return resumo;
  }

  function anexarResumo(pacote) {
    var resumo = resumoMetas(pacote.contexto);
    pacote.quantidade = resumo.quantidade;
    pacote.gols = resumo.gols;
    pacote.pagos = resumo.pagos;
    return pacote;
  }

  function recortarPacote(pacote, quantidade) {
    var inicio = Math.max(0, pacote.serie.length - quantidade);
    return anexarResumo({
      serie: pacote.serie.slice(inicio),
      contexto: pacote.contexto.slice(inicio),
      jogos: pacote.jogos.slice(inicio)
    });
  }

  /*
   * A faixa horária acompanha o relógio virtual de cada partida. O limite
   * inferior é estrito: para 3h entram apenas slots em (último - 3h, último],
   * o que resulta em 60 jogos numa cadência perfeita de três minutos.
   */
  function recortarPacotePorHoras(pacote, horas) {
    if (!horas) return recortarPacote(pacote, pacote.serie.length);
    var ultimaMeta = pacote.contexto[pacote.contexto.length - 1];
    var ultimoSlot = ultimaMeta && ultimaMeta.slotAbs !== null &&
      ultimaMeta.slotAbs !== undefined && ultimaMeta.slotAbs !== ''
      ? Number(ultimaMeta.slotAbs) : NaN;
    if (!isFinite(ultimoSlot)) {
      return recortarPacote(pacote, horas * JOGOS_HORA);
    }

    var limite = ultimoSlot - horas * 60 * 60 * 1000;
    var serie = [];
    var contexto = [];
    var jogos = [];
    pacote.contexto.forEach(function (meta, indice) {
      var slot = meta && meta.slotAbs !== null &&
        meta.slotAbs !== undefined && meta.slotAbs !== ''
        ? Number(meta.slotAbs) : NaN;
      if (!isFinite(slot) || slot <= limite || slot > ultimoSlot) return;
      serie.push(pacote.serie[indice]);
      contexto.push(meta);
      jogos.push(pacote.jogos[indice]);
    });
    return anexarResumo({ serie: serie, contexto: contexto, jogos: jogos });
  }

  function referenciaMercado(mercado, fallback) {
    if (typeof root.normalDe === 'function') {
      try {
        var normal = Number(root.normalDe(mercado));
        if (isFinite(normal)) return normal;
      } catch (e) {}
    }
    return fallback;
  }

  function montarJanela(mercadoForcado) {
    var mercado = mercadoForcado || mercadoDaGrade();
    var janela = janelaSelecionada();
    var historico = cacheDaLiga(ligaAtual()).jogos;
    var fonte = deduplicarResolvidos(historico.concat(jogosAtuais()));
    var completo = mediaMovel(fonte, janela, mercado);

    /*
     * Preservamos todos os pontos completos que já vieram na consulta. Assim o
     * zoom 1 continua abrindo exatamente N jogos, mas, depois de destravar, o
     * usuário pode arrastar até o início de todo o histórico já carregado.
     */
    var pacote = recortarPacote(completo, completo.serie.length);
    var periodoAtual = recortarPacote(pacote, janela);
    pacote.quantidadeDisponivel = pacote.quantidade;
    pacote.golsDisponiveis = pacote.gols;
    pacote.quantidade = periodoAtual.quantidade;
    pacote.gols = periodoAtual.gols;
    pacote.pagos = periodoAtual.pagos;
    pacote.modo = 'janela';
    pacote.mercado = mercado;
    pacote.janela = janela;
    pacote.quantidadePadrao = janela;
    pacote.completo = periodoAtual.quantidade === janela;
    pacote.horasCarregadas = cacheDaLiga(ligaAtual()).horas;
    pacote.base = referenciaMercado(
      mercado,
      periodoAtual.quantidade
        ? Math.round((periodoAtual.pagos / periodoAtual.quantidade) * 1000) / 10
        : 0
    );
    return pacote;
  }

  function montarAcumulado(mercadoForcado) {
    var mercado = mercadoForcado || mercadoDaGrade();
    var dia = cortarNoRelogioDoJogo(mesclarAcumulado());
    var faixas = Object.create(null);
    var completo = mediaAcumulada(dia, mercado);

    FAIXAS.forEach(function (opcao) {
      var chave = opcao[0];
      var horas = opcao[2];
      var faixa = recortarPacotePorHoras(completo, horas);
      faixa.chave = chave;
      faixa.rotulo = opcao[1];
      faixa.horas = horas;
      faixas[chave] = faixa;
    });

    var pagos = 0;
    dia.forEach(function (jogo) {
      if (pagouNoMercado(jogo, mercado)) pagos++;
    });

    return {
      modo: 'acum',
      mercado: mercado,
      janela: null,
      jogos: dia,
      faixas: faixas,
      desde: dia.length ? dia[0].rotulo : '',
      quantidade: dia.length,
      gols: completo.contexto.reduce(function (total, meta) {
        return total + (Number(meta.golsJogo) || 0);
      }, 0),
      pagos: pagos,
      base: referenciaMercado(
        mercado,
        dia.length ? Math.round((pagos / dia.length) * 1000) / 10 : 0
      )
    };
  }

  function inicioDoDiaVirtual(diasAtras) {
    var agora = new Date();
    return Date.UTC(
      agora.getFullYear(), agora.getMonth(), agora.getDate() - diasAtras
    );
  }

  function formatarDataReplay(ts) {
    var data = new Date(ts);
    return pad2(data.getUTCDate()) + '/' + pad2(data.getUTCMonth() + 1) +
      '/' + data.getUTCFullYear();
  }

  function montarReplay(mercadoForcado) {
    var mercado = mercadoForcado || mercadoDaGrade();
    var inicio = inicioDoDiaVirtual(replayDia);
    var fim = inicio + 24 * 60 * 60 * 1000;
    var dia = mesclarAcumulado().filter(function (jogo) {
      return jogo.slotAbs !== null && jogo.slotAbs >= inicio && jogo.slotAbs < fim;
    });
    var completo = mediaAcumulada(dia, mercado);
    var pagos = 0;
    dia.forEach(function (jogo) {
      if (pagouNoMercado(jogo, mercado)) pagos++;
    });
    var base = referenciaMercado(
      mercado,
      dia.length ? Math.round((pagos / dia.length) * 1000) / 10 : 0
    );
    var acumulado = {
      modo: 'acum', replay: true, replayDia: replayDia,
      replayData: formatarDataReplay(inicio), mercado: mercado,
      janela: null, jogos: dia, faixas: { dia: completo },
      desde: dia.length ? dia[0].rotulo : '', quantidade: dia.length,
      gols: completo.contexto.reduce(function (total, meta) {
        return total + (Number(meta.golsJogo) || 0);
      }, 0),
      pagos: pagos, base: base
    };
    completo.chave = 'dia';
    completo.rotulo = 'dia completo';
    completo.horas = 0;
    return {
      modo: 'acum', replay: true, replayDia: replayDia,
      replayData: acumulado.replayData, mercado: mercado, janela: null,
      serie: completo.serie, contexto: completo.contexto, jogos: completo.jogos,
      quantidade: completo.quantidade, gols: completo.gols, pagos: completo.pagos,
      faixaHoras: 0, faixaRotulo: 'dia completo', base: base,
      acumulado: acumulado
    };
  }

  /*
   * Comparativo justo: as quatro ligas usam o mesmo mercado, a mesma janela
   * matemática e a mesma quantidade de pontos. O eixo X representa jogos
   * atrás (não relógio), porque cada liga começa em um minuto diferente.
   */
  function montarComparativo(mercadoForcado) {
    var mercado = mercadoForcado || mercadoDaGrade();
    var janela = janelaSelecionada();
    var ativa = ligaAtual();
    var ligas = LIGAS_COMPARATIVO.map(function (cfg, ordem) {
      var jogos = cacheDaLiga(cfg.id).jogos.slice();
      if (cfg.id === ativa) {
        jogos = deduplicarResolvidos(jogos.concat(jogosAtuais()));
      }
      var completo = mediaMovel(jogos, janela, mercado);
      var pacote = recortarPacote(completo, janela);
      return {
        id: cfg.id,
        liga: cfg.id,
        nome: cfg.nome,
        cor: cfg.cor,
        ordem: ordem,
        serie: pacote.serie,
        contexto: pacote.contexto,
        jogos: pacote.jogos,
        atual: null,
        variacao: null,
        amostra: 0,
        status: pacote.serie.length >= 2 ? 'ok' : 'sem-dados'
      };
    });

    var prontas = ligas.filter(function (liga) {
      return liga.serie.length >= 2;
    });
    var pontosComuns = prontas.length
      ? Math.min.apply(null, prontas.map(function (liga) {
        return liga.serie.length;
      })) : 0;
    pontosComuns = Math.min(janela, pontosComuns);

    ligas.forEach(function (liga) {
      if (liga.serie.length < 2 || pontosComuns < 2) return;
      liga.serie = liga.serie.slice(-pontosComuns);
      liga.contexto = liga.contexto.slice(-pontosComuns);
      liga.jogos = liga.jogos.slice(-pontosComuns);
      liga.atual = liga.serie[liga.serie.length - 1];
      var baseVariacao = liga.serie[Math.max(0, liga.serie.length - 6)];
      liga.variacao = Math.round((liga.atual - baseVariacao) * 10) / 10;
      var ultimaMeta = liga.contexto[liga.contexto.length - 1] || {};
      liga.amostra = Number(ultimaMeta.amostra) || janela;
      liga.status = 'ok';
    });

    var ranking = ligas.filter(function (liga) {
      return typeof liga.atual === 'number' && isFinite(liga.atual);
    }).sort(function (a, b) {
      if (b.atual !== a.atual) return b.atual - a.atual;
      return a.ordem - b.ordem;
    });
    var maior = ranking.length ? ranking[0].atual : null;
    var melhores = maior === null ? [] : ranking.filter(function (liga) {
      return liga.atual === maior;
    });
    var melhor = melhores.length ? melhores[0] : null;
    var completo = ligas.every(function (liga) {
      return liga.status === 'ok' && liga.serie.length >= janela;
    }) && pontosComuns >= janela;

    return {
      modo: 'ligas',
      mercado: mercado,
      janela: janela,
      pontos: pontosComuns,
      ligas: ligas,
      ranking: ranking,
      melhores: melhores,
      melhor: melhor,
      empate: melhores.length > 1,
      completo: completo,
      serie: melhor ? melhor.serie : [],
      contexto: melhor ? melhor.contexto : [],
      jogos: melhor ? melhor.jogos : [],
      base: referenciaMercado(mercado, maior || 0)
    };
  }

  function pacoteAtual() {
    if (modoAtual === 'janela') return montarJanela();
    if (modoAtual === 'ligas') return montarComparativo();
    if (modoAtual === 'replay') return montarReplay();

    var acumulado = montarAcumulado();
    if (!acumulado.faixas[faixaAtual]) {
      faixaAtual = acumulado.faixas.dia ? 'dia' : primeiraFaixa(acumulado);
    }
    var faixa = acumulado.faixas[faixaAtual];
    return {
      modo: 'acum',
      mercado: acumulado.mercado,
      janela: null,
      serie: faixa ? faixa.serie : [],
      contexto: faixa ? faixa.contexto : [],
      jogos: faixa ? faixa.jogos : [],
      quantidade: faixa ? faixa.quantidade : 0,
      gols: faixa ? faixa.gols : 0,
      pagos: faixa ? faixa.pagos : 0,
      faixaHoras: faixa ? faixa.horas : 0,
      faixaRotulo: faixa ? faixa.rotulo : '',
      base: acumulado.base,
      acumulado: acumulado
    };
  }

  function primeiraFaixa(acumulado) {
    for (var i = 0; i < FAIXAS.length; i++) {
      if (acumulado.faixas[FAIXAS[i][0]]) return FAIXAS[i][0];
    }
    return 'dia';
  }

  /*
   * n é o limite visual pedido pelo app (zoom). O período matemático continua
   * sendo exatamente a Qtd. Jogos ativa na barra.
   */
  function limitar(pacote, n) {
    var limite = parseInt(n, 10);
    var serie = pacote.serie || [];
    var contexto = pacote.contexto || [];
    if (!isNaN(limite) && limite > 0 && serie.length > limite) {
      serie = serie.slice(-limite);
      contexto = contexto.slice(-limite);
    } else {
      serie = serie.slice();
      contexto = contexto.slice();
    }
    contexto = contexto.map(function (meta, i) {
      var copia = Object.assign({}, meta);
      copia.indice = i;
      copia.valor = serie[i];
      return copia;
    });
    var resumo = resumoMetas(contexto);
    return {
      serie: serie,
      contexto: contexto,
      quantidade: resumo.quantidade,
      gols: resumo.gols,
      pagos: resumo.pagos
    };
  }

  function aplicarMetrica(visivel, metrica) {
    var nome = String(metrica || '% pagamento');
    var campo = nome === 'Odd' ? 'oddMedia'
      : nome === 'Gols' ? 'golsMedia'
        : nome === 'EV' ? 'ev'
          : nome === 'Taxa de acerto' ? 'acertoConservador'
            : 'valorPagamento';
    var serie = visivel.contexto.map(function (meta, indice) {
      var valor = Number(meta && meta[campo]);
      if (!isFinite(valor) && campo === 'valorPagamento') {
        valor = Number(visivel.serie[indice]);
      }
      return valor;
    });
    var primeiroValido = serie.find(function (valor) { return isFinite(valor); });
    if (!isFinite(primeiroValido)) {
      visivel.serie = [];
      visivel.contexto = [];
      return visivel;
    }
    var ultimoValido = primeiroValido;
    serie = serie.map(function (valor) {
      if (isFinite(valor)) ultimoValido = valor;
      return isFinite(valor) ? valor : ultimoValido;
    });
    visivel.serie = serie;
    visivel.contexto = visivel.contexto.map(function (meta, indice) {
      var copia = Object.assign({}, meta);
      copia.valor = serie[indice];
      copia.metrica = nome;
      return copia;
    });
    return visivel;
  }

  function serie(n, metrica) {
    if (modoAtual === 'ligas' && comparativoPrecisaDados()) {
      buscarTodasLigas(false).then(agendarRender);
    } else if (modoAtual === 'janela' && janelaPrecisaDados()) {
      buscarJanela(false).then(agendarRender);
    } else if (modoAtual === 'acum' &&
        !cacheDaLiga(ligaAtual()).jogos.length) {
      buscarDia(false).then(agendarRender);
    } else if (modoAtual === 'replay' &&
        cacheDaLiga(ligaAtual()).horas < 192) {
      buscarReplay(false).then(agendarRender);
    }

    var pacote = pacoteAtual();
    /* Qtd. Jogos nunca recorta o Acumulado; nele quem manda é a faixa horária. */
    var visivel = aplicarMetrica(
      limitar(pacote, modoAtual === 'acum' || modoAtual === 'replay' ? null : n), metrica);
    ultimoPacote = pacote;
    ultimoContexto = visivel.contexto;
    atualizarBarra(pacote);
    return visivel.serie;
  }

  /* Serie paralela para comparar mercados no mesmo grafico. Usa exatamente
     os mesmos jogos, janela e faixa horaria da linha principal, sem trocar
     o mercado ativo nem alterar o contexto usado pelo MACD/Hacker IA. */
  function serieMercado(mercado, n, metrica) {
    if (!mercado || modoAtual === 'ligas') return null;
    var pacote;
    if (modoAtual === 'janela') {
      pacote = montarJanela(mercado);
    } else if (modoAtual === 'replay') {
      pacote = montarReplay(mercado);
    } else {
      var acumulado = montarAcumulado(mercado);
      var chave = acumulado.faixas[faixaAtual]
        ? faixaAtual : (acumulado.faixas.dia ? 'dia' : primeiraFaixa(acumulado));
      var faixa = acumulado.faixas[chave];
      pacote = {
        modo: 'acum', mercado: mercado,
        serie: faixa ? faixa.serie : [],
        contexto: faixa ? faixa.contexto : [],
        jogos: faixa ? faixa.jogos : []
      };
    }
    var visivel = aplicarMetrica(
      limitar(pacote, modoAtual === 'acum' || modoAtual === 'replay' ? null : n), metrica);
    return { mercado: mercado, serie: visivel.serie, contexto: visivel.contexto };
  }

  function comparativo(n) {
    if (comparativoPrecisaDados()) {
      buscarTodasLigas(false).then(agendarRender);
    }
    var pacote = montarComparativo();
    var limite = Math.max(2, parseInt(n, 10) || pacote.janela || 20);
    pacote.ligas.forEach(function (liga) {
      if (liga.serie.length > limite) {
        liga.serie = liga.serie.slice(-limite);
        liga.contexto = liga.contexto.slice(-limite);
        liga.jogos = liga.jogos.slice(-limite);
      }
    });
    pacote.pontos = pacote.ligas.reduce(function (menor, liga) {
      if (liga.status !== 'ok') return menor;
      return menor === null ? liga.serie.length : Math.min(menor, liga.serie.length);
    }, null) || 0;
    if (pacote.melhor) {
      pacote.serie = pacote.melhor.serie;
      pacote.contexto = pacote.melhor.contexto;
      pacote.jogos = pacote.melhor.jogos;
    }
    ultimoPacote = pacote;
    ultimoContexto = pacote.contexto.slice();
    atualizarBarra(pacote);
    return pacote;
  }

  function comparativoMercado(mercado, n) {
    if (comparativoPrecisaDados()) buscarTodasLigas(false).then(agendarRender);
    var pacote = montarComparativo(mercado);
    var limite = Math.max(18, parseInt(n, 10) || pacote.janela || 20);
    pacote.ligas.forEach(function (liga) {
      if (liga.serie.length > limite) liga.serie = liga.serie.slice(-limite);
    });
    return pacote;
  }

  function contexto() {
    var pacote = ultimoPacote || {};
    var referencia = pacote.modo === 'acum' && pacote.acumulado
      ? pacote.acumulado.base
      : pacote.base;
    var resumoVisivel = resumoMetas(ultimoContexto);
    var quantidadePeriodo = pacote.modo === 'janela' || pacote.modo === 'acum'
      ? Number(pacote.quantidade) || 0
      : resumoVisivel.quantidade;
    var golsPeriodo = pacote.modo === 'janela' || pacote.modo === 'acum'
      ? Number(pacote.gols) || 0
      : resumoVisivel.gols;
    var pagosPeriodo = pacote.modo === 'janela' || pacote.modo === 'acum'
      ? Number(pacote.pagos) || 0
      : resumoVisivel.pagos;
    var saida = {
      modo: pacote.modo || modoAtual,
      faixa: modoAtual === 'acum' ? faixaAtual : null,
      mercado: pacote.mercado || mercadoDaGrade(),
      janela: pacote.modo === 'acum' ? null : (pacote.janela || janelaSelecionada()),
      referencia: typeof referencia === 'number' ? referencia : null,
      quantidade: quantidadePeriodo,
      gols: golsPeriodo,
      pagos: pagosPeriodo,
      quantidadeDisponivel: pacote.quantidadeDisponivel || resumoVisivel.quantidade,
      golsDisponiveis: pacote.golsDisponiveis || resumoVisivel.gols,
      meta: ultimoContexto.map(function (meta) { return Object.assign({}, meta); })
    };
    if (pacote.modo === 'janela') {
      saida.quantidadePadrao = pacote.quantidadePadrao || pacote.janela;
      saida.completo = !!pacote.completo;
      saida.horasCarregadas = pacote.horasCarregadas || 0;
    }
    if (pacote.modo === 'acum' && pacote.acumulado) {
      saida.horas = pacote.faixaHoras || 0;
      saida.periodo = pacote.faixaRotulo || '';
      saida.desde = pacote.acumulado.desde || '';
      saida.totalDiaJogos = pacote.acumulado.quantidade || 0;
      saida.totalDiaGols = pacote.acumulado.gols || 0;
      if (pacote.replay) {
        saida.replay = true;
        saida.replayDia = pacote.replayDia;
        saida.replayData = pacote.replayData;
      }
    }
    if (pacote.modo === 'ligas') {
      saida.ligas = pacote.ligas || [];
      saida.ranking = pacote.ranking || [];
      saida.melhores = pacote.melhores || [];
      saida.empate = !!pacote.empate;
      saida.completo = !!pacote.completo;
    }
    return saida;
  }

  function agendarRender() {
    if (renderAgendado) return;
    /* requestAnimationFrame para completamente em abas ocultas. O Golden/Death
       Cross depende do renderChart para comparar o último ponto; por isso, em
       segundo plano, executamos pelo microtask da própria resposta da API. */
    if (root.document && root.document.hidden) {
      renderAgendado = -1;
      Promise.resolve().then(function () {
        renderAgendado = 0;
        if (typeof root.renderChart === 'function') root.renderChart();
      });
      return;
    }
    var raf = root.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
    renderAgendado = raf(function () {
      renderAgendado = 0;
      if (typeof root.renderChart === 'function') root.renderChart();
    });
  }

  function atualizar(forcar) {
    var pronto = Promise.resolve();
    if (modoAtual === 'janela') pronto = buscarJanela(!!forcar);
    if (modoAtual === 'acum') pronto = buscarDia(!!forcar);
    if (modoAtual === 'replay') pronto = buscarReplay(!!forcar);
    if (modoAtual === 'ligas') pronto = buscarTodasLigas(!!forcar);

    return pronto.then(function () {
      var pacote = pacoteAtual();
      ultimoPacote = pacote;
      atualizarBarra(pacote);
      agendarRender();
      return pacote;
    });
  }

  function trocar(novoModo) {
    if (novoModo !== 'janela' && novoModo !== 'acum' &&
        novoModo !== 'replay' && novoModo !== 'ligas')
      return Promise.resolve(ultimoPacote);
    modoAtual = novoModo;
    gravarLocal(LS_MODO, modoAtual);
    atualizarBotoesModo();
    if (modoAtual !== 'acum' && modoAtual !== 'replay') removerBarra();
    if (typeof root.atualizarSeletorLigaGrafico === 'function') {
      root.atualizarSeletorLigaGrafico();
    }
    agendarRender();
    return atualizar(false);
  }

  function atualizarBotoesModo() {
    Array.prototype.forEach.call(
      document.querySelectorAll('#grafmodo .tab'),
      function (botao) {
        var ativo = botao.getAttribute('data-modo') === modoAtual;
        botao.classList.toggle('active', ativo);
        botao.setAttribute('aria-pressed', ativo ? 'true' : 'false');
      }
    );
  }

  function criarAbas() {
    if (document.getElementById('grafmodo')) {
      atualizarBotoesModo();
      return true;
    }
    var visual = document.getElementById('visual');
    var linha = visual && visual.parentElement;
    if (!linha) return false;

    var rotulo = document.createElement('span');
    rotulo.className = 'k';
    rotulo.textContent = 'Gráfico:';

    var grupo = document.createElement('div');
    grupo.id = 'grafmodo';
    grupo.className = 'tabrow';

    [
      ['janela', '📉 Janela móvel',
        'Jogos resolvidos da grade; a Qtd. Jogos define a média móvel.'],
      ['acum', '📐 Acumulado 00h',
        'Histórico real do relógio do jogo, com faixas de 3h a desde 00h.'],
      ['replay', '⏪ Replay 00h',
        'Veja como terminou qualquer um dos sete dias anteriores.'],
      ['ligas', '🏆 Top Ligas',
        'Compara as ligas recebidas pela extensão no mesmo mercado e janela.']
    ].forEach(function (opcao) {
      var botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'tab sm';
      botao.setAttribute('data-modo', opcao[0]);
      botao.title = opcao[2];
      botao.textContent = opcao[1];
      botao.addEventListener('click', function () { trocar(opcao[0]); });
      grupo.appendChild(botao);
    });

    linha.appendChild(rotulo);
    linha.appendChild(grupo);
    atualizarBotoesModo();
    return true;
  }

  function removerBarra() {
    var barra = document.getElementById('acumBar');
    if (barra && barra.parentNode) barra.parentNode.removeChild(barra);
  }

  function atualizarBarra(pacote) {
    if (modoAtual !== 'acum' && modoAtual !== 'replay') {
      removerBarra();
      return;
    }

    var svg = document.getElementById('chart');
    if (!svg || !svg.parentNode) return;
    removerBarra();

    var acumulado = pacote && pacote.acumulado
      ? pacote.acumulado
      : (pacote && pacote.faixas ? pacote : montarAcumulado());
    var barra = document.createElement('div');
    barra.id = 'acumBar';

    if (modoAtual === 'replay') {
      barra.className = 'replay-bar';
      var replayRotulo = document.createElement('span');
      replayRotulo.className = 'k';
      replayRotulo.textContent = 'Dias anteriores:';
      barra.appendChild(replayRotulo);
      var replayGrupo = document.createElement('div');
      replayGrupo.className = 'tabrow';
      for (var d = 1; d <= 7; d++) {
        (function (dia) {
          var botaoDia = document.createElement('button');
          botaoDia.type = 'button';
          botaoDia.className = 'tab sm' + (replayDia === dia ? ' active' : '');
          botaoDia.textContent = dia === 1 ? 'Ontem' : dia + ' dias';
          botaoDia.addEventListener('click', function () {
            replayDia = dia;
            gravarLocal(LS_REPLAY_DIA, replayDia);
            atualizar(false);
          });
          replayGrupo.appendChild(botaoDia);
        })(d);
      }
      barra.appendChild(replayGrupo);
      var replayInfo = document.createElement('span');
      replayInfo.className = 'acum-dir';
      if (acumulado.quantidade) {
        var replayAtual = acumulado.faixas.dia.serie.slice(-1)[0];
        replayInfo.innerHTML = '<span class="replay-data">REPLAY ' +
          acumulado.replayData + '</span> · <b>' + replayAtual.toFixed(1) +
          '%</b> · ' + acumulado.quantidade + ' jogos · ' +
          acumulado.gols + ' gols · fechamento do dia';
      } else {
        replayInfo.className += ' acum-status';
        replayInfo.textContent = Object.keys(voosPorLiga).length
          ? 'carregando replay…' : 'sem resultados para este dia';
      }
      barra.appendChild(replayInfo);
      svg.parentNode.insertBefore(barra, svg);
      return;
    }

    var rotulo = document.createElement('span');
    rotulo.className = 'k';
    rotulo.textContent = 'Horas:';
    barra.appendChild(rotulo);

    var grupo = document.createElement('div');
    grupo.className = 'tabrow';
    FAIXAS.forEach(function (opcao) {
      if (!acumulado.faixas[opcao[0]]) return;
      var botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'tab sm' + (faixaAtual === opcao[0] ? ' active' : '');
      botao.textContent = opcao[1];
      botao.addEventListener('click', function () {
        faixaAtual = opcao[0];
        gravarLocal(LS_FAIXA, faixaAtual);
        atualizar(false);
      });
      grupo.appendChild(botao);
    });
    barra.appendChild(grupo);

    var info = document.createElement('span');
    info.className = 'acum-dir';
    var faixa = acumulado.faixas[faixaAtual];
    if (faixa && faixa.serie.length) {
      var atual = faixa.serie[faixa.serie.length - 1];
      if (faixa.horas) {
        info.innerHTML = '<b>' + atual.toFixed(1) + '%</b> · '
          + faixa.quantidade + ' jogos · ' + faixa.gols + ' gols nas últimas '
          + faixa.rotulo + ' · percentual acumulado desde 00h ('
          + acumulado.quantidade + ' jogos)';
      } else {
        info.innerHTML = '<b>' + atual.toFixed(1) + '%</b> · '
          + faixa.quantidade + ' jogos · ' + faixa.gols + ' gols desde '
          + acumulado.desde + ' (relógio do jogo)';
      }
    } else {
      info.className += ' acum-status';
      info.textContent = Object.keys(voosPorLiga).length
        ? 'carregando histórico real…'
        : 'aguardando resultados resolvidos';
    }
    barra.appendChild(info);
    svg.parentNode.insertBefore(barra, svg);
  }

  function observarGrade() {
    if (observerGrade) return true;
    var grade = document.getElementById('grade');
    if (!grade || typeof MutationObserver !== 'function') return false;
    observerGrade = new MutationObserver(function () {
      clearTimeout(timerGrade);
      timerGrade = setTimeout(function () { atualizar(false); }, 80);
    });
    observerGrade.observe(grade, { childList: true, subtree: true });
    return true;
  }

  function ligarControles() {
    document.addEventListener('click', function (evento) {
      var alvo = evento.target && evento.target.closest
        ? evento.target.closest(
          '#qtd .tab, #horas .tab, #mktMenu button, #cmktMenu button, #realBar .tab'
        )
        : null;
      if (!alvo) return;
      setTimeout(function () { atualizar(false); }, 0);
    });
  }

  function iniciar() {
    if (!document.getElementById('grafico-real-css')) {
      var estilo = document.createElement('style');
      estilo.id = 'grafico-real-css';
      estilo.textContent = CSS;
      document.head.appendChild(estilo);
    }

    criarAbas();
    if (typeof root.atualizarSeletorLigaGrafico === 'function') {
      root.atualizarSeletorLigaGrafico();
    }
    observarGrade();
    ligarControles();

    var tentativas = 0;
    var espera = setInterval(function () {
      criarAbas();
      observarGrade();
      if ((root.Real && criarAbas() && observarGrade()) || ++tentativas > 80) {
        clearInterval(espera);
        atualizar(false);
      }
    }, 250);

    /*
     * A conta sempre mescla Real.jogos() novamente; portanto um resultado
     * recém-chegado entra no acumulado sem esperar uma nova consulta de 24h.
     */
    setInterval(function () { atualizar(false); }, 5000);
  }

  root.GraficoReal = {
    serie: serie,
    serieMercado: serieMercado,
    comparativo: comparativo,
    comparativoMercado: comparativoMercado,
    contexto: contexto,
    atualizar: atualizar,
    /* Para o renderizador, Replay usa a mesma semântica do Acumulado. */
    modo: function () { return modoAtual === 'replay' ? 'acum' : modoAtual; },
    trocar: trocar
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})(window);
