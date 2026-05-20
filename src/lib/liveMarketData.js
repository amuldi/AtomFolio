const YAHOO_CHART_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YAHOO_SEARCH_URL = 'https://query1.finance.yahoo.com/v1/finance/search';
const STOOQ_QUOTE_URL = 'https://stooq.com/q/l/';
const NAVER_STOCK_BASIC_BASE = 'https://m.stock.naver.com/api/stock';
const DEFAULT_SEARCH_LIMIT = 10;
const MARKET_WINDOWS = [
  { range: '1d', interval: '5m' },
  { range: '5d', interval: '15m' },
  { range: '1mo', interval: '1d' },
];
const LOCAL_SECURITY_UNIVERSE = [
  {
    symbol: '005930.KS',
    name: '삼성전자',
    rawName: 'Samsung Electronics Co., Ltd.',
    exchangeName: 'Korea',
    aliases: ['삼전', '삼성 전자', 'samsung electronics', 'samsung elec'],
  },
  {
    symbol: '005935.KS',
    name: '삼성전자우',
    rawName: 'Samsung Electronics Co., Ltd. Pfd.',
    exchangeName: 'Korea',
    aliases: ['삼전우', '삼성전자 우선주', '삼성전자우선주', 'samsung electronics preferred'],
  },
  {
    symbol: '000660.KS',
    name: 'SK하이닉스',
    rawName: 'SK hynix Inc.',
    exchangeName: 'Korea',
    aliases: ['하이닉스', '슼하이닉스', 'sk hynix', 'hynix'],
  },
  {
    symbol: '373220.KS',
    name: 'LG에너지솔루션',
    rawName: 'LG Energy Solution, Ltd.',
    exchangeName: 'Korea',
    aliases: ['엘지에너지솔루션', '엔솔', 'lg엔솔', 'lg energy solution'],
  },
  {
    symbol: '207940.KS',
    name: '삼성바이오로직스',
    rawName: 'Samsung Biologics Co., Ltd.',
    exchangeName: 'Korea',
    aliases: ['삼바', '삼성바이오', 'samsung biologics'],
  },
  {
    symbol: '005380.KS',
    name: '현대차',
    rawName: 'Hyundai Motor Company',
    exchangeName: 'Korea',
    aliases: ['현차', '현대자동차', 'hyundai motor'],
  },
  {
    symbol: '000270.KS',
    name: '기아',
    rawName: 'Kia Corporation',
    exchangeName: 'Korea',
    aliases: ['kia', '기아차'],
  },
  {
    symbol: '035420.KS',
    name: 'NAVER',
    rawName: 'NAVER Corporation',
    exchangeName: 'Korea',
    aliases: ['네이버', 'naver'],
  },
  {
    symbol: '035720.KS',
    name: '카카오',
    rawName: 'Kakao Corp.',
    exchangeName: 'Korea',
    aliases: ['kakao'],
  },
  {
    symbol: '323410.KS',
    name: '카카오뱅크',
    rawName: 'KakaoBank Corp.',
    exchangeName: 'Korea',
    aliases: ['카뱅', 'kakaobank', 'kakao bank'],
  },
  {
    symbol: '377300.KS',
    name: '카카오페이',
    rawName: 'Kakao Pay Corp.',
    exchangeName: 'Korea',
    aliases: ['카페', 'kakaopay', 'kakao pay'],
  },
  {
    symbol: '068270.KS',
    name: '셀트리온',
    rawName: 'Celltrion, Inc.',
    exchangeName: 'Korea',
    aliases: ['셀트', 'celltrion'],
  },
  {
    symbol: '005490.KS',
    name: 'POSCO홀딩스',
    rawName: 'POSCO Holdings Inc.',
    exchangeName: 'Korea',
    aliases: ['포스코홀딩스', '포홀', '포스코', 'posco'],
  },
  {
    symbol: '051910.KS',
    name: 'LG화학',
    rawName: 'LG Chem, Ltd.',
    exchangeName: 'Korea',
    aliases: ['엘지화학', 'lg chem'],
  },
  {
    symbol: '006400.KS',
    name: '삼성SDI',
    rawName: 'Samsung SDI Co., Ltd.',
    exchangeName: 'Korea',
    aliases: ['삼성에스디아이', '삼스디', 'samsung sdi'],
  },
  {
    symbol: '012330.KS',
    name: '현대모비스',
    rawName: 'Hyundai Mobis Co., Ltd.',
    exchangeName: 'Korea',
    aliases: ['모비스', 'hyundai mobis'],
  },
  {
    symbol: '105560.KS',
    name: 'KB금융',
    rawName: 'KB Financial Group Inc.',
    exchangeName: 'Korea',
    aliases: ['국민은행', 'kb financial'],
  },
  {
    symbol: '055550.KS',
    name: '신한지주',
    rawName: 'Shinhan Financial Group Co., Ltd.',
    exchangeName: 'Korea',
    aliases: ['신한금융', '신한', 'shinhan'],
  },
  {
    symbol: '086790.KS',
    name: '하나금융지주',
    rawName: 'Hana Financial Group Inc.',
    exchangeName: 'Korea',
    aliases: ['하나금융', 'hana financial'],
  },
  {
    symbol: '034020.KS',
    name: '두산에너빌리티',
    rawName: 'Doosan Enerbility Co., Ltd.',
    exchangeName: 'Korea',
    aliases: ['두산중공업', '두빌', 'doosan enerbility'],
  },
  {
    symbol: '012450.KS',
    name: '한화에어로스페이스',
    rawName: 'Hanwha Aerospace Co., Ltd.',
    exchangeName: 'Korea',
    aliases: ['한화에어로', '한에', 'hanwha aerospace'],
  },
  {
    symbol: '042660.KS',
    name: '한화오션',
    rawName: 'Hanwha Ocean Co., Ltd.',
    exchangeName: 'Korea',
    aliases: ['대우조선해양', 'hanwha ocean'],
  },
  {
    symbol: '010140.KS',
    name: '삼성중공업',
    rawName: 'Samsung Heavy Industries Co., Ltd.',
    exchangeName: 'Korea',
    aliases: ['삼중', 'samsung heavy industries'],
  },
  {
    symbol: '042700.KS',
    name: '한미반도체',
    rawName: 'Hanmi Semiconductor Co., Ltd.',
    exchangeName: 'Korea',
    aliases: ['한미반도체', 'hanmi semiconductor'],
  },
  {
    symbol: '267260.KS',
    name: 'HD현대일렉트릭',
    rawName: 'HD Hyundai Electric Co., Ltd.',
    exchangeName: 'Korea',
    aliases: ['현대일렉트릭', 'hd hyundai electric'],
  },
  {
    symbol: '247540.KQ',
    name: '에코프로비엠',
    rawName: 'Ecopro BM Co., Ltd.',
    exchangeName: 'Korea',
    aliases: ['에코비', '에코프로 비엠', 'ecopro bm'],
  },
  {
    symbol: '086520.KQ',
    name: '에코프로',
    rawName: 'Ecopro Co., Ltd.',
    exchangeName: 'Korea',
    aliases: ['ecopro'],
  },
  {
    symbol: '196170.KQ',
    name: '알테오젠',
    rawName: 'Alteogen Inc.',
    exchangeName: 'Korea',
    aliases: ['alteogen'],
  },
  {
    symbol: '028300.KQ',
    name: 'HLB',
    rawName: 'HLB Co., Ltd.',
    exchangeName: 'Korea',
    aliases: ['에이치엘비'],
  },
  {
    symbol: '277810.KQ',
    name: '레인보우로보틱스',
    rawName: 'Rainbow Robotics Inc.',
    exchangeName: 'Korea',
    aliases: ['레인보우', 'rainbow robotics'],
  },
  {
    symbol: '259960.KS',
    name: '크래프톤',
    rawName: 'Krafton, Inc.',
    exchangeName: 'Korea',
    aliases: ['krafton'],
  },
  {
    symbol: '352820.KS',
    name: '하이브',
    rawName: 'HYBE Co., Ltd.',
    exchangeName: 'Korea',
    aliases: ['hybe', '빅히트'],
  },
  {
    symbol: '066570.KS',
    name: 'LG전자',
    rawName: 'LG Electronics Inc.',
    exchangeName: 'Korea',
    aliases: ['엘지전자', 'lg electronics'],
  },
  {
    symbol: '028260.KS',
    name: '삼성물산',
    rawName: 'Samsung C&T Corporation',
    exchangeName: 'Korea',
    aliases: ['삼물', 'samsung c&t'],
  },
  {
    symbol: '032830.KS',
    name: '삼성생명',
    rawName: 'Samsung Life Insurance Co., Ltd.',
    exchangeName: 'Korea',
    aliases: ['삼생', 'samsung life'],
  },
  {
    symbol: '017670.KS',
    name: 'SK텔레콤',
    rawName: 'SK Telecom Co., Ltd.',
    exchangeName: 'Korea',
    aliases: ['에스케이텔레콤', 'skt', 'sk telecom'],
  },
  {
    symbol: '030200.KS',
    name: 'KT',
    rawName: 'KT Corporation',
    exchangeName: 'Korea',
    aliases: ['케이티'],
  },
  {
    symbol: '033780.KS',
    name: 'KT&G',
    rawName: 'KT&G Corporation',
    exchangeName: 'Korea',
    aliases: ['케이티앤지', 'ktng'],
  },
  {
    symbol: '011200.KS',
    name: 'HMM',
    rawName: 'HMM Co., Ltd.',
    exchangeName: 'Korea',
    aliases: ['에이치엠엠', '현대상선'],
  },
  {
    symbol: '360750.KS',
    name: 'TIGER 미국S&P500',
    rawName: 'Mirae Asset TIGER US S&P500 ETF',
    exchangeName: 'Korea',
    quoteType: 'ETF',
    typeDisp: 'ETF',
    aliases: ['타이거 미국 s&p500', '타이거 미국 에스앤피500', '미국s&p500', '미국에스앤피', 'tiger s&p 500', 'tiger sp500'],
  },
  {
    symbol: '133690.KS',
    name: 'TIGER 미국나스닥100',
    rawName: 'Mirae Asset TIGER US Nasdaq 100 ETF',
    exchangeName: 'Korea',
    quoteType: 'ETF',
    typeDisp: 'ETF',
    aliases: ['타이거 미국 나스닥100', '타이거 나스닥', '미국나스닥100', 'tiger nasdaq 100'],
  },
  {
    symbol: '381170.KS',
    name: 'TIGER 미국테크TOP10 INDXX',
    rawName: 'Mirae Asset TIGER US Tech Top 10 INDXX ETF',
    exchangeName: 'Korea',
    quoteType: 'ETF',
    typeDisp: 'ETF',
    aliases: ['타이거 미국테크탑텐', '타이거 미국테크 top10', '미국테크top10', 'tiger us tech top 10'],
  },
  {
    symbol: '381180.KS',
    name: 'TIGER 미국필라델피아반도체나스닥',
    rawName: 'Mirae Asset TIGER US Philadelphia Semiconductor Nasdaq ETF',
    exchangeName: 'Korea',
    quoteType: 'ETF',
    typeDisp: 'ETF',
    aliases: ['타이거 미국필라델피아반도체', '필라델피아반도체', '미국반도체', 'tiger semiconductor'],
  },
  {
    symbol: '458730.KS',
    name: 'TIGER 미국배당다우존스',
    rawName: 'Mirae Asset TIGER US Dividend Dow Jones ETF',
    exchangeName: 'Korea',
    quoteType: 'ETF',
    typeDisp: 'ETF',
    aliases: ['미국배당', '배당다우존스', '타이거 미국배당', '타미당', '미국배당다우존스', 'tiger dividend dow jones'],
  },
  {
    symbol: '488500.KS',
    name: 'TIGER 미국S&P500동일가중',
    rawName: 'Mirae Asset TIGER US S&P500 Equal Weight ETF',
    exchangeName: 'Korea',
    quoteType: 'ETF',
    typeDisp: 'ETF',
    aliases: ['타이거 미국 s&p 동일가중', 'tiger s&p equal weight'],
  },
  {
    symbol: '143850.KS',
    name: 'TIGER S&P500 Futures ETF',
    rawName: 'Mirae Asset TIGER S&P500 Futures ETF',
    exchangeName: 'Korea',
    quoteType: 'ETF',
    typeDisp: 'ETF',
    aliases: ['타이거 s&p500 선물', 'tiger s&p500 futures'],
  },
  {
    symbol: '411060.KS',
    name: 'ACE KRX금현물',
    rawName: 'Korea Investment ACE KRX Gold Spot ETF',
    exchangeName: 'Korea',
    quoteType: 'ETF',
    typeDisp: '금/원자재',
    sector: '금',
    assetClass: '금/원자재 ETF',
    aliases: ['금', '골드', '금현물', 'krx 금현물', 'ace 금', 'ace gold', 'gold spot'],
  },
  {
    symbol: '132030.KS',
    name: 'KODEX 골드선물(H)',
    rawName: 'Samsung KODEX Gold Futures(H) ETF',
    exchangeName: 'Korea',
    quoteType: 'ETF',
    typeDisp: '금/원자재',
    sector: '금',
    assetClass: '금/원자재 ETF',
    aliases: ['금', '골드', '금선물', '골드선물', '코덱스 골드', 'kodex gold', 'gold futures'],
  },
  {
    symbol: '139320.KS',
    name: 'TIGER 금은선물(H)',
    rawName: 'Mirae Asset TIGER Gold Silver Futures(H) ETF',
    exchangeName: 'Korea',
    quoteType: 'ETF',
    typeDisp: '금/원자재',
    sector: '금',
    assetClass: '금/원자재 ETF',
    aliases: ['금', '은', '골드', '실버', '금은선물', '타이거 금', 'tiger gold silver'],
  },
  {
    symbol: '069500.KS',
    name: 'KODEX 200',
    rawName: 'Samsung KODEX 200 ETF',
    exchangeName: 'Korea',
    quoteType: 'ETF',
    typeDisp: 'ETF',
    aliases: ['코덱스 200', 'kodex 200'],
  },
  {
    symbol: '122630.KS',
    name: 'KODEX 레버리지',
    rawName: 'Samsung KODEX Leverage ETF',
    exchangeName: 'Korea',
    quoteType: 'ETF',
    typeDisp: 'ETF',
    aliases: ['코덱스 레버리지', 'kodex leverage'],
  },
  {
    symbol: '114800.KS',
    name: 'KODEX 인버스',
    rawName: 'Samsung KODEX Inverse ETF',
    exchangeName: 'Korea',
    quoteType: 'ETF',
    typeDisp: 'ETF',
    aliases: ['코덱스 인버스', 'kodex inverse'],
  },
  {
    symbol: '379800.KS',
    name: 'KODEX 미국S&P500TR',
    rawName: 'Samsung KODEX US S&P500 TR ETF',
    exchangeName: 'Korea',
    quoteType: 'ETF',
    typeDisp: 'ETF',
    aliases: ['코덱스 미국 s&p500', 'kodex us s&p500'],
  },
  {
    symbol: '379810.KS',
    name: 'KODEX 미국나스닥100TR',
    rawName: 'Samsung KODEX US Nasdaq 100 TR ETF',
    exchangeName: 'Korea',
    quoteType: 'ETF',
    typeDisp: 'ETF',
    aliases: ['코덱스 미국 나스닥100', 'kodex nasdaq 100'],
  },
  {
    symbol: '360200.KS',
    name: 'ACE 미국S&P500',
    rawName: 'Korea Investment ACE US S&P500 ETF',
    exchangeName: 'Korea',
    quoteType: 'ETF',
    typeDisp: 'ETF',
    aliases: ['에이스 미국 s&p500', '킨덱스 미국 s&p500', 'kindex s&p500', 'ace s&p500'],
  },
  {
    symbol: '367380.KS',
    name: 'ACE 미국나스닥100',
    rawName: 'Korea Investment ACE US Nasdaq 100 ETF',
    exchangeName: 'Korea',
    quoteType: 'ETF',
    typeDisp: 'ETF',
    aliases: ['에이스 미국 나스닥100', '킨덱스 미국 나스닥100', 'ace nasdaq 100'],
  },
  {
    symbol: '379780.KS',
    name: 'RISE 미국S&P500',
    rawName: 'KB RISE US S&P500 ETF',
    exchangeName: 'Korea',
    quoteType: 'ETF',
    typeDisp: 'ETF',
    aliases: ['라이즈 미국 s&p500', 'kbstar 미국 s&p500', '케이비스타 미국 s&p500', 'rise s&p500'],
  },
  {
    symbol: '368590.KS',
    name: 'RISE 미국나스닥100',
    rawName: 'KB RISE US Nasdaq 100 ETF',
    exchangeName: 'Korea',
    quoteType: 'ETF',
    typeDisp: 'ETF',
    aliases: ['라이즈 미국 나스닥100', 'kbstar 미국 나스닥100', '케이비스타 미국 나스닥100', 'rise nasdaq 100'],
  },
  {
    symbol: '446720.KS',
    name: 'SOL 미국배당다우존스',
    rawName: 'Shinhan SOL US Dividend Dow Jones ETF',
    exchangeName: 'Korea',
    quoteType: 'ETF',
    typeDisp: 'ETF',
    aliases: ['미국배당', '배당다우존스', '솔 미국배당', '솔미당', '미국배당다우존스', 'sol dividend dow jones'],
  },
  {
    symbol: 'AAPL',
    name: '애플',
    rawName: 'Apple Inc.',
    exchangeName: 'Nasdaq',
    aliases: ['apple', '아이폰'],
  },
  {
    symbol: 'MSFT',
    name: '마이크로소프트',
    rawName: 'Microsoft Corporation',
    exchangeName: 'Nasdaq',
    aliases: ['마이크로소프트', '마소', 'msft'],
  },
  {
    symbol: 'NVDA',
    name: '엔비디아',
    rawName: 'NVIDIA Corporation',
    exchangeName: 'Nasdaq',
    aliases: ['엔비디아', '엔비', 'nvidia'],
  },
  {
    symbol: 'TSLA',
    name: '테슬라',
    rawName: 'Tesla, Inc.',
    exchangeName: 'Nasdaq',
    aliases: ['테슬라', 'tesla'],
  },
  {
    symbol: 'GOOGL',
    name: '알파벳',
    rawName: 'Alphabet Inc.',
    exchangeName: 'Nasdaq',
    aliases: ['구글', '알파벳', 'google', 'alphabet'],
  },
  {
    symbol: 'AMZN',
    name: '아마존',
    rawName: 'Amazon.com, Inc.',
    exchangeName: 'Nasdaq',
    aliases: ['아마존', 'amazon'],
  },
  {
    symbol: 'META',
    name: '메타',
    rawName: 'Meta Platforms, Inc.',
    exchangeName: 'Nasdaq',
    aliases: ['메타', '페이스북', 'facebook'],
  },
  {
    symbol: 'NFLX',
    name: '넷플릭스',
    rawName: 'Netflix, Inc.',
    exchangeName: 'Nasdaq',
    aliases: ['넷플릭스', '넷플', 'netflix'],
  },
  {
    symbol: 'AMD',
    name: 'AMD',
    rawName: 'Advanced Micro Devices, Inc.',
    exchangeName: 'Nasdaq',
    aliases: ['암드', 'advanced micro devices'],
  },
  {
    symbol: 'INTC',
    name: '인텔',
    rawName: 'Intel Corporation',
    exchangeName: 'Nasdaq',
    aliases: ['intel', '인텔코퍼레이션'],
  },
  {
    symbol: 'PINS',
    name: '핀터레스트',
    rawName: 'Pinterest, Inc.',
    exchangeName: 'NYSE',
    aliases: ['pinterest', '핀터'],
  },
  {
    symbol: 'PLTR',
    name: '팔란티어',
    rawName: 'Palantir Technologies Inc.',
    exchangeName: 'Nasdaq',
    aliases: ['팔란티어', 'palantir'],
  },
  {
    symbol: 'AVGO',
    name: '브로드컴',
    rawName: 'Broadcom Inc.',
    exchangeName: 'Nasdaq',
    aliases: ['브로드컴', 'broadcom'],
  },
  {
    symbol: 'TSM',
    name: 'TSMC',
    rawName: 'Taiwan Semiconductor Manufacturing Company Limited',
    exchangeName: 'NYSE',
    aliases: ['티에스엠씨', '대만반도체', 'taiwan semiconductor'],
  },
  {
    symbol: 'SPY',
    name: 'SPY 미국S&P500 ETF',
    rawName: 'SPDR S&P 500 ETF Trust',
    exchangeName: 'NYSE Arca',
    quoteType: 'ETF',
    typeDisp: 'ETF',
    aliases: ['스파이', 's&p500', 's&p 500'],
  },
  {
    symbol: 'QQQ',
    name: 'QQQ 나스닥100 ETF',
    rawName: 'Invesco QQQ Trust',
    exchangeName: 'Nasdaq',
    quoteType: 'ETF',
    typeDisp: 'ETF',
    aliases: ['큐큐큐', '나스닥100', 'nasdaq 100'],
  },
  {
    symbol: 'VOO',
    name: 'VOO 미국S&P500 ETF',
    rawName: 'Vanguard S&P 500 ETF',
    exchangeName: 'NYSE Arca',
    quoteType: 'ETF',
    typeDisp: 'ETF',
    aliases: ['부', '브이오오', 'vanguard s&p 500'],
  },
  {
    symbol: 'SCHD',
    name: 'SCHD 미국배당 ETF',
    rawName: 'Schwab US Dividend Equity ETF',
    exchangeName: 'NYSE Arca',
    quoteType: 'ETF',
    typeDisp: 'ETF',
    aliases: ['슈드', '미국배당', 'schwab dividend'],
  },
  {
    symbol: 'GLD',
    name: 'GLD 금 ETF',
    rawName: 'SPDR Gold Shares',
    exchangeName: 'NYSE Arca',
    quoteType: 'ETF',
    typeDisp: '금/원자재',
    sector: '금',
    assetClass: '금/원자재 ETF',
    aliases: ['금', '골드', '미국 금 etf', 'spdr gold', 'gold shares'],
  },
  {
    symbol: 'IAU',
    name: 'IAU 금 ETF',
    rawName: 'iShares Gold Trust',
    exchangeName: 'NYSE Arca',
    quoteType: 'ETF',
    typeDisp: '금/원자재',
    sector: '금',
    assetClass: '금/원자재 ETF',
    aliases: ['금', '골드', '미국 금 etf', 'ishares gold', 'gold trust'],
  },
  {
    symbol: 'GLDM',
    name: 'GLDM 미니 금 ETF',
    rawName: 'SPDR Gold MiniShares Trust',
    exchangeName: 'NYSE Arca',
    quoteType: 'ETF',
    typeDisp: '금/원자재',
    sector: '금',
    assetClass: '금/원자재 ETF',
    aliases: ['금', '골드', '미니 금', 'spdr gold mini', 'gold minishares'],
  },
  {
    symbol: 'GC=F',
    name: '금 선물',
    rawName: 'Gold Futures',
    exchangeName: 'COMEX',
    quoteType: 'FUTURE',
    typeDisp: '금/원자재',
    sector: '금',
    assetClass: '원자재',
    aliases: ['금', '골드', '국제 금', '금 가격', 'gold futures', 'comex gold'],
  },
];
const LOCAL_SYMBOL_DISPLAY_NAMES = Object.fromEntries(
  LOCAL_SECURITY_UNIVERSE.map((entry) => [normalizeSymbol(entry.symbol), entry.name]),
);
const LOCAL_SYMBOL_METADATA = Object.fromEntries(
  LOCAL_SECURITY_UNIVERSE.map((entry) => [
    normalizeSymbol(entry.symbol),
    {
      assetClass: entry.assetClass || '',
      sector: entry.sector || '',
      exchangeName: entry.exchangeName || '',
      quoteType: entry.quoteType || '',
      typeDisp: entry.typeDisp || '',
    },
  ]),
);
const KOREAN_QUERY_ALIASES = [
  ['타이거', 'tiger'],
  ['티거', 'tiger'],
  ['삼전우', 'samsung electronics preferred'],
  ['삼전', 'samsung electronics'],
  ['삼성전자', 'samsung electronics'],
  ['하이닉스', 'sk hynix'],
  ['카뱅', 'kakao bank'],
  ['카페', 'kakao pay'],
  ['에코비', 'ecopro bm'],
  ['에코프로비엠', 'ecopro bm'],
  ['팔란티어', 'palantir'],
  ['핀터레스트', 'pinterest'],
  ['엔비디아', 'nvidia'],
  ['테슬라', 'tesla'],
  ['애플', 'apple'],
  ['넷플', 'netflix'],
  ['넷플릭스', 'netflix'],
  ['인텔', 'intel'],
  ['마소', 'microsoft'],
  ['구글', 'google'],
  ['코덱스', 'kodex'],
  ['에이스', 'ace'],
  ['킨덱스', 'kindex'],
  ['케이비스타', 'kbstar'],
  ['케이비 스타', 'kbstar'],
  ['솔', 'sol'],
  ['아리랑', 'arirang'],
  ['히어로즈', 'heroes'],
  ['한투', 'ace'],
  ['미국배당', 'dividend'],
  ['미국나스닥', 'nasdaq'],
  ['미국에스앤피', 's&p'],
  ['미국반도체', 'semiconductor'],
  ['금현물', 'gold spot'],
  ['금선물', 'gold futures'],
  ['골드', 'gold'],
];

function normalizeSymbol(value) {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

function isKoreanListedSymbol(symbol) {
  return /^\d{6}(?:\.(?:KS|KQ))?$/.test(normalizeSymbol(symbol));
}

function cleanExchangeName(exchangeName, symbol = '') {
  const normalizedSymbol = normalizeSymbol(symbol);
  const clean = String(exchangeName ?? '').trim();

  if (
    isKoreanListedSymbol(normalizedSymbol) ||
    /korea|krx|kospi|kosdaq|ksc|koe|kq/i.test(clean)
  ) {
    return '한국';
  }

  if (/nasdaq/i.test(clean)) {
    return 'NASDAQ';
  }

  if (/nyse arca/i.test(clean)) {
    return 'NYSE Arca';
  }

  if (/nyse/i.test(clean)) {
    return 'NYSE';
  }

  return clean || (normalizedSymbol ? '해외' : '');
}

function cleanQuoteTypeLabel(value, symbol = '') {
  const clean = String(value ?? '').trim();

  if (/금|gold|commodity|원자재/i.test(clean)) {
    return clean.includes('ETF') ? '금/원자재 ETF' : '금/원자재';
  }

  if (/etf/i.test(clean)) {
    return 'ETF';
  }

  if (/equity|stock/i.test(clean)) {
    return isKoreanListedSymbol(symbol) ? '주식' : 'Stock';
  }

  return clean;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeSearchText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeLooseSearchText(value) {
  return normalizeSearchText(value).replace(/[^\p{L}\p{N}]+/gu, '');
}

function isOrderedCharacterMatch(query, candidate) {
  if (!query || !candidate || query.length < 2) {
    return false;
  }

  let cursor = 0;

  for (const char of candidate) {
    if (char === query[cursor]) {
      cursor += 1;
      if (cursor >= query.length) {
        return true;
      }
    }
  }

  return false;
}

function localSearchTokens(entry) {
  return unique([
    entry.symbol,
    entry.name,
    entry.rawName,
    entry.exchangeName,
    entry.quoteType,
    entry.typeDisp,
    entry.sector,
    entry.assetClass,
    ...(Array.isArray(entry.aliases) ? entry.aliases : []),
  ]);
}

function scoreLocalSuggestion(entry, query) {
  const queryText = normalizeSearchText(query);
  const queryLoose = normalizeLooseSearchText(query);

  if (!queryText || !queryLoose) {
    return Number.POSITIVE_INFINITY;
  }

  const tokens = localSearchTokens(entry);
  const normalizedSymbol = normalizeSymbol(entry.symbol);

  if (normalizeSymbol(query) === normalizedSymbol || /^\d{6}$/.test(queryLoose) && normalizedSymbol.startsWith(queryLoose)) {
    return 0;
  }

  let bestScore = Number.POSITIVE_INFINITY;

  tokens.forEach((token) => {
    const tokenText = normalizeSearchText(token);
    const tokenLoose = normalizeLooseSearchText(token);

    if (!tokenText || !tokenLoose) {
      return;
    }

    if (tokenText === queryText || tokenLoose === queryLoose) {
      bestScore = Math.min(bestScore, 1);
      return;
    }

    if (tokenText.startsWith(queryText) || tokenLoose.startsWith(queryLoose)) {
      bestScore = Math.min(bestScore, 2);
      return;
    }

    if (tokenText.includes(queryText) || tokenLoose.includes(queryLoose)) {
      bestScore = Math.min(bestScore, 3);
      return;
    }

    if (isOrderedCharacterMatch(queryLoose, tokenLoose)) {
      bestScore = Math.min(bestScore, 5);
    }
  });

  return bestScore;
}

function localSecurityToSuggestion(entry, localRank = 0, searchScore = 0) {
  return {
    symbol: normalizeSymbol(entry.symbol),
    name: entry.name,
    rawName: entry.rawName || entry.name,
    displayName: entry.name,
    exchangeName: cleanExchangeName(entry.exchangeName || '한국', entry.symbol),
    quoteType: entry.quoteType || 'EQUITY',
    typeDisp: cleanQuoteTypeLabel(entry.typeDisp || entry.quoteType || 'equity', entry.symbol),
    sector: entry.sector || '',
    assetClass: entry.assetClass || '',
    aliases: Array.isArray(entry.aliases) ? entry.aliases : [],
    source: '한국어 종목명 사전',
    localRank,
    searchScore,
  };
}

function searchLocalSymbolSuggestions(query, limit = DEFAULT_SEARCH_LIMIT) {
  const scored = LOCAL_SECURITY_UNIVERSE.map((entry, index) => ({
    entry,
    index,
    score: scoreLocalSuggestion(entry, query),
  })).filter((item) => Number.isFinite(item.score));

  return scored
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .slice(0, limit)
    .map((item) => localSecurityToSuggestion(item.entry, item.index, item.score));
}

function uniqueBySymbol(values) {
  const seen = new Set();
  const output = [];

  for (const value of values) {
    const symbol = normalizeSymbol(value?.symbol);

    if (!symbol || seen.has(symbol)) {
      continue;
    }

    seen.add(symbol);
    output.push({ ...value, symbol });
  }

  return output;
}

function buildSearchQueryVariants(query) {
  const cleanQuery = String(query ?? '').trim().replace(/\s+/g, ' ');

  if (!cleanQuery) {
    return [];
  }

  const variants = [cleanQuery];
  const lowered = cleanQuery.toLowerCase();

  KOREAN_QUERY_ALIASES.forEach(([korean, english]) => {
    if (lowered.includes(korean)) {
      variants.push(cleanQuery.replace(new RegExp(korean, 'gi'), english));
    }
  });

  return unique(variants);
}

export function cleanMarketDisplayName(name, symbol = '') {
  const normalizedSymbol = normalizeSymbol(symbol);
  const mappedName = LOCAL_SYMBOL_DISPLAY_NAMES[normalizedSymbol];

  if (mappedName) {
    return mappedName;
  }

  let cleaned = String(name ?? '').replace(/\s+/g, ' ').trim();

  if (!cleaned) {
    return normalizedSymbol || '';
  }

  cleaned = cleaned
    .replace(/^Mirae Asset\s+Tiger\s+/i, 'TIGER ')
    .replace(/^Mirae Asset\s+MAPS\s+/i, 'TIGER ')
    .replace(/^Mirae Asset\s+/i, '')
    .replace(/^Samsung\s+KODEX\s+/i, 'KODEX ')
    .replace(/^Samsung Asset Management\s+/i, 'KODEX ')
    .replace(/^Korea Investment\s+ACE\s+/i, 'ACE ')
    .replace(/^Korea Investment\s+/i, '')
    .replace(/^KB\s+KBSTAR\s+/i, 'KBSTAR ')
    .replace(/^KB Asset Management\s+/i, 'KBSTAR ')
    .replace(/^Shinhan\s+SOL\s+/i, 'SOL ')
    .replace(/^Hanwha\s+ARIRANG\s+/i, 'ARIRANG ')
    .replace(/\bTiger\b/i, 'TIGER')
    .replace(/\bKodex\b/i, 'KODEX')
    .replace(/\bKbstar\b/i, 'KBSTAR')
    .replace(/\bArirang\b/i, 'ARIRANG')
    .replace(/\bSnp\b/i, 'S&P')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || normalizedSymbol;
}

function buildSymbolCandidates(ticker) {
  const normalized = normalizeSymbol(ticker);

  if (!normalized) {
    return [];
  }

  if (/^\d{6}$/.test(normalized)) {
    return unique([`${normalized}.KS`, `${normalized}.KQ`, normalized]);
  }

  return [normalized];
}

function toStooqSymbol(symbol) {
  const normalized = normalizeSymbol(symbol);

  if (!normalized) {
    return '';
  }

  if (/^\d{6}$/.test(normalized)) {
    return `${normalized}.kr`;
  }

  if (/^\d{6}\.(KS|KQ)$/.test(normalized)) {
    return `${normalized.slice(0, 6)}.kr`;
  }

  if (normalized.includes('.')) {
    return normalized.toLowerCase();
  }

  return `${normalized.toLowerCase()}.us`;
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toFiniteNumberFromText(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const normalized = String(value ?? '')
    .trim()
    .replace(/[−–—]/g, '-')
    .replace(/[,₩원$€¥￦%\s]/g, '')
    .replace(/[^0-9.+-]/g, '');
  const numeric = Number(normalized);

  return Number.isFinite(numeric) ? numeric : null;
}

function readRuntimeEnv(key) {
  return typeof globalThis !== 'undefined' ? globalThis.process?.env?.[key] ?? '' : '';
}

function toNaverStockCode(symbol) {
  const normalized = normalizeSymbol(symbol);
  const match = normalized.match(/^(\d{6})(?:\.(?:KS|KQ))?$/);
  return match?.[1] ?? '';
}

async function fetchJsonResource(url, signal, headers = {}) {
  const response = await fetch(url.toString(), {
    signal,
    cache: 'no-store',
    headers: {
      accept: 'application/json,text/plain,*/*',
      'user-agent': 'Mozilla/5.0 AtomFolio/1.0',
      ...headers,
    },
  });

  if (!response.ok) {
    throw new Error('json-fetch-failed:' + response.status);
  }

  return response.json();
}

function extractMarketPoints(result) {
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const quote = result?.indicators?.quote?.[0] ?? {};
  const closes = Array.isArray(quote.close) ? quote.close : [];
  const opens = Array.isArray(quote.open) ? quote.open : [];
  const highs = Array.isArray(quote.high) ? quote.high : [];
  const lows = Array.isArray(quote.low) ? quote.low : [];
  const volumes = Array.isArray(quote.volume) ? quote.volume : [];

  return timestamps
    .map((timestamp, index) => ({
      time: timestamp * 1000,
      open: toFiniteNumber(opens[index]),
      high: toFiniteNumber(highs[index]),
      low: toFiniteNumber(lows[index]),
      close: toFiniteNumber(closes[index]),
      volume: toFiniteNumber(volumes[index]),
    }))
    .filter((point) => Number.isFinite(point.close));
}

function quoteToSuggestion(quote) {
  const symbol = normalizeSymbol(quote?.symbol);

  if (!symbol) {
    return null;
  }

  const rawName =
    String(quote?.longname ?? '').trim() ||
    String(quote?.shortname ?? '').trim() ||
    String(quote?.name ?? '').trim() ||
    symbol;

  return {
    symbol,
    name: cleanMarketDisplayName(rawName, symbol),
    rawName,
    displayName: cleanMarketDisplayName(rawName, symbol),
    exchangeName: cleanExchangeName(quote?.exchDisp ?? quote?.exchange ?? '', symbol),
    quoteType: String(quote?.quoteType ?? '').trim(),
    typeDisp: cleanQuoteTypeLabel(quote?.typeDisp ?? quote?.quoteType ?? '', symbol),
    source: 'Yahoo Finance',
  };
}

function rankSuggestions(suggestions, query) {
  const normalizedQuery = normalizeSearchText(query);
  const queryWithoutSpace = normalizeLooseSearchText(query);

  return [...suggestions].sort((left, right) => {
    const leftAliases = Array.isArray(left.aliases) ? left.aliases.join(' ') : '';
    const rightAliases = Array.isArray(right.aliases) ? right.aliases.join(' ') : '';
    const leftText = normalizeSearchText(`${left.symbol} ${left.name} ${left.rawName} ${leftAliases}`);
    const rightText = normalizeSearchText(`${right.symbol} ${right.name} ${right.rawName} ${rightAliases}`);
    const leftCompact = normalizeLooseSearchText(leftText);
    const rightCompact = normalizeLooseSearchText(rightText);
    const leftStarts = leftText.startsWith(normalizedQuery) || leftCompact.startsWith(queryWithoutSpace);
    const rightStarts =
      rightText.startsWith(normalizedQuery) || rightCompact.startsWith(queryWithoutSpace);
    const leftIncludes = leftText.includes(normalizedQuery) || leftCompact.includes(queryWithoutSpace);
    const rightIncludes =
      rightText.includes(normalizedQuery) || rightCompact.includes(queryWithoutSpace);

    if (leftStarts !== rightStarts) {
      return leftStarts ? -1 : 1;
    }

    if (leftIncludes !== rightIncludes) {
      return leftIncludes ? -1 : 1;
    }

    const leftScore = Number.isFinite(left.searchScore) ? left.searchScore : 99;
    const rightScore = Number.isFinite(right.searchScore) ? right.searchScore : 99;

    if (leftScore !== rightScore) {
      return leftScore - rightScore;
    }

    const leftRank = Number.isFinite(left.localRank) ? left.localRank : 9999;
    const rightRank = Number.isFinite(right.localRank) ? right.localRank : 9999;

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return left.symbol.localeCompare(right.symbol);
  });
}

async function fetchYahooSearchSuggestions(query, signal, limit = DEFAULT_SEARCH_LIMIT) {
  const normalizedQuery = String(query ?? '').trim();

  if (!normalizedQuery) {
    return [];
  }

  const url = new URL(YAHOO_SEARCH_URL);
  url.searchParams.set('q', normalizedQuery);
  url.searchParams.set('quotesCount', String(limit));
  url.searchParams.set('newsCount', '0');
  url.searchParams.set('enableFuzzyQuery', 'true');

  const response = await fetch(url.toString(), { signal, cache: 'no-store' });

  if (!response.ok) {
    throw new Error('symbol-search-failed');
  }

  const payload = await response.json();
  const quotes = Array.isArray(payload?.quotes) ? payload.quotes : [];

  return quotes
    .filter((quote) =>
      /equity|etf|mutualfund|index/i.test(`${quote?.quoteType ?? ''} ${quote?.typeDisp ?? ''}`),
    )
    .map(quoteToSuggestion)
    .filter(Boolean);
}

export async function searchMarketSymbolSuggestions(query, { signal, limit = DEFAULT_SEARCH_LIMIT } = {}) {
  const variants = buildSearchQueryVariants(query);
  const localSuggestions = searchLocalSymbolSuggestions(query, limit);

  if (!variants.length) {
    return localSuggestions;
  }

  const settled = await Promise.allSettled(
    variants.map((variant) => fetchYahooSearchSuggestions(variant, signal, limit)),
  );
  const suggestions = uniqueBySymbol(
    [
      ...localSuggestions,
      ...settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : [])),
    ],
  );

  return rankSuggestions(suggestions, query).slice(0, limit);
}

async function searchMarketSymbols(query, signal) {
  const suggestions = await searchMarketSymbolSuggestions(query, { signal });

  return suggestions.map((suggestion) => suggestion.symbol);
}

async function fetchYahooChart(symbol, windowConfig, signal) {
  const url = new URL(`${YAHOO_CHART_BASE}/${encodeURIComponent(symbol)}`);
  url.searchParams.set('range', windowConfig.range);
  url.searchParams.set('interval', windowConfig.interval);
  url.searchParams.set('includePrePost', 'false');
  url.searchParams.set('events', 'div,splits');
  url.searchParams.set('corsDomain', 'finance.yahoo.com');

  const response = await fetch(url.toString(), { signal, cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`quote-fetch-failed:${response.status}`);
  }

  const payload = await response.json();
  const error = payload?.chart?.error;

  if (error) {
    throw new Error(error.description || error.code || 'quote-fetch-failed');
  }

  const result = payload?.chart?.result?.[0];
  const meta = result?.meta ?? {};
  const points = extractMarketPoints(result);
  const latestClose = points.at(-1)?.close ?? null;
  const latestPrice =
    toFiniteNumber(meta.regularMarketPrice) ??
    toFiniteNumber(meta.postMarketPrice) ??
    toFiniteNumber(meta.preMarketPrice) ??
    latestClose;
  const previousClose =
    toFiniteNumber(meta.chartPreviousClose) ??
    toFiniteNumber(meta.previousClose) ??
    points.find((point) => Number.isFinite(point.close))?.close ??
    null;
  const change =
    Number.isFinite(latestPrice) && Number.isFinite(previousClose)
      ? latestPrice - previousClose
      : null;
  const changePercent =
    Number.isFinite(change) && Number.isFinite(previousClose) && previousClose !== 0
      ? (change / previousClose) * 100
      : null;

  if (!Number.isFinite(latestPrice) && !points.length) {
    throw new Error('quote-empty');
  }

  const rawName = meta.longName || meta.shortName || meta.symbol || symbol;
  const normalizedResultSymbol = normalizeSymbol(meta.symbol || symbol);
  const localMetadata = LOCAL_SYMBOL_METADATA[normalizedResultSymbol] ?? {};
  const displayName = cleanMarketDisplayName(rawName, meta.symbol || symbol);

  return {
    symbol: meta.symbol || symbol,
    name: displayName,
    rawName,
    displayName,
    exchangeName: cleanExchangeName(
      localMetadata.exchangeName || meta.fullExchangeName || meta.exchangeName || '',
      meta.symbol || symbol,
    ),
    quoteType: localMetadata.quoteType || '',
    typeDisp: cleanQuoteTypeLabel(localMetadata.typeDisp || '', meta.symbol || symbol),
    sector: localMetadata.sector || '',
    assetClass: localMetadata.assetClass || '',
    currency: meta.currency || '',
    latestPrice,
    previousClose,
    change,
    changePercent,
    points,
    range: windowConfig.range,
    interval: windowConfig.interval,
    updatedAt: (toFiniteNumber(meta.regularMarketTime) ?? Date.now() / 1000) * 1000,
    source: 'Yahoo Finance',
  };
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;

  for (const char of line) {
    if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current);
  return values.map((value) => value.trim());
}

function createQuotePoints({ previousClose, latestPrice, updatedAt }) {
  const timestamp = Number.isFinite(updatedAt) ? updatedAt : Date.now();

  if (!Number.isFinite(latestPrice)) {
    return [];
  }

  if (!Number.isFinite(previousClose) || previousClose === latestPrice) {
    return [
      { time: timestamp - 60 * 1000, close: latestPrice },
      { time: timestamp, close: latestPrice },
    ];
  }

  const midpoint = previousClose + (latestPrice - previousClose) * 0.42;

  return [
    { time: timestamp - 6 * 60 * 60 * 1000, close: previousClose },
    { time: timestamp - 30 * 60 * 1000, close: midpoint },
    { time: timestamp, close: latestPrice },
  ];
}

function normalizeMiraeQuotePayload(payload, symbol, name = '') {
  const data = payload?.output ?? payload?.data ?? payload?.result ?? payload?.quote ?? payload;
  const latestPrice =
    toFiniteNumberFromText(data?.latestPrice) ??
    toFiniteNumberFromText(data?.currentPrice) ??
    toFiniteNumberFromText(data?.closePrice) ??
    toFiniteNumberFromText(data?.price) ??
    toFiniteNumberFromText(data?.stck_prpr) ??
    toFiniteNumberFromText(data?.현재가);
  const change =
    toFiniteNumberFromText(data?.change) ??
    toFiniteNumberFromText(data?.compareToPreviousClosePrice) ??
    toFiniteNumberFromText(data?.prdy_vrss) ??
    toFiniteNumberFromText(data?.전일대비);
  const changePercent =
    toFiniteNumberFromText(data?.changePercent) ??
    toFiniteNumberFromText(data?.fluctuationsRatio) ??
    toFiniteNumberFromText(data?.prdy_ctrt) ??
    toFiniteNumberFromText(data?.등락률);
  const previousClose =
    toFiniteNumberFromText(data?.previousClose) ??
    toFiniteNumberFromText(data?.prdy_clpr) ??
    (Number.isFinite(latestPrice) && Number.isFinite(change) ? latestPrice - change : null);

  if (!Number.isFinite(latestPrice)) {
    throw new Error('mirae-quote-empty');
  }

  const normalizedSymbol = normalizeSymbol(data?.symbol ?? data?.code ?? data?.stck_shrn_iscd ?? symbol);
  const localMetadata = LOCAL_SYMBOL_METADATA[normalizedSymbol] ?? {};
  const rawName = String(
    data?.stockName ?? data?.name ?? data?.hts_kor_isnm ?? data?.종목명 ?? name ?? normalizedSymbol,
  ).trim();
  const updatedAt = Date.parse(data?.updatedAt ?? data?.localTradedAt ?? data?.stck_cntg_hour ?? '') || Date.now();

  return {
    symbol: normalizedSymbol,
    name: cleanMarketDisplayName(rawName, normalizedSymbol),
    rawName,
    displayName: cleanMarketDisplayName(rawName, normalizedSymbol),
    exchangeName: cleanExchangeName(localMetadata.exchangeName || data?.exchangeName || 'Mirae Asset', normalizedSymbol),
    quoteType: localMetadata.quoteType || '',
    typeDisp: cleanQuoteTypeLabel(localMetadata.typeDisp || '', normalizedSymbol),
    sector: localMetadata.sector || '',
    assetClass: localMetadata.assetClass || '',
    currency: data?.currency || 'KRW',
    latestPrice,
    previousClose,
    change: Number.isFinite(change) ? change : latestPrice - previousClose,
    changePercent:
      Number.isFinite(changePercent)
        ? changePercent
        : Number.isFinite(previousClose) && previousClose !== 0
          ? ((latestPrice - previousClose) / previousClose) * 100
          : null,
    points: createQuotePoints({ previousClose, latestPrice, updatedAt }),
    range: 'live',
    interval: 'quote',
    updatedAt,
    source: '미래에셋증권',
  };
}

async function fetchMiraeAssetQuote(symbol, name, signal) {
  const endpoint = readRuntimeEnv('MIRAE_ASSET_QUOTE_PROXY_URL');

  if (!endpoint) {
    throw new Error('mirae-proxy-not-configured');
  }

  const normalizedSymbol = normalizeSymbol(symbol);
  const code = toNaverStockCode(normalizedSymbol) || normalizedSymbol;
  const url = new URL(
    endpoint
      .replace(/\{code\}/g, encodeURIComponent(code))
      .replace(/\{symbol\}/g, encodeURIComponent(normalizedSymbol))
      .replace(/\{name\}/g, encodeURIComponent(name || '')),
  );

  if (!/\{code\}|\{symbol\}|\{name\}/.test(endpoint)) {
    url.searchParams.set('code', code);
    url.searchParams.set('symbol', normalizedSymbol);
    if (name) {
      url.searchParams.set('name', name);
    }
  }

  const token = readRuntimeEnv('MIRAE_ASSET_QUOTE_PROXY_TOKEN');
  const payload = await fetchJsonResource(url, signal, token ? { authorization: 'Bearer ' + token } : {});
  return normalizeMiraeQuotePayload(payload, normalizedSymbol, name);
}

async function fetchNaverStockQuote(symbol, name, signal) {
  const code = toNaverStockCode(symbol);

  if (!code) {
    throw new Error('naver-code-required');
  }

  const url = new URL(NAVER_STOCK_BASIC_BASE + '/' + code + '/basic');
  url.searchParams.set('_ts', String(Date.now()));

  const payload = await fetchJsonResource(url, signal, {
    referer: 'https://m.stock.naver.com/domestic/stock/' + code,
  });
  const regularPrice = toFiniteNumberFromText(payload?.closePrice);
  const regularChange = toFiniteNumberFromText(payload?.compareToPreviousClosePrice);
  const regularChangePercent = toFiniteNumberFromText(payload?.fluctuationsRatio);
  const regularUpdatedAt = Date.parse(payload?.localTradedAt ?? '') || Date.now();
  const overMarket = payload?.overMarketPriceInfo ?? null;
  const overPrice = toFiniteNumberFromText(overMarket?.overPrice);
  const overUpdatedAt = Date.parse(overMarket?.localTradedAt ?? '') || 0;
  const useOverMarket = Number.isFinite(overPrice) && overUpdatedAt >= regularUpdatedAt;
  const latestPrice = useOverMarket ? overPrice : regularPrice;
  const change = useOverMarket
    ? toFiniteNumberFromText(overMarket?.compareToPreviousClosePrice)
    : regularChange;
  const changePercent = useOverMarket
    ? toFiniteNumberFromText(overMarket?.fluctuationsRatio)
    : regularChangePercent;
  const previousClose =
    Number.isFinite(latestPrice) && Number.isFinite(change) ? latestPrice - change : null;
  const updatedAt = useOverMarket ? overUpdatedAt : regularUpdatedAt;

  if (!Number.isFinite(latestPrice)) {
    throw new Error('naver-quote-empty');
  }

  const normalizedSymbol = normalizeSymbol(payload?.itemCode ?? code);
  const exchangeCode = payload?.stockExchangeType?.code === 'KQ' ? 'KQ' : 'KS';
  const localMetadata = LOCAL_SYMBOL_METADATA[normalizedSymbol + '.' + exchangeCode] ??
    LOCAL_SYMBOL_METADATA[normalizedSymbol] ??
    {};
  const rawName = String(payload?.stockName ?? name ?? normalizedSymbol).trim();

  return {
    symbol: normalizedSymbol,
    name: cleanMarketDisplayName(rawName, normalizedSymbol),
    rawName,
    displayName: cleanMarketDisplayName(rawName, normalizedSymbol),
    exchangeName: cleanExchangeName(
      payload?.stockExchangeName || payload?.stockExchangeType?.nameKor || localMetadata.exchangeName || '한국',
      normalizedSymbol,
    ),
    quoteType: localMetadata.quoteType || payload?.stockEndType || '',
    typeDisp: cleanQuoteTypeLabel(localMetadata.typeDisp || payload?.stockEndType || '', normalizedSymbol),
    sector: localMetadata.sector || '',
    assetClass: localMetadata.assetClass || '',
    currency: 'KRW',
    latestPrice,
    previousClose,
    change,
    changePercent,
    points: createQuotePoints({ previousClose, latestPrice, updatedAt }),
    range: payload?.delayTimeName === '실시간' ? 'realtime' : 'quote',
    interval: 'naver',
    updatedAt,
    source: payload?.delayTimeName === '실시간' ? '네이버 증권 실시간' : '네이버 증권',
    marketStatus: payload?.marketStatus || overMarket?.overMarketStatus || '',
  };
}

async function fetchStooqQuote(symbol, signal) {
  const stooqSymbol = toStooqSymbol(symbol);

  if (!stooqSymbol) {
    throw new Error('stooq-symbol-required');
  }

  const url = new URL(STOOQ_QUOTE_URL);
  url.searchParams.set('s', stooqSymbol);
  url.searchParams.set('f', 'sd2t2ohlcv');
  url.searchParams.set('h', '');
  url.searchParams.set('e', 'csv');

  const response = await fetch(url.toString(), { signal, cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`stooq-fetch-failed:${response.status}`);
  }

  const text = await response.text();
  const rows = text
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parseCsvLine);
  const header = rows[0] ?? [];
  const row = rows[1] ?? [];
  const valueFor = (key) => row[header.indexOf(key)] ?? '';
  const close = toFiniteNumber(valueFor('Close'));
  const open = toFiniteNumber(valueFor('Open'));
  const high = toFiniteNumber(valueFor('High'));
  const low = toFiniteNumber(valueFor('Low'));
  const volume = toFiniteNumber(valueFor('Volume'));

  if (!Number.isFinite(close)) {
    throw new Error('stooq-empty');
  }

  const date = valueFor('Date');
  const time = valueFor('Time');
  const parsedTime = Date.parse(`${date}T${time || '00:00:00'}Z`);
  const updatedAt = Number.isFinite(parsedTime) ? parsedTime : Date.now();
  const change = Number.isFinite(open) ? close - open : null;
  const changePercent =
    Number.isFinite(change) && Number.isFinite(open) && open !== 0 ? (change / open) * 100 : null;
  const normalizedSymbol = normalizeSymbol(symbol);
  const localMetadata = LOCAL_SYMBOL_METADATA[normalizedSymbol] ?? {};
  const displayName = cleanMarketDisplayName(valueFor('Symbol') || stooqSymbol.toUpperCase(), symbol);
  const chartValues = [
    { offset: -3, close: open },
    { offset: -2, close: high },
    { offset: -1, close: low },
    { offset: 0, close },
  ].filter((point) => Number.isFinite(point.close));
  const points = chartValues.map((point) => ({
    time: updatedAt + point.offset * 60 * 60 * 1000,
    close: point.close,
    open,
    high,
    low,
    volume,
  }));

  return {
    symbol: valueFor('Symbol') || stooqSymbol.toUpperCase(),
    name: displayName,
    rawName: valueFor('Symbol') || stooqSymbol.toUpperCase(),
    displayName,
    exchangeName: cleanExchangeName(localMetadata.exchangeName || 'Stooq', symbol),
    quoteType: localMetadata.quoteType || '',
    typeDisp: cleanQuoteTypeLabel(localMetadata.typeDisp || '', symbol),
    sector: localMetadata.sector || '',
    assetClass: localMetadata.assetClass || '',
    currency: '',
    latestPrice: close,
    previousClose: open,
    change,
    changePercent,
    points,
    range: 'quote',
    interval: 'OHLC',
    updatedAt,
    source: 'Stooq',
  };
}

export async function fetchLiveMarketDataFromProviders({ ticker, name, signal } = {}) {
  const tickerCandidates = buildSymbolCandidates(ticker).map((symbol) => ({ symbol }));
  const searchQuery = String(name ?? '').trim();
  const canSearchByName = searchQuery.length >= 2 || /[가-힣]/.test(searchQuery);
  const suggestions =
    canSearchByName
      ? await searchMarketSymbolSuggestions(searchQuery, { signal }).catch(() => [])
      : [];
  let candidates = uniqueBySymbol([...tickerCandidates, ...suggestions]);

  if (!candidates.length && canSearchByName) {
    candidates = (await searchMarketSymbols(searchQuery, signal)).map((symbol) => ({ symbol }));
  }

  if (!candidates.length) {
    throw new Error('symbol-required');
  }

  let lastError = null;

  for (const candidate of candidates) {
    if (toNaverStockCode(candidate.symbol)) {
      try {
        const quote = await fetchNaverStockQuote(candidate.symbol, candidate.name || searchQuery, signal);
        const displayName = cleanMarketDisplayName(candidate.name || quote.name, quote.symbol);

        return {
          ...quote,
          name: displayName,
          displayName,
          rawName: candidate.rawName || quote.rawName || quote.name,
          quoteType: candidate.quoteType || quote.quoteType || '',
          typeDisp: candidate.typeDisp || quote.typeDisp || '',
          sector: candidate.sector || quote.sector || '',
          assetClass: candidate.assetClass || quote.assetClass || '',
        };
      } catch (error) {
        lastError = error;
      }

      try {
        const quote = await fetchMiraeAssetQuote(candidate.symbol, candidate.name || searchQuery, signal);
        const displayName = cleanMarketDisplayName(candidate.name || quote.name, quote.symbol);

        return {
          ...quote,
          name: displayName,
          displayName,
          rawName: candidate.rawName || quote.rawName || quote.name,
          quoteType: candidate.quoteType || quote.quoteType || '',
          typeDisp: candidate.typeDisp || quote.typeDisp || '',
          sector: candidate.sector || quote.sector || '',
          assetClass: candidate.assetClass || quote.assetClass || '',
        };
      } catch (error) {
        lastError = error;
      }
    }

    for (const windowConfig of MARKET_WINDOWS) {
      try {
        const quote = await fetchYahooChart(candidate.symbol, windowConfig, signal);
        const displayName = cleanMarketDisplayName(candidate.name || quote.name, quote.symbol);

        return {
          ...quote,
          name: displayName,
          displayName,
          rawName: candidate.rawName || quote.rawName || quote.name,
          quoteType: candidate.quoteType || quote.quoteType || '',
          typeDisp: candidate.typeDisp || quote.typeDisp || '',
          sector: candidate.sector || quote.sector || '',
          assetClass: candidate.assetClass || quote.assetClass || '',
        };
      } catch (error) {
        lastError = error;
      }
    }
  }

  for (const symbol of unique([...candidates.map((candidate) => candidate.symbol), ticker])) {
    try {
      return await fetchStooqQuote(symbol, signal);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error('quote-fetch-failed');
}

export async function fetchLiveMarketData({ ticker, name, signal } = {}) {
  if (typeof window !== 'undefined') {
    const url = new URL('/api/market/live', window.location.origin);
    const cleanTicker = String(ticker ?? '').trim();
    const cleanName = String(name ?? '').trim();

    if (cleanTicker) {
      url.searchParams.set('ticker', cleanTicker);
    }
    if (cleanName) {
      url.searchParams.set('name', cleanName);
    }

    try {
      const response = await fetch(url.toString(), { signal, cache: 'no-store' });

      if (response.ok) {
        return await response.json();
      }
    } catch {
      // Fall through to direct public endpoints when the local API is unavailable.
    }
  }

  return fetchLiveMarketDataFromProviders({ ticker, name, signal });
}

export async function fetchMarketSymbolSuggestions({ query, signal, limit } = {}) {
  const cleanQuery = String(query ?? '').trim();

  if (!cleanQuery) {
    return [];
  }

  if (typeof window !== 'undefined') {
    const url = new URL('/api/market/search', window.location.origin);
    url.searchParams.set('query', cleanQuery);
    if (Number.isFinite(Number(limit))) {
      url.searchParams.set('limit', String(limit));
    }

    try {
      const response = await fetch(url.toString(), { signal, cache: 'no-store' });

      if (response.ok) {
        const payload = await response.json();
        return Array.isArray(payload?.suggestions) ? payload.suggestions : [];
      }
    } catch {
      // Fall through to direct public search when the local API is unavailable.
    }
  }

  return searchMarketSymbolSuggestions(cleanQuery, { signal, limit });
}

export function formatMarketInputPrice(value) {
  const numeric = toFiniteNumber(value);

  if (!Number.isFinite(numeric)) {
    return '';
  }

  return numeric.toFixed(Math.abs(numeric) >= 1000 ? 0 : 2).replace(/\.00$/, '');
}

export function formatMarketPrice(value, currency = '') {
  const numeric = toFiniteNumber(value);

  if (!Number.isFinite(numeric)) {
    return '-';
  }

  const locale = currency === 'KRW' ? 'ko-KR' : 'en-US';
  const options = {
    maximumFractionDigits: Math.abs(numeric) >= 1000 ? 0 : 2,
    minimumFractionDigits: 0,
  };

  if (/^[A-Z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat(locale, {
        ...options,
        style: 'currency',
        currency,
      }).format(numeric);
    } catch {
      return `${new Intl.NumberFormat(locale, options).format(numeric)} ${currency}`;
    }
  }

  return new Intl.NumberFormat(locale, options).format(numeric);
}

export function formatMarketChange(value) {
  const numeric = toFiniteNumber(value);

  if (!Number.isFinite(numeric)) {
    return '-';
  }

  const sign = numeric > 0 ? '+' : '';
  return `${sign}${numeric.toFixed(Math.abs(numeric) >= 10 ? 2 : 3).replace(/\.?0+$/, '')}`;
}

export function formatMarketChangePercent(value) {
  const numeric = toFiniteNumber(value);

  if (!Number.isFinite(numeric)) {
    return '';
  }

  const sign = numeric > 0 ? '+' : '';
  return `${sign}${numeric.toFixed(Math.abs(numeric) >= 10 ? 2 : 3).replace(/\.?0+$/, '')}%`;
}

export function formatMarketTime(value, language = 'ko') {
  const numeric = toFiniteNumber(value);

  if (!Number.isFinite(numeric)) {
    return '';
  }

  return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(numeric));
}
