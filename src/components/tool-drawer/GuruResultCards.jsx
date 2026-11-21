// The comparison read-out under the 유명인 tab once 비교하기 has run: what differs, sector and
// region mix, the holdings both share, and concentration. All numbers come from
// src/lib/guruCompare.js; the atoms themselves are on the main stage (GuruStage).
import { REGION_LABELS, REGION_ORDER, SECTOR_LABELS } from '../../lib/guruCompare.js';

const REGION_SWATCH = {
  us: 'rgba(var(--frame-ink-a), 0.9)',
  kr: 'rgba(var(--frame-ink-a), 0.62)',
  cn: 'rgba(var(--frame-ink-a), 0.44)',
  tw: 'rgba(var(--frame-ink-a), 0.32)',
  other: 'rgba(var(--frame-ink-a), 0.22)',
  rest: 'rgba(var(--frame-ink-a), 0.1)',
};

const formatPercent = (value, digits = 1) => `${(value * 100).toFixed(digits)}%`;

export function GuruResultCards({ guru, result, insights, language }) {
  const en = language === 'en';
  const lang = en ? 'en' : 'ko';
  const person = guru.person[lang];
  const sectorLabel = (key) => SECTOR_LABELS[key]?.[lang] ?? key;
  const regionLabel = (key) => REGION_LABELS[key]?.[lang] ?? key;
  const sectorMax = Math.max(0.0001, ...result.sectors.map((row) => Math.max(row.user, row.guru)));
  const usedRegions = REGION_ORDER.filter(
    (key) => (result.userRegions[key] ?? 0) + (result.guruRegions[key] ?? 0) > 0.0005,
  );

  const regionRow = (label, buckets) => (
    <div className="guru-compare__stack-row">
      <span>{label}</span>
      <div className="guru-compare__stack">
        {REGION_ORDER.filter((key) => (buckets[key] ?? 0) > 0.0005).map((key) => (
          <i
            key={key}
            title={`${regionLabel(key)} ${formatPercent(buckets[key])}`}
            style={{ flexGrow: buckets[key], background: REGION_SWATCH[key] }}
            className={key === 'us' || key === 'kr' ? undefined : 'is-light'}
          >
            {buckets[key] > 0.16 ? `${regionLabel(key)} ${formatPercent(buckets[key], 0)}` : ''}
          </i>
        ))}
      </div>
    </div>
  );

  return (
    <div className="guru-compare__result">
      <div className="guru-compare__card guru-compare__insights" style={{ '--i': 0 }}>
        <ul>
          {insights.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>

      <div className="guru-compare__card" style={{ '--i': 1 }}>
        <div className="guru-compare__subhead">
          <span>{en ? 'Common holdings' : '공통 종목'}</span>
          <em>{`${result.shared.length}${en ? '' : '종목'} · ${formatPercent(result.commonShare)}`}</em>
        </div>
        {result.shared.length ? (
          <div className="guru-compare__table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{en ? 'Holding' : '종목'}</th>
                  <th>{en ? 'Mine' : '나'}</th>
                  <th>{person}</th>
                  <th>{en ? 'My return' : '내 수익률'}</th>
                </tr>
              </thead>
              <tbody>
                {result.shared.map((holding, index) => (
                  <tr key={holding.ticker} style={{ '--row': index }}>
                    <td>
                      {holding.name?.[lang] ?? holding.ticker}
                      <small>{holding.ticker}</small>
                    </td>
                    <td>{formatPercent(holding.userWeight)}</td>
                    <td className="is-guru">{formatPercent(holding.guruWeight)}</td>
                    <td className={holding.returnRate == null ? '' : holding.returnRate >= 0 ? 'positive' : 'negative'}>
                      {holding.returnRate == null
                        ? '-'
                        : `${holding.returnRate >= 0 ? '▲' : '▼'}${Math.abs(holding.returnRate).toFixed(1)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="guru-compare__empty">{en ? 'No holdings in common.' : '공통 종목이 없습니다.'}</p>
        )}
      </div>

      <div className="guru-compare__card" style={{ '--i': 2 }}>
        <div className="guru-compare__subhead">
          <span>{en ? 'Sectors' : '섹터'}</span>
          <em className="guru-compare__keys">
            <i className="is-mine" />
            {en ? 'Me' : '나'}
            <i className="is-guru" />
            {person}
          </em>
        </div>
        <div className="guru-compare__bars">
          {result.sectors.map((row, index) => (
            <div
              key={row.key}
              className={`guru-compare__bar-row${row.key === 'rest' ? ' is-rest' : ''}`}
              style={{ '--i': 2 + index * 0.3 }}
            >
              <span>{sectorLabel(row.key)}</span>
              <div>
                {row.key === 'rest' ? null : (
                  <div className="guru-compare__bar">
                    <b>
                      <i className="is-mine" style={{ '--w': `${(row.user / sectorMax) * 100}%` }} />
                    </b>
                    <em>{formatPercent(row.user)}</em>
                  </div>
                )}
                <div className="guru-compare__bar">
                  <b>
                    <i className="is-guru" style={{ '--w': `${(row.guru / sectorMax) * 100}%` }} />
                  </b>
                  <em>{formatPercent(row.guru)}</em>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="guru-compare__card" style={{ '--i': 3 }}>
        <div className="guru-compare__subhead">
          <span>{en ? 'Regions' : '지역'}</span>
        </div>
        {regionRow(en ? 'Me' : '나', result.userRegions)}
        {regionRow(person, result.guruRegions)}
        <div className="guru-compare__region-keys">
          {usedRegions.map((key) => (
            <span key={key}>
              <i style={{ background: REGION_SWATCH[key] }} />
              {regionLabel(key)}
            </span>
          ))}
        </div>
      </div>

      <div className="guru-compare__card" style={{ '--i': 4 }}>
        <div className="guru-compare__subhead">
          <span>{en ? 'Concentration' : '집중도'}</span>
        </div>
        <dl className="guru-compare__stats">
          <dt />
          <dd>{en ? 'Me' : '나'}</dd>
          <dd className="is-guru">{person}</dd>
          <dt>{en ? 'Holdings' : '보유 종목'}</dt>
          <dd>{result.userConcentration.holdings}</dd>
          <dd className="is-guru">{guru.holdingsCount}</dd>
          <dt>{en ? 'Effective holdings' : '유효 종목'}</dt>
          <dd>{result.userConcentration.effectiveHoldings.toFixed(1)}</dd>
          <dd className="is-guru">{guru.effectiveHoldings.toFixed(1)}</dd>
          <dt>{en ? 'Largest' : '1위 비중'}</dt>
          <dd>{formatPercent(result.userConcentration.top1)}</dd>
          <dd className="is-guru">{formatPercent(guru.top1)}</dd>
          <dt>{en ? 'Top 5' : '상위 5 비중'}</dt>
          <dd>{formatPercent(result.userConcentration.top5)}</dd>
          <dd className="is-guru">{formatPercent(guru.top5)}</dd>
        </dl>
      </div>
    </div>
  );
}
