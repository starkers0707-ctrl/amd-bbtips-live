(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CandleTrendModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function limitar(valor, minimo, maximo) {
    return Math.max(minimo, Math.min(maximo, valor));
  }

  function combinacao(n, k) {
    if (k < 0 || k > n) return 0;
    k = Math.min(k, n - k);
    var resultado = 1;
    for (var i = 1; i <= k; i += 1) resultado = resultado * (n - k + i) / i;
    return resultado;
  }

  function probBinomial(n, k, p) {
    return combinacao(n, k) * Math.pow(p, k) * Math.pow(1 - p, n - k);
  }

  function estimarEntrada(metas, base) {
    var validas = (Array.isArray(metas) ? metas : []).filter(function (meta) {
      return meta && typeof meta.pagou === 'boolean';
    });
    var recentes = validas.slice(-Math.min(60, validas.length));
    var prior = limitar(Number(base) / 100 || 0.5, 0.01, 0.99);
    if (!recentes.length) return prior;
    var pagos = recentes.reduce(function (soma, meta) {
      return soma + (meta.pagou ? 1 : 0);
    }, 0);
    var pesoHistorico = Math.max(20, Math.round(recentes.length * 0.7));
    return limitar((prior * pesoHistorico + pagos) /
      (pesoHistorico + recentes.length), 0.01, 0.99);
  }

  function projetarHorizonte(metas, janela, horizonte, probabilidadeEntrada,
    taxaAtual) {
    var h = Math.max(1, Math.round(horizonte));
    var inicioSaida = metas.length - janela;
    var conhecidos = 0;
    var saemPagos = 0;
    for (var i = 0; i < h; i += 1) {
      var meta = metas[inicioSaida + i];
      if (!meta || typeof meta.pagou !== 'boolean') continue;
      conhecidos += 1;
      if (meta.pagou) saemPagos += 1;
    }
    if (conhecidos < h) {
      saemPagos += (h - conhecidos) * limitar(taxaAtual / 100, 0, 1);
    }

    var pAlta = 0, pBaixa = 0, pLateral = 0;
    for (var entram = 0; entram <= h; entram += 1) {
      var prob = probBinomial(h, entram, probabilidadeEntrada);
      if (entram > saemPagos + 1e-9) pAlta += prob;
      else if (entram < saemPagos - 1e-9) pBaixa += prob;
      else pLateral += prob;
    }
    var direcao = 'LATERAL';
    var confianca = pLateral;
    if (pAlta > pBaixa && pAlta > pLateral && pAlta >= 0.55) {
      direcao = 'ALTA'; confianca = pAlta;
    } else if (pBaixa > pAlta && pBaixa > pLateral && pBaixa >= 0.55) {
      direcao = 'BAIXA'; confianca = pBaixa;
    } else {
      confianca = Math.max(pLateral, 1 - Math.abs(pAlta - pBaixa));
    }
    var variacao = ((h * probabilidadeEntrada - saemPagos) / janela) * 100;
    return {
      jogos: h,
      direcao: direcao,
      confianca: Math.round(limitar(confianca, 0, 0.99) * 100),
      variacao: Math.round(variacao * 100) / 100,
      saemPagos: Math.round(saemPagos * 10) / 10
    };
  }

  function prever(opcoes) {
    var cfg = opcoes || {};
    var pontos = Array.isArray(cfg.pontos) ? cfg.pontos : [];
    var metas = Array.isArray(cfg.metas) ? cfg.metas : [];
    var janela = Math.max(2, Math.round(Number(cfg.janela) || pontos.length || 2));
    var taxaAtual = pontos.length ? Number(pontos[pontos.length - 1]) : Number(cfg.base);
    if (!isFinite(taxaAtual)) taxaAtual = 0;
    var probabilidadeEntrada = isFinite(Number(cfg.probabilidadeEntrada))
      ? limitar(Number(cfg.probabilidadeEntrada), 0.01, 0.99)
      : estimarEntrada(metas, Number(cfg.base));
    var horizontes = Array.isArray(cfg.horizontes) && cfg.horizontes.length
      ? cfg.horizontes : [1, 3, 5];
    return {
      probabilidadeEntrada: Math.round(probabilidadeEntrada * 1000) / 10,
      taxaAtual: taxaAtual,
      janela: janela,
      projecoes: horizontes.map(function (h) {
        return projetarHorizonte(metas, janela, h, probabilidadeEntrada, taxaAtual);
      })
    };
  }

  return {
    prever: prever,
    estimarEntrada: estimarEntrada,
    _internals: { probBinomial: probBinomial, projetarHorizonte: projetarHorizonte }
  };
});
