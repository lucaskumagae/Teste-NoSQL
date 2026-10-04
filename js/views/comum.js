// Componentes de produto reutilizados pelas abas.

import { esc, $, $$, fmt, icone, abrirModal, toast, confirmar } from "../ui.js";
import { payloadProduto, payloadUnidade, qrSvg, montarLeitor, lerPayload } from "../qr.js";
import { formatarCodigo, codigoPedido } from "../codigos.js";
import {
    STATUS_PRODUTO,
    TIPOS_MOV,
    CONDICOES,
    CONDICOES_CADASTRO,
    ESTADOS_DEVOLUCAO,
    rotuloMotivo,
    ehIndividual,
    historicoProduto,
    criarProduto,
    atualizarProduto,
    deletarProduto,
    registrarManutencao,
    lerUnidade,
    mensagemDeErro
} from "../servicos.js";

// ─── Badges e chips ───

export function badgeStatus(status) {
    const s = STATUS_PRODUTO[status] || STATUS_PRODUTO.em_estoque;
    return `<span class="badge ${s.cor}">${s.rotulo}</span>`;
}

export function badgeTipo(tipo) {
    const t = TIPOS_MOV[tipo] || { rotulo: tipo, cor: "" };
    return `<span class="badge sem-ponto ${t.cor}">${t.rotulo}</span>`;
}

export function badgeCondicao(produto) {
    const c = CONDICOES[(produto && produto.condicao) || "novo"] || CONDICOES.novo;
    return `<span class="badge sem-ponto ${c.cor}">${c.rotulo}</span>`;
}

export function chipCodigo(codigo) {
    return codigo ? `<span class="codigo-chip" title="Código da peça">${esc(formatarCodigo(codigo))}</span>` : "";
}

export function textoPosicao(posicao) {
    if (!posicao) return "";
    return [
        posicao.setor && `Setor ${posicao.setor}`,
        posicao.corredor && `Corr. ${posicao.corredor}`,
        posicao.prateleira && `Prat. ${posicao.prateleira}`
    ].filter(Boolean).join(" · ");
}

export function chipPosicao(posicao) {
    const texto = textoPosicao(posicao);
    return texto
        ? `<span class="posicao-chip" title="Localização">${esc(texto)}</span>`
        : `<span class="subtle">—</span>`;
}

// Dias até a validade (negativo = vencido). null se não tem validade.
export function diasParaVencer(validade) {
    if (!validade) return null;
    const alvo = new Date(validade + "T00:00:00Z");
    if (isNaN(alvo)) return null;
    const hoje = new Date();
    const hojeUtc = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    return Math.round((alvo - hojeUtc) / 86400000);
}

export function badgeValidade(validade) {
    const dias = diasParaVencer(validade);
    if (dias === null) return "";
    if (dias < 0) return `<span class="badge danger">Vencido</span>`;
    if (dias <= 30) return `<span class="badge warn">Vence em ${dias}d</span>`;
    return "";
}

// Itens individuais aparecem com condição e código: "Furadeira X — aberto · K7Q2-M9XD".
export function rotuloProduto(p) {
    if (ehIndividual(p)) {
        return `${p.nome} — ${CONDICOES[p.condicao].rotulo.toLowerCase()} · ${formatarCodigo(p.codigo || p.id)}`;
    }
    return `${p.nome} — saldo ${fmt.num(p.quantidade)}${p.lote ? " · lote " + p.lote : ""}`;
}

export function opcoesProdutos(produtos, selecionado = "") {
    return `<option value="">Selecione um produto…</option>` + produtos.map((p) => `
        <option value="${esc(p.id)}" ${p.id === selecionado ? "selected" : ""}>${esc(rotuloProduto(p))}</option>
    `).join("");
}

// ─── Leitura de QR em modal (uma leitura) ───

// Interpreta o que foi lido (etiqueta do produto, de uma unidade ou código
// digitado). Devolve { produto, unidade, codigo } ou { erro }.
export async function resolverLeitura(ctx, texto) {
    const lido = lerPayload(texto, ctx.estado.galpaoId);
    if (lido.erro) return { erro: lido.erro };

    if (lido.pedidoId) {
        return { erro: "Esta é a guia de um pedido, não a etiqueta de um produto." };
    }

    if (lido.produtoId) {
        const produto = ctx.produto(lido.produtoId);
        return produto ? { produto, unidade: null } : { erro: "Nenhum produto com este código neste galpão." };
    }

    // Código curto: item individual (o ID do produto é o próprio código) ou
    // unidade de um produto novo que já saiu com etiqueta.
    let unidade = null;
    try {
        unidade = await lerUnidade(ctx.estado.galpaoId, lido.codigo);
    } catch (erro) {
        return { erro: mensagemDeErro(erro, "Não foi possível consultar o código.") };
    }
    const produto = ctx.produto(lido.codigo)
        || (unidade && ctx.produto(unidade.itemId || unidade.produtoId));
    if (!produto && !unidade) return { erro: `Código ${formatarCodigo(lido.codigo)} não encontrado neste galpão.` };
    return { produto, unidade: unidade || null, codigo: lido.codigo };
}

// Abre a câmera; resolve com { produto, unidade, codigo } (ou null se fechar).
export function lerQr(ctx, titulo = "Ler etiqueta") {
    return new Promise((resolve) => {

        let desligar = () => {};
        let resultado = null;
        let ocupado = false;

        const { el, fechar } = abrirModal({
            titulo,
            corpo: `<div data-leitor></div>`,
            aoFechar: () => {
                desligar();
                resolve(resultado);
            }
        });

        desligar = montarLeitor($("[data-leitor]", el), async (texto) => {
            if (ocupado) return;
            ocupado = true;
            const r = await resolverLeitura(ctx, texto);
            ocupado = false;
            if (r.erro) {
                toast(r.erro, "erro");
                return;
            }
            resultado = r;
            fechar();
        });
    });
}

// Atalho para quem só precisa do produto.
export async function lerProdutoPorQr(ctx, titulo = "Ler etiqueta do produto") {
    const r = await lerQr(ctx, titulo);
    return r ? r.produto : null;
}

// ─── Etiqueta QR ───

export function htmlEtiqueta(ctx, produto) {
    if (ehIndividual(produto)) {
        return htmlEtiquetaUnidade(ctx, produto.codigo || produto.id, produto.nome, CONDICOES[produto.condicao].rotulo);
    }
    return `
        <div class="etiqueta" data-etiqueta>
            ${qrSvg(payloadProduto(ctx.estado.galpaoId, produto.id))}
            <div class="etiqueta-nome">${esc(produto.nome)}</div>
            ${textoPosicao(produto.posicao) ? `<div class="etiqueta-meta">${esc(textoPosicao(produto.posicao))}</div>` : ""}
            ${produto.lote ? `<div class="etiqueta-meta">Lote ${esc(produto.lote)}${produto.validade ? " · Val. " + esc(fmt.data(produto.validade)) : ""}</div>` : ""}
            <div class="etiqueta-meta" style="opacity:.6">${esc(produto.id)}</div>
        </div>
    `;
}

// Etiqueta de UMA peça: QR com o código curto, que identifica a unidade.
export function htmlEtiquetaUnidade(ctx, codigo, nome, detalhe = "") {
    return `
        <div class="etiqueta" data-etiqueta>
            ${qrSvg(payloadUnidade(ctx.estado.galpaoId, codigo))}
            <div class="etiqueta-codigo">${esc(formatarCodigo(codigo))}</div>
            <div class="etiqueta-nome">${esc(nome)}</div>
            ${detalhe ? `<div class="etiqueta-meta">${esc(detalhe)}</div>` : ""}
        </div>
    `;
}

// Modal com várias etiquetas de peça para imprimir de uma vez.
export function abrirEtiquetasUnidades(ctx, etiquetas, { titulo = "Etiquetas das peças", texto = "" } = {}) {
    const { el } = abrirModal({
        titulo,
        largo: true,
        corpo: `
            ${texto ? `<p class="muted" style="margin-bottom:14px;">${esc(texto)}</p>` : ""}
            <div class="etiquetas-lote" data-lote>
                ${etiquetas.map((e) => htmlEtiquetaUnidade(ctx, e.codigo, e.nome, e.detalhe)).join("")}
            </div>
        `,
        rodape: `
            <button type="button" class="btn-secondary" data-fechar>Fechar</button>
            <button type="button" data-imprimir>${icone("print")} Imprimir ${etiquetas.length} etiqueta(s)</button>
        `
    });
    $("[data-imprimir]", el).addEventListener("click", () => imprimirEtiqueta($("[data-lote]", el)));
}

export function imprimirEtiqueta(el) {
    el.classList.add("imprimivel");
    window.print();
    el.classList.remove("imprimivel");
}

// ─── Ficha do produto (detalhes + QR + histórico) ───

export function abrirFicha(ctx, produtoId) {

    const produto = ctx.produto(produtoId);
    if (!produto) return;

    const atributos = Object.entries(produto.atributos || {});
    const individual = ehIndividual(produto);
    const base = individual && produto.produtoBaseId ? ctx.produto(produto.produtoBaseId) : null;
    const podeMovimentar = !individual && ["entrada", "saida", "devolucao"].some((a) => ctx.pode(a));
    const podeManutencao = individual && ctx.pode("editarProduto");
    const manutencoes = (produto.manutencoes || []).slice().reverse();

    const { el, fechar } = abrirModal({
        titulo: produto.nome,
        largo: true,
        corpo: `
            <div class="grid-2" style="gap:20px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));">
                <div>
                    <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px;">
                        ${badgeCondicao(produto)} ${badgeStatus(produto.status)} ${badgeValidade(produto.validade)}
                    </div>
                    <table>
                        <tbody>
                            ${individual ? `
                                <tr><td class="muted">Código da peça</td><td class="num">${chipCodigo(produto.codigo || produto.id)}</td></tr>
                                <tr><td class="muted">Situação</td><td class="num">${produto.quantidade === 1 ? "No galpão" : "Fora (saiu em pedido)"}</td></tr>
                                ${base ? `<tr><td class="muted">Produto de origem</td><td class="num"><a href="#" data-base="${esc(base.id)}">${esc(base.nome)}</a></td></tr>` : ""}
                                ${produto.estadoObs ? `<tr><td class="muted">Estado</td><td class="num">${esc(produto.estadoObs)}</td></tr>` : ""}
                            ` : `
                                <tr><td class="muted">Saldo</td><td class="num"><strong>${fmt.num(produto.quantidade)}</strong></td></tr>
                            `}
                            <tr><td class="muted">Categoria</td><td class="num">${esc(produto.categoria || "—")}</td></tr>
                            <tr><td class="muted">Preço unitário</td><td class="num">${fmt.moeda(produto.preco)}</td></tr>
                            <tr><td class="muted">Localização</td><td class="num">${chipPosicao(produto.posicao)}</td></tr>
                            <tr><td class="muted">Lote</td><td class="num">${esc(produto.lote || "—")}</td></tr>
                            <tr><td class="muted">Validade</td><td class="num">${fmt.data(produto.validade)}</td></tr>
                            ${atributos.map(([k, v]) => `<tr><td class="muted">${esc(k)}</td><td class="num">${esc(v)}</td></tr>`).join("")}
                        </tbody>
                    </table>
                </div>
                <div>
                    ${htmlEtiqueta(ctx, produto)}
                    <button type="button" class="btn-secondary btn-block" data-imprimir style="margin-top:10px;">
                        ${icone("print")} Imprimir etiqueta
                    </button>
                </div>
            </div>

            ${manutencoes.length ? `
                <h3 style="margin:24px 0 6px;">Manutenções</h3>
                <ul class="timeline">
                    ${manutencoes.map((m) => `
                        <li>
                            <span class="badge sem-ponto violet">Manutenção</span>
                            <div>
                                <div>${esc(m.descricao)}</div>
                                <div class="subtle">${esc(m.nome)} · ${fmt.dataHora(m.em)}${m.condicaoAnterior ? " · era " + esc((CONDICOES[m.condicaoAnterior] || {}).rotulo || m.condicaoAnterior) : ""}</div>
                            </div>
                            <span></span>
                        </li>
                    `).join("")}
                </ul>
            ` : ""}

            <h3 style="margin:24px 0 6px;">Histórico de movimentações</h3>
            <div data-historico><p class="subtle">Carregando…</p></div>
        `,
        rodape: `
            ${podeManutencao ? `<button type="button" class="btn-secondary" data-manutencao style="margin-right:auto;">Registrar manutenção</button>` : ""}
            ${ctx.pode("editarProduto") ? `<button type="button" class="btn-secondary" data-editar>${icone("edit")} Editar</button>` : ""}
            ${podeMovimentar ? `<button type="button" data-movimentar>${icone("swap")} Movimentar</button>` : ""}
        `
    });

    $("[data-imprimir]", el).addEventListener("click", () => imprimirEtiqueta($("[data-etiqueta]", el)));

    const btnEditar = $("[data-editar]", el);
    if (btnEditar) btnEditar.addEventListener("click", () => {
        fechar();
        abrirFormProduto(ctx, produtoId);
    });

    const btnMov = $("[data-movimentar]", el);
    if (btnMov) btnMov.addEventListener("click", () => {
        fechar();
        ctx.irPara("movimentar", { produtoId });
    });

    const linkBase = $("[data-base]", el);
    if (linkBase) linkBase.addEventListener("click", (e) => {
        e.preventDefault();
        fechar();
        abrirFicha(ctx, linkBase.dataset.base);
    });

    const btnManut = $("[data-manutencao]", el);
    if (btnManut) btnManut.addEventListener("click", () => {
        fechar();
        abrirManutencao(ctx, produtoId);
    });

    carregarHistorico(ctx, produtoId, $("[data-historico]", el));
}

export async function carregarHistorico(ctx, produtoId, alvo, max = 100) {
    // Clique em "Pedido #…" leva à aba Pedidos com o pedido em destaque.
    alvo.onclick = (e) => {
        const link = e.target.closest("[data-ir-pedido]");
        if (!link) return;
        e.preventDefault();
        const dialog = alvo.closest("dialog");
        if (dialog) dialog.close();
        ctx.irPara("pedidos", { pedidoId: link.dataset.irPedido });
    };

    try {
        const movs = await historicoProduto(ctx.estado.galpaoId, produtoId, max);
        alvo.innerHTML = htmlTimeline(movs);
    } catch (erro) {
        alvo.innerHTML = `<p class="subtle">${esc(mensagemDeErro(erro, "Não foi possível carregar o histórico."))}</p>`;
    }
}

export function htmlTimeline(movs) {
    if (movs.length === 0) {
        return `<div class="vazio"><strong>Sem movimentações ainda</strong>Entradas, saídas e devoluções aparecerão aqui.</div>`;
    }

    return `<ul class="timeline">${movs.map((m) => {
        const classeDelta = m.delta > 0 ? "pos" : m.delta < 0 ? "neg" : "zero";
        const sinal = m.delta > 0 ? "+" : "";
        const detalhes = [
            m.estado && `Voltou: ${(ESTADOS_DEVOLUCAO[m.estado] || m.estado).toLowerCase()}`,
            m.motivo && `Motivo: ${rotuloMotivo(m.motivo)}`,
            m.motivo === "avariado" && "não retornou ao saldo",
            m.tipo === "saida" && !m.pedidoId && "Saída avulsa (sem pedido)",
            m.observacao
        ].filter(Boolean).join(" · ");

        const codigos = m.codigos || [];
        const linkPedido = m.pedidoId
            ? `<a href="#" data-ir-pedido="${esc(m.pedidoId)}">Pedido #${esc(codigoPedido({ id: m.pedidoId, codigo: m.pedidoCodigo }))}</a>`
            : "";

        return `
            <li>
                ${badgeTipo(m.tipo)}
                <div>
                    <div>${esc(m.usuarioNome || "—")} <span class="subtle">· ${fmt.dataHora(m.criadoEm)}</span></div>
                    ${linkPedido || detalhes ? `<div class="subtle">${linkPedido}${linkPedido && detalhes ? " · " : ""}${esc(detalhes)}</div>` : ""}
                    ${codigos.length ? `<div class="codigos-lista">${codigos.slice(0, 6).map(chipCodigo).join("")}${codigos.length > 6 ? `<span class="subtle">+${codigos.length - 6}</span>` : ""}</div>` : ""}
                </div>
                <div style="text-align:right">
                    <div class="delta ${classeDelta}">${sinal}${fmt.num(m.delta)}</div>
                    <div class="subtle">saldo ${fmt.num(m.saldoApos)}</div>
                </div>
            </li>
        `;
    }).join("")}</ul>`;
}

// ─── Formulário de produto (criar / editar) ───

export function abrirFormProduto(ctx, produtoId = null) {

    const produto = produtoId ? ctx.produto(produtoId) : null;
    const editando = Boolean(produto);
    const p = produto || {};
    const pos = p.posicao || {};
    const individual = editando && ehIndividual(p);
    let condicao = "novo"; // só usada no cadastro

    const categorias = [...new Set(ctx.estado.produtos.map((x) => x.categoria).filter(Boolean))];

    const { el, fechar } = abrirModal({
        titulo: editando ? "Editar produto" : "Novo produto",
        largo: true,
        corpo: `
            <form id="form-produto" novalidate>
                <div class="form-row">
                    <div class="form-group" style="grid-column: 1 / -1;">
                        <label for="fp-nome">Nome</label>
                        <input type="text" id="fp-nome" required value="${esc(p.nome)}">
                    </div>
                </div>

                ${editando ? (individual ? `
                    <p style="margin:-4px 0 14px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                        ${badgeCondicao(p)} ${chipCodigo(p.codigo || p.id)}
                        <span class="subtle">Item individual: a condição muda por devolução ou manutenção.</span>
                    </p>
                ` : "") : `
                    <div class="form-group">
                        <span class="label" id="fp-condicao-rotulo">Condição</span>
                        <div class="segmentado" role="group" aria-labelledby="fp-condicao-rotulo">
                            ${CONDICOES_CADASTRO.map((c) => `
                                <button type="button" data-condicao="${c}" aria-pressed="${c === "novo"}">${CONDICOES[c].rotulo}</button>
                            `).join("")}
                        </div>
                        <p class="subtle" data-condicao-dica style="margin-top:6px;"></p>
                    </div>
                `}

                <div class="form-row">
                    <div class="form-group">
                        <label for="fp-categoria">Categoria</label>
                        <input type="text" id="fp-categoria" list="fp-categorias" placeholder="Ex: Roupa, Eletrônico, Alimento" required value="${esc(p.categoria)}">
                        <datalist id="fp-categorias">${categorias.map((c) => `<option value="${esc(c)}">`).join("")}</datalist>
                    </div>
                    <div class="form-group">
                        <label for="fp-preco">Preço unitário (R$)</label>
                        <input type="number" id="fp-preco" min="0" step="0.01" required value="${p.preco ?? ""}">
                    </div>
                    <div class="form-group ${individual ? "hidden" : ""}" data-qtd-grupo>
                        <label for="fp-quantidade">${editando ? "Saldo atual" : "Quantidade inicial"}</label>
                        <input type="number" id="fp-quantidade" min="0" step="1" value="${editando ? p.quantidade : 0}" ${editando ? "readonly" : ""}>
                    </div>
                </div>
                ${editando && !individual ? `<p class="subtle" style="margin:-6px 0 14px;">O saldo só muda por movimentação (aba Movimentar) ou reconciliação — assim o histórico fica sempre correto.</p>` : ""}

                <div class="form-group ${individual ? "" : "hidden"}" data-estado-grupo>
                    <label for="fp-estado">Estado da peça <span class="subtle">(marcas de uso, o que foi trocado…)</span></label>
                    <textarea id="fp-estado" placeholder="Ex: bateria nova, arranhado na lateral">${esc(p.estadoObs)}</textarea>
                </div>

                <fieldset>
                    <legend>Localização no galpão</legend>
                    <div class="form-row">
                        <div class="form-group">
                            <label for="fp-setor">Setor</label>
                            <input type="text" id="fp-setor" placeholder="Ex: A" value="${esc(pos.setor)}">
                        </div>
                        <div class="form-group">
                            <label for="fp-corredor">Corredor</label>
                            <input type="text" id="fp-corredor" placeholder="Ex: 03" value="${esc(pos.corredor)}">
                        </div>
                        <div class="form-group">
                            <label for="fp-prateleira">Prateleira</label>
                            <input type="text" id="fp-prateleira" placeholder="Ex: 2B" value="${esc(pos.prateleira)}">
                        </div>
                    </div>
                </fieldset>

                <fieldset>
                    <legend>Lote e validade (opcional)</legend>
                    <div class="form-row">
                        <div class="form-group">
                            <label for="fp-lote">Lote</label>
                            <input type="text" id="fp-lote" value="${esc(p.lote)}">
                        </div>
                        <div class="form-group">
                            <label for="fp-validade">Validade</label>
                            <input type="date" id="fp-validade" value="${esc(p.validade)}">
                        </div>
                    </div>
                </fieldset>

                ${editando && ctx.pode("alterarStatus") ? `
                    <div class="form-group">
                        <label for="fp-status">Status</label>
                        <select id="fp-status">
                            ${Object.entries(STATUS_PRODUTO).map(([k, s]) => `
                                <option value="${k}" ${(p.status || "em_estoque") === k ? "selected" : ""}>${s.rotulo}</option>
                            `).join("")}
                        </select>
                    </div>
                ` : ""}

                <fieldset>
                    <legend>Atributos extras (específicos da categoria)</legend>
                    <div data-atributos></div>
                    <button type="button" class="btn-ghost btn-sm" data-add-atributo style="margin-bottom:12px;">
                        ${icone("plus")} Adicionar atributo
                    </button>
                </fieldset>

                <p class="form-message" data-msg></p>
            </form>
        `,
        rodape: `
            ${editando && ctx.pode("deletarProduto") ? `<button type="button" class="btn-danger" data-deletar style="margin-right:auto;">${icone("trash")} Excluir</button>` : ""}
            <button type="button" class="btn-secondary" data-fechar>Cancelar</button>
            <button type="submit" form="form-produto">${editando ? "Salvar alterações" : "Cadastrar produto"}</button>
        `
    });

    const form = $("#form-produto", el);
    const atributosEl = $("[data-atributos]", el);
    const msg = $("[data-msg]", el);

    function adicionarAtributo(chave = "", valor = "") {
        const linha = document.createElement("div");
        linha.className = "itens-editor";
        linha.innerHTML = `
            <div class="item-linha" style="grid-template-columns: 1fr 1fr 32px;">
                <input type="text" class="atributo-chave" placeholder="Ex: cor" value="${esc(chave)}" aria-label="Nome do atributo">
                <input type="text" class="atributo-valor" placeholder="Ex: azul" value="${esc(valor)}" aria-label="Valor do atributo">
                <button type="button" class="btn-ghost btn-icon" aria-label="Remover atributo">${icone("x")}</button>
            </div>
        `;
        $("button", linha).addEventListener("click", () => linha.remove());
        atributosEl.appendChild(linha);
    }

    Object.entries(p.atributos || {}).forEach(([k, v]) => adicionarAtributo(k, v));
    $("[data-add-atributo]", el).addEventListener("click", () => adicionarAtributo());

    const btnDeletar = $("[data-deletar]", el);
    if (btnDeletar) btnDeletar.addEventListener("click", async () => {
        const ok = await confirmar(
            `Excluir "${p.nome}"? O produto sai da lista; esta ação não pode ser desfeita.`,
            { titulo: "Excluir produto", botao: "Excluir", perigo: true }
        );
        if (!ok) return;
        try {
            await deletarProduto(ctx.estado.galpaoId, produtoId);
            toast("Produto excluído.", "ok");
            fechar();
        } catch (erro) {
            toast(mensagemDeErro(erro, "Erro ao excluir o produto."), "erro");
        }
    });

    // Condição no cadastro: usado/recondicionado entra com 1 unidade e
    // código próprio; o campo de quantidade some.
    const DICAS_CONDICAO = {
        novo: "Controlado por quantidade: todas as unidades são iguais.",
        usado: "Item individual: entra com 1 unidade e ganha um código e etiqueta próprios.",
        recondicionado: "Item individual que passou por manutenção (ex.: troca de bateria). Entra com 1 unidade e código próprio."
    };

    function selecionarCondicao(nova) {
        condicao = nova;
        $$("[data-condicao]", el).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.condicao === condicao)));
        $("[data-condicao-dica]", el).textContent = DICAS_CONDICAO[condicao];
        $("[data-qtd-grupo]", el).classList.toggle("hidden", condicao !== "novo");
        $("[data-estado-grupo]", el).classList.toggle("hidden", condicao === "novo");
    }

    if (!editando) {
        $$("[data-condicao]", el).forEach((b) => b.addEventListener("click", () => selecionarCondicao(b.dataset.condicao)));
        selecionarCondicao("novo");
    }

    $("#fp-nome", el).focus();

    form.addEventListener("submit", async (event) => {
        event.preventDefault();

        const valor = (id) => $(id, el).value.trim();

        const atributos = {};
        $$(".item-linha", atributosEl).forEach((linha) => {
            const chave = $(".atributo-chave", linha).value.trim();
            if (chave) atributos[chave] = $(".atributo-valor", linha).value.trim();
        });

        const dados = {
            nome: valor("#fp-nome"),
            categoria: valor("#fp-categoria"),
            preco: Number(valor("#fp-preco")),
            posicao: {
                setor: valor("#fp-setor"),
                corredor: valor("#fp-corredor"),
                prateleira: valor("#fp-prateleira")
            },
            lote: valor("#fp-lote"),
            validade: valor("#fp-validade"),
            atributos
        };

        const statusEl = $("#fp-status", el);
        if (statusEl) dados.status = statusEl.value;

        if (!editando) dados.condicao = condicao;
        if (individual || (!editando && condicao !== "novo")) dados.estadoObs = valor("#fp-estado");

        if (!dados.nome || !dados.categoria) {
            msg.textContent = "Preencha nome e categoria.";
            msg.className = "form-message erro";
            return;
        }

        if (!(dados.preco >= 0) || valor("#fp-preco") === "") {
            msg.textContent = "Informe um preço válido.";
            msg.className = "form-message erro";
            return;
        }

        const quantidadeInicial = Number(valor("#fp-quantidade") || 0);
        if (!editando && (!Number.isInteger(quantidadeInicial) || quantidadeInicial < 0)) {
            msg.textContent = "A quantidade inicial deve ser um número inteiro.";
            msg.className = "form-message erro";
            return;
        }

        const botao = $('button[type="submit"]', el);
        botao.disabled = true;

        try {
            if (editando) {
                await atualizarProduto(ctx.estado.galpaoId, produtoId, dados);
                toast("Produto atualizado.", "ok");
            } else {
                const criado = await criarProduto(ctx.estado.galpaoId, dados, quantidadeInicial, ctx.usuario);
                toast("Produto cadastrado.", "ok");
                fechar();
                // Item individual: a etiqueta própria já pode ser impressa.
                if (criado.codigo) {
                    abrirEtiquetasUnidades(ctx, [{ codigo: criado.codigo, nome: dados.nome, detalhe: CONDICOES[condicao].rotulo }], {
                        titulo: "Etiqueta do item",
                        texto: "Cole esta etiqueta na peça. O código identifica esta unidade em pedidos e devoluções."
                    });
                }
                return;
            }
            fechar();
        } catch (erro) {
            msg.textContent = mensagemDeErro(erro, "Erro ao salvar o produto.");
            msg.className = "form-message erro";
            botao.disabled = false;
        }
    });
}

// ─── Manutenção de item individual ───

export function abrirManutencao(ctx, produtoId) {

    const produto = ctx.produto(produtoId);
    if (!produto) return;

    const { el, fechar } = abrirModal({
        titulo: "Registrar manutenção",
        corpo: `
            <p style="margin-bottom:12px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                <strong>${esc(produto.nome)}</strong> ${chipCodigo(produto.codigo || produto.id)} ${badgeCondicao(produto)}
            </p>
            <form id="form-manutencao" novalidate>
                <div class="form-group">
                    <label for="mn-desc">O que foi feito</label>
                    <textarea id="mn-desc" placeholder="Ex: troca de bateria, limpeza, substituição do cabo" required></textarea>
                </div>
                <p class="subtle">Depois de registrada, a peça passa a “Recondicionado” e volta a poder ser pedida.</p>
                <p class="form-message" data-msg></p>
            </form>
        `,
        rodape: `
            <button type="button" class="btn-secondary" data-fechar>Cancelar</button>
            <button type="submit" form="form-manutencao">Registrar</button>
        `
    });

    $("#mn-desc", el).focus();

    $("#form-manutencao", el).addEventListener("submit", async (e) => {
        e.preventDefault();
        const botao = $('button[type="submit"]', el);
        botao.disabled = true;
        try {
            await registrarManutencao(ctx.estado.galpaoId, produtoId, $("#mn-desc", el).value.trim(), ctx.usuario);
            toast("Manutenção registrada; peça recondicionada.", "ok");
            fechar();
        } catch (erro) {
            const msg = $("[data-msg]", el);
            msg.textContent = mensagemDeErro(erro, "Erro ao registrar a manutenção.");
            msg.className = "form-message erro";
            botao.disabled = false;
        }
    });
}

// ─── Consulta de uma unidade (etiqueta de peça de produto novo) ───

const ACOES_UNIDADE = {
    saida: "Saiu no pedido",
    devolucao: "Voltou",
    cadastro: "Cadastrada",
    manutencao: "Manutenção"
};

export function abrirUnidade(ctx, unidade) {

    const produto = ctx.produto(unidade.itemId || unidade.produtoId);
    const eventos = (unidade.eventos || []).slice().reverse();

    const { el, fechar } = abrirModal({
        titulo: `Peça ${formatarCodigo(unidade.codigo)}`,
        corpo: `
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:12px;">
                <strong>${esc(unidade.produtoNome || (produto && produto.nome) || "—")}</strong>
                ${badgeCondicao({ condicao: unidade.condicao })}
                <span class="badge ${unidade.status === "fora" ? "warn" : "ok"}">${unidade.status === "fora" ? "Fora do estoque" : "No galpão"}</span>
            </div>
            ${unidade.status === "fora" && unidade.pedidoId ? `
                <p class="muted" style="margin-bottom:12px;">
                    Saiu no <a href="#" data-ir-pedido="${esc(unidade.pedidoId)}">pedido #${esc(codigoPedido({ id: unidade.pedidoId, codigo: unidade.pedidoCodigo }))}</a>.
                </p>` : ""}
            <h3 style="margin:16px 0 6px;">Histórico da peça</h3>
            <ul class="timeline">
                ${eventos.map((ev) => `
                    <li>
                        <span class="badge sem-ponto">${esc(ACOES_UNIDADE[ev.status] || ev.status)}</span>
                        <div>
                            <div>${esc(ev.nome || "—")} <span class="subtle">· ${fmt.dataHora(ev.em)}</span></div>
                            <div class="subtle">${esc([
                                ev.pedidoCodigo && `Pedido #${formatarCodigo(ev.pedidoCodigo)}`,
                                ev.estado && `voltou ${(ESTADOS_DEVOLUCAO[ev.estado] || ev.estado).toLowerCase()}`,
                                ev.motivo && `motivo: ${rotuloMotivo(ev.motivo)}`,
                                ev.descricao
                            ].filter(Boolean).join(" · "))}</div>
                        </div>
                        <span></span>
                    </li>
                `).join("")}
            </ul>
        `,
        rodape: `
            ${produto ? `<button type="button" class="btn-secondary" data-produto>Ver produto</button>` : ""}
            <button type="button" data-fechar>Fechar</button>
        `
    });

    el.addEventListener("click", (e) => {
        const link = e.target.closest("[data-ir-pedido]");
        if (!link) return;
        e.preventDefault();
        fechar();
        ctx.irPara("pedidos", { pedidoId: link.dataset.irPedido });
    });

    const btnProduto = $("[data-produto]", el);
    if (btnProduto) btnProduto.addEventListener("click", () => {
        fechar();
        abrirFicha(ctx, produto.id);
    });
}
