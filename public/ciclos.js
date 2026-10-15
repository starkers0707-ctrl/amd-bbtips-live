/* ============================================================
   AMD LIVE 2 - ciclos.js
   DETECTOR DE CICLOS O/U - PADROES E GREENS

   Porte do detector do Betaxis (app/tools/marcio.html) para o
   AMD Live 2. A logica e a mesma; a fonte de dados muda: la o
   detector le CSV por liga, aqui le o /api/grade via adaptador.

   COMO FUNCIONA
   Percorre a sequencia de jogos marcando cada um como O (positivo
   no mercado) ou U (negativo). Procura seis padroes alternados:
     O-U-O     O-U-U-O     O-U-U-U-O
     U-O-U     U-O-O-U     U-O-O-O-U

   Quando um padrao fecha, o ALVO e projetado a partir do PRIMEIRO
   jogo do padrao, com deslocamento de 20 jogos por passo:
     padrao de 3 jogos -> alvo +39 / +40 / +41
     padrao de 4 jogos -> alvo +59 / +60 / +61
     padrao de 5 jogos -> alvo +79 / +80 / +81
   Como cada jogo dura 3 min, 20 jogos = 1 hora exata. A hipotese
   e de repeticao horaria do comportamento do mercado.

   O QUE FOI ACRESCENTADO EM RELACAO AO BETAXIS
   A REGUA DO CICLO e o EDGE. A regua e a taxa de acertar pelo
   menos 1 green em 3 tiros quaisquer da janela. Sem ela, uma taxa
   de 91% parece forte quando na verdade a regua ja e 86% - medi
   isso na Copa/Ambas e a diferenca era de 5 pontos, dentro do
   ruido. O edge mostra quanto o padrao bate acima ou abaixo dela.

   REGRA DESTE ARQUIVO: nenhum numero e gerado.
   ============================================================ */

(function () {
  'use strict';

  var API = '/api/grade';
  var PASSO = 20;          /* jogos por hora */
  var TIROS = 3;           /* tiros do alvo e da regua */
  var RECARGA_MS = 60000;

  var LIGAS = [['copa','Copa'],['euro','Euro'],['super','Super'],['premier','Premier']];
  var JANELAS = [[3,'3 h (~60)'],[6,'6 h (~120)'],[12,'12 h (~240)'],[24,'24 h (~480)'],[48,'48 h (~960)']];
  var MERCADOS = [
    ['o15','Over 1.5', 1.5],
    ['o25','Over 2.5', 2.5],
    ['o35','Over 3.5', 3.5],
    ['ambas','Ambas Marcam', null]
  ];

  /* Os seis padroes. 'O' = positivo no mercado, 'U' = negativo. */
  var PADROES = [
    { chave:'OUO',    seq:'OUO',   rot:'O · U · O',         cor:'var(--green)' },
    { chave:'OUUO',   seq:'OUUO',  rot:'O · U · U · O',     cor:'#a78bfa' },
    { chave:'OUUUO',  seq:'OUUUO', rot:'O · U · U · U · O', cor:'#fbbf24' },
    { chave:'UOU',    seq:'UOU',   rot:'U · O · U',         cor:'#38bdf8' },
    { chave:'UOOU',   seq:'UOOU',  rot:'U · O · O · U',     cor:'#f472b6' },
    { chave:'UOOOU',  seq:'UOOOU', rot:'U · O · O · O · U', cor:'#fb923c' }
  ];

  var estado = { liga:'copa', horas:6, mercado:'o25', jogos:[], carregando:false, aberto:null };

  function $(id){ return document.getElementById(id); }
  function esc(s){
    return String(s==null?'':s).replace(/[&<>"]/g,function(c){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c];
    });
  }
  function pct(n,d){ return d ? (100*n/d).toFixed(1)+'%' : '—'; }

  /* ---------- classificacao do jogo ---------- */

  function gols(j){
    var a = Number(j.gols_a), b = Number(j.gols_b);
    if (!isFinite(a) || !isFinite(b)) return null;
    return { a:a, b:b, tot:a+b };
  }

  function ocorreu(j){
    return !!j.resultado_ft && gols(j) !== null;
  }

  /* positivo = O ; negativo = U */
  function positivo(j, mercado){
    var g = gols(j);
    if (!g) return null;
    if (mercado === 'ambas') return g.a > 0 && g.b > 0;
    var m = MERCADOS.filter(function(x){ return x[0]===mercado; })[0];
    var linha = m ? m[2] : 2.5;
    return g.tot > linha;
  }

  /* ---------- regua do ciclo ---------- */

  function regua(seq){
    var n=0, h=0;
    for (var i=0; i+TIROS<=seq.length; i++){
      n++;
      if (seq.slice(i,i+TIROS).indexOf('O') >= 0) h++;
    }
    return n ? (100*h/n) : null;
  }

  /* ---------- busca dos padroes ---------- */

  function deslocamentos(tamanho){
    var base = (tamanho - 1) * PASSO - 1;
    return [base, base+1, base+2];
  }

  function analisar(jogos, mercado){
    var seq = jogos.map(function(j){ var p = positivo(j, mercado); return p===null ? '?' : (p ? 'O' : 'U'); });
    var r = regua(seq.filter(function(c){ return c!=='?'; }));

    var saida = PADROES.map(function(pd){
      var alvos = deslocamentos(pd.seq.length);
      var ocorrencias = [];
      for (var i=0; i+pd.seq.length<=seq.length; i++){
        var bate = true;
        for (var k=0;k<pd.seq.length;k++){ if (seq[i+k] !== pd.seq[k]) { bate=false; break; } }
        if (!bate) continue;
        var tiros = alvos.map(function(off){
          var idx = i + off;
          if (idx >= jogos.length) return { idx:idx, estado:'futuro', jogo:null };
          var j = jogos[idx];
          if (!ocorreu(j)) return { idx:idx, estado:'aguardando', jogo:j };
          return { idx:idx, estado: positivo(j,mercado) ? 'green' : 'red', jogo:j };
        });
        var resolvidos = tiros.filter(function(t){ return t.estado==='green'||t.estado==='red'; });
        ocorrencias.push({
          inicio: i,
          gatilho: jogos.slice(i, i+pd.seq.length),
          tiros: tiros,
          resolvido: resolvidos.length === TIROS,
          green: tiros.some(function(t){ return t.estado==='green'; }),
          green1: tiros[0].estado,
          green2: tiros[1].estado
        });
      }
      var resolvidas = ocorrencias.filter(function(o){ return o.resolvido; });
      var greens = resolvidas.filter(function(o){ return o.green; }).length;
      var taxa = resolvidas.length ? (100*greens/resolvidas.length) : null;
      var r1 = ocorrencias.filter(function(o){ return o.green1==='green'||o.green1==='red'; });
      var r2 = ocorrencias.filter(function(o){ return o.green2==='green'||o.green2==='red'; });
      return {
        def: pd, alvos: alvos,
        total: ocorrencias.length,
        resolvidas: resolvidas.length,
        greens: greens,
        taxa: taxa,
        edge: (taxa!==null && r!==null) ? (taxa - r) : null,
        g1: { n:r1.length, ok:r1.filter(function(o){return o.green1==='green';}).length },
        g2: { n:r2.length, ok:r2.filter(function(o){return o.green2==='green';}).length },
        ocorrencias: ocorrencias
      };
    });
    return { regua: r, jogos: jogos.length, familias: saida };
  }

  /* ---------- render ---------- */

  function nomeJogo(j){
    if (!j) return '—';
    var g = gols(j);
    var placar = g ? (g.a + '-' + g.b) : '';
    return (j.horario||'') + ' ' + (j.time_a||'') + ' ' + placar + ' ' + (j.time_b||'');
  }

  function selo(t){
    if (t.estado==='green') return '<b style="color:var(--green)">' + esc(nomeJogo(t.jogo)) + '</b>';
    if (t.estado==='red')   return '<span style="color:var(--red)">' + esc(nomeJogo(t.jogo)) + '</span>';
    if (t.estado==='aguardando') return '<span style="color:var(--muted)">' + esc((t.jogo&&t.jogo.horario)||'') + ' aguardando</span>';
    return '<span style="color:var(--muted)">além da janela</span>';
  }

  function cartao(f, r){
    var cor = f.def.cor;
    var edge = f.edge;
    var corEdge = edge===null ? 'var(--muted)' : (edge>0 ? 'var(--green)' : 'var(--red)');
    return '<div class="an-kpi" style="border-color:' + cor + '55;cursor:pointer" data-abre="' + f.def.chave + '">' +
      '<div class="v" style="color:' + cor + '">' + f.total + '</div>' +
      '<div class="k">Ocorrências ' + esc(f.def.rot) + '</div>' +
      '<div class="k" style="margin-top:6px">Taxa <b>' + (f.taxa===null?'—':f.taxa.toFixed(1)+'%') + '</b>' +
      ' · <span style="color:' + corEdge + '">edge ' + (edge===null?'—':((edge>0?'+':'')+edge.toFixed(1)+' pts')) + '</span></div>' +
      '<div class="k">1º ' + pct(f.g1.ok,f.g1.n) + ' · 2º ' + pct(f.g2.ok,f.g2.n) + ' · ' + f.resolvidas + ' resolvidas</div>' +
    '</div>';
  }

  function tabela(f){
    if (!f.ocorrencias.length) return '<div style="padding:14px;color:var(--muted)">Nenhuma ocorrência deste padrão na janela.</div>';
    var cabAlvo = f.alvos.map(function(o){ return '<th>ALVO +' + o + '</th>'; }).join('');
    var linhas = f.ocorrencias.slice().reverse().slice(0,40).map(function(o){
      var g = o.gatilho.map(function(j){ return '<td>' + esc(nomeJogo(j)) + '</td>'; }).join('');
      var a = o.tiros.map(function(t){ return '<td>' + selo(t) + '</td>'; }).join('');
      return '<tr>' + g + a + '</tr>';
    }).join('');
    var cabG = o_cab(f);
    return '<div style="overflow-x:auto"><table class="bt-rolagem" style="width:100%;font-size:12px">' +
      '<thead><tr>' + cabG + cabAlvo + '</tr></thead><tbody>' + linhas + '</tbody></table></div>';
  }

  function o_cab(f){
    return f.def.seq.split('').map(function(c,i){
      return '<th>' + (i+1) + 'º ' + (c==='O' ? 'POSITIVO' : 'NEGATIVO') + '</th>';
    }).join('');
  }

  function render(){
    var alvo = $('ciclos-corpo');
    if (!alvo) return;
    if (!window.AMD_ADAPTADOR){ alvo.innerHTML = '<div style="padding:14px;color:var(--red)">motor-adaptador.js não carregou.</div>'; return; }

    var d = window.AMD_ADAPTADOR.normalizar(estado.jogos);
    var jogos = d.todos;
    if (jogos.length < 30){ alvo.innerHTML = '<div style="padding:14px;color:var(--muted)">Poucos jogos na janela (' + jogos.length + ').</div>'; return; }

    var res = analisar(jogos, estado.mercado);
    var mrot = (MERCADOS.filter(function(m){return m[0]===estado.mercado;})[0]||[])[1] || estado.mercado;

    var cab = '<div class="meta" style="margin:4px 0 12px">' +
      esc(estado.liga) + ' · ' + esc(mrot) + ' · ' + res.jogos + ' jogos na janela · ' +
      'régua do ciclo <b>' + (res.regua===null?'—':res.regua.toFixed(1)+'%') + '</b>' +
      ' <span style="opacity:.7">(chance de pelo menos 1 green em 3 tiros quaisquer — é isto que um padrão precisa superar)</span></div>';

    var cards = '<div class="an-kpis" style="grid-template-columns:repeat(auto-fit,minmax(210px,1fr))">' +
      res.familias.map(function(f){ return cartao(f, res.regua); }).join('') + '</div>';

    var det = '';
    if (estado.aberto){
      var f = res.familias.filter(function(x){ return x.def.chave===estado.aberto; })[0];
      if (f) det = '<div class="an-sec" style="margin-top:14px"><div class="an-sechead">' +
        '<h2 style="color:' + f.def.cor + '">' + esc(f.def.rot) + ' — OCORRÊNCIAS DETECTADAS</h2>' +
        '<p>Total: <b>' + f.total + '</b> · resolvidas: <b>' + f.resolvidas + '</b> · greens: <b>' + f.greens + '</b> · taxa: <b>' + (f.taxa===null?'—':f.taxa.toFixed(1)+'%') + '</b>' +
        ' · edge sobre a régua: <b>' + (f.edge===null?'—':((f.edge>0?'+':'')+f.edge.toFixed(1)+' pts')) + '</b></p>' +
        '</div>' + tabela(f) + '</div>';
    } else {
      det = '<div class="meta" style="padding:12px 2px">Clique num cartão para ver as ocorrências detectadas.</div>';
    }

    alvo.innerHTML = cab + cards + det;

    [].forEach.call(alvo.querySelectorAll('[data-abre]'), function(el){
      el.addEventListener('click', function(){
        var c = el.getAttribute('data-abre');
        estado.aberto = (estado.aberto === c) ? null : c;
        render();
      });
    });
  }

  /* ---------- dados ---------- */

  function carregar(){
    if (estado.carregando) return;
    estado.carregando = true;
    var alvo = $('ciclos-corpo');
    if (alvo && !alvo.innerHTML) alvo.innerHTML = '<div style="padding:14px;color:var(--muted)">carregando…</div>';
    var q = API + '?liga=' + encodeURIComponent(estado.liga) + '&horas=' + estado.horas + '&compacto=1';
    fetch(q, { cache:'no-store', credentials:'same-origin' })
      .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
      .then(function(j){
        estado.jogos = Array.isArray(j) ? j : (j && Array.isArray(j.partidas)) ? j.partidas : [];
        estado.carregando = false;
        render();
      })
      .catch(function(e){
        estado.carregando = false;
        if (alvo) alvo.innerHTML = '<div style="padding:14px;color:var(--muted)">Não foi possível carregar: ' + esc(e.message) + '</div>';
      });
  }

  /* ---------- controles ---------- */

  function chips(id, lista, atual){
    return '<div class="opts" id="' + id + '">' + lista.map(function(x){
      return '<div class="opt' + (String(x[0])===String(atual)?' on':'') + '" data-v="' + x[0] + '">' + esc(x[1]) + '</div>';
    }).join('') + '</div>';
  }

  function montarControles(){
    var c = $('ciclos-ctrl');
    if (!c) return;
    c.innerHTML =
      '<div class="k" style="margin-bottom:4px">LIGA</div>' + chips('cic-liga', LIGAS, estado.liga) +
      '<div class="k" style="margin:10px 0 4px">JANELA</div>' + chips('cic-hora', JANELAS, estado.horas) +
      '<div class="k" style="margin:10px 0 4px">MERCADO</div>' + chips('cic-mkt', MERCADOS.map(function(m){return [m[0],m[1]];}), estado.mercado);

    var liga = function(ev, id, campo, recarrega){
      var box = $(id); if (!box) return;
      box.addEventListener('click', function(e){
        var o = e.target.closest('.opt'); if (!o) return;
        estado[campo] = (campo==='horas') ? +o.getAttribute('data-v') : o.getAttribute('data-v');
        estado.aberto = null;
        [].forEach.call(box.querySelectorAll('.opt'), function(x){
          x.className = 'opt' + (String(x.getAttribute('data-v'))===String(estado[campo])?' on':'');
        });
        if (recarrega) carregar(); else render();
      });
    };
    liga(null,'cic-liga','liga',true);
    liga(null,'cic-hora','horas',true);
    liga(null,'cic-mkt','mercado',false);
  }

  function iniciar(){
    if (!$('ciclos-corpo')) return;
    montarControles();
    carregar();
    setInterval(function(){ if (!document.hidden) carregar(); }, RECARGA_MS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
