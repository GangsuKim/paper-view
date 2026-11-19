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
import { getUiStrings, type LangCode, type UiStrings } from '../i18n';
import type { PaperSummaryItem, QueueItem, QueueStateResponse } from '../types';

interface QueueModalProps {
  lang?: LangCode;
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

function statusBadgeInfo(item: QueueItem, t: UiStrings): { label: string; cls: string } {
  switch (item.status) {
    case 'running':
      return { label: t.qStatusRunning(item.progress), cls: 'running' };
    case 'queued':
      return { label: t.qStatusQueued(item.progress), cls: 'queued' };
    case 'waiting_quota':
      return { label: t.qStatusQuota, cls: 'warn' };
    case 'completed':
      return { label: t.qStatusDone, cls: 'done' };
    case 'error':
      return { label: t.qStatusError, cls: 'err' };
    default:
      return { label: item.status, cls: 'queued' };
  }
}

export const QueueModal: React.FC<QueueModalProps> = ({
  lang = 'ko',
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
  const t = getUiStrings(lang);
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
      const next = await enqueuePdfFiles(pdfs, selectedEngine, forceRetranslate, lang);
      onQueueUpdated(next);
    } catch (err: any) {
      setLocalError(err?.message || 'Queue error');
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
      const next = await enqueueUrlsOrArxivs(targets, selectedEngine, forceRetranslate, lang);
      onQueueUpdated(next);
      setBatchUrlInput('');
    } catch (err: any) {
      setLocalError(err?.message || 'Queue error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEnqueuePaperIds = async (ids: string[], force = false) => {
    if (ids.length === 0) return;
    setSubmitting(true);
    setLocalError(null);
    try {
      const next = await enqueuePaperIds(ids, selectedEngine, force, lang);
      onQueueUpdated(next);
    } catch (err: any) {
      setLocalError(err?.message || 'Queue error');
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
      setLocalError(err?.message || 'Queue error');
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
        aria-label={t.queueTitle}
      >
        <div className="queue-modal-header">
          <div className="row-center" style={{ gap: 8 }}>
            <ListChecks size={18} className="sec-icon" />
            <div>
              <h3>{t.queueTitle}</h3>
              <p className="queue-header-sub">
                {t.queueSub}
                {selectedModelLabel ? ` · ${selectedModelLabel}` : ''}
              </p>
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} title={t.close}>
            <X size={18} />
          </button>
        </div>

        <div className="queue-modal-body">
          <div className="queue-schedule-bar">
            <div className="queue-sched-top">
              <div className="row-center" style={{ gap: 8, flexWrap: 'wrap' }}>
                {queueState.paused ? (
                  <span className="queue-status-pill paused">{t.qPaused}</span>
                ) : queueState.scheduled_time_label ? (
                  <span className="queue-status-pill scheduled">
                    {t.qScheduled(queueState.scheduled_time_label)}
                  </span>
                ) : queueState.is_worker_busy ? (
                  <span className="queue-status-pill running">
                    <span className="spinner-ring tiny" /> {t.qRunning}
                  </span>
                ) : (
                  <span className="queue-status-pill idle">{t.qIdle}</span>
                )}

                <label className="queue-checkbox-label">
                  <input
                    type="checkbox"
                    checked={queueState.auto_retry_on_quota}
                    onChange={(e) =>
                      handleControl({ auto_retry_on_quota: e.target.checked })
                    }
                  />
                  <span>{t.qAutoRetry}</span>
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
                    <span>{t.qStartNow}</span>
                  </button>
                )}

                {!queueState.paused && (
                  <button
                    type="button"
                    className="stream-ctrl-btn"
                    onClick={() => handleControl({ action: 'pause' })}
                  >
                    <Pause size={12} />
                    <span>{t.qPauseBtn}</span>
                  </button>
                )}

                {hasFinishedItems && (
                  <button
                    type="button"
                    className="stream-ctrl-btn"
                    onClick={() => handleControl({ action: 'clear_done' })}
                  >
                    <Trash2 size={12} />
                    <span>{t.qClearDone}</span>
                  </button>
                )}
              </div>
            </div>

            <div className="queue-sched-time-row">
              <Clock size={13} className="muted-icon" />
              <span>{t.qScheduleLabel}</span>
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
                {t.qSetSchedule}
              </button>
              {queueState.scheduled_time_label && (
                <button
                  type="button"
                  className="mini-sched-btn clear"
                  onClick={() => handleControl({ scheduled_time: '' })}
                >
                  {t.qClearSchedule}
                </button>
              )}
            </div>
          </div>

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
                <strong>{t.qDropTitle}</strong>
                <p>{t.qDropSub}</p>
              </div>
            </div>

            <form className="queue-url-box" onSubmit={handleAddBatchUrls}>
              <textarea
                rows={2}
                placeholder={t.qUrlPlaceholder}
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
                  <span>{t.qForceRetranslate}</span>
                </label>
                <button
                  type="submit"
                  className="mini-sched-btn primary"
                  disabled={submitting || !batchUrlInput.trim()}
                >
                  <Plus size={13} />
                  <span>{submitting ? t.qAdding : t.qAddBtn}</span>
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
                  {t.qAddCurrent(
                    `${(currentPaperTitle || '').slice(0, 28)}${
                      (currentPaperTitle || '').length > 28 ? '...' : ''
                    }`
                  )}
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
                  {t.qAddUnfinished(unfinishedRecent.length)}
                </button>
              )}
            </div>
          )}

          {localError && <div className="pane-error">{localError}</div>}

          <div className="queue-list-section">
            <div className="lib-pop-header">{t.qListHeader(queueState.items.length)}</div>

            {queueState.items.length === 0 ? (
              <div className="queue-empty-box">{t.qEmpty}</div>
            ) : (
              <div className="queue-items-scroll">
                {queueState.items.map((item, idx) => {
                  const badge = statusBadgeInfo(item, t);
                  const canMove =
                    item.status === 'queued' || item.status === 'waiting_quota';

                  return (
                    <div key={item.id} className={`queue-item-row ${badge.cls}`}>
                      <div className="queue-item-main">
                        <div className="queue-item-top">
                          <span className="queue-seq-num">#{idx + 1}</span>
                          {item.lang && (
                            <span className="model-sub-pill" style={{ fontSize: 10 }}>
                              {item.lang.toUpperCase()}
                            </span>
                          )}
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
                        >
                          <ExternalLink size={11} />
                          <span>{t.openBtn}</span>
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
