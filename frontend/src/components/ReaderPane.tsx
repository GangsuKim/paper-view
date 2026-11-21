import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshCw,
  Search,
  BookOpen,
  Pause,
  Play,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Table as TableIcon,
  ZoomIn,
  X,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Lightbulb,
  ExternalLink,
  Code2,
  Globe,
  Database,
} from 'lucide-react';
import { openExternalUrl, resolvePaperMediaUrl } from '../api';
import { isDemoMode } from '../demoMode';
import { getUiStrings, type LangCode } from '../i18n';
import type { InlineCitation, PaperOverview, PaperResourceLink, SentenceItem } from '../types';
import { getExplicitMathRanges, renderMathText } from '../utils/mathRenderer';

interface ReaderPaneProps {
  lang?: LangCode;
  resourceLinks?: PaperResourceLink[];
  overview: PaperOverview | null;
  loadingOverview: boolean;
  onRefreshOverview: () => void;
  sections: string[];
  sentences: SentenceItem[];
  aiStatus: string;
  aiProgress: number;
  aiModel?: string | null;
  aiError?: string | null;
  streamingSection?: string;
  activeSentenceId: string | null;
  scrollSignal: number; // incremented when Left PDF requests Right Reader scroll
  activeCitationRefKey: string | null;
  loadingInsightIds?: Set<string>;
  onRequestMediaInsight?: (sentenceId: string, force?: boolean) => void;
  onSelectSentenceFromReader: (sentence: SentenceItem) => void;
  onClickCitation: (refKey: string, sentence: SentenceItem) => void;
  onPauseStream: () => void;
  onResumeStream: () => void;
  onRestartStream: () => void;
}

function overlapsMathRange(
  start: number,
  end: number,
  mathRanges: Array<[number, number]>
): boolean {
  return mathRanges.some(([ms, me]) => start < me && end > ms);
}

/** Render inline clickable [12] badges + KaTeX LaTeX math inside Korean translation text */
function renderKoreanWithCitations(
  text: string,
  knownCitations: InlineCitation[],
  activeCitationRefKey: string | null,
  onClickCitation: (refKey: string) => void
): React.ReactNode {
  if (!knownCitations || knownCitations.length === 0) {
    return renderMathText(text, 'ko_plain');
  }
  const mathRanges = getExplicitMathRanges(text);
  const regex = /\[(\d{1,3}(?:\s*[-–—,]\s*\d{1,3})*)\]/g;
  const nodes: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const full = match[0];
    const inner = match[1];
    const start = match.index;
    const end = start + full.length;

    if (overlapsMathRange(start, end, mathRanges)) {
      continue;
    }

    if (start > lastIdx) {
      nodes.push(
        <span key={`t_${lastIdx}`}>
          {renderMathText(text.slice(lastIdx, start), `ko_${lastIdx}`)}
        </span>
      );
    }

    const extractedKeys: string[] = [];
    for (const part of inner.split(',').map((p) => p.trim())) {
      const rng = part.match(/^(\d{1,3})\s*[-–—]\s*(\d{1,3})$/);
      if (rng) {
        const a = parseInt(rng[1], 10);
        const b = parseInt(rng[2], 10);
        if (a > 0 && b >= a && b - a <= 15) {
          for (let k = a; k <= b; k++) extractedKeys.push(String(k));
        }
      } else if (/^\d{1,3}$/.test(part) && parseInt(part, 10) > 0) {
        extractedKeys.push(part);
      }
    }

    if (extractedKeys.length > 0) {
      nodes.push(
        <span key={`cg_${start}`} className="inline-cite-group">
          {extractedKeys.map((rk, idx) => (
            <button
              key={`${rk}_${idx}`}
              type="button"
              className={`inline-cite-pill ${activeCitationRefKey === rk ? 'selected' : ''}`}
              title={`[${rk}]`}
              onClick={(e) => {
                e.stopPropagation();
                onClickCitation(rk);
              }}
            >
              [{rk}]
            </button>
          ))}
        </span>
      );
    } else {
      nodes.push(<span key={`raw_${start}`}>{renderMathText(full, `ko_raw_${start}`)}</span>);
    }
    lastIdx = end;
  }

  if (lastIdx < text.length) {
    nodes.push(
      <span key={`tail_${lastIdx}`}>
        {renderMathText(text.slice(lastIdx), `ko_tail_${lastIdx}`)}
      </span>
    );
  }
  return nodes;
}

/** Render full English sentence with KaTeX LaTeX math + clickable numeric & author-year citations */
function renderFullEnglishSentence(
  sent: SentenceItem,
  activeCitationRefKey: string | null,
  onClickCitation: (refKey: string) => void
): React.ReactNode {
  if (!sent.citations || sent.citations.length === 0) {
    return renderMathText(sent.text, `en_${sent.id}`);
  }

  const mathRanges = getExplicitMathRanges(sent.text);
  const groups: Array<{ start: number; end: number; items: InlineCitation[] }> = [];
  for (const c of sent.citations) {
    if (overlapsMathRange(c.start, c.end, mathRanges)) {
      continue;
    }
    const last = groups[groups.length - 1];
    if (last && last.start === c.start && last.end === c.end) {
      last.items.push(c);
    } else if (!last || c.start >= last.end) {
      groups.push({ start: c.start, end: c.end, items: [c] });
    }
  }

  if (groups.length === 0) {
    return renderMathText(sent.text, `en_${sent.id}`);
  }

  const nodes: React.ReactNode[] = [];
  let cursor = 0;

  groups.forEach((g, gIdx) => {
    if (g.start > cursor) {
      nodes.push(
        <span key={`txt_${gIdx}`}>
          {renderMathText(sent.text.slice(cursor, g.start), `en_${sent.id}_${gIdx}`)}
        </span>
      );
    }
    nodes.push(
      <span key={`cit_grp_${gIdx}`} className="inline-cite-group">
        {g.items.map((item, iIdx) => {
          const isSelected = activeCitationRefKey === item.ref_key;
          return (
            <button
              key={`${item.ref_key}_${iIdx}`}
              type="button"
              className={`inline-cite-pill ${isSelected ? 'selected' : ''}`}
              title={`[${item.ref_key}]`}
              onClick={(e) => {
                e.stopPropagation();
                onClickCitation(item.ref_key);
              }}
            >
              {item.label.startsWith('[') ? item.label : `[${item.label}]`}
            </button>
          );
        })}
      </span>
    );
    cursor = g.end;
  });

  if (cursor < sent.text.length) {
    nodes.push(
      <span key="txt_tail">
        {renderMathText(sent.text.slice(cursor), `en_tail_${sent.id}`)}
      </span>
    );
  }
  return nodes;
}

function renderOverviewRich(text: string, keyPrefix: string): React.ReactNode {
  if (!text) return null;
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (!part) return null;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={`${keyPrefix}_b_${idx}`}>
          {renderMathText(part.slice(2, -2), `${keyPrefix}_bm_${idx}`)}
        </strong>
      );
    }
    return (
      <React.Fragment key={`${keyPrefix}_t_${idx}`}>
        {renderMathText(part, `${keyPrefix}_tm_${idx}`)}
      </React.Fragment>
    );
  });
}

export const ReaderPane: React.FC<ReaderPaneProps> = ({
  lang = 'ko',
  resourceLinks = [],
  overview,
  loadingOverview,
  onRefreshOverview,
  sections,
  sentences,
  aiStatus,
  aiProgress,
  aiModel,
  aiError,
  streamingSection,
  activeSentenceId,
  scrollSignal,
  activeCitationRefKey,
  loadingInsightIds,
  onRequestMediaInsight,
  onSelectSentenceFromReader,
  onClickCitation,
  onPauseStream,
  onResumeStream,
  onRestartStream,
}) => {
  const t = getUiStrings(lang);
  const demoMode = isDemoMode();
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const overviewCardRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const sectionHeaderRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const [searchQuery, setSearchQuery] = useState('');
  const [showKo, setShowKo] = useState(true);
  const [overviewCollapsed, setOverviewCollapsed] = useState(false);
  const [lightboxItem, setLightboxItem] = useState<SentenceItem | null>(null);
  const liveLightboxItem = useMemo(
    () =>
      lightboxItem
        ? sentences.find((s) => s.id === lightboxItem.id) || lightboxItem
        : null,
    [lightboxItem, sentences]
  );

  const filteredSentences = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sentences;
    return sentences.filter(
      (s) =>
        s.text.toLowerCase().includes(q) ||
        (s.ko && s.ko.toLowerCase().includes(q)) ||
        s.section.toLowerCase().includes(q)
    );
  }, [sentences, searchQuery]);

  const groupedBySection = useMemo(() => {
    const groups: Array<{ section: string; items: SentenceItem[] }> = [];
    for (const s of filteredSentences) {
      const last = groups[groups.length - 1];
      if (last && last.section === s.section) {
        last.items.push(s);
      } else {
        groups.push({ section: s.section, items: [s] });
      }
    }
    return groups;
  }, [filteredSentences]);

  useEffect(() => {
    if (!scrollSignal || !activeSentenceId) return;
    const el = cardRefs.current.get(activeSentenceId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [scrollSignal, activeSentenceId]);

  const scrollToSection = (sec: string) => {
    const el = sectionHeaderRefs.current.get(sec);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const isStreaming = aiStatus === 'streaming' || aiStatus === 'pending';

  return (
    <div className="reader-pane-root">
      {/* Subtoolbar */}
      <div className="pane-subtoolbar reader-subtoolbar">
        <div className="reader-search-box">
          <Search size={14} className="muted-icon" />
          <input
            type="text"
            placeholder={t.searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="reader-mode-actions">
          {aiModel && (
            <span className="active-model-chip" title={`${t.modelLabel}: ${aiModel}`}>
              {t.modelLabel}: <strong>{aiModel}</strong>
            </span>
          )}

          <button
            type="button"
            className={`pill-toggle-btn ${showKo ? 'active' : ''}`}
            onClick={() => setShowKo((v) => !v)}
          >
            {showKo ? <Eye size={14} /> : <EyeOff size={14} />}
            <span>{showKo ? t.showTransBtn : t.onlyOrigBtn}</span>
          </button>

          {aiStatus === 'completed' && !demoMode && (
            <button
              type="button"
              className="icon-btn"
              title={t.retranslateTitle}
              onClick={onRestartStream}
            >
              <RefreshCw size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Live Streaming Progress Banner */}
      {isStreaming && (
        <div className="stream-progress-banner">
          <div className="stream-banner-top">
            <div className="stream-status-left">
              <div className="spinner-ring small" />
              <span>
                {sentences.length === 0 ? (
                  !overview ? (
                    <>{t.streamOverviewWait}</>
                  ) : (
                    <>{t.streamSectionsStart}</>
                  )
                ) : (
                  <>
                    {t.streamProgress(
                      streamingSection || sections[sections.length - 1] || 'Abstract',
                      sentences.length,
                      aiProgress
                    )}
                    {aiModel ? ` · ${t.modelLabel}: ${aiModel}` : ''}
                  </>
                )}
              </span>
            </div>
            <button type="button" className="stream-ctrl-btn" onClick={onPauseStream}>
              <Pause size={12} />
              <span>{t.pauseBtn}</span>
            </button>
          </div>
          <div className="stream-progress-track">
            <div
              className="stream-progress-fill"
              style={{ width: `${Math.max(4, aiProgress)}%` }}
            />
          </div>
        </div>
      )}

      {aiStatus === 'paused' && (
        <div className="stream-progress-banner paused">
          <div className="stream-banner-top">
            <span>{t.pausedMsg(sentences.length, aiProgress)}</span>
            <div className="row-center">
              <button type="button" className="stream-ctrl-btn primary" onClick={onResumeStream}>
                <Play size={12} />
                <span>{t.resumeBtn}</span>
              </button>
              <button type="button" className="stream-ctrl-btn" onClick={onRestartStream}>
                <RefreshCw size={12} />
                <span>{t.restartBtn}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {aiStatus === 'error' && (
        <div className="stream-progress-banner error">
          <div className="stream-banner-top">
            <span>
              {t.streamErrPrefix}: {aiError || 'Unknown error'}
            </span>
            <button type="button" className="stream-ctrl-btn primary" onClick={onResumeStream}>
              <RefreshCw size={12} />
              <span>{t.retryBtn}</span>
            </button>
          </div>
        </div>
      )}

      {/* Dynamic Section Jump Bar */}
      {(overview || sections.length > 0) && (
        <div className="section-jump-bar">
          {overview && (
            <button
              type="button"
              className="section-chip overview-chip"
              onClick={() => {
                setOverviewCollapsed(false);
                overviewCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              {t.overviewChip}
            </button>
          )}
          {sections.map((sec) => (
            <button
              key={sec}
              type="button"
              className="section-chip"
              onClick={() => scrollToSection(sec)}
            >
              {sec}
            </button>
          ))}
        </div>
      )}

      {/* Main Reader Scroll Area */}
      <div className="reader-scroll-area" ref={scrollAreaRef}>
        {/* Official Author-Provided Code / Hugging Face / Project Links */}
        {!searchQuery.trim() && resourceLinks.length > 0 && (
          <div className="author-resources-bar">
            <span className="author-resources-kicker">{t.authorLinksLabel}</span>
            <div className="author-resources-pills">
              {resourceLinks.map((lk) => {
                const isGithub = lk.url.toLowerCase().includes('github.com');
                const badgeText =
                  lk.kind === 'huggingface'
                    ? t.hfLinkBadge
                    : lk.kind === 'project'
                    ? t.projectLinkBadge
                    : lk.kind === 'dataset'
                    ? t.datasetLinkBadge
                    : t.codeLinkBadge;
                const showSlug =
                  lk.label &&
                  lk.label.toLowerCase() !== badgeText.toLowerCase() &&
                  lk.label.toLowerCase() !== 'code ocean';
                return (
                  <button
                    key={lk.url}
                    type="button"
                    className={`author-resource-pill ${lk.kind}`}
                    title={lk.url}
                    onClick={() => openExternalUrl(lk.url)}
                  >
                    {lk.kind === 'huggingface' ? (
                      <span className="hf-emoji" aria-hidden="true">
                        🤗
                      </span>
                    ) : lk.kind === 'code' && isGithub ? (
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path d="M12 0.3C5.37 0.3 0 5.67 0 12.3c0 5.3 3.44 9.8 8.2 11.39.6.11.82-.26.82-.58 0-.29-.01-1.05-.02-2.06-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.08 1.85 1.24 1.85 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.02 0c2.28-1.55 3.29-1.23 3.29-1.23.66 1.66.25 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.48 5.92.43.37.81 1.1.81 2.22 0 1.61-.01 2.9-.01 3.29 0 .32.21.7.82.58C20.57 22.1 24 17.6 24 12.3 24 5.67 18.63 0.3 12 0.3z" />
                      </svg>
                    ) : lk.kind === 'project' ? (
                      <Globe size={13} />
                    ) : lk.kind === 'dataset' ? (
                      <Database size={13} />
                    ) : (
                      <Code2 size={13} />
                    )}
                    <strong className="res-pill-kind">{badgeText}</strong>
                    {showSlug && <span className="res-pill-slug">{lk.label}</span>}
                    <ExternalLink size={11} className="res-pill-ext" />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 0: Top Paper Summary & Core Contributions Card */}
        {!searchQuery.trim() && (overview || loadingOverview || (isStreaming && !overview)) && (
          <section className="paper-overview-card" ref={overviewCardRef}>
            <div className="overview-card-header">
              <div className="overview-title-left">
                <Sparkles size={15} className="overview-sparkle" />
                <h3>{t.overviewTitle}</h3>
                {overview?.model_name && (
                  <span className="overview-model-pill">{overview.model_name}</span>
                )}
              </div>

              {overview && (
                <div className="row-center" style={{ gap: 4 }}>
                  {!demoMode && (
                    <button
                      type="button"
                      className="icon-tiny-btn"
                      title={t.retranslateTitle}
                      disabled={loadingOverview}
                      onClick={onRefreshOverview}
                    >
                      <RefreshCw size={12} className={loadingOverview ? 'spin' : ''} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-tiny-btn"
                    onClick={() => setOverviewCollapsed((v) => !v)}
                  >
                    {overviewCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                  </button>
                </div>
              )}
            </div>

            {!overview ? (
              <div className="overview-loading-body">
                <div className="spinner-ring small" />
                <span>{t.overviewLoading}</span>
              </div>
            ) : (
              !overviewCollapsed && (
                <div className="overview-card-body">
                  {overview.tldr && (
                    <div className="overview-tldr-box">
                      <span className="overview-kicker">{t.tldrLabel}</span>
                      <p>{renderOverviewRich(overview.tldr, 'ov_tldr')}</p>
                    </div>
                  )}

                  {overview.contributions.length > 0 && (
                    <div className="overview-contrib-box">
                      <span className="overview-kicker">{t.contribLabel}</span>
                      <ol className="overview-contrib-list">
                        {overview.contributions.map((item, idx) => (
                          <li key={idx}>
                            <span className="contrib-num">{idx + 1}</span>
                            <div className="contrib-text">
                              {renderOverviewRich(item, `ov_c_${idx}`)}
                            </div>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                  {(overview.problem || overview.method || overview.results) && (
                    <div className="overview-meta-grid">
                      {overview.problem && (
                        <div className="overview-meta-item">
                          <span className="overview-meta-tag">{t.problemLabel}</span>
                          <p>{renderOverviewRich(overview.problem, 'ov_prob')}</p>
                        </div>
                      )}
                      {overview.method && (
                        <div className="overview-meta-item">
                          <span className="overview-meta-tag">{t.methodLabel}</span>
                          <p>{renderOverviewRich(overview.method, 'ov_meth')}</p>
                        </div>
                      )}
                      {overview.results && (
                        <div className="overview-meta-item">
                          <span className="overview-meta-tag">{t.resultsLabel}</span>
                          <p>{renderOverviewRich(overview.results, 'ov_res')}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            )}
          </section>
        )}

        {groupedBySection.length === 0 && isStreaming && (
          <div className="empty-streaming-skeleton">
            <div className="skeleton-card" />
            <div className="skeleton-card short" />
            <div className="skeleton-card" />
            <p>{t.skeletonWait}</p>
          </div>
        )}

        {groupedBySection.length === 0 && !isStreaming && (
          <div className="pane-placeholder">{t.noSentences}</div>
        )}

        {groupedBySection.map(({ section, items }) => (
          <section key={section} className="reader-section-block">
            <div
              className="reader-section-header"
              ref={(el) => {
                if (el) sectionHeaderRefs.current.set(section, el);
              }}
            >
              <div className="sec-title-wrap">
                <BookOpen size={15} className="sec-icon" />
                <h3>{section}</h3>
                <span className="sec-count">{t.sentenceCount(items.length)}</span>
              </div>
            </div>

            <div className="bilingual-sentence-list">
              {items.map((sent) => {
                const isActive = sent.id === activeSentenceId;
                const isMedia = sent.kind === 'figure' || sent.kind === 'table';
                const fullImgUrl = resolvePaperMediaUrl(sent.image_url);

                return (
                  <div
                    key={sent.id}
                    ref={(el) => {
                      if (el) cardRefs.current.set(sent.id, el);
                      else cardRefs.current.delete(sent.id);
                    }}
                    className={`bilingual-pair streamed-in ${isActive ? 'active' : ''} ${
                      isMedia ? `media-block ${sent.kind}` : ''
                    }`}
                    onClick={() => onSelectSentenceFromReader(sent)}
                  >
                    {isMedia ? (
                      <div className="media-block-header">
                        <span className={`media-type-badge ${sent.kind}`}>
                          {sent.kind === 'table' ? (
                            <TableIcon size={12} />
                          ) : (
                            <ImageIcon size={12} />
                          )}
                          <span>{sent.media_label || (sent.kind === 'table' ? 'Table' : 'Figure')}</span>
                        </span>
                        <span className="media-page-meta">Page {sent.page}</span>
                      </div>
                    ) : (
                      <span className="hover-page-pill">p.{sent.page}</span>
                    )}

                    {isMedia && fullImgUrl && (
                      <div
                        className="media-preview-frame"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLightboxItem(sent);
                        }}
                        title={t.zoomImage}
                      >
                        <img src={fullImgUrl} alt={sent.media_label || sent.text} loading="lazy" />
                        <span className="media-zoom-hint">
                          <ZoomIn size={13} /> {t.zoomImage}
                        </span>
                      </div>
                    )}

                    <div className="bilingual-en-line">
                      {renderFullEnglishSentence(sent, activeCitationRefKey, (rk) =>
                        onClickCitation(rk, sent)
                      )}
                    </div>

                    {showKo && sent.ko && (
                      <div className="bilingual-ko-line">
                        <span className="ko-arrow" aria-hidden="true">
                          →
                        </span>
                        <span className="ko-text">
                          {renderKoreanWithCitations(
                            sent.ko,
                            sent.citations,
                            activeCitationRefKey,
                            (rk) => onClickCitation(rk, sent)
                          )}
                        </span>
                      </div>
                    )}

                    {isMedia && showKo && (
                      <div
                        className="media-author-insight-area"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {sent.insight ? (
                          <div className="media-insight-box">
                            <div className="media-insight-head">
                              <span className="media-insight-kicker">
                                <Lightbulb size={13} />
                                <span>
                                  {t.mediaInsightLabel(
                                    sent.kind === 'table' ? 'table' : 'figure'
                                  )}
                                </span>
                              </span>
                              {onRequestMediaInsight && !demoMode && (
                                <button
                                  type="button"
                                  className="icon-tiny-btn"
                                  title={t.retranslateTitle}
                                  disabled={loadingInsightIds?.has(sent.id)}
                                  onClick={() => onRequestMediaInsight(sent.id, true)}
                                >
                                  <RefreshCw
                                    size={11}
                                    className={loadingInsightIds?.has(sent.id) ? 'spin' : ''}
                                  />
                                </button>
                              )}
                            </div>
                            <p className="media-insight-text">
                              {renderOverviewRich(sent.insight, `mi_${sent.id}`)}
                            </p>
                          </div>
                        ) : loadingInsightIds?.has(sent.id) || isStreaming ? (
                          <div className="media-insight-loading">
                            <div className="spinner-ring tiny" />
                            <span>{t.mediaInsightLoading}</span>
                          </div>
                        ) : (
                          onRequestMediaInsight && (
                            <button
                              type="button"
                              className="media-insight-cta-btn"
                              onClick={() => onRequestMediaInsight(sent.id, false)}
                            >
                              <Lightbulb size={13} />
                              <span>
                                {t.mediaInsightBtn(
                                  sent.kind === 'table' ? 'table' : 'figure'
                                )}
                              </span>
                            </button>
                          )
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {liveLightboxItem && liveLightboxItem.image_url && (
        <div className="media-lightbox-backdrop" onClick={() => setLightboxItem(null)}>
          <div className="media-lightbox-modal" onClick={(e) => e.stopPropagation()}>
            <div className="media-lightbox-top">
              <strong>
                {liveLightboxItem.media_label || 'Figure / Table'} (Page {liveLightboxItem.page})
              </strong>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setLightboxItem(null)}
                title={t.close}
              >
                <X size={18} />
              </button>
            </div>
            <div className="media-lightbox-img-wrap">
              <img
                src={resolvePaperMediaUrl(liveLightboxItem.image_url) || ''}
                alt={liveLightboxItem.media_label || ''}
              />
            </div>
            <div className="media-lightbox-caption">
              <p>{renderMathText(liveLightboxItem.text, 'lb_en')}</p>
              {liveLightboxItem.ko && (
                <p className="ko">→ {renderMathText(liveLightboxItem.ko, 'lb_ko')}</p>
              )}
              {liveLightboxItem.insight && (
                <div className="media-insight-box" style={{ marginTop: 10 }}>
                  <div className="media-insight-head">
                    <span className="media-insight-kicker">
                      <Lightbulb size={13} />
                      <span>
                        {t.mediaInsightLabel(
                          liveLightboxItem.kind === 'table' ? 'table' : 'figure'
                        )}
                      </span>
                    </span>
                  </div>
                  <p className="media-insight-text">
                    {renderOverviewRich(liveLightboxItem.insight, 'lb_mi')}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
