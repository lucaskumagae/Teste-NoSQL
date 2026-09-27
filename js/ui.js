// Utilitários de interface compartilhados por todas as páginas.

// Escapa texto antes de colocá-lo em innerHTML — nomes de produto,
// observações etc. vêm do usuário e não podem virar HTML.
export function esc(valor) {
    return String(valor ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export function $(seletor, raiz = document) {
    return raiz.querySelector(seletor);
}

export function $$(seletor, raiz = document) {
    return [...raiz.querySelectorAll(seletor)];
}

// ─── Formatação ───

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const numero = new Intl.NumberFormat("pt-BR");
const dataHora = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const dataCurta = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "UTC" });

export const fmt = {
    moeda: (v) => moeda.format(Number(v) || 0),
    num: (v) => numero.format(Number(v) || 0),
    pct: (v) => (v * 100).toFixed(1).replace(".", ",") + "%",

    // Aceita Timestamp do Firestore, Date ou string ISO.
    dataHora(v) {
        const d = paraDate(v);
        return d ? dataHora.format(d) : "—";
    },

    // Validade é salva como "AAAA-MM-DD" (sem fuso).
    data(v) {
        if (!v) return "—";
        const d = new Date(v + "T00:00:00Z");
        return isNaN(d) ? v : dataCurta.format(d);
    }
};

export function paraDate(v) {
    if (!v) return null;
    if (typeof v.toDate === "function") return v.toDate();
    const d = new Date(v);
    return isNaN(d) ? null : d;
}

export function iniciais(nome) {
    return String(nome || "?")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((p) => p[0])
        .join("")
        .toUpperCase();
}

// ─── Mensagens em formulários ───

export function mensagem(el, texto, tipo = "") {
    el.textContent = texto;
    el.className = "form-message" + (tipo ? " " + tipo : "");
}

// ─── Toasts ───

export function toast(texto, tipo = "") {
    let pilha = $(".toasts");

    if (!pilha) {
        pilha = document.createElement("div");
        pilha.className = "toasts";
        pilha.setAttribute("role", "status");
        pilha.setAttribute("aria-live", "polite");
        // Popover fica na "top layer", acima de modais <dialog> abertos.
        pilha.setAttribute("popover", "manual");
        document.body.appendChild(pilha);
    }

    const el = document.createElement("div");
    el.className = "toast " + tipo;
    el.textContent = texto;
    pilha.appendChild(el);

    // Reabrir traz a pilha para cima do modal mais recente.
    if (pilha.showPopover) {
        if (pilha.matches(":popover-open")) pilha.hidePopover();
        pilha.showPopover();
    }

    setTimeout(() => {
        el.remove();
        if (!pilha.children.length && pilha.hidePopover && pilha.matches(":popover-open")) {
            pilha.hidePopover();
        }
    }, 4000);
}

// ─── Modal (usa <dialog> nativo) ───

// Abre um modal e devolve { el, fechar }. O conteúdo é HTML já montado
// (lembre de usar esc() nas partes vindas do usuário).
export function abrirModal({ titulo, corpo, rodape = "", largo = false, aoFechar }) {

    const dialog = document.createElement("dialog");
    dialog.className = "modal" + (largo ? " largo" : "");

    dialog.innerHTML = `
        <div class="modal-topo">
            <h2>${esc(titulo)}</h2>
            <button type="button" class="btn-ghost btn-icon" data-fechar aria-label="Fechar">${icone("x")}</button>
        </div>
        <div class="modal-corpo">${corpo}</div>
        ${rodape ? `<div class="modal-rodape">${rodape}</div>` : ""}
    `;

    document.body.appendChild(dialog);

    // Finaliza na hora (sem esperar o evento "close", que é assíncrono);
    // o evento continua cobrindo o fechamento pela tecla Esc.
    let finalizado = false;
    function finalizar() {
        if (finalizado) return;
        finalizado = true;
        if (aoFechar) aoFechar();
        dialog.remove();
    }

    const fechar = () => {
        if (dialog.open) dialog.close();
        finalizar();
    };

    dialog.addEventListener("close", finalizar);

    dialog.addEventListener("click", (e) => {
        if (e.target.closest("[data-fechar]")) fechar();
        // clique fora do conteúdo (no backdrop) fecha
        if (e.target === dialog) fechar();
    });

    dialog.showModal();

    return { el: dialog, fechar };
}

export function confirmar(texto, { titulo = "Confirmar", botao = "Confirmar", perigo = false } = {}) {
    return new Promise((resolve) => {
        let resposta = false;

        const { el, fechar } = abrirModal({
            titulo,
            corpo: `<p>${esc(texto)}</p>`,
            rodape: `
                <button type="button" class="btn-secondary" data-fechar>Cancelar</button>
                <button type="button" class="${perigo ? "btn-danger" : ""}" data-ok>${esc(botao)}</button>
            `,
            aoFechar: () => resolve(resposta)
        });

        $("[data-ok]", el).addEventListener("click", () => {
            resposta = true;
            fechar();
        });
    });
}

// ─── Ícones (SVG inline, traço) ───

const ICONES = {
    box: '<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
    warehouse: '<path d="M3 21V8l9-5 9 5v13"/><path d="M7 21v-8h10v8M7 17h10"/>',
    swap: '<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
    clipboard: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/>',
    scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m14 6 4 4"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    logout: '<path d="M15 4h4v16h-4M10 17l5-5-5-5M15 12H3"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    print: '<path d="M6 9V3h12v6M6 18H4v-7h16v7h-2"/><rect x="6" y="14" width="12" height="7"/>',
    check: '<path d="m5 12 5 5L20 7"/>',
    pin: '<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/>'
};

export function icone(nome) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[nome] || ""}</svg>`;
}
