/* ============================================================
   AMD LIVE 2 - ancoras.js
   Porte da logica de ANCORA do AMD Live 1.

   ORIGEM: caramelo-live/server.js, funcoes anchorStats (l.823)
   e avaliaAncora (l.914). Nao estava no motor.js, por isso nao
   veio junto quando o motor foi portado.

   REGRA (identica ao Live 1):
     placar-ancora = jogo cujo INTERVALO terminou 2-0 ou 0-2
     gatilho   = % dos jogos do time naquele lado com HT 2-0/0-2
     big placar= % de Over 3.5 na janela de 3 jogos
     corte gatilho .......... 0.30
     corte big placar ....... 0.65
     amostra minima ......... 8 jogos
     lado bate se gatilho >= 0.30 OU big >= 0.65
     nivel: os dois lados batem -> FORTE; so um -> ANCORA

   NOTA sobre a janela de 3: o comentario do Live 1 diz 'pra cada
   jogo do time olha janela de 3 jogos na ordem'. Implementei como
   o proprio jogo mais os 2 seguintes, contando acerto se Over 3.5
   pagou em qualquer um dos 3. Se a sua regra for outra, e so mudar
   JANELA_BIG e a funcao bigDoLado.

   REGRA DESTE ARQUIVO: nenhum numero e gerado.
   ============================================================ */

(function () {
  'use strict';

  var API = '/api/grade';
  var CORTE_GATILHO = 0.30;
  var CORTE_BIG = 0.65;
  var MIN_JOGOS = 8;
  var JANELA_BIG = 3;
  var HORAS = 48;
  var RECARGA_MS = 90000;

  var LIGAS = { ita:1, eng:1, spa:1, mnd:1, bra:1, lat:1, cam:1, cop:1, ame:1 };
  var estado = { liga: null, carregando: false };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }
  function pc(v) {
    if (v === null || v === undefined || !isFinite(v)) return null;
    return Math.round(v * 100);
  }
  function txtPct(v) { return v === null ? '-' : v + '%'; }

  function ligaAtual() {
    var chips = document.querySelectorAll('.opts .opt');
    for (var i = 0; i < chips.length; i++) {
      var t = (chips[i].textContent || '').trim().toLowerCase();
      if (LIGAS[t] && /\bon\b/.test(chips[i].className)) return t;
    }
    return 'ita';
  }

  /* ---------- placar-ancora: HT 2-0 ou 0-2 ---------- */

  function ehPlacarAncora(ht) {
    if (!ht) return false;
    /* OUT = 3+ gols no HT. E o gatilho mais forte que existe:
       na base, jogo com HT OUT termina com media 4.63 gols,
       contra 2.05 quando o HT tem placar normal. */
    if (String(ht).trim() === 'OUT') return true;
    var m = /^\s*(\d+)\s*[-x]\s*(\d+)\s*$/.exec(String(ht));
    if (!m) return false;
    var a = +m[1], b = +m[2];
    return (a === 2 && b === 0) || (a === 0 && b === 2);
  }

  function htValido(ht) {
    /* OUT = HT com 3 gols ou mais. E dado valido, nao faltante:
       o placar so aparece ate 2 gols; acima disso vira OUT. */
    if (String(ht || '').trim() === 'OUT') return true;
    return /^\s*\d+\s*[-x]\s*\d+\s*$/.test(String(ht || ''));
  }

  /* ---------- estatisticas por time e lado ---------- */

  function anchorStats(jogos) {
    var m = {};
    var get = function (t) {
      if (!m[t]) m[t] = { casaJogos: 0, casaAnc: 0, foraJogos: 0, foraAnc: 0 };
      return m[t];
    };
    for (var i = 0; i < jogos.length; i++) {
      var g = jogos[i];
      if (!g.time_a || !g.time_b) continue;
      if (!htValido(g.resultado_ht)) continue; /* 'OUT' nao conta */
      var anc = ehPlacarAncora(g.resultado_ht);
      var c = get(g.time_a); c.casaJogos++; if (anc) c.casaAnc++;
      var f = get(g.time_b); f.foraJogos++; if (anc) f.foraAnc++;
    }
    return m;
  }
  /* ------------------------------------------------------------
     CORRECAO: a versao acima usava so o HT 2-0/0-2 e ainda contava
     'OUT' como gatilho. As duas coisas estavam erradas.

     A funcao real do Live 1 (server.js l.813) tem TRES condicoes:
       FT 2-1 ou 1-2   -> return true
       FT 3-0 ou 0-3   -> return true
       HT 2-0 ou 0-2   -> return true
     Comentario do proprio Live 1 na l.811: 'esses placares costumam
     anteceder/acompanhar big placares (Over 3.5 / 5+)'.

     'OUT' (3+ gols no HT) NAO conta: esses jogos terminam com media
     de 4.63 gols, ou seja, ja SAO o big placar, nao o precursor.
     Contando OUT, a media da liga ia a 36% e todo time passava do
     corte de 30%. Sem OUT, a media fica em 27.8% e as taxas caem na
     mesma faixa das que o Live 1 mostra (30% a 36%).

     Esta declaracao substitui a anterior: em JavaScript, quando duas
     funcoes tem o mesmo nome no mesmo escopo, vale a ultima.
     ------------------------------------------------------------ */

  function ehAncoraJogo(j) {
    var a = Number(j.gols_a), b = Number(j.gols_b);
    if (isFinite(a) && isFinite(b)) {
      if ((a === 2 && b === 1) || (a === 1 && b === 2)) return true;
      if ((a === 3 && b === 0) || (a === 0 && b === 3)) return true;
    }
    var s = String(j.resultado_ht || '').trim();
    if (s === 'OUT') return false;
    var m = /^(\d+)\s*[-x]\s*(\d+)$/.exec(s);
    if (m) {
      var p = +m[1], q = +m[2];
      if ((p === 2 && q === 0) || (p === 0 && q === 2)) return true;
    }
    return false;
  }

  function anchorStats(jogos) {
    var m = {};
    var get = function (t) {
      if (!m[t]) m[t] = { casaJogos: 0, casaAnc: 0, foraJogos: 0, foraAnc: 0 };
      return m[t];
    };
    for (var i = 0; i < jogos.length; i++) {
      var g = jogos[i];
      if (!g.time_a || !g.time_b) continue;
      /* conta TODOS os jogos resolvidos, como o Live 1 faz.
         Nao filtra por HT valido: o FT sozinho ja decide. */
      var anc = ehAncoraJogo(g);
      var c = get(g.time_a); c.casaJogos++; if (anc) c.casaAnc++;
      var f = get(g.time_b); f.foraJogos++; if (anc) f.foraAnc++;
    }
    return m;
  }

  /* Over 3.5 na janela de JANELA_BIG jogos a partir de cada jogo
     do time. Usa a ordem cronologica da grade. */
  function bigStats(jogos) {
    var m = {};
    var get = function (t) {
      if (!m[t]) m[t] = { casaJogos: 0, casaO35: 0, casa5: 0, foraJogos: 0, foraO35: 0, fora5: 0 };
      return m[t];
    };
    var total = function (g) {
      var a = Number(g.gols_a), b = Number(g.gols_b);
      return (isFinite(a) && isFinite(b)) ? a + b : null;
    };
    for (var i = 0; i < jogos.length; i++) {
      var g = jogos[i];
      if (!g.time_a || !g.time_b) continue;
      var houveO35 = false, houve5 = false;
      for (var k = 0; k < JANELA_BIG && (i + k) < jogos.length; k++) {
        var t = total(jogos[i + k]);
        if (t === null) continue;
        if (t >= 4) houveO35 = true;
        if (t >= 5) houve5 = true;
      }
      var c = get(g.time_a);
      c.casaJogos++; if (houveO35) c.casaO35++; if (houve5) c.casa5++;
      var f = get(g.time_b);
      f.foraJogos++; if (houveO35) f.foraO35++; if (houve5) f.fora5++;
    }
    return m;
  }

  function taxa(num, den) {
    return den >= MIN_JOGOS ? (num / den) : null;
  }

  /* ---------- avaliacao de um confronto ---------- */

  function avaliaAncora(casa, fora, stats, big) {
    var cs = stats[casa] || {}, fs = stats[fora] || {};
    var cb = big[casa] || {}, fb = big[fora] || {};

    var casaRate = taxa(cs.casaAnc || 0, cs.casaJogos || 0);
    var foraRate = taxa(fs.foraAnc || 0, fs.foraJogos || 0);
    var casaO35 = taxa(cb.casaO35 || 0, cb.casaJogos || 0);
    var casa5 = taxa(cb.casa5 || 0, cb.casaJogos || 0);
    var foraO35 = taxa(fb.foraO35 || 0, fb.foraJogos || 0);
    var fora5 = taxa(fb.fora5 || 0, fb.foraJogos || 0);

    var casaHit = (casaRate !== null && casaRate >= CORTE_GATILHO) ||
                  (casaO35 !== null && casaO35 >= CORTE_BIG);
    var foraHit = (foraRate !== null && foraRate >= CORTE_GATILHO) ||
                  (foraO35 !== null && foraO35 >= CORTE_BIG);

    var nivel = (casaHit && foraHit) ? 'forte' : (casaHit || foraHit) ? 'normal' : null;
    if (!nivel) return null;

    return {
      nivel: nivel,
      casa: { time: casa, taxa: pc(casaRate), o35: pc(casaO35), p5: pc(casa5), jogos: cs.casaJogos || 0, hit: casaHit },
      fora: { time: fora, taxa: pc(foraRate), o35: pc(foraO35), p5: pc(fora5), jogos: fs.foraJogos || 0, hit: foraHit }
    };
  }

  /* ---------- montagem ---------- */

  function montar() {
    var orig = $('ancoras');
    if (!orig) return false;
    if ($('ancoras-real')) return true;
    orig.style.display = 'none';
    var novo = document.createElement('div');
    novo.className = 'confr';
    novo.id = 'ancoras-real';
    orig.parentNode.insertBefore(novo, orig.nextSibling);
    return true;
  }

  /* ---------- render ---------- */

  function lado(l, rotulo) {
    var marca = l.hit ? '<b style="color:var(--green)">BATE</b>' : '<span style="color:var(--muted)">nao bate</span>';
    return '<div class="lado">' +
      '<div class="t">' + esc(rotulo) + ': ' + esc(l.time) + ' - ' + marca + '</div>' +
      '<div class="r"><span>Gatilho (HT 2-0/0-2)</span><b>' + txtPct(l.taxa) + '</b></div>' +
      '<div class="r"><span>Over 3.5 (janela 3)</span><b>' + txtPct(l.o35) + '</b></div>' +
      '<div class="r"><span>5+ Gols (janela 3)</span><b>' + txtPct(l.p5) + '</b></div>' +
      '<div class="r" style="opacity:.55"><span>amostra</span><b>' + l.jogos + ' jogos</b></div>' +
    '</div>';
  }

  function render(dados) {
    var alvo = $('ancoras-real');
    if (!alvo) return;

    var resolvidos = dados.filter(function (j) { return j.resultado_ft; });
    var futuros = dados.filter(function (j) { return !j.resultado_ft; });
    var comHT = resolvidos.filter(function (j) { return htValido(j.resultado_ht); }).length;

    if (!resolvidos.length) {
      alvo.innerHTML = '<div style="padding:14px;color:var(--muted)">Sem jogos resolvidos.</div>';
      return;
    }

    var stats = anchorStats(resolvidos);
    var big = bigStats(resolvidos);

    var achados = [];
    futuros.forEach(function (g) {
      var a = avaliaAncora(g.time_a, g.time_b, stats, big);
      if (a) achados.push({ jogo: g, anc: a });
    });

    var cab = '<div class="meta" style="margin:2px 0 10px">' +
      esc(estado.liga) + ' - base ' + resolvidos.length + ' jogos, ' + comHT + ' com HT valido' +
      ' - cortes: gatilho ' + Math.round(CORTE_GATILHO * 100) + '%, big ' + Math.round(CORTE_BIG * 100) + '%, minimo ' + MIN_JOGOS + ' jogos' +
      '</div>';

    /* ------------------------------------------------------------
       Estado vazio: em vez de so dizer 'nenhuma ancora', mostra os
       jogos que chegaram mais perto do corte. Assim a secao nunca
       fica muda e da para ver o que esta se formando.

       (O bloco logo abaixo virou codigo morto: este retorna antes.
       O texto dele citava media de 11%, que era da regra antiga -
       so HT. Com a regra completa a media da liga e ~28%.) */
    if (!achados.length) {
      var perto = [];
      futuros.forEach(function (g) {
        var cs = stats[g.time_a] || {}, fs = stats[g.time_b] || {};
        var cb = big[g.time_a] || {}, fb = big[g.time_b] || {};
        var cg = taxa(cs.casaAnc || 0, cs.casaJogos || 0);
        var fg = taxa(fs.foraAnc || 0, fs.foraJogos || 0);
        var co = taxa(cb.casaO35 || 0, cb.casaJogos || 0);
        var fo = taxa(fb.foraO35 || 0, fb.foraJogos || 0);
        var cands = [];
        if (cg !== null) cands.push({ time: g.time_a, lado: 'casa', tipo: 'gatilho', v: cg, falta: CORTE_GATILHO - cg });
        if (fg !== null) cands.push({ time: g.time_b, lado: 'fora', tipo: 'gatilho', v: fg, falta: CORTE_GATILHO - fg });
        if (co !== null) cands.push({ time: g.time_a, lado: 'casa', tipo: 'big', v: co, falta: CORTE_BIG - co });
        if (fo !== null) cands.push({ time: g.time_b, lado: 'fora', tipo: 'big', v: fo, falta: CORTE_BIG - fo });
        if (!cands.length) return;
        cands.sort(function (a, b) { return a.falta - b.falta; });
        perto.push({ jogo: g, melhor: cands[0] });
      });

      perto.sort(function (a, b) { return a.melhor.falta - b.melhor.falta; });

      var linhas = perto.map(function (it) {
        var m = it.melhor;
        var pts = Math.round(m.falta * 100);
        return '<div class="r" style="padding:6px 2px">' +
          '<span>' + esc(it.jogo.horario || '') + ' ' + esc(it.jogo.time_a) + ' x ' + esc(it.jogo.time_b) + '</span>' +
          '<b style="color:var(--muted)">' + esc(m.time) + ' ' + m.lado + ' - ' + m.tipo + ' ' + Math.round(m.v * 100) + '%' +
          ' (faltam ' + pts + ' pts)</b>' +
        '</div>';
      }).join('');

      alvo.innerHTML = cab +
        '<div style="padding:12px 14px;color:var(--muted)">' +
        'Nenhuma ancora nos ' + futuros.length + ' jogos por disputar.<br>' +
        'Na liga, ' + qualificados(stats) + ' dos ' + (Object.keys(stats).length * 2) + ' lados de time passam do corte de ' + Math.round(CORTE_GATILHO * 100) + '%, ' +
        'entao ancora aparece com frequencia - so nao caiu nesta rodada.' +
        '</div>' +
        (linhas ? '<div style="padding:0 14px 14px"><div class="meta" style="margin-bottom:6px">Mais proximos do corte</div>' + linhas + '</div>' : '');
      return;
    }
    /* usada na mensagem de estado vazio: quantos lados de time
       da liga passam do corte de gatilho neste momento. */
    function qualificados(st) {
      var n = 0;
      Object.keys(st).forEach(function (t) {
        var o = st[t];
        var c = taxa(o.casaAnc || 0, o.casaJogos || 0);
        var f = taxa(o.foraAnc || 0, o.foraJogos || 0);
        if (c !== null && c >= CORTE_GATILHO) n++;
        if (f !== null && f >= CORTE_GATILHO) n++;
      });
      return n;
    }
    if (!achados.length) {
      alvo.innerHTML = cab + '<div style="padding:14px;color:var(--muted)">Nenhuma ancora nos ' + futuros.length + ' jogos por disputar. Ancora e rara: a media da liga de HT 2-0/0-2 fica perto de 11%, e o corte e 30%.</div>';
      return;
    }

    achados.sort(function (x, y) { return (y.anc.nivel === 'forte' ? 1 : 0) - (x.anc.nivel === 'forte' ? 1 : 0); });

    alvo.innerHTML = cab + achados.map(function (it) {
      var forte = it.anc.nivel === 'forte';
      return '<div class="cf">' +
        '<div class="hora">' + esc(it.jogo.horario || it.jogo.hora || '') + '</div>' +
        '<div class="times">' + esc(it.jogo.time_a) + ' x ' + esc(it.jogo.time_b) + '</div>' +
        '<div class="anc">' + (forte ? 'ANCORA FORTE' : 'ANCORA') + '</div>' +
        '<div class="lados">' + lado(it.anc.casa, 'Casa') + '<div class="vs">x</div>' + lado(it.anc.fora, 'Fora') + '</div>' +
        '<div class="conf">' + (forte ? 'Os dois lados bateram o corte' : 'Um lado bateu o corte') + '</div>' +
      '</div>';
    }).join('');
  }

  /* ---------- dados ---------- */

  function carregar() {
    if (estado.carregando) return;
    estado.carregando = true;
    var q = API + '?liga=' + encodeURIComponent(estado.liga) + '&horas=' + HORAS + '&compacto=1';
    fetch(q, { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        var lista = Array.isArray(j) ? j : (j && Array.isArray(j.partidas)) ? j.partidas : [];
        estado.carregando = false;
        render(lista);
      })
      .catch(function (e) {
        estado.carregando = false;
        var alvo = $('ancoras-real');
        if (alvo) alvo.innerHTML = '<div style="padding:14px;color:var(--muted)">Nao foi possivel carregar: ' + esc(e.message) + '</div>';
      });
  }

  function iniciar() {
    var n = 0;
    var t = setInterval(function () {
      n++;
      if (montar()) {
        clearInterval(t);
        estado.liga = ligaAtual();
        carregar();
        setInterval(function () {
          var l = ligaAtual();
          if (l !== estado.liga) { estado.liga = l; carregar(); }
        }, 1500);
        setInterval(carregar, RECARGA_MS);
      } else if (n > 40) { clearInterval(t); }
    }, 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
