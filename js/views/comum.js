// Componentes de produto reutilizados pelas abas.

import { esc, $, $$, fmt, icone, abrirModal, toast, confirmar } from "../ui.js";
import { payloadProduto, qrSvg, montarLeitor, lerPayload } from "../qr.js";
import {
    STATUS_PRODUTO,
    TIPOS_MOV,
    MOTIVOS_DEVOLUCAO,
    historicoProduto,
    criarProduto,
    atualizarProduto,
    deletarProduto,
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

export function opcoesProdutos(produtos, selecionado = "") {
    return `<option value="">Selecione um produto…</option>` + produtos.map((p) => `
        <option value="${esc(p.id)}" ${p.id === selecionado ? "selected" : ""}>
            ${esc(p.nome)} — saldo ${fmt.num(p.quantidade)}${p.lote ? " · lote " + esc(p.lote) : ""}
        </option>
    `).join("");
}

// ─── Leitura de QR em modal (uma leitura) ───

// Abre a câmera, resolve com o produto lido (ou null se fechar).
export function lerProdutoPorQr(ctx, titulo = "Ler etiqueta do produto") {
    return new Promise((resolve) => {

        let desligar = () => {};
        let resultado = null;

        const { el, fechar } = abrirModal({
            titulo,
            corpo: `<div data-leitor></div>`,
            aoFechar: () => {
                desligar();
                resolve(resultado);
            }
        });

        desligar = montarLeitor($("[data-leitor]", el), (texto) => {
            const lido = lerPayload(texto, ctx.estado.galpaoId);
            if (lido.erro) {
                toast(lido.erro, "erro");
                return;
            }
            const produto = ctx.produto(lido.produtoId);
            if (!produto) {
                toast("Nenhum produto com este código neste galpão.", "erro");
                return;
            }
            resultado = produto;
            fechar();
        });
    });
}

// ─── Etiqueta QR ───

export function htmlEtiqueta(ctx, produto) {
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
    const podeMovimentar = ["entrada", "saida", "devolucao"].some((a) => ctx.pode(a));

    const { el, fechar } = abrirModal({
        titulo: produto.nome,
        largo: true,
        corpo: `
            <div class="grid-2" style="gap:20px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));">
                <div>
                    <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px;">
                        ${badgeStatus(produto.status)} ${badgeValidade(produto.validade)}
                    </div>
                    <table>
                        <tbody>
                            <tr><td class="muted">Saldo</td><td class="num"><strong>${fmt.num(produto.quantidade)}</strong></td></tr>
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

            <h3 style="margin:24px 0 6px;">Histórico de movimentações</h3>
            <div data-historico><p class="subtle">Carregando…</p></div>
        `,
        rodape: `
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

    carregarHistorico(ctx, produtoId, $("[data-historico]", el));
}

export async function carregarHistorico(ctx, produtoId, alvo, max = 100) {
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
            m.motivo && `Motivo: ${MOTIVOS_DEVOLUCAO[m.motivo] || m.motivo}`,
            m.motivo === "avariado" && "não retornou ao saldo",
            m.pedidoId && `Pedido #${m.pedidoId.slice(0, 6)}`,
            m.observacao
        ].filter(Boolean).join(" · ");

        return `
            <li>
                ${badgeTipo(m.tipo)}
                <div>
                    <div>${esc(m.usuarioNome || "—")} <span class="subtle">· ${fmt.dataHora(m.criadoEm)}</span></div>
                    ${detalhes ? `<div class="subtle">${esc(detalhes)}</div>` : ""}
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
                    <div class="form-group">
                        <label for="fp-quantidade">${editando ? "Saldo atual" : "Quantidade inicial"}</label>
                        <input type="number" id="fp-quantidade" min="0" step="1" value="${editando ? p.quantidade : 0}" ${editando ? "readonly" : ""}>
                    </div>
                </div>
                ${editando ? `<p class="subtle" style="margin:-6px 0 14px;">O saldo só muda por movimentação (aba Movimentar) ou reconciliação — assim o histórico fica sempre correto.</p>` : ""}

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
                await criarProduto(ctx.estado.galpaoId, dados, quantidadeInicial, ctx.usuario);
                toast("Produto cadastrado.", "ok");
            }
            fechar();
        } catch (erro) {
            msg.textContent = mensagemDeErro(erro, "Erro ao salvar o produto.");
            msg.className = "form-message erro";
            botao.disabled = false;
        }
    });
}
