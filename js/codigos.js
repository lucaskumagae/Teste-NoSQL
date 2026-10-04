// Códigos curtos usados em unidades e pedidos (ex.: K7Q2-M9XD).
//
// - 8 caracteres aleatórios → 31^8 ≈ 850 bilhões de combinações.
// - Sem caracteres que se confundem na leitura/digitação (0/O, 1/I/L).
// - Não dependem do nome do produto (renomear não "quebra" o código).

const ALFABETO = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const TAMANHO = 8;

export function gerarCodigo() {
    const aleatorios = crypto.getRandomValues(new Uint32Array(TAMANHO));
    return [...aleatorios].map((n) => ALFABETO[n % ALFABETO.length]).join("");
}

// "k7q2 m9xd", "K7Q2-M9XD" → "K7Q2M9XD"
export function normalizarCodigo(texto) {
    return String(texto || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
}

export function ehCodigoValido(texto) {
    const c = normalizarCodigo(texto);
    return c.length === TAMANHO && [...c].every((ch) => ALFABETO.includes(ch));
}

// "K7Q2M9XD" → "K7Q2-M9XD" (só para exibir e imprimir)
export function formatarCodigo(codigo) {
    const c = normalizarCodigo(codigo);
    return c.length === TAMANHO ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

// Pedidos antigos (antes do código curto) mostram o início do ID.
export function codigoPedido(pedido) {
    if (!pedido) return "";
    return pedido.codigo ? formatarCodigo(pedido.codigo) : String(pedido.id || "").slice(0, 6).toUpperCase();
}
