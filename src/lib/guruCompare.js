// Famous-investor ("guru") portfolio comparison — pure functions only, no React, no fetches.
// The investor side comes from src/data/guruPortfolios.json (built from SEC 13F filings by
// scripts/fetch-guru-portfolios.mjs); the user side is the active portfolio's
// createPortfolioAnalyticsSummary(...).positions.
//
// Both sides are put on one broad sector/region vocabulary before comparing. The app's own
// enrichment uses finer, Korean-market-flavoured sector names ('반도체', '대형 기술주',
// '인터넷 플랫폼'…) that a 13F holding never carries, so comparing raw labels would put every
// holding in a different bucket.

export const SECTOR_LABELS = {
  tech: { ko: 'IT', en: 'Tech' },
  comm: { ko: '커뮤니케이션', en: 'Communication' },
  discretionary: { ko: '경기소비재', en: 'Consumer disc.' },
  staples: { ko: '필수소비재', en: 'Staples' },
  financials: { ko: '금융', en: 'Financials' },
  health: { ko: '헬스케어', en: 'Health care' },
  industrials: { ko: '산업재', en: 'Industrials' },
  energy: { ko: '에너지', en: 'Energy' },
  utilities: { ko: '유틸리티', en: 'Utilities' },
  realestate: { ko: '부동산', en: 'Real estate' },
  materials: { ko: '소재', en: 'Materials' },
  etf: { ko: 'ETF', en: 'ETF' },
  bonds: { ko: '채권', en: 'Bonds' },
  commodities: { ko: '금·원자재', en: 'Gold & commodities' },
  other: { ko: '기타', en: 'Other' },
  rest: { ko: '상위 15 외', en: 'Outside top 15' },
};

export const REGION_LABELS = {
  us: { ko: '미국', en: 'US' },
  kr: { ko: '한국', en: 'Korea' },
  cn: { ko: '중국·홍콩', en: 'China & HK' },
  tw: { ko: '대만', en: 'Taiwan' },
  other: { ko: '기타', en: 'Other' },
  rest: { ko: '상위 15 외', en: 'Outside top 15' },
};

export const REGION_ORDER = ['us', 'kr', 'cn', 'tw', 'other', 'rest'];

// ticker → [Korean name, English name, sector key, region key]. Covers every holding in the
// bundled 13F data plus common user holdings; anything missing falls back to the app's own
// enrichment (see resolveUserSector/resolveUserRegion). The fetch script warns about any 13F
// ticker missing from here so it can be added.
export const SECURITY_META = {
  AAPL: ['애플', 'Apple', 'tech', 'us'],
  MSFT: ['마이크로소프트', 'Microsoft', 'tech', 'us'],
  NVDA: ['엔비디아', 'NVIDIA', 'tech', 'us'],
  AVGO: ['브로드컴', 'Broadcom', 'tech', 'us'],
  ORCL: ['오라클', 'Oracle', 'tech', 'us'],
  ADBE: ['어도비', 'Adobe', 'tech', 'us'],
  CRM: ['세일즈포스', 'Salesforce', 'tech', 'us'],
  AMD: ['AMD', 'AMD', 'tech', 'us'],
  MU: ['마이크론', 'Micron', 'tech', 'us'],
  LRCX: ['램리서치', 'Lam Research', 'tech', 'us'],
  TSM: ['TSMC', 'TSMC', 'tech', 'tw'],
  STX: ['시게이트', 'Seagate', 'tech', 'us'],
  STM: ['ST마이크로', 'STMicroelectronics', 'tech', 'other'],
  CDW: ['CDW', 'CDW', 'tech', 'us'],
  U: ['유니티', 'Unity Software', 'tech', 'us'],
  PLTR: ['팔란티어', 'Palantir', 'tech', 'us'],
  SHOP: ['쇼피파이', 'Shopify', 'tech', 'other'],
  CRWD: ['크라우드스트라이크', 'CrowdStrike', 'tech', 'us'],
  SNOW: ['스노우플레이크', 'Snowflake', 'tech', 'us'],
  NET: ['클라우드플레어', 'Cloudflare', 'tech', 'us'],
  INTC: ['인텔', 'Intel', 'tech', 'us'],
  GOOGL: ['알파벳', 'Alphabet', 'comm', 'us'],
  META: ['메타', 'Meta Platforms', 'comm', 'us'],
  NFLX: ['넷플릭스', 'Netflix', 'comm', 'us'],
  SIRI: ['시리우스XM', 'SiriusXM', 'comm', 'us'],
  FOXA: ['폭스', 'Fox', 'comm', 'us'],
  TME: ['텐센트뮤직', 'Tencent Music', 'comm', 'cn'],
  VZ: ['버라이즌', 'Verizon', 'comm', 'us'],
  DIS: ['디즈니', 'Walt Disney', 'comm', 'us'],
  RBLX: ['로블록스', 'Roblox', 'comm', 'us'],
  AMZN: ['아마존', 'Amazon', 'discretionary', 'us'],
  TSLA: ['테슬라', 'Tesla', 'discretionary', 'us'],
  LEN: ['레나', 'Lennar', 'discretionary', 'us'],
  BABA: ['알리바바', 'Alibaba', 'discretionary', 'cn'],
  PDD: ['PDD(테무)', 'PDD Holdings', 'discretionary', 'cn'],
  CROX: ['크록스', 'Crocs', 'discretionary', 'us'],
  SE: ['씨(Sea)', 'Sea Ltd', 'discretionary', 'other'],
  SGI: ['솜니그룹', 'Somnigroup', 'discretionary', 'us'],
  NKE: ['나이키', 'Nike', 'discretionary', 'us'],
  SBUX: ['스타벅스', 'Starbucks', 'discretionary', 'us'],
  KO: ['코카콜라', 'Coca-Cola', 'staples', 'us'],
  KHC: ['크래프트 하인즈', 'Kraft Heinz', 'staples', 'us'],
  KR: ['크로거', 'Kroger', 'staples', 'us'],
  PG: ['P&G', 'Procter & Gamble', 'staples', 'us'],
  PEP: ['펩시코', 'PepsiCo', 'staples', 'us'],
  TBBB: ['BBB Foods', 'BBB Foods', 'staples', 'other'],
  AXP: ['아메리칸 익스프레스', 'American Express', 'financials', 'us'],
  BAC: ['뱅크오브아메리카', 'Bank of America', 'financials', 'us'],
  MCO: ['무디스', "Moody's", 'financials', 'us'],
  CB: ['처브', 'Chubb', 'financials', 'us'],
  JPM: ['JP모건', 'JPMorgan Chase', 'financials', 'us'],
  'BRK.B': ['버크셔 해서웨이', 'Berkshire Hathaway', 'financials', 'us'],
  EWBC: ['이스트웨스트 뱅코프', 'East West Bancorp', 'financials', 'us'],
  COIN: ['코인베이스', 'Coinbase', 'financials', 'us'],
  XYZ: ['블록', 'Block', 'financials', 'us'],
  PYPL: ['페이팔', 'PayPal', 'financials', 'us'],
  CVX: ['셰브론', 'Chevron', 'energy', 'us'],
  OXY: ['옥시덴탈', 'Occidental', 'energy', 'us'],
  XOM: ['엑슨모빌', 'ExxonMobil', 'energy', 'us'],
  YPF: ['YPF', 'YPF', 'energy', 'other'],
  DVA: ['다비타', 'DaVita', 'health', 'us'],
  LLY: ['일라이 릴리', 'Eli Lilly', 'health', 'us'],
  NTRA: ['나테라', 'Natera', 'health', 'us'],
  INSM: ['인스메드', 'Insmed', 'health', 'us'],
  RVMD: ['레볼루션 메디슨', 'Revolution Medicines', 'health', 'us'],
  NAMS: ['뉴암스테르담 파마', 'NewAmsterdam Pharma', 'health', 'other'],
  JNJ: ['존슨앤드존슨', 'Johnson & Johnson', 'health', 'us'],
  ABBV: ['애브비', 'AbbVie', 'health', 'us'],
  PFE: ['화이자', 'Pfizer', 'health', 'us'],
  DAL: ['델타항공', 'Delta Air Lines', 'industrials', 'us'],
  SPCX: ['스페이스X', 'SpaceX', 'industrials', 'us'],
  UBER: ['우버', 'Uber', 'industrials', 'us'],
  BA: ['보잉', 'Boeing', 'industrials', 'us'],
  VST: ['비스트라', 'Vistra', 'utilities', 'us'],
  NRG: ['NRG 에너지', 'NRG Energy', 'utilities', 'us'],
  O: ['리얼티인컴', 'Realty Income', 'realestate', 'us'],
  PBUS: ['Invesco 미국 대형주 ETF', 'Invesco PureBeta US ETF', 'etf', 'us'],
  IVV: ['iShares S&P500 ETF', 'iShares Core S&P 500', 'etf', 'us'],
  VOO: ['Vanguard S&P500 ETF', 'Vanguard S&P 500', 'etf', 'us'],
  SPY: ['SPDR S&P500 ETF', 'SPDR S&P 500', 'etf', 'us'],
  QQQ: ['Invesco QQQ', 'Invesco QQQ', 'etf', 'us'],
  QQQM: ['Invesco QQQM', 'Invesco QQQM', 'etf', 'us'],
  SCHD: ['SCHD', 'Schwab US Dividend Equity', 'etf', 'us'],
  VYM: ['VYM', 'Vanguard High Dividend Yield', 'etf', 'us'],
  JEPI: ['JEPI', 'JPMorgan Equity Premium Income', 'etf', 'us'],
  ARKK: ['ARKK', 'ARK Innovation ETF', 'etf', 'us'],
  EWY: ['iShares 한국 ETF', 'iShares MSCI South Korea', 'etf', 'kr'],
  EWZ: ['iShares 브라질 ETF', 'iShares MSCI Brazil', 'etf', 'other'],
  // Added for the wider 13F / Form 4 directory (src/data/guruDirectory.json).
  AMAT: ['어플라이드 머티어리얼즈', 'Applied Materials', 'tech', 'us'],
  APH: ['암페놀', 'Amphenol', 'tech', 'us'],
  APP: ['앱러빈', 'AppLovin', 'tech', 'us'],
  CRWV: ['코어위브', 'CoreWeave', 'tech', 'us'],
  DDOG: ['데이터독', 'Datadog', 'tech', 'us'],
  FLEX: ['플렉스', 'Flex', 'tech', 'us'],
  GDS: ['GDS홀딩스', 'GDS Holdings', 'tech', 'cn'],
  NATL: ['NCR 아틀레오스', 'NCR Atleos', 'tech', 'us'],
  QCOM: ['퀄컴', 'Qualcomm', 'tech', 'us'],
  SNDK: ['샌디스크', 'SanDisk', 'tech', 'us'],
  VRSN: ['베리사인', 'VeriSign', 'tech', 'us'],
  FICO: ['페어아이작', 'Fair Isaac', 'tech', 'us'],
  FTNT: ['포티넷', 'Fortinet', 'tech', 'us'],
  KEYS: ['키사이트', 'Keysight', 'tech', 'us'],
  ROP: ['로퍼 테크놀로지스', 'Roper Technologies', 'tech', 'us'],
  NOW: ['서비스나우', 'ServiceNow', 'tech', 'us'],
  TXN: ['텍사스 인스트루먼트', 'Texas Instruments', 'tech', 'us'],
  CCCS: ['CCC 인텔리전트', 'CCC Intelligent Solutions', 'tech', 'us'],
  CCC: ['CCC 인텔리전트', 'CCC Intelligent Solutions', 'tech', 'us'],
  SMCI: ['슈퍼마이크로', 'Super Micro Computer', 'tech', 'us'],
  SUNB: ['선벨트 렌털스', 'Sunbelt Rentals', 'industrials', 'us'],
  ACA: ['아르코사', 'Arcosa', 'industrials', 'us'],
  NBIS: ['네비우스', 'Nebius', 'tech', 'other'],
  ECHO: ['에코스타', 'EchoStar', 'comm', 'us'],
  TKO: ['TKO그룹', 'TKO Group', 'comm', 'us'],
  FWONK: ['리버티 포뮬러원', 'Liberty Formula One', 'comm', 'us'],
  LYV: ['라이브네이션', 'Live Nation', 'comm', 'us'],
  TDS: ['TDS', 'Telephone & Data Systems', 'comm', 'us'],
  WBD: ['워너브라더스 디스커버리', 'Warner Bros. Discovery', 'comm', 'us'],
  EA: ['일렉트로닉 아츠', 'Electronic Arts', 'comm', 'us'],
  LBTYK: ['리버티 글로벌', 'Liberty Global', 'comm', 'other'],
  CZR: ['시저스', 'Caesars Entertainment', 'discretionary', 'us'],
  GPC: ['제뉴인 파츠', 'Genuine Parts', 'discretionary', 'us'],
  HD: ['홈디포', 'Home Depot', 'discretionary', 'us'],
  M: ['메이시스', "Macy's", 'discretionary', 'us'],
  MNRO: ['먼로', 'Monro', 'discretionary', 'us'],
  QSR: ['레스토랑 브랜즈', 'Restaurant Brands', 'discretionary', 'other'],
  ABNB: ['에어비앤비', 'Airbnb', 'discretionary', 'us'],
  MAR: ['메리어트', 'Marriott', 'discretionary', 'us'],
  ORLY: ['오라일리', "O'Reilly Automotive", 'discretionary', 'us'],
  TJX: ['TJX', 'TJX Companies', 'discretionary', 'us'],
  YUM: ['얌브랜즈', 'Yum! Brands', 'discretionary', 'us'],
  DASH: ['도어대시', 'DoorDash', 'discretionary', 'us'],
  NCLH: ['노르웨이지안 크루즈', 'Norwegian Cruise Line', 'discretionary', 'us'],
  DLTR: ['달러트리', 'Dollar Tree', 'staples', 'us'],
  KOF: ['코카콜라 펨사', 'Coca-Cola FEMSA', 'staples', 'other'],
  MNST: ['몬스터 베버리지', 'Monster Beverage', 'staples', 'us'],
  WMT: ['월마트', 'Walmart', 'staples', 'us'],
  PM: ['필립모리스', 'Philip Morris', 'staples', 'us'],
  'BF.B': ['브라운포맨', 'Brown-Forman', 'staples', 'us'],
  'BF.A': ['브라운포맨', 'Brown-Forman', 'staples', 'us'],
  CASY: ['케이시스', "Casey's", 'staples', 'us'],
  CHD: ['처치앤드와이트', 'Church & Dwight', 'staples', 'us'],
  HLF: ['허벌라이프', 'Herbalife', 'staples', 'us'],
  NSRGY: ['네슬레', 'Nestlé', 'staples', 'other'],
  AON: ['에이온', 'Aon', 'financials', 'us'],
  CME: ['CME그룹', 'CME Group', 'financials', 'us'],
  COF: ['캐피털원', 'Capital One', 'financials', 'us'],
  CRCL: ['서클', 'Circle', 'financials', 'us'],
  HOOD: ['로빈후드', 'Robinhood', 'financials', 'us'],
  MKTX: ['마켓액세스', 'MarketAxess', 'financials', 'us'],
  V: ['비자', 'Visa', 'financials', 'us'],
  MA: ['마스터카드', 'Mastercard', 'financials', 'us'],
  BN: ['브룩필드', 'Brookfield', 'financials', 'other'],
  GSHD: ['구스헤드', 'Goosehead Insurance', 'financials', 'us'],
  KKR: ['KKR', 'KKR', 'financials', 'us'],
  KSPI: ['카스피', 'Kaspi.kz', 'financials', 'other'],
  UNM: ['유넘', 'Unum', 'financials', 'us'],
  WBS: ['웹스터 파이낸셜', 'Webster Financial', 'financials', 'us'],
  CVI: ['CVR 에너지', 'CVR Energy', 'energy', 'us'],
  OKE: ['원오크', 'ONEOK', 'energy', 'us'],
  RIG: ['트랜스오션', 'Transocean', 'energy', 'us'],
  SD: ['샌드리지 에너지', 'SandRidge Energy', 'energy', 'us'],
  SHEL: ['셸', 'Shell', 'energy', 'other'],
  BLCO: ['바슈롬', 'Bausch + Lomb', 'health', 'us'],
  ELV: ['엘레반스 헬스', 'Elevance Health', 'health', 'us'],
  MOH: ['몰리나 헬스케어', 'Molina Healthcare', 'health', 'us'],
  SDGR: ['슈뢰딩거', 'Schrödinger', 'health', 'us'],
  TEM: ['템퍼스 AI', 'Tempus AI', 'health', 'us'],
  TFX: ['텔레플렉스', 'Teleflex', 'health', 'us'],
  TWST: ['트위스트 바이오사이언스', 'Twist Bioscience', 'health', 'us'],
  TXG: ['10x 지노믹스', '10x Genomics', 'health', 'us'],
  WST: ['웨스트 파마슈티컬', 'West Pharmaceutical', 'health', 'us'],
  IDXX: ['아이덱스', 'IDEXX Labs', 'health', 'us'],
  SYK: ['스트라이커', 'Stryker', 'health', 'us'],
  VEEV: ['비바 시스템즈', 'Veeva Systems', 'health', 'us'],
  WAT: ['워터스', 'Waters', 'health', 'us'],
  CRSP: ['크리스퍼', 'CRISPR Therapeutics', 'health', 'other'],
  TEVA: ['테바', 'Teva', 'health', 'other'],
  CAT: ['캐터필러', 'Caterpillar', 'industrials', 'us'],
  CNI: ['캐나디언 내셔널 철도', 'Canadian National Railway', 'industrials', 'other'],
  CTRI: ['센추리', 'Centuri', 'industrials', 'us'],
  DE: ['디어', 'Deere', 'industrials', 'us'],
  DNOW: ['DNOW', 'DNOW', 'industrials', 'us'],
  FDX: ['페덱스', 'FedEx', 'industrials', 'us'],
  FERG: ['퍼거슨', 'Ferguson', 'industrials', 'us'],
  GTLS: ['차트 인더스트리즈', 'Chart Industries', 'industrials', 'us'],
  HONA: ['허니웰 에어로스페이스', 'Honeywell Aerospace', 'industrials', 'us'],
  IEP: ['아이칸 엔터프라이즈', 'Icahn Enterprises', 'industrials', 'us'],
  JBLU: ['제트블루', 'JetBlue', 'industrials', 'us'],
  SITE: ['사이트원', 'SiteOne', 'industrials', 'us'],
  UAL: ['유나이티드항공', 'United Airlines', 'industrials', 'us'],
  UNP: ['유니언퍼시픽', 'Union Pacific', 'industrials', 'us'],
  WCC: ['웨스코', 'WESCO', 'industrials', 'us'],
  WCN: ['웨이스트 커넥션스', 'Waste Connections', 'industrials', 'us'],
  WM: ['웨이스트 매니지먼트', 'Waste Management', 'industrials', 'us'],
  ADP: ['ADP', 'Automatic Data Processing', 'industrials', 'us'],
  APG: ['API그룹', 'APi Group', 'industrials', 'us'],
  CPRT: ['코파트', 'Copart', 'industrials', 'us'],
  GEV: ['GE 버노바', 'GE Vernova', 'industrials', 'us'],
  NSC: ['노퍽 서던', 'Norfolk Southern', 'industrials', 'us'],
  ROL: ['롤린스', 'Rollins', 'industrials', 'us'],
  TDG: ['트랜스다임', 'TransDigm', 'industrials', 'us'],
  AEP: ['아메리칸 일렉트릭 파워', 'American Electric Power', 'utilities', 'us'],
  ETR: ['엔터지', 'Entergy', 'utilities', 'us'],
  DLR: ['디지털 리얼티', 'Digital Realty', 'realestate', 'us'],
  AVB: ['애벌론베이', 'AvalonBay', 'realestate', 'us'],
  CSGP: ['코스타', 'CoStar', 'realestate', 'us'],
  CRH: ['CRH', 'CRH', 'materials', 'other'],
  ECL: ['에코랩', 'Ecolab', 'materials', 'us'],
  IFF: ['IFF', 'International Flavors & Fragrances', 'materials', 'us'],
  NEM: ['뉴몬트', 'Newmont', 'materials', 'us'],
  NUE: ['뉴코어', 'Nucor', 'materials', 'us'],
  UAN: ['CVR 파트너스', 'CVR Partners', 'materials', 'us'],
  MLM: ['마틴 마리에타', 'Martin Marietta', 'materials', 'us'],
  HCC: ['워리어 멧 콜', 'Warrior Met Coal', 'materials', 'us'],
  AMR: ['알파 메탈러지컬', 'Alpha Metallurgical', 'materials', 'us'],
  CRS: ['카펜터 테크놀로지', 'Carpenter Technology', 'materials', 'us'],
  AXTA: ['액살타', 'Axalta', 'materials', 'us'],
  LIN: ['린데', 'Linde', 'materials', 'us'],
  // Community / meme favourites.
  GME: ['게임스탑', 'GameStop', 'discretionary', 'us'],
  AMC: ['AMC 엔터테인먼트', 'AMC Entertainment', 'comm', 'us'],
  MSTR: ['스트래티지', 'Strategy (MicroStrategy)', 'tech', 'us'],
  ASTS: ['AST 스페이스모바일', 'AST SpaceMobile', 'comm', 'us'],
  RKLB: ['로켓랩', 'Rocket Lab', 'industrials', 'us'],
  SOFI: ['소파이', 'SoFi', 'financials', 'us'],
  QBTS: ['디웨이브', 'D-Wave Quantum', 'tech', 'us'],
  IONQ: ['아이온큐', 'IonQ', 'tech', 'us'],
  RGTI: ['리게티', 'Rigetti Computing', 'tech', 'us'],
  OKLO: ['오클로', 'Oklo', 'utilities', 'us'],
  MARA: ['마라 홀딩스', 'MARA Holdings', 'financials', 'us'],
  MRNA: ['모더나', 'Moderna', 'health', 'us'],
  LULU: ['룰루레몬', 'Lululemon', 'discretionary', 'us'],
  SLM: ['샐리메이', 'Sallie Mae', 'financials', 'us'],
  BRKR: ['브루커', 'Bruker', 'health', 'us'],
  AAOI: ['어플라이드 옵토', 'Applied Optoelectronics', 'tech', 'us'],
  CRDO: ['크레도', 'Credo Technology', 'tech', 'us'],
  BE: ['블룸에너지', 'Bloom Energy', 'industrials', 'us'],
  COHR: ['코히어런트', 'Coherent', 'tech', 'us'],
  DTE: ['DTE 에너지', 'DTE Energy', 'utilities', 'us'],
  IT: ['가트너', 'Gartner', 'tech', 'us'],
  EWW: ['iShares 멕시코 ETF', 'iShares MSCI Mexico', 'etf', 'other'],
  IEMG: ['iShares 신흥국 ETF', 'iShares Core MSCI EM', 'etf', 'other'],
  VWO: ['Vanguard 신흥국 ETF', 'Vanguard FTSE Emerging Markets', 'etf', 'other'],
  '005930': ['삼성전자', 'Samsung Electronics', 'tech', 'kr'],
  '000660': ['SK하이닉스', 'SK hynix', 'tech', 'kr'],
  '035420': ['NAVER', 'NAVER', 'comm', 'kr'],
  '035720': ['카카오', 'Kakao', 'comm', 'kr'],
  '005380': ['현대차', 'Hyundai Motor', 'discretionary', 'kr'],
  '000270': ['기아', 'Kia', 'discretionary', 'kr'],
  '105560': ['KB금융', 'KB Financial', 'financials', 'kr'],
  '055550': ['신한지주', 'Shinhan Financial', 'financials', 'kr'],
  '373220': ['LG에너지솔루션', 'LG Energy Solution', 'industrials', 'kr'],
  '068270': ['셀트리온', 'Celltrion', 'health', 'kr'],
  '207940': ['삼성바이오로직스', 'Samsung Biologics', 'health', 'kr'],
  '005490': ['POSCO홀딩스', 'POSCO Holdings', 'materials', 'kr'],
};

// Share classes of the same company compare as one holding.
const TICKER_ALIASES = {
  GOOG: 'GOOGL',
  'BRK/B': 'BRK.B',
  'BRK-B': 'BRK.B',
  BRKB: 'BRK.B',
  'BRK/A': 'BRK.B',
  'BRK-A': 'BRK.B',
  'BRK.A': 'BRK.B',
  'BF/B': 'BF.B',
  'BF/A': 'BF.B',
  'BF.A': 'BF.B',
};

export function normalizeTicker(value) {
  const raw = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\.(KS|KQ|KRX|KOSPI|KOSDAQ)$/, '');
  if (!raw) {
    return '';
  }
  return TICKER_ALIASES[raw] ?? raw;
}

// Order matters: the first match wins, so the specific sectors come before the catch-all ETF one.
const APP_SECTOR_RULES = [
  [/채권|bond|treasury/i, 'bonds'],
  [/^금$|금·|gold|원자재|commodit/i, 'commodities'],
  [/부동산|리츠|reit|real estate/i, 'realestate'],
  [/광범위|혼합|분산|국제 주식|신흥국|배당 etf|broad|index/i, 'etf'],
  [/반도체|기술|software|tech|semiconductor|it$/i, 'tech'],
  [/인터넷|플랫폼|커뮤니케이션|미디어|통신|게임|communication|media|telecom/i, 'comm'],
  [/금융|은행|보험|증권|bank|financ|insur/i, 'financials'],
  [/자동차|경기소비|리테일|유통|auto|discretionary|retail/i, 'discretionary'],
  [/필수소비|음식료|식품|staples|food|beverage/i, 'staples'],
  [/바이오|헬스케어|제약|health|pharma|bio/i, 'health'],
  [/배터리|2차전지|산업|조선|방산|항공|기계|industrial|aerospace/i, 'industrials'],
  [/철강|소재|화학|material|chemical/i, 'materials'],
  [/에너지|정유|energy|oil/i, 'energy'],
  [/유틸리티|전력|가스|utilit/i, 'utilities'],
];

export function resolveUserSector(position) {
  const meta = SECURITY_META[normalizeTicker(position?.code)];
  if (meta) {
    return meta[2];
  }
  const sector = String(position?.sector ?? '').trim();
  const rule = APP_SECTOR_RULES.find(([pattern]) => pattern.test(sector));
  if (rule) {
    return rule[1];
  }
  if (/ETF|ETN|펀드|fund/i.test(String(position?.assetClass ?? ''))) {
    return 'etf';
  }
  return 'other';
}

export function resolveUserRegion(position) {
  const meta = SECURITY_META[normalizeTicker(position?.code)];
  if (meta) {
    return meta[3];
  }
  const region = String(position?.region ?? '').trim();
  if (/미국|^us$|united states|usa/i.test(region)) return 'us';
  if (/한국|korea|^kr$/i.test(region)) return 'kr';
  if (/중국|홍콩|china|hong ?kong/i.test(region)) return 'cn';
  if (/대만|taiwan/i.test(region)) return 'tw';
  if (!region || region === '미분류') {
    const code = normalizeTicker(position?.code);
    if (/^\d{6}$|^\d{5}[A-Z]$/.test(code)) return 'kr';
    if (/^[A-Z][A-Z.]{0,5}$/.test(code)) return 'us';
  }
  return 'other';
}

// One row per security, weights re-normalised over the positions that actually have a weight.
export function buildUserHoldings(positions = []) {
  const merged = new Map();
  for (const position of Array.isArray(positions) ? positions : []) {
    const weight = Number(position?.weight);
    if (!Number.isFinite(weight) || weight <= 0) {
      continue;
    }
    const ticker = normalizeTicker(position?.code);
    const key = ticker || `name:${String(position?.label ?? '').trim()}`;
    const meta = SECURITY_META[ticker];
    const current = merged.get(key);
    if (current) {
      current.weight += weight;
      continue;
    }
    merged.set(key, {
      ticker,
      name: { ko: meta?.[0] ?? position?.label ?? ticker, en: meta?.[1] ?? position?.label ?? ticker },
      weight,
      returnRate: Number.isFinite(position?.returnRate) ? position.returnRate : null,
      sector: resolveUserSector(position),
      region: resolveUserRegion(position),
    });
  }
  const total = [...merged.values()].reduce((sum, holding) => sum + holding.weight, 0);
  if (!total) {
    return [];
  }
  return [...merged.values()]
    .map((holding) => ({ ...holding, weight: holding.weight / total }))
    .sort((a, b) => b.weight - a.weight);
}

export function concentrationOf(weights) {
  const sorted = weights.filter((w) => w > 0).sort((a, b) => b - a);
  const total = sorted.reduce((sum, w) => sum + w, 0);
  if (!total) {
    return { holdings: 0, effectiveHoldings: 0, top1: 0, top5: 0 };
  }
  const shares = sorted.map((w) => w / total);
  return {
    holdings: shares.length,
    effectiveHoldings: 1 / shares.reduce((sum, w) => sum + w * w, 0),
    top1: shares[0],
    top5: shares.slice(0, 5).reduce((sum, w) => sum + w, 0),
  };
}

function bucketWeights(holdings, key, rest = 0) {
  const buckets = {};
  for (const holding of holdings) {
    buckets[holding[key]] = (buckets[holding[key]] ?? 0) + holding.weight;
  }
  if (rest > 0.0005) {
    buckets.rest = rest;
  }
  return buckets;
}

// The "common share" is Σ min(my weight, their weight) over the securities both hold — how much
// of the two portfolios is literally the same money in the same names. Only the investor's top
// holdings are bundled, so anything outside them counts as not shared.
export function compareWithGuru(userHoldings = [], guru) {
  const guruHoldings = guru?.holdings ?? [];
  const guruByTicker = new Map(guruHoldings.map((holding) => [holding.ticker, holding]));
  const userTickers = new Set(userHoldings.map((holding) => holding.ticker).filter(Boolean));
  const shared = userHoldings
    .filter((holding) => holding.ticker && guruByTicker.has(holding.ticker))
    .map((holding) => ({
      ...holding,
      userWeight: holding.weight,
      guruWeight: guruByTicker.get(holding.ticker).weight,
    }))
    .sort(
      (a, b) => Math.max(b.userWeight, b.guruWeight) - Math.max(a.userWeight, a.guruWeight),
    );
  const commonShare = shared.reduce((sum, h) => sum + Math.min(h.userWeight, h.guruWeight), 0);
  const covered = guruHoldings.reduce((sum, holding) => sum + holding.weight, 0);
  const rest = Math.max(0, 1 - covered);
  const userSectors = bucketWeights(userHoldings, 'sector');
  const guruSectors = bucketWeights(guruHoldings, 'sector', rest);
  const sectorKeys = [...new Set([...Object.keys(userSectors), ...Object.keys(guruSectors)])].filter(
    (key) => key !== 'rest',
  );
  const sectors = sectorKeys
    .map((key) => ({ key, user: userSectors[key] ?? 0, guru: guruSectors[key] ?? 0 }))
    .sort((a, b) => Math.max(b.user, b.guru) - Math.max(a.user, a.guru));
  if (guruSectors.rest) {
    sectors.push({ key: 'rest', user: 0, guru: guruSectors.rest });
  }

  return {
    shared,
    commonShare,
    userOnly: userHoldings.filter((holding) => !holding.ticker || !guruByTicker.has(holding.ticker)),
    guruOnly: guruHoldings.filter((holding) => !userTickers.has(holding.ticker)),
    sectors,
    userRegions: bucketWeights(userHoldings, 'region'),
    guruRegions: bucketWeights(guruHoldings, 'region', rest),
    userConcentration: concentrationOf(userHoldings.map((holding) => holding.weight)),
  };
}

const searchKey = (value) => String(value ?? '').toLowerCase().replace(/[\s·.,'&()-]/g, '');

// Directory search for the 유명인 tab: matches names (Korean or English), the fund/company, and
// — so "애플" or "NVDA" finds who holds or trades it — the bundled holdings and Form 4 issuers.
// Name matches come first; holding matches are ordered by how much of the portfolio it is.
export function searchGuruDirectory(people = [], snapshot = null, query = '') {
  const needle = searchKey(query);
  if (!needle) {
    return people.map((entry) => ({ entry, holding: null }));
  }
  const nameHits = [];
  const holdingHits = [];
  for (const entry of people) {
    const names = [entry.person?.ko, entry.person?.en, entry.entity, entry.id, ...(entry.aliases ?? [])].map(searchKey);
    if (names.some((name) => name.includes(needle))) {
      nameHits.push({ entry, holding: null });
      continue;
    }
    const fund = snapshot?.funds?.[entry.id];
    const insider = snapshot?.insiders?.[entry.id];
    const candidates = [
      ...(fund?.holdings ?? []).map((holding) => ({ ...holding, source: 'holding' })),
      ...(insider?.issuers ?? []).map((issuer) => ({
        ticker: issuer.ticker,
        name: { ko: issuer.name, en: issuer.name },
        weight: 0,
        source: 'issuer',
      })),
    ];
    const hit = candidates.find((holding) =>
      [holding.ticker, holding.name?.ko, holding.name?.en].map(searchKey).some((key) => key && key.includes(needle)),
    );
    if (hit) holdingHits.push({ entry, holding: hit });
  }
  holdingHits.sort((a, b) => (b.holding.weight ?? 0) - (a.holding.weight ?? 0));
  return [...nameHits, ...holdingHits];
}

export function daysSince(dateText, today = new Date()) {
  const then = Date.parse(`${dateText}T00:00:00Z`);
  if (!Number.isFinite(then)) {
    return null;
  }
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((now - then) / 86_400_000);
}

const pct = (value) => `${(value * 100).toFixed(1)}%`;
const points = (value) => `${(value * 100).toFixed(1)}%p`;

function withTopic(word, en) {
  if (en) {
    return word;
  }
  const code = word.charCodeAt(word.length - 1);
  if (code < 0xac00 || code > 0xd7a3) {
    return `${word}는`;
  }
  return `${word}${(code - 0xac00) % 28 ? '은' : '는'}`;
}

// Plain descriptive sentences — what differs, never what to buy or sell.
export function buildGuruInsights(result, guru, language = 'ko') {
  const en = language === 'en';
  const person = guru?.person?.[en ? 'en' : 'ko'] ?? '';
  const sectorName = (key) => SECTOR_LABELS[key]?.[en ? 'en' : 'ko'] ?? key;
  const nameOf = (holding) => holding.name?.[en ? 'en' : 'ko'] ?? holding.ticker;
  const lines = [];
  const topCount = guru?.holdings?.length ?? 0;

  if (result.shared.length) {
    const names = result.shared.slice(0, 3).map(nameOf).join(', ');
    const more = result.shared.length > 3 ? (en ? ' and more' : ' 등') : '';
    lines.push(
      en
        ? `Common share is ${pct(result.commonShare)}: you hold ${result.shared.length} of ${person}'s top ${topCount} (${names}${more}).`
        : `공통 비중은 ${pct(result.commonShare)}입니다. ${person}의 상위 ${topCount}종목 가운데 ${result.shared.length}종목(${names}${more})을 나도 갖고 있습니다.`,
    );
  } else {
    lines.push(
      en
        ? `You hold none of ${person}'s top ${topCount}. Compare by sector and region instead.`
        : `${person}의 상위 ${topCount}종목과 내 포트폴리오 사이에 공통 종목이 없습니다. 종목 대신 섹터와 지역으로 비교해 보세요.`,
    );
  }

  const comparable = result.sectors.filter((row) => row.key !== 'rest');
  const guruHeavier = comparable.reduce(
    (best, row) => (row.guru - row.user > (best ? best.guru - best.user : 0) ? row : best),
    null,
  );
  const userHeavier = comparable.reduce(
    (best, row) => (row.user - row.guru > (best ? best.user - best.guru : 0) ? row : best),
    null,
  );
  if (guruHeavier && guruHeavier.guru - guruHeavier.user > 0.02) {
    lines.push(
      en
        ? `${person} has ${pct(guruHeavier.guru)} in ${sectorName(guruHeavier.key)}, ${points(guruHeavier.guru - guruHeavier.user)} more than you (${pct(guruHeavier.user)}).`
        : `${withTopic(person, en)} ${sectorName(guruHeavier.key)} 비중이 ${pct(guruHeavier.guru)}로 나(${pct(guruHeavier.user)})보다 ${points(guruHeavier.guru - guruHeavier.user)} 높습니다.`,
    );
  }
  if (userHeavier && userHeavier.user - userHeavier.guru > 0.02) {
    lines.push(
      en
        ? `You have ${pct(userHeavier.user)} in ${sectorName(userHeavier.key)}, ${points(userHeavier.user - userHeavier.guru)} more than ${person} (${pct(userHeavier.guru)}).`
        : `나는 ${sectorName(userHeavier.key)} 비중이 ${pct(userHeavier.user)}로 ${person}(${pct(userHeavier.guru)})보다 ${points(userHeavier.user - userHeavier.guru)} 높습니다.`,
    );
  }

  const korea = result.userRegions.kr ?? 0;
  if (korea > 0.5) {
    lines.push(
      en
        ? `${pct(korea)} of your portfolio is Korean stocks. 13F filings only list US-listed securities, so common holdings are unlikely.`
        : `내 포트폴리오는 한국 주식이 ${pct(korea)}입니다. 13F에는 미국 상장 종목만 나오므로 공통 종목이 나오기 어렵습니다.`,
    );
  }

  const mine = result.userConcentration.effectiveHoldings.toFixed(1);
  const theirs = Number(guru?.effectiveHoldings ?? 0).toFixed(1);
  lines.push(
    en
      ? `Effective number of holdings: you ${mine}, ${person} ${theirs}.`
      : `유효 종목 수는 나 ${mine}개, ${person} ${theirs}개입니다.`,
  );

  return lines;
}
