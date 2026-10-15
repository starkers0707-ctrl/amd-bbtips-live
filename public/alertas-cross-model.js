(function(root,factory){'use strict';var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AlertasCrossModel=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
function n(v){var x=Number(v);return Number.isFinite(x)?x:null;}
function tempo(j){var x=Date.parse(j&&((j.slot_em||j.criado_em)||''));return Number.isFinite(x)?x:0;}
function chave(v){return String(v||'').trim().toLocaleLowerCase('pt-BR');}
function temTime(j,time){var k=chave(time);return chave(j&&j.time_a)===k||chave(j&&j.time_b)===k;}
function relacoesDoTime(ranking,time,filtros){
 filtros=filtros||{};var k=chave(time),fonte=filtros.ligaFonte||'todas',alvo=filtros.ligaAlvo||'todas',mercado=filtros.mercado||'todos',vistos={};
 return (ranking||[]).filter(function(rel){
  if(!rel||chave(rel.time)!==k)return false;
  if(rel.status!=='RELAÇÃO VALIDADA'&&rel.status!=='SINAL RECORRENTE')return false;
  if(fonte!=='todas'&&rel.ligaFonte!==fonte)return false;
  if(alvo!=='todas'&&rel.ligaAlvo!==alvo)return false;
  if(mercado!=='todos'&&rel.mercado!==mercado)return false;
  var id=[rel.ligaFonte,rel.ligaAlvo,rel.mercado].join('|');if(vistos[id])return false;vistos[id]=1;return true;
 });
}
function resolvido(j){return !!(j&&j.resultado_ft!=null&&j.resultado_ft!==''&&n(j.gols_a)!=null&&n(j.gols_b)!=null);}
function ordenar(lista){return (lista||[]).slice().sort(function(a,b){return tempo(a)-tempo(b);});}
function futurosAtuais(lista,limite){
 limite=Math.max(1,Number(limite)||6);var ordenados=ordenar(lista),ultimoResolvido=0,vistos={};
 ordenados.forEach(function(j){if(resolvido(j))ultimoResolvido=Math.max(ultimoResolvido,tempo(j));});
 return ordenados.filter(function(j){
  if(resolvido(j)||!j||!j.time_a||!j.time_b||tempo(j)<=ultimoResolvido)return false;
  var id=[tempo(j),chave(j.time_a),chave(j.time_b)].join('|');if(vistos[id])return false;vistos[id]=1;return true;
 }).slice(0,limite);
}
function montarAtivos(ranking,dados,agora){
 agora=Number(agora)||Date.now();var saida=[];
 (ranking||[]).forEach(function(rel){
  if(rel.status!=='RELAÇÃO VALIDADA'&&rel.status!=='SINAL RECORRENTE')return;
  var fonte=ordenar(dados[rel.ligaFonte]),alvo=ordenar(dados[rel.ligaAlvo]);
  var eventos=fonte.filter(function(j){return resolvido(j)&&tempo(j)<=agora&&temTime(j,rel.time);});
  var gatilho=eventos[eventos.length-1];if(!gatilho)return;
  var limite=rel.tiros||3,proximos=alvo.filter(function(j){return tempo(j)>tempo(gatilho);}).slice(0,limite);
  var completos=proximos.filter(resolvido).length;if(completos>=limite)return;
  var proximo=proximos.find(function(j){return!resolvido(j);})||null;
  /* A grade compacta pode ainda não trazer o próximo cartão. Nesse caso o
     gatilho permanece ativo por no máximo 20 minutos, sem inventar equipes. */
  if(!proximo&&agora-tempo(gatilho)>20*60000)return;
  saida.push(Object.assign({},rel,{gatilhoAtual:gatilho,proximos:proximos,tiroAtual:completos+1,proximoJogo:proximo,proximoInferido:!proximo}));
 });
 saida.sort(function(a,b){var pa=a.status==='RELAÇÃO VALIDADA'?2:1,pb=b.status==='RELAÇÃO VALIDADA'?2:1;return pb-pa||b.validacao.uplift-a.validacao.uplift||tempo(a.proximoJogo)-tempo(b.proximoJogo);});
 return saida;
}
return{tempo:tempo,resolvido:resolvido,futurosAtuais:futurosAtuais,relacoesDoTime:relacoesDoTime,montarAtivos:montarAtivos};
});
