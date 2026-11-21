// What a person bought and sold, laid out so it reads at a glance with nothing to unfold:
//   TradeSummaryCard  last quarter's 13F changes — money in, money out, then every buy and sell
//                     ranked by size, each with its own bar, share change and price move
//   BuzzCard          a community's most-mentioned stocks (ApeWisdom)
//   TradesCard        an executive's Form 4 trades, newest first
// Each list sits in a ResizeBox: grab the strip under it and drag to show more or fewer rows.
import { describeChange, summarizeTrades } from '../../lib/guruLive.js';
import { KindBadge, Move, ResizeBox, TRADE_KIND, useFormatters } from './GuruShared.jsx';

function TradeRow({ change, maxValue, quote, language, fmt }) {
  const en = language === 'en';
  const lang = en ? 'en' : 'ko';
  const tone = TRADE_KIND[change.kind]?.tone ?? '';
  const width = maxValue > 0 ? Math.max(3, (Math.abs(change.tradeValueUsd) / maxValue) * 100) : 0;
  const ticker = change.ticker.startsWith('CUSIP:') ? '' : change.ticker;
  const shares =
    change.kind === 'new'
      ? `${fmt.shares(change.sharesAfter)}${en ? ' sh' : '주'}`
      : change.kind === 'soldOut'
        ? `${fmt.shares(change.sharesBefore)}${en ? ' sh' : '주'} → 0`
        : `${fmt.shares(change.sharesBefore)} → ${fmt.shares(change.sharesAfter)}${en ? ' sh' : '주'}`;
  return (
    <li className={`guru-trade__row ${tone}`}>
      <div className="guru-trade__top">
        <KindBadge kind={change.kind} lang={lang} />
        <span className="guru-panel__what">
          <strong>{change.name?.[lang] ?? change.ticker}</strong>
          {ticker ? <small>{ticker}</small> : null}
        </span>
        <b className="guru-trade__amount">{`≈${fmt.usd(Math.abs(change.tradeValueUsd))}`}</b>
      </div>
      <span className="guru-trade__bar" aria-hidden="true">
        <i style={{ width: `${width}%` }} />
      </span>
      <div className="guru-trade__bottom">
        <span>{[describeChange(change, language), shares].filter(Boolean).join(' · ')}</span>
        <span>
          {`${en ? 'Weight' : '비중'} ${fmt.percent(change.weightBefore)} → ${fmt.percent(change.weightAfter)}`}
          {quote ? <Move value={quote.sincePct} label={en ? 'Since' : '이후'} /> : null}
        </span>
      </div>
    </li>
  );
}

export function TradeSummaryCard({ fund, quotes, language }) {
  const en = language === 'en';
  const fmt = useFormatters(en);
  if (!fund?.previous || !fund.changes?.length) return null;
  const { buys, sells, boughtUsd, soldUsd, netUsd } = summarizeTrades(fund.changes);
  const maxValue = Math.max(0, ...fund.changes.map((change) => Math.abs(change.tradeValueUsd)));
  const counts = fund.changeCounts ?? {};
  const total = boughtUsd + soldUsd;
  const section = (title, rows, tone) =>
    rows.length ? (
      <section className={`guru-trade__section ${tone}`}>
        <h4>
          {title}
          <em>{rows.length}</em>
        </h4>
        <ul>
          {rows.map((change) => (
            <TradeRow
              key={`${change.cusip}-${change.kind}`}
              change={change}
              maxValue={maxValue}
              quote={quotes?.[change.ticker]}
              language={language}
              fmt={fmt}
            />
          ))}
        </ul>
      </section>
    ) : null;
  return (
    <div className="guru-compare__card guru-trade">
      <div className="guru-compare__subhead">
        <span>{en ? 'Buys & sells' : '이번 분기 매매'}</span>
        <em>{`${fund.previous.period} → ${fund.period}`}</em>
      </div>
      <div className="guru-trade__balance">
        <div className="is-buy">
          <em>{en ? 'Bought' : '사들인 돈'}</em>
          <b>{`≈${fmt.usd(boughtUsd)}`}</b>
        </div>
        <div className="is-sell">
          <em>{en ? 'Sold' : '팔아낸 돈'}</em>
          <b>{`≈${fmt.usd(soldUsd)}`}</b>
        </div>
        <div className={netUsd >= 0 ? 'is-buy' : 'is-sell'}>
          <em>{en ? 'Net' : '순매수'}</em>
          <b>{`${netUsd >= 0 ? '+' : '−'}${fmt.usd(Math.abs(netUsd))}`}</b>
        </div>
      </div>
      {total > 0 ? (
        <div className="guru-trade__split" aria-hidden="true">
          <i className="is-buy" style={{ flexGrow: boughtUsd }} />
          <i className="is-sell" style={{ flexGrow: soldUsd }} />
        </div>
      ) : null}
      <div className="guru-panel__counts">
        {['new', 'added', 'trimmed', 'soldOut'].map((kind) => (
          <span key={kind} className={TRADE_KIND[kind].tone}>
            {TRADE_KIND[kind][en ? 'en' : 'ko']} <b>{counts[kind] ?? 0}</b>
          </span>
        ))}
      </div>
      <ResizeBox
        storageKey="atomfolio-guru-trades-height"
        initial={380}
        max={900}
        label={en ? 'Drag to resize' : '끌어서 크기 조절'}
      >
        {section(en ? 'Bought more' : '더 산 종목', buys, 'is-buy')}
        {section(en ? 'Sold' : '판 종목', sells, 'is-sell')}
      </ResizeBox>
    </div>
  );
}

// Community mention ranking (not holdings): rank and mentions now vs 24 hours ago.
export function BuzzCard({ fund, language }) {
  const en = language === 'en';
  if (fund?.source !== 'ApeWisdom') return null;
  return (
    <div className="guru-compare__card guru-panel__activity">
      <div className="guru-compare__subhead">
        <span>{en ? 'Most mentioned · 24h' : '언급 순위 · 24시간'}</span>
        <em>ApeWisdom</em>
      </div>
      <ResizeBox
        storageKey="atomfolio-guru-buzz-height"
        initial={320}
        label={en ? 'Drag to resize' : '끌어서 크기 조절'}
      >
        <ul className="guru-panel__rows">
          {fund.holdings.map((holding) => {
            const delta = holding.mentions - holding.mentions24hAgo;
            const moved = holding.rank24hAgo ? holding.rank24hAgo - holding.rank : null;
            return (
              <li key={holding.ticker}>
                <span className="guru-panel__rank">{holding.rank}</span>
                <span className="guru-panel__what">
                  <strong>{holding.ticker}</strong>
                  <small>{holding.name?.[en ? 'en' : 'ko']}</small>
                </span>
                <span className="guru-panel__how">
                  {`${holding.mentions.toLocaleString()}${en ? ' mentions' : '회'}`}
                  <em className={delta > 0 ? 'positive' : delta < 0 ? 'negative' : ''}>
                    {`${delta >= 0 ? '+' : ''}${delta.toLocaleString()}${moved ? ` · ${moved > 0 ? '▲' : '▼'}${Math.abs(moved)}` : ''}`}
                  </em>
                </span>
              </li>
            );
          })}
        </ul>
      </ResizeBox>
    </div>
  );
}

// An executive's own Form 4 trades: every row is listed; pull the grip to show more of them.
export function TradesCard({ insider, quotes, language }) {
  const en = language === 'en';
  const lang = en ? 'en' : 'ko';
  const fmt = useFormatters(en);
  if (!insider?.trades?.length) return null;
  return (
    <div className="guru-compare__card guru-panel__activity">
      <div className="guru-compare__subhead">
        <span>{en ? 'Latest trades' : '최근 매매'}</span>
        <em>{`Form 4 · ${insider.latestFiled} · ${insider.trades.length}${en ? '' : '건'}`}</em>
      </div>
      <ResizeBox
        storageKey="atomfolio-guru-form4-height"
        initial={300}
        label={en ? 'Drag to resize' : '끌어서 크기 조절'}
      >
        <ul className="guru-panel__rows">
          {insider.trades.map((trade) => {
            const quote = quotes?.[trade.ticker];
            return (
              <li key={`${trade.date}-${trade.ticker}-${trade.kind}-${trade.filed}`}>
                <KindBadge kind={trade.kind} lang={lang} />
                <span className="guru-panel__what">
                  <strong>{trade.ticker || trade.issuer}</strong>
                  <small>{trade.date}</small>
                </span>
                <span className="guru-panel__how">
                  {`${fmt.shares(trade.shares)}${en ? ' sh' : '주'}${trade.averagePrice ? ` @ ${fmt.price(trade.averagePrice)}` : ''}`}
                  <em>
                    {[
                      trade.valueUsd ? fmt.usd(trade.valueUsd) : null,
                      trade.plan10b5 ? '10b5-1' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    {quote && trade.averagePrice > 0 ? (
                      <Move
                        value={(quote.price / trade.averagePrice - 1) * 100}
                        label={en ? 'Now' : '지금'}
                      />
                    ) : null}
                  </em>
                </span>
              </li>
            );
          })}
        </ul>
      </ResizeBox>
    </div>
  );
}
