import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import type { SentenceItem } from '../types';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfPaneProps {
  pdfUrl: string;
  sentences: SentenceItem[];
  activeSentenceId: string | null;
  scrollSignal: number; // incremented when Right Pane requests Left PDF scroll
  onSelectSentenceFromPdf: (sentence: SentenceItem) => void;
}

interface PageViewportMeta {
  pageNumber: number;
  baseWidth: number;
  baseHeight: number;
}

interface SinglePageCanvasProps {
  pdfDoc: pdfjsLib.PDFDocumentProxy;
  meta: PageViewportMeta;
  scale: number;
  pageSentences: SentenceItem[];
  activeSentenceId: string | null;
  onSelectSentence: (s: SentenceItem) => void;
  registerPageRef: (pageNum: number, el: HTMLDivElement | null) => void;
}

const SinglePageCanvas: React.FC<SinglePageCanvasProps> = ({
  pdfDoc,
  meta,
  scale,
  pageSentences,
  activeSentenceId,
  onSelectSentence,
  registerPageRef,
}) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isVisible, setIsVisible] = useState(meta.pageNumber <= 3);

  const cssWidth = Math.round(meta.baseWidth * scale);
  const cssHeight = Math.round(meta.baseHeight * scale);

  useEffect(() => {
    registerPageRef(meta.pageNumber, wrapperRef.current);
    return () => registerPageRef(meta.pageNumber, null);
  }, [meta.pageNumber, registerPageRef]);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsVisible(true);
          }
        }
      },
      { rootMargin: '600px 0px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Force render if active sentence is on this page
  const hasActive = useMemo(
    () => pageSentences.some((s) => s.id === activeSentenceId),
    [pageSentences, activeSentenceId]
  );

  useEffect(() => {
    if (!isVisible && !hasActive) return;
    let cancelled = false;
    let renderTask: pdfjsLib.RenderTask | null = null;

    (async () => {
      try {
        const page = await pdfDoc.getPage(meta.pageNumber);
        if (cancelled || !canvasRef.current) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: scale * dpr });
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;

        renderTask = page.render({
          canvasContext: ctx,
          viewport,
        });
        await renderTask.promise;
      } catch {
        // Ignore cancelled render
      }
    })();

    return () => {
      cancelled = true;
      if (renderTask) {
        try {
          renderTask.cancel();
        } catch {
          // ignore
        }
      }
    };
  }, [pdfDoc, meta.pageNumber, scale, cssWidth, cssHeight, isVisible, hasActive]);

  return (
    <div
      ref={wrapperRef}
      className="pdf-page-card"
      style={{ width: `${cssWidth}px`, height: `${cssHeight}px` }}
      data-page={meta.pageNumber}
    >
      <canvas ref={canvasRef} className="pdf-canvas" />
      <div className="pdf-bbox-layer">
        {pageSentences.map((sent) => {
          const isActive = sent.id === activeSentenceId;
          return sent.bboxes.map((bb, idx) => (
            <div
              key={`${sent.id}_${idx}`}
              className={`pdf-sent-hotspot ${isActive ? 'active' : ''}`}
              style={{
                left: `${bb.x0 * 100}%`,
                top: `${bb.y0 * 100}%`,
                width: `${Math.max(0.5, (bb.x1 - bb.x0) * 100)}%`,
                height: `${Math.max(0.8, (bb.y1 - bb.y0) * 100)}%`,
              }}
              title="클릭하여 우측 끊어읽기 뷰와 동기화"
              onClick={(e) => {
                e.stopPropagation();
                onSelectSentence(sent);
              }}
            />
          ));
        })}
      </div>
      <div className="pdf-page-badge">Page {meta.pageNumber}</div>
    </div>
  );
};

export const PdfPane: React.FC<PdfPaneProps> = ({
  pdfUrl,
  sentences,
  activeSentenceId,
  scrollSignal,
  onSelectSentenceFromPdf,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pagesMeta, setPagesMeta] = useState<PageViewportMeta[]>([]);
  const [scale, setScale] = useState<number>(1.15);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const sentencesByPage = useMemo(() => {
    const map = new Map<number, SentenceItem[]>();
    for (const s of sentences) {
      const arr = map.get(s.page) || [];
      arr.push(s);
      map.set(s.page, arr);
    }
    return map;
  }, [sentences]);

  useEffect(() => {
    if (!pdfUrl) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const loadingTask = pdfjsLib.getDocument(pdfUrl);
    loadingTask.promise
      .then(async (doc) => {
        if (cancelled) return;
        const metas: PageViewportMeta[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const p = await doc.getPage(i);
          const vp = p.getViewport({ scale: 1.0 });
          metas.push({
            pageNumber: i,
            baseWidth: vp.width,
            baseHeight: vp.height,
          });
        }
        if (cancelled) return;
        setPdfDoc(doc);
        setPagesMeta(metas);

        // Fit width nicely on initial load
        if (scrollContainerRef.current && metas.length > 0) {
          const avail = scrollContainerRef.current.clientWidth - 48;
          if (avail > 280) {
            const fitted = Math.max(0.7, Math.min(1.6, avail / metas[0].baseWidth));
            setScale(Number(fitted.toFixed(2)));
          }
        }
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message || 'PDF 로드 실패');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      loadingTask.destroy().catch(() => {});
    };
  }, [pdfUrl]);

  // Scroll PDF to active sentence when requested from Right Pane
  useEffect(() => {
    if (!scrollSignal || !activeSentenceId) return;
    const target = sentences.find((s) => s.id === activeSentenceId);
    if (!target) return;

    const pageEl = pageRefs.current.get(target.page);
    const container = scrollContainerRef.current;
    if (!pageEl || !container) return;

    const firstBox = target.bboxes[0];
    const yRatio = firstBox ? firstBox.y0 : 0.1;
    const targetTop =
      pageEl.offsetTop + pageEl.clientHeight * yRatio - container.clientHeight * 0.32;

    container.scrollTo({
      top: Math.max(0, targetTop),
      behavior: 'smooth',
    });
  }, [scrollSignal, activeSentenceId, sentences]);

  const handleFitWidth = () => {
    if (!scrollContainerRef.current || pagesMeta.length === 0) return;
    const avail = scrollContainerRef.current.clientWidth - 48;
    if (avail > 240) {
      setScale(Number(Math.max(0.6, Math.min(2.2, avail / pagesMeta[0].baseWidth)).toFixed(2)));
    }
  };

  const registerPageRef = React.useCallback((pageNum: number, el: HTMLDivElement | null) => {
    if (el) {
      pageRefs.current.set(pageNum, el);
    } else {
      pageRefs.current.delete(pageNum);
    }
  }, []);

  return (
    <div className="pdf-pane-root">
      <div className="pane-subtoolbar">
        <span className="pane-subtitle">
          원본 PDF 뷰어 {pagesMeta.length > 0 ? `(${pagesMeta.length}p)` : ''}
        </span>
        <div className="zoom-controls">
          <button
            className="icon-btn"
            onClick={() => setScale((s) => Number(Math.max(0.55, s - 0.15).toFixed(2)))}
            title="축소"
          >
            <ZoomOut size={15} />
          </button>
          <span className="zoom-label">{Math.round(scale * 100)}%</span>
          <button
            className="icon-btn"
            onClick={() => setScale((s) => Number(Math.min(2.5, s + 0.15).toFixed(2)))}
            title="확대"
          >
            <ZoomIn size={15} />
          </button>
          <button className="icon-btn" onClick={handleFitWidth} title="패널 폭에 맞추기">
            <Maximize2 size={14} />
          </button>
        </div>
      </div>

      <div className="pdf-scroll-area" ref={scrollContainerRef}>
        {loading && <div className="pane-placeholder">PDF 렌더링 준비 중...</div>}
        {error && <div className="pane-error">{error}</div>}
        {pdfDoc &&
          pagesMeta.map((meta) => (
            <SinglePageCanvas
              key={meta.pageNumber}
              pdfDoc={pdfDoc}
              meta={meta}
              scale={scale}
              pageSentences={sentencesByPage.get(meta.pageNumber) || []}
              activeSentenceId={activeSentenceId}
              onSelectSentence={onSelectSentenceFromPdf}
              registerPageRef={registerPageRef}
            />
          ))}
      </div>
    </div>
  );
};
