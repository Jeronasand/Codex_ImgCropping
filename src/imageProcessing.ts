import type { CropMode } from './types';

export const DEFAULT_TARGET_WIDTH = 1920 as const;
export const DEFAULT_TARGET_HEIGHT = 1080 as const;

export const normalizeToWidth = (img: HTMLImageElement, targetWidth: number): HTMLCanvasElement => {
  if (!img.width || !img.height) {
    throw new Error('图片尺寸无效，无法处理。');
  }

  const safeTargetWidth = Math.max(1, Math.trunc(targetWidth));
  const normalizedHeight = Math.max(1, Math.round((img.height * safeTargetWidth) / img.width));
  const canvas = document.createElement('canvas');
  canvas.width = safeTargetWidth;
  canvas.height = normalizedHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('浏览器不支持 Canvas 2D。');
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, safeTargetWidth, normalizedHeight);
  return canvas;
};

export const renderCrop = (
  normalized: CanvasImageSource,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  mode: CropMode,
  n: number
): HTMLCanvasElement => {
  const safeTargetWidth = Math.max(1, Math.trunc(targetWidth));
  const safeTargetHeight = Math.max(1, Math.trunc(targetHeight));
  const output = document.createElement('canvas');
  output.width = safeTargetWidth;
  output.height = safeTargetHeight;

  const ctx = output.getContext('2d');
  if (!ctx) {
    throw new Error('浏览器不支持 Canvas 2D。');
  }

  ctx.clearRect(0, 0, output.width, output.height);

  const normalizedN = Number.isFinite(n) ? Math.trunc(n) : 0;
  let startY = 0;

  if (mode === 'offset') {
    startY = normalizedN;
  } else if (mode === 'bottom') {
    startY = sourceHeight - safeTargetHeight;
  }

  const requestedTop = startY;
  const requestedBottom = startY + safeTargetHeight;
  const safeTop = Math.max(0, requestedTop);
  const safeBottom = Math.min(sourceHeight, requestedBottom);

  if (safeBottom > safeTop) {
    const drawHeight = safeBottom - safeTop;
    const destY = safeTop - requestedTop;
    ctx.drawImage(normalized, 0, safeTop, safeTargetWidth, drawHeight, 0, destY, safeTargetWidth, drawHeight);
  }

  return output;
};

export const canvasToPngBlob = async (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('图片导出失败。'));
        return;
      }
      resolve(blob);
    }, 'image/png');
  });

export const copyBlobToClipboard = async (blob: Blob): Promise<void> => {
  const clipboard = navigator.clipboard as Clipboard | undefined;
  if (!clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('当前浏览器不支持图片复制。请使用下载按钮。');
  }

  await clipboard.write([
    new ClipboardItem({
      'image/png': blob
    })
  ]);
};

export const loadImageFromFile = async (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('图片加载失败，请检查文件格式。'));
    };

    img.src = objectUrl;
  });
