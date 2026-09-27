import {
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";

import {
    doc,
    getDoc
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

import { auth, db } from "./firebase-config.js";
import { esc } from "./ui.js";
import { papelDe, badgePapel } from "./permissoes.js";

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

    // Busca os dados de cada galpão (em paralelo) pra mostrar o nome, não só o ID.
    const snaps = await Promise.all(
        galpaoIds.map((id) => getDoc(doc(db, "galpoes", id)).catch(() => null))
    );

    const cards = snaps
        .map((snap, i) => ({ snap, id: galpaoIds[i] }))
        // Ignora galpões apagados ou dos quais o usuário foi removido.
        .filter(({ snap }) => snap && snap.exists() && (snap.data().membros || []).includes(user.uid))
        .map(({ snap, id }) => {
            const galpao = snap.data();
            return `
                <a class="galpao-opcao" href="painel.html?galpao=${encodeURIComponent(id)}">
                    <span>
                        <strong>${esc(galpao.nome)}</strong><br>
                        <span class="subtle">${esc(galpao.endereco || "Sem endereço")} · ${(galpao.membros || []).length} membro(s)</span>
                    </span>
                    ${badgePapel(papelDe(galpao, user.uid))}
                </a>
            `;
        });

    galpoesListaEl.innerHTML = cards.length
        ? cards.join("")
        : `<p class="muted">Você não participa de nenhum galpão ativo.</p>`;

});

// ─── LOGOUT ───

document.getElementById("logout-btn").addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "login.html";
});
