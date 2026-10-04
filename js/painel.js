import {
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
    doc,
    getDoc,
    updateDoc,
    arrayRemove,
    onSnapshot,
    query,
    orderBy
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

import { auth, db } from "./firebase-config.js";
import { $, esc, icone, iniciais } from "./ui.js";
import { pode, papelDe, badgePapel } from "./permissoes.js";
import { refGalpao, colProdutos, colPedidos } from "./servicos.js";

import { montarEstoque } from "./views/estoque.js";
import { montarMovimentar } from "./views/movimentar.js";
import { montarPedidos } from "./views/pedidos.js";
import { montarRelatorios } from "./views/relatorios.js";
import { montarEquipe } from "./views/equipe.js";

// ─── Estado compartilhado entre as abas ───

const estado = {
    galpaoId: null,
    galpao: null,
    galpaoIds: [],
    papel: "membro",
    produtos: [],   // [{ id, ...dados }] ordenados por nome
    produtosCarregados: false,
    pedidos: []     // [{ id, ...dados }] mais recentes primeiro
};

const usuario = { uid: null, nome: "", email: "" };

// Abas: `requer` é a ação de permissions.js necessária para vê-la.
const ABAS = [
    { id: "estoque",    rotulo: "Estoque",    icone: "box",       montar: montarEstoque },
    { id: "movimentar", rotulo: "Movimentar", icone: "swap",      montar: montarMovimentar,
      visivel: (p) => ["entrada", "saida", "devolucao"].some((a) => pode(p, a)) },
    { id: "pedidos",    rotulo: "Pedidos",    icone: "clipboard", montar: montarPedidos },
    { id: "relatorios", rotulo: "Relatórios", icone: "chart",     montar: montarRelatorios,
      visivel: (p) => pode(p, "relatorios") },
    { id: "equipe",     rotulo: "Equipe",     icone: "users",     montar: montarEquipe }
];

const conteudoEl = $("#conteudo");
const navEl = $("#nav");

let abaAtual = null;
let views = {};          // id → { el, atualizar, mostrar }
let papelMontado = null; // papel com o qual as views foram montadas

// Contexto entregue a cada aba.
const ctx = {
    estado,
    usuario,
    pode: (acao) => pode(estado.papel, acao),
    produto: (id) => estado.produtos.find((p) => p.id === id),
    irPara
};

$("#marca-logo").innerHTML = icone("warehouse");
$("#logout-btn").innerHTML = icone("logout");

// ─── Login e carregamento do galpão ───

onAuthStateChanged(auth, async (user) => {

    if (!user) {
        window.location.href = "login.html";
        return;
    }

    usuario.uid = user.uid;

    const usuarioSnap = await getDoc(doc(db, "usuarios", user.uid));
    const usuarioData = usuarioSnap.data() || {};

    usuario.nome = usuarioData.nome || user.email;
    usuario.email = usuarioData.email || user.email;
    estado.galpaoIds = usuarioData.galpaoIds || [];

    $("#usuario-nome").textContent = usuario.nome;
    $("#usuario-avatar").textContent = iniciais(usuario.nome);

    if (estado.galpaoIds.length === 0) {
        window.location.href = "galpao.html";
        return;
    }

    // O galpão a ser exibido vem da URL: painel.html?galpao=ID
    const galpaoDaUrl = new URLSearchParams(window.location.search).get("galpao");

    // Só aceita o galpão da URL se o usuário realmente pertencer a ele.
    estado.galpaoId = galpaoDaUrl && estado.galpaoIds.includes(galpaoDaUrl)
        ? galpaoDaUrl
        : estado.galpaoIds[0];

    if (estado.galpaoIds.length > 1) {
        $("#trocar-galpao").classList.remove("hidden");
    }

    escutarGalpao();
});

function escutarGalpao() {

    let primeiraVez = true;

    // Escuta em tempo real: se o admin mudar seu papel ou te remover,
    // a tela reage na hora.
    onSnapshot(refGalpao(estado.galpaoId), async (snap) => {

        const galpao = snap.exists() ? snap.data() : null;

        if (!galpao || !(galpao.membros || []).includes(usuario.uid)) {
            await sairDeGalpaoInacessivel();
            return;
        }

        estado.galpao = galpao;
        estado.papel = papelDe(galpao, usuario.uid);

        document.title = `${galpao.nome} · Galpão`;
        $("#galpao-nome").textContent = galpao.nome;
        $("#usuario-papel").innerHTML = badgePapel(estado.papel);

        registrarMeuNome(galpao);

        if (primeiraVez) {
            primeiraVez = false;
            escutarProdutos();
            escutarPedidos();
        }

        // Papel mudou → remonta as abas com as novas permissões.
        if (papelMontado !== estado.papel) {
            montarViews();
        } else {
            notificar("galpao");
        }

    }, (erro) => {
        console.error(erro);
        conteudoEl.innerHTML = `<div class="vazio"><strong>Não foi possível abrir este galpão.</strong></div>`;
    });
}

function escutarProdutos() {
    onSnapshot(colProdutos(estado.galpaoId), (snap) => {
        estado.produtos = snap.docs
            .map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
            // Por nome; itens individuais logo abaixo do produto novo de mesmo nome.
            .sort((a, b) =>
                String(a.nome).localeCompare(String(b.nome), "pt-BR")
                || Number((a.condicao || "novo") !== "novo") - Number((b.condicao || "novo") !== "novo")
                || String(a.codigo || "").localeCompare(String(b.codigo || "")));
        estado.produtosCarregados = true;
        notificar("produtos");
    }, (erro) => console.error("produtos:", erro));
}

function escutarPedidos() {
    onSnapshot(query(colPedidos(estado.galpaoId), orderBy("criadoEm", "desc")), (snap) => {
        estado.pedidos = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
        notificar("pedidos");
    }, (erro) => console.error("pedidos:", erro));
}

// Guarda nome/e-mail no galpão para a equipe ver nomes em vez de UIDs.
function registrarMeuNome(galpao) {
    const info = (galpao.membrosInfo || {})[usuario.uid];
    if (info && info.nome === usuario.nome && info.email === usuario.email) return;

    updateDoc(refGalpao(estado.galpaoId), {
        [`membrosInfo.${usuario.uid}`]: { nome: usuario.nome, email: usuario.email }
    }).catch((e) => console.warn("Não foi possível registrar o nome no galpão.", e));
}

// Removido do galpão (ou galpão apagado): limpa o vínculo e sai.
async function sairDeGalpaoInacessivel() {
    try {
        await updateDoc(doc(db, "usuarios", usuario.uid), {
            galpaoIds: arrayRemove(estado.galpaoId)
        });
    } catch (e) {
        console.warn(e);
    }
    alert("Você não faz mais parte deste galpão.");
    window.location.href = estado.galpaoIds.length > 1 ? "selecionar-galpao.html" : "galpao.html";
}

// ─── Abas ───

function abasVisiveis() {
    return ABAS.filter((a) => !a.visivel || a.visivel(estado.papel));
}

function montarViews() {

    papelMontado = estado.papel;
    views = {};
    conteudoEl.innerHTML = "";

    const visiveis = abasVisiveis();

    navEl.innerHTML = visiveis.map((a) => `
        <button type="button" role="tab" data-aba="${a.id}" aria-selected="false">
            ${icone(a.icone)} ${esc(a.rotulo)}
            <span class="contador hidden" data-contador="${a.id}"></span>
        </button>
    `).join("");

    visiveis.forEach((aba) => {
        const el = document.createElement("section");
        el.className = "hidden";
        el.dataset.view = aba.id;
        conteudoEl.appendChild(el);
        views[aba.id] = aba.montar(el, ctx) || {};
    });

    const inicial = location.hash.slice(1);
    irPara(views[inicial] ? inicial : (views[abaAtual] ? abaAtual : "estoque"));

    notificar("tudo");
}

navEl.addEventListener("click", (e) => {
    const botao = e.target.closest("[data-aba]");
    if (botao) irPara(botao.dataset.aba);
});

// Links/voltar do navegador que mudam só o #hash.
window.addEventListener("hashchange", () => {
    const id = location.hash.slice(1);
    if (id !== abaAtual && views[id]) irPara(id);
});

function irPara(id, params = {}) {

    if (!views[id]) return;

    abaAtual = id;
    history.replaceState(null, "", location.search + "#" + id);

    navEl.querySelectorAll("[data-aba]").forEach((b) => {
        b.setAttribute("aria-selected", String(b.dataset.aba === id));
    });

    conteudoEl.querySelectorAll("[data-view]").forEach((el) => {
        el.classList.toggle("hidden", el.dataset.view !== id);
    });

    if (views[id].mostrar) views[id].mostrar(params);

    window.scrollTo({ top: 0 });
}

function notificar(motivo) {
    Object.values(views).forEach((v) => v.atualizar && v.atualizar(motivo));
    atualizarContadores();
}

// Badge na aba "Pedidos" com quantos pedidos aguardam ação minha.
function atualizarContadores() {
    const el = navEl.querySelector('[data-contador="pedidos"]');
    if (!el) return;

    const aguardando = estado.pedidos.filter((p) =>
        (p.status === "pendente" && ctx.pode("aprovarPedido"))
        || (["aprovado", "em_separacao"].includes(p.status) && ctx.pode("separarPedido"))
    ).length;

    el.textContent = aguardando;
    el.classList.toggle("hidden", aguardando === 0);
}

// ─── Logout ───

$("#logout-btn").addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "login.html";
});
