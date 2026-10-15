(function(){
  'use strict';
  var LIGAS=[['copa','Copa'],['euro','Euro'],['super','Super'],['premier','Premier']];
  var grade=document.getElementById('grade'), estado=document.getElementById('estado');
  var mercado=document.getElementById('mercado'), janela=document.getElementById('janela');
  var cache={};
  function esc(s){return String(s).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];});}
  function pago(j,m){
    var a=Number(j.gols_a),b=Number(j.gols_b); if(!Number.isFinite(a)||!Number.isFinite(b))return null;
    var t=a+b;
    if(m==='Over 0.5')return t>=1;if(m==='Over 1.5')return t>=2;if(m==='Over 2.5')return t>=3;if(m==='Over 3.5')return t>=4;
    if(m==='5+ Gols')return t>=5;if(m==='Under 1.5')return t<2;if(m==='Under 2.5')return t<3;if(m==='Under 3.5')return t<4;
    if(m==='Ambas Marcam (Sim)')return a>0&&b>0;if(m==='Ambas Marcam (Não)')return !(a>0&&b>0);return false;
  }
  function serie(lista,m,n){
    var res=lista.filter(function(j){return pago(j,m)!==null;}).slice(-Math.max(n*2,n));
    return res.map(function(_,i){var ini=Math.max(0,i-n+1),fat=res.slice(ini,i+1),ok=0;fat.forEach(function(j){if(pago(j,m))ok++;});return +(ok/fat.length*100).toFixed(1);}).slice(-n);
  }
  function svg(valores,id){
    if(!valores.length)return '<div class="vazio">Aguardando jogos resolvidos</div>';
    var W=720,H=245,p=28,min=Math.max(0,Math.min.apply(null,valores)-8),max=Math.min(100,Math.max.apply(null,valores)+8);if(max-min<15){max=Math.min(100,max+8);min=Math.max(0,min-8);}
    function x(i){return p+i*(W-p*2)/Math.max(1,valores.length-1);}function y(v){return H-p-(v-min)*(H-p*2)/Math.max(1,max-min);}
    var pts=valores.map(function(v,i){return x(i).toFixed(1)+','+y(v).toFixed(1);}).join(' '), linhas='';
    for(var k=0;k<4;k++){var yy=p+k*(H-p*2)/3,rv=max-k*(max-min)/3;linhas+='<line class="eixo" x1="'+p+'" y1="'+yy+'" x2="'+(W-p)+'" y2="'+yy+'"/><text class="rotulo" x="2" y="'+(yy+3)+'">'+rv.toFixed(0)+'%</text>';}
    return '<svg class="graf" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none"><defs><linearGradient id="area'+id+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#00ef64" stop-opacity=".28"/><stop offset="1" stop-color="#00ef64" stop-opacity="0"/></linearGradient></defs>'+linhas+'<polygon fill="url(#area'+id+')" points="'+p+','+(H-p)+' '+pts+' '+(W-p)+','+(H-p)+'"/><polyline class="linha" points="'+pts+'"/><circle class="ponto" cx="'+x(valores.length-1)+'" cy="'+y(valores[valores.length-1])+'" r="4"/></svg>';
  }
  function desenhar(){
    var m=mercado.value,n=Number(janela.value);grade.innerHTML=LIGAS.map(function(l,i){var jogos=cache[l[0]]||[],s=serie(jogos,m,n),v=s.length?s[s.length-1].toFixed(1)+'%':'—';return '<section class="painel"><div class="cab"><h2>'+esc(l[1])+'</h2><b class="pct">'+v+'</b><span class="info">'+jogos.length+' jogos · '+esc(m)+'</span></div>'+svg(s,i)+'</section>';}).join('');
  }
  async function carregar(){
    estado.textContent='Atualizando as quatro ligas…';
    var falhas=0;await Promise.all(LIGAS.map(async function(l){try{var r=await fetch('/api/grade?liga='+encodeURIComponent(l[0])+'&horas=24&compacto=1',{cache:'no-store'});if(!r.ok)throw new Error();var d=await r.json();cache[l[0]]=Array.isArray(d.partidas)?d.partidas:[];}catch(e){falhas++;}}));
    desenhar();estado.textContent=falhas?'Atualizado com '+falhas+' liga(s) indisponível(is)':'Atualizado agora';
  }
  mercado.addEventListener('change',desenhar);janela.addEventListener('change',desenhar);document.getElementById('atualizar').addEventListener('click',carregar);
  carregar();setInterval(carregar,45000);
})();
