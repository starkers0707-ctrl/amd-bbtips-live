/* ============================================================
   AMD LIVE 2 - status-coleta.js

   PARA QUE SERVE
   O atraso da coleta e estrutural (polling em API com cota), mas a
   CONFUSAO que ele causa nao precisa existir. Esta barra mostra, o
   tempo todo, a diferenca entre tres coisas que hoje se parecem:
     - o jogo ainda nao aconteceu
     - aconteceu e o resultado ainda nao chegou
     - chegou, e ha quanto tempo

   Nao altera nenhum calculo. So exibe o estado real da coleta.

   O deslocamento entre o relogio do jogo e o UTC e MEDIDO nos
   dados (mediana), nao chutado - se a casa mudar o horario, a
   barra continua certa sozinha.
   ============================================================ */

(function () {
  'use strict';

  var API = '/api/grade';
  var RECARGA_MS = 20000;
  var LIGAS = { copa:1, euro:1, super:1, premier:1 };
  var estado = { liga: null, carregando: false };

  function $(id){ return document.getElementById(id); }
  function esc(s){
    return String(s==null?'':s).replace(/[&<>"]/g,function(c){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c];
    });
  }
  function dois(n){ return String(n).padStart(2,'0'); }

  function ligaAtual(){
    var chips = document.querySelectorAll('.opts .opt');
    for (var i=0;i<chips.length;i++){
      var t = (chips[i].textContent||'').trim().toLowerCase();
      if (LIGAS[t] && /\bon\b/.test(chips[i].className)) return t;
    }
    return 'super';
  }

  /* minutos do dia a partir de 'HH.MM' ou 'HH:MM' */
  function minDoHorario(h){
    var p = String(h||'').split(/[.:]/);
    var a = parseInt(p[0],10), b = parseInt(p[1],10);
    if (isNaN(a) || isNaN(b)) return null;
    return a*60 + b;
  }

  function minUTC(iso){
    var t = Date.parse(iso);
    if (!isFinite(t)) return null;
    var d = new Date(t);
    return d.getUTCHours()*60 + d.getUTCMinutes();
  }

  /* mediana do deslocamento entre relogio do jogo e UTC */
  function deslocamento(resolvidos){
    var difs = [];
    resolvidos.forEach(function(g){
      if (!g.resultado_em) return;
      var a = minDoHorario(g.horario), b = minUTC(g.resultado_em);
      if (a===null || b===null) return;
      var d = a - b;
      while (d < -720) d += 1440;
      while (d > 720) d -= 1440;
      difs.push(d);
    });
    if (!difs.length) return 0;
    difs.sort(function(x,y){ return x-y; });
    return difs[Math.floor(difs.length/2)];
  }

  function montar(){
    if ($('status-coleta')) return true;
    var main = document.querySelector('.an-main') || document.querySelector('.main');
    if (!main) return false;
    var barra = document.createElement('div');
    barra.id = 'status-coleta';
    barra.style.cssText = 'margin:10px 0;padding:9px 12px;border-radius:9px;' +
      'border:1px solid var(--line);background:var(--panel2);' +
      'font-size:12px;line-height:1.6;color:var(--muted)';
    var ancora = main.querySelector('header') || main.firstChild;
    if (ancora && ancora.nextSibling) main.insertBefore(barra, ancora.nextSibling);
    else main.insertBefore(barra, main.firstChild);
    return true;
  }

  function render(partidas){
    var el = $('status-coleta');
    if (!el) return;

    var agora = Date.now();
    var resolvidos = partidas.filter(function(g){ return g.resultado_ft; });
    var abertos = partidas.filter(function(g){ return !g.resultado_ft; });

    if (!resolvidos.length){
      el.innerHTML = 'Coleta: sem jogos resolvidos nesta janela.';
      return;
    }

    var desl = deslocamento(resolvidos);
    var d = new Date(agora + desl*60000);
    var relogio = dois(d.getUTCHours()) + ':' + dois(d.getUTCMinutes());
    var agoraMin = d.getUTCHours()*60 + d.getUTCMinutes();

    var ultimo = resolvidos[resolvidos.length-1];
    var ultMin = minDoHorario(ultimo.horario);
    var atraso = (ultMin!==null) ? (agoraMin - ultMin) : null;
    while (atraso !== null && atraso < -720) atraso += 1440;

    /* jogos cujo horario ja passou e continuam sem resultado */
    var vencidos = abertos.filter(function(g){
      var m = minDoHorario(g.horario);
      if (m===null) return false;
      var dif = agoraMin - m;
      while (dif < -720) dif += 1440;
      return dif > 1;
    });

    /* idade da lista de proximos jogos */
    var vistos = abertos.map(function(g){ return Date.parse(g.visto_em); }).filter(isFinite);
    var idadeFut = vistos.length ? Math.round((agora - Math.max.apply(null, vistos))/60000) : null;

    var proximo = abertos.length ? abertos[0].horario : null;

    var cor = vencidos.length ? 'var(--red)' : 'var(--green)';
    var selo = vencidos.length
      ? ('ATRASADO - ' + vencidos.length + ' jogo(s) ja passaram e nao chegaram: ' + vencidos.map(function(g){return g.horario;}).join(', '))
      : 'EM DIA';

    el.innerHTML =
      '<b style="color:' + cor + '">Coleta: ' + esc(selo) + '</b>' +
      ' &nbsp;|&nbsp; relogio do jogo <b>' + relogio + '</b>' +
      ' &nbsp;|&nbsp; ultimo fechado <b>' + esc(ultimo.horario) + '</b>' +
      (atraso!==null ? ' (ha ' + atraso + ' min)' : '') +
      (proximo ? ' &nbsp;|&nbsp; proximo <b>' + esc(proximo) + '</b>' : '') +
      (idadeFut!==null ? ' &nbsp;|&nbsp; lista de proximos com ' + idadeFut + ' min' : '') +
      '<br><span style="opacity:.7">Os horarios acima sao os do banco. Se a casa mostrar outro numero para o mesmo jogo, o rotulo esta defasado - compare o horario, nao a posicao.</span>';
  }

  function carregar(){
    if (estado.carregando) return;
    estado.carregando = true;
    var q = API + '?liga=' + encodeURIComponent(estado.liga) + '&horas=2&compacto=1';
    fetch(q, { cache:'no-store', credentials:'same-origin' })
      .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
      .then(function(j){
        estado.carregando = false;
        render(Array.isArray(j) ? j : (j && j.partidas) ? j.partidas : []);
      })
      .catch(function(e){
        estado.carregando = false;
        var el = $('status-coleta');
        if (el) el.innerHTML = '<b style="color:var(--red)">Coleta: sem resposta</b> - ' + esc(e.message);
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
      } else if (n > 40){ clearInterval(t); }
    }, 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
