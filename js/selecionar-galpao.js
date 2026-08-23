import {
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
    doc,
    getDoc
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

import { auth, db } from "./firebase-config.js";

const galpoesListaEl = document.getElementById("galpoes-lista");

// Bloqueia o acesso a essa página se não houver usuário logado.
onAuthStateChanged(auth, async (user) => {

    if (!user) {
        window.location.href = "login.html";
        return;
    }

    const usuarioSnap = await getDoc(doc(db, "usuarios", user.uid));
    const usuarioData = usuarioSnap.data();
    const galpaoIds = (usuarioData && usuarioData.galpaoIds) || [];

    if (galpaoIds.length === 0) {
        window.location.href = "galpao.html";
        return;
    }

    if (galpaoIds.length === 1) {
        window.location.href = "painel.html?galpao=" + galpaoIds[0];
        return;
    }

    // Busca os dados de cada galpão pra mostrar o nome, não só o ID.
    for (const galpaoId of galpaoIds) {

        const galpaoSnap = await getDoc(doc(db, "galpoes", galpaoId));

        if (!galpaoSnap.exists()) {
            continue;
        }

        const galpao = galpaoSnap.data();

        const card = document.createElement("a");
        card.href = "painel.html?galpao=" + galpaoId;
        card.style.display = "block";
        card.style.border = "1px solid #ccc";
        card.style.borderRadius = "5px";
        card.style.padding = "10px";
        card.style.marginBottom = "10px";
        card.style.color = "inherit";

        card.innerHTML = `
            <strong>${galpao.nome}</strong><br>
            Código: ${galpaoId}
        `;

        galpoesListaEl.appendChild(card);

    }

});

// ─── LOGOUT ───

document.getElementById("logout-btn").addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "login.html";
});