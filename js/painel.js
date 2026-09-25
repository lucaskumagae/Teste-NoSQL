import {
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
    doc,
    getDoc,
    collection,
    addDoc,
    updateDoc,
    deleteDoc,
    arrayRemove,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

import { auth, db } from "./firebase-config.js";

let galpaoId = null;
let atributosCount = 0;
let souAdmin = false;
let uidAtual = null;

const galpaoNomeEl = document.getElementById("galpao-nome");
const galpaoCodigoEl = document.getElementById("galpao-codigo");
const trocarGalpaoEl = document.getElementById("trocar-galpao");

const form = document.getElementById("produto-form");
const formTitulo = document.getElementById("form-titulo");
const formMessage = document.getElementById("form-message");
const produtoIdInput = document.getElementById("produto-id");
const cancelarBtn = document.getElementById("cancelar-edicao");
const atributosContainer = document.getElementById("atributos-container");

const produtosListaEl = document.getElementById("produtos-lista");
const membrosListaEl = document.getElementById("membros-lista");

// ─── VERIFICA LOGIN E CARREGA O GALPÃO ───

onAuthStateChanged(auth, async (user) => {

    if (!user) {
        window.location.href = "login.html";
        return;
    }

    uidAtual = user.uid;

    const usuarioSnap = await getDoc(doc(db, "usuarios", user.uid));
    const usuarioData = usuarioSnap.data();
    const galpaoIds = (usuarioData && usuarioData.galpaoIds) || [];

    if (galpaoIds.length === 0) {
        window.location.href = "galpao.html";
        return;
    }

    // O galpão a ser exibido vem da URL: painel.html?galpao=ID
    const params = new URLSearchParams(window.location.search);
    const galpaoDaUrl = params.get("galpao");

    // Só aceita o galpão da URL se o usuário realmente pertencer a ele.
    if (galpaoDaUrl && galpaoIds.includes(galpaoDaUrl)) {
        galpaoId = galpaoDaUrl;
    } else {
        galpaoId = galpaoIds[0];
    }

    const galpaoSnap = await getDoc(doc(db, "galpoes", galpaoId));
    const galpaoData = galpaoSnap.data();

    galpaoNomeEl.textContent = galpaoData.nome;
    galpaoCodigoEl.textContent = galpaoId;

    // O criador do galpão é o admin: só ele pode remover membros
    // e deletar produtos (ver regras do Firestore).
    souAdmin = galpaoData.criadoPor === uidAtual;

    // Só mostra o link de trocar de galpão se o usuário tiver mais de um.
    if (galpaoIds.length > 1) {
        trocarGalpaoEl.style.display = "inline-block";
    }

    renderizarMembros(galpaoData.membros || [], galpaoData.criadoPor);
    escutarProdutos();

});

// ─── MEMBROS DO GALPÃO ───

function renderizarMembros(membros, criadoPor) {

    if (!membrosListaEl) return;

    membrosListaEl.innerHTML = "";

    membros.forEach((uid) => {

        const linha = document.createElement("div");
        linha.style.display = "flex";
        linha.style.justifyContent = "space-between";
        linha.style.alignItems = "center";
        linha.style.marginBottom = "6px";

        const rotulo = uid === uidAtual ? `${uid} (você)` : uid;
        const cargo = uid === criadoPor ? " — admin" : "";

        linha.innerHTML = `<span>${rotulo}${cargo}</span>`;

        // Só o admin pode remover membros, e não pode remover a si mesmo.
        if (souAdmin && uid !== criadoPor) {
            const btnRemover = document.createElement("button");
            btnRemover.textContent = "Remover";
            btnRemover.addEventListener("click", () => removerMembro(uid));
            linha.appendChild(btnRemover);
        }

        membrosListaEl.appendChild(linha);

    });

}

async function removerMembro(uid) {

    if (!confirm("Remover este membro do galpão?")) {
        return;
    }

    try {
        const galpaoRef = doc(db, "galpoes", galpaoId);
        await updateDoc(galpaoRef, {
            membros: arrayRemove(uid)
        });

        const galpaoSnap = await getDoc(galpaoRef);
        const galpaoData = galpaoSnap.data();
        renderizarMembros(galpaoData.membros || [], galpaoData.criadoPor);

    } catch (error) {
        console.error(error);
        alert("Erro ao remover membro.");
    }

}

// ─── LOGOUT ───

document.getElementById("logout-btn").addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "login.html";
});

// ─── ATRIBUTOS DINÂMICOS (chave/valor) ───

document.getElementById("add-atributo").addEventListener("click", () => {

    atributosCount++;

    const linha = document.createElement("div");
    linha.className = "atributo-linha";
    linha.style.display = "flex";
    linha.style.gap = "10px";
    linha.style.marginBottom = "10px";

    linha.innerHTML = `
        <input type="text" class="atributo-chave" placeholder="Ex: cor" style="flex:1;">
        <input type="text" class="atributo-valor" placeholder="Ex: azul" style="flex:1;">
        <button type="button" class="remover-atributo">x</button>
    `;

    linha.querySelector(".remover-atributo")
        .addEventListener("click", () => linha.remove());

    atributosContainer.appendChild(linha);

});

function lerAtributos() {

    const chaves = document.querySelectorAll(".atributo-chave");
    const valores = document.querySelectorAll(".atributo-valor");

    const atributos = {};

    chaves.forEach((chaveInput, i) => {
        const chave = chaveInput.value.trim();
        const valor = valores[i].value.trim();

        if (chave) {
            atributos[chave] = valor;
        }
    });

    return atributos;

}

function limparAtributos() {
    atributosContainer.querySelectorAll(".atributo-linha")
        .forEach((el) => el.remove());
}

// ─── CRIAR / ATUALIZAR PRODUTO ───

form.addEventListener("submit", async (event) => {

    event.preventDefault();

    const produtoId = produtoIdInput.value;

    const dados = {
        nome: document.getElementById("nome").value,
        categoria: document.getElementById("categoria").value,
        quantidade: Number(document.getElementById("quantidade").value),
        preco: Number(document.getElementById("preco").value),
        atributos: lerAtributos()
    };

    try {

        if (produtoId) {
            // Edição de produto existente
            await updateDoc(
                doc(db, "galpoes", galpaoId, "produtos", produtoId),
                dados
            );
            formMessage.textContent = "Produto atualizado!";
        } else {
            // Criação de produto novo
            await addDoc(
                collection(db, "galpoes", galpaoId, "produtos"),
                dados
            );
            formMessage.textContent = "Produto criado!";
        }

        resetarFormulario();

    } catch (error) {
        console.error(error);
        formMessage.textContent = "Erro ao salvar o produto.";
    }

});

function resetarFormulario() {
    form.reset();
    limparAtributos();
    produtoIdInput.value = "";
    formTitulo.textContent = "Novo produto";
    cancelarBtn.style.display = "none";
}

cancelarBtn.addEventListener("click", resetarFormulario);

// ─── LISTAR PRODUTOS EM TEMPO REAL ───

function escutarProdutos() {

    const produtosRef = collection(db, "galpoes", galpaoId, "produtos");

    onSnapshot(produtosRef, (snapshot) => {

        produtosListaEl.innerHTML = "";

        snapshot.forEach((docSnap) => {

            const produto = docSnap.data();
            const id = docSnap.id;

            const atributosTexto = Object.entries(produto.atributos || {})
                .map(([chave, valor]) => `${chave}: ${valor}`)
                .join(", ");

            const card = document.createElement("div");
            card.style.border = "1px solid #ccc";
            card.style.borderRadius = "5px";
            card.style.padding = "10px";
            card.style.marginBottom = "10px";

            card.innerHTML = `
                <strong>${produto.nome}</strong> (${produto.categoria})<br>
                Quantidade: ${produto.quantidade} | Preço: R$ ${produto.preco.toFixed(2)}<br>
                ${atributosTexto ? "Atributos: " + atributosTexto : ""}
                <br><br>
                <button class="editar-btn">Editar</button>
                ${souAdmin ? '<button class="deletar-btn">Deletar</button>' : ""}
            `;

            card.querySelector(".editar-btn")
                .addEventListener("click", () => preencherEdicao(id, produto));

            const btnDeletar = card.querySelector(".deletar-btn");
            if (btnDeletar) {
                btnDeletar.addEventListener("click", () => deletarProduto(id));
            }

            produtosListaEl.appendChild(card);

        });

    });

}

function preencherEdicao(id, produto) {

    produtoIdInput.value = id;
    document.getElementById("nome").value = produto.nome;
    document.getElementById("categoria").value = produto.categoria;
    document.getElementById("quantidade").value = produto.quantidade;
    document.getElementById("preco").value = produto.preco;

    limparAtributos();

    Object.entries(produto.atributos || {}).forEach(([chave, valor]) => {
        document.getElementById("add-atributo").click();
        const linhas = atributosContainer.querySelectorAll(".atributo-linha");
        const ultimaLinha = linhas[linhas.length - 1];
        ultimaLinha.querySelector(".atributo-chave").value = chave;
        ultimaLinha.querySelector(".atributo-valor").value = valor;
    });

    formTitulo.textContent = "Editando: " + produto.nome;
    cancelarBtn.style.display = "inline-block";

    window.scrollTo({ top: 0, behavior: "smooth" });

}

async function deletarProduto(id) {

    if (!confirm("Tem certeza que deseja deletar este produto?")) {
        return;
    }

    try {
        await deleteDoc(doc(db, "galpoes", galpaoId, "produtos", id));
    } catch (error) {
        console.error(error);
        alert("Erro ao deletar o produto.");
    }

}