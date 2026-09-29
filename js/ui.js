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

// ─── Ícones (Lucide — https://lucide.dev, licença ISC; SVG embutido) ───

const ICONES = {
    box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    warehouse: '<path d="M18 21V10a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1v11"/><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 1.132-1.803l7.95-3.974a2 2 0 0 1 1.837 0l7.948 3.974A2 2 0 0 1 22 8z"/><path d="M6 13h12"/><path d="M6 17h12"/>',
    swap: '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
    clipboard: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
    chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    qr: '<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/>',
    scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
    edit: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
    trash: '<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
    logout: '<path d="m16 17 5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    print: '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    pin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>'
};

export function icone(nome) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[nome] || ""}</svg>`;
}
