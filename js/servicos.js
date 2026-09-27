// Operações de dados do galpão (Firestore).
// Toda mudança de quantidade passa por registrar uma movimentação na
// MESMA transação — as regras do Firestore recusam o contrário.

import {
    doc,
    collection,
    getDoc,
    getDocs,
    addDoc,
    updateDoc,
    deleteDoc,
    query,
    orderBy,
    limit,
    writeBatch,
    runTransaction,
    serverTimestamp,
    arrayUnion
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";

import { db } from "./firebase-config.js";

// ─── Constantes de domínio ───

export const STATUS_PRODUTO = {
    em_estoque:   { rotulo: "Em estoque",   cor: "ok" },
    reservado:    { rotulo: "Reservado",    cor: "violet" },
    em_separacao: { rotulo: "Em separação", cor: "info" },
    expedido:     { rotulo: "Expedido",     cor: "" },
    devolvido:    { rotulo: "Devolvido",    cor: "warn" }
};

export const TIPOS_MOV = {
    entrada:   { rotulo: "Entrada",   cor: "ok" },
    saida:     { rotulo: "Saída",     cor: "danger" },
    devolucao: { rotulo: "Devolução", cor: "warn" },
    ajuste:    { rotulo: "Ajuste",    cor: "violet" }
};

export const MOTIVOS_DEVOLUCAO = {
    avariado:    "Avariado",
    excesso:     "Excesso",
    erro_pedido: "Erro de pedido",
    outro:       "Outro"
};

export const STATUS_PEDIDO = {
    pendente:     { rotulo: "Pendente",     cor: "warn",    passo: 0 },
    aprovado:     { rotulo: "Reservado",    cor: "violet",  passo: 1 },
    em_separacao: { rotulo: "Em separação", cor: "info",    passo: 2 },
    expedido:     { rotulo: "Expedido",     cor: "ok",      passo: 3 },
    rejeitado:    { rotulo: "Rejeitado",    cor: "danger",  passo: -1 },
    cancelado:    { rotulo: "Cancelado",    cor: "",        passo: -1 }
};

// Limite imposto pelas regras (máx. 20 leituras auxiliares por transação).
export const MAX_ITENS_PEDIDO = 8;

// ─── Referências ───

const refGalpao = (g) => doc(db, "galpoes", g);
const colProdutos = (g) => collection(db, "galpoes", g, "produtos");
const refProduto = (g, p) => doc(db, "galpoes", g, "produtos", p);
const colMovs = (g, p) => collection(db, "galpoes", g, "produtos", p, "movimentacoes");
const colPedidos = (g) => collection(db, "galpoes", g, "pedidos");
const refPedido = (g, p) => doc(db, "galpoes", g, "pedidos", p);
const colReconciliacoes = (g) => collection(db, "galpoes", g, "reconciliacoes");

export { refGalpao, colProdutos, colPedidos, colReconciliacoes };

// ─── Regras de negócio puras ───

// Quanto o saldo muda para cada tipo de movimentação.
// Devolução "avariado" fica registrada, mas não volta para o estoque.
export function calcularDelta(tipo, quantidade, { motivo, sentidoAjuste } = {}) {
    switch (tipo) {
        case "entrada":   return quantidade;
        case "saida":     return -quantidade;
        case "devolucao": return motivo === "avariado" ? 0 : quantidade;
        case "ajuste":    return sentidoAjuste < 0 ? -quantidade : quantidade;
        default: throw new Error("Tipo de movimentação inválido: " + tipo);
    }
}

function statusAposMovimentacao(tipo, saldoApos, statusAtual) {
    if (tipo === "entrada") return "em_estoque";
    if (tipo === "devolucao") return "devolvido";
    if (tipo === "saida") return saldoApos > 0 ? "em_estoque" : "expedido";
    return statusAtual || "em_estoque";
}

function montarMovimentacao({ tipo, quantidade, delta, motivo, observacao, pedidoId, saldoApos, produtoNome, usuario }) {
    return {
        tipo,
        quantidade,
        delta,
        motivo: tipo === "devolucao" ? motivo : null,
        observacao: observacao || "",
        pedidoId: pedidoId || null,
        saldoApos,
        produtoNome,
        uid: usuario.uid,
        usuarioNome: usuario.nome,
        criadoEm: serverTimestamp()
    };
}

// ─── Produtos ───

// dados = campos cadastrais (nome, categoria, preco, posicao, lote, validade, atributos)
export async function criarProduto(galpaoId, dados, quantidadeInicial, usuario) {

    const prodRef = doc(colProdutos(galpaoId));
    const batch = writeBatch(db);

    const produto = {
        ...dados,
        quantidade: quantidadeInicial,
        status: "em_estoque",
        ultimaMovId: null,
        criadoEm: serverTimestamp(),
        atualizadoEm: serverTimestamp()
    };

    // Estoque inicial vira uma "entrada" no histórico.
    if (quantidadeInicial > 0) {
        const movRef = doc(colMovs(galpaoId, prodRef.id));
        produto.ultimaMovId = movRef.id;
        batch.set(movRef, montarMovimentacao({
            tipo: "entrada",
            quantidade: quantidadeInicial,
            delta: quantidadeInicial,
            observacao: "Estoque inicial no cadastro",
            saldoApos: quantidadeInicial,
            produtoNome: dados.nome,
            usuario
        }));
    }

    batch.set(prodRef, produto);
    await batch.commit();

    return prodRef.id;
}

export function atualizarProduto(galpaoId, produtoId, dados) {
    return updateDoc(refProduto(galpaoId, produtoId), {
        ...dados,
        atualizadoEm: serverTimestamp()
    });
}

export function alterarStatusProduto(galpaoId, produtoId, status) {
    return updateDoc(refProduto(galpaoId, produtoId), {
        status,
        atualizadoEm: serverTimestamp()
    });
}

export function deletarProduto(galpaoId, produtoId) {
    return deleteDoc(refProduto(galpaoId, produtoId));
}

// ─── Movimentações ───

export async function registrarMovimentacao(galpaoId, {
    produtoId, tipo, quantidade, motivo, observacao, sentidoAjuste, pedidoId
}, usuario) {

    if (!Number.isInteger(quantidade) || quantidade <= 0) {
        throw new ErroNegocio("Informe uma quantidade inteira maior que zero.");
    }

    if (tipo === "devolucao" && !MOTIVOS_DEVOLUCAO[motivo]) {
        throw new ErroNegocio("Selecione o motivo da devolução.");
    }

    const prodRef = refProduto(galpaoId, produtoId);

    return runTransaction(db, async (tx) => {

        const snap = await tx.get(prodRef);

        if (!snap.exists()) {
            throw new ErroNegocio("Produto não encontrado.");
        }

        const produto = snap.data();
        const delta = calcularDelta(tipo, quantidade, { motivo, sentidoAjuste });
        const saldoApos = (produto.quantidade || 0) + delta;

        if (saldoApos < 0) {
            throw new ErroNegocio(
                `Saldo insuficiente: há ${produto.quantidade} unidade(s) de "${produto.nome}".`
            );
        }

        const movRef = doc(colMovs(galpaoId, produtoId));

        tx.set(movRef, montarMovimentacao({
            tipo, quantidade, delta, motivo, observacao, pedidoId,
            saldoApos, produtoNome: produto.nome, usuario
        }));

        tx.update(prodRef, {
            quantidade: saldoApos,
            ultimaMovId: movRef.id,
            status: statusAposMovimentacao(tipo, saldoApos, produto.status),
            atualizadoEm: serverTimestamp()
        });

        return { saldoApos, delta };
    });
}

export async function historicoProduto(galpaoId, produtoId, max = 100) {
    const snap = await getDocs(
        query(colMovs(galpaoId, produtoId), orderBy("criadoEm", "desc"), limit(max))
    );
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Lê o histórico de todos os produtos (para relatórios).
// Em galpões grandes, trocar por uma consulta collectionGroup com índice.
export async function todasMovimentacoes(galpaoId, produtoIds) {
    const listas = await Promise.all(produtoIds.map(async (produtoId) => {
        const snap = await getDocs(colMovs(galpaoId, produtoId));
        return snap.docs.map((d) => ({ id: d.id, produtoId, ...d.data() }));
    }));
    return listas.flat();
}

// ─── Pedidos ───

export function criarPedido(galpaoId, { itens, observacao }, usuario) {

    // Junta itens repetidos do mesmo produto numa linha só.
    const agrupados = new Map();
    itens.forEach((item) => {
        const atual = agrupados.get(item.produtoId);
        agrupados.set(item.produtoId, {
            produtoId: item.produtoId,
            nome: item.nome,
            quantidade: (atual ? atual.quantidade : 0) + item.quantidade
        });
    });

    const lista = [...agrupados.values()];

    if (lista.length === 0) {
        throw new ErroNegocio("Adicione pelo menos um item.");
    }

    if (lista.length > MAX_ITENS_PEDIDO) {
        throw new ErroNegocio(`Um pedido pode ter no máximo ${MAX_ITENS_PEDIDO} produtos diferentes.`);
    }

    return addDoc(colPedidos(galpaoId), {
        solicitante: usuario.uid,
        solicitanteNome: usuario.nome,
        itens: lista,
        observacao: observacao || "",
        status: "pendente",
        criadoEm: serverTimestamp(),
        eventos: [evento("pendente", usuario)]
    });
}

function evento(status, usuario, extra = {}) {
    return {
        status,
        uid: usuario.uid,
        nome: usuario.nome,
        em: new Date().toISOString(),
        ...extra
    };
}

// Status que o produto assume em cada etapa do pedido.
const STATUS_PRODUTO_POR_PEDIDO = {
    aprovado: "reservado",
    em_separacao: "em_separacao"
};

// Aprovar, iniciar separação, rejeitar ou cancelar.
// (Expedição tem função própria porque baixa o estoque.)
export async function mudarStatusPedido(galpaoId, pedidoId, novoStatus, usuario, { motivo } = {}) {

    const pedRef = refPedido(galpaoId, pedidoId);

    return runTransaction(db, async (tx) => {

        const pedSnap = await tx.get(pedRef);
        if (!pedSnap.exists()) throw new ErroNegocio("Pedido não encontrado.");

        const pedido = pedSnap.data();
        const produtosRefs = pedido.itens.map((i) => refProduto(galpaoId, i.produtoId));
        const produtosSnaps = await Promise.all(produtosRefs.map((r) => tx.get(r)));

        // Ao aprovar, confere se há saldo para tudo.
        if (novoStatus === "aprovado") {
            pedido.itens.forEach((item, i) => {
                const snap = produtosSnaps[i];
                if (!snap.exists()) {
                    throw new ErroNegocio(`"${item.nome}" não existe mais no estoque.`);
                }
                if (snap.data().quantidade < item.quantidade) {
                    throw new ErroNegocio(
                        `Saldo insuficiente de "${item.nome}": pedido ${item.quantidade}, disponível ${snap.data().quantidade}.`
                    );
                }
            });
        }

        const statusProduto = STATUS_PRODUTO_POR_PEDIDO[novoStatus];
        const liberando = ["cancelado", "rejeitado"].includes(novoStatus)
            && ["aprovado", "em_separacao"].includes(pedido.status);

        produtosSnaps.forEach((snap, i) => {
            if (!snap.exists()) return;
            if (statusProduto) {
                tx.update(produtosRefs[i], { status: statusProduto, atualizadoEm: serverTimestamp() });
            } else if (liberando && ["reservado", "em_separacao"].includes(snap.data().status)) {
                tx.update(produtosRefs[i], { status: "em_estoque", atualizadoEm: serverTimestamp() });
            }
        });

        tx.update(pedRef, {
            status: novoStatus,
            eventos: arrayUnion(evento(novoStatus, usuario, motivo ? { motivo } : {}))
        });
    });
}

// Baixa o estoque de todos os itens, gera uma "saída" por item e marca
// o pedido como expedido — tudo ou nada.
export async function expedirPedido(galpaoId, pedidoId, usuario) {

    const pedRef = refPedido(galpaoId, pedidoId);

    return runTransaction(db, async (tx) => {

        const pedSnap = await tx.get(pedRef);
        if (!pedSnap.exists()) throw new ErroNegocio("Pedido não encontrado.");

        const pedido = pedSnap.data();

        if (pedido.status !== "em_separacao") {
            throw new ErroNegocio("O pedido precisa estar em separação para ser expedido.");
        }

        const produtosRefs = pedido.itens.map((i) => refProduto(galpaoId, i.produtoId));
        const produtosSnaps = await Promise.all(produtosRefs.map((r) => tx.get(r)));

        pedido.itens.forEach((item, i) => {

            const snap = produtosSnaps[i];
            if (!snap.exists()) {
                throw new ErroNegocio(`"${item.nome}" não existe mais no estoque.`);
            }

            const produto = snap.data();
            const saldoApos = produto.quantidade - item.quantidade;

            if (saldoApos < 0) {
                throw new ErroNegocio(
                    `Saldo insuficiente de "${item.nome}": há ${produto.quantidade}, pedido ${item.quantidade}.`
                );
            }

            const movRef = doc(colMovs(galpaoId, item.produtoId));

            tx.set(movRef, montarMovimentacao({
                tipo: "saida",
                quantidade: item.quantidade,
                delta: -item.quantidade,
                observacao: "Expedição de pedido (conferido por QR)",
                pedidoId,
                saldoApos,
                produtoNome: produto.nome,
                usuario
            }));

            tx.update(produtosRefs[i], {
                quantidade: saldoApos,
                ultimaMovId: movRef.id,
                status: saldoApos > 0 ? "em_estoque" : "expedido",
                atualizadoEm: serverTimestamp()
            });
        });

        tx.update(pedRef, {
            status: "expedido",
            eventos: arrayUnion(evento("expedido", usuario))
        });
    });
}

// ─── Reconciliação de inventário ───

// itens: [{ produtoId, nome, sistema, contado }]
// Se `aplicar`, gera um "ajuste" para cada divergência, deixando o saldo
// igual à contagem física.
export async function salvarReconciliacao(galpaoId, itens, usuario, { aplicar, observacao }) {

    const divergentes = itens.filter((i) => i.contado !== i.sistema);
    const falhas = [];

    if (aplicar) {
        for (const item of divergentes) {
            try {
                await ajustarParaContagem(galpaoId, item, usuario);
            } catch (erro) {
                console.error(erro);
                falhas.push(item.nome);
            }
        }
    }

    await addDoc(colReconciliacoes(galpaoId), {
        uid: usuario.uid,
        usuarioNome: usuario.nome,
        criadoEm: serverTimestamp(),
        observacao: observacao || "",
        aplicada: Boolean(aplicar),
        totalItens: itens.length,
        totalDivergencias: divergentes.length,
        itens: itens.map((i) => ({
            produtoId: i.produtoId,
            nome: i.nome,
            sistema: i.sistema,
            contado: i.contado,
            diferenca: i.contado - i.sistema
        }))
    });

    return { divergentes: divergentes.length, falhas };
}

// Usa o saldo ATUAL (dentro da transação) para não sobrescrever uma
// movimentação que tenha acontecido durante a contagem.
async function ajustarParaContagem(galpaoId, item, usuario) {

    const prodRef = refProduto(galpaoId, item.produtoId);

    return runTransaction(db, async (tx) => {

        const snap = await tx.get(prodRef);
        if (!snap.exists()) throw new ErroNegocio("Produto removido.");

        const produto = snap.data();
        const delta = item.contado - produto.quantidade;
        if (delta === 0) return;

        const movRef = doc(colMovs(galpaoId, item.produtoId));

        tx.set(movRef, montarMovimentacao({
            tipo: "ajuste",
            quantidade: Math.abs(delta),
            delta,
            observacao: `Reconciliação: sistema ${produto.quantidade}, contagem física ${item.contado}`,
            saldoApos: item.contado,
            produtoNome: produto.nome,
            usuario
        }));

        tx.update(prodRef, {
            quantidade: item.contado,
            ultimaMovId: movRef.id,
            atualizadoEm: serverTimestamp()
        });
    });
}

export async function listarReconciliacoes(galpaoId, max = 10) {
    const snap = await getDocs(
        query(colReconciliacoes(galpaoId), orderBy("criadoEm", "desc"), limit(max))
    );
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ─── Galpão / membros ───

export async function lerGalpao(galpaoId) {
    const snap = await getDoc(refGalpao(galpaoId));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Erro com mensagem pronta para mostrar ao usuário.
export class ErroNegocio extends Error {}

export function mensagemDeErro(erro, padrao = "Algo deu errado. Tente novamente.") {
    if (erro instanceof ErroNegocio) return erro.message;
    if (erro && erro.code === "permission-denied") {
        return "Você não tem permissão para esta ação.";
    }
    console.error(erro);
    return padrao;
}
