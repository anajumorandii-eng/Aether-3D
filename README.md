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
