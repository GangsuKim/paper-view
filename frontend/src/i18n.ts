export type LangCode = 'ko' | 'en' | 'ja' | 'zh-CN' | 'zh-TW' | 'es' | 'de' | 'fr';

export interface LanguageOption {
  code: LangCode;
  nativeName: string;
  englishName: string;
  shortBadge: string;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: 'ko', nativeName: '한국어', englishName: 'Korean', shortBadge: 'KO' },
  { code: 'en', nativeName: 'English', englishName: 'English', shortBadge: 'EN' },
  { code: 'ja', nativeName: '日本語', englishName: 'Japanese', shortBadge: 'JA' },
  { code: 'zh-CN', nativeName: '简体中文', englishName: 'Simplified Chinese', shortBadge: '简' },
  { code: 'zh-TW', nativeName: '繁體中文', englishName: 'Traditional Chinese', shortBadge: '繁' },
  { code: 'es', nativeName: 'Español', englishName: 'Spanish', shortBadge: 'ES' },
  { code: 'de', nativeName: 'Deutsch', englishName: 'German', shortBadge: 'DE' },
  { code: 'fr', nativeName: 'Français', englishName: 'French', shortBadge: 'FR' },
];

export function detectInitialLang(): LangCode {
  try {
    const saved = localStorage.getItem('paperview_lang');
    if (saved && LANGUAGE_OPTIONS.some((o) => o.code === saved)) {
      return saved as LangCode;
    }
  } catch {
    // ignore
  }
  const nav = (typeof navigator !== 'undefined' ? navigator.language || '' : '').toLowerCase();
  if (nav.startsWith('ko')) return 'ko';
  if (nav.startsWith('ja')) return 'ja';
  if (nav === 'zh-tw' || nav === 'zh-hk' || nav.includes('hant')) return 'zh-TW';
  if (nav.startsWith('zh')) return 'zh-CN';
  if (nav.startsWith('es')) return 'es';
  if (nav.startsWith('de')) return 'de';
  if (nav.startsWith('fr')) return 'fr';
  if (nav.startsWith('en')) return 'en';
  return 'ko';
}

export interface UiStrings {
  homeTitle: string;
  openPdf: string;
  arxivPlaceholder: string;
  openBtn: string;
  recentBtn: (n: number) => string;
  recentHeader: string;
  paperMeta: (pages: number, sents: number, refs: number) => string;
  langMenuHeader: string;
  dropOverlayText: string;
  modelCurrent: string;
  modelDetected: string;
  authMethod: string;
  authZeroApi: string;
  reasoningEffort: string;
  selectModelHeader: (provider: string, count: number) => string;
  refreshModelsTitle: string;
  close: string;
  remainingQuotaBtn: (pct: number | null) => string;
  usageHeader: string;
  usageZeroApi: string;
  pctRemaining: (pct: number) => string;
  pctUsed: (pct: number) => string;
  resetsAt: (t: string) => string;
  usageLoading: string;
  usageEmptyHint: string;
  sessionRequests: (n: number) => string;
  checkedAt: (t: string) => string;
  queueBtn: string;
  alertsBtn: string;
  alertsHeader: string;
  alertsEmpty: string;
  alertRunning: (rk: string) => string;
  alertDone: (rk: string) => string;
  alertError: (rk: string) => string;
  viewBtn: string;
  bgRunningPill: (n: number) => string;
  paperChatBtn: string;
  askPaperFab: string;
  togglePdfTitle: (shown: boolean) => string;
  toggleThemeTitle: (dark: boolean) => string;
  loadingPdfTitle: string;
  loadingPdfSub: string;
  heroBadge: string;
  heroTitle: string;
  heroSub: string;
  uploadCardTitle: string;
  uploadCardSub: string;
  arxivCardTitle: string;
  arxivCardPlaceholder: string;
  importBtn: string;
  sampleLabel: string;
  // PdfPane
  pdfViewerTitle: string;
  zoomOut: string;
  zoomIn: string;
  fitWidth: string;
  pdfPreparing: string;
  syncTooltip: string;
  // ReaderPane
  searchPlaceholder: string;
  modelLabel: string;
  showTransBtn: string;
  onlyOrigBtn: string;
  retranslateTitle: string;
  streamOverviewWait: string;
  streamSectionsStart: string;
  streamProgress: (sec: string, count: number, pct: number) => string;
  pauseBtn: string;
  pausedMsg: (count: number, pct: number) => string;
  resumeBtn: string;
  restartBtn: string;
  streamErrPrefix: string;
  retryBtn: string;
  overviewChip: string;
  overviewTitle: string;
  overviewLoading: string;
  tldrLabel: string;
  contribLabel: string;
  problemLabel: string;
  methodLabel: string;
  resultsLabel: string;
  skeletonWait: string;
  noSentences: string;
  sentenceCount: (n: number) => string;
  zoomImage: string;
  mediaInsightLabel: (kind: 'figure' | 'table') => string;
  mediaInsightBtn: (kind: 'figure' | 'table') => string;
  mediaInsightLoading: string;
  // CitationPopover
  citHeader: string;
  citLoadingMeta: string;
  etAl: (n: number) => string;
  fulltextReady: string;
  abstractReady: string;
  bibOnly: string;
  goPaperArxiv: string;
  goPaper: string;
  rawPdfBtn: string;
  openInNewTab: string;
  quickSummaryBtn: string;
  quickSummaryHint: (modelInfo: string, hasFulltext: boolean) => string;
  summarizingTitle: (rk: string) => string;
  summarizingBody: string;
  closeKeepReading: string;
  mainFigTitle: string;
  keyPointsLabel: string;
  whyCitedLabel: string;
  citingLocs: (n: number) => string;
  rawRefToggle: string;
  // PaperChatDrawer
  chatTitle: string;
  concise: string;
  detailed: string;
  clearChat: string;
  chatWelcomeTitle: string;
  chatWelcomeSub: string;
  quickPrompts: [string, string, string, string];
  writingReply: string;
  pinToggle: (target: string) => string;
  chatPlaceholder: string;
  // QueueModal
  queueTitle: string;
  queueSub: string;
  qPaused: string;
  qScheduled: (lbl: string) => string;
  qRunning: string;
  qIdle: string;
  qAutoRetry: string;
  qStartNow: string;
  qPauseBtn: string;
  qClearDone: string;
  qScheduleLabel: string;
  qSetSchedule: string;
  qClearSchedule: string;
  qDropTitle: string;
  qDropSub: string;
  qUrlPlaceholder: string;
  qForceRetranslate: string;
  qAddBtn: string;
  qAdding: string;
  qAddCurrent: (title: string) => string;
  qAddUnfinished: (n: number) => string;
  qListHeader: (n: number) => string;
  qEmpty: string;
  qStatusRunning: (pct: number) => string;
  qStatusQueued: (pct: number) => string;
  qStatusQuota: string;
  qStatusDone: string;
  qStatusError: string;
}

const KO: UiStrings = {
  homeTitle: '홈 화면으로 이동',
  openPdf: 'PDF 열기',
  arxivPlaceholder: 'arXiv ID 또는 PDF URL (예: 1706.03762)',
  openBtn: '열기',
  recentBtn: (n) => `최근 (${n})`,
  recentHeader: '최근 열어본 논문',
  paperMeta: (p, s, r) => `${p}p · ${s}문장 · 인용 ${r}개`,
  langMenuHeader: '번역 · 요약 · 화면 언어',
  dropOverlayText: '여기에 논문 PDF 파일을 놓으면 AI 핵심 요약 및 실시간 번역이 시작됩니다',
  modelCurrent: '현재 선택/설정 모델:',
  modelDetected: '최근 실제 API 응답 ID:',
  authMethod: '인증 방식:',
  authZeroApi: '로컬 구독 로그인 (API 과금 차단)',
  reasoningEffort: '추론 성능 (Reasoning Effort)',
  selectModelHeader: (p, n) => `사용 가능한 ${p} 모델 선택 (${n}개)`,
  refreshModelsTitle: '사용 가능한 모델 목록 새로고침',
  close: '닫기',
  remainingQuotaBtn: (pct) => (pct !== null ? `남은 한도 ${pct}%` : '사용량 확인'),
  usageHeader: 'AI 구독 사용량 · 남은 한도',
  usageZeroApi: 'API 종량제 과금 없음',
  pctRemaining: (pct) => `${pct}% 남음`,
  pctUsed: (pct) => `${pct}% 사용됨`,
  resetsAt: (t) => `초기화: ${t}`,
  usageLoading: '로컬 CLI에서 남은 한도를 조회하는 중입니다...',
  usageEmptyHint: '새로고침 버튼을 눌러 현재 구독 세션의 남은 한도를 조회하세요.',
  sessionRequests: (n) => `이번 실행 요청 ${n}회`,
  checkedAt: (t) => `조회 시각 ${t}`,
  queueBtn: '번역 큐',
  alertsBtn: '요약 알림',
  alertsHeader: '인용 논문 요약 알림',
  alertsEmpty: '인용 번호 클릭 후 [간단 요약 보기]를 누르면 창을 닫아도 이곳에서 완료 알림을 확인할 수 있습니다.',
  alertRunning: (rk) => `[${rk}]번 논문 요약 중...`,
  alertDone: (rk) => `✨ [${rk}]번 논문 요약이 완성되었어요!`,
  alertError: (rk) => `[${rk}]번 논문 요약 오류`,
  viewBtn: '보기',
  bgRunningPill: (n) => `백그라운드 인용 요약 진행 중 (${n}건)`,
  paperChatBtn: '논문 채팅',
  askPaperFab: '논문 질문하기',
  togglePdfTitle: (shown) => (shown ? '좌측 PDF 패널 숨기기' : '좌측 PDF 패널 보이기'),
  toggleThemeTitle: (dark) => (dark ? '라이트 모드로 전환' : '다크 모드로 전환'),
  loadingPdfTitle: '논문 PDF 및 Figure · Table 구조를 분석하는 중입니다...',
  loadingPdfSub: '곧바로 AI 핵심 요약과 섹션별 실시간 번역이 시작됩니다',
  heroBadge: 'AI 핵심 요약 · 1단/2단 레이아웃 & 표·그림 자동 인식 · 다국어 실시간 번역',
  heroTitle: '논문을 넣으면 AI가 핵심 요약과 섹션별 전문 번역을 실시간으로 보여줍니다',
  heroSub: '1단(NeurIPS·ICLR) 및 2단(IEEE·CVPR) 컬럼과 Figure · Table을 페이지별로 자동 감지하고, 인용 논문은 arXiv 우선 탐색 및 백그라운드 요약을 제공합니다.',
  uploadCardTitle: '내 컴퓨터 PDF 논문 열기',
  uploadCardSub: '클릭하여 선택하거나 PDF 파일을 화면 어디에나 드래그 앤 드롭하세요',
  arxivCardTitle: 'arXiv ID 또는 URL로 바로 시작',
  arxivCardPlaceholder: '예: 1706.03762 또는 https://arxiv.org/abs/...',
  importBtn: '불러오기',
  sampleLabel: '예시 논문 바로 열기:',
  pdfViewerTitle: '원본 PDF 뷰어',
  zoomOut: '축소',
  zoomIn: '확대',
  fitWidth: '패널 폭에 맞추기',
  pdfPreparing: 'PDF 렌더링 준비 중...',
  syncTooltip: '클릭하여 우측 리더 뷰와 동기화',
  searchPlaceholder: '원문 또는 번역 검색...',
  modelLabel: '모델',
  showTransBtn: '번역 함께 보기',
  onlyOrigBtn: '영어 원문만',
  retranslateTitle: '현재 선택한 AI 엔진·언어로 다시 번역',
  streamOverviewWait: 'AI가 가장 먼저 논문 핵심 요약 & Contribution을 정리하고 있습니다...',
  streamSectionsStart: '요약 완료! 이어서 Abstract / Introduction / ... 섹션별 실시간 번역을 시작합니다...',
  streamProgress: (sec, c, pct) => `실시간 번역 중 — ${sec} (${c}문장 완료 · ${pct}%)`,
  pauseBtn: '일시정지',
  pausedMsg: (c, pct) => `번역이 일시정지되었습니다 (${c}문장 완료 · ${pct}%)`,
  resumeBtn: '이어서 번역',
  restartBtn: '처음부터',
  streamErrPrefix: '스트리밍 번역 오류',
  retryBtn: '이어서 재시도',
  overviewChip: '✦ 핵심 요약',
  overviewTitle: '논문 핵심 요약 & Contribution',
  overviewLoading: '논문 전체 구조(초록·서론·방법론·결론)를 바탕으로 핵심 요약과 주요 Contribution을 먼저 작성하는 중입니다...',
  tldrLabel: '한줄 핵심 요약',
  contribLabel: '주요 Contribution',
  problemLabel: '문제 정의',
  methodLabel: '제안 방법',
  resultsLabel: '주요 성과',
  skeletonWait: '번역이 완료되는 문장부터 실시간으로 바로 표시됩니다...',
  noSentences: '표시할 문장이 없습니다.',
  sentenceCount: (n) => `${n}문장`,
  zoomImage: '크게 보기',
  mediaInsightLabel: (k) =>
    k === 'table' ? '저자가 이 표로 말하고 싶은 핵심' : '저자가 이 그림으로 말하고 싶은 핵심',
  mediaInsightBtn: (k) =>
    k === 'table'
      ? '저자가 이 표로 말하고 싶은 핵심 보기'
      : '저자가 이 그림으로 말하고 싶은 핵심 보기',
  mediaInsightLoading: '본문 언급 문장과 내부 수치를 바탕으로 저자의 핵심 의도를 정리하는 중...',
  citHeader: '인용 논문 정보',
  citLoadingMeta: '서지 정보(제목·저자·출판연도)를 조회하는 중입니다...',
  etAl: (n) => ` 외 ${n}명`,
  fulltextReady: '원문 PDF 확보 가능',
  abstractReady: '초록 확보됨',
  bibOnly: '서지 텍스트',
  goPaperArxiv: '해당 논문 보러가기 (arXiv)',
  goPaper: '해당 논문 보러가기',
  rawPdfBtn: '원문 PDF',
  openInNewTab: 'PaperView 새 탭 열기',
  quickSummaryBtn: '간단 요약 보기',
  quickSummaryHint: (m, full) => `${m} 모델로 ${full ? '원문 및 Main Figure' : '초록 및 문맥'}를 읽어 요약합니다. 창을 닫아도 완료 시 우상단에 알림이 표시됩니다.`,
  summarizingTitle: (rk) => `[${rk}]번 인용 논문을 읽고 요약하는 중...`,
  summarizingBody: '창을 닫고 본문을 계속 읽으셔도 백그라운드에서 진행되며, 완성되면 우상단에 알림을 띄워드립니다.',
  closeKeepReading: '창 닫고 본문 계속 읽기',
  mainFigTitle: '인용 논문 Main Figure',
  keyPointsLabel: '주요 내용',
  whyCitedLabel: '현재 논문에서 인용한 이유',
  citingLocs: (n) => `본문 내 인용 위치 (${n}곳)`,
  rawRefToggle: '원문 References 표기 보기',
  chatTitle: '논문 Q&A',
  concise: '간결',
  detailed: '상세',
  clearChat: '대화 내역 비우기',
  chatWelcomeTitle: '현재 논문 전체를 바탕으로 질문해 보세요',
  chatWelcomeSub: '본문 전체, 수식 문맥, Figure·Table 캡션, 참고문헌이 자동으로 컨텍스트에 포함됩니다.',
  quickPrompts: [
    '핵심 Contribution 3줄 요약해줘',
    '제안 방법론(Method) 핵심 흐름만 간단히 설명해줘',
    '기존 베이스라인 대비 주요 실험 강점은 뭐야?',
    '이 연구의 주요 한계점이나 가정을 짧게 짚어줘',
  ],
  writingReply: '논문 내용을 바탕으로 답변을 작성하는 중...',
  pinToggle: (t) => `현재 선택한 ${t} 질문에 첨부하기`,
  chatPlaceholder: '논문에 대해 궁금한 점을 질문하세요 (Enter 전송, Shift+Enter 줄바꿈)',
  queueTitle: '논문 예약 · 연속 번역 큐 (Queue)',
  queueSub: '여러 논문을 걸어두면 핵심 요약부터 전문 번역까지 순서대로 자동 실행됩니다',
  qPaused: '⏸ 일시정지됨',
  qScheduled: (lbl) => `🌙 ${lbl} 시작 예약됨`,
  qRunning: '실시간 순차 번역 중',
  qIdle: '대기 중 (추가 시 즉시 시작)',
  qAutoRetry: '구독 한도 도달 시 초기화 후 자동 재개',
  qStartNow: '지금 바로 시작',
  qPauseBtn: '큐 일시정지',
  qClearDone: '완료 정리',
  qScheduleLabel: '취침·외출 예약 시작 시각:',
  qSetSchedule: '예약 걸기',
  qClearSchedule: '예약 해제',
  qDropTitle: 'PDF 논문 여러 개 한 번에 추가',
  qDropSub: '클릭하여 여러 파일을 선택하거나 여기에 드래그 앤 드롭하세요',
  qUrlPlaceholder: 'arXiv ID 또는 PDF URL 여러 개 입력 (쉼표 또는 줄바꿈 구분, 예: 1706.03762, 2403.07636)',
  qForceRetranslate: '이미 번역된 논문도 처음부터 재번역',
  qAddBtn: '큐에 추가',
  qAdding: '추가 중...',
  qAddCurrent: (t) => `+ 현재 열린 논문 큐에 추가 (${t})`,
  qAddUnfinished: (n) => `+ 미완료 최근 논문 ${n}개 일괄 추가`,
  qListHeader: (n) => `큐 대기열 목록 (${n}건)`,
  qEmpty: '등록된 논문이 없습니다. 자기 전에 읽고 싶은 PDF 논문들을 여러 개 올려두시면 밤새 자동으로 완료해 둡니다.',
  qStatusRunning: (pct) => `번역 중 (${pct}%)`,
  qStatusQueued: (pct) => (pct > 0 ? `대기 중 (${pct}% 완료됨)` : '대기 중'),
  qStatusQuota: '한도 초기화 대기 중',
  qStatusDone: '완료',
  qStatusError: '오류',
};

const EN: UiStrings = {
  homeTitle: 'Back to Home',
  openPdf: 'Open PDF',
  arxivPlaceholder: 'arXiv ID or PDF URL (e.g. 1706.03762)',
  openBtn: 'Open',
  recentBtn: (n) => `Recent (${n})`,
  recentHeader: 'Recently Opened Papers',
  paperMeta: (p, s, r) => `${p}p · ${s} sents · ${r} refs`,
  langMenuHeader: 'AI Output & UI Language',
  dropOverlayText: 'Drop a paper PDF anywhere to start AI overview & real-time reading notes',
  modelCurrent: 'Active Model:',
  modelDetected: 'Last Detected ID:',
  authMethod: 'Auth Mode:',
  authZeroApi: 'Subscription OAuth ($0 API Billing)',
  reasoningEffort: 'Reasoning Effort',
  selectModelHeader: (p, n) => `Available ${p} Models (${n})`,
  refreshModelsTitle: 'Refresh available models',
  close: 'Close',
  remainingQuotaBtn: (pct) => (pct !== null ? `Quota ${pct}%` : 'Usage'),
  usageHeader: 'Subscription Usage & Quota',
  usageZeroApi: '$0 Extra API Cost',
  pctRemaining: (pct) => `${pct}% left`,
  pctUsed: (pct) => `${pct}% used`,
  resetsAt: (t) => `Resets: ${t}`,
  usageLoading: 'Querying remaining quota from local CLI...',
  usageEmptyHint: 'Click refresh to inspect remaining subscription quota.',
  sessionRequests: (n) => `${n} requests this session`,
  checkedAt: (t) => `Checked ${t}`,
  queueBtn: 'Queue',
  alertsBtn: 'Alerts',
  alertsHeader: 'Citation Summary Alerts',
  alertsEmpty: 'Click [Quick Summary] on any inline citation — you can close the drawer and get notified here when ready.',
  alertRunning: (rk) => `Summarizing ref [${rk}]...`,
  alertDone: (rk) => `✨ Summary ready for [${rk}]!`,
  alertError: (rk) => `Failed to summarize [${rk}]`,
  viewBtn: 'Open',
  bgRunningPill: (n) => `Summarizing citations in background (${n})`,
  paperChatBtn: 'Paper Chat',
  askPaperFab: 'Ask Paper',
  togglePdfTitle: (shown) => (shown ? 'Hide PDF Pane' : 'Show PDF Pane'),
  toggleThemeTitle: (dark) => (dark ? 'Switch to Light Mode' : 'Switch to Dark Mode'),
  loadingPdfTitle: 'Analyzing PDF layout, Figures & Tables...',
  loadingPdfSub: 'AI Key Summary & real-time section streaming will begin shortly',
  heroBadge: 'Overview-First · Auto 1-Col / 2-Col & Figures · Multilingual AI Reader',
  heroTitle: 'Drop any paper for instant Key Contributions & real-time scholarly reading',
  heroSub: 'Automatically detects 1-column (NeurIPS/ICLR) & 2-column (IEEE/CVPR) layouts, extracts Figures & Tables inline, and summarizes cited papers via arXiv.',
  uploadCardTitle: 'Open Local PDF Paper',
  uploadCardSub: 'Click to browse or drag & drop a PDF file anywhere on screen',
  arxivCardTitle: 'Start from arXiv ID or URL',
  arxivCardPlaceholder: 'e.g. 1706.03762 or https://arxiv.org/abs/...',
  importBtn: 'Import',
  sampleLabel: 'Try a sample paper:',
  pdfViewerTitle: 'Original PDF',
  zoomOut: 'Zoom Out',
  zoomIn: 'Zoom In',
  fitWidth: 'Fit to Pane Width',
  pdfPreparing: 'Preparing PDF pages...',
  syncTooltip: 'Click to sync with reader pane',
  searchPlaceholder: 'Search original text or notes...',
  modelLabel: 'Model',
  showTransBtn: 'Show Key Notes',
  onlyOrigBtn: 'Original Only',
  retranslateTitle: 'Regenerate in current model & language',
  streamOverviewWait: 'Synthesizing Key Summary & Contributions first...',
  streamSectionsStart: 'Overview ready! Streaming Abstract / Introduction / ...',
  streamProgress: (sec, c, pct) => `Streaming — ${sec} (${c} sents · ${pct}%)`,
  pauseBtn: 'Pause',
  pausedMsg: (c, pct) => `Paused (${c} sentences done · ${pct}%)`,
  resumeBtn: 'Resume',
  restartBtn: 'Restart',
  streamErrPrefix: 'Stream Error',
  retryBtn: 'Retry',
  overviewChip: '✦ Key Summary',
  overviewTitle: 'Key Summary & Contributions',
  overviewLoading: 'Synthesizing TL;DR and Key Contributions across Abstract, Method, and Conclusion...',
  tldrLabel: 'One-Line Summary (TL;DR)',
  contribLabel: 'Key Contributions',
  problemLabel: 'Problem',
  methodLabel: 'Proposed Method',
  resultsLabel: 'Key Results',
  skeletonWait: 'Sentences appear here in real time as each one completes...',
  noSentences: 'No sentences to display.',
  sentenceCount: (n) => `${n} sents`,
  zoomImage: 'Enlarge',
  mediaInsightLabel: (k) =>
    k === 'table' ? "Author's Core Claim in This Table" : "Author's Core Claim in This Figure",
  mediaInsightBtn: (k) =>
    k === 'table' ? "Explain Author's Key Claim (Table)" : "Explain Author's Key Claim (Figure)",
  mediaInsightLoading: "Analyzing body context & values to summarize the authors' core claim...",
  citHeader: 'Cited Paper Info',
  citLoadingMeta: 'Resolving bibliography metadata & arXiv full text...',
  etAl: (n) => ` +${n} more`,
  fulltextReady: 'Full-Text PDF Found',
  abstractReady: 'Abstract Found',
  bibOnly: 'Citation Text',
  goPaperArxiv: 'View Paper (arXiv)',
  goPaper: 'View Paper',
  rawPdfBtn: 'Full PDF',
  openInNewTab: 'Open in PaperView',
  quickSummaryBtn: 'Quick Summary',
  quickSummaryHint: (m, full) => `Uses ${m} to read ${full ? 'full PDF & Main Figure' : 'abstract & context'}. Close anytime — you will be notified when ready.`,
  summarizingTitle: (rk) => `Reading & summarizing [${rk}]...`,
  summarizingBody: 'Feel free to close this panel and keep reading — we will notify you at top-right as soon as it finishes.',
  closeKeepReading: 'Close & Keep Reading',
  mainFigTitle: 'Cited Paper Main Figure',
  keyPointsLabel: 'Key Points',
  whyCitedLabel: 'Why Cited in This Paper',
  citingLocs: (n) => `Citing Locations in Paper (${n})`,
  rawRefToggle: 'View Raw Reference String',
  chatTitle: 'Paper Q&A',
  concise: 'Concise',
  detailed: 'Detailed',
  clearChat: 'Clear Chat',
  chatWelcomeTitle: 'Ask anything grounded in the full paper',
  chatWelcomeSub: 'Full text, equations, Figure/Table captions, and references are automatically included.',
  quickPrompts: [
    'Summarize the 3 core contributions briefly',
    'Explain the core workflow of the proposed method',
    'What are the main experimental gains over baselines?',
    'What are the key limitations or assumptions?',
  ],
  writingReply: 'Drafting grounded answer...',
  pinToggle: (t) => `Pin selected ${t} to question`,
  chatPlaceholder: 'Ask a question about this paper (Enter to send, Shift+Enter for newline)',
  queueTitle: 'Scheduled & Batch Queue',
  queueSub: 'Queue multiple papers to run Overview & full-text processing sequentially',
  qPaused: '⏸ Paused',
  qScheduled: (lbl) => `🌙 Scheduled (${lbl})`,
  qRunning: 'Processing Queue',
  qIdle: 'Ready (starts immediately)',
  qAutoRetry: 'Auto-resume after subscription quota resets',
  qStartNow: 'Start Now',
  qPauseBtn: 'Pause Queue',
  qClearDone: 'Clear Done',
  qScheduleLabel: 'Scheduled Start Time:',
  qSetSchedule: 'Set Schedule',
  qClearSchedule: 'Clear',
  qDropTitle: 'Add Multiple PDF Papers',
  qDropSub: 'Click to choose multiple files or drag & drop here',
  qUrlPlaceholder: 'Enter multiple arXiv IDs or PDF URLs (comma or newline separated, e.g. 1706.03762)',
  qForceRetranslate: 'Reprocess even if already completed',
  qAddBtn: 'Add to Queue',
  qAdding: 'Adding...',
  qAddCurrent: (t) => `+ Enqueue current paper (${t})`,
  qAddUnfinished: (n) => `+ Enqueue ${n} unfinished recent papers`,
  qListHeader: (n) => `Queued Papers (${n})`,
  qEmpty: 'No papers in queue yet. Add multiple PDFs before sleep and wake up to completed summaries & notes.',
  qStatusRunning: (pct) => `Running (${pct}%)`,
  qStatusQueued: (pct) => (pct > 0 ? `Queued (${pct}% done)` : 'Queued'),
  qStatusQuota: 'Waiting for Quota Reset',
  qStatusDone: 'Completed',
  qStatusError: 'Error',
};

const JA: UiStrings = {
  ...EN,
  homeTitle: 'ホームへ戻る',
  openPdf: 'PDFを開く',
  arxivPlaceholder: 'arXiv ID または PDF URL (例: 1706.03762)',
  openBtn: '開く',
  recentBtn: (n) => `履歴 (${n})`,
  recentHeader: '最近開いた論文',
  paperMeta: (p, s, r) => `${p}p · ${s}文 · 引用${r}件`,
  langMenuHeader: '翻訳・要約・表示言語',
  dropOverlayText: 'ここに論文PDFをドロップするとAI要点整理とリアルタイム翻訳を開始します',
  modelCurrent: '選択中のモデル:',
  modelDetected: '検出された応答ID:',
  authMethod: '認証方式:',
  authZeroApi: 'ローカル購読ログイン (追加API課金 $0)',
  reasoningEffort: '推論レベル (Reasoning Effort)',
  selectModelHeader: (p, n) => `利用可能な ${p} モデル (${n}件)`,
  refreshModelsTitle: 'モデル一覧を再取得',
  close: '閉じる',
  remainingQuotaBtn: (pct) => (pct !== null ? `残り枠 ${pct}%` : '使用量確認'),
  usageHeader: 'AIサブスク使用量・残り枠',
  usageZeroApi: '従量API課金なし',
  pctRemaining: (pct) => `残り ${pct}%`,
  pctUsed: (pct) => `${pct}% 使用済み`,
  resetsAt: (t) => `リセット: ${t}`,
  usageLoading: 'ローカルCLIから残り枠を取得中...',
  usageEmptyHint: '更新ボタンを押して現在のサブスク残り枠を確認してください。',
  sessionRequests: (n) => `今回のリクエスト ${n}回`,
  checkedAt: (t) => `取得時刻 ${t}`,
  queueBtn: '翻訳キュー',
  alertsBtn: '要約通知',
  alertsHeader: '引用論文の要約通知',
  alertsEmpty: '引用番号から [簡単要約を見る] を押すと、パネルを閉じても完了時にここへ通知されます。',
  alertRunning: (rk) => `[${rk}]番の論文を要約中...`,
  alertDone: (rk) => `✨ [${rk}]番の論文要約が完了しました！`,
  alertError: (rk) => `[${rk}]番の要約エラー`,
  viewBtn: '開く',
  bgRunningPill: (n) => `バックグラウンドで引用要約中 (${n}件)`,
  paperChatBtn: '論文チャット',
  askPaperFab: '論文に質問する',
  togglePdfTitle: (shown) => (shown ? '左PDFパネルを隠す' : '左PDFパネルを表示'),
  toggleThemeTitle: (dark) => (dark ? 'ライトモードへ切替' : 'ダークモードへ切替'),
  loadingPdfTitle: 'PDFレイアウトと Figure・Table を解析しています...',
  loadingPdfSub: 'まもなくAI要点まとめとセクション別リアルタイム翻訳が始まります',
  heroBadge: 'AI要点・Contribution先行提示 · 1段/2段 & 図表自動認識 · 多言語リアルタイム翻訳',
  heroTitle: '論文を入れるだけで、要点・Contributionから全文翻訳までリアルタイム表示',
  heroSub: '1段組(NeurIPS等)・2段組(IEEE/CVPR等)と Figure・Table をページ単位で自動判別し、引用論文は arXiv 優先検索とバックグラウンド要約に対応します。',
  uploadCardTitle: 'PC内のPDF論文を開く',
  uploadCardSub: 'クリックして選択するか、PDFファイルを画面にドラッグ＆ドロップ',
  arxivCardTitle: 'arXiv ID または URL から開始',
  arxivCardPlaceholder: '例: 1706.03762 または https://arxiv.org/abs/...',
  importBtn: '読み込む',
  sampleLabel: 'サンプル論文を開く:',
  pdfViewerTitle: '原文PDFビューア',
  zoomOut: '縮小',
  zoomIn: '拡大',
  fitWidth: 'パネル幅に合わせる',
  pdfPreparing: 'PDFページを描画中...',
  syncTooltip: 'クリックして右パネルと同期',
  searchPlaceholder: '原文または翻訳を検索...',
  modelLabel: 'モデル',
  showTransBtn: '翻訳を併記',
  onlyOrigBtn: '英語原文のみ',
  retranslateTitle: '現在のモデル・言語で再翻訳する',
  streamOverviewWait: 'AIが最初に論文の要点 & Contribution を整理しています...',
  streamSectionsStart: '要点完了！続いて Abstract / Introduction / ... のリアルタイム翻訳を開始します...',
  streamProgress: (sec, c, pct) => `リアルタイム翻訳中 — ${sec} (${c}文完了 · ${pct}%)`,
  pauseBtn: '一時停止',
  pausedMsg: (c, pct) => `翻訳を一時停止しました (${c}文完了 · ${pct}%)`,
  resumeBtn: '続きから翻訳',
  restartBtn: '最初から',
  streamErrPrefix: '翻訳ストリームエラー',
  retryBtn: '再試行',
  overviewChip: '✦ 要点まとめ',
  overviewTitle: '論文の要点 & Contribution',
  overviewLoading: '論文全体（要旨・序論・手法・結論）から要点と主な Contribution を作成しています...',
  tldrLabel: '一行要約 (TL;DR)',
  contribLabel: '主な Contribution',
  problemLabel: '課題設定',
  methodLabel: '提案手法',
  resultsLabel: '主な成果',
  skeletonWait: '翻訳が完了した文からリアルタイムで表示されます...',
  noSentences: '表示する文がありません。',
  sentenceCount: (n) => `${n}文`,
  zoomImage: '拡大表示',
  mediaInsightLabel: (k) =>
    k === 'table' ? '著者がこの表で主張したい核心' : '著者がこの図で主張したい核心',
  mediaInsightBtn: (k) =>
    k === 'table' ? '著者がこの表で主張したい核心を見る' : '著者がこの図で主張したい核心を見る',
  mediaInsightLoading: '本文の言及箇所と図内数値から著者の主張を整理しています...',
  citHeader: '引用論文の情報',
  citLoadingMeta: '書誌情報と arXiv 原文PDFを確認しています...',
  etAl: (n) => ` ほか${n}名`,
  fulltextReady: '原文PDF取得可',
  abstractReady: '要旨取得済み',
  bibOnly: '書誌テキスト',
  goPaperArxiv: '論文ページへ (arXiv)',
  goPaper: '論文ページへ',
  rawPdfBtn: '原文PDF',
  openInNewTab: 'PaperView新タブで開く',
  quickSummaryBtn: '簡単要約を見る',
  quickSummaryHint: (m, full) => `${m} モデルで${full ? '原文PDFとMain Figure' : '要旨と引用文脈'}を読み取り要約します。閉じても完了時に右上で通知します。`,
  summarizingTitle: (rk) => `[${rk}]番の引用論文を読み取り要約中...`,
  summarizingBody: 'ウィンドウを閉じて本文を読み続けてもバックグラウンドで進行し、完了時に右上で通知します。',
  closeKeepReading: '閉じて本文を読み続ける',
  mainFigTitle: '引用論文の Main Figure',
  keyPointsLabel: '主な内容',
  whyCitedLabel: '本論文で引用されている理由',
  citingLocs: (n) => `本文内の引用箇所 (${n}箇所)`,
  rawRefToggle: 'References 原文表記を見る',
  chatTitle: '論文 Q&A',
  concise: '簡潔',
  detailed: '詳細',
  clearChat: '履歴を消去',
  chatWelcomeTitle: '論文全体を踏まえて質問してみましょう',
  chatWelcomeSub: '本文、数式、Figure・Table キャプション、参考文献が自動的にコンテキストに含まれます。',
  quickPrompts: [
    '主要な Contribution を3行で要約して',
    '提案手法(Method)の核心フローを簡潔に教えて',
    '既存ベースラインに対する主な実験的強みは？',
    '本研究の主な限界や前提条件を短く指摘して',
  ],
  writingReply: '論文内容に基づき回答を作成中...',
  pinToggle: (t) => `選択中の ${t} を質問に添付`,
  chatPlaceholder: '論文について質問を入力 (Enterで送信、Shift+Enterで改行)',
  queueTitle: '予約・連続自動翻訳キュー (Queue)',
  queueSub: '複数の論文を登録しておけば、要点まとめから全文翻訳まで順番に自動実行されます',
  qPaused: '⏸ 一時停止中',
  qScheduled: (lbl) => `🌙 ${lbl} 開始予約済み`,
  qRunning: '順次自動翻訳中',
  qIdle: '待機中 (追加すると即時開始)',
  qAutoRetry: '利用上限に達した場合、リセット後に自動再開する',
  qStartNow: '今すぐ開始',
  qPauseBtn: 'キュー停止',
  qClearDone: '完了分を整理',
  qScheduleLabel: '就寝・外出の開始予約時刻:',
  qSetSchedule: '予約設定',
  qClearSchedule: '予約解除',
  qDropTitle: '複数のPDF論文を一括追加',
  qDropSub: 'クリックして複数選択するか、ここにドラッグ＆ドロップ',
  qUrlPlaceholder: '複数の arXiv ID または PDF URL を入力 (カンマ・改行区切り、例: 1706.03762)',
  qForceRetranslate: '翻訳済みの論文も最初から再翻訳する',
  qAddBtn: 'キューに追加',
  qAdding: '追加中...',
  qAddCurrent: (t) => `+ 現在開いている論文を追加 (${t})`,
  qAddUnfinished: (n) => `+ 未完了の履歴論文 ${n}件を一括追加`,
  qListHeader: (n) => `待機リスト (${n}件)`,
  qEmpty: '登録された論文はありません。就寝前に読みたいPDFを複数入れておけば朝までに自動完了します。',
  qStatusRunning: (pct) => `翻訳中 (${pct}%)`,
  qStatusQueued: (pct) => (pct > 0 ? `待機中 (${pct}%完了)` : '待機中'),
  qStatusQuota: '枠リセット待機中',
  qStatusDone: '完了',
  qStatusError: 'エラー',
};

const ZH_CN: UiStrings = {
  ...EN,
  homeTitle: '返回首页',
  openPdf: '打开 PDF',
  arxivPlaceholder: 'arXiv ID 或 PDF 链接 (如: 1706.03762)',
  openBtn: '打开',
  recentBtn: (n) => `最近 (${n})`,
  recentHeader: '最近打开的论文',
  paperMeta: (p, s, r) => `${p}页 · ${s}句 · 引用 ${r}`,
  langMenuHeader: 'AI 翻译总结与界面语言',
  dropOverlayText: '将论文 PDF 拖放到此处，即可开始 AI 核心总结与实时全文翻译',
  modelCurrent: '当前模型:',
  modelDetected: '最近响应模型 ID:',
  authMethod: '认证方式:',
  authZeroApi: '本地订阅登录 ($0 额外 API 费用)',
  reasoningEffort: '推理强度 (Reasoning Effort)',
  selectModelHeader: (p, n) => `可选 ${p} 模型 (${n})`,
  refreshModelsTitle: '刷新可用模型列表',
  close: '关闭',
  remainingQuotaBtn: (pct) => (pct !== null ? `剩余额度 ${pct}%` : '查看用量'),
  usageHeader: 'AI 订阅用量与剩余额度',
  usageZeroApi: '零按量 API 扣费',
  pctRemaining: (pct) => `剩余 ${pct}%`,
  pctUsed: (pct) => `已用 ${pct}%`,
  resetsAt: (t) => `重置: ${t}`,
  usageLoading: '正在从本地 CLI 查询剩余额度...',
  usageEmptyHint: '点击右上角刷新按钮查看当前订阅会话剩余额度。',
  sessionRequests: (n) => `本次运行请求 ${n} 次`,
  checkedAt: (t) => `查询时间 ${t}`,
  queueBtn: '翻译队列',
  alertsBtn: '总结通知',
  alertsHeader: '引文总结通知',
  alertsEmpty: '点击引用编号并选择 [查看简要总结] 后，即使关闭面板也会在此提示完成。',
  alertRunning: (rk) => `正在总结引文 [${rk}]...`,
  alertDone: (rk) => `✨ 引文 [${rk}] 总结已完成！`,
  alertError: (rk) => `引文 [${rk}] 总结失败`,
  viewBtn: '查看',
  bgRunningPill: (n) => `后台引文总结进行中 (${n})`,
  paperChatBtn: '论文对话',
  askPaperFab: '向论文提问',
  togglePdfTitle: (shown) => (shown ? '隐藏左侧 PDF' : '显示左侧 PDF'),
  toggleThemeTitle: (dark) => (dark ? '切换浅色模式' : '切换深色模式'),
  loadingPdfTitle: '正在解析论文 PDF 版面与图表结构...',
  loadingPdfSub: '即将开始 AI 核心贡献总结与逐节实时翻译',
  heroBadge: '核心总结先行 · 单/双栏与图表自动识别 · 多语言实时精读',
  heroTitle: '导入论文，即刻生成核心贡献总结与逐句学术精译',
  heroSub: '按页自动识别单栏(NeurIPS/ICLR)与双栏(IEEE/CVPR)排版及图表，引文支持 arXiv 标题优先检索与后台主图总结。',
  uploadCardTitle: '打开本地 PDF 论文',
  uploadCardSub: '点击选择文件，或将 PDF 直接拖放到屏幕任意位置',
  arxivCardTitle: '通过 arXiv ID 或链接开始',
  arxivCardPlaceholder: '例如: 1706.03762 或 https://arxiv.org/abs/...',
  importBtn: '导入',
  sampleLabel: '快速体验示例论文:',
  pdfViewerTitle: '原文 PDF 视图',
  zoomOut: '缩小',
  zoomIn: '放大',
  fitWidth: '适应面板宽度',
  pdfPreparing: '正在渲染 PDF...',
  syncTooltip: '点击与右侧译文同步定位',
  searchPlaceholder: '搜索原文或译文...',
  modelLabel: '模型',
  showTransBtn: '显示译文',
  onlyOrigBtn: '仅看英文原文',
  retranslateTitle: '使用当前模型与语言重新翻译',
  streamOverviewWait: 'AI 正在优先提炼论文核心总结与 Contribution...',
  streamSectionsStart: '核心总结已完成！正在开始逐节实时翻译...',
  streamProgress: (sec, c, pct) => `实时翻译中 — ${sec} (已完成 ${c} 句 · ${pct}%)`,
  pauseBtn: '暂停',
  pausedMsg: (c, pct) => `翻译已暂停 (已完成 ${c} 句 · ${pct}%)`,
  resumeBtn: '继续翻译',
  restartBtn: '重新开始',
  streamErrPrefix: '流式翻译出错',
  retryBtn: '继续重试',
  overviewChip: '✦ 核心总结',
  overviewTitle: '论文核心总结 & Contribution',
  overviewLoading: '正在结合摘要、引言、方法与结论优先生成核心总结与主要贡献...',
  tldrLabel: '一句话核心总结',
  contribLabel: '主要 Contribution',
  problemLabel: '问题定义',
  methodLabel: '核心方法',
  resultsLabel: '主要成果',
  skeletonWait: '每完成一句翻译将立即在此实时呈现...',
  noSentences: '暂无可显示的句子。',
  sentenceCount: (n) => `${n}句`,
  zoomImage: '查看大图',
  mediaInsightLabel: (k) =>
    k === 'table' ? '作者通过此表想表达的核心主张' : '作者通过此图想表达的核心主张',
  mediaInsightBtn: (k) =>
    k === 'table' ? '查看作者在此表中的核心主张' : '查看作者在此图中的核心主张',
  mediaInsightLoading: '正在结合正文论述与图内数据提炼作者的核心主张...',
  citHeader: '引用论文信息',
  citLoadingMeta: '正在检索题录信息与 arXiv 原文 PDF...',
  etAl: (n) => ` 等 ${n} 人`,
  fulltextReady: '可获取原文 PDF',
  abstractReady: '已获取摘要',
  bibOnly: '题录文本',
  goPaperArxiv: '前往论文主页 (arXiv)',
  goPaper: '前往论文主页',
  rawPdfBtn: '原文 PDF',
  openInNewTab: '在 PaperView 新标签页打开',
  quickSummaryBtn: '查看简要总结',
  quickSummaryHint: (m, full) => `使用 ${m} 分析${full ? '原文 PDF 与 Main Figure' : '摘要与引用语境'}。关闭面板后仍会在后台继续，完成后右上角提醒。`,
  summarizingTitle: (rk) => `正在阅读并总结引文 [${rk}]...`,
  summarizingBody: '您可以关闭此窗口继续阅读正文，后台完成后将在右上角弹出通知。',
  closeKeepReading: '关闭并继续阅读正文',
  mainFigTitle: '引文代表图 (Main Figure)',
  keyPointsLabel: '核心要点',
  whyCitedLabel: '本文引用该论文的原因',
  citingLocs: (n) => `正文引用位置 (${n}处)`,
  rawRefToggle: '查看原始 References 条目',
  chatTitle: '论文问答 Q&A',
  concise: '精简',
  detailed: '详细',
  clearChat: '清空对话',
  chatWelcomeTitle: '基于整篇论文内容随时提问',
  chatWelcomeSub: '全文正文、公式语境、图表题注与参考文献已自动纳入上下文。',
  quickPrompts: [
    '用三句话总结这篇论文的核心贡献',
    '简要说明所提方法(Method)的核心流程',
    '相比基线模型有哪些主要实验优势？',
    '这项研究的主要局限性或假设是什么？',
  ],
  writingReply: '正在基于论文内容生成回答...',
  pinToggle: (t) => `将当前选中的 ${t} 附加到提问`,
  chatPlaceholder: '输入关于本篇论文的问题 (Enter 发送，Shift+Enter 换行)',
  queueTitle: '定时与批量自动翻译队列 (Queue)',
  queueSub: '一次添加多篇论文，按顺序自动完成核心总结与全文精译',
  qPaused: '⏸ 已暂停',
  qScheduled: (lbl) => `🌙 已预约 ${lbl} 开始`,
  qRunning: '正在顺序翻译',
  qIdle: '空闲中 (添加后立即开始)',
  qAutoRetry: '达到订阅限额时等待重置后自动续译',
  qStartNow: '立即开始',
  qPauseBtn: '暂停队列',
  qClearDone: '清理已完成',
  qScheduleLabel: '夜间/预约开始时间:',
  qSetSchedule: '设置预约',
  qClearSchedule: '取消预约',
  qDropTitle: '批量添加多篇 PDF 论文',
  qDropSub: '点击选择多个文件，或直接拖放到此处',
  qUrlPlaceholder: '输入多个 arXiv ID 或 PDF 链接 (逗号或换行分隔，如 1706.03762)',
  qForceRetranslate: '已翻译论文也从头重新翻译',
  qAddBtn: '加入队列',
  qAdding: '添加中...',
  qAddCurrent: (t) => `+ 将当前打开的论文加入队列 (${t})`,
  qAddUnfinished: (n) => `+ 一键加入 ${n} 篇未完成论文`,
  qListHeader: (n) => `队列列表 (${n})`,
  qEmpty: '队列为空。睡前放入多篇想读的 PDF 论文，醒来即可直接阅读完整总结与译文。',
  qStatusRunning: (pct) => `翻译中 (${pct}%)`,
  qStatusQueued: (pct) => (pct > 0 ? `排队中 (已完成 ${pct}%)` : '排队中'),
  qStatusQuota: '等待额度重置',
  qStatusDone: '已完成',
  qStatusError: '错误',
};

const ZH_TW: UiStrings = {
  ...ZH_CN,
  homeTitle: '返回首頁',
  openPdf: '開啟 PDF',
  arxivPlaceholder: 'arXiv ID 或 PDF 連結 (例: 1706.03762)',
  openBtn: '開啟',
  recentHeader: '最近開啟的論文',
  paperMeta: (p, s, r) => `${p}頁 · ${s}句 · 引用 ${r}`,
  langMenuHeader: 'AI 翻譯摘要與介面語言',
  dropOverlayText: '將論文 PDF 拖放到此處，即可開始 AI 核心摘要與即時全文翻譯',
  modelCurrent: '目前模型:',
  modelDetected: '最近回應模型 ID:',
  authMethod: '驗證方式:',
  authZeroApi: '本機訂閱登入 ($0 額外 API 費用)',
  reasoningEffort: '推理強度 (Reasoning Effort)',
  selectModelHeader: (p, n) => `可選 ${p} 模型 (${n})`,
  refreshModelsTitle: '重新整理模型清單',
  close: '關閉',
  remainingQuotaBtn: (pct) => (pct !== null ? `剩餘額度 ${pct}%` : '查看用量'),
  usageHeader: 'AI 訂閱用量與剩餘額度',
  usageZeroApi: '零按量 API 扣費',
  pctRemaining: (pct) => `剩餘 ${pct}%`,
  pctUsed: (pct) => `已用 ${pct}%`,
  resetsAt: (t) => `重置: ${t}`,
  usageLoading: '正在從本機 CLI 查詢剩餘額度...',
  usageEmptyHint: '點擊重新整理按鈕查看目前訂閱剩餘額度。',
  sessionRequests: (n) => `本次執行請求 ${n} 次`,
  checkedAt: (t) => `查詢時間 ${t}`,
  queueBtn: '翻譯佇列',
  alertsBtn: '摘要通知',
  alertsHeader: '引文摘要通知',
  alertsEmpty: '點擊引用編號並選擇 [查看簡要摘要] 後，關閉視窗也會在此通知完成。',
  alertRunning: (rk) => `正在摘要引文 [${rk}]...`,
  alertDone: (rk) => `✨ 引文 [${rk}] 摘要已完成！`,
  alertError: (rk) => `引文 [${rk}] 摘要失敗`,
  bgRunningPill: (n) => `背景引文摘要進行中 (${n})`,
  paperChatBtn: '論文對話',
  askPaperFab: '向論文提問',
  togglePdfTitle: (shown) => (shown ? '隱藏左側 PDF' : '顯示左側 PDF'),
  toggleThemeTitle: (dark) => (dark ? '切換淺色模式' : '切換深色模式'),
  loadingPdfTitle: '正在解析論文 PDF 版面與圖表結構...',
  loadingPdfSub: '即將開始 AI 核心貢獻摘要與逐節即時翻譯',
  heroBadge: '核心摘要先行 · 單/雙欄與圖表自動辨識 · 多語言即時精讀',
  heroTitle: '匯入論文，即刻產生核心貢獻摘要與逐句學術精譯',
  heroSub: '逐頁自動辨識單欄(NeurIPS/ICLR)與雙欄(IEEE/CVPR)排版及圖表，引文支援 arXiv 標題優先檢索與背景主圖摘要。',
  uploadCardTitle: '開啟本機 PDF 論文',
  uploadCardSub: '點擊選擇檔案，或將 PDF 拖放到畫面任意位置',
  arxivCardTitle: '透過 arXiv ID 或連結開始',
  arxivCardPlaceholder: '例如: 1706.03762 或 https://arxiv.org/abs/...',
  importBtn: '匯入',
  sampleLabel: '快速體驗範例論文:',
  pdfViewerTitle: '原文 PDF 檢視器',
  zoomOut: '縮小',
  zoomIn: '放大',
  fitWidth: '符合面板寬度',
  pdfPreparing: '正在準備 PDF...',
  syncTooltip: '點擊與右側譯文同步定位',
  searchPlaceholder: '搜尋原文或譯文...',
  showTransBtn: '顯示譯文',
  onlyOrigBtn: '僅看英文原文',
  retranslateTitle: '以目前模型與語言重新翻譯',
  streamOverviewWait: 'AI 正在優先整理論文核心摘要與 Contribution...',
  streamSectionsStart: '核心摘要完成！開始逐節即時翻譯...',
  streamProgress: (sec, c, pct) => `即時翻譯中 — ${sec} (已完成 ${c} 句 · ${pct}%)`,
  pauseBtn: '暫停',
  pausedMsg: (c, pct) => `翻譯已暫停 (已完成 ${c} 句 · ${pct}%)`,
  resumeBtn: '繼續翻譯',
  restartBtn: '重新開始',
  streamErrPrefix: '串流翻譯錯誤',
  retryBtn: '繼續重試',
  overviewChip: '✦ 核心摘要',
  overviewTitle: '論文核心摘要 & Contribution',
  overviewLoading: '正在結合摘要、引言、方法與結論優先撰寫核心摘要與主要貢獻...',
  tldrLabel: '一句話核心摘要',
  contribLabel: '主要 Contribution',
  problemLabel: '問題定義',
  methodLabel: '核心方法',
  resultsLabel: '主要成果',
  skeletonWait: '每完成一句翻譯將立即在此即時顯示...',
  noSentences: '沒有可顯示的句子。',
  zoomImage: '放大檢視',
  mediaInsightLabel: (k) =>
    k === 'table' ? '作者透過此表想表達的核心主張' : '作者透過此圖想表達的核心主張',
  mediaInsightBtn: (k) =>
    k === 'table' ? '查看作者在此表中的核心主張' : '查看作者在此圖中的核心主張',
  mediaInsightLoading: '正在結合內文論述與圖內數據整理作者的核心主張...',
  citHeader: '引用論文資訊',
  citLoadingMeta: '正在檢索書目資訊與 arXiv 原文 PDF...',
  fulltextReady: '可取得原文 PDF',
  abstractReady: '已取得摘要',
  bibOnly: '書目文字',
  goPaperArxiv: '前往論文頁面 (arXiv)',
  goPaper: '前往論文頁面',
  openInNewTab: '在 PaperView 新分頁開啟',
  quickSummaryBtn: '查看簡要摘要',
  quickSummaryHint: (m, full) => `使用 ${m} 分析${full ? '原文 PDF 與 Main Figure' : '摘要與引用脈絡'}。關閉面板後仍會在背景繼續，完成時於右上角通知。`,
  summarizingTitle: (rk) => `正在閱讀並摘要引文 [${rk}]...`,
  summarizingBody: '您可以關閉視窗繼續閱讀內文，背景完成後將在右上角彈出通知。',
  closeKeepReading: '關閉並繼續閱讀內文',
  mainFigTitle: '引文代表圖 (Main Figure)',
  keyPointsLabel: '核心要點',
  whyCitedLabel: '本文引用該論文的原因',
  citingLocs: (n) => `內文引用位置 (${n}處)`,
  rawRefToggle: '檢視原始 References 條目',
  chatTitle: '論文問答 Q&A',
  concise: '精簡',
  detailed: '詳細',
  clearChat: '清除對話',
  chatWelcomeTitle: '基於整篇論文內容隨時提問',
  chatWelcomeSub: '全文內文、公式脈絡、圖表說明與參考文獻皆自動納入上下文。',
  quickPrompts: [
    '用三句話總結這篇論文的核心貢獻',
    '簡要說明所提方法(Method)的核心流程',
    '相比基線模型有哪些主要實驗優勢？',
    '這項研究的主要限制或假設是什麼？',
  ],
  writingReply: '正在根據論文內容撰寫回答...',
  pinToggle: (t) => `將目前選取的 ${t} 附加到提問`,
  chatPlaceholder: '輸入關於本篇論文的問題 (Enter 送出，Shift+Enter 換行)',
  queueTitle: '預約與批次自動翻譯佇列 (Queue)',
  queueSub: '一次加入多篇論文，依序自動完成核心摘要與全文精譯',
  qPaused: '⏸ 已暫停',
  qScheduled: (lbl) => `🌙 已預約 ${lbl} 開始`,
  qRunning: '正在依序翻譯',
  qIdle: '待機中 (加入後立即開始)',
  qAutoRetry: '達到訂閱上限時等待重置後自動續譯',
  qStartNow: '立即開始',
  qPauseBtn: '暫停佇列',
  qClearDone: '清理已完成',
  qScheduleLabel: '睡前/預約開始時間:',
  qSetSchedule: '設定預約',
  qClearSchedule: '取消預約',
  qDropTitle: '批次加入多篇 PDF 論文',
  qDropSub: '點擊選擇多個檔案，或直接拖放到此處',
  qUrlPlaceholder: '輸入多個 arXiv ID 或 PDF 連結 (逗號或換行分隔，例 1706.03762)',
  qForceRetranslate: '已翻譯論文也從頭重新翻譯',
  qAddBtn: '加入佇列',
  qAdding: '加入中...',
  qAddCurrent: (t) => `+ 將目前開啟的論文加入佇列 (${t})`,
  qAddUnfinished: (n) => `+ 一鍵加入 ${n} 篇未完成論文`,
  qListHeader: (n) => `佇列清單 (${n})`,
  qEmpty: '佇列目前為空。睡前放入多篇想讀的 PDF 論文，醒來即可閱讀完整摘要與譯文。',
  qStatusRunning: (pct) => `翻譯中 (${pct}%)`,
  qStatusQueued: (pct) => (pct > 0 ? `排隊中 (已完成 ${pct}%)` : '排隊中'),
  qStatusQuota: '等待額度重置',
  qStatusDone: '已完成',
  qStatusError: '錯誤',
};

const ES: UiStrings = {
  ...EN,
  homeTitle: 'Volver al inicio',
  openPdf: 'Abrir PDF',
  arxivPlaceholder: 'ID de arXiv o URL PDF (ej. 1706.03762)',
  openBtn: 'Abrir',
  recentBtn: (n) => `Recientes (${n})`,
  recentHeader: 'Artículos recientes',
  langMenuHeader: 'Idioma de IA e interfaz',
  dropOverlayText: 'Suelta un PDF aquí para iniciar el resumen clave y la traducción en tiempo real',
  close: 'Cerrar',
  remainingQuotaBtn: (pct) => (pct !== null ? `Cuota ${pct}%` : 'Uso'),
  queueBtn: 'Cola',
  alertsBtn: 'Alertas',
  paperChatBtn: 'Chat',
  askPaperFab: 'Preguntar al artículo',
  heroBadge: 'Resumen Clave Primero · Detección 1/2 Columnas y Figuras · Lector IA Multilingüe',
  heroTitle: 'Abre cualquier artículo y obtén contribuciones clave y traducción académica en vivo',
  uploadCardTitle: 'Abrir PDF local',
  uploadCardSub: 'Haz clic o arrastra y suelta un archivo PDF en cualquier parte',
  arxivCardTitle: 'Importar desde arXiv o URL',
  importBtn: 'Importar',
  sampleLabel: 'Probar artículo de ejemplo:',
  pdfViewerTitle: 'PDF Original',
  searchPlaceholder: 'Buscar en original o traducción...',
  showTransBtn: 'Mostrar traducción',
  onlyOrigBtn: 'Solo original',
  pauseBtn: 'Pausar',
  resumeBtn: 'Reanudar',
  restartBtn: 'Reiniciar',
  overviewChip: '✦ Resumen Clave',
  overviewTitle: 'Resumen Clave y Contribuciones',
  tldrLabel: 'Resumen en una línea (TL;DR)',
  contribLabel: 'Contribuciones Clave',
  problemLabel: 'Problema',
  methodLabel: 'Método Propuesto',
  resultsLabel: 'Resultados Clave',
  mediaInsightLabel: (k) =>
    k === 'table' ? 'Idea clave de los autores en esta tabla' : 'Idea clave de los autores en esta figura',
  mediaInsightBtn: () => 'Ver qué quieren demostrar los autores',
  citHeader: 'Información de la Cita',
  quickSummaryBtn: 'Ver Resumen Rápido',
  closeKeepReading: 'Cerrar y seguir leyendo',
  keyPointsLabel: 'Puntos Clave',
  whyCitedLabel: 'Por qué se cita aquí',
  concise: 'Conciso',
  detailed: 'Detallado',
  quickPrompts: [
    'Resume las 3 contribuciones principales',
    'Explica brevemente el flujo del método propuesto',
    '¿Cuáles son las ventajas experimentales frente a los baselines?',
    '¿Cuáles son las principales limitaciones o supuestos?',
  ],
};

const DE: UiStrings = {
  ...EN,
  homeTitle: 'Zur Startseite',
  openPdf: 'PDF öffnen',
  arxivPlaceholder: 'arXiv-ID oder PDF-URL (z. B. 1706.03762)',
  openBtn: 'Öffnen',
  recentBtn: (n) => `Zuletzt (${n})`,
  recentHeader: 'Zuletzt geöffnete Paper',
  langMenuHeader: 'KI-Ausgabe- & UI-Sprache',
  dropOverlayText: 'PDF hier ablegen, um Kernaussagen & Echtzeit-Übersetzung zu starten',
  close: 'Schließen',
  remainingQuotaBtn: (pct) => (pct !== null ? `Kontingent ${pct}%` : 'Nutzung'),
  queueBtn: 'Warteschlange',
  alertsBtn: 'Hinweise',
  paperChatBtn: 'Paper-Chat',
  askPaperFab: 'Paper fragen',
  heroBadge: 'Kernaussagen zuerst · 1-/2-Spalten & Abbildungen · Mehrsprachiger KI-Reader',
  heroTitle: 'PDF öffnen für sofortige Key Contributions & wissenschaftliche Echtzeit-Übersetzung',
  uploadCardTitle: 'Lokales PDF öffnen',
  uploadCardSub: 'Klicken oder PDF-Datei einfach per Drag & Drop ablegen',
  arxivCardTitle: 'Per arXiv-ID oder URL starten',
  importBtn: 'Laden',
  sampleLabel: 'Beispiel-Paper öffnen:',
  pdfViewerTitle: 'Original-PDF',
  searchPlaceholder: 'Original oder Übersetzung durchsuchen...',
  showTransBtn: 'Übersetzung anzeigen',
  onlyOrigBtn: 'Nur Original',
  pauseBtn: 'Pause',
  resumeBtn: 'Fortsetzen',
  restartBtn: 'Neu starten',
  overviewChip: '✦ Kernaussagen',
  overviewTitle: 'Kernaussagen & Contributions',
  tldrLabel: 'Kurzfassung (TL;DR)',
  contribLabel: 'Wichtigste Contributions',
  problemLabel: 'Problemstellung',
  methodLabel: 'Methode',
  resultsLabel: 'Ergebnisse',
  mediaInsightLabel: (k) =>
    k === 'table' ? 'Kernaussage der Autoren zu dieser Tabelle' : 'Kernaussage der Autoren zu dieser Abbildung',
  mediaInsightBtn: () => 'Kernaussage der Autoren anzeigen',
  citHeader: 'Zitierte Arbeit',
  quickSummaryBtn: 'Kurzzusammenfassung',
  closeKeepReading: 'Schließen & weiterlesen',
  keyPointsLabel: 'Kernpunkte',
  whyCitedLabel: 'Warum hier zitiert',
  concise: 'Kompakt',
  detailed: 'Detailliert',
  quickPrompts: [
    'Fasse die 3 wichtigsten Contributions kurz zusammen',
    'Erkläre kurz den Kernablauf der vorgeschlagenen Methode',
    'Was sind die wichtigsten experimentellen Vorteile gegenüber Baselines?',
    'Welche Einschränkungen oder Annahmen hat diese Arbeit?',
  ],
};

const FR: UiStrings = {
  ...EN,
  homeTitle: "Retour à l'accueil",
  openPdf: 'Ouvrir un PDF',
  arxivPlaceholder: 'ID arXiv ou URL PDF (ex. 1706.03762)',
  openBtn: 'Ouvrir',
  recentBtn: (n) => `Récents (${n})`,
  recentHeader: 'Articles récents',
  langMenuHeader: "Langue de l'IA et de l'interface",
  dropOverlayText: 'Déposez un PDF ici pour lancer la synthèse clé et la traduction en direct',
  close: 'Fermer',
  remainingQuotaBtn: (pct) => (pct !== null ? `Quota ${pct}%` : 'Usage'),
  queueBtn: "File d'attente",
  alertsBtn: 'Alertes',
  paperChatBtn: 'Chat Article',
  askPaperFab: 'Poser une question',
  heroBadge: 'Synthèse Clé en Premier · Détection 1/2 Colonnes & Figures · Lecteur IA Multilingue',
  heroTitle: 'Importez un article pour obtenir ses contributions clés et sa traduction scientifique en direct',
  uploadCardTitle: 'Ouvrir un PDF local',
  uploadCardSub: 'Cliquez ou glissez-déposez un fichier PDF sur cette page',
  arxivCardTitle: 'Démarrer via arXiv ou URL',
  importBtn: 'Importer',
  sampleLabel: 'Essayer un article exemple :',
  pdfViewerTitle: 'PDF Original',
  searchPlaceholder: 'Rechercher dans le texte ou la traduction...',
  showTransBtn: 'Afficher la traduction',
  onlyOrigBtn: 'Original uniquement',
  pauseBtn: 'Pause',
  resumeBtn: 'Reprendre',
  restartBtn: 'Recommencer',
  overviewChip: '✦ Synthèse Clé',
  overviewTitle: 'Synthèse Clé & Contributions',
  tldrLabel: 'Résumé en une phrase (TL;DR)',
  contribLabel: 'Contributions Clés',
  problemLabel: 'Problématique',
  methodLabel: 'Méthode Proposée',
  resultsLabel: 'Résultats Clés',
  mediaInsightLabel: (k) =>
    k === 'table' ? 'Argument clé des auteurs (Tableau)' : 'Argument clé des auteurs (Figure)',
  mediaInsightBtn: () => "Voir l'argument clé des auteurs",
  citHeader: 'Article Cité',
  quickSummaryBtn: 'Résumé Rapide',
  closeKeepReading: 'Fermer et continuer la lecture',
  keyPointsLabel: 'Points Clés',
  whyCitedLabel: 'Pourquoi cité dans cet article',
  concise: 'Concis',
  detailed: 'Détaillé',
  quickPrompts: [
    'Résume les 3 contributions principales en bref',
    'Explique brièvement le fonctionnement de la méthode proposée',
    'Quels sont les gains expérimentaux face aux baselines ?',
    'Quelles sont les principales limites ou hypothèses ?',
  ],
};

export const UI_TRANSLATIONS: Record<LangCode, UiStrings> = {
  ko: KO,
  en: EN,
  ja: JA,
  'zh-CN': ZH_CN,
  'zh-TW': ZH_TW,
  es: ES,
  de: DE,
  fr: FR,
};

export function getUiStrings(lang: string): UiStrings {
  if (lang in UI_TRANSLATIONS) {
    return UI_TRANSLATIONS[lang as LangCode];
  }
  return KO;
}
