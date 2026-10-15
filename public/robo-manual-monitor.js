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
    'Casa FT':'odd_resultado_final_casa','Empate FT':'odd_resultado_final_empate','Fora FT':'odd_resultado_final_fora'
  };
  var style=document.createElement('style');style.textContent='.manual-live-entry{position:fixed;right:20px;top:76px;z-index:2147482000;display:flex;flex-direction:column;gap:5px;max-width:480px;padding:16px 18px;border:2px solid #00f278;border-radius:12px;background:#031b14;color:#fff;box-shadow:0 0 30px rgba(0,242,120,.35);font-family:Inter,system-ui,sans-serif}.manual-live-entry b{color:#00f278;font-size:15px}.manual-live-entry span{color:#b9d9cf;font-size:13px}';document.head.appendChild(style);
  function read(key) { try { var value=JSON.parse(localStorage.getItem(key)||'[]'); return Array.isArray(value)?value:[]; } catch (_) { return []; } }
  function robotLeagues(robot) {
    var values=robot&&Array.isArray(robot.leagues)&&robot.leagues.length?robot.leagues:[robot&&robot.league||'copa'];
    var seen={};return values.map(function(value){return String(value||'').toLowerCase();})
      .filter(function(value){if(['copa','euro','super','premier'].indexOf(value)<0||seen[value])return false;seen[value]=true;return true;});
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
    return true;
  }
  function matchingRow(robot, completed) {
    var rows={};(robot.pattern||[]).forEach(function(p){(rows[p.row]||(rows[p.row]=[])).push(p);});
    var ids=Object.keys(rows);
    for(var i=0;i<ids.length;i++){
      var cells=rows[ids[i]].sort(function(a,b){return a.column-b.column;});
      var entry=cells.find(function(p){return p.markType==='entry';});
      var patterns=cells.filter(function(p){return p.markType!=='entry'&&(!entry||p.column<entry.column);});
      if(!entry||!patterns.length)continue;
      var ok=patterns.every(function(p){var distance=entry.column-p.column-1;return distance>=0&&positionMatches(p,completed[distance]);});
      if(ok)return {row:Number(ids[i]),entry:entry,trigger:completed[0]};
    }
    return null;
  }
  function eligibleMatch(robot, all) {
    var completed=all.filter(function(g){return g.resultado_ft;})
      .sort(function(a,b){return orderValue(b)-orderValue(a);});
    if(!completed.length)return null;
    var match=matchingRow(robot,completed);if(!match)return null;
    var activated=Date.parse(robot.activatedAt||robot.updatedAt||'')||0;
    return timeValue(match.trigger)>activated?match:null;
  }
  function hasOpenCycle(signals, robotId, league) {
    return signals.some(function(signal){
      return signal.status==='PENDENTE'&&String(signal.robotId||'')===String(robotId||'')&&
        String(signal.league||'copa')===String(league||'copa');
    });
  }
  function pendingAfter(all, previous, nowValue) {
    var previousTime=slotValue(previous),nowTime=Number(nowValue)||Date.now();
    return all.filter(function(game){var slot=slotValue(game);return !game.resultado_ft&&slot>previousTime&&slot>nowTime;})
      .sort(function(a,b){return slotValue(a)-slotValue(b);});
  }
  function nextGame(all, trigger, nowValue) {
    var pending=pendingAfter(all,trigger,nowValue);
    /* pending[0] e o jogo corrente. Sem uma segunda linha, aguarde a proxima
       atualizacao em vez de enviar uma entrada no fim da partida. */
    return pending.length>1?pending[1]:null;
  }
  function slotValue(game) { return Date.parse(game&&game.slot_em||game&&game.criado_em||'')||0; }
  function nextShotGame(all, previous) {
    var previousTime=slotValue(previous);
    var after=all.filter(function(game){return !sameTarget({
      gameId:previous&&previous.id,timeA:previous&&previous.time_a,timeB:previous&&previous.time_b,
      gameSlot:previous&&previous.slot_em||previous&&previous.criado_em||''
    },game)&&slotValue(game)>previousTime;})
      .sort(function(a,b){return slotValue(a)-slotValue(b);});
    var pending=after.filter(function(game){return !game.resultado_ft;});
    if(pending.length>1)return pending[1];
    /* Mantem a conciliacao de ciclos antigos que ja possuem resultados. */
    return after.filter(function(game){return !!game.resultado_ft;})[0]||null;
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
    var changed=false,followUps=[];
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
        if(paid){signal.status='GREEN';signal.winningShot=current;signal.resolvedAt=new Date().toISOString();break;}
        if(current>=maximum){signal.status='RED';signal.resolvedAt=new Date().toISOString();break;}
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
  async function notify(title,body,key) {
    panelToast(title,body);
    try{window.dispatchEvent(new CustomEvent('amd:manual-entry',{detail:{title:title,body:body,key:key,at:new Date().toISOString()}}));}catch(_){}
    if(!('Notification' in root)||Notification.permission!=='granted')return;
    var options={body:body,tag:'amd-manual-'+key,renotify:true,requireInteraction:true,data:{url:'/robos.html'}};
    try{if('serviceWorker' in navigator){var reg=await navigator.serviceWorker.register('/sw-alertas.js');await reg.showNotification(title,options);return;}new Notification(title,options);}catch(_){}
  }
  async function tick() {
    if(running||!await isLeader())return;running=true;
    try{
      var robots=read(ROBOTS_KEY).filter(function(r){return r.active&&Array.isArray(r.pattern);});
      var sent=read(SENT_KEY),sentSet={};sent.forEach(function(k){sentSet[k]=true;});
      var signals=read(SIGNALS_KEY);
      var leagues={};robots.forEach(function(r){robotLeagues(r).forEach(function(league){leagues[league]=true;});});
      signals.forEach(function(signal){if(signal.status==='PENDENTE')leagues[signal.league||'copa']=true;});
      var data={};await Promise.all(Object.keys(leagues).map(async function(league){
        if(root.AMDGradeTabs&&typeof root.AMDGradeTabs.request==='function'){
          var shared=await root.AMDGradeTabs.request({liga:league,horas:6,compacto:true,maxAgeMs:7000});
          data[league]=(shared&&shared.partidas)||[];return;
        }
        var response=await fetch('/api/grade?liga='+encodeURIComponent(league)+'&horas=6&compacto=1&_='+Date.now(),{cache:'no-store',credentials:'same-origin'});
        if(response.ok)data[league]=(await response.json()).partidas||[];
      }));
      var followUps=reconcileSignals(signals,data);
      for(var fi=0;fi<followUps.length;fi++){
        var follow=followUps[fi],followSignal=follow.signal;
        var followHour=gameHour({hora:followSignal.gameHour,minuto:followSignal.gameMinute,slot_em:followSignal.gameSlot});
        var followBody=String(followSignal.league||'copa').toUpperCase()+' · '+followSignal.market+' · '+
          followSignal.timeA+' x '+followSignal.timeB+' · TIRO '+follow.shot+'/'+Math.max(1,Number(followSignal.shots||1))+' · jogo '+followHour;
        await notify('🤖 '+(followSignal.robotName||'Robô manual')+' · PRÓXIMO TIRO',followBody,followSignal.key+'-tiro-'+follow.shot);
      }
      for(var i=0;i<robots.length;i++){
        var robot=robots[i],robotLeagueList=robotLeagues(robot);
          for(var li=0;li<robotLeagueList.length;li++){
            var robotLeague=robotLeagueList[li],all=data[robotLeague]||[];
            /* Um robo e uma liga formam um unico ciclo. Os tiros seguintes
               pertencem a essa mesma entrada; nunca abra outro sinal enquanto
               o ciclo atual ainda estiver aguardando resultado. */
            if(hasOpenCycle(signals,robot.id,robotLeague))continue;
            var match=eligibleMatch(robot,all);if(!match)continue;
          var upcoming=nextGame(all,match.trigger);if(!upcoming)continue;
          var key=[robot.id,robotLeague,match.row,gameKey(match.trigger),upcoming.id||upcoming.slot_em].join('|');if(sentSet[key])continue;
          sentSet[key]=true;sent.unshift(key);sent=sent.slice(0,500);localStorage.setItem(SENT_KEY,JSON.stringify(sent));
          var market=match.entry.entryMarket||robot.entryMarket||match.entry.market||'Entrada';var maximum=Math.max(1,Number(robot.shots||1));
          var entryHour=gameHour(upcoming);
          var body=robotLeague.toUpperCase()+' · '+market+' · '+(upcoming.time_a||'?')+' x '+(upcoming.time_b||'?')+' · TIRO 1/'+maximum+' · jogo '+entryHour;
          saveSignal({id:key,key:key,robotId:robot.id,robotName:robot.name||'Robô manual',league:robotLeague,market:market,shots:maximum,currentShot:1,attempts:[],cycleVersion:2,timeA:upcoming.time_a||'?',timeB:upcoming.time_b||'?',gameId:upcoming.id||'',gameSlot:upcoming.slot_em||upcoming.criado_em||'',gameHour:upcoming.hora,gameMinute:upcoming.minuto,status:'PENDENTE',sentAt:new Date().toISOString(),score:''});
          await notify('🤖 '+(robot.name||'Robô manual')+' · ENTRADA',body,key);
        }
      }
    }catch(_){}finally{running=false;}
  }
  async function enable() {
    if(!('Notification' in root))return 'unsupported';
    if(Notification.permission==='default')return Notification.requestPermission();
    return Notification.permission;
  }
  root.AMDManualMonitor={tick:tick,enable:enable,robotLeagues:robotLeagues,marketMatches:marketMatches,positionMatches:positionMatches,matchingRow:matchingRow,eligibleMatch:eligibleMatch,nextGame:nextGame,nextShotGame:nextShotGame,reconcileSignals:reconcileSignals,hasOpenCycle:hasOpenCycle,gameHour:gameHour,isLeader:isLeader};
  root.addEventListener('pagehide',releaseLeadership);
  timer=setInterval(tick,15000);setTimeout(tick,1500);
})(window);
