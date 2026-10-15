(function(root,factory){'use strict';var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AuditoriaTimesModel=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
var MERCADOS=[
 {id:'over15',nome:'Over 1.5'},{id:'over25',nome:'Over 2.5'},{id:'over35',nome:'Over 3.5'},
 {id:'cincomais',nome:'5+ Gols'},{id:'ambas',nome:'Ambas Marcam'},
 {id:'under05',nome:'Under 0.5'},{id:'under15',nome:'Under 1.5'},{id:'under25',nome:'Under 2.5'},{id:'under35',nome:'Under 3.5'}
];
function n(v){var x=Number(v);return Number.isFinite(x)?x:null;}
function resolvido(j){return !!(j&&j.resultado_ft!=null&&j.resultado_ft!==''&&n(j.gols_a)!=null&&n(j.gols_b)!=null);}
function pagou(j,m){if(!resolvido(j))return false;var a=n(j.gols_a),b=n(j.gols_b),t=a+b;
 if(m==='over15')return t>=2;if(m==='over25')return t>=3;if(m==='over35')return t>=4;if(m==='cincomais')return t>=5;
 if(m==='ambas')return a>0&&b>0;if(m==='under05')return t<1;if(m==='under15')return t<2;if(m==='under25')return t<3;if(m==='under35')return t<4;return false;}
function tempo(j){var x=Date.parse(j.slot_em||j.criado_em||'');return Number.isFinite(x)?x:0;}
function chaveNome(v){return String(v||'').trim().toLocaleLowerCase('pt-BR');}
function nome(v){return String(v||'').trim();}
function ordenar(lista){return (lista||[]).filter(resolvido).slice().sort(function(a,b){return tempo(a)-tempo(b);});}
function taxa(lista,m){if(!lista.length)return 0;return lista.reduce(function(s,j){return s+(pagou(j,m)?1:0);},0)/lista.length;}
function taxaJanela(lista,m,tiros){var total=0,hits=0;for(var i=0;i+tiros<=lista.length;i++){total++;for(var k=0;k<tiros;k++){if(pagou(lista[i+k],m)){hits++;break;}}}return total?hits/total:0;}
function proximoIndice(lista,t){var lo=0,hi=lista.length;while(lo<hi){var mid=(lo+hi)>>1;if(tempo(lista[mid])<=t)lo=mid+1;else hi=mid;}return lo;}
function inferiorWilson(p,total){var z=1.645,totalOk=Math.max(1,total),den=1+z*z/totalOk,centro=p+z*z/(2*totalOk),margem=z*Math.sqrt(p*(1-p)/totalOk+z*z/(4*totalOk*totalOk));return Math.max(0,(centro-margem)/den);}
function times(lista){var mapa=Object.create(null);lista.forEach(function(j){[j.time_a,j.time_b].forEach(function(t){if(nome(t))mapa[chaveNome(t)]=nome(t);});});return Object.keys(mapa).map(function(k){return mapa[k];});}
function eventosTime(lista,time){var k=chaveNome(time);return lista.filter(function(j){return chaveNome(j.time_a)===k||chaveNome(j.time_b)===k;});}
function auditarPar(fonte,time,alvo,mercado,tiros){
 tiros=Math.max(1,Math.min(3,Number(tiros)||3));var origem=eventosTime(fonte,time),baseJogo=taxa(alvo,mercado),baseAte=taxaJanela(alvo,mercado,tiros),gatilhos=[],ultimoFim=-1;
 origem.forEach(function(evento){var inicio=proximoIndice(alvo,tempo(evento));if(inicio<=ultimoFim||inicio+tiros>alvo.length)return;ultimoFim=inicio+tiros-1;var janela=alvo.slice(inicio,inicio+tiros),res=janela.map(function(j){return pagou(j,mercado)?1:0;});gatilhos.push({evento:evento,jogos:janela,resultados:res,acertou:res.some(Boolean)?1:0});});
 var total=gatilhos.length,hits=gatilhos.reduce(function(s,g){return s+g.acertou;},0),prior=10,ajustada=(hits+prior*baseAte)/(total+prior),inf=inferiorWilson(ajustada,total+prior),porTiro=[];
 for(var i=0;i<tiros;i++){var h=gatilhos.reduce(function(s,g){return s+g.resultados[i];},0);porTiro.push({hits:h,total:total,taxa:total?h/total:0});}
 var corte=Math.max(1,Math.floor(total*.7)),treinoLista=gatilhos.slice(0,corte),validacaoLista=gatilhos.slice(corte);
 function bloco(arr){var h=arr.reduce(function(s,g){return s+g.acertou;},0),p=(h+8*baseAte)/(arr.length+8);return{n:arr.length,hits:h,taxa:arr.length?h/arr.length:0,ajustada:p,inferior:inferiorWilson(p,arr.length+8),uplift:p-baseAte};}
 var treino=bloco(treinoLista),validacao=bloco(validacaoLista),uplift=ajustada-baseAte;
 var status=total<20||validacao.n<6?'AMOSTRA FRACA':treino.uplift>=.04&&validacao.uplift>=.02&&validacao.inferior>baseAte?'RELAÇÃO VALIDADA':treino.uplift>0&&validacao.uplift>0&&uplift>=.04?'SINAL RECORRENTE':'SEM VANTAGEM';
 return {time:time,total:total,hits:hits,taxa:total?hits/total:0,ajustada:ajustada,inferior:inf,baseJogo:baseJogo,baseAte:baseAte,uplift:uplift,porTiro:porTiro,status:status,treino:treino,validacao:validacao,gatilhos:gatilhos};
}
function ranking(dados,op){op=op||{};var ligas=Object.keys(dados),tiros=op.tiros||3,mercados=op.mercado&&op.mercado!=='todos'?[op.mercado]:MERCADOS.map(function(m){return m.id;}),saida=[];
 var ordenado={};ligas.forEach(function(l){ordenado[l]=ordenar(dados[l]);});
 ligas.forEach(function(lf){if(op.ligaFonte&&op.ligaFonte!=='todas'&&op.ligaFonte!==lf)return;times(ordenado[lf]).forEach(function(time){ligas.forEach(function(la){if(la===lf||op.ligaAlvo&&op.ligaAlvo!=='todas'&&op.ligaAlvo!==la)return;mercados.forEach(function(m){var a=auditarPar(ordenado[lf],time,ordenado[la],m,tiros);if(a.total>=5)saida.push(Object.assign(a,{ligaFonte:lf,ligaAlvo:la,mercado:m,tiros:tiros}));});});});});
 var peso={'RELAÇÃO VALIDADA':4,'SINAL RECORRENTE':3,'SEM VANTAGEM':2,'AMOSTRA FRACA':1};saida.sort(function(a,b){return (peso[b.status]||0)-(peso[a.status]||0)||b.validacao.uplift-a.validacao.uplift||b.uplift-a.uplift||b.total-a.total;});return saida;
}
return {MERCADOS:MERCADOS,resolvido:resolvido,pagou:pagou,ordenar:ordenar,auditarPar:auditarPar,ranking:ranking};
});
