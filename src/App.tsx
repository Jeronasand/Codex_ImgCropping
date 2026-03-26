import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  canvasToPngBlob,
  copyBlobToClipboard,
  loadImageFromFile,
  normalizeToWidth,
  renderCrop
} from './imageProcessing';
import type { CropMode, CropPresetId, OffsetInputMode, ProcessResult } from './types';

const ACCEPT_IMAGE = 'image/*';

const PRESETS: Record<CropPresetId, { label: string; width: number; height: number }> = {
  desktop: { label: '桌面 1920 × 1080', width: 1920, height: 1080 },
  mobile: { label: '移动端 375 × 812', width: 375, height: 812 }
};

const App = () => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const syncingScrollRef = useRef(false);
  const normalizedCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);
  const [sourceName, setSourceName] = useState('');
  const [preset, setPreset] = useState<CropPresetId>('desktop');
  const [mode, setMode] = useState<CropMode>('top');
  const [offsetInputMode, setOffsetInputMode] = useState<OffsetInputMode>('pixel');
  const [pixelValue, setPixelValue] = useState('0');
  const [pageValue, setPageValue] = useState('1');
  const [isDragOver, setIsDragOver] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState('等待导入图片。');
  const [error, setError] = useState('');
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [normalizedPreviewUrl, setNormalizedPreviewUrl] = useState('');
  const [normalizedHeight, setNormalizedHeight] = useState(0);
  const [pickerViewportHeight, setPickerViewportHeight] = useState(180);

  const targetWidth = PRESETS[preset].width;
  const targetHeight = PRESETS[preset].height;

  const pixelOffset = useMemo(() => {
    if (offsetInputMode === 'page') {
      const page = Number(pageValue);
      if (!Number.isFinite(page)) {
        return 0;
      }
      return Math.trunc((page - 1) * targetHeight);
    }

    const n = Number(pixelValue);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }, [offsetInputMode, pageValue, pixelValue, targetHeight]);

  useEffect(() => {
    return () => {
      if (normalizedPreviewUrl) {
        URL.revokeObjectURL(normalizedPreviewUrl);
      }
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
      setNormalizedPreviewUrl((prev) => {
        if (prev) {
          URL.revokeObjectURL(prev);
        }
        return '';
      });
      return;
    }

    const normalized = normalizeToWidth(sourceImage, targetWidth);
    normalizedCanvasRef.current = normalized;
    setNormalizedHeight(normalized.height);

    normalized.toBlob((blob) => {
      if (!blob) {
        return;
      }
      const nextUrl = URL.createObjectURL(blob);
      setNormalizedPreviewUrl((prev) => {
        if (prev) {
          URL.revokeObjectURL(prev);
        }
        return nextUrl;
      });
    }, 'image/png');
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

        const output = renderCrop(normalized, normalized.height, targetWidth, targetHeight, mode, pixelOffset);
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
  }, [sourceImage, mode, pixelOffset, normalizedHeight, targetWidth, targetHeight]);

  useEffect(() => {
    const picker = pickerRef.current;
    if (!picker || !normalizedHeight) {
      return;
    }

    const updateMetrics = () => {
      const scale = picker.clientWidth / targetWidth;
      const viewport = Math.max(120, Math.round(targetHeight * Math.max(scale, 0.05)));
      setPickerViewportHeight(viewport);
    };

    updateMetrics();
    const observer = new ResizeObserver(updateMetrics);
    observer.observe(picker);
    return () => observer.disconnect();
  }, [normalizedHeight, targetHeight, targetWidth]);

  useEffect(() => {
    const picker = pickerRef.current;
    if (!picker || mode !== 'offset' || !normalizedHeight) {
      return;
    }

    const scale = picker.clientWidth / targetWidth;
    if (!Number.isFinite(scale) || scale <= 0) {
      return;
    }

    const maxStart = Math.max(0, normalizedHeight - targetHeight);
    const safeStart = Math.min(Math.max(pixelOffset, 0), maxStart);
    syncingScrollRef.current = true;
    picker.scrollTop = Math.max(0, safeStart * scale);
  }, [mode, pixelOffset, normalizedHeight, pickerViewportHeight, targetHeight, targetWidth]);

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
    anchor.download = `crop-${preset}-${mode}-${Date.now()}.png`;
    anchor.click();
  };

  const onPickerScroll = () => {
    const picker = pickerRef.current;
    if (!picker || syncingScrollRef.current) {
      syncingScrollRef.current = false;
      return;
    }

    const scale = picker.clientWidth / targetWidth;
    if (!Number.isFinite(scale) || scale <= 0) {
      return;
    }

    const nextPixel = Math.trunc(picker.scrollTop / scale);
    setPixelValue(String(nextPixel));
    const nextPage = Number.parseFloat((nextPixel / targetHeight + 1).toFixed(3));
    setPageValue(String(nextPage));
  };

  const offsetLabel = offsetInputMode === 'page' ? `当前起始像素: ${pixelOffset}px` : '支持负数或超范围，将自动透明补白。';

  return (
    <div className="app">
      <header className="hero">
        <h1>图片裁切工具</h1>
        <p>支持桌面端 1920×1080 与移动端 375×812，支持上传、拖拽、粘贴、复制与下载。</p>
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

            <h2>裁切模式</h2>
            <div className="mode-row">
              <label>
                <input type="radio" name="mode" checked={mode === 'top'} onChange={() => setMode('top')} />
                顶部 0-{targetHeight}
              </label>
              <label>
                <input type="radio" name="mode" checked={mode === 'offset'} onChange={() => setMode('offset')} />
                任意起始 n-(n+{targetHeight})
              </label>
              <label>
                <input type="radio" name="mode" checked={mode === 'bottom'} onChange={() => setMode('bottom')} />
                底部向上 {targetHeight}
              </label>
            </div>

            {mode === 'offset' ? (
              <div className="offset-editor">
                <div className="mode-row">
                  <label>
                    <input
                      type="radio"
                      name="offset-input-mode"
                      checked={offsetInputMode === 'pixel'}
                      onChange={() => setOffsetInputMode('pixel')}
                    />
                    按像素输入 n
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="offset-input-mode"
                      checked={offsetInputMode === 'page'}
                      onChange={() => setOffsetInputMode('page')}
                    />
                    按页码换算
                  </label>
                </div>

                {offsetInputMode === 'pixel' ? (
                  <label className="field">
                    起始像素 n
                    <input
                      type="number"
                      value={pixelValue}
                      onChange={(event) => setPixelValue(event.target.value)}
                      placeholder="例如 540"
                    />
                  </label>
                ) : (
                  <label className="field">
                    第几页（第 1 页从 0px 开始）
                    <input
                      type="number"
                      value={pageValue}
                      onChange={(event) => setPageValue(event.target.value)}
                      placeholder="例如 2"
                    />
                  </label>
                )}

                <p className="tip">{offsetLabel}</p>
                {normalizedPreviewUrl ? (
                  <div className="scroll-picker-section">
                    <p className="tip">滚动下方预览可直接选择裁切起始区域。</p>
                    <div
                      className="scroll-picker"
                      ref={pickerRef}
                      onScroll={onPickerScroll}
                      style={{ height: `${pickerViewportHeight}px` }}
                    >
                      <img src={normalizedPreviewUrl} alt="滚动选区预览" className="scroll-picker-image" />
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>

        <section className="panel result-panel">
          <h2>结果预览</h2>
          <p className="meta">{sourceName ? `来源: ${sourceName}` : '尚未导入图片'}</p>
          <p className="meta">输出尺寸: {targetWidth} × {targetHeight}</p>
          <p className="meta">状态: {isBusy ? '处理中' : message}</p>
          {error ? <p className="error">错误: {error}</p> : null}

          <div className="preview-wrap">
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
