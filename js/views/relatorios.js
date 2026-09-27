// Aba "Relatórios" (gerente/admin): resumo do período, curva ABC,
// devoluções por motivo e reconciliação de inventário.

import { esc, $, $$, fmt, icone, toast, confirmar, paraDate } from "../ui.js";
import {
    MOTIVOS_DEVOLUCAO,
    todasMovimentacoes,
    salvarReconciliacao,
    listarReconciliacoes,
    mensagemDeErro
} from "../servicos.js";
import { chipPosicao } from "./comum.js";

// Lista (não objeto) para manter a ordem — chaves numéricas seriam reordenadas.
const PERIODOS = [[30, "30 dias"], [90, "90 dias"], [365, "12 meses"], [0, "Tudo"]];

export function montarRelatorios(el, ctx) {

    let periodo = 90;
    let criterio = "unidades";
    let movs = null;       // cache das movimentações carregadas
    let carregando = false;

    // Contagem física digitada (produtoId → número). Fica fora do DOM
    // para sobreviver às atualizações em tempo real da lista.
    const contagem = new Map();

    el.innerHTML = `
        <div class="pagina-topo">
            <div>
                <h1>Relatórios</h1>
                <p>Giro de estoque, causas de devolução e conferência de inventário.</p>
            </div>
            <div class="acoes">
                <select data-periodo aria-label="Período" style="width:auto;">
                    ${PERIODOS.map(([k, v]) => `<option value="${k}" ${k === periodo ? "selected" : ""}>${v}</option>`).join("")}
                </select>
                <button type="button" class="btn-secondary" data-recarregar>${icone("history")} Atualizar</button>
            </div>
        </div>

        <div class="kpis" data-resumo></div>

        <div class="pilha">
            <div class="card">
                <div class="card-topo">
                    <div>
                        <h2>Curva ABC de saídas</h2>
                        <p class="subtle">A = 80% do volume · B = próximos 15% · C = restante</p>
                    </div>
                    <div class="segmentado" role="group" aria-label="Critério da curva ABC">
                        <button type="button" data-criterio="unidades" aria-pressed="true">Unidades</button>
                        <button type="button" data-criterio="valor" aria-pressed="false">Valor (R$)</button>
                    </div>
                </div>
                <div class="tabela-wrap" data-abc></div>
            </div>

            <div class="card">
                <div class="card-topo"><h2>Devoluções por motivo</h2></div>
                <div class="card-corpo barras-motivo" data-motivos></div>
            </div>

            <div class="card">
                <div class="card-topo">
                    <div>
                        <h2>Reconciliação de inventário</h2>
                        <p class="subtle">Digite a contagem física; itens em branco não entram. Divergências ficam destacadas.</p>
                    </div>
                    <div class="acoes">
                        <input type="search" data-rec-busca placeholder="Filtrar por nome ou setor" style="width:220px;" aria-label="Filtrar produtos da reconciliação">
                    </div>
                </div>
                <div class="tabela-wrap" data-rec-tabela></div>
                <div class="card-corpo" style="border-top:1px solid var(--border);">
                    <div class="form-group">
                        <label for="rec-obs">Observação <span class="subtle">(opcional)</span></label>
                        <input type="text" id="rec-obs" placeholder="Ex: inventário mensal, setor A">
                    </div>
                    <div class="acoes" style="justify-content:space-between; align-items:center;">
                        <span class="muted" data-rec-resumo></span>
                        <div class="acoes">
                            <button type="button" class="btn-ghost" data-rec-limpar>Limpar</button>
                            <button type="button" class="btn-secondary" data-rec-salvar>Salvar só o registro</button>
                            <button type="button" data-rec-aplicar>Salvar e ajustar saldos</button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-topo"><h2>Reconciliações anteriores</h2></div>
                <div class="tabela-wrap" data-rec-historico><div class="vazio">Carregando…</div></div>
            </div>
        </div>
    `;

    const resumoEl = $("[data-resumo]", el);
    const abcEl = $("[data-abc]", el);
    const motivosEl = $("[data-motivos]", el);
    const recTabelaEl = $("[data-rec-tabela]", el);
    const recBuscaEl = $("[data-rec-busca]", el);
    const recResumoEl = $("[data-rec-resumo]", el);
    const recHistEl = $("[data-rec-historico]", el);

    $("[data-periodo]", el).addEventListener("change", (e) => {
        periodo = Number(e.target.value);
        renderAnalises();
    });

    $("[data-recarregar]", el).addEventListener("click", () => carregar(true));

    $$("[data-criterio]", el).forEach((b) => b.addEventListener("click", () => {
        criterio = b.dataset.criterio;
        $$("[data-criterio]", el).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        renderAnalises();
    }));

    // ─── Carregamento ───

    async function carregar(forcar = false) {
        if (carregando || (movs && !forcar)) return;
        carregando = true;
        abcEl.innerHTML = `<div class="vazio">Carregando movimentações…</div>`;
        try {
            movs = await todasMovimentacoes(ctx.estado.galpaoId, ctx.estado.produtos.map((p) => p.id));
            renderAnalises();
        } catch (erro) {
            abcEl.innerHTML = `<div class="vazio">${esc(mensagemDeErro(erro, "Erro ao carregar dados."))}</div>`;
        } finally {
            carregando = false;
        }
        carregarHistorico();
    }

    function movsDoPeriodo() {
        if (!movs) return [];
        if (!periodo) return movs;
        const limite = Date.now() - periodo * 86400000;
        return movs.filter((m) => {
            const d = paraDate(m.criadoEm);
            return d && d.getTime() >= limite;
        });
    }

    // ─── Resumo + ABC + motivos ───

    function renderAnalises() {
        if (!movs) return;
        const lista = movsDoPeriodo();

        const soma = (tipo) => lista.filter((m) => m.tipo === tipo).reduce((s, m) => s + m.quantidade, 0);
        const devolucoes = lista.filter((m) => m.tipo === "devolucao");
        const ajustes = lista.filter((m) => m.tipo === "ajuste");

        resumoEl.innerHTML = `
            <div class="kpi"><div class="rotulo">Entradas</div><div class="valor">${fmt.num(soma("entrada"))}</div></div>
            <div class="kpi"><div class="rotulo">Saídas</div><div class="valor">${fmt.num(soma("saida"))}</div></div>
            <div class="kpi"><div class="rotulo">Devoluções</div><div class="valor">${fmt.num(soma("devolucao"))}</div></div>
            <div class="kpi ${ajustes.length ? "alerta" : ""}"><div class="rotulo">Ajustes de inventário</div><div class="valor">${fmt.num(ajustes.length)}</div></div>
        `;

        renderAbc(lista.filter((m) => m.tipo === "saida"));
        renderMotivos(devolucoes);
    }

    function renderAbc(saidas) {
        const porProduto = new Map();

        saidas.forEach((m) => {
            const produto = ctx.produto(m.produtoId);
            const atual = porProduto.get(m.produtoId) || {
                nome: produto ? produto.nome : (m.produtoNome || "(removido)"),
                produto,
                unidades: 0,
                valor: 0
            };
            atual.unidades += m.quantidade;
            atual.valor += m.quantidade * (produto ? produto.preco || 0 : 0);
            porProduto.set(m.produtoId, atual);
        });

        const linhas = [...porProduto.values()].sort((a, b) => b[criterio] - a[criterio]);
        const total = linhas.reduce((s, l) => s + l[criterio], 0);

        if (linhas.length === 0 || total === 0) {
            abcEl.innerHTML = `<div class="vazio"><strong>Sem saídas no período</strong>Registre saídas ou expedições para montar a curva.</div>`;
            return;
        }

        // Classe pelo acumulado ANTES do item: o item que cruza os 80% ainda é A.
        let acumulado = 0;
        const maior = linhas[0][criterio];

        abcEl.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th class="num">#</th>
                        <th>Produto</th>
                        <th>Classe</th>
                        <th class="num">${criterio === "valor" ? "Valor" : "Unidades"}</th>
                        <th class="num">% do total</th>
                        <th class="num">% acumulado</th>
                        <th style="width:22%"></th>
                    </tr>
                </thead>
                <tbody>
                    ${linhas.map((l, i) => {
                        const antes = acumulado / total;
                        acumulado += l[criterio];
                        const classe = antes < 0.8 ? "A" : antes < 0.95 ? "B" : "C";
                        const cor = { A: "accent", B: "warn", C: "" }[classe];
                        return `
                            <tr>
                                <td class="num subtle">${i + 1}</td>
                                <td><span class="produto-nome">${esc(l.nome)}</span></td>
                                <td><span class="badge sem-ponto ${cor}">${classe}</span></td>
                                <td class="num">${criterio === "valor" ? fmt.moeda(l.valor) : fmt.num(l.unidades)}</td>
                                <td class="num">${fmt.pct(l[criterio] / total)}</td>
                                <td class="num">${fmt.pct(acumulado / total)}</td>
                                <td><div class="barra classe-${classe}"><span style="width:${(l[criterio] / maior * 100).toFixed(1)}%"></span></div></td>
                            </tr>
                        `;
                    }).join("")}
                </tbody>
            </table>
        `;
    }

    function renderMotivos(devolucoes) {
        const contagemMotivo = Object.fromEntries(Object.keys(MOTIVOS_DEVOLUCAO).map((k) => [k, 0]));
        devolucoes.forEach((m) => {
            if (m.motivo in contagemMotivo) contagemMotivo[m.motivo] += m.quantidade;
        });
        const maior = Math.max(...Object.values(contagemMotivo));

        if (maior === 0) {
            motivosEl.innerHTML = `<div class="vazio" style="padding:12px;">Nenhuma devolução no período.</div>`;
            return;
        }

        motivosEl.innerHTML = Object.entries(contagemMotivo)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `
                <div class="linha">
                    <span>${MOTIVOS_DEVOLUCAO[k]}</span>
                    <div class="barra"><span style="width:${(v / maior * 100).toFixed(1)}%"></span></div>
                    <strong class="num" style="text-align:right">${fmt.num(v)}</strong>
                </div>
            `).join("");
    }

    // ─── Reconciliação ───

    function renderReconciliacao() {
        const termo = recBuscaEl.value.trim().toLowerCase();
        const produtos = ctx.estado.produtos.filter((p) => {
            if (!termo) return true;
            const pos = p.posicao || {};
            return [p.nome, p.categoria, pos.setor, pos.corredor, pos.prateleira].join(" ").toLowerCase().includes(termo);
        });

        if (produtos.length === 0) {
            recTabelaEl.innerHTML = `<div class="vazio">Nenhum produto.</div>`;
            renderResumoRec();
            return;
        }

        // Mantém o foco no campo que o usuário está digitando.
        const focado = document.activeElement && document.activeElement.dataset
            ? document.activeElement.dataset.contagem : null;

        recTabelaEl.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Produto</th>
                        <th>Localização</th>
                        <th class="num">Sistema</th>
                        <th class="num">Contagem física</th>
                        <th class="num">Diferença</th>
                    </tr>
                </thead>
                <tbody>
                    ${produtos.map((p) => {
                        const contado = contagem.get(p.id);
                        const temContagem = contado !== undefined;
                        const dif = temContagem ? contado - p.quantidade : 0;
                        return `
                            <tr class="${temContagem && dif !== 0 ? "divergente" : ""}" data-linha="${esc(p.id)}">
                                <td><span class="produto-nome">${esc(p.nome)}</span>${p.lote ? `<div class="produto-meta">lote ${esc(p.lote)}</div>` : ""}</td>
                                <td>${chipPosicao(p.posicao)}</td>
                                <td class="num">${fmt.num(p.quantidade)}</td>
                                <td class="num">
                                    <input type="number" class="contagem-input" min="0" step="1"
                                        data-contagem="${esc(p.id)}" value="${temContagem ? contado : ""}"
                                        aria-label="Contagem física de ${esc(p.nome)}">
                                </td>
                                <td class="num" data-dif>${htmlDiferenca(temContagem, dif)}</td>
                            </tr>
                        `;
                    }).join("")}
                </tbody>
            </table>
        `;

        if (focado) {
            const input = recTabelaEl.querySelector(`[data-contagem="${CSS.escape(focado)}"]`);
            if (input) {
                input.focus();
                const fim = input.value.length;
                try { input.setSelectionRange(fim, fim); } catch { /* number input */ }
            }
        }

        renderResumoRec();
    }

    function htmlDiferenca(temContagem, dif) {
        if (!temContagem) return `<span class="subtle">—</span>`;
        if (dif === 0) return `<span class="badge ok">OK</span>`;
        return `<span class="delta ${dif > 0 ? "pos" : "neg"}">${dif > 0 ? "+" : ""}${fmt.num(dif)}</span>`;
    }

    function itensContados() {
        return [...contagem.entries()]
            .map(([produtoId, contado]) => {
                const p = ctx.produto(produtoId);
                return p ? { produtoId, nome: p.nome, sistema: p.quantidade, contado } : null;
            })
            .filter(Boolean);
    }

    function renderResumoRec() {
        const itens = itensContados();
        const div = itens.filter((i) => i.contado !== i.sistema).length;
        recResumoEl.textContent = itens.length
            ? `${itens.length} item(ns) contado(s) · ${div} divergência(s)`
            : "Nenhum item contado ainda.";
    }

    // Atualiza só a linha editada (sem redesenhar a tabela toda).
    recTabelaEl.addEventListener("input", (e) => {
        const input = e.target.closest("[data-contagem]");
        if (!input) return;
        const id = input.dataset.contagem;
        const valor = input.value.trim();

        if (valor === "") contagem.delete(id);
        else contagem.set(id, Math.max(0, Math.floor(Number(valor))));

        const p = ctx.produto(id);
        const linha = input.closest("tr");
        const tem = contagem.has(id);
        const dif = tem ? contagem.get(id) - p.quantidade : 0;
        linha.classList.toggle("divergente", tem && dif !== 0);
        $("[data-dif]", linha).innerHTML = htmlDiferenca(tem, dif);
        renderResumoRec();
    });

    recBuscaEl.addEventListener("input", renderReconciliacao);

    $("[data-rec-limpar]", el).addEventListener("click", () => {
        contagem.clear();
        renderReconciliacao();
    });

    async function enviarReconciliacao(aplicar) {
        const itens = itensContados();
        if (itens.length === 0) {
            toast("Digite a contagem física de pelo menos um item.", "erro");
            return;
        }

        const divergentes = itens.filter((i) => i.contado !== i.sistema).length;

        if (aplicar) {
            if (divergentes === 0) {
                toast("Nenhuma divergência para ajustar — use “Salvar só o registro”.");
                return;
            }
            const ok = await confirmar(
                `Ajustar o saldo de ${divergentes} produto(s) para a contagem física? Cada ajuste fica registrado no histórico.`,
                { titulo: "Aplicar ajustes", botao: "Ajustar saldos" }
            );
            if (!ok) return;
        }

        $$("[data-rec-salvar], [data-rec-aplicar]", el).forEach((b) => (b.disabled = true));

        try {
            const { falhas } = await salvarReconciliacao(ctx.estado.galpaoId, itens, ctx.usuario, {
                aplicar,
                observacao: $("#rec-obs", el).value.trim()
            });

            if (falhas.length) {
                toast(`Registro salvo, mas não foi possível ajustar: ${falhas.join(", ")}.`, "erro");
            } else {
                toast(aplicar ? "Saldos ajustados e reconciliação registrada." : "Reconciliação registrada.", "ok");
            }

            contagem.clear();
            $("#rec-obs", el).value = "";
            renderReconciliacao();
            movs = null;
            carregar();
        } catch (erro) {
            toast(mensagemDeErro(erro, "Erro ao salvar a reconciliação."), "erro");
        } finally {
            $$("[data-rec-salvar], [data-rec-aplicar]", el).forEach((b) => (b.disabled = false));
        }
    }

    $("[data-rec-salvar]", el).addEventListener("click", () => enviarReconciliacao(false));
    $("[data-rec-aplicar]", el).addEventListener("click", () => enviarReconciliacao(true));

    async function carregarHistorico() {
        try {
            const recs = await listarReconciliacoes(ctx.estado.galpaoId);
            if (recs.length === 0) {
                recHistEl.innerHTML = `<div class="vazio">Nenhuma reconciliação registrada.</div>`;
                return;
            }
            recHistEl.innerHTML = `
                <table>
                    <thead>
                        <tr><th>Data</th><th>Responsável</th><th class="num">Itens</th><th class="num">Divergências</th><th>Situação</th><th>Observação</th></tr>
                    </thead>
                    <tbody>
                        ${recs.map((r) => `
                            <tr>
                                <td>${fmt.dataHora(r.criadoEm)}</td>
                                <td>${esc(r.usuarioNome)}</td>
                                <td class="num">${fmt.num(r.totalItens)}</td>
                                <td class="num">${r.totalDivergencias ? `<strong style="color:var(--warn)">${fmt.num(r.totalDivergencias)}</strong>` : "0"}</td>
                                <td>${r.aplicada ? `<span class="badge ok">Ajustada</span>` : `<span class="badge">Só registro</span>`}</td>
                                <td class="subtle">${esc(r.observacao || "")}</td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            `;
        } catch (erro) {
            recHistEl.innerHTML = `<div class="vazio">${esc(mensagemDeErro(erro, "Erro ao carregar o histórico."))}</div>`;
        }
    }

    let visivel = false;

    return {
        mostrar() {
            visivel = true;
            // Espera a lista de produtos chegar antes de buscar o histórico.
            if (ctx.estado.produtosCarregados) carregar();
            renderReconciliacao();
        },
        atualizar(motivo) {
            if (motivo === "produtos" || motivo === "tudo") {
                renderReconciliacao();
                if (!visivel || !ctx.estado.produtosCarregados) return;
                if (movs) renderAnalises();
                else carregar();
            }
        }
    };
}
