// Aba "Estoque": indicadores, busca/filtros e lista de produtos.

import { esc, $, fmt, icone } from "../ui.js";
import { STATUS_PRODUTO } from "../servicos.js";
import {
    badgeStatus,
    badgeValidade,
    chipPosicao,
    diasParaVencer,
    abrirFicha,
    abrirFormProduto,
    lerProdutoPorQr,
    textoPosicao
} from "./comum.js";

export function montarEstoque(el, ctx) {

    el.innerHTML = `
        <div class="pagina-topo">
            <div>
                <h1>Estoque</h1>
                <p>Produtos, saldos e onde encontrar cada um.</p>
            </div>
            <div class="acoes">
                <button type="button" class="btn-secondary" data-ler>${icone("scan")} Ler QR</button>
                ${ctx.pode("editarProduto") ? `<button type="button" data-novo>${icone("plus")} Novo produto</button>` : ""}
            </div>
        </div>

        <div class="kpis" data-kpis></div>

        <div class="card">
            <div class="toolbar">
                <input type="search" data-busca placeholder="Buscar por nome, categoria, lote, localização…" aria-label="Buscar produtos">
                <select data-filtro-categoria aria-label="Filtrar por categoria"></select>
                <select data-filtro-status aria-label="Filtrar por status">
                    <option value="">Todos os status</option>
                    ${Object.entries(STATUS_PRODUTO).map(([k, s]) => `<option value="${k}">${s.rotulo}</option>`).join("")}
                    <option value="__vencendo">Vencidos / vencendo</option>
                </select>
            </div>
            <div class="tabela-wrap" data-tabela></div>
        </div>
    `;

    const kpisEl = $("[data-kpis]", el);
    const tabelaEl = $("[data-tabela]", el);
    const buscaEl = $("[data-busca]", el);
    const categoriaEl = $("[data-filtro-categoria]", el);
    const statusEl = $("[data-filtro-status]", el);

    const btnNovo = $("[data-novo]", el);
    if (btnNovo) btnNovo.addEventListener("click", () => abrirFormProduto(ctx));

    $("[data-ler]", el).addEventListener("click", async () => {
        const produto = await lerProdutoPorQr(ctx);
        if (produto) abrirFicha(ctx, produto.id);
    });

    [buscaEl, categoriaEl, statusEl].forEach((c) => c.addEventListener("input", renderTabela));

    tabelaEl.addEventListener("click", (e) => {
        const linha = e.target.closest("[data-id]");
        if (!linha) return;
        const id = linha.dataset.id;
        const acao = e.target.closest("[data-acao]");

        if (!acao) return abrirFicha(ctx, id);

        switch (acao.dataset.acao) {
            case "editar": return abrirFormProduto(ctx, id);
            case "movimentar": return ctx.irPara("movimentar", { produtoId: id });
            default: return abrirFicha(ctx, id);
        }
    });

    function renderKpis() {
        const produtos = ctx.estado.produtos;
        const unidades = produtos.reduce((s, p) => s + (p.quantidade || 0), 0);
        const valor = produtos.reduce((s, p) => s + (p.quantidade || 0) * (p.preco || 0), 0);
        const vencendo = produtos.filter((p) => {
            const d = diasParaVencer(p.validade);
            return d !== null && d <= 30 && p.quantidade > 0;
        }).length;
        const pendentes = ctx.estado.pedidos.filter((p) => ["pendente", "aprovado", "em_separacao"].includes(p.status)).length;

        kpisEl.innerHTML = `
            <div class="kpi"><div class="rotulo">Produtos</div><div class="valor">${fmt.num(produtos.length)}</div></div>
            <div class="kpi"><div class="rotulo">Unidades</div><div class="valor">${fmt.num(unidades)}</div></div>
            <div class="kpi"><div class="rotulo">Valor em estoque</div><div class="valor">${fmt.moeda(valor)}</div></div>
            <div class="kpi ${vencendo ? "alerta" : ""}"><div class="rotulo">Vencidos / ≤ 30 dias</div><div class="valor">${fmt.num(vencendo)}</div></div>
            <div class="kpi"><div class="rotulo">Pedidos em aberto</div><div class="valor">${fmt.num(pendentes)}</div></div>
        `;
    }

    function renderCategorias() {
        const atual = categoriaEl.value;
        const categorias = [...new Set(ctx.estado.produtos.map((p) => p.categoria).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, "pt-BR"));
        categoriaEl.innerHTML = `<option value="">Todas as categorias</option>` +
            categorias.map((c) => `<option value="${esc(c)}" ${c === atual ? "selected" : ""}>${esc(c)}</option>`).join("");
    }

    function filtrados() {
        const termo = buscaEl.value.trim().toLowerCase();
        const categoria = categoriaEl.value;
        const status = statusEl.value;

        return ctx.estado.produtos.filter((p) => {
            if (categoria && p.categoria !== categoria) return false;

            if (status === "__vencendo") {
                const d = diasParaVencer(p.validade);
                if (d === null || d > 30) return false;
            } else if (status && (p.status || "em_estoque") !== status) {
                return false;
            }

            if (!termo) return true;

            const texto = [
                p.nome, p.categoria, p.lote, p.id, textoPosicao(p.posicao),
                ...Object.values(p.atributos || {})
            ].join(" ").toLowerCase();
            return texto.includes(termo);
        });
    }

    function renderTabela() {
        const lista = filtrados();
        const podeMov = ["entrada", "saida", "devolucao"].some((a) => ctx.pode(a));

        if (ctx.estado.produtos.length === 0) {
            tabelaEl.innerHTML = `
                <div class="vazio">
                    <strong>Nenhum produto cadastrado</strong>
                    ${ctx.pode("editarProduto") ? "Clique em “Novo produto” para começar." : "Quando alguém cadastrar produtos, eles aparecem aqui."}
                </div>`;
            return;
        }

        if (lista.length === 0) {
            tabelaEl.innerHTML = `<div class="vazio"><strong>Nada encontrado</strong>Ajuste a busca ou os filtros.</div>`;
            return;
        }

        tabelaEl.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Produto</th>
                        <th>Localização</th>
                        <th>Status</th>
                        <th class="num">Saldo</th>
                        <th class="num">Preço</th>
                        <th><span class="hidden">Ações</span></th>
                    </tr>
                </thead>
                <tbody>
                    ${lista.map((p) => `
                        <tr data-id="${esc(p.id)}" style="cursor:pointer">
                            <td>
                                <div class="produto-nome">${esc(p.nome)}</div>
                                <div class="produto-meta">
                                    ${esc(p.categoria || "")}${p.lote ? " · lote " + esc(p.lote) : ""}${p.validade ? " · val. " + fmt.data(p.validade) : ""}
                                    ${badgeValidade(p.validade)}
                                </div>
                            </td>
                            <td>${chipPosicao(p.posicao)}</td>
                            <td>${badgeStatus(p.status)}</td>
                            <td class="num"><strong>${fmt.num(p.quantidade)}</strong></td>
                            <td class="num">${fmt.moeda(p.preco)}</td>
                            <td class="acoes-celula">
                                <button type="button" class="btn-ghost btn-icon" data-acao="ficha" title="Ficha, QR e histórico" aria-label="Ficha de ${esc(p.nome)}">${icone("qr")}</button>
                                ${podeMov ? `<button type="button" class="btn-ghost btn-icon" data-acao="movimentar" title="Movimentar" aria-label="Movimentar ${esc(p.nome)}">${icone("swap")}</button>` : ""}
                                ${ctx.pode("editarProduto") ? `<button type="button" class="btn-ghost btn-icon" data-acao="editar" title="Editar" aria-label="Editar ${esc(p.nome)}">${icone("edit")}</button>` : ""}
                            </td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        `;
    }

    return {
        atualizar() {
            renderKpis();
            renderCategorias();
            renderTabela();
        }
    };
}
