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
  Languages,
} from 'lucide-react';
import {
  ensurePaperMediaInsights,
  fetchCitationMetadata,
  fetchModelsCatalog,
  fetchPaperBundle,
  fetchPapersList,
  fetchQueueState,
  fetchUsageStatus,
  generateMediaInsight,
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
import {
  detectInitialLang,
  getUiStrings,
  LANGUAGE_OPTIONS,
  type LangCode,
} from './i18n';
import type {
  AllModelsCatalog,
  CitationMetadataResponse,
  CitationSummaryResponse,
  EngineInfo,
  LoadedPaperBundle,
  ModelOptionItem,
  PaperDocument,
  PaperOverview,
  PaperResourceLink,
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

  const [lang, setLang] = useState<LangCode>(() => detectInitialLang());
  const langRef = useRef<LangCode>(lang);
  const [showLangMenu, setShowLangMenu] = useState<boolean>(false);
  const t = getUiStrings(lang);

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
  const [loadingInsightIds, setLoadingInsightIds] = useState<Set<string>>(new Set());
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
    langRef.current = lang;
    document.documentElement.lang = lang;
  }, [lang]);

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

  const handleGoHome = useCallback(() => {
    closeStream();
    setPaper(null);
    setActiveCitationKey(null);
    setShowChatPanel(false);
    setGlobalError(null);
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('paperId');
    cleanUrl.searchParams.delete('import');
    const nextHref = `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`;
    window.history.replaceState({}, '', nextHref || '/');
  }, [closeStream]);

  const handleRequestMediaInsight = useCallback(
    async (sentenceId: string, force = false) => {
      const curPaper = paperRef.current;
      if (!curPaper) return;
      const targetPaperId = curPaper.paper_id;
      const useLang = langRef.current;
      setLoadingInsightIds((prev) => new Set(prev).add(sentenceId));
      try {
        const res = await generateMediaInsight(
          targetPaperId,
          sentenceId,
          selectedEngineRef.current,
          force,
          useLang
        );
        if (paperRef.current?.paper_id === targetPaperId && langRef.current === useLang) {
          setPaper((prev) =>
            prev
              ? {
                  ...prev,
                  sentences: prev.sentences.map((s) =>
                    s.id === sentenceId ? { ...s, insight: res.insight } : s
                  ),
                }
              : prev
          );
        }
        loadUsageStatus(true);
      } catch (err: any) {
        setGlobalError(err?.message || 'Failed to generate figure insight.');
      } finally {
        setLoadingInsightIds((prev) => {
          const next = new Set(prev);
          next.delete(sentenceId);
          return next;
        });
      }
    },
    [loadUsageStatus]
  );

  const triggerEnsureMediaInsights = useCallback(
    async (paperId: string, engine: string, targetLang?: LangCode, missingIds: string[] = []) => {
      const useLang = targetLang || langRef.current;
      if (missingIds.length > 0) {
        setLoadingInsightIds((prev) => {
          const next = new Set(prev);
          for (const id of missingIds) next.add(id);
          return next;
        });
      }
      try {
        const res = await ensurePaperMediaInsights(paperId, engine, false, useLang);
        if (
          res.insights &&
          Object.keys(res.insights).length > 0 &&
          paperRef.current?.paper_id === paperId &&
          langRef.current === useLang
        ) {
          setPaper((prev) =>
            prev
              ? {
                  ...prev,
                  sentences: prev.sentences.map((s) =>
                    res.insights[s.id] ? { ...s, insight: res.insights[s.id] } : s
                  ),
                }
              : prev
          );
          loadUsageStatus(true);
        }
      } catch {
        // Non-fatal: fallback button remains available if offline
      } finally {
        if (missingIds.length > 0) {
          setLoadingInsightIds((prev) => {
            const next = new Set(prev);
            for (const id of missingIds) next.delete(id);
            return next;
          });
        }
      }
    },
    [loadUsageStatus]
  );

  const triggerPaperOverview = useCallback(
    async (paperId: string, engine: string, force = false, targetLang?: LangCode) => {
      const useLang = targetLang || langRef.current;
      setLoadingOverview(true);
      try {
        const ov = await generatePaperOverview(paperId, engine, force, useLang);
        if (paperRef.current?.paper_id === paperId && langRef.current === useLang) {
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
    (paperId: string, engine: string, force = false, targetLang?: LangCode) => {
      const useLang = targetLang || langRef.current;
      const localT = getUiStrings(useLang);
      closeStream();
      setStreamingSection(localT.overviewTitle);
      if (force) {
        setPaper((prev) =>
          prev && prev.paper_id === paperId
            ? {
                ...prev,
                lang: useLang,
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
            ? { ...prev, lang: useLang, ai_status: 'streaming', ai_error: null }
            : prev
        );
      }

      const es = new EventSource(getPaperStreamUrl(paperId, engine, force, useLang));
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

      es.addEventListener('resources', (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as {
            arxiv_id?: string | null;
            resource_links?: PaperResourceLink[];
          };
          setPaper((prev) =>
            prev && prev.paper_id === paperId
              ? {
                  ...prev,
                  arxiv_id: data.arxiv_id ?? prev.arxiv_id,
                  resource_links: data.resource_links || prev.resource_links,
                }
              : prev
          );
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
            resource_links?: PaperResourceLink[];
          };
          setPaper((prev) =>
            prev && prev.paper_id === paperId
              ? {
                  ...prev,
                  overview: data.overview,
                  ai_progress: data.ai_progress ?? prev.ai_progress,
                  ai_model: data.ai_model || prev.ai_model,
                  resource_links: data.resource_links || prev.resource_links,
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
        fetchPapersList(useLang)
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
    (bundle: LoadedPaperBundle, targetLang?: LangCode) => {
      const useLang = targetLang || langRef.current;
      closeStream();
      setPaper(bundle.paper);
      setCitationSummaries(bundle.citation_summaries || {});
      setCitationMetaCache({});
      setCitSummaryErrors({});
      setActiveCitationKey(null);
      setActiveSentenceId((cur) =>
        bundle.paper.sentences.some((s) => s.id === cur)
          ? cur
          : bundle.paper.sentences[0]?.id || null
      );
      setGlobalError(null);

      const url = new URL(window.location.href);
      url.searchParams.delete('import');
      url.searchParams.set('paperId', bundle.paper.paper_id);
      window.history.replaceState({}, '', url.toString());

      fetchPapersList(useLang)
        .then(setRecentPapers)
        .catch(() => {});

      if (
        bundle.paper.ai_status === 'pending' ||
        bundle.paper.ai_status === 'streaming' ||
        bundle.paper.sentences.length === 0
      ) {
        startPaperStream(bundle.paper.paper_id, selectedEngineRef.current, false, useLang);
      } else {
        if (!bundle.paper.overview) {
          triggerPaperOverview(bundle.paper.paper_id, selectedEngineRef.current, false, useLang);
        }
        const missingMediaIds = bundle.paper.sentences
          .filter((s) => (s.kind === 'figure' || s.kind === 'table') && !(s.insight && s.insight.trim()))
          .map((s) => s.id);
        if (missingMediaIds.length > 0) {
          triggerEnsureMediaInsights(
            bundle.paper.paper_id,
            selectedEngineRef.current,
            useLang,
            missingMediaIds
          );
        }
      }
    },
    [closeStream, startPaperStream, triggerPaperOverview, triggerEnsureMediaInsights]
  );

  const openPaperById = useCallback(
    async (paperId: string, targetLang?: LangCode) => {
      const useLang = targetLang || langRef.current;
      setLoadingPaper(true);
      setGlobalError(null);
      try {
        const bundle = await fetchPaperBundle(paperId, useLang);
        applyLoadedBundle(bundle, useLang);
      } catch (err: any) {
        setGlobalError(err?.message || 'Failed to load paper.');
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
      const useLang = langRef.current;
      setLoadingPaper(true);
      setGlobalError(null);
      try {
        const bundle = await importPaperUrl(val, useLang);
        setArxivInput('');
        applyLoadedBundle(bundle, useLang);
      } catch (err: any) {
        setGlobalError(err?.message || 'Failed to import URL/arXiv.');
      } finally {
        setLoadingPaper(false);
      }
    },
    [arxivInput, applyLoadedBundle]
  );

  const handleChangeLanguage = useCallback(
    async (nextLang: LangCode) => {
      setShowLangMenu(false);
      if (nextLang === langRef.current) return;
      setLang(nextLang);
      langRef.current = nextLang;
      try {
        localStorage.setItem('paperview_lang', nextLang);
      } catch {
        // ignore
      }
      updateEngineSettings({ default_lang: nextLang }).catch(() => {});
      fetchPapersList(nextLang)
        .then(setRecentPapers)
        .catch(() => {});
      if (paperRef.current) {
        await openPaperById(paperRef.current.paper_id, nextLang);
      }
    },
    [openPaperById]
  );

  // Initial bootstrap: models catalog, recent papers, URL ?paperId= or ?import=, and VS Code bridge
  useEffect(() => {
    const initLang = langRef.current;
    updateEngineSettings({ default_lang: initLang }).catch(() => {});
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

    fetchPapersList(initLang)
      .then((list) => {
        setRecentPapers(list);
        const params = new URLSearchParams(window.location.search);
        const qImport = params.get('import');
        const qPaperId = params.get('paperId');
        if (qImport) {
          handleImportUrl(qImport);
        } else if (qPaperId) {
          openPaperById(qPaperId, initLang);
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
    const useLang = langRef.current;
    setLoadingPaper(true);
    setGlobalError(null);
    try {
      const bundle = await uploadPaperFile(file, useLang);
      applyLoadedBundle(bundle, useLang);
    } catch (err: any) {
      setGlobalError(err?.message || 'PDF upload failed.');
    } finally {
      setLoadingPaper(false);
    }
  };

  const handlePauseStream = async () => {
    if (!paper) return;
    closeStream();
    try {
      const res = await stopPaperStream(paper.paper_id, langRef.current);
      setPaper(res.paper);
    } catch {
      setPaper((prev) => (prev ? { ...prev, ai_status: 'paused' } : prev));
    }
  };

  const handleResumeStream = () => {
    if (!paper) return;
    startPaperStream(paper.paper_id, selectedEngine, false, langRef.current);
  };

  const handleRestartStream = () => {
    if (!paper) return;
    startPaperStream(paper.paper_id, selectedEngine, true, langRef.current);
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
      const useLang = langRef.current;
      const jobId = `${targetPaperId}:${refKey}:${useLang}`;
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
        const meta = await fetchCitationMetadata(targetPaperId, refKey, useLang);
        setCitationMetaCache((prev) => ({ ...prev, [refKey]: meta }));
        if (meta.cached_summary) {
          setCitationSummaries((prev) => ({ ...prev, [refKey]: meta.cached_summary! }));
        }
      } catch (err: any) {
        setCitMetaError(err?.message || 'Citation lookup failed.');
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
    const useLang = langRef.current;
    const jobId = `${targetPaperId}:${targetRefKey}:${useLang}`;
    const citedTitle =
      citationMetaCache[targetRefKey]?.title || `[${targetRefKey}]`;

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
        force,
        useLang
      );

      if (paperRef.current?.paper_id === targetPaperId && langRef.current === useLang) {
        setCitationSummaries((prev) => ({ ...prev, [targetRefKey]: sum }));
        fetchCitationMetadata(targetPaperId, targetRefKey, useLang)
          .then((freshMeta) => {
            if (paperRef.current?.paper_id === targetPaperId && langRef.current === useLang) {
              setCitationMetaCache((prev) => ({ ...prev, [targetRefKey]: freshMeta }));
            }
          })
          .catch(() => {});
      }

      const isCurrentlyViewingSameCitation =
        paperRef.current?.paper_id === targetPaperId &&
        activeCitationKeyRef.current === targetRefKey &&
        langRef.current === useLang;

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
      const msg = err?.message || 'Citation summary failed.';
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
          fetchPapersList(langRef.current)
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
    paper && activeCitationKey ? `${paper.paper_id}:${activeCitationKey}:${lang}` : '';
  const currentLangOption =
    LANGUAGE_OPTIONS.find((o) => o.code === lang) || LANGUAGE_OPTIONS[0];

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
            <p>{t.dropOverlayText}</p>
          </div>
        </div>
      )}

      {/* Top Header */}
      <header className="top-navbar">
        <div className="brand-group">
          <div
            className="brand-logo"
            onClick={handleGoHome}
            title={t.homeTitle}
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
            <span>{t.openPdf}</span>
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
              placeholder={t.arxivPlaceholder}
              value={arxivInput}
              onChange={(e) => setArxivInput(e.target.value)}
            />
            {arxivInput.trim() && (
              <button type="submit" className="mini-go-btn">
                {t.openBtn}
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
                  setShowLangMenu(false);
                }}
              >
                <BookMarked size={14} />
                <span>{t.recentBtn(recentPapers.length)}</span>
              </button>

              {showLibraryMenu && (
                <div className="library-popover" onMouseLeave={() => setShowLibraryMenu(false)}>
                  <div className="lib-pop-header">{t.recentHeader}</div>
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
                        {t.paperMeta(
                          item.page_count,
                          item.sentence_count,
                          item.reference_count
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="divider-v" />

          {/* Target Output & UI Language Selector */}
          <div className="library-dropdown-wrap">
            <button
              type="button"
              className="nav-btn"
              title={t.langMenuHeader}
              onClick={() => {
                setShowLangMenu((v) => !v);
                setShowModelMenu(false);
                setShowLibraryMenu(false);
                setShowAlertsTray(false);
                setShowUsageMenu(false);
              }}
            >
              <Languages size={14} />
              <span>{currentLangOption.nativeName}</span>
              <ChevronDown size={12} style={{ opacity: 0.65 }} />
            </button>

            {showLangMenu && (
              <div
                className="library-popover"
                style={{ minWidth: 210 }}
                onMouseLeave={() => setShowLangMenu(false)}
              >
                <div className="lib-pop-header">{t.langMenuHeader}</div>
                {LANGUAGE_OPTIONS.map((opt) => {
                  const isCur = opt.code === lang;
                  return (
                    <button
                      key={opt.code}
                      type="button"
                      className={`model-row-btn ${isCur ? 'current' : ''}`}
                      onClick={() => handleChangeLanguage(opt.code)}
                    >
                      <span>
                        <strong>{opt.nativeName}</strong>{' '}
                        <span style={{ opacity: 0.65, fontSize: 11.5 }}>
                          ({opt.englishName})
                        </span>
                      </span>
                      {isCur && <CheckCircle2 size={14} className="check-accent" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

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
                    setShowLangMenu(false);
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
                      title={t.refreshModelsTitle}
                      onClick={handleRefreshModelsCatalog}
                    >
                      <RefreshCw size={12} className={refreshingModels ? 'spin' : ''} />
                    </button>
                    <button
                      type="button"
                      className="icon-tiny-btn"
                      title={t.close}
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
                        <span>{t.modelCurrent}</span>
                        <strong>{modelsCatalog.claude.effective_model}</strong>
                      </div>
                      {modelsCatalog.claude.detected_model && (
                        <div>
                          <span>{t.modelDetected}</span>
                          <code>{modelsCatalog.claude.detected_model}</code>
                        </div>
                      )}
                    </div>

                    <div className="lib-pop-header">{t.reasoningEffort}</div>
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
                      {t.selectModelHeader('Claude', modelsCatalog.claude.models.length)}
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
                        <span>{t.modelCurrent}</span>
                        <strong>{modelsCatalog.codex.effective_model}</strong>
                      </div>
                      <div>
                        <span>{t.authMethod}</span>
                        <span className="usage-zero-api">{t.authZeroApi}</span>
                      </div>
                    </div>

                    <div className="lib-pop-header">{t.reasoningEffort}</div>
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
                      {t.selectModelHeader('OpenAI Codex', modelsCatalog.codex.models.length)}
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
                          <code>GEMINI_API_KEY</code>
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
                            placeholder="GEMINI_API_KEY"
                            value={geminiKeyInput}
                            onChange={(e) => setGeminiKeyInput(e.target.value)}
                          />
                          <button type="submit">{t.openBtn}</button>
                        </form>
                      </div>
                    )}

                    <div className="lib-pop-header">{t.reasoningEffort}</div>
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
                      {t.selectModelHeader('Antigravity', modelsCatalog.antigravity.models.length)}
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
                      setShowLangMenu(false);
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
                    <span>{t.remainingQuotaBtn(remPct)}</span>
                  </button>

                  {showUsageMenu && (
                    <div className="library-popover usage-popover">
                      <div className="alerts-tray-header">
                        <span>{t.usageHeader}</span>
                        <div className="row-center" style={{ gap: 4 }}>
                          <button
                            type="button"
                            className="icon-tiny-btn"
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
                            title={t.close}
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
                                : 'SUB'}
                            </span>
                            <span className="usage-zero-api">{t.usageZeroApi}</span>
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
                                      {t.pctRemaining(rem)}
                                    </strong>
                                  </div>
                                  <div className="usage-bar-track">
                                    <div
                                      className={`usage-bar-fill ${barState}`}
                                      style={{ width: `${Math.max(2, rem)}%` }}
                                    />
                                  </div>
                                  <div className="usage-quota-foot">
                                    <span>{t.pctUsed(used)}</span>
                                    {q.resets_at && <span>{t.resetsAt(q.resets_at)}</span>}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : refreshingUsage ? (
                          <div className="alerts-empty">{t.usageLoading}</div>
                        ) : (
                          <div className="alerts-empty">
                            {usageStatus?.error || t.usageEmptyHint}
                          </div>
                        )}

                        {usageStatus?.activity_lines &&
                          usageStatus.activity_lines.length > 0 && (
                            <div className="usage-activity-box">
                              {usageStatus.activity_lines.map((ln, idx) => (
                                <div key={idx} className="usage-activity-line">
                                  {ln}
                                </div>
                              ))}
                            </div>
                          )}

                        <div className="usage-footer-meta">
                          <span>
                            {t.sessionRequests(usageStatus?.local_session_requests ?? 0)}
                          </span>
                          {usageStatus?.checked_at && (
                            <span>{t.checkedAt(usageStatus.checked_at)}</span>
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
            onClick={() => {
              setShowQueueModal(true);
              setShowModelMenu(false);
              setShowLibraryMenu(false);
              setShowAlertsTray(false);
              setShowUsageMenu(false);
              setShowLangMenu(false);
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
            <span>{t.queueBtn}</span>
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
              onClick={() => {
                setShowAlertsTray((v) => !v);
                setShowModelMenu(false);
                setShowLibraryMenu(false);
                setShowUsageMenu(false);
                setShowLangMenu(false);
              }}
            >
              {runningAlertsCount > 0 ? (
                <div className="spinner-ring small" />
              ) : (
                <Bell size={14} />
              )}
              <span>{t.alertsBtn}</span>
              {(unreadAlertsCount > 0 || runningAlertsCount > 0) && (
                <span className="alert-count-badge">
                  {unreadAlertsCount > 0 ? unreadAlertsCount : runningAlertsCount}
                </span>
              )}
            </button>

            {showAlertsTray && (
              <div className="library-popover alerts-tray-popover">
                <div className="alerts-tray-header">
                  <span>{t.alertsHeader}</span>
                  <button
                    type="button"
                    className="icon-tiny-btn"
                    onClick={() => setShowAlertsTray(false)}
                  >
                    <X size={13} />
                  </button>
                </div>

                {summaryAlerts.length === 0 ? (
                  <div className="alerts-empty">{t.alertsEmpty}</div>
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
                              <span className="spinner-ring tiny" /> {t.alertRunning(item.refKey)}
                            </span>
                          ) : item.status === 'done' ? (
                            <span className="alert-status done">
                              {t.alertDone(item.refKey)}
                            </span>
                          ) : (
                            <span className="alert-status err">
                              {t.alertError(item.refKey)}
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
                            {t.viewBtn}
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
                onClick={() => setShowChatPanel((v) => !v)}
              >
                <MessageSquare size={14} />
                <span>{t.paperChatBtn}</span>
              </button>

              <button
                type="button"
                className={`icon-btn ${showPdfPane ? 'active-icon' : ''}`}
                title={t.togglePdfTitle(showPdfPane)}
                onClick={() => setShowPdfPane((v) => !v)}
              >
                <Columns size={16} />
              </button>
            </>
          )}

          <button
            type="button"
            className="icon-btn"
            title={t.toggleThemeTitle(darkMode)}
            onClick={() => setDarkMode((v) => !v)}
          >
            {darkMode ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>

      {/* Floating Top-Right Completion Toasts */}
      {(visibleToasts.length > 0 || (runningAlertsCount > 0 && !activeCitationKey)) && (
        <div className="topright-toast-stack">
          {runningAlertsCount > 0 && !activeCitationKey && (
            <button
              type="button"
              className="running-bg-pill"
              onClick={() => setShowAlertsTray((v) => !v)}
            >
              <div className="spinner-ring tiny" />
              <span>{t.bgRunningPill(runningAlertsCount)}</span>
            </button>
          )}

          {visibleToasts.map((toastItem) => (
            <div key={toastItem.id} className={`summary-ready-toast ${toastItem.status}`}>
              <div className="toast-content">
                <strong>
                  {toastItem.status === 'done'
                    ? t.alertDone(toastItem.refKey)
                    : t.alertError(toastItem.refKey)}
                </strong>
                <p>{toastItem.status === 'done' ? toastItem.paperTitle : toastItem.errorMsg}</p>
              </div>
              <div className="toast-actions">
                {toastItem.status === 'done' && (
                  <button
                    type="button"
                    className="toast-view-btn"
                    onClick={async () => {
                      if (paper?.paper_id !== toastItem.paperId) {
                        await openPaperById(toastItem.paperId);
                      }
                      openCitationDrawerByRefKey(toastItem.paperId, toastItem.refKey);
                    }}
                  >
                    {t.openBtn}
                  </button>
                )}
                <button
                  type="button"
                  className="toast-dismiss-btn"
                  onClick={() =>
                    setSummaryAlerts((prev) =>
                      prev.map((a) =>
                        a.id === toastItem.id ? { ...a, toastVisible: false } : a
                      )
                    )
                  }
                  title={t.close}
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
            {t.close}
          </button>
        </div>
      )}

      {/* Main Content */}
      {loadingPaper ? (
        <div className="center-loading-screen">
          <div className="spinner-ring large" />
          <h3>{t.loadingPdfTitle}</h3>
          <p>{t.loadingPdfSub}</p>
        </div>
      ) : !paper ? (
        <main className="welcome-landing">
          <div className="welcome-hero-card">
            <div className="hero-badge">{t.heroBadge}</div>
            <h1>{t.heroTitle}</h1>
            <p className="hero-sub">{t.heroSub}</p>

            <div className="hero-actions-grid">
              <div
                className="upload-drop-card"
                onClick={() => fileInputRef.current?.click()}
              >
                <FileText size={32} className="accent-icon" />
                <h3>{t.uploadCardTitle}</h3>
                <p>{t.uploadCardSub}</p>
              </div>

              <div className="arxiv-import-card">
                <h3>{t.arxivCardTitle}</h3>
                <form
                  className="hero-url-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleImportUrl();
                  }}
                >
                  <input
                    type="text"
                    placeholder={t.arxivCardPlaceholder}
                    value={arxivInput}
                    onChange={(e) => setArxivInput(e.target.value)}
                  />
                  <button type="submit">{t.importBtn}</button>
                </form>

                <div className="sample-presets">
                  <span>{t.sampleLabel}</span>
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
                <h4>{t.recentHeader}</h4>
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
                        {t.paperMeta(rp.page_count, rp.sentence_count, rp.reference_count)}
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
                  lang={lang}
                  onSelectSentenceFromPdf={handleSelectFromPdf}
                />
              </div>

              <div
                className="split-resizer"
                onMouseDown={() => {
                  splitDraggingRef.current = true;
                  document.body.style.userSelect = 'none';
                }}
              />
            </>
          )}

          <div className="split-right" style={{ flex: 1 }}>
            <ReaderPane
              lang={lang}
              resourceLinks={paper.resource_links || []}
              overview={paper.overview || null}
              loadingOverview={loadingOverview}
              onRefreshOverview={() =>
                triggerPaperOverview(paper.paper_id, selectedEngine, true, lang)
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
              loadingInsightIds={loadingInsightIds}
              onRequestMediaInsight={handleRequestMediaInsight}
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
              >
                <MessageSquare size={16} />
                <span>{t.askPaperFab}</span>
              </button>
            )}

            {activeCitationKey && (
              <CitationPopover
                lang={lang}
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
              lang={lang}
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
          lang={lang}
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
            fetchPapersList(lang)
              .then(setRecentPapers)
              .catch(() => {});
          }}
          onOpenPaper={(pid) => openPaperById(pid, lang)}
          onClose={() => setShowQueueModal(false)}
        />
      )}
    </div>
  );
};
