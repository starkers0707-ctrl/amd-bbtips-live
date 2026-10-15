'use strict';
importScripts('auditoria-times-model.js?v=20260814b','alertas-cross-model.js?v=20260814c');
self.onmessage=function(ev){
 var msg=ev.data||{},dados=msg.dados||{},completo=AuditoriaTimesModel.ranking(dados,{ligaFonte:'todas',ligaAlvo:'todas',mercado:'todos',tiros:3});
 var monitoradas=completo.filter(function(a){return a.status==='RELAÇÃO VALIDADA'||a.status==='SINAL RECORRENTE'}).map(function(a){var limpo={};Object.keys(a).forEach(function(k){if(k!=='gatilhos')limpo[k]=a[k]});return limpo;});
 var ativos=AlertasCrossModel.montarAtivos(monitoradas,dados,msg.agora||Date.now());
 self.postMessage({id:msg.id,ranking:monitoradas,ativos:ativos,amostra:Object.values(dados).reduce(function(s,x){return s+x.length},0)});
};
