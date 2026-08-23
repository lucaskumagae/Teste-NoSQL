import {
    signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
    doc,
    getDoc
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

import { auth, db } from "./firebase-config.js";

const form = document.getElementById("login-form");

const message = document.getElementById("login-message");

form.addEventListener("submit", async (event) => {

    event.preventDefault();

    const email =
        document.getElementById("email").value;

    const password =
        document.getElementById("password").value;

    try {

        const userCredential =
            await signInWithEmailAndPassword(
                auth,
                email,
                password
            );

        const uid = userCredential.user.uid;

        console.log("Usuário conectado:", uid);

        message.textContent =
            "Login realizado com sucesso!";

        // Busca o documento do usuário pra saber quantos galpões ele tem.
        const usuarioSnap = await getDoc(doc(db, "usuarios", uid));
        const usuarioData = usuarioSnap.data();
        const galpaoIds = (usuarioData && usuarioData.galpaoIds) || [];

        if (galpaoIds.length === 0) {
            // Nenhum galpão ainda -> vai criar/entrar em um.
            window.location.href = "galpao.html";
        } else if (galpaoIds.length === 1) {
            // Só um galpão -> pula direto pro painel dele.
            window.location.href = "painel.html?galpao=" + galpaoIds[0];
        } else {
            // Vários galpões -> deixa o usuário escolher qual ver.
            window.location.href = "selecionar-galpao.html";
        }

    } catch (error) {

        console.error(error);

        message.textContent =
            "E-mail ou senha incorretos.";

    }

});