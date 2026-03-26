import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  TARGET_HEIGHT,
  TARGET_WIDTH,
  canvasToPngBlob,
  copyBlobToClipboard,
  loadImageFromFile,
  normalizeTo1920,
  renderCrop
} from './imageProcessing';
import type { CropMode, OffsetInputMode, ProcessResult } from './types';

const ACCEPT_IMAGE = 'image/*';

const App = () => {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);
  const [sourceName, setSourceName] = useState('');
  const [mode, setMode] = useState<CropMode>('top');
  const [offsetInputMode, setOffsetInputMode] = useState<OffsetInputMode>('pixel');
  const [pixelValue, setPixelValue] = useState('0');
  const [pageValue, setPageValue] = useState('1');
  const [isDragOver, setIsDragOver] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState('等待导入图片。');
  const [error, setError] = useState('');
  const [result, setResult] = useState<ProcessResult | null>(null);

  const pixelOffset = useMemo(() => {
    if (offsetInputMode === 'page') {
      const page = Number(pageValue);
      if (!Number.isFinite(page)) {
        return 0;
      }
      return Math.trunc((page - 1) * TARGET_HEIGHT);
    }

    const n = Number(pixelValue);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }, [offsetInputMode, pageValue, pixelValue]);

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
        const normalized = normalizeTo1920(sourceImage);
        const output = renderCrop(normalized, normalized.height, mode, pixelOffset);
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
            width: TARGET_WIDTH,
            height: TARGET_HEIGHT
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
  }, [sourceImage, mode, pixelOffset]);

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
    anchor.download = `crop-${mode}-${Date.now()}.png`;
    anchor.click();
  };

  const offsetLabel = offsetInputMode === 'page' ? `当前起始像素: ${pixelOffset}px` : '支持负数或超范围，将自动透明补白。';

  return (
    <div className="app">
      <header className="hero">
        <h1>1920 × 1080 图片裁切工具</h1>
        <p>支持上传、拖拽、Ctrl/Cmd + V 粘贴导入，输出 PNG，可复制到剪贴板。</p>
      </header>

      <section className="panel import-panel">
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
          <span>宽度会自动缩放到 1920，高度按模式裁切为 1080。</span>
          <button type="button" onClick={() => inputRef.current?.click()} disabled={isBusy}>
            选择图片
          </button>
        </label>
      </section>

      <section className="panel">
        <h2>裁切模式</h2>
        <div className="mode-row">
          <label>
            <input type="radio" name="mode" checked={mode === 'top'} onChange={() => setMode('top')} />
            顶部 0-1080
          </label>
          <label>
            <input type="radio" name="mode" checked={mode === 'offset'} onChange={() => setMode('offset')} />
            任意起始 n-(n+1080)
          </label>
          <label>
            <input type="radio" name="mode" checked={mode === 'bottom'} onChange={() => setMode('bottom')} />
            底部向上 1080
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
          </div>
        ) : null}
      </section>

      <section className="panel result-panel">
        <h2>结果</h2>
        <p className="meta">{sourceName ? `来源: ${sourceName}` : '尚未导入图片'}</p>
        <p className="meta">输出尺寸固定: {TARGET_WIDTH} × {TARGET_HEIGHT}</p>
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
  );
};

export default App;
