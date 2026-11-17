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
