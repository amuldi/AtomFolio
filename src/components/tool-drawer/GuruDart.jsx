// Korean company cards (OpenDART): who owns it and what insiders recently did. Rates are percent
// of common stock; the atom on the stage draws the same owners.
import { useFormatters } from './GuruShared.jsx';

export function DartCards({ dart, language }) {
  const en = language === 'en';
  const fmt = useFormatters(en);
  if (!dart) return null;
  const { owners, blockholders, executives } = dart;
  const signed = (value) => `${value > 0 ? '+' : ''}${fmt.shares(value)}`;
  return (
    <>
      {owners.owners.length ? (
        <div className="guru-compare__card guru-panel__activity">
          <div className="guru-compare__subhead">
            <span>{en ? 'Largest shareholders' : '최대주주 · 특수관계인'}</span>
            <em>{`${owners.year ?? ''} ${en ? 'annual report' : '사업보고서'}`}</em>
          </div>
          <ul className="guru-panel__rows">
            {owners.owners.slice(0, 10).map((owner) => {
              const delta = owner.shares - owner.sharesBefore;
              return (
                <li key={owner.name}>
                  <span className="guru-panel__rank">{`${owner.rate.toFixed(2)}%`}</span>
                  <span className="guru-panel__what">
                    <strong>{owner.name}</strong>
                    <small>{owner.relation}</small>
                  </span>
                  <span className="guru-panel__how">
                    {`${fmt.shares(owner.shares)}${en ? ' sh' : '주'}`}
                    {delta ? <em className={delta > 0 ? 'positive' : 'negative'}>{signed(delta)}</em> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {blockholders.length ? (
        <div className="guru-compare__card guru-panel__activity">
          <div className="guru-compare__subhead">
            <span>{en ? '5%+ blockholders' : '5% 이상 대량보유'}</span>
            <em>{en ? 'latest report each' : '보고자별 최신'}</em>
          </div>
          <ul className="guru-panel__rows">
            {blockholders.map((holder) => (
              <li key={`${holder.name}-${holder.receipt}`}>
                <span className="guru-panel__rank">{holder.rate != null ? `${holder.rate.toFixed(2)}%` : '-'}</span>
                <span className="guru-panel__what">
                  <strong>{holder.name}</strong>
                  <small>{holder.date}</small>
                </span>
                <span className="guru-panel__how">
                  {holder.reason}
                  {holder.rateChange ? (
                    <em className={holder.rateChange > 0 ? 'positive' : 'negative'}>
                      {`${holder.rateChange > 0 ? '+' : ''}${holder.rateChange.toFixed(2)}%p`}
                    </em>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {executives.length ? (
        <div className="guru-compare__card guru-panel__activity">
          <div className="guru-compare__subhead">
            <span>{en ? 'Executive trades' : '임원·주요주주 매매'}</span>
            <em>{en ? 'DART' : 'DART 공시'}</em>
          </div>
          <ul className="guru-panel__rows">
            {executives.slice(0, 12).map((trade) => (
              <li key={`${trade.receipt}-${trade.name}`}>
                <span className={`guru-panel__kind ${trade.change > 0 ? 'is-buy' : 'is-sell'}`}>
                  {trade.change > 0 ? (en ? 'Buy' : '취득') : en ? 'Sell' : '처분'}
                </span>
                <span className="guru-panel__what">
                  <strong>{trade.name}</strong>
                  <small>{[trade.title, trade.date].filter(Boolean).join(' · ')}</small>
                </span>
                <span className="guru-panel__how">
                  {`${signed(trade.change)}${en ? ' sh' : '주'}`}
                  <em>{`${en ? 'holds' : '보유'} ${fmt.shares(trade.shares)}`}</em>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
