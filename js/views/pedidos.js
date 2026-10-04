// Aba "Pedidos": solicitação interna de retirada → aprovação (reserva)
// → separação → conferência por QR → expedição (baixa no estoque).
//
// Na conferência, cada peça de produto novo ganha um código curto único
// (etiqueta impressa na hora). Itens individuais já têm o seu código.
// Assim, na devolução, o sistema sabe exatamente qual peça voltou.

import { esc, $, $$, fmt, icone, toast, abrirModal, confirmar, mensagem } from "../ui.js";
import { montarLeitor, lerPayload, qrSvg, payloadPedido } from "../qr.js";
import { gerarCodigo, formatarCodigo, codigoPedido, normalizarCodigo } from "../codigos.js";
import {
    STATUS_PEDIDO,
    MAX_ITENS_PEDIDO,
    MAX_UNIDADES_PEDIDO,
    ehIndividual,
    individualDisponivel,
    criarPedido,
    mudarStatusPedido,
    expedirPedido,
    lerUnidade,
    mensagemDeErro
} from "../servicos.js";
import {
    opcoesProdutos,
    textoPosicao,
    lerProdutoPorQr,
    badgeCondicao,
    chipCodigo,
    htmlEtiquetaUnidade,
    imprimirEtiqueta
} from "./comum.js";

const PASSOS = ["Solicitado", "Reservado", "Em separação", "Expedido"];

const FILTROS = {
    abertos: { rotulo: "Em aberto", teste: (p) => ["pendente", "aprovado", "em_separacao"].includes(p.status) },
    meus:    { rotulo: "Meus pedidos", teste: (p, uid) => p.solicitante === uid },
    todos:   { rotulo: "Todos", teste: () => true }
};

// Nome atual do produto (o pedido guarda uma cópia do nome da época).
function nomeItem(ctx, item) {
    const produto = ctx.produto(item.produtoId);
    return produto ? produto.nome : item.nome;
}

export function montarPedidos(el, ctx) {

    let filtro = "abertos";
    let destaque = null; // pedidoId vindo de um link do histórico

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

        <div class="toolbar-simples">
            <div class="segmentado" role="group" aria-label="Filtrar pedidos">
                ${Object.entries(FILTROS).map(([k, f]) => `
                    <button type="button" data-filtro="${k}" aria-pressed="${k === filtro}">${f.rotulo}</button>
                `).join("")}
            </div>
            <input type="search" data-busca class="mono" placeholder="Buscar pelo código do pedido" aria-label="Buscar pelo código do pedido">
        </div>

        <div class="pedidos-lista" data-lista></div>
    `;

    const listaEl = $("[data-lista]", el);
    const buscaEl = $("[data-busca]", el);

    $("[data-novo]", el).addEventListener("click", () => abrirNovoPedido(ctx));

    function selecionarFiltro(novo) {
        filtro = novo;
        $$("[data-filtro]", el).forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.filtro === filtro)));
    }

    $$("[data-filtro]", el).forEach((b) => b.addEventListener("click", () => {
        selecionarFiltro(b.dataset.filtro);
        destaque = null;
        render();
    }));

    buscaEl.addEventListener("input", () => {
        // A busca procura em todos os pedidos, não só no filtro atual.
        if (buscaEl.value.trim()) selecionarFiltro("todos");
        render();
    });

    listaEl.addEventListener("click", async (e) => {
        const botao = e.target.closest("[data-acao]");
        if (!botao) return;
        const pedido = ctx.estado.pedidos.find((p) => p.id === botao.closest("[data-pedido]").dataset.pedido);
        if (!pedido) return;
        await executarAcao(ctx, pedido, botao.dataset.acao, botao);
    });

    function render() {
        const termo = normalizarCodigo(buscaEl.value);
        const lista = ctx.estado.pedidos.filter((p) =>
            FILTROS[filtro].teste(p, ctx.usuario.uid)
            && (!termo || normalizarCodigo(codigoPedido(p)).includes(termo))
        );

        if (lista.length === 0) {
            listaEl.innerHTML = `
                <div class="card vazio">
                    <strong>Nenhum pedido aqui</strong>
                    ${termo ? "Nenhum pedido com esse código." : "Use “Novo pedido” para solicitar a retirada de produtos."}
                </div>`;
            return;
        }

        listaEl.innerHTML = lista.map((p) => htmlPedido(ctx, p, p.id === destaque)).join("");

        if (destaque) {
            const card = listaEl.querySelector(`[data-pedido="${CSS.escape(destaque)}"]`);
            if (card) card.scrollIntoView({ block: "center" });
        }
    }

    return {
        atualizar(motivo) {
            if (["pedidos", "produtos", "tudo", "galpao"].includes(motivo)) render();
        },
        // Vindo de "Pedido #…" no histórico de um produto.
        mostrar(params = {}) {
            if (params.pedidoId) {
                destaque = params.pedidoId;
                buscaEl.value = "";
                selecionarFiltro("todos");
                render();
            }
        }
    };
}

// ─── Card de pedido ───

function htmlPedido(ctx, p, destacado) {

    const st = STATUS_PEDIDO[p.status] || { rotulo: p.status, cor: "", passo: -1 };
    const encerrado = st.passo < 0;
    const ultimoEvento = (p.eventos || []).at(-1);
    const expedidas = p.unidadesExpedidas || {};

    return `
        <article class="card pedido ${destacado ? "destaque" : ""}" data-pedido="${esc(p.id)}">
            <div class="pedido-topo">
                <div>
                    <h3>Pedido <span class="mono">#${esc(codigoPedido(p))}</span></h3>
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
                    const codigos = expedidas[item.produtoId] || [];
                    return `
                        <li>
                            <span>
                                ${esc(nomeItem(ctx, item))}
                                ${produto && ehIndividual(produto) ? `${badgeCondicao(produto)} ${chipCodigo(produto.codigo || produto.id)}` : ""}
                                ${pos ? `<span class="posicao-chip">${esc(pos)}</span>` : ""}
                                ${!produto ? `<span class="badge danger">removido</span>` : ""}
                                ${faltando ? `<span class="badge warn">saldo ${fmt.num(produto.quantidade)}</span>` : ""}
                                ${codigos.length && !(produto && ehIndividual(produto)) ? `
                                    <span class="codigos-lista">${codigos.slice(0, 4).map(chipCodigo).join("")}${codigos.length > 4 ? `<span class="subtle">+${codigos.length - 4}</span>` : ""}</span>
                                ` : ""}
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
    if (p.status === "expedido") {
        botoes.push(`<button type="button" class="btn-sm btn-secondary" data-acao="guia">${icone("print")} Guia e etiquetas</button>`);
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

            case "guia":
                abrirGuia(ctx, pedido, pedido.unidadesExpedidas || {});
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

// Produtos que podem ser pedidos: novos com saldo e itens individuais
// disponíveis (danificados só depois da manutenção).
function produtosPedidos(ctx) {
    return ctx.estado.produtos.filter((p) => ehIndividual(p) ? individualDisponivel(p) : true);
}

function abrirNovoPedido(ctx) {

    if (ctx.estado.produtos.length === 0) {
        toast("Ainda não há produtos cadastrados neste galpão.", "erro");
        return;
    }

    const { el, fechar } = abrirModal({
        titulo: "Novo pedido de retirada",
        corpo: `
            <form id="form-pedido" novalidate>
                <label class="label">Itens <span class="subtle">(até ${MAX_ITENS_PEDIDO} produtos e ${MAX_UNIDADES_PEDIDO} unidades)</span></label>
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

    // Item individual é único: quantidade travada em 1.
    function ajustarQuantidade(linha) {
        const produto = ctx.produto($("select", linha).value);
        const input = $("input", linha);
        const unico = ehIndividual(produto);
        if (unico) input.value = "1";
        input.disabled = unico;
    }

    function adicionarItem(produtoId = "") {
        if ($$(".item-linha", itensEl).length >= MAX_ITENS_PEDIDO) {
            mensagem(msg, `Máximo de ${MAX_ITENS_PEDIDO} produtos por pedido.`, "erro");
            return;
        }
        const linha = document.createElement("div");
        linha.className = "item-linha";
        linha.innerHTML = `
            <select aria-label="Produto">${opcoesProdutos(produtosPedidos(ctx), produtoId)}</select>
            <input type="number" min="1" step="1" value="1" aria-label="Quantidade">
            <button type="button" class="btn-ghost btn-icon" aria-label="Remover item">${icone("x")}</button>
        `;
        $("button", linha).addEventListener("click", () => linha.remove());
        $("select", linha).addEventListener("change", () => ajustarQuantidade(linha));
        itensEl.appendChild(linha);
        ajustarQuantidade(linha);
    }

    adicionarItem();
    $("[data-add]", el).addEventListener("click", () => adicionarItem());

    $("[data-qr]", el).addEventListener("click", async () => {
        const produto = await lerProdutoPorQr(ctx, "Adicionar item por QR");
        if (!produto) return;
        if (ehIndividual(produto) && !individualDisponivel(produto)) {
            mensagem(msg, `“${produto.nome}” não está disponível (fora do galpão ou danificado).`, "erro");
            return;
        }
        // Reaproveita uma linha vazia, se houver.
        const vazia = $$(".item-linha", itensEl).find((l) => !$("select", l).value);
        if (vazia) {
            $("select", vazia).value = produto.id;
            ajustarQuantidade(vazia);
        } else {
            adicionarItem(produto.id);
        }
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
            const produto = ctx.produto(produtoId);
            itens.push({ produtoId, nome: produto.nome, quantidade, individual: ehIndividual(produto) });
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
//
// Produto novo: ler a etiqueta geral do produto gera um código novo para
// cada unidade (a etiqueta da peça é impressa depois). Se a peça já tem
// etiqueta (voltou lacrada antes), lê-se a etiqueta dela e o código é reaproveitado.
// Item individual: lê-se a etiqueta da própria peça.

function abrirConferencia(ctx, pedido) {

    // produtoId → [{ codigo, novo }]
    const lidas = new Map(pedido.itens.map((i) => [i.produtoId, []]));
    let desligar = () => {};
    let ocupado = false;

    const { el, fechar } = abrirModal({
        titulo: `Conferir pedido #${codigoPedido(pedido)}`,
        largo: true,
        corpo: `
            <p class="muted" style="margin-bottom:14px;">
                Para cada peça separada, leia a etiqueta. Produtos novos ganham um
                <strong>código único por peça</strong> — as etiquetas são impressas ao expedir.
                A expedição só é liberada quando tudo bate com o pedido.
            </p>
            <div class="grid-2" style="grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));">
                <div>
                    <div data-leitor></div>
                    <div class="form-group" style="margin-top:12px;">
                        <label for="cf-lote">Peças por leitura</label>
                        <input type="number" id="cf-lote" min="1" step="1" value="1">
                        <p class="subtle">Para caixas fechadas: ex. 12 gera 12 códigos de uma vez (vale para a etiqueta geral do produto).</p>
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

    function todosCodigos() {
        return [...lidas.values()].flat().map((u) => u.codigo);
    }

    function render() {
        let tudoCerto = true;

        itensEl.innerHTML = pedido.itens.map((item) => {
            const lista = lidas.get(item.produtoId);
            const completo = lista.length === item.quantidade;
            if (!completo) tudoCerto = false;
            const produto = ctx.produto(item.produtoId);
            const pos = produto ? textoPosicao(produto.posicao) : "";

            return `
                <div class="conferencia-item ${completo ? "completo" : ""}">
                    <div style="min-width:0;">
                        <strong>${esc(nomeItem(ctx, item))}</strong>
                        ${produto && ehIndividual(produto) ? `<div>${badgeCondicao(produto)} ${chipCodigo(produto.codigo || produto.id)}</div>` : ""}
                        ${pos ? `<div class="subtle">${esc(pos)}</div>` : ""}
                        ${lista.length ? `
                            <div class="codigos-lista">
                                ${lista.slice(-6).map((u) => `
                                    <span class="codigo-chip ${u.novo ? "novo" : ""}" title="${u.novo ? "Código novo (etiqueta a imprimir)" : "Etiqueta existente"}">
                                        ${esc(formatarCodigo(u.codigo))}
                                    </span>`).join("")}
                                ${lista.length > 6 ? `<span class="subtle">+${lista.length - 6}</span>` : ""}
                            </div>` : ""}
                    </div>
                    <div style="display:flex; align-items:center; gap:6px;">
                        <strong class="mono">${fmt.num(lista.length)} / ${fmt.num(item.quantidade)}</strong>
                        <button type="button" class="btn-ghost btn-icon" data-menos="${esc(item.produtoId)}" aria-label="Desfazer a última leitura de ${esc(nomeItem(ctx, item))}" ${lista.length === 0 ? "disabled" : ""}>−</button>
                    </div>
                </div>
            `;
        }).join("");

        btnExpedir.disabled = !tudoCerto;
    }

    itensEl.addEventListener("click", (e) => {
        const b = e.target.closest("[data-menos]");
        if (!b) return;
        lidas.get(b.dataset.menos).pop();
        render();
    });

    function adicionar(item, unidades) {
        const lista = lidas.get(item.produtoId);
        const espaco = item.quantidade - lista.length;
        if (espaco <= 0) {
            toast(`Excedeu: ${nomeItem(ctx, item)} tem ${item.quantidade} no pedido.`, "erro");
            return;
        }
        if (unidades.length > espaco) {
            toast(`Só faltam ${espaco} peça(s) de ${nomeItem(ctx, item)}; as demais foram ignoradas.`, "erro");
        }
        lista.push(...unidades.slice(0, espaco));
        if (lista.length === item.quantidade) toast(`${nomeItem(ctx, item)} completo.`, "ok");
        render();
    }

    async function aoLer(texto) {
        const lido = lerPayload(texto, ctx.estado.galpaoId);
        if (lido.erro) return toast(lido.erro, "erro");
        if (lido.pedidoId) return toast("Esta é a guia de um pedido. Leia a etiqueta do produto ou da peça.", "erro");

        // Etiqueta geral do produto (ou ID digitado)
        if (lido.produtoId) {
            const item = pedido.itens.find((i) => i.produtoId === lido.produtoId);
            const produto = ctx.produto(lido.produtoId);
            if (!item) {
                return toast(produto ? `“${produto.nome}” NÃO faz parte deste pedido.` : "Código não reconhecido.", "erro");
            }
            if (ehIndividual(produto)) {
                const codigo = normalizarCodigo(produto.codigo || produto.id);
                if (todosCodigos().includes(codigo)) return toast("Esta peça já foi lida.", "erro");
                return adicionar(item, [{ codigo, novo: false }]);
            }
            const passo = Math.max(1, parseInt(loteEl.value, 10) || 1);
            const novos = Array.from({ length: passo }, () => ({ codigo: gerarCodigo(), novo: true }));
            return adicionar(item, novos);
        }

        // Código curto: item individual ou peça que já tem etiqueta.
        const codigo = lido.codigo;
        if (todosCodigos().includes(codigo)) return toast("Esta peça já foi lida.", "erro");

        const individual = pedido.itens.find((i) => {
            const p = ctx.produto(i.produtoId);
            return p && ehIndividual(p) && normalizarCodigo(p.codigo || p.id) === codigo;
        });
        if (individual) return adicionar(individual, [{ codigo, novo: false }]);

        if (ocupado) return;
        ocupado = true;
        let unidade = null;
        try {
            unidade = await lerUnidade(ctx.estado.galpaoId, codigo);
        } catch (erro) {
            ocupado = false;
            return toast(mensagemDeErro(erro, "Não foi possível consultar o código."), "erro");
        }
        ocupado = false;

        if (!unidade) return toast(`Código ${formatarCodigo(codigo)} não encontrado.`, "erro");
        const item = pedido.itens.find((i) => i.produtoId === unidade.produtoId && !unidade.itemId);
        if (!item) return toast(`A peça ${formatarCodigo(codigo)} (${unidade.produtoNome}) NÃO faz parte deste pedido.`, "erro");
        if (unidade.status !== "em_estoque") return toast(`A peça ${formatarCodigo(codigo)} consta como fora do estoque.`, "erro");
        adicionar(item, [{ codigo, novo: false }]);
    }

    desligar = montarLeitor($("[data-leitor]", el), aoLer, { continuo: true });

    btnExpedir.addEventListener("click", async () => {
        btnExpedir.disabled = true;
        const unidades = Object.fromEntries(lidas);
        try {
            await expedirPedido(ctx.estado.galpaoId, pedido.id, unidades, ctx.usuario);
            toast("Pedido expedido e estoque baixado.", "ok");
            fechar();
            abrirGuia(ctx, pedido, Object.fromEntries(
                [...lidas].map(([produtoId, lista]) => [produtoId, lista.map((u) => u.codigo)])
            ), new Set(todosCodigosNovos()));
        } catch (erro) {
            toast(mensagemDeErro(erro, "Erro ao expedir o pedido."), "erro");
            btnExpedir.disabled = false;
        }
    });

    function todosCodigosNovos() {
        return [...lidas.values()].flat().filter((u) => u.novo).map((u) => u.codigo);
    }

    render();
}

// ─── Guia de saída + etiquetas das peças ───
//
// A guia acompanha a mercadoria: tem o QR do pedido e a lista de peças.
// As etiquetas (uma por peça nova) são coladas nas peças antes de sair.

function abrirGuia(ctx, pedido, codigosPorProduto, novos = null) {

    const linhas = pedido.itens.map((item) => ({
        item,
        nome: nomeItem(ctx, item),
        codigos: codigosPorProduto[item.produtoId] || []
    }));

    const etiquetas = linhas.flatMap((l) =>
        l.codigos
            .filter((c) => !novos || novos.has(c))
            .map((c) => ({ codigo: c, nome: l.nome }))
    );

    const { el } = abrirModal({
        titulo: `Pedido #${codigoPedido(pedido)} — guia e etiquetas`,
        largo: true,
        corpo: `
            ${novos ? `<p class="muted" style="margin-bottom:14px;">Expedição registrada. Imprima as etiquetas e cole uma em cada peça; a guia acompanha a mercadoria.</p>` : ""}

            <div class="guia" data-guia>
                <div class="guia-topo">
                    <div>
                        <div class="guia-titulo">Guia de saída</div>
                        <div class="guia-codigo">#${esc(codigoPedido(pedido))}</div>
                        <div class="etiqueta-meta">${esc(ctx.estado.galpao ? ctx.estado.galpao.nome : "")}</div>
                        <div class="etiqueta-meta">Solicitante: ${esc(pedido.solicitanteNome || "—")}</div>
                    </div>
                    <div class="guia-qr">${qrSvg(payloadPedido(ctx.estado.galpaoId, pedido.id))}</div>
                </div>
                <table>
                    <thead><tr><th>Produto</th><th class="num">Qtd.</th><th>Códigos das peças</th></tr></thead>
                    <tbody>
                        ${linhas.map((l) => `
                            <tr>
                                <td>${esc(l.nome)}</td>
                                <td class="num">${fmt.num(l.item.quantidade)}</td>
                                <td class="mono">${l.codigos.map((c) => esc(formatarCodigo(c))).join(", ") || "—"}</td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>

            ${etiquetas.length ? `
                <h3 style="margin:20px 0 8px;">Etiquetas das peças (${etiquetas.length})</h3>
                <div class="etiquetas-lote" data-lote>
                    ${etiquetas.map((e) => htmlEtiquetaUnidade(ctx, e.codigo, e.nome, `Pedido #${codigoPedido(pedido)}`)).join("")}
                </div>
            ` : ""}
        `,
        rodape: `
            <button type="button" class="btn-secondary" data-fechar>Fechar</button>
            <button type="button" class="btn-secondary" data-imprimir-guia>${icone("print")} Imprimir guia</button>
            ${etiquetas.length ? `<button type="button" data-imprimir-etiquetas>${icone("print")} Imprimir ${etiquetas.length} etiqueta(s)</button>` : ""}
        `
    });

    $("[data-imprimir-guia]", el).addEventListener("click", () => imprimirEtiqueta($("[data-guia]", el)));
    const btnEtiquetas = $("[data-imprimir-etiquetas]", el);
    if (btnEtiquetas) btnEtiquetas.addEventListener("click", () => imprimirEtiqueta($("[data-lote]", el)));
}
