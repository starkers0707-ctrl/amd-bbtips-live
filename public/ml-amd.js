(function () {
  'use strict';

  var el = function (id) { return document.getElementById(id); };
  var badge = el('mlBadge');
  var titulo = el('mlTitulo');
  var progressoTexto = el('mlProgressoTexto');
  var explicacao = el('mlExplicacao');
  var brier = el('mlBrier');
  var barra = el('mlProgressBar');
  var candidatos = el('mlCandidatos');
  var progress = document.querySelector('.ml-progress');
  if (!badge || !candidatos) return;
  var ligaAtual = 'copa';
  var atualizacaoEmCurso = false;
  var atualizacaoPendente = null;

  function nomeLiga(liga) {
    var nomes = { copa: 'Copa', euro: 'Euro', super: 'Super', premier: 'Premier' };
    return nomes[String(liga || '').toLowerCase()] || 'Copa';
  }

  function detectarLiga() {
    if (window.Real && typeof window.Real.liga === 'function') {
      return String(window.Real.liga() || 'copa').toLowerCase();
    }
    var ativa = document.querySelector('#leagues .tab.active');
    return String(ativa && (ativa.dataset.v || ativa.textContent) || 'copa')
      .replace(/^\S+\s/, '').trim().toLowerCase();
  }

  function pct(valor, sinal) {
    var n = Number(valor);
    if (!Number.isFinite(n)) return '—';
    return (sinal && n >= 0 ? '+' : '') + (n * 100).toFixed(1) + ' pp';
  }

  function porcentagem(valor) {
    var n = Number(valor);
    return Number.isFinite(n) ? (n * 100).toFixed(1) + '%' : '—';
  }

  function numero(valor, casas) {
    var n = Number(valor);
    return Number.isFinite(n) ? n.toFixed(casas == null ? 1 : casas) : '—';
  }

  function itemTexto(rotulo, valor) {
    var span = document.createElement('span');
    var b = document.createElement('b');
    b.textContent = valor;
    span.textContent = rotulo;
    span.appendChild(b);
    return span;
  }

  function card(candidato, pronto) {
    var ctx = candidato.contexto || {};
    var nivel = candidato.qualifica ? 'confirmado' :
      (candidato.nivel || ctx.ml_nivel || 'neutro');
    var forte = pronto && nivel === 'confirmado';
    var oportunidade = pronto && nivel === 'antecipado';
    var box = document.createElement('article');
    box.className = 'ml-card' + (forte ? ' forte' : oportunidade ? ' oportunidade' : '');

    var topo = document.createElement('div');
    topo.className = 'ml-card-top';
    var selo = document.createElement('span');
    selo.className = 'ml-selo';
    selo.textContent = forte ? 'PADRÃO CONFIRMADO' : oportunidade
      ? 'OPORTUNIDADE ML' : (pronto ? 'PADRÃO NEUTRO' : 'APRENDENDO PADRÕES');
    var hora = document.createElement('span');
    hora.className = 'ml-hora';
    hora.textContent = candidato.horario || '—';
    topo.appendChild(selo);
    topo.appendChild(hora);

    var jogo = document.createElement('div');
    jogo.className = 'ml-jogo';
    jogo.textContent = candidato.jogo || 'Jogo sem nome';

    var nums = document.createElement('div');
    nums.className = 'ml-numeros';
    nums.appendChild(itemTexto('Prob. ML', porcentagem(candidato.probabilidade)));
    nums.appendChild(itemTexto('Vantagem', pct(candidato.margem, true)));
    nums.appendChild(itemTexto('Odd', numero(candidato.odd, 2)));

    var padroes = document.createElement('div');
    padroes.className = 'ml-filtros';
    padroes.textContent = 'Padrões parecidos: ' + (ctx.padroes_amostra || 0) +
      ' · Pagaram ' + porcentagem(ctx.padroes_taxa) +
      ' · Similaridade ' + porcentagem(ctx.padroes_similaridade) +
      ' · Faixa segura ' + porcentagem(ctx.padroes_limite);

    var filtros = document.createElement('div');
    filtros.className = 'ml-filtros';
    filtros.textContent = 'Contexto aprendido · Gráfico: ' + (ctx.zona || '—') + ' / ' + (ctx.direcao || '—') +
      ' · MACD ' + numero(ctx.macd, 2) + ' · Score ' + numero(ctx.score, 0) +
      ' · Coluna ' + porcentagem(ctx.coluna_taxa) + ' (' + (ctx.coluna_amostra || 0) + ')' +
      ' · Times ' + porcentagem(ctx.times_taxa) + ' (' + (ctx.times_amostra || 0) + ')' +
      ' · EV gráfico ' + pct(ctx.site_ev, true).replace(' pp', '%');

    box.appendChild(topo);
    box.appendChild(jogo);
    box.appendChild(nums);
    box.appendChild(padroes);
    box.appendChild(filtros);
    return box;
  }

  function render(dados) {
    ligaAtual = String(dados.liga || ligaAtual).toLowerCase();
    if (titulo) titulo.textContent = 'AMD ML';
    var rotulos = Number(dados.padroes == null ? dados.rotulos : dados.padroes) || 0;
    var minimo = Number(dados.minimo_rotulos) || 100;
    var progresso = Math.max(0, Math.min(100, Number(dados.progresso) || 0));
    var temEntrada = Array.isArray(dados.candidatos) && dados.candidatos.some(function (c) {
      return dados.pronto && c.qualifica;
    });
    var temOportunidade = Array.isArray(dados.candidatos) && dados.candidatos.some(function (c) {
      return dados.pronto && !c.qualifica &&
        (c.nivel === 'antecipado' || (c.contexto || {}).ml_nivel === 'antecipado');
    });
    badge.textContent = temEntrada ? 'PADRÃO CONFIRMADO' : temOportunidade
      ? 'OPORTUNIDADE ML' : (dados.pronto ? 'MEMÓRIA ATIVA' : 'APRENDENDO');
    badge.className = 'ml-badge ' + (temOportunidade && !temEntrada
      ? 'oportunidade' : dados.pronto ? 'pronto' : 'aprendendo');
    progressoTexto.textContent = dados.pronto
      ? 'Memória ativa · ' + rotulos + ' resultados aprendidos na ' + nomeLiga(ligaAtual)
      : 'Aprendendo padrões ' + rotulos + '/' + minimo + ' resultados';
    explicacao.textContent = temEntrada
      ? 'O comportamento atual repetiu padrões que já pagaram Over 3.5 com valor nesta liga.'
      : temOportunidade
      ? 'Há vantagem positiva e boa repetição histórica; falta a faixa conservadora confirmar.'
      : dados.pronto
      ? 'A ML compara cada jogo com situações anteriores da própria liga e aprende novamente após o FT.'
      : 'A ML ainda está formando a memória mínima de padrões desta liga.';
    brier.textContent = dados.brier == null
      ? 'Precisão: aguardando previsões resolvidas'
      : 'Brier ' + Number(dados.brier).toFixed(3) +
        ' · referência ' + Number(dados.brier_referencia).toFixed(3) +
        (dados.supera_referencia ? ' · melhor que a referência' : ' · ainda aprendendo');
    barra.style.width = progresso + '%';
    progress.setAttribute('aria-valuenow', String(progresso));

    candidatos.textContent = '';
    var lista = Array.isArray(dados.candidatos) ? dados.candidatos.slice() : [];
    lista.sort(function (a, b) {
      var peso = function (c) {
        if (c.qualifica || c.nivel === 'confirmado') return 2;
        if (c.nivel === 'antecipado' || (c.contexto || {}).ml_nivel === 'antecipado') return 1;
        return 0;
      };
      return peso(b) - peso(a) || Number(b.margem) - Number(a.margem);
    });
    if (!lista.length) {
      var vazio = document.createElement('div');
      vazio.className = 'ml-vazio';
      vazio.textContent = 'Sem jogos ' + nomeLiga(ligaAtual) + ' Over 3.5 com odd disponível neste momento.';
      candidatos.appendChild(vazio);
      return;
    }
    lista.slice(0, 4).forEach(function (c) { candidatos.appendChild(card(c, dados.pronto)); });
  }

  async function atualizar(ligaPedida) {
    if (atualizacaoEmCurso) {
      atualizacaoPendente = ligaPedida || detectarLiga();
      return;
    }
    atualizacaoEmCurso = true;
    try {
      var ligaConsulta = String(ligaPedida || detectarLiga()).toLowerCase();
      ligaAtual = ligaConsulta;
      if (titulo) titulo.textContent = 'AMD ML';
      var resposta = await fetch('/api/ml/status?liga=' + encodeURIComponent(ligaConsulta), {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      if (!resposta.ok) throw new Error('HTTP ' + resposta.status);
      var dados = await resposta.json();
      if (ligaConsulta === ligaAtual) render(dados);
    } catch (erro) {
      badge.textContent = 'INDISPONÍVEL';
      badge.className = 'ml-badge aprendendo';
      candidatos.innerHTML = '<div class="ml-vazio">Modelo temporariamente indisponível. Nova tentativa automática em 30 segundos.</div>';
    } finally {
      atualizacaoEmCurso = false;
      if (atualizacaoPendente) {
        var proximaLiga = atualizacaoPendente;
        atualizacaoPendente = null;
        window.setTimeout(function () { atualizar(proximaLiga); }, 0);
      }
    }
  }

  atualizar();
  window.addEventListener('amd:liga-alterada', function (evento) {
    ligaAtual = String(evento.detail && evento.detail.liga || detectarLiga()).toLowerCase();
    if (titulo) titulo.textContent = 'AMD ML';
    atualizar(ligaAtual);
  });
  document.addEventListener('click', function (evento) {
    var controle = evento.target.closest('#leagues .tab, #cligaMenu button');
    if (!controle) return;
    ligaAtual = String(controle.dataset.liga || controle.dataset.v || controle.textContent || '')
      .replace(/^\S+\s/, '').trim().toLowerCase();
    if (titulo) titulo.textContent = 'AMD ML';
    atualizar(ligaAtual);
  });
  window.setInterval(atualizar, 30000);
})();
