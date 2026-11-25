(function (root) {
  'use strict';
  var ROBOTS_KEY = 'amd:robos-manuais:v2';
  var SENT_KEY = 'amd:robos-manuais-enviados:v1';
  var SIGNALS_KEY = 'amd:robos-manuais-sinais:v2';
  var LEADER_KEY = 'amd:robo-manual-monitor-lider:v1';
  var LEADER_LOCK = 'amd-robo-manual-monitor-eleicao';
  var LEADER_VERSION = 2;
  var LEASE_MS = 20000;
  /* A grade contem uma linha sem FT para a partida em andamento, seguida dos
     jogos realmente futuros. O monitor deve pular essa linha corrente. */
  var TAB_ID = root.crypto&&root.crypto.randomUUID?root.crypto.randomUUID():String(Date.now())+'-'+Math.random().toString(36).slice(2);
  var running = false;
  var timer = null;
  var ODD_KEYS = {
    'Over 0.5':'odd_over_0.5','Over 1.5':'odd_over_1.5','Over 2.5':'odd_over_2.5','Over 3.5':'odd_over_3.5',
    'Under 0.5':'odd_under_0.5','Under 1.5':'odd_under_1.5','Under 2.5':'odd_under_2.5','Under 3.5':'odd_under_3.5',
    'Ambas Marcam (Sim)':'odd_ambas_sim','Ambas Marcam (Não)':'odd_ambas_nao',
    '5+ Gols':'odd_total_gols_extatos_5','Casa FT':'odd_resultado_final_casa','Empate FT':'odd_resultado_final_empate','Fora FT':'odd_resultado_final_fora'
  };
  var style=document.createElement('style');style.textContent='.manual-live-entry{position:fixed;right:20px;top:76px;z-index:2147482000;display:flex;flex-direction:column;gap:5px;max-width:480px;padding:16px 18px;border:2px solid #00f278;border-radius:12px;background:#031b14;color:#fff;box-shadow:0 0 30px rgba(0,242,120,.35);font-family:Inter,system-ui,sans-serif}.manual-live-entry b{color:#00f278;font-size:15px}.manual-live-entry span{color:#b9d9cf;font-size:13px}';document.head.appendChild(style);
  function read(key) { try { var value=JSON.parse(localStorage.getItem(key)||'[]'); return Array.isArray(value)?value:[]; } catch (_) { return []; } }
  function robotLeagues(robot) {
    var values=robot&&Array.isArray(robot.leagues)&&robot.leagues.length?robot.leagues:[robot&&robot.league||'copa'];
    var seen={};return values.map(function(value){return String(value||'').toLowerCase();})
      .filter(function(value){if(['eng','ita','spa','mnd','bra','lat','cam','cop','ame'].indexOf(value)<0||seen[value])return false;seen[value]=true;return true;});
  }
  function claimLeadership() {
    try {
      var now=Date.now(),current=JSON.parse(localStorage.getItem(LEADER_KEY)||'null');
      if(current&&Number(current.version)===LEADER_VERSION&&current.id!==TAB_ID&&Number(current.expires)>now)return false;
      localStorage.setItem(LEADER_KEY,JSON.stringify({id:TAB_ID,version:LEADER_VERSION,expires:now+LEASE_MS}));
      current=JSON.parse(localStorage.getItem(LEADER_KEY)||'null');
      return !!current&&Number(current.version)===LEADER_VERSION&&current.id===TAB_ID;
    }catch(_){return true;}
  }
  async function isLeader() {
    if(root.navigator&&root.navigator.locks&&root.navigator.locks.request){
      try{return await root.navigator.locks.request(LEADER_LOCK,{mode:'exclusive'},claimLeadership);}catch(_){}
    }
    return claimLeadership();
  }
  function releaseLeadership() {
    try{var current=JSON.parse(localStorage.getItem(LEADER_KEY)||'null');if(current&&current.id===TAB_ID)localStorage.removeItem(LEADER_KEY);}catch(_){}
  }
  function normalized(value) { return String(value||'').trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,''); }
  function timeValue(game) { return Date.parse(game.resultado_em||game.visto_em||game.slot_em||game.criado_em||'')||0; }
  function orderValue(game) { return Date.parse(game.slot_em||game.criado_em||game.resultado_em||game.visto_em||'')||0; }
  function gameKey(game) { return [game.liga||'',game.id||'',game.resultado_em||game.visto_em||''].join('|'); }
  function resultOf(game) { var a=Number(game.gols_a),b=Number(game.gols_b); return a>b?'home':a<b?'away':'draw'; }
  function scorePair(value) {
    var match=String(value||'').match(/(\d+)\s*-\s*(\d+)/);
    return match?[Number(match[1]),Number(match[2])]:[0,0];
  }
  function marketMatches(market,game) {
    if(!game||!game.resultado_ft)return false;
    var name=String(market||'').trim(),a=Number(game.gols_a),b=Number(game.gols_b);
    if(!Number.isFinite(a)||!Number.isFinite(b))return false;
    var total=a+b,half=scorePair(game.resultado_ht),second=total-half[0]-half[1];
    var home=a>b,away=b>a,draw=a===b,both=a>0&&b>0,match;
    switch(name){
      case 'Qualquer resultado':return true;
      case 'Over 0.5':return total>=1;case 'Over 1.5':return total>=2;
      case 'Over 2.5':return total>=3;case 'Over 3.5':return total>=4;
      case 'Under 0.5':return total<1;case 'Under 1.5':return total<2;
      case 'Under 2.5':return total<3;case 'Under 3.5':return total<4;
      case 'OUT HT':return String(game.resultado_ht||'').trim().toUpperCase()==='OUT'||half[0]+half[1]>=3;
      case 'Total Gols (FT)':return total>=3;case 'Gols Casa (FT)':return a>=2;
      case 'Gols Fora (FT)':return b>=2;
      case 'Ambas Marcam (Sim)':return both;case 'Ambas Marcam (Não)':return !both;
      case 'Casa FT':return home;case 'Empate FT':return draw;case 'Fora FT':return away;
      case 'Casa/Fora e Sim':return !draw&&both;case 'Casa e Sim':return home&&both;
      case 'Casa e Não':return home&&!both;case 'Fora e Sim':return away&&both;
      case 'Fora e Não':return away&&!both;case 'Empate e Sim':return draw&&both;
      case 'Empate e Não':return draw&&!both;case '5+ Gols':return total>=5;
    }
    match=name.match(/^(\d) gols? \/ 2º tempo$/i);if(match)return second===Number(match[1]);
    match=name.match(/^(\d) Gols?$/);if(match)return total===Number(match[1]);
    match=name.match(/^Casa (\d) Gols?$/);if(match)return a===Number(match[1]);
    match=name.match(/^Fora (\d) Gols?$/);if(match)return b===Number(match[1]);
    match=name.match(/^(Casa|Empate|Visitante|Qualquer) (\d)-(\d)$/);
    if(match){
      var x=Number(match[2]),y=Number(match[3]);
      if(match[1]==='Qualquer')return (a===x&&b===y)||(a===y&&b===x);
      return a===x&&b===y;
    }
    return false;
  }
  function minuteMatches(position, minute) {
    var value=Number(minute),from=Number(position.minuteFrom),to=Number(position.minuteTo);
    if(position.minuteOp==='from')return value>=from;if(position.minuteOp==='until')return value<=from;
    if(position.minuteOp==='between')return value>=from&&value<=to;return value===from;
  }
  function hasMinuteRule(position) {
    if(position.minuteConfigured===false||position.minuteOp==='any'||position.minuteFrom===''||position.minuteFrom==null)return false;
    if(position.minuteConfigured==null&&(position.minuteOp||'equal')==='equal'&&String(position.minuteFrom)==='15'&&String(position.minuteTo==null?'30':position.minuteTo)==='30')return false;
    return true;
  }
  function positionMatches(position, game) {
    if(!game||!game.resultado_ft)return false;
    var a=Number(game.gols_a),b=Number(game.gols_b),names=[normalized(game.time_a),normalized(game.time_b)];
    if(position.teamA&&names.indexOf(normalized(position.teamA))<0)return false;
    if(position.teamB&&names.indexOf(normalized(position.teamB))<0)return false;
    if(position.teamOrder==='fixed'&&position.teamA&&normalized(game.time_a)!==normalized(position.teamA))return false;
    if(position.scoreResult&&resultOf(game)!==position.scoreResult)return false;
    if(position.scoreA!==''&&position.scoreA!=null&&a!==Number(position.scoreA))return false;
    if(position.scoreB!==''&&position.scoreB!=null&&b!==Number(position.scoreB))return false;
    if(position.market&&!marketMatches(position.market,game))return false;
    if(hasMinuteRule(position)&&!minuteMatches(position,game.minuto))return false;
    if(position.odd){var key=ODD_KEYS[position.market],odd=key&&game.odds&&Number(game.odds[key]);if(!odd||odd.toFixed(2)!==Number(position.odd).toFixed(2))return false;}
    var oMin=Number(position.oddMin)||0,oMax=Number(position.oddMax)||0;
    if(oMin||oMax){var k2=ODD_KEYS[position.oddMarket||position.market],o2=k2&&game.odds&&Number(game.odds[k2]);if(!o2)return false;if(oMin&&o2<oMin)return false;if(oMax&&o2>oMax)return false;}
    return true;
  }
  /* Avisa assim que o padrao fecha: o gatilho e o ultimo jogo do padrao e a
     entrada fica "skip" jogos depois dele (os pulos montados no quadro).
     Assim um +1 sai com 1 jogo de antecedencia, um +6 com 6. */
  function matchingRow(robot, completed) {
    var rows={};(robot.pattern||[]).forEach(function(p){(rows[p.row]||(rows[p.row]=[])).push(p);});
    var ids=Object.keys(rows);
    for(var i=0;i<ids.length;i++){
      var cells=rows[ids[i]].sort(function(a,b){return a.column-b.column;});
      var entry=cells.find(function(p){return p.markType==='entry';});
      var patterns=cells.filter(function(p){return p.markType!=='entry'&&(!entry||p.column<entry.column);});
      if(!entry||!patterns.length)continue;
      var lastCol=Math.max.apply(null,patterns.map(function(p){return p.column;})),d=entry.column-lastCol-1;
      for(var k=0;k<=d;k++){
        var ok=patterns.every(function(p){return positionMatches(p,completed[k+lastCol-p.column]);});
        if(ok)return {row:Number(ids[i]),entry:entry,trigger:completed[k],skip:d};
      }
    }
    return null;
  }
  /* A grade marca o horario de Brasilia como se fosse UTC (3h atras do
     relogio real). Detecta isso pelos proprios jogos e corrige o "agora". */
  function clockShift(all){
    var max=0;(all||[]).forEach(function(g){var t=Date.parse(g&&g.slot_em||g&&g.criado_em||'')||0;if(t>max)max=t;});
    return max&&Date.now()-max>90*60000?3*3600000:0;
  }
  function eligibleMatch(robot, all) {
    var completed=all.filter(function(g){return g.resultado_ft;})
      .sort(function(a,b){return orderValue(b)-orderValue(a);});
    if(!completed.length)return null;
    var match=matchingRow(robot,completed);if(!match)return null;
    var activated=(Date.parse(robot.activatedAt||robot.updatedAt||'')||0)-clockShift(all);
    return timeValue(match.trigger)>activated?match:null;
  }
  /* Metricas que somam pontos: calculadas na linha (% de acerto em janela de 20)
     do mercado da entrada, com os jogos reais da liga. */
  var COMPANION={'Over 0.5':'Over 1.5','Over 1.5':'Ambas Marcam (Sim)','Over 2.5':'Over 1.5','Over 3.5':'Over 2.5','Ambas Marcam (Sim)':'Over 2.5','Under 2.5':'Under 3.5','Under 1.5':'Under 2.5','Under 3.5':'Under 2.5'};
  /* Mesma linha do grafico do site: % acumulada do mercado desde 00h
     (horario de Brasilia, que a grade grava como UTC). */
  function lineSeries(all,market){
    var done=all.filter(function(g){return g.resultado_ft;}).sort(function(a,b){return orderValue(a)-orderValue(b);});
    if(!done.length)return {line:[],hits:[]};
    var last=new Date(orderValue(done[done.length-1])),dia=Date.UTC(last.getUTCFullYear(),last.getUTCMonth(),last.getUTCDate());
    var hoje=done.filter(function(g){return orderValue(g)>=dia;});
    var hits=hoje.map(function(g){return marketMatches(market,g)?1:0;}),out=[],sum=0;
    for(var i=0;i<hits.length;i++){sum+=hits[i];out.push(sum/(i+1)*100);}
    return {line:out,hits:hits};
  }
  /* Grafico em janela movel de X horas (igual ao Raio-X). */
  function windowLine(all,market,hours){
    var done=all.filter(function(g){return g.resultado_ft;}).sort(function(a,b){return orderValue(a)-orderValue(b);});
    var hits=done.map(function(g){return marketMatches(market,g)?1:0;}),ts=done.map(orderValue),W=hours*3600000,s=0,j=0;
    return hits.map(function(x,i){s+=x;while(ts[j]<=ts[i]-W){s-=hits[j];j++;}return s/(i-j+1)*100;});
  }
  function lineUp(line){var n=line.length-1;if(n<25)return null;var a=sma(line,9),b=sma(line,21);return a[n]>b[n]&&a[n]>=a[n-1];}
  /* Coluna = mesmo minuto do relogio. Ruim = nenhum Over nos ultimos 3 jogos daquele minuto. */
  function columnBad(all,market,game){
    if(!game)return false;var mi=Number(game.minuto);
    var col=all.filter(function(g){return g.resultado_ft&&Number(g.minuto)===mi;}).sort(function(a,b){return orderValue(b)-orderValue(a);}).slice(0,3);
    return col.length>=3&&!col.some(function(g){return marketMatches(market,g);});
  }
  /* Time frio = nenhum Over nos ultimos 3 jogos dele nesta liga. */
  function teamCold(all,market,team){
    if(!team)return false;var t=normalized(team);
    var js=all.filter(function(g){return g.resultado_ft&&(normalized(g.time_a)===t||normalized(g.time_b)===t);}).sort(function(a,b){return orderValue(b)-orderValue(a);}).slice(0,3);
    return js.length>=3&&!js.some(function(g){return marketMatches(market,g);});
  }
  function sma(arr,n){var out=[],s=0;for(var i=0;i<arr.length;i++){s+=arr[i];if(i>=n)s-=arr[i-n];out.push(i>=n-1?s/n:null);}return out;}
  function ema(arr,n){var k=2/(n+1),e=arr[0],res=[];for(var i=0;i<arr.length;i++){e=i?arr[i]*k+e*(1-k):arr[i];res.push(e);}return res;}
  function rising(line,back){var n=line.length;return n>back&&line[n-1]>line[n-1-back];}
  function metricState(robot,data,league,market){
    var s=lineSeries(data[league]||[],market),line=s.line,n=line.length;
    if(n<60)return null;
    var m9=sma(line,9),m21=sma(line,21),L=n-1;
    var e12=ema(line,12),e26=ema(line,26),gains=0,losses=0;
    for(var i=Math.max(1,n-14);i<n;i++){var d=line[i]-line[i-1];if(d>0)gains+=d;else losses-=d;}
    var rsi=gains+losses?100*gains/(gains+losses):50;
    /* subindo = media 9 acima da 21 (depois do Golden e antes do Death) e a 9 nao caindo */
    var up=m9[L]!=null&&m21[L]!=null&&m9[L]>m21[L]&&m9[L]>=m9[L-1];
    var others=false;
    Object.keys(data).forEach(function(other){if(other===league)return;var o=lineSeries(data[other]||[],market).line,k=o.length-1;if(k<25)return;var a9=sma(o,9),a21=sma(o,21);if(a9[k]<a21[k])others=true;});
    var comp=COMPANION[market]||'Over 2.5',cl=lineSeries(data[league]||[],comp).line,c9=sma(cl,9),c21=sma(cl,21),cL=cl.length-1;
    return {subida:up,media:line[L]>m21[L],macd:e12[L]-e26[L]>0,rsi:rsi>=45&&rsi<=70,ligas:up&&others,confirmacao:cL>=21&&c9[cL]>c21[cL],
      acimaM9:line[L]>=m9[L],linha:Math.round(line[L]*10)/10,m9:Math.round(m9[L]*100)/100,mediaHist:Math.round(m21[L]*10)/10};
  }
  function metricsPass(robot,data,league,market,entryGame){
    var rules=(robot.metrics||[]).filter(function(r){return r.use;}),threshold=Number(robot.threshold);
    var st=metricState(robot,data,league,market);
    if(!st)return {ok:false,pct:0,text:'madrugada: menos de 60 jogos no dia, gráfico 00h ainda engana'};
    /* Trava obrigatoria para todo robo: nunca entra com o grafico do mercado da
       entrada caindo (ex.: Over caindo = Under subindo). */
    if(!st.subida)return {ok:false,pct:0,text:'gráfico de '+market+' caindo ('+st.linha+'% · MM21 '+st.mediaHist+'%)'};
    /* Linha abaixo da MM9 = virando para baixo agora, mesmo com a 9 ainda acima da 21. */
    if(!st.acimaM9)return {ok:false,pct:0,text:'linha abaixo da MM9 ('+st.linha+'% · MM9 '+st.m9+'%): virando'};
    /* As tres bases precisam subir juntas: 1h, 2h e 00h. */
    var u1=lineUp(windowLine(data[league]||[],market,1)),u2=lineUp(windowLine(data[league]||[],market,2));
    if(u1===false||u2===false)return {ok:false,pct:0,text:'bases discordam (1h '+(u1?'sobe':'cai')+' · 2h '+(u2?'sobe':'cai')+')'};
    /* Confere os jogos de TODOS os tiros (entryGame pode ser a lista dos tiros). */
    var tiros=Array.isArray(entryGame)?entryGame:(entryGame?[entryGame]:[]),nomes=['SG','G1','G2','G3','G4'];
    for(var ti=0;ti<tiros.length;ti++){
      var jg=tiros[ti],all=data[league]||[];
      if(columnBad(all,market,jg))return {ok:false,pct:0,text:nomes[ti]+' na coluna :'+String(jg.minuto).padStart(2,'0')+' ruim (0 de 3)'};
      if(teamCold(all,market,jg.time_a))return {ok:false,pct:0,text:nomes[ti]+' com '+jg.time_a+' frio (0 de 3)'};
      if(teamCold(all,market,jg.time_b))return {ok:false,pct:0,text:nomes[ti]+' com '+jg.time_b+' frio (0 de 3)'};
    }
    if(!rules.length||!threshold)return {ok:true,text:'1h, 2h e 00h subindo'};
    var max=0,pts=0,mandatoryFail=false;
    rules.forEach(function(r){max+=Number(r.weight)||0;var hit=!!st[r.key]===!!r.expected;if(hit)pts+=Number(r.weight)||0;else if(r.key==='subida'&&r.expected)mandatoryFail=true;});
    var pct=max?Math.round(pts/max*100):0;
    return {ok:!mandatoryFail&&pct>=threshold,pct:pct,text:'métricas '+pct+'/100 · gráfico '+st.linha+'% (MM21 '+st.mediaHist+'%)'};
  }
  function hasOpenCycle(signals, robotId, league) {
    return signals.some(function(signal){
      return signal.status==='PENDENTE'&&String(signal.robotId||'')===String(robotId||'')&&
        String(signal.league||'copa')===String(league||'copa');
    });
  }
  function pendingAfter(all, previous, nowValue) {
    var previousTime=slotValue(previous),nowTime=(Number(nowValue)||Date.now())-clockShift(all);
    return all.filter(function(game){var slot=slotValue(game);return !game.resultado_ft&&slot>previousTime&&slot>nowTime;})
      .sort(function(a,b){return slotValue(a)-slotValue(b);});
  }
  function nextGame(all, trigger, skip) {
    var t=slotValue(trigger);
    var after=all.filter(function(game){return slotValue(game)>t;}).sort(function(a,b){return slotValue(a)-slotValue(b);});
    var g=after[Math.max(0,Number(skip)||0)];
    return g&&!g.resultado_ft?g:null;
  }
  function slotValue(game) { return Date.parse(game&&game.slot_em||game&&game.criado_em||'')||0; }
  function nextShotGame(all, previous) {
    var previousTime=slotValue(previous);
    var after=all.filter(function(game){return !sameTarget({
      gameId:previous&&previous.id,timeA:previous&&previous.time_a,timeB:previous&&previous.time_b,
      gameSlot:previous&&previous.slot_em||previous&&previous.criado_em||''
    },game)&&slotValue(game)>previousTime;})
      .sort(function(a,b){return slotValue(a)-slotValue(b);});
    /* Tiros seguidos: o proximo tiro e sempre o jogo logo depois do anterior. */
    return after[0]||null;
  }
  function gameHour(game) {
    var hour=Number(game&&game.hora),minute=Number(game&&game.minuto);
    if(Number.isFinite(hour)&&Number.isFinite(minute))return String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0');
    var value=new Date(game&&game.slot_em||game&&game.criado_em||'');
    return isNaN(value.getTime())?'--:--':value.toISOString().slice(11,16);
  }
  function sameTarget(signal,game) {
    if(!signal||!game)return false;
    if(signal.gameId&&game.id&&String(signal.gameId)===String(game.id))return true;
    var sameTeams=normalized(signal.timeA)===normalized(game.time_a)&&normalized(signal.timeB)===normalized(game.time_b);
    if(!sameTeams)return false;
    var savedTime=Date.parse(signal.gameSlot||'')||0,currentTime=Date.parse(game.slot_em||game.criado_em||'')||0;
    return !savedTime||!currentTime||Math.abs(savedTime-currentTime)<120000;
  }
  function attemptRecord(number,game,status) {
    return {number:number,gameId:game.id||'',timeA:game.time_a||'?',timeB:game.time_b||'?',
      gameSlot:game.slot_em||game.criado_em||'',status:status,
      gameHour:gameHour(game),
      score:game.resultado_ft||((game.gols_a||0)+'-'+(game.gols_b||0)),resolvedAt:new Date().toISOString()};
  }
  function assignShot(signal,game,number) {
    signal.currentShot=number;signal.gameId=game.id||'';signal.gameSlot=game.slot_em||game.criado_em||'';
    signal.gameHour=game.hora;signal.gameMinute=game.minuto;
    signal.timeA=game.time_a||'?';signal.timeB=game.time_b||'?';signal.score='';signal.awaitingNext=false;
  }
  function reconcileSignals(signals,data) {
    var changed=false,followUps=[];followUps.resolved=[];
    signals.forEach(function(signal){
      var maximum=Math.max(1,Number(signal.shots||1)),all=data[signal.league||'copa']||[];
      if(signal.status!=='PENDENTE')return;
      signal.cycleVersion=2;signal.currentShot=Math.max(1,Number(signal.currentShot||1));
      signal.attempts=Array.isArray(signal.attempts)?signal.attempts:[];
      var guard=0;
      while(guard++<maximum+1&&signal.status==='PENDENTE'){
        var game;
        if(signal.awaitingNext){
          var last=signal.attempts[signal.attempts.length-1];
          var previous={id:last&&last.gameId,time_a:last&&last.timeA,time_b:last&&last.timeB,slot_em:last&&last.gameSlot};
          game=nextShotGame(all,previous);if(!game)break;
          assignShot(signal,game,signal.attempts.length+1);changed=true;
          if(!game.resultado_ft){followUps.push({signal:signal,shot:signal.currentShot});break;}
        }else{
          game=all.find(function(item){return item.resultado_ft&&sameTarget(signal,item);});
          if(!game)break;
        }
        var paid=marketMatches(signal.market,game),shotStatus=paid?'GREEN':'RED';
        var current=Number(signal.currentShot||signal.attempts.length+1);
        signal.attempts=signal.attempts.filter(function(item){return Number(item.number)!==current;});
        signal.attempts.push(attemptRecord(current,game,shotStatus));
        signal.attempts.sort(function(a,b){return Number(a.number)-Number(b.number);});
        signal.score=game.resultado_ft||((game.gols_a||0)+'-'+(game.gols_b||0));
        signal.lastResolvedGameSlot=game.slot_em||game.criado_em||'';changed=true;
        if(paid){signal.status='GREEN';signal.winningShot=current;signal.resolvedAt=new Date().toISOString();followUps.resolved.push(signal);break;}
        if(current>=maximum){signal.status='RED';signal.resolvedAt=new Date().toISOString();followUps.resolved.push(signal);break;}
        /* Trava entre tiros: depois de um red, se o grafico virou (9 abaixo da 21,
           9 caindo ou linha abaixo da MM9), cancela o resto da sequencia. */
        var vira=metricState({},data,signal.league||'copa',signal.market);
        if(vira&&(!vira.subida||!vira.acimaM9)){
          signal.status='ANULADO';signal.abortado=true;signal.motivoAborto=!vira.subida?'gráfico caindo':'linha abaixo da MM9';
          signal.resolvedAt=new Date().toISOString();followUps.resolved.push(signal);break;}
        var next=nextShotGame(all,game);
        if(!next){signal.awaitingNext=true;signal.currentShot=current+1;signal.gameId='';signal.gameSlot='';
          signal.timeA='?';signal.timeB='?';signal.score='';break;}
        assignShot(signal,next,current+1);
        if(!next.resultado_ft){followUps.push({signal:signal,shot:signal.currentShot});break;}
      }
    });
    if(changed){
      localStorage.setItem(SIGNALS_KEY,JSON.stringify(signals.slice(0,500)));
      try{root.dispatchEvent(new CustomEvent('amd:manual-status-changed'));}catch(_){}
    }
    return followUps;
  }
  function saveSignal(record) {
    var signals=read(SIGNALS_KEY);
    if(!signals.some(function(item){return item.key===record.key;}))signals.unshift(record);
    localStorage.setItem(SIGNALS_KEY,JSON.stringify(signals.slice(0,500)));
    try{root.dispatchEvent(new CustomEvent('amd:manual-status-changed'));}catch(_){}
  }
  function panelToast(title,body) {
    var box=document.createElement('div');box.className='manual-live-entry';box.setAttribute('role','alert');
    box.innerHTML='<b>'+title.replace(/[<>]/g,'')+'</b><span>'+body.replace(/[<>]/g,'')+'</span>';document.body.appendChild(box);
    setTimeout(function(){box.remove();},12000);
  }
  var tgQueue=Promise.resolve();
  function sendTelegram(text,canal){
    tgQueue=tgQueue.then(function(){return fetch('/api/telegram/enviar',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({texto:text,canal:canal||''})}).catch(function(){});});
    return tgQueue;
  }
  function robotById(id){return read(ROBOTS_KEY).find(function(r){return String(r.id)===String(id);})||{};}
  async function notify(title,body,key,destino) {
    destino=destino||'todos';
    var msg=title+'\n'+body.split(' · ').join('\n');
    /* O Telegram agora e enviado pelo servidor (funciona com o PC desligado). */
    void msg;
    if(destino==='telegram'){try{window.dispatchEvent(new CustomEvent('amd:manual-entry',{detail:{title:title,body:body,key:key,at:new Date().toISOString()}}));}catch(_){}return;}
    panelToast(title,body);
    try{window.dispatchEvent(new CustomEvent('amd:manual-entry',{detail:{title:title,body:body,key:key,at:new Date().toISOString()}}));}catch(_){}
    if(!('Notification' in root)||Notification.permission!=='granted')return;
    var options={body:body,tag:'amd-manual-'+key,renotify:true,requireInteraction:true,data:{url:'/robos.html'}};
    try{if('serviceWorker' in navigator){var reg=await navigator.serviceWorker.register('/sw-alertas.js');await reg.showNotification(title,options);return;}new Notification(title,options);}catch(_){}
  }
  var MONITOR_V='20261125-trava';
  var lastSync='';
  function pullRobots(){
    return fetch('/api/robos/lista?_='+Date.now(),{credentials:'same-origin',cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).then(function(j){
      var lista=j&&Array.isArray(j.robots)?j.robots:[];
      if(lista.length&&!read(ROBOTS_KEY).length){
        localStorage.setItem(ROBOTS_KEY,JSON.stringify(lista));
        try{root.dispatchEvent(new CustomEvent('amd:robos-sincronizados'));}catch(_){}
      }
    }).catch(function(){});
  }
  function syncRobots(){
    try{
      var robots=read(ROBOTS_KEY);
      /* Aparelho novo / lista vazia: puxa os robos do servidor em vez de apagar os de la. */
      if(!robots.length&&localStorage.getItem('amd:robos-vazio-ok')!=='1'){pullRobots();return;}
      var body=JSON.stringify({robots:robots,vazioOk:!robots.length});
      if(body===lastSync)return;
      fetch('/api/robos/sync',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:body})
        .then(function(r){if(r.ok)lastSync=body;}).catch(function(){});
    }catch(_){}
  }
  /* O servidor e o unico que decide as entradas (mesma regra, com metricas).
     O navegador so mostra no site e notifica o que o servidor registrou. */
  var STATE_KEY='amd:robos-manuais-vistos:v3';
  function readObj(key){try{var v=JSON.parse(localStorage.getItem(key)||'{}');return v&&typeof v==='object'?v:{};}catch(_){return {};}}
  async function tick() {
    syncRobots();
    if(running||!await isLeader())return;running=true;
    try{
      var r=await fetch('/api/robos/sinais?_='+Date.now(),{credentials:'same-origin',cache:'no-store'});
      if(!r.ok)return;
      var resp=await r.json(),sinais=resp.sinais||[];
      if(resp.v&&resp.v!==MONITOR_V){try{if(sessionStorage.getItem('amd:monitor-recarregou')!==resp.v){sessionStorage.setItem('amd:monitor-recarregou',resp.v);location.reload();return;}}catch(_){}}
      localStorage.setItem(SIGNALS_KEY,JSON.stringify(sinais));
      try{root.dispatchEvent(new CustomEvent('amd:manual-status-changed'));}catch(_){}
      var vistos=readObj(STATE_KEY),primeira=!Object.keys(vistos).length,novos={};
      for(var i=0;i<sinais.length;i++){
        var s=sinais[i],estado=s.status+'|'+(s.currentShot||1);novos[s.key]=estado;
        if(primeira||vistos[s.key]===estado||s.destino==='telegram'||String(s.destino||'').indexOf('canal:')===0)continue;
        var liga=String(s.league||'').toUpperCase(),max=Math.max(1,Number(s.shots||1));
        var titulo,corpo;
        if(s.status==='GREEN'){titulo='🟩 GREEN · '+(s.robotName||'Robô');corpo=liga+' · '+s.market+' · '+s.timeA+' x '+s.timeB+' · placar '+(s.score||'?');}
        else if(s.status==='RED'){titulo='🟥 RED · '+(s.robotName||'Robô');corpo=liga+' · '+s.market+' · '+s.timeA+' x '+s.timeB+' · placar '+(s.score||'?');}
        else{titulo='🤖 '+(s.robotName||'Robô')+(Number(s.currentShot||1)>1?' · PRÓXIMO TIRO':' · ENTRADA');corpo=liga+' · '+s.market+' · '+s.timeA+' x '+s.timeB+' · TIRO '+(s.currentShot||1)+'/'+max+' · jogo '+gameHour({hora:s.gameHour,minuto:s.gameMinute,slot_em:s.gameSlot});}
        await notify(titulo,corpo,s.key+'-'+estado,'site');
      }
      localStorage.setItem(STATE_KEY,JSON.stringify(novos));
    }catch(_){}finally{running=false;}
  }
  async function enable() {
    if(!('Notification' in root))return 'unsupported';
    if(Notification.permission==='default')return Notification.requestPermission();
    return Notification.permission;
  }
  root.AMDManualMonitor={teamCold:teamCold,columnBad:columnBad,clockShift:clockShift,metricsPass:metricsPass,gameKey:gameKey,tick:tick,enable:enable,robotLeagues:robotLeagues,marketMatches:marketMatches,positionMatches:positionMatches,matchingRow:matchingRow,eligibleMatch:eligibleMatch,nextGame:nextGame,nextShotGame:nextShotGame,reconcileSignals:reconcileSignals,hasOpenCycle:hasOpenCycle,gameHour:gameHour,isLeader:isLeader};
  root.addEventListener('pagehide',releaseLeadership);
  timer=setInterval(tick,15000);setTimeout(tick,1500);
})(window);
