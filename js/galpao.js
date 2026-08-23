import {
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
    collection,
    addDoc,
    doc,
    getDoc,
    updateDoc,
    arrayUnion
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

import { auth, db } from "./firebase-config.js";

const criarForm = document.getElementById("criar-galpao-form");
const criarMessage = document.getElementById("criar-message");

const entrarForm = document.getElementById("entrar-galpao-form");
const entrarMessage = document.getElementById("entrar-message");

// Bloqueia o acesso a essa página se não houver usuário logado.
onAuthStateChanged(auth, (user) => {
    if (!user) {
        window.location.href = "login.html";
    }
});

// ─── LOGOUT ───

document.getElementById("logout-btn").addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "login.html";
});

// CRIAR GALPÃO NOVO
criarForm.addEventListener("submit", async (event) => {

    event.preventDefault();

    const nome = document.getElementById("nome-galpao").value;
    const endereco = document.getElementById("endereco-galpao").value;

    const uid = auth.currentUser.uid;

    try {

        // Cria o galpão em uma coleção separada.
        // addDoc gera um ID automático — esse ID é o "código" do galpão.
        const novoGalpao = await addDoc(collection(db, "galpoes"), {
            nome: nome,
            endereco: endereco,
            criadoPor: uid,
            criadoEm: new Date().toISOString()
        });

        // Adiciona o galpão à LISTA de galpões do usuário, sem apagar os outros.
        await updateDoc(doc(db, "usuarios", uid), {
            galpaoIds: arrayUnion(novoGalpao.id)
        });

        criarMessage.textContent =
            "Galpão criado! Código: " + novoGalpao.id;

        window.location.href = "painel.html?galpao=" + novoGalpao.id;

    } catch (error) {

        console.error(error);
        criarMessage.textContent = "Erro ao criar o galpão.";

    }

});

// ENTRAR EM GALPÃO EXISTENTE
entrarForm.addEventListener("submit", async (event) => {

    event.preventDefault();

    const codigo = document.getElementById("codigo-galpao").value.trim();

    const uid = auth.currentUser.uid;

    try {

        // Verifica se o galpão com esse ID realmente existe
        // antes de vincular o usuário a ele.
        const galpaoRef = doc(db, "galpoes", codigo);
        const galpaoSnap = await getDoc(galpaoRef);

        if (!galpaoSnap.exists()) {
            entrarMessage.textContent = "Código de galpão inválido.";
            return;
        }

        await updateDoc(doc(db, "usuarios", uid), {
            galpaoIds: arrayUnion(codigo)
        });

        entrarMessage.textContent = "Você entrou no galpão!";

        window.location.href = "painel.html?galpao=" + codigo;

    } catch (error) {

        console.error(error);
        entrarMessage.textContent = "Erro ao entrar no galpão.";

    }

});