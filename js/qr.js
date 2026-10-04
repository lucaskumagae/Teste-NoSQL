// Geração e leitura de QR codes de produto.
// Bibliotecas carregadas via <script> no painel.html:
//   - qrcode-generator (window.qrcode)  → gera o SVG
//   - html5-qrcode     (window.Html5Qrcode) → lê pela câmera

import { esc, $, icone } from "./ui.js";

import { ehCodigoValido, normalizarCodigo } from "./codigos.js";

// Prefixos do conteúdo dos QR codes:
//   GLP|<galpaoId>|<produtoId>   etiqueta geral do produto (localizar, contar)
//   GLU|<galpaoId>|<codigo>      etiqueta de UMA unidade (código curto único)
//   GLO|<galpaoId>|<pedidoId>    guia de saída de um pedido
// Incluir o galpão permite avisar quando alguém lê uma etiqueta de OUTRO galpão.
const PREFIXOS = { GLP: "produtoId", GLU: "codigo", GLO: "pedidoId" };

export function payloadProduto(galpaoId, produtoId) {
    return `GLP|${galpaoId}|${produtoId}`;
}

export function payloadUnidade(galpaoId, codigo) {
    return `GLU|${galpaoId}|${normalizarCodigo(codigo)}`;
}

export function payloadPedido(galpaoId, pedidoId) {
    return `GLO|${galpaoId}|${pedidoId}`;
}

// Devolve { produtoId } | { codigo } | { pedidoId } | { erro }.
// Também aceita texto digitado: um código curto (K7Q2-M9XD) ou o ID do produto
// (útil sem câmera ou com leitor USB, que "digita" o código).
export function lerPayload(texto, galpaoId) {
    const bruto = String(texto || "").trim();

    if (!bruto) {
        return { erro: "Código vazio." };
    }

    const partes = bruto.split("|");

    if (PREFIXOS[partes[0]] && partes.length === 3) {
        if (partes[1] !== galpaoId) {
            return { erro: "Esta etiqueta pertence a outro galpão." };
        }
        const campo = PREFIXOS[partes[0]];
        return { [campo]: campo === "codigo" ? normalizarCodigo(partes[2]) : partes[2] };
    }

    if (ehCodigoValido(bruto)) {
        return { codigo: normalizarCodigo(bruto) };
    }

    return { produtoId: bruto };
}

export function qrSvg(texto) {
    if (!window.qrcode) {
        return `<p class="subtle">Biblioteca de QR indisponível (sem internet?).</p>`;
    }
    const qr = window.qrcode(0, "M");
    qr.addData(texto);
    qr.make();
    return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}

// Monta o bloco "câmera + digitação manual" dentro de `container`.
// `aoLer(texto)` é chamado a cada leitura. Retorna uma função para
// desligar a câmera (chame ao fechar o modal).
export function montarLeitor(container, aoLer, { continuo = false } = {}) {

    const idArea = "leitor-" + Math.random().toString(36).slice(2);

    container.innerHTML = `
        <div class="scanner-area" id="${idArea}"></div>
        <p class="subtle" data-status style="text-align:center; margin-bottom:12px;">
            Iniciando câmera…
        </p>
        <form class="scanner-manual" data-manual>
            <input type="text" placeholder="Ou digite / bipe o código" autocomplete="off" aria-label="Código do produto">
            <button type="submit" class="btn-secondary">OK</button>
        </form>
    `;

    const statusEl = $("[data-status]", container);
    const formManual = $("[data-manual]", container);
    const inputManual = $("input", formManual);

    // Evita disparar várias vezes para o mesmo QR parado na frente da câmera.
    let ultimo = "";
    let ultimoEm = 0;

    function entregar(texto) {
        const agora = Date.now();
        if (texto === ultimo && agora - ultimoEm < 1800) return;
        ultimo = texto;
        ultimoEm = agora;
        aoLer(texto);
    }

    formManual.addEventListener("submit", (e) => {
        e.preventDefault();
        const texto = inputManual.value.trim();
        if (!texto) return;
        ultimo = ""; // digitação manual sempre conta
        entregar(texto);
        inputManual.value = "";
    });

    let leitor = null;
    let parado = false;

    if (!window.Html5Qrcode) {
        statusEl.textContent = "Leitor de câmera indisponível — use a digitação manual.";
        $("#" + idArea, container).remove();
        inputManual.focus();
        return () => {};
    }

    leitor = new window.Html5Qrcode(idArea, { verbose: false });

    leitor.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 230, height: 230 } },
        (texto) => {
            entregar(texto);
            if (!continuo) desligar();
        },
        () => {} // erros de "nenhum QR neste frame" são normais
    ).then(() => {
        if (parado) {
            leitor.stop().catch(() => {});
            return;
        }
        statusEl.textContent = continuo
            ? "Aponte a câmera para cada etiqueta."
            : "Aponte a câmera para a etiqueta do produto.";
    }).catch((erro) => {
        console.warn(erro);
        statusEl.innerHTML = `Não foi possível acessar a câmera. ${
            location.protocol === "https:" || location.hostname === "localhost"
                ? "Verifique a permissão do navegador."
                : "A câmera exige HTTPS ou localhost."
        } Use a digitação manual abaixo.`;
        const area = document.getElementById(idArea);
        if (area) area.remove();
        inputManual.focus();
    });

    function desligar() {
        if (parado) return;
        parado = true;
        if (leitor && leitor.isScanning) {
            leitor.stop().catch(() => {});
        }
    }

    return desligar;
}

// Botão padrão "Ler QR" usado em vários formulários.
export function botaoLerQr(rotulo = "Ler QR") {
    return `<button type="button" class="btn-secondary" data-ler-qr>${icone("scan")} ${esc(rotulo)}</button>`;
}
