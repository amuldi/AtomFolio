import { createHash } from 'node:crypto';
import { createPortfolioAllocation } from '../../src/lib/portfolioAllocation.js';
import { createPortfolioAnalyticsSummary } from '../../src/lib/portfolioAnalyticsSummary.js';
import { createPortfolioScorecard } from '../../src/lib/portfolioScoring.js';
import { createPortfolioTwin, generateTwinInsights } from '../../src/lib/digitalTwin.js';
import { getPortfolio, listAiAnalyses, saveAiAnalysis } from '../portfolioStore.mjs';
import {
  createStructuredOpenAiResponse,
  isOpenAiConfigured,
} from './openaiClient.mjs';

const ANALYSIS_TYPE = 'portfolio-summary';
const PROMPT_VERSION = 1;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DISCLAIMER_KO = '정보 제공 목적의 사용자 입력 기반 분석이며 투자 조언이 아닙니다.';
const DISCLAIMER_EN =
  'For informational, user-input-based analysis only. This is not investment advice.';

const memoryCache = globalThis.__ATOMFOLIO_AI_SUMMARY_CACHE__ ?? new Map();
globalThis.__ATOMFOLIO_AI_SUMMARY_CACHE__ = memoryCache;

function nowIso() {
  return new Date().toISOString();
}

function cleanText(value, max = 160) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function roundNumber(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function pickWarnings(portfolio) {
  return [
    ...safeArray(portfolio?.agentReview?.warnings),
    ...safeArray(portfolio?.parserDiagnostics?.warnings),
  ]
    .map((warning) => ({
      code: cleanText(warning?.code, 48),
      severity: cleanText(warning?.severity, 16) || 'info',
      message: cleanText(warning?.message, 180),
    }))
    .filter((warning) => warning.message)
    .slice(0, 6);
}

function compactTopHoldings(summary) {
  return safeArray(summary?.concentration?.topHoldings)
    .slice(0, 5)
    .map((holding) => ({
      label: cleanText(holding.label, 42),
      code: cleanText(holding.code, 18),
      weightPercent: roundNumber(holding.weightPercent, 1),
      returnRate: roundNumber(holding.returnRate, 2),
    }));
}

function compactGroups(groups) {
  return safeArray(groups)
    .slice(0, 5)
    .map((group) => ({
      label: cleanText(group.label, 42),
      weightPercent: roundNumber(group.weightPercent, 1),
      returnRate: roundNumber(group.returnRate, 2),
      count: Number.isFinite(Number(group.count)) ? Number(group.count) : null,
    }));
}

function compactScorecard(scorecard) {
  return {
    overall: roundNumber(scorecard?.overall, 0),
    metrics: Object.fromEntries(
      Object.entries(scorecard?.metrics ?? {}).map(([key, value]) => [key, roundNumber(value, 0)]),
    ),
  };
}

function buildPortfolioSnapshot(portfolio, language = 'ko') {
  const items = safeArray(portfolio?.items);
  const timelineItems = safeArray(portfolio?.timelineItems).length
    ? safeArray(portfolio.timelineItems)
    : items;
  const analytics = createPortfolioAnalyticsSummary(items, timelineItems, {
    period: 'month',
    topN: 5,
    targetBucketWeights: {
      stock: 60,
      dividend: 15,
      goldCash: 15,
      reit: 5,
      other: 5,
    },
  });
  const allocation = createPortfolioAllocation(items, {
    classificationMode: 'auto',
    weightMode: 'auto',
  });
  const scorecard = createPortfolioScorecard(items, language, {
    weightPreset: 'balanced',
  });
  const twin = createPortfolioTwin(items, timelineItems);

  return {
    promptVersion: PROMPT_VERSION,
    portfolioId: cleanText(portfolio?.id, 120),
    language,
    updatedAt: portfolio?.updatedAt ?? portfolio?.createdAt ?? null,
    counts: {
      holdings: items.length,
      timelineRows: timelineItems.length,
      parserRows: Number(portfolio?.parserDiagnostics?.bodyRowCount ?? 0) || null,
    },
    totals: {
      marketValueKnown: Number.isFinite(analytics?.totals?.totalMarketValue),
      totalReturnRate: roundNumber(analytics?.totals?.totalReturnRate, 2),
      totalProfitAmountKnown: Number.isFinite(analytics?.totals?.totalProfitAmount),
      valueSource: cleanText(analytics?.totals?.valueSource, 32),
    },
    concentration: {
      level: cleanText(analytics?.concentration?.concentrationLevel, 16),
      effectiveHoldings: roundNumber(analytics?.concentration?.effectiveHoldings, 2),
      topWeightPercent: roundNumber(analytics?.concentration?.topWeightPercent, 1),
      topHoldings: compactTopHoldings(analytics),
    },
    allocation: {
      weightSource: cleanText(allocation?.weightSource, 32),
      segments: safeArray(allocation?.segments)
        .slice(0, 6)
        .map((segment) => ({
          label: cleanText(segment.label, 42),
          weightPercent: roundNumber(segment.weight * 100, 1),
          returnRate: roundNumber(segment.returnRate, 2),
        })),
    },
    groups: {
      assetClass: compactGroups(analytics?.assetClassWeights),
      region: compactGroups(analytics?.regionWeights),
    },
    scorecard: compactScorecard(scorecard),
    twin: {
      riskScore: Number.isFinite(twin?.riskScore) ? twin.riskScore : null,
      insights: generateTwinInsights(twin).slice(0, 5).map((item) => cleanText(item, 160)),
    },
    dataQuality: {
      reviewStatus:
        cleanText(portfolio?.agentReview?.status, 24) ||
        cleanText(portfolio?.parserDiagnostics?.reviewStatus, 24) ||
        'ok',
      parserSummary: cleanText(portfolio?.parserDiagnostics?.summary, 160),
      reviewSummary: cleanText(portfolio?.agentReview?.summary, 220),
      warnings: pickWarnings(portfolio),
      fieldRoles: portfolio?.parserDiagnostics?.fieldRoles ?? null,
    },
    profitFlow: safeArray(analytics?.profitFlow)
      .slice(-6)
      .map((point) => ({
        periodKey: point.periodKey,
        returnRate: roundNumber(point.returnRate, 2),
        entriesCount: point.entriesCount,
      })),
  };
}

function disclaimerFor(language) {
  return language === 'en' ? DISCLAIMER_EN : DISCLAIMER_KO;
}

function fallbackSummary(snapshot, language = 'ko', reason = 'openai-unavailable') {
  const disclaimer = disclaimerFor(language);
  const topHolding = snapshot.concentration.topHoldings[0];
  const concentrationText =
    language === 'en'
      ? `Top holding weight is ${snapshot.concentration.topWeightPercent ?? 0}%.`
      : `상위 종목 비중은 ${snapshot.concentration.topWeightPercent ?? 0}%입니다.`;
  const returnText =
    snapshot.totals.totalReturnRate == null
      ? language === 'en'
        ? 'Return data is incomplete.'
        : '수익률 데이터는 일부만 확인됩니다.'
      : language === 'en'
        ? `Total return is ${snapshot.totals.totalReturnRate}%.`
        : `총 수익률은 ${snapshot.totals.totalReturnRate}%로 계산됩니다.`;

  return {
    type: ANALYSIS_TYPE,
    status: reason === 'cache-hit' ? 'ok' : 'degraded',
    mode: reason === 'cache-hit' ? 'cache-hit' : 'deterministic-fallback',
    disclaimer,
    summary: {
      headline:
        language === 'en'
          ? 'Portfolio snapshot generated from available data.'
          : '현재 입력 데이터 기준의 포트폴리오 요약입니다.',
      overview:
        language === 'en'
          ? `${snapshot.counts.holdings} holdings were reviewed. ${returnText}`
          : `${snapshot.counts.holdings}개 종목을 검토했습니다. ${returnText}`,
      keyObservations: [
        {
          title: language === 'en' ? 'Concentration' : '집중도',
          detail: topHolding
            ? language === 'en'
              ? `${topHolding.label} is the largest visible exposure.`
              : `${topHolding.label}이 가장 큰 비중으로 보입니다.`
            : concentrationText,
          evidence: [concentrationText],
          confidence: 'medium',
        },
        {
          title: language === 'en' ? 'Data basis' : '데이터 기준',
          detail:
            language === 'en'
              ? `Weights use ${snapshot.allocation.weightSource || 'available'} data.`
              : `비중은 ${snapshot.allocation.weightSource || '확인 가능한'} 데이터를 기준으로 계산했습니다.`,
          evidence: [
            language === 'en'
              ? `${snapshot.counts.timelineRows} timeline rows`
              : `${snapshot.counts.timelineRows}개 시계열 행`,
          ],
          confidence: 'medium',
        },
      ],
      riskNotes: snapshot.twin.insights.length
        ? snapshot.twin.insights
        : [
            language === 'en'
              ? 'Risk notes are limited because holdings metadata is incomplete.'
              : '보유 종목 메타데이터가 부족해 위험 설명은 제한적입니다.',
          ],
      dataQualityNotes: snapshot.dataQuality.warnings.length
        ? snapshot.dataQuality.warnings.map((warning) => warning.message)
        : [
            language === 'en'
              ? 'No blocking upload diagnostics were detected.'
              : '차단 수준의 업로드 진단은 확인되지 않았습니다.',
          ],
      assumptions: [
        language === 'en'
          ? 'Calculations use uploaded or manually entered values.'
          : '계산은 업로드 또는 직접 입력한 값을 기준으로 합니다.',
        disclaimer,
      ],
    },
    guardrails: {
      investmentAdvice: false,
      tradeRecommendation: false,
      checkedForbiddenAdvice: true,
    },
    warnings:
      reason === 'openai-unavailable'
        ? [
            {
              code: 'openai-unavailable',
              severity: 'info',
              message:
                language === 'en'
                  ? 'AI summary is unavailable, so a metric-based summary is shown.'
                  : 'AI 요약을 사용할 수 없어 기존 지표 기반 요약을 표시합니다.',
            },
          ]
        : [],
    generatedAt: nowIso(),
  };
}

function hasForbiddenAdvice(value) {
  const text = JSON.stringify(value ?? '').toLowerCase();
  return /(?:매수|매도|매집|청산|buy|sell)\s*(?:하세요|하라|추천|권장|recommend|now|immediately)/i.test(text);
}

const PORTFOLIO_SUMMARY_SCHEMA = {
  name: 'atomfolio_portfolio_summary',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['headline', 'overview', 'keyObservations', 'riskNotes', 'dataQualityNotes', 'assumptions'],
    properties: {
      headline: { type: 'string' },
      overview: { type: 'string' },
      keyObservations: {
        type: 'array',
        maxItems: 4,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'detail', 'evidence', 'confidence'],
          properties: {
            title: { type: 'string' },
            detail: { type: 'string' },
            evidence: { type: 'array', maxItems: 3, items: { type: 'string' } },
            confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
          },
        },
      },
      riskNotes: { type: 'array', maxItems: 5, items: { type: 'string' } },
      dataQualityNotes: { type: 'array', maxItems: 5, items: { type: 'string' } },
      assumptions: { type: 'array', maxItems: 5, items: { type: 'string' } },
    },
  },
};

function buildOpenAiInstructions(language = 'ko') {
  return [
    'You are AtomFolio portfolio explanation engine.',
    'Return only JSON that matches the schema.',
    'Use only the provided snapshot. Do not infer real-time market facts.',
    'Never recommend buying, selling, holding, replacing, increasing, or reducing a specific security.',
    'Use informational language: data basis, assumptions, exposures, sensitivity, concentration, and items to review.',
    'Always include that this is informational, assumption-based, user-input-based analysis and not investment advice.',
    language === 'en' ? 'Write in English.' : '한국어로 작성하세요.',
  ].join('\n');
}

async function loadPortfolio(workspaceId, body) {
  if (body?.portfolio && typeof body.portfolio === 'object') {
    return body.portfolio;
  }

  const portfolioId = cleanText(body?.portfolioId, 120);
  if (!portfolioId) {
    return null;
  }

  return getPortfolio(workspaceId, portfolioId);
}

export async function createPortfolioSummaryAnalysis({ workspaceId, body }) {
  const language = body?.language === 'en' ? 'en' : 'ko';
  const portfolio = await loadPortfolio(workspaceId, body);

  if (!portfolio) {
    return {
      statusCode: 404,
      payload: { error: 'Portfolio not found.' },
    };
  }

  const snapshot = buildPortfolioSnapshot(portfolio, language);
  const inputHash = hashJson(snapshot);
  const portfolioId = snapshot.portfolioId || cleanText(body?.portfolioId, 120) || null;
  const cacheKey = `${workspaceId}:${portfolioId ?? 'inline'}:${ANALYSIS_TYPE}:${inputHash}:${language}`;
  const cached = memoryCache.get(cacheKey);

  if (!body?.refresh && cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return {
      statusCode: 200,
      payload: {
        ...cached.payload,
        mode: 'cache-hit',
        cache: { hit: true, key: inputHash, ttlSeconds: CACHE_TTL_MS / 1000, createdAt: cached.createdAt },
      },
    };
  }

  if (!body?.refresh) {
    const { analyses } = await listAiAnalyses(workspaceId, {
      portfolioId,
      analysisType: ANALYSIS_TYPE,
      inputHash,
      limit: 1,
    });
    const stored = analyses[0]?.result;
    if (stored?.summary) {
      const payload = {
        ...stored,
        mode: 'cache-hit',
        cache: { hit: true, key: inputHash, ttlSeconds: CACHE_TTL_MS / 1000, createdAt: analyses[0].createdAt },
      };
      memoryCache.set(cacheKey, { payload, cachedAt: Date.now(), createdAt: analyses[0].createdAt });
      return { statusCode: 200, payload };
    }
  }

  let payload = null;
  let model = null;
  let status = 'fallback';

  if (isOpenAiConfigured()) {
    try {
      const response = await createStructuredOpenAiResponse({
        instructions: buildOpenAiInstructions(language),
        input: JSON.stringify(snapshot),
        jsonSchema: PORTFOLIO_SUMMARY_SCHEMA,
      });
      if (hasForbiddenAdvice(response.parsed)) {
        throw new Error('OpenAI response included forbidden advice language.');
      }

      model = response.model;
      status = 'ready';
      payload = {
        type: ANALYSIS_TYPE,
        status: 'ok',
        mode: 'openai',
        disclaimer: disclaimerFor(language),
        summary: response.parsed,
        guardrails: {
          investmentAdvice: false,
          tradeRecommendation: false,
          checkedForbiddenAdvice: true,
        },
        warnings: [],
        generatedAt: nowIso(),
      };
    } catch {
      payload = fallbackSummary(snapshot, language, 'openai-unavailable');
    }
  } else {
    payload = fallbackSummary(snapshot, language, 'openai-unavailable');
  }

  payload = {
    ...payload,
    cache: { hit: false, key: inputHash, ttlSeconds: CACHE_TTL_MS / 1000, createdAt: nowIso() },
    inputSummary: {
      portfolioId,
      holdings: snapshot.counts.holdings,
      timelineRows: snapshot.counts.timelineRows,
      promptVersion: PROMPT_VERSION,
    },
  };

  if (body?.save !== false) {
    await saveAiAnalysis(workspaceId, {
      portfolioId,
      analysisType: ANALYSIS_TYPE,
      inputHash,
      model,
      status,
      inputSummary: payload.inputSummary,
      result: payload,
    });
  }

  memoryCache.set(cacheKey, { payload, cachedAt: Date.now(), createdAt: payload.cache.createdAt });

  return {
    statusCode: 200,
    payload,
  };
}
