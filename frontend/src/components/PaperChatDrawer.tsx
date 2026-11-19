import React, { useEffect, useRef, useState } from 'react';
import {
  MessageSquare,
  Send,
  Trash2,
  X,
  Pin,
  Square,
  Sparkles,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import {
  clearPaperChatHistory,
  fetchPaperChatHistory,
  streamPaperChatMessage,
} from '../api';
import type { ChatMessage, SentenceItem } from '../types';
import { renderMathText } from '../utils/mathRenderer';

interface PaperChatDrawerProps {
  paperId: string;
  paperTitle: string;
  width: number;
  isWide: boolean;
  onStartResize: (e: React.MouseEvent) => void;
  onToggleWide: () => void;
  selectedEngine: string;
  selectedModelLabel?: string;
  activeSentence: SentenceItem | null;
  knownRefKeys: Set<string>;
  onClose: () => void;
  onClickCitationInChat: (refKey: string) => void;
  onChatTurnCompleted?: () => void;
}

const QUICK_PROMPTS = [
  '핵심 Contribution 3줄 요약해줘',
  '제안 방법론(Method) 핵심 흐름만 간단히 설명해줘',
  '기존 베이스라인 대비 주요 실험 강점은 뭐야?',
  '이 연구의 주요 한계점이나 가정을 짧게 짚어줘',
];

function renderInlineRich(
  text: string,
  knownRefKeys: Set<string>,
  onClickCitation: (rk: string) => void
): React.ReactNode {
  // Tokenize math spans first so * or [1] inside $...$ are preserved for KaTeX
  const tokenRe =
    /(\$\$[\s\S]+?\$\$|(?<!\\|\$)\$(?!\$)(?!\s)(?:\\.|[^$\\\n])+?(?<!\s)\$(?!\$|[0-9])|`[^`]+`|\*\*[^*]+\*\*|\[\d{1,3}(?:\s*,\s*\d{1,3})*\])/g;
  const parts = text.split(tokenRe);

  return parts.map((part, idx) => {
    if (!part) return null;
    if (
      (part.startsWith('$$') && part.endsWith('$$')) ||
      (part.startsWith('$') && part.endsWith('$') && part.length >= 3)
    ) {
      return <React.Fragment key={idx}>{renderMathText(part, `cm_${idx}`)}</React.Fragment>;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={idx} className="chat-inline-code">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={idx}>{renderMathText(part.slice(2, -2), `cb_${idx}`)}</strong>;
    }
    const citMatch = part.match(/^\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]$/);
    if (citMatch) {
      const nums = citMatch[1]
        .split(',')
        .map((s) => s.trim())
        .filter((k) => knownRefKeys.has(k));
      if (nums.length > 0) {
        return (
          <span key={idx} className="inline-cite-group">
            {nums.map((rk, subIdx) => (
              <button
                key={`${rk}_${subIdx}`}
                type="button"
                className="inline-cite-pill"
                onClick={() => onClickCitation(rk)}
                title={`인용 논문 [${rk}] 정보 보기`}
              >
                [{rk}]
              </button>
            ))}
          </span>
        );
      }
    }
    return <span key={idx}>{renderMathText(part, `cp_${idx}`)}</span>;
  });
}

function renderChatMarkdown(
  content: string,
  knownRefKeys: Set<string>,
  onClickCitation: (rk: string) => void
): React.ReactNode {
  const blocks = content.split(/(```[\s\S]*?```|\$\$[\s\S]*?\$\$)/g);
  return blocks.map((blk, bIdx) => {
    if (blk.startsWith('```') && blk.endsWith('```')) {
      const inner = blk.replace(/^```[a-zA-Z0-9_-]*\n?/, '').replace(/```$/, '');
      return (
        <pre key={bIdx} className="chat-code-block">
          <code>{inner}</code>
        </pre>
      );
    }
    if (blk.startsWith('$$') && blk.endsWith('$$')) {
      return (
        <div key={bIdx} className="pv-math-block-wrap">
          {renderMathText(blk, `cdb_${bIdx}`)}
        </div>
      );
    }

    const lines = blk.split('\n');
    const elements: React.ReactNode[] = [];
    let listItems: React.ReactNode[] = [];

    const flushList = (keySuffix: number) => {
      if (listItems.length > 0) {
        elements.push(
          <ul key={`ul_${bIdx}_${keySuffix}`} className="chat-md-list">
            {listItems}
          </ul>
        );
        listItems = [];
      }
    };

    lines.forEach((rawLine, lIdx) => {
      const line = rawLine.trim();
      if (!line) {
        flushList(lIdx);
        return;
      }

      if (line.startsWith('### ')) {
        flushList(lIdx);
        elements.push(
          <h4 key={`h4_${lIdx}`} className="chat-md-h">
            {renderInlineRich(line.slice(4), knownRefKeys, onClickCitation)}
          </h4>
        );
      } else if (line.startsWith('## ') || line.startsWith('# ')) {
        flushList(lIdx);
        const cleanH = line.replace(/^#+\s+/, '');
        elements.push(
          <h4 key={`h3_${lIdx}`} className="chat-md-h">
            {renderInlineRich(cleanH, knownRefKeys, onClickCitation)}
          </h4>
        );
      } else if (/^[-*•]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
        const itemBody = line.replace(/^(?:[-*•]|\d+\.)\s+/, '');
        listItems.push(
          <li key={`li_${lIdx}`}>
            {renderInlineRich(itemBody, knownRefKeys, onClickCitation)}
          </li>
        );
      } else {
        flushList(lIdx);
        elements.push(
          <p key={`p_${lIdx}`} className="chat-md-p">
            {renderInlineRich(line, knownRefKeys, onClickCitation)}
          </p>
        );
      }
    });

    flushList(lines.length);
    return <React.Fragment key={bIdx}>{elements}</React.Fragment>;
  });
}

export const PaperChatDrawer: React.FC<PaperChatDrawerProps> = ({
  paperId,
  paperTitle,
  width,
  isWide,
  onStartResize,
  onToggleWide,
  selectedEngine,
  selectedModelLabel,
  activeSentence,
  knownRefKeys,
  onClose,
  onClickCitationInChat,
  onChatTurnCompleted,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputVal, setInputVal] = useState('');
  const [responseStyle, setResponseStyle] = useState<'concise' | 'detailed'>('concise');
  const [attachSelected, setAttachSelected] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamingReply, setStreamingReply] = useState('');
  const [streamingModel, setStreamingModel] = useState('');
  const [chatError, setChatError] = useState<string | null>(null);

  const scrollBottomRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setChatError(null);
    setStreamingReply('');
    fetchPaperChatHistory(paperId)
      .then(setMessages)
      .catch(() => setMessages([]));
    return () => {
      abortRef.current?.abort();
    };
  }, [paperId]);

  useEffect(() => {
    scrollBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingReply]);

  const handleSend = async (presetQuestion?: string) => {
    const question = (presetQuestion ?? inputVal).trim();
    if (!question || streaming) return;

    const contextSnippet =
      attachSelected && activeSentence
        ? `[p.${activeSentence.page} | ${activeSentence.section}] ${activeSentence.text}`
        : null;

    if (!presetQuestion) {
      setInputVal('');
    }
    setAttachSelected(false);
    setChatError(null);
    setStreaming(true);
    setStreamingReply('');
    setStreamingModel('');

    const optimisticUser: ChatMessage = {
      id: `temp_${Date.now()}`,
      role: 'user',
      content: question,
      context_snippet: contextSnippet,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUser]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamPaperChatMessage({
        paperId,
        message: question,
        contextSnippet,
        engine: selectedEngine,
        responseStyle,
        signal: controller.signal,
        onUserSaved: (savedUser) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === optimisticUser.id ? savedUser : m))
          );
        },
        onModel: (_eng, mod) => {
          setStreamingModel(mod);
        },
        onDelta: (delta) => {
          setStreamingReply((prev) => prev + delta);
        },
        onDone: (assistantMsg) => {
          setStreamingReply('');
          setMessages((prev) => [...prev, assistantMsg]);
          onChatTurnCompleted?.();
        },
      });
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setChatError(err?.message || '답변 생성 중 오류가 발생했습니다.');
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const handleClear = async () => {
    if (streaming) {
      abortRef.current?.abort();
    }
    try {
      await clearPaperChatHistory(paperId);
      setMessages([]);
      setStreamingReply('');
      setChatError(null);
    } catch (err: any) {
      setChatError(err?.message || '대화 초기화 실패');
    }
  };

  return (
    <>
      <div
        className="chat-split-resizer"
        onMouseDown={onStartResize}
        title="좌우로 드래그하여 논문 채팅 창 너비 조절"
      />
      <aside
        className="paper-chat-panel"
        style={{ width: `${width}px` }}
        aria-label="논문 AI 채팅"
      >
        <div className="chat-panel-header">
          <div className="chat-header-title">
            <MessageSquare size={15} className="sec-icon" />
            <span>논문 Q&A</span>
            {selectedModelLabel && (
              <span className="chat-model-pill" title={selectedModelLabel}>
                {selectedModelLabel}
              </span>
            )}
          </div>

          <div className="row-center" style={{ gap: 4 }}>
            <div className="chat-style-switch" title="답변 길이 모드 선택 (기본: 간결)">
              <button
                type="button"
                className={responseStyle === 'concise' ? 'active' : ''}
                onClick={() => setResponseStyle('concise')}
              >
                간결
              </button>
              <button
                type="button"
                className={responseStyle === 'detailed' ? 'active' : ''}
                onClick={() => setResponseStyle('detailed')}
              >
                상세
              </button>
            </div>

            <button
              type="button"
              className="icon-btn"
              title={isWide ? '기본 너비로 축소' : '채팅 창 넓게 펼치기'}
              onClick={onToggleWide}
            >
              {isWide ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>

            {messages.length > 0 && (
              <button
                type="button"
                className="icon-btn"
                title="대화 내역 비우기"
                onClick={handleClear}
              >
                <Trash2 size={14} />
              </button>
            )}
            <button type="button" className="icon-btn" title="채팅 패널 닫기" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>

      <div className="chat-messages-area">
        {messages.length === 0 && !streaming && (
          <div className="chat-empty-welcome">
            <div className="chat-welcome-icon">
              <Sparkles size={20} />
            </div>
            <h4>현재 논문 전체를 바탕으로 질문해 보세요</h4>
            <p title={paperTitle}>
              본문 전체, 수식 문맥, Figure·Table 캡션, 참고문헌이 자동으로 컨텍스트에 포함됩니다.
            </p>
            <div className="chat-starter-chips">
              {QUICK_PROMPTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  className="chat-starter-btn"
                  onClick={() => handleSend(q)}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`chat-bubble-row ${m.role}`}>
            <div className={`chat-bubble ${m.role}`}>
              {m.context_snippet && (
                <div className="chat-pinned-quote">{m.context_snippet}</div>
              )}

              {m.role === 'user' ? (
                <div className="chat-user-text">{m.content}</div>
              ) : (
                <>
                  <div className="chat-md-body">
                    {renderChatMarkdown(m.content, knownRefKeys, onClickCitationInChat)}
                  </div>
                  {m.model_name && (
                    <div className="chat-bubble-meta">
                      {m.engine === 'codex'
                        ? 'Codex'
                        : m.engine === 'antigravity'
                        ? 'Antigravity'
                        : 'Claude'}{' '}
                      · {m.model_name}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ))}

        {streaming && (
          <div className="chat-bubble-row assistant">
            <div className="chat-bubble assistant streaming">
              {streamingReply ? (
                <div className="chat-md-body">
                  {renderChatMarkdown(streamingReply, knownRefKeys, onClickCitationInChat)}
                </div>
              ) : (
                <div className="row-center" style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                  <div className="spinner-ring tiny" />
                  <span>논문 내용을 바탕으로 답변을 작성하는 중...</span>
                </div>
              )}
              {streamingModel && (
                <div className="chat-bubble-meta">실시간 생성 중 · {streamingModel}</div>
              )}
            </div>
          </div>
        )}

        {chatError && <div className="pane-error">{chatError}</div>}
        <div ref={scrollBottomRef} />
      </div>

      {/* Input Footer */}
      <div className="chat-input-footer">
        {activeSentence && (
          <div className="chat-context-bar">
            {!attachSelected ? (
              <button
                type="button"
                className="pin-context-toggle"
                onClick={() => setAttachSelected(true)}
                title={activeSentence.text}
              >
                <Pin size={11} />
                <span>
                  현재 선택한 {activeSentence.media_label || `문장(p.${activeSentence.page})`} 질문에
                  첨부하기
                </span>
              </button>
            ) : (
              <div className="pinned-context-active">
                <span className="pinned-text">
                  📌 p.{activeSentence.page}: {activeSentence.text.slice(0, 58)}
                  {activeSentence.text.length > 58 ? '...' : ''}
                </span>
                <button
                  type="button"
                  onClick={() => setAttachSelected(false)}
                  title="첨부 해제"
                >
                  <X size={12} />
                </button>
              </div>
            )}
          </div>
        )}

        <form
          className="chat-composer-row"
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
        >
          <textarea
            rows={2}
            placeholder="논문에 대해 궁금한 점을 질문하세요 (Enter 전송, Shift+Enter 줄바꿈)"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          {streaming ? (
            <button
              type="button"
              className="chat-send-btn stop"
              title="생성 중단"
              onClick={() => abortRef.current?.abort()}
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              type="submit"
              className="chat-send-btn"
              disabled={!inputVal.trim()}
              title="질문 보내기"
            >
              <Send size={15} />
            </button>
          )}
        </form>
      </div>
      </aside>
    </>
  );
};
