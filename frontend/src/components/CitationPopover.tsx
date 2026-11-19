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
import { getUiStrings, type LangCode } from '../i18n';
import type { CitationMetadataResponse, CitationSummaryResponse } from '../types';
import { renderMathText } from '../utils/mathRenderer';

interface CitationPopoverProps {
  lang?: LangCode;
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
  lang = 'ko',
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
  const t = getUiStrings(lang);
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

  const engineLabel =
    selectedEngine === 'codex'
      ? 'Codex'
      : selectedEngine === 'antigravity'
      ? 'Antigravity'
      : 'Claude';
  const modelDescriptor = selectedModelLabel ? `${engineLabel} (${selectedModelLabel})` : engineLabel;

  return (
    <>
      <div className="citation-drawer" role="dialog" aria-label={`[${refKey}] ${t.citHeader}`}>
        <div className="citation-drawer-header">
          <div className="cit-header-left">
            <span className="cit-ref-badge">[{refKey}]</span>
            <span className="cit-header-label">{t.citHeader}</span>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} title={t.close}>
            <X size={16} />
          </button>
        </div>

        <div className="citation-drawer-body">
          {loadingMeta && <div className="cit-loading-box">{t.citLoadingMeta}</div>}

          {metaError && <div className="pane-error">{metaError}</div>}

          {!loadingMeta && metadata && (
            <>
              <h4 className="cit-paper-title">{metadata.title}</h4>

              <div className="cit-meta-rows">
                {metadata.authors.length > 0 && (
                  <div className="cit-authors">
                    {metadata.authors.slice(0, 5).join(', ')}
                    {metadata.authors.length > 5 ? t.etAl(metadata.authors.length - 5) : ''}
                  </div>
                )}

                <div className="cit-tags-row">
                  {metadata.year && <span className="cit-tag year">{metadata.year}</span>}
                  {metadata.venue && <span className="cit-tag venue">{metadata.venue}</span>}
                  {metadata.arxiv_id && (
                    <span className="cit-tag oa">arXiv:{metadata.arxiv_id}</span>
                  )}
                  {metadata.has_fulltext ? (
                    <span className="cit-tag oa">{t.fulltextReady}</span>
                  ) : metadata.has_abstract ? (
                    <span className="cit-tag abs">{t.abstractReady}</span>
                  ) : (
                    <span className="cit-tag basic">{t.bibOnly}</span>
                  )}
                </div>
              </div>

              <div className="cit-links-bar">
                <a
                  href={goPaperUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="cit-link-btn primary-go"
                  onClick={() => notifyVsCodeExternalIfEmbedded(goPaperUrl)}
                >
                  <ExternalLink size={13} />
                  <span>{metadata.arxiv_id ? t.goPaperArxiv : t.goPaper}</span>
                </a>

                {metadata.pdf_url && metadata.pdf_url !== goPaperUrl && (
                  <a
                    href={metadata.pdf_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="cit-link-btn"
                    onClick={() => notifyVsCodeExternalIfEmbedded(metadata.pdf_url!)}
                  >
                    <FileText size={13} />
                    <span>{t.rawPdfBtn}</span>
                  </a>
                )}

                {importTarget && (
                  <a
                    href={`/?import=${encodeURIComponent(importTarget)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="cit-link-btn highlight"
                  >
                    <ArrowUpRight size={13} />
                    <span>{t.openInNewTab}</span>
                  </a>
                )}

                {publisherDoiUrl && publisherDoiUrl !== goPaperUrl && (
                  <a
                    href={publisherDoiUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="cit-link-btn"
                    onClick={() => notifyVsCodeExternalIfEmbedded(publisherDoiUrl)}
                  >
                    <ExternalLink size={12} />
                    <span>DOI</span>
                  </a>
                )}
              </div>

              {!effectiveSummary && !loadingSummary && (
                <div className="cit-summary-cta-box">
                  <button
                    type="button"
                    className="cit-summarize-primary-btn"
                    onClick={() => onRequestSummary(false)}
                  >
                    <Sparkles size={16} />
                    <span>{t.quickSummaryBtn}</span>
                  </button>
                  <p className="cit-cta-hint">
                    {t.quickSummaryHint(modelDescriptor, metadata.has_fulltext)}
                  </p>
                </div>
              )}

              {loadingSummary && (
                <div className="cit-summary-loading-card">
                  <div className="cit-summary-loading">
                    <div className="spinner-ring" />
                    <div>
                      <strong>{t.summarizingTitle(refKey)}</strong>
                      <p>{t.summarizingBody}</p>
                    </div>
                  </div>
                  <button type="button" className="cit-bg-close-btn" onClick={onClose}>
                    {t.closeKeepReading}
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
                        title={t.retranslateTitle}
                        onClick={() => onRequestSummary(true)}
                      >
                        <RefreshCw size={12} />
                      </button>
                    </div>
                  </div>

                  {mainFigFullUrl && (
                    <div className="cit-main-fig-card">
                      <div className="cit-main-fig-header">
                        <span className="row-center">
                          <ImageIcon size={12} />
                          <strong>{t.mainFigTitle}</strong>
                        </span>
                        <button
                          type="button"
                          className="cit-fig-zoom-btn"
                          onClick={() => setZoomMainFig(true)}
                        >
                          <ZoomIn size={12} /> {t.zoomImage}
                        </button>
                      </div>
                      <div
                        className="cit-main-fig-img-wrap"
                        onClick={() => setZoomMainFig(true)}
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
                    <span className="cit-sec-kicker">{t.tldrLabel}</span>
                    <p>{renderMathText(effectiveSummary.tldr, 'cit_tldr')}</p>
                  </div>

                  {effectiveSummary.summary_points.length > 0 && (
                    <div className="cit-points-block">
                      <span className="cit-sec-kicker">{t.keyPointsLabel}</span>
                      <ul>
                        {effectiveSummary.summary_points.map((pt, i) => (
                          <li key={i}>{renderMathText(pt, `cit_pt_${i}`)}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {effectiveSummary.why_cited && (
                    <div className="cit-why-block">
                      <span className="cit-sec-kicker">{t.whyCitedLabel}</span>
                      <p>{renderMathText(effectiveSummary.why_cited, 'cit_why')}</p>
                    </div>
                  )}
                </div>
              )}

              {metadata.citing_sentences.length > 0 && (
                <div className="cit-collapsible">
                  <button
                    type="button"
                    className="cit-collapse-toggle"
                    onClick={() => setShowCitingList((v) => !v)}
                  >
                    <span className="row-center">
                      <Quote size={13} />
                      {t.citingLocs(metadata.citing_sentences.length)}
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
                  <span>{t.rawRefToggle}</span>
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
              <strong>
                [{refKey}] {t.mainFigTitle}
              </strong>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setZoomMainFig(false)}
                title={t.close}
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
