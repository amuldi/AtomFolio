// Generates the 8 demo portfolio CSVs: node scripts/generate-demo-portfolios.mjs samples/demo
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2];
mkdirSync(outDir, { recursive: true });

const DATES = ['2026-06-30', '2026-07-31', '2026-08-31', '2026-09-30', '2026-10-31', '2026-11-14'];

// [name, code, buyPrice, shares, currency, final return %, account]
const PORTFOLIOS = {
  '미국 빅테크': [
    ['Apple', 'AAPL', 195, 18, 'USD', 18.4, '해외주식'],
    ['Microsoft', 'MSFT', 410, 9, 'USD', 21.7, '해외주식'],
    ['NVIDIA', 'NVDA', 118, 40, 'USD', 46.2, '해외주식'],
    ['Alphabet', 'GOOGL', 165, 16, 'USD', 24.9, '해외주식'],
    ['Amazon', 'AMZN', 190, 14, 'USD', 9.6, '해외주식'],
    ['Meta Platforms', 'META', 560, 4, 'USD', -4.8, '해외주식'],
    ['Broadcom', 'AVGO', 170, 10, 'USD', 38.2, '해외주식'],
    ['Netflix', 'NFLX', 95, 30, 'USD', 18.6, '해외주식'],
    ['Oracle', 'ORCL', 180, 12, 'USD', 12.3, '해외주식'],
    ['Adobe', 'ADBE', 420, 5, 'USD', -14.2, '해외주식'],
    ['Salesforce', 'CRM', 300, 6, 'USD', -9.4, '해외주식'],
  ],
  '한국 대표주': [
    ['삼성전자', '005930', 58000, 120, 'KRW', 31.2, '위탁'],
    ['SK하이닉스', '000660', 175000, 25, 'KRW', 58.4, '위탁'],
    ['NAVER', '035420', 190000, 20, 'KRW', -6.3, '위탁'],
    ['현대차', '005380', 215000, 15, 'KRW', 4.1, '위탁'],
    ['KB금융', '105560', 82000, 40, 'KRW', 12.7, '위탁'],
    ['LG에너지솔루션', '373220', 360000, 6, 'KRW', -14.5, '위탁'],
    ['셀트리온', '068270', 175000, 10, 'KRW', -3.2, '위탁'],
    ['삼성바이오로직스', '207940', 900000, 2, 'KRW', 6.5, '위탁'],
    ['기아', '000270', 95000, 20, 'KRW', 8.8, '위탁'],
    ['POSCO홀딩스', '005490', 380000, 4, 'KRW', -21.5, '위탁'],
    ['카카오', '035720', 40000, 50, 'KRW', -12.4, '위탁'],
    ['신한지주', '055550', 45000, 40, 'KRW', 18.9, '위탁'],
  ],
  '미국 배당주': [
    ['Schwab U.S. Dividend Equity ETF', 'SCHD', 26.5, 220, 'USD', 5.2, '해외주식'],
    ['Vanguard High Dividend Yield ETF', 'VYM', 125, 40, 'USD', 8.9, '해외주식'],
    ['JPMorgan Equity Premium Income ETF', 'JEPI', 56, 90, 'USD', 1.4, '해외주식'],
    ['Realty Income', 'O', 56, 70, 'USD', -2.6, '해외주식'],
    ['Coca-Cola', 'KO', 68, 45, 'USD', 3.8, '해외주식'],
    ['Procter & Gamble', 'PG', 162, 18, 'USD', -5.1, '해외주식'],
    ['Johnson & Johnson', 'JNJ', 150, 15, 'USD', 4.6, '해외주식'],
    ['PepsiCo', 'PEP', 165, 12, 'USD', -9.8, '해외주식'],
    ['Verizon', 'VZ', 40, 60, 'USD', 2.1, '해외주식'],
    ['AbbVie', 'ABBV', 170, 10, 'USD', 15.4, '해외주식'],
    ['Exxon Mobil', 'XOM', 110, 15, 'USD', -1.7, '해외주식'],
  ],
  'ISA 국내상장 ETF': [
    ['TIGER 미국S&P500', '360750', 19500, 150, 'KRW', 16.8, 'ISA'],
    ['TIGER 미국나스닥100', '133690', 118000, 22, 'KRW', 22.5, 'ISA'],
    ['KODEX 200', '069500', 34000, 60, 'KRW', 27.9, 'ISA'],
    ['TIGER 미국배당다우존스', '458730', 11800, 200, 'KRW', 3.3, 'ISA'],
    ['ACE KRX금현물', '411060', 17500, 80, 'KRW', 35.6, 'ISA'],
    ['KODEX 반도체', '091160', 38000, 30, 'KRW', 24.1, 'ISA'],
    ['TIGER 200', '102110', 35000, 40, 'KRW', 26.8, 'ISA'],
    ['KODEX 2차전지산업', '305720', 14000, 80, 'KRW', -18.3, 'ISA'],
    ['TIGER 200 IT', '139260', 40000, 25, 'KRW', 31.0, 'ISA'],
    ['KODEX 레버리지', '122630', 18000, 50, 'KRW', 44.7, 'ISA'],
  ],
  '연금저축 장기투자': [
    ['KODEX 미국S&P500TR', '379800', 17200, 180, 'KRW', 19.1, '연금저축'],
    ['TIGER 미국테크TOP10 INDXX', '381170', 21500, 110, 'KRW', 28.3, '연금저축'],
    ['KODEX 200TR', '278530', 12800, 150, 'KRW', 24.6, '연금저축'],
    ['TIGER 리츠부동산인프라', '329200', 4600, 300, 'KRW', -3.9, '연금저축'],
    ['KOSEF 국고채10년', '148070', 112000, 12, 'KRW', 1.8, '연금저축'],
    ['ACE 미국S&P500', '360200', 19000, 100, 'KRW', 18.0, '연금저축'],
    ['TIGER 미국채10년선물', '305080', 12500, 60, 'KRW', 1.2, '연금저축'],
    ['KODEX 골드선물(H)', '132030', 15000, 40, 'KRW', 29.5, '연금저축'],
    ['PLUS 고배당주', '161510', 12500, 70, 'KRW', 14.1, '연금저축'],
    ['KODEX 200', '069500', 34000, 20, 'KRW', 27.2, '연금저축'],
  ],
  '성장주 공격형': [
    ['Tesla', 'TSLA', 260, 12, 'USD', 38.5, '해외주식'],
    ['Palantir', 'PLTR', 85, 40, 'USD', 72.4, '해외주식'],
    ['AMD', 'AMD', 150, 20, 'USD', 15.3, '해외주식'],
    ['ARK Innovation ETF', 'ARKK', 62, 50, 'USD', -11.2, '해외주식'],
    ['Coinbase', 'COIN', 290, 8, 'USD', -18.7, '해외주식'],
    ['Shopify', 'SHOP', 105, 25, 'USD', 9.9, '해외주식'],
    ['CrowdStrike', 'CRWD', 300, 5, 'USD', 42.5, '해외주식'],
    ['Snowflake', 'SNOW', 160, 8, 'USD', -6.9, '해외주식'],
    ['Cloudflare', 'NET', 90, 15, 'USD', 33.8, '해외주식'],
    ['Roblox', 'RBLX', 60, 25, 'USD', 51.2, '해외주식'],
    ['Unity Software', 'U', 25, 40, 'USD', -27.4, '해외주식'],
    ['Block', 'XYZ', 70, 15, 'USD', -12.6, '해외주식'],
  ],
  '글로벌 자산배분': [
    ['Vanguard S&P 500 ETF', 'VOO', 520, 10, 'USD', 13.6, '해외주식'],
    ['Vanguard FTSE Developed Markets ETF', 'VEA', 50, 80, 'USD', 9.4, '해외주식'],
    ['Vanguard FTSE Emerging Markets ETF', 'VWO', 45, 70, 'USD', 6.1, '해외주식'],
    ['Vanguard Total Bond Market ETF', 'BND', 73, 60, 'USD', 0.9, '해외주식'],
    ['SPDR Gold Shares', 'GLD', 300, 8, 'USD', 26.8, '해외주식'],
    ['삼성전자', '005930', 61000, 40, 'KRW', 24.7, '위탁'],
    ['Vanguard Real Estate ETF', 'VNQ', 90, 15, 'USD', 3.4, '해외주식'],
    ['iShares 20+ Year Treasury Bond ETF', 'TLT', 92, 20, 'USD', -4.1, '해외주식'],
    ['iShares MSCI Japan ETF', 'EWJ', 70, 20, 'USD', 11.8, '해외주식'],
    ['iShares MSCI India ETF', 'INDA', 52, 30, 'USD', 2.6, '해외주식'],
    ['TIGER 미국S&P500', '360750', 19500, 60, 'KRW', 16.1, '위탁'],
  ],
  '손실 회복 대기': [
    ['Intel', 'INTC', 31, 120, 'USD', -22.4, '해외주식'],
    ['Nike', 'NKE', 82, 35, 'USD', -16.8, '해외주식'],
    ['Pfizer', 'PFE', 29, 110, 'USD', -9.5, '해외주식'],
    ['Boeing', 'BA', 205, 10, 'USD', 4.2, '해외주식'],
    ['엔씨소프트', '036570', 240000, 8, 'KRW', -31.6, '위탁'],
    ['LG생활건강', '051900', 380000, 5, 'KRW', -27.3, '위탁'],
    ['Walt Disney', 'DIS', 115, 15, 'USD', -8.3, '해외주식'],
    ['PayPal', 'PYPL', 80, 20, 'USD', -21.7, '해외주식'],
    ['Starbucks', 'SBUX', 100, 12, 'USD', -12.9, '해외주식'],
    ['아모레퍼시픽', '090430', 160000, 6, 'KRW', -25.8, '위탁'],
    ['롯데케미칼', '011170', 120000, 5, 'KRW', -38.2, '위탁'],
    ['호텔신라', '008770', 70000, 10, 'KRW', -33.1, '위탁'],
  ],
};

// Deterministic noise so regenerating gives identical files.
function noise(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function round(value, currency) {
  return currency === 'KRW' ? Math.round(value) : Math.round(value * 100) / 100;
}

const files = [];
let seed = 1;
for (const [portfolioName, holdings] of Object.entries(PORTFOLIOS)) {
  const rows = ['평가일,계좌,종목명,종목코드,매수가,보유수량,평가금액,수익률,통화'];
  for (const date of DATES) {
    const step = DATES.indexOf(date);
    for (const [name, code, buy, shares, currency, finalReturn, account] of holdings) {
      // Return path: from ~35% of the final return at the first month to the final value,
      // with a wobble that shrinks to zero on the last date.
      const progress = 0.35 + 0.65 * (step / (DATES.length - 1));
      const wobble = step === DATES.length - 1 ? 0 : (noise(seed + step * 7.1) - 0.5) * 9;
      const returnRate = Math.round((finalReturn * progress + wobble) * 100) / 100;
      const price = buy * (1 + returnRate / 100);
      const value = round(price * shares, currency);
      const quotedName = name.includes(',') ? `"${name}"` : name;
      rows.push(
        [date, account, quotedName, code, buy, shares, value, `${returnRate}%`, currency].join(','),
      );
      seed += 1;
    }
  }
  const fileName = `${portfolioName}.csv`;
  writeFileSync(join(outDir, fileName), `${rows.join('\n')}\n`, 'utf8');
  files.push(fileName);
}
console.log(files.join('\n'));
