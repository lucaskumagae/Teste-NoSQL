// Papéis e permissões do galpão.
// IMPORTANTE: isto só controla o que aparece na tela. Quem de fato
// garante as permissões são as regras do Firestore (firestore.rules),
// que espelham esta mesma matriz.

export const PAPEIS = {
    admin: {
        rotulo: "Admin",
        cor: "accent",
        descricao: "Controle total, incluindo membros e papéis."
    },
    gerente: {
        rotulo: "Gerente",
        cor: "violet",
        descricao: "Relatórios, aprovação de pedidos e todas as movimentações."
    },
    conferente: {
        rotulo: "Conferente",
        cor: "info",
        descricao: "Confirma entradas e devoluções; cadastra produtos."
    },
    separador: {
        rotulo: "Separador",
        cor: "ok",
        descricao: "Registra saídas e separa/expede pedidos."
    },
    membro: {
        rotulo: "Membro",
        cor: "",
        descricao: "Consulta o estoque e solicita pedidos."
    }
};

// Papéis que um admin pode atribuir pela tela de equipe.
export const PAPEIS_ATRIBUIVEIS = ["admin", "gerente", "conferente", "separador", "membro"];

const MATRIZ = {
    editarProduto:    ["admin", "gerente", "conferente"],
    deletarProduto:   ["admin"],
    alterarStatus:    ["admin", "gerente"],
    entrada:          ["admin", "gerente", "conferente"],
    devolucao:        ["admin", "gerente", "conferente"],
    saida:            ["admin", "gerente", "separador"],
    ajuste:           ["admin", "gerente"],
    aprovarPedido:    ["admin", "gerente"],
    separarPedido:    ["admin", "gerente", "separador"],
    relatorios:       ["admin", "gerente"],
    gerenciarMembros: ["admin"]
};

// Legenda usada na tela de equipe.
export const ACOES_LEGIVEIS = [
    ["editarProduto", "Cadastrar/editar produtos"],
    ["entrada", "Registrar entrada"],
    ["devolucao", "Registrar devolução"],
    ["saida", "Registrar saída"],
    ["aprovarPedido", "Aprovar pedidos"],
    ["separarPedido", "Separar e expedir pedidos"],
    ["relatorios", "Relatórios e reconciliação"],
    ["deletarProduto", "Excluir produtos"],
    ["gerenciarMembros", "Gerenciar membros e papéis"]
];

export function pode(papel, acao) {
    return (MATRIZ[acao] || []).includes(papel);
}

// O criador é sempre admin; os demais usam o mapa "papeis" do galpão.
export function papelDe(galpao, uid) {
    if (!galpao || !uid) return "membro";
    if (galpao.criadoPor === uid) return "admin";
    const papel = (galpao.papeis || {})[uid];
    return PAPEIS[papel] ? papel : "membro";
}

export function badgePapel(papel) {
    const p = PAPEIS[papel] || PAPEIS.membro;
    return `<span class="badge sem-ponto ${p.cor}">${p.rotulo}</span>`;
}
