import React from 'react';
import katex from 'katex';

// Explicit math blocks: $$...$$, \[...\], \(...\), and Pandoc-safe $...$
const EXPLICIT_MATH_RE =
  /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<!\\|\$)\$(?!\$)(?!\s)((?:\\.|[^$\\\n])+?)(?<!\s)\$(?!\$|[0-9])/g;

// Safe bare TeX commands or explicit braced sub/superscripts (e.g. \mathcal{L}_{id}, \lambda, x_{t+1})
const BARE_TEX_RE =
  /(\\(?:alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega|mathcal|mathbb|mathbf|mathrm|mathsf|mathtt|operatorname|frac|dfrac|tfrac|sqrt|sum|prod|int|oint|lim|in|notin|subset|subseteq|cup|cap|times|cdot|circ|oplus|otimes|pm|mp|le|leq|ge|geq|neq|ne|approx|equiv|sim|propto|to|rightarrow|leftarrow|Rightarrow|Leftarrow|hat|tilde|bar|vec|dot|ddot|overline|underline|ell|infty|partial|nabla|forall|exists|star)\b(?:\s*\{[^{}]*\})*(?:\s*[_^]\s*(?:\{[^{}]*\}|[A-Za-z0-9⋆*+-]))*|\b[A-Za-z](?:_\{[^{}]+\}|\^\{[^{}]+\})+(?:[_^](?:\{[^{}]+\}|[A-Za-z0-9⋆*+-]))*)/g;

function normalizeTexFormula(raw: string): string {
  // Convert Unicode star p⋆ -> p^{\star} if bare inside formula
  return raw.replace(/⋆/g, '\\star ').trim();
}

function renderKatexSpan(
  tex: string,
  displayMode: boolean,
  key: string
): React.ReactNode {
  const cleaned = normalizeTexFormula(tex);
  if (!cleaned) return null;
  try {
    const html = katex.renderToString(cleaned, {
      displayMode,
      throwOnError: false,
      strict: 'ignore',
      trust: false,
    });
    return (
      <span
        key={key}
        className={displayMode ? 'pv-math-display' : 'pv-math-inline'}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  } catch {
    return <span key={key}>{tex}</span>;
  }
}

function renderPlainWithBareTex(text: string, keyPrefix: string): React.ReactNode {
  if (!text) return null;
  const unescapedDollar = text.replace(/\\\$/g, '$');
  if (!unescapedDollar.includes('\\') && !unescapedDollar.includes('_{') && !unescapedDollar.includes('^{')) {
    return unescapedDollar;
  }

  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  BARE_TEX_RE.lastIndex = 0;

  while ((m = BARE_TEX_RE.exec(unescapedDollar)) !== null) {
    if (m.index > last) {
      out.push(
        <React.Fragment key={`${keyPrefix}_p_${last}`}>
          {unescapedDollar.slice(last, m.index)}
        </React.Fragment>
      );
    }
    out.push(renderKatexSpan(m[1], false, `${keyPrefix}_bt_${m.index}`));
    last = m.index + m[0].length;
  }

  if (out.length === 0) {
    return unescapedDollar;
  }
  if (last < unescapedDollar.length) {
    out.push(
      <React.Fragment key={`${keyPrefix}_pt_${last}`}>
        {unescapedDollar.slice(last)}
      </React.Fragment>
    );
  }
  return out;
}

/**
 * Render inline/display LaTeX (`$...$`, `$$...$$`, `\(...\)`, `\[...\]`) and bare TeX macros via KaTeX.
 */
export function renderMathText(
  text: string,
  keyPrefix = 'math'
): React.ReactNode {
  if (!text) return null;
  if (
    !text.includes('$') &&
    !text.includes('\\') &&
    !text.includes('_{') &&
    !text.includes('^{')
  ) {
    return text;
  }

  const nodes: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  EXPLICIT_MATH_RE.lastIndex = 0;

  while ((match = EXPLICIT_MATH_RE.exec(text)) !== null) {
    const start = match.index;
    if (start > lastIdx) {
      nodes.push(
        <React.Fragment key={`${keyPrefix}_txt_${lastIdx}`}>
          {renderPlainWithBareTex(text.slice(lastIdx, start), `${keyPrefix}_${lastIdx}`)}
        </React.Fragment>
      );
    }

    const displayTex = match[1] ?? match[2];
    const inlineTex = match[3] ?? match[4];

    if (displayTex !== undefined) {
      nodes.push(renderKatexSpan(displayTex, true, `${keyPrefix}_dm_${start}`));
    } else if (inlineTex !== undefined) {
      nodes.push(renderKatexSpan(inlineTex, false, `${keyPrefix}_im_${start}`));
    }

    lastIdx = start + match[0].length;
  }

  if (nodes.length === 0) {
    return renderPlainWithBareTex(text, `${keyPrefix}_all`);
  }

  if (lastIdx < text.length) {
    nodes.push(
      <React.Fragment key={`${keyPrefix}_tail_${lastIdx}`}>
        {renderPlainWithBareTex(text.slice(lastIdx), `${keyPrefix}_t_${lastIdx}`)}
      </React.Fragment>
    );
  }

  return nodes;
}

/**
 * Return character ranges `[start, end)` of explicit LaTeX math spans in `text`
 * so citation bracket parsers never split inside `$ ... $`!
 */
export function getExplicitMathRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  if (!text || (!text.includes('$') && !text.includes('\\'))) return ranges;
  EXPLICIT_MATH_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EXPLICIT_MATH_RE.exec(text)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}
