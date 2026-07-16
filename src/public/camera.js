let activeStream = null;
let selfieStream = null;

const MOOD_CHIPS = ['Golden hour', 'Night drive', 'Coffee run'];

export function getMoodChips() {
  return MOOD_CHIPS;
}

export async function startCamera({ viewfinderVideo, selfieVideo, onFallback }) {
  stopCamera();

  if (!navigator.mediaDevices?.getUserMedia) {
    onFallback?.('Camera not supported in this browser.');
    return false;
  }

  try {
    activeStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    });
    if (viewfinderVideo) {
      viewfinderVideo.srcObject = activeStream;
      await viewfinderVideo.play().catch(() => {});
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((d) => d.kind === 'videoinput');
      if (videoInputs.length >= 2 && selfieVideo) {
        selfieStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: false
        });
        selfieVideo.srcObject = selfieStream;
        selfieVideo.closest('.selfie-pip')?.classList.remove('hidden');
        await selfieVideo.play().catch(() => {});
      }
    } catch {
      selfieVideo?.closest('.selfie-pip')?.classList.add('hidden');
    }

    return true;
  } catch (err) {
    console.warn('Camera access failed:', err);
    onFallback?.('Camera permission denied or unavailable.');
    return false;
  }
}

export function stopCamera() {
  [activeStream, selfieStream].forEach((stream) => {
    stream?.getTracks().forEach((t) => t.stop());
  });
  activeStream = null;
  selfieStream = null;
}

export async function capturePhotoFromVideo(videoEl, filename = 'moment-capture.jpg') {
  if (!videoEl?.videoWidth) {
    throw new Error('Camera not ready.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(videoEl, 0, 0);
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Capture failed'))), 'image/jpeg', 0.85);
  });
  return new File([blob], filename, { type: 'image/jpeg' });
}

export function bindCameraLifecycle() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopCamera();
  });
}
