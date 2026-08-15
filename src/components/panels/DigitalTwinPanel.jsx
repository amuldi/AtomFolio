import { memo, useMemo, useState } from 'react';
import {
  applyMarketScenario,
  createPortfolioTwin,
  digitalTwinFormatters,
  projectFutureInvestment,
  runStressTest,
  simulateRebalance,
} from '../../lib/digitalTwin.js';

const STRESS_PRESETS = [
  ['tech_crash', '기술주 급락'],
  ['rate_hike', '금리 상승'],
  ['usd_krw_up', '환율 급등'],
  ['global_recession', '글로벌 경기침체'],
  ['defensive_market', '방어장세'],
];

const BUCKET_FIELDS = [
  ['stock', '주식'],
  ['dividend', '배당'],
  ['goldCash', '금/현금'],
  ['reit', '리츠'],
  ['other', '기타'],
];
const SCENARIO_PLACEHOLDERS = {
  globalShock: '-7',
  usShock: '0',
  techShock: '-8',
  goldCashShock: '3',
  reitShock: '-5',
};
const TARGET_PLACEHOLDERS = {
  stock: '50',
  dividend: '20',
  goldCash: '15',
  reit: '5',
  other: '10',
};
const INVESTMENT_RETURN_PRESETS = [
  { key: 'stable', label: '안정적', sentenceLabel: '안정적으로', scenarioLabel: '안정', rate: 4 },
  { key: 'balanced', label: '중간', sentenceLabel: '적당히', scenarioLabel: '기본', rate: 7 },
  { key: 'aggressive', label: '공격적', sentenceLabel: '공격적으로', scenarioLabel: '공격', rate: 10 },
];
const MONTHLY_CONTRIBUTION_PRESETS = [
  { key: '100000', label: '10만 원', value: 100000 },
  { key: '300000', label: '30만 원', value: 300000 },
  { key: '500000', label: '50만 원', value: 500000 },
  { key: '1000000', label: '100만 원', value: 1000000 },
  { key: 'custom', label: '직접 입력', value: null },
];
const INVESTMENT_PERIOD_PRESETS = [
  { key: '12', label: '1년', months: 12 },
  { key: '36', label: '3년', months: 36 },
  { key: '60', label: '5년', months: 60 },
  { key: '120', label: '10년', months: 120 },
  { key: '240', label: '20년', months: 240 },
];

function formatPercentValue(value) {
  return digitalTwinFormatters.formatPercent(Number(value ?? 0), 1);
}

function toneClassForValue(value) {
  const numeric = Number(value);

  if (numeric > 0) {
    return 'is-up';
  }

  if (numeric < 0) {
    return 'is-down';
  }

  return '';
}

// 억/만원 단위 축약 — 카드 폭에 맞지 않는 8자리 원 단위 숫자(예: ₩29,004,178)가 다음 줄로
// 밀려나는 걸 막기 위한 표시 전용 포맷. "원" 접미사는 붙이지 않는다 — 이미 ₩ 기호나 "매월 …씩"
// 같은 문맥이 통화임을 알려주는 자리에서는 "605.6만원"보다 "605.6만"이 더 짧고 자연스럽다.
function formatKoreanWonShort(value) {
  const numeric = Math.max(0, Number(value ?? 0));

  if (numeric >= 100000000) {
    const amount = numeric / 100000000;
    const fixed = amount >= 10 ? amount.toFixed(0) : amount.toFixed(1).replace(/\.0$/, '');
    return `${fixed}억`;
  }

  if (numeric >= 10000) {
    const amount = numeric / 10000;
    const fixed = amount >= 100 ? Math.round(amount).toLocaleString('ko-KR') : amount.toFixed(1).replace(/\.0$/, '');
    return `${fixed}만`;
  }

  return Math.round(numeric).toLocaleString('ko-KR');
}

function formatMoney(value, source) {
  const prefix = source === 'weight' || source === 'equal' ? '' : '₩';
  return `${prefix}${formatKoreanWonShort(Number(value ?? 0))}`;
}

function formatInvestmentMoney(value) {
  return `₩${formatKoreanWonShort(Number(value ?? 0))}`;
}

function formatSignedInvestmentMoney(value) {
  const numeric = Number(value ?? 0);
  const sign = numeric > 0 ? '+' : numeric < 0 ? '-' : '';

  return `${sign}₩${formatKoreanWonShort(Math.abs(numeric))}`;
}

function formatDuration(months) {
  const numeric = Math.max(1, Number(months ?? 0));

  if (numeric % 12 === 0) {
    return `${numeric / 12}년`;
  }

  return `${numeric}개월`;
}

function findBaseProjection(projection) {
  return projection?.scenarios?.find((scenario) => scenario.key === 'base') ?? projection?.scenarios?.[0] ?? null;
}

function createInvestmentTwin(twin) {
  if (twin.valueSource === 'weight' || twin.valueSource === 'equal') {
    return {
      ...twin,
      totalValue: 0,
      valueSource: 'position',
    };
  }

  return twin;
}

function NumberInput({ label, value, suffix = '%', placeholder = '', onChange }) {
  return (
    <label className="twin-control-row">
      <span>{label}</span>
      <span className="twin-input-wrap">
        <input
          type="number"
          inputMode="decimal"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
        <em>{suffix}</em>
      </span>
    </label>
  );
}

function ResultSummary({ result, twin }) {
  if (!result) {
    return (
      <div className="twin-result-card">
        <span className="twin-result-card__label">기준 포트폴리오</span>
        <strong>{formatMoney(twin.totalValue, twin.valueSource)}</strong>
      </div>
    );
  }

  if (result.type === 'rebalance') {
    return (
      <div className="twin-result-card">
        <span className="twin-result-card__label">리밸런싱 위험 점수</span>
        <strong>{result.riskScoreBefore} → {result.riskScoreAfter}</strong>
      </div>
    );
  }

  return (
    <div className="twin-result-card">
      <span className="twin-result-card__label">예상 포트폴리오 수익률</span>
      <strong className={toneClassForValue(result.returnRate)}>{formatPercentValue(result.returnRate)}</strong>
    </div>
  );
}

function TwinOverview({ twin, activeResult }) {
  const topPosition = [...(twin.weights ?? [])].sort((left, right) => right.weight - left.weight)[0];
  const topAsset = twin.assetClassWeights?.[0];
  const topRegion = twin.regionWeights?.[0];
  const expectedReturn = Number(activeResult?.returnRate ?? 0);
  const riskScore = activeResult?.riskScoreAfter ?? twin.riskScore;

  return (
    <section className="twin-overview">
      <div className="twin-overview-card">
        <span>현재 포트폴리오</span>
        <strong>{formatMoney(twin.totalValue, twin.valueSource)}</strong>
        <em>{twin.positionCount}개 종목</em>
      </div>
      <div className="twin-overview-card">
        <span>예상 변화</span>
        <strong className={activeResult ? toneClassForValue(expectedReturn) : ''}>
          {activeResult ? formatPercentValue(expectedReturn) : '-'}
        </strong>
      </div>
      <div className="twin-overview-card">
        <span>위험 점수</span>
        <strong>{riskScore}</strong>
        <div className="twin-meter">
          <i style={{ width: `${Math.min(100, Math.max(0, riskScore))}%` }} />
        </div>
      </div>
      <div className="twin-overview-card">
        <span>집중 포인트</span>
        <strong>{topPosition?.label ?? topAsset?.label ?? '대기'}</strong>
        <em>
          {topPosition ? `${(topPosition.weight * 100).toFixed(0)}%` : topRegion?.label ?? ''}
        </em>
      </div>
    </section>
  );
}

function DigitalTwinPanel({
  items = [],
  timelineItems = [],
  className = '',
  onPointerDown,
}) {
  const twin = useMemo(
    () => createPortfolioTwin(items, timelineItems),
    [items, timelineItems],
  );
  const investmentTwin = useMemo(() => createInvestmentTwin(twin), [twin]);
  const [scenario, setScenario] = useState({
    globalShock: '',
    usShock: '',
    techShock: '',
    goldCashShock: '',
    reitShock: '',
  });
  const [targetWeights, setTargetWeights] = useState({
    stock: '',
    dividend: '',
    goldCash: '',
    reit: '',
    other: '',
  });
  const [future, setFuture] = useState({
    monthlyContribution: '300000',
    months: '60',
    annualReturnRate: '7',
  });
  const [monthlyMode, setMonthlyMode] = useState('300000');
  const [activeResult, setActiveResult] = useState(null);
  const hasScenarioInputs = Object.values(scenario).some((value) => String(value).trim());
  const hasCompleteTargetInputs = BUCKET_FIELDS.every(([key]) => String(targetWeights[key]).trim());
  const hasFutureInputs = Boolean(
    String(future.monthlyContribution).trim() &&
    String(future.months).trim() &&
    String(future.annualReturnRate).trim(),
  );

  const futureProjection = useMemo(
    () =>
      hasFutureInputs
        ? projectFutureInvestment(
            investmentTwin,
            future.monthlyContribution,
            future.months,
            future.annualReturnRate,
          )
        : null,
    [future, hasFutureInputs, investmentTwin],
  );
  const selectedProjection = useMemo(() => findBaseProjection(futureProjection), [futureProjection]);
  const comparisonProjections = useMemo(
    () =>
      INVESTMENT_RETURN_PRESETS.map((preset) => {
        const projection = projectFutureInvestment(
          investmentTwin,
          future.monthlyContribution,
          future.months,
          preset.rate,
        );
        const baseProjection = findBaseProjection(projection);

        return {
          ...preset,
          projection: baseProjection,
        };
      }),
    [future.monthlyContribution, future.months, investmentTwin],
  );
  const selectedReturnPreset =
    INVESTMENT_RETURN_PRESETS.find((preset) => Number(future.annualReturnRate) === preset.rate) ??
    INVESTMENT_RETURN_PRESETS[1];
  const monthlyContribution = Math.max(0, Number(futureProjection?.monthlyContribution ?? 0));
  const investmentMonths = Math.max(1, Number(futureProjection?.months ?? 1));
  const totalContribution = selectedProjection?.contributions ?? monthlyContribution * investmentMonths;
  const projectionGain = selectedProjection?.gain ?? 0;
  const projectionReturnRate = selectedProjection?.returnRate ?? 0;
  const projectedValue = selectedProjection?.projectedValue ?? investmentTwin.totalValue + totalContribution;
  const hasStartingValue = investmentTwin.totalValue > 0;
  const resultSentence = `${hasStartingValue ? '현재 포트폴리오에 ' : ''}매월 ${formatKoreanWonShort(
    monthlyContribution,
  )}씩 ${formatDuration(investmentMonths)} 동안 ${selectedReturnPreset.sentenceLabel} 투자하면 예상 금액은 약 ${formatKoreanWonShort(
    projectedValue,
  )}입니다.`;

  const setScenarioValue = (key, value) => {
    setScenario((current) => ({ ...current, [key]: value }));
  };
  const setTargetValue = (key, value) => {
    setTargetWeights((current) => ({ ...current, [key]: value }));
  };
  const setFutureValue = (key, value) => {
    setFuture((current) => ({ ...current, [key]: value }));
  };
  const selectMonthlyContribution = (preset) => {
    setMonthlyMode(preset.key);

    if (Number.isFinite(preset.value)) {
      setFutureValue('monthlyContribution', String(preset.value));
    }
  };

  if (!items.length) {
    return (
      <aside className={`twin-panel ${className}`} onPointerDown={onPointerDown}>
        <div className="twin-panel__header">
          <span>투자 시뮬레이션</span>
          <strong>대기</strong>
        </div>
      </aside>
    );
  }

  const largestLoss = activeResult?.largestLossContributor;
  const defensiveAsset = activeResult?.defensiveAsset;

  return (
    <aside className={`twin-panel ${className}`} onPointerDown={onPointerDown}>
      <div className="twin-panel__header">
        <span>투자 시뮬레이션</span>
        <strong>{twin.positionCount}개 종목</strong>
      </div>

      <TwinOverview twin={twin} activeResult={activeResult} />

      <section className="twin-section twin-section--planner">
        <div className="twin-section__title">
          <span>빠른 예상</span>
          <strong>{selectedReturnPreset.label} · 연 {selectedReturnPreset.rate}%</strong>
        </div>

        <div className="twin-planner-stack">
          <div className="twin-choice-block">
            <span className="twin-choice-label">투자 성향</span>
            <div className="twin-choice-grid twin-choice-grid--three">
              {INVESTMENT_RETURN_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  className={`twin-choice${Number(future.annualReturnRate) === preset.rate ? ' is-active' : ''}`}
                  onClick={() => setFutureValue('annualReturnRate', String(preset.rate))}
                >
                  <strong>{preset.label}</strong>
                  <em>연 {preset.rate}%</em>
                </button>
              ))}
            </div>
          </div>

          <div className="twin-choice-block">
            <span className="twin-choice-label">월 투자금</span>
            <div className="twin-choice-grid twin-choice-grid--money">
              {MONTHLY_CONTRIBUTION_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  className={`twin-choice${monthlyMode === preset.key ? ' is-active' : ''}`}
                  onClick={() => selectMonthlyContribution(preset)}
                >
                  <strong>{preset.label}</strong>
                </button>
              ))}
            </div>
            {monthlyMode === 'custom' ? (
              <label className="twin-custom-money">
                <span>직접 입력</span>
                <span className="twin-input-wrap">
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    value={future.monthlyContribution}
                    placeholder="300000"
                    onChange={(event) => setFutureValue('monthlyContribution', event.target.value)}
                  />
                  <em>원</em>
                </span>
              </label>
            ) : null}
          </div>

          <div className="twin-choice-block">
            <span className="twin-choice-label">투자 기간</span>
            <div className="twin-choice-grid twin-choice-grid--period">
              {INVESTMENT_PERIOD_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  className={`twin-choice${String(future.months) === preset.key ? ' is-active' : ''}`}
                  onClick={() => setFutureValue('months', preset.key)}
                >
                  <strong>{preset.label}</strong>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="twin-projection-card">
          <p className="twin-projection-sentence">{resultSentence}</p>
          <div className="twin-result-metrics">
            <div className="twin-metric-card">
              <span>총 납입금</span>
              <strong>{formatInvestmentMoney(totalContribution)}</strong>
            </div>
            <div className="twin-metric-card">
              <span>예상 수익</span>
              <strong className={toneClassForValue(projectionGain)}>{formatSignedInvestmentMoney(projectionGain)}</strong>
            </div>
            <div className="twin-metric-card">
              <span>예상 수익률</span>
              <strong className={toneClassForValue(projectionReturnRate)}>{formatPercentValue(projectionReturnRate)}</strong>
            </div>
            <div className="twin-metric-card">
              <span>예상 최종 금액</span>
              <strong>{formatInvestmentMoney(projectedValue)}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="twin-section twin-section--compare">
        <div className="twin-section__title">
          <span>같은 조건 비교</span>
        </div>
        <div className="twin-comparison-grid">
          {comparisonProjections.map((scenario) => (
            <article
              key={scenario.key}
              className={`twin-comparison-card${Number(future.annualReturnRate) === scenario.rate ? ' is-active' : ''}`}
            >
              <span>{scenario.scenarioLabel}</span>
              <strong>{formatInvestmentMoney(scenario.projection?.projectedValue ?? 0)}</strong>
              <em className={toneClassForValue(scenario.projection?.gain)}>
                예상 수익 {formatSignedInvestmentMoney(scenario.projection?.gain ?? 0)}
              </em>
            </article>
          ))}
        </div>
      </section>

      <details className="twin-advanced">
        <summary>
          <span>고급 실험</span>
          <em>시장 충격, 리밸런싱</em>
        </summary>

        <section className="twin-section">
          <div className="twin-section__title">
            <span>시장 시나리오</span>
            <strong>{formatMoney(twin.totalValue, twin.valueSource)}</strong>
          </div>
          <div className="twin-scenario-grid">
            <NumberInput label="전체 시장" value={scenario.globalShock} placeholder={SCENARIO_PLACEHOLDERS.globalShock} onChange={(value) => setScenarioValue('globalShock', value)} />
            <NumberInput label="미국 자산" value={scenario.usShock} placeholder={SCENARIO_PLACEHOLDERS.usShock} onChange={(value) => setScenarioValue('usShock', value)} />
            <NumberInput label="기술주" value={scenario.techShock} placeholder={SCENARIO_PLACEHOLDERS.techShock} onChange={(value) => setScenarioValue('techShock', value)} />
            <NumberInput label="금/현금" value={scenario.goldCashShock} placeholder={SCENARIO_PLACEHOLDERS.goldCashShock} onChange={(value) => setScenarioValue('goldCashShock', value)} />
            <NumberInput label="리츠" value={scenario.reitShock} placeholder={SCENARIO_PLACEHOLDERS.reitShock} onChange={(value) => setScenarioValue('reitShock', value)} />
          </div>
          <button
            type="button"
            className="twin-action"
            disabled={!hasScenarioInputs}
            onClick={() => setActiveResult(applyMarketScenario(twin, scenario))}
          >
            시나리오 적용
          </button>
        </section>

        <section className="twin-section">
          <div className="twin-section__title">
            <span>스트레스 테스트</span>
          </div>
          <div className="twin-preset-row">
            {STRESS_PRESETS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                className="twin-chip"
                onClick={() => setActiveResult(runStressTest(twin, key))}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="twin-section">
          <div className="twin-section__title">
            <span>리밸런싱 실험</span>
          </div>
          <div className="twin-scenario-grid twin-scenario-grid--compact">
            {BUCKET_FIELDS.map(([key, label]) => (
              <NumberInput
                key={key}
                label={label}
                value={targetWeights[key]}
                placeholder={TARGET_PLACEHOLDERS[key]}
                onChange={(value) => setTargetValue(key, value)}
              />
            ))}
          </div>
          <button
            type="button"
            className="twin-action"
            disabled={!hasCompleteTargetInputs}
            onClick={() => setActiveResult(simulateRebalance(twin, targetWeights))}
          >
            목표 비중 비교
          </button>
          {activeResult?.type === 'rebalance' ? (
            <div className="twin-rebalance-list">
              {activeResult.comparison.map((item) => (
                <div key={item.key} className="twin-rebalance-row">
                  <span>{digitalTwinFormatters.bucketLabel(item.key)}</span>
                  <strong>
                    {(item.currentWeight * 100).toFixed(0)}% → {(item.targetWeight * 100).toFixed(0)}%
                  </strong>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <section className="twin-section">
          <div className="twin-section__title">
            <span>고급 결과</span>
          </div>
          <ResultSummary result={activeResult} twin={twin} />
          <div className="twin-loss-grid">
            <div>
              <span>손실 기여</span>
              <strong>{largestLoss?.label ?? '-'}</strong>
            </div>
            <div>
              <span>방어 자산</span>
              <strong>{defensiveAsset?.label ?? '-'}</strong>
            </div>
          </div>
        </section>
      </details>
    </aside>
  );
}

export default memo(DigitalTwinPanel);
