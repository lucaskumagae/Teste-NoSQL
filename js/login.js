import {
    signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import { auth } from "./firebase-config.js";

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

        console.log(
            "Usuário conectado:",
            userCredential.user.uid
        );

        message.textContent =
            "Login realizado com sucesso!";

    } catch (error) {

        console.error(error);

        message.textContent =
            "E-mail ou senha incorretos.";

    }

});