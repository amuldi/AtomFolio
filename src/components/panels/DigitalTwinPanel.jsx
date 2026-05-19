import { useMemo, useState } from 'react';
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
  globalShock: '예: -7',
  usShock: '예: 0',
  techShock: '예: -8',
  goldCashShock: '예: 3',
  reitShock: '예: -5',
};
const TARGET_PLACEHOLDERS = {
  stock: '예: 50',
  dividend: '예: 20',
  goldCash: '예: 15',
  reit: '예: 5',
  other: '예: 10',
};

function formatPercentValue(value) {
  return digitalTwinFormatters.formatPercent(Number(value ?? 0), 1);
}

function formatMoney(value, source) {
  const prefix = source === 'weight' || source === 'equal' ? '' : '₩';
  return `${prefix}${digitalTwinFormatters.formatWon(Number(value ?? 0))}`;
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
      <strong>{formatPercentValue(result.returnRate)}</strong>
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
        <strong>{activeResult ? formatPercentValue(expectedReturn) : '-'}</strong>
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

export default function DigitalTwinPanel({
  items = [],
  timelineItems = [],
  className = '',
  onPointerDown,
}) {
  const twin = useMemo(
    () => createPortfolioTwin(items, timelineItems),
    [items, timelineItems],
  );
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
    monthlyContribution: '',
    months: '',
    annualReturnRate: '',
  });
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
            twin,
            future.monthlyContribution,
            future.months,
            future.annualReturnRate,
          )
        : null,
    [future, hasFutureInputs, twin],
  );

  const setScenarioValue = (key, value) => {
    setScenario((current) => ({ ...current, [key]: value }));
  };
  const setTargetValue = (key, value) => {
    setTargetWeights((current) => ({ ...current, [key]: value }));
  };
  const setFutureValue = (key, value) => {
    setFuture((current) => ({ ...current, [key]: value }));
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
          <span>미래 투자 시뮬레이션</span>
        </div>
        <div className="twin-scenario-grid">
          <NumberInput label="월 추가 투자" value={future.monthlyContribution} placeholder="예: 300000" suffix="원" onChange={(value) => setFutureValue('monthlyContribution', value)} />
          <NumberInput label="기간" value={future.months} placeholder="예: 36" suffix="개월" onChange={(value) => setFutureValue('months', value)} />
          <NumberInput label="연평균" value={future.annualReturnRate} placeholder="예: 6" onChange={(value) => setFutureValue('annualReturnRate', value)} />
        </div>
        {futureProjection ? (
          <div className="twin-future-row">
          {futureProjection.scenarios.map((projection) => (
            <div key={projection.key} className="twin-mini-card">
              <span>{projection.label}</span>
              <strong>{formatMoney(projection.projectedValue, twin.valueSource)}</strong>
              <em>{formatPercentValue(projection.returnRate)}</em>
            </div>
          ))}
          </div>
        ) : null}
      </section>

      <section className="twin-section">
        <div className="twin-section__title">
          <span>결과 요약</span>
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
    </aside>
  );
}
