import {
    createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import { auth } from "./firebase-config.js";

const form = document.getElementById("register-form");

const message =
    document.getElementById("register-message");

form.addEventListener("submit", async (event) => {

    event.preventDefault();

    const email =
        document.getElementById("email").value;

    const password =
        document.getElementById("password").value;

    try {

        const userCredential =
            await createUserWithEmailAndPassword(
                auth,
                email,
                password
            );

        console.log(
            "Usuário criado:",
            userCredential.user.uid
        );

        message.textContent =
            "Conta criada com sucesso!";

    } catch (error) {

        console.error(error);

        message.textContent =
            "Erro ao criar a conta.";

    }

});