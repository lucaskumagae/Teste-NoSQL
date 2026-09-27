// Aba "Pedidos": solicitação interna de retirada → aprovação (reserva)
// → separação → conferência por QR → expedição (baixa no estoque).

import { esc, $, $$, fmt, icone, toast, abrirModal, confirmar, mensagem } from "../ui.js";
import { montarLeitor, lerPayload } from "../qr.js";
import {
    STATUS_PEDIDO,
    MAX_ITENS_PEDIDO,
    criarPedido,
    mudarStatusPedido,
    expedirPedido,
    mensagemDeErro
} from "../servicos.js";
import { opcoesProdutos, textoPosicao, lerProdutoPorQr } from "./comum.js";

const PASSOS = ["Solicitado", "Reservado", "Em separação", "Expedido"];

const FILTROS = {
    abertos: { rotulo: "Em aberto", teste: (p) => ["pendente", "aprovado", "em_separacao"].includes(p.status) },
    meus:    { rotulo: "Meus pedidos", teste: (p, uid) => p.solicitante === uid },
    todos:   { rotulo: "Todos", teste: () => true }
};

export function montarPedidos(el, ctx) {

    let filtro = "abertos";

    el.innerHTML = `
        <div class="pagina-topo">
            <div>
                <h1>Pedidos internos</h1>
                <p>Solicite retiradas; gerentes aprovam e separadores conferem a saída pelo QR code.</p>
            </div>
            <div class="acoes">
                <button type="button" data-novo>${icone("plus")} Novo pedido</button>
            </div>
        </div>

        <div class="segmentado" role="group" aria-label="Filtrar pedidos" style="margin-bottom:16px;">
            ${Object.entries(FILTROS).map(([k, f]) => `
                <button type="button" data-filtro="${k}" aria-pressed="${k === filtro}">${f.rotulo}</button>
            `).join("")}
        </div>

        <div class="pedidos-lista" data-lista></div>
    `;

    const listaEl = $("[data-lista]", el);

    $("[data-novo]", el).addEventListener("click", () => abrirNovoPedido(ctx));

    $$("[data-filtro]", el).forEach((b) => b.addEventListener("click", () => {
        filtro = b.dataset.filtro;
        $$("[data-filtro]", el).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        render();
    }));

    listaEl.addEventListener("click", async (e) => {
        const botao = e.target.closest("[data-acao]");
        if (!botao) return;
        const pedido = ctx.estado.pedidos.find((p) => p.id === botao.closest("[data-pedido]").dataset.pedido);
        if (!pedido) return;
        await executarAcao(ctx, pedido, botao.dataset.acao, botao);
    });

    function render() {
        const lista = ctx.estado.pedidos.filter((p) => FILTROS[filtro].teste(p, ctx.usuario.uid));

        if (lista.length === 0) {
            listaEl.innerHTML = `
                <div class="card vazio">
                    <strong>Nenhum pedido aqui</strong>
                    Use “Novo pedido” para solicitar a retirada de produtos.
                </div>`;
            return;
        }

        listaEl.innerHTML = lista.map((p) => htmlPedido(ctx, p)).join("");
    }

    return {
        atualizar(motivo) {
            if (["pedidos", "produtos", "tudo", "galpao"].includes(motivo)) render();
        }
    };
}

// ─── Card de pedido ───

function htmlPedido(ctx, p) {

    const st = STATUS_PEDIDO[p.status] || { rotulo: p.status, cor: "", passo: -1 };
    const encerrado = st.passo < 0;
    const ultimoEvento = (p.eventos || []).at(-1);

    return `
        <article class="card pedido" data-pedido="${esc(p.id)}">
            <div class="pedido-topo">
                <div>
                    <h3>Pedido #${esc(p.id.slice(0, 6).toUpperCase())}</h3>
                    <div class="subtle">
                        por ${esc(p.solicitanteNome || "—")} · ${fmt.dataHora(p.criadoEm)}
                    </div>
                </div>
                <span class="badge ${st.cor}">${st.rotulo}</span>
            </div>

            ${encerrado ? "" : `
                <div class="stepper" aria-hidden="true">
                    ${PASSOS.map((_, i) => `<span class="${i <= st.passo ? "feito" : ""}"></span>`).join("")}
                </div>
                <div class="stepper-rotulos" aria-hidden="true">${PASSOS.map((r) => `<span>${r}</span>`).join("")}</div>
            `}

            <ul class="pedido-itens">
                ${p.itens.map((item) => {
                    const produto = ctx.produto(item.produtoId);
                    const pos = produto ? textoPosicao(produto.posicao) : "";
                    const faltando = produto && ["pendente", "aprovado", "em_separacao"].includes(p.status)
                        && produto.quantidade < item.quantidade;
                    return `
                        <li>
                            <span>
                                ${esc(item.nome)}
                                ${pos ? `<span class="posicao-chip">${esc(pos)}</span>` : ""}
                                ${!produto ? `<span class="badge danger">removido</span>` : ""}
                                ${faltando ? `<span class="badge warn">saldo ${fmt.num(produto.quantidade)}</span>` : ""}
                            </span>
                            <strong>${fmt.num(item.quantidade)} un.</strong>
                        </li>
                    `;
                }).join("")}
            </ul>

            ${p.observacao ? `<p class="subtle" style="margin-bottom:10px;">“${esc(p.observacao)}”</p>` : ""}
            ${ultimoEvento && ultimoEvento.status !== "pendente" ? `
                <p class="subtle" style="margin-bottom:10px;">
                    ${esc(STATUS_PEDIDO[ultimoEvento.status]?.rotulo || ultimoEvento.status)} por ${esc(ultimoEvento.nome)} · ${fmt.dataHora(ultimoEvento.em)}
                    ${ultimoEvento.motivo ? ` — ${esc(ultimoEvento.motivo)}` : ""}
                </p>` : ""}

            <div class="acoes">${botoesDoPedido(ctx, p)}</div>
        </article>
    `;
}

function botoesDoPedido(ctx, p) {
    const souSolicitante = p.solicitante === ctx.usuario.uid;
    const botoes = [];

    if (p.status === "pendente" && ctx.pode("aprovarPedido")) {
        botoes.push(`<button type="button" class="btn-sm" data-acao="aprovar">${icone("check")} Aprovar e reservar</button>`);
        botoes.push(`<button type="button" class="btn-sm btn-danger" data-acao="rejeitar">Rejeitar</button>`);
    }
    if (p.status === "aprovado" && ctx.pode("separarPedido")) {
        botoes.push(`<button type="button" class="btn-sm" data-acao="separar">Iniciar separação</button>`);
    }
    if (p.status === "em_separacao" && ctx.pode("separarPedido")) {
        botoes.push(`<button type="button" class="btn-sm" data-acao="conferir">${icone("scan")} Conferir e expedir</button>`);
    }
    const podeCancelar = (p.status === "pendente" && (souSolicitante || ctx.pode("aprovarPedido")))
        || (["aprovado", "em_separacao"].includes(p.status) && ctx.pode("aprovarPedido"));
    if (podeCancelar) {
        botoes.push(`<button type="button" class="btn-sm btn-ghost" data-acao="cancelar">Cancelar pedido</button>`);
    }

    return botoes.join("");
}

async function executarAcao(ctx, pedido, acao, botao) {

    const g = ctx.estado.galpaoId;

    try {
        switch (acao) {
            case "aprovar":
                botao.disabled = true;
                await mudarStatusPedido(g, pedido.id, "aprovado", ctx.usuario);
                toast("Pedido aprovado; itens reservados.", "ok");
                break;

            case "rejeitar": {
                const motivo = prompt("Motivo da rejeição (opcional):");
                if (motivo === null) return;
                await mudarStatusPedido(g, pedido.id, "rejeitado", ctx.usuario, { motivo: motivo.trim() });
                toast("Pedido rejeitado.");
                break;
            }

            case "separar":
                botao.disabled = true;
                await mudarStatusPedido(g, pedido.id, "em_separacao", ctx.usuario);
                toast("Separação iniciada.", "ok");
                break;

            case "conferir":
                abrirConferencia(ctx, pedido);
                break;

            case "cancelar": {
                const ok = await confirmar("Cancelar este pedido? Reservas feitas serão liberadas.", {
                    titulo: "Cancelar pedido", botao: "Cancelar pedido", perigo: true
                });
                if (!ok) return;
                await mudarStatusPedido(g, pedido.id, "cancelado", ctx.usuario);
                toast("Pedido cancelado.");
                break;
            }
        }
    } catch (erro) {
        toast(mensagemDeErro(erro, "Não foi possível atualizar o pedido."), "erro");
        botao.disabled = false;
    }
}

// ─── Novo pedido ───

function abrirNovoPedido(ctx) {

    if (ctx.estado.produtos.length === 0) {
        toast("Ainda não há produtos cadastrados neste galpão.", "erro");
        return;
    }

    const { el, fechar } = abrirModal({
        titulo: "Novo pedido de retirada",
        corpo: `
            <form id="form-pedido" novalidate>
                <label class="label">Itens <span class="subtle">(até ${MAX_ITENS_PEDIDO} produtos)</span></label>
                <div class="itens-editor" data-itens></div>
                <div class="acoes" style="margin-bottom:16px;">
                    <button type="button" class="btn-secondary btn-sm" data-add>${icone("plus")} Adicionar item</button>
                    <button type="button" class="btn-secondary btn-sm" data-qr>${icone("scan")} Adicionar por QR</button>
                </div>
                <div class="form-group">
                    <label for="pd-obs">Observação <span class="subtle">(opcional)</span></label>
                    <textarea id="pd-obs" placeholder="Ex: para a obra da filial, urgente…"></textarea>
                </div>
                <p class="form-message" data-msg></p>
            </form>
        `,
        rodape: `
            <button type="button" class="btn-secondary" data-fechar>Cancelar</button>
            <button type="submit" form="form-pedido">Enviar pedido</button>
        `
    });

    const itensEl = $("[data-itens]", el);
    const msg = $("[data-msg]", el);

    function adicionarItem(produtoId = "") {
        if ($$(".item-linha", itensEl).length >= MAX_ITENS_PEDIDO) {
            mensagem(msg, `Máximo de ${MAX_ITENS_PEDIDO} produtos por pedido.`, "erro");
            return;
        }
        const linha = document.createElement("div");
        linha.className = "item-linha";
        linha.innerHTML = `
            <select aria-label="Produto">${opcoesProdutos(ctx.estado.produtos, produtoId)}</select>
            <input type="number" min="1" step="1" value="1" aria-label="Quantidade">
            <button type="button" class="btn-ghost btn-icon" aria-label="Remover item">${icone("x")}</button>
        `;
        $("button", linha).addEventListener("click", () => linha.remove());
        itensEl.appendChild(linha);
    }

    adicionarItem();
    $("[data-add]", el).addEventListener("click", () => adicionarItem());

    $("[data-qr]", el).addEventListener("click", async () => {
        const produto = await lerProdutoPorQr(ctx, "Adicionar item por QR");
        if (!produto) return;
        // Reaproveita uma linha vazia, se houver.
        const vazia = $$(".item-linha select", itensEl).find((s) => !s.value);
        if (vazia) vazia.value = produto.id;
        else adicionarItem(produto.id);
    });

    $("#form-pedido", el).addEventListener("submit", async (event) => {
        event.preventDefault();

        const itens = [];
        for (const linha of $$(".item-linha", itensEl)) {
            const produtoId = $("select", linha).value;
            const quantidade = Number($("input", linha).value);
            if (!produtoId) continue;
            if (!Number.isInteger(quantidade) || quantidade <= 0) {
                return mensagem(msg, "Quantidades devem ser inteiros maiores que zero.", "erro");
            }
            itens.push({ produtoId, nome: ctx.produto(produtoId).nome, quantidade });
        }

        const botao = $('button[type="submit"]', el);
        botao.disabled = true;

        try {
            await criarPedido(ctx.estado.galpaoId, { itens, observacao: $("#pd-obs", el).value.trim() }, ctx.usuario);
            toast("Pedido enviado para aprovação.", "ok");
            fechar();
        } catch (erro) {
            mensagem(msg, mensagemDeErro(erro, "Erro ao criar o pedido."), "erro");
            botao.disabled = false;
        }
    });
}

// ─── Conferência por QR na saída ───

function abrirConferencia(ctx, pedido) {

    // produtoId → quantidade conferida
    const conferido = new Map(pedido.itens.map((i) => [i.produtoId, 0]));
    let desligar = () => {};

    const { el, fechar } = abrirModal({
        titulo: `Conferir pedido #${pedido.id.slice(0, 6).toUpperCase()}`,
        largo: true,
        corpo: `
            <p class="muted" style="margin-bottom:14px;">
                Leia a etiqueta de cada unidade separada. A expedição só é liberada
                quando tudo o que foi lido bate exatamente com o pedido.
            </p>
            <div class="grid-2" style="grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));">
                <div>
                    <div data-leitor></div>
                    <div class="form-group" style="margin-top:12px;">
                        <label for="cf-lote">Unidades por leitura</label>
                        <input type="number" id="cf-lote" min="1" step="1" value="1">
                        <p class="subtle">Para caixas fechadas: ex. 12 conta a caixa inteira de uma vez.</p>
                    </div>
                </div>
                <div data-itens></div>
            </div>
        `,
        rodape: `
            <button type="button" class="btn-secondary" data-fechar>Fechar</button>
            <button type="button" data-expedir disabled>${icone("check")} Confirmar expedição</button>
        `,
        aoFechar: () => desligar()
    });

    const itensEl = $("[data-itens]", el);
    const btnExpedir = $("[data-expedir]", el);
    const loteEl = $("#cf-lote", el);

    function render() {
        let tudoCerto = true;

        itensEl.innerHTML = pedido.itens.map((item) => {
            const lido = conferido.get(item.produtoId);
            const estado = lido === item.quantidade ? "completo" : lido > item.quantidade ? "excedido" : "";
            if (estado !== "completo") tudoCerto = false;
            const produto = ctx.produto(item.produtoId);
            const pos = produto ? textoPosicao(produto.posicao) : "";

            return `
                <div class="conferencia-item ${estado}">
                    <div>
                        <strong>${esc(item.nome)}</strong>
                        ${pos ? `<div class="subtle">${esc(pos)}</div>` : ""}
                    </div>
                    <div style="display:flex; align-items:center; gap:6px;">
                        <strong class="mono">${fmt.num(lido)} / ${fmt.num(item.quantidade)}</strong>
                        <button type="button" class="btn-ghost btn-icon" data-menos="${esc(item.produtoId)}" aria-label="Desfazer uma leitura de ${esc(item.nome)}" ${lido === 0 ? "disabled" : ""}>−</button>
                    </div>
                </div>
            `;
        }).join("");

        btnExpedir.disabled = !tudoCerto;
    }

    itensEl.addEventListener("click", (e) => {
        const b = e.target.closest("[data-menos]");
        if (!b) return;
        const id = b.dataset.menos;
        conferido.set(id, Math.max(0, conferido.get(id) - 1));
        render();
    });

    desligar = montarLeitor($("[data-leitor]", el), (texto) => {
        const lido = lerPayload(texto, ctx.estado.galpaoId);
        if (lido.erro) return toast(lido.erro, "erro");

        if (!conferido.has(lido.produtoId)) {
            const produto = ctx.produto(lido.produtoId);
            toast(produto
                ? `“${produto.nome}” NÃO faz parte deste pedido.`
                : "Código não reconhecido.", "erro");
            return;
        }

        const item = pedido.itens.find((i) => i.produtoId === lido.produtoId);
        const passo = Math.max(1, parseInt(loteEl.value, 10) || 1);
        const novo = conferido.get(lido.produtoId) + passo;
        conferido.set(lido.produtoId, novo);

        if (novo > item.quantidade) {
            toast(`Excedeu: ${item.nome} tem ${item.quantidade} no pedido.`, "erro");
        } else if (novo === item.quantidade) {
            toast(`${item.nome} completo.`, "ok");
        }
        render();
    }, { continuo: true });

    btnExpedir.addEventListener("click", async () => {
        btnExpedir.disabled = true;
        try {
            await expedirPedido(ctx.estado.galpaoId, pedido.id, ctx.usuario);
            toast("Pedido expedido e estoque baixado.", "ok");
            fechar();
        } catch (erro) {
            toast(mensagemDeErro(erro, "Erro ao expedir o pedido."), "erro");
            btnExpedir.disabled = false;
        }
    });

    render();
}
