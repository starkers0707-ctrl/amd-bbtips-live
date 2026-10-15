(function () {
  'use strict';

  var CFG = { minimo: 5, intervalo: 5000, maxCicloMs: 20 * 60 * 1000 };
  var ligado = false, timer = null, observador = null, aplicando = false;
  var marcadas = [], ultimoAlerta = '', ciclo = null, bloqueios = {};
  var STORAGE = 'amd:r3:ciclo:v1', BLOQUEIOS_STORAGE = 'amd:r3:bloqueios:v1';

  var CSS = ''
    + '#robo3tBtn.on{color:#ffdf3d;border-color:#ffca00;background:rgba(255,202,0,.12);'
    + 'box-shadow:0 0 14px rgba(255,202,0,.5);animation:robo3tBotao 1.3s ease-in-out infinite}'
    + '#robo3tBtn .robo3t-n{font-size:9px;margin-left:3px}'
    + '.robo3t-hit{outline:2px solid #ffd000!important;outline-offset:-2px;position:relative;'
    + 'box-shadow:0 0 16px rgba(255,208,0,.55)!important;animation:robo3tCelula 1.2s ease-in-out infinite}'
    + '.robo3t-card{font:800 8px/1.2 "Share Tech Mono",monospace;color:#071015;'
    + 'background:#ffd000;border-radius:3px;padding:2px 3px;margin:-2px -2px 2px;position:relative;z-index:8}'
    + '.robo3t-hit.robo3t-red{outline-color:#ff3e4d!important;box-shadow:0 0 16px rgba(255,62,77,.55)!important}'
    + '.robo3t-hit.robo3t-green{outline-color:#20ef61!important;box-shadow:0 0 18px rgba(32,239,97,.65)!important}'
    + '.robo3t-red .robo3t-card{background:#ff3e4d;color:#fff}.robo3t-green .robo3t-card{background:#20ef61}'
    + '.robo3t-cancelado .robo3t-card{background:#53636b;color:#e8f0f3}'
    + '.robo3t-alerta{position:fixed;left:50%;top:72px;transform:translateX(-50%);z-index:2147482000;'
    + 'max-width:min(820px,92vw);padding:12px 18px;border:2px solid #ffd000;border-radius:10px;'
    + 'background:#071015;color:#ffe65c;font:800 12px/1.4 "Share Tech Mono",monospace;'
    + 'box-shadow:0 0 30px rgba(255,208,0,.65);text-align:center;animation:robo3tAlerta 1.2s ease-in-out infinite}'
    + '.robo3t-alerta.green{color:#38f776;border-color:#20ef61;box-shadow:0 0 30px rgba(32,239,97,.65)}'
    + '.robo3t-alerta.red{color:#ff6671;border-color:#ff3e4d;box-shadow:0 0 30px rgba(255,62,77,.65)}'
    + 'body.robo3t-sinal:after{content:"";position:fixed;inset:0;z-index:2147481900;pointer-events:none;'
    + 'border:5px solid rgba(255,208,0,.8);box-shadow:inset 0 0 45px rgba(255,208,0,.2)}'
    + 'body.robo3t-green:after{border-color:rgba(32,239,97,.85);box-shadow:inset 0 0 45px rgba(32,239,97,.2)}'
    + 'body.robo3t-red:after{border-color:rgba(255,62,77,.85);box-shadow:inset 0 0 45px rgba(255,62,77,.2)}'
    + '@keyframes robo3tBotao{50%{box-shadow:0 0 24px rgba(255,202,0,.85)}}'
    + '@keyframes robo3tCelula{50%{filter:brightness(1.28)}}'
    + '@keyframes robo3tAlerta{50%{border-color:#fff19a;box-shadow:0 0 42px rgba(255,208,0,.85)}}'
    + '@media(prefers-reduced-motion:reduce){#robo3tBtn.on,.robo3t-hit,.robo3t-alerta{animation:none}}';

  function horaDaLinha(row) {
    var p = row.previousElementSibling;
    while (p && !p.classList.contains('hour-label')) p = p.previousElementSibling;
    var m = p && (p.textContent || '').match(/(\d{1,2})\s*h/i);
    return m ? parseInt(m[1], 10) : null;
  }

  function coletar() {
    var linhas = [].slice.call(document.querySelectorAll('#grade .gridrow'));
    var sequencia = [];
    linhas.slice().reverse().forEach(function (linha) {
      var hora = horaDaLinha(linha);
      [].slice.call(linha.children).filter(function (el) {
        return el.classList.contains('match');
      }).forEach(function (el, coluna) {
        var jogo = el.__realJogo || {};
        sequencia.push({
          el: el, jogo: jogo, hora: hora, coluna: coluna,
          id: jogo.id || el.dataset.gameId || '', slot: jogo.slot || Number(el.dataset.slot),
          minuto: jogo.minuto,
          timeA: jogo.timeA || '', timeB: jogo.timeB || '',
          placar: jogo.placar || '', placarHT: jogo.placarHT || '',
          odds: jogo.odds || {}, real: !!el.__realJogo,
          resolvido: !!jogo.resolvido,
          pago: el.classList.contains('pay'),
          red: el.classList.contains('nopay'),
          pendente: el.classList.contains('neutral')
        });
      });
    });
    return sequencia;
  }

  function mercadoAtual() {
    var botao = document.getElementById('mktBtn');
    return ((botao && botao.textContent) || '').replace(/^\s*Mercado:\s*/i, '')
      .replace(/\s*[⌄▾▼].*$/, '').trim();
  }

  function janelaAtual() {
    var ativo = document.querySelector('#horas .tab.active');
    return ativo ? ativo.textContent.trim() : '';
  }

  function ligaAtual() {
    if (window.Real && typeof window.Real.liga === 'function') {
      try { return String(window.Real.liga() || ''); } catch (e) {}
    }
    return '';
  }

  function oddDoJogo(item, mercado) {
    var nome = String(mercado || '').toLowerCase();
    var chave = '';
    if (nome.indexOf('over 2.5') >= 0) chave = 'odd_over_2.5';
    else if (nome.indexOf('over 3.5') >= 0) chave = 'odd_over_3.5';
    else if (nome.indexOf('5+') >= 0) chave = 'odd_total_gols_extatos_5';
    else if (/ambas.*(n[aã]o|\(n)/i.test(nome)) chave = 'odd_ambas_nao';
    else if (nome.indexOf('ambas') >= 0) chave = 'odd_ambas_sim';
    else if (nome.indexOf('under 1.5') >= 0) chave = 'odd_under_1.5';
    else if (nome.indexOf('under 0.5') >= 0) chave = 'odd_under_0.5';
    var valor = chave && item.odds ? Number(item.odds[chave]) : NaN;
    return isFinite(valor) && valor > 1 ? valor : null;
  }

  function limpar() {
    marcadas.forEach(function (el) {
      if (!el) return;
      el.classList.remove('robo3t-hit', 'robo3t-red', 'robo3t-green', 'robo3t-cancelado');
      var card = el.querySelector('.robo3t-card');
      if (card) card.remove();
      if (el.getAttribute('data-robo3t-title')) {
        el.removeAttribute('title'); el.removeAttribute('data-robo3t-title');
      }
    });
    marcadas = [];
    [].slice.call(document.querySelectorAll('.robo3t-hit')).forEach(function (el) {
      el.classList.remove('robo3t-hit', 'robo3t-red', 'robo3t-green', 'robo3t-cancelado');
      var card = el.querySelector('.robo3t-card'); if (card) card.remove();
    });
    var alerta = document.getElementById('robo3tAlerta');
    if (alerta) alerta.remove();
    document.body.classList.remove('robo3t-sinal', 'robo3t-green', 'robo3t-red');
  }

  function marcar(el, rotulo, texto, classe) {
    if (!el) return;
    el.classList.add('robo3t-hit');
    if (classe) el.classList.add(classe);
    el.setAttribute('data-robo3t-title', '1'); el.title = texto;
    var card = document.createElement('div');
    card.className = 'robo3t-card'; card.textContent = rotulo;
    el.insertBefore(card, el.firstChild); marcadas.push(el);
  }

  function atualizarBotao(valor) {
    var botao = document.getElementById('robo3tBtn');
    if (!botao) return;
    botao.classList.toggle('on', ligado);
    botao.setAttribute('aria-pressed', ligado ? 'true' : 'false');
    var badge = botao.querySelector('.robo3t-n');
    if (badge) badge.textContent = ligado ? '(' + valor + ')' : '';
  }

  function salvarCiclo() {
    try {
      if (ciclo) localStorage.setItem(STORAGE, JSON.stringify(ciclo));
      else localStorage.removeItem(STORAGE);
      localStorage.setItem(BLOQUEIOS_STORAGE, JSON.stringify(bloqueios));
    } catch (e) {}
  }

  function carregarCiclo() {
    try {
      var salvo = JSON.parse(localStorage.getItem(STORAGE) || 'null');
      ciclo = salvo && Array.isArray(salvo.tiros) && salvo.tiros.length === 3 ? salvo : null;
      bloqueios = JSON.parse(localStorage.getItem(BLOQUEIOS_STORAGE) || '{}') || {};
      if (ciclo && ciclo.status !== 'EM ANDAMENTO') bloqueios[ciclo.mercado] = true;
    } catch (e) { ciclo = null; bloqueios = {}; }
  }

  function emitirSom(tipo) {
    if (window.AMDAlertaPodeDisparar && !window.AMDAlertaPodeDisparar()) return;
    try {
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      var ctx = new AudioCtx(), osc = ctx.createOscillator(), ganho = ctx.createGain();
      osc.frequency.value = tipo === 'GREEN' ? 1120 : tipo === 'RED' ? 330 : 880;
      ganho.gain.value = 0.08; osc.connect(ganho); ganho.connect(ctx.destination); osc.start();
      ganho.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
      osc.stop(ctx.currentTime + 0.56);
    } catch (e) {}
  }

  function criarCiclo(analise, mercado, proximas) {
    var taxa = Math.round(analise.forca * 100);
    var resumo = analise.confirmacoes.slice(0, 4).map(function (f) {
      return f.nome + ' ' + Math.round(f.taxa * 100) + '% n' + f.ocorrencias;
    }).join(' · ');
    var detalhe = 'R3 completo · ' + mercado + ' · ' + analise.alvo.timeA + ' x '
      + analise.alvo.timeB + ' · odd ' + Number(analise.alvo.odd).toFixed(2)
      + ' · confluência ' + analise.confirmacoes.length + ' parâmetros · ' + resumo;
    ciclo = {
      versao: 1, status: 'EM ANDAMENTO', mercado: mercado, janela: janelaAtual(),
      liga: window.Real && typeof window.Real.liga === 'function' ? window.Real.liga() : '',
      criadoEm: Date.now(), taxa: taxa, detalhe: detalhe,
      alvo: analise.alvo.timeA + ' x ' + analise.alvo.timeB,
      odd: Number(analise.alvo.odd), confirmacoes: analise.confirmacoes.length,
      tiros: proximas.map(function (p, i) {
        return { numero: i + 1, chave: window.RoboPadroesModel.chaveJogo(p),
          id: p.id || '', slot: p.slot, timeA: p.timeA, timeB: p.timeB,
          hora: p.hora, minuto: p.minuto, status: 'AGUARDANDO', placar: '' };
      })
    };
    salvarCiclo();
    var chave = mercado + '|' + janelaAtual() + '|' + ciclo.tiros.map(function (t) {
      return t.chave;
    }).join(',');
    if (chave !== ultimoAlerta) {
      ultimoAlerta = chave; emitirSom('SINAL');
    }
  }

  function jogosParaAcompanhar(sequencia) {
    var todos = [];
    if (window.Real && typeof window.Real.jogos === 'function') {
      try { todos = (window.Real.jogos() || []).slice(); } catch (e) {}
    }
    sequencia.forEach(function (c) {
      if (!todos.some(function (j) {
        return window.RoboPadroesModel.chaveJogo(j) === window.RoboPadroesModel.chaveJogo(c);
      })) todos.push(c);
    });
    return todos;
  }

  function acompanharCiclo(sequencia) {
    if (!ciclo || ciclo.status !== 'EM ANDAMENTO') return;
    if (ciclo.criadoEm && Date.now() - ciclo.criadoEm > CFG.maxCicloMs) {
      ciclo.status = 'EXPIRADO'; ciclo.concluidoEm = Date.now();
      bloqueios[ciclo.mercado] = true; salvarCiclo();
      if (typeof window.mostrarAviso === 'function')
        window.mostrarAviso('🤖 R3 expirado · os resultados do ciclo não foram localizados');
      return;
    }
    /* Cada liga possui sua própria grade carregada. Não tenta julgar um ciclo
       da Premier usando os jogos que estão na tela da Copa, por exemplo. */
    if (ciclo.liga && ligaAtual() && ciclo.liga !== ligaAtual()) return;
    var anterior = ciclo.status;
    window.RoboPadroesModel.atualizarCiclo(ciclo, jogosParaAcompanhar(sequencia),
      function (jogo, mercado) {
        try { return !!window.pagou(mercado, jogo); } catch (e) { return !!jogo.pago; }
      });
    if (anterior !== ciclo.status && (ciclo.status === 'GREEN' || ciclo.status === 'RED')) {
      /* Fecha o gatilho atual. Um novo ciclo só pode nascer depois que a
         condição estatística deixar de existir e aparecer novamente. */
      ciclo.rearmeLiberado = false;
      bloqueios[ciclo.mercado] = true;
      emitirSom(ciclo.status);
      if (typeof window.mostrarAviso === 'function') {
        window.mostrarAviso(ciclo.status === 'GREEN'
          ? '🤖 R3 GREEN no tiro ' + ciclo.tiroVencedor + ' · ' + ciclo.mercado
          : '🤖 R3 RED após os 3 tiros · ' + ciclo.mercado);
      }
    }
    salvarCiclo();
  }

  function renderCiclo(sequencia) {
    if (!ciclo) return;
    var finalizado = ciclo.status === 'GREEN' || ciclo.status === 'RED' ||
      ciclo.status === 'EXPIRADO';
    if (finalizado && ciclo.concluidoEm && Date.now() - ciclo.concluidoEm > 10000) {
      /* O resultado continua registrado no botão, mas não bloqueia a tela. */
      atualizarBotao(ciclo.status); return;
    }
    var porChave = {};
    sequencia.forEach(function (item) {
      porChave[window.RoboPadroesModel.chaveJogo(item)] = item;
      if (item.id) porChave['id:' + String(item.id)] = item;
    });
    ciclo.tiros.forEach(function (tiro, i) {
      var item = porChave[window.RoboPadroesModel.chaveJogo(tiro)] || porChave[tiro.chave];
      if (!item) item = sequencia.filter(function (candidato) {
        return String(candidato.timeA || '').toLowerCase() === String(tiro.timeA || '').toLowerCase() &&
          String(candidato.timeB || '').toLowerCase() === String(tiro.timeB || '').toLowerCase() &&
          Number(candidato.hora) === Number(tiro.hora) &&
          Number(candidato.minuto) === Number(tiro.minuto);
      })[0];
      if (!item || !item.el) return;
      var nome = i === 0 ? 'ENTRADA' : 'TIRO ' + (i + 1);
      var classe = tiro.status === 'GREEN' ? 'robo3t-green'
        : tiro.status === 'RED' ? 'robo3t-red'
        : tiro.status === 'CANCELADO' ? 'robo3t-cancelado' : '';
      marcar(item.el, nome + ' · ' + tiro.status, ciclo.detalhe, classe);
    });
    var alerta = document.createElement('div');
    alerta.id = 'robo3tAlerta'; alerta.className = 'robo3t-alerta '
      + (ciclo.status === 'GREEN' ? 'green' : ciclo.status === 'RED' ? 'red' : '');
    alerta.setAttribute('role', 'alert');
    if (ciclo.status === 'GREEN') {
      alerta.textContent = '✅ R3 GREEN NO TIRO ' + ciclo.tiroVencedor + ' · '
        + ciclo.mercado + ' · ' + ciclo.alvo + ' · CICLO ENCERRADO';
      document.body.classList.add('robo3t-green'); atualizarBotao('GREEN');
    } else if (ciclo.status === 'RED') {
      alerta.textContent = '❌ R3 RED · OS 3 TIROS NÃO PAGARAM · '
        + ciclo.mercado + ' · ' + ciclo.alvo + ' · CICLO ENCERRADO';
      document.body.classList.add('robo3t-red'); atualizarBotao('RED');
    } else if (ciclo.status === 'EXPIRADO') {
      alerta.textContent = '⚠ R3 EXPIRADO · CICLO ANTIGO ENCERRADO SEM RESULTADO · '
        + ciclo.mercado + ' · ' + ciclo.alvo;
      atualizarBotao('EXP');
    } else {
      var reds = ciclo.tiros.filter(function (t) { return t.status === 'RED'; }).length;
      var atual = Math.min(reds + 1, 3);
      alerta.textContent = '🤖 R3 EM ANDAMENTO · ' + ciclo.mercado + ' · '
        + ciclo.alvo + ' · ' + (reds ? reds + ' RED · ' : '')
        + 'AGUARDANDO TIRO ' + atual + ' · força ' + ciclo.taxa + '%';
      atualizarBotao('T' + atual);
    }
    document.body.appendChild(alerta); document.body.classList.add('robo3t-sinal');
  }

  function prepararMercado(base, mercado) {
    return base.map(function (item) {
      var copia = {};
      Object.keys(item).forEach(function (k) { copia[k] = item[k]; });
      copia.odd = oddDoJogo(copia, mercado);
      if (copia.real && copia.resolvido) {
        try { copia.pago = !!window.pagou(mercado, copia.jogo); } catch (e) { copia.pago = false; }
        copia.red = !copia.pago; copia.pendente = false;
      } else {
        copia.pago = false; copia.red = false;
        copia.pendente = copia.real && !copia.resolvido;
      }
      return copia;
    });
  }

  function analisarMercado(base, mercado) {
    var sequencia = prepararMercado(base, mercado);
    var resolvidos = sequencia.filter(function (c) { return c.real && c.resolvido; });
    var ultimoResolvido = -1;
    sequencia.forEach(function (c, i) { if (c.real && c.resolvido) ultimoResolvido = i; });
    var proximas = sequencia.slice(ultimoResolvido + 1).filter(function (c) {
      var agora = window.Real && typeof window.Real.agoraSlot === 'function' ? Number(window.Real.agoraSlot()) : null;
      return c.pendente && c.real && (!isFinite(agora) || !isFinite(Number(c.slot)) || Number(c.slot) > agora);
    }).slice(0, 3);
    if (proximas.length < 3) return { mercado: mercado, sinal: false, proximas: proximas };
    var analise = window.RoboPadroesModel.analisarCompleto(
      resolvidos, proximas[0], mercado, CFG.minimo);
    return { mercado: mercado, sinal: !!(analise.suportado && analise.sinal),
      analise: analise, proximas: proximas };
  }

  function varrer() {
    if (!ligado || !window.RoboPadroesModel) return;
    aplicando = true;
    try {
      limpar();
      var sequencia = coletar();
      var mercadoTela = mercadoAtual();
      var ligaTela = ligaAtual();
      if (ciclo && ((ciclo.mercado && ciclo.mercado !== mercadoTela) ||
          (ciclo.liga && ligaTela && ciclo.liga !== ligaTela))) {
        /* O R3 pertence exclusivamente ao que está sendo visto. Trocar liga
           ou mercado encerra silenciosamente a marcação anterior. */
        delete bloqueios[ciclo.mercado]; ciclo = null; salvarCiclo();
      }
      acompanharCiclo(sequencia);
      if (ciclo && ciclo.status === 'EM ANDAMENTO') {
        renderCiclo(sequencia); return;
      }
      var resultados = [mercadoTela].map(function (mercado) {
        return analisarMercado(sequencia, mercado);
      });
      var alterouBloqueio = false;
      resultados.forEach(function (r) {
        if (!r.sinal && bloqueios[r.mercado]) {
          delete bloqueios[r.mercado]; alterouBloqueio = true;
        }
      });
      if (alterouBloqueio) salvarCiclo();

      /* Mostra GREEN/RED por dez segundos antes de liberar outra entrada. */
      if (ciclo && ciclo.concluidoEm && Date.now() - ciclo.concluidoEm <= 10000) {
        renderCiclo(sequencia); return;
      }
      var candidatos = resultados.filter(function (r) {
        return r.sinal && !bloqueios[r.mercado];
      }).sort(function (a, b) {
        var margemA = a.analise.forca - a.analise.limiar;
        var margemB = b.analise.forca - b.analise.limiar;
        return margemB - margemA || b.analise.confirmacoes.length - a.analise.confirmacoes.length;
      });
      if (candidatos.length) {
        var melhor = candidatos[0];
        criarCiclo(melhor.analise, melhor.mercado, melhor.proximas);
        renderCiclo(sequencia); return;
      }
      if (ciclo) renderCiclo(sequencia); else atualizarBotao(0);
    } catch (erro) {
      console.warn('[R3]', erro); atualizarBotao('!');
    } finally {
      setTimeout(function () { aplicando = false; }, 80);
    }
  }

  function observar() {
    var grade = document.getElementById('grade');
    if (!grade || observador) return;
    var espera = null;
    observador = new MutationObserver(function () {
      if (!ligado || aplicando) return;
      clearTimeout(espera); espera = setTimeout(varrer, 350);
    });
    observador.observe(grade, { childList: true, subtree: true });
  }

  function ligar() {
    ligado = true; ultimoAlerta = ''; carregarCiclo(); atualizarBotao('...'); varrer(); observar();
    clearInterval(timer); timer = setInterval(varrer, CFG.intervalo);
  }

  function desligar() {
    ligado = false; clearInterval(timer); timer = null;
    if (observador) { observador.disconnect(); observador = null; }
    limpar(); atualizarBotao('');
  }

  function criarBotao() {
    if (document.getElementById('robo3tBtn')) return true;
    var npro = document.getElementById('nproBtn');
    var barra = npro && npro.parentElement;
    if (!barra) return false;
    var botao = document.createElement('button');
    botao.id = 'robo3tBtn'; botao.type = 'button'; botao.className = 'chip';
    botao.setAttribute('aria-pressed', 'false');
    botao.title = 'Desligado por padrão · monitora somente o mercado e a liga visíveis · 5+ ocorrências · 3 tiros';
    botao.innerHTML = '🤖 R3 <span class="robo3t-n"></span>';
    botao.addEventListener('click', function () { ligado ? desligar() : ligar(); });
    npro.insertAdjacentElement('afterend', botao);
    return true;
  }

  function iniciar() {
    var estilo = document.createElement('style'); estilo.id = 'robo3t-css';
    estilo.textContent = CSS; document.head.appendChild(estilo);
    var tentativas = 0;
    var espera = setInterval(function () {
      if (criarBotao() || ++tentativas > 40) clearInterval(espera);
    }, 250);
    window.Robo3T = { ligar: ligar, desligar: desligar, varrer: varrer,
      ligado: function () { return ligado; }, ciclo: function () { return ciclo; },
      mercados: function () { return [mercadoAtual()]; }, cfg: CFG };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
