// Aba "Movimentar": entrada, saída avulsa e devolução.
//
// Devolução:
//  - COM código (etiqueta da peça): o sistema sabe exatamente qual peça
//    voltou e de qual pedido ela saiu — e recusa peças que não constam como fora.
//  - SEM código (peça que saiu avulsa, sem etiqueta): escolhe-se o produto.
//  Estado em que voltou: novo (volta ao saldo) · aberto/danificado (vira item
//  individual com código próprio).

import { esc, $, $$, fmt, icone, toast, mensagem } from "../ui.js";
import { formatarCodigo, codigoPedido } from "../codigos.js";
import {
    TIPOS_MOV,
    MOTIVOS_DEVOLUCAO,
    ESTADOS_DEVOLUCAO,
    CONDICOES,
    ehIndividual,
    registrarMovimentacao,
    registrarDevolucao,
    mensagemDeErro
} from "../servicos.js";
import {
    badgeStatus,
    badgeValidade,
    badgeCondicao,
    chipCodigo,
    textoPosicao,
    opcoesProdutos,
    lerQr,
    resolverLeitura,
    carregarHistorico,
    abrirEtiquetasUnidades
} from "./comum.js";

const TIPOS = ["entrada", "saida", "devolucao"];

const DICAS = {
    entrada: "Recebimento de mercadoria nova: soma ao saldo. Itens usados/recondicionados são cadastrados na aba Estoque.",
    saida: "Retirada avulsa, sem pedido e sem etiqueta por peça. Para retiradas rastreadas, use a aba Pedidos.",
    devolucao: "Leia a etiqueta da peça: o sistema confere se ela saiu e de qual pedido. Sem etiqueta, escolha o produto."
};

export function montarMovimentar(el, ctx) {

    const tiposPermitidos = TIPOS.filter((t) => ctx.pode(t));
    let tipo = tiposPermitidos[0];
    let produtoId = "";

    // Devolução
    let modoDevolucao = "codigo";   // "codigo" | "produto"
    let unidadeLida = null;         // { codigo, unidade, produto }
    let estado = "novo";

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

                        <!-- Devolução: por código da peça -->
                        <div data-bloco-codigo class="hidden">
                            <div class="form-group">
                                <label for="mv-codigo">Código da peça</label>
                                <div class="busca-produto">
                                    <input type="text" id="mv-codigo" class="mono" placeholder="Ex: K7Q2-M9XD" autocomplete="off">
                                    <button type="button" class="btn-secondary" data-ler-codigo title="Ler QR">${icone("scan")} QR</button>
                                </div>
                                <p class="subtle" style="margin-top:6px;">
                                    Peça sem etiqueta (saiu avulsa)? <a href="#" data-modo="produto">Escolher o produto</a>
                                </p>
                            </div>
                        </div>

                        <!-- Entrada / saída / devolução sem código: por produto -->
                        <div data-bloco-produto>
                            <div class="form-group">
                                <label for="mv-produto">Produto</label>
                                <div class="busca-produto">
                                    <select id="mv-produto"></select>
                                    <button type="button" class="btn-secondary" data-ler title="Ler QR">${icone("scan")} QR</button>
                                </div>
                                <p class="subtle hidden" data-voltar-codigo style="margin-top:6px;">
                                    <a href="#" data-modo="codigo">Voltar para leitura do código da peça</a>
                                </p>
                            </div>
                        </div>

                        <div data-alvo></div>

                        <div data-bloco-estado class="hidden">
                            <div class="form-group">
                                <span class="label" id="mv-estado-rotulo">Estado em que voltou</span>
                                <div class="segmentado" role="group" aria-labelledby="mv-estado-rotulo">
                                    ${Object.entries(ESTADOS_DEVOLUCAO).map(([k, v]) => `
                                        <button type="button" data-estado="${k}" aria-pressed="${k === estado}">${esc(v.split(" (")[0])}</button>
                                    `).join("")}
                                </div>
                                <p class="subtle" data-estado-dica style="margin-top:6px;"></p>
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group" data-qtd-grupo>
                                <label for="mv-quantidade">Quantidade</label>
                                <input type="number" id="mv-quantidade" min="1" step="1" required>
                            </div>
                            <div class="form-group hidden" data-motivo-grupo>
                                <label for="mv-motivo">Motivo da devolução</label>
                                <select id="mv-motivo">
                                    <option value="">Selecione…</option>
                                    ${Object.entries(MOTIVOS_DEVOLUCAO).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
                                </select>
                            </div>
                        </div>

                        <div class="form-group">
                            <label for="mv-obs" data-obs-rotulo>Observação <span class="subtle">(opcional)</span></label>
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
    const codigoEl = $("#mv-codigo", el);
    const alvoEl = $("[data-alvo]", el);
    const qtdEl = $("#mv-quantidade", el);
    const qtdGrupo = $("[data-qtd-grupo]", el);
    const motivoGrupo = $("[data-motivo-grupo]", el);
    const motivoEl = $("#mv-motivo", el);
    const obsEl = $("#mv-obs", el);
    const msg = $("[data-msg]", el);
    const historicoEl = $("[data-historico]", el);
    const enviarBtn = $("[data-enviar]", el);

    // Entrada e saída avulsa só valem para produtos novos (por quantidade).
    function produtosDoTipo() {
        return ctx.estado.produtos.filter((p) => !ehIndividual(p));
    }

    function devolvendoPorCodigo() {
        return tipo === "devolucao" && modoDevolucao === "codigo";
    }

    // ── Layout conforme tipo/modo/estado ──

    function atualizarLayout() {
        const devolucao = tipo === "devolucao";
        $("[data-bloco-codigo]", el).classList.toggle("hidden", !devolvendoPorCodigo());
        $("[data-bloco-produto]", el).classList.toggle("hidden", devolvendoPorCodigo());
        $("[data-voltar-codigo]", el).classList.toggle("hidden", !devolucao);
        $("[data-bloco-estado]", el).classList.toggle("hidden", !devolucao);
        motivoGrupo.classList.toggle("hidden", !devolucao);

        // Peça com código, ou peça aberta/danificada: sempre 1 por registro.
        const umaPorVez = devolucao && (devolvendoPorCodigo() || estado !== "novo");
        qtdGrupo.classList.toggle("hidden", umaPorVez);
        if (umaPorVez) qtdEl.value = "1";

        $("[data-obs-rotulo]", el).innerHTML = devolucao && estado !== "novo"
            ? `Estado da peça <span class="subtle">(o que está aberto, avariado…)</span>`
            : `Observação <span class="subtle">(opcional)</span>`;

        $("[data-estado-dica]", el).textContent = {
            novo: "Lacrada e sem uso: volta ao saldo do produto novo.",
            aberto: "Vira um item individual (condição “aberto”), com o código da peça. Não volta ao saldo de novos.",
            danificado: "Vira um item individual “danificado”, fora dos pedidos até registrar manutenção."
        }[estado];

        enviarBtn.textContent = `Registrar ${TIPOS_MOV[tipo].rotulo.toLowerCase()}`;
    }

    function selecionarTipo(novo) {
        tipo = novo;
        $$("[data-tipo]", el).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tipo === tipo)));
        $("[data-dica]", el).textContent = DICAS[tipo];
        if (tipo !== "devolucao") limparCodigo();
        mensagem(msg, "");
        atualizarLayout();
        renderAlvo();
    }

    function selecionarModo(modo) {
        modoDevolucao = modo;
        limparCodigo();
        atualizarLayout();
        renderAlvo();
        (modo === "codigo" ? codigoEl : selectEl).focus();
    }

    function selecionarEstado(novo) {
        estado = novo;
        $$("[data-estado]", el).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.estado === estado)));
        atualizarLayout();
    }

    function selecionarProduto(id) {
        produtoId = id;
        selectEl.value = id;
        renderAlvo();
        mostrarHistorico(id);
    }

    function mostrarHistorico(id) {
        if (id) {
            historicoEl.innerHTML = `<p class="subtle">Carregando…</p>`;
            carregarHistorico(ctx, id, historicoEl, 10);
        } else {
            historicoEl.innerHTML = `<p class="subtle">Selecione um produto para ver o histórico.</p>`;
        }
    }

    function limparCodigo() {
        unidadeLida = null;
        codigoEl.value = "";
    }

    // ── Leitura do código da peça (devolução) ──

    async function lerCodigo(texto) {
        const r = await resolverLeitura(ctx, texto);
        if (r.erro) {
            unidadeLida = null;
            renderAlvo();
            return mensagem(msg, r.erro, "erro");
        }
        if (!r.codigo) {
            unidadeLida = null;
            renderAlvo();
            return mensagem(msg, "Esta é a etiqueta geral do produto. Leia a etiqueta da peça (código curto) ou escolha “sem etiqueta”.", "erro");
        }
        mensagem(msg, "");
        unidadeLida = r;
        codigoEl.value = formatarCodigo(r.codigo);
        // Item individual não volta como novo.
        const individual = r.unidade ? Boolean(r.unidade.itemId) : ehIndividual(r.produto);
        if (individual && estado === "novo") selecionarEstado("aberto");
        renderAlvo();
        if (r.produto) mostrarHistorico(r.produto.id);
    }

    codigoEl.addEventListener("change", () => {
        if (codigoEl.value.trim()) lerCodigo(codigoEl.value);
    });
    codigoEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            if (codigoEl.value.trim()) lerCodigo(codigoEl.value);
        }
    });

    // ── Cartão do alvo ──

    // Mostra o produto (ou a peça) com a localização em destaque, para o
    // separador/conferente achar o item rápido.
    function renderAlvo() {
        if (devolvendoPorCodigo()) {
            if (!unidadeLida) {
                alvoEl.innerHTML = "";
                return;
            }
            const { unidade, produto, codigo } = unidadeLida;
            const fora = unidade ? unidade.status === "fora" : produto && produto.quantidade === 0;
            alvoEl.innerHTML = `
                <div class="produto-alvo">
                    <div class="info">
                        <div class="grande">${esc((produto && produto.nome) || (unidade && unidade.produtoNome) || "—")}</div>
                        <div style="margin-top:6px; display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
                            ${chipCodigo(codigo)}
                            ${badgeCondicao({ condicao: unidade ? unidade.condicao : produto.condicao })}
                            <span class="badge ${fora ? "warn" : "danger"}">${fora ? "Consta como fora" : "Não consta como fora"}</span>
                        </div>
                        <div class="subtle" style="margin-top:6px;">
                            ${unidade && unidade.pedidoId && fora
                                ? `Saiu no pedido #${esc(codigoPedido({ id: unidade.pedidoId, codigo: unidade.pedidoCodigo }))}.`
                                : fora ? "" : "Esta peça já está no galpão (devolvida antes ou nunca saiu) — confira se é a peça certa."}
                        </div>
                    </div>
                </div>
            `;
            return;
        }

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

    // ── Eventos ──

    $$("[data-tipo]", el).forEach((b) => b.addEventListener("click", () => selecionarTipo(b.dataset.tipo)));
    $$("[data-estado]", el).forEach((b) => b.addEventListener("click", () => selecionarEstado(b.dataset.estado)));
    $$("[data-modo]", el).forEach((a) => a.addEventListener("click", (e) => {
        e.preventDefault();
        selecionarModo(a.dataset.modo);
    }));
    selectEl.addEventListener("change", () => selecionarProduto(selectEl.value));

    $("[data-ler]", el).addEventListener("click", async () => {
        const r = await lerQr(ctx, "Ler etiqueta do produto");
        if (!r || !r.produto) return;
        if (ehIndividual(r.produto)) {
            return mensagem(msg, "Itens individuais não entram aqui: saem por pedido e voltam pela leitura do código.", "erro");
        }
        selecionarProduto(r.produto.id);
        qtdEl.focus();
    });

    $("[data-ler-codigo]", el).addEventListener("click", async () => {
        const r = await lerQr(ctx, "Ler etiqueta da peça");
        if (r) lerCodigo(r.codigo || r.produto.id);
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();

        const quantidade = Number(qtdEl.value);

        if (tipo === "devolucao") {
            if (devolvendoPorCodigo() && !unidadeLida) return mensagem(msg, "Leia ou digite o código da peça.", "erro");
            if (!devolvendoPorCodigo() && !produtoId) return mensagem(msg, "Selecione um produto.", "erro");
            if (!motivoEl.value) return mensagem(msg, "O motivo é obrigatório em devoluções.", "erro");
        } else if (!produtoId) {
            return mensagem(msg, "Selecione um produto.", "erro");
        }

        if (!Number.isInteger(quantidade) || quantidade <= 0) {
            return mensagem(msg, "Informe uma quantidade inteira maior que zero.", "erro");
        }

        enviarBtn.disabled = true;

        try {
            if (tipo === "devolucao") {
                const r = await registrarDevolucao(ctx.estado.galpaoId, {
                    codigo: devolvendoPorCodigo() ? unidadeLida.codigo : null,
                    produtoId: devolvendoPorCodigo() ? null : produtoId,
                    quantidade,
                    estado,
                    motivo: motivoEl.value,
                    observacao: obsEl.value.trim()
                }, ctx.usuario);

                toast(estado === "novo"
                    ? `Devolução registrada. Novo saldo: ${fmt.num(r.saldoApos)}.`
                    : `Devolução registrada como item ${CONDICOES[estado].rotulo.toLowerCase()} (${formatarCodigo(r.codigo)}).`, "ok");

                // Peça sem etiqueta que virou item individual: imprimir a etiqueta nova.
                if (r.codigoNovo) {
                    const base = ctx.produto(produtoId);
                    abrirEtiquetasUnidades(ctx, [{
                        codigo: r.codigo,
                        nome: base ? base.nome : "",
                        detalhe: CONDICOES[estado].rotulo
                    }], {
                        titulo: "Etiqueta da peça devolvida",
                        texto: "A peça voltou sem etiqueta e virou um item individual. Cole esta etiqueta nela."
                    });
                }

                mostrarHistorico(r.produtoId);
                limparCodigo();
                renderAlvo();
            } else {
                const { saldoApos } = await registrarMovimentacao(ctx.estado.galpaoId, {
                    produtoId,
                    tipo,
                    quantidade,
                    observacao: obsEl.value.trim()
                }, ctx.usuario);

                toast(`${TIPOS_MOV[tipo].rotulo} registrada. Novo saldo: ${fmt.num(saldoApos)}.`, "ok");
                mostrarHistorico(produtoId);
            }

            mensagem(msg, "");
            if (!qtdGrupo.classList.contains("hidden")) qtdEl.value = "";
            obsEl.value = "";
            motivoEl.value = "";
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
                selectEl.innerHTML = opcoesProdutos(produtosDoTipo(), produtoId);
                if (produtoId && !ctx.produto(produtoId)) selecionarProduto("");
                renderAlvo();
            }
        },
        // Chamado ao abrir a aba, ex.: vindo do botão "Movimentar" do estoque.
        mostrar(params = {}) {
            if (params.produtoId) {
                if (tipo === "devolucao") selecionarModo("produto");
                selecionarProduto(params.produtoId);
                qtdEl.focus();
            }
        }
    };
}
