// Aba "Equipe": código de convite, membros, papéis e matriz de permissões.

import {
    updateDoc,
    arrayRemove,
    deleteField
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

import { esc, $, icone, iniciais, toast, confirmar } from "../ui.js";
import { PAPEIS, PAPEIS_ATRIBUIVEIS, ACOES_LEGIVEIS, pode, papelDe, badgePapel } from "../permissoes.js";
import { refGalpao, mensagemDeErro } from "../servicos.js";

export function montarEquipe(el, ctx) {

    const souCriador = () => ctx.estado.galpao.criadoPor === ctx.usuario.uid;

    el.innerHTML = `
        <div class="pagina-topo">
            <div>
                <h1>Equipe</h1>
                <p>Quem tem acesso a este galpão e o que cada um pode fazer.</p>
            </div>
        </div>

        <div class="pilha">
            <div class="card">
                <div class="card-corpo">
                    <label class="label" for="codigo-convite">Código de convite</label>
                    <div class="codigo-convite">
                        <input type="text" id="codigo-convite" readonly value="${esc(ctx.estado.galpaoId)}">
                        <button type="button" class="btn-secondary" data-copiar>${icone("copy")} Copiar</button>
                    </div>
                    <p class="subtle" style="margin-top:6px;">
                        Envie este código a quem deve entrar. Novos membros começam com o papel “Membro”
                        ${ctx.pode("gerenciarMembros") ? "— depois é só ajustar o papel abaixo." : "até um admin definir outro papel."}
                    </p>
                </div>
            </div>

            <div class="card">
                <div class="card-topo">
                    <h2>Membros</h2>
                    <span class="subtle" data-total></span>
                </div>
                <div data-membros></div>
            </div>

            <div class="card">
                <div class="card-topo"><h2>O que cada papel pode fazer</h2></div>
                <div class="tabela-wrap">
                    <table class="matriz">
                        <thead>
                            <tr>
                                <th>Ação</th>
                                ${PAPEIS_ATRIBUIVEIS.map((p) => `<th>${PAPEIS[p].rotulo}</th>`).join("")}
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>Ver estoque e solicitar pedidos</td>
                                ${PAPEIS_ATRIBUIVEIS.map(() => `<td class="check">✓</td>`).join("")}
                            </tr>
                            ${ACOES_LEGIVEIS.map(([acao, rotulo]) => `
                                <tr>
                                    <td>${esc(rotulo)}</td>
                                    ${PAPEIS_ATRIBUIVEIS.map((p) => pode(p, acao)
                                        ? `<td class="check" aria-label="sim">✓</td>`
                                        : `<td class="nao" aria-label="não">—</td>`).join("")}
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>
                </div>
            </div>

            <div data-sair></div>
        </div>
    `;

    const membrosEl = $("[data-membros]", el);

    $("[data-copiar]", el).addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(ctx.estado.galpaoId);
            toast("Código copiado.", "ok");
        } catch {
            $("#codigo-convite", el).select();
            toast("Selecione e copie o código manualmente.");
        }
    });

    membrosEl.addEventListener("change", async (e) => {
        const select = e.target.closest("[data-papel]");
        if (!select) return;
        const uid = select.dataset.papel;
        try {
            await updateDoc(refGalpao(ctx.estado.galpaoId), { [`papeis.${uid}`]: select.value });
            toast(`Papel alterado para ${PAPEIS[select.value].rotulo}.`, "ok");
        } catch (erro) {
            toast(mensagemDeErro(erro, "Erro ao alterar o papel."), "erro");
            render();
        }
    });

    membrosEl.addEventListener("click", async (e) => {
        const botao = e.target.closest("[data-remover]");
        if (!botao) return;
        const uid = botao.dataset.remover;
        const nome = nomeDe(uid);

        const ok = await confirmar(`Remover ${nome} do galpão? A pessoa perde o acesso imediatamente.`, {
            titulo: "Remover membro", botao: "Remover", perigo: true
        });
        if (!ok) return;

        try {
            await updateDoc(refGalpao(ctx.estado.galpaoId), {
                membros: arrayRemove(uid),
                [`papeis.${uid}`]: deleteField(),
                [`membrosInfo.${uid}`]: deleteField()
            });
            toast(`${nome} foi removido(a).`, "ok");
        } catch (erro) {
            toast(mensagemDeErro(erro, "Erro ao remover membro."), "erro");
        }
    });

    function nomeDe(uid) {
        const info = (ctx.estado.galpao.membrosInfo || {})[uid];
        return info && info.nome ? info.nome : "Membro " + uid.slice(0, 6);
    }

    function render() {
        const galpao = ctx.estado.galpao;
        if (!galpao) return;

        const membros = [...(galpao.membros || [])].sort((a, b) => {
            // criador primeiro, depois ordem alfabética
            if (a === galpao.criadoPor) return -1;
            if (b === galpao.criadoPor) return 1;
            return nomeDe(a).localeCompare(nomeDe(b), "pt-BR");
        });

        $("[data-total]", el).textContent = `${membros.length} pessoa(s)`;

        const gerencio = ctx.pode("gerenciarMembros");

        membrosEl.innerHTML = membros.map((uid) => {
            const info = (galpao.membrosInfo || {})[uid] || {};
            const papel = papelDe(galpao, uid);
            const ehCriador = uid === galpao.criadoPor;
            const ehEu = uid === ctx.usuario.uid;
            // Não dá pra mexer no criador nem no próprio papel (evita se trancar fora).
            const editavel = gerencio && !ehCriador && !ehEu;

            return `
                <div class="membro-linha">
                    <span class="avatar">${esc(iniciais(info.nome || "?"))}</span>
                    <div class="usuario-info" style="flex:1;">
                        <strong>${esc(nomeDe(uid))}${ehEu ? ' <span class="subtle">(você)</span>' : ""}</strong>
                        <span class="subtle">${esc(info.email || "")}${ehCriador ? " · criador do galpão" : ""}</span>
                    </div>
                    ${editavel ? `
                        <select data-papel="${esc(uid)}" aria-label="Papel de ${esc(nomeDe(uid))}">
                            ${PAPEIS_ATRIBUIVEIS.map((p) => `<option value="${p}" ${p === papel ? "selected" : ""}>${PAPEIS[p].rotulo}</option>`).join("")}
                        </select>
                        <button type="button" class="btn-danger btn-sm" data-remover="${esc(uid)}">Remover</button>
                    ` : badgePapel(papel)}
                </div>
            `;
        }).join("");

        const sairEl = $("[data-sair]", el);
        sairEl.innerHTML = souCriador() ? "" : `
            <div class="card">
                <div class="card-corpo" style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:12px;">
                    <div>
                        <h3>Sair deste galpão</h3>
                        <p class="subtle">Você perde o acesso até receber o código de novo.</p>
                    </div>
                    <button type="button" class="btn-danger" data-sair-btn>Sair do galpão</button>
                </div>
            </div>
        `;

        const btnSair = $("[data-sair-btn]", sairEl);
        if (btnSair) btnSair.addEventListener("click", sairDoGalpao);
    }

    async function sairDoGalpao() {
        const ok = await confirmar("Sair deste galpão? Você perderá o acesso aos produtos e pedidos.", {
            titulo: "Sair do galpão", botao: "Sair", perigo: true
        });
        if (!ok) return;

        const uid = ctx.usuario.uid;
        const galpaoId = ctx.estado.galpaoId;

        try {
            await updateDoc(refGalpao(galpaoId), {
                membros: arrayRemove(uid),
                [`papeis.${uid}`]: deleteField(),
                [`membrosInfo.${uid}`]: deleteField()
            });
            // O painel percebe que você saiu (listener do galpão),
            // limpa o vínculo no seu usuário e redireciona.
        } catch (erro) {
            toast(mensagemDeErro(erro, "Não foi possível sair do galpão."), "erro");
        }
    }

    return {
        atualizar(motivo) {
            if (motivo === "galpao" || motivo === "tudo") render();
        }
    };
}
