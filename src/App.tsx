import { ChangeEvent, DragEvent, WheelEvent, useEffect, useMemo, useRef, useState } from 'react';
import { canvasToPngBlob, copyBlobToClipboard, loadImageFromFile, normalizeToWidth, renderCrop } from './imageProcessing';
import type { CropPresetId, ProcessResult } from './types';

const ACCEPT_IMAGE = 'image/*';

const PRESETS: Record<CropPresetId, { label: string; width: number; height: number }> = {
  desktop: { label: '桌面 1920 × 1080', width: 1920, height: 1080 },
  mobile: { label: '移动端 375 × 812', width: 375, height: 812 }
};

const App = () => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const normalizedCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);
  const [sourceName, setSourceName] = useState('');
  const [preset, setPreset] = useState<CropPresetId>('desktop');
  const [startPixelText, setStartPixelText] = useState('0');
  const [isDragOver, setIsDragOver] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState('等待导入图片。');
  const [error, setError] = useState('');
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [normalizedHeight, setNormalizedHeight] = useState(0);

  const targetWidth = PRESETS[preset].width;
  const targetHeight = PRESETS[preset].height;

  const startPixel = useMemo(() => {
    const n = Number(startPixelText);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }, [startPixelText]);

  const pageText = useMemo(() => ((startPixel / targetHeight) + 1).toFixed(3), [startPixel, targetHeight]);

  useEffect(() => {
    return () => {
      setResult((prev) => {
        if (prev?.dataUrl) {
          URL.revokeObjectURL(prev.dataUrl);
        }
        return null;
      });
    };
  }, []);

  useEffect(() => {
    if (!sourceImage) {
      normalizedCanvasRef.current = null;
      setNormalizedHeight(0);
      return;
    }

    const normalized = normalizeToWidth(sourceImage, targetWidth);
    normalizedCanvasRef.current = normalized;
    setNormalizedHeight(normalized.height);
  }, [sourceImage, targetWidth]);

  useEffect(() => {
    const onPaste = async (event: ClipboardEvent) => {
      if (!event.clipboardData) {
        return;
      }

      const imageItem = Array.from(event.clipboardData.items).find((item) => item.type.startsWith('image/'));
      if (!imageItem) {
        return;
      }

      const file = imageItem.getAsFile();
      if (!file) {
        return;
      }

      event.preventDefault();
      await handleFile(file, '剪贴板图片');
    };

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!sourceImage) {
        setResult((prev) => {
          if (prev?.dataUrl) {
            URL.revokeObjectURL(prev.dataUrl);
          }
          return null;
        });
        return;
      }

      setIsBusy(true);
      setError('');
      setMessage('处理中...');

      try {
        const normalized = normalizedCanvasRef.current;
        if (!normalized) {
          return;
        }

        const output = renderCrop(normalized, normalized.height, targetWidth, targetHeight, 'offset', startPixel);
        const blob = await canvasToPngBlob(output);
        const nextUrl = URL.createObjectURL(blob);

        if (cancelled) {
          URL.revokeObjectURL(nextUrl);
          return;
        }

        setResult((prev) => {
          if (prev?.dataUrl) {
            URL.revokeObjectURL(prev.dataUrl);
          }

          return {
            blob,
            dataUrl: nextUrl,
            width: targetWidth,
            height: targetHeight
          };
        });

        setMessage('处理完成，可复制或下载 PNG。');
      } catch (processingError) {
        const errorText = processingError instanceof Error ? processingError.message : '处理失败，请重试。';
        setError(errorText);
      } finally {
        if (!cancelled) {
          setIsBusy(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [sourceImage, startPixel, normalizedHeight, targetWidth, targetHeight]);

  const handleFile = async (file: File, fallbackName?: string) => {
    if (!file.type.startsWith('image/')) {
      setError('只支持图片文件。');
      return;
    }

    setIsBusy(true);
    setError('');
    setMessage('图片加载中...');

    try {
      const image = await loadImageFromFile(file);
      setSourceImage(image);
      setSourceName(file.name || fallbackName || '未命名图片');
      setMessage('图片已导入，开始处理...');
    } catch (loadError) {
      const errorText = loadError instanceof Error ? loadError.message : '图片读取失败。';
      setError(errorText);
      setIsBusy(false);
    }
  };

  const onFileInput = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    await handleFile(file);
    event.target.value = '';
  };

  const onDrop = async (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragOver(false);

    const file = event.dataTransfer.files?.[0];
    if (!file) {
      return;
    }

    await handleFile(file);
  };

  const onCopy = async () => {
    if (!result) {
      return;
    }

    try {
      await copyBlobToClipboard(result.blob);
      setError('');
      setMessage('图片已复制到剪贴板。');
    } catch (copyError) {
      const errorText = copyError instanceof Error ? copyError.message : '复制失败，请改用下载。';
      setError(errorText);
    }
  };

  const onDownload = () => {
    if (!result) {
      return;
    }

    const anchor = document.createElement('a');
    anchor.href = result.dataUrl;
    anchor.download = `crop-${preset}-${Date.now()}.png`;
    anchor.click();
  };

  const jumpTop = () => setStartPixelText('0');

  const jumpBottom = () => {
    const maxStart = Math.max(0, normalizedHeight - targetHeight);
    setStartPixelText(String(maxStart));
  };

  const onPreviewWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!result) {
      return;
    }

    event.preventDefault();
    const maxStart = Math.max(0, normalizedHeight - targetHeight);
    const stepBase = Math.max(1, Math.round(Math.abs(event.deltaY)));
    const step = event.shiftKey ? stepBase * 4 : stepBase;
    const direction = Math.sign(event.deltaY);
    const next = Math.min(maxStart, Math.max(0, startPixel + direction * step));
    setStartPixelText(String(next));
  };

  return (
    <div className="app">
      <header className="hero">
        <h1>图片裁切工具</h1>
        <p>直接滚动选区即可裁切，支持桌面端 1920×1080 与移动端 375×812。</p>
      </header>

      <div className="workspace">
        <div className="tools-column">
          <section className="panel">
            <h2>导入图片</h2>
            <label
              className={`drop-zone${isDragOver ? ' active' : ''}`}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={onDrop}
            >
              <input ref={inputRef} type="file" accept={ACCEPT_IMAGE} onChange={onFileInput} hidden />
              <strong>点击选择图片 / 拖拽图片到此处 / 直接粘贴图片</strong>
              <span>图片宽度将按当前输出预设自动缩放。</span>
              <button type="button" onClick={() => inputRef.current?.click()} disabled={isBusy}>
                选择图片
              </button>
            </label>
          </section>

          <section className="panel">
            <h2>输出尺寸</h2>
            <div className="mode-row">
              <label>
                <input type="radio" name="preset" checked={preset === 'desktop'} onChange={() => setPreset('desktop')} />
                {PRESETS.desktop.label}
              </label>
              <label>
                <input type="radio" name="preset" checked={preset === 'mobile'} onChange={() => setPreset('mobile')} />
                {PRESETS.mobile.label}
              </label>
            </div>

            <h2>起始位置</h2>
            <label className="field">
              起始像素 n
              <input
                type="number"
                value={startPixelText}
                onChange={(event) => setStartPixelText(event.target.value)}
                placeholder="例如 540"
              />
            </label>
            <p className="tip">当前约第 {pageText} 页（每页高度 {targetHeight}px）。</p>
            <p className="tip">可直接输入像素，也可在右侧预览区域滚轮直接调节。</p>

            <div className="actions compact-actions">
              <button type="button" onClick={jumpTop}>到顶部</button>
              <button type="button" onClick={jumpBottom}>到底部</button>
            </div>
          </section>
        </div>

        <section className="panel result-panel">
          <h2>结果预览</h2>
          <p className="meta">{sourceName ? `来源: ${sourceName}` : '尚未导入图片'}</p>
          <p className="meta">输出尺寸: {targetWidth} × {targetHeight}</p>
          <p className="meta">状态: {isBusy ? '处理中' : message}</p>
          {error ? <p className="error">错误: {error}</p> : null}

          <div className="preview-wrap preview-wheel" onWheel={onPreviewWheel}>
            {result ? (
              <img src={result.dataUrl} alt="处理结果" className="preview" />
            ) : (
              <div className="empty">导入图片后将在这里显示预览</div>
            )}
          </div>

          <div className="actions">
            <button type="button" onClick={onCopy} disabled={!result || isBusy}>
              复制图片
            </button>
            <button type="button" onClick={onDownload} disabled={!result || isBusy}>
              下载 PNG
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};

export default App;
