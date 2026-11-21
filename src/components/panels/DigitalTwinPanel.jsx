import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyMarketScenario,
  createPortfolioTwin,
  digitalTwinFormatters,
  projectFutureInvestment,
  runStressTest,
  simulateRebalance,
} from '../../lib/digitalTwin.js';
import { formatKoreanWonShort } from '../../utils/format.js';

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
  {
    key: 'aggressive',
    label: '공격적',
    sentenceLabel: '공격적으로',
    scenarioLabel: '공격',
    rate: 10,
  },
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
  return (
    projection?.scenarios?.find((scenario) => scenario.key === 'base') ??
    projection?.scenarios?.[0] ??
    null
  );
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

function NumberInput({ label, value, suffix = '%', placeholder = '', min, max, onChange }) {
  return (
    <label className="twin-control-row">
      <span>{label}</span>
      <span className="twin-input-wrap">
        <input
          type="number"
          inputMode="decimal"
          value={value}
          placeholder={placeholder}
          min={min}
          max={max}
          onChange={(event) =>
            onChange(clampInput(event.target.value, min ?? -Infinity, max ?? Infinity))
          }
        />
        <em>{suffix}</em>
      </span>
    </label>
  );
}

const SHOCK_LABELS = [
  ['globalShock', '전체 시장'],
  ['usShock', '미국 자산'],
  ['techShock', '기술주'],
  ['goldCashShock', '금/현금'],
  ['reitShock', '리츠'],
];

function signedPercent(value, digits = 0) {
  const numeric = Number(value ?? 0);
  const sign = numeric > 0 ? '+' : numeric < 0 ? '−' : '';
  return `${sign}${Math.abs(numeric).toFixed(digits)}%`;
}

// Amounts only mean something when the portfolio has real values; a weight-only or equal-weight
// import has no won amounts to show.
const hasMoneyValues = (twin) =>
  twin.valueSource === 'marketValue' || twin.valueSource === 'position';

// Clamp what is typed into a % field so a stray digit can't become 5,020,155%.
function clampInput(value, min, max) {
  const text = String(value);
  if (text === '' || text === '-' || text === '.') return text;
  const numeric = Number(text);
  if (!Number.isFinite(numeric)) return text;
  return numeric < min ? String(min) : numeric > max ? String(max) : text;
}

// What an experiment did, in one place: the headline number, what was assumed, which holdings it
// hit and how hard — or, for a rebalance, what to buy and sell. Shown at the top of 고급 실험.
function ExperimentResult({ result, twin, resultRef }) {
  const money = hasMoneyValues(twin);

  if (result.type === 'rebalance') {
    const moves = result.comparison.filter((item) => Math.abs(item.difference) >= 0.01);
    return (
      <section ref={resultRef} className="twin-outcome" aria-live="polite">
        <header>
          <span>리밸런싱 결과</span>
          <strong>
            위험 점수 {result.riskScoreBefore} → {result.riskScoreAfter}
          </strong>
        </header>
        {result.warnings.length ? (
          <ul className="twin-outcome__warnings">
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}
        <ul className="twin-outcome__rows">
          {result.comparison.map((item) => {
            const move = Math.abs(item.difference) >= 0.01;
            const buy = item.tradeValue > 0;
            return (
              <li key={item.key}>
                <span>{digitalTwinFormatters.bucketLabel(item.key)}</span>
                <b>
                  {(item.currentWeight * 100).toFixed(0)}% → {(item.targetWeight * 100).toFixed(0)}%
                </b>
                <em className={move ? (buy ? 'is-up' : 'is-down') : ''}>
                  {!move
                    ? '그대로'
                    : money
                      ? `${formatKoreanWonShort(Math.abs(item.tradeValue))} ${buy ? '더 사기' : '줄이기'}`
                      : `${signedPercent(item.difference * 100)}p`}
                </em>
              </li>
            );
          })}
        </ul>
        <p className="twin-outcome__note">
          {moves.length
            ? '비중만 비교한 결과예요. 세금과 수수료는 계산에 넣지 않았어요.'
            : '목표 비중이 지금과 거의 같아요.'}
        </p>
      </section>
    );
  }

  const assumptions = SHOCK_LABELS.filter(([key]) => result.scenario?.[key])
    .map(([key, label]) => `${label} ${signedPercent(result.scenario[key])}`)
    .join(' · ');
  const rows = [...result.positions].sort((left, right) => left.changeValue - right.changeValue);
  const shown = rows.slice(0, 5);
  const maxChange = Math.max(1, ...rows.map((row) => Math.abs(row.changeValue)));

  return (
    <section ref={resultRef} className="twin-outcome" aria-live="polite">
      <header>
        <span>{result.presetLabel ?? '직접 설정한 시나리오'}</span>
        <strong className={toneClassForValue(result.returnRate)}>
          {signedPercent(result.returnRate, 1)}
        </strong>
      </header>
      {money ? (
        <p className="twin-outcome__amount">
          {formatMoney(result.totalValue, twin.valueSource)} →{' '}
          {formatMoney(result.projectedTotalValue, twin.valueSource)}
          <em className={toneClassForValue(result.changeValue)}>
            {' '}
            ({formatSignedInvestmentMoney(result.changeValue)})
          </em>
        </p>
      ) : null}
      <p className="twin-outcome__assumption">가정: {assumptions || '충격 없음'}</p>
      <ul className="twin-outcome__rows">
        {shown.map((row) => (
          <li key={row.id}>
            <span title={row.label}>{row.label}</span>
            <b>{signedPercent(row.scenarioShock)}</b>
            <em className={toneClassForValue(row.changeValue)}>
              {money
                ? formatSignedInvestmentMoney(row.changeValue)
                : `${signedPercent(row.contributionRate, 1)}p`}
            </em>
            <i
              className={row.changeValue < 0 ? 'is-down' : 'is-up'}
              style={{ '--w': `${Math.max(3, (Math.abs(row.changeValue) / maxChange) * 100)}%` }}
              aria-hidden="true"
            />
          </li>
        ))}
      </ul>
      {rows.length > shown.length ? (
        <p className="twin-outcome__note">
          나머지 {rows.length - shown.length}종목은 영향이 더 작아요.
        </p>
      ) : null}
      <div className="twin-loss-grid">
        <div>
          <span>가장 많이 잃는 종목</span>
          <strong>{result.largestLossContributor?.label ?? '손실 없음'}</strong>
        </div>
        <div>
          <span>버텨 주는 종목</span>
          <strong>{result.defensiveAsset?.label ?? '버텨 주는 종목이 없어요'}</strong>
        </div>
      </div>
      <p className="twin-outcome__note">
        위험 점수 {result.riskScoreBefore} → {result.riskScoreAfter}. 정해 둔 충격을 그대로 적용한
        단순 계산이에요.
      </p>
    </section>
  );
}

function TwinOverview({ twin, activeResult, planner }) {
  const topPosition = [...(twin.weights ?? [])].sort(
    (left, right) => right.weight - left.weight,
  )[0];
  const topAsset = twin.assetClassWeights?.[0];
  const topRegion = twin.regionWeights?.[0];
  const riskScore = activeResult?.riskScoreAfter ?? twin.riskScore;
  // Second tile: what the last experiment did; until one runs, what the planner below projects.
  let change;
  if (activeResult?.type === 'rebalance') {
    change = {
      label: '리밸런싱 후',
      value: `위험 ${activeResult.riskScoreBefore} → ${activeResult.riskScoreAfter}`,
      tone: '',
    };
  } else if (activeResult) {
    change = {
      label: activeResult.presetLabel ?? '시나리오 결과',
      value: signedPercent(activeResult.returnRate, 1),
      tone: toneClassForValue(activeResult.returnRate),
    };
  } else {
    change = {
      label: `${planner.duration} 뒤 예상`,
      value: formatInvestmentMoney(planner.value),
      tone: '',
    };
  }

  return (
    <section className="twin-overview">
      <div className="twin-overview-card">
        <span>현재 포트폴리오</span>
        <strong>{formatMoney(twin.totalValue, twin.valueSource)}</strong>
        <em>{twin.positionCount}개 종목</em>
      </div>
      <div className="twin-overview-card">
        <span>{change.label}</span>
        <strong className={change.tone}>{change.value}</strong>
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
          {topPosition ? `${(topPosition.weight * 100).toFixed(0)}%` : (topRegion?.label ?? '')}
        </em>
      </div>
    </section>
  );
}

function DigitalTwinPanel({
  items = [],
  timelineItems = [],
  positionValues = null,
  className = '',
  onPointerDown,
}) {
  const twin = useMemo(
    () => createPortfolioTwin(items, timelineItems, { positionValues }),
    [items, timelineItems, positionValues],
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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const resultRef = useRef(null);
  const hasScenarioInputs = Object.values(scenario).some((value) => String(value).trim());
  // A blank target counts as 0%, so only the buckets you care about need filling in.
  const hasAnyTargetInput = BUCKET_FIELDS.some(([key]) => String(targetWeights[key]).trim());
  const targetTotal = BUCKET_FIELDS.reduce(
    (sum, [key]) => sum + (Number(targetWeights[key]) || 0),
    0,
  );

  // Open 고급 실험 and bring the result into view: it used to land far below the button.
  const runExperiment = (result) => {
    setActiveResult(result);
    setAdvancedOpen(true);
  };
  useEffect(() => {
    if (activeResult) resultRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeResult]);

  // A blank monthly amount simply means 0 — months and rate always come from the presets.
  const futureProjection = useMemo(
    () =>
      projectFutureInvestment(
        investmentTwin,
        future.monthlyContribution,
        future.months,
        future.annualReturnRate,
      ),
    [future, investmentTwin],
  );
  const selectedProjection = useMemo(
    () => findBaseProjection(futureProjection),
    [futureProjection],
  );
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
  const totalContribution =
    selectedProjection?.contributions ?? monthlyContribution * investmentMonths;
  const projectionGain = selectedProjection?.gain ?? 0;
  const projectionReturnRate = selectedProjection?.returnRate ?? 0;
  const projectedValue =
    selectedProjection?.projectedValue ?? investmentTwin.totalValue + totalContribution;
  const hasStartingValue = investmentTwin.totalValue > 0;
  const resultSentence = `${hasStartingValue ? '현재 포트폴리오에 ' : ''}매월 ${formatKoreanWonShort(
    monthlyContribution,
  )}씩 ${formatDuration(investmentMonths)} 동안 ${selectedReturnPreset.sentenceLabel} 투자하면 예상 금액은 약 ${formatKoreanWonShort(
    projectedValue,
  )}입니다.`;
  const lowProjection = futureProjection?.scenarios?.find(
    (candidate) => candidate.key === 'conservative',
  );
  const highProjection = futureProjection?.scenarios?.find(
    (candidate) => candidate.key === 'optimistic',
  );

  const setScenarioValue = (key, value) => {
    setScenario((current) => ({ ...current, [key]: value }));
  };
  const setTargetValue = (key, value) => {
    setTargetWeights((current) => ({ ...current, [key]: value }));
  };
  // Today's mix, rounded, as a starting point for the target weights.
  const fillCurrentMix = () => {
    const current = Object.fromEntries(BUCKET_FIELDS.map(([key]) => [key, 0]));
    twin.rebalanceBuckets.forEach(({ label, weight }) => {
      current[label] = Math.round(weight * 100);
    });
    setTargetWeights(
      Object.fromEntries(Object.entries(current).map(([key, value]) => [key, String(value)])),
    );
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

  return (
    <aside className={`twin-panel ${className}`} onPointerDown={onPointerDown}>
      <div className="twin-panel__header">
        <span>투자 시뮬레이션</span>
        <strong>{twin.positionCount}개 종목</strong>
      </div>

      <TwinOverview
        twin={twin}
        activeResult={activeResult}
        planner={{ duration: formatDuration(investmentMonths), value: projectedValue }}
      />

      <section className="twin-section twin-section--planner">
        <div className="twin-section__title">
          <span>빠른 예상</span>
          <strong>
            {selectedReturnPreset.label} · 연 {selectedReturnPreset.rate}%
          </strong>
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
              <strong className={toneClassForValue(projectionGain)}>
                {formatSignedInvestmentMoney(projectionGain)}
              </strong>
            </div>
            <div className="twin-metric-card">
              <span>{formatDuration(investmentMonths)} 누적 수익률</span>
              <strong className={toneClassForValue(projectionReturnRate)}>
                {formatPercentValue(projectionReturnRate)}
              </strong>
            </div>
            <div className="twin-metric-card">
              <span>예상 최종 금액</span>
              <strong>{formatInvestmentMoney(projectedValue)}</strong>
            </div>
          </div>
          {lowProjection && highProjection ? (
            <p className="twin-projection-range">
              연 {lowProjection.annualReturnRate}%~{highProjection.annualReturnRate}%로 달라지면 약{' '}
              {formatKoreanWonShort(lowProjection.projectedValue)} ~{' '}
              {formatKoreanWonShort(highProjection.projectedValue)}
            </p>
          ) : null}
          <p className="twin-disclaimer">
            정해 둔 수익률을 그대로 적용한 단순 계산이에요. 실제 수익은 이와 다를 수 있고, 수익을
            보장하지 않아요. 세금·수수료·물가는 반영하지 않았어요. 투자 권유가 아닙니다.
          </p>
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

      <details
        className="twin-advanced"
        open={advancedOpen}
        onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
      >
        <summary>
          <span>고급 실험</span>
          <em>{activeResult ? '결과 보는 중' : '시장 충격, 리밸런싱'}</em>
        </summary>

        {activeResult ? (
          <ExperimentResult result={activeResult} twin={twin} resultRef={resultRef} />
        ) : null}

        <section className="twin-section">
          <div className="twin-section__title">
            <span>시장 시나리오</span>
            <strong>{formatMoney(twin.totalValue, twin.valueSource)}</strong>
          </div>
          <div className="twin-scenario-grid">
            <NumberInput
              label="전체 시장"
              value={scenario.globalShock}
              placeholder={SCENARIO_PLACEHOLDERS.globalShock}
              min={-95}
              max={200}
              onChange={(value) => setScenarioValue('globalShock', value)}
            />
            <NumberInput
              label="미국 자산"
              value={scenario.usShock}
              placeholder={SCENARIO_PLACEHOLDERS.usShock}
              min={-95}
              max={200}
              onChange={(value) => setScenarioValue('usShock', value)}
            />
            <NumberInput
              label="기술주"
              value={scenario.techShock}
              placeholder={SCENARIO_PLACEHOLDERS.techShock}
              min={-95}
              max={200}
              onChange={(value) => setScenarioValue('techShock', value)}
            />
            <NumberInput
              label="금/현금"
              value={scenario.goldCashShock}
              placeholder={SCENARIO_PLACEHOLDERS.goldCashShock}
              min={-95}
              max={200}
              onChange={(value) => setScenarioValue('goldCashShock', value)}
            />
            <NumberInput
              label="리츠"
              value={scenario.reitShock}
              placeholder={SCENARIO_PLACEHOLDERS.reitShock}
              min={-95}
              max={200}
              onChange={(value) => setScenarioValue('reitShock', value)}
            />
          </div>
          <button
            type="button"
            className="twin-action"
            disabled={!hasScenarioInputs}
            onClick={() => runExperiment(applyMarketScenario(twin, scenario))}
          >
            시나리오 적용
          </button>
        </section>

        <section className="twin-section">
          <div className="twin-section__title">
            <span>스트레스 테스트</span>
            <strong>누르면 바로 계산해요</strong>
          </div>
          <div className="twin-preset-row">
            {STRESS_PRESETS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`twin-chip${activeResult?.preset === key ? ' is-active' : ''}`}
                aria-pressed={activeResult?.preset === key}
                onClick={() => runExperiment(runStressTest(twin, key))}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="twin-section">
          <div className="twin-section__title">
            <span>리밸런싱 실험</span>
            <strong>목표 비중 {targetTotal}%</strong>
          </div>
          <div className="twin-scenario-grid twin-scenario-grid--compact">
            {BUCKET_FIELDS.map(([key, label]) => (
              <NumberInput
                key={key}
                label={label}
                value={targetWeights[key]}
                placeholder={TARGET_PLACEHOLDERS[key]}
                min={0}
                max={100}
                onChange={(value) => setTargetValue(key, value)}
              />
            ))}
          </div>
          <p className="twin-hint">
            비워 둔 칸은 0%로 봐요.
            {hasAnyTargetInput && targetTotal !== 100
              ? ' 합계가 100%가 아니면 비율로 환산해서 비교해요.'
              : ''}
          </p>
          <div className="twin-action-row">
            <button type="button" className="twin-chip" onClick={fillCurrentMix}>
              현재 비중으로 채우기
            </button>
            <button
              type="button"
              className="twin-action"
              disabled={!hasAnyTargetInput || targetTotal <= 0}
              onClick={() => runExperiment(simulateRebalance(twin, targetWeights))}
            >
              목표 비중 비교
            </button>
          </div>
        </section>
      </details>
    </aside>
  );
}

export default memo(DigitalTwinPanel);
