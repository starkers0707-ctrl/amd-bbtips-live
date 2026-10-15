/* Compartilha as consultas da grade entre todas as abas do mesmo navegador. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document && !root.AMDGradeTabs) {
    root.AMDGradeTabs = api.criar({ root: root });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var CHANNEL_NAME = 'amd-grade-tabs-v1';
  var LEADER_KEY = 'amd:grade-tabs-lider:v1';
  var LEADER_LOCK = 'amd-grade-tabs-eleicao';
  var LEASE_MS = 12000;
  var HEARTBEAT_MS = 4000;
  // Uma aba em segundo plano pode ser congelada pelo navegador mesmo ainda
  // aparecendo como lider no localStorage. Esperar 32 s fazia a grade parecer
  // travada. Depois de 6 s, a aba visivel consulta nosso proprio banco
  // diretamente; isso nao cria chamadas extras para a RapidAPI.
  var REQUEST_TIMEOUT_MS = 6000;
  var RECONCILIAR_MS = 15 * 60 * 1000;

  function idAleatorio(root) {
    return root.crypto && typeof root.crypto.randomUUID === 'function'
      ? root.crypto.randomUUID()
      : String(Date.now()) + '-' + Math.random().toString(36).slice(2);
  }

  function normalizarOpcoes(opcoes) {
    opcoes = opcoes || {};
    var liga = String(opcoes.liga || 'copa').trim().toLowerCase();
    var horas = Math.max(1, Math.min(168, parseInt(opcoes.horas, 10) || 48));
    return {
      liga: liga,
      horas: horas,
      compacto: opcoes.compacto !== false,
      diaAtual: opcoes.diaAtual === true,
      maxAgeMs: Math.max(0, Number(opcoes.maxAgeMs) || 0)
    };
  }

  function chaveEscopo(opcoes) {
    var o = normalizarOpcoes(opcoes);
    return [o.liga, o.horas, o.compacto ? 'compacto' : 'completo',
      o.diaAtual ? 'dia' : 'janela'].join('|');
  }

  function chavePartida(partida) {
    partida = partida || {};
    if (partida.id !== undefined && partida.id !== null && partida.id !== '') {
      return 'id:' + String(partida.id);
    }
    return [partida.slot_em || '', partida.hora || '', partida.minuto || '',
      String(partida.time_a || '').trim().toLowerCase(),
      String(partida.time_b || '').trim().toLowerCase()].join('|');
  }

  function instantePartida(partida) {
    var ts = Date.parse((partida && (
      partida.resultado_em || partida.visto_em || partida.criado_em
    )) || '');
    return isNaN(ts) ? 0 : ts;
  }

  function mesclarPartidas(atuais, alteradas) {
    var mapa = Object.create(null);
    (Array.isArray(atuais) ? atuais : []).concat(
      Array.isArray(alteradas) ? alteradas : []
    ).forEach(function (partida) {
      var chave = chavePartida(partida);
      var anterior = mapa[chave];
      var resolvida = !!String((partida && partida.resultado_ft) || '').trim();
      var anteriorResolvida = !!String((anterior && anterior.resultado_ft) || '').trim();
      if (!anterior || (resolvida && !anteriorResolvida) ||
          (resolvida === anteriorResolvida &&
           instantePartida(partida) >= instantePartida(anterior))) {
        mapa[chave] = partida;
      }
    });
    return Object.keys(mapa).map(function (chave) { return mapa[chave]; })
      .sort(function (a, b) {
        var slotA = Date.parse(a.slot_em || a.criado_em || '') || 0;
        var slotB = Date.parse(b.slot_em || b.criado_em || '') || 0;
        return slotA - slotB || instantePartida(a) - instantePartida(b);
      });
  }

  function criar(config) {
    config = config || {};
    var root = config.root || (typeof globalThis !== 'undefined' ? globalThis : {});
    var storage = config.storage || root.localStorage;
    var fetcher = config.fetch || (root.fetch && root.fetch.bind(root));
    var setTimer = config.setTimeout || root.setTimeout.bind(root);
    var clearTimer = config.clearTimeout || root.clearTimeout.bind(root);
    var setRepeater = config.setInterval || root.setInterval.bind(root);
    var clearRepeater = config.clearInterval || root.clearInterval.bind(root);
    var now = config.now || Date.now;
    var requestTimeoutMs = config.requestTimeoutMs == null
      ? REQUEST_TIMEOUT_MS : Math.max(1, Number(config.requestTimeoutMs) || REQUEST_TIMEOUT_MS);
    var tabId = config.tabId || idAleatorio(root);
    var estados = Object.create(null);
    var cacheRemoto = Object.create(null);
    var pendentes = Object.create(null);
    var parado = false;
    var canal = null;

    var Channel = config.BroadcastChannel || root.BroadcastChannel;
    try { if (Channel) canal = new Channel(CHANNEL_NAME); } catch (_) { canal = null; }

    function lerLider() {
      try { return JSON.parse(storage.getItem(LEADER_KEY) || 'null'); }
      catch (_) { return null; }
    }

    function gravarLider() {
      try {
        storage.setItem(LEADER_KEY, JSON.stringify({
          id: tabId,
          expires: now() + LEASE_MS
        }));
        var atual = lerLider();
        return !!atual && atual.id === tabId;
      } catch (_) {
        return true;
      }
    }

    function tentarLideranca() {
      var atual = lerLider();
      if (atual && atual.id !== tabId && Number(atual.expires) > now()) return false;
      return gravarLider();
    }

    function souLider() {
      var atual = lerLider();
      return !!atual && atual.id === tabId && Number(atual.expires) > now();
    }

    function eleger() {
      if (!canal) return Promise.resolve(true);
      if (souLider()) {
        gravarLider();
        return Promise.resolve(true);
      }
      var locks = root.navigator && root.navigator.locks;
      if (locks && typeof locks.request === 'function') {
        return locks.request(LEADER_LOCK, { mode: 'exclusive' }, tentarLideranca)
          .catch(function () { return tentarLideranca(); });
      }
      return Promise.resolve(tentarLideranca());
    }

    function soltarLideranca() {
      try {
        var atual = lerLider();
        if (atual && atual.id === tabId) storage.removeItem(LEADER_KEY);
      } catch (_) {}
    }

    function publicar(mensagem) {
      if (!canal || parado) return;
      try { canal.postMessage(mensagem); } catch (_) {}
    }

    function snapshot(estado, escopo, alterados, incremental) {
      return {
        liga: estado.opcoes.liga,
        horas: estado.opcoes.horas,
        dia: estado.opcoes.diaAtual ? 'atual' : null,
        cursor: estado.cursor || null,
        total: estado.partidas.length,
        partidas: estado.partidas.slice(),
        incremental: !!incremental,
        alterados: Number(alterados) || 0,
        atualizadoEm: estado.atualizadoEm || now(),
        compartilhado: !!canal,
        escopo: escopo
      };
    }

    function avisarAutenticacao() {
      try {
        if (typeof root.CustomEvent === 'function' && root.dispatchEvent) {
          root.dispatchEvent(new root.CustomEvent('amd:auth-required'));
        }
      } catch (_) {}
    }

    function buscarRemoto(opcoes) {
      var o = normalizarOpcoes(opcoes);
      var escopo = chaveEscopo(o);
      var estado = estados[escopo] || (estados[escopo] = {
        opcoes: o,
        partidas: [],
        cursor: '',
        ultimaCompleta: 0,
        atualizadoEm: 0,
        emVoo: null
      });
      var idade = now() - estado.atualizadoEm;
      if (estado.partidas.length && idade <= o.maxAgeMs) {
        return Promise.resolve(snapshot(estado, escopo, 0, true));
      }
      if (estado.emVoo) return estado.emVoo;

      var completa = !estado.cursor || !estado.partidas.length ||
        now() - estado.ultimaCompleta >= RECONCILIAR_MS;
      var controller = typeof root.AbortController === 'function'
        ? new root.AbortController() : null;
      var timeout = setTimer(function () { if (controller) controller.abort(); }, 30000);
      var url = '/api/grade?liga=' + encodeURIComponent(o.liga) +
        '&horas=' + o.horas + (o.compacto ? '&compacto=1' : '') +
        (o.diaAtual ? '&dia=atual' : '') +
        (!completa && estado.cursor ? '&desde=' + encodeURIComponent(estado.cursor) : '') +
        '&_=' + now();

      estado.emVoo = fetcher(url, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        signal: controller ? controller.signal : undefined
      }).then(function (resposta) {
        if (!resposta.ok) {
          var erro = new Error('HTTP ' + resposta.status);
          erro.status = resposta.status;
          throw erro;
        }
        return resposta.json();
      }).then(function (dados) {
        var alteradas = Array.isArray(dados && dados.partidas) ? dados.partidas : [];
        estado.partidas = completa
          ? mesclarPartidas([], alteradas)
          : mesclarPartidas(estado.partidas, alteradas);
        if (dados && dados.cursor) estado.cursor = String(dados.cursor);
        if (completa) estado.ultimaCompleta = now();
        estado.atualizadoEm = now();
        var resposta = snapshot(estado, escopo, alteradas.length, !completa);
        cacheRemoto[escopo] = resposta;
        publicar({ type: 'snapshot', from: tabId, escopo: escopo, payload: resposta });
        return resposta;
      }).catch(function (erro) {
        if (erro && erro.status === 401) avisarAutenticacao();
        throw erro;
      }).then(function (resposta) {
        clearTimer(timeout);
        estado.emVoo = null;
        return resposta;
      }, function (erro) {
        clearTimer(timeout);
        estado.emVoo = null;
        throw erro;
      });
      return estado.emVoo;
    }

    function resolverEscopo(escopo, payload) {
      cacheRemoto[escopo] = payload;
      Object.keys(pendentes).forEach(function (id) {
        var pendente = pendentes[id];
        if (!pendente || pendente.escopo !== escopo) return;
        clearTimer(pendente.timer);
        delete pendentes[id];
        pendente.resolve(payload);
      });
    }

    function aoReceber(evento) {
      var mensagem = evento && evento.data;
      if (!mensagem || mensagem.from === tabId || parado) return;
      if (mensagem.type === 'snapshot' && mensagem.escopo && mensagem.payload) {
        resolverEscopo(mensagem.escopo, mensagem.payload);
        return;
      }
      if (mensagem.type !== 'request' || !mensagem.requestId) return;
      if (!souLider()) return;
      gravarLider();
      buscarRemoto(mensagem.opcoes).then(function (payload) {
        publicar({
          type: 'response', from: tabId, to: mensagem.from,
          requestId: mensagem.requestId, escopo: mensagem.escopo, payload: payload
        });
      }).catch(function (erro) {
        publicar({
          type: 'error', from: tabId, to: mensagem.from,
          requestId: mensagem.requestId,
          message: erro && erro.message ? erro.message : 'falha na grade'
        });
      });
    }

    function aoReceberCompleto(evento) {
      var mensagem = evento && evento.data;
      if (mensagem && mensagem.to === tabId && mensagem.requestId) {
        var pendente = pendentes[mensagem.requestId];
        if (pendente) {
          clearTimer(pendente.timer);
          delete pendentes[mensagem.requestId];
          if (mensagem.type === 'response') pendente.resolve(mensagem.payload);
          else if (mensagem.type === 'error') pendente.reject(new Error(mensagem.message));
        }
      }
      aoReceber(evento);
    }
    if (canal) canal.onmessage = aoReceberCompleto;

    function pedirAoLider(opcoes) {
      var escopo = chaveEscopo(opcoes);
      var guardado = cacheRemoto[escopo];
      if (guardado && opcoes.maxAgeMs > 0 &&
          now() - Number(guardado.atualizadoEm || 0) <= opcoes.maxAgeMs) {
        return Promise.resolve(guardado);
      }
      var requestId = tabId + ':' + now() + ':' + Math.random().toString(36).slice(2);
      return new Promise(function (resolve, reject) {
        var timer = setTimer(function () {
          delete pendentes[requestId];
          // Mesmo que a eleicao ainda enxergue uma lease antiga, nao podemos
          // deixar a tela parada. A consulta e somente ao /api/grade local.
          eleger().then(function () {
            return buscarRemoto(opcoes).then(resolve, reject);
          }, reject);
        }, requestTimeoutMs);
        pendentes[requestId] = {
          escopo: escopo, resolve: resolve, reject: reject, timer: timer
        };
        publicar({
          type: 'request', from: tabId, requestId: requestId,
          escopo: escopo, opcoes: opcoes
        });
      });
    }

    function request(opcoes) {
      var o = normalizarOpcoes(opcoes);
      if (!fetcher) return Promise.reject(new Error('fetch indisponivel'));
      if (!canal) return buscarRemoto(o);
      return eleger().then(function (lider) {
        return lider ? buscarRemoto(o) : pedirAoLider(o).catch(function (erro) {
          // O lider pode morrer entre a eleicao e a resposta. Recupera na
          // propria aba em vez de deixar todos os timers da tela congelados.
          if (erro && erro.status === 401) throw erro;
          return buscarRemoto(o);
        });
      });
    }

    var heartbeat = setRepeater(function () {
      if (parado) return;
      if (souLider()) gravarLider();
    }, HEARTBEAT_MS);

    function stop() {
      if (parado) return;
      parado = true;
      clearRepeater(heartbeat);
      soltarLideranca();
      Object.keys(pendentes).forEach(function (id) {
        clearTimer(pendentes[id].timer);
        pendentes[id].reject(new Error('coordenador encerrado'));
        delete pendentes[id];
      });
      try { if (canal) canal.close(); } catch (_) {}
    }

    if (root.addEventListener) root.addEventListener('pagehide', stop);

    return {
      request: request,
      isLeader: souLider,
      stop: stop,
      tabId: tabId,
      channelSupported: !!canal
    };
  }

  return {
    criar: criar,
    chaveEscopo: chaveEscopo,
    mesclarPartidas: mesclarPartidas
  };
});
