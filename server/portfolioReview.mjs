// CSV ingest review — deterministic validation only (no LLM calls). Replaces the earlier
// server/agents/{orchestrator,schemaMapper,qualityGuard,explanationAgent,contracts}.mjs split,
// which wrapped these same checks in a multi-agent orchestration shape even though nothing here
// is async or agent-like. Consolidated into one module since the "agents" were never independent
// (schema/quality checks always run together, explanation always runs last) and nothing outside
// this file's own return value reads the per-check breakdown — only `status`/`summary`/`warnings`
// are consumed (see portfolioIngestion.mjs and src/App.jsx's agentReview usage).

function createWarning(code, severity, message) {
  return { code, severity, message };
}

function deriveStatus(warnings) {
  if (warnings.some((warning) => warning.severity === 'error')) {
    return 'blocked';
  }

  if (warnings.some((warning) => warning.severity === 'warning')) {
    return 'needs-review';
  }

  return 'ok';
}

function summarizeMappedColumns(mappedColumns) {
  return Object.entries(mappedColumns)
    .filter(([, value]) => value?.label)
    .map(([key, value]) => `${key}:${value.label}`)
    .join(', ');
}

function checkSchemaMapping(parserDiagnostics) {
  const mappedColumns = parserDiagnostics?.mappedColumns ?? {};
  const warnings = [];

  if (!mappedColumns.stockName && !mappedColumns.stockCode) {
    warnings.push(
      createWarning('missing-security-identity', 'error', '종목명 또는 종목 티커 매핑을 확정하지 못했습니다.'),
    );
  }

  if (mappedColumns.stockName && mappedColumns.stockName.confidence < 0.62) {
    warnings.push(
      createWarning(
        'low-stock-name-confidence',
        'warning',
        '종목명 매핑 신뢰도가 낮아 수동 확인이 필요할 수 있습니다.',
      ),
    );
  }

  if (!mappedColumns.buyDate) {
    warnings.push(
      createWarning('missing-buy-date', 'info', '날짜 매핑이 비어 있어 히트맵 정보가 제한될 수 있습니다.'),
    );
  }

  if (!mappedColumns.return) {
    warnings.push(
      createWarning('missing-return', 'info', '수익률 매핑이 비어 있어 일부 상세 정보가 약할 수 있습니다.'),
    );
  }

  return {
    warnings,
    mappedColumns,
    summary: summarizeMappedColumns(mappedColumns) || '확정된 핵심 컬럼 매핑이 아직 충분하지 않습니다.',
  };
}

function extractDateValue(item) {
  for (const field of item?.fields ?? []) {
    const label = String(field?.label ?? '').trim();
    if (/(날짜|일자|date|day|tradedate|recorddate|valuedate|snapshotdate|buydate)/i.test(label)) {
      return String(field?.value ?? '').trim();
    }
  }

  return '';
}

function normalizeLabel(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_.\-/%()[\]]+/g, '');
}

function looksGenericLabel(value) {
  return /^(미국|한국|국내|해외|글로벌|선진국|신흥국|기술|반도체|금융|에너지|바이오|헬스|소재|성장주|가치주|고위험|중위험|저위험|주식|채권|현금|etf|fund|bond|cash|growth|value|technology|energy|financials?)$/.test(
    normalizeLabel(value),
  );
}

function metadataCoverage(items) {
  if (!items.length) {
    return 0;
  }

  const filledCount = items.reduce((count, item) => {
    return (
      count +
      ['region', 'sector', 'style', 'risk', 'assetClass'].filter((key) => String(item?.[key] ?? '').trim())
        .length
    );
  }, 0);

  return filledCount / (items.length * 5);
}

function checkQuality({ parserDiagnostics, timelineItems, items }) {
  const warnings = [];
  const timelineDateCount = new Set(timelineItems.map(extractDateValue).filter(Boolean)).size;
  const genericLabelCount = items.filter((item) => looksGenericLabel(item?.label)).length;
  const coverage = metadataCoverage(items);

  if (timelineItems.length >= 12 && timelineDateCount <= 1) {
    warnings.push(
      createWarning(
        'timeline-collapsed',
        'warning',
        '입력 행 수에 비해 날짜 종류가 너무 적어 시계열 파싱이 잘못됐을 수 있습니다.',
      ),
    );
  }

  if (items.length && genericLabelCount / items.length >= 0.25) {
    warnings.push(createWarning('generic-labels', 'warning', '표시 라벨 중 일부가 종목명보다 메타값처럼 보입니다.'));
  }

  if (items.length && coverage < 0.28) {
    warnings.push(
      createWarning(
        'low-metadata-coverage',
        'info',
        '자동 보강 후에도 메타데이터 충실도가 낮아 그룹 분석이 약할 수 있습니다.',
      ),
    );
  }

  if ((parserDiagnostics?.parsedItemCount ?? 0) > 0 && items.length === 0) {
    warnings.push(createWarning('display-collapse-empty', 'error', '파싱된 행은 있지만 표시용 종목이 비어 있습니다.'));
  }

  return {
    warnings,
    summary: `timelineDates:${timelineDateCount}, metadataCoverage:${Math.round(coverage * 100)}%`,
  };
}

function buildExplanation({ parserDiagnostics, warningCount }) {
  const dateLabel = parserDiagnostics?.mappedColumns?.buyDate?.label;
  const returnLabel = parserDiagnostics?.mappedColumns?.return?.label;
  const identityLabel =
    parserDiagnostics?.mappedColumns?.stockName?.label ?? parserDiagnostics?.mappedColumns?.stockCode?.label ?? '';

  const parts = [
    identityLabel ? `핵심 식별 컬럼은 ${identityLabel}로 해석했습니다.` : '핵심 식별 컬럼은 재검토가 필요합니다.',
    dateLabel ? `날짜는 ${dateLabel} 열을 사용합니다.` : '날짜 열은 확정되지 않았습니다.',
    returnLabel ? `수익률은 ${returnLabel} 열을 사용합니다.` : '수익률 열은 확정되지 않았습니다.',
  ];

  if (warningCount) {
    parts.push(`검토 포인트 ${warningCount}건이 있습니다.`);
  }

  return parts.join(' ');
}

function mergeWarnings(...groups) {
  const deduped = new Map();

  groups
    .flat()
    .filter(Boolean)
    .forEach((warning) => {
      const key = `${warning.code}:${warning.message}`;
      if (!deduped.has(key)) {
        deduped.set(key, warning);
      }
    });

  return [...deduped.values()];
}

export function reviewPortfolioImport({ fileName, parserDiagnostics, timelineItems, items }) {
  const schemaCheck = checkSchemaMapping(parserDiagnostics);
  const qualityCheck = checkQuality({ parserDiagnostics, timelineItems, items });
  const warnings = mergeWarnings(parserDiagnostics?.warnings ?? [], schemaCheck.warnings, qualityCheck.warnings);

  return {
    fileName,
    status: deriveStatus(warnings),
    summary: buildExplanation({ parserDiagnostics, warningCount: warnings.length }),
    warnings,
  };
}
