import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Upload,
  Globe,
  BookMarked,
  Cpu,
  Moon,
  Sun,
  Columns,
  FileText,
  Sparkles,
  AlertCircle,
  Bell,
  RefreshCw,
  CheckCircle2,
  X,
  ChevronDown,
  MessageSquare,
  Activity,
  ListChecks,
  Clock,
} from 'lucide-react';
import {
  fetchCitationMetadata,
  fetchModelsCatalog,
  fetchPaperBundle,
  fetchPapersList,
  fetchQueueState,
  fetchUsageStatus,
  generatePaperOverview,
  getPaperPdfUrl,
  getPaperStreamUrl,
  importPaperUrl,
  stopPaperStream,
  summarizeCitation,
  updateEngineSettings,
  uploadPaperFile,
} from './api';
import { PdfPane } from './components/PdfPane';
import { ReaderPane } from './components/ReaderPane';
import { CitationPopover } from './components/CitationPopover';
import { PaperChatDrawer } from './components/PaperChatDrawer';
import { QueueModal } from './components/QueueModal';
import type {
  AllModelsCatalog,
  CitationMetadataResponse,
  CitationSummaryResponse,
  EngineInfo,
  LoadedPaperBundle,
  ModelOptionItem,
  PaperDocument,
  PaperOverview,
  PaperSummaryItem,
  QueueStateResponse,
  SentenceItem,
  UsageStatusResponse,
} from './types';

interface SummaryAlertItem {
  id: string;
  paperId: string;
  refKey: string;
  paperTitle: string;
  status: 'running' | 'done' | 'error';
  unread: boolean;
  toastVisible: boolean;
  errorMsg?: string;
}

function groupModels(models: ModelOptionItem[]): Array<{ group: string; items: ModelOptionItem[] }> {
  const out: Array<{ group: string; items: ModelOptionItem[] }> = [];
  for (const m of models) {
    const g = out.find((x) => x.group === m.group);
    if (g) g.items.push(m);
    else out.push({ group: m.group, items: [m] });
  }
  return out;
}

export const App: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [modelsCatalog, setModelsCatalog] = useState<AllModelsCatalog | null>(null);
  const [selectedEngine, setSelectedEngine] = useState<string>('claude');
  const selectedEngineRef = useRef<string>('claude');

  const [showModelMenu, setShowModelMenu] = useState<boolean>(false);
  const [modelMenuTab, setModelMenuTab] = useState<'claude' | 'codex' | 'antigravity'>('claude');
  const [refreshingModels, setRefreshingModels] = useState<boolean>(false);
  const [geminiKeyInput, setGeminiKeyInput] = useState<string>('');

  const [recentPapers, setRecentPapers] = useState<PaperSummaryItem[]>([]);
  const [showLibraryMenu, setShowLibraryMenu] = useState(false);

  const [paper, setPaper] = useState<PaperDocument | null>(null);
  const paperRef = useRef<PaperDocument | null>(null);
  const [streamingSection, setStreamingSection] = useState<string>('');
  const [loadingOverview, setLoadingOverview] = useState<boolean>(false);
  const [citationSummaries, setCitationSummaries] = useState<
    Record<string, CitationSummaryResponse>
  >({});

  const [loadingPaper, setLoadingPaper] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [arxivInput, setArxivInput] = useState('');

  // Bidirectional PDF <-> Reader sync state
  const [activeSentenceId, setActiveSentenceId] = useState<string | null>(null);
  const [pdfScrollSignal, setPdfScrollSignal] = useState(0);
  const [readerScrollSignal, setReaderScrollSignal] = useState(0);

  // Citation drawer & background summarization state
  const [activeCitationKey, setActiveCitationKey] = useState<string | null>(null);
  const activeCitationKeyRef = useRef<string | null>(null);
  const [citationMetaCache, setCitationMetaCache] = useState<
    Record<string, CitationMetadataResponse>
  >({});
  const [loadingCitMeta, setLoadingCitMeta] = useState(false);
  const [citMetaError, setCitMetaError] = useState<string | null>(null);

  // Independent background summary jobs & Top-Right Alert Center
  const [summarizingKeys, setSummarizingKeys] = useState<Set<string>>(new Set());
  const [citSummaryErrors, setCitSummaryErrors] = useState<Record<string, string>>({});
  const [summaryAlerts, setSummaryAlerts] = useState<SummaryAlertItem[]>([]);
  const [showAlertsTray, setShowAlertsTray] = useState<boolean>(false);

  // Layout, usage check & theme controls
  const [usageStatus, setUsageStatus] = useState<UsageStatusResponse | null>(null);
  const [showUsageMenu, setShowUsageMenu] = useState<boolean>(false);
  const [refreshingUsage, setRefreshingUsage] = useState<boolean>(false);

  const [queueState, setQueueState] = useState<QueueStateResponse>({
    paused: false,
    auto_retry_on_quota: true,
    is_worker_busy: false,
    items: [],
  });
  const [showQueueModal, setShowQueueModal] = useState<boolean>(false);

  const [leftRatio, setLeftRatio] = useState<number>(48);
  const [showPdfPane, setShowPdfPane] = useState<boolean>(true);
  const [showChatPanel, setShowChatPanel] = useState<boolean>(false);
  const [chatWidth, setChatWidth] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem('paperview_chat_width'));
      if (Number.isFinite(saved) && saved >= 280 && saved <= 920) return saved;
    } catch {
      // ignore
    }
    return 400;
  });
  const chatWidthRef = useRef<number>(400);
  const [darkMode, setDarkMode] = useState<boolean>(false);
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);
  const splitDraggingRef = useRef<boolean>(false);
  const chatDraggingRef = useRef<boolean>(false);

  useEffect(() => {
    chatWidthRef.current = chatWidth;
  }, [chatWidth]);

  const loadUsageStatus = useCallback(async (refresh = false) => {
    setRefreshingUsage(true);
    try {
      const u = await fetchUsageStatus(refresh);
      setUsageStatus(u);
    } catch {
      // ignore transient error
    } finally {
      setRefreshingUsage(false);
    }
  }, []);

  useEffect(() => {
    selectedEngineRef.current = selectedEngine;
  }, [selectedEngine]);

  useEffect(() => {
    paperRef.current = paper;
  }, [paper]);

  useEffect(() => {
    activeCitationKeyRef.current = activeCitationKey;
  }, [activeCitationKey]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  const closeStream = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => closeStream();
  }, [closeStream]);

  const triggerPaperOverview = useCallback(
    async (paperId: string, engine: string, force = false) => {
      setLoadingOverview(true);
      try {
        const ov = await generatePaperOverview(paperId, engine, force);
        if (paperRef.current?.paper_id === paperId) {
          setPaper((prev) => (prev ? { ...prev, overview: ov } : prev));
        }
        loadUsageStatus(true);
      } catch {
        // ignore transient error
      } finally {
        if (paperRef.current?.paper_id === paperId) {
          setLoadingOverview(false);
        }
      }
    },
    [loadUsageStatus]
  );

  const startPaperStream = useCallback(
    (paperId: string, engine: string, force = false) => {
      closeStream();
      setStreamingSection('논문 핵심 요약 & Contribution');
      if (force) {
        setPaper((prev) =>
          prev && prev.paper_id === paperId
            ? {
                ...prev,
                overview: null,
                sections: [],
                sentences: [],
                ai_status: 'streaming',
                ai_progress: 0,
                ai_error: null,
              }
            : prev
        );
      } else {
        setPaper((prev) =>
          prev && prev.paper_id === paperId
            ? { ...prev, ai_status: 'streaming', ai_error: null }
            : prev
        );
      }

      const es = new EventSource(getPaperStreamUrl(paperId, engine, force));
      eventSourceRef.current = es;

      es.addEventListener('snapshot', (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as { paper: PaperDocument };
          setPaper(data.paper);
          if (data.paper.sentences.length > 0) {
            setActiveSentenceId((cur) => cur || data.paper.sentences[0].id);
          }
        } catch {
          // ignore
        }
      });

      es.addEventListener('overview', (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as {
            overview: PaperOverview;
            ai_progress?: number;
            ai_model?: string | null;
          };
          setPaper((prev) =>
            prev && prev.paper_id === paperId
              ? {
                  ...prev,
                  overview: data.overview,
                  ai_progress: data.ai_progress ?? prev.ai_progress,
                  ai_model: data.ai_model || prev.ai_model,
                }
              : prev
          );
        } catch {
          // ignore
        }
      });

      es.addEventListener('title', (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as { title: string };
          if (data.title) {
            setPaper((prev) => (prev ? { ...prev, title: data.title } : prev));
          }
        } catch {
          // ignore
        }
      });

      es.addEventListener('model_info', (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as {
            engine: string;
            model: string;
          };
          if (data.model) {
            setPaper((prev) => (prev ? { ...prev, ai_model: data.model } : prev));
            setEngines((prev) =>
              prev.map((eng) =>
                eng.id === data.engine
                  ? { ...eng, active_model: data.model, detected_model: data.model }
                  : eng
              )
            );
          }
        } catch {
          // ignore
        }
      });

      es.addEventListener('status', (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data);
          if (data.current_section) setStreamingSection(data.current_section);
          setPaper((prev) =>
            prev
              ? {
                  ...prev,
                  ai_status: data.ai_status || 'streaming',
                  ai_progress:
                    typeof data.ai_progress === 'number' ? data.ai_progress : prev.ai_progress,
                }
              : prev
          );
        } catch {
          // ignore
        }
      });

      es.addEventListener('sentence', (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as {
            sentence: SentenceItem;
            sections: string[];
            ai_progress: number;
            ai_engine?: string;
            ai_model?: string;
            current_section?: string;
          };
          if (data.current_section) {
            setStreamingSection(data.current_section);
          }
          setPaper((prev) => {
            if (!prev || prev.paper_id !== paperId) return prev;
            const exists = prev.sentences.some((s) => s.id === data.sentence.id);
            const nextSentences = exists
              ? prev.sentences.map((s) => (s.id === data.sentence.id ? data.sentence : s))
              : [...prev.sentences, data.sentence];
            return {
              ...prev,
              sections: data.sections || prev.sections,
              sentences: nextSentences,
              ai_status: 'streaming',
              ai_progress: data.ai_progress ?? prev.ai_progress,
              ai_engine: data.ai_engine || prev.ai_engine,
              ai_model: data.ai_model || prev.ai_model,
            };
          });
          if (data.sentence.index === 0) {
            setActiveSentenceId((cur) => cur || data.sentence.id);
          }
        } catch {
          // ignore
        }
      });

      es.addEventListener('paused', (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data);
          setPaper((prev) =>
            prev
              ? {
                  ...prev,
                  ai_status: 'paused',
                  ai_progress: data.ai_progress ?? prev.ai_progress,
                }
              : prev
          );
        } catch {
          // ignore
        }
        closeStream();
      });

      es.addEventListener('complete', () => {
        setPaper((prev) =>
          prev ? { ...prev, ai_status: 'completed', ai_progress: 100 } : prev
        );
        fetchPapersList()
          .then(setRecentPapers)
          .catch(() => {});
        closeStream();
      });

      es.addEventListener('stream_error', (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data);
          setPaper((prev) =>
            prev
              ? {
                  ...prev,
                  ai_status: 'error',
                  ai_error: data.detail || '스트리밍 번역 실패',
                }
              : prev
          );
        } catch {
          // ignore
        }
        closeStream();
      });

      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) {
          closeStream();
        }
      };
    },
    [closeStream]
  );

  const applyLoadedBundle = useCallback(
    (bundle: LoadedPaperBundle) => {
      closeStream();
      setPaper(bundle.paper);
      setCitationSummaries(bundle.citation_summaries || {});
      setCitationMetaCache({});
      setCitSummaryErrors({});
      setActiveCitationKey(null);
      setActiveSentenceId(bundle.paper.sentences[0]?.id || null);
      setGlobalError(null);

      const url = new URL(window.location.href);
      url.searchParams.delete('import');
      url.searchParams.set('paperId', bundle.paper.paper_id);
      window.history.replaceState({}, '', url.toString());

      fetchPapersList()
        .then(setRecentPapers)
        .catch(() => {});

      if (
        bundle.paper.ai_status === 'pending' ||
        bundle.paper.ai_status === 'streaming' ||
        bundle.paper.sentences.length === 0
      ) {
        startPaperStream(bundle.paper.paper_id, selectedEngineRef.current, false);
      } else if (!bundle.paper.overview) {
        triggerPaperOverview(bundle.paper.paper_id, selectedEngineRef.current, false);
      }
    },
    [closeStream, startPaperStream, triggerPaperOverview]
  );

  const openPaperById = useCallback(
    async (paperId: string) => {
      setLoadingPaper(true);
      setGlobalError(null);
      try {
        const bundle = await fetchPaperBundle(paperId);
        applyLoadedBundle(bundle);
      } catch (err: any) {
        setGlobalError(err?.message || '논문을 불러오지 못했습니다.');
      } finally {
        setLoadingPaper(false);
      }
    },
    [applyLoadedBundle]
  );

  const handleImportUrl = useCallback(
    async (targetUrl?: string) => {
      const val = (targetUrl ?? arxivInput).trim();
      if (!val) return;
      setLoadingPaper(true);
      setGlobalError(null);
      try {
        const bundle = await importPaperUrl(val);
        setArxivInput('');
        applyLoadedBundle(bundle);
      } catch (err: any) {
        setGlobalError(err?.message || 'URL/arXiv 논문을 가져오지 못했습니다.');
      } finally {
        setLoadingPaper(false);
      }
    },
    [arxivInput, applyLoadedBundle]
  );

  // Initial bootstrap: models catalog, recent papers, URL ?paperId= or ?import=, and VS Code bridge
  useEffect(() => {
    fetchModelsCatalog(false)
      .then(({ engines: list, catalog }) => {
        setEngines(list);
        setModelsCatalog(catalog);
        const preferred = list.find((e) => e.available);
        if (preferred) {
          setSelectedEngine(preferred.id);
          selectedEngineRef.current = preferred.id;
        }
      })
      .catch(() => {});

    loadUsageStatus(false);
    fetchQueueState()
      .then(setQueueState)
      .catch(() => {});

    fetchPapersList()
      .then((list) => {
        setRecentPapers(list);
        const params = new URLSearchParams(window.location.search);
        const qImport = params.get('import');
        const qPaperId = params.get('paperId');
        if (qImport) {
          handleImportUrl(qImport);
        } else if (qPaperId) {
          openPaperById(qPaperId);
        }
      })
      .catch(() => {});

    const onMessage = (ev: MessageEvent) => {
      if (ev.data?.type === 'paperview:loadPaperId' && ev.data.paperId) {
        openPaperById(String(ev.data.paperId));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [openPaperById, handleImportUrl]);

  // Split pane & Chat panel resize handlers
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (splitDraggingRef.current) {
        const pct = (e.clientX / window.innerWidth) * 100;
        setLeftRatio(Math.max(24, Math.min(68, pct)));
      } else if (chatDraggingRef.current) {
        const rawW = Math.round(window.innerWidth - e.clientX);
        const maxChat = Math.min(920, Math.floor(window.innerWidth * 0.72));
        const clamped = Math.max(280, Math.min(maxChat, rawW));
        setChatWidth(clamped);
      }
    };
    const onUp = () => {
      if (chatDraggingRef.current) {
        try {
          localStorage.setItem('paperview_chat_width', String(chatWidthRef.current));
        } catch {
          // ignore
        }
      }
      splitDraggingRef.current = false;
      chatDraggingRef.current = false;
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const handleRefreshModelsCatalog = async () => {
    setRefreshingModels(true);
    try {
      const { engines: list, catalog } = await fetchModelsCatalog(true);
      setEngines(list);
      setModelsCatalog(catalog);
    } catch (err: any) {
      setGlobalError(err?.message || '모델 목록 조회 실패');
    } finally {
      setRefreshingModels(false);
    }
  };

  const handleApplyEngineSettings = async (payload: Parameters<typeof updateEngineSettings>[0]) => {
    try {
      const { engines: list, catalog } = await updateEngineSettings(payload);
      setEngines(list);
      setModelsCatalog(catalog);
    } catch (err: any) {
      setGlobalError(err?.message || '모델 설정 저장 실패');
    }
  };

  const handleFileSelected = async (file: File) => {
    setLoadingPaper(true);
    setGlobalError(null);
    try {
      const bundle = await uploadPaperFile(file);
      applyLoadedBundle(bundle);
    } catch (err: any) {
      setGlobalError(err?.message || 'PDF 업로드 중 오류가 발생했습니다.');
    } finally {
      setLoadingPaper(false);
    }
  };

  const handlePauseStream = async () => {
    if (!paper) return;
    closeStream();
    try {
      const res = await stopPaperStream(paper.paper_id);
      setPaper(res.paper);
    } catch {
      setPaper((prev) => (prev ? { ...prev, ai_status: 'paused' } : prev));
    }
  };

  const handleResumeStream = () => {
    if (!paper) return;
    startPaperStream(paper.paper_id, selectedEngine, false);
  };

  const handleRestartStream = () => {
    if (!paper) return;
    startPaperStream(paper.paper_id, selectedEngine, true);
  };

  const handleSelectFromPdf = useCallback((sent: SentenceItem) => {
    setActiveSentenceId(sent.id);
    setReaderScrollSignal((n) => n + 1);
  }, []);

  const handleSelectFromReader = useCallback((sent: SentenceItem) => {
    setActiveSentenceId(sent.id);
    setPdfScrollSignal((n) => n + 1);
  }, []);

  const openCitationDrawerByRefKey = useCallback(
    async (targetPaperId: string, refKey: string) => {
      setActiveCitationKey(refKey);
      setCitMetaError(null);
      // Mark alert as read when user opens this citation
      const jobId = `${targetPaperId}:${refKey}`;
      setSummaryAlerts((prev) =>
        prev.map((a) =>
          a.id === jobId ? { ...a, unread: false, toastVisible: false } : a
        )
      );

      if (citationMetaCache[refKey]) {
        return;
      }

      setLoadingCitMeta(true);
      try {
        const meta = await fetchCitationMetadata(targetPaperId, refKey);
        setCitationMetaCache((prev) => ({ ...prev, [refKey]: meta }));
        if (meta.cached_summary) {
          setCitationSummaries((prev) => ({ ...prev, [refKey]: meta.cached_summary! }));
        }
      } catch (err: any) {
        setCitMetaError(err?.message || '인용 서지 정보를 가져오지 못했습니다.');
      } finally {
        setLoadingCitMeta(false);
      }
    },
    [citationMetaCache]
  );

  // Stage 1: Click inline citation -> fetch metadata ONLY
  const handleClickCitation = async (refKey: string, sent: SentenceItem) => {
    if (!paper) return;
    setActiveSentenceId(sent.id);
    await openCitationDrawerByRefKey(paper.paper_id, refKey);
  };

  // Stage 2: Background-capable citation summarization + Top-Right completion notification!
  const handleRequestCitationSummary = async (force = false) => {
    if (!paper || !activeCitationKey) return;
    const targetPaperId = paper.paper_id;
    const targetRefKey = activeCitationKey;
    const jobId = `${targetPaperId}:${targetRefKey}`;
    const citedTitle =
      citationMetaCache[targetRefKey]?.title || `[${targetRefKey}]번 인용 논문`;

    if (summarizingKeys.has(jobId) && !force) return;

    setSummarizingKeys((prev) => new Set(prev).add(jobId));
    setCitSummaryErrors((prev) => {
      const next = { ...prev };
      delete next[jobId];
      return next;
    });

    setSummaryAlerts((prev) => {
      const filtered = prev.filter((a) => a.id !== jobId);
      return [
        {
          id: jobId,
          paperId: targetPaperId,
          refKey: targetRefKey,
          paperTitle: citedTitle,
          status: 'running',
          unread: false,
          toastVisible: false,
        },
        ...filtered,
      ];
    });

    try {
      const sum = await summarizeCitation(
        targetPaperId,
        targetRefKey,
        selectedEngine,
        force
      );

      if (paperRef.current?.paper_id === targetPaperId) {
        setCitationSummaries((prev) => ({ ...prev, [targetRefKey]: sum }));
        fetchCitationMetadata(targetPaperId, targetRefKey)
          .then((freshMeta) => {
            if (paperRef.current?.paper_id === targetPaperId) {
              setCitationMetaCache((prev) => ({ ...prev, [targetRefKey]: freshMeta }));
            }
          })
          .catch(() => {});
      }

      const isCurrentlyViewingSameCitation =
        paperRef.current?.paper_id === targetPaperId &&
        activeCitationKeyRef.current === targetRefKey;

      setSummaryAlerts((prev) =>
        prev.map((a) =>
          a.id === jobId
            ? {
                ...a,
                status: 'done',
                unread: !isCurrentlyViewingSameCitation,
                toastVisible: true,
              }
            : a
        )
      );
    } catch (err: any) {
      const msg = err?.message || '인용 논문 요약 생성에 실패했습니다.';
      setCitSummaryErrors((prev) => ({ ...prev, [jobId]: msg }));
      setSummaryAlerts((prev) =>
        prev.map((a) =>
          a.id === jobId
            ? {
                ...a,
                status: 'error',
                unread: true,
                toastVisible: true,
                errorMsg: msg,
              }
            : a
        )
      );
    } finally {
      setSummarizingKeys((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
    }
  };

  const handleJumpToSentenceById = (sentenceId: string) => {
    if (!paper) return;
    const found = paper.sentences.find((s) => s.id === sentenceId);
    if (!found) return;
    setActiveSentenceId(found.id);
    setReaderScrollSignal((n) => n + 1);
    setPdfScrollSignal((n) => n + 1);
  };

  const activeEngineInfo = engines.find((e) => e.id === selectedEngine);
  const currentModelDisplay =
    activeEngineInfo?.active_model || activeEngineInfo?.configured_model || '';
  const currentEffortDisplay = activeEngineInfo?.reasoning_effort || 'low';

  const activeQueueCount = queueState.items.filter((it) =>
    ['queued', 'running', 'waiting_quota'].includes(it.status)
  ).length;

  useEffect(() => {
    if (!showQueueModal && activeQueueCount === 0 && !queueState.scheduled_time_label) {
      return;
    }
    const timer = window.setInterval(() => {
      fetchQueueState()
        .then((next) => {
          setQueueState(next);
          fetchPapersList()
            .then(setRecentPapers)
            .catch(() => {});
        })
        .catch(() => {});
    }, 3000);
    return () => window.clearInterval(timer);
  }, [showQueueModal, activeQueueCount, queueState.scheduled_time_label]);
  const runningAlertsCount = summaryAlerts.filter((a) => a.status === 'running').length;
  const unreadAlertsCount = summaryAlerts.filter((a) => a.unread).length;
  const visibleToasts = summaryAlerts.filter((a) => a.toastVisible);

  const activeJobId =
    paper && activeCitationKey ? `${paper.paper_id}:${activeCitationKey}` : '';

  return (
    <div
      className="app-shell"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingFile(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsDraggingFile(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDraggingFile(false);
        const f = e.dataTransfer.files?.[0];
        if (f && f.name.toLowerCase().endsWith('.pdf')) {
          handleFileSelected(f);
        }
      }}
    >
      {isDraggingFile && (
        <div className="drop-overlay">
          <div className="drop-box">
            <Upload size={36} />
            <p>여기에 논문 PDF 파일을 놓으면 AI 섹션 분리 및 실시간 번역이 시작됩니다</p>
          </div>
        </div>
      )}

      {/* Top Header */}
      <header className="top-navbar">
        <div className="brand-group">
          <div
            className="brand-logo"
            onClick={() => {
              closeStream();
              setPaper(null);
            }}
            title="홈 화면으로 이동"
          >
            <Sparkles size={17} />
            <span>PaperView</span>
          </div>

          {paper && (
            <div className="current-paper-title" title={paper.title}>
              {paper.title}
            </div>
          )}
        </div>

        <div className="navbar-controls">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFileSelected(f);
              e.target.value = '';
            }}
          />

          <button
            type="button"
            className="nav-btn primary"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={14} />
            <span>PDF 열기</span>
          </button>

          <form
            className="arxiv-quick-form"
            onSubmit={(e) => {
              e.preventDefault();
              handleImportUrl();
            }}
          >
            <Globe size={13} className="muted-icon" />
            <input
              type="text"
              placeholder="arXiv ID 또는 PDF URL (예: 1706.03762)"
              value={arxivInput}
              onChange={(e) => setArxivInput(e.target.value)}
            />
            {arxivInput.trim() && (
              <button type="submit" className="mini-go-btn">
                열기
              </button>
            )}
          </form>

          {recentPapers.length > 0 && (
            <div className="library-dropdown-wrap">
              <button
                type="button"
                className="nav-btn"
                onClick={() => {
                  setShowLibraryMenu((v) => !v);
                  setShowModelMenu(false);
                  setShowAlertsTray(false);
                  setShowUsageMenu(false);
                }}
              >
                <BookMarked size={14} />
                <span>최근 ({recentPapers.length})</span>
              </button>

              {showLibraryMenu && (
                <div className="library-popover" onMouseLeave={() => setShowLibraryMenu(false)}>
                  <div className="lib-pop-header">최근 열어본 논문</div>
                  {recentPapers.map((item) => (
                    <button
                      key={item.paper_id}
                      type="button"
                      className={`lib-item-btn ${
                        paper?.paper_id === item.paper_id ? 'current' : ''
                      }`}
                      onClick={() => {
                        setShowLibraryMenu(false);
                        openPaperById(item.paper_id);
                      }}
                    >
                      <div className="lib-item-title">{item.title}</div>
                      <div className="lib-item-meta">
                        {item.page_count}p · {item.sentence_count}문장 · 인용{' '}
                        {item.reference_count}개
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="divider-v" />

          {/* Single Active Model Pill Button */}
          <div className="library-dropdown-wrap">
            {(() => {
              const info = engines.find((e) => e.id === selectedEngine);
              const available = info ? info.available : true;
              const needsKey = Boolean(info?.needs_key);
              const modelName =
                currentModelDisplay ||
                (selectedEngine === 'codex'
                  ? 'gpt-5.4'
                  : selectedEngine === 'antigravity'
                  ? 'gemini-2.5-flash'
                  : 'opus[1m]');

              return (
                <button
                  type="button"
                  className={`nav-btn single-active-model-btn ${selectedEngine}`}
                  title={info?.detail || `현재 모델: ${modelName} (${currentEffortDisplay})`}
                  onClick={() => {
                    setModelMenuTab(
                      selectedEngine === 'codex'
                        ? 'codex'
                        : selectedEngine === 'antigravity'
                        ? 'antigravity'
                        : 'claude'
                    );
                    setShowModelMenu((v) => !v);
                    setShowLibraryMenu(false);
                    setShowAlertsTray(false);
                    setShowUsageMenu(false);
                  }}
                >
                  <span
                    className={`status-dot ${
                      available ? 'on' : needsKey ? 'warn' : 'off'
                    }`}
                  />
                  <Cpu size={13} className="muted-icon" />
                  <strong className="single-model-id">{modelName}</strong>
                  {currentEffortDisplay && (
                    <span className="model-sub-pill">{currentEffortDisplay}</span>
                  )}
                  <ChevronDown size={12} style={{ opacity: 0.65 }} />
                </button>
              );
            })()}

            {showModelMenu && modelsCatalog && (
              <div className="library-popover model-catalog-popover">
                <div className="model-pop-topbar">
                  <div className="model-pop-tabs">
                    <button
                      type="button"
                      className={`model-tab-btn ${modelMenuTab === 'claude' ? 'active' : ''}`}
                      onClick={() => {
                        setModelMenuTab('claude');
                        const cInfo = engines.find((e) => e.id === 'claude');
                        if (cInfo?.available) setSelectedEngine('claude');
                      }}
                    >
                      Claude ({modelsCatalog.claude.models.length})
                    </button>
                    {modelsCatalog.codex && (
                      <button
                        type="button"
                        className={`model-tab-btn ${modelMenuTab === 'codex' ? 'active' : ''}`}
                        onClick={() => {
                          setModelMenuTab('codex');
                          const cxInfo = engines.find((e) => e.id === 'codex');
                          if (cxInfo?.available) setSelectedEngine('codex');
                        }}
                      >
                        Codex ({modelsCatalog.codex.models.length})
                      </button>
                    )}
                    <button
                      type="button"
                      className={`model-tab-btn ${
                        modelMenuTab === 'antigravity' ? 'active' : ''
                      }`}
                      onClick={() => {
                        setModelMenuTab('antigravity');
                        const aInfo = engines.find((e) => e.id === 'antigravity');
                        if (aInfo?.available) setSelectedEngine('antigravity');
                      }}
                    >
                      Antigravity ({modelsCatalog.antigravity.models.length})
                    </button>
                  </div>
                  <div className="row-center">
                    <button
                      type="button"
                      className="icon-tiny-btn"
                      title="현재 PC의 사용 가능한 모델 목록 다시 조회"
                      onClick={handleRefreshModelsCatalog}
                    >
                      <RefreshCw size={12} className={refreshingModels ? 'spin' : ''} />
                    </button>
                    <button
                      type="button"
                      className="icon-tiny-btn"
                      title="닫기"
                      onClick={() => setShowModelMenu(false)}
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>

                {modelMenuTab === 'claude' ? (
                  <div className="model-pop-body">
                    <div className="claude-model-kv">
                      <div>
                        <span>현재 선택/설정 모델:</span>
                        <strong>{modelsCatalog.claude.effective_model}</strong>
                      </div>
                      {modelsCatalog.claude.detected_model && (
                        <div>
                          <span>최근 실제 API 응답 ID:</span>
                          <code>{modelsCatalog.claude.detected_model}</code>
                        </div>
                      )}
                    </div>

                    <div className="lib-pop-header">추론 성능 (Reasoning Effort)</div>
                    <div className="effort-pills-grid">
                      {modelsCatalog.claude.efforts.map((eff) => {
                        const active = modelsCatalog.claude.selected_effort === eff.id;
                        return (
                          <button
                            key={eff.id}
                            type="button"
                            className={`effort-choice-btn ${active ? 'active' : ''}`}
                            title={eff.desc}
                            onClick={() =>
                              handleApplyEngineSettings({ claude_effort: eff.id })
                            }
                          >
                            <strong>{eff.id.toUpperCase()}</strong>
                            <span>{eff.desc}</span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="lib-pop-header">
                      사용 가능한 Claude 모델 선택 ({modelsCatalog.claude.models.length}개 조회됨)
                    </div>
                    <div className="models-scroll-list">
                      {groupModels(modelsCatalog.claude.models).map((grp) => (
                        <div key={grp.group} className="model-group-sec">
                          <div className="model-group-label">{grp.group}</div>
                          {grp.items.map((m) => {
                            const isCur = modelsCatalog.claude.selected_model === m.id;
                            return (
                              <button
                                key={m.id || '__default__'}
                                type="button"
                                className={`model-row-btn ${isCur ? 'current' : ''}`}
                                onClick={() => {
                                  setSelectedEngine('claude');
                                  handleApplyEngineSettings({
                                    claude_model_override: m.id,
                                  });
                                }}
                              >
                                <span>{m.label}</span>
                                {isCur && <CheckCircle2 size={14} className="check-accent" />}
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : modelMenuTab === 'codex' && modelsCatalog.codex ? (
                  <div className="model-pop-body">
                    <div className="claude-model-kv">
                      <div>
                        <span>현재 선택/설정 모델:</span>
                        <strong>{modelsCatalog.codex.effective_model}</strong>
                      </div>
                      <div>
                        <span>인증 방식:</span>
                        <span className="usage-zero-api">ChatGPT 로그인 (API 과금 차단)</span>
                      </div>
                    </div>

                    <div className="lib-pop-header">추론 성능 (Reasoning Effort)</div>
                    <div className="effort-pills-grid">
                      {modelsCatalog.codex.efforts.map((eff) => {
                        const active = modelsCatalog.codex.selected_effort === eff.id;
                        return (
                          <button
                            key={eff.id}
                            type="button"
                            className={`effort-choice-btn ${active ? 'active' : ''}`}
                            title={eff.desc}
                            onClick={() =>
                              handleApplyEngineSettings({ codex_effort: eff.id })
                            }
                          >
                            <strong>{eff.id.toUpperCase()}</strong>
                            <span>{eff.desc}</span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="lib-pop-header">
                      사용 가능한 OpenAI Codex 모델 선택 ({modelsCatalog.codex.models.length}개)
                    </div>
                    <div className="models-scroll-list">
                      {groupModels(modelsCatalog.codex.models).map((grp) => (
                        <div key={grp.group} className="model-group-sec">
                          <div className="model-group-label">{grp.group}</div>
                          {grp.items.map((m) => {
                            const isCur = modelsCatalog.codex.selected_model === m.id;
                            return (
                              <button
                                key={m.id || '__codex_default__'}
                                type="button"
                                className={`model-row-btn ${isCur ? 'current' : ''}`}
                                onClick={() => {
                                  const cxInfo = engines.find((e) => e.id === 'codex');
                                  if (cxInfo?.available) setSelectedEngine('codex');
                                  handleApplyEngineSettings({ codex_model: m.id });
                                }}
                              >
                                <span>{m.label}</span>
                                {isCur && <CheckCircle2 size={14} className="check-accent" />}
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="model-pop-body">
                    {engines.find((e) => e.id === 'antigravity')?.needs_key && (
                      <div className="agy-inline-key-box">
                        <p className="agy-pop-desc">
                          <code>GEMINI_API_KEY</code>를 등록하면 실시간 API 모델 조회 및 Antigravity
                          SDK 실행이 활성화됩니다.
                        </p>
                        <form
                          className="hero-url-form"
                          onSubmit={async (e) => {
                            e.preventDefault();
                            if (!geminiKeyInput.trim()) return;
                            await handleApplyEngineSettings({
                              gemini_api_key: geminiKeyInput.trim(),
                            });
                            setSelectedEngine('antigravity');
                            setGeminiKeyInput('');
                          }}
                        >
                          <input
                            type="password"
                            placeholder="GEMINI_API_KEY 붙여넣기"
                            value={geminiKeyInput}
                            onChange={(e) => setGeminiKeyInput(e.target.value)}
                          />
                          <button type="submit">연결</button>
                        </form>
                      </div>
                    )}

                    <div className="lib-pop-header">추론 성능 (Thinking Level)</div>
                    <div className="effort-pills-grid">
                      {modelsCatalog.antigravity.efforts.map((eff) => {
                        const active = modelsCatalog.antigravity.selected_effort === eff.id;
                        return (
                          <button
                            key={eff.id}
                            type="button"
                            className={`effort-choice-btn ${active ? 'active' : ''}`}
                            title={eff.desc}
                            onClick={() =>
                              handleApplyEngineSettings({
                                antigravity_thinking_level: eff.id,
                              })
                            }
                          >
                            <strong>{eff.id.toUpperCase()}</strong>
                            <span>{eff.desc}</span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="lib-pop-header">
                      사용 가능한 Antigravity 모델 ({modelsCatalog.antigravity.models.length}개)
                    </div>
                    <div className="models-scroll-list">
                      {groupModels(modelsCatalog.antigravity.models).map((grp) => (
                        <div key={grp.group} className="model-group-sec">
                          <div className="model-group-label">{grp.group}</div>
                          {grp.items.map((m) => {
                            const isCur = modelsCatalog.antigravity.selected_model === m.id;
                            return (
                              <button
                                key={m.id}
                                type="button"
                                className={`model-row-btn ${isCur ? 'current' : ''}`}
                                onClick={() => {
                                  const aInfo = engines.find((e) => e.id === 'antigravity');
                                  if (aInfo?.available) setSelectedEngine('antigravity');
                                  handleApplyEngineSettings({
                                    antigravity_model: m.id,
                                  });
                                }}
                              >
                                <span>{m.label}</span>
                                {isCur && <CheckCircle2 size={14} className="check-accent" />}
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Subscription Remaining Quota / Usage Check Popover */}
          <div className="library-dropdown-wrap">
            {(() => {
              const sessionQuota =
                usageStatus?.quotas.find((q) => q.key === 'session') ||
                usageStatus?.quotas[0] ||
                null;
              const remPct = sessionQuota ? Math.round(sessionQuota.remaining_percent) : null;
              const levelClass =
                remPct === null
                  ? ''
                  : remPct >= 40
                  ? 'good'
                  : remPct >= 15
                  ? 'warn'
                  : 'low';

              return (
                <>
                  <button
                    type="button"
                    className={`nav-btn usage-pill-btn ${levelClass}`}
                    title="구독 사용량 및 남은 한도 확인"
                    onClick={() => {
                      const next = !showUsageMenu;
                      setShowUsageMenu(next);
                      setShowModelMenu(false);
                      setShowLibraryMenu(false);
                      setShowAlertsTray(false);
                      if (next) {
                        loadUsageStatus(false);
    fetchQueueState()
      .then(setQueueState)
      .catch(() => {});
                      }
                    }}
                  >
                    {refreshingUsage && !usageStatus ? (
                      <div className="spinner-ring tiny" />
                    ) : (
                      <Activity size={13} />
                    )}
                    <span>
                      {remPct !== null ? `남은 한도 ${remPct}%` : '사용량 확인'}
                    </span>
                  </button>

                  {showUsageMenu && (
                    <div className="library-popover usage-popover">
                      <div className="alerts-tray-header">
                        <span>AI 구독 사용량 · 남은 한도</span>
                        <div className="row-center" style={{ gap: 4 }}>
                          <button
                            type="button"
                            className="icon-tiny-btn"
                            title="실시간 남은 사용량 새로고침 (토큰 소모 없음)"
                            onClick={() => loadUsageStatus(true)}
                          >
                            <RefreshCw
                              size={12}
                              className={refreshingUsage ? 'spin' : ''}
                            />
                          </button>
                          <button
                            type="button"
                            className="icon-tiny-btn"
                            title="닫기"
                            onClick={() => setShowUsageMenu(false)}
                          >
                            <X size={13} />
                          </button>
                        </div>
                      </div>

                      <div className="usage-pop-body">
                        <div className="usage-sub-banner">
                          <div className="usage-sub-top">
                            <span className="usage-plan-badge">
                              Claude{' '}
                              {usageStatus?.subscription_type
                                ? usageStatus.subscription_type.toUpperCase()
                                : '구독'}{' '}
                              세션
                            </span>
                            <span className="usage-zero-api">API 종량제 과금 없음</span>
                          </div>
                          {usageStatus?.email && (
                            <div className="usage-email-line">{usageStatus.email}</div>
                          )}
                        </div>

                        {usageStatus?.quotas && usageStatus.quotas.length > 0 ? (
                          <div className="usage-quotas-list">
                            {usageStatus.quotas.map((q) => {
                              const rem = Math.round(q.remaining_percent);
                              const used = Math.round(q.used_percent);
                              const barState =
                                rem >= 40 ? 'good' : rem >= 15 ? 'warn' : 'low';
                              return (
                                <div key={q.key} className="usage-quota-card">
                                  <div className="usage-quota-head">
                                    <span className="usage-quota-label">{q.label}</span>
                                    <strong className={`usage-rem-badge ${barState}`}>
                                      {rem}% 남음
                                    </strong>
                                  </div>
                                  <div className="usage-bar-track">
                                    <div
                                      className={`usage-bar-fill ${barState}`}
                                      style={{ width: `${Math.max(2, rem)}%` }}
                                    />
                                  </div>
                                  <div className="usage-quota-foot">
                                    <span>{used}% 사용됨</span>
                                    {q.resets_at && <span>초기화: {q.resets_at}</span>}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : refreshingUsage ? (
                          <div className="alerts-empty">
                            로컬 Claude CLI에서 남은 한도를 조회하는 중입니다...
                          </div>
                        ) : (
                          <div className="alerts-empty">
                            {usageStatus?.error ||
                              '새로고침 버튼을 눌러 현재 구독 세션의 남은 한도를 조회하세요.'}
                          </div>
                        )}

                        {usageStatus?.activity_lines &&
                          usageStatus.activity_lines.length > 0 && (
                            <div className="usage-activity-box">
                              <div className="usage-activity-title">로컬 CLI 최근 사용 통계</div>
                              {usageStatus.activity_lines.map((ln, idx) => (
                                <div key={idx} className="usage-activity-line">
                                  {ln}
                                </div>
                              ))}
                            </div>
                          )}

                        <div className="usage-footer-meta">
                          <span>
                            이번 실행 요청 {usageStatus?.local_session_requests ?? 0}회
                          </span>
                          {usageStatus?.checked_at && (
                            <span>조회 시각 {usageStatus.checked_at}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>

          {/* Overnight / Batch Translation Queue Button */}
          <button
            type="button"
            className={`nav-btn ${activeQueueCount > 0 ? 'has-unread' : ''}`}
            title="여러 논문을 걸어두고 순차·예약 자동 번역하기"
            onClick={() => {
              setShowQueueModal(true);
              setShowModelMenu(false);
              setShowLibraryMenu(false);
              setShowAlertsTray(false);
              setShowUsageMenu(false);
              fetchQueueState()
                .then(setQueueState)
                .catch(() => {});
            }}
          >
            {queueState.is_worker_busy ? (
              <div className="spinner-ring tiny" />
            ) : queueState.scheduled_time_label ? (
              <Clock size={14} />
            ) : (
              <ListChecks size={14} />
            )}
            <span>번역 큐</span>
            {activeQueueCount > 0 && (
              <span className="alert-count-badge">{activeQueueCount}</span>
            )}
          </button>

          {/* Top-Right Citation Summary Notification Toggle */}
          <div className="library-dropdown-wrap">
            <button
              type="button"
              className={`nav-btn alert-toggle-btn ${
                unreadAlertsCount > 0 ? 'has-unread' : ''
              }`}
              title="인용 논문 백그라운드 요약 진행 및 완료 알림 토글"
              onClick={() => {
                setShowAlertsTray((v) => !v);
                setShowModelMenu(false);
                setShowLibraryMenu(false);
                setShowUsageMenu(false);
              }}
            >
              {runningAlertsCount > 0 ? (
                <div className="spinner-ring small" />
              ) : (
                <Bell size={14} />
              )}
              <span>요약 알림</span>
              {(unreadAlertsCount > 0 || runningAlertsCount > 0) && (
                <span className="alert-count-badge">
                  {unreadAlertsCount > 0 ? unreadAlertsCount : runningAlertsCount}
                </span>
              )}
            </button>

            {showAlertsTray && (
              <div className="library-popover alerts-tray-popover">
                <div className="alerts-tray-header">
                  <span>인용 논문 요약 알림</span>
                  <button
                    type="button"
                    className="icon-tiny-btn"
                    onClick={() => setShowAlertsTray(false)}
                  >
                    <X size={13} />
                  </button>
                </div>

                {summaryAlerts.length === 0 ? (
                  <div className="alerts-empty">
                    인용 번호 클릭 후 [간단 요약 보기]를 누르면 창을 닫아도 이곳에서 완료 알림을
                    확인할 수 있습니다.
                  </div>
                ) : (
                  <div className="alerts-list">
                    {summaryAlerts.map((item) => (
                      <div
                        key={item.id}
                        className={`alert-tray-item ${item.unread ? 'unread' : ''}`}
                      >
                        <div className="alert-item-main">
                          {item.status === 'running' ? (
                            <span className="alert-status running">
                              <span className="spinner-ring tiny" /> [{item.refKey}]번 논문 요약 중...
                            </span>
                          ) : item.status === 'done' ? (
                            <span className="alert-status done">
                              ✨ [{item.refKey}]번 논문 요약이 완성되었어요
                            </span>
                          ) : (
                            <span className="alert-status err">
                              [{item.refKey}]번 논문 요약 실패
                            </span>
                          )}
                          <div className="alert-paper-sub">{item.paperTitle}</div>
                        </div>

                        {item.status === 'done' && (
                          <button
                            type="button"
                            className="alert-open-btn"
                            onClick={async () => {
                              setShowAlertsTray(false);
                              if (paper?.paper_id !== item.paperId) {
                                await openPaperById(item.paperId);
                              }
                              openCitationDrawerByRefKey(item.paperId, item.refKey);
                            }}
                          >
                            보기
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {paper && (
            <>
              <button
                type="button"
                className={`nav-btn ${showChatPanel ? 'primary' : ''}`}
                title="현재 논문에 대해 AI와 대화하기"
                onClick={() => setShowChatPanel((v) => !v)}
              >
                <MessageSquare size={14} />
                <span>논문 채팅</span>
              </button>

              <button
                type="button"
                className={`icon-btn ${showPdfPane ? 'active-icon' : ''}`}
                title={showPdfPane ? '좌측 PDF 패널 숨기기' : '좌측 PDF 패널 보이기'}
                onClick={() => setShowPdfPane((v) => !v)}
              >
                <Columns size={16} />
              </button>
            </>
          )}

          <button
            type="button"
            className="icon-btn"
            title={darkMode ? '라이트 모드로 전환' : '다크 모드로 전환'}
            onClick={() => setDarkMode((v) => !v)}
          >
            {darkMode ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>

      {/* Floating Top-Right Completion Toasts (shown even when citation drawer is closed!) */}
      {(visibleToasts.length > 0 || (runningAlertsCount > 0 && !activeCitationKey)) && (
        <div className="topright-toast-stack">
          {runningAlertsCount > 0 && !activeCitationKey && (
            <button
              type="button"
              className="running-bg-pill"
              onClick={() => setShowAlertsTray((v) => !v)}
            >
              <div className="spinner-ring tiny" />
              <span>백그라운드 인용 요약 진행 중 ({runningAlertsCount}건)</span>
            </button>
          )}

          {visibleToasts.map((t) => (
            <div key={t.id} className={`summary-ready-toast ${t.status}`}>
              <div className="toast-content">
                <strong>
                  {t.status === 'done'
                    ? `[${t.refKey}]번 논문 요약이 완성되었어요!`
                    : `[${t.refKey}]번 논문 요약 오류`}
                </strong>
                <p>{t.status === 'done' ? t.paperTitle : t.errorMsg}</p>
              </div>
              <div className="toast-actions">
                {t.status === 'done' && (
                  <button
                    type="button"
                    className="toast-view-btn"
                    onClick={async () => {
                      if (paper?.paper_id !== t.paperId) {
                        await openPaperById(t.paperId);
                      }
                      openCitationDrawerByRefKey(t.paperId, t.refKey);
                    }}
                  >
                    열기
                  </button>
                )}
                <button
                  type="button"
                  className="toast-dismiss-btn"
                  onClick={() =>
                    setSummaryAlerts((prev) =>
                      prev.map((a) =>
                        a.id === t.id ? { ...a, toastVisible: false } : a
                      )
                    )
                  }
                  title="알림 닫기"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {globalError && (
        <div className="global-error-banner">
          <div className="row-center">
            <AlertCircle size={15} />
            <span>{globalError}</span>
          </div>
          <button type="button" onClick={() => setGlobalError(null)}>
            닫기
          </button>
        </div>
      )}

      {/* Main Content */}
      {loadingPaper ? (
        <div className="center-loading-screen">
          <div className="spinner-ring large" />
          <h3>논문 PDF 및 Figure · Table 구조를 분석하는 중입니다...</h3>
          <p>곧바로 AI 섹션 분리와 실시간 번역이 시작됩니다</p>
        </div>
      ) : !paper ? (
        <main className="welcome-landing">
          <div className="welcome-hero-card">
            <div className="hero-badge">AI 핵심 요약 · 1단/2단 레이아웃 &amp; 표·그림 자동 인식 · 실시간 번역</div>
            <h1>논문을 넣으면 AI가 핵심 요약과 섹션별 전문 번역을 실시간으로 보여줍니다</h1>
            <p className="hero-sub">
              <strong>1단(NeurIPS·ICLR) 및 2단(IEEE·CVPR) 컬럼</strong>과 <strong>Figure · Table</strong>을
              페이지별로 자동 감지하고, 인용 논문은 arXiv 우선 탐색 및 백그라운드 요약을 제공합니다.
            </p>

            <div className="hero-actions-grid">
              <div
                className="upload-drop-card"
                onClick={() => fileInputRef.current?.click()}
              >
                <FileText size={32} className="accent-icon" />
                <h3>내 컴퓨터 PDF 논문 열기</h3>
                <p>클릭하여 선택하거나 PDF 파일을 화면 어디에나 드래그 앤 드롭하세요</p>
              </div>

              <div className="arxiv-import-card">
                <h3>arXiv ID 또는 URL로 바로 시작</h3>
                <form
                  className="hero-url-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleImportUrl();
                  }}
                >
                  <input
                    type="text"
                    placeholder="예: 1706.03762 또는 https://arxiv.org/abs/..."
                    value={arxivInput}
                    onChange={(e) => setArxivInput(e.target.value)}
                  />
                  <button type="submit">불러오기</button>
                </form>

                <div className="sample-presets">
                  <span>예시 논문 바로 열기:</span>
                  <button
                    type="button"
                    onClick={() => handleImportUrl('1706.03762')}
                  >
                    Attention Is All You Need
                  </button>
                  <button
                    type="button"
                    onClick={() => handleImportUrl('2005.11401')}
                  >
                    RAG (Lewis et al.)
                  </button>
                </div>
              </div>
            </div>

            {recentPapers.length > 0 && (
              <div className="welcome-recent-section">
                <h4>최근 열어본 논문</h4>
                <div className="recent-cards-grid">
                  {recentPapers.slice(0, 6).map((rp) => (
                    <button
                      key={rp.paper_id}
                      type="button"
                      className="recent-paper-card"
                      onClick={() => openPaperById(rp.paper_id)}
                    >
                      <div className="rp-title">{rp.title}</div>
                      <div className="rp-meta">
                        {rp.page_count}페이지 · {rp.sentence_count}문장 · 인용 {rp.reference_count}건
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </main>
      ) : (
        <main className="split-workspace">
          {showPdfPane && (
            <>
              <div
                className="split-left"
                style={{
                  width: showChatPanel
                    ? `min(${leftRatio}%, calc(100% - ${chatWidth + 280}px))`
                    : `${leftRatio}%`,
                }}
              >
                <PdfPane
                  pdfUrl={getPaperPdfUrl(paper.paper_id)}
                  sentences={paper.sentences}
                  activeSentenceId={activeSentenceId}
                  scrollSignal={pdfScrollSignal}
                  onSelectSentenceFromPdf={handleSelectFromPdf}
                />
              </div>

              <div
                className="split-resizer"
                onMouseDown={() => {
                  splitDraggingRef.current = true;
                  document.body.style.userSelect = 'none';
                }}
                title="드래그하여 좌우 화면 비율 조절"
              />
            </>
          )}

          <div className="split-right" style={{ flex: 1 }}>
            <ReaderPane
              overview={paper.overview || null}
              loadingOverview={loadingOverview}
              onRefreshOverview={() =>
                triggerPaperOverview(paper.paper_id, selectedEngine, true)
              }
              sections={paper.sections}
              sentences={paper.sentences}
              aiStatus={paper.ai_status}
              aiProgress={paper.ai_progress}
              aiModel={
                currentModelDisplay
                  ? `${currentModelDisplay} (${currentEffortDisplay})`
                  : paper.ai_model || null
              }
              aiError={paper.ai_error}
              streamingSection={streamingSection}
              activeSentenceId={activeSentenceId}
              scrollSignal={readerScrollSignal}
              activeCitationRefKey={activeCitationKey}
              onSelectSentenceFromReader={handleSelectFromReader}
              onClickCitation={handleClickCitation}
              onPauseStream={handlePauseStream}
              onResumeStream={handleResumeStream}
              onRestartStream={handleRestartStream}
            />

            {!showChatPanel && !activeCitationKey && (
              <button
                type="button"
                className="floating-chat-fab"
                onClick={() => setShowChatPanel(true)}
                title="현재 논문에 대해 AI와 채팅하기"
              >
                <MessageSquare size={16} />
                <span>논문 질문하기</span>
              </button>
            )}

            {activeCitationKey && (
              <CitationPopover
                refKey={activeCitationKey}
                metadata={citationMetaCache[activeCitationKey] || null}
                loadingMeta={loadingCitMeta}
                metaError={citMetaError}
                summary={citationSummaries[activeCitationKey] || null}
                loadingSummary={summarizingKeys.has(activeJobId)}
                summaryError={citSummaryErrors[activeJobId] || null}
                selectedEngine={selectedEngine}
                selectedModelLabel={
                  currentModelDisplay
                    ? `${currentModelDisplay} · ${currentEffortDisplay}`
                    : undefined
                }
                onClose={() => setActiveCitationKey(null)}
                onRequestSummary={handleRequestCitationSummary}
                onJumpToSentence={handleJumpToSentenceById}
              />
            )}
          </div>

          {showChatPanel && (
            <PaperChatDrawer
              paperId={paper.paper_id}
              paperTitle={paper.title}
              width={chatWidth}
              isWide={chatWidth >= 560}
              onStartResize={() => {
                chatDraggingRef.current = true;
                document.body.style.userSelect = 'none';
              }}
              onToggleWide={() => {
                const nextW = chatWidth >= 560 ? 400 : Math.min(640, Math.floor(window.innerWidth * 0.52));
                setChatWidth(nextW);
                try {
                  localStorage.setItem('paperview_chat_width', String(nextW));
                } catch {
                  // ignore
                }
              }}
              selectedEngine={selectedEngine}
              selectedModelLabel={
                currentModelDisplay
                  ? `${currentModelDisplay} · ${currentEffortDisplay}`
                  : undefined
              }
              activeSentence={
                paper.sentences.find((s) => s.id === activeSentenceId) || null
              }
              knownRefKeys={new Set(Object.keys(paper.references || {}))}
              onClose={() => setShowChatPanel(false)}
              onClickCitationInChat={(rk) =>
                openCitationDrawerByRefKey(paper.paper_id, rk)
              }
              onChatTurnCompleted={() => loadUsageStatus(true)}
            />
          )}
        </main>
      )}

      {showQueueModal && (
        <QueueModal
          queueState={queueState}
          selectedEngine={selectedEngine}
          selectedModelLabel={
            currentModelDisplay
              ? `${currentModelDisplay} (${currentEffortDisplay})`
              : undefined
          }
          currentPaperId={paper?.paper_id || null}
          currentPaperTitle={paper?.title || null}
          recentPapers={recentPapers}
          onQueueUpdated={(next) => {
            setQueueState(next);
            fetchPapersList()
              .then(setRecentPapers)
              .catch(() => {});
          }}
          onOpenPaper={(pid) => openPaperById(pid)}
          onClose={() => setShowQueueModal(false)}
        />
      )}
    </div>
  );
};
