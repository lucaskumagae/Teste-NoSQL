import {
    createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
 
import {
    doc,
    setDoc
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";
 
import { auth, db } from "./firebase-config.js";
 
const form = document.getElementById("register-form");
 
const message =
    document.getElementById("register-message");
 
form.addEventListener("submit", async (event) => {
 
    event.preventDefault();
 
    const nome =
        document.getElementById("name").value;
 
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
 
        const uid = userCredential.user.uid;
 
        console.log("Usuário criado:", uid);
 
        // Cria o documento do usuário no Firestore,
        // usando o mesmo uid do Firebase Auth como ID do documento.
        await setDoc(doc(db, "usuarios", uid), {
            nome: nome,
            email: email,
            galpaoId: null,
            criadoEm: new Date().toISOString()
        });
 
        message.textContent =
            "Conta criada com sucesso!";
 
    } catch (error) {
 
        console.error(error);
 
        message.textContent =
            "Erro ao criar a conta.";
 
    }
 
});
 