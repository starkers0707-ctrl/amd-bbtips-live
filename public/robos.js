(function () {
  'use strict';
  var STORAGE = 'amd:robos-teste:v1';
  var perfilAtual = 'equilibrado';
  var timerEntradas = null, leituraResultados = 0;
  var $ = function (s, base) { return (base || document).querySelector(s); };
  var $$ = function (s, base) { return [].slice.call((base || document).querySelectorAll(s)); };

  function regras() {
    return $$('.rb-rule').map(function (el) {
      var usar = $('.rb-use input', el);
      var agora = $('.rb-now', el);
      return {
        chave: el.dataset.key,
        peso: Number(el.dataset.weight),
        usar: usar ? usar.checked : true,
        confirmada: agora.classList.contains('on')
      };
    });
  }

  function nomePerfilAtual() {
    if (perfilAtual === 'personalizado') return 'Personalizado';
    return window.RobosTesteModel.perfil(perfilAtual).nome;
  }

  function quantidadeTiros() {
    var campo = $('#rbTiros');
    var valor = campo ? Number(campo.value) : 3;
    return valor >= 1 && valor <= 5 ? valor : 3;
  }

  function mostrarCarregando() {
    $('#rbScore').textContent = '...';
    $('#rbMeter').style.width = '0%';
    $('#rbMarker').style.left = Number($('#rbLimiar').value) + '%';
    $('#rbConfirmed').textContent = 'calculando';
    $('#rbProfileName').textContent = nomePerfilAtual();
    $('#rbScoreCard').dataset.status = 'aguardar';
    $('#rbStatus').textContent = 'CALCULANDO';
    $('#rbStatusIcon').textContent = '\u23f3';
    $('#rbStatusText').textContent = 'Lendo os resultados reais das ligas selecionadas';
  }

  function calcular() {
    mostrarCarregando();
    carregarEntradas();
    return null;
  }

  function definirPerfil(chave) {
    perfilAtual = chave;
    $$('.rb-profiles button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.profile === chave);
    });
    var valor = window.RobosTesteModel.perfil(chave).limiar;
    $('#rbLimiar').value = valor;
    $('#rbLimiarOut').textContent = valor;
    calcular();
  }

  function lerSalvos() {
    try { return JSON.parse(localStorage.getItem(STORAGE) || '[]'); }
    catch (_) { return []; }
  }

  function gravarSalvos(lista) {
    localStorage.setItem(STORAGE, JSON.stringify(lista.slice(0, 3)));
  }

  function escapar(texto) {
    return String(texto || '').replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }


  function placarRobo(texto) {
    var m = String(texto || '').match(/(\d+)\s*[-x]\s*(\d+)/i);
    return m ? [Number(m[1]), Number(m[2])] : null;
  }

  function pagouRobo(partida, mercado) {
    var ft = placarRobo(partida && partida.resultado_ft);
    var ht = placarRobo(partida && partida.resultado_ht);
    var htOut = String(partida && partida.resultado_ht || '').trim().toUpperCase() === 'OUT';
    if (mercado === 'OUT HT') return htOut || (ht ? ht[0] + ht[1] >= 3 : null);
    if (!ft) return null;
    var total = ft[0] + ft[1];
    if (mercado === 'Under 2.5') return total <= 2;
    if (mercado === 'Over 2.5') return total >= 3;
    if (mercado === 'Over 3.5') return total >= 4;
    if (mercado === '5+ Gols') return total >= 5;
    if (mercado === 'Ambas Marcam (Sim)') return ft[0] > 0 && ft[1] > 0;
    if (mercado === 'Ambas Marcam (Não)') return !(ft[0] > 0 && ft[1] > 0);
    return null;
  }

  function mercadoDeConfirmacao(mercado) {
    return ({
      'Over 2.5': 'Over 3.5',
      'Over 3.5': '5+ Gols',
      '5+ Gols': 'Over 3.5',
      'OUT HT': 'Over 2.5',
      'Ambas Marcam (Sim)': 'Over 2.5',
      'Ambas Marcam (Não)': 'Under 2.5'
    })[mercado] || null;
  }

  function serieRobo(partidas, mercado) {
    var resolvidos = (partidas || []).map(function (p) {
      return { jogo: p, verde: pagouRobo(p, mercado) };
    }).filter(function (item) { return item.verde !== null; });
    function tempo(item) {
      var p = item && item.jogo || {};
      var t = Date.parse(p.slot_em || p.criado_em || '');
      return isNaN(t) ? null : t;
    }
    resolvidos.sort(function (a, b) {
      var ta = tempo(a), tb = tempo(b);
      if (ta !== null && tb !== null) return ta - tb;
      return 0;
    });
    var comTempo = resolvidos.filter(function (item) { return tempo(item) !== null; });
    if (comTempo.length) {
      var ultimoTs = tempo(comTempo[comTempo.length - 1]);
      var ultimo = new Date(ultimoTs);
      var inicioDia = Date.UTC(
        ultimo.getUTCFullYear(), ultimo.getUTCMonth(), ultimo.getUTCDate());
      resolvidos = resolvidos.filter(function (item) {
        var t = tempo(item);
        return t !== null && t >= inicioDia && t <= ultimoTs;
      });
    } else {
      var inicio = 0;
      for (var r = 1; r < resolvidos.length; r++) {
        var ha = Number(resolvidos[r - 1].jogo.hora);
        var hb = Number(resolvidos[r].jogo.hora);
        if (isFinite(ha) && isFinite(hb) && hb < ha - 12) inicio = r;
      }
      resolvidos = resolvidos.slice(inicio);
    }
    var serie = [], verdes = 0;
    resolvidos.forEach(function (item, indice) {
      if (item.verde) verdes++;
      serie.push(Math.round(verdes / (indice + 1) * 1000) / 10);
    });
    var soma = serie.reduce(function (total, valor) { return total + valor; }, 0);
    return {
      serie: serie,
      media: serie.length ? soma / serie.length : null,
      resultados: resolvidos.length
    };
  }

  function emaRobo(valores, periodo) {
    if (!valores.length) return [];
    var k = 2 / (periodo + 1), saida = [valores[0]];
    for (var i = 1; i < valores.length; i++) {
      saida.push(valores[i] * k + saida[i - 1] * (1 - k));
    }
    return saida;
  }

  function rsiRobo(valores, periodo) {
    if (valores.length <= periodo) return null;
    var ganhos = 0, perdas = 0;
    for (var i = valores.length - periodo; i < valores.length; i++) {
      var delta = valores[i] - valores[i - 1];
      if (delta > 0) ganhos += delta;
      else perdas -= delta;
    }
    if (!perdas) return ganhos ? 100 : 50;
    return 100 - 100 / (1 + ganhos / perdas);
  }

  function slotRobo(p) {
    if (!p) return null;
    var direto = Date.parse(p.slot_em || '');
    if (!isNaN(direto)) return direto;
    var criado = Date.parse(p.criado_em || '');
    var hora = Number(p.hora), minuto = Number(p.minuto);
    if (isNaN(criado) || !isFinite(hora) || !isFinite(minuto)) return null;
    var ref = new Date(criado);
    var slot = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(),
      hora, minuto, 0, 0);
    var meioDia = 12 * 60 * 60 * 1000;
    while (slot - criado > meioDia) slot -= 24 * 60 * 60 * 1000;
    while (criado - slot > meioDia) slot += 24 * 60 * 60 * 1000;
    return slot;
  }

  function futurosDaGrade(partidas, agora) {
    var lista = Array.isArray(partidas) ? partidas : [];
    var minimoFuturo = (Number(agora) || Date.now()) + 45 * 1000;
    var ultimoResolvido = null;
    var vistoTopo = 0;
    lista.forEach(function (p) {
      var visto = Date.parse(p && p.visto_em || '');
      if (!isNaN(visto) && visto > vistoTopo) vistoTopo = visto;
      if (!p || !p.resultado_ft) return;
      var slot = slotRobo(p);
      if (slot !== null && (ultimoResolvido === null || slot > ultimoResolvido))
        ultimoResolvido = slot;
    });
    if (ultimoResolvido === null || !vistoTopo) return [];
    var unicos = Object.create(null);
    lista.forEach(function (p) {
      if (!p || p.resultado_ft || !p.time_a || !p.time_b) return;
      var slot = slotRobo(p);
      var visto = Date.parse(p.visto_em || '');
      if (slot === null || isNaN(visto)) return;
      if (slot <= ultimoResolvido || slot <= minimoFuturo ||
          slot > ultimoResolvido + 45 * 60 * 1000) return;
      if (visto < vistoTopo - 20 * 60 * 1000) return;
      var chave = slot + '|' + String(p.time_a).toLowerCase() +
        '|' + String(p.time_b).toLowerCase();
      if (!unicos[chave] || Date.parse(unicos[chave].visto_em || '') < visto)
        unicos[chave] = p;
    });
    return Object.keys(unicos).map(function (k) { return unicos[k]; })
      .sort(function (a, b) { return slotRobo(a) - slotRobo(b); });
  }

  function analisarResultados(partidas, mercado, janela) {
    var dados = serieRobo(partidas, mercado, janela);
    if (dados.serie.length < 20) {
      return { pronto: false, resultados: dados.resultados, futuros: [] };
    }
    var serie = dados.serie;
    var atual = serie[serie.length - 1];
    var curta = emaRobo(serie, 10);
    var longa = emaRobo(serie, 20);
    var hist = serie.map(function (_, i) { return curta[i] - longa[i]; });
    var macd = hist[hist.length - 1];
    var macdAnterior = hist[Math.max(0, hist.length - 4)];
    var rsi = rsiRobo(serie, 14);
    return {
      pronto: true,
      resultados: dados.resultados,
      atual: atual,
      anterior: serie[serie.length - 2],
      media: dados.media,
      macd: macd,
      rsi: rsi,
      futuros: futurosDaGrade(partidas),
      metricas: {
        subida: serie.length >= 2 && atual > serie[serie.length - 2],
        media: atual > dados.media,
        macd: macd > 0 && macd >= macdAnterior,
        rsi: rsi !== null && rsi >= 50 && rsi <= 70,
        ligas: false,
        mercados: false
      }
    };
  }

  function confirmarOutroMercado(partidas, mercado, janela) {
    var apoio = mercadoDeConfirmacao(mercado);
    if (!apoio) return false;
    var analise = analisarResultados(partidas, apoio, janela);
    return !!(analise.pronto && analise.metricas.subida &&
      analise.atual > analise.media);
  }

  function pontuarRobo(analise) {
    var pontos = 0, confirmadas = 0, usadas = 0;
    $$('.rb-rule').forEach(function (el) {
      var usar = $('.rb-use input', el);
      var chave = el.dataset.key;
      if (usar && !usar.checked) return;
      usadas++;
      if (analise.metricas[chave]) {
        confirmadas++;
        pontos += Number(el.dataset.weight) || 0;
      }
    });
    analise.pontos = Math.min(100, pontos);
    analise.confirmadas = confirmadas;
    analise.usadas = usadas;
    analise.entrada = analise.metricas.subida && usadas > 0 &&
      pontos >= Number($('#rbLimiar').value);
    return analise;
  }

  function mostrarRegrasReais(analise) {
    $$('.rb-rule').forEach(function (el) {
      var botao = $('.rb-now', el);
      if (!botao) return;
      var ok = !!(analise && analise.pronto && analise.metricas[el.dataset.key]);
      botao.disabled = true;
      botao.classList.toggle('on', ok);
      botao.setAttribute('aria-pressed', ok ? 'true' : 'false');
      botao.textContent = analise && analise.pronto ? 'Real: ' + (ok ? 'SIM' : 'NÃO') : 'Real: —';
    });
  }

  function atualizarSinalReal(analise, motivo) {
    var status = analise && analise.entrada ? 'ENTRADA' :
      analise && analise.pronto && analise.pontos >=
      Math.max(1, Number($('#rbLimiar').value) - 15) ? 'OBSERVAR' : 'AGUARDAR';
    $('#rbScore').textContent = analise && analise.pronto ? analise.pontos : '—';
    $('#rbMeter').style.width = analise && analise.pronto ? analise.pontos + '%' : '0%';
    $('#rbConfirmed').textContent = analise && analise.pronto
      ? analise.confirmadas + ' de ' + analise.usadas : 'sem amostra';
    $('#rbProfileName').textContent = nomePerfilAtual();
    $('#rbMarker').style.left = Number($('#rbLimiar').value) + '%';
    $('#rbScoreCard').dataset.status = status.toLowerCase();
    $('#rbStatus').textContent = status;
    $('#rbStatusIcon').textContent = status === 'ENTRADA' ? '🚀' : status === 'OBSERVAR' ? '👀' : '⏳';
    $('#rbStatusText').textContent = motivo || (status === 'ENTRADA'
      ? analise.liga + ': pontuação confirmada pelos resultados reais'
      : analise && analise.pronto
        ? analise.liga + ': aguardando as métricas atingirem o limiar'
        : 'Não há resultados suficientes para calcular');
  }

  function horaRobo(jogo) {
    return jogo.horario || String(jogo.hora).padStart(2, '0') +
      ':' + String(jogo.minuto).padStart(2, '0');
  }

  function desenharEntradasReais(analises, mercado, totalTiros, janela) {
    var box = $('#rbEntriesList');
    var info = $('#rbEntriesUpdated');
    var entradas = analises.filter(function (a) {
      return a.entrada && a.futuros.length >= totalTiros;
    });
    if (window.RobosHistorico &&
        typeof window.RobosHistorico.registrar === 'function') {
      window.RobosHistorico.registrar(entradas, mercado, totalTiros);
    }
    info.textContent = entradas.length + ' entrada' +
      (entradas.length === 1 ? '' : 's') + ' real' +
      (entradas.length === 1 ? '' : 'is');
    if (!entradas.length) {
      var resumo = analises.map(function (a) {
        if (!a.pronto) return a.liga + ': amostra ' + a.resultados;
        return a.liga + ': gráfico ' + a.anterior.toFixed(1) + '% → ' +
          a.atual.toFixed(1) + '% / média ' + a.media.toFixed(1) + '% / MACD ' +
          a.macd.toFixed(2);
      }).join(' · ');
      box.innerHTML = '<div class="rb-entry-empty"><b>Nenhuma entrada real agora.</b><br>' +
        escapar(resumo) + '</div>';
      return;
    }
    box.innerHTML = entradas.map(function (a) {
      var tiros = a.futuros.slice(0, totalTiros).map(function (jogo, indice) {
        return '<div><b>TIRO ' + (indice + 1) + '</b><span>' +
          escapar(jogo.time_a) + ' × ' + escapar(jogo.time_b) +
          '</span><em>' + escapar(horaRobo(jogo)) + '</em></div>';
      }).join('');
      return '<article class="rb-entry-item rb-cycle"><header><span>🤖 ENTRADA REAL · ' +
        totalTiros + ' TIROS</span><b>' + a.pontos +
        '/100</b></header><p><strong>' + escapar(a.liga) +
        '</strong> · ' + escapar(mercado) + ' · ' + a.resultados +
        ' resultados lidos · gráfico ' + a.anterior.toFixed(1) + '% → ' +
        a.atual.toFixed(1) + '% · média ' + a.media.toFixed(1) + '% · MACD ' +
        a.macd.toFixed(2) + '</p><div class="rb-shots">' + tiros +
        '</div><footer>Jogos conferidos na faixa atual da grade da API</footer></article>';
    }).join('');
  }

  function carregarEntradas() {
    var box = $('#rbEntriesList');
    var info = $('#rbEntriesUpdated');
    if (!box || !info) return;
    clearTimeout(timerEntradas);
    timerEntradas = setTimeout(function () {
      var ligas = $$('input[name="liga"]:checked').map(function (c) { return c.value; });
      var mercado = $('#rbMercado').value;
      var totalTiros = quantidadeTiros();
      var janela = null;
      var pedido = ++leituraResultados;
      if (!ligas.length) {
        mostrarRegrasReais(null);
        atualizarSinalReal(null, 'Selecione pelo menos uma liga');
        info.textContent = 'Nenhuma liga selecionada';
        box.innerHTML = '<div class="rb-entry-empty">Selecione uma liga para calcular o cenário real.</div>';
        return;
      }
      info.textContent = 'Lendo resultados reais...';
      box.innerHTML = '<div class="rb-entry-empty">Calculando o gráfico com resultados resolvidos...</div>';
      Promise.all(ligas.map(function (liga) {
        var consulta = window.AMDGradeTabs &&
          typeof window.AMDGradeTabs.request === 'function'
          ? window.AMDGradeTabs.request({
            liga: liga, horas: 24, compacto: true, maxAgeMs: 4000
          })
          : fetch('/api/grade?liga=' + encodeURIComponent(liga.toLowerCase()) +
            '&horas=24&compacto=1&_=' + Date.now(), {
              cache: 'no-store', credentials: 'same-origin'
            }).then(function (resposta) {
              if (!resposta.ok) throw new Error('HTTP ' + resposta.status);
              return resposta.json();
            });
        return consulta.then(function (dados) {
            var partidas = Array.isArray(dados.partidas) ? dados.partidas : [];
            var analise = analisarResultados(partidas, mercado, janela);
            analise.liga = liga;
            if (analise.pronto) {
              analise.metricas.mercados = confirmarOutroMercado(
                partidas, mercado, janela);
            }
            return analise;
          }).catch(function (erro) {
            return {
              pronto: false, resultados: 0, futuros: [], liga: liga,
              erro: erro && erro.message ? erro.message : 'falha na API'
            };
          });
      })).then(function (analises) {
        if (pedido !== leituraResultados) return;
        var prontas = analises.filter(function (a) { return a.pronto; });
        if (!prontas.length) {
          mostrarRegrasReais(null);
          var comErro = analises.filter(function (a) { return a.erro; });
          atualizarSinalReal(null, comErro.length
            ? 'Falha ao ler: ' + comErro.map(function (a) { return a.liga; }).join(', ')
            : 'Amostra insuficiente nas ligas selecionadas');
          desenharEntradasReais(analises, mercado, totalTiros, janela);
          return;
        }
        var maior = Math.max.apply(null, prontas.map(function (a) { return a.atual; }));
        prontas.forEach(function (a) {
          a.metricas.ligas = prontas.length > 1 && a.atual === maior &&
            a.metricas.subida && prontas.some(function (outra) {
              return outra !== a && (!outra.metricas.subida || outra.atual < a.atual);
            });
          pontuarRobo(a);
        });
        prontas.sort(function (a, b) { return b.pontos - a.pontos; });
        mostrarRegrasReais(prontas[0]);
        atualizarSinalReal(prontas[0]);
        desenharEntradasReais(prontas, mercado, totalTiros, janela);
      }).catch(function () {
        if (pedido !== leituraResultados) return;
        mostrarRegrasReais(null);
        atualizarSinalReal(null, 'Falha ao calcular os cenários das ligas');
        info.textContent = 'Falha na API';
        box.innerHTML = '<div class="rb-entry-empty">Falha ao ler resultados reais. Nenhuma entrada foi criada.</div>';
      });
    }, 350);
  }

  function renderSalvos() {
    var lista = lerSalvos();
    $('#rbSlots').textContent = lista.length + '/3 salvos';
    if (!lista.length) {
      $('#rbSavedList').innerHTML = '<div class="rb-saved-empty">Nenhum robô de teste salvo. Monte um cenário acima e salve para comparar.</div>';
      return;
    }
    $('#rbSavedList').innerHTML = lista.map(function (r) {
      return '<article class="rb-saved-item" data-id="' + escapar(r.id) + '"><header><h3>'
        + escapar(r.nome) + '</h3><button type="button" title="Excluir">×</button></header><p>'
        + escapar(r.ligas.join(', ')) + ' · ' + escapar(r.mercado) + ' · ' + escapar(r.tiros || 3) + ' tiros</p><footer><span>'
        + escapar(r.perfil) + '</span><b>' + r.limiar + ' pontos</b></footer></article>';
    }).join('');
    $$('.rb-saved-item button').forEach(function (botao) {
      botao.addEventListener('click', function () {
        var id = botao.closest('.rb-saved-item').dataset.id;
        gravarSalvos(lerSalvos().filter(function (r) { return r.id !== id; }));
        renderSalvos(); toast('Robô de teste removido');
      });
    });
  }

  function toast(texto) {
    var el = $('#rbToast');
    el.textContent = texto; el.classList.add('show');
    clearTimeout(toast.timer); toast.timer = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  function salvar() {
    var lista = lerSalvos();
    if (lista.length >= 3) { toast('Limite de 3 robôs de teste atingido'); return; }
    var ligas = $$('input[name="liga"]:checked').map(function (c) { return c.value; });
    if (!ligas.length) { toast('Selecione pelo menos uma liga'); return; }
    var nome = $('#rbNome').value.trim() || 'Meu padrão';
    lista.unshift({
      id: String(Date.now()), nome: nome, ligas: ligas,
      mercado: $('#rbMercado').value,
      tiros: quantidadeTiros(),
      perfil: nomePerfilAtual(),
      limiar: Number($('#rbLimiar').value), regras: regras()
    });
    gravarSalvos(lista); renderSalvos(); toast('Robô salvo somente neste navegador');
  }

  function limpar() {
    $$('.rb-rule').forEach(function (el, i) {
      var usar = $('.rb-use input', el);
      if (usar && !usar.disabled) usar.checked = true;
      var ligado = i < 3;
      $('.rb-now', el).classList.toggle('on', ligado);
      $('.rb-now', el).setAttribute('aria-pressed', ligado ? 'true' : 'false');
      $('.rb-now', el).textContent = 'Agora: ' + (ligado ? 'SIM' : 'NÃO');
    });
    definirPerfil('equilibrado'); toast('Cenário restaurado');
  }

  function iniciar() {
    $$('.rb-profiles button').forEach(function (b) {
      b.addEventListener('click', function () { definirPerfil(b.dataset.profile); });
    });
    $$('.rb-now').forEach(function (b) {
      b.addEventListener('click', function () {
        var ligado = !b.classList.contains('on');
        b.classList.toggle('on', ligado); b.setAttribute('aria-pressed', ligado ? 'true' : 'false');
        b.textContent = 'Agora: ' + (ligado ? 'SIM' : 'NÃO'); calcular();
      });
    });
    $$('.rb-use input').forEach(function (c) { c.addEventListener('change', calcular); });
    $$('.rb-rule').forEach(function (el) {
      el.addEventListener('click', function (ev) {
        if (ev.target.closest('.rb-now') || ev.target.closest('.rb-use')) return;
        var usar = $('.rb-use input', el);
        if (!usar || usar.disabled) return;
        usar.checked = !usar.checked;
        calcular();
      });
    });
    $$('input[name="liga"]').forEach(function (c) { c.addEventListener('change', calcular); });
    $('#rbMercado').addEventListener('change', calcular);
    var tiros = $('#rbTiros');
    if (tiros) tiros.addEventListener('change', calcular);
    $('#rbLimiar').addEventListener('input', function () {
      $('#rbLimiarOut').textContent = this.value;
      perfilAtual = 'personalizado';
      $$('.rb-profiles button').forEach(function (b) { b.classList.remove('active'); });
      calcular();
    });
    $('#rbSimular').addEventListener('click', function () { calcular(); toast('Cenário recalculado'); });
    $('#rbSave').addEventListener('click', salvar);
    $('#rbReset').addEventListener('click', limpar);
    renderSalvos(); calcular();
    setInterval(function () { if (!document.hidden) calcular(); }, 20000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
