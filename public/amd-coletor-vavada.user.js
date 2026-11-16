// ==UserScript==
// @name         AMD Coletor Vavada
// @namespace    amd.live
// @version      1.1.1
// @description  Coleta as seis ligas Kiron diretamente da API Vavada e envia ao AMD Live.
// @match        https://vavada.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      sb2virtuals-altenar2.biahosted.com
// @connect      amd-bbtips-live.onrender.com
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const API = 'https://sb2virtuals-altenar2.biahosted.com/api/';
  const DESTINO = 'https://amd-bbtips-live.onrender.com/api/tampermonkey';
  const QS = { culture:'pt-PT', timezoneOffset:'180', integration:'vavada', deviceType:'1', numFormat:'en-GB', countryCode:'BR' };
  const LIGAS = {
    bra:{id:55, cols:20, passo:3, inicio:2},
    eng:{id:57, cols:30, passo:2, inicio:0},
    ita:{id:59, cols:30, passo:2, inicio:1},
    lat:{id:61, cols:20, passo:3, inicio:2},
    spa:{id:63, cols:30, passo:2, inicio:1},
    mnd:{id:92, cols:30, passo:2, inicio:0}
  };
  let executando = false;
  let painelInfo = null;

  function requisicao(method, url, body, headers={}) {
    return new Promise((resolve, reject) => GM_xmlhttpRequest({
      method, url, data: body, headers, timeout: 15000,
      onload: r => {
        if (r.status < 200 || r.status >= 300) return reject(new Error(`HTTP ${r.status} ${url}`));
        try { resolve(JSON.parse(r.responseText)); } catch (e) { reject(e); }
      },
      onerror: () => reject(new Error(`falha de rede ${url}`)),
      ontimeout: () => reject(new Error(`timeout ${url}`))
    }));
  }

  function url(path, extra={}) {
    const u = new URL(path, API);
    Object.entries({...QS,...extra}).forEach(([k,v]) => u.searchParams.set(k,String(v)));
    return u.href;
  }

  const lista = (x, nomes) => {
    for (const n of nomes) if (Array.isArray(x?.[n])) return x[n];
    return Array.isArray(x) ? x : [];
  };
  const pausa = ms => new Promise(r => setTimeout(r,ms));

  function idsMercado(det, tipo) {
    const m = lista(det,['markets','marketList']).find(x => Number(x.typeId)===tipo);
    return new Set([...(m?.desktopOddIds||[]),...(m?.mobileOddIds||[])].flat(Infinity).map(Number));
  }
  function oddsMercado(det,tipo) {
    const ids=idsMercado(det,tipo);
    return lista(det,['odds','oddList']).filter(o=>ids.has(Number(o.id)));
  }
  function linha(odd) {
    try { const s=typeof odd?.sv==='string'?JSON.parse(odd.sv):odd?.sv; return String(s?.['1']??'').replace(',','.'); }
    catch { return ''; }
  }
  function odd(det,tipo,teste) { return oddsMercado(det,tipo).find(teste); }
  function vencedor(det,tipo) {
    const a=oddsMercado(det,tipo).filter(o=>Number(o.oddStatus)===1);
    return a.length===1?a[0]:null;
  }
  function nomes(det,ev) {
    const c=lista(det,['competitors','participants']);
    const n=String(det?.name||ev?.name||'').split(/\s+vs\.?\s+|\s+x\s+/i);
    return [c[0]?.name||n[0]||'Casa',c[1]?.name||n[1]||'Fora'];
  }
  function horario(iso) {
    const d=new Date(iso);
    return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hour12:false}).format(d) : '';
  }
  function coordenadas(h, cfg) {
    const [hh,mm]=String(h).split(':').map(Number);
    const delta=(mm-cfg.inicio+60)%60;
    return {linha_visual:hh, coluna_visual:Math.floor(delta/cfg.passo)+1};
  }
  function oddsBasicas(det) {
    const o25=odd(det,18,o=>Number(o.typeId)===12&&linha(o)==='2.5');
    const o35=odd(det,18,o=>Number(o.typeId)===12&&linha(o)==='3.5');
    const as=odd(det,29,o=>Number(o.typeId)===74||/^sim$/i.test(String(o.name||'')));
    const an=odd(det,29,o=>Number(o.typeId)===76||/^n[aã]o$/i.test(String(o.name||'')));
    return {o25:o25?.price??null,o35:o35?.price??null,ambs:as?.price??null,ambn:an?.price??null};
  }
  function interpretar(det,ev,liga,cfg) {
    const [casa,fora]=nomes(det,ev), h=horario(det?.startDate||ev?.startDate), coord=coordenadas(h,cfg);
    const base={id:`vavada:${liga}:${ev.id}`,nome:`${casa} x ${fora}`,casa,fora,hora:h,horario:h,odds:oddsBasicas(det),...coord};
    if(Number(ev.status)!==2) return {futuro:base};
    // O placar exato liquidado é a confirmação mais direta do resultado. Em
    // alguns eventos a Vavada já remove a marca vencedora do mercado 1x2,
    // embora mantenha o resultado exato corretamente liquidado.
    const ex=vencedor(det,199); if(!ex) return {};
    const [a,b]=String(ex.name||'').split(':').map(Number);
    if(!Number.isFinite(a)||!Number.isFinite(b)) return {};
    return {placar:{...base,a,b,total:a+b,placar:`${a}-${b}`}};
  }

  async function enviar(liga,placares,upcoming) {
    const token=String(GM_getValue('amd_vavada_token','')).trim();
    if(!token) throw new Error('token não configurado');
    return requisicao('POST',DESTINO,JSON.stringify({liga,mkt:'o25',placares,upcoming,debug:{versao:'1.1.0',ts:Date.now()}}),{
      'Content-Type':'application/json','Authorization':`Bearer ${token}`
    });
  }

  async function ciclo() {
    if(executando) return; executando=true;
    try {
      status('consultando catálogo das 6 ligas...');
      const gj=await requisicao('GET',url('Virtuals/GetGames'));
      const games=lista(gj,['games','items','data']);
      let total=0;
      for(const [liga,cfg] of Object.entries(LIGAS)) {
        const game=games.find(g=>Number(g.id)===cfg.id||Number(g.typeId)===cfg.id||Number(g.gameTypeId)===cfg.id);
        if(!game) { status(`${liga.toUpperCase()}: liga ${cfg.id} não encontrada`); continue; }
        const ej=await requisicao('GET',url('Virtuals/GetEventList',{id:game.id,dbId:game.dbId}));
        const eventos=lista(ej,['events','items','data']);
        const cache=GM_getValue(`amd_cache_${liga}`,{}), futuros=[];
        for(const ev of eventos) {
          try {
            const det=await requisicao('GET',url('WidgetVirtuals/GetVirtualEventDetails',{id:game.id,dbId:game.dbId,eventId:ev.id}));
            const r=interpretar(det,ev,liga,cfg);
            if(r.placar) cache[r.placar.id]=r.placar;
            if(r.futuro) futuros.push(r.futuro);
          } catch(e) { console.warn('[AMD Vavada]',liga,ev.id,e); }
          await pausa(120);
        }
        const placares=Object.values(cache).sort((a,b)=>String(a.horario).localeCompare(String(b.horario))).slice(-1200);
        GM_setValue(`amd_cache_${liga}`,Object.fromEntries(placares.map(p=>[p.id,p])));
        const resp=await enviar(liga,placares,futuros);
        total+=placares.length;
        status(`${liga.toUpperCase()}: ${placares.length} resultados + ${futuros.length} futuros (${eventos.length} eventos lidos)`);
        console.log('[AMD Vavada]',liga,resp);
      }
      status(`OK v1.1.1: ${total} resultados armazenados · próxima consulta em 30s`);
    } catch(e) { status(`ERRO: ${e.message}`); console.error('[AMD Vavada]',e); }
    finally { executando=false; }
  }

  function status(txt) { if(painelInfo) painelInfo.textContent=txt; }
  function painel() {
    if(document.getElementById('amd-vavada')) return;
    const p=document.createElement('div'); p.id='amd-vavada';
    p.style.cssText='position:fixed;right:14px;bottom:14px;z-index:2147483647;width:350px;background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:14px;padding:16px;font:14px monospace;box-shadow:0 12px 32px #0009';
    p.innerHTML='<b>AMD COLETOR VAVADA v1.1.1</b><div id="amd-vavada-info" style="color:#f0b90b;margin:12px 0;white-space:pre-wrap">iniciando...</div><button id="amd-vavada-agora">Coletar agora</button> <button id="amd-vavada-token">Trocar token</button>';
    document.body.appendChild(p); painelInfo=p.querySelector('#amd-vavada-info');
    p.querySelector('#amd-vavada-agora').onclick=ciclo;
    p.querySelector('#amd-vavada-token').onclick=()=>{const t=prompt('Cole o TAMPERMONKEY_TOKEN configurado no Render:',GM_getValue('amd_vavada_token',''));if(t){GM_setValue('amd_vavada_token',t.trim());status('token atualizado');}};
    if(!GM_getValue('amd_vavada_token','')) p.querySelector('#amd-vavada-token').click();
    ciclo(); setInterval(ciclo,30000);
  }
  const pronto=setInterval(()=>{if(document.body){clearInterval(pronto);painel();}},200);
})();
