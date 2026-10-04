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
import { gerarCodigo, normalizarCodigo, formatarCodigo } from "./codigos.js";

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

// Condição do produto.
// - "novo": controlado por QUANTIDADE (unidades iguais entre si).
// - demais: ITEM INDIVIDUAL — um cadastro por peça, saldo 0 ou 1, e o ID do
//   produto é o próprio código curto da peça (etiqueta única).
export const CONDICOES = {
    novo:           { rotulo: "Novo",           cor: "ok" },
    aberto:         { rotulo: "Aberto",         cor: "info" },
    usado:          { rotulo: "Usado",          cor: "" },
    danificado:     { rotulo: "Danificado",     cor: "danger" },
    recondicionado: { rotulo: "Recondicionado", cor: "violet" }
};

// Condições possíveis ao cadastrar um produto (entrada).
export const CONDICOES_CADASTRO = ["novo", "usado", "recondicionado"];

// Como a peça voltou (diferente do MOTIVO, que diz por que voltou).
export const ESTADOS_DEVOLUCAO = {
    novo:       "Novo (lacrado, sem uso)",
    aberto:     "Aberto",
    danificado: "Danificado"
};

export const MOTIVOS_DEVOLUCAO = {
    defeito:     "Defeito",
    excesso:     "Excesso",
    erro_pedido: "Erro de pedido",
    outro:       "Outro"
};

// Motivos de versões anteriores, só para exibir o histórico antigo.
const MOTIVOS_LEGADOS = { avariado: "Avariado" };

export function rotuloMotivo(motivo) {
    return MOTIVOS_DEVOLUCAO[motivo] || MOTIVOS_LEGADOS[motivo] || motivo;
}

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

// Cada unidade expedida gera um documento de unidade; uma transação do
// Firestore aceita no máximo 500 gravações.
export const MAX_UNIDADES_PEDIDO = 200;

export function ehIndividual(produto) {
    return Boolean(produto) && (produto.condicao || "novo") !== "novo";
}

// Item individual que pode ser pedido (danificado só depois da manutenção).
export function individualDisponivel(produto) {
    return ehIndividual(produto) && produto.condicao !== "danificado" && produto.quantidade === 1;
}

// ─── Referências ───

const refGalpao = (g) => doc(db, "galpoes", g);
const colProdutos = (g) => collection(db, "galpoes", g, "produtos");
const refProduto = (g, p) => doc(db, "galpoes", g, "produtos", p);
const colMovs = (g, p) => collection(db, "galpoes", g, "produtos", p, "movimentacoes");
const colPedidos = (g) => collection(db, "galpoes", g, "pedidos");
const refPedido = (g, p) => doc(db, "galpoes", g, "pedidos", p);
const colReconciliacoes = (g) => collection(db, "galpoes", g, "reconciliacoes");
const refUnidade = (g, c) => doc(db, "galpoes", g, "unidades", normalizarCodigo(c));

export { refGalpao, colProdutos, colPedidos, colReconciliacoes };

// ─── Regras de negócio puras ───

// Quanto o saldo muda para cada tipo de movimentação.
export function calcularDelta(tipo, quantidade, { sentidoAjuste } = {}) {
    switch (tipo) {
        case "entrada":   return quantidade;
        case "saida":     return -quantidade;
        case "devolucao": return quantidade;
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

function montarMovimentacao({
    tipo, quantidade, delta, motivo, estado, observacao, pedidoId, pedidoCodigo,
    codigos, saldoApos, produtoNome, usuario
}) {
    return {
        tipo,
        quantidade,
        delta,
        motivo: tipo === "devolucao" ? motivo : null,
        estado: tipo === "devolucao" ? estado : null,
        observacao: observacao || "",
        pedidoId: pedidoId || null,
        pedidoCodigo: pedidoCodigo || null,
        codigos: codigos || [],
        saldoApos,
        produtoNome,
        uid: usuario.uid,
        usuarioNome: usuario.nome,
        criadoEm: serverTimestamp()
    };
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

// Gera um código curto que ainda não existe (confere dentro da transação).
async function codigoLivre(tx, galpaoId) {
    for (let tentativa = 0; tentativa < 5; tentativa++) {
        const codigo = gerarCodigo();
        const [uni, prod] = await Promise.all([
            tx.get(refUnidade(galpaoId, codigo)),
            tx.get(refProduto(galpaoId, codigo))
        ]);
        if (!uni.exists() && !prod.exists()) return codigo;
    }
    throw new ErroNegocio("Não foi possível gerar um código único. Tente novamente.");
}

// Campos copiados do produto novo para o item individual que nasce dele.
function dadosHerdados(base) {
    return {
        nome: base.nome,
        categoria: base.categoria || "",
        preco: base.preco || 0,
        posicao: base.posicao || {},
        lote: base.lote || "",
        validade: base.validade || "",
        atributos: base.atributos || {}
    };
}

// ─── Produtos ───

// dados = campos cadastrais (nome, categoria, preco, posicao, lote, validade,
// atributos, condicao, estadoObs). Produtos usados/recondicionados entram
// sempre com 1 unidade e ganham código curto próprio.
// Devolve { id, codigo? }.
export async function criarProduto(galpaoId, dados, quantidadeInicial, usuario) {

    const condicao = dados.condicao || "novo";

    if (condicao !== "novo") {
        return criarItemIndividual(galpaoId, dados, usuario);
    }

    const prodRef = doc(colProdutos(galpaoId));
    const batch = writeBatch(db);

    const produto = {
        ...dados,
        condicao: "novo",
        quantidade: quantidadeInicial,
        status: "em_estoque",
        ultimaMovId: null,
        criadoEm: serverTimestamp(),
        atualizadoEm: serverTimestamp()
    };
    delete produto.estadoObs;

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

    return { id: prodRef.id };
}

async function criarItemIndividual(galpaoId, dados, usuario) {
    return runTransaction(db, async (tx) => {

        const codigo = await codigoLivre(tx, galpaoId);
        const prodRef = refProduto(galpaoId, codigo);
        const movRef = doc(colMovs(galpaoId, codigo));

        tx.set(movRef, montarMovimentacao({
            tipo: "entrada",
            quantidade: 1,
            delta: 1,
            observacao: `Cadastro de item ${CONDICOES[dados.condicao].rotulo.toLowerCase()}`,
            codigos: [codigo],
            saldoApos: 1,
            produtoNome: dados.nome,
            usuario
        }));

        tx.set(prodRef, {
            ...dados,
            codigo,
            produtoBaseId: null,
            quantidade: 1,
            status: "em_estoque",
            ultimaMovId: movRef.id,
            manutencoes: [],
            criadoEm: serverTimestamp(),
            atualizadoEm: serverTimestamp()
        });

        tx.set(refUnidade(galpaoId, codigo), {
            codigo,
            produtoId: codigo,
            itemId: codigo,
            produtoNome: dados.nome,
            condicao: dados.condicao,
            status: "em_estoque",
            pedidoId: null,
            pedidoCodigo: null,
            criadoEm: serverTimestamp(),
            atualizadoEm: serverTimestamp(),
            eventos: [evento("cadastro", usuario, { condicao: dados.condicao })]
        });

        return { id: codigo, codigo };
    });
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

// Item individual consertado (troca de bateria, reparo…): passa a
// "recondicionado" e fica disponível para pedidos de novo.
export async function registrarManutencao(galpaoId, produtoId, descricao, usuario) {

    if (!descricao) throw new ErroNegocio("Descreva o que foi feito na manutenção.");

    const prodRef = refProduto(galpaoId, produtoId);

    return runTransaction(db, async (tx) => {
        const snap = await tx.get(prodRef);
        if (!snap.exists()) throw new ErroNegocio("Produto não encontrado.");
        const produto = snap.data();
        if (!ehIndividual(produto)) throw new ErroNegocio("Manutenção é registrada em itens individuais.");

        const registro = evento("manutencao", usuario, { descricao, condicaoAnterior: produto.condicao });

        tx.update(prodRef, {
            condicao: "recondicionado",
            estadoObs: descricao,
            manutencoes: arrayUnion(registro),
            atualizadoEm: serverTimestamp()
        });

        tx.set(refUnidade(galpaoId, produto.codigo || produtoId), {
            condicao: "recondicionado",
            atualizadoEm: serverTimestamp(),
            eventos: arrayUnion(registro)
        }, { merge: true });
    });
}

// ─── Unidades (códigos curtos) ───

export async function lerUnidade(galpaoId, codigo) {
    const snap = await getDoc(refUnidade(galpaoId, codigo));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ─── Movimentações (entrada / saída avulsa) ───

export async function registrarMovimentacao(galpaoId, {
    produtoId, tipo, quantidade, observacao, sentidoAjuste
}, usuario) {

    if (tipo === "devolucao") {
        throw new Error("Use registrarDevolucao() para devoluções.");
    }

    if (!Number.isInteger(quantidade) || quantidade <= 0) {
        throw new ErroNegocio("Informe uma quantidade inteira maior que zero.");
    }

    const prodRef = refProduto(galpaoId, produtoId);

    return runTransaction(db, async (tx) => {

        const snap = await tx.get(prodRef);

        if (!snap.exists()) {
            throw new ErroNegocio("Produto não encontrado.");
        }

        const produto = snap.data();

        if (ehIndividual(produto)) {
            throw new ErroNegocio("Itens individuais só saem por pedido e só voltam por devolução.");
        }

        const delta = calcularDelta(tipo, quantidade, { sentidoAjuste });
        const saldoApos = (produto.quantidade || 0) + delta;

        if (saldoApos < 0) {
            throw new ErroNegocio(
                `Saldo insuficiente: há ${produto.quantidade} unidade(s) de "${produto.nome}".`
            );
        }

        const movRef = doc(colMovs(galpaoId, produtoId));

        tx.set(movRef, montarMovimentacao({
            tipo, quantidade, delta, observacao,
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

// ─── Devolução ───

// Dois caminhos:
//  a) COM código (etiqueta da unidade): o sistema sabe exatamente qual peça
//     voltou e de qual pedido ela saiu. Recusa se a peça não consta como fora.
//  b) SEM código (peça que saiu avulsa, sem etiqueta): escolhe-se o produto.
//
// Estado em que voltou:
//  - novo:  volta ao saldo do produto novo;
//  - aberto/danificado: vira (ou continua) ITEM INDIVIDUAL com o código da
//    peça — não volta ao saldo "novo". Sem código, um código novo é gerado.
//
// Devolve { produtoId, codigo, codigoNovo: bool, saldoApos }.
export async function registrarDevolucao(galpaoId, {
    codigo, produtoId, quantidade = 1, estado, motivo, observacao
}, usuario) {

    if (!ESTADOS_DEVOLUCAO[estado]) throw new ErroNegocio("Informe em que estado a peça voltou.");
    if (!MOTIVOS_DEVOLUCAO[motivo]) throw new ErroNegocio("Selecione o motivo da devolução.");
    if (!Number.isInteger(quantidade) || quantidade <= 0) {
        throw new ErroNegocio("Informe uma quantidade inteira maior que zero.");
    }

    return runTransaction(db, async (tx) => {

        let unidade = null;
        let baseId = produtoId;

        // ── Leituras ──
        if (codigo) {
            const uniSnap = await tx.get(refUnidade(galpaoId, codigo));
            if (!uniSnap.exists()) {
                throw new ErroNegocio(`Código ${formatarCodigo(codigo)} não encontrado neste galpão.`);
            }
            unidade = uniSnap.data();
            if (unidade.status !== "fora") {
                throw new ErroNegocio(
                    `A peça ${formatarCodigo(codigo)} já está no galpão (foi devolvida antes ou nunca saiu). ` +
                    "Confira se é a peça certa."
                );
            }
            baseId = unidade.itemId || unidade.produtoId;
            quantidade = 1;
        }

        const baseRef = refProduto(galpaoId, baseId);
        const baseSnap = await tx.get(baseRef);
        if (!baseSnap.exists()) throw new ErroNegocio("O produto desta peça não existe mais.");
        const base = baseSnap.data();

        if (!codigo && ehIndividual(base)) {
            throw new ErroNegocio("Este é um item individual: leia o código da etiqueta dele.");
        }

        const voltaComoIndividual = ehIndividual(base) || estado !== "novo";

        if (ehIndividual(base) && estado === "novo") {
            throw new ErroNegocio("Um item aberto/usado não volta como novo. Escolha aberto ou danificado.");
        }

        if (voltaComoIndividual && quantidade !== 1) {
            throw new ErroNegocio("Peças abertas ou danificadas são registradas uma a uma.");
        }

        // Peça sem código que vira item individual ganha código agora.
        let codigoFinal = codigo ? normalizarCodigo(codigo) : null;
        let codigoNovo = false;
        if (voltaComoIndividual && !codigoFinal) {
            codigoFinal = await codigoLivre(tx, galpaoId);
            codigoNovo = true;
        }

        let itemSnap = null;
        if (voltaComoIndividual && !ehIndividual(base)) {
            itemSnap = await tx.get(refProduto(galpaoId, codigoFinal));
            if (itemSnap.exists()) throw new ErroNegocio("Já existe um item com este código.");
        }

        // ── Gravações ──
        const pedidoId = unidade ? unidade.pedidoId : null;
        const pedidoCodigo = unidade ? unidade.pedidoCodigo : null;

        let alvoId;
        let saldoApos;

        if (!voltaComoIndividual) {
            // (novo) → soma no saldo do produto novo
            alvoId = baseId;
            saldoApos = (base.quantidade || 0) + quantidade;
            const movRef = doc(colMovs(galpaoId, alvoId));
            tx.set(movRef, montarMovimentacao({
                tipo: "devolucao", quantidade, delta: quantidade, motivo, estado, observacao,
                pedidoId, pedidoCodigo, codigos: codigoFinal ? [codigoFinal] : [],
                saldoApos, produtoNome: base.nome, usuario
            }));
            tx.update(baseRef, {
                quantidade: saldoApos,
                ultimaMovId: movRef.id,
                status: "devolvido",
                atualizadoEm: serverTimestamp()
            });

        } else if (ehIndividual(base)) {
            // item individual que tinha saído → volta para ele mesmo
            alvoId = baseId;
            saldoApos = 1;
            const movRef = doc(colMovs(galpaoId, alvoId));
            tx.set(movRef, montarMovimentacao({
                tipo: "devolucao", quantidade: 1, delta: 1, motivo, estado, observacao,
                pedidoId, pedidoCodigo, codigos: [codigoFinal],
                saldoApos, produtoNome: base.nome, usuario
            }));
            tx.update(baseRef, {
                quantidade: 1,
                condicao: estado,
                estadoObs: observacao || base.estadoObs || "",
                ultimaMovId: movRef.id,
                status: "devolvido",
                atualizadoEm: serverTimestamp()
            });

        } else {
            // peça do produto novo voltou aberta/danificada → nasce o item individual
            alvoId = codigoFinal;
            saldoApos = 1;
            const itemRef = refProduto(galpaoId, codigoFinal);
            const movRef = doc(colMovs(galpaoId, codigoFinal));
            tx.set(movRef, montarMovimentacao({
                tipo: "devolucao", quantidade: 1, delta: 1, motivo, estado, observacao,
                pedidoId, pedidoCodigo, codigos: [codigoFinal],
                saldoApos, produtoNome: base.nome, usuario
            }));
            tx.set(itemRef, {
                ...dadosHerdados(base),
                condicao: estado,
                codigo: codigoFinal,
                produtoBaseId: baseId,
                estadoObs: observacao || "",
                quantidade: 1,
                status: "devolvido",
                ultimaMovId: movRef.id,
                manutencoes: [],
                criadoEm: serverTimestamp(),
                atualizadoEm: serverTimestamp()
            });
        }

        // Registro da unidade (etiqueta) acompanha a peça.
        if (codigoFinal) {
            const registro = evento("devolucao", usuario, { estado, motivo, pedidoCodigo });
            if (codigoNovo) {
                tx.set(refUnidade(galpaoId, codigoFinal), {
                    codigo: codigoFinal,
                    produtoId: baseId,
                    itemId: codigoFinal,
                    produtoNome: base.nome,
                    condicao: estado,
                    status: "em_estoque",
                    pedidoId: null,
                    pedidoCodigo: null,
                    criadoEm: serverTimestamp(),
                    atualizadoEm: serverTimestamp(),
                    eventos: [registro]
                });
            } else {
                tx.update(refUnidade(galpaoId, codigoFinal), {
                    itemId: voltaComoIndividual ? alvoId : null,
                    condicao: estado,
                    status: "em_estoque",
                    atualizadoEm: serverTimestamp(),
                    eventos: arrayUnion(registro)
                });
            }
        }

        return { produtoId: alvoId, codigo: codigoFinal, codigoNovo, saldoApos, pedidoCodigo };
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
            quantidade: (atual ? atual.quantidade : 0) + item.quantidade,
            individual: Boolean(item.individual)
        });
    });

    const lista = [...agrupados.values()];

    if (lista.length === 0) {
        throw new ErroNegocio("Adicione pelo menos um item.");
    }

    if (lista.length > MAX_ITENS_PEDIDO) {
        throw new ErroNegocio(`Um pedido pode ter no máximo ${MAX_ITENS_PEDIDO} produtos diferentes.`);
    }

    if (lista.some((i) => i.individual && i.quantidade !== 1)) {
        throw new ErroNegocio("Itens individuais (abertos, usados…) são únicos: quantidade 1.");
    }

    const total = lista.reduce((s, i) => s + i.quantidade, 0);
    if (total > MAX_UNIDADES_PEDIDO) {
        throw new ErroNegocio(`Um pedido pode ter no máximo ${MAX_UNIDADES_PEDIDO} unidades no total.`);
    }

    return addDoc(colPedidos(galpaoId), {
        codigo: gerarCodigo(),
        solicitante: usuario.uid,
        solicitanteNome: usuario.nome,
        itens: lista.map(({ produtoId, nome, quantidade }) => ({ produtoId, nome, quantidade })),
        observacao: observacao || "",
        status: "pendente",
        criadoEm: serverTimestamp(),
        eventos: [evento("pendente", usuario)]
    });
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
                if (snap.data().condicao === "danificado") {
                    throw new ErroNegocio(`"${item.nome}" está danificado e precisa de manutenção antes de sair.`);
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

// Baixa o estoque de todos os itens, gera uma "saída" por item, registra o
// código de cada unidade que saiu e marca o pedido como expedido — tudo ou nada.
//
// unidades: { [produtoId]: [{ codigo, novo }] }
//   novo = código gerado agora na conferência (etiqueta nova);
//   !novo = peça que já tinha etiqueta (voltou lacrada antes, ou item individual).
export async function expedirPedido(galpaoId, pedidoId, unidades, usuario) {

    const pedRef = refPedido(galpaoId, pedidoId);

    return runTransaction(db, async (tx) => {

        const pedSnap = await tx.get(pedRef);
        if (!pedSnap.exists()) throw new ErroNegocio("Pedido não encontrado.");

        const pedido = pedSnap.data();
        const pedidoCodigo = pedido.codigo || null;

        if (pedido.status !== "em_separacao") {
            throw new ErroNegocio("O pedido precisa estar em separação para ser expedido.");
        }

        const produtosRefs = pedido.itens.map((i) => refProduto(galpaoId, i.produtoId));
        const produtosSnaps = await Promise.all(produtosRefs.map((r) => tx.get(r)));

        // Todos os códigos, com conferência de duplicidade.
        const todos = pedido.itens.flatMap((item) =>
            (unidades[item.produtoId] || []).map((u) => ({ ...u, codigo: normalizarCodigo(u.codigo), item }))
        );
        const vistos = new Set();
        todos.forEach((u) => {
            if (vistos.has(u.codigo)) throw new ErroNegocio(`O código ${formatarCodigo(u.codigo)} foi lido duas vezes.`);
            vistos.add(u.codigo);
        });

        const unidadesSnaps = await Promise.all(todos.map((u) => tx.get(refUnidade(galpaoId, u.codigo))));

        // ── Validações ──
        pedido.itens.forEach((item, i) => {
            const snap = produtosSnaps[i];
            if (!snap.exists()) throw new ErroNegocio(`"${item.nome}" não existe mais no estoque.`);

            const produto = snap.data();
            const lidas = unidades[item.produtoId] || [];

            if (lidas.length !== item.quantidade) {
                throw new ErroNegocio(`"${item.nome}": ${lidas.length} de ${item.quantidade} unidade(s) conferida(s).`);
            }
            if (produto.quantidade - item.quantidade < 0) {
                throw new ErroNegocio(
                    `Saldo insuficiente de "${item.nome}": há ${produto.quantidade}, pedido ${item.quantidade}.`
                );
            }
            if (ehIndividual(produto)) {
                const codigoItem = normalizarCodigo(produto.codigo || item.produtoId);
                if (lidas.length !== 1 || normalizarCodigo(lidas[0].codigo) !== codigoItem) {
                    throw new ErroNegocio(`"${item.nome}": leia a etiqueta ${formatarCodigo(codigoItem)} desta peça.`);
                }
            }
        });

        todos.forEach((u, k) => {
            const snap = unidadesSnaps[k];
            const individual = ehIndividual(produtosSnaps[pedido.itens.indexOf(u.item)].data());
            if (u.novo && !individual) {
                if (snap.exists()) throw new ErroNegocio("Colisão de código gerado. Gere as etiquetas novamente.");
                return;
            }
            if (!snap.exists()) {
                // item individual cadastrado antes do registro de unidades
                if (individual) return;
                throw new ErroNegocio(`Código ${formatarCodigo(u.codigo)} não encontrado.`);
            }
            const dados = snap.data();
            if (dados.status !== "em_estoque") {
                throw new ErroNegocio(`A unidade ${formatarCodigo(u.codigo)} já consta como fora do estoque.`);
            }
            if (!individual && (dados.produtoId !== u.item.produtoId || dados.itemId)) {
                throw new ErroNegocio(`A unidade ${formatarCodigo(u.codigo)} não é de "${u.item.nome}".`);
            }
        });

        // ── Gravações ──
        pedido.itens.forEach((item, i) => {
            const produto = produtosSnaps[i].data();
            const saldoApos = produto.quantidade - item.quantidade;
            const codigos = (unidades[item.produtoId] || []).map((u) => normalizarCodigo(u.codigo));
            const movRef = doc(colMovs(galpaoId, item.produtoId));

            tx.set(movRef, montarMovimentacao({
                tipo: "saida",
                quantidade: item.quantidade,
                delta: -item.quantidade,
                observacao: "Expedição de pedido (conferido por QR)",
                pedidoId,
                pedidoCodigo,
                codigos,
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

        todos.forEach((u, k) => {
            const produto = produtosSnaps[pedido.itens.indexOf(u.item)].data();
            const registro = evento("saida", usuario, { pedidoCodigo });
            const campos = {
                status: "fora",
                pedidoId,
                pedidoCodigo,
                atualizadoEm: serverTimestamp()
            };

            if (unidadesSnaps[k].exists()) {
                tx.update(refUnidade(galpaoId, u.codigo), { ...campos, eventos: arrayUnion(registro) });
            } else {
                tx.set(refUnidade(galpaoId, u.codigo), {
                    ...campos,
                    codigo: u.codigo,
                    produtoId: u.item.produtoId,
                    itemId: ehIndividual(produto) ? u.item.produtoId : null,
                    produtoNome: produto.nome,
                    condicao: produto.condicao || "novo",
                    criadoEm: serverTimestamp(),
                    eventos: [registro]
                });
            }
        });

        const unidadesExpedidas = {};
        pedido.itens.forEach((item) => {
            unidadesExpedidas[item.produtoId] = (unidades[item.produtoId] || []).map((u) => normalizarCodigo(u.codigo));
        });

        tx.update(pedRef, {
            status: "expedido",
            unidadesExpedidas,
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

        if (ehIndividual(produto) && item.contado > 1) {
            throw new ErroNegocio("Item individual tem no máximo 1 unidade.");
        }

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
