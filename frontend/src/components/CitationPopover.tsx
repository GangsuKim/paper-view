import React, { useState } from 'react';
import {
  X,
  ExternalLink,
  FileText,
  Sparkles,
  RefreshCw,
  Quote,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  ZoomIn,
  Image as ImageIcon,
} from 'lucide-react';
import { getApiBase } from '../api';
import type { CitationMetadataResponse, CitationSummaryResponse } from '../types';
import { renderMathText } from '../utils/mathRenderer';

interface CitationPopoverProps {
  refKey: string;
  metadata: CitationMetadataResponse | null;
  loadingMeta: boolean;
  metaError: string | null;
  summary: CitationSummaryResponse | null;
  loadingSummary: boolean;
  summaryError: string | null;
  selectedEngine: string;
  selectedModelLabel?: string;
  onClose: () => void;
  onRequestSummary: (force?: boolean) => void;
  onJumpToSentence: (sentenceId: string) => void;
}

function notifyVsCodeExternalIfEmbedded(url: string): void {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'paperview:openExternal', url }, '*');
  }
}

export const CitationPopover: React.FC<CitationPopoverProps> = ({
  refKey,
  metadata,
  loadingMeta,
  metaError,
  summary,
  loadingSummary,
  summaryError,
  selectedEngine,
  selectedModelLabel,
  onClose,
  onRequestSummary,
  onJumpToSentence,
}) => {
  const [showRawRef, setShowRawRef] = useState(false);
  const [showCitingList, setShowCitingList] = useState(false);
  const [zoomMainFig, setZoomMainFig] = useState(false);

  const effectiveSummary = summary || metadata?.cached_summary || null;

  const goPaperUrl = metadata
    ? (metadata.arxiv_id ? `https://arxiv.org/abs/${metadata.arxiv_id}` : null) ||
      metadata.url ||
      metadata.pdf_url ||
      `https://scholar.google.com/scholar?q=${encodeURIComponent(metadata.title)}`
    : '';

  const publisherDoiUrl =
    metadata?.doi && !metadata.doi.toLowerCase().includes('arxiv')
      ? `https://doi.org/${metadata.doi}`
      : null;

  const importTarget = metadata ? metadata.arxiv_id || metadata.pdf_url || '' : '';
  const mainFigFullUrl = effectiveSummary?.main_figure_url
    ? `${getApiBase()}${effectiveSummary.main_figure_url}`
    : null;

  return (
    <>
      <div className="citation-drawer" role="dialog" aria-label={`인용 논문 [${refKey}] 정보`}>
        <div className="citation-drawer-header">
          <div className="cit-header-left">
            <span className="cit-ref-badge">[{refKey}]</span>
            <span className="cit-header-label">인용 논문 정보</span>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} title="닫기">
            <X size={16} />
          </button>
        </div>

        <div className="citation-drawer-body">
          {loadingMeta && (
            <div className="cit-loading-box">
              서지 정보(제목·저자·출판연도)를 조회하는 중입니다...
            </div>
          )}

          {metaError && <div className="pane-error">{metaError}</div>}

          {!loadingMeta && metadata && (
            <>
              <h4 className="cit-paper-title">{metadata.title}</h4>

              <div className="cit-meta-rows">
                {metadata.authors.length > 0 && (
                  <div className="cit-authors">
                    {metadata.authors.slice(0, 5).join(', ')}
                    {metadata.authors.length > 5 ? ` 외 ${metadata.authors.length - 5}명` : ''}
                  </div>
                )}

                <div className="cit-tags-row">
                  {metadata.year && <span className="cit-tag year">{metadata.year}</span>}
                  {metadata.venue && <span className="cit-tag venue">{metadata.venue}</span>}
                  {metadata.arxiv_id && (
                    <span className="cit-tag oa" title="arXiv 오픈액세스 버전 확인됨">
                      arXiv:{metadata.arxiv_id}
                    </span>
                  )}
                  {metadata.has_fulltext ? (
                    <span className="cit-tag oa">원문 PDF 확보 가능</span>
                  ) : metadata.has_abstract ? (
                    <span className="cit-tag abs">초록 확보됨</span>
                  ) : (
                    <span className="cit-tag basic">서지 텍스트</span>
                  )}
                </div>
              </div>

              {/* New-tab links bar */}
              <div className="cit-links-bar">
                <a
                  href={goPaperUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="cit-link-btn primary-go"
                  onClick={() => notifyVsCodeExternalIfEmbedded(goPaperUrl)}
                  title="새 탭에서 해당 논문 페이지 열기 (arXiv 우선)"
                >
                  <ExternalLink size={13} />
                  <span>
                    {metadata.arxiv_id ? '해당 논문 보러가기 (arXiv)' : '해당 논문 보러가기'}
                  </span>
                </a>

                {metadata.pdf_url && metadata.pdf_url !== goPaperUrl && (
                  <a
                    href={metadata.pdf_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="cit-link-btn"
                    onClick={() => notifyVsCodeExternalIfEmbedded(metadata.pdf_url!)}
                    title="새 탭에서 원문 PDF 열기"
                  >
                    <FileText size={13} />
                    <span>원문 PDF</span>
                  </a>
                )}

                {importTarget && (
                  <a
                    href={`/?import=${encodeURIComponent(importTarget)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="cit-link-btn highlight"
                    title="새 탭의 PaperView 리더에서 이 인용 논문을 바로 번역하며 읽습니다"
                  >
                    <ArrowUpRight size={13} />
                    <span>PaperView 새 탭 열기</span>
                  </a>
                )}

                {publisherDoiUrl && publisherDoiUrl !== goPaperUrl && (
                  <a
                    href={publisherDoiUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="cit-link-btn"
                    onClick={() => notifyVsCodeExternalIfEmbedded(publisherDoiUrl)}
                    title="출판사/학회 DOI 페이지 열기"
                  >
                    <ExternalLink size={12} />
                    <span>DOI</span>
                  </a>
                )}
              </div>

              {/* Stage 2 Trigger: Only runs AI when user clicks [간단 요약 보기] */}
              {!effectiveSummary && !loadingSummary && (
                <div className="cit-summary-cta-box">
                  <button
                    type="button"
                    className="cit-summarize-primary-btn"
                    onClick={() => onRequestSummary(false)}
                  >
                    <Sparkles size={16} />
                    <span>간단 요약 보기</span>
                  </button>
                  <p className="cit-cta-hint">
                    <strong>
                      {selectedEngine === 'codex'
                        ? 'Codex'
                        : selectedEngine === 'antigravity'
                        ? 'Antigravity'
                        : 'Claude'}
                      {selectedModelLabel ? ` (${selectedModelLabel})` : ''}
                    </strong>{' '}
                    모델로 {metadata.has_fulltext ? '원문 및 Main Figure' : '초록 및 문맥'}를 읽어
                    요약합니다. 요약 중 창을 닫아도 완료 시 우상단에 알림이 표시됩니다.
                  </p>
                </div>
              )}

              {loadingSummary && (
                <div className="cit-summary-loading-card">
                  <div className="cit-summary-loading">
                    <div className="spinner-ring" />
                    <div>
                      <strong>[{refKey}]번 인용 논문을 읽고 요약하는 중...</strong>
                      <p>
                        창을 닫고 본문을 계속 읽으셔도 백그라운드에서 진행되며, 완성되면 우상단에
                        알림을 띄워드립니다.
                      </p>
                    </div>
                  </div>
                  <button type="button" className="cit-bg-close-btn" onClick={onClose}>
                    창 닫고 본문 계속 읽기
                  </button>
                </div>
              )}

              {summaryError && <div className="pane-error">{summaryError}</div>}

              {effectiveSummary && !loadingSummary && (
                <div className="cit-summary-result">
                  <div className="cit-summary-topbar">
                    <span className="source-pill">{effectiveSummary.source_label}</span>
                    <div className="cit-summary-right">
                      <span className={`engine-mini-tag ${effectiveSummary.engine}`}>
                        {effectiveSummary.engine === 'codex'
                          ? 'Codex'
                          : effectiveSummary.engine === 'claude'
                          ? 'Claude'
                          : 'Antigravity'}
                        {effectiveSummary.model_name ? ` · ${effectiveSummary.model_name}` : ''}
                        {effectiveSummary.reasoning_effort
                          ? ` (${effectiveSummary.reasoning_effort})`
                          : ''}
                      </span>
                      <button
                        type="button"
                        className="icon-tiny-btn"
                        title="현재 선택한 모델로 다시 요약"
                        onClick={() => onRequestSummary(true)}
                      >
                        <RefreshCw size={12} />
                      </button>
                    </div>
                  </div>

                  {/* Main Figure of the Cited Paper */}
                  {mainFigFullUrl && (
                    <div className="cit-main-fig-card">
                      <div className="cit-main-fig-header">
                        <span className="row-center">
                          <ImageIcon size={12} />
                          <strong>인용 논문 Main Figure</strong>
                        </span>
                        <button
                          type="button"
                          className="cit-fig-zoom-btn"
                          onClick={() => setZoomMainFig(true)}
                        >
                          <ZoomIn size={12} /> 크게 보기
                        </button>
                      </div>
                      <div
                        className="cit-main-fig-img-wrap"
                        onClick={() => setZoomMainFig(true)}
                        title="클릭하여 원본 크기로 확대"
                      >
                        <img src={mainFigFullUrl} alt={`[${refKey}] Main Figure`} />
                      </div>
                      {effectiveSummary.main_figure_caption && (
                        <p className="cit-main-fig-cap">
                          {renderMathText(effectiveSummary.main_figure_caption, 'cit_fcap')}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="cit-tldr-card">
                    <span className="cit-sec-kicker">한줄 핵심 요약</span>
                    <p>{renderMathText(effectiveSummary.tldr, 'cit_tldr')}</p>
                  </div>

                  {effectiveSummary.summary_points.length > 0 && (
                    <div className="cit-points-block">
                      <span className="cit-sec-kicker">주요 내용</span>
                      <ul>
                        {effectiveSummary.summary_points.map((pt, i) => (
                          <li key={i}>{renderMathText(pt, `cit_pt_${i}`)}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {effectiveSummary.why_cited && (
                    <div className="cit-why-block">
                      <span className="cit-sec-kicker">현재 논문에서 인용한 이유</span>
                      <p>{renderMathText(effectiveSummary.why_cited, 'cit_why')}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Citing sentences inside current paper */}
              {metadata.citing_sentences.length > 0 && (
                <div className="cit-collapsible">
                  <button
                    type="button"
                    className="cit-collapse-toggle"
                    onClick={() => setShowCitingList((v) => !v)}
                  >
                    <span className="row-center">
                      <Quote size={13} />
                      본문 내 인용 위치 ({metadata.citing_sentences.length}곳)
                    </span>
                    {showCitingList ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  {showCitingList && (
                    <div className="cit-citing-list">
                      {metadata.citing_sentences.map((cs) => (
                        <button
                          key={cs.sentence_id}
                          type="button"
                          className="cit-citing-item"
                          onClick={() => onJumpToSentence(cs.sentence_id)}
                        >
                          <span className="cit-citing-page">
                            p.{cs.page} · {cs.section}
                          </span>
                          <p>{cs.text}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="cit-collapsible">
                <button
                  type="button"
                  className="cit-collapse-toggle"
                  onClick={() => setShowRawRef((v) => !v)}
                >
                  <span>원문 References 표기 보기</span>
                  {showRawRef ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                {showRawRef && <div className="cit-raw-box">{metadata.raw_reference}</div>}
              </div>
            </>
          )}
        </div>
      </div>

      {zoomMainFig && mainFigFullUrl && (
        <div className="media-lightbox-backdrop" onClick={() => setZoomMainFig(false)}>
          <div className="media-lightbox-modal" onClick={(e) => e.stopPropagation()}>
            <div className="media-lightbox-top">
              <strong>[{refKey}] 인용 논문 Main Figure</strong>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setZoomMainFig(false)}
                title="닫기"
              >
                <X size={18} />
              </button>
            </div>
            <div className="media-lightbox-img-wrap">
              <img src={mainFigFullUrl} alt={`[${refKey}] Main Figure`} />
            </div>
            {effectiveSummary?.main_figure_caption && (
              <div className="media-lightbox-caption">
                <p>{effectiveSummary.main_figure_caption}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
