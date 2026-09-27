# Teste-NoSQL
Web com interação com NoSQL, visando entender a estrutura e funcionamento do banco de dados não relacional.

Sistema de controle de galpão (Firebase Auth + Firestore, HTML/CSS/JS puro, sem build).

## Objetivo do sistema

O sistema foi feito para atender **uma empresa** que precisa controlar o estoque dos seus galpões.
Ele reúne num só lugar:

- **Cadastros** — galpões, produtos (com preço, categoria, localização, lote e validade) e a
  equipe que trabalha em cada galpão, cada pessoa com um papel.
- **Entrada e saída de produtos** — todo recebimento, retirada ou devolução fica registrado com
  quem fez, quando, quanto e por quê. O saldo de cada produto é sempre o resultado desse histórico.
- **Valores** — preço unitário de cada produto, valor total em estoque e curva ABC por valor, para
  saber quais itens concentram o dinheiro parado e o giro do galpão.
- **Pedidos internos** — um funcionário pede a retirada, um gerente aprova e um separador confere
  a saída lendo o QR code das etiquetas, reduzindo erro de digitação.

Cada galpão é **fechado**: só vê e mexe nos dados quem entrou com o código de convite, e cada
um só faz o que o seu papel permite. O modelo aceita vários galpões no mesmo banco, mas todos
pertencem à mesma empresa.

## Funcionalidades

- **Estoque** — produtos com localização (setor/corredor/prateleira), lote e validade, status
  (em estoque, reservado, em separação, expedido, devolvido), busca e filtros.
- **QR code por produto** — ficha com etiqueta imprimível; leitura pela câmera (ou leitor USB /
  digitação) para localizar produtos, movimentar e conferir pedidos.
- **Movimentações** — entrada, saída e devolução (com motivo obrigatório). Cada registro vai para
  `galpoes/{id}/produtos/{id}/movimentacoes` e o saldo só muda junto com uma movimentação.
- **Pedidos internos** — solicitação → aprovação (reserva) → separação → conferência por QR →
  expedição (baixa no estoque numa única transação).
- **Relatórios** — curva ABC de saídas (unidades ou valor), devoluções por motivo e
  reconciliação de inventário (contagem física × sistema, com ajuste opcional).
- **Papéis** — admin, gerente, conferente, separador e membro. Matriz na aba Equipe.

## Tecnologias utilizadas

| Tecnologia | Para que serve aqui |
|---|---|
| **HTML, CSS e JavaScript puro** (módulos ES) | Toda a interface. Não há framework nem etapa de build: o navegador carrega os arquivos direto. |
| **Firebase Authentication** | Cadastro e login com e-mail e senha. Cada usuário recebe um `uid` único. |
| **Cloud Firestore** (banco NoSQL de documentos) | Guarda todos os dados em coleções e documentos, com atualização em tempo real na tela (`onSnapshot`). |
| **Firestore Security Rules** | O "back-end" do sistema: decidem no servidor quem pode ler e gravar cada documento. |
| **Transações do Firestore** (`runTransaction`, `writeBatch`) | Garantem que saldo, histórico e pedido mudem juntos, sem estado pela metade. |
| **qrcode-generator** (CDN jsDelivr) | Gera o QR code das etiquetas em SVG. |
| **html5-qrcode** (CDN jsDelivr) | Lê QR codes pela câmera do celular ou notebook. |
| **Google Fonts** (Inter, JetBrains Mono) | Tipografia da interface. |
| **Firebase Emulator Suite** | Rodar e testar tudo localmente sem mexer no projeto real. |

O Firebase é carregado direto do CDN oficial (`gstatic.com/firebasejs/12.17.0`), então não é
preciso `npm install` para usar o sistema.

## Como as partes conversam

Não existe um servidor próprio: o navegador fala direto com o Firebase, e as **regras de
segurança** fazem o papel de back-end, validando cada gravação.

```
 Navegador (HTML + JS)                         Firebase (nuvem)
 ───────────────────────                       ─────────────────────────────
  login.html / cadastro.html ──── e-mail/senha ──▶ Authentication  → devolve o uid
                                                         │
  painel.html                                            ▼
   ├─ painel.js (estado, abas) ◀── tempo real ───  Cloud Firestore
   ├─ views/*.js (telas)                               ▲
   └─ servicos.js ─────────── leituras/gravações ──────┤
                                                       │
                                    firestore.rules ───┘  (aprova ou recusa
                                                           cada operação)
```

1. **Autenticação** — o usuário entra pelo Firebase Auth. A partir daí, toda requisição ao
   Firestore vai com o `uid` dele, e é isso que as regras usam para saber quem está pedindo.
2. **Escolha do galpão** — o documento `usuarios/{uid}` guarda a lista `galpaoIds`. Com um
   galpão, o login vai direto ao painel; com vários, passa por `selecionar-galpao.html`.
3. **Painel em tempo real** — o `painel.js` abre três "escutas" (`onSnapshot`): o documento do
   galpão (membros e papéis), a lista de produtos e a lista de pedidos. Qualquer mudança feita
   por outra pessoa aparece na tela na hora, sem recarregar.
4. **Ações do usuário** — as telas (`views/`) nunca gravam direto no banco; elas chamam funções
   do `servicos.js`, que montam a operação (quase sempre uma transação) e enviam ao Firestore.
5. **Validação no servidor** — o Firestore confere a operação contra o `firestore.rules`. Se o
   papel não permitir, ou se os dados não baterem (ex.: saldo mudou sem movimentação), a
   gravação é recusada e a tela mostra o erro.

> O arquivo `permissoes.js` só esconde botões que o usuário não pode usar. Quem realmente
> garante as permissões são as regras; mesmo alguém mexendo no navegador não consegue burlar.

## Como tudo funciona

### Cadastro, galpões e equipe
- Ao criar a conta, é gravado `usuarios/{uid}` com nome e e-mail.
- Quem cria um galpão vira o **criador e admin** dele (`criadoPor`). O ID do documento do galpão
  é o **código de convite**.
- Quem recebe o código entra no galpão e começa com o papel **membro**. O admin define os papéis
  na aba **Equipe**, pode remover pessoas, e qualquer um (exceto o criador) pode sair do galpão.
- Se alguém for removido, o painel dessa pessoa percebe na hora e a redireciona.

### Papéis

| Ação | Admin | Gerente | Conferente | Separador | Membro |
|---|:-:|:-:|:-:|:-:|:-:|
| Ver estoque e solicitar pedidos | ✓ | ✓ | ✓ | ✓ | ✓ |
| Cadastrar/editar produtos | ✓ | ✓ | ✓ | — | — |
| Registrar entrada e devolução | ✓ | ✓ | ✓ | — | — |
| Registrar saída | ✓ | ✓ | — | ✓ | — |
| Aprovar pedidos | ✓ | ✓ | — | — | — |
| Separar e expedir pedidos | ✓ | ✓ | — | ✓ | — |
| Relatórios e reconciliação | ✓ | ✓ | — | — | — |
| Excluir produtos | ✓ | — | — | — | — |
| Gerenciar membros e papéis | ✓ | — | — | — | — |

### Produtos e valores
- Cada produto tem nome, categoria, **preço unitário**, saldo, localização, lote/validade e
  atributos livres (ex.: cor, tamanho).
- A aba **Estoque** mostra indicadores: número de produtos, unidades, **valor total em estoque**
  (saldo × preço), itens vencidos ou vencendo em até 30 dias e pedidos em aberto.
- O saldo **não é editado no formulário**: ele só muda por movimentação ou reconciliação.
  Ao cadastrar com quantidade inicial, o sistema já registra uma "entrada" automática.

### Entrada, saída e devolução
Na aba **Movimentar**, escolhe-se o tipo, o produto (pela lista ou lendo o QR) e a quantidade.
O `servicos.js` faz tudo numa transação:

1. lê o saldo atual do produto;
2. calcula a variação (`delta`): entrada soma, saída subtrai, devolução soma — exceto motivo
   **avariado**, que fica registrado mas não volta ao estoque;
3. recusa se o saldo ficaria negativo;
4. grava o documento em `movimentacoes` e atualiza o saldo e o status do produto **juntos**.

As regras conferem que a movimentação foi criada na mesma operação e que o `delta` explica
exatamente a mudança do saldo. O histórico não pode ser editado nem apagado.

### Pedidos internos
```
 pendente ──(gerente aprova)──▶ aprovado/reservado ──(separador)──▶ em separação ──(conferência QR)──▶ expedido
     │                                │                                   │
     └──── rejeitado / cancelado ◀────┴───────────────────────────────────┘
```
- Qualquer membro cria um pedido com até 8 produtos diferentes.
- Na aprovação, o sistema confere se há saldo e marca os produtos como **reservados**.
- Na conferência, o separador lê a etiqueta de cada item. Produto fora do pedido ou quantidade
  a mais gera alerta; a expedição só libera quando tudo bate.
- Ao expedir, uma única transação cria uma "saída" para cada item, baixa o estoque e fecha o
  pedido. Cada mudança de status fica registrada em `eventos`, com quem fez e quando.

### Relatórios (gerente e admin)
- **Curva ABC** — ordena os produtos pelo volume de saídas no período (em unidades ou em valor
  R$). Classe A = produtos que somam 80% do volume, B = próximos 15%, C = restante.
- **Devoluções por motivo** — avariado, excesso, erro de pedido e outro.
- **Reconciliação de inventário** — digita-se a contagem física; o sistema destaca as
  divergências e pode ajustar os saldos, gerando uma movimentação de "ajuste" para cada uma.
  Toda reconciliação fica salva em `reconciliacoes`.

### QR code
O conteúdo da etiqueta é `GLP|<galpaoId>|<produtoId>`. Incluir o galpão permite avisar quando
alguém lê a etiqueta de outro galpão. Leitores USB e digitação manual do ID também funcionam.

## Estrutura de arquivos

```
login.html, cadastro.html        Autenticação
galpao.html                      Criar galpão ou entrar com código
selecionar-galpao.html           Escolher entre vários galpões
painel.html                      Aplicação principal (abas)
css/style.css                    Visual (tema claro/escuro, responsivo)
js/
  firebase-config.js             Inicializa o Firebase (e os emuladores em localhost)
  login.js, cadastro.js,
  galpao.js, selecionar-galpao.js  Lógica das páginas de entrada
  painel.js                      Estado compartilhado, escutas em tempo real, navegação
  servicos.js                    Todas as operações no Firestore (transações, regras de negócio)
  permissoes.js                  Papéis e o que cada um pode fazer na interface
  qr.js                          Geração e leitura de QR code
  ui.js                          Utilitários (modais, avisos, formatação, ícones)
  views/
    estoque.js                   Aba Estoque
    movimentar.js                Aba Movimentar
    pedidos.js                   Aba Pedidos (inclui a conferência por QR)
    relatorios.js                Aba Relatórios
    equipe.js                    Aba Equipe
    comum.js                     Ficha do produto, formulário, histórico
firestore.rules                  Regras de segurança do Firestore
firebase.json                    Configuração da CLI/emuladores
```

## Modelo de dados

```
usuarios/{uid}                         nome, email, galpaoIds[]
galpoes/{galpaoId}                     nome, endereco, criadoPor, membros[], papeis{uid: papel}, membrosInfo{uid: {nome, email}}
  produtos/{produtoId}                 nome, categoria, preco, quantidade, status, posicao{}, lote, validade, atributos{}, ultimaMovId
    movimentacoes/{movId}              tipo, quantidade, delta, motivo, uid, usuarioNome, pedidoId, saldoApos, criadoEm
  pedidos/{pedidoId}                   solicitante, itens[], status, observacao, eventos[], criadoEm
  reconciliacoes/{recId}               uid, itens[], totalDivergencias, aplicada, criadoEm
```

## Regras de segurança

As regras ficam em [`firestore.rules`](firestore.rules). **Publique-as antes de usar a nova versão**
(as regras antigas bloqueiam, por exemplo, o registro de nomes da equipe):

- pelo console: Firebase → Firestore → Regras → colar o conteúdo e publicar; ou
- pela CLI: `firebase deploy --only firestore:rules`

> Publique as regras junto com o código novo: a versão antiga do site grava saldo sem
> movimentação, o que as regras novas recusam.

## Rodando localmente com emuladores

```bash
npm install -g firebase-tools
firebase emulators:start --only auth,firestore
```

Sirva a pasta em `localhost` (ex.: extensão Live Server ou `python -m http.server 5500`) e abra
`http://localhost:5500/login.html?emulador=1`. A página passa a usar os emuladores em vez do
projeto real até a aba ser fechada (`?emulador=0` desliga).

> A câmera só funciona em HTTPS ou `localhost`.

## Limitações conhecidas

- **Até 8 produtos diferentes por pedido** — a expedição grava tudo numa transação e as regras
  do Firestore limitam as leituras extras por operação.
- **Relatórios leem o histórico produto a produto** — funciona bem em galpões pequenos e médios;
  para volumes grandes, o ideal é migrar para uma consulta `collectionGroup` com índice.
- **Fora do escopo desta fase:** alerta de estoque mínimo e modelo de marketplace com várias
  empresas.
