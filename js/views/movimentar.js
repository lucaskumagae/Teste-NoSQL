// Aba "Movimentar": entrada, saída e devolução de um produto,
// com seleção pela lista ou por leitura do QR code.

import { esc, $, $$, fmt, icone, toast, mensagem } from "../ui.js";
import { TIPOS_MOV, MOTIVOS_DEVOLUCAO, registrarMovimentacao, mensagemDeErro } from "../servicos.js";
import {
    badgeStatus,
    badgeValidade,
    textoPosicao,
    opcoesProdutos,
    lerProdutoPorQr,
    carregarHistorico
} from "./comum.js";

const TIPOS = ["entrada", "saida", "devolucao"];

const DICAS = {
    entrada: "Recebimento de mercadoria: soma ao saldo.",
    saida: "Retirada avulsa: subtrai do saldo. Para retiradas solicitadas, use a aba Pedidos.",
    devolucao: "Retorno de mercadoria. Devoluções com motivo “Avariado” ficam registradas, mas não voltam ao saldo."
};

export function montarMovimentar(el, ctx) {

    const tiposPermitidos = TIPOS.filter((t) => ctx.pode(t));
    let tipo = tiposPermitidos[0];
    let produtoId = "";

    el.innerHTML = `
        <div class="pagina-topo">
            <div>
                <h1>Movimentar</h1>
                <p>Registre entradas, saídas e devoluções. Cada registro entra no histórico do produto.</p>
            </div>
        </div>

        <div class="grid-2">
            <div class="card">
                <div class="card-corpo">
                    <form data-form novalidate>
                        <div class="segmentado" role="group" aria-label="Tipo de movimentação" style="margin-bottom:8px;">
                            ${tiposPermitidos.map((t) => `
                                <button type="button" data-tipo="${t}" aria-pressed="${t === tipo}">${TIPOS_MOV[t].rotulo}</button>
                            `).join("")}
                        </div>
                        <p class="subtle" data-dica style="margin-bottom:16px;"></p>

                        <div class="form-group">
                            <label for="mv-produto">Produto</label>
                            <div class="busca-produto">
                                <select id="mv-produto"></select>
                                <button type="button" class="btn-secondary" data-ler title="Ler QR">${icone("scan")} QR</button>
                            </div>
                        </div>

                        <div data-alvo></div>

                        <div class="form-row">
                            <div class="form-group">
                                <label for="mv-quantidade">Quantidade</label>
                                <input type="number" id="mv-quantidade" min="1" step="1" required>
                            </div>
                            <div class="form-group" data-motivo-grupo>
                                <label for="mv-motivo">Motivo da devolução</label>
                                <select id="mv-motivo">
                                    <option value="">Selecione…</option>
                                    ${Object.entries(MOTIVOS_DEVOLUCAO).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
                                </select>
                            </div>
                        </div>

                        <div class="form-group">
                            <label for="mv-obs">Observação <span class="subtle">(opcional)</span></label>
                            <input type="text" id="mv-obs" placeholder="Ex: NF 1234, fornecedor X, cliente Y…">
                        </div>

                        <button type="submit" class="btn-block" data-enviar>Registrar</button>
                        <p class="form-message" data-msg></p>
                    </form>
                </div>
            </div>

            <div class="card">
                <div class="card-topo"><h2>Últimas movimentações do produto</h2></div>
                <div class="card-corpo" data-historico>
                    <p class="subtle">Selecione um produto para ver o histórico.</p>
                </div>
            </div>
        </div>
    `;

    const form = $("[data-form]", el);
    const selectEl = $("#mv-produto", el);
    const alvoEl = $("[data-alvo]", el);
    const qtdEl = $("#mv-quantidade", el);
    const motivoGrupo = $("[data-motivo-grupo]", el);
    const motivoEl = $("#mv-motivo", el);
    const obsEl = $("#mv-obs", el);
    const msg = $("[data-msg]", el);
    const historicoEl = $("[data-historico]", el);
    const enviarBtn = $("[data-enviar]", el);

    function selecionarTipo(novo) {
        tipo = novo;
        $$("[data-tipo]", el).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tipo === tipo)));
        $("[data-dica]", el).textContent = DICAS[tipo];
        motivoGrupo.classList.toggle("hidden", tipo !== "devolucao");
        enviarBtn.textContent = `Registrar ${TIPOS_MOV[tipo].rotulo.toLowerCase()}`;
        mensagem(msg, "");
    }

    function selecionarProduto(id) {
        produtoId = id;
        selectEl.value = id;
        renderAlvo();
        if (id) {
            historicoEl.innerHTML = `<p class="subtle">Carregando…</p>`;
            carregarHistorico(ctx, id, historicoEl, 10);
        } else {
            historicoEl.innerHTML = `<p class="subtle">Selecione um produto para ver o histórico.</p>`;
        }
    }

    // Cartão com o produto escolhido — mostra a localização em destaque
    // para o separador/conferente achar o item rápido.
    function renderAlvo() {
        const p = ctx.produto(produtoId);
        if (!p) {
            alvoEl.innerHTML = "";
            return;
        }
        const posicao = textoPosicao(p.posicao);
        alvoEl.innerHTML = `
            <div class="produto-alvo">
                <div class="info">
                    <div class="grande">${esc(p.nome)}</div>
                    <div class="subtle">
                        Saldo <strong>${fmt.num(p.quantidade)}</strong>
                        ${p.lote ? " · lote " + esc(p.lote) : ""}${p.validade ? " · val. " + fmt.data(p.validade) : ""}
                    </div>
                    <div style="margin-top:6px; display:flex; gap:6px; flex-wrap:wrap;">
                        ${badgeStatus(p.status)} ${badgeValidade(p.validade)}
                    </div>
                    ${posicao ? `<span class="posicao-destaque">${icone("pin")} ${esc(posicao)}</span>` : ""}
                </div>
            </div>
        `;
    }

    $$("[data-tipo]", el).forEach((b) => b.addEventListener("click", () => selecionarTipo(b.dataset.tipo)));
    selectEl.addEventListener("change", () => selecionarProduto(selectEl.value));

    $("[data-ler]", el).addEventListener("click", async () => {
        const produto = await lerProdutoPorQr(ctx);
        if (produto) {
            selecionarProduto(produto.id);
            qtdEl.focus();
        }
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();

        const quantidade = Number(qtdEl.value);

        if (!produtoId) return mensagem(msg, "Selecione um produto.", "erro");
        if (!Number.isInteger(quantidade) || quantidade <= 0) {
            return mensagem(msg, "Informe uma quantidade inteira maior que zero.", "erro");
        }
        if (tipo === "devolucao" && !motivoEl.value) {
            return mensagem(msg, "O motivo é obrigatório em devoluções.", "erro");
        }

        enviarBtn.disabled = true;

        try {
            const { saldoApos } = await registrarMovimentacao(ctx.estado.galpaoId, {
                produtoId,
                tipo,
                quantidade,
                motivo: motivoEl.value,
                observacao: obsEl.value.trim()
            }, ctx.usuario);

            toast(`${TIPOS_MOV[tipo].rotulo} registrada. Novo saldo: ${fmt.num(saldoApos)}.`, "ok");
            mensagem(msg, "");
            qtdEl.value = "";
            obsEl.value = "";
            motivoEl.value = "";
            carregarHistorico(ctx, produtoId, historicoEl, 10);
        } catch (erro) {
            mensagem(msg, mensagemDeErro(erro, "Erro ao registrar a movimentação."), "erro");
        } finally {
            enviarBtn.disabled = false;
        }
    });

    selecionarTipo(tipo);

    return {
        atualizar(motivo) {
            if (motivo === "produtos" || motivo === "tudo") {
                selectEl.innerHTML = opcoesProdutos(ctx.estado.produtos, produtoId);
                if (produtoId && !ctx.produto(produtoId)) selecionarProduto("");
                renderAlvo();
            }
        },
        // Chamado ao abrir a aba, ex.: vindo do botão "Movimentar" do estoque.
        mostrar(params = {}) {
            if (params.produtoId) {
                selecionarProduto(params.produtoId);
                qtdEl.focus();
            }
        }
    };
}
