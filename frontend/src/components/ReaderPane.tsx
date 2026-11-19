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
} from 'lucide-react';
import { getApiBase } from '../api';
import type { InlineCitation, PaperOverview, SentenceItem } from '../types';
import { getExplicitMathRanges, renderMathText } from '../utils/mathRenderer';

interface ReaderPaneProps {
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
              title={`인용 논문 [${rk}] 정보 보기`}
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
              title={`인용 논문 [${item.ref_key}] 정보 보기`}
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
  onSelectSentenceFromReader,
  onClickCitation,
  onPauseStream,
  onResumeStream,
  onRestartStream,
}) => {
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const overviewCardRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const sectionHeaderRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const [searchQuery, setSearchQuery] = useState('');
  const [showKo, setShowKo] = useState(true);
  const [overviewCollapsed, setOverviewCollapsed] = useState(false);
  const [lightboxItem, setLightboxItem] = useState<SentenceItem | null>(null);

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
            placeholder="원문 또는 번역 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="reader-mode-actions">
          {aiModel && (
            <span className="active-model-chip" title={`현재 논문에 사용된 AI 모델: ${aiModel}`}>
              모델: <strong>{aiModel}</strong>
            </span>
          )}

          <button
            type="button"
            className={`pill-toggle-btn ${showKo ? 'active' : ''}`}
            onClick={() => setShowKo((v) => !v)}
            title="문장별 한국어 번역 표시 켜기/끄기"
          >
            {showKo ? <Eye size={14} /> : <EyeOff size={14} />}
            <span>{showKo ? '번역 함께 보기' : '영어 원문만'}</span>
          </button>

          {aiStatus === 'completed' && (
            <button
              type="button"
              className="icon-btn"
              title="현재 선택한 AI 엔진으로 논문 다시 번역"
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
                    <>
                      AI가 가장 먼저 <strong>논문 핵심 요약 &amp; Contribution</strong>을 정리하고
                      있습니다...
                    </>
                  ) : (
                    <>
                      요약 완료! 이어서 <strong>Abstract / Introduction / ...</strong> 섹션별 실시간
                      번역을 시작합니다...
                    </>
                  )
                ) : (
                  <>
                    실시간 번역 중 —{' '}
                    <strong>{streamingSection || sections[sections.length - 1] || '본문'}</strong>{' '}
                    ({sentences.length}문장 완료 · {aiProgress}%)
                    {aiModel ? ` · 모델: ${aiModel}` : ''}
                  </>
                )}
              </span>
            </div>
            <button type="button" className="stream-ctrl-btn" onClick={onPauseStream}>
              <Pause size={12} />
              <span>일시정지</span>
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
            <span>
              번역이 일시정지되었습니다 ({sentences.length}문장 완료 · {aiProgress}%)
            </span>
            <div className="row-center">
              <button type="button" className="stream-ctrl-btn primary" onClick={onResumeStream}>
                <Play size={12} />
                <span>이어서 번역</span>
              </button>
              <button type="button" className="stream-ctrl-btn" onClick={onRestartStream}>
                <RefreshCw size={12} />
                <span>처음부터</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {aiStatus === 'error' && (
        <div className="stream-progress-banner error">
          <div className="stream-banner-top">
            <span>스트리밍 번역 오류: {aiError || '알 수 없는 오류'}</span>
            <button type="button" className="stream-ctrl-btn primary" onClick={onResumeStream}>
              <RefreshCw size={12} />
              <span>이어서 재시도</span>
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
              ✦ 핵심 요약
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
        {/* Step 0: Top Paper Summary & Core Contributions Card */}
        {!searchQuery.trim() && (overview || loadingOverview || (isStreaming && !overview)) && (
          <section className="paper-overview-card" ref={overviewCardRef}>
            <div className="overview-card-header">
              <div className="overview-title-left">
                <Sparkles size={15} className="overview-sparkle" />
                <h3>논문 핵심 요약 &amp; Contribution</h3>
                {overview?.model_name && (
                  <span className="overview-model-pill">{overview.model_name}</span>
                )}
              </div>

              {overview && (
                <div className="row-center" style={{ gap: 4 }}>
                  <button
                    type="button"
                    className="icon-tiny-btn"
                    title="현재 모델로 핵심 요약 다시 생성"
                    disabled={loadingOverview}
                    onClick={onRefreshOverview}
                  >
                    <RefreshCw size={12} className={loadingOverview ? 'spin' : ''} />
                  </button>
                  <button
                    type="button"
                    className="icon-tiny-btn"
                    title={overviewCollapsed ? '요약 펼치기' : '요약 접기'}
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
                <span>
                  논문 전체 구조(초록·서론·방법론·결론)를 바탕으로 <strong>핵심 요약과 주요 Contribution</strong>을 먼저 작성하는 중입니다...
                </span>
              </div>
            ) : (
              !overviewCollapsed && (
                <div className="overview-card-body">
                  {overview.tldr && (
                    <div className="overview-tldr-box">
                      <span className="overview-kicker">한줄 핵심 요약</span>
                      <p>{renderOverviewRich(overview.tldr, 'ov_tldr')}</p>
                    </div>
                  )}

                  {overview.contributions.length > 0 && (
                    <div className="overview-contrib-box">
                      <span className="overview-kicker">주요 Contribution</span>
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
                          <span className="overview-meta-tag">문제 정의</span>
                          <p>{renderOverviewRich(overview.problem, 'ov_prob')}</p>
                        </div>
                      )}
                      {overview.method && (
                        <div className="overview-meta-item">
                          <span className="overview-meta-tag">제안 방법</span>
                          <p>{renderOverviewRich(overview.method, 'ov_meth')}</p>
                        </div>
                      )}
                      {overview.results && (
                        <div className="overview-meta-item">
                          <span className="overview-meta-tag">주요 성과</span>
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
            <p>번역이 완료되는 문장부터 실시간으로 바로 표시됩니다...</p>
          </div>
        )}

        {groupedBySection.length === 0 && !isStreaming && (
          <div className="pane-placeholder">표시할 문장이 없습니다.</div>
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
                <span className="sec-count">{items.length}문장</span>
              </div>
            </div>

            <div className="bilingual-sentence-list">
              {items.map((sent) => {
                const isActive = sent.id === activeSentenceId;
                const isMedia = sent.kind === 'figure' || sent.kind === 'table';
                const fullImgUrl = sent.image_url ? `${getApiBase()}${sent.image_url}` : null;

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
                        title="클릭하여 원본 해상도로 크게 보기"
                      >
                        <img src={fullImgUrl} alt={sent.media_label || sent.text} loading="lazy" />
                        <span className="media-zoom-hint">
                          <ZoomIn size={13} /> 크게 보기
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
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {lightboxItem && lightboxItem.image_url && (
        <div className="media-lightbox-backdrop" onClick={() => setLightboxItem(null)}>
          <div className="media-lightbox-modal" onClick={(e) => e.stopPropagation()}>
            <div className="media-lightbox-top">
              <strong>
                {lightboxItem.media_label || 'Figure / Table'} (Page {lightboxItem.page})
              </strong>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setLightboxItem(null)}
                title="닫기"
              >
                <X size={18} />
              </button>
            </div>
            <div className="media-lightbox-img-wrap">
              <img
                src={`${getApiBase()}${lightboxItem.image_url}`}
                alt={lightboxItem.media_label || ''}
              />
            </div>
            <div className="media-lightbox-caption">
              <p>{renderMathText(lightboxItem.text, 'lb_en')}</p>
              {lightboxItem.ko && (
                <p className="ko">→ {renderMathText(lightboxItem.ko, 'lb_ko')}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
