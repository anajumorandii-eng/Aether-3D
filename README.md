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

Em **Som 3D**, escolha um modo pronto ou toque em **Personalizar**. Os ajustes são aplicados durante a reprodução: equalizador de 10 bandas, ambiente e reverberação, espacialização, órbita, posição, elevação e modo noturno.

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
