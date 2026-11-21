/**
 * Live sources for the computer, so streaming music plays through the engine without saving files.
 *  - A browser tab (e.g. the Spotify web player): Chrome and Edge can capture a tab's audio and mute
 *    it locally, so only the processed sound is heard.
 *  - An input device (e.g. a virtual cable that the Spotify desktop app outputs to).
 * Voice processing is turned off: echo cancellation and gain control would damage music.
 */
export interface LiveSource { kind: 'tab' | 'device'; label: string; stream: MediaStream }

const MUSIC_AUDIO = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } };

export const canCaptureTab = () =>
  typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia) && !/iPhone|iPad|Android/i.test(navigator.userAgent);
export const canUseInputDevice = () => typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

export async function captureTab(): Promise<LiveSource> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 1, width: 320, height: 180 },
    audio: { ...MUSIC_AUDIO, suppressLocalAudioPlayback: true },
    // Chrome-only hints: offer tabs first, include tab audio, and never this app's own tab.
    preferCurrentTab: false, selfBrowserSurface: 'exclude', surfaceSwitching: 'include', systemAudio: 'exclude',
  } as DisplayMediaStreamOptions);
  const audio = stream.getAudioTracks()[0];
  // Only the sound is used; the picture is kept (stopping it can end the capture) but switched off.
  stream.getVideoTracks().forEach(track => { track.enabled = false; });
  if (!audio) {
    stream.getTracks().forEach(track => track.stop());
    throw new Error('A aba foi escolhida sem áudio. Compartilhe de novo e deixe “Compartilhar áudio da guia” marcado.');
  }
  const label = stream.getVideoTracks()[0]?.label || 'Aba do navegador';
  return { kind: 'tab', label, stream };
}

/** Asks for permission once, then lists inputs; a virtual cable is put first. */
export async function listInputDevices(): Promise<MediaDeviceInfo[]> {
  const probe = await navigator.mediaDevices.getUserMedia({ audio: MUSIC_AUDIO });
  probe.getTracks().forEach(track => track.stop());
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput' && d.deviceId);
  const cable = (d: MediaDeviceInfo) => /cable|virtual|loopback|blackhole|voicemeeter/i.test(d.label);
  return devices.sort((a, b) => Number(cable(b)) - Number(cable(a)));
}

export async function captureDevice(device: MediaDeviceInfo): Promise<LiveSource> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { ...MUSIC_AUDIO, deviceId: { exact: device.deviceId } } });
  return { kind: 'device', label: device.label || 'Dispositivo de entrada', stream };
}

export function stopSource(source: LiveSource | null) {
  source?.stream.getTracks().forEach(track => track.stop());
}

export function describeCaptureError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'AbortError') return 'Captura cancelada. Nada foi alterado.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Esse dispositivo de entrada não foi encontrado. Conecte-o e tente de novo.';
  if (name === 'NotReadableError') return 'O Windows não liberou esse dispositivo. Feche outros apps que o estejam usando e tente de novo.';
  return error instanceof Error && error.message ? error.message : 'Não foi possível iniciar a captura.';
}
