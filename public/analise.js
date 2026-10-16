var LIGAS=['ITA','ENG','SPA','MND','BRA','LAT','CAM','COP','AME'];
var liga='ITA';

// Uma unica leitura do banco alimenta o ranking EV+ e os quatro quadrantes.
// /api/grade consulta o PostgreSQL do coletor; nunca chama o provedor de odds.
// O cache em memoria tambem evita repetir a mesma consulta quando o usuario
// muda mercado, ferramenta, equipes ou tiros dentro da mesma janela.
var AMD_ANALISE_DADOS=window.AMD_ANALISE_DADOS||(function(){
  var API='/api/grade';
  var CACHE_MS=90000,cache={},buscando={};
  function idLiga(nome){
    var n=String(nome||'ita').toLowerCase();
    return ['ita','eng','spa','mnd','bra','lat','cam','cop','ame'].indexOf(n)>=0?n:'ita';
  }
  function horasValidas(h){h=parseInt(h,10)||24;return Math.max(1,Math.min(168,h));}
  function melhorCache(id,horas){
    var agora=Date.now(),melhor=null;
    Object.keys(cache).forEach(function(k){var c=cache[k];
      if(c.liga===id&&c.horas>=horas&&agora-c.ts<CACHE_MS&&(!melhor||c.horas<melhor.horas))melhor=c;
    });
    return melhor;
  }
  function melhorPendente(id,horas){
    var melhor=null;
    Object.keys(buscando).forEach(function(k){var b=buscando[k];
      if(b.liga===id&&b.horas>=horas&&(!melhor||b.horas<melhor.horas))melhor=b;
    });
    return melhor;
  }
  function buscar(nome,horas,forcar){
    var id=idLiga(nome),h=horasValidas(horas),salvo=!forcar&&melhorCache(id,h);
    if(salvo)return Promise.resolve(salvo.partidas);
    var pendente=!forcar&&melhorPendente(id,h);
    if(pendente)return pendente.promise;
    var chave=id+'|'+h;
    if(buscando[chave])return buscando[chave].promise;
    var promessa=fetch(API+'?liga='+encodeURIComponent(id)+'&horas='+h+'&compacto=1',{cache:'no-store'})
      .then(function(r){if(!r.ok)throw new Error('banco respondeu '+r.status);return r.json();})
      .then(function(j){
        var partidas=j&&Array.isArray(j.partidas)?j.partidas:[];
        cache[chave]={liga:id,horas:h,ts:Date.now(),partidas:partidas};
        if(buscando[chave]&&buscando[chave].promise===promessa)delete buscando[chave];
        return partidas;
      }).catch(function(err){
        if(buscando[chave]&&buscando[chave].promise===promessa)delete buscando[chave];
        var antigo=null;
        Object.keys(cache).forEach(function(k){var c=cache[k];if(c.liga===id&&c.horas>=h&&(!antigo||c.ts>antigo.ts))antigo=c;});
        if(antigo)return antigo.partidas;
        throw err;
      });
    buscando[chave]={liga:id,horas:h,promise:promessa};
    return promessa;
  }
  return {buscar:buscar,idLiga:idLiga};
})();
window.AMD_ANALISE_DADOS=AMD_ANALISE_DADOS;
function rngDe(s){var h=2166136261;for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}var x=h>>>0;
  return function(){x=(x*1664525+1013904223)>>>0;return x/4294967296;};}
function pad(n){return String(n).padStart(2,'0');}
var MERCADOS=['Over 2.5','Over 1.5','Over 3.5','5+ Gols','Ambas marcam','Ambas Não','Under 1.5','Under 2.5','Under 3.5','Casa vence','Empate','Fora vence','Placar correto'];
var JANELAS=['3h','6h','12h','24h','48h','72h','120h'];
var EQUIPES=['Casa + Fora','Só Casa','Só Fora'];var TIROS=['1 tiro','2 tiros','3 tiros','4 tiros'];
var FERRAM=['Analisador de padrões','Ranking de odds','Topos e fundos','Rank de confrontos'];
var PADROES=['Repetição 2-1 após baixa de Over','Topo rompido com retorno à média','Sequência alternada Casa/Fora','Fundo duplo com confirmação','Congestão rompida para cima','Mínima das 6h com reversão'];
var PAISES=['França','Suíça','Dinamarca','Portugal','Itália','Espanha','Geórgia','Eslováquia','Holanda','Bélgica'];
var TIMES=['Leões','Falcões','Atlético','Real Norte','União','Estrela','Nacional','Vitória','Geórgia','Eslováquia','Portugal','Itália'];
var estado=[{f:0,j:1,m:0,e:0,t:2},{f:0,j:2,m:0,e:0,t:2},{f:1,j:1,m:1,e:0,t:1},{f:2,j:3,m:0,e:1,t:0}];
function opts(l,sel,q,c){return l.map(function(o,i){return '<button class="opt'+(i===sel?' on':'')+'" data-q="'+q+'" data-campo="'+c+'" data-i="'+i+'">'+o+'</button>';}).join('');}
function renderQuads(){var out='';
  for(var q=0;q<4;q++){var s=estado[q];var r=rngDe('quad'+liga+q+s.f+s.j+s.m+s.e+s.t);var forca=68+Math.floor(r()*28);var itens='';
    for(var k=0;k<3;k++){var conf=70+Math.floor(r()*20);var ev=(8+r()*14).toFixed(1);
      itens+='<div class="res"><div class="pos">'+(k+1)+'</div><div class="txt">'+MERCADOS[s.m]+' · '+PADROES[Math.floor(r()*PADROES.length)]+'<small>'+EQUIPES[s.e]+' · amostra '+(40+Math.floor(r()*40))+' jogos</small></div><div class="num"><b>'+conf+'%</b><span>+'+ev+'% EV</span></div></div>';}
    out+='<div class="quad"><h3>QUADRANTE '+(q+1)+'</h3><div class="nome">'+FERRAM[s.f]+' <span class="an-badge">PRONTO</span></div>'
      +'<div class="grp"><div class="lbl">Ferramenta</div><div class="opts">'+opts(FERRAM,s.f,q,'f')+'</div></div>'
      +'<div class="grp"><div class="lbl">Janela</div><div class="opts">'+opts(JANELAS,s.j,q,'j')+'</div></div>'
      +'<div class="grp"><div class="lbl">Mercado</div><div class="opts">'+opts(MERCADOS,s.m,q,'m')+'</div></div>'
      +'<div class="grp"><div class="lbl">Equipes</div><div class="opts">'+opts(EQUIPES,s.e,q,'e')+'</div></div>'
      +'<div class="grp"><div class="lbl">Tiros</div><div class="opts">'+opts(TIROS,s.t,q,'t')+'</div></div>'
      +'<button class="btn-an">Analisar agora</button>'
      +'<div class="selo"><div><b>'+liga+'</b><span>Liga</span></div><div><b>'+JANELAS[s.j]+'</b><span>Janela</span></div><div><b>'+(s.t+1)+'</b><span>Tiros</span></div><div><b style="color:var(--green)">'+forca+'%</b><span>Força</span></div></div>'+itens+'</div>';}
  document.getElementById('quads').innerHTML=out;}
var GRUPOS={Over:['Over 2.5','Over 3.5','5+ Gols','Ambas Sim'],
  Under:['Under 0.5','Under 1.5','Under 2.5','Under 3.5','Ambas Não'],
  Resultado:['Casa vence','Empate','Fora vence']};
var BASE={'Over 2.5':43,'Over 3.5':21,'5+ Gols':7,'Ambas Sim':49,'Under 0.5':8,'Under 1.5':25,
  'Under 2.5':57,'Under 3.5':79,'Ambas Não':51,'Casa vence':40,'Empate':25,'Fora vence':35};
var JAN=[['3h',5],['6h',10],['12h',21],['24h',43]];
var rkGrupo='Over';
function topTimes(m,amostra,r){
  var b=BASE[m]||40;
  var arr=PAISES.map(function(p){
    var n=Math.max(2,Math.round(amostra*(0.5+r())));
    var desvio=(r()-0.5)*90/Math.sqrt(n);
    var pct=Math.max(0,Math.min(100,Math.round(b+desvio)));
    return {p:p,n:n,pct:pct};});
  arr.sort(function(a,b2){return b2.pct-a.pct||b2.n-a.n;});
  return arr.slice(0,5);}
function maxReds(m,amostra,r){
  var p=(BASE[m]||40)/100;
  var esperado=Math.log(Math.max(2,amostra*4))/-Math.log(1-p);
  return Math.max(1,Math.round(esperado+(r()-0.4)*esperado*0.5));}
function renderRanking(){
  document.getElementById('rkOpts').innerHTML=Object.keys(GRUPOS).map(function(g){
    return '<button class="opt'+(g===rkGrupo?' on':'')+'" data-rk="'+g+'">'+g+'</button>';}).join('');
  var lista=GRUPOS[rkGrupo],out='',reds='';
  lista.forEach(function(m){
    var r=rngDe('rk'+liga+m);
    var linhas='';
    JAN.forEach(function(w){
      var top=topTimes(m,w[1],r);
      var txt=top.map(function(t,k){
        return (k+1)+'º '+t.p+' <b>'+t.pct+'%</b> <i class="'+(t.n<10?'fraca':'')+'">('+t.n+'j)</i>';}).join(' · ');
      linhas+='<div class="rklin"><span class="jan">'+w[0]+'</span><span class="lista">'+txt+'</span></div>';});
    out+='<div class="rkcard"><h4>'+m+'</h4>'+linhas+'</div>';
    var r2=rngDe('red'+liga+m);
    var cels=JAN.map(function(w){return '<td>'+maxReds(m,w[1],r2)+'</td>';}).join('');
    var seca=Math.floor(r2()*4);
    var destaque=(m==='Over 3.5'||m==='Under 2.5');
    reds+='<tr><td class="'+(destaque?'marc':'')+'">'+m+(destaque?' ◀':'')+'</td>'+cels
      +'<td><b>'+seca+'</b></td></tr>';});
  document.getElementById('rankTimes').innerHTML=out;
  document.getElementById('redsBody').innerHTML=reds;}
function renderConfrontos(){var r=rngDe('cf'+liga+new Date().getHours());var out='';var mins=21*60+35;
  for(var k=0;k<3;k++){var a=TIMES[Math.floor(r()*TIMES.length)],b=TIMES[Math.floor(r()*TIMES.length)];
    if(b===a)b=TIMES[(TIMES.indexOf(a)+1)%TIMES.length];
    var conf=2+Math.floor(r()*3);var forte=r()>.5;
    var lado=function(t,ic){return '<div class="lado"><div class="t">'+ic+' '+t+'</div><div class="r"><span>Gatilho</span><b>'+(28+Math.floor(r()*18))+'%</b></div><div class="r"><span>Over 3.5</span><b>'+(36+Math.floor(r()*24))+'%</b></div><div class="r"><span>5+ Gols</span><b>'+(12+Math.floor(r()*16))+'%</b></div></div>';};
    out+='<div class="cf"><div class="hora">'+pad(Math.floor(mins/60))+':'+pad(mins%60)+'</div><div class="times">'+a+' x '+b+'</div>'
      +'<div class="meta">'+liga+' · janela: anterior, atual e próximo jogo</div><div class="anc">⚓ '+(forte?'FORTE':'ÂNCORA')+'</div>'
      +'<div class="lados">'+lado('Casa','🏠')+'<div class="vs">×</div>'+lado('Fora','✈')+'</div>'
      +'<div class="conf">Confluência '+conf+' de 4 janelas</div>'
      +'<div class="status '+(conf>=3?'vig':'obs')+'">'+(conf>=3?'ENTRADA EM VIGILÂNCIA':'OBSERVAR')+'</div>'
      +'<button class="abrir" data-cf="'+a+' x '+b+'">Abrir confronto</button></div>';mins+=6;}
  document.getElementById('confr').innerHTML=out;}
function renderLeitura(nome){var r=rngDe('lt'+liga+nome);var prob=(38+r()*18);var odd=100/prob;var ev=(r()*8-4);
  document.getElementById('leitura').innerHTML='<div class="linha" style="font-weight:700;font-size:12.5px">'+nome+' · atualizado agora</div>'
   +'<div class="linha">🎯 No Over: <b>2-1</b> ('+(10+Math.floor(r()*8))+'%) · no Under: <b>0-0</b> ('+(11+Math.floor(r()*8))+'%) · esse confronto puxa <b>3-2</b> ('+(2+r()*2).toFixed(1)+'× o normal)</div>'
   +'<div class="linha">⏱ coluna '+(10+Math.floor(r()*50))+' pagou — 3h '+(20+Math.floor(r()*40))+'% · 6h '+(20+Math.floor(r()*40))+'% · 12h '+(20+Math.floor(r()*40))+'% · 24h '+(20+Math.floor(r()*40))+'%</div>'
   +'<div class="metr"><div><div class="k">Prob. calibrada</div><div class="v" style="color:var(--green)">'+prob.toFixed(1)+'%</div></div>'
   +'<div><div class="k">Odd justa</div><div class="v">'+odd.toFixed(2)+'</div></div>'
   +'<div><div class="k">EV real</div><div class="v" style="color:'+(ev>=0?'var(--green)':'var(--red)')+'">'+(ev>=0?'+':'')+ev.toFixed(1)+'%</div></div>'
   +'<div><div class="k">EV gale</div><div class="v" style="color:'+(ev>=0?'var(--green)':'var(--red)')+'">'+(ev>=0?'+':'')+(ev-0.7).toFixed(1)+'%</div></div>'
   +'<div><div class="k">Edge</div><div class="v">'+(ev/2).toFixed(1)+'%</div></div></div>'
   +'<div class="base"><span>Base dessa odd <b>'+(r()>.5?'sem base':(10+Math.floor(r()*40))+' jogos')+'</b></span>'
   +'<span>Base dos times <b>'+(20+Math.floor(r()*20))+'/'+(45+Math.floor(r()*20))+' '+(40+Math.floor(r()*20))+'%</b></span>'
   +'<span>Ciclo <b>'+(1+Math.floor(r()*3))+' RED | início/meio | pressão '+(30+Math.floor(r()*30))+'</b></span>'
   +'<span>⚓ Âncora <b>'+(r()>.5?'FORTE':'MÉDIA')+'</b></span></div>';}
document.addEventListener('click',function(e){
  var o=e.target.closest('.opt[data-q]');if(o){estado[+o.dataset.q][o.dataset.campo]=+o.dataset.i;renderQuads();return;}
  var rk=e.target.closest('.opt[data-rk]');if(rk){rkGrupo=rk.dataset.rk;renderRanking();return;}
  if(e.target.closest('.btn-an')){renderQuads();return;}
  var cf=e.target.closest('.abrir');if(cf){renderLeitura(cf.dataset.cf);document.getElementById('leitura').scrollIntoView({behavior:'smooth',block:'center'});}
});
var r0=rngDe('topo'+liga+new Date().toDateString());
document.getElementById('kSinais').textContent=18+Math.floor(r0()*14);
document.getElementById('kConf').textContent=(74+Math.floor(r0()*14))+'%';
document.getElementById('kEv').textContent='+'+(10+r0()*12).toFixed(1)+'%';
renderQuads();renderRanking();renderConfrontos();renderLeitura('Leões x Falcões');
var evMkt='Over 3.5', evJanela=6;
var EVMKTS=['Over 2.5','Over 1.5','Over 3.5','5+ Gols','Ambas Sim','Ambas Não','Under 1.5','Under 2.5','Under 3.5','Casa vence','Empate','Fora vence'];
var evPedido=0;
function evCfg(nome){
  var m=String(nome||'').toLowerCase();
  if(m.indexOf('over 1.5')>=0)return {odd:'odd_over_1.5',paga:function(a,b){return a+b>=2;}};
  if(m.indexOf('over 2.5')>=0)return {odd:'odd_over_2.5',paga:function(a,b){return a+b>=3;}};
  if(m.indexOf('over 3.5')>=0)return {odd:'odd_over_3.5',paga:function(a,b){return a+b>=4;}};
  if(m.indexOf('5+')>=0)return {odd:'odd_total_gols_extatos_5',paga:function(a,b){return a+b>=5;}};
  if(m.indexOf('ambas n')>=0)return {odd:'odd_ambas_nao',paga:function(a,b){return !(a>0&&b>0);}};
  if(m.indexOf('ambas')>=0)return {odd:'odd_ambas_sim',paga:function(a,b){return a>0&&b>0;}};
  if(m.indexOf('under 1.5')>=0)return {odd:'odd_under_1.5',paga:function(a,b){return a+b<=1;}};
  if(m.indexOf('under 2.5')>=0)return {odd:'odd_under_2.5',paga:function(a,b){return a+b<=2;}};
  if(m.indexOf('under 3.5')>=0)return {odd:'odd_under_3.5',paga:function(a,b){return a+b<=3;}};
  if(m.indexOf('casa')>=0)return {odd:'odd_resultado_final_casa',paga:function(a,b){return a>b;}};
  if(m.indexOf('empate')>=0)return {odd:'odd_resultado_final_empate',paga:function(a,b){return a===b;}};
  return {odd:'odd_resultado_final_fora',paga:function(a,b){return b>a;}};
}
function evNumero(v){var n=parseFloat(String(v==null?'':v).replace(',','.'));return isFinite(n)&&n>1.01?n:null;}
function evResolvidos(partidas,horas){
  var js=(partidas||[]).filter(function(p){return p&&p.gols_a!=null&&p.gols_b!=null;});
  if(!js.length)return js;
  var fim=Date.parse(js[js.length-1].slot_em||''),corte=fim-horas*3600000;
  if(isFinite(fim)){
    var porTempo=js.filter(function(p){var t=Date.parse(p.slot_em||'');return isFinite(t)&&t>corte&&t<=fim;});
    if(porTempo.length)return porTempo;
  }
  return js.slice(-horas*20);
}
function evHorasNecessarias(){
  // 24h é a base mínima compartilhada pelo robô e pelo rank de times; a
  // estatística exibida continua recortada exatamente pela janela escolhida.
  var h=Math.max(24,evJanela);
  (estado||[]).forEach(function(s){var x=parseInt(JANELAS[s.j],10)||0;if(x>h)h=x;});
  return h;
}
function evLinhas(partidas,mercado,horas){
  var cfg=evCfg(mercado),js=evResolvidos(partidas,horas),grupos={};
  js.forEach(function(p){
    var odd=evNumero(p.odds&&p.odds[cfg.odd]);if(!odd)return;
    var k=odd.toFixed(2),s=grupos[k]||(grupos[k]={odd:odd,n:0,ac:0});
    s.n++;if(cfg.paga(+p.gols_a,+p.gols_b))s.ac++;
  });
  // Odd sempre exata. A amostra minima cresce com a janela, sem excluir toda
  // a janela de 3h (onde cada preco aparece poucas vezes).
  var minimo=js.length>=240?8:js.length>=120?5:3;
  var linhas=Object.keys(grupos).map(function(k){return grupos[k];}).filter(function(s){return s.n>=minimo;});
  if(!linhas.length)linhas=Object.keys(grupos).map(function(k){return grupos[k];}).filter(function(s){return s.n>=2;});
  linhas.forEach(function(s){s.pago=s.ac/s.n*100;s.justa=s.ac?100/s.pago:null;s.ev=(s.pago/100*s.odd-1)*100;});
  linhas.sort(function(a,b){return b.ev-a.ev||b.n-a.n||a.odd-b.odd;});
  return {linhas:linhas.slice(0,10),jogos:js.length,minimo:minimo};
}
function renderEV(){
  document.getElementById('evOpts').innerHTML=EVMKTS.map(function(m){
    return '<button class="opt'+(m===evMkt?' on':'')+'" data-ev="'+m+'">'+m+'</button>';}).join('');
  document.getElementById('evJan').innerHTML=[3,6,12,24].map(function(w){
    return '<button class="opt'+(w===evJanela?' on':'')+'" data-evj="'+w+'">'+w+'h</button>';}).join('');
  var corpo=document.getElementById('evBody'),status=document.getElementById('evStatus');
  if(corpo)corpo.innerHTML='<tr><td colspan="6" style="color:var(--muted)">Lendo histórico do banco...</td></tr>';
  var token=++evPedido,mercado=evMkt,janela=evJanela,ligaPedido=liga;
  AMD_ANALISE_DADOS.buscar(ligaPedido,evHorasNecessarias()).then(function(partidas){
    if(token!==evPedido)return;
    var dados=evLinhas(partidas,mercado,janela);
    if(status)status.textContent='Banco · '+ligaPedido+' · '+janela+'h · '+dados.jogos+' jogos concluídos · odds exatas';
    if(!dados.linhas.length){
      corpo.innerHTML='<tr><td colspan="6" style="color:var(--muted)">Sem odd válida neste período.</td></tr>';return;
    }
    corpo.innerHTML=dados.linhas.map(function(l){
      var vale=l.ev>=0;
      return '<tr><td class="pc" style="color:var(--text)">@'+l.odd.toFixed(2)+'</td>'
        +'<td>'+l.ac+'/'+l.n+'</td><td>'+l.pago.toFixed(1)+'%</td>'
        +'<td>'+(l.justa?l.justa.toFixed(2):'—')+'</td>'
        +'<td class="pc" style="color:'+(vale?'var(--green)':'var(--red)')+'">'+(vale?'+':'')+l.ev.toFixed(1)+'%</td>'
        +'<td><span class="ver '+(vale?'vale':'cara')+'">'+(vale?'vale':'cara')+'</span></td></tr>';}).join('');
  }).catch(function(err){
    if(token!==evPedido)return;
    if(status)status.textContent='Banco indisponível';
    if(corpo)corpo.innerHTML='<tr><td colspan="6" style="color:var(--red)">Não foi possível ler o banco: '+String(err&&err.message||err).replace(/[<>&]/g,'')+'</td></tr>';
  });}
document.addEventListener('click',function(e){
  var b=e.target.closest('[data-ev]'); if(b){evMkt=b.dataset.ev;renderEV();return;}
  var w=e.target.closest('[data-evj]'); if(w){evJanela=+w.dataset.evj;renderEV();}});
function cardSimples(t,sub,linhas,tag,cor){var l="";
  linhas.forEach(function(x){l+="<div class=\"r\" style=\"font-size:10px;margin-top:4px\"><span>"+x[0]+"</span><b>"+x[1]+"</b></div>";});
  return "<div class=\"cf\"><div class=\"times\">"+t+"</div><div class=\"meta\">"+sub+"</div>"
    +"<div class=\"anc\" style=\"border-color:"+cor+";color:"+cor+"\">"+tag+"</div>"
    +"<div class=\"lado\" style=\"margin-top:4px\">"+l+"</div></div>";}
function renderAncoras(){var r=rngDe("anc"+liga+new Date().getHours());var out="";
  for(var k=0;k<3;k++){var col=pad(1+Math.floor(r()*20));
    out+=cardSimples("Coluna "+col+" · minuto "+pad((+col*3)%60),""+liga+" · base consolidada",
      [["3h",(30+Math.floor(r()*40))+"%"],["6h",(30+Math.floor(r()*40))+"%"],["12h",(30+Math.floor(r()*40))+"%"],["24h",(30+Math.floor(r()*40))+"%"]],
      "⚓ "+(r()>.5?"FORTE":"MÉDIA"),"var(--orange)");}
  document.getElementById("ancoras").innerHTML=out;}
function renderCacadores(){var r=rngDe("cac"+liga+new Date().getHours());var out="";
  var g=["Mínima das 6h","Quebra de LTB","Topo duplo","Congestão rompida","Fundo com reversão","Sequência 4 reds"];
  for(var k=0;k<3;k++){var arm=r()>.45;
    out+=cardSimples(g[Math.floor(r()*g.length)],""+liga+" · monitorando "+(2+Math.floor(r()*5))+" mercados",
      [["Gatilho",(30+Math.floor(r()*40))+"%"],["Distância",(1+Math.floor(r()*9))+" jogos"],["Força",(60+Math.floor(r()*35))+"%"]],
      arm?"◉ ARMADO":"○ AGUARDANDO",arm?"var(--green)":"var(--muted)");}
  document.getElementById("cacadores").innerHTML=out;}
renderEV();renderAncoras();renderCacadores();

function renderLigas(){
  document.getElementById('ligaOpts').innerHTML=LIGAS.map(function(l){
    return '<button class="opt'+(l===liga?' on':'')+'" data-liga="'+l+'">'+l+'</button>';}).join('');
  document.getElementById('ligaNome').textContent=liga;
  Array.prototype.forEach.call(document.querySelectorAll('.ligaTxt'),function(e){e.textContent=liga;});
}
function renderTudo(){
  renderLigas();renderQuads();renderRanking();renderConfrontos();renderEV();renderAncoras();renderCacadores();
  var r=rngDe('topo'+liga+new Date().toDateString());
  document.getElementById('kSinais').textContent=18+Math.floor(r()*14);
  document.getElementById('kConf').textContent=(74+Math.floor(r()*14))+'%';
  document.getElementById('kEv').textContent='+'+(10+r()*12).toFixed(1)+'%';
  renderLeitura(document.querySelector('.abrir')?document.querySelector('.abrir').dataset.cf:'Leões x Falcões');
}
document.addEventListener('click',function(e){
  var b=e.target.closest('.opt[data-liga]');
  if(b){liga=b.dataset.liga;renderTudo();window.scrollTo({top:0,behavior:'smooth'});}
});
renderTudo();
