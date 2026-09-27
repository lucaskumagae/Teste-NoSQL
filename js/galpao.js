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
import { mensagem } from "./ui.js";

const criarForm = document.getElementById("criar-galpao-form");
const criarMessage = document.getElementById("criar-message");

const entrarForm = document.getElementById("entrar-galpao-form");
const entrarMessage = document.getElementById("entrar-message");

// Nome/e-mail do usuário logado — gravados no galpão para a equipe
// enxergar nomes em vez de UIDs.
let meuPerfil = null;

// Se o formulário for enviado antes do perfil carregar, usa o e-mail.
function perfil() {
    const email = auth.currentUser.email;
    return meuPerfil || { nome: email, email };
}

// Bloqueia o acesso a essa página se não houver usuário logado.
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "login.html";
        return;
    }

    const snap = await getDoc(doc(db, "usuarios", user.uid));
    const dados = snap.data() || {};

    meuPerfil = {
        nome: dados.nome || user.email,
        email: dados.email || user.email
    };

    // Quem já tem galpões ganha um atalho de volta.
    if ((dados.galpaoIds || []).length > 0) {
        document.getElementById("voltar-painel").classList.remove("hidden");
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

    const nome = document.getElementById("nome-galpao").value.trim();
    const endereco = document.getElementById("endereco-galpao").value.trim();

    const uid = auth.currentUser.uid;

    try {

        // Cria o galpão em uma coleção separada.
        // addDoc gera um ID automático — esse ID é o "código" do galpão.
        // O criador entra automaticamente como membro (e é o admin, via criadoPor).
        const novoGalpao = await addDoc(collection(db, "galpoes"), {
            nome: nome,
            endereco: endereco,
            criadoPor: uid,
            membros: [uid],
            membrosInfo: { [uid]: perfil() },
            criadoEm: new Date().toISOString()
        });

        // Adiciona o galpão à LISTA de galpões do usuário, sem apagar os outros.
        await updateDoc(doc(db, "usuarios", uid), {
            galpaoIds: arrayUnion(novoGalpao.id)
        });

        mensagem(criarMessage, "Galpão criado! Abrindo…", "ok");

        window.location.href = "painel.html?galpao=" + novoGalpao.id;

    } catch (error) {

        console.error(error);
        mensagem(criarMessage, "Erro ao criar o galpão.", "erro");

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
            mensagem(entrarMessage, "Código de galpão inválido.", "erro");
            return;
        }

        // Adiciona o usuário à lista de membros do galpão
        // (é isso que dá a ele acesso aos produtos, via regras do Firestore).
        // Quem já é membro não precisa ser adicionado de novo.
        if (!(galpaoSnap.data().membros || []).includes(uid)) {
            await updateDoc(galpaoRef, {
                membros: arrayUnion(uid),
                [`membrosInfo.${uid}`]: perfil()
            });
        }

        await updateDoc(doc(db, "usuarios", uid), {
            galpaoIds: arrayUnion(codigo)
        });

        mensagem(entrarMessage, "Você entrou no galpão!", "ok");

        window.location.href = "painel.html?galpao=" + codigo;

    } catch (error) {

        console.error(error);
        mensagem(entrarMessage, "Erro ao entrar no galpão.", "erro");

    }

});
