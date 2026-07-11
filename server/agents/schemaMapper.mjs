import { createAgentWarning, deriveReviewStatus } from './contracts.mjs';

function summarizeMappedColumns(mappedColumns) {
  return Object.entries(mappedColumns)
    .filter(([, value]) => value?.label)
    .map(([key, value]) => `${key}:${value.label}`)
    .join(', ');
}

export async function runSchemaMapperAgent(parserDiagnostics) {
  const mappedColumns = parserDiagnostics?.mappedColumns ?? {};
  const warnings = [];

  if (!mappedColumns.stockName && !mappedColumns.stockCode) {
    warnings.push(
      createAgentWarning({
        code: 'missing-security-identity',
        severity: 'error',
        message: '종목명 또는 종목 티커 매핑을 확정하지 못했습니다.',
        source: 'schema-mapper',
      }),
    );
  }

  if (mappedColumns.stockName && mappedColumns.stockName.confidence < 0.62) {
    warnings.push(
      createAgentWarning({
        code: 'low-stock-name-confidence',
        severity: 'warning',
        message: '종목명 매핑 신뢰도가 낮아 수동 확인이 필요할 수 있습니다.',
        source: 'schema-mapper',
      }),
    );
  }

  if (!mappedColumns.buyDate) {
    warnings.push(
      createAgentWarning({
        code: 'missing-buy-date',
        severity: 'info',
        message: '날짜 매핑이 비어 있어 히트맵 정보가 제한될 수 있습니다.',
        source: 'schema-mapper',
      }),
    );
  }

  if (!mappedColumns.return) {
    warnings.push(
      createAgentWarning({
        code: 'missing-return',
        severity: 'info',
        message: '수익률 매핑이 비어 있어 일부 상세 정보가 약할 수 있습니다.',
        source: 'schema-mapper',
      }),
    );
  }

  return {
    agent: 'schema-mapper',
    status: deriveReviewStatus(warnings),
    summary:
      summarizeMappedColumns(mappedColumns) || '확정된 핵심 컬럼 매핑이 아직 충분하지 않습니다.',
    decisions: mappedColumns,
    warnings,
  };
}
