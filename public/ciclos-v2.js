/* ============================================================
   AMD LIVE 2 - ciclos-v2.js
   DETECTOR DE CICLOS O/U - PADROES E GREENS

   Porte fiel do detector do Betaxis (app/tools/marcio.html).
   A logica e a mesma; muda so a fonte: la e CSV por liga,
   aqui e o /api/grade via AMD_ADAPTADOR.

   O QUE A PRIMEIRA VERSAO (ciclos.js) ERRAVA
   1. Tratava o alvo como salto de posicao no array. O original
      usa OFFSET EM MINUTOS de relogio: 117/120/123 para padrao
      de 3, 177/180/183 para 4, 237/240/243 para 5. O indice do
      array e so o atalho para achar o jogo; o horario exibido
      vem de horaToMin(gatilho) + offset.
   2. Padroes de 4 e 5 jogos tem DOIS alvos, um a partir do
      primeiro jogo e outro a partir do ultimo. Por isso a tela
      original mostra 'Green 1o' e 'Green 2o' separados.
   3. Nao existia estado pendente. O original devolve null quando
      algum tiro ainda nao aconteceu e nenhum deu green, e esses
      casos SAO EXCLUIDOS do denominador. Contar como resolvido
      inflava as taxas.

   ACRESCENTADO (nao existe no original)
   - REGUA DO CICLO: taxa de acertar pelo menos 1 green em 3 tiros
     quaisquer. Sem ela, 90% parece forte quando a regua ja e 86%.
   - EDGE: quantos pontos o padrao bate acima ou abaixo da regua.
   - Taxa escondida com menos de MIN_RESOLVIDAS casos, em vez de
     exibir '100%' apoiado em uma ocorrencia.

   REGRA DESTE ARQUIVO: nenhum numero e gerado.
   ============================================================ */

(function () {
  'use strict';

  var API = '/api/grade';
  var RECARGA_MS = 180000;   /* mesmo intervalo do original */
  var MIN_RESOLVIDAS = 5;
  var TIROS = 3;

  /* offsets em MINUTOS de relogio, como no original */
  var OFF_MIN_3 = [117, 120, 123];
  var OFF_MIN_4 = [177, 180, 183];
  var OFF_MIN_5 = [237, 240, 243];
  /* offsets em POSICAO usados para localizar o jogo na grade */
  var OFF_IDX_3 = 39;
  var OFF_IDX_4 = 59;
  var OFF_IDX_5 = 79;

  var LIGAS = [['ita','ITA'],['eng','ENG'],['spa','SPA'],['mnd','MND'],['bra','BRA'],['lat','LAT'],['cam','CAM'],['cop','COP'],['ame','AME']];
  var JANELAS = [[60,'3 h (~60)'],[120,'6 h (~120)'],[240,'12 h (~240)'],[480,'24 h (~480)'],[960,'48 h (~960)']];
  var LINHAS = [[1.5,'Over/Under 1.5'],[2.5,'Over/Under 2.5'],[3.5,'Over/Under 3.5']];
  var MODOS = [['ou','Over / Under'],['ambas','Ambas Marcam']];

  var estado = { liga:'ita', janela:120, linha:2.5, modo:'ou', jogos:[], carregando:false };

  function $(id){ return document.getElementById(id); }
  function esc(s){
    return String(s==null?'':s).replace(/[&<>"]/g,function(c){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c];
    });
  }

  /* ---------- classificacao ---------- */

  function num(v){ var n = Number(v); return isFinite(n) ? n : NaN; }

  function isAmbas(j){
    var a = num(j.gols_a), b = num(j.gols_b);
    return !isNaN(a) && !isNaN(b) && a > 0 && b > 0;
  }

  function isOver(j, linha){
    var a = num(j.gols_a), b = num(j.gols_b);
    if (isNaN(a) || isNaN(b)) return false;
    return (a + b) > linha;
  }

  function isPositivo(j, modo, linha){
    return modo === 'ambas' ? isAmbas(j) : isOver(j, linha);
  }

  /* jogo ja ocorreu: tem placar valido */
  function existe(lista, idx){
    if (idx >= lista.length || idx < 0) return false;
    var j = lista[idx];
    if (!j) return false;
    return !isNaN(num(j.gols_a)) && !isNaN(num(j.gols_b)) && !!j.resultado_ft;
  }

  /* ---------- relogio ---------- */

  function horaToMin(h){
    var s = String(h||'').trim().replace('.', ':');
    var m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return parseInt(m[1],10) * 60 + parseInt(m[2],10);
  }

  function minToHora(min){
    var t = ((min % 1440) + 1440) % 1440;
    var h = Math.floor(t / 60), m = t % 60;
    return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
  }

  /* ---------- descricoes ---------- */

  function descJogo(j){
    if (!j) return '—';
    var hora = String(j.horario||'').trim();
    var a = num(j.gols_a), b = num(j.gols_b);
    if (!isNaN(a) && !isNaN(b) && j.resultado_ft){
      return hora + ' ' + (j.time_a||'') + ' ' + a + '-' + b + ' ' + (j.time_b||'');
    }
    return hora + ' ' + (j.time_a||'') + ' vs ' + (j.time_b||'');
  }

  function descAlvo(lista, absIdx, horaGatilho, offsetIdx, offsetsMin){
    if (existe(lista, absIdx)) return { texto: descJogo(lista[absIdx]), existe: true };
    if (absIdx < lista.length)  return { texto: descJogo(lista[absIdx]), existe: false };
    var base = horaToMin(horaGatilho);
    if (base === null) return { texto: '—?', existe: false };
    return { texto: minToHora(base + offsetsMin[offsetIdx]) + ' (est)', existe: false };
  }

  /* ---------- janela de tiros ---------- */

  function checkWindow(lista, startIdx, modo, linha, startOffset){
    var off = startOffset || 0;
    var hits = [];
    for (var k = off; k <= off + 2; k++){
      var idx = startIdx + k;
      if (!existe(lista, idx)) hits.push(null);
      else hits.push(isPositivo(lista[idx], modo, linha));
    }
    return hits;
  }

  /* regra do original: green pendente nao conta como red */
  function resolveGreen(hits){
    var temFuturo = hits.some(function(h){ return h === null; });
    var temGreen  = hits.some(function(h){ return h === true; });
    if (temFuturo) return temGreen ? true : null;
    return temGreen;
  }

  /* ---------- regua do ciclo ---------- */

  function regua(lista, modo, linha){
    var seq = [];
    for (var i=0;i<lista.length;i++){
      if (!existe(lista, i)) continue;
      seq.push(isPositivo(lista[i], modo, linha));
    }
    var n=0, h=0;
    for (var k=0; k+TIROS<=seq.length; k++){
      n++;
      if (seq[k] || seq[k+1] || seq[k+2]) h++;
    }
    return n ? (100*h/n) : null;
  }

  /* ---------- analise ---------- */

  function varrer(lista, janela, modo, linha, inverso){
    var slice = lista.slice(-janela);
    var base = lista.length - slice.length;
    var p3 = [], p4 = [], p5 = [];
    var pos = function(j){
      var v = isPositivo(j, modo, linha);
      return inverso ? !v : v;
    };

    for (var i=0; i<slice.length-2; i++){
      if (!pos(slice[i])) continue;
      var absI = base + i;
      var h0 = (slice[i].horario)||'';

      /* P N P */
      if (i+2 < slice.length && !pos(slice[i+1]) && pos(slice[i+2])){
        var hits = checkWindow(lista, absI, modo, linha, OFF_IDX_3);
        p3.push({
          pos: absI+1,
          gatilho: [descJogo(slice[i]), descJogo(slice[i+1]), descJogo(slice[i+2])],
          alvos: [
            descAlvo(lista, absI+OFF_IDX_3,   h0, 0, OFF_MIN_3),
            descAlvo(lista, absI+OFF_IDX_3+1, h0, 1, OFF_MIN_3),
            descAlvo(lista, absI+OFF_IDX_3+2, h0, 2, OFF_MIN_3)
          ],
          green: resolveGreen(hits)
        });
      }

      /* P N N P - dois alvos */
      if (i+3 < slice.length && !pos(slice[i+1]) && !pos(slice[i+2]) && pos(slice[i+3])){
        var absF = base + i + 3;
        var hF = (slice[i+3].horario)||'';
        p4.push({
          pos: absI+1,
          gatilho: [descJogo(slice[i]), descJogo(slice[i+1]), descJogo(slice[i+2]), descJogo(slice[i+3])],
          alvos1: [
            descAlvo(lista, absI+OFF_IDX_4,   h0, 0, OFF_MIN_4),
            descAlvo(lista, absI+OFF_IDX_4+1, h0, 1, OFF_MIN_4),
            descAlvo(lista, absI+OFF_IDX_4+2, h0, 2, OFF_MIN_4)
          ],
          alvos2: [
            descAlvo(lista, absF+OFF_IDX_4,   hF, 0, OFF_MIN_4),
            descAlvo(lista, absF+OFF_IDX_4+1, hF, 1, OFF_MIN_4),
            descAlvo(lista, absF+OFF_IDX_4+2, hF, 2, OFF_MIN_4)
          ],
          green1: resolveGreen(checkWindow(lista, absI, modo, linha, OFF_IDX_4)),
          green2: resolveGreen(checkWindow(lista, absF, modo, linha, OFF_IDX_4))
        });
      }

      /* P N N N P - dois alvos */
      if (i+4 < slice.length && !pos(slice[i+1]) && !pos(slice[i+2]) && !pos(slice[i+3]) && pos(slice[i+4])){
        var absG = base + i + 4;
        var hG = (slice[i+4].horario)||'';
        p5.push({
          pos: absI+1,
          gatilho: [descJogo(slice[i]), descJogo(slice[i+1]), descJogo(slice[i+2]), descJogo(slice[i+3]), descJogo(slice[i+4])],
          alvos1: [
            descAlvo(lista, absI+OFF_IDX_5,   h0, 0, OFF_MIN_5),
            descAlvo(lista, absI+OFF_IDX_5+1, h0, 1, OFF_MIN_5),
            descAlvo(lista, absI+OFF_IDX_5+2, h0, 2, OFF_MIN_5)
          ],
          alvos2: [
            descAlvo(lista, absG+OFF_IDX_5,   hG, 0, OFF_MIN_5),
            descAlvo(lista, absG+OFF_IDX_5+1, hG, 1, OFF_MIN_5),
            descAlvo(lista, absG+OFF_IDX_5+2, hG, 2, OFF_MIN_5)
          ],
          green1: resolveGreen(checkWindow(lista, absI, modo, linha, OFF_IDX_5)),
          green2: resolveGreen(checkWindow(lista, absG, modo, linha, OFF_IDX_5))
        });
      }
    }
    return { total: slice.length, p3: p3, p4: p4, p5: p5 };
  }

  /* ---------- helpers de exibicao ---------- */

  function rot(modo){
    var A = modo === 'ambas';
    return { P: A?'A':'O', N: A?'NA':'U', p1: A?'1ª Ambas':'1º Over', p2: A?'2ª Ambas':'2º Over', n: A?'Não Amb':'Under' };
  }

  function taxaDe(lista, campo){
    var res = lista.filter(function(r){ return r[campo] !== null; });
    var g = res.filter(function(r){ return r[campo] === true; }).length;
    return { n: res.length, g: g, taxa: res.length ? (100*g/res.length) : null };
  }

  function txtTaxa(t, reg){
    if (t.n < MIN_RESOLVIDAS) return '<b style="color:var(--muted)">— <span style="font-size:.8em">(' + t.n + ' resolvidas)</span></b>';
    var e = (reg === null) ? null : (t.taxa - reg);
    var cor = e === null ? 'var(--muted)' : (e > 0 ? 'var(--green)' : 'var(--red)');
    return '<b>' + t.taxa.toFixed(1) + '%</b> <span style="color:' + cor + '">' +
           (e===null?'':'edge ' + (e>0?'+':'') + e.toFixed(1) + ' pts') + '</span>' +
           ' <span style="opacity:.6;font-size:.85em">' + t.g + '/' + t.n + '</span>';
  }

  function selo(g){
    if (g === null) return '<span style="color:#fbbf24">Aguard.</span>';
    return g ? '<span style="color:var(--green)">Green</span>' : '<span style="color:var(--red)">Red</span>';
  }

  function celAlvo(a){
    if (!a) return '<td>—</td>';
    var cor = a.existe ? '' : 'color:var(--muted)';
    return '<td style="' + cor + '">' + esc(a.texto) + '</td>';
  }

  /* ---------- render ---------- */

  function tabela(titulo, cor, lista, cabGatilho, offsets, duplo, reg){
    if (!lista.length) return '';
    var t1 = taxaDe(lista, duplo ? 'green1' : 'green');
    var t2 = duplo ? taxaDe(lista, 'green2') : null;

    var cabAlvo = offsets.map(function(o){ return '<th>ALVO +' + o + 'min</th>'; }).join('');
    var cab = cabGatilho.map(function(c){ return '<th>' + esc(c) + '</th>'; }).join('') +
              cabAlvo + '<th>1º</th>' + (duplo ? cabAlvo + '<th>2º</th>' : '');

    var linhas = lista.slice().reverse().map(function(r){
      var g = r.gatilho.map(function(x){ return '<td>' + esc(x) + '</td>'; }).join('');
      var a1 = (duplo ? r.alvos1 : r.alvos).map(celAlvo).join('');
      var s1 = '<td>' + selo(duplo ? r.green1 : r.green) + '</td>';
      var a2 = duplo ? r.alvos2.map(celAlvo).join('') + '<td>' + selo(r.green2) + '</td>' : '';
      return '<tr><td>#' + r.pos + '</td>' + g + a1 + s1 + a2 + '</tr>';
    }).join('');

    return '<div class="an-sec" style="margin:16px 0">' +
      '<div class="an-sechead">' +
        '<h2 style="color:' + cor + '">' + esc(titulo) + ' — OCORRÊNCIAS DETECTADAS</h2>' +
        '<p>Total: <b>' + lista.length + '</b> &nbsp;|&nbsp; ' +
        (duplo ? ('1º alvo: ' + txtTaxa(t1, reg) + ' &nbsp;|&nbsp; 2º alvo: ' + txtTaxa(t2, reg))
               : ('Taxa: ' + txtTaxa(t1, reg))) + '</p>' +
      '</div>' +
      '<div style="overflow-x:auto"><table class="bt-rolagem" style="width:100%;font-size:11.5px">' +
      '<thead><tr><th>#</th>' + cab + '</tr></thead><tbody>' + linhas + '</tbody></table></div>' +
    '</div>';
  }

  function render(){
    var alvo = $('ciclos-corpo');
    if (!alvo) return;
    if (!window.AMD_ADAPTADOR){ alvo.innerHTML = '<div style="padding:14px;color:var(--red)">motor-adaptador.js não carregou.</div>'; return; }

    var d = window.AMD_ADAPTADOR.normalizar(estado.jogos);
    var lista = d.todos;
    if (lista.length < 30){ alvo.innerHTML = '<div style="padding:14px;color:var(--muted)">Poucos jogos na janela (' + lista.length + ').</div>'; return; }

    var modo = estado.modo, linha = estado.linha;
    var R = rot(modo);
    var reg = regua(lista.slice(-estado.janela), modo, linha);

    var dir = varrer(lista, estado.janela, modo, linha, false);
    var inv = varrer(lista, estado.janela, modo, linha, true);

    var cab3 = [R.p1, R.n, R.p2];
    var cab4 = [R.p1, R.n + ' 1', R.n + ' 2', R.p2];
    var cab5 = [R.p1, R.n + ' 1', R.n + ' 2', R.n + ' 3', R.p2];
    var cab3i = [R.n, R.P, R.n];
    var cab4i = [R.n, R.P + ' 1', R.P + ' 2', R.n];
    var cab5i = [R.n, R.P + ' 1', R.P + ' 2', R.P + ' 3', R.n];

    var cabecalho = '<div class="meta" style="margin:4px 0 12px">' +
      esc(estado.liga) + ' · ' + (modo==='ambas' ? 'Ambas Marcam' : ('Over/Under ' + linha)) +
      ' · ' + dir.total + ' jogos na janela · régua do ciclo <b>' + (reg===null?'—':reg.toFixed(1)+'%') + '</b>' +
      ' <span style="opacity:.7">(acertar 1 green em 3 tiros quaisquer — é o que um padrão precisa superar)</span></div>';

    var html = cabecalho;
    html += tabela(R.P+' · '+R.N+' · '+R.P, 'var(--green)', dir.p3, cab3, OFF_MIN_3, false, reg);
    html += tabela(R.P+' · '+R.N+' · '+R.N+' · '+R.P, '#a78bfa', dir.p4, cab4, OFF_MIN_4, true, reg);
    html += tabela(R.P+' · '+R.N+' · '+R.N+' · '+R.N+' · '+R.P, '#fbbf24', dir.p5, cab5, OFF_MIN_5, true, reg);
    html += tabela(R.N+' · '+R.P+' · '+R.N, '#38bdf8', inv.p3, cab3i, OFF_MIN_3, false, reg);
    html += tabela(R.N+' · '+R.P+' · '+R.P+' · '+R.N, '#f472b6', inv.p4, cab4i, OFF_MIN_4, true, reg);
    html += tabela(R.N+' · '+R.P+' · '+R.P+' · '+R.P+' · '+R.N, '#fb923c', inv.p5, cab5i, OFF_MIN_5, true, reg);

    alvo.innerHTML = html;
  }

  /* ---------- dados ---------- */

  function horasDaJanela(){
    return Math.max(3, Math.ceil(estado.janela / 20));
  }

  function carregar(){
    if (estado.carregando) return;
    estado.carregando = true;
    var alvo = $('ciclos-corpo');
    if (alvo && !alvo.innerHTML) alvo.innerHTML = '<div style="padding:14px;color:var(--muted)">carregando…</div>';
    var q = API + '?liga=' + encodeURIComponent(estado.liga) + '&horas=' + horasDaJanela() + '&compacto=1';
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
      '<div class="k" style="margin:10px 0 4px">JANELA</div>' + chips('cic-jan', JANELAS, estado.janela) +
      '<div class="k" style="margin:10px 0 4px">TIPO DE MERCADO</div>' + chips('cic-modo', MODOS, estado.modo) +
      '<div id="cic-linha-box"><div class="k" style="margin:10px 0 4px">LINHA</div>' + chips('cic-linha', LINHAS, estado.linha) + '</div>';

    var ligar = function(id, campo, numero, recarrega){
      var box = $(id); if (!box) return;
      box.addEventListener('click', function(e){
        var o = e.target.closest('.opt'); if (!o) return;
        estado[campo] = numero ? Number(o.getAttribute('data-v')) : o.getAttribute('data-v');
        [].forEach.call(box.querySelectorAll('.opt'), function(x){
          x.className = 'opt' + (String(x.getAttribute('data-v'))===String(estado[campo])?' on':'');
        });
        var lb = $('cic-linha-box');
        if (lb) lb.style.display = (estado.modo === 'ambas') ? 'none' : '';
        if (recarrega) carregar(); else render();
      });
    };
    ligar('cic-liga','liga',false,true);
    ligar('cic-jan','janela',true,true);
    ligar('cic-modo','modo',false,false);
    ligar('cic-linha','linha',true,false);
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
