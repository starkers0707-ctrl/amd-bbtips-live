/* ============================================================
   AMD LIVE 2 - cacadores.js
   Porte do CACADOR DE PADRAO do AMD Live 1.

   ORIGEM: caramelo-live/server.js, funcao calculaPadroes (l.2674).

   COMO O LIVE 1 CACA
   Tudo e medido contra a REGUA DO CICLO: em qualquer trecho de 3
   jogos, qual a % que tem pelo menos 1 green. Um padrao so entra
   se pagar ACIMA (prox G) ou ABAIXO (prox R) dessa regua. Taxa
   alta sozinha nao vale nada - o que vale e a diferenca (edge).

   O cacador conta SO O DIA ATUAL do relogio do jogo: zera na
   virada 23h -> 00h.

   FAMILIAS PORTADAS AQUI (4 das 5 do Live 1):
     1. Sequencia  - trechos de 4 e 5 jogos (ex.: RRGR)
                     min 5 casos, em 2+ horas diferentes, edge >= 15
     2. Placar     - categoria do placar do jogo gatilho, edge >= 12
     3. Coluna     - minuto do relogio, edge >= 12
     4. Odd / Time - valor da odd e nome do time, edge >= 12

   NAO PORTADA AINDA: familia 5 (PULO), que mede a regularidade da
   distancia entre ocorrencias de ~10 tipos de evento usando coef.
   de variacao. Fica para a etapa seguinte.

   AVISO QUE VEM DO PROPRIO LIVE 1 (server.js l.2886):
   'milhares de combinacoes produzem 100% por acaso - o numero de
   testes e parte da leitura'. Por isso esta tela mostra quantos
   padroes foram testados junto com os que passaram.

   REGRA DESTE ARQUIVO: nenhum numero e gerado.
   ============================================================ */

(function () {
  'use strict';

  var API = '/api/grade';
  var HORAS = 48;
  var RECARGA_MS = 90000;

  var TIROS = 3;        /* ciclo de tiros do Live 1 */
  var MIN_SEQ = 5;      /* min de casos para sequencia */
  var MIN_HORAS = 2;    /* precisa repetir em horas diferentes */
  var EDGE_SEQ = 15;    /* edge minimo da familia sequencia */
  var EDGE_GARIMPA = 12;/* edge minimo das familias por chave */
  var MIN_GARIMPA = 6;  /* min de casos das familias por chave */
  var TOPO = 8;         /* quantos padroes por familia */

  var MERCADOS = [['o25','Over 2.5'],['o35','Over 3.5'],['ge5','5+ Gols'],['ambs','Ambas marcam']];
  var ROTULO = {}; MERCADOS.forEach(function(m){ ROTULO[m[0]] = m[1]; });
  var LIGAS = { copa:1, euro:1, super:1, premier:1 };

  var estado = { liga: null, mkt: 'o25', carregando: false, jogos: [] };

  function $(id){ return document.getElementById(id); }
  function esc(s){
    return String(s==null?'':s).replace(/[&<>"]/g, function(c){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c];
    });
  }

  function ligaAtual(){
    var chips = document.querySelectorAll('.opts .opt');
    for (var i=0;i<chips.length;i++){
      var t = (chips[i].textContent||'').trim().toLowerCase();
      if (LIGAS[t] && /\bon\b/.test(chips[i].className)) return t;
    }
    return 'super';
  }

  /* ---------- so o dia atual do relogio do jogo ---------- */

  function horaDe(j){
    var h = String(j.horario||'').split(/[.:]/)[0];
    var n = parseInt(h,10);
    return isNaN(n) ? null : n;
  }

  function soDiaAtual(games){
    var idxDia = 0;
    for (var i=1;i<games.length;i++){
      var h1 = horaDe(games[i]), h0 = horaDe(games[i-1]);
      if (h1===null || h0===null) continue;
      if (h1 < h0) idxDia = i;  /* virada 23 -> 00 */
    }
    return games.slice(idxDia);
  }

  /* ---------- regua do ciclo ---------- */

  function paga(j, mkt){
    try { return !!window.AMD_MOTOR.pays(j, mkt); } catch(e){ return false; }
  }

  function reguaCiclo(seq){
    var n=0, h=0;
    for (var i=0;i+TIROS<=seq.length;i++){
      n++;
      if (seq.slice(i,i+TIROS).indexOf('G') >= 0) h++;
    }
    return n ? Math.round(100*h/n) : 0;
  }

  /* ---------- familia 1: sequencia ---------- */

  function familiaSequencia(seq, horas, regua){
    var grupos = {}, testes = 0;
    [4,5].forEach(function(L){
      for (var i=0;i+L+TIROS<=seq.length;i++){
        var chave = seq.slice(i,i+L).join('');
        var tres = seq.slice(i+L, i+L+TIROS);
        var pagou = tres.indexOf('G') >= 0;
        var g = grupos[chave] || (grupos[chave] = { n:0, ok:0, horas:{} });
        g.n++;
        if (pagou) g.ok++;
        var hh = horas[i+L];
        if (hh !== null && hh !== undefined) g.horas[hh] = 1;
      }
    });
    var out = [];
    Object.keys(grupos).forEach(function(chave){
      testes++;
      var g = grupos[chave];
      if (g.n < MIN_SEQ) return;
      if (Object.keys(g.horas).length < MIN_HORAS) return;
      var taxa = Math.round(100*g.ok/g.n);
      var eG = taxa - regua, eR = regua - taxa;
      if (eG >= EDGE_SEQ) out.push({ chave:chave, prox:'G', taxa:taxa, edge:eG, n:g.n, ok:g.ok });
      else if (eR >= EDGE_SEQ) out.push({ chave:chave, prox:'R', taxa:taxa, edge:eR, n:g.n, ok:g.ok });
    });
    out.sort(function(a,b){ return (b.edge-a.edge) || (b.n-a.n); });
    return { lista: out.slice(0,TOPO), testes: testes };
  }

  /* ---------- garimpa: familias por chave ---------- */

  function garimpa(obj, regua, minN){
    var arr = [], testes = 0;
    Object.keys(obj).forEach(function(k){
      testes++;
      var o = obj[k];
      if (o.n < minN) return;
      var taxa = Math.round(100*o.ok/o.n);
      var eG = taxa - regua, eR = regua - taxa;
      if (eG >= EDGE_GARIMPA) arr.push({ chave:k, prox:'G', taxa:taxa, edge:eG, n:o.n, ok:o.ok });
      else if (eR >= EDGE_GARIMPA) arr.push({ chave:k, prox:'R', taxa:taxa, edge:eR, n:o.n, ok:o.ok });
    });
    arr.sort(function(a,b){ return (b.edge-a.edge) || (b.n-a.n); });
    return { lista: arr.slice(0,TOPO), testes: testes };
  }

  /* categoria de placar, igual ao catPlacar do Live 1 */
  function catPlacar(j){
    var a = Number(j.gols_a), b = Number(j.gols_b);
    if (!isFinite(a) || !isFinite(b)) return null;
    var tot = a+b, mx = Math.max(a,b);
    if (tot === 0) return '0-0 seco';
    if (tot === 1) return 'jogo de 1 gol';
    if (mx >= 3) return 'goleada';
    if (a === b) return 'empate ' + a + '-' + b;
    return 'acima de ' + Math.max(a,b) + '-' + Math.min(a,b);
  }

  /* ---------- calculo geral ---------- */

  function calcular(){
    var mkt = estado.mkt;
    if (!window.AMD_MOTOR || !window.AMD_ADAPTADOR) return null;

    var d = window.AMD_ADAPTADOR.normalizar(estado.jogos);
    var games = soDiaAtual(d.passados);
    if (games.length < 30) return { poucos:true, jogosNoDia: games.length };

    var seq = games.map(function(g){ return paga(g,mkt) ? 'G' : 'R'; });
    var horas = games.map(horaDe);
    var regua = reguaCiclo(seq);

    /* ciclo dos TIROS seguintes ao jogo i */
    var cicloDepois = function(i){
      return seq.slice(i+1, i+1+TIROS).indexOf('G') >= 0;
    };
    /* janela CENTRADA no jogo i (antes, nele, depois) */
    var cicloCentrado = function(i){
      return seq.slice(Math.max(0,i-1), i+2).indexOf('G') >= 0;
    };

    var porPlacar = {}, porColuna = {}, porOdd = {}, porTime = {};
    var somar = function(obj, chave, ok){
      if (chave === null || chave === undefined || chave === '') return;
      var o = obj[chave] || (obj[chave] = { n:0, ok:0 });
      o.n++; if (ok) o.ok++;
    };

    for (var i=0;i<games.length;i++){
      var g = games[i];
      var depois = cicloDepois(i);
      var centrado = cicloCentrado(i);
      somar(porPlacar, catPlacar(g), depois);
      var min = String(g.horario||'').split(/[.:]/)[1];
      somar(porColuna, min ? ('minuto ' + min) : null, depois);
      var ov = (g.odds && g.odds[mkt] != null) ? String(g.odds[mkt]) : null;
      somar(porOdd, ov ? ('odd ' + ov) : null, centrado);
      somar(porTime, g.time_a, centrado);
      somar(porTime, g.time_b, centrado);
    }

    var fSeq = familiaSequencia(seq, horas, regua);
    var fPla = garimpa(porPlacar, regua, MIN_GARIMPA);
    var fCol = garimpa(porColuna, regua, MIN_GARIMPA);
    var fOdd = garimpa(porOdd, regua, MIN_GARIMPA);
    var fTim = garimpa(porTime, regua, MIN_GARIMPA);

    return {
      mkt: mkt, regua: regua, jogosNoDia: games.length,
      testes: fSeq.testes + fPla.testes + fCol.testes + fOdd.testes + fTim.testes,
      familias: [
        { nome:'Sequencia (4 e 5 jogos)', dados:fSeq },
        { nome:'Placar do gatilho', dados:fPla },
        { nome:'Coluna (minuto)', dados:fCol },
        { nome:'Odd', dados:fOdd },
        { nome:'Time', dados:fTim }
      ]
    };
  }

  /* ---------- montagem e render ---------- */

  function montar(){
    var orig = $('cacadores');
    if (!orig) return false;
    if ($('cacadores-real')) return true;
    orig.style.display = 'none';

    var barra = document.createElement('div');
    barra.className = 'cac-market-bar';
    barra.id = 'cac-mkts';
    barra.style.margin = '8px 0';
    barra.innerHTML = MERCADOS.map(function(m){
      return '<div class="opt' + (m[0]===estado.mkt?' on':'') + '" data-mkt="' + m[0] + '">' + esc(m[1]) + '</div>';
    }).join('');
    orig.parentNode.insertBefore(barra, orig);

    var novo = document.createElement('div');
    novo.className = '';
    novo.id = 'cacadores-real';
    orig.parentNode.insertBefore(novo, orig.nextSibling);

    barra.addEventListener('click', function(ev){
      var alvo = ev.target.closest('.opt');
      if (!alvo) return;
      estado.mkt = alvo.getAttribute('data-mkt');
      [].forEach.call(barra.querySelectorAll('.opt'), function(o){
        o.className = 'opt' + (o.getAttribute('data-mkt')===estado.mkt?' on':'');
      });
      render();
    });
    return true;
  }

  function render(){
    var alvo = $('cacadores-real');
    if (!alvo) return;
    var r = calcular();
    if (!r) { alvo.innerHTML = '<div style="padding:14px;color:var(--red)">motor.js ou motor-adaptador.js nao carregou.</div>'; return; }
    if (r.poucos) { alvo.innerHTML = '<div style="padding:14px;color:var(--muted)">So ' + r.jogosNoDia + ' jogos no dia atual - o cacador precisa de pelo menos 30.</div>'; return; }

    var achou = r.familias.reduce(function(s,f){ return s + f.dados.lista.length; }, 0);

    var cab = '<div class="cac-topline">' +
      '<div class="cac-contexto"><b>' + esc(estado.liga) + ' · ' + esc(ROTULO[r.mkt]||r.mkt) + '</b> · leitura do dia atual</div>' +
      '<div class="cac-live">Monitoramento ao vivo</div>' +
      '</div>' +
      '<div class="cac-kpis">' +
        '<div class="cac-kpi"><div class="v">' + r.jogosNoDia + '</div><div class="k">jogos hoje</div></div>' +
        '<div class="cac-kpi"><div class="v">' + r.regua + '%</div><div class="k">régua do ciclo</div></div>' +
        '<div class="cac-kpi"><div class="v">' + r.testes + '</div><div class="k">padrões testados</div></div>' +
        '<div class="cac-kpi"><div class="v">' + achou + '</div><div class="k">padrões aprovados</div></div>' +
      '</div>';

    if (!achou){
      alvo.innerHTML = cab + '<div class="cac-how"><div class="cac-how-title">SEM GATILHO AGORA</div><div class="cac-how-text">Nenhum padrão tem vantagem suficiente sobre a régua neste momento. O monitoramento continua e esta área atualiza automaticamente.</div></div>';
      return;
    }

    var corpo = '<div class="cac-grid">' + r.familias.map(function(f){
      var linhas = f.dados.lista.map(function(p){
        var classe = p.prox === 'G' ? 'green' : 'red';
        var largura = Math.max(18, Math.min(100, Math.round(100 * p.n / 20)));
        return '<div class="cac-pattern ' + classe + '">' +
          '<div class="cac-pattern-top"><span class="cac-dot"></span>' +
          '<span class="cac-key" title="' + esc(p.chave) + '">' + esc(p.chave) + '</span>' +
          '<span class="cac-call">→ ' + (p.prox==='G'?'GREEN':'RED') + '</span></div>' +
          '<div class="cac-stats"><span>taxa <b>' + p.taxa + '%</b></span><span class="cac-edge">edge +' + p.edge + '</span><span>amostra <b>' + p.ok + '/' + p.n + '</b></span></div>' +
          '<div class="cac-sample" title="Tamanho da amostra: ' + p.n + ' ocorrências"><span style="width:' + largura + '%"></span></div>' +
        '</div>';
      }).join('');
      if (!linhas) linhas = '<div class="cac-empty">Nenhum padrão aprovado nesta família agora.</div>';
      return '<section class="cac-family">' +
        '<div class="cac-family-head"><div><div class="cac-family-title">' + esc(f.nome) + '</div>' +
        '<div class="cac-family-meta">' + f.dados.testes + ' combinações testadas</div></div>' +
        '<div class="cac-family-count">' + f.dados.lista.length + '</div></div>' +
        '<div class="cac-list">' + linhas + '</div>' +
      '</section>';
    }).join('') + '</div>';

    var rodape = '<div class="cac-how"><div class="cac-how-title">COMO LER</div><div class="cac-how-text">' +
      '<b>Taxa</b> é o acerto observado. <b>Edge</b> é a diferença para a régua do ciclo — verde indica que o ciclo paga mais e vermelho, que morre mais. ' +
      '<b>Amostra</b> mostra acertos/total; a barra representa o tamanho da amostra. Foram testadas ' + r.testes + ' combinações: quanto maior o total de ocorrências, mais confiável a leitura.' +
      '</div></div>';

    alvo.innerHTML = cab + corpo + rodape;
  }

  /* ---------- dados ---------- */

  function carregar(){
    if (estado.carregando) return;
    estado.carregando = true;
    var q = API + '?liga=' + encodeURIComponent(estado.liga) + '&horas=' + HORAS + '&compacto=1';
    fetch(q, { cache:'no-store', credentials:'same-origin' })
      .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
      .then(function(j){
        estado.jogos = Array.isArray(j) ? j : (j && Array.isArray(j.partidas)) ? j.partidas : [];
        estado.carregando = false;
        render();
      })
      .catch(function(e){
        estado.carregando = false;
        var alvo = $('cacadores-real');
        if (alvo) alvo.innerHTML = '<div style="padding:14px;color:var(--muted)">Nao foi possivel carregar: ' + esc(e.message) + '</div>';
      });
  }

  function iniciar(){
    var n = 0;
    var t = setInterval(function(){
      n++;
      if (montar()){
        clearInterval(t);
        estado.liga = ligaAtual();
        carregar();
        setInterval(function(){
          var l = ligaAtual();
          if (l !== estado.liga){ estado.liga = l; carregar(); }
        }, 1500);
        setInterval(carregar, RECARGA_MS);
      } else if (n > 40) { clearInterval(t); }
    }, 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
