import React, { useRef, useState } from 'react';
import {
  X,
  Upload,
  Clock,
  Play,
  Pause,
  Trash2,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  ExternalLink,
  CheckCircle2,
  ListChecks,
  Plus,
} from 'lucide-react';
import {
  controlTranslationQueue,
  enqueuePaperIds,
  enqueuePdfFiles,
  enqueueUrlsOrArxivs,
  moveQueueItem,
  removeQueueItem,
  retryQueueItem,
} from '../api';
import type { PaperSummaryItem, QueueItem, QueueStateResponse } from '../types';

interface QueueModalProps {
  queueState: QueueStateResponse;
  selectedEngine: string;
  selectedModelLabel?: string;
  currentPaperId?: string | null;
  currentPaperTitle?: string | null;
  recentPapers: PaperSummaryItem[];
  onQueueUpdated: (next: QueueStateResponse) => void;
  onOpenPaper: (paperId: string) => void;
  onClose: () => void;
}

function statusBadgeInfo(item: QueueItem): { label: string; cls: string } {
  switch (item.status) {
    case 'running':
      return { label: `번역 중 (${item.progress}%)`, cls: 'running' };
    case 'queued':
      return {
        label: item.progress > 0 ? `대기 중 (${item.progress}% 완료됨)` : '대기 중',
        cls: 'queued',
      };
    case 'waiting_quota':
      return { label: '한도 초기화 대기 중', cls: 'warn' };
    case 'completed':
      return { label: '완료', cls: 'done' };
    case 'error':
      return { label: '오류', cls: 'err' };
    default:
      return { label: item.status, cls: 'queued' };
  }
}

export const QueueModal: React.FC<QueueModalProps> = ({
  queueState,
  selectedEngine,
  selectedModelLabel,
  currentPaperId,
  currentPaperTitle,
  recentPapers,
  onQueueUpdated,
  onOpenPaper,
  onClose,
}) => {
  const multiFileRef = useRef<HTMLInputElement | null>(null);
  const [batchUrlInput, setBatchUrlInput] = useState('');
  const [timeInput, setTimeInput] = useState('02:00');
  const [forceRetranslate, setForceRetranslate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleFilesSelected = async (fileList: FileList | File[]) => {
    const pdfs = Array.from(fileList).filter((f) =>
      f.name.toLowerCase().endsWith('.pdf')
    );
    if (pdfs.length === 0) return;

    setSubmitting(true);
    setLocalError(null);
    try {
      const next = await enqueuePdfFiles(pdfs, selectedEngine, forceRetranslate);
      onQueueUpdated(next);
    } catch (err: any) {
      setLocalError(err?.message || 'PDF 큐 등록 실패');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddBatchUrls = async (e: React.FormEvent) => {
    e.preventDefault();
    const targets = batchUrlInput
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (targets.length === 0) return;

    setSubmitting(true);
    setLocalError(null);
    try {
      const next = await enqueueUrlsOrArxivs(targets, selectedEngine, forceRetranslate);
      onQueueUpdated(next);
      setBatchUrlInput('');
    } catch (err: any) {
      setLocalError(err?.message || 'URL/arXiv 큐 추가 실패');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEnqueuePaperIds = async (ids: string[], force = false) => {
    if (ids.length === 0) return;
    setSubmitting(true);
    setLocalError(null);
    try {
      const next = await enqueuePaperIds(ids, selectedEngine, force);
      onQueueUpdated(next);
    } catch (err: any) {
      setLocalError(err?.message || '논문 큐 추가 실패');
    } finally {
      setSubmitting(false);
    }
  };

  const handleControl = async (
    payload: Parameters<typeof controlTranslationQueue>[0]
  ) => {
    try {
      const next = await controlTranslationQueue(payload);
      onQueueUpdated(next);
    } catch (err: any) {
      setLocalError(err?.message || '큐 제어 실패');
    }
  };

  const unfinishedRecent = recentPapers.filter(
    (rp) =>
      rp.ai_status !== 'completed' &&
      !queueState.items.some(
        (it) =>
          it.paper_id === rp.paper_id &&
          ['queued', 'running', 'waiting_quota'].includes(it.status)
      )
  );

  const hasFinishedItems = queueState.items.some((it) =>
    ['completed', 'error', 'cancelled'].includes(it.status)
  );

  return (
    <div className="media-lightbox-backdrop" onClick={onClose}>
      <div
        className="queue-modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="논문 자동 번역 큐 관리"
      >
        {/* Header */}
        <div className="queue-modal-header">
          <div className="row-center" style={{ gap: 8 }}>
            <ListChecks size={18} className="sec-icon" />
            <div>
              <h3>논문 예약 · 연속 번역 큐 (Queue)</h3>
              <p className="queue-header-sub">
                여러 논문을 걸어두면 핵심 요약부터 전문 번역까지 순서대로 자동 실행됩니다
                {selectedModelLabel ? ` · 현재 모델: ${selectedModelLabel}` : ''}
              </p>
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} title="닫기">
            <X size={18} />
          </button>
        </div>

        <div className="queue-modal-body">
          {/* 1. Schedule & Execution Control Bar */}
          <div className="queue-schedule-bar">
            <div className="queue-sched-top">
              <div className="row-center" style={{ gap: 8, flexWrap: 'wrap' }}>
                {queueState.paused ? (
                  <span className="queue-status-pill paused">⏸ 일시정지됨</span>
                ) : queueState.scheduled_time_label ? (
                  <span className="queue-status-pill scheduled">
                    🌙 {queueState.scheduled_time_label} 시작 예약됨
                  </span>
                ) : queueState.is_worker_busy ? (
                  <span className="queue-status-pill running">
                    <span className="spinner-ring tiny" /> 실시간 순차 번역 중
                  </span>
                ) : (
                  <span className="queue-status-pill idle">대기 중 (추가 시 즉시 시작)</span>
                )}

                <label className="queue-checkbox-label" title="새벽 중 Claude 5시간 구독 한도에 도달하더라도 멈춘 구간을 저장해 두고, 한도 초기화 후 자동으로 이어서 번역합니다.">
                  <input
                    type="checkbox"
                    checked={queueState.auto_retry_on_quota}
                    onChange={(e) =>
                      handleControl({ auto_retry_on_quota: e.target.checked })
                    }
                  />
                  <span>구독 한도 도달 시 초기화 후 자동 재개</span>
                </label>
              </div>

              <div className="row-center" style={{ gap: 6 }}>
                {(queueState.paused || queueState.scheduled_time_label) && (
                  <button
                    type="button"
                    className="stream-ctrl-btn primary"
                    onClick={() => handleControl({ action: 'start_now' })}
                  >
                    <Play size={12} />
                    <span>지금 바로 시작</span>
                  </button>
                )}

                {!queueState.paused && (
                  <button
                    type="button"
                    className="stream-ctrl-btn"
                    onClick={() => handleControl({ action: 'pause' })}
                  >
                    <Pause size={12} />
                    <span>큐 일시정지</span>
                  </button>
                )}

                {hasFinishedItems && (
                  <button
                    type="button"
                    className="stream-ctrl-btn"
                    onClick={() => handleControl({ action: 'clear_done' })}
                    title="완료·오류 항목 목록에서 비우기"
                  >
                    <Trash2 size={12} />
                    <span>완료 정리</span>
                  </button>
                )}
              </div>
            </div>

            <div className="queue-sched-time-row">
              <Clock size={13} className="muted-icon" />
              <span>취침·외출 예약 시작 시각:</span>
              <input
                type="time"
                className="queue-time-input"
                value={timeInput}
                onChange={(e) => setTimeInput(e.target.value)}
              />
              <button
                type="button"
                className="mini-sched-btn"
                onClick={() => handleControl({ scheduled_time: timeInput })}
              >
                예약 걸기
              </button>
              {queueState.scheduled_time_label && (
                <button
                  type="button"
                  className="mini-sched-btn clear"
                  onClick={() => handleControl({ scheduled_time: '' })}
                >
                  예약 해제
                </button>
              )}
            </div>
          </div>

          {/* 2. Batch Enqueue Section (Multi-PDF + Batch arXiv/URL) */}
          <div className="queue-add-grid">
            <div
              className={`queue-dropzone ${dragActive ? 'drag' : ''}`}
              onClick={() => multiFileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                if (e.dataTransfer.files?.length) {
                  handleFilesSelected(e.dataTransfer.files);
                }
              }}
            >
              <input
                ref={multiFileRef}
                type="file"
                accept="application/pdf,.pdf"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  if (e.target.files?.length) {
                    handleFilesSelected(e.target.files);
                  }
                  e.target.value = '';
                }}
              />
              <Upload size={20} className="sec-icon" />
              <div>
                <strong>PDF 논문 여러 개 한 번에 추가</strong>
                <p>클릭하여 여러 파일을 선택하거나 여기에 드래그 앤 드롭하세요</p>
              </div>
            </div>

            <form className="queue-url-box" onSubmit={handleAddBatchUrls}>
              <textarea
                rows={2}
                placeholder="arXiv ID 또는 PDF URL 여러 개 입력 (쉼표 또는 줄바꿈 구분, 예: 1706.03762, 2403.07636)"
                value={batchUrlInput}
                onChange={(e) => setBatchUrlInput(e.target.value)}
              />
              <div className="queue-url-actions">
                <label className="queue-checkbox-label">
                  <input
                    type="checkbox"
                    checked={forceRetranslate}
                    onChange={(e) => setForceRetranslate(e.target.checked)}
                  />
                  <span>이미 번역된 논문도 처음부터 재번역</span>
                </label>
                <button
                  type="submit"
                  className="mini-sched-btn primary"
                  disabled={submitting || !batchUrlInput.trim()}
                >
                  <Plus size={13} />
                  <span>{submitting ? '추가 중...' : '큐에 추가'}</span>
                </button>
              </div>
            </form>
          </div>

          {(currentPaperId || unfinishedRecent.length > 0) && (
            <div className="queue-quick-chips">
              {currentPaperId && (
                <button
                  type="button"
                  className="section-chip"
                  onClick={() => handleEnqueuePaperIds([currentPaperId], forceRetranslate)}
                >
                  + 현재 열린 논문 큐에 추가 ({(currentPaperTitle || '').slice(0, 28)}
                  {(currentPaperTitle || '').length > 28 ? '...' : ''})
                </button>
              )}
              {unfinishedRecent.length > 0 && (
                <button
                  type="button"
                  className="section-chip"
                  onClick={() =>
                    handleEnqueuePaperIds(
                      unfinishedRecent.map((r) => r.paper_id),
                      false
                    )
                  }
                >
                  + 미완료 최근 논문 {unfinishedRecent.length}개 일괄 추가
                </button>
              )}
            </div>
          )}

          {localError && <div className="pane-error">{localError}</div>}

          {/* 3. Queue Items List */}
          <div className="queue-list-section">
            <div className="lib-pop-header">
              큐 대기열 목록 ({queueState.items.length}건)
            </div>

            {queueState.items.length === 0 ? (
              <div className="queue-empty-box">
                등록된 논문이 없습니다. 자기 전에 읽고 싶은 PDF 논문들을 여러 개 올려두시면
                요약·Contribution부터 전체 본문 번역까지 밤새 자동으로 완료해 둡니다.
              </div>
            ) : (
              <div className="queue-items-scroll">
                {queueState.items.map((item, idx) => {
                  const badge = statusBadgeInfo(item);
                  const canMove =
                    item.status === 'queued' || item.status === 'waiting_quota';

                  return (
                    <div key={item.id} className={`queue-item-row ${badge.cls}`}>
                      <div className="queue-item-main">
                        <div className="queue-item-top">
                          <span className="queue-seq-num">#{idx + 1}</span>
                          <strong className="queue-item-title" title={item.title}>
                            {item.title}
                          </strong>
                          <span className={`queue-badge ${badge.cls}`}>
                            {item.status === 'completed' && <CheckCircle2 size={11} />}
                            {badge.label}
                          </span>
                        </div>

                        <div className="queue-prog-track">
                          <div
                            className={`queue-prog-fill ${badge.cls}`}
                            style={{
                              width: `${Math.max(
                                item.status === 'running' ? 4 : 0,
                                item.progress
                              )}%`,
                            }}
                          />
                        </div>

                        {item.error && (
                          <div className="queue-item-err">{item.error}</div>
                        )}
                      </div>

                      <div className="queue-item-actions">
                        <button
                          type="button"
                          className="alert-open-btn"
                          onClick={() => {
                            onOpenPaper(item.paper_id);
                            onClose();
                          }}
                          title="이 논문 화면 열기"
                        >
                          <ExternalLink size={11} />
                          <span>열기</span>
                        </button>

                        {canMove && (
                          <>
                            <button
                              type="button"
                              className="icon-tiny-btn"
                              disabled={idx === 0}
                              onClick={async () =>
                                onQueueUpdated(await moveQueueItem(item.id, 'up'))
                              }
                              title="순서 위로"
                            >
                              <ArrowUp size={12} />
                            </button>
                            <button
                              type="button"
                              className="icon-tiny-btn"
                              disabled={idx === queueState.items.length - 1}
                              onClick={async () =>
                                onQueueUpdated(await moveQueueItem(item.id, 'down'))
                              }
                              title="순서 아래로"
                            >
                              <ArrowDown size={12} />
                            </button>
                          </>
                        )}

                        {(item.status === 'error' || item.status === 'waiting_quota') && (
                          <button
                            type="button"
                            className="icon-tiny-btn"
                            onClick={async () =>
                              onQueueUpdated(await retryQueueItem(item.id))
                            }
                            title="다시 시도"
                          >
                            <RotateCcw size={12} />
                          </button>
                        )}

                        <button
                          type="button"
                          className="icon-tiny-btn"
                          onClick={async () =>
                            onQueueUpdated(await removeQueueItem(item.id))
                          }
                          title="큐에서 제거 / 중단"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
