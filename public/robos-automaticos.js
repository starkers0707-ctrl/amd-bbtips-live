(function () {
  "use strict";

  const ORDER = ["o35", "o25", "o25b", "ambas"];
  const FALLBACK_NAMES = { o35: "O3.5", o25: "O2.5 A", o25b: "O2.5 B", ambas: "AMBAS" };
  const STATUS = {
    GREEN: ["GREEN", "green"],
    RED_CICLO: ["RED (3 tiros)", "red"],
    DESCARTADO: ["CANCELADO", "neutral"],
    GREEN_OBS: ["OBSERVAÇÃO GREEN", "green"],
    ABORT: ["ABORTADO", "neutral"]
  };

  const $ = id => document.getElementById(id);
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const units = value => {
    const n = number(value);
    return `${n > 0 ? "+" : ""}${n.toFixed(1)}u`;
  };
  const dateTime = value => {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "Horário indisponível" : d.toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
    });
  };
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  function stat(label, value, className) {
    const node = el("div", className || "");
    node.append(el("span", "", label), el("strong", "", value));
    return node;
  }

  function renderCard(key, data) {
    const card = el("article", "rb-auto-card");
    const head = el("header");
    const title = el("div");
    title.append(el("small", "", "ROBÔ AUTOMÁTICO"), el("h3", "", data.nome || FALLBACK_NAMES[key] || key.toUpperCase()));
    const active = Boolean(data.cicloView);
    head.append(title, el("span", `rb-auto-state ${active ? "active" : "watching"}`, active ? "CICLO EM ANDAMENTO" : "EM VIGÍLIA"));
    card.append(head);

    const reg = data.registro || {};
    const stats = el("div", "rb-auto-card-stats");
    stats.append(
      stat("SALDO", units(reg.saldo), number(reg.saldo) >= 0 ? "positive" : "negative"),
      stat("GREEN", String(number(reg.greens))),
      stat("RED", String(number(reg.redsCiclo))),
      stat("CICLOS", String(number(reg.ciclos)))
    );
    card.append(stats);

    if (active) {
      const cycle = data.cicloView || {};
      const target = cycle.alvo || {};
      const detail = el("div", "rb-auto-cycle");
      const line = el("div", "rb-auto-cycle-title");
      line.append(el("b", "", cycle.liga || "Liga"), el("span", "", `Tiro ${number(cycle.degrau) + 1} de 3`));
      detail.append(line);
      if (target.h || target.jogo) {
        detail.append(el("p", "", `Próxima entrada: ${target.h || "--:--"} · ${target.jogo || "jogo aguardando"}${target.odd ? ` · odd ${number(target.odd).toFixed(2)}` : ""}`));
      }
      const plan = el("div", "rb-auto-plan");
      const shots = Array.isArray(cycle.plano) && cycle.plano.length ? cycle.plano : (Array.isArray(cycle.tiros) ? cycle.tiros : []);
      shots.forEach((shot, index) => {
        const row = el("div", index === number(cycle.degrau) ? "current" : "");
        row.append(el("b", "", `T${index + 1}`), el("span", "", `${shot.h || "--:--"} · ${shot.jogo || "aguardando"}`), el("em", "", shot.odd ? `@${number(shot.odd).toFixed(2)}` : ""));
        plan.append(row);
      });
      detail.append(plan);
      card.append(detail);
    } else {
      card.append(el("p", "rb-auto-watching", "Aguardando o próximo sinal válido. O painel atualiza automaticamente."));
    }
    return card;
  }

  function renderHistory(items) {
    const list = $("rbAutoHistoryList");
    list.replaceChildren();
    $("rbAutoHistoryCount").textContent = String(items.length);
    if (!items.length) {
      list.append(el("div", "rb-auto-empty", "Ainda não há resultados concluídos salvos."));
      return;
    }
    items.slice(0, 80).forEach(item => {
      const row = el("article", "rb-auto-history-row");
      const copy = el("div");
      copy.append(el("h4", "", `${item.nome} · ${dateTime(item.quando)}`), el("p", "", item.detalhe || "Resultado registrado pelo robô."));
      const info = STATUS[item.resultado] || [String(item.resultado || "REGISTRO").replaceAll("_", " "), "neutral"];
      const result = el("div", "rb-auto-history-result");
      result.append(el("span", info[1], info[0]), el("strong", number(item.unidades) >= 0 ? "positive" : "negative", units(item.unidades)));
      row.append(copy, result);
      list.append(row);
    });
  }

  function render(payload) {
    const cards = $("rbAutoCards");
    cards.replaceChildren();
    let active = 0;
    let greens = 0;
    let reds = 0;
    let balance = 0;
    const history = [];

    ORDER.forEach(key => {
      const data = payload && payload[key] ? payload[key] : {};
      const reg = data.registro || {};
      if (data.cicloView) active += 1;
      greens += number(reg.greens);
      reds += number(reg.redsCiclo);
      balance += number(reg.saldo);
      (Array.isArray(data.historico) ? data.historico : []).forEach(item => history.push({ ...item, nome: data.nome || FALLBACK_NAMES[key] }));
      cards.append(renderCard(key, data));
    });

    history.sort((a, b) => new Date(b.quando).getTime() - new Date(a.quando).getTime());
    $("rbAutoActive").textContent = String(active);
    $("rbAutoGreens").textContent = String(greens);
    $("rbAutoReds").textContent = String(reds);
    $("rbAutoBalance").textContent = units(balance);
    $("rbAutoBalance").className = balance >= 0 ? "positive" : "negative";
    renderHistory(history);
  }

  async function refresh() {
    try {
      const response = await fetch("/api/robo?view=panel", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      render(await response.json());
    } catch (error) {
      const cards = $("rbAutoCards");
      cards.replaceChildren(el("div", "rb-auto-empty error", "Não foi possível atualizar agora. Uma nova tentativa será feita automaticamente."));
    }
  }

  refresh();
  window.setInterval(() => { if (!document.hidden) refresh(); }, 15000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
}());
