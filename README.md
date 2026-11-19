# Aether 3D

Player de áudio espacial (HRTF binaural) para iPhone como PWA — React + TypeScript + Vite + Tailwind.

- Palco sonoro 360° interativo com espectro radial em tempo real
- Equalizador paramétrico de 10 bandas com curva de resposta e presets
- Acústica de ambiente (reverb convolucional): Estúdio, Teatro, Catedral
- Fila mesclada: playlists do Spotify vinculadas a arquivos locais (MP3/FLAC)
- Faixa de demonstração gerada no próprio navegador para testar o 3D

## Rodar

```bash
npm install
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Para o Spotify, defina `SPOTIFY_CLIENT_ID` em `src/spotify/SpotifySync.ts` e cadastre
`http://127.0.0.1:5173/` como Redirect URI no Spotify Developer Dashboard.

## Publicar (Azure Static Web Apps)

```bash
npm run build
swa deploy ./dist --env production
```

## Sincronizar músicas pela nuvem (Azure Blob Storage)

1. No portal do Azure, crie uma **Conta de armazenamento** e, dentro dela, um **contêiner** (ex.: `musicas`, nível de acesso **Privado**).
2. Envie seus MP3/FLAC para o contêiner (botão **Carregar**). Subpastas são aceitas.
3. Em **Configurações → Compartilhamento de recursos (CORS) → Serviço Blob**, adicione uma regra:
   origem `https://ambitious-sky-061d4a210.5.azurestaticapps.net`, métodos `GET, HEAD, OPTIONS`, cabeçalhos `*`.
4. No contêiner, abra **Tokens de acesso compartilhado**, marque **Ler** e **Listar**, escolha uma validade longa e gere a **URL SAS do Blob**.
5. No app, em **Biblioteca → Nuvem · Azure → Conectar armazenamento**, cole a URL SAS.

O app baixa as músicas novas ao abrir e ao voltar para a tela, e remove do aparelho as que forem apagadas da nuvem.

## Modos de escuta e personalização

Em **Som 3D**, escolha um modo pronto ou toque em **Personalizar**. Os ajustes são aplicados durante a reprodução: equalizador de 10 bandas, ambiente e reverberação, imersão adaptativa, posicionamento manual e modo noturno.

Dê um nome e toque em **Salvar modo** para adicioná-lo a **Meus modos**. Até 12 configurações ficam salvas neste navegador; salvar com o mesmo nome atualiza a configuração existente. Excluir um modo não altera o som em reprodução.

## Conta Google e sincronização entre aparelhos

O login Google usa Firebase Authentication; os dados ficam no Realtime Database, em `users/<uid>/settings`. As regras restringem leitura e escrita ao dono da conta.

São sincronizados ajustes de áudio, modos personalizados, playlist selecionada e a URL da biblioteca Azure. Tokens do Spotify, volume, posição de reprodução e arquivos locais não são enviados. É necessário conectar o Spotify uma vez em cada aparelho. O app precisa estar aberto para receber atualizações; ajustes feitos sem conexão são guardados neste navegador e enviados ao reconectar. A última gravação em cada seção prevalece. O botão de sincronização do Spotify também avisa os outros aparelhos conectados para atualizar suas playlists.

A configuração pública do app Firebase está em `src/account/config.ts`. Ela identifica o projeto; não é uma credencial administrativa. Nunca publique códigos de login, tokens de administrador ou arquivos de conta de serviço. O projeto está no plano gratuito, sem vínculo de cobrança criado por esta integração.

Ao trocar o domínio público, inclua-o em Firebase Authentication → Configurações → Domínios autorizados. O login Google usa uma janela aberta por um toque do usuário, evitando o fluxo de redirecionamento entre sites no Safari.

### Verificação local de contas

1. Instale as dependências e o Chromium do Playwright: `npm ci` e `npx playwright install chromium`.
2. Inicie os emuladores: `npx -y firebase-tools@latest emulators:start --only auth,database --project aether-3d-sync-42043f7`.
3. Em outro terminal, inicie `VITE_FIREBASE_EMULATORS=1 npm run dev -- --port 5175 --strictPort`.
4. Execute `npm run test:accounts`.

Os testes usam identidades Google falsas aceitas apenas pelo emulador. Verificam sincronização em duas sessões, restauração, isolamento entre usuários, regras de acesso reenvio de edições offline após fechar a aba, e propagação de sincronização do Spotify usando tokens locais separados. Para usar um Chromium já instalado, defina `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.

Para atualizar as regras: `npx -y firebase-tools@latest deploy --only database --project aether-3d-sync-42043f7`. A publicação do frontend continua no Azure, pelo workflow do GitHub.

## Imersão DJ e reprodução em segundo plano

O modo **DJ 3D** reúne o impacto dos efeitos DJ e a imersão estéreo adaptativa, e oferece níveis Suave (25%), Intenso (65%) e Máximo (100%), além do ajuste contínuo de 0 a 100%. A intensidade altera equalização e força da adaptação estéreo, sem rotação. O volume do player não é alterado. Em **Personalizar**, é possível ajustar os efeitos separadamente e salvar a combinação em Meus modos; a intensidade também acompanha a conta Google.

O motor configura `navigator.audioSession.type = playback` quando disponível e mantém estado, posição e ações de reprodução na Media Session. Há recuperação de AudioContext suspenso durante reprodução e ao retornar à página; uma pausa feita pelo usuário é respeitada. Os testes automatizados verificam essa configuração e esses eventos, mas não reproduzem o gerenciamento de energia e áudio de um iPhone físico. A continuidade ao bloquear a tela precisa ser validada na versão de iOS/iPadOS utilizada. A adaptação de áudio roda em AudioWorklet, sem depender de animações ou timers da interface. O sistema ainda pode suspender o contexto de áudio em situações específicas.

Referências: [Audio Session API](https://developer.mozilla.org/en-US/docs/Web/API/AudioSession/type), [Media Session](https://developer.mozilla.org/en-US/docs/Web/API/MediaSession) e [histórico de suspensão do Web Audio no WebKit](https://bugs.webkit.org/show_bug.cgi?id=261554).

Para testar o áudio e o DJ, inicie o Vite na porta 5176 e execute `npm run test:audio`. Os testes verificam os parâmetros de áudio reais, pausa, retomada, limpeza de recursos, intensidade manual e salvamento do DJ. Use `AUDIO_TEST_URL` se o servidor estiver em outra porta.

## Imersão adaptativa por áudio

Som 3D e DJ 3D usam um processador estéreo adaptativo em AudioWorklet. Ele mede energia central/lateral, correlação entre canais, graves e transientes para ajustar abertura e profundidade gradualmente. Mixagens já abertas ou com oposição de fase não recebem mais expansão; graves fortes e transientes reduzem o processamento. Reflexões curtas são adicionadas às laterais e o envelope de profundidade controla a reverberação do ambiente escolhido no próprio thread de áudio.

Não há órbita automática. Configurações antigas que giravam a fonte são convertidas para adaptação, preservando o equalizador e o ambiente. O posicionamento HRTF manual continua disponível ao desligar Adaptar à música. A rota adaptativa mantém os dois canais originais e não passa pelo panner mono do posicionamento manual.

A análise é local e acompanha o sinal durante a reprodução; não identifica instrumentos, não separa stems e não reconstrói Atmos ou objetos 360° de um arquivo estéreo. Ao trocar de faixa, são reiniciados os medidores e as reflexões. Se AudioWorklet não estiver disponível, o app informa a limitação e mantém a reprodução estéreo, sem simular adaptação.

`tests/adaptive-dsp.cjs` verifica sinais PCM sintéticos: centro, estéreo estreito/amplo, graves, oposição de fase, bypass e silêncio. `tests/adaptive-browser.cjs` verifica o AudioWorklet real, diferenças entre entradas, fallback e migração de presets antigos. Os ajustes e a intensidade também são incluídos na sincronização da conta.

## Passagem automática do Spotify para o Aether

Em Biblioteca, conecte o Spotify e ative **Seguir o Spotify** no aparelho onde deseja ouvir. O Aether acompanha a seleção e a posição e procura um arquivo compatível na biblioteca local. Se a biblioteca Azure estiver conectada, solicita uma sincronização e prioriza a faixa procurada.

O áudio continua vindo dos seus arquivos; a API do Spotify não fornece a música completa para o processamento. O Aether inicia o arquivo na posição recebida, verifica se a música do Spotify mudou durante a troca e só solicita a pausa remota após o início local. Se o sistema já pausou o Spotify ao trocar a saída de áudio, não há outro pedido de pausa. O modo e os efeitos escolhidos, incluindo DJ 3D, são mantidos.

O navegador pode exigir um toque em **Continuar no Aether** para iniciar o áudio. Isso não exige pausar o Spotify manualmente. A pausa remota pela API pode exigir Premium. Se o Spotify recusar e continuar tocando, a tentativa local é interrompida e a interface informa que a transferência não foi concluída. Uma falha de rede também não é apresentada como sucesso.

A busca usa títulos e artistas dos nomes dos arquivos; nomes ambíguos ou versões diferentes não são escolhidos automaticamente. A duração local também é conferida. Essa associação não usa reconhecimento acústico. Atualizações dependem de o navegador poder executar o app; ao voltar ao Aether, a consulta é imediata. A função deve ser ativada no aparelho destinado à reprodução, para evitar dois aparelhos tentando assumir a mesma sessão.

`npm run test:spotify` verifica ordem de início/pausa, posição, mesma faixa retomada, arquivo ausente, bloqueio do navegador, cancelamento, troca de faixa e recusa do Spotify. Os testes de navegador usam respostas simuladas do Spotify e áudio WAV real; não dependem de credenciais ou de controlar uma conta Spotify real.
