import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { createPortfolioHeatmap } from './lib/portfolioHeatmap.js';
import { createPortfolioAllocation } from './lib/portfolioAllocation.js';
import {
  collapsePortfolioItemsForDisplay as collapsePortfolioItemsForDisplayShared,
  parsePortfolioTextDetailed as parsePortfolioTextDetailedShared,
  shouldFallbackToLocalTimeline as shouldFallbackToLocalTimelineShared,
} from './lib/portfolioIngestionCore.js';
import { createPortfolioScorecard } from './lib/portfolioScoring.js';
import { createPortfolioAnalyticsSummary } from './lib/portfolioAnalyticsSummary.js';
import { enrichPortfolioItem, resolveExactSecurityReferenceCode } from './lib/securityKnowledge.js';
import {
  fetchLiveMarketData,
  fetchMarketSymbolSuggestions,
  formatMarketChange,
  formatMarketChangePercent,
  formatMarketInputPrice,
  formatMarketPrice,
  formatMarketTime,
} from './lib/liveMarketData.js';
import { fetchCompanyFinancials } from './lib/companyFinancials.js';
import { fetchMarketNews, formatNewsTime } from './lib/marketNews.js';
import { fetchPortfolioAiSummary } from './lib/aiPortfolioSummary.js';
import {
  createServerPortfolio,
  deleteServerPortfolio,
  claimGuestWorkspace,
  fetchWorkspaceSession,
  getPortfolioWorkspaceId,
  isGuestPortfolioWorkspaceId,
  listServerPortfolios,
  readStoredOption,
  readStoredPosition,
  setPortfolioWorkspaceId,
  writeStoredPosition,
  clearStoredPosition,
  saveServerImportHistory,
} from './utils/storage.js';
import { filterPortfolioItemsForAtomScene } from './utils/portfolioItems.js';
import {
  AtomSketch as AtomSketchView,
  PortfolioPreviewAtom as PortfolioPreviewAtomView,
} from './components/atom/index.jsx';
import { HeatmapCard as HeatmapCardView } from './components/cards/HeatmapCard.jsx';
import { PortfolioScoreCard as PortfolioScoreCardView } from './components/cards/PortfolioScoreCard.jsx';
import {
  PortfolioAllocationCard as PortfolioAllocationCardView,
  PortfolioAllocationRing as PortfolioAllocationRingView,
} from './components/allocation/index.jsx';
import DigitalTwinPanel from './components/panels/DigitalTwinPanel.jsx';
import { AuthPanel } from './components/auth/AuthPanel.jsx';

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? '';

const VIEWBOX_SIZE = 640;
const VIEWBOX_HALF = VIEWBOX_SIZE / 2;
const MIN_ATOMS = 1;
const MAX_PORTFOLIOS = 20;
const BOND_LENGTH = 214;
const CAMERA_DISTANCE = 470;
const CAMERA_NEAR_CLIP = 136;
const TRACKBALL_RADIUS = 208;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const AUTO_ROTATE_SPEED = 0.018;
const DEFAULT_SCENE_CAMERA = {
  panX: 0,
  panY: 0,
  dolly: 0,
  zoom: 1,
  roll: 0,
  driftX: 0,
  driftY: 0,
  focus: 0,
};
const LOW_COUNT_LAYOUTS = {
  2: [
    [0.82, 0.12, 0.56],
    [-0.74, -0.24, -0.63],
  ],
  3: [
    [0.86, 0.08, 0.5],
    [-0.42, 0.82, -0.38],
    [-0.48, -0.8, -0.36],
  ],
  4: [
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
  ],
  5: [
    [0, 1, 0.46],
    [0.92, 0.1, -0.34],
    [-0.58, 0.72, -0.38],
    [-0.72, -0.58, -0.36],
    [0.62, -0.76, 0.1],
  ],
};
const GROUP_OPTION_KEYS = ['region', 'sector', 'style', 'risk'];
const SCORE_AXIS_KEYS = [
  'profitability',
  'diversification',
  'riskManagement',
  'composition',
  'timing',
  'stability',
];
const LANGUAGE_OPTIONS = ['ko', 'en'];
const ASSET_CLASS_MODE_OPTIONS = ['auto', 'preferOriginal'];
const ALLOCATION_WEIGHT_MODE_OPTIONS = ['auto', 'stock', 'assetClass', 'account'];
const SCORE_WEIGHT_PRESET_OPTIONS = ['balanced', 'returnFocus', 'longTermReturnFocus', 'stabilityFocus'];
const BASE_CURRENCY_OPTIONS = ['KRW', 'USD'];
const DEFAULT_USD_KRW_RATE = 1365;
const DEFAULT_DISPLAY_FX_RATES = {
  USD: { KRW: DEFAULT_USD_KRW_RATE },
  KRW: { USD: 1 / DEFAULT_USD_KRW_RATE },
};
const DATE_BASIS_OPTIONS = ['kst', 'local'];
const SETTING_TOGGLE_OPTIONS = ['on', 'off'];
const STORAGE_KEYS = {
  language: 'atom-sketch-language',
  assetClassMode: 'atom-sketch-asset-class-mode',
  allocationWeightMode: 'atom-sketch-allocation-weight-mode',
  scoreWeightPreset: 'atom-sketch-score-weight-preset',
  baseCurrency: 'atom-sketch-base-currency',
  dateBasis: 'atom-sketch-date-basis',
  autoSave: 'atom-sketch-auto-save',
  dailySnapshots: 'atom-sketch-daily-snapshots',
  portfolioData: 'atom-sketch-portfolio-data-v1',
  settingsDockPosition: 'atom-sketch-settings-dock-position',
  toolTriggerPosition: 'atom-sketch-tool-trigger-position',
  groupDockPosition: 'atom-sketch-group-dock-position',
  heatmapDockPosition: 'atom-sketch-heatmap-dock-position',
  scoreDockPosition: 'atom-sketch-score-dock-position-v2',
  allocationDockPosition: 'atom-sketch-allocation-dock-position',
  twinDockPosition: 'atom-sketch-twin-dock-position',
};
const MOBILE_BREAKPOINT = 560;
const REVIEW_TOOLTIP_MAX_WIDTH = 18 * 16;
const REVIEW_TOOLTIP_VIEWPORT_INSET = 18;
const REVIEW_TOOLTIP_VERTICAL_GAP = 10;
const SHOOTING_STAR_INTERVAL_MS = 30000;
const SHOOTING_STAR_CLEAR_BUFFER_MS = 420;
const SCENE_FRAME_INTERVAL_MS = 1000 / 30;
const LARGE_SCENE_FRAME_INTERVAL_MS = 1000 / 24;
const DRAG_SCENE_FRAME_INTERVAL_MS = 1000 / 60;
const REDUCED_MOTION_FRAME_INTERVAL_MS = 1000 / 12;
const LARGE_SCENE_ATOM_THRESHOLD = 12;
const DRAG_ROTATION_RESPONSE = 30;
const IDLE_ROTATION_RESPONSE = 10;
const DRAG_ROTATION_SENSITIVITY = 0.68;
const DRAG_SPIN_DECAY = 7.4;
const MAX_DRAG_SPIN_VELOCITY = 0.58;
const SECURITY_ENRICHMENT_RETRY_DELAYS_MS = [0, 1500, 5000, 14000];
const ACTIVE_FLOATING_TOOL_Z_INDEX = 80;
const FLOATING_TOOL_Z_INDEX = {
  settings: 30,
  'tool-menu': 31,
  group: 32,
  heatmap: 33,
  allocation: 34,
  score: 35,
  twin: 36,
  'tool-drawer': 37,
};
const TOOL_DRAWER_DEFAULT_WIDTH = 522;
const TOOL_DRAWER_MAX_WIDTH = 760;
const SERVER_SYNC_DEBOUNCE_MS = 850;
const DAILY_SNAPSHOT_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_REBALANCE_TARGET_WEIGHTS = {
  stock: 60,
  dividend: 15,
  goldCash: 15,
  reit: 5,
  other: 5,
};
const UI_TEXT = {
  ko: {
    groupLabels: {
      region: '투자 지역',
      sector: '분야',
      style: '투자 스타일',
      risk: '위험 등급',
    },
    scoreAxisLabels: {
      profitability: '수익성',
      diversification: '분산투자',
      riskManagement: '위험관리',
      composition: '포트폴리오 구성',
      timing: '투자 타이밍',
      stability: '수익 안정성',
    },
    fieldLabels: {
      stockCode: '종목 티커',
      stockName: '종목명',
      accountId: '포트폴리오 ID',
      accountType: '포트폴리오 유형',
      buyDate: '매수일',
      buyPrice: '매수가',
      shares: '보유수량',
      return: '수익률',
      region: '투자 지역',
      sector: '분야',
      style: '투자 스타일',
      risk: '위험 등급',
      assetClass: '자산 구분',
      currency: '통화',
      marketCapClass: '규모 분류',
      volatility: '변동성',
      taxStatus: '과세 구분',
      benchmark: '비교 지수',
    },
    settings: '설정',
    language: '언어',
    korean: '한국어',
    english: '영어',
    settingsAria: '설정 열기',
    settingsSectionLanguage: '언어',
    settingsSectionBaseCurrency: '기준 통화',
    settingsCurrencyKrw: 'KRW',
    settingsCurrencyUsd: 'USD',
    settingsSectionDateBasis: '날짜 기준',
    settingsDateBasisKst: '한국 시간',
    settingsDateBasisLocal: '내 기기 시간',
    settingsSectionAutoSave: '자동 저장',
    settingsAutoSaveOn: '켜짐',
    settingsAutoSaveOff: '꺼짐',
    settingsSectionDailySnapshots: '일별 손익 누적',
    settingsDailySnapshotsOn: '켜짐',
    settingsDailySnapshotsOff: '꺼짐',
    settingsSectionWorkspace: '서비스 계정',
    workspaceStatusLabel: '상태',
    workspaceStatusGuest: '게스트',
    workspaceStatusSignedIn: '로그인됨',
    workspaceIdLabel: 'Workspace',
    workspaceUserLabel: '사용자',
    workspaceSyncLabel: '저장 동기화',
    workspaceSyncIdle: '대기',
    workspaceSyncPending: '저장 중',
    workspaceSyncSaved: '저장됨',
    workspaceSyncOffline: '서버 저장 실패',
    workspaceSyncPaused: '자동 저장 꺼짐',
    workspaceSyncServerMerged: '서버 저장본 반영',
    workspaceSyncConflict: '로컬 변경 우선',
    workspaceSyncLocalFailed: '로컬 저장 실패',
    workspaceClaimButton: '게스트 데이터 이전',
    workspaceClaimReady: '로그인 후 이전 가능',
    workspaceClaimPending: '이전 중',
    workspaceClaimDone: '이전 완료',
    workspaceClaimEmpty: '이전할 게스트 데이터 없음',
    workspaceClaimFailed: '이전 실패',
    authEmailPlaceholder: '이메일',
    authPasswordPlaceholder: '비밀번호',
    authVerifyCodePlaceholder: '인증 코드',
    authVerifyHint: '이메일로 받은 인증 코드를 입력하세요',
    authSignInButton: '로그인',
    authSignUpButton: '회원가입',
    authVerifyButton: '인증 확인',
    authSignOut: '로그아웃',
    authPending: '처리 중',
    authSwitchToSignUp: '계정이 없으신가요? 회원가입',
    authSwitchToSignIn: '이미 계정이 있으신가요? 로그인',
    authGenericError: '요청을 처리하지 못했습니다. 다시 시도해주세요.',
    uploadAria: '투자 데이터 업로드',
    uploadHint: '투자 데이터를 업로드 해주세요',
    uploadDragHint: 'CSV 파일을 여기에 끌어다 놓으세요',
    reviewTitle: '업로드 진단',
    reviewStatusOk: '정상',
    reviewStatusNeedsReview: '검토 필요',
    reviewStatusBlocked: '차단',
    toolMenuAria: '도구 선택 열기',
    groupToolAria: '하이라이트 도구 열기',
    scoreToolAria: '스파이더 차트 열기',
    clearUploadAria: '업로드 파일 지우기',
    clearCenterAria: '선택 강조 해제',
    heatmapAria: '수익 캘린더 히트맵 열기',
    contributionAria: '깃허브 잔디밭 아이콘',
    heatmapChartAria: '포트폴리오 수익 캘린더 히트맵',
    heatmapHint: '날짜 위에 커서를 올려 손익 확인',
    heatmapEmpty: '날짜와 손익 데이터가 없어 히트맵을 표시할 수 없습니다.',
    heatmapLess: '적음',
    heatmapMore: '많음',
    scoreChartAria: '포트폴리오 레이더 점수 차트',
    allocationTitle: '자산 비중',
    allocationChartAria: '포트폴리오 자산 비중 도넛 차트',
    allocationTotalReturn: '총 수익률',
    allocationUnknown: '미분류',
    allocationShareLabel: '전체 비중',
    allocationSourceExplicit: '비중 컬럼 기준',
    allocationSourcePosition: '매수가 × 수량 기준',
    allocationSourceEqual: '균등 비중 기준',
    atomAria: '검은 배경 위 손으로 그린 인터랙티브 포트폴리오 스케치',
    scorePointUnit: '점',
    parseError: '종목 행을 찾지 못했습니다. ticker/name 컬럼이 있는 CSV를 올려주세요.',
    readError: '파일을 읽지 못했습니다.',
    maxFilesError: '포트폴리오는 최대 20개까지 업로드할 수 있습니다.',
  },
  en: {
    groupLabels: {
      region: 'Region',
      sector: 'Field',
      style: 'Style',
      risk: 'Risk Level',
    },
    scoreAxisLabels: {
      profitability: 'Profitability',
      diversification: 'Diversification',
      riskManagement: 'Risk Control',
      composition: 'Composition',
      timing: 'Timing',
      stability: 'Stability',
    },
    fieldLabels: {
      stockCode: 'Ticker',
      stockName: 'Name',
      accountId: 'Portfolio ID',
      accountType: 'Portfolio Type',
      buyDate: 'Buy Date',
      buyPrice: 'Buy Price',
      shares: 'Shares',
      return: 'Return',
      region: 'Region',
      sector: 'Field',
      style: 'Style',
      risk: 'Risk Level',
      assetClass: 'Asset Class',
      currency: 'Currency',
      marketCapClass: 'Market Cap',
      volatility: 'Volatility',
      taxStatus: 'Tax Status',
      benchmark: 'Benchmark',
    },
    settings: 'Settings',
    language: 'Language',
    korean: 'Korean',
    english: 'English',
    settingsAria: 'Open settings',
    settingsSectionLanguage: 'Language',
    settingsSectionBaseCurrency: 'Base Currency',
    settingsCurrencyKrw: 'KRW',
    settingsCurrencyUsd: 'USD',
    settingsSectionDateBasis: 'Date Basis',
    settingsDateBasisKst: 'Korea time',
    settingsDateBasisLocal: 'Device time',
    settingsSectionAutoSave: 'Auto Save',
    settingsAutoSaveOn: 'On',
    settingsAutoSaveOff: 'Off',
    settingsSectionDailySnapshots: 'Daily P/L History',
    settingsDailySnapshotsOn: 'On',
    settingsDailySnapshotsOff: 'Off',
    settingsSectionWorkspace: 'Service Account',
    workspaceStatusLabel: 'Status',
    workspaceStatusGuest: 'Guest',
    workspaceStatusSignedIn: 'Signed in',
    workspaceIdLabel: 'Workspace',
    workspaceUserLabel: 'User',
    workspaceSyncLabel: 'Save Sync',
    workspaceSyncIdle: 'Idle',
    workspaceSyncPending: 'Saving',
    workspaceSyncSaved: 'Saved',
    workspaceSyncOffline: 'Server save failed',
    workspaceSyncPaused: 'Auto save off',
    workspaceSyncServerMerged: 'Server copy applied',
    workspaceSyncConflict: 'Local copy kept',
    workspaceSyncLocalFailed: 'Local save failed',
    workspaceClaimButton: 'Move guest data',
    workspaceClaimReady: 'Available after sign-in',
    workspaceClaimPending: 'Moving',
    workspaceClaimDone: 'Moved',
    workspaceClaimEmpty: 'No guest data to move',
    workspaceClaimFailed: 'Move failed',
    authEmailPlaceholder: 'Email',
    authPasswordPlaceholder: 'Password',
    authVerifyCodePlaceholder: 'Verification code',
    authVerifyHint: 'Enter the verification code sent to your email',
    authSignInButton: 'Sign in',
    authSignUpButton: 'Sign up',
    authVerifyButton: 'Verify',
    authSignOut: 'Sign out',
    authPending: 'Working',
    authSwitchToSignUp: "Don't have an account? Sign up",
    authSwitchToSignIn: 'Already have an account? Sign in',
    authGenericError: 'Something went wrong. Please try again.',
    uploadAria: 'Upload investment data',
    uploadHint: 'Please upload your investment data',
    uploadDragHint: 'Drop CSV files here',
    reviewTitle: 'Upload Review',
    reviewStatusOk: 'OK',
    reviewStatusNeedsReview: 'Needs Review',
    reviewStatusBlocked: 'Blocked',
    toolMenuAria: 'Open tool picker',
    groupToolAria: 'Open highlight tool',
    scoreToolAria: 'Open radar chart',
    clearUploadAria: 'Clear uploaded file',
    clearCenterAria: 'Clear highlighted portfolio selection',
    heatmapAria: 'Open profit calendar heatmap',
    contributionAria: 'GitHub contribution icon',
    heatmapChartAria: 'Portfolio profit calendar heatmap',
    heatmapHint: 'Hover a date to inspect the result',
    heatmapEmpty: 'No date and return data was found for the heatmap.',
    heatmapLess: 'Less',
    heatmapMore: 'More',
    scoreChartAria: 'Portfolio radar score chart',
    allocationTitle: 'Asset Mix',
    allocationChartAria: 'Portfolio asset allocation donut chart',
    allocationTotalReturn: 'Total Return',
    allocationUnknown: 'Unclassified',
    allocationShareLabel: 'Portfolio Share',
    allocationSourceExplicit: 'Weighted by allocation column',
    allocationSourcePosition: 'Weighted by buy price × shares',
    allocationSourceEqual: 'Weighted equally',
    atomAria: 'Interactive hand-drawn portfolio sketch on a black background',
    scorePointUnit: 'pts',
    parseError: 'Could not find portfolio rows. Upload a CSV with ticker or name columns.',
    readError: 'Could not read the file.',
    maxFilesError: 'You can upload up to 20 portfolios.',
  },
};
const TOOLTIP_WIDTH = 320;
const TOOLTIP_HEIGHT = 260;
const ALLOCATION_SEGMENT_PALETTE = [
  {
    main: '#f2f2f2',
    soft: 'rgba(242, 242, 242, 0.34)',
    glow: 'rgba(242, 242, 242, 0.18)',
    highlight: 'rgba(255, 255, 255, 0.78)',
  },
  {
    main: '#d6d6d6',
    soft: 'rgba(214, 214, 214, 0.34)',
    glow: 'rgba(214, 214, 214, 0.18)',
    highlight: 'rgba(247, 247, 247, 0.66)',
  },
  {
    main: '#bdbdbd',
    soft: 'rgba(189, 189, 189, 0.34)',
    glow: 'rgba(189, 189, 189, 0.18)',
    highlight: 'rgba(234, 234, 234, 0.6)',
  },
  {
    main: '#a4a4a4',
    soft: 'rgba(164, 164, 164, 0.34)',
    glow: 'rgba(164, 164, 164, 0.18)',
    highlight: 'rgba(223, 223, 223, 0.58)',
  },
  {
    main: '#8a8a8a',
    soft: 'rgba(138, 138, 138, 0.34)',
    glow: 'rgba(138, 138, 138, 0.18)',
    highlight: 'rgba(212, 212, 212, 0.56)',
  },
  {
    main: '#727272',
    soft: 'rgba(114, 114, 114, 0.34)',
    glow: 'rgba(114, 114, 114, 0.18)',
    highlight: 'rgba(198, 198, 198, 0.54)',
  },
];

function makeDemoItem({
  label,
  detail,
  region,
  sector,
  style,
  risk,
  code,
  buyDate,
  buyPrice,
  shares,
}) {
  return enrichPortfolioItem({
    label,
    code,
    name: label,
    detail,
    region,
    sector,
    style,
    risk,
    fields: [
      { label: '종목 티커', value: code },
      { label: '매수일', value: buyDate },
      { label: '매수가', value: buyPrice },
      { label: '보유수량', value: shares },
      { label: '수익률', value: detail },
      { label: '투자 지역', value: region },
      { label: '분야', value: sector },
      { label: '투자 스타일', value: style },
      { label: '위험 등급', value: risk },
    ].filter((item) => item.value),
  });
}

const DEFAULT_PORTFOLIO_ITEMS = [
  makeDemoItem({
    label: 'QQQM',
    detail: '+4.8%',
    region: '미국',
    sector: '대형 기술주',
    style: '성장주',
    risk: '고위험',
    code: 'QQQM',
    buyDate: '2025-11-18',
    buyPrice: '$205.40',
    shares: '14주',
  }),
  makeDemoItem({
    label: 'VEA',
    detail: '+1.6%',
    region: '선진국',
    sector: '국제 주식',
    style: '분산형',
    risk: '중위험',
    code: 'VEA',
    buyDate: '2025-10-22',
    buyPrice: '$52.10',
    shares: '31주',
  }),
  makeDemoItem({
    label: 'SCHD',
    detail: '-0.9%',
    region: '미국',
    sector: '배당주',
    style: '배당주',
    risk: '중위험',
    code: 'SCHD',
    buyDate: '2025-09-04',
    buyPrice: '$27.84',
    shares: '44주',
  }),
  makeDemoItem({
    label: 'SOXX',
    detail: '+7.3%',
    region: '미국',
    sector: '반도체',
    style: '성장주',
    risk: '고위험',
    code: 'SOXX',
    buyDate: '2025-12-12',
    buyPrice: '$231.65',
    shares: '8주',
  }),
  makeDemoItem({
    label: 'AAPL',
    detail: '+5.1%',
    region: '미국',
    sector: '기술',
    style: '성장주',
    risk: '고위험',
    code: 'AAPL',
    buyDate: '2025-07-01',
    buyPrice: '$208.10',
    shares: '12주',
  }),
  makeDemoItem({
    label: 'MSFT',
    detail: '+3.9%',
    region: '미국',
    sector: '기술',
    style: '성장주',
    risk: '고위험',
    code: 'MSFT',
    buyDate: '2025-08-15',
    buyPrice: '$421.30',
    shares: '7주',
  }),
  makeDemoItem({
    label: 'VTI',
    detail: '+2.4%',
    region: '미국',
    sector: '광범위 시장',
    style: '분산형',
    risk: '중위험',
    code: 'VTI',
    buyDate: '2025-06-10',
    buyPrice: '$284.26',
    shares: '16주',
  }),
  makeDemoItem({
    label: 'BND',
    detail: '-1.2%',
    region: '미국',
    sector: '채권',
    style: '배당주',
    risk: '저위험',
    code: 'BND',
    buyDate: '2025-05-02',
    buyPrice: '$72.44',
    shares: '28주',
  }),
  makeDemoItem({
    label: 'IAU',
    detail: '+0.7%',
    region: '글로벌',
    sector: '원자재',
    style: '방어형',
    risk: '중위험',
    code: 'IAU',
    buyDate: '2025-04-19',
    buyPrice: '$58.21',
    shares: '19주',
  }),
];
const HEADER_KEYWORDS = [
  'ticker',
  'symbol',
  'code',
  'name',
  'security',
  'asset',
  'assetclass',
  'assettype',
  'assetname',
  'securityname',
  'productname',
  'weight',
  'allocation',
  'ratio',
  'share',
  'quantity',
  'date',
  'day',
  'price',
  'buyprice',
  'buydate',
  'region',
  'country',
  'sector',
  'industry',
  'style',
  'strategy',
  'risk',
  'acct',
  'acctid',
  'accountid',
  'accountnumber',
  'ordertype',
  'buysell',
  'account',
  'accounttype',
  'accountkind',
  'currency',
  'benchmark',
  '종목',
  '종목명',
  '자산명',
  '상품명',
  '보유',
  '비중',
  '수량',
  '매수',
  '매입',
  '현재가',
  '손익',
  '평가손익',
  '시가총액',
  '지역',
  '분야',
  '스타일',
  '위험',
  '자산',
  '계좌',
  '계좌유형',
  '계좌종류',
  '통화',
  '금액',
  'return',
  'dailyreturn',
  'cumulativereturn',
  'returns',
  'performance',
  'change',
  '수익률',
  '일일수익률',
  '누적수익률',
  '날짜',
  '일자',
  '등락률',
];

function normalizeHeader(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\ufeff/, '')
    .replace(/[\s_.\-/%()[\]]+/g, '');
}

function noise(seed) {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function jitter(seed, amount) {
  return (noise(seed) * 2 - 1) * amount;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function damp(current, target, lambda, delta) {
  return current + (target - current) * (1 - Math.exp(-lambda * delta));
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function createPortfolioEntry(fileName, items, entryId) {
  const displayItems = collapsePortfolioItemsForDisplayShared(items);

  return {
    id:
      entryId ||
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `portfolio-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`),
    fileName,
    items: displayItems,
    timelineItems: items,
    parserDiagnostics: null,
    agentReview: null,
    ingestSource: 'client-local',
  };
}

function createPortfolioEntryFromPayload(payload, entryId) {
  const timelineItems = Array.isArray(payload?.timelineItems) ? payload.timelineItems : [];
  const rawDisplayItems = Array.isArray(payload?.items)
    ? payload.items
    : collapsePortfolioItemsForDisplayShared(timelineItems);
  const displayItems = collapsePortfolioItemsForDisplayShared(rawDisplayItems);

  return {
    id:
      entryId ||
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `portfolio-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`),
    fileName: payload?.fileName || 'portfolio.csv',
    items: displayItems,
    timelineItems,
    parserDiagnostics: payload?.parserDiagnostics ?? null,
    agentReview: payload?.agentReview ?? null,
    ingestSource: payload?.ingestSource ?? 'server',
    metadata: payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : {},
    createdAt: payload?.createdAt ?? null,
    updatedAt: payload?.updatedAt ?? null,
  };
}

function serializePortfolioEntryForStorage(entry) {
  const items = Array.isArray(entry?.items) ? entry.items : [];
  const timelineItems =
    Array.isArray(entry?.timelineItems) && entry.timelineItems.length ? entry.timelineItems : items;

  return {
    id: String(entry?.id ?? ''),
    fileName: String(entry?.fileName ?? 'portfolio.csv'),
    items,
    timelineItems,
    parserDiagnostics: entry?.parserDiagnostics ?? null,
    agentReview: entry?.agentReview ?? null,
    ingestSource: entry?.ingestSource ?? 'restored-local',
    metadata: entry?.metadata && typeof entry.metadata === 'object' ? entry.metadata : {},
    createdAt: entry?.createdAt ?? null,
    updatedAt: entry?.updatedAt ?? null,
  };
}

function portfolioEntryTimestamp(entry) {
  const parsed = Date.parse(entry?.updatedAt ?? entry?.createdAt ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function portfolioEntriesEqual(first, second) {
  try {
    return (
      JSON.stringify(serializePortfolioEntryForStorage(first)) ===
      JSON.stringify(serializePortfolioEntryForStorage(second))
    );
  } catch {
    return false;
  }
}

function mergePortfolioEntriesWithServer(localEntries, serverEntries) {
  const entries = Array.isArray(localEntries) ? localEntries.slice(0, MAX_PORTFOLIOS) : [];
  const byId = new Map(entries.map((entry, index) => [entry.id, index]));
  const summary = {
    addedFromServer: 0,
    updatedFromServer: 0,
    localNewer: 0,
  };

  (Array.isArray(serverEntries) ? serverEntries : []).slice(0, MAX_PORTFOLIOS).forEach((serverEntry) => {
    if (!serverEntry?.id) {
      return;
    }

    const localIndex = byId.get(serverEntry.id);
    if (!Number.isInteger(localIndex)) {
      if (entries.length < MAX_PORTFOLIOS) {
        byId.set(serverEntry.id, entries.length);
        entries.push(serverEntry);
        summary.addedFromServer += 1;
      }
      return;
    }

    const localEntry = entries[localIndex];
    if (portfolioEntriesEqual(localEntry, serverEntry)) {
      return;
    }

    const serverTime = portfolioEntryTimestamp(serverEntry);
    const localTime = portfolioEntryTimestamp(localEntry);
    if (serverTime >= localTime) {
      entries[localIndex] = serverEntry;
      summary.updatedFromServer += 1;
      return;
    }

    summary.localNewer += 1;
  });

  return { entries, summary };
}

function dateFromDateKey(dateKey) {
  const match = String(dateKey ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const [, yearValue, monthValue, dayValue] = match;
  const year = Number.parseInt(yearValue, 10);
  const month = Number.parseInt(monthValue, 10);
  const day = Number.parseInt(dayValue, 10);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function normalizePortfolioDateKey(value) {
  const dateKey = formatAtomDateLabel(value);

  return dateFromDateKey(dateKey) ? dateKey : '';
}

function addDaysToDateKey(dateKey, days) {
  const date = dateFromDateKey(dateKey);
  if (!date) {
    return '';
  }

  date.setDate(date.getDate() + days);
  return formatDateKey(date);
}

function readSavedAtDateKey(savedAt, dateBasis = 'kst') {
  if (!savedAt) {
    return '';
  }

  const date = new Date(savedAt);
  if (Number.isFinite(date.getTime())) {
    return formatDateKeyForBasis(date, dateBasis);
  }

  return normalizePortfolioDateKey(savedAt);
}

function buildElapsedDateKeysSince(savedAt, today = new Date(), dateBasis = 'kst') {
  const savedDateKey = readSavedAtDateKey(savedAt, dateBasis);
  const todayDateKey = formatDateKeyForBasis(today, dateBasis);

  if (!savedDateKey || savedDateKey >= todayDateKey) {
    return [];
  }

  const dateKeys = [];
  let cursorDateKey = addDaysToDateKey(savedDateKey, 1);

  while (cursorDateKey && cursorDateKey <= todayDateKey) {
    dateKeys.push(cursorDateKey);
    cursorDateKey = addDaysToDateKey(cursorDateKey, 1);
  }

  return dateKeys;
}

function isPortfolioSnapshotDateLabel(label) {
  const normalized = normalizeDisplayKey(label);

  return [
    '날짜',
    '일자',
    '기준일',
    '기준일자',
    '평가일',
    '평가일자',
    '조회일',
    '조회일자',
    'date',
    'day',
    'recorddate',
    'valuedate',
    'valuationdate',
    'snapshotdate',
    'asofdate',
  ]
    .map(normalizeDisplayKey)
    .includes(normalized);
}

function readPortfolioSnapshotDateKey(item) {
  const directDateKey = normalizePortfolioDateKey(
    item?.dailySnapshotDate ?? item?.snapshotDate ?? item?.recordedAt ?? item?.asOfDate,
  );

  if (directDateKey) {
    return directDateKey;
  }

  const dateField = (item?.fields ?? []).find((field) =>
    isPortfolioSnapshotDateLabel(field?.label),
  );

  return normalizePortfolioDateKey(dateField?.value);
}

function upsertPortfolioSnapshotDateField(fields, dateKey) {
  const nextFields = Array.isArray(fields) ? fields.map((field) => ({ ...field })) : [];
  const dateFieldIndex = nextFields.findIndex((field) =>
    isPortfolioSnapshotDateLabel(field?.label),
  );

  if (dateFieldIndex >= 0) {
    nextFields[dateFieldIndex] = {
      ...nextFields[dateFieldIndex],
      value: dateKey,
    };
    return nextFields;
  }

  return [{ label: '날짜', value: dateKey }, ...nextFields];
}

function dailySnapshotItemKey(item, index) {
  return [
    item?.code,
    item?.ticker,
    item?.stockCode,
    item?.name,
    item?.stockName,
    item?.companyName,
    item?.label,
  ]
    .map((value) => normalizeDisplayKey(value))
    .find(Boolean) ?? `row:${index}`;
}

function dailySnapshotId(item, dateKey, index) {
  const baseId = String(item?.id ?? dailySnapshotItemKey(item, index))
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]/g, '-')
    .slice(0, 80);

  return `${baseId || `holding-${index + 1}`}:snapshot:${dateKey}`;
}

function createDailyPortfolioSnapshotItem(item, dateKey, index) {
  return {
    ...item,
    id: dailySnapshotId(item, dateKey, index),
    recordedAt: dateKey,
    snapshotDate: dateKey,
    dailySnapshotDate: dateKey,
    fields: upsertPortfolioSnapshotDateField(item?.fields, dateKey),
    metadataSourceByField: {
      ...(item?.metadataSourceByField ?? {}),
      recordedAt: 'daily-roll-forward',
      snapshotDate: 'daily-roll-forward',
    },
  };
}

function getDailySnapshotSourceItems(entry) {
  if (Array.isArray(entry?.items) && entry.items.length) {
    return entry.items;
  }

  const timelineItems = Array.isArray(entry?.timelineItems) ? entry.timelineItems : [];
  return collapsePortfolioItemsForDisplayShared(timelineItems);
}

function rollForwardPortfolioEntry(entry, savedAt, dateBasis = 'kst') {
  const elapsedDateKeys = buildElapsedDateKeysSince(savedAt, new Date(), dateBasis);
  if (!elapsedDateKeys.length) {
    return entry;
  }

  const sourceItems = getDailySnapshotSourceItems(entry);
  if (!sourceItems.length) {
    return entry;
  }

  const timelineItems = Array.isArray(entry?.timelineItems) && entry.timelineItems.length
    ? entry.timelineItems
    : sourceItems;
  const existingSnapshotKeysByDate = new Map();

  timelineItems.forEach((item, index) => {
    const dateKey = readPortfolioSnapshotDateKey(item);
    if (!dateKey) {
      return;
    }

    const itemKey = dailySnapshotItemKey(item, index);
    const itemKeys = existingSnapshotKeysByDate.get(dateKey) ?? new Set();
    itemKeys.add(itemKey);
    existingSnapshotKeysByDate.set(dateKey, itemKeys);
  });

  const appendedItems = [];
  elapsedDateKeys.forEach((dateKey) => {
    const existingItemKeys = existingSnapshotKeysByDate.get(dateKey) ?? new Set();

    sourceItems.forEach((item, index) => {
      const itemKey = dailySnapshotItemKey(item, index);
      if (existingItemKeys.has(itemKey)) {
        return;
      }

      existingItemKeys.add(itemKey);
      appendedItems.push(createDailyPortfolioSnapshotItem(item, dateKey, index));
    });

    existingSnapshotKeysByDate.set(dateKey, existingItemKeys);
  });

  if (!appendedItems.length) {
    return entry;
  }

  const nextTimelineItems = [...timelineItems, ...appendedItems];
  const lastSnapshotDate = appendedItems.at(-1)?.dailySnapshotDate ?? elapsedDateKeys.at(-1);

  return {
    ...entry,
    items: collapsePortfolioItemsForDisplayShared(nextTimelineItems),
    timelineItems: nextTimelineItems,
    metadata: {
      ...(entry?.metadata ?? {}),
      lastDailySnapshotAt: lastSnapshotDate,
      dailySnapshotCount: Number(entry?.metadata?.dailySnapshotCount ?? 0) + appendedItems.length,
    },
  };
}

function rollForwardPortfolioEntriesSince(entries, savedAt, dateBasis = 'kst') {
  if (!Array.isArray(entries) || !entries.length) {
    return Array.isArray(entries) ? entries : [];
  }

  let changed = false;
  const nextEntries = entries.map((entry) => {
    const entrySavedAt =
      savedAt ??
      entry?.metadata?.lastSavedAt ??
      entry?.metadata?.lastDailySnapshotAt ??
      entry?.updatedAt ??
      entry?.createdAt;
    const nextEntry = rollForwardPortfolioEntry(entry, entrySavedAt, dateBasis);

    if (nextEntry !== entry) {
      changed = true;
    }

    return nextEntry;
  });

  return changed ? nextEntries : entries;
}

function readStoredPortfolioState() {
  if (typeof window === 'undefined') {
    return { entries: [], activePortfolioId: null, savedAt: null };
  }

  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEYS.portfolioData);
    if (!rawValue) {
      return { entries: [], activePortfolioId: null, savedAt: null };
    }

    const parsed = JSON.parse(rawValue);
    const savedAt = parsed?.savedAt ?? null;
    const dateBasis = readStoredOption(STORAGE_KEYS.dateBasis, DATE_BASIS_OPTIONS, 'kst');
    const dailySnapshots = readStoredOption(STORAGE_KEYS.dailySnapshots, SETTING_TOGGLE_OPTIONS, 'on');
    const baseEntries = Array.isArray(parsed?.entries)
      ? parsed.entries
          .slice(0, MAX_PORTFOLIOS)
          .map((storedEntry) =>
            createPortfolioEntryFromPayload(
              {
                fileName: storedEntry?.fileName,
                items: Array.isArray(storedEntry?.items) ? storedEntry.items : [],
                timelineItems: Array.isArray(storedEntry?.timelineItems)
                  ? storedEntry.timelineItems
                  : Array.isArray(storedEntry?.items)
                    ? storedEntry.items
                    : [],
                parserDiagnostics: storedEntry?.parserDiagnostics ?? null,
                agentReview: storedEntry?.agentReview ?? null,
                ingestSource: storedEntry?.ingestSource ?? 'restored-local',
                metadata: storedEntry?.metadata,
                createdAt: storedEntry?.createdAt,
                updatedAt: storedEntry?.updatedAt,
              },
              storedEntry?.id,
            ),
          )
          .filter((entry) => entry.id)
      : [];
    const restoredEntries =
      dailySnapshots === 'on'
        ? rollForwardPortfolioEntriesSince(baseEntries, savedAt, dateBasis)
        : baseEntries;

    const parsedActiveId = String(parsed?.activePortfolioId ?? '');
    const activePortfolioId = restoredEntries.some((entry) => entry.id === parsedActiveId)
      ? parsedActiveId
      : restoredEntries[0]?.id ?? null;

    return {
      entries: restoredEntries,
      activePortfolioId,
      savedAt,
    };
  } catch {
    return { entries: [], activePortfolioId: null, savedAt: null };
  }
}

function writeStoredPortfolioState(entries, activePortfolioId) {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const safeEntries = Array.isArray(entries)
      ? entries.slice(0, MAX_PORTFOLIOS).map(serializePortfolioEntryForStorage).filter((entry) => entry.id)
      : [];

    if (!safeEntries.length) {
      window.localStorage.removeItem(STORAGE_KEYS.portfolioData);
      return null;
    }

    const safeActiveId = String(activePortfolioId ?? '');
    const nextActivePortfolioId = safeEntries.some((entry) => entry.id === safeActiveId)
      ? safeActiveId
      : safeEntries[0].id;
    const savedAt = new Date().toISOString();

    window.localStorage.setItem(
      STORAGE_KEYS.portfolioData,
      JSON.stringify({
        version: 1,
        savedAt,
        activePortfolioId: nextActivePortfolioId,
        entries: safeEntries,
      }),
    );
    return savedAt;
  } catch (error) {
    console.warn('portfolio-persist-failed', error);
    return null;
  }
}

function buildLocalPortfolioPayload(fileName, localItems, parserDiagnostics, overrides = {}) {
  const displayItems = collapsePortfolioItemsForDisplayShared(localItems);

  return {
    fileName,
    itemCount: localItems.length,
    securityCount: displayItems.length,
    items: displayItems,
    timelineItems: localItems,
    parserDiagnostics,
    agentReview: null,
    ingestSource: 'client-local',
    ...overrides,
  };
}

function reviewStatusLabel(text, status) {
  if (status === 'blocked') {
    return text.reviewStatusBlocked;
  }

  if (status === 'needs-review') {
    return text.reviewStatusNeedsReview;
  }

  return text.reviewStatusOk;
}

function resolveEntryReviewStatus(entry) {
  if (!entry) {
    return 'ok';
  }

  if (
    entry.ingestSource === 'client-local-fallback' ||
    entry.ingestSource === 'server-with-local-timeline'
  ) {
    return entry.agentReview?.status === 'blocked' ? 'blocked' : 'needs-review';
  }

  return entry.agentReview?.status ?? entry.parserDiagnostics?.reviewStatus ?? 'ok';
}

function buildImportRecordFromPortfolioEntry(entry) {
  const timelineItems =
    Array.isArray(entry?.timelineItems) && entry.timelineItems.length
      ? entry.timelineItems
      : Array.isArray(entry?.items)
        ? entry.items
        : [];
  const displayItems = Array.isArray(entry?.items) ? entry.items : [];

  return {
    id: 'import-' + String(entry?.id ?? Date.now()),
    portfolioId: String(entry?.id ?? ''),
    fileName: String(entry?.fileName ?? 'portfolio.csv'),
    status: resolveEntryReviewStatus(entry),
    itemCount: timelineItems.length,
    securityCount: displayItems.length || timelineItems.length,
    parserDiagnostics: entry?.parserDiagnostics ?? null,
    agentReview: entry?.agentReview ?? null,
    ingestSource: entry?.ingestSource ?? 'client-local',
  };
}

function queueImportHistorySync(entry) {
  if (typeof window === 'undefined' || !entry?.id) {
    return;
  }

  void saveServerImportHistory(buildImportRecordFromPortfolioEntry(entry)).catch(() => {});
}

function buildUploadReviewPreview(entry) {
  if (!entry) {
    return null;
  }

  const status = resolveEntryReviewStatus(entry);
  if (status === 'ok') {
    return null;
  }

  const summary = String(entry.agentReview?.summary ?? '').trim();
  const warnings = (entry.agentReview?.warnings ?? entry.parserDiagnostics?.warnings ?? [])
    .filter((warning) => String(warning?.message ?? '').trim())
    .slice(0, 3);

  if (!summary && !warnings.length) {
    return null;
  }

  return {
    status,
    summary,
    warnings,
  };
}

function supportsHoverTooltip() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }

  return window.matchMedia('(hover: hover)').matches;
}

function readPrefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }

  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function sceneFrameIntervalFor(atomCount, reducedMotion, isDragging = false) {
  if (reducedMotion) {
    return REDUCED_MOTION_FRAME_INTERVAL_MS;
  }

  if (isDragging) {
    return DRAG_SCENE_FRAME_INTERVAL_MS;
  }

  return atomCount > LARGE_SCENE_ATOM_THRESHOLD
    ? LARGE_SCENE_FRAME_INTERVAL_MS
    : SCENE_FRAME_INTERVAL_MS;
}

function uiInsetFor(width) {
  if (width <= MOBILE_BREAKPOINT) {
    return 14.4;
  }

  return clamp(width * 0.022, 16, 28.8);
}

function gearSizeFor(width) {
  return (width <= MOBILE_BREAKPOINT ? 3.7 : 4.45) * 16;
}

function groupDockSizeFor(width) {
  return (width <= MOBILE_BREAKPOINT ? 3.1 : 3.55) * 16;
}

function scoreDockSizeFor(width) {
  return (width <= MOBILE_BREAKPOINT ? 3.65 : 4.2) * 16;
}

function allocationWidgetSizeFor(width) {
  return (width <= MOBILE_BREAKPOINT ? 3.5 : 4) * 16;
}

function twinDockSizeFor(width) {
  return (width <= MOBILE_BREAKPOINT ? 3.45 : 3.9) * 16;
}

function toolTriggerSizeFor(width) {
  return scoreDockSizeFor(width);
}

function toolDockGapFor(width) {
  return width <= MOBILE_BREAKPOINT ? 12 : 16;
}

function toolDockStackStepFor(width) {
  return width <= MOBILE_BREAKPOINT ? 68 : 76;
}

function stackDockBelow(anchorX, anchorY, previousSize, dockSize, width, height, steps = 1) {
  const inset = toolDockGapFor(width);
  const step = toolDockStackStepFor(width) * steps;

  return {
    x: clamp(
      anchorX + (previousSize - dockSize) * 0.5,
      inset,
      width - dockSize - inset,
    ),
    y: clamp(
      anchorY + previousSize * 0.5 + step - dockSize * 0.5,
      inset,
      height - dockSize - inset,
    ),
  };
}

function stackDockBelowRect(rect, previousSize, dockSize, width, height, steps = 1) {
  const anchorX = rect.left + rect.width * 0.5 - previousSize * 0.5;
  const anchorY = rect.top + rect.height * 0.5 - previousSize * 0.5;
  return stackDockBelow(anchorX, anchorY, previousSize, dockSize, width, height, steps);
}

function swirlDockSizeFor(width) {
  return (width <= MOBILE_BREAKPOINT ? 3.05 : 3.38) * 16;
}

function swirlDockYFor(width) {
  return 202 + scoreDockSizeFor(width) + (width <= MOBILE_BREAKPOINT ? 42 : 48);
}

function heatmapDockSizeFor(width) {
  return (width <= MOBILE_BREAKPOINT ? 3.15 : 3.5) * 16;
}

function floatingPanelSideFor(positionX, dockSize, viewportWidth) {
  if (typeof positionX !== 'number') {
    return 'right';
  }

  const resolvedViewportWidth =
    typeof viewportWidth === 'number'
      ? viewportWidth
      : typeof window !== 'undefined'
        ? window.innerWidth
        : 0;

  if (!resolvedViewportWidth) {
    return 'right';
  }

  return positionX + dockSize * 0.5 >= resolvedViewportWidth * 0.5 ? 'left' : 'right';
}

function heatmapDockYFor(width) {
  return swirlDockYFor(width) + swirlDockSizeFor(width) + (width <= MOBILE_BREAKPOINT ? 38 : 44);
}

function uploadDockCenterOffsetFor(width, anchorWidth = 0) {
  if (anchorWidth > 0) {
    return clamp(
      anchorWidth * 0.26,
      width <= MOBILE_BREAKPOINT ? 70 : 78,
      width <= MOBILE_BREAKPOINT ? 92 : 108,
    );
  }

  return width <= MOBILE_BREAKPOINT ? 78 : 92;
}

function useFloatingHandle({
  initialPosition,
  fallbackSize,
  measureBounds,
  onInteract,
  onPress,
  resetSignal,
  followAnchor = true,
  continuousFollow = false,
  storageKey = null,
}) {
  const containerRef = useRef(null);
  const hasUserMovedRef = useRef(false);
  const snapContextRef = useRef({
    clearPress: null,
    clampPosition: null,
    initialPosition: null,
  });
  const pressRef = useRef({
    pointerId: null,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    lastX: 0,
    lastY: 0,
    pressAt: 0,
    dragStarted: false,
    action: 'toggle',
    holdTimer: null,
  });
  const [dragging, setDragging] = useState(false);
  const [position, setPosition] = useState(() => {
    if (typeof window === 'undefined') {
      return { x: 0, y: 0 };
    }

    const storedPosition = readStoredPosition(storageKey);
    if (storedPosition) {
      hasUserMovedRef.current = true;
      return storedPosition;
    }

    return initialPosition(window);
  });

  const clampPosition = (nextX, nextY) => {
    if (typeof window === 'undefined') {
      return { x: nextX, y: nextY };
    }

    const margin = uiInsetFor(window.innerWidth);
    const fallback = fallbackSize(window.innerWidth);
    const measuredBounds = measureBounds?.({
      container: containerRef.current,
      fallback,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      nextX,
      nextY,
    });
    const width =
      measuredBounds?.width ?? containerRef.current?.offsetWidth ?? fallback.width;
    const height =
      measuredBounds?.height ?? containerRef.current?.offsetHeight ?? fallback.height;
    const offsetX = measuredBounds?.offsetX ?? 0;
    const offsetY = measuredBounds?.offsetY ?? 0;

    return {
      x: clamp(
        nextX,
        margin - offsetX,
        Math.max(margin - offsetX, window.innerWidth - width - margin - offsetX),
      ),
      y: clamp(
        nextY,
        margin - offsetY,
        Math.max(margin - offsetY, window.innerHeight - height - margin - offsetY),
      ),
    };
  };

  const reusePositionIfUnchanged = (current, next) =>
    Math.abs(current.x - next.x) < 0.01 && Math.abs(current.y - next.y) < 0.01
      ? current
      : next;

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    let frameId = 0;
    let cancelled = false;
    let remainingFrames = 0;

    const syncPosition = () => {
      if (cancelled) {
        return;
      }

      setPosition((current) => {
        if (hasUserMovedRef.current) {
          return reusePositionIfUnchanged(current, clampPosition(current.x, current.y));
        }

        if (!followAnchor) {
          return reusePositionIfUnchanged(current, clampPosition(current.x, current.y));
        }

        const anchored = initialPosition(window);
        return reusePositionIfUnchanged(current, clampPosition(anchored.x, anchored.y));
      });

      remainingFrames -= 1;
      if (
        followAnchor &&
        !hasUserMovedRef.current &&
        remainingFrames > 0
      ) {
        frameId = window.requestAnimationFrame(syncPosition);
        return;
      }

      frameId = 0;
    };

    const scheduleSync = (frames = continuousFollow ? 120 : 18) => {
      remainingFrames = Math.max(remainingFrames, frames);
      if (!frameId) {
        frameId = window.requestAnimationFrame(syncPosition);
      }
    };

    const handleResize = () => scheduleSync();

    scheduleSync();
    window.addEventListener('resize', handleResize);

    return () => {
      cancelled = true;
      window.removeEventListener('resize', handleResize);
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [continuousFollow, fallbackSize, followAnchor, initialPosition, measureBounds]);

  const beginDrag = () => {
    if (pressRef.current.pointerId === null) {
      return;
    }

    window.clearTimeout(pressRef.current.holdTimer);
    pressRef.current.holdTimer = null;
    pressRef.current.dragStarted = true;
    hasUserMovedRef.current = true;
    setDragging(true);
    document.body.style.cursor = 'grabbing';
    setPosition(
      clampPosition(
        pressRef.current.originX + (pressRef.current.lastX - pressRef.current.startX),
        pressRef.current.originY + (pressRef.current.lastY - pressRef.current.startY),
      ),
    );
  };

  const clearPress = () => {
    window.clearTimeout(pressRef.current.holdTimer);
    pressRef.current.pointerId = null;
    pressRef.current.dragStarted = false;
    pressRef.current.action = 'toggle';
    pressRef.current.holdTimer = null;
    setDragging(false);
    document.body.style.cursor = '';
  };

  snapContextRef.current.clearPress = clearPress;
  snapContextRef.current.clampPosition = clampPosition;
  snapContextRef.current.initialPosition = initialPosition;

  const snapToInitial = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    snapContextRef.current.clearPress?.();
    hasUserMovedRef.current = false;
    clearStoredPosition(storageKey);
    const anchored = snapContextRef.current.initialPosition?.(window) ?? { x: 0, y: 0 };
    setPosition(snapContextRef.current.clampPosition?.(anchored.x, anchored.y) ?? anchored);
  }, [storageKey]);

  useEffect(() => {
    if (!resetSignal || typeof window === 'undefined') {
      return;
    }

    snapToInitial();
  }, [resetSignal, snapToInitial]);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !storageKey ||
      dragging ||
      !hasUserMovedRef.current
    ) {
      return;
    }

    writeStoredPosition(storageKey, position);
  }, [dragging, position, storageKey]);

  useEffect(() => {
    const handleWindowPointerMove = (event) => {
      if (pressRef.current.pointerId !== event.pointerId) {
        return;
      }

      pressRef.current.lastX = event.clientX;
      pressRef.current.lastY = event.clientY;
      const deltaX = event.clientX - pressRef.current.startX;
      const deltaY = event.clientY - pressRef.current.startY;
      const distanceSquared = deltaX * deltaX + deltaY * deltaY;
      const action = pressRef.current.action;
      const dragDistanceThreshold = action === 'toggle' ? 36 : 9;
      const shouldStartDrag =
        distanceSquared > dragDistanceThreshold ||
        (action !== 'toggle' && performance.now() - pressRef.current.pressAt > 90);

      if (!pressRef.current.dragStarted) {
        if (shouldStartDrag) {
          beginDrag();
        } else {
          return;
        }
      }

      event.preventDefault();
      onInteract?.();
      setPosition(
        clampPosition(
          pressRef.current.originX + deltaX,
          pressRef.current.originY + deltaY,
        ),
      );
    };

    const handleWindowPointerUp = (event) => {
      if (pressRef.current.pointerId !== event.pointerId) {
        return;
      }

      const deltaX = event.clientX - pressRef.current.startX;
      const deltaY = event.clientY - pressRef.current.startY;
      const wasDrag = pressRef.current.dragStarted;
      const wasClick = !wasDrag && deltaX * deltaX + deltaY * deltaY < 100;
      const action = pressRef.current.action;

      clearPress();

      if (wasDrag) {
        event.preventDefault();
        return;
      }

      if (wasClick && action === 'toggle') {
        onInteract?.();
        onPress?.();
      }
    };

    const handleWindowPointerCancel = (event) => {
      if (pressRef.current.pointerId !== event.pointerId) {
        return;
      }

      clearPress();
    };

    window.addEventListener('pointermove', handleWindowPointerMove, {
      passive: false,
    });
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerCancel);

    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerCancel);
      window.clearTimeout(pressRef.current.holdTimer);
    };
  }, [onInteract, onPress]);

  const startPress = (event, action, options = {}) => {
    const {
      capture = false,
      preventDefault = false,
      stopPropagation = false,
      holdDelay = 90,
    } = options;

    if (preventDefault) {
      event.preventDefault();
    }

    if (stopPropagation) {
      event.stopPropagation();
    }

    onInteract?.();
    if (capture) {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    pressRef.current.pointerId = event.pointerId;
    pressRef.current.startX = event.clientX;
    pressRef.current.startY = event.clientY;
    pressRef.current.originX = position.x;
    pressRef.current.originY = position.y;
    pressRef.current.lastX = event.clientX;
    pressRef.current.lastY = event.clientY;
    pressRef.current.pressAt = performance.now();
    pressRef.current.dragStarted = false;
    pressRef.current.action = action;
    pressRef.current.holdTimer =
      Number.isFinite(holdDelay) && holdDelay >= 0
        ? window.setTimeout(beginDrag, holdDelay)
        : null;
  };

  const handlePointerDown = (event) => {
    startPress(event, 'toggle', {
      capture: true,
      preventDefault: true,
      stopPropagation: true,
      holdDelay: null,
    });
  };

  const handleDragPointerDown = (event) => {
    startPress(event, 'drag', {
      capture: false,
      preventDefault: false,
      stopPropagation: true,
      holdDelay: 90,
    });
  };

  return {
    containerRef,
    dragging,
    position,
    handlePointerDown,
    handleDragPointerDown,
    snapToInitial,
  };
}

function alignedDockXFor(width, dockSize, anchorWidth = 0) {
  const centerX = uiInsetFor(width) + uploadDockCenterOffsetFor(width, anchorWidth);
  return centerX - dockSize * 0.5;
}

function format(value) {
  return value.toFixed(2);
}

function createShootingStar() {
  const seed =
    (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.001 +
    Math.random() * 17;

  return {
    id: `shooting-star-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    startX: 62 + noise(seed + 0.13) * 26,
    startY: 6 + noise(seed + 0.47) * 20,
    travelX: -(180 + noise(seed + 0.83) * 118),
    travelY: 110 + noise(seed + 1.19) * 138,
    angle: -34 + jitter(seed + 1.51, 5.6),
    length: 92 + noise(seed + 1.87) * 72,
    duration: 1800 + noise(seed + 2.23) * 940,
    scale: 0.82 + noise(seed + 2.59) * 0.28,
    opacity: 0.34 + noise(seed + 2.93) * 0.14,
  };
}

function compactLabel(value, max = 18) {
  if (!value) {
    return '';
  }

  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function compactFileName(fileName, max = 18) {
  const cleanName = String(fileName ?? '').trim();

  if (!cleanName || cleanName.length <= max) {
    return cleanName;
  }

  const extensionMatch = cleanName.match(/(\.[^.]{1,5})$/);
  const extension = extensionMatch?.[1] ?? '';
  const baseName = extension ? cleanName.slice(0, -extension.length) : cleanName;
  const extensionBudget = extension ? extension.length : 0;
  const availableBase = Math.max(6, max - extensionBudget - 1);
  const frontLength = Math.max(4, Math.ceil(availableBase * 0.58));
  const backLength = Math.max(3, availableBase - frontLength);

  if (baseName.length <= frontLength + backLength + 1) {
    return `${compactLabel(baseName, max - extensionBudget)}${extension}`;
  }

  return `${baseName.slice(0, frontLength)}…${baseName.slice(-backLength)}${extension}`;
}

function formatDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function formatDateKeyForBasis(value = new Date(), dateBasis = 'kst') {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return '';
  }

  if (dateBasis !== 'kst') {
    return formatDateKey(date);
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${byType.year}-${byType.month}-${byType.day}`;
}

function textFor(language) {
  return UI_TEXT[language] ?? UI_TEXT.ko;
}

function groupOptionsFor(language) {
  const labels = textFor(language).groupLabels;
  return GROUP_OPTION_KEYS.map((key) => ({ key, label: labels[key] }));
}

function scoreAxesFor(language) {
  const labels = textFor(language).scoreAxisLabels;
  return SCORE_AXIS_KEYS.map((key) => ({ key, label: labels[key] }));
}

function formatHeatmapValue(value, mode) {
  if (!Number.isFinite(value)) {
    return '';
  }

  if (mode === 'percent') {
    const fixed = Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(2);
    const trimmed = fixed.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0$/, '');
    return `${value > 0 ? '+' : ''}${trimmed}%`;
  }

  const fixed = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1);
  const trimmed = fixed.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0$/, '');
  return `${value > 0 ? '+' : ''}${trimmed}`;
}

function formatHeatmapDateLabel(date, language) {
  return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'ko-KR', {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function formatHeatmapMonthLabel(date, language) {
  return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'ko-KR', {
    month: 'short',
  }).format(date);
}

function formatAllocationPercent(value) {
  if (!Number.isFinite(value)) {
    return '0%';
  }

  const percentValue = value * 100;
  const fixed = percentValue >= 10 ? percentValue.toFixed(1) : percentValue.toFixed(2);
  const trimmed = fixed.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0$/, '');
  return `${trimmed}%`;
}

function formatAnalyticsCompactValue(value, language = 'ko') {
  if (!Number.isFinite(value)) {
    return '-';
  }

  const absoluteValue = Math.abs(value);
  const formatter = new Intl.NumberFormat(language === 'en' ? 'en-US' : 'ko-KR', {
    maximumFractionDigits: absoluteValue >= 100000 ? 1 : 0,
    notation: absoluteValue >= 100000 ? 'compact' : 'standard',
  });

  return formatter.format(value);
}

function formatAnalyticsSignedValue(value, language = 'ko') {
  if (!Number.isFinite(value)) {
    return '-';
  }

  return (value > 0 ? '+' : '') + formatAnalyticsCompactValue(value, language);
}

function formatAnalyticsPercentValue(value) {
  if (!Number.isFinite(value)) {
    return '-';
  }

  const fixed = Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(2);
  const trimmed = fixed.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0$/, '');
  return (value > 0 ? '+' : '') + trimmed + '%';
}

function concentrationLevelLabel(level, language = 'ko') {
  if (language === 'en') {
    return level === 'high' ? 'High' : level === 'medium' ? 'Medium' : 'Low';
  }

  return level === 'high' ? '높음' : level === 'medium' ? '보통' : '낮음';
}

function normalizeDisplayKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\ufeff/, '')
    .replace(/[\s_.\-/%()[\]]+/g, '');
}

const LEGACY_ATOM_TERM_PATTERN = new RegExp(`원${'자'}(?!재)`, 'g');

function normalizePortfolioVocabulary(value) {
  return String(value ?? '').replace(LEGACY_ATOM_TERM_PATTERN, '포트폴리오');
}

function canHighlightGroupField(atom, groupKey) {
  if (!atom || !groupKey) {
    return false;
  }

  const value = String(atom[groupKey] ?? '').trim();
  if (!value) {
    return false;
  }

  const source = String(atom.metadataSourceByField?.[groupKey] ?? '').trim().toLowerCase();
  return source === 'provided' || source === 'reference' || source === 'derived' || source === 'wikidata';
}

function resolveFieldLabelKey(label) {
  const normalized = normalizeDisplayKey(normalizePortfolioVocabulary(label));

  if (
    ['종목 티커', '종목코드', '티커', 'ticker', 'symbol', 'stockcode', 'securitycode']
      .map(normalizeDisplayKey)
      .includes(normalized)
  ) {
    return 'stockCode';
  }

  if (
    ['종목명', '자산명', '상품명', 'name', 'security', 'securityname', 'assetname', 'productname', 'company'].map(
      normalizeDisplayKey,
    ).includes(normalized)
  ) {
    return 'stockName';
  }

  if (['계좌id', '계좌번호', '계좌코드', '포트폴리오id', '포트폴리오번호', '포트폴리오코드', 'acctid', 'accountid', 'accountnumber'].map(normalizeDisplayKey).includes(normalized)) {
    return 'accountId';
  }

  if (['계좌유형', '계좌종류', '계좌구분', '계좌명', '포트폴리오 유형', '포트폴리오종류', '포트폴리오구분', '포트폴리오명', 'accounttype', 'accountkind', 'accountclass'].map(normalizeDisplayKey).includes(normalized)) {
    return 'accountType';
  }

  if (['매수일', '매입일', '취득일', 'buydate', 'purchasedate'].map(normalizeDisplayKey).includes(normalized)) {
    return 'buyDate';
  }

  if (['매수가', '매입가', 'buyprice', 'purchaseprice', 'entryprice'].map(normalizeDisplayKey).includes(normalized)) {
    return 'buyPrice';
  }

  if (['보유수량', '수량', 'shares', 'quantity'].map(normalizeDisplayKey).includes(normalized)) {
    return 'shares';
  }

  if (['수익률', '등락률', 'return', 'returns', 'performance', 'change'].map(normalizeDisplayKey).includes(normalized)) {
    return 'return';
  }

  if (['투자지역', '지역', 'region', 'market', 'country'].map(normalizeDisplayKey).includes(normalized)) {
    return 'region';
  }

  if (['분야', '업종', '산업', '섹터', 'sector', 'industry', 'theme'].map(normalizeDisplayKey).includes(normalized)) {
    return 'sector';
  }

  if (['투자스타일', '스타일', 'style', 'strategy', 'factor'].map(normalizeDisplayKey).includes(normalized)) {
    return 'style';
  }

  if (['위험등급', '위험', '리스크', 'risk', 'riskgrade', 'risklevel'].map(normalizeDisplayKey).includes(normalized)) {
    return 'risk';
  }

  if (['자산구분', 'assetclass', 'asset type', 'assettype'].map(normalizeDisplayKey).includes(normalized)) {
    return 'assetClass';
  }

  if (['통화', 'currency', 'fx', 'quotedcurrency'].map(normalizeDisplayKey).includes(normalized)) {
    return 'currency';
  }

  if (['규모분류', '시가총액분류', 'marketcap', 'marketcapclass', 'capstyle'].map(normalizeDisplayKey).includes(normalized)) {
    return 'marketCapClass';
  }

  if (['변동성', 'volatility', 'volatilitylevel'].map(normalizeDisplayKey).includes(normalized)) {
    return 'volatility';
  }

  if (['과세구분', 'taxstatus', 'taxtreatment', 'taxable'].map(normalizeDisplayKey).includes(normalized)) {
    return 'taxStatus';
  }

  if (['비교지수', '벤치마크', 'benchmark', 'referenceindex'].map(normalizeDisplayKey).includes(normalized)) {
    return 'benchmark';
  }

  return null;
}

function formatFieldLabel(label, language = 'ko') {
  const key = resolveFieldLabelKey(label);
  if (!key) {
    return normalizePortfolioVocabulary(label);
  }

  return textFor(language).fieldLabels[key] ?? label;
}

const CORE_ATOM_INFO_FIELDS = [
  { key: 'region', label: '투자 지역' },
  { key: 'sector', label: '분야' },
  { key: 'style', label: '투자 스타일' },
  { key: 'risk', label: '위험 등급' },
];

const PENDING_ATOM_INFO_VALUES = new Set(['확인중', 'checking']);
const HIDDEN_ATOM_INFO_FIELD_KEYS = new Set(['assetClass']);
const HIDDEN_ATOM_INFO_FIELD_LABELS = [
  '날짜',
  '일자',
  'date',
  'day',
  '전일대비',
  '전일 대비',
  'previousChange',
  'changeAmount',
  '시세시각',
  '시세 시각',
  'marketUpdatedAt',
  'quoteTime',
  '시세출처',
  '시세 출처',
  'marketSource',
  'quoteSource',
  '자산군',
  '자산 구분',
  '자산구분',
  '자산 유형',
  'assetClass',
  'assetType',
].map(normalizeDisplayKey);

function atomInfoFallbackValue(language = 'ko') {
  return language === 'en' ? 'Checking' : '확인 중';
}

function isPendingAtomInfoValue(value) {
  return PENDING_ATOM_INFO_VALUES.has(normalizeDisplayKey(value));
}

function buildAtomInfoFields(atom, language = 'ko') {
  if (!atom) {
    return [];
  }

  const fields = Array.isArray(atom.fields) ? atom.fields : [];
  const inferredAtom = enrichPortfolioItem(atom);
  const resolvedFields = [];
  const seenKeys = new Set();
  const seenLabels = new Set();
  const fallbackValue = atomInfoFallbackValue(language);

  const pushField = (label, value) => {
    const trimmedLabel = normalizePortfolioVocabulary(label).trim();
    const trimmedValue = String(value ?? '').trim();

    if (!trimmedLabel || !trimmedValue) {
      return;
    }

    const resolvedKey = resolveFieldLabelKey(trimmedLabel);
    if (
      HIDDEN_ATOM_INFO_FIELD_KEYS.has(resolvedKey) ||
      HIDDEN_ATOM_INFO_FIELD_LABELS.includes(normalizeDisplayKey(trimmedLabel))
    ) {
      return;
    }

    const dedupeKey = resolvedKey || normalizeDisplayKey(trimmedLabel);
    if (dedupeKey && seenKeys.has(dedupeKey)) {
      return;
    }

    if (seenLabels.has(trimmedLabel)) {
      return;
    }

    if (dedupeKey) {
      seenKeys.add(dedupeKey);
    }
    seenLabels.add(trimmedLabel);
    resolvedFields.push({ label: trimmedLabel, value: trimmedValue });
  };

  CORE_ATOM_INFO_FIELDS.forEach(({ key, label }) => {
    const matchedField = fields.find((field) => resolveFieldLabelKey(field?.label) === key);
    const matchedValue = String(matchedField?.value ?? '').trim();
    const atomValue = String(atom[key] ?? '').trim();
    const inferredValue = String(inferredAtom?.[key] ?? '').trim();

    pushField(
      label,
      (!isPendingAtomInfoValue(matchedValue) && matchedValue) ||
        (!isPendingAtomInfoValue(atomValue) && atomValue) ||
        (!isPendingAtomInfoValue(inferredValue) && inferredValue) ||
        fallbackValue,
    );
  });

  fields.forEach((field) => {
    pushField(field?.label, field?.value);
  });

  return resolvedFields;
}

function hashString(value) {
  return Array.from(String(value ?? '')).reduce(
    (accumulator, character) => accumulator * 31 + character.charCodeAt(0),
    7,
  );
}

function createContributionPreview(items) {
  const columns = 4;
  const rows = 4;
  const total = columns * rows;
  const baseSeed = items.reduce(
    (accumulator, item, index) =>
      accumulator + hashString(item.label) * (index + 1) + hashString(item.detail),
    17,
  );

  const cells = Array.from({ length: total }, (_, index) => {
    const signal = noise(baseSeed + index * 19);
    const intensitySignal = noise(baseSeed + 401 + index * 13);
    const positive = signal > 0.42;
    const hasData = signal > 0.22;
    return {
      key: `contribution-${index}`,
      hasData,
      positive: hasData ? positive : false,
      intensity: hasData ? 0.22 + intensitySignal * 0.78 : 0,
    };
  });

  return { cells, columns, rows };
}

const META_VALUE_TRANSLATIONS = {
  en: {
    미국: 'US',
    한국: 'Korea',
    글로벌: 'Global',
    선진국: 'Developed Markets',
    일본: 'Japan',
    홍콩: 'Hong Kong',
    캐나다: 'Canada',
    고위험: 'High Risk',
    중위험: 'Medium Risk',
    저위험: 'Low Risk',
    성장주: 'Growth',
    가치주: 'Value',
    배당주: 'Dividend',
    방어형: 'Defensive',
    분산형: 'Diversified',
    개별주식: 'Single Stock',
    '주식 ETF': 'Equity ETF',
    '채권 ETF': 'Bond ETF',
    '원자재 ETF': 'Commodity ETF',
    기술: 'Technology',
    '인터넷 플랫폼': 'Internet Platform',
    반도체: 'Semiconductors',
    '반도체/전자': 'Semiconductors / Electronics',
    '철강/소재': 'Steel / Materials',
    자동차: 'Automobiles',
    배터리: 'Batteries',
    금융: 'Financials',
    바이오: 'Biotech',
    '방산/산업재': 'Aerospace / Industrials',
    '플랫폼/소비재': 'Platform / Consumer',
    전기차: 'EV',
    복합금융: 'Diversified Financials',
    필수소비재: 'Consumer Staples',
    에너지: 'Energy',
    '대형 기술주': 'Large-Cap Tech',
    '광범위 시장': 'Broad Market',
    '국제 주식': 'International Equities',
    채권: 'Bonds',
    원자재: 'Commodities',
    금: 'Gold',
    부동산: 'Real Estate',
    '전세계 주식': 'Global Equities',
    '배당 ETF': 'Dividend ETF',
    '국내 주식': 'Korean Stocks',
    '미국 주식': 'US Stocks',
    '해외 주식': 'International Stocks',
    '국내 주식 ETF': 'Korean Equity ETF',
    '미국 주식 ETF': 'US Equity ETF',
    '글로벌 주식 ETF': 'Global Equity ETF',
    '금/원자재 ETF': 'Gold / Commodity ETF',
    '리츠/부동산': 'REIT / Real Estate',
    '현금성 자산': 'Cash & Cash Equivalents',
    '디지털 자산': 'Digital Assets',
    대체자산: 'Alternative Assets',
    '기타 자산': 'Other Assets',
    미분류: 'Unclassified',
  },
  ko: {
    us: '미국',
    unitedstates: '미국',
    america: '미국',
    korea: '한국',
    southkorea: '한국',
    global: '글로벌',
    developedmarkets: '선진국',
    japan: '일본',
    hongkong: '홍콩',
    canada: '캐나다',
    highrisk: '고위험',
    mediumrisk: '중위험',
    lowrisk: '저위험',
    growth: '성장주',
    value: '가치주',
    dividend: '배당주',
    defensive: '방어형',
    diversified: '분산형',
    singlestock: '개별주식',
    equityetf: '주식 ETF',
    bondetf: '채권 ETF',
    commodityetf: '원자재 ETF',
    technology: '기술',
    internetplatform: '인터넷 플랫폼',
    semiconductors: '반도체',
    semiconductorselectronics: '반도체/전자',
    steelmaterials: '철강/소재',
    automobiles: '자동차',
    batteries: '배터리',
    financials: '금융',
    biotech: '바이오',
    aerospaceindustrials: '방산/산업재',
    platformconsumer: '플랫폼/소비재',
    ev: '전기차',
    diversifiedfinancials: '복합금융',
    consumerstaples: '필수소비재',
    energy: '에너지',
    largecaptech: '대형 기술주',
    broadmarket: '광범위 시장',
    internationalequities: '국제 주식',
    bonds: '채권',
    commodities: '원자재',
    gold: '금',
    realestate: '부동산',
    globalequities: '전세계 주식',
    dividendetf: '배당 ETF',
    koreanstocks: '국내 주식',
    domesticstocks: '국내 주식',
    usstocks: '미국 주식',
    internationalstocks: '해외 주식',
    koreanequityetf: '국내 주식 ETF',
    domesticequityetf: '국내 주식 ETF',
    usequityetf: '미국 주식 ETF',
    globalequityetf: '글로벌 주식 ETF',
    goldcommodityetf: '금/원자재 ETF',
    reitrealestate: '리츠/부동산',
    cashcashequivalents: '현금성 자산',
    digitalassets: '디지털 자산',
    alternativeassets: '대체자산',
    otherassets: '기타 자산',
    unclassified: '미분류',
    shares: '주',
    sh: '주',
  },
};

function translateDisplayValue(value, language = 'ko') {
  const trimmed = String(value ?? '').trim();

  if (!trimmed) {
    return value;
  }

  if (language === 'en') {
    const sharesMatch = trimmed.match(/^([0-9]+(?:\.[0-9]+)?)\s*주$/);
    if (sharesMatch) {
      return `${sharesMatch[1]} sh`;
    }
  }

  if (language === 'ko') {
    const sharesMatch = trimmed.match(/^([0-9]+(?:\.[0-9]+)?)\s*(?:shares?|sh)$/i);
    if (sharesMatch) {
      return `${sharesMatch[1]}주`;
    }
  }

  const normalized = normalizeDisplayKey(trimmed);
  return META_VALUE_TRANSLATIONS[language]?.[normalized] ?? META_VALUE_TRANSLATIONS[language]?.[trimmed] ?? value;
}

function normalizeMetaValue(value, max = 22) {
  return compactLabel(value.trim(), max);
}

function countCharacter(value, character) {
  return value.split(character).length - 1;
}

function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).find((line) => line.trim()) ?? '';
  const candidates = [',', '\t', ';', '|'];

  return candidates.reduce((best, candidate) =>
    countCharacter(sample, candidate) > countCharacter(sample, best) ? candidate : best,
  );
}

function parseSeparatedText(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (character === '"') {
      const next = text[index + 1];

      if (quoted && next === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (character === delimiter && !quoted) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') {
        index += 1;
      }

      row.push(cell);
      if (row.some((entry) => entry.trim())) {
        rows.push(row);
      }
      row = [];
      cell = '';
      continue;
    }

    cell += character;
  }

  row.push(cell);
  if (row.some((entry) => entry.trim())) {
    rows.push(row);
  }

  return rows;
}

function looksLikeHeader(row) {
  return row
    .map((cell) => normalizeHeader(cell))
    .some((cell) => HEADER_KEYWORDS.some((keyword) => cell.includes(keyword)));
}

function looksLikeRecognizedHeaderCell(value) {
  const trimmed = String(value ?? '').trim();

  if (!trimmed) {
    return false;
  }

  if (isPlaceholderHeaderLabel(trimmed) || resolveFieldLabelKey(trimmed)) {
    return true;
  }

  const normalized = normalizeHeader(trimmed);
  return HEADER_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function looksLikeExplicitHeaderRow(row) {
  const values = row.map((cell) => String(cell ?? '').trim()).filter(Boolean);

  if (values.length < 2) {
    return false;
  }

  return matchRatio(values, looksLikeRecognizedHeaderCell) >= 0.45;
}

function isPlaceholderHeaderLabel(label) {
  const normalized = String(label ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\ufeff/, '')
    .replace(/[\s_.\-/%()[\]:]+/g, '');

  if (!normalized) {
    return true;
  }

  return /^(?:column|col|field|header|value|item|attribute|unnamed|untitled)(?:[a-z]+)?\d*$/i.test(normalized);
}

function looksLikePlaceholderHeaderRow(row) {
  const values = row.map((cell) => String(cell ?? '').trim()).filter(Boolean);

  if (values.length < 2) {
    return false;
  }

  return matchRatio(values, isPlaceholderHeaderLabel) >= 0.6;
}

function pickColumnIndex(headers, candidates) {
  return headers.findIndex((header) =>
    candidates.some((candidate) => header.includes(candidate)),
  );
}

function pickResolvedFieldIndex(fieldKeys, fallbackHeaders, key, candidates = []) {
  const resolvedIndex = fieldKeys.findIndex((fieldKey) => fieldKey === key);

  if (resolvedIndex >= 0) {
    return resolvedIndex;
  }

  return pickColumnIndex(fallbackHeaders, candidates);
}

const KNOWN_CURRENCY_CODES = new Set(['USD', 'KRW', 'EUR', 'JPY', 'CNY', 'HKD', 'GBP', 'CAD', 'AUD', 'CHF']);
const NON_STOCK_LABEL_FIELD_KEYS = new Set([
  'accountId',
  'accountType',
  'buyDate',
  'buyPrice',
  'shares',
  'return',
  'region',
  'sector',
  'style',
  'risk',
  'assetClass',
  'currency',
  'marketCapClass',
  'volatility',
  'taxStatus',
  'benchmark',
]);
const ACCOUNT_TYPE_PATTERN =
  /^(isa|irp|ira|cma|cma-rp|mmf|rp|연금|연금저축|퇴직연금|개인연금|중개형isa|일반계좌|종합계좌|증권계좌|해외주식|국내주식|계좌)$/i;
const ACCOUNT_ID_PATTERN = /^[A-Z]{1,3}\d{5,12}$/i;
const TRADE_META_PATTERN =
  /^(buy|sell|nasdaq|nyse|arca|bats|iex|smart|mkt|lmt|stop|stp|market|limit|day|gtc|ioc|fok|open|close|o|c|a)$/i;
const SECURITY_BRAND_HINT_PATTERN =
  /(tiger|kodex|arirang|ace|kbstar|hanaro|kosef|sol|rise|plus|timefolio|spdr|ishares|vanguard|invesco|schwab|etf|etn|fund|trust)/i;
const COMPANY_NAME_HINT_PATTERN =
  /(inc|corp|corporation|co\.?|company|ltd|limited|plc|holdings?|group|pharma|therapeutics|bank|energy|systems|technologies|motors?|semiconductor|전자|화학|금융|은행|제약|바이오|홀딩스?|건설|증권|통신|식품|에너지|반도체)/i;
const GENERIC_META_EXACT_PATTERN =
  /^(high|medium|low|taxable|stock|stocks|equity|equities|etf|fund|bond|bonds|reit|cash|commodity|crypto|growth|value|dividend|defensive|blend|income|quality|momentum|미국|한국|국내|해외|글로벌|선진국(?:가)?|신흥국(?:가)?|유럽|일본|중국|홍콩|캐나다|기술|반도체|금융|에너지|바이오|헬스|소재|자동차|배터리|인터넷|플랫폼|부동산|소비재|산업재|주식|채권|리츠|원자재|펀드|현금|성장주|가치주|배당주|방어형|분산형|고위험|중위험|저위험|대형주|중형주|소형주|large\\s*cap|mid\\s*cap|small\\s*cap|mega\\s*cap|developed(?:\\s*markets?)?|emerging(?:\\s*markets?)?|europe|japan|china|hong\\s*kong|canada|technology|semiconductor|financials?|energy|biotech|health|materials?|automobile|battery|internet|platform|real\\s*estate|consumer|industrial)$/i;
const GENERIC_META_TOKEN_PATTERN =
  /(지역|국가|시장|분야|업종|산업|섹터|스타일|전략|팩터|위험|등급|변동성|자산군|자산구분|규모|시가총액|country|region|market|sector|industry|style|strategy|factor|risk|grade|volatility|asset\\s*class|asset\\s*type|market\\s*cap|cap\\s*class)/i;
const SECURITY_NAME_HINT_PATTERN =
  /(tiger|kodex|arirang|ace|kbstar|hanaro|kosef|sol|rise|plus|timefolio|spdr|ishares|vanguard|invesco|schwab|s&p|nasdaq|dow|russell|msci|kospi|kosdaq|etf|etn|fund|trust|tiger|kodex|미국|글로벌|반도체|배당|테크|성장|채권|금리|리츠|부동산)/i;

function matchRatio(values, predicate) {
  if (!values.length) {
    return 0;
  }

  const matched = values.filter((value) => predicate(value)).length;
  return matched / values.length;
}

function distinctValueCount(values, normalize = normalizeDisplayKey) {
  return new Set(values.map((value) => normalize(value)).filter(Boolean)).size;
}

function formatAtomDateLabel(value) {
  const trimmed = String(value ?? '').trim();

  if (!trimmed) {
    return '';
  }

  const normalized = trimmed.replace(/\s+/, ' ');
  const isoDateTimeMatch = normalized.match(
    /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s]\d{1,2}:\d{2}(?::\d{2})?)?/,
  );
  if (isoDateTimeMatch) {
    const [, year, month, day] = isoDateTimeMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const isoDateMatch = trimmed.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (isoDateMatch) {
    const [, year, month, day] = isoDateMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const compactMatch = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactMatch) {
    const [, year, month, day] = compactMatch;
    return `${year}-${month}-${day}`;
  }

  const shortDateMatch = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[T\s]\d{1,2}:\d{2}(?::\d{2})?)?/);
  if (shortDateMatch) {
    const [, month, day, year] = shortDateMatch;
    const fullYear = year.length === 2 ? `20${year}` : year;
    return `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  return trimmed;
}

function isTickerLikeValue(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return false;
  }

  if (KNOWN_CURRENCY_CODES.has(trimmed.toUpperCase())) {
    return false;
  }

  if (/^\d{8}$/.test(trimmed) && isDateLikeValue(trimmed)) {
    return false;
  }

  return /^([A-Z]{1,5}(?:\.[A-Z])?|[A-Z]{1,6}|[0-9]{4,8})$/.test(trimmed);
}

function isDateLikeValue(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return false;
  }

  if (/^\d{8}$/.test(trimmed)) {
    const year = Number.parseInt(trimmed.slice(0, 4), 10);
    const month = Number.parseInt(trimmed.slice(4, 6), 10) - 1;
    const day = Number.parseInt(trimmed.slice(6, 8), 10);
    const date = new Date(year, month, day);
    return Number.isFinite(date.getTime());
  }

  if (
    /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:[T\s]\d{1,2}:\d{2}(?::\d{2})?)?$/.test(trimmed) ||
    /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}(?:[T\s]\d{1,2}:\d{2}(?::\d{2})?)?$/.test(trimmed)
  ) {
    const date = new Date(trimmed.replace(/\./g, '-').replace(/^(\d{4}-\d{1,2}-\d{1,2})\s+/, '$1T'));
    return Number.isFinite(date.getTime());
  }

  return false;
}

function isNumericLikeValue(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return false;
  }

  const numeric = Number.parseFloat(trimmed.replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(numeric);
}

function isShareLikeValue(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return false;
  }

  if (!/^\d+(?:\.\d+)?(?:\s*(?:주|shares?|sh))?$/i.test(trimmed)) {
    return false;
  }

  return Number.parseFloat(trimmed.replace(/[^0-9.+-]/g, '')) > 0;
}

function isPriceLikeValue(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return false;
  }

  if (!isNumericLikeValue(trimmed)) {
    return false;
  }

  return /[$₩€¥]|krw|usd|eur|jpy|원|달러/i.test(trimmed) || Number.parseFloat(trimmed.replace(/[^0-9.+-]/g, '')) >= 1;
}

function isAccountTypeValue(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return false;
  }

  if (ACCOUNT_ID_PATTERN.test(trimmed)) {
    return true;
  }

  if (ACCOUNT_TYPE_PATTERN.test(trimmed)) {
    return true;
  }

  return /(account|brokerage|pension|retirement|taxable|deferred|절세계좌|퇴직|연금|계좌)/i.test(trimmed);
}

function hasSecurityNameContext(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return false;
  }

  return (
    isTickerLikeValue(trimmed) ||
    SECURITY_BRAND_HINT_PATTERN.test(trimmed) ||
    COMPANY_NAME_HINT_PATTERN.test(trimmed)
  );
}

function isGenericMetaValue(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return false;
  }

  if (GENERIC_META_EXACT_PATTERN.test(trimmed)) {
    return true;
  }

  if (hasSecurityNameContext(trimmed)) {
    return false;
  }

  return GENERIC_META_TOKEN_PATTERN.test(trimmed);
}

function isLikelySecurityName(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed || isAccountTypeValue(trimmed)) {
    return false;
  }

  if (TRADE_META_PATTERN.test(trimmed)) {
    return false;
  }

  if (isGenericMetaValue(trimmed)) {
    return false;
  }

  if (looksLikeFreeTextName(trimmed)) {
    return true;
  }

  if (isTickerLikeValue(trimmed)) {
    return true;
  }

  return SECURITY_NAME_HINT_PATTERN.test(trimmed);
}

function looksLikeFreeTextName(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return false;
  }

  if (
    isTickerLikeValue(trimmed) ||
    isDateLikeValue(trimmed) ||
    KNOWN_CURRENCY_CODES.has(trimmed.toUpperCase()) ||
    ACCOUNT_ID_PATTERN.test(trimmed) ||
    TRADE_META_PATTERN.test(trimmed)
  ) {
    return false;
  }

  if (/(s&p|nasdaq|dow|russell|msci|kospi|kosdaq|benchmark|index)/i.test(trimmed)) {
    return false;
  }

  if (isGenericMetaValue(trimmed)) {
    return false;
  }

  if (
    /^(stock|stocks|equity|equities|etf|fund|bond|bonds|reit|cash|commodity|crypto|개별주식|주식\s*etf|채권\s*etf|채권|리츠|현금성\s*자산|원자재|디지털\s*자산)$/i.test(
      trimmed,
    )
  ) {
    return false;
  }

  return /[a-z]/i.test(trimmed) || /[가-힣]/.test(trimmed);
}

function findBestSecurityNameColumnIndex(headerLabels, fieldKeys, bodyRows) {
  const columnCount = Math.max(headerLabels.length, ...bodyRows.map((row) => row.length));
  const columns = Array.from({ length: columnCount }, (_, columnIndex) => {
    const values = bodyRows
      .map((row) => String(row[columnIndex] ?? '').trim())
      .filter(Boolean);

    return {
      columnIndex,
      values,
      headerLabel: headerLabels[columnIndex] ?? `Column ${columnIndex + 1}`,
      fieldKey: fieldKeys[columnIndex] ?? resolveFieldLabelKey(headerLabels[columnIndex] ?? ''),
    };
  }).filter(({ values }) => values.length > 0);

  const bestColumn = columns
    .map((column) => ({
      ...column,
      score: scoreSecurityNameColumn(column.headerLabel, column.fieldKey, column.values),
    }))
    .sort((left, right) => right.score - left.score)[0];

  return bestColumn && bestColumn.score >= 0.5 ? bestColumn.columnIndex : -1;
}

function inferHeaderLabels(headerLabels, bodyRows) {
  const labels = [...headerLabels];
  const columnCount = Math.max(labels.length, ...bodyRows.map((row) => row.length));
  const candidateDefinitions = [
    {
      key: 'stockCode',
      label: '종목 티커',
      minScore: 0.72,
      score: (values) => matchRatio(values, isTickerLikeValue),
    },
    {
      key: 'accountType',
      label: '포트폴리오 유형',
      minScore: 0.74,
      score: (values) => matchRatio(values, isAccountTypeValue),
    },
    {
      key: 'buyDate',
      label: '매수일',
      minScore: 0.84,
      score: (values) => matchRatio(values, isDateLikeValue),
    },
    {
      key: 'buyPrice',
      label: '매수가',
      minScore: 0.76,
      score: (values) => matchRatio(values, isPriceLikeValue),
    },
    {
      key: 'shares',
      label: '보유수량',
      minScore: 0.78,
      score: (values) => matchRatio(values, isShareLikeValue),
    },
    {
      key: 'return',
      label: '수익률',
      minScore: 0.72,
      score: (values) =>
        matchRatio(values, (value) => {
          const trimmed = String(value ?? '').trim();
          const parsed = Number.parseFloat(trimmed.replace(/[,%\s]/g, ''));
          if (!Number.isFinite(parsed)) {
            return false;
          }

          return trimmed.includes('%') || /^[+-]/.test(trimmed) || Math.abs(parsed) <= 100;
        }),
    },
    {
      key: 'assetClass',
      label: '자산 구분',
      minScore: 0.72,
      score: (values) =>
        matchRatio(values, (value) =>
          /^(stock|stocks|equity|equities|etf|fund|bond|bonds|reit|cash|commodity|crypto|개별주식|주식\s*etf|채권\s*etf|채권|리츠|현금성\s*자산|원자재|디지털\s*자산)$/i.test(
            String(value ?? '').trim(),
          ),
        ),
    },
    {
      key: 'marketCapClass',
      label: '규모 분류',
      minScore: 0.68,
      score: (values) =>
        matchRatio(values, (value) =>
          /(mega\s*cap|large\s*cap|mid\s*cap|small\s*cap|대형주|중형주|소형주)/i.test(String(value ?? '').trim()),
        ),
    },
    {
      key: 'region',
      label: '투자 지역',
      minScore: 0.72,
      score: (values) =>
        matchRatio(values, (value) =>
          /^(미국|한국|국내|해외|글로벌|일본|중국|홍콩|캐나다|유럽|us|usa|united states|korea|global|international|japan|china|hong kong|canada|europe)$/i.test(
            String(value ?? '').trim(),
          ),
        ),
    },
    {
      key: 'sector',
      label: '분야',
      minScore: 0.68,
      score: (values) =>
        matchRatio(values, (value) =>
          /(기술|반도체|금융|에너지|바이오|헬스|소재|자동차|배터리|인터넷|플랫폼|부동산|소비재|산업재|technology|semiconductor|financial|energy|biotech|health|material|automobile|battery|internet|platform|real estate|consumer|industrial)/i.test(
            String(value ?? '').trim(),
          ),
        ),
    },
    {
      key: 'style',
      label: '투자 스타일',
      minScore: 0.68,
      score: (values) =>
        matchRatio(values, (value) =>
          /^(성장주|가치주|배당주|방어형|분산형|growth|value|dividend|defensive|income|blend|quality|momentum)$/i.test(
            String(value ?? '').trim(),
          ),
        ),
    },
    {
      key: 'currency',
      label: '통화',
      minScore: 0.8,
      score: (values) =>
        matchRatio(values, (value) => KNOWN_CURRENCY_CODES.has(String(value ?? '').trim().toUpperCase())),
    },
    {
      key: 'risk',
      label: '위험 등급',
      minScore: 0.68,
      score: (values) =>
        matchRatio(values, (value) =>
          /^(high|medium|low|aggressive|moderate|conservative|고위험|중위험|저위험)$/i.test(
            String(value ?? '').trim(),
          ),
        ),
    },
    {
      key: 'volatility',
      label: '변동성',
      minScore: 0.68,
      score: (values) =>
        matchRatio(values, (value) =>
          /^(high|medium|low|고변동|중변동|저변동)$/i.test(String(value ?? '').trim()),
        ),
    },
    {
      key: 'taxStatus',
      label: '과세 구분',
      minScore: 0.72,
      score: (values) =>
        matchRatio(values, (value) =>
          /^(taxable|tax[-\s]?deferred|tax[-\s]?exempt|과세|비과세|절세|일반계좌|연금|ira|isa)$/i.test(
            String(value ?? '').trim(),
          ),
        ),
    },
    {
      key: 'benchmark',
      label: '비교 지수',
      minScore: 0.68,
      score: (values) =>
        matchRatio(values, (value) =>
          /(s&p|nasdaq|nyse|dow|russell|msci|kospi|kosdaq|index|지수|benchmark)/i.test(
            String(value ?? '').trim(),
          ),
        ),
    },
  ];

  const scoredMatches = [];

  for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
    const values = bodyRows
      .map((row) => String(row[columnIndex] ?? '').trim())
      .filter(Boolean);

    if (!values.length) {
      continue;
    }

    candidateDefinitions.forEach((candidate) => {
      const score = candidate.score(values);
      if (score >= candidate.minScore) {
        scoredMatches.push({
          columnIndex,
          key: candidate.key,
          label: candidate.label,
          score,
        });
      }
    });
  }

  scoredMatches
    .sort((left, right) => right.score - left.score)
    .forEach(({ columnIndex, key, label }) => {
      const alreadyAssignedKey = labels.some((currentLabel) => resolveFieldLabelKey(currentLabel) === key);
      if (alreadyAssignedKey) {
        return;
      }

      const currentLabel = labels[columnIndex] ?? '';
      if (!isPlaceholderHeaderLabel(currentLabel)) {
        return;
      }

      labels[columnIndex] = label;
    });

  const inferredNameColumnIndex = Array.from({ length: columnCount }, (_, columnIndex) => {
    const values = bodyRows
      .map((row) => String(row[columnIndex] ?? '').trim())
      .filter(Boolean);

    return {
      columnIndex,
      score: matchRatio(values, isLikelySecurityName),
      values,
    };
  })
    .filter(({ values }) => values.length > 0)
    .sort((left, right) => right.score - left.score)
    .find(({ columnIndex, score }) => {
      const currentLabel = labels[columnIndex] ?? '';
      return isPlaceholderHeaderLabel(currentLabel) && score >= 0.68;
    });

  const hasAssignedStockName = labels.some((currentLabel) => resolveFieldLabelKey(currentLabel) === 'stockName');
  if (inferredNameColumnIndex && !hasAssignedStockName) {
    labels[inferredNameColumnIndex.columnIndex] = '종목명';
  }

  return Array.from({ length: columnCount }, (_, index) => labels[index] || `Column ${index + 1}`);
}

function scoreSecurityNameColumn(headerLabel, fieldKey, values) {
  if (!values.length) {
    return 0;
  }

  const normalizedHeader = normalizeHeader(headerLabel);
  const securityRatio = matchRatio(values, isLikelySecurityName);
  const accountRatio = matchRatio(values, isAccountTypeValue);
  const dateRatio = matchRatio(values, isDateLikeValue);
  const numericRatio = matchRatio(
    values,
    (value) => isNumericLikeValue(value) && !isTickerLikeValue(value),
  );
  const shortNumericRatio = matchRatio(values, (value) => /^\d{1,3}(?:\.\d+)?$/.test(String(value ?? '').trim()));
  const metaValueRatio = matchRatio(
    values,
    (value) => isGenericMetaValue(value),
  );
  let bonus = 0;

  if (fieldKey === 'stockName') {
    bonus += 0.18;
  }

  if (fieldKey === 'stockCode') {
    bonus -= 0.56;
  }

  if (/(assetname|securityname|productname|자산명|상품명)/.test(normalizedHeader)) {
    bonus += 0.24;
  }

  if (/(name|security|company|종목명)/.test(normalizedHeader)) {
    bonus += 0.14;
  }

  if (
    fieldKey === 'accountId' ||
    fieldKey === 'accountType' ||
    /(acctid|accountid|accountnumber|accounttype|accountkind|accountclass|계좌id|계좌번호|계좌유형|계좌종류|계좌)/.test(
      normalizedHeader,
    )
  ) {
    bonus -= 0.9;
  }

  if (
    fieldKey &&
    [
      'accountId',
      'accountType',
      'buyDate',
      'buyPrice',
      'shares',
      'return',
      'region',
      'sector',
      'style',
      'risk',
      'assetClass',
      'currency',
      'marketCapClass',
      'volatility',
      'taxStatus',
      'benchmark',
    ].includes(fieldKey)
  ) {
    bonus -= 0.9;
  }

  if (
    /(date|day|buydate|tradedate|recorddate|valuedate|매수일|날짜|일자|계좌|account|region|country|market|분야|sector|industry|style|risk|assetclass|currency|marketcap|volatility|tax|benchmark|return|performance|change|shares|quantity|buyprice|price)/.test(
      normalizedHeader,
    )
  ) {
    bonus -= 0.82;
  }

  return (
    securityRatio -
    accountRatio * 1.25 -
    dateRatio * 1.1 -
    numericRatio * 0.95 -
    shortNumericRatio * 1.35 -
    metaValueRatio * 1.2 +
    bonus
  );
}

function scoreAccountTypeColumn(headerLabel, fieldKey, values) {
  if (!values.length) {
    return 0;
  }

  const normalizedHeader = normalizeHeader(headerLabel);
  const securityRatio = matchRatio(values, isLikelySecurityName);
  const accountRatio = matchRatio(
    values,
    (value) => isAccountTypeValue(value) && !ACCOUNT_ID_PATTERN.test(String(value ?? '').trim()),
  );
  let bonus = 0;

  if (fieldKey === 'accountType') {
    bonus += 0.24;
  }

  if (/(accounttype|accountkind|accountclass|계좌유형|계좌종류|계좌)/.test(normalizedHeader)) {
    bonus += 0.28;
  }

  if (fieldKey === 'stockName' && accountRatio >= 0.7) {
    bonus += 0.18;
  }

  return accountRatio - securityRatio * 1.15 + bonus;
}

function scoreAccountIdColumn(headerLabel, fieldKey, values) {
  if (!values.length) {
    return 0;
  }

  const normalizedHeader = normalizeHeader(headerLabel);
  const idRatio = matchRatio(values, (value) => ACCOUNT_ID_PATTERN.test(String(value ?? '').trim()));
  let bonus = 0;

  if (fieldKey === 'accountId') {
    bonus += 0.28;
  }

  if (/(acctid|accountid|accountnumber|계좌id|계좌번호|계좌코드)/.test(normalizedHeader)) {
    bonus += 0.3;
  }

  if (fieldKey === 'stockName' || fieldKey === 'stockCode') {
    bonus -= 0.4;
  }

  return idRatio + bonus;
}

function normalizePortfolioFieldLabels(headerLabels, bodyRows) {
  const labels = [...headerLabels];
  const columnCount = Math.max(labels.length, ...bodyRows.map((row) => row.length));
  const columns = Array.from({ length: columnCount }, (_, columnIndex) => {
    const values = bodyRows
      .map((row) => String(row[columnIndex] ?? '').trim())
      .filter(Boolean);

    return {
      columnIndex,
      values,
      headerLabel: labels[columnIndex] ?? `Column ${columnIndex + 1}`,
      fieldKey: resolveFieldLabelKey(labels[columnIndex] ?? ''),
    };
  }).filter(({ values }) => values.length > 0);

  const bestSecurityColumn = [...columns]
    .map((column) => ({
      ...column,
      score: scoreSecurityNameColumn(column.headerLabel, column.fieldKey, column.values),
    }))
    .sort((left, right) => right.score - left.score)
    .find((column) => column.score >= 0.5);

  if (bestSecurityColumn) {
    labels[bestSecurityColumn.columnIndex] = '종목명';
  }

  const bestAccountIdColumn = [...columns]
    .filter((column) => column.columnIndex !== bestSecurityColumn?.columnIndex)
    .map((column) => ({
      ...column,
      score: scoreAccountIdColumn(column.headerLabel, column.fieldKey, column.values),
    }))
    .sort((left, right) => right.score - left.score)
    .find((column) => column.score >= 0.78);

  if (bestAccountIdColumn) {
    labels[bestAccountIdColumn.columnIndex] = '포트폴리오 ID';
  }

  const bestAccountColumn = [...columns]
    .filter(
      (column) =>
        column.columnIndex !== bestSecurityColumn?.columnIndex &&
        column.columnIndex !== bestAccountIdColumn?.columnIndex,
    )
    .map((column) => ({
      ...column,
      score: scoreAccountTypeColumn(column.headerLabel, column.fieldKey, column.values),
    }))
    .sort((left, right) => right.score - left.score)
    .find((column) => column.score >= 0.7);

  if (bestAccountColumn) {
    labels[bestAccountColumn.columnIndex] = '포트폴리오 유형';
  }

  return labels;
}

function selectPortfolioLabelStrategy({
  bodyRows,
  headers,
  fieldKeys,
  dateIndex,
  nameIndex,
  tickerIndex,
}) {
  if (dateIndex < 0 || bodyRows.length < 8) {
    return 'security';
  }

  const dateValues = bodyRows
    .map((row) => String(row[dateIndex] ?? '').trim())
    .filter(Boolean);

  if (dateValues.length < 8) {
    return 'security';
  }

  const dateDistinctCount = distinctValueCount(dateValues, formatAtomDateLabel);
  const dateDistinctRatio = dateDistinctCount / dateValues.length;

  if (dateDistinctRatio < 0.45) {
    return 'security';
  }

  const securityIndex = nameIndex >= 0 ? nameIndex : tickerIndex;
  const securityValues =
    securityIndex >= 0
      ? bodyRows
          .map((row) => String(row[securityIndex] ?? '').trim())
          .filter(Boolean)
      : [];
  const securityDistinctCount = securityValues.length
    ? distinctValueCount(securityValues)
    : Number.POSITIVE_INFINITY;
  const hasDailySeriesHeaders = headers.some(
    (header) =>
      header.includes('일일수익률') ||
      header.includes('누적수익률') ||
      header.includes('dailyreturn') ||
      header.includes('cumulativereturn'),
  );
  const hasTimeSeriesMetricHeaders = headers.some(
    (header) =>
      header.includes('초기금액') ||
      header.includes('평가금액') ||
      header.includes('initialamount') ||
      header.includes('marketvalue') ||
      header.includes('valuation'),
  );
  const hasGenericDateHeader =
    fieldKeys[dateIndex] === 'buyDate' ||
    headers[dateIndex]?.includes('날짜') ||
    headers[dateIndex]?.includes('일자') ||
    headers[dateIndex]?.includes('date');

  if (
    hasGenericDateHeader &&
    (hasDailySeriesHeaders || hasTimeSeriesMetricHeaders) &&
    securityDistinctCount <= Math.max(8, Math.round(dateDistinctCount * 0.35)) &&
    dateDistinctCount >= securityDistinctCount * 2
  ) {
    return 'date';
  }

  return 'security';
}

function formatReturnDetail(value, label = '') {
  const trimmed = value.trim();

  if (!trimmed) {
    return '';
  }

  const numeric = Number.parseFloat(trimmed.replace(/[,%\s]/g, ''));
  if (!Number.isFinite(numeric)) {
    return '';
  }

  const explicitPercent =
    /%|pct|percent|return|yield|change|rate|수익률|등락률|변동률|손익률/i.test(String(label ?? '').trim());
  const percentValue =
    explicitPercent || trimmed.includes('%') || Math.abs(numeric) > 1 ? numeric : numeric * 100;
  const fixed = percentValue
    .toFixed(Math.abs(percentValue) >= 10 ? 1 : 2)
    .replace(/(\.\d*?[1-9])0+$/, '$1')
    .replace(/\.0$/, '');
  const sign = percentValue > 0 ? '+' : '';

  return `${sign}${fixed}%`;
}

function parseSignedDisplayValue(value) {
  const trimmed = String(value ?? '').trim().replace(/[−–—]/g, '-');
  if (!trimmed) {
    return null;
  }

  const numeric = Number.parseFloat(trimmed.replace(/[^0-9.+-]/g, ''));
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const shouldNegate = /^\(.*\)$/.test(trimmed) || /(?:손실|loss|▼|↓)/i.test(trimmed);
  return shouldNegate && numeric > 0 ? -numeric : numeric;
}

function getSignedValueToneClass(value, positiveClass = 'is-up', negativeClass = 'is-down') {
  const numeric = parseSignedDisplayValue(value);

  if (numeric > 0) {
    return positiveClass;
  }

  if (numeric < 0) {
    return negativeClass;
  }

  return '';
}

function parseManualPriceValue(value) {
  const match = String(value ?? '')
    .replace(/,/g, '')
    .match(/[+-]?\d*\.?\d+/);
  const numeric = Number.parseFloat(match?.[0] ?? '');

  return Number.isFinite(numeric) ? numeric : NaN;
}

function calculateReturnRateFromBuyPrice(buyPriceValue, latestPrice) {
  const buyPrice = parseManualPriceValue(buyPriceValue);
  const currentPrice = Number(latestPrice);

  if (!Number.isFinite(buyPrice) || buyPrice <= 0 || !Number.isFinite(currentPrice)) {
    return '';
  }

  return formatMarketChangePercent(((currentPrice - buyPrice) / buyPrice) * 100);
}

function countReplacementCharacters(text) {
  return (text.match(/\uFFFD/g) ?? []).length;
}

async function readPortfolioFile(file) {
  const buffer = await file.arrayBuffer();
  const decoders = ['utf-8', 'euc-kr'];
  let bestText = '';
  let bestScore = Number.POSITIVE_INFINITY;

  for (const encoding of decoders) {
    try {
      const text = new TextDecoder(encoding).decode(buffer);
      const score = countReplacementCharacters(text);

      if (score < bestScore) {
        bestText = text;
        bestScore = score;
      }
    } catch {
      continue;
    }
  }

  return bestText;
}

async function ingestPortfolioTextViaApi(fileName, text) {
  const response = await fetch('/api/portfolio/ingest', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fileName,
      text,
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      payload && typeof payload.error === 'string' ? payload.error : 'Portfolio ingestion failed.',
    );
  }

  return payload;
}

async function enrichSecurityItemsViaApi(items, options = {}) {
  const response = await fetch('/api/securities/enrich', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      items,
      force: Boolean(options.force),
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      payload && typeof payload.error === 'string' ? payload.error : 'Security enrichment failed.',
    );
  }

  return payload;
}

const STRONG_METADATA_SOURCES = new Set(['provided', 'reference', 'wikidata', 'yahoo']);

function hasMissingCoreMetadata(item) {
  return ['region', 'sector', 'style', 'risk'].some((field) => {
    const value = String(item?.[field] ?? '').trim();
    const source = String(
      item?.metadataSourceByField?.[field] ?? item?.metadataSource ?? 'raw',
    )
      .trim()
      .toLowerCase();

    return !value || !STRONG_METADATA_SOURCES.has(source);
  });
}

function hasMissingLiveQuote(item) {
  const latestPrice = Number(item?.latestPrice);

  return (
    !String(item?.marketPrice ?? '').trim() &&
    !(Number.isFinite(latestPrice) && latestPrice > 0)
  );
}

function metadataMergeKey(item) {
  return [
    item?.code,
    item?.ticker,
    item?.name,
    item?.companyName,
    item?.label,
  ]
    .map((value) => normalizeDisplayKey(value))
    .find(Boolean) ?? '';
}

function mergeSecurityMetadataItems(baseItems, enrichedItems) {
  if (!Array.isArray(baseItems) || !Array.isArray(enrichedItems) || !enrichedItems.length) {
    return baseItems;
  }

  const enrichedByKey = new Map();
  enrichedItems.forEach((item, index) => {
    const key = metadataMergeKey(item) || `index:${index}`;
    if (!enrichedByKey.has(key)) {
      enrichedByKey.set(key, item);
    }
  });

  return baseItems.map((item, index) => {
    const key = metadataMergeKey(item) || `index:${index}`;
    return mergeSecurityMetadataItem(item, enrichedByKey.get(key) ?? enrichedItems[index]);
  });
}

const LIVE_QUOTE_ITEM_KEYS = [
  'marketPrice',
  'marketCurrency',
  'currency',
  'marketUpdatedAt',
  'marketSource',
  'quoteSource',
  'latestPrice',
  'marketChange',
  'marketChangePercent',
];
const LIVE_QUOTE_FIELD_LABELS = new Set(
  ['현재가', '전일대비', '등락률', '통화', '시세시각', '시세출처'].map(normalizeDisplayKey),
);

function mergeSecurityMetadataFields(currentFields, enrichedFields, keepLiveQuoteFields) {
  const nextFields = Array.isArray(currentFields) ? [...currentFields] : [];

  for (const field of enrichedFields ?? []) {
    const label = String(field?.label ?? '').trim();
    const value = String(field?.value ?? '').trim();

    if (!label || !value) {
      continue;
    }

    const normalizedLabel = normalizeDisplayKey(label);
    const existingIndex = nextFields.findIndex(
      (currentField) => normalizeDisplayKey(currentField?.label) === normalizedLabel,
    );

    if (existingIndex >= 0) {
      if (keepLiveQuoteFields && LIVE_QUOTE_FIELD_LABELS.has(normalizedLabel)) {
        continue;
      }

      nextFields[existingIndex] = { label, value };
    } else {
      nextFields.push({ label, value });
    }
  }

  return nextFields;
}

function mergeSecurityMetadataItem(currentItem, enrichedItem) {
  if (!enrichedItem) {
    return currentItem;
  }

  const keepLiveQuoteFields = Boolean(
    currentItem?.marketSource || currentItem?.quoteSource || Number.isFinite(currentItem?.latestPrice),
  );
  const nextItem = {
    ...currentItem,
    ...enrichedItem,
    fields: mergeSecurityMetadataFields(currentItem?.fields, enrichedItem?.fields, keepLiveQuoteFields),
    metadataSourceByField: {
      ...(currentItem?.metadataSourceByField ?? {}),
      ...(enrichedItem?.metadataSourceByField ?? {}),
    },
  };

  if (keepLiveQuoteFields) {
    for (const key of LIVE_QUOTE_ITEM_KEYS) {
      if (currentItem?.[key] !== undefined && currentItem?.[key] !== null && currentItem?.[key] !== '') {
        nextItem[key] = currentItem[key];
      }
    }
  }

  return nextItem;
}

function normalizeQuoteFieldValue(value) {
  return String(value ?? '').trim();
}

function upsertQuoteField(fields, label, value) {
  const cleanValue = normalizeQuoteFieldValue(value);

  if (!cleanValue) {
    return Array.isArray(fields) ? fields : [];
  }

  const nextFields = Array.isArray(fields) ? [...fields] : [];
  const targetKey = resolveFieldLabelKey(label) || normalizeDisplayKey(label);
  const index = nextFields.findIndex((field) => {
    const fieldKey = resolveFieldLabelKey(field?.label) || normalizeDisplayKey(field?.label);
    return fieldKey === targetKey;
  });
  const nextField = { label, value: cleanValue };

  if (index >= 0) {
    nextFields[index] = nextField;
  } else {
    nextFields.push(nextField);
  }

  return nextFields;
}

function applyLiveQuoteToPortfolioItem(item, quote) {
  if (!quote || !Number.isFinite(quote.latestPrice)) {
    return item;
  }

  const displayName = resolveMarketDisplayName(quote) || item?.stockName || item?.name || item?.label;
  const symbol = String(quote.symbol ?? item?.ticker ?? item?.stockCode ?? item?.code ?? '').trim();
  const marketPrice = formatMarketPrice(quote.latestPrice, quote.currency);
  const marketUpdatedAt = formatMarketTime(quote.updatedAt, 'ko');
  let fields = Array.isArray(item?.fields) ? [...item.fields] : [];

  fields = upsertQuoteField(fields, '종목 티커', symbol);
  fields = upsertQuoteField(fields, '종목명', displayName);
  fields = upsertQuoteField(fields, '현재가', marketPrice);
  fields = upsertQuoteField(fields, '전일대비', formatMarketChange(quote.change));
  fields = upsertQuoteField(fields, '등락률', formatMarketChangePercent(quote.changePercent));
  fields = upsertQuoteField(fields, '통화', quote.currency || 'KRW');
  fields = upsertQuoteField(fields, '시세시각', marketUpdatedAt);
  fields = upsertQuoteField(fields, '시세출처', quote.source);
  fields = upsertQuoteField(fields, '상장 시장', quote.exchangeName);

  return {
    ...item,
    label: displayName || item.label,
    name: displayName || item.name,
    companyName: displayName || item.companyName,
    stockName: displayName || item.stockName,
    stockCode: symbol || item.stockCode,
    ticker: symbol || item.ticker,
    code: symbol || item.code,
    marketPrice,
    marketCurrency: quote.currency || item.marketCurrency || 'KRW',
    currency: quote.currency || item.currency || 'KRW',
    marketUpdatedAt,
    marketSource: quote.source,
    quoteSource: quote.source,
    latestPrice: quote.latestPrice,
    marketChange: quote.change,
    marketChangePercent: quote.changePercent,
    fields,
    metadataSourceByField: {
      ...(item.metadataSourceByField ?? {}),
      stockName: 'live-market',
      stockCode: 'live-market',
      ticker: 'live-market',
      marketPrice: 'live-market',
      currency: 'live-market',
    },
  };
}

function liveQuoteLookupForItem(item) {
  const rawTicker =
    String(item?.ticker ?? item?.stockCode ?? item?.code ?? '').trim() ||
    getItemFieldValue(item, ['종목 티커', '종목코드', '티커', 'ticker', 'stockCode', 'code']);
  const name =
    String(item?.stockName ?? item?.name ?? item?.companyName ?? item?.label ?? '').trim() ||
    getItemFieldValue(item, ['종목명', 'stockName', 'name']);
  const exactTicker = resolveExactSecurityReferenceCode([rawTicker, name]);
  const ticker = exactTicker || rawTicker;

  return { ticker, name, key: normalizeDisplayKey(ticker || name) };
}

function normalizeMarketSymbolBase(value) {
  return normalizeDisplayKey(String(value ?? '').replace(/\.(KS|KQ|TO|V|T|HK|SS|SZ|DU|L)$/i, ''));
}

function liveQuoteMatchesLookup(quote, lookup) {
  const requestedTicker = normalizeMarketSymbolBase(lookup?.ticker);
  if (!requestedTicker) {
    const requestedName = normalizeDisplayKey(lookup?.name);

    if (!requestedName) {
      return true;
    }

    const exactTicker = normalizeMarketSymbolBase(resolveExactSecurityReferenceCode([lookup?.name]));
    const returnedSymbol = normalizeMarketSymbolBase(quote?.symbol);

    if (exactTicker) {
      return returnedSymbol === exactTicker;
    }

    const quoteIdentifiers = [
      quote?.symbol,
      quote?.name,
      quote?.displayName,
      quote?.rawName,
    ]
      .map(normalizeDisplayKey)
      .filter(Boolean);

    return quoteIdentifiers.some(
      (identifier) =>
        identifier === requestedName ||
        (identifier.length >= 4 && requestedName.includes(identifier)) ||
        (requestedName.length >= 4 && identifier.includes(requestedName)),
    );
  }

  const returnedSymbol = normalizeMarketSymbolBase(quote?.symbol);
  return returnedSymbol === requestedTicker;
}

async function enrichPortfolioItemsWithLiveQuotes(items) {
  if (!Array.isArray(items) || !items.length) {
    return items;
  }

  const lookups = [];
  const seen = new Set();

  items.forEach((item) => {
    const lookup = liveQuoteLookupForItem(item);
    if (!lookup.key || seen.has(lookup.key)) {
      return;
    }

    seen.add(lookup.key);
    lookups.push(lookup);
  });

  const quoteByKey = new Map();

  for (const lookup of lookups.slice(0, 80)) {
    try {
      const quote = await fetchLiveMarketData({
        ticker: lookup.ticker,
        name: lookup.name,
      });
      if (liveQuoteMatchesLookup(quote, lookup)) {
        quoteByKey.set(lookup.key, quote);
      }
    } catch {
      // Leave the uploaded value as-is when every live provider fails.
    }
  }

  return items.map((item) => {
    const lookup = liveQuoteLookupForItem(item);
    return quoteByKey.has(lookup.key) ? applyLiveQuoteToPortfolioItem(item, quoteByKey.get(lookup.key)) : item;
  });
}

function mergePortfolioItemUpdates(baseItems, updatedItems) {
  if (!Array.isArray(baseItems) || !Array.isArray(updatedItems) || !updatedItems.length) {
    return baseItems;
  }

  return baseItems.map((item, index) => updatedItems[index] ?? item);
}

function midpoint(a, b) {
  return {
    x: (a.x + b.x) * 0.5,
    y: (a.y + b.y) * 0.5,
  };
}

function closedSketchPath(points) {
  const firstMid = midpoint(points[points.length - 1], points[0]);
  let path = `M ${format(firstMid.x)} ${format(firstMid.y)}`;

  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    const currentMid = midpoint(points[index], next);
    path += ` Q ${format(points[index].x)} ${format(points[index].y)} ${format(
      currentMid.x,
    )} ${format(currentMid.y)}`;
  }

  return path;
}

function openSketchPath(points) {
  if (points.length < 2) {
    return '';
  }

  let path = `M ${format(points[0].x)} ${format(points[0].y)}`;

  for (let index = 1; index < points.length - 1; index += 1) {
    const currentMid = midpoint(points[index], points[index + 1]);
    path += ` Q ${format(points[index].x)} ${format(points[index].y)} ${format(
      currentMid.x,
    )} ${format(currentMid.y)}`;
  }

  const last = points[points.length - 1];
  path += ` L ${format(last.x)} ${format(last.y)}`;
  return path;
}

function buildAllocationArcPath({
  centerX,
  centerY,
  radius,
  startAngle,
  endAngle,
  seed,
  wobble = 2.4,
}) {
  const span = endAngle - startAngle;

  if (span <= 0.02) {
    return '';
  }

  const steps = Math.max(8, Math.ceil(span / (Math.PI / 18)));
  const points = [];

  for (let index = 0; index <= steps; index += 1) {
    const progress = index / steps;
    const angle = startAngle + span * progress;
    const radialOffset =
      Math.sin(seed * 0.031 + progress * Math.PI * 4.2) * wobble * 0.34 +
      jitter(seed + index * 3.17, wobble * 0.24);
    const tangentOffset = jitter(seed + 200 + index * 2.41, wobble * 0.16);
    const localRadius = radius + radialOffset;

    points.push({
      x:
        centerX +
        Math.cos(angle) * localRadius +
        Math.cos(angle + Math.PI / 2) * tangentOffset,
      y:
        centerY +
        Math.sin(angle) * localRadius +
        Math.sin(angle + Math.PI / 2) * tangentOffset,
    });
  }

  return openSketchPath(points);
}

function buildLoopPath(radius, seed) {
  const points = [];

  for (let index = 0; index < 10; index += 1) {
    const angle = (index / 10) * Math.PI * 2;
    const ring = radius + jitter(seed + index * 1.19, radius * 0.22);
    points.push({
      x: Math.cos(angle) * ring + jitter(seed + index * 2.17, 0.92),
      y: Math.sin(angle) * ring + jitter(seed + index * 3.03, 0.92),
    });
  }

  return closedSketchPath(points);
}

function buildBlotPath(radius, seed) {
  const points = [];

  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2;
    const ring = radius + jitter(seed + index * 2.31, radius * 0.27);
    points.push({
      x: Math.cos(angle) * ring + jitter(seed + index * 3.3, 1.7),
      y: Math.sin(angle) * ring + jitter(seed + index * 4.4, 1.7),
    });
  }

  return closedSketchPath(points);
}

function createAtomState(config) {
  return {
    ...config,
    baseDirection: new THREE.Vector3(...config.direction).normalize(),
    hovered: false,
    hoverMix: 0,
    dragging: false,
    dragMix: 0,
    nodeTilt: jitter(config.seed + 401, 16),
    labelTilt: jitter(config.seed + 509, 8),
    labelOffset: 20 + noise(config.seed + 557) * 14,
    nodePaths: [
      buildLoopPath(config.node, config.seed + 201),
      buildLoopPath(config.node * 0.84, config.seed + 301),
    ],
  };
}

function createSceneCameraRig() {
  return {
    current: {
      panX: 0,
      panY: 0,
      dolly: 0,
      zoom: 1,
      roll: 0,
      driftX: 0,
      driftY: 0,
      focus: 0,
    },
    target: {
      panX: 0,
      panY: 0,
      dolly: 0,
      zoom: 1,
      roll: 0,
      driftX: 0,
      driftY: 0,
      focus: 0,
    },
  };
}

function projectPoint(position, camera = DEFAULT_SCENE_CAMERA) {
  const translatedX = position.x + (camera.panX ?? 0);
  const translatedY = position.y + (camera.panY ?? 0);
  const translatedZ = position.z + (camera.dolly ?? 0);
  const roll = ((camera.roll ?? 0) * Math.PI) / 180;
  const rollCos = Math.cos(roll);
  const rollSin = Math.sin(roll);
  const rolledX = translatedX * rollCos - translatedY * rollSin;
  const rolledY = translatedX * rollSin + translatedY * rollCos;
  const perspective = CAMERA_DISTANCE / Math.max(CAMERA_NEAR_CLIP, CAMERA_DISTANCE - translatedZ);
  const zoom = camera.zoom ?? 1;

  return {
    x: rolledX * perspective * zoom + (camera.driftX ?? 0),
    y: rolledY * perspective * zoom + (camera.driftY ?? 0),
    scale: perspective * zoom,
    depth: clamp((translatedZ / BOND_LENGTH + 1) * 0.5, 0, 1),
  };
}

function buildBondPath(atom, variant, phase) {
  const end = {
    x: atom.x + jitter(atom.seed + variant * 5.1, 1.8),
    y: atom.y + jitter(atom.seed + variant * 6.1, 1.8),
  };
  const length = Math.hypot(end.x, end.y) || 1;
  const direction = {
    x: end.x / length,
    y: end.y / length,
  };
  const normal = {
    x: -direction.y,
    y: direction.x,
  };
  const phaseWobble = Math.sin(phase + atom.seed * 0.11 + variant * 0.7) * 1.8;
  const depthCurve = (0.5 - atom.depth) * 14;
  const curve = depthCurve + phaseWobble + jitter(atom.seed + variant * 7.1, 6);
  const start = {
    x: jitter(atom.seed + variant * 2.1, 4),
    y: jitter(atom.seed + variant * 3.1, 4),
  };
  const controlOne = {
    x: end.x * (0.28 + variant * 0.025) + normal.x * (curve * 0.85),
    y: end.y * (0.28 + variant * 0.025) + normal.y * (curve * 0.85),
  };
  const controlTwo = {
    x:
      end.x * (0.68 - variant * 0.02) +
      normal.x * (curve * 0.45 + jitter(atom.seed + variant * 11.1, 5)),
    y:
      end.y * (0.68 - variant * 0.02) +
      normal.y * (curve * 0.45 + jitter(atom.seed + variant * 12.1, 5)),
  };

  return `M ${format(start.x)} ${format(start.y)} C ${format(controlOne.x)} ${format(
    controlOne.y,
  )} ${format(controlTwo.x)} ${format(controlTwo.y)} ${format(end.x)} ${format(
    end.y,
  )}`;
}

function buildScoreSketchPolygon(points, seed, wobble = 1.4) {
  const jitteredPoints = points.map((point, index) => ({
    x: point.x + jitter(seed + index * 1.37, wobble),
    y: point.y + jitter(seed + index * 2.11, wobble),
  }));

  return jitteredPoints
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${format(point.x)} ${format(point.y)}`)
    .join(' ')
    .concat(' Z');
}

function buildScoreAxisPath(start, end, seed) {
  const startPoint = {
    x: start.x + jitter(seed + 1.1, 0.8),
    y: start.y + jitter(seed + 2.3, 0.8),
  };
  const endPoint = {
    x: end.x + jitter(seed + 3.7, 1.2),
    y: end.y + jitter(seed + 4.9, 1.2),
  };

  return `M ${format(startPoint.x)} ${format(startPoint.y)} L ${format(endPoint.x)} ${format(
    endPoint.y,
  )}`;
}

function buildSketchBoxPath(x, y, width, height, seed, wobble = 1.4) {
  return buildScoreSketchPolygon(
    [
      { x, y },
      { x: x + width, y: y + jitter(seed + 1.2, wobble * 0.18) },
      { x: x + width + jitter(seed + 2.4, wobble * 0.18), y: y + height },
      { x: x + jitter(seed + 3.6, wobble * 0.18), y: y + height + jitter(seed + 4.8, wobble * 0.18) },
    ],
    seed,
    wobble,
  );
}

function trackballVector(point) {
  const x = clamp(point.x / TRACKBALL_RADIUS, -1, 1);
  const y = clamp(point.y / TRACKBALL_RADIUS, -1, 1);
  const lengthSquared = x * x + y * y;

  if (lengthSquared > 1) {
    const scale = 1 / Math.sqrt(lengthSquared);
    return new THREE.Vector3(x * scale, y * scale, 0);
  }

  return new THREE.Vector3(x, y, Math.sqrt(1 - lengthSquared));
}

function resolveAtomStockDisplayName(item, fallback = 'Stock') {
  return (
    String(item?.companyName ?? '').trim() ||
    String(item?.name ?? '').trim() ||
    String(item?.stockName ?? '').trim() ||
    getItemFieldValue(item, ['종목명', 'stockName', 'name', 'companyName']) ||
    String(item?.label ?? '').trim() ||
    fallback
  );
}

function generateAtomLayout(items) {
  const visibleItems = filterPortfolioItemsForAtomScene(items);

  if (!visibleItems.length) {
    return [];
  }

  const total = Math.max(visibleItems.length, MIN_ATOMS);

  if (total === 1) {
    return [
      {
        id: 'a1',
        direction: [0.86, 0.22, 0.46],
        node: 8.7,
        seed: 11,
        label: resolveAtomStockDisplayName(visibleItems[0], 'Stock'),
        detail: visibleItems[0]?.detail ?? '',
        sourceItemId: visibleItems[0]?.id ?? '',
        stockName: visibleItems[0]?.stockName ?? visibleItems[0]?.name ?? visibleItems[0]?.label ?? '',
        stockCode: visibleItems[0]?.stockCode ?? visibleItems[0]?.ticker ?? visibleItems[0]?.code ?? '',
        ticker: visibleItems[0]?.ticker ?? visibleItems[0]?.stockCode ?? visibleItems[0]?.code ?? '',
        region: visibleItems[0]?.region ?? '',
        sector: visibleItems[0]?.sector ?? '',
        style: visibleItems[0]?.style ?? '',
        risk: visibleItems[0]?.risk ?? '',
        assetClass: visibleItems[0]?.assetClass ?? '',
        metadataSource: visibleItems[0]?.metadataSource ?? 'raw',
        metadataSourceByField: visibleItems[0]?.metadataSourceByField ?? {},
        fields: visibleItems[0]?.fields ?? [],
      },
    ];
  }

  if (LOW_COUNT_LAYOUTS[total]) {
    return Array.from({ length: total }, (_, index) => {
      const preset = LOW_COUNT_LAYOUTS[total][index] ?? [0, 0, 1];
      const direction = new THREE.Vector3(...preset)
        .add(
          new THREE.Vector3(
            jitter(1500 + index * 19, 0.08),
            jitter(1600 + index * 23, 0.08),
            jitter(1700 + index * 29, 0.08),
          ),
        )
        .normalize();

      return {
        id: `a${index + 1}`,
        direction: [direction.x, direction.y, direction.z],
        node: 7.9 + noise(1800 + index * 31) * 1.6,
        seed: 11 + index * 23,
        label: resolveAtomStockDisplayName(visibleItems[index], `Stock ${index + 1}`),
        detail: visibleItems[index]?.detail ?? '',
        sourceItemId: visibleItems[index]?.id ?? '',
        stockName: visibleItems[index]?.stockName ?? visibleItems[index]?.name ?? visibleItems[index]?.label ?? '',
        stockCode: visibleItems[index]?.stockCode ?? visibleItems[index]?.ticker ?? visibleItems[index]?.code ?? '',
        ticker: visibleItems[index]?.ticker ?? visibleItems[index]?.stockCode ?? visibleItems[index]?.code ?? '',
        region: visibleItems[index]?.region ?? '',
        sector: visibleItems[index]?.sector ?? '',
        style: visibleItems[index]?.style ?? '',
        risk: visibleItems[index]?.risk ?? '',
        assetClass: visibleItems[index]?.assetClass ?? '',
        metadataSource: visibleItems[index]?.metadataSource ?? 'raw',
        metadataSourceByField: visibleItems[index]?.metadataSourceByField ?? {},
        fields: visibleItems[index]?.fields ?? [],
      };
    });
  }

  return Array.from({ length: total }, (_, index) => {
    const ratio = total === 1 ? 0.5 : index / (total - 1);
    const y = 1 - ratio * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = index * GOLDEN_ANGLE + jitter(1400 + index * 17, 0.24);
    const direction = new THREE.Vector3(
      Math.cos(theta) * radius + jitter(1500 + index * 19, 0.14),
      y + jitter(1600 + index * 23, 0.14),
      Math.sin(theta) * radius + jitter(1700 + index * 29, 0.14),
    ).normalize();

    return {
      id: `a${index + 1}`,
      direction: [direction.x, direction.y, direction.z],
      node: 7.8 + noise(1800 + index * 31) * 1.7,
      seed: 11 + index * 23,
      label: resolveAtomStockDisplayName(visibleItems[index], `Stock ${index + 1}`),
      detail: visibleItems[index]?.detail ?? '',
      sourceItemId: visibleItems[index]?.id ?? '',
      stockName: visibleItems[index]?.stockName ?? visibleItems[index]?.name ?? visibleItems[index]?.label ?? '',
      stockCode: visibleItems[index]?.stockCode ?? visibleItems[index]?.ticker ?? visibleItems[index]?.code ?? '',
      ticker: visibleItems[index]?.ticker ?? visibleItems[index]?.stockCode ?? visibleItems[index]?.code ?? '',
      region: visibleItems[index]?.region ?? '',
      sector: visibleItems[index]?.sector ?? '',
      style: visibleItems[index]?.style ?? '',
      risk: visibleItems[index]?.risk ?? '',
      assetClass: visibleItems[index]?.assetClass ?? '',
      metadataSource: visibleItems[index]?.metadataSource ?? 'raw',
      metadataSourceByField: visibleItems[index]?.metadataSourceByField ?? {},
      fields: visibleItems[index]?.fields ?? [],
    };
  });
}

const PORTFOLIO_PREVIEW_SLOTS = [
  { x: -0.12, y: -0.02, scale: 0.32, rotation: -23, z: -1160, blur: 0.66, opacity: 0.64, shadow: 18, delay: '-2.4s', duration: '5.8s' },
  { x: 1.12, y: 0.07, scale: 0.24, rotation: 18, z: -1380, blur: 1.02, opacity: 0.5, shadow: 14, delay: '-1.2s', duration: '6.4s' },
  { x: 0.1, y: 0.09, scale: 0.2, rotation: -7, z: -1540, blur: 1.28, opacity: 0.42, shadow: 11, delay: '-1.8s', duration: '6.2s' },
  { x: 0.94, y: 0.27, scale: 0.28, rotation: 13, z: -1240, blur: 0.84, opacity: 0.56, shadow: 15, delay: '-2.9s', duration: '5.9s' },
  { x: -0.08, y: 0.82, scale: 0.29, rotation: 17, z: -1200, blur: 0.74, opacity: 0.6, shadow: 16, delay: '-3.1s', duration: '6.1s' },
  { x: 0.18, y: 1.08, scale: 0.21, rotation: -15, z: -1600, blur: 1.34, opacity: 0.38, shadow: 10, delay: '-1.5s', duration: '6.7s' },
  { x: 1.08, y: 0.96, scale: 0.23, rotation: -19, z: -1460, blur: 1.1, opacity: 0.46, shadow: 12, delay: '-0.8s', duration: '6.9s' },
  { x: 0.86, y: 0.72, scale: 0.19, rotation: 9, z: -1700, blur: 1.52, opacity: 0.34, shadow: 9, delay: '-2.2s', duration: '7.1s' },
  { x: 0.48, y: -0.12, scale: 0.18, rotation: -11, z: -1820, blur: 1.56, opacity: 0.32, shadow: 8, delay: '-3.4s', duration: '7.4s' },
  { x: -0.18, y: 0.43, scale: 0.2, rotation: 25, z: -1520, blur: 1.18, opacity: 0.42, shadow: 11, delay: '-0.6s', duration: '6.8s' },
  { x: 1.18, y: 0.48, scale: 0.18, rotation: -4, z: -1760, blur: 1.48, opacity: 0.34, shadow: 9, delay: '-2.7s', duration: '7.2s' },
  { x: 0.58, y: 1.16, scale: 0.17, rotation: 21, z: -1880, blur: 1.62, opacity: 0.3, shadow: 8, delay: '-1.9s', duration: '7.6s' },
];

const PREVIEW_ATOM_NODE_LIMIT = 6;

const PortfolioPreviewAtom = memo(function PortfolioPreviewAtom({ entry, slot }) {
  const previewNodes = useMemo(() => {
    const label = compactLabel(entry.fileName.replace(/\.[^.]+$/, ''), 16);

    return generateAtomLayout(entry.items)
      .slice(0, PREVIEW_ATOM_NODE_LIMIT)
      .map((atom, index) => {
        const direction = new THREE.Vector3(...atom.direction).normalize();
        const radius = 34 + direction.z * 12 + noise(atom.seed + 71) * 9;
        const x = direction.x * radius;
        const y = direction.y * radius;
        const depth = clamp((direction.z + 1) * 0.5, 0, 1);
        const loopOuter = buildLoopPath(6.6 + depth * 2.5 + index * 0.12, atom.seed + 1100);
        const loopMid = buildLoopPath(5.4 + depth * 1.9 + index * 0.1, atom.seed + 1146);
        const loopInner = buildLoopPath(4.1 + depth * 1.5 + index * 0.08, atom.seed + 1180);

        return {
          id: atom.id,
          x,
          y,
          depth,
          seed: atom.seed,
          outer: loopOuter,
          mid: loopMid,
          inner: loopInner,
          label,
        };
      });
  }, [entry.fileName, entry.items]);

  return (
    <div
      className="portfolio-preview"
      style={{
        left: `${slot.x * 100}%`,
        top: `${slot.y * 100}%`,
        transform: `translate3d(-50%, -50%, ${slot.z ?? -180}px) scale(${slot.scale}) rotate(${slot.rotation}deg)`,
        '--preview-z': `${slot.z ?? -180}px`,
        '--preview-scale': `${slot.scale}`,
        '--preview-blur': `${slot.blur ?? 0.3}px`,
        '--preview-opacity': `${slot.opacity ?? 0.78}`,
        '--preview-shadow': `${slot.shadow ?? 10}px`,
        '--preview-twinkle-delay': slot.delay ?? '0s',
        '--preview-twinkle-duration': slot.duration ?? '6.8s',
        '--preview-shift-x': `${(0.5 - slot.x) * 420}px`,
        '--preview-shift-y': `${(0.5 - slot.y) * 420}px`,
        '--preview-rotate-from': `${slot.rotation}deg`,
        '--preview-rotate-to': `${slot.rotation * 0.18}deg`,
        '--preview-focus-scale': `${slot.scale * 4.15}`,
        '--preview-focus-z': `${clamp(Math.abs(slot.z ?? -180) * 0.28, 116, 228)}px`,
      }}
      aria-label={entry.fileName}
    >
      <svg className="portfolio-preview__svg" viewBox="-80 -80 160 160" aria-hidden="true">
        <g className="portfolio-preview__core">
          {previewNodes.map((node, index) => {
            const curve = 5 + jitter(node.seed + 33, 8) + (0.5 - node.depth) * 12;
            const midX = node.x * 0.48 + curve * 0.18;
            const midY = node.y * 0.48 - curve * 0.22;
            const midXTwo = node.x * 0.76 - curve * 0.1;
            const midYTwo = node.y * 0.76 + curve * 0.14;
            const path = `M ${format(jitter(node.seed + 41, 1.8))} ${format(
              jitter(node.seed + 57, 1.8),
            )} C ${format(midX)} ${format(midY)} ${format(midXTwo)} ${format(midYTwo)} ${format(
              node.x,
            )} ${format(node.y)}`;

            return (
              <g key={node.id} opacity={0.46 + node.depth * 0.38 + index * 0.02}>
                <path className="portfolio-preview__bond-ghost" d={path} />
                <path className="portfolio-preview__bond-soft" d={path} />
                <path className="portfolio-preview__bond-main" d={path} />
                <g transform={`translate(${format(node.x)} ${format(node.y)}) rotate(${format(jitter(node.seed + 88, 18))})`}>
                  <path className="portfolio-preview__node-soft" d={node.outer} />
                  <path className="portfolio-preview__node-mid" d={node.mid} />
                  <path className="portfolio-preview__node-main" d={node.inner} />
                </g>
              </g>
            );
          })}

          <g transform={`rotate(${format(slot.rotation * 0.8)})`}>
            <path
              className="portfolio-preview__orbit"
              d={buildLoopPath(14.8, 2101 + slot.rotation)}
              opacity="0.46"
            />
            <path
              className="portfolio-preview__orbit"
              d={buildLoopPath(11.4, 2197 + slot.rotation)}
              opacity="0.34"
              transform="scale(0.92 0.78) rotate(18)"
            />
            {CENTER_BLOTS.map((path, index) => (
              <path
                key={`preview-blot-${index}`}
                className="portfolio-preview__center"
                d={path}
                opacity={0.5 + index * 0.12}
              />
            ))}
            {DUST.slice(0, 6).map((dot, index) => (
              <circle
                key={`preview-dust-${index}`}
                className="portfolio-preview__dust"
                cx={dot.x * 0.82}
                cy={dot.y * 0.82}
                r={dot.r * 0.92}
                opacity={0.22 + index * 0.05}
              />
            ))}
          </g>
        </g>
      </svg>
      <span className="portfolio-preview__label">{previewNodes[0]?.label ?? entry.fileName}</span>
    </div>
  );
});

const CENTER_BLOTS = [
  buildBlotPath(13.2, 501),
  buildBlotPath(10.7, 613),
  buildBlotPath(7.9, 727),
];
const CENTER_SPIN_LOOPS = [
  buildLoopPath(14.8, 811),
  buildLoopPath(12.9, 883),
];

const DUST = [
  { x: -22, y: 28, r: 1.4, opacity: 0.2 },
  { x: 10, y: -20, r: 1.2, opacity: 0.16 },
  { x: 28, y: 14, r: 1.2, opacity: 0.14 },
  { x: -36, y: -10, r: 0.95, opacity: 0.11 },
  { x: 44, y: -8, r: 1, opacity: 0.1 },
];

function SketchAtom({
  atom,
  phase,
  onPointerDown,
  onPointerEnter,
  onPointerMove,
  onPointerLeave,
}) {
  const softOpacity = 0.1 + atom.depth * 0.19 + atom.hoverMix * 0.07;
  const shadowOpacity = 0.18 + atom.depth * 0.3 + atom.hoverMix * 0.08;
  const mainOpacity = 0.3 + atom.depth * 0.48 + atom.hoverMix * 0.08;
  const scale = atom.scale * (0.86 + atom.depth * 0.1);
  const nodeScale =
    scale *
    ((atom.isSelected ? 0.92 : atom.isGroupMatch ? 0.91 : 0.9) +
      atom.hoverMix * 0.055 +
      atom.dragMix * 0.085);
  const nodeRotation =
    atom.nodeTilt + atom.position.z * 0.045 + Math.sin(phase + atom.seed) * 1.4;
  const lineLayers = [
    buildBondPath(atom, 0, phase),
    buildBondPath(atom, 1, phase),
    buildBondPath(atom, 2, phase),
  ];
  const dimFactor = atom.dimmed ? 0.18 : 1;
  const focusBoost = atom.isSelected ? 1.48 : atom.isGroupMatch ? 1.04 : 1;

  return (
    <>
      <path
        className="stroke-soft"
        d={lineLayers[2]}
        opacity={Math.min(1, softOpacity * dimFactor * focusBoost)}
        strokeWidth={0.88 + scale * 0.3}
      />
      <path
        className="stroke-shadow"
        d={lineLayers[1]}
        opacity={Math.min(1, shadowOpacity * dimFactor * focusBoost)}
        strokeWidth={1.3 + scale * 0.58}
      />
      <path
        className="stroke-main"
        d={lineLayers[0]}
        opacity={Math.min(1, mainOpacity * dimFactor * focusBoost)}
        strokeWidth={0.98 + scale * 0.46}
      />

      <g
        className="node-shell"
        transform={`translate(${format(atom.x)} ${format(atom.y)}) rotate(${format(
          nodeRotation,
        )}) scale(${format(nodeScale)})`}
      >
        {atom.isSelected ? (
          <path
            className="node-selected-glow"
            d={atom.nodePaths[0]}
            opacity={Math.min(1, (0.48 + atom.depth * 0.34) * (0.82 + Math.sin(phase * 1.2) * 0.08))}
            strokeWidth={3.2}
          />
        ) : null}
        <path
          className="node-soft"
          d={atom.nodePaths[0]}
          opacity={Math.min(
            1,
            (0.3 + atom.depth * 0.26 + atom.hoverMix * 0.12) * dimFactor * focusBoost,
          )}
          strokeWidth={1.08}
        />
        <path
          className="node-main"
          d={atom.nodePaths[1]}
          opacity={Math.min(
            1,
            (0.48 + atom.depth * 0.38 + atom.hoverMix * 0.08) * dimFactor * focusBoost,
          )}
          strokeWidth={1.24}
        />
        <circle
          className="node-hit"
          cx="0"
          cy="0"
          r={atom.node * 2.85}
          onPointerDown={onPointerDown}
          onPointerEnter={onPointerEnter}
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
        />
      </g>
    </>
  );
}

function SketchAura({ atom, phase }) {
  const dimFactor = atom.dimmed ? 0.12 : 1;
  const focusBoost = atom.isSelected ? 2.25 : atom.isGroupMatch ? 1.08 : 1;

  return (
    <path
      className="aura-line"
      d={buildBondPath(atom, 0, phase)}
      opacity={Math.min(
        atom.isSelected ? 0.44 : 0.22,
        (0.03 + atom.depth * 0.04 + atom.dragMix * 0.05) * dimFactor * focusBoost,
      )}
      strokeWidth={atom.isSelected ? 8.2 + atom.scale * 3.2 : 5.4 + atom.scale * 2.5}
    />
  );
}

function AtomLabel({ atom }) {
  const length = Math.hypot(atom.x, atom.y) || 1;
  const direction = {
    x: atom.x / length,
    y: atom.y / length,
  };
  const anchor =
    direction.x > 0.24 ? 'start' : direction.x < -0.24 ? 'end' : 'middle';
  const baseX = direction.x > 0.24 ? 10 : direction.x < -0.24 ? -10 : 0;
  const noteX = atom.x + direction.x * atom.labelOffset;
  const noteY = atom.y + direction.y * atom.labelOffset + jitter(atom.seed + 601, 4);
  const opacity =
    (0.48 + atom.depth * 0.32 + atom.hoverMix * 0.08) *
    (atom.dimmed ? 0.24 : atom.isSelected ? 1.06 : atom.isGroupMatch ? 1.03 : 1);

  return (
    <g
      className="label-note"
      transform={`translate(${format(noteX)} ${format(noteY)}) rotate(${format(
        atom.labelTilt + direction.x * 4,
      )})`}
      opacity={opacity}
    >
      <text className="label-main" textAnchor={anchor} x={baseX} y="-2">
        {atom.label}
      </text>
      {atom.detail ? (
        <text className="label-detail" textAnchor={anchor} x={baseX} y="13">
          {atom.detail}
        </text>
      ) : null}
    </g>
  );
}

function SketchGearIcon() {
  return (
    <svg className="settings-gear__icon" viewBox="0 0 48 48" aria-hidden="true">
      <path
        className="settings-gear__outline-soft"
        d="M24.2 7.1l3.2.9 1.4 4.5 4.4-.1 2.3 3-1.8 4.2 3.5 2.4-.8 4-4 1.4-.5 4.2-3.5 2.2-3.7-2.1-3.9 2.3-3.2-2.4.2-4.2-4-1.6-.8-3.7 3.1-2.9-1.8-4.1 2.7-3.2 4.3.2 1.5-4.6z"
      />
      <path
        className="settings-gear__outline-main"
        d="M24.4 6.4l3.5 1 1.3 4.6 4.3.1 2.5 3.1-1.9 4 3.2 2.6-.6 4.1-4.2 1.2-.4 4.3-3.6 2.4-3.6-2.2-4 2.3-3.1-2.7.2-4.1-4.2-1.5-.6-3.8 3.2-2.8-2-4 2.6-3.3 4.4.3 1.4-4.6z"
      />
      <path
        className="settings-gear__center-soft"
        d="M24.3 16.8c4.3-.1 7.1 3.1 7 7.2 0 4.1-2.9 7.1-7 7-3.9 0-6.9-2.9-6.9-7 .1-4.1 3-7.2 6.9-7.2z"
      />
      <path
        className="settings-gear__center-main"
        d="M24.2 17.6c3.8 0 6.2 2.9 6.2 6.5 0 3.7-2.4 6.4-6.1 6.4-3.6 0-6.2-2.6-6.2-6.4s2.5-6.5 6.1-6.5z"
      />
    </svg>
  );
}

function SketchPlusIcon() {
  return (
    <svg className="tool-plus__icon" viewBox="0 0 48 48" aria-hidden="true">
      <path
        className="tool-plus__stroke-soft"
        d="M22.7 8.8L28.5 9.2L28.1 20.3L39 20.7L38.6 27.9L27.7 27.5L27.4 39.1L20.8 38.7L21.2 27.2L9.7 27.4L9.2 20.9L21.7 20.6L22.7 8.8Z"
      />
      <path
        className="tool-plus__stroke-main"
        d="M23.6 8.1L28 8.4L27.8 21.2L39.2 21.3L38.9 26.8L27.4 27L27.1 39.8L21.2 39.3L21.7 26.6L8.8 26.9L8.5 21.6L22.1 21.3L23.6 8.1Z"
      />
      <path
        className="tool-plus__stroke-soft"
        d="M22.5 8.9L28.3 9.4L27.9 20.9L39.1 20.6L38.8 27.4L27.6 27.6L27.2 39.2L20.7 38.8L21 27.3L9.5 27.6L9.1 20.8L21.9 20.8L22.5 8.9Z"
      />
    </svg>
  );
}

function SketchUploadArrowIcon() {
  return (
    <svg className="upload-arrow__icon" viewBox="0 0 48 48" aria-hidden="true">
      <path
        className="upload-arrow__stroke-soft"
        d="M23.1 7.8L30.1 15.6L27.2 15.1L27.4 28.9L21.2 28.6L21.4 15.4L18 15.7L23.1 7.8Z"
      />
      <path
        className="upload-arrow__stroke-main"
        d="M23.7 7.1L29.7 14.6L26.6 14.2L26.7 30.3L21.7 30L21.8 14.6L18.2 15L23.7 7.1Z"
      />
      <path
        className="upload-arrow__stroke-soft"
        d="M12 31.4L15.7 35.2L31.8 35.4L35.6 31.7"
      />
      <path
        className="upload-arrow__stroke-main"
        d="M12.8 30.6L15.9 33.9L31.4 34L34.9 30.8"
      />
      <path
        className="upload-arrow__stroke-soft"
        d="M15.6 34.8L15.2 38L32 38.2L31.7 35"
      />
      <path
        className="upload-arrow__stroke-main"
        d="M16.1 34.1L15.8 37.1L31.4 37.2L31.2 34.3"
      />
    </svg>
  );
}

function SketchBurstIcon() {
  return (
    <svg className="group-dock__burst-icon" viewBox="0 0 48 48" aria-hidden="true">
      <path
        className="group-dock__burst-soft"
        d="M24.2 5.8L26.8 18L34.8 12.6L30.1 21L41.7 19.2L30.9 24.2L33.2 33.4L26 28.8L24.8 42.7L21.5 29.2L14.2 34.3L18.8 26.1L6.2 24.2L18.2 22.1L11.2 15.3L21.2 18.8Z"
      />
      <path
        className="group-dock__burst-main"
        d="M24.1 6.6L26.1 17.4L33.8 12.4L29.6 20.9L40 19.6L30.4 24.1L32.4 32.2L25.8 28L24.7 40.9L21.8 28.7L15.1 33.4L19.1 25.9L7.6 24L18.5 22L12.2 15.8L21.5 19Z"
      />
      <path
        className="group-dock__burst-core"
        d="M24.4 7.3L26.5 18.4L34 13.5L29.5 21.8L39.1 20.5L30.1 24.5L31.9 31.4L25.8 27.6L24.8 39.6L22.1 28.2L15.8 32.6L19.6 25.6L9 23.9L18.9 22.2L13 16.6L21.7 19.5Z"
        opacity="0.86"
      />
    </svg>
  );
}

function FloatingGroupDock({
  anchorRef,
  anchorPosition,
  options,
  activeKey,
  spawn,
  resetSignal,
  visible = true,
  layerStyle,
  onAnchorPositionChange,
  onChange,
  onInteract,
}) {
  const dockRef = useRef(null);
  const hasUserMovedRef = useRef(false);
  const storageKey = STORAGE_KEYS.groupDockPosition;
  const pressRef = useRef({
    pointerId: null,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    lastX: 0,
    lastY: 0,
    pressAt: 0,
    dragStarted: false,
    action: 'toggle',
    holdTimer: null,
  });
  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const anchoredPosition = () => {
    if (typeof window === 'undefined') {
      return { x: 0, y: 0 };
    }

    const dockSize = groupDockSizeFor(window.innerWidth);
    const triggerSize = toolTriggerSizeFor(window.innerWidth);
    if (anchorPosition) {
      return stackDockBelow(
        anchorPosition.x,
        anchorPosition.y,
        triggerSize,
        dockSize,
        window.innerWidth,
        window.innerHeight,
      );
    }

    const rect = anchorRef?.current?.getBoundingClientRect();

    if (!rect) {
      const inset = uiInsetFor(window.innerWidth);
      return stackDockBelow(
        inset,
        inset,
        triggerSize,
        dockSize,
        window.innerWidth,
        window.innerHeight,
      );
    }

    return stackDockBelowRect(
      rect,
      triggerSize,
      dockSize,
      window.innerWidth,
      window.innerHeight,
    );
  };
  const [position, setPosition] = useState(() => {
    const storedPosition = readStoredPosition(storageKey);
    if (storedPosition) {
      hasUserMovedRef.current = true;
      return storedPosition;
    }

    return anchoredPosition();
  });

  const clampDockPosition = (nextX, nextY) => {
    const margin = 18;
    const width = dockRef.current?.offsetWidth ?? 64;
    const height = dockRef.current?.offsetHeight ?? 64;

    return {
      x: clamp(nextX, margin, window.innerWidth - width - margin),
      y: clamp(nextY, margin, window.innerHeight - height - margin),
    };
  };

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const syncPosition = () => {
      setPosition((current) => {
        const next = clampDockPosition(current.x, current.y);
        if (hasUserMovedRef.current) {
          return next;
        }

        const anchored = anchoredPosition();
        return clampDockPosition(anchored.x, anchored.y);
      });
    };

    const frameId = window.requestAnimationFrame(syncPosition);
    window.addEventListener('resize', syncPosition);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', syncPosition);
    };
  }, [anchorRef, anchorPosition?.x, anchorPosition?.y, expanded]);

  useEffect(() => {
    if (!hasUserMovedRef.current) {
      onAnchorPositionChange?.(position);
    }
  }, [onAnchorPositionChange, position]);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      dragging ||
      !hasUserMovedRef.current
    ) {
      return;
    }

    writeStoredPosition(storageKey, position);
  }, [dragging, position, storageKey]);

  useEffect(() => {
    if (!spawn) {
      return;
    }

    hasUserMovedRef.current = true;
    setExpanded(true);
    setPosition((current) => clampDockPosition(spawn.x ?? current.x, spawn.y ?? current.y));
  }, [spawn?.session]);

  useEffect(() => {
    if (!resetSignal) {
      return;
    }

    hasUserMovedRef.current = false;
    clearStoredPosition(storageKey);
    setExpanded(false);
    const anchored = anchoredPosition();
    setPosition(clampDockPosition(anchored.x, anchored.y));
  }, [resetSignal, storageKey]);

  const beginDrag = () => {
    if (pressRef.current.pointerId === null) {
      return;
    }

    window.clearTimeout(pressRef.current.holdTimer);
    pressRef.current.holdTimer = null;
    pressRef.current.dragStarted = true;
    hasUserMovedRef.current = true;
    setDragging(true);
    document.body.style.cursor = 'grabbing';
    setPosition(
      clampDockPosition(
        pressRef.current.originX + (pressRef.current.lastX - pressRef.current.startX),
        pressRef.current.originY + (pressRef.current.lastY - pressRef.current.startY),
      ),
    );
  };

  const clearPress = () => {
    window.clearTimeout(pressRef.current.holdTimer);
    pressRef.current.pointerId = null;
    pressRef.current.dragStarted = false;
    pressRef.current.action = 'toggle';
    pressRef.current.holdTimer = null;
    setDragging(false);
    document.body.style.cursor = '';
  };

  useEffect(() => {
    const handleWindowPointerMove = (event) => {
      if (pressRef.current.pointerId !== event.pointerId) {
        return;
      }

      pressRef.current.lastX = event.clientX;
      pressRef.current.lastY = event.clientY;
      const deltaX = event.clientX - pressRef.current.startX;
      const deltaY = event.clientY - pressRef.current.startY;
      const distanceSquared = deltaX * deltaX + deltaY * deltaY;
      const action = pressRef.current.action;
      const dragDistanceThreshold = action === 'toggle' ? 36 : 9;
      const shouldStartDrag =
        distanceSquared > dragDistanceThreshold ||
        (action !== 'toggle' && performance.now() - pressRef.current.pressAt > 140);

      if (!pressRef.current.dragStarted) {
        if (shouldStartDrag) {
          beginDrag();
        } else {
          return;
        }
      }

      event.preventDefault();
      onInteract();
      setPosition(
        clampDockPosition(
          pressRef.current.originX + deltaX,
          pressRef.current.originY + deltaY,
        ),
      );
    };

    const handleWindowPointerUp = (event) => {
      if (pressRef.current.pointerId !== event.pointerId) {
        return;
      }

      const deltaX = event.clientX - pressRef.current.startX;
      const deltaY = event.clientY - pressRef.current.startY;
      const wasDrag = pressRef.current.dragStarted;
      const wasClick = !wasDrag && deltaX * deltaX + deltaY * deltaY < 100;
      const action = pressRef.current.action;

      clearPress();

      if (wasDrag) {
        event.preventDefault();
        return;
      }

      if (wasClick && action === 'toggle') {
        onInteract();
        setExpanded((current) => !current);
      }
    };

    const handleWindowPointerCancel = (event) => {
      if (pressRef.current.pointerId !== event.pointerId) {
        return;
      }

      clearPress();
    };

    window.addEventListener('pointermove', handleWindowPointerMove, {
      passive: false,
    });
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerCancel);

    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerCancel);
      window.clearTimeout(pressRef.current.holdTimer);
    };
  }, [onInteract]);

  const startPress = (event, action, options = {}) => {
    const {
      capture = false,
      preventDefault = false,
      stopPropagation = false,
      holdDelay = 140,
    } = options;

    if (preventDefault) {
      event.preventDefault();
    }

    if (stopPropagation) {
      event.stopPropagation();
    }

    onInteract();
    if (capture) {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    pressRef.current.pointerId = event.pointerId;
    pressRef.current.startX = event.clientX;
    pressRef.current.startY = event.clientY;
    pressRef.current.originX = position.x;
    pressRef.current.originY = position.y;
    pressRef.current.lastX = event.clientX;
    pressRef.current.lastY = event.clientY;
    pressRef.current.pressAt = performance.now();
    pressRef.current.dragStarted = false;
    pressRef.current.action = action;
    pressRef.current.holdTimer =
      Number.isFinite(holdDelay) && holdDelay >= 0
        ? window.setTimeout(beginDrag, holdDelay)
        : null;
  };

  const handleDockPointerDown = (event) => {
    startPress(event, 'toggle', {
      capture: true,
      preventDefault: true,
      stopPropagation: true,
      holdDelay: null,
    });
  };

  const handleDockSurfacePointerDown = (event) => {
    startPress(event, 'drag', {
      capture: false,
      preventDefault: false,
      stopPropagation: true,
      holdDelay: 140,
    });
  };

  const panelSide =
    typeof window === 'undefined'
      ? 'right'
      : floatingPanelSideFor(position.x, groupDockSizeFor(window.innerWidth), window.innerWidth);

  return (
    <div
      ref={dockRef}
      className={`group-dock${panelSide === 'left' ? ' is-flipped' : ''}${expanded ? ' is-expanded' : ''}${dragging ? ' is-dragging' : ''}${visible ? '' : ' is-hidden'}`}
      style={{
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        ...layerStyle,
      }}
    >
      <button
        type="button"
        className="group-dock__burst"
        onPointerDown={handleDockPointerDown}
        aria-expanded={expanded}
      >
        <SketchBurstIcon />
      </button>

      <div className="group-dock__row" onPointerDown={handleDockSurfacePointerDown}>
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            className={`group-dock__option${option.key === activeKey ? ' is-active' : ''}`}
            onClick={() => {
              onInteract();
              onChange(option.key);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function HoverCard({ atom, position, language }) {
  const infoFields = buildAtomInfoFields(atom, language);

  if (!atom || !infoFields.length || !position) {
    return null;
  }

  const returnRaw = atom.detail ?? '';
  const returnToneClass = getSignedValueToneClass(returnRaw, 'is-positive', 'is-negative');
  const displayFields = returnRaw
    ? infoFields.filter((field) => resolveFieldLabelKey(field.label) !== 'return')
    : infoFields;

  return (
    <aside
      className="hover-card"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
    >
      <div className="hover-card__header">
        <div className="hover-card__title-wrap">
          <strong className="hover-card__title">{atom.label}</strong>
          {returnRaw ? (
            <span
              className={`hover-card__return${returnToneClass ? ` ${returnToneClass}` : ''}`}
            >
              {returnRaw}
            </span>
          ) : null}
        </div>
      </div>

      <div className="hover-card__list">
        {displayFields.map((field, index) => (
          <div className="hover-card__row" key={`${atom.id}-${field.label}-${index}`}>
            <span className="hover-card__label">{formatFieldLabel(field.label, language)}</span>
            <span className="hover-card__value">{translateDisplayValue(field.value, language)}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}

function SketchRadarIcon({ scorecard, axes }) {
  const center = 24;
  const radius = 14.5;
  const angleStep = (Math.PI * 2) / axes.length;
  const ringRatios = [0.5, 1];
  const axisPoints = axes.map((axis, index) => {
    const angle = -Math.PI / 2 + index * angleStep;
    return {
      key: axis.key,
      angle,
      outerX: center + Math.cos(angle) * radius,
      outerY: center + Math.sin(angle) * radius,
      value: scorecard.metrics[axis.key],
    };
  });
  const radarPoints = axisPoints.map((axis) => {
    const scaledRadius = radius * (axis.value / 100);
    return {
      x: center + Math.cos(axis.angle) * scaledRadius,
      y: center + Math.sin(axis.angle) * scaledRadius,
    };
  });
  const ringPaths = ringRatios.map((ring, index) => {
    const points = axisPoints.map((axis) => ({
      x: center + Math.cos(axis.angle) * radius * ring,
      y: center + Math.sin(axis.angle) * radius * ring,
    }));

    return {
      key: `mini-ring-${ring}`,
      soft: buildScoreSketchPolygon(points, 3001 + index * 37, 0.58 + index * 0.12),
      main: buildScoreSketchPolygon(points, 3061 + index * 37, 0.42 + index * 0.08),
    };
  });
  const axisSketches = axisPoints.map((axis, index) => ({
    key: axis.key,
    soft: buildScoreAxisPath(
      { x: center, y: center },
      { x: axis.outerX, y: axis.outerY },
      3121 + index * 19,
    ),
    main: buildScoreAxisPath(
      { x: center, y: center },
      { x: axis.outerX, y: axis.outerY },
      3181 + index * 19,
    ),
  }));

  return (
    <svg className="score-dock__icon" viewBox="0 0 48 48" aria-hidden="true">
      {ringPaths.map((ring) => (
        <g key={ring.key}>
          <path d={ring.soft} className="score-dock__icon-grid-soft" />
          <path d={ring.main} className="score-dock__icon-grid-main" />
        </g>
      ))}

      {axisSketches.map((axis) => (
        <g key={axis.key}>
          <path d={axis.soft} className="score-dock__icon-grid-soft" />
          <path d={axis.main} className="score-dock__icon-grid-main" />
        </g>
      ))}

      <path
        d={buildScoreSketchPolygon(radarPoints, 3241, 0.84)}
        className="score-dock__icon-shape-soft"
      />
      <path
        d={buildScoreSketchPolygon(radarPoints, 3301, 0.52)}
        className="score-dock__icon-shape-main"
      />
    </svg>
  );
}

function SketchSpiralIcon() {
  return (
    <svg className="spiral-glyph__icon" viewBox="0 0 48 48" aria-hidden="true">
      <path
        className="spiral-glyph__soft"
        d="M34.6 11.3C29.4 6.9 19.5 7.2 14.5 12.5C9.9 17.3 9.6 25.6 14 30.7C18.4 35.9 26.7 36.7 31.9 33.1C36.1 30.2 37.9 24.7 36 20.1C34.2 15.9 29.6 13.3 25.2 14.1C21.1 14.8 17.9 18.3 17.9 22.4C17.9 26 20.6 29.1 24.1 29.4C27.2 29.6 29.9 27.5 30.2 24.8C30.4 22.5 29.1 20.6 26.9 19.9"
      />
      <path
        className="spiral-glyph__main"
        d="M33.3 11.2C28.8 7.5 20.1 7.5 15.1 12.1C10.2 16.6 9.9 24.8 14 30.1C18.1 35.4 26.4 36.3 31.3 32.8C35.4 29.8 37.1 24.5 35.3 20.3C33.7 16.4 29.4 14.2 25.4 14.8C21.6 15.3 18.5 18.5 18.4 22.2C18.3 25.8 20.9 28.7 24.1 28.9C27 29.1 29.5 27.1 29.8 24.6C30 22.2 28.8 20.2 26.3 19.4C24.2 18.8 21.8 19.7 20.8 21.6C19.9 23.4 20.3 25.7 21.9 27C23.3 28.1 25.5 28.1 26.9 27"
      />
      <path
        className="spiral-glyph__highlight"
        d="M33.1 11.8C28.5 8.1 20.3 8 15.8 12.5C11.5 16.9 11.2 24.6 14.8 29.3C18.5 34.1 25.9 35 30.6 31.9C34.4 29.4 35.9 24.7 34.4 20.7C33 17.1 29.1 15.1 25.6 15.6C22.3 16 19.6 18.8 19.4 22C19.2 25 21.3 27.5 24.1 27.9C26.7 28.1 28.7 26.4 28.9 24.3C29.1 22.4 28 20.8 26 20.1"
      />
    </svg>
  );
}

function PortfolioScoreCard({
  scorecard,
  axes,
  language,
  className = 'score-panel',
  onPointerDown,
}) {
  const [hoveredMetricKey, setHoveredMetricKey] = useState(null);
  const center = 104;
  const radius = 74;
  const angleStep = (Math.PI * 2) / axes.length;
  const rings = [0.25, 0.5, 0.75, 1];
  const text = textFor(language);
  const axisPoints = axes.map((axis, index) => {
    const angle = -Math.PI / 2 + index * angleStep;
    const outerX = center + Math.cos(angle) * radius;
    const outerY = center + Math.sin(angle) * radius;
    const labelRadius = radius + 8;
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    const verticalOffset = sin > 0.82 ? 4 : sin < -0.82 ? -3 : 0;
    const horizontalOffset = cos > 0.82 ? 2 : cos < -0.82 ? -2 : 0;

    return {
      ...axis,
      angle,
      outerX,
      outerY,
      labelX: center + cos * labelRadius + horizontalOffset,
      labelY: center + sin * labelRadius + verticalOffset,
      value: scorecard.metrics[axis.key],
    };
  });
  const ringPaths = rings.map((ring, ringIndex) => {
    const ringPoints = axisPoints.map((axis) => ({
      x: center + Math.cos(axis.angle) * radius * ring,
      y: center + Math.sin(axis.angle) * radius * ring,
    }));

    return {
      key: `ring-${ring}`,
      soft: buildScoreSketchPolygon(ringPoints, 901 + ringIndex * 17, 0.95 + ringIndex * 0.28),
      main: buildScoreSketchPolygon(ringPoints, 933 + ringIndex * 17, 0.74 + ringIndex * 0.22),
    };
  });
  const axisSketches = axisPoints.map((axis, index) => ({
    key: axis.key,
    soft: buildScoreAxisPath(
      { x: center, y: center },
      { x: axis.outerX, y: axis.outerY },
      1101 + index * 23,
    ),
    main: buildScoreAxisPath(
      { x: center, y: center },
      { x: axis.outerX, y: axis.outerY },
      1163 + index * 23,
    ),
  }));
  const radarPoints = axisPoints.map((axis) => {
    const scaledRadius = radius * (axis.value / 100);
    return {
      ...axis,
      x: center + Math.cos(axis.angle) * scaledRadius,
      y: center + Math.sin(axis.angle) * scaledRadius,
    };
  });
  const radarPathSoft = buildScoreSketchPolygon(
    radarPoints.map(({ x, y }) => ({ x, y })),
    1407,
    1.95,
  );
  const radarPathMain = buildScoreSketchPolygon(
    radarPoints.map(({ x, y }) => ({ x, y })),
    1459,
    1.08,
  );
  const hoveredAxis = axisPoints.find((axis) => axis.key === hoveredMetricKey) ?? null;
  const scoreHintTransform = hoveredAxis
    ? hoveredAxis.labelY < center - 18
      ? 'translate(-50%, 0.9rem)'
      : hoveredAxis.labelY > center + 18
        ? 'translate(-50%, -115%)'
        : hoveredAxis.labelX > center + 18
          ? 'translate(-100%, -55%)'
          : hoveredAxis.labelX < center - 18
            ? 'translate(0, -55%)'
            : 'translate(-50%, -115%)'
    : '';

  return (
    <aside className={className} onPointerDown={onPointerDown} aria-label={text.heatmapChartAria}>
      <div className="score-chart-wrap">
        <svg className="score-chart" viewBox="0 0 208 208" role="img" aria-label={text.scoreChartAria}>
          <g className="score-grid">
            {ringPaths.map((ring) => {
              return (
                <g key={ring.key}>
                  <path d={ring.soft} className="score-grid-ring-soft" />
                  <path d={ring.main} className="score-grid-ring" />
                </g>
              );
            })}

            {axisSketches.map((axis) => (
              <g key={`axis-${axis.key}`}>
                <path className="score-grid-axis-soft" d={axis.soft} />
                <path className="score-grid-axis" d={axis.main} />
              </g>
            ))}
          </g>

          <path className="score-shape-soft" d={radarPathSoft} />
          <path className="score-shape-main" d={radarPathMain} />
          <path className="score-shape-ghost" d={radarPathSoft} />

          {radarPoints.map((axis, index) => {
            return (
              <g key={`point-${axis.key}`} transform={`translate(${format(axis.x)} ${format(axis.y)})`}>
                <path className="score-point-soft" d={buildLoopPath(3.15, 1701 + index * 37)} />
                <path className="score-point-main" d={buildLoopPath(2.42, 1759 + index * 37)} />
                <circle className="score-point-core" cx="0" cy="0" r="1.3" />
                <circle
                  className="score-point-hit"
                  cx="0"
                  cy="0"
                  r="10"
                  onPointerEnter={() => setHoveredMetricKey(axis.key)}
                  onPointerLeave={() => setHoveredMetricKey((current) => (current === axis.key ? null : current))}
                />
              </g>
            );
          })}

          <text className="score-center-value" x={center} y={center + 4} textAnchor="middle">
            {scorecard.overall}
          </text>

          {axisPoints.map((axis) => (
            <text
              key={`label-${axis.key}`}
              className="score-axis-label"
              x={axis.labelX}
              y={axis.labelY}
              textAnchor={
                Math.abs(axis.labelX - center) < 8 ? 'middle' : axis.labelX > center ? 'start' : 'end'
              }
            >
              {axis.label}
            </text>
          ))}
        </svg>

        {hoveredAxis ? (
          <div
            className="score-hint"
            style={{
              left: `${(hoveredAxis.outerX / 208) * 100}%`,
              top: `${(hoveredAxis.outerY / 208) * 100}%`,
              transform: scoreHintTransform,
            }}
          >
            <strong className="score-hint__title">
              {hoveredAxis.label} {hoveredAxis.value}
              {language === 'en' ? ` ${text.scorePointUnit}` : text.scorePointUnit}
            </strong>
            <p className="score-hint__body">{scorecard.explanations?.[hoveredAxis.key]}</p>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function SketchHeatmapIcon({ heatmap }) {
  const cells = heatmap.cells ?? [];
  const positiveCells = cells.filter((cell) => cell.positive);
  const negativeCells = cells.filter((cell) => cell.negative);
  const positiveGlow = positiveCells.length
    ? positiveCells.reduce(
        (sum, cell) => sum + (cell.positiveIntensity ?? cell.intensity ?? 0.36),
        0,
      ) / positiveCells.length
    : 0.22;
  const negativeWeight = negativeCells.length
    ? negativeCells.reduce(
        (sum, cell) => sum + (cell.negativeIntensity ?? cell.intensity ?? 0.22),
        0,
      ) / negativeCells.length
    : 0.1;
  const lineOpacity = Math.min(0.96, 0.52 + positiveGlow * 0.34 - negativeWeight * 0.08);
  const softOpacity = Math.min(0.7, 0.2 + positiveGlow * 0.28);
  const bladeShapes = [
    {
      key: 'left-short',
      soft: 'M11.4 39.6C11.1 33.2 11.8 28.2 15.4 22.4C18.8 24.4 21.5 29.2 23.6 35.7',
      main: 'M12.2 39.1C12.1 33.5 12.8 29 15.8 23.9C18.6 26.1 20.8 30 22.8 35.2',
    },
    {
      key: 'left-tall',
      soft: 'M17.4 36.6C16.8 27.1 17.8 19.4 21.1 8.2C24.4 12.2 26.2 19.8 27 35.4',
      main: 'M18.2 35.9C17.8 27.5 18.7 20.6 21.6 10C24.1 13.8 25.5 20.7 26.1 34.7',
    },
    {
      key: 'right-tall',
      soft: 'M26.4 35.5C27.3 27.4 29.1 21.1 34.8 15.6C36.6 20 36.6 27.2 33.9 35.7',
      main: 'M27 34.8C28 27.7 29.9 22.4 34.3 17.2C35.6 21.3 35.5 27.5 33.2 35.1',
    },
    {
      key: 'right-short',
      soft: 'M31.8 39.7C32.1 35.1 33.6 31.8 38.8 28.1C40.2 30.4 39.4 34.8 35.9 39.3',
      main: 'M32.4 39.1C32.8 35.2 34.1 32.4 38.1 29.5C39.1 31.7 38.5 35.2 35.6 38.8',
    },
  ];
  const baseCurves = {
    soft: 'M12.5 39.7L17.2 35.8L23.7 35.8L26.1 33.7L28.9 35.8L34.7 35.9L39 32.8L37.2 37.8L36.4 41.1L19.4 41.1L13.7 41Z',
    main: 'M13.4 39.4L17.8 36.4L23.9 36.4L26.2 34.5L28.7 36.4L34.3 36.4L38 33.8L36.3 38.1L35.6 40.3L19.7 40.4L14.5 40.4Z',
  };

  return (
    <svg className="heatmap-dock__icon" viewBox="0 0 48 48" aria-hidden="true">
      {bladeShapes.map((blade, index) => (
        <g key={blade.key}>
          <path
            d={blade.soft}
            className="heatmap-dock__grass-blade-soft"
            opacity={softOpacity - index * 0.022}
          />
          <path
            d={blade.main}
            className="heatmap-dock__grass-blade-main"
            opacity={lineOpacity - index * 0.014}
          />
        </g>
      ))}
      <path d={baseCurves.soft} className="heatmap-dock__grass-blade-soft" opacity={softOpacity * 0.92} />
      <path d={baseCurves.main} className="heatmap-dock__grass-blade-main" opacity={lineOpacity * 0.94} />
    </svg>
  );
}

function SketchTwinIcon() {
  return (
    <svg className="twin-dock__icon" viewBox="0 0 48 48" aria-hidden="true">
      <path
        className="twin-dock__orbit-soft"
        d="M10.6 25.4C13.7 14.6 24.5 8.8 34 12.1C42.7 15.2 43.8 25.3 36.5 32.1C28.6 39.4 16 40.5 11.5 32.5C10.1 30 9.8 27.7 10.6 25.4Z"
      />
      <path
        className="twin-dock__orbit-main"
        d="M11.8 25.1C14.8 15.6 24.1 10.4 32.5 13.3C40.2 16 41.6 24.7 35 30.9C27.9 37.6 17.1 38.3 13 31.3C11.8 29.2 11.2 27.1 11.8 25.1Z"
      />
      <path
        className="twin-dock__orbit-soft"
        d="M13.4 14.9C21.2 9.1 32.1 11.9 35.3 21.2C38.3 29.9 31.1 38.1 21.1 36.3C11.8 34.6 7.7 25.8 13.4 14.9Z"
        opacity="0.42"
      />
      <path
        className="twin-dock__node-soft"
        d="M23.7 17.9C27.7 17.6 30.6 20.5 30.7 24.1C30.8 28.2 27.8 31.1 23.8 31C19.8 31 17.2 28.3 17.3 24.4C17.4 20.7 20 18.2 23.7 17.9Z"
      />
      <path
        className="twin-dock__node-main"
        d="M24 18.9C27.2 18.7 29.5 21 29.5 24.1C29.5 27.5 27.2 29.8 24 29.8C20.8 29.8 18.6 27.5 18.7 24.4C18.8 21.3 20.9 19.1 24 18.9Z"
      />
      <circle className="twin-dock__spark" cx="34.4" cy="15.6" r="2.1" />
      <circle className="twin-dock__spark" cx="13.6" cy="31.2" r="1.6" />
    </svg>
  );
}

function SketchAccountStackIcon() {
  return (
    <svg className="account-dock__icon" viewBox="0 0 48 48" aria-hidden="true">
      <path
        className="account-dock__soft"
        d="M13.2 12.6C18.1 9.5 29.2 9.8 34.9 12.9C39.7 15.6 39 20.1 33.7 22.1C27.5 24.4 16.6 23.8 12.4 20.2C9.5 17.7 10.1 14.5 13.2 12.6Z"
      />
      <path
        className="account-dock__main"
        d="M14.1 13.4C18.7 10.8 28.3 11 33.5 13.6C37.3 15.5 36.9 18.5 32.7 20.2C27.1 22.4 17.5 21.8 13.6 18.9C11.4 17.3 11.8 14.7 14.1 13.4Z"
      />
      <path
        className="account-dock__soft"
        d="M11.9 21.2C16.1 25.1 28.8 25.8 35.4 22.7L35 28.2C29.5 32 17.4 31.6 12 27.4L11.9 21.2Z"
        opacity="0.55"
      />
      <path
        className="account-dock__main"
        d="M13.1 22.3C17.5 25.5 28 26 34 23.4L33.7 27.4C28.5 30.3 18.2 30 13.2 26.7L13.1 22.3Z"
      />
      <path
        className="account-dock__soft"
        d="M12.4 30.3C17.9 34.2 29 34.7 35.2 31.2L34.8 35.4C28.7 39 17.5 38.2 12.6 34.7L12.4 30.3Z"
      />
      <path
        className="account-dock__main"
        d="M13.6 30.9C18.7 33.8 28.4 34.2 33.8 31.8L33.6 34.6C28.4 37.2 18.8 36.7 13.7 33.9L13.6 30.9Z"
      />
    </svg>
  );
}

function SketchManualAccountIcon() {
  return (
    <svg className="manual-dock__icon" viewBox="0 0 48 48" aria-hidden="true">
      <path
        className="manual-dock__soft"
        d="M12.5 13.6C17.1 10.5 30.2 10.7 35.8 13.9C39.5 16 38.8 19.3 34.2 20.8C28.4 22.7 17.1 22.1 12.8 19.1C9.7 16.9 10.3 15 12.5 13.6Z"
      />
      <path
        className="manual-dock__main"
        d="M14.4 15C18.5 12.8 28.7 12.8 33.5 15.2C36.2 16.6 35.6 18.5 32.7 19.5C27.5 21.1 18.5 20.8 14.5 18.4C12.5 17.2 12.7 15.9 14.4 15Z"
      />
      <path
        className="manual-dock__soft"
        d="M13.1 22.8C17.9 26 29.6 26.4 34.8 23.7L34.2 34.1C29.2 37.4 18.7 37.1 13.5 33.5L13.1 22.8Z"
      />
      <path
        className="manual-dock__main"
        d="M15.1 24.1C19.5 26.3 28.4 26.6 32.8 24.6L32.4 32.8C28 34.8 20.1 34.7 15.5 32.3L15.1 24.1Z"
      />
      <path className="manual-dock__main" d="M19.1 29.3L22.6 31.8L29.7 25.7" />
      <path className="manual-dock__accent" d="M34.3 10.8L34.3 17.6M30.9 14.2L37.7 14.2" />
    </svg>
  );
}

function SketchNewsIcon() {
  return (
    <svg className="news-dock__icon" viewBox="0 0 48 48" aria-hidden="true">
      <path
        className="news-dock__soft"
        d="M12.2 13.4C18.4 10.7 30.4 10.2 36.2 13.8L35.5 35.5C29.7 32.3 19.4 32.4 12.7 35.8L12.2 13.4Z"
      />
      <path
        className="news-dock__main"
        d="M14.3 14.8C19.6 12.8 29.2 12.7 33.9 15.1L33.4 32.9C28.2 30.8 20.1 30.9 14.8 33.2L14.3 14.8Z"
      />
      <path className="news-dock__main" d="M18.4 19.2L29.6 18.7" />
      <path className="news-dock__main" d="M18.4 23.8L30.1 23.4" />
      <path className="news-dock__main" d="M18.6 28.3L26.8 27.9" />
      <path className="news-dock__accent" d="M34.4 10.5C37.4 11.5 39.1 14.3 38.5 17.4" />
      <path className="news-dock__accent" d="M37.9 22.1C40.1 24.5 39.9 28.2 37.4 30.4" />
    </svg>
  );
}

function summarizePortfolioEntryAccounts(entry, language) {
  const sourceItems = (entry?.timelineItems?.length ? entry.timelineItems : entry?.items) ?? [];
  const labels = [];

  sourceItems.forEach((item) => {
    const rawLabel =
      item?.accountType ??
      item?.accountId ??
      item?.account ??
      item?.accountName ??
      item?.accountLabel ??
      '';
    const label = String(rawLabel).trim();

    if (label && !labels.includes(label)) {
      labels.push(label);
    }
  });

  const visibleLabels = labels.slice(0, 3).map((label) => compactLabel(label, 12));
  const extraCount = Math.max(0, labels.length - visibleLabels.length);
  const accountText = visibleLabels.length
    ? `${visibleLabels.join(', ')}${extraCount ? ` +${extraCount}` : ''}`
    : language === 'en'
      ? 'Unclassified portfolio'
      : '포트폴리오 정보 없음';
  const rowCount = sourceItems.length;
  const securityCount = entry?.items?.length ?? 0;

  return {
    accountText,
    rowCount,
    securityCount,
  };
}

function createManualPortfolioItem(row, index) {
  const accountName = String(row?.accountName ?? '').trim() || '직접 입력 포트폴리오';
  const stockName =
    String(row?.stockName ?? '').trim() ||
    String(row?.marketName ?? '').trim() ||
    String(row?.ticker ?? '').trim() ||
    `직접 입력 종목 ${index + 1}`;
  const ticker = String(row?.ticker ?? '').trim();
  const buyPrice = String(row?.buyPrice ?? '').trim();
  const shares = String(row?.shares ?? '').trim();
  const assetClass = String(row?.assetClass ?? '').trim() || '주식';
  const sector = String(row?.sector ?? '').trim();
  const marketPrice = String(row?.marketPrice ?? '').trim();
  const marketCurrency = String(row?.marketCurrency ?? '').trim();
  const marketUpdatedAt = String(row?.marketUpdatedAt ?? '').trim();
  const recordedAt = String(row?.recordedAt ?? '').trim() || formatDateKey();
  const returnDetail = formatReturnDetail(String(row?.returnRate ?? '0'), '수익률') || '0%';
  const fields = [
    { label: '포트폴리오명', value: accountName },
    { label: '종목명', value: stockName },
    { label: '종목 티커', value: ticker },
    { label: '날짜', value: recordedAt },
    { label: '매수가', value: buyPrice },
    { label: '보유수량', value: shares },
    { label: '수익률', value: returnDetail },
    { label: '자산군', value: assetClass },
    { label: '분야', value: sector },
    { label: '현재가', value: marketPrice },
    { label: '통화', value: marketCurrency },
    { label: '시세시각', value: marketUpdatedAt },
  ].filter((field) => String(field.value ?? '').trim());

  return {
    id:
      row?.id ||
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `manual-${Date.now()}-${index}`),
    label: stockName,
    name: stockName,
    detail: returnDetail,
    stockName,
    stockCode: ticker,
    ticker,
    code: ticker,
    accountType: accountName,
    accountName,
    recordedAt,
    buyPrice,
    shares,
    return: returnDetail,
    assetClass,
    sector,
    marketPrice,
    currency: marketCurrency,
    marketUpdatedAt,
    fields,
    metadataSource: 'manual-entry',
    metadataSourceByField: {
      accountType: 'manual',
      stockName: 'manual',
      stockCode: ticker ? 'manual' : 'fallback',
      buyPrice: buyPrice ? 'manual' : 'fallback',
      shares: shares ? 'manual' : 'fallback',
      return: 'manual',
      assetClass: 'manual',
    },
  };
}

function buildMarketSparklinePath(points, width = 320, height = 138) {
  const validPoints = points
    .filter((point) => Number.isFinite(point.close))
    .slice(-96);

  if (validPoints.length < 2) {
    return null;
  }

  const paddingX = 10;
  const paddingY = 12;
  const values = validPoints.map((point) => point.close);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || Math.max(1, Math.abs(max) * 0.01);
  const step = (width - paddingX * 2) / Math.max(1, validPoints.length - 1);
  const coords = validPoints.map((point, index) => {
    const x = paddingX + step * index;
    const y = height - paddingY - ((point.close - min) / range) * (height - paddingY * 2);
    return {
      x,
      y,
      time: point.time,
      close: point.close,
    };
  });
  const line = coords
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');
  const area = `${line} L${coords.at(-1).x.toFixed(2)} ${height - paddingY} L${coords[0].x.toFixed(2)} ${height - paddingY} Z`;

  return { line, area, min, max, latest: values.at(-1), first: values[0], points: coords };
}

function buildMarketInfoUrl(data) {
  const symbol = String(data?.symbol ?? '').trim().toUpperCase();

  if (!symbol) {
    return '';
  }

  const koreanCodeMatch = symbol.match(/^(\d{6})(?:\.(?:KS|KQ))?$/);

  if (koreanCodeMatch) {
    return `https://finance.naver.com/item/main.naver?code=${koreanCodeMatch[1]}`;
  }

  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
}

function formatMarketPointTime(value, language = 'ko') {
  if (!Number.isFinite(Number(value))) {
    return '';
  }

  return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(Number(value)));
}

function resolveMarketDisplayName(data) {
  return String(data?.displayName ?? data?.name ?? data?.rawName ?? data?.symbol ?? '').trim();
}

function normalizeCurrencyCode(value) {
  const code = String(value ?? '').trim().toUpperCase();

  return BASE_CURRENCY_OPTIONS.includes(code) ? code : '';
}

function inferCurrencyFromText(value) {
  const text = String(value ?? '').trim();

  if (/₩|KRW|원/i.test(text)) {
    return 'KRW';
  }

  if (/\$|USD|달러/i.test(text)) {
    return 'USD';
  }

  return '';
}

function normalizeUsdKrwRate(value) {
  const numeric = Number(value);

  return Number.isFinite(numeric) && numeric > 0 ? numeric : DEFAULT_USD_KRW_RATE;
}

function buildDisplayFxRates(usdKrwRate = DEFAULT_USD_KRW_RATE) {
  const rate = normalizeUsdKrwRate(usdKrwRate);

  return {
    USD: { KRW: rate },
    KRW: { USD: 1 / rate },
  };
}

function convertMarketValueForBase(value, sourceCurrency, baseCurrency, fxRates = DEFAULT_DISPLAY_FX_RATES) {
  const numeric = parseManualPriceValue(value);
  const source = normalizeCurrencyCode(sourceCurrency);
  const target = normalizeCurrencyCode(baseCurrency) || source;

  if (!Number.isFinite(numeric)) {
    return { value: null, currency: target || source };
  }

  if (!source || !target || source === target) {
    return { value: numeric, currency: target || source };
  }

  const rate = fxRates?.[source]?.[target];

  if (!Number.isFinite(rate)) {
    return { value: numeric, currency: source };
  }

  return { value: numeric * rate, currency: target };
}

function formatMarketPriceForBase(value, sourceCurrency, baseCurrency, fxRates) {
  const converted = convertMarketValueForBase(value, sourceCurrency, baseCurrency, fxRates);

  return formatMarketPrice(converted.value, converted.currency);
}

function formatMarketChangeForBase(value, sourceCurrency, baseCurrency, fxRates) {
  const converted = convertMarketValueForBase(value, sourceCurrency, baseCurrency, fxRates);

  if (!Number.isFinite(converted.value)) {
    return '-';
  }

  const sign = converted.value > 0 ? '+' : converted.value < 0 ? '-' : '';

  return `${sign}${formatMarketPrice(Math.abs(converted.value), converted.currency)}`;
}

function formatMoneyMetricForBase(value, sourceCurrency, baseCurrency, fxRates) {
  const trimmed = String(value ?? '').trim();

  if (!trimmed) {
    return '-';
  }

  const numeric = parseManualPriceValue(trimmed);

  if (!Number.isFinite(numeric)) {
    return trimmed;
  }

  return formatMarketPriceForBase(numeric, inferCurrencyFromText(trimmed) || sourceCurrency, baseCurrency, fxRates);
}

function formatFinancialMetricMeta(metric, language = 'ko') {
  const periodEnd = metric?.periodEnd
    ? new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'ko-KR', {
        year: 'numeric',
        month: 'short',
      }).format(new Date(metric.periodEnd))
    : '';
  const parts = [
    metric?.period,
    periodEnd,
    metric?.form,
  ].filter(Boolean);

  return parts.join(' · ');
}

function CompanyFinancialsPreview({ financials, status, error, language }) {
  const sections = Array.isArray(financials?.sections)
    ? financials.sections.filter((section) => section?.metrics?.length)
    : [];
  const sourceLinks = Array.isArray(financials?.sourceUrls) ? financials.sourceUrls.filter((source) => source?.url) : [];
  const hasSections = sections.length > 0;
  const title = language === 'en' ? 'Company Financials' : '기업 재무정보';

  if (status === 'idle') {
    return null;
  }

  return (
    <div className={`tool-drawer__financials is-${status}`}>
      <div className="tool-drawer__financials-head">
        <strong>{title}</strong>
        <small>
          {status === 'loading'
            ? language === 'en'
              ? 'checking filings'
              : '공시 확인 중'
            : financials?.updatedAt
              ? formatMarketTime(financials.updatedAt, language)
              : ''}
        </small>
      </div>

      {status === 'loading' ? (
        <p className="tool-drawer__financials-message">
          {language === 'en' ? 'Loading verified financial data.' : '확인 가능한 재무정보를 불러오는 중입니다.'}
        </p>
      ) : null}

      {status === 'error' ? (
        <p className="tool-drawer__financials-message">
          {error || (language === 'en' ? 'Could not load financial data.' : '재무정보를 가져오지 못했습니다.')}
        </p>
      ) : null}

      {status === 'empty' ? (
        <p className="tool-drawer__financials-message">
          {language === 'en'
            ? 'No verifiable company financials are available for this ticker.'
            : '이 티커에서 확인 가능한 기업 재무정보가 없습니다.'}
        </p>
      ) : null}

      {hasSections ? (
        <div className="tool-drawer__financials-sections">
          {sections.slice(0, 2).map((section) => (
            <section key={section.key} className="tool-drawer__financials-section">
              <div className="tool-drawer__financials-section-head">
                <strong>{section.title}</strong>
                <small>{section.source}</small>
              </div>
              <dl className="tool-drawer__financials-grid">
                {section.metrics.slice(0, 8).map((metric) => (
                  <div key={`${section.key}-${metric.key}`} className="tool-drawer__financial-metric">
                    <dt>{metric.label}</dt>
                    <dd>
                      <strong>{metric.displayValue || '-'}</strong>
                      <span>{formatFinancialMetricMeta(metric, language)}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      ) : null}

      {sourceLinks.length ? (
        <div className="tool-drawer__financials-source">
          <span>{language === 'en' ? 'Source' : '출처'}</span>
          {sourceLinks.slice(0, 2).map((source) => (
            <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
              {source.label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MarketLivePreview({
  data,
  status,
  error,
  language,
  baseCurrency = 'KRW',
  fxRates = DEFAULT_DISPLAY_FX_RATES,
  onApplyQuote,
  showApply = true,
  showStats = true,
}) {
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [financials, setFinancials] = useState(null);
  const [financialsStatus, setFinancialsStatus] = useState('idle');
  const [financialsError, setFinancialsError] = useState('');
  const isLoading = status === 'loading';
  const hasData = Boolean(data);
  const path = hasData ? buildMarketSparklinePath(data.points ?? []) : null;
  const changeAmountText = hasData ? formatMarketChangeForBase(data.change, data.currency, baseCurrency, fxRates) : '';
  const changePercentText = hasData ? formatMarketChangePercent(data.changePercent) : '';
  const tone = getSignedValueToneClass(data?.changePercent);
  const marketUrl = buildMarketInfoUrl(data);
  const displayName = resolveMarketDisplayName(data);

  const handleChartPointerMove = useCallback(
    (event) => {
      if (!path?.points?.length) {
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const relativeX = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 320;
      const nearest = path.points.reduce((closest, point) =>
        Math.abs(point.x - relativeX) < Math.abs(closest.x - relativeX) ? point : closest,
      );

      setHoveredPoint(nearest);
    },
    [path],
  );

  useEffect(() => {
    const symbol = String(data?.symbol ?? '').trim();

    if (!hasData || !symbol) {
      setFinancials(null);
      setFinancialsStatus('idle');
      setFinancialsError('');
      return undefined;
    }

    const controller = new AbortController();
    setFinancialsStatus('loading');
    setFinancialsError('');

    fetchCompanyFinancials({
      ticker: symbol,
      name: displayName,
      signal: controller.signal,
    })
      .then((payload) => {
        if (controller.signal.aborted) {
          return;
        }

        setFinancials(payload);
        setFinancialsStatus(payload?.status === 'empty' || !payload?.sections?.length ? 'empty' : 'ready');
      })
      .catch((financialsFetchError) => {
        if (controller.signal.aborted || financialsFetchError?.name === 'AbortError') {
          return;
        }

        setFinancials(null);
        setFinancialsStatus('error');
        setFinancialsError(
          language === 'en'
            ? 'Could not load company financials.'
            : '기업 재무정보를 가져오지 못했습니다.',
        );
      });

    return () => {
      controller.abort();
    };
  }, [data?.symbol, displayName, hasData, language]);

  const handleChartOpen = useCallback(() => {
    if (!marketUrl || typeof window === 'undefined') {
      return;
    }

    window.open(marketUrl, '_blank', 'noopener,noreferrer');
  }, [marketUrl]);

  if (!hasData && status === 'idle') {
    return (
      <section className="tool-drawer__market-preview is-empty">
        <p>
          {language === 'en'
            ? 'Enter a ticker to load live market data and a chart.'
            : '티커/코드를 입력하면 실시간 시세와 차트가 표시됩니다.'}
        </p>
      </section>
    );
  }

  return (
    <section className={`tool-drawer__market-preview${tone ? ` ${tone}` : ''}`}>
      <div className="tool-drawer__market-head">
        <span>
          <strong>{hasData ? data.symbol : language === 'en' ? 'Loading' : '조회 중'}</strong>
          <em title={displayName}>{hasData ? displayName : ''}</em>
        </span>
        <small>
          {isLoading
            ? language === 'en'
              ? 'updating'
              : '갱신 중'
            : hasData
              ? formatMarketTime(data.updatedAt, language)
              : ''}
        </small>
      </div>

      {hasData && showStats ? (
        <div className="tool-drawer__market-stats">
          <strong>{formatMarketPriceForBase(data.latestPrice, data.currency, baseCurrency, fxRates)}</strong>
          <span>
            {changeAmountText}
            {changePercentText ? ` · ${changePercentText}` : ''}
          </span>
        </div>
      ) : null}

      <button
        type="button"
        className="tool-drawer__market-chart"
        disabled={!marketUrl}
        onClick={handleChartOpen}
        onPointerMove={handleChartPointerMove}
        onPointerLeave={() => setHoveredPoint(null)}
        aria-label={language === 'en' ? 'Open stock information' : '주식 정보 웹으로 이동'}
      >
        {path ? (
          <svg viewBox="0 0 320 138" role="img" aria-label={language === 'en' ? 'Live stock chart' : '실시간 주식 차트'}>
            <defs>
              <linearGradient id="manualMarketArea" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="rgba(255, 247, 232, 0.26)" />
                <stop offset="100%" stopColor="rgba(255, 247, 232, 0)" />
              </linearGradient>
            </defs>
            <path className="tool-drawer__market-area" d={path.area} />
            <path className="tool-drawer__market-line" d={path.line} />
            {hoveredPoint ? (
              <g className="tool-drawer__market-hover-mark" aria-hidden="true">
                <line x1={hoveredPoint.x} x2={hoveredPoint.x} y1="8" y2="130" />
                <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r="3.2" />
              </g>
            ) : null}
          </svg>
        ) : (
          <p>
            {error ||
              (isLoading
                ? language === 'en'
                  ? 'Loading market chart...'
                  : '시세 차트를 불러오는 중입니다.'
                : language === 'en'
                  ? 'No chart data available.'
                  : '차트 데이터를 가져오지 못했습니다.')}
          </p>
        )}
        {hoveredPoint ? (
          <span
            className="tool-drawer__market-hover"
            style={{ left: `${(hoveredPoint.x / 320) * 100}%` }}
          >
            <em>{formatMarketPointTime(hoveredPoint.time, language)}</em>
            <strong>{formatMarketPriceForBase(hoveredPoint.close, data?.currency, baseCurrency, fxRates)}</strong>
          </span>
        ) : null}
      </button>

      <CompanyFinancialsPreview
        financials={financials}
        status={financialsStatus}
        error={financialsError}
        language={language}
      />

      <div className="tool-drawer__market-foot">
        <span>{hasData ? `${data.source} · ${data.range}/${data.interval}` : error}</span>
        {showApply ? (
          <button type="button" disabled={!hasData} onClick={onApplyQuote}>
            {language === 'en' ? 'Use quote' : '현재가 적용'}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function getItemFieldValue(item, labels) {
  const normalizedLabels = labels.map(normalizeDisplayKey);

  for (const field of item?.fields ?? []) {
    if (normalizedLabels.includes(normalizeDisplayKey(field?.label))) {
      return String(field?.value ?? '').trim();
    }
  }

  return '';
}

function resolveHoldingName(item) {
  return (
    String(item?.companyName ?? item?.name ?? item?.stockName ?? item?.label ?? '').trim() ||
    getItemFieldValue(item, ['종목명', 'stockName', 'name', 'companyName']) ||
    resolveHoldingTicker(item) ||
    '종목'
  );
}

function resolveHoldingTicker(item) {
  return (
    String(item?.ticker ?? item?.stockCode ?? item?.code ?? '').trim() ||
    getItemFieldValue(item, ['종목 티커', '종목코드', '티커', 'ticker', 'code', 'symbol'])
  );
}

function resolveHoldingAccount(item) {
  return (
    String(item?.accountType ?? item?.accountName ?? '').trim() ||
    getItemFieldValue(item, ['포트폴리오 유형', '포트폴리오명', '계좌유형', '계좌명', 'accountType', 'accountName']) ||
    '포트폴리오'
  );
}

function resolveHoldingGroupKey(item, index = 0) {
  const tickerKey = normalizeDisplayKey(resolveHoldingTicker(item));

  if (tickerKey) {
    return `code:${tickerKey}`;
  }

  const nameKey = normalizeDisplayKey(resolveHoldingName(item));

  if (nameKey) {
    return `name:${nameKey}`;
  }

  return `row:${index}`;
}

function buildGroupedHoldingItems(items) {
  const sourceItems = Array.isArray(items) ? items : [];

  if (sourceItems.length <= 1) {
    return sourceItems.map((item, index) => ({
      ...item,
      holdingGroupKey: resolveHoldingGroupKey(item, index),
      groupedSourceItemIds: [String(item?.id ?? '').trim()].filter(Boolean),
      groupedSourceItemIndexes: [index],
      groupedRowCount: 1,
    }));
  }

  const groupedItems = new Map();
  sourceItems.forEach((item, index) => {
    const key = resolveHoldingGroupKey(item, index);
    const bucket = groupedItems.get(key);
    const nextEntry = { item, index };

    if (bucket) {
      bucket.push(nextEntry);
      return;
    }

    groupedItems.set(key, [nextEntry]);
  });

  return [...groupedItems.entries()].map(([key, group]) => {
    const groupItems = group.map((entry) => entry.item);
    const representative =
      collapsePortfolioItemsForDisplayShared(groupItems)[0] ?? groupItems[groupItems.length - 1];
    const groupedSourceItemIds = group
      .map((entry) => String(entry.item?.id ?? '').trim())
      .filter(Boolean);

    return {
      ...representative,
      holdingGroupKey: key,
      groupedSourceItemIds,
      groupedSourceItemIndexes: group.map((entry) => entry.index),
      groupedRowCount: group.length,
    };
  });
}

function formatHoldingListMeta(item, language = 'ko') {
  const ticker = resolveHoldingTicker(item) || resolveHoldingAccount(item);
  const rowCount = Number(item?.groupedRowCount ?? 1);

  if (rowCount > 1) {
    const rowText = language === 'en' ? `${rowCount} rows` : `${rowCount}개 행`;
    return ticker ? `${ticker} · ${rowText}` : rowText;
  }

  return ticker;
}

function resolveHoldingAtomId(atoms, item, itemIndex) {
  const itemId = String(item?.id ?? '').trim();
  const tickerKey = normalizeDisplayKey(resolveHoldingTicker(item));
  const nameKey = normalizeDisplayKey(resolveHoldingName(item));

  if (itemId) {
    const byId = atoms.find((atom) => String(atom.sourceItemId ?? '').trim() === itemId);
    if (byId) {
      return byId.id;
    }
  }

  if (tickerKey) {
    const byTicker = atoms.find((atom) =>
      [atom.ticker, atom.stockCode, atom.code].some((value) => normalizeDisplayKey(value) === tickerKey),
    );
    if (byTicker) {
      return byTicker.id;
    }
  }

  if (nameKey) {
    const byName = atoms.find((atom) =>
      [atom.stockName, atom.name, atom.label].some((value) => normalizeDisplayKey(value) === nameKey),
    );
    if (byName) {
      return byName.id;
    }
  }

  return atoms[itemIndex]?.id ?? null;
}

function resolveHoldingMetric(item, labels) {
  return getItemFieldValue(item, labels) || '';
}

function StockDetailCard({
  item,
  language,
  baseCurrency = 'KRW',
  fxRates = DEFAULT_DISPLAY_FX_RATES,
  onEdit,
  onClose,
}) {
  const ticker = resolveHoldingTicker(item);
  const name = resolveHoldingName(item);
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!ticker && name.length < 2) {
      setStatus('idle');
      setData(null);
      setError('');
      return undefined;
    }

    const controller = new AbortController();

    const load = async () => {
      setStatus('loading');
      setError('');

      try {
        const nextData = await fetchLiveMarketData({
          ticker,
          name,
          signal: controller.signal,
        });

        if (controller.signal.aborted) {
          return;
        }

        setData(nextData);
        setStatus('ready');
      } catch {
        if (controller.signal.aborted) {
          return;
        }

        setData(null);
        setStatus('error');
        setError(language === 'en' ? 'Could not load details.' : '상세 시세를 가져오지 못했습니다.');
      }
    };

    load();
    const intervalId = window.setInterval(load, 30000);

    return () => {
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, [language, name, ticker]);

  const shares = resolveHoldingMetric(item, ['보유수량', 'shares', 'quantity']);
  const buyPrice = resolveHoldingMetric(item, ['매수가', 'buyPrice', 'purchasePrice']);
  const returnRate = String(item?.detail ?? item?.return ?? '').trim() ||
    resolveHoldingMetric(item, ['수익률', 'return']);
  const returnRateToneClass = getSignedValueToneClass(returnRate);
  const sourceCurrency =
    normalizeCurrencyCode(data?.currency) ||
    normalizeCurrencyCode(item?.marketCurrency) ||
    normalizeCurrencyCode(item?.currency) ||
    normalizeCurrencyCode(resolveHoldingMetric(item, ['통화', 'currency']));
  const currentPriceText = data
    ? formatMarketPriceForBase(data.latestPrice, data.currency, baseCurrency, fxRates)
    : '-';
  const yesterdayChange = data
    ? `${formatMarketChangeForBase(data.change, data.currency, baseCurrency, fxRates)} ${formatMarketChangePercent(data.changePercent)}`
    : '-';
  const buyPriceText = formatMoneyMetricForBase(buyPrice, sourceCurrency, baseCurrency, fxRates);
  const yesterdayChangeToneClass = getSignedValueToneClass(data?.changePercent);

  return (
    <section className="tool-drawer__holding-detail">
      <div className="tool-drawer__holding-detail-head">
        <span>
          <strong>{compactLabel(name, 22)}</strong>
          <em>{ticker || resolveHoldingAccount(item)}</em>
        </span>
        <div className="tool-drawer__holding-detail-actions">
          <button type="button" onClick={onEdit}>
            {language === 'en' ? 'Edit' : '수정'}
          </button>
          {onClose ? (
            <button
              type="button"
              className="tool-drawer__holding-detail-close"
              onClick={onClose}
              aria-label={language === 'en' ? 'Close stock details' : '종목 정보 닫기'}
            >
              ×
            </button>
          ) : null}
        </div>
      </div>

      <div className="tool-drawer__holding-metrics">
        <div>
          <span>{language === 'en' ? 'Live' : '현재가'}</span>
          <strong>{currentPriceText}</strong>
        </div>
        <div>
          <span>{language === 'en' ? 'Vs prev.' : '전일 대비'}</span>
          <strong className={yesterdayChangeToneClass}>
            {yesterdayChange}
          </strong>
        </div>
        <div>
          <span>{language === 'en' ? 'Shares' : '보유수량'}</span>
          <strong>{shares || '-'}</strong>
        </div>
        <div>
          <span>{language === 'en' ? 'Buy' : '매수가'}</span>
          <strong>{buyPriceText}</strong>
        </div>
        <div>
          <span>{language === 'en' ? 'Return' : '수익률'}</span>
          <strong className={returnRateToneClass}>{returnRate || '-'}</strong>
        </div>
      </div>

      <MarketLivePreview
        data={data}
        status={status}
        error={error}
        language={language}
        baseCurrency={baseCurrency}
        fxRates={fxRates}
        onApplyQuote={() => {}}
        showApply={false}
        showStats={false}
      />
    </section>
  );
}

function MarketNewsPanel({ language }) {
  const requestIdRef = useRef(0);
  const activeNewsAbortRef = useRef(null);
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [news, setNews] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');

  const loadNews = useCallback(
    async (nextQuery = '') => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      activeNewsAbortRef.current?.abort();
      const controller = new AbortController();
      activeNewsAbortRef.current = controller;
      const cleanQuery = String(nextQuery ?? '').trim();
      setStatus('loading');
      setError('');

      try {
        const payload = await fetchMarketNews({
          query: cleanQuery,
          language,
          mode: cleanQuery ? 'search' : 'today',
          refreshKey: `${Date.now()}-${requestId}`,
          signal: controller.signal,
        });

        if (requestIdRef.current !== requestId || controller.signal.aborted) {
          return;
        }

        setNews(payload);
        setStatus('ready');
      } catch {
        if (requestIdRef.current !== requestId || controller.signal.aborted) {
          return;
        }

        setNews(null);
        setStatus('error');
        setError(language === 'en' ? 'Could not load market news.' : '뉴스를 가져오지 못했습니다.');
      }
    },
    [language],
  );

  useEffect(() => {
    setSubmittedQuery('');
    loadNews('');

    return () => {
      requestIdRef.current += 1;
      activeNewsAbortRef.current?.abort();
    };
  }, [language, loadNews]);

  const handleSearch = useCallback(
    (event) => {
      event.preventDefault();
      const cleanQuery = query.trim();
      setSubmittedQuery(cleanQuery);
      loadNews(cleanQuery);
    },
    [loadNews, query],
  );

  const handleRefresh = useCallback(() => {
    loadNews(submittedQuery);
  }, [loadNews, submittedQuery]);

  const newsItems = news?.items ?? [];
  const isSearchMode = Boolean(submittedQuery || news?.mode === 'search');
  const metaLabel =
    news?.source ??
    (isSearchMode ? (language === 'en' ? 'Search results' : '검색 결과') : language === 'en' ? 'Latest stock news' : '최신 주식 뉴스');
  const emptyCopy = isSearchMode
    ? language === 'en' ? 'No matching news.' : '검색 결과가 없습니다.'
    : language === 'en' ? 'No recent stock news found.' : '최신 주식 뉴스를 찾지 못했습니다.';

  return (
    <div className="tool-drawer__news">
      <form className="tool-drawer__news-search" onSubmit={handleSearch}>
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={language === 'en' ? 'Ticker, company, theme, date' : '티커, 종목명, 테마, 날짜 검색'}
        />
        <button type="submit" disabled={status === 'loading'}>
          {language === 'en' ? 'Search' : '검색'}
        </button>
        <button type="button" onClick={handleRefresh} disabled={status === 'loading'}>
          {language === 'en' ? 'Refresh' : '새로고침'}
        </button>
      </form>

      <div className="tool-drawer__news-meta">
        <span>{metaLabel}</span>
        <em>
          {status === 'loading'
            ? language === 'en' ? 'updating' : '갱신 중'
            : news?.fetchedAt
              ? formatNewsTime(news.fetchedAt, language)
              : ''}
        </em>
      </div>

      {error ? <p className="tool-drawer__empty">{error}</p> : null}
      {!error && status !== 'loading' && newsItems.length === 0 ? (
        <p className="tool-drawer__empty">{emptyCopy}</p>
      ) : null}

      <div className="tool-drawer__news-list">
        {newsItems.map((article) => {
          const sourceLabel = /naver|네이버/i.test(article.source ?? '')
            ? language === 'en' ? 'Market news' : '주식 뉴스'
            : article.source;

          return (
            <a
              key={article.id}
              className="tool-drawer__news-card"
              href={article.link}
              target="_blank"
              rel="noopener noreferrer"
            >
              <strong>{article.title}</strong>
              <span>
                {sourceLabel}
                {article.publishedAt ? ` · ${formatNewsTime(article.publishedAt, language)}` : ''}
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
function HeatmapCard({
  heatmap,
  language,
  className = 'heatmap-panel',
  onPointerDown,
}) {
  const latestDataCell = [...heatmap.cells].reverse().find((cell) => cell.hasData) ?? null;
  const [activeKey, setActiveKey] = useState(latestDataCell?.key ?? null);
  const text = textFor(language);

  useEffect(() => {
    setActiveKey((current) =>
      heatmap.cells.some((cell) => cell.key === current && cell.hasData)
        ? current
        : latestDataCell?.key ?? null,
    );
  }, [heatmap, latestDataCell]);

  const activeCell =
    heatmap.cells.find((cell) => cell.key === activeKey && cell.hasData) ?? latestDataCell;
  const dayLabels =
    language === 'en'
      ? [
          { label: 'Mon', row: 1 },
          { label: 'Wed', row: 3 },
          { label: 'Fri', row: 5 },
        ]
      : [
          { label: '월', row: 1 },
          { label: '수', row: 3 },
          { label: '금', row: 5 },
        ];
  const legendSteps = [0.1, 0.28, 0.46, 0.68, 0.92];

  return (
    <aside className={className} onPointerDown={onPointerDown} aria-label={text.heatmapChartAria}>
      {heatmap.entriesCount ? (
        <>
          <div
            className="heatmap-panel__months"
            style={{ gridTemplateColumns: `repeat(${heatmap.weeks}, var(--heat-cell-size))` }}
          >
            {heatmap.monthLabels.map((month) => (
              <span
                key={`month-${month.index}`}
                className="heatmap-panel__month"
                style={{ gridColumnStart: month.index + 1 }}
              >
                {formatHeatmapMonthLabel(month.date, language)}
              </span>
            ))}
          </div>

          <div className="heatmap-panel__body">
            <div className="heatmap-panel__days">
              {dayLabels.map((day) => (
                <span
                  key={day.label}
                  className="heatmap-panel__day"
                  style={{ gridRowStart: day.row }}
                >
                  {day.label}
                </span>
              ))}
            </div>

            <div
              className="heatmap-panel__grid"
              style={{ gridTemplateColumns: `repeat(${heatmap.weeks}, var(--heat-cell-size))` }}
            >
              {heatmap.cells.map((cell, index) => (
                <div
                  key={cell.key}
                  className={`heatmap-panel__cell${cell.positive ? ' is-positive' : ''}${
                    cell.negative ? ' is-negative' : ''
                  }${cell.hasData ? ' has-data' : ''}${cell.key === activeKey ? ' is-active' : ''}`}
                  style={{
                    gridColumnStart: Math.floor(index / 7) + 1,
                    gridRowStart: (index % 7) + 1,
                    '--heat-alpha': cell.positive
                      ? (0.14 + (cell.positiveIntensity ?? cell.intensity) * 0.84).toFixed(3)
                      : 0,
                    '--heat-dark-alpha': cell.negative
                      ? (0.16 + (cell.negativeIntensity ?? cell.intensity) * 0.8).toFixed(3)
                      : 0,
                    borderRadius: `${1 + Math.round(noise(3901 + index * 7) * 2.2)}px`,
                  }}
                  onPointerEnter={() => {
                    if (cell.hasData) {
                      setActiveKey(cell.key);
                    }
                  }}
                />
              ))}
            </div>
          </div>

          <div className="heatmap-panel__footer">
            <div className="heatmap-panel__meta">
              {activeCell ? (
                <>
                  <span>{formatHeatmapDateLabel(activeCell.date, language)}</span>
                  <strong>{formatHeatmapValue(activeCell.value, heatmap.valueMode)}</strong>
                </>
              ) : null}
            </div>

            <div className="heatmap-panel__legend" aria-hidden="true">
              <span className="heatmap-panel__legend-label">{text.heatmapLess}</span>
              <div className="heatmap-panel__legend-scale">
                {legendSteps.map((step, index) => (
                  <span
                    key={`legend-step-${step}`}
                    className={`heatmap-panel__legend-cell${
                      index === 0 ? ' is-negative' : ''
                    }`}
                    style={{
                      '--legend-alpha': step.toFixed(3),
                      '--legend-dark-alpha': (0.28 + step * 0.54).toFixed(3),
                    }}
                  />
                ))}
              </div>
              <span className="heatmap-panel__legend-label">{text.heatmapMore}</span>
            </div>
          </div>
        </>
      ) : (
        <p className="heatmap-panel__empty">{text.heatmapEmpty}</p>
      )}
    </aside>
  );
}

function PortfolioAllocationRing({
  allocation,
  language,
  hoverInfo = null,
  setSegmentHover,
  clearSegmentHover,
  interactive = false,
  className = 'allocation-chart',
  decorative = false,
  compact = false,
}) {
  const text = textFor(language);
  const center = 96;
  const radius = 58;
  const segmentGapAngle = allocation.segments.length > 1 ? 0.068 : 0;
  const trackPathSoft = buildAllocationArcPath({
    centerX: center,
    centerY: center,
    radius,
    startAngle: 0.02,
    endAngle: Math.PI * 2 - 0.04,
    seed: 9123,
    wobble: 2.8,
  });
  const trackPathMain = buildAllocationArcPath({
    centerX: center,
    centerY: center,
    radius: radius - 0.6,
    startAngle: 0.04,
    endAngle: Math.PI * 2 - 0.02,
    seed: 9277,
    wobble: 2.1,
  });
  let offset = 0;

  return (
    <svg
      className={className}
      viewBox="0 0 192 192"
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : text.allocationChartAria}
      aria-hidden={decorative || undefined}
    >
      <g className="allocation-chart__base">
        <circle className="allocation-chart__glow" cx={center} cy={center} r="72" />
        <path className="allocation-chart__track-soft" d={trackPathSoft} />
        <path className="allocation-chart__track" d={trackPathMain} />
      </g>

      {allocation.segments.map((segment, index) => {
        const palette = ALLOCATION_SEGMENT_PALETTE[index % ALLOCATION_SEGMENT_PALETTE.length];
        const isHovered = interactive && hoverInfo?.segmentId === segment.id;
        const isDimmed = interactive && hoverInfo?.segmentId && !isHovered;
        const startAngle = -Math.PI / 2 + offset * Math.PI * 2 + segmentGapAngle * 0.5;
        const endAngle =
          -Math.PI / 2 + (offset + segment.weight) * Math.PI * 2 - segmentGapAngle * 0.5;
        const softPath = buildAllocationArcPath({
          centerX: center,
          centerY: center,
          radius: radius + 0.8,
          startAngle,
          endAngle,
          seed: 1103 + index * 79,
          wobble: 3.3,
        });
        const mainPath = buildAllocationArcPath({
          centerX: center,
          centerY: center,
          radius,
          startAngle,
          endAngle,
          seed: 1277 + index * 79,
          wobble: 2.6,
        });
        const highlightPath = buildAllocationArcPath({
          centerX: center,
          centerY: center,
          radius: radius - 1.6,
          startAngle: startAngle + 0.006,
          endAngle: endAngle - 0.006,
          seed: 1411 + index * 79,
          wobble: 2.1,
        });

        offset += segment.weight;

        if (!mainPath) {
          return null;
        }

        return (
          <g
            key={segment.id}
            className={`allocation-chart__segment-group${isHovered ? ' is-active' : ''}${
              isDimmed ? ' is-dimmed' : ''
            }`}
          >
            {compact ? null : (
              <>
                <circle
                  className="allocation-chart__segment-cap"
                  cx={center + Math.cos(startAngle) * radius}
                  cy={center + Math.sin(startAngle) * radius}
                  r="1.5"
                  fill={palette.main}
                />
                <circle
                  className="allocation-chart__segment-cap"
                  cx={center + Math.cos(endAngle) * radius}
                  cy={center + Math.sin(endAngle) * radius}
                  r="1.35"
                  fill={palette.highlight}
                />
              </>
            )}
            <path
              className="allocation-chart__segment-soft"
              d={softPath}
              stroke={palette.soft}
            />
            <path
              className="allocation-chart__segment"
              d={mainPath}
              stroke={palette.main}
            />
            <path
              className="allocation-chart__segment-highlight"
              d={highlightPath}
              stroke={palette.highlight}
            />
            {interactive ? (
              <path
                className="allocation-chart__segment-hit"
                d={softPath || mainPath}
                onPointerEnter={(event) => {
                  setSegmentHover?.(segment, event.clientX, event.clientY);
                }}
                onPointerMove={(event) => {
                  setSegmentHover?.(segment, event.clientX, event.clientY);
                }}
                onPointerLeave={() => {
                  clearSegmentHover?.();
                }}
              />
            ) : null}
          </g>
        );
      })}

      <g transform={`translate(${center} ${center})`}>
        {compact ? (
          <>
            <path className="allocation-chart__core-soft" d={buildBlotPath(28.8, 8801)} />
            <path className="allocation-chart__core-main" d={buildBlotPath(25.2, 8947)} />
            <path className="allocation-chart__core-ring" d={buildLoopPath(24.1, 9193)} />
          </>
        ) : (
          <>
            <path className="allocation-chart__core-soft" d={buildBlotPath(41.5, 8801)} />
            <path className="allocation-chart__core-main" d={buildBlotPath(38.2, 8947)} />
            <path className="allocation-chart__core-ring-soft" d={buildLoopPath(39.6, 9061)} />
            <path className="allocation-chart__core-ring" d={buildLoopPath(34.8, 9193)} />
          </>
        )}
      </g>
      {compact ? null : (
        <>
          <text className="allocation-chart__center-label" x={center} y="84" textAnchor="middle">
            {text.allocationTotalReturn}
          </text>
          <text
            className={`allocation-chart__center-value${
              allocation.hasReturnData && allocation.totalReturn > 0
                ? ' is-positive'
                : allocation.hasReturnData && allocation.totalReturn < 0
                  ? ' is-negative'
                  : ''
            }`}
            x={center}
            y="108"
            textAnchor="middle"
          >
            {allocation.hasReturnData ? formatHeatmapValue(allocation.totalReturn, 'percent') : '—'}
          </text>
        </>
      )}
    </svg>
  );
}

function PortfolioAllocationCard({
  allocation,
  language,
  className = 'allocation-panel',
  onInteract,
  onPointerDown,
}) {
  const panelRef = useRef(null);
  const text = textFor(language);
  const [hoverInfo, setHoverInfo] = useState(null);

  const resolveHoverPosition = (clientX, clientY) => {
    const bounds = panelRef.current?.getBoundingClientRect();

    if (!bounds) {
      return { x: 96, y: 34 };
    }

    return {
      x: clamp(clientX - bounds.left, 84, bounds.width - 84),
      y: clamp(clientY - bounds.top - 16, 48, bounds.height - 24),
    };
  };

  const setSegmentHover = (segment, clientX, clientY) => {
    setHoverInfo({
      segmentId: segment.id,
      x: resolveHoverPosition(clientX, clientY).x,
      y: resolveHoverPosition(clientX, clientY).y,
    });
  };

  const clearSegmentHover = () => {
    setHoverInfo(null);
  };

  const hoveredSegment =
    allocation.segments.find((segment) => segment.id === hoverInfo?.segmentId) ?? null;
  const hoveredSegmentLabel = hoveredSegment
    ? hoveredSegment.isUnknown
      ? text.allocationUnknown
      : translateDisplayValue(hoveredSegment.label, language)
    : '';

  return (
    <aside
      ref={panelRef}
      className={className}
      aria-label={text.allocationChartAria}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        onInteract?.();
      }}
    >
      <div className="allocation-panel__chart-wrap">
        <PortfolioAllocationRingView
          allocation={allocation}
          language={language}
          hoverInfo={hoverInfo}
          setSegmentHover={setSegmentHover}
          clearSegmentHover={clearSegmentHover}
          interactive
        />
      </div>

      {hoveredSegment && hoverInfo ? (
        <div
          className="allocation-panel__tooltip"
          style={{
            left: `${hoverInfo.x}px`,
            top: `${hoverInfo.y}px`,
          }}
        >
          <strong className="allocation-panel__tooltip-title">{hoveredSegmentLabel}</strong>
          <span className="allocation-panel__tooltip-value">
            {text.allocationShareLabel} {formatAllocationPercent(hoveredSegment.weight)}
          </span>
        </div>
      ) : null}

      <div className="allocation-panel__legend">
        {allocation.segments.map((segment, index) => {
          const palette = ALLOCATION_SEGMENT_PALETTE[index % ALLOCATION_SEGMENT_PALETTE.length];
          const label = segment.isUnknown
            ? text.allocationUnknown
            : translateDisplayValue(segment.label, language);
          const isHovered = hoverInfo?.segmentId === segment.id;
          const isDimmed = hoverInfo?.segmentId && !isHovered;

          return (
            <div
              key={`legend-${segment.id}`}
              className={`allocation-panel__legend-row${isHovered ? ' is-active' : ''}${
                isDimmed ? ' is-dimmed' : ''
              }`}
              onPointerEnter={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setSegmentHover(segment, rect.left + rect.width * 0.5, rect.top);
              }}
              onPointerMove={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setSegmentHover(segment, rect.left + rect.width * 0.5, rect.top);
              }}
              onPointerLeave={clearSegmentHover}
            >
              <span
                className="allocation-panel__swatch"
                style={{ '--segment-color': palette.main, '--segment-shadow': palette.glow }}
                aria-hidden="true"
              />
              <span className="allocation-panel__legend-label">{label}</span>
              <span className="allocation-panel__legend-value">{formatAllocationPercent(segment.weight)}</span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function PortfolioAllocationWidget({
  allocation,
  language,
  anchorRef,
  anchorSelector,
  anchorPosition,
  anchorSize,
  anchorSteps = 1,
  resetSignal,
  visible = true,
  settingsOpen = false,
  layerStyle,
  onInteract,
}) {
  const text = textFor(language);
  const [open, setOpen] = useState(false);
  const pendingResetRef = useRef(0);

  const resolveAnchorRect = () =>
    anchorRef?.current?.getBoundingClientRect() ??
    (anchorSelector && typeof document !== 'undefined'
      ? document.querySelector(anchorSelector)?.getBoundingClientRect()
      : null);

  const allocationDock = useFloatingHandle({
    initialPosition: (win) => {
      const size = allocationWidgetSizeFor(win.innerWidth);
      const currentAnchorSize = anchorSize ?? scoreDockSizeFor(win.innerWidth);
      const rect = resolveAnchorRect();

      if (rect) {
        return stackDockBelowRect(
          rect,
          currentAnchorSize,
          size,
          win.innerWidth,
          win.innerHeight,
          anchorSteps,
        );
      }

      if (anchorPosition) {
        return stackDockBelow(
          anchorPosition.x,
          anchorPosition.y,
          currentAnchorSize,
          size,
          win.innerWidth,
          win.innerHeight,
          anchorSteps,
        );
      }

      const inset = uiInsetFor(win.innerWidth);

      return stackDockBelow(
        inset,
        inset,
        toolTriggerSizeFor(win.innerWidth),
        size,
        win.innerWidth,
        win.innerHeight,
        4,
      );
    },
    fallbackSize: (width) => {
      const size = allocationWidgetSizeFor(width);
      return { width: size, height: size };
    },
    measureBounds: ({ container, fallback, viewportWidth, nextX }) => {
      if (!open) {
        return fallback;
      }

      const panel = container?.querySelector('.allocation-panel');
      const panelWidth = panel?.offsetWidth ?? Math.min(13.8 * 16, viewportWidth - 32);
      const panelHeight = panel?.offsetHeight ?? 0;
      const panelOffset = (viewportWidth <= MOBILE_BREAKPOINT ? 0.34 : 0.55) * 16;
      const panelReachX = Math.max(0, panelWidth + panelOffset - fallback.width);
      const panelSide = floatingPanelSideFor(nextX ?? container?.getBoundingClientRect().left ?? 0, fallback.width, viewportWidth);

      return {
        width: fallback.width + panelReachX,
        height: Math.max(fallback.height, panelHeight + panelOffset),
        offsetX: panelSide === 'left' ? -panelReachX : 0,
        offsetY: 0,
      };
    },
    onInteract,
    onPress: () => {
      setOpen((current) => !current);
    },
    continuousFollow: true,
    storageKey: STORAGE_KEYS.allocationDockPosition,
  });

  useEffect(() => {
    if (!resetSignal) {
      return;
    }

    pendingResetRef.current = resetSignal;
    setOpen(false);
  }, [resetSignal]);

  useEffect(() => {
    if (!pendingResetRef.current || !resetSignal || typeof window === 'undefined') {
      return undefined;
    }

    let outerFrameId = 0;
    let innerFrameId = 0;

    outerFrameId = window.requestAnimationFrame(() => {
      innerFrameId = window.requestAnimationFrame(() => {
        if (pendingResetRef.current !== resetSignal) {
          return;
        }

        allocationDock.snapToInitial();
        pendingResetRef.current = 0;
      });
    });

    return () => {
      window.cancelAnimationFrame(outerFrameId);
      window.cancelAnimationFrame(innerFrameId);
    };
  }, [
    allocationDock.snapToInitial,
    anchorPosition?.x,
    anchorPosition?.y,
    anchorSteps,
    resetSignal,
  ]);

  useEffect(() => {
    if (!open || !visible) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, visible]);

  const panelSide =
    typeof window === 'undefined'
      ? 'right'
      : floatingPanelSideFor(
          allocationDock.position.x,
          allocationWidgetSizeFor(window.innerWidth),
          window.innerWidth,
        );

  return (
    <div
      ref={allocationDock.containerRef}
      className={`allocation-widget${panelSide === 'left' ? ' is-flipped' : ''}${open ? ' is-open' : ''}${allocationDock.dragging ? ' is-dragging' : ''}${visible ? '' : ' is-hidden'}`}
      style={{
        transform: `translate3d(${allocationDock.position.x}px, ${allocationDock.position.y}px, 0)`,
        ...layerStyle,
      }}
    >
      <button
        type="button"
        className={`allocation-toggle${open ? ' is-open' : ''}`}
        aria-label={text.allocationChartAria}
        aria-expanded={open}
        onPointerDown={allocationDock.handlePointerDown}
        onClick={(event) => {
          if (event.detail !== 0) {
            return;
          }

          onInteract?.();
          setOpen((current) => !current);
        }}
      >
        <PortfolioAllocationRingView
          allocation={allocation}
          language={language}
          className="allocation-toggle__icon"
          decorative
          compact
        />
      </button>

      {open ? (
        <PortfolioAllocationCardView
          allocation={allocation}
          language={language}
          onInteract={onInteract}
          onPointerDown={allocationDock.handleDragPointerDown}
        />
      ) : null}
    </div>
  );
}

function FloatingDigitalTwinDock({
  items,
  timelineItems,
  language = 'ko',
  anchorRef,
  anchorSelector,
  anchorPosition,
  anchorSize,
  anchorSteps = 5,
  resetSignal,
  visible = true,
  layerStyle,
  onInteract,
}) {
  const [open, setOpen] = useState(false);
  const pendingResetRef = useRef(0);

  const resolveAnchorRect = () =>
    anchorRef?.current?.getBoundingClientRect() ??
    (anchorSelector && typeof document !== 'undefined'
      ? document.querySelector(anchorSelector)?.getBoundingClientRect()
      : null);

  const twinDock = useFloatingHandle({
    initialPosition: (win) => {
      const size = twinDockSizeFor(win.innerWidth);
      const currentAnchorSize = anchorSize ?? toolTriggerSizeFor(win.innerWidth);
      const rect = resolveAnchorRect();

      if (rect) {
        return stackDockBelowRect(
          rect,
          currentAnchorSize,
          size,
          win.innerWidth,
          win.innerHeight,
          anchorSteps,
        );
      }

      if (anchorPosition) {
        return stackDockBelow(
          anchorPosition.x,
          anchorPosition.y,
          currentAnchorSize,
          size,
          win.innerWidth,
          win.innerHeight,
          anchorSteps,
        );
      }

      const inset = uiInsetFor(win.innerWidth);

      return stackDockBelow(
        inset,
        inset,
        toolTriggerSizeFor(win.innerWidth),
        size,
        win.innerWidth,
        win.innerHeight,
        anchorSteps,
      );
    },
    fallbackSize: (width) => {
      const size = twinDockSizeFor(width);
      return { width: size, height: size };
    },
    measureBounds: ({ container, fallback, viewportWidth, nextX }) => {
      if (!open) {
        return fallback;
      }

      const panel = container?.querySelector('.twin-panel');
      const panelWidth = panel?.offsetWidth ?? Math.min(24 * 16, viewportWidth - 32);
      const panelHeight = panel?.offsetHeight ?? Math.min(36 * 16, window.innerHeight - 32);
      const panelOffset = (viewportWidth <= MOBILE_BREAKPOINT ? 0.34 : 0.55) * 16;
      const panelReachX = Math.max(0, panelWidth + panelOffset - fallback.width);
      const panelSide = floatingPanelSideFor(
        nextX ?? container?.getBoundingClientRect().left ?? 0,
        fallback.width,
        viewportWidth,
      );

      return {
        width: fallback.width + panelReachX,
        height: Math.max(fallback.height, panelHeight + panelOffset),
        offsetX: panelSide === 'left' ? -panelReachX : 0,
        offsetY: 0,
      };
    },
    onInteract,
    onPress: () => {
      setOpen((current) => !current);
    },
    continuousFollow: true,
    storageKey: STORAGE_KEYS.twinDockPosition,
  });

  useEffect(() => {
    if (!resetSignal) {
      return;
    }

    pendingResetRef.current = resetSignal;
    setOpen(false);
  }, [resetSignal]);

  useEffect(() => {
    if (!pendingResetRef.current || !resetSignal || typeof window === 'undefined') {
      return undefined;
    }

    let outerFrameId = 0;
    let innerFrameId = 0;

    outerFrameId = window.requestAnimationFrame(() => {
      innerFrameId = window.requestAnimationFrame(() => {
        if (pendingResetRef.current !== resetSignal) {
          return;
        }

        twinDock.snapToInitial();
        pendingResetRef.current = 0;
      });
    });

    return () => {
      window.cancelAnimationFrame(outerFrameId);
      window.cancelAnimationFrame(innerFrameId);
    };
  }, [
    twinDock.snapToInitial,
    anchorPosition?.x,
    anchorPosition?.y,
    anchorSteps,
    resetSignal,
  ]);

  useEffect(() => {
    if (!open || !visible) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, visible]);

  const panelSide =
    typeof window === 'undefined'
      ? 'right'
      : floatingPanelSideFor(
          twinDock.position.x,
          twinDockSizeFor(window.innerWidth),
          window.innerWidth,
        );

  return (
    <div
      ref={twinDock.containerRef}
      className={`twin-dock${panelSide === 'left' ? ' is-flipped' : ''}${open ? ' is-open' : ''}${twinDock.dragging ? ' is-dragging' : ''}${visible ? '' : ' is-hidden'}`}
      style={{
        transform: `translate3d(${twinDock.position.x}px, ${twinDock.position.y}px, 0)`,
        ...layerStyle,
      }}
    >
      <button
        type="button"
        className={`twin-dock__toggle${open ? ' is-open' : ''}`}
        aria-label={language === 'en' ? 'Investment Simulation' : '투자 시뮬레이션'}
        aria-expanded={open}
        onPointerDown={twinDock.handlePointerDown}
        onClick={(event) => {
          if (event.detail !== 0) {
            return;
          }

          onInteract?.();
          setOpen((current) => !current);
        }}
      >
        <SketchTwinIcon />
      </button>

      {open ? (
        <DigitalTwinPanel
          items={items}
          timelineItems={timelineItems}
          className="is-open"
          onPointerDown={twinDock.handleDragPointerDown}
        />
      ) : null}
    </div>
  );
}

function ToolSideDrawer({
  open,
  activeTool,
  onSelectTool,
  groupOptions,
  activeGroupKey,
  onGroupChange,
  heatmap,
  allocation,
  analyticsSummary,
  scorecard,
  overallScorecard,
  scoreAxes,
  scoreWeightPreset,
  onScoreWeightPresetChange,
  items,
  timelineItems,
  portfolioEntries = [],
  activePortfolio = null,
  activePortfolioId,
  onSelectPortfolio,
  onFocusHolding,
  onClearHoldingFocus,
  onClearPortfolio,
  onOpenPortfolioPicker,
  onCreateManualAtom,
  onCreateManualPortfolio,
  onAppendManualHoldings,
  onUpdatePortfolioHolding,
  onRemovePortfolioHolding,
  drawerWidth = TOOL_DRAWER_DEFAULT_WIDTH,
  onDrawerWidthChange,
  language,
  baseCurrency = 'KRW',
  fxRates = DEFAULT_DISPLAY_FX_RATES,
  layerStyle,
  onInteract,
}) {
  const text = textFor(language);
  const [resizing, setResizing] = useState(false);
  const [manualAccountName, setManualAccountName] = useState('');
  const [manualStockName, setManualStockName] = useState('');
  const [manualTicker, setManualTicker] = useState('');
  const [manualBuyPrice, setManualBuyPrice] = useState('');
  const [manualShares, setManualShares] = useState('');
  const [manualReturnRate, setManualReturnRate] = useState('');
  const [manualAssetClass, setManualAssetClass] = useState('주식');
  const [manualRows, setManualRows] = useState([]);
  const [manualMarketData, setManualMarketData] = useState(null);
  const [manualMarketStatus, setManualMarketStatus] = useState('idle');
  const [manualMarketError, setManualMarketError] = useState('');
  const [manualMarketSuggestions, setManualMarketSuggestions] = useState([]);
  const [manualSuggestionStatus, setManualSuggestionStatus] = useState('idle');
  const [manualSuggestionLocked, setManualSuggestionLocked] = useState(false);
  const [editingHolding, setEditingHolding] = useState(null);
  const [selectedHolding, setSelectedHolding] = useState(null);
  const [aiSummary, setAiSummary] = useState(null);
  const [aiSummaryStatus, setAiSummaryStatus] = useState('idle');
  const [aiSummaryError, setAiSummaryError] = useState('');
  const manualSuggestionRef = useRef(null);
  const manualDraftRef = useRef({
    stockName: '',
    ticker: '',
    buyPrice: '',
    returnRate: '',
  });
  const tools = [
    {
      key: 'accounts',
      label: language === 'en' ? 'Portfolios' : '포트폴리오 목록',
      icon: <SketchAccountStackIcon />,
      available: true,
    },
    {
      key: 'manual',
      label: language === 'en' ? 'Add Stock' : '종목 추가',
      icon: <SketchManualAccountIcon />,
      available: true,
    },
    {
      key: 'overview',
      label: language === 'en' ? 'Overview' : '요약',
      icon: <SketchBurstIcon />,
      available: Boolean(analyticsSummary || heatmap || allocation || scorecard || groupOptions.length),
    },
    {
      key: 'ai',
      label: language === 'en' ? 'AI Summary' : 'AI 요약',
      icon: <SketchSpiralIcon />,
      available: Boolean(activePortfolio?.id || items.length),
    },
    {
      key: 'compare',
      label: language === 'en' ? 'Compare' : '비교',
      icon: <SketchAccountStackIcon />,
      available: portfolioEntries.length >= 2,
    },
    {
      key: 'report',
      label: language === 'en' ? 'Monthly Report' : '월간 리포트',
      icon: <SketchBurstIcon />,
      available: Boolean(analyticsSummary?.profitFlow?.length),
    },
    {
      key: 'twin',
      label: language === 'en' ? 'Investment Simulation' : '투자 시뮬레이션',
      icon: <SketchTwinIcon />,
      available: true,
    },
    {
      key: 'news',
      label: language === 'en' ? 'Market News' : '시장 뉴스',
      icon: <SketchNewsIcon />,
      available: true,
    },
  ].filter((tool) => tool.available);
  const resolvedTool =
    tools.find((tool) => tool.key === activeTool) ??
    tools.find((tool) => tool.key === 'accounts') ??
    null;
  const clampDrawerWidth = useCallback((nextWidth) => {
    if (typeof window === 'undefined') {
      return clamp(nextWidth, 300, TOOL_DRAWER_MAX_WIDTH);
    }

    const viewportWidth = window.innerWidth;
    const minWidth = Math.min(300, Math.max(248, viewportWidth - 72));
    const maxWidth = Math.max(minWidth, Math.min(TOOL_DRAWER_MAX_WIDTH, viewportWidth - 34));

    return clamp(nextWidth, minWidth, maxWidth);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleResize = () => {
      onDrawerWidthChange?.((current) => clampDrawerWidth(current));
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [clampDrawerWidth, onDrawerWidthChange]);

  useEffect(() => {
    manualDraftRef.current = {
      stockName: manualStockName,
      ticker: manualTicker,
      buyPrice: manualBuyPrice,
      returnRate: manualReturnRate,
    };
  }, [manualBuyPrice, manualReturnRate, manualStockName, manualTicker]);

  useEffect(() => {
    const query = manualStockName.trim();

    if (
      !open ||
      resolvedTool?.key !== 'manual' ||
      manualSuggestionLocked ||
      (query.length < 2 && !/[가-힣]/.test(query))
    ) {
      setManualMarketSuggestions([]);
      setManualSuggestionStatus('idle');
      return undefined;
    }

    const controller = new AbortController();
    setManualSuggestionStatus('loading');

    const timerId = window.setTimeout(async () => {
      try {
        const suggestions = await fetchMarketSymbolSuggestions({
          query,
          limit: 8,
          signal: controller.signal,
        });

        if (controller.signal.aborted) {
          return;
        }

        setManualMarketSuggestions(suggestions);
        setManualSuggestionStatus('ready');
      } catch {
        if (controller.signal.aborted) {
          return;
        }

        setManualMarketSuggestions([]);
        setManualSuggestionStatus('error');
      }
    }, 220);

    return () => {
      controller.abort();
      window.clearTimeout(timerId);
    };
  }, [manualStockName, manualSuggestionLocked, open, resolvedTool?.key]);

  useEffect(() => {
    const ticker = manualTicker.trim();
    const name = manualStockName.trim();

    if (!open || resolvedTool?.key !== 'manual' || (!ticker && name.length < 2)) {
      setManualMarketStatus('idle');
      setManualMarketError('');
      setManualMarketData(null);
      return undefined;
    }

    const controller = new AbortController();
    const queryKey = `${ticker}|${name}`;
    let intervalId = 0;

    const loadMarketData = async (silent = false) => {
      if (!silent) {
        setManualMarketStatus('loading');
        setManualMarketError('');
        setManualMarketData(null);
      }

      try {
        const nextData = await fetchLiveMarketData({
          ticker,
          name,
          signal: controller.signal,
        });

        if (controller.signal.aborted) {
          return;
        }

        setManualMarketData({ ...nextData, queryKey });
        setManualMarketStatus('ready');
        setManualMarketError('');

        const currentDraft = manualDraftRef.current;
        const nextBuyPrice = currentDraft.buyPrice.trim() || formatMarketInputPrice(nextData.latestPrice);
        if (!currentDraft.buyPrice.trim() && nextBuyPrice) {
          setManualBuyPrice(nextBuyPrice);
        }
        const nextReturnRate = calculateReturnRateFromBuyPrice(nextBuyPrice, nextData.latestPrice);
        if (nextReturnRate) {
          setManualReturnRate(nextReturnRate);
        }
        if (nextData.assetClass) {
          setManualAssetClass((current) =>
            !current.trim() || current === '주식' ? nextData.assetClass : current,
          );
        }
      } catch {
        if (controller.signal.aborted) {
          return;
        }

        setManualMarketStatus('error');
        setManualMarketError(
          language === 'en'
            ? 'Could not load live market data.'
            : '실시간 시세를 가져오지 못했습니다.',
        );
        setManualMarketData(null);
      }
    };

    const timerId = window.setTimeout(() => {
      loadMarketData(false);
      intervalId = window.setInterval(() => loadMarketData(true), 30000);
    }, 520);

    return () => {
      controller.abort();
      window.clearTimeout(timerId);
      window.clearInterval(intervalId);
    };
  }, [language, manualStockName, manualTicker, open, resolvedTool?.key]);

  useEffect(() => {
    if (!manualBuyPrice.trim()) {
      setManualReturnRate('');
      return;
    }

    const nextReturnRate = calculateReturnRateFromBuyPrice(
      manualBuyPrice,
      manualMarketData?.latestPrice,
    );

    if (!nextReturnRate) {
      return;
    }

    setManualReturnRate((current) => (current === nextReturnRate ? current : nextReturnRate));
  }, [manualBuyPrice, manualMarketData]);

  const handleResizePointerDown = useCallback(
    (event) => {
      if (!open || event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onInteract?.();

      const startX = event.clientX;
      const startWidth = drawerWidth;
      setResizing(true);

      const handlePointerMove = (moveEvent) => {
        moveEvent.preventDefault();
        onDrawerWidthChange?.(clampDrawerWidth(startWidth + moveEvent.clientX - startX));
      };

      const stopResize = () => {
        setResizing(false);
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', stopResize);
        window.removeEventListener('pointercancel', stopResize);
      };

      window.addEventListener('pointermove', handlePointerMove, { passive: false });
      window.addEventListener('pointerup', stopResize);
      window.addEventListener('pointercancel', stopResize);
    },
    [clampDrawerWidth, drawerWidth, onDrawerWidthChange, onInteract, open],
  );

  const handleResizeKeyDown = useCallback(
    (event) => {
      if (!open) {
        return;
      }

      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
        return;
      }

      event.preventDefault();
      onInteract?.();
      onDrawerWidthChange?.((current) =>
        clampDrawerWidth(current + (event.key === 'ArrowRight' ? 24 : -24)),
      );
    },
    [clampDrawerWidth, onDrawerWidthChange, onInteract, open],
  );

  const hasAtomName = manualAccountName.trim().length > 0;
  const hasManualStockDraft = manualStockName.trim().length > 0 || manualTicker.trim().length > 0;
  const hasManualDraft = hasManualStockDraft && (Boolean(activePortfolio?.id) || hasAtomName);
  const makeManualDraftRow = useCallback(
    () => {
      if (!hasManualDraft) {
        return null;
      }

      return {
        accountName:
          activePortfolio?.id
            ? activePortfolio.fileName?.replace(/\.manual\.csv$/i, '') ||
              summarizePortfolioEntryAccounts(activePortfolio, language).accountText ||
              '직접 입력 포트폴리오'
            : manualAccountName.trim() || '직접 입력 포트폴리오',
        stockName: resolveMarketDisplayName(manualMarketData) || manualStockName.trim() || manualTicker.trim(),
        ticker: manualMarketData?.symbol || manualTicker.trim() || '',
        buyPrice: manualBuyPrice.trim() || formatMarketInputPrice(manualMarketData?.latestPrice),
        shares: manualShares.trim(),
        returnRate:
          manualReturnRate.trim() ||
          calculateReturnRateFromBuyPrice(
            manualBuyPrice.trim() || formatMarketInputPrice(manualMarketData?.latestPrice),
            manualMarketData?.latestPrice,
          ),
        assetClass: manualAssetClass.trim() || '주식',
        sector: manualMarketData?.sector || '',
        marketName: resolveMarketDisplayName(manualMarketData) || '',
        marketPrice: Number.isFinite(manualMarketData?.latestPrice)
          ? formatMarketPrice(manualMarketData.latestPrice, manualMarketData.currency)
          : '',
        marketCurrency: manualMarketData?.currency || '',
        marketUpdatedAt: manualMarketData?.updatedAt
          ? formatMarketTime(manualMarketData.updatedAt, language)
          : '',
        recordedAt: formatDateKey(),
      };
    },
    [
      activePortfolio,
      hasManualDraft,
      language,
      manualAccountName,
      manualAssetClass,
      manualBuyPrice,
      manualMarketData,
      manualReturnRate,
      manualShares,
      manualStockName,
      manualTicker,
    ],
  );
  const clearManualStockFields = useCallback(() => {
    setManualStockName('');
    setManualTicker('');
    setManualBuyPrice('');
    setManualShares('');
    setManualReturnRate('');
    setManualAssetClass('주식');
    setManualSuggestionLocked(false);
  }, []);
  const handleCreateManualAtom = useCallback(() => {
    if (!hasAtomName || portfolioEntries.length >= MAX_PORTFOLIOS) {
      return;
    }

    onInteract?.();
    onCreateManualAtom?.({
      accountName: manualAccountName.trim(),
    });
    setManualRows([]);
    clearManualStockFields();
    setManualAccountName('');
    onSelectTool?.('manual');
  }, [
    clearManualStockFields,
    hasAtomName,
    manualAccountName,
    onCreateManualAtom,
    onInteract,
    onSelectTool,
    portfolioEntries.length,
  ]);
  const handleAddManualRow = useCallback(() => {
    if (editingHolding) {
      return;
    }

    const draft = makeManualDraftRow();

    if (!draft) {
      return;
    }

    onInteract?.();
    setManualRows((current) => [
      ...current,
      {
        ...draft,
        id:
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `manual-row-${Date.now()}-${current.length}`,
      },
    ]);
    clearManualStockFields();
  }, [clearManualStockFields, editingHolding, makeManualDraftRow, onInteract]);
  const handleSaveManualPortfolio = useCallback(() => {
    const draft = makeManualDraftRow();

    if (editingHolding) {
      if (!draft) {
        return;
      }

      onInteract?.();
      onUpdatePortfolioHolding?.({
        entryId: editingHolding.entryId,
        itemId: editingHolding.itemId,
        itemIndex: editingHolding.itemIndex,
        accountName: manualAccountName.trim() || resolveHoldingAccount(editingHolding.item),
        row: draft,
      });
      setEditingHolding(null);
      setManualRows([]);
      clearManualStockFields();
      setManualAccountName('');
      onSelectTool?.('accounts');
      return;
    }

    const rows = draft ? [...manualRows, draft] : manualRows;

    if (!rows.length || portfolioEntries.length >= MAX_PORTFOLIOS) {
      return;
    }

    onInteract?.();
    onCreateManualPortfolio?.({
      accountName: manualAccountName.trim() || '직접 입력 포트폴리오',
      rows,
    });
    setManualRows([]);
    setManualAccountName('');
    clearManualStockFields();
  }, [
    clearManualStockFields,
    editingHolding,
    makeManualDraftRow,
    manualAccountName,
    manualRows,
    onCreateManualPortfolio,
    onInteract,
    onSelectTool,
    onUpdatePortfolioHolding,
    portfolioEntries.length,
  ]);
  const handleAppendManualRows = useCallback(() => {
    const draft = makeManualDraftRow();
    const rows = draft ? [...manualRows, draft] : manualRows;

    if (!activePortfolio?.id || !rows.length) {
      return;
    }

    onInteract?.();
    onAppendManualHoldings?.({
      entryId: activePortfolio.id,
      accountName:
        activePortfolio.fileName?.replace(/\.manual\.csv$/i, '') ||
        summarizePortfolioEntryAccounts(activePortfolio, language).accountText ||
        '직접 입력 포트폴리오',
      rows,
    });
    setManualRows([]);
    clearManualStockFields();
    setManualAccountName('');
    onSelectTool?.('accounts');
  }, [
    activePortfolio,
    clearManualStockFields,
    language,
    makeManualDraftRow,
    manualRows,
    onAppendManualHoldings,
    onInteract,
    onSelectTool,
  ]);
  const removeManualRow = useCallback((rowId) => {
    setManualRows((current) => current.filter((row) => row.id !== rowId));
  }, []);
  const beginEditHolding = useCallback(
    (entry, item, itemIndex) => {
      if (!entry || !item) {
        return;
      }

      onInteract?.();
      setEditingHolding({
        entryId: entry.id,
        itemId: item.id ?? '',
        itemIndex,
        item,
      });
      setManualRows([]);
      setManualAccountName(resolveHoldingAccount(item));
      setManualStockName(resolveHoldingName(item));
      setManualTicker(resolveHoldingTicker(item));
      setManualSuggestionLocked(true);
      setManualBuyPrice(resolveHoldingMetric(item, ['매수가', 'buyPrice', 'purchasePrice']));
      setManualShares(resolveHoldingMetric(item, ['보유수량', 'shares', 'quantity']));
      setManualReturnRate(
        String(item?.detail ?? item?.return ?? '').trim() ||
          resolveHoldingMetric(item, ['수익률', 'return']),
      );
      setManualAssetClass(String(item?.assetClass ?? '').trim() || '주식');
      onSelectTool?.('manual');
    },
    [onInteract, onSelectTool],
  );
  const cancelEditingHolding = useCallback(() => {
    setEditingHolding(null);
    setManualRows([]);
    setManualAccountName('');
    clearManualStockFields();
  }, [clearManualStockFields]);

  const activeAccountEntry =
    activePortfolio ??
    portfolioEntries.find((entry) => entry.id === activePortfolioId) ??
    portfolioEntries[0] ??
    null;
  const activeAccountSourceItems =
    (activeAccountEntry?.timelineItems?.length
      ? activeAccountEntry.timelineItems
      : activeAccountEntry?.items) ?? [];
  const activeAccountItems = useMemo(
    () => buildGroupedHoldingItems(activeAccountSourceItems),
    [activeAccountSourceItems],
  );
  const activeSelectedHolding =
    activeAccountEntry && selectedHolding?.entryId === activeAccountEntry.id
      ? selectedHolding
      : null;
  const analyticsTotals = analyticsSummary?.totals ?? null;
  const analyticsTopHolding = analyticsSummary?.concentration?.topHoldings?.[0] ?? null;
  const analyticsGap = analyticsSummary?.rebalanceGaps?.bucket?.[0] ?? null;
  const analyticsKpis = analyticsSummary
    ? [
        {
          key: 'market-value',
          label: language === 'en' ? 'Market value' : '평가금액',
          value: formatAnalyticsCompactValue(analyticsTotals?.totalMarketValue, language),
        },
        {
          key: 'profit',
          label: language === 'en' ? 'P/L' : '누적손익',
          value: formatAnalyticsSignedValue(analyticsTotals?.totalProfitAmount, language),
          tone: getSignedValueToneClass(analyticsTotals?.totalProfitAmount, 'positive', 'negative'),
        },
        {
          key: 'return',
          label: language === 'en' ? 'Return' : '수익률',
          value: formatAnalyticsPercentValue(analyticsTotals?.totalReturnRate),
          tone: getSignedValueToneClass(analyticsTotals?.totalReturnRate, 'positive', 'negative'),
        },
        {
          key: 'holdings',
          label: language === 'en' ? 'Holdings' : '종목수',
          value: formatAnalyticsCompactValue(analyticsTotals?.holdingsCount, language),
        },
      ]
    : [];
  const portfolioComparisonRows = useMemo(
    () =>
      portfolioEntries.map((entry) => {
        const entryItems = entry?.items ?? [];
        const entryTimelineItems = entry?.timelineItems?.length ? entry.timelineItems : entryItems;
        const entrySummary = createPortfolioAnalyticsSummary(entryItems, entryTimelineItems, {
          period: 'month',
          topN: 3,
          targetBucketWeights: DEFAULT_REBALANCE_TARGET_WEIGHTS,
        });
        const entryScorecard = createPortfolioScorecard(entryItems, language, {
          weightPreset: scoreWeightPreset,
        });
        const accountSummary = summarizePortfolioEntryAccounts(entry, language);
        const topHolding = entrySummary.concentration?.topHoldings?.[0] ?? null;

        return {
          id: entry.id,
          fileName: entry.fileName,
          accountText: accountSummary.accountText,
          holdingsCount: entrySummary.totals?.holdingsCount ?? entryItems.length,
          totalReturnRate: entrySummary.totals?.totalReturnRate,
          totalMarketValue: entrySummary.totals?.totalMarketValue,
          concentrationLevel: entrySummary.concentration?.concentrationLevel,
          effectiveHoldings: entrySummary.concentration?.effectiveHoldings,
          topHolding,
          score: entryScorecard?.overall,
        };
      }),
    [language, portfolioEntries, scoreWeightPreset],
  );
  const latestMonthlyReport = analyticsSummary?.profitFlow?.at(-1) ?? null;

  const loadAiSummary = useCallback(
    async ({ refresh = false } = {}) => {
      if (!activePortfolio?.id && !items.length) {
        setAiSummary(null);
        setAiSummaryStatus('idle');
        setAiSummaryError('');
        return;
      }

      const controller = new AbortController();
      setAiSummaryStatus('loading');
      setAiSummaryError('');

      try {
        const payload = await fetchPortfolioAiSummary({
          portfolioId: activePortfolio?.id,
          portfolio: activePortfolio,
          language,
          refresh,
          signal: controller.signal,
        });

        if (controller.signal.aborted) {
          return;
        }

        setAiSummary(payload);
        setAiSummaryStatus('ready');
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setAiSummary(null);
        setAiSummaryStatus('error');
        setAiSummaryError(
          error instanceof Error
            ? error.message
            : language === 'en'
              ? 'AI summary could not be loaded.'
              : 'AI 요약을 불러오지 못했습니다.',
        );
      }

      return () => controller.abort();
    },
    [activePortfolio, items.length, language],
  );

  useEffect(() => {
    if (!open || resolvedTool?.key !== 'ai') {
      return undefined;
    }

    const controller = new AbortController();
    setAiSummaryStatus('loading');
    setAiSummaryError('');

    void fetchPortfolioAiSummary({
      portfolioId: activePortfolio?.id,
      portfolio: activePortfolio,
      language,
      signal: controller.signal,
    })
      .then((payload) => {
        if (controller.signal.aborted) {
          return;
        }

        setAiSummary(payload);
        setAiSummaryStatus('ready');
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }

        setAiSummary(null);
        setAiSummaryStatus('error');
        setAiSummaryError(
          error instanceof Error
            ? error.message
            : language === 'en'
              ? 'AI summary could not be loaded.'
              : 'AI 요약을 불러오지 못했습니다.',
        );
      });

    return () => {
      controller.abort();
    };
  }, [activePortfolio, language, open, resolvedTool?.key]);

  useEffect(() => {
    if (!selectedHolding) {
      return;
    }

    const entry = portfolioEntries.find((candidate) => candidate.id === selectedHolding.entryId);
    const sourceItems = (entry?.timelineItems?.length ? entry.timelineItems : entry?.items) ?? [];
    const stillExists = buildGroupedHoldingItems(sourceItems).some(
      (item, index) =>
        selectedHolding.holdingGroupKey
          ? item.holdingGroupKey === selectedHolding.holdingGroupKey
          : selectedHolding.itemId
            ? item.id === selectedHolding.itemId
            : index === selectedHolding.itemIndex,
    );

    if (!stillExists) {
      setSelectedHolding(null);
    }
  }, [portfolioEntries, selectedHolding]);

  const handleSelectMarketSuggestion = useCallback(
    (suggestion) => {
      if (!suggestion?.symbol) {
        return;
      }

      onInteract?.();
      setManualSuggestionLocked(true);
      setManualStockName(suggestion.displayName || suggestion.name || suggestion.symbol);
      setManualTicker(suggestion.symbol);
      if (suggestion.assetClass) {
        setManualAssetClass(suggestion.assetClass);
      }
      setManualMarketSuggestions([]);
      setManualSuggestionStatus('idle');
    },
    [onInteract],
  );
  const handleManualStockNameChange = useCallback((event) => {
    setManualSuggestionLocked(false);
    setManualStockName(event.target.value);
  }, []);
  const handleManualBuyPriceChange = useCallback(
    (event) => {
      const nextBuyPrice = event.target.value;
      setManualBuyPrice(nextBuyPrice);

      const nextReturnRate = calculateReturnRateFromBuyPrice(
        nextBuyPrice,
        manualMarketData?.latestPrice,
      );

      if (nextReturnRate || !nextBuyPrice.trim()) {
        setManualReturnRate(nextReturnRate);
      }
    },
    [manualMarketData],
  );
  const shouldShowManualSuggestions =
    !manualSuggestionLocked &&
    (manualStockName.trim().length >= 2 || /[가-힣]/.test(manualStockName.trim())) &&
    (manualSuggestionStatus === 'loading' ||
      manualSuggestionStatus === 'ready' ||
      manualSuggestionStatus === 'error');
  const closeManualSuggestions = useCallback(() => {
    setManualSuggestionStatus('idle');
  }, []);

  useEffect(() => {
    if (!shouldShowManualSuggestions || typeof document === 'undefined') {
      return undefined;
    }

    const handleDocumentPointerDown = (event) => {
      if (manualSuggestionRef.current?.contains(event.target)) {
        return;
      }

      closeManualSuggestions();
    };
    const handleDocumentKeyDown = (event) => {
      if (event.key === 'Escape') {
        closeManualSuggestions();
      }
    };

    document.addEventListener('pointerdown', handleDocumentPointerDown, true);
    document.addEventListener('keydown', handleDocumentKeyDown, true);

    return () => {
      document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
      document.removeEventListener('keydown', handleDocumentKeyDown, true);
    };
  }, [closeManualSuggestions, shouldShowManualSuggestions]);

  const applyMarketQuoteToDraft = useCallback(() => {
    if (!manualMarketData) {
      return;
    }

    onInteract?.();
    const marketName = resolveMarketDisplayName(manualMarketData);
    if (marketName) {
      setManualSuggestionLocked(true);
      setManualStockName(marketName);
    }
    if (!manualTicker.trim()) {
      setManualTicker(manualMarketData.symbol || '');
    }
    if (manualMarketData.assetClass) {
      setManualAssetClass(manualMarketData.assetClass);
    }
    const nextBuyPrice = formatMarketInputPrice(manualMarketData.latestPrice);
    setManualBuyPrice(nextBuyPrice);
    const nextReturnRate = calculateReturnRateFromBuyPrice(
      nextBuyPrice,
      manualMarketData.latestPrice,
    );
    if (nextReturnRate) {
      setManualReturnRate(nextReturnRate);
    }
  }, [manualMarketData, manualTicker, onInteract]);
  const renderManualEntryPanel = () => (
    <section className="tool-drawer__manual-entry">
      {editingHolding ? (
        <div className="tool-drawer__manual-editing">
          <span>{language === 'en' ? 'Editing holding' : '종목 수정 중'}</span>
          <button type="button" onClick={cancelEditingHolding}>
            {language === 'en' ? 'Cancel' : '취소'}
          </button>
        </div>
      ) : null}

      <div className="tool-drawer__manual-grid">
        <div ref={manualSuggestionRef} className="tool-drawer__manual-field tool-drawer__manual-field--suggest">
          <span id="manual-stock-name-label">{language === 'en' ? 'Stock' : '종목명'}</span>
          <input
            type="text"
            value={manualStockName}
            onChange={handleManualStockNameChange}
            placeholder={language === 'en' ? 'Apple, TIGER' : '예: 타이거, 애플'}
            autoComplete="off"
            aria-labelledby="manual-stock-name-label"
            aria-autocomplete="list"
            aria-expanded={shouldShowManualSuggestions}
          />
          {shouldShowManualSuggestions ? (
            <div className="tool-drawer__suggestions" role="listbox" aria-label={language === 'en' ? 'Stock suggestions' : '종목 검색 결과'}>
              {manualMarketSuggestions.length ? (
                manualMarketSuggestions.map((suggestion) => (
                  <button
                    key={suggestion.symbol}
                    type="button"
                    className="tool-drawer__suggestion"
                    role="option"
                    aria-selected={manualTicker === suggestion.symbol}
                    onClick={() => handleSelectMarketSuggestion(suggestion)}
                  >
                    <span>
                      <strong>{suggestion.displayName || suggestion.name || suggestion.symbol}</strong>
                      <em>
                        {[
                          suggestion.exchangeName,
                          suggestion.typeDisp,
                        ]
                          .filter(Boolean)
                          .join(' · ') || suggestion.source}
                      </em>
                    </span>
                    <small>{suggestion.symbol}</small>
                  </button>
                ))
              ) : (
                <p className="tool-drawer__suggestion-empty">
                  {manualSuggestionStatus === 'loading'
                    ? language === 'en'
                      ? 'Searching...'
                      : '검색 중...'
                    : manualSuggestionStatus === 'error'
                      ? language === 'en'
                        ? 'Could not load suggestions.'
                        : '검색 결과를 가져오지 못했습니다.'
                      : language === 'en'
                        ? 'No matching stocks.'
                        : '관련 종목이 없습니다.'}
                </p>
              )}
            </div>
          ) : null}
        </div>
        <label className="tool-drawer__manual-field">
          <span>{language === 'en' ? 'Ticker' : '종목 티커'}</span>
          <input
            type="text"
            value={manualTicker}
            onChange={(event) => setManualTicker(event.target.value)}
            placeholder={language === 'en' ? 'AAPL' : 'AAPL 또는 005930'}
          />
        </label>
        <label className="tool-drawer__manual-field">
          <span>{language === 'en' ? 'Buy Price' : '매수가'}</span>
          <input
            type="text"
            inputMode="decimal"
            value={manualBuyPrice}
            onChange={handleManualBuyPriceChange}
            placeholder="0"
          />
        </label>
        <label className="tool-drawer__manual-field">
          <span>{language === 'en' ? 'Shares' : '보유수량'}</span>
          <input
            type="text"
            inputMode="decimal"
            value={manualShares}
            onChange={(event) => setManualShares(event.target.value)}
            placeholder="0"
          />
        </label>
        <label className="tool-drawer__manual-field">
          <span>{language === 'en' ? 'Return' : '수익률'}</span>
          <input
            type="text"
            inputMode="decimal"
            value={manualReturnRate}
            onChange={(event) => setManualReturnRate(event.target.value)}
            placeholder={language === 'en' ? '3.5%' : '예: 3.5%'}
          />
        </label>
        <label className="tool-drawer__manual-field">
          <span>{language === 'en' ? 'Asset' : '자산군'}</span>
          <select
            value={manualAssetClass}
            onChange={(event) => setManualAssetClass(event.target.value)}
          >
            <option value="주식">{language === 'en' ? 'Stock' : '주식'}</option>
            <option value="배당">{language === 'en' ? 'Dividend' : '배당'}</option>
            <option value="금/원자재 ETF">{language === 'en' ? 'Gold/Commodity' : '금/원자재'}</option>
            <option value="금/현금">{language === 'en' ? 'Gold/Cash' : '금/현금'}</option>
            <option value="리츠">{language === 'en' ? 'REITs' : '리츠'}</option>
            <option value="채권">{language === 'en' ? 'Bond' : '채권'}</option>
            <option value="기타">{language === 'en' ? 'Other' : '기타'}</option>
          </select>
        </label>
      </div>

      <div className="tool-drawer__manual-actions">
        <button
          type="button"
          className="tool-drawer__manual-button"
          disabled={!activePortfolio?.id || !hasManualStockDraft || Boolean(editingHolding)}
          onClick={handleAddManualRow}
        >
          {language === 'en' ? 'Add stock' : '종목 추가'}
        </button>
        {activePortfolio?.id && !editingHolding ? (
          <button
            type="button"
            className="tool-drawer__manual-button"
            disabled={!manualRows.length && !hasManualStockDraft}
            onClick={handleAppendManualRows}
          >
            {language === 'en' ? 'Add to current portfolio' : '현재 포트폴리오에 종목 추가'}
          </button>
        ) : null}
        {editingHolding ? (
          <button
            type="button"
            className="tool-drawer__manual-button tool-drawer__manual-button--primary"
            disabled={!hasManualDraft}
            onClick={handleSaveManualPortfolio}
          >
            {language === 'en' ? 'Save changes' : '변경 저장'}
          </button>
        ) : null}
      </div>

      {manualRows.length && !editingHolding ? (
        <div className="tool-drawer__manual-preview">
          {manualRows.map((row) => (
            <div key={row.id} className="tool-drawer__manual-row">
              <span>
                <strong>{compactLabel(row.stockName || row.ticker, 16)}</strong>
                <em>{compactLabel(row.ticker || row.assetClass, 12)}</em>
              </span>
              <button
                type="button"
                className="tool-drawer__manual-remove"
                onClick={() => removeManualRow(row.id)}
                aria-label={language === 'en' ? 'Remove stock' : '종목 제거'}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <MarketLivePreview
        data={manualMarketData}
        status={manualMarketStatus}
        error={manualMarketError}
        language={language}
        baseCurrency={baseCurrency}
        fxRates={fxRates}
        onApplyQuote={applyMarketQuoteToDraft}
      />
    </section>
  );

  const renderAiSummaryPanel = () => {
    const summary = aiSummary?.summary;
    const observations = Array.isArray(summary?.keyObservations) ? summary.keyObservations : [];
    const riskNotes = Array.isArray(summary?.riskNotes) ? summary.riskNotes : [];
    const dataQualityNotes = Array.isArray(summary?.dataQualityNotes) ? summary.dataQualityNotes : [];

    return (
      <div className="tool-drawer__ai-panel">
        <section className="tool-drawer__overview-card tool-drawer__overview-card--wide tool-drawer__ai-card">
          <div className="tool-drawer__overview-card-head">
            <p>{language === 'en' ? 'AI Portfolio Summary' : 'AI 포트폴리오 요약'}</p>
            <button
              type="button"
              className="tool-drawer__small-action"
              disabled={aiSummaryStatus === 'loading'}
              onClick={() => {
                onInteract?.();
                void loadAiSummary({ refresh: true });
              }}
            >
              {language === 'en' ? 'Refresh' : '새로고침'}
            </button>
          </div>

          <p className="tool-drawer__ai-disclaimer">
            {aiSummary?.disclaimer ??
              (language === 'en'
                ? 'For informational, user-input-based analysis only. This is not investment advice.'
                : '정보 제공 목적의 사용자 입력 기반 분석이며 투자 조언이 아닙니다.')}
          </p>

          {aiSummaryStatus === 'loading' ? (
            <p className="tool-drawer__empty">
              {language === 'en' ? 'Preparing summary...' : '요약을 준비하고 있습니다.'}
            </p>
          ) : null}

          {aiSummaryStatus === 'error' ? (
            <p className="tool-drawer__empty">{aiSummaryError}</p>
          ) : null}

          {summary ? (
            <div className="tool-drawer__ai-content">
              <div className="tool-drawer__ai-headline">
                <strong>{summary.headline}</strong>
                <span>{summary.overview}</span>
              </div>

              {observations.length ? (
                <div className="tool-drawer__ai-list">
                  {observations.map((item, index) => (
                    <article key={`${item.title}-${index}`} className="tool-drawer__ai-row">
                      <span>{item.title}</span>
                      <strong>{item.detail}</strong>
                      {item.evidence?.length ? <em>{item.evidence.join(' · ')}</em> : null}
                    </article>
                  ))}
                </div>
              ) : null}

              <div className="tool-drawer__ai-columns">
                <section>
                  <p>{language === 'en' ? 'Risk Checks' : '위험 점검'}</p>
                  {riskNotes.length ? (
                    <ul>
                      {riskNotes.slice(0, 4).map((note, index) => (
                        <li key={`${note}-${index}`}>{note}</li>
                      ))}
                    </ul>
                  ) : (
                    <span>{language === 'en' ? 'No risk notes.' : '표시할 위험 점검 항목이 없습니다.'}</span>
                  )}
                </section>
                <section>
                  <p>{language === 'en' ? 'Data Quality' : '데이터 품질'}</p>
                  {dataQualityNotes.length ? (
                    <ul>
                      {dataQualityNotes.slice(0, 4).map((note, index) => (
                        <li key={`${note}-${index}`}>{note}</li>
                      ))}
                    </ul>
                  ) : (
                    <span>{language === 'en' ? 'No blocking diagnostics.' : '차단 수준의 진단은 없습니다.'}</span>
                  )}
                </section>
              </div>

              <small className="tool-drawer__ai-meta">
                {aiSummary.mode === 'deterministic-fallback'
                  ? language === 'en'
                    ? 'Metric-based fallback'
                    : '지표 기반 fallback'
                  : aiSummary.mode === 'cache-hit'
                    ? language === 'en'
                      ? 'Cached summary'
                      : '저장된 요약'
                    : 'OpenAI'}
              </small>
            </div>
          ) : null}
        </section>
      </div>
    );
  };

  const renderComparePanel = () => (
    <div className="tool-drawer__compare-panel">
      <section className="tool-drawer__overview-card tool-drawer__overview-card--wide">
        <p>{language === 'en' ? 'Portfolio Comparison' : '포트폴리오 비교'}</p>
        <div className="tool-drawer__compare-table">
          {portfolioComparisonRows.map((row) => {
            const isActive = row.id === activePortfolioId;

            return (
              <button
                key={row.id}
                type="button"
                className={`tool-drawer__compare-row${isActive ? ' is-active' : ''}`}
                onClick={() => {
                  onInteract?.();
                  onSelectPortfolio?.(row.id);
                }}
              >
                <span>
                  <strong title={row.fileName}>{compactFileName(row.fileName, 24)}</strong>
                  <em>{row.accountText}</em>
                </span>
                <span>
                  <small>{language === 'en' ? 'Return' : '수익률'}</small>
                  <strong className={getSignedValueToneClass(row.totalReturnRate, 'positive', 'negative')}>
                    {formatAnalyticsPercentValue(row.totalReturnRate)}
                  </strong>
                </span>
                <span>
                  <small>{language === 'en' ? 'Score' : '점수'}</small>
                  <strong>{Number.isFinite(row.score) ? Math.round(row.score) : '-'}</strong>
                </span>
                <span>
                  <small>{language === 'en' ? 'Top' : '상위'}</small>
                  <strong>
                    {row.topHolding
                      ? `${compactLabel(row.topHolding.label, 12)} · ${formatAllocationPercent(row.topHolding.weight)}`
                      : '-'}
                  </strong>
                </span>
                <span>
                  <small>{language === 'en' ? 'Concentration' : '집중도'}</small>
                  <strong>
                    {concentrationLevelLabel(row.concentrationLevel, language)}
                    {' · '}
                    {formatAnalyticsCompactValue(row.effectiveHoldings, language)}
                  </strong>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );

  const renderMonthlyReportPanel = () => (
    <div className="tool-drawer__report-panel">
      <section className="tool-drawer__overview-card tool-drawer__overview-card--wide">
        <p>{language === 'en' ? 'Monthly Report Draft' : '월간 리포트 초안'}</p>
        {latestMonthlyReport ? (
          <div className="tool-drawer__report-summary">
            <div className="tool-drawer__analytics-grid">
              <div className="tool-drawer__analytics-metric">
                <span>{language === 'en' ? 'Month' : '월'}</span>
                <strong>{latestMonthlyReport.periodKey}</strong>
              </div>
              <div className="tool-drawer__analytics-metric">
                <span>{language === 'en' ? 'Return' : '수익률'}</span>
                <strong className={getSignedValueToneClass(latestMonthlyReport.returnRate, 'positive', 'negative')}>
                  {formatAnalyticsPercentValue(latestMonthlyReport.returnRate)}
                </strong>
              </div>
              <div className="tool-drawer__analytics-metric">
                <span>{language === 'en' ? 'Rows' : '기록'}</span>
                <strong>{formatAnalyticsCompactValue(latestMonthlyReport.entriesCount, language)}</strong>
              </div>
              <div className="tool-drawer__analytics-metric">
                <span>{language === 'en' ? 'P/L' : '손익'}</span>
                <strong className={getSignedValueToneClass(latestMonthlyReport.profitAmount, 'positive', 'negative')}>
                  {formatAnalyticsSignedValue(latestMonthlyReport.profitAmount, language)}
                </strong>
              </div>
            </div>

            <div className="tool-drawer__report-lines">
              <p>
                {language === 'en'
                  ? 'This draft uses uploaded or manually entered values and existing portfolio calculations.'
                  : '이 초안은 업로드 또는 직접 입력한 값과 기존 포트폴리오 계산을 기준으로 합니다.'}
              </p>
              <ul>
                <li>
                  {language === 'en'
                    ? `Largest visible holding: ${
                        analyticsTopHolding
                          ? `${analyticsTopHolding.label} (${formatAllocationPercent(analyticsTopHolding.weight)})`
                          : '-'
                      }`
                    : `가장 큰 표시 비중: ${
                        analyticsTopHolding
                          ? `${analyticsTopHolding.label} (${formatAllocationPercent(analyticsTopHolding.weight)})`
                          : '-'
                      }`}
                </li>
                <li>
                  {language === 'en'
                    ? `Concentration: ${concentrationLevelLabel(
                        analyticsSummary?.concentration?.concentrationLevel,
                        language,
                      )}`
                    : `집중도: ${concentrationLevelLabel(
                        analyticsSummary?.concentration?.concentrationLevel,
                        language,
                      )}`}
                </li>
                <li>
                  {language === 'en'
                    ? 'Next check: confirm data freshness, missing prices, and large allocation gaps.'
                    : '다음 점검: 데이터 최신성, 누락 시세, 큰 비중 차이를 확인하세요.'}
                </li>
              </ul>
            </div>
          </div>
        ) : (
          <p className="tool-drawer__empty">
            {language === 'en'
              ? 'Monthly timeline data is not available yet.'
              : '월간 시계열 데이터가 아직 없습니다.'}
          </p>
        )}
      </section>
    </div>
  );

  const renderActivePanel = () => {
    if (!resolvedTool) {
      return null;
    }

    if (resolvedTool.key === 'accounts') {
      return (
        <div className="tool-drawer__accounts">
          <div className="tool-drawer__account-actions">
            <span>
              {language === 'en'
                ? `${portfolioEntries.length} portfolios`
                : `${portfolioEntries.length}개 포트폴리오`}
            </span>
            <button
              type="button"
              className="tool-drawer__account-upload"
              disabled={portfolioEntries.length >= MAX_PORTFOLIOS}
              onClick={() => {
                onInteract?.();
                onOpenPortfolioPicker?.();
              }}
            >
              {language === 'en' ? 'Import file' : '파일 가져오기'}
            </button>
          </div>
          <div className="tool-drawer__account-create">
            <label className="tool-drawer__account-create-field">
              <input
                type="text"
                value={manualAccountName}
                onChange={(event) => setManualAccountName(event.target.value)}
                aria-label={language === 'en' ? 'Portfolio name' : '포트폴리오명'}
                placeholder={language === 'en' ? 'Growth portfolio, dividend portfolio' : '예: isa, 연금저축'}
              />
            </label>
            <button
              type="button"
              className="tool-drawer__account-create-button"
              disabled={!hasAtomName || portfolioEntries.length >= MAX_PORTFOLIOS}
              onClick={handleCreateManualAtom}
            >
              {language === 'en' ? 'Create portfolio' : '포트폴리오 생성'}
            </button>
          </div>

          {portfolioEntries.length ? (
            <div className="tool-drawer__account-list">
              {portfolioEntries.map((entry) => {
                const entryReviewStatus = resolveEntryReviewStatus(entry);
                const entryReviewLabel = reviewStatusLabel(text, entryReviewStatus);
                const accountSummary = summarizePortfolioEntryAccounts(entry, language);
                const reviewPreview = buildUploadReviewPreview(entry);
                const isActive = entry.id === activePortfolioId;

                return (
                  <article
                    key={entry.id}
                    className={`tool-drawer__account-card${isActive ? ' is-active' : ''}`}
                  >
                    <button
                      type="button"
                      className="tool-drawer__account-main"
                      onClick={() => {
                        onInteract?.();
                        onSelectPortfolio?.(entry.id);
                      }}
                      aria-label={`${entry.fileName} · ${entryReviewLabel}`}
                    >
                      <span
                        className={`upload-file-chip__status upload-file-chip__status--${entryReviewStatus}`}
                        aria-hidden="true"
                      />
                      <span className="tool-drawer__account-copy">
                        <strong title={entry.fileName}>{compactFileName(entry.fileName, 28)}</strong>
                        <em title={accountSummary.accountText}>{accountSummary.accountText}</em>
                        <small>
                          {language === 'en'
                            ? `${accountSummary.securityCount} assets · ${accountSummary.rowCount} rows`
                            : `${accountSummary.securityCount}개 종목 · ${accountSummary.rowCount}개 행`}
                        </small>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="tool-drawer__account-clear"
                      onClick={() => {
                        onInteract?.();
                        onClearPortfolio?.(entry.id);
                      }}
                      aria-label={text.clearUploadAria}
                    >
                      ×
                    </button>
                    {reviewPreview ? (
                      <div className="tool-drawer__account-review">
                        <strong>{reviewPreview.summary || entryReviewLabel}</strong>
                        {reviewPreview.warnings.length ? (
                          <ul>
                            {reviewPreview.warnings.map((warning, warningIndex) => (
                              <li key={`${warning.code ?? warning.message}-${warningIndex}`}>
                                {warning.message}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : null}

          {activeAccountEntry ? (
            <section className="tool-drawer__holdings">
              <div className="tool-drawer__holdings-head">
                <span>{language === 'en' ? 'Portfolio holdings' : '포트폴리오 종목 구성'}</span>
                <button
                  type="button"
                  onClick={() => {
                    onInteract?.();
                    onSelectTool?.('manual');
                  }}
                >
                  {language === 'en' ? 'Add stock' : '종목 추가'}
                </button>
              </div>

              {activeAccountItems.length ? (
                <div className="tool-drawer__holding-list">
                  {activeAccountItems.map((item, itemIndex) => {
                    const itemId = item.id ?? '';
                    const itemIds = Array.isArray(item.groupedSourceItemIds)
                      ? item.groupedSourceItemIds
                      : [];
                    const itemIndexes = Array.isArray(item.groupedSourceItemIndexes)
                      ? item.groupedSourceItemIndexes
                      : [];
                    const isSelected =
                      selectedHolding?.entryId === activeAccountEntry.id &&
                      (item.holdingGroupKey
                        ? selectedHolding.holdingGroupKey === item.holdingGroupKey
                        : itemId
                          ? selectedHolding.itemId === itemId
                          : selectedHolding.itemIndex === itemIndex);

                    return (
                      <article
                        key={item.holdingGroupKey || itemId || `${activeAccountEntry.id}-${itemIndex}`}
                        className={`tool-drawer__holding-row${isSelected ? ' is-active' : ''}`}
                      >
                        <button
                          type="button"
                          className="tool-drawer__holding-main"
                          onClick={() => {
                            onInteract?.();
                            if (isSelected) {
                              setSelectedHolding(null);
                              onClearHoldingFocus?.();
                              return;
                            }

                            setSelectedHolding({
                              entryId: activeAccountEntry.id,
                              itemId,
                              itemIds,
                              itemIndex,
                              itemIndexes,
                              holdingGroupKey: item.holdingGroupKey,
                              item,
                            });
                            onFocusHolding?.({
                              entryId: activeAccountEntry.id,
                              item,
                              itemIndex,
                            });
                          }}
                        >
                          <span>
                            <strong>{compactLabel(resolveHoldingName(item), 18)}</strong>
                            <em>{formatHoldingListMeta(item, language)}</em>
                          </span>
                          <small>{String(item.detail ?? item.return ?? '').trim() || '-'}</small>
                        </button>
                        <button
                          type="button"
                          className="tool-drawer__holding-edit"
                          onClick={() => beginEditHolding(activeAccountEntry, item, itemIndex)}
                        >
                          {language === 'en' ? 'Edit' : '수정'}
                        </button>
                        <button
                          type="button"
                          className="tool-drawer__holding-remove"
                          onClick={() => {
                            onInteract?.();
                            onRemovePortfolioHolding?.({
                              entryId: activeAccountEntry.id,
                              itemId,
                              itemIds,
                              itemIndex,
                              itemIndexes,
                            });
                          }}
                          aria-label={language === 'en' ? 'Remove holding' : '종목 삭제'}
                        >
                          ×
                        </button>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className="tool-drawer__empty">
                  {language === 'en' ? 'No stocks in this portfolio.' : '이 포트폴리오에 종목이 없습니다.'}
                </p>
              )}

            </section>
          ) : null}
        </div>
      );
    }

    if (resolvedTool.key === 'manual') {
      return <div className="tool-drawer__manual-panel">{renderManualEntryPanel()}</div>;
    }

    if (resolvedTool.key === 'overview') {
      return (
        <div className="tool-drawer__overview">
          {groupOptions.length ? (
            <section className="tool-drawer__overview-card tool-drawer__overview-card--wide tool-drawer__overview-card--groups">
              <p>{language === 'en' ? 'Category Filter' : '카테고리 필터'}</p>
              <div className="tool-drawer__group-grid">
                {groupOptions.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={`group-dock__option tool-drawer__group-option${option.key === activeGroupKey ? ' is-active' : ''}`}
                    onClick={() => {
                      onInteract?.();
                      onGroupChange(option.key);
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {analyticsSummary ? (
            <section className="tool-drawer__overview-card tool-drawer__overview-card--wide tool-drawer__analytics-card">
              <p>{language === 'en' ? 'Service Analytics' : '서비스 분석'}</p>
              <div className="tool-drawer__analytics-grid">
                {analyticsKpis.map((metric) => (
                  <div
                    key={metric.key}
                    className={'tool-drawer__analytics-metric' + (metric.tone ? ' is-' + metric.tone : '')}
                  >
                    <span>{metric.label}</span>
                    <strong>{metric.value}</strong>
                  </div>
                ))}
              </div>
              <div className="tool-drawer__analytics-readout">
                <span>
                  <em>{language === 'en' ? 'Top' : '상위종목'}</em>
                  <strong>
                    {analyticsTopHolding
                      ? compactLabel(analyticsTopHolding.label, 14) + ' · ' + formatAllocationPercent(analyticsTopHolding.weight)
                      : '-'}
                  </strong>
                </span>
                <span>
                  <em>{language === 'en' ? 'Concentration' : '집중도'}</em>
                  <strong>
                    {concentrationLevelLabel(
                      analyticsSummary.concentration?.concentrationLevel,
                      language,
                    )}
                    {' · '}
                    {formatAnalyticsCompactValue(analyticsSummary.concentration?.effectiveHoldings, language)}
                  </strong>
                </span>
                <span>
                  <em>{language === 'en' ? 'Rebalance' : '리밸런싱'}</em>
                  <strong>
                    {analyticsGap
                      ? analyticsGap.label + ' ' + formatAnalyticsPercentValue(analyticsGap.gapWeightPercent)
                      : '-'}
                  </strong>
                </span>
              </div>
            </section>
          ) : null}

          {heatmap ? (
            <section className="tool-drawer__overview-card tool-drawer__overview-card--wide">
              <p>{language === 'en' ? 'Daily P/L' : '날짜별 손익률'}</p>
              <HeatmapCardView
                heatmap={heatmap}
                language={language}
                className="heatmap-panel heatmap-panel--drawer"
              />
            </section>
          ) : null}

          <div className="tool-drawer__overview-grid">
            {scorecard || overallScorecard ? (
              <section className="tool-drawer__overview-card tool-drawer__overview-card--score">
                <div className="tool-drawer__overview-card-head">
                  <p>{language === 'en' ? 'Portfolio Scores' : '포트폴리오 점수'}</p>
                </div>

                <div className="tool-drawer__score-mode-grid" aria-label={language === 'en' ? 'Score weighting mode' : '점수 가중치 선택'}>
                  {[
                    {
                      key: 'balanced',
                      label: language === 'en' ? 'Balanced' : '균형형',
                    },
                    {
                      key: 'longTermReturnFocus',
                      label: language === 'en' ? 'Future' : '미래지향',
                    },
                    {
                      key: 'stabilityFocus',
                      label: language === 'en' ? 'Stable' : '안정형',
                    },
                    {
                      key: 'returnFocus',
                      label: language === 'en' ? 'Aggressive' : '공격형',
                    },
                  ].map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={`tool-drawer__score-mode${scoreWeightPreset === option.key ? ' is-active' : ''}`}
                      onClick={() => {
                        onInteract?.();
                        onScoreWeightPresetChange?.(option.key);
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <div className="tool-drawer__score-chart-stack">
                  {scorecard ? (
                    <div className="tool-drawer__score-chart-block">
                      <span>{language === 'en' ? 'Current portfolio score' : '현재 포트폴리오 점수'}</span>
                      <PortfolioScoreCardView
                        scorecard={scorecard}
                        axes={scoreAxes}
                        language={language}
                        className="score-panel score-panel--drawer"
                      />
                    </div>
                  ) : null}

                  {overallScorecard ? (
                    <div className="tool-drawer__score-chart-block">
                      <span>{language === 'en' ? 'Total portfolio score' : '전체 포트폴리오 점수'}</span>
                      <PortfolioScoreCardView
                        scorecard={overallScorecard}
                        axes={scoreAxes}
                        language={language}
                        className="score-panel score-panel--drawer"
                      />
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}

            {allocation ? (
              <section className="tool-drawer__overview-card">
                <p>{language === 'en' ? 'Portfolio Mix' : '포트폴리오 비중'}</p>
                <PortfolioAllocationCardView
                  allocation={allocation}
                  language={language}
                  className="allocation-panel allocation-panel--drawer"
                  onInteract={onInteract}
                />
              </section>
            ) : null}
          </div>
        </div>
      );
    }

    if (resolvedTool.key === 'ai') {
      return renderAiSummaryPanel();
    }

    if (resolvedTool.key === 'compare') {
      return renderComparePanel();
    }

    if (resolvedTool.key === 'report') {
      return renderMonthlyReportPanel();
    }

    if (resolvedTool.key === 'twin') {
      return (
        <DigitalTwinPanel
          items={items}
          timelineItems={timelineItems}
          className="twin-panel--drawer"
        />
      );
    }

    if (resolvedTool.key === 'news') {
      return <MarketNewsPanel items={items} language={language} />;
    }

    return null;
  };

  return (
    <aside
      className={`tool-drawer${open ? ' is-open' : ''}${open && resolvedTool ? ' has-panel' : ''}${resizing ? ' is-resizing' : ''}`}
      style={{
        ...layerStyle,
        '--tool-drawer-width': `${drawerWidth}px`,
        width: open ? `${drawerWidth}px` : undefined,
        minWidth: open ? `${drawerWidth}px` : undefined,
      }}
    >
      <div className="tool-drawer__window">
        <div className="tool-drawer__rail" aria-label={text.toolMenuAria}>
          {tools.map((tool) => (
            <button
              key={tool.key}
              type="button"
              className={`tool-drawer__button tool-drawer__button--${tool.key}${open && tool.key === resolvedTool?.key ? ' is-active' : ''}`}
              aria-label={tool.label}
              title={tool.label}
              onClick={() => {
                onInteract?.();
                onSelectTool(tool.key);
              }}
            >
              {tool.icon}
            </button>
          ))}
        </div>

        <section className="tool-drawer__panel" aria-live="polite">
          {open && resolvedTool ? (
            <div className="tool-drawer__body">{renderActivePanel()}</div>
          ) : (
            <div className="tool-drawer__body">
              <p className="tool-drawer__empty">
                {language === 'en'
                  ? 'Choose a tool from the left rail.'
                  : '왼쪽 도구를 선택하면 이 창에서 열립니다.'}
              </p>
            </div>
          )}
        </section>

        <div
          className="tool-drawer__resize-handle"
          role="separator"
          aria-label={language === 'en' ? 'Resize tool panel' : '도구 패널 너비 조절'}
          aria-orientation="vertical"
          tabIndex={open ? 0 : -1}
          onPointerDown={handleResizePointerDown}
          onKeyDown={handleResizeKeyDown}
        />
      </div>

      {open && resolvedTool?.key === 'accounts' && activeAccountEntry && activeSelectedHolding ? (
        <aside className="tool-drawer__detail-popout" aria-label={language === 'en' ? 'Stock details' : '종목 정보'}>
          <StockDetailCard
            item={activeSelectedHolding.item}
            language={language}
            baseCurrency={baseCurrency}
            fxRates={fxRates}
            onEdit={() =>
              beginEditHolding(activeAccountEntry, activeSelectedHolding.item, activeSelectedHolding.itemIndex)
            }
            onClose={() => {
              onInteract?.();
              setSelectedHolding(null);
              onClearHoldingFocus?.();
            }}
          />
        </aside>
      ) : null}

    </aside>
  );
}

function FloatingSpiralGlyph({ anchorRef }) {
  const anchoredPosition = () => {
    if (typeof window === 'undefined') {
      return { x: 0, y: 0 };
    }

    const width = window.innerWidth;

    return {
      x: alignedDockXFor(
        width,
        swirlDockSizeFor(width),
        anchorRef?.current?.getBoundingClientRect().width ?? 0,
      ),
      y: swirlDockYFor(width),
    };
  };
  const [position, setPosition] = useState(anchoredPosition);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const syncPosition = () => {
      setPosition(anchoredPosition());
    };

    const frameId = window.requestAnimationFrame(syncPosition);
    window.addEventListener('resize', syncPosition);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', syncPosition);
    };
  }, [anchorRef]);

  return (
    <div
      className="spiral-glyph"
      style={{
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
      }}
      aria-hidden="true"
    >
      <SketchSpiralIcon />
    </div>
  );
}

function FloatingHeatmapDock({
  anchorRef,
  anchorPosition,
  anchorSize,
  heatmap,
  language,
  visible = true,
  resetSignal,
  iconOnly = false,
  layerStyle,
  onAnchorPositionChange,
  onInteract,
}) {
  const dockRef = useRef(null);
  const hasUserMovedRef = useRef(false);
  const suppressHandleClickRef = useRef(false);
  const storageKey = STORAGE_KEYS.heatmapDockPosition;
  const pressRef = useRef({
    pointerId: null,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    lastX: 0,
    lastY: 0,
    pressAt: 0,
    dragStarted: false,
    action: 'toggle',
    holdTimer: null,
  });
  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const anchoredPosition = () => {
    if (typeof window === 'undefined') {
      return { x: 0, y: 0 };
    }

    const dockSize = heatmapDockSizeFor(window.innerWidth);
    const previousDockSize = anchorSize ?? scoreDockSizeFor(window.innerWidth);

    if (anchorPosition) {
      return stackDockBelow(
        anchorPosition.x,
        anchorPosition.y,
        previousDockSize,
        dockSize,
        window.innerWidth,
        window.innerHeight,
      );
    }

    const rect = anchorRef?.current?.getBoundingClientRect();

    if (rect) {
      return stackDockBelowRect(
        rect,
        toolTriggerSizeFor(window.innerWidth),
        dockSize,
        window.innerWidth,
        window.innerHeight,
        2,
      );
    }

    const inset = uiInsetFor(window.innerWidth);
    return stackDockBelow(
      inset,
      inset,
      toolTriggerSizeFor(window.innerWidth),
      dockSize,
      window.innerWidth,
      window.innerHeight,
      2,
    );
  };
  const [position, setPosition] = useState(() => {
    const storedPosition = readStoredPosition(storageKey);
    if (storedPosition) {
      hasUserMovedRef.current = true;
      return storedPosition;
    }

    return anchoredPosition();
  });

  const clampDockPosition = (nextX, nextY) => {
    const margin = 18;
    const dockSize = heatmapDockSizeFor(window.innerWidth);
    const panel = dockRef.current?.querySelector('.heatmap-panel--floating');
    const panelWidth = !iconOnly && expanded ? panel?.offsetWidth ?? 280 : 0;
    const panelSide =
      !iconOnly && expanded
        ? floatingPanelSideFor(nextX, dockSize, window.innerWidth)
        : 'right';
    const panelReachX =
      !iconOnly && expanded
        ? Math.max(0, panelWidth + (window.innerWidth <= MOBILE_BREAKPOINT ? -4 : 8))
        : 0;
    const width = dockSize + panelReachX;
    const height = !iconOnly && expanded ? Math.max(panel?.offsetHeight ?? dockSize, 208) : dockSize;
    const offsetX = panelSide === 'left' ? -panelReachX : 0;

    return {
      x: clamp(
        nextX,
        margin - offsetX,
        Math.max(margin - offsetX, window.innerWidth - width - margin - offsetX),
      ),
      y: clamp(nextY, margin, window.innerHeight - height - margin),
    };
  };

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const syncPosition = () => {
      setPosition((current) => {
        const next = clampDockPosition(current.x, current.y);
        if (hasUserMovedRef.current) {
          return next;
        }

        const anchored = anchoredPosition();
        return clampDockPosition(anchored.x, anchored.y);
      });
    };

    const frameId = window.requestAnimationFrame(syncPosition);
    window.addEventListener('resize', syncPosition);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', syncPosition);
    };
  }, [anchorRef, anchorPosition?.x, anchorPosition?.y, anchorSize, expanded, iconOnly]);

  useEffect(() => {
    if (!hasUserMovedRef.current) {
      onAnchorPositionChange?.(position);
    }
  }, [onAnchorPositionChange, position]);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      dragging ||
      !hasUserMovedRef.current
    ) {
      return;
    }

    writeStoredPosition(storageKey, position);
  }, [dragging, position, storageKey]);

  useEffect(() => {
    if (!resetSignal) {
      return;
    }

    hasUserMovedRef.current = false;
    clearStoredPosition(storageKey);
    setExpanded(false);
    const anchored = anchoredPosition();
    setPosition(clampDockPosition(anchored.x, anchored.y));
  }, [resetSignal, storageKey]);

  const beginDrag = () => {
    if (pressRef.current.pointerId === null) {
      return;
    }

    window.clearTimeout(pressRef.current.holdTimer);
    pressRef.current.holdTimer = null;
    pressRef.current.dragStarted = true;
    hasUserMovedRef.current = true;
    suppressHandleClickRef.current = true;
    setDragging(true);
    document.body.style.cursor = 'grabbing';
    setPosition(
      clampDockPosition(
        pressRef.current.originX + (pressRef.current.lastX - pressRef.current.startX),
        pressRef.current.originY + (pressRef.current.lastY - pressRef.current.startY),
      ),
    );
  };

  const clearPress = () => {
    window.clearTimeout(pressRef.current.holdTimer);
    pressRef.current.pointerId = null;
    pressRef.current.dragStarted = false;
    pressRef.current.action = 'toggle';
    pressRef.current.holdTimer = null;
    setDragging(false);
    document.body.style.cursor = '';
  };

  useEffect(() => {
    const handleWindowPointerMove = (event) => {
      if (pressRef.current.pointerId !== event.pointerId) {
        return;
      }

      pressRef.current.lastX = event.clientX;
      pressRef.current.lastY = event.clientY;
      const deltaX = event.clientX - pressRef.current.startX;
      const deltaY = event.clientY - pressRef.current.startY;
      const distanceSquared = deltaX * deltaX + deltaY * deltaY;
      const action = pressRef.current.action;
      const dragDistanceThreshold = action === 'toggle' ? 36 : 9;
      const shouldStartDrag =
        distanceSquared > dragDistanceThreshold ||
        (action !== 'toggle' && performance.now() - pressRef.current.pressAt > 90);

      if (!pressRef.current.dragStarted) {
        if (shouldStartDrag) {
          beginDrag();
        } else {
          return;
        }
      }

      event.preventDefault();
      onInteract();
      setPosition(
        clampDockPosition(
          pressRef.current.originX + deltaX,
          pressRef.current.originY + deltaY,
        ),
      );
    };

    const handleWindowPointerUp = (event) => {
      if (pressRef.current.pointerId !== event.pointerId) {
        return;
      }

      const deltaX = event.clientX - pressRef.current.startX;
      const deltaY = event.clientY - pressRef.current.startY;
      const wasDrag = pressRef.current.dragStarted;
      const wasClick = !wasDrag && deltaX * deltaX + deltaY * deltaY < 100;
      const action = pressRef.current.action;

      clearPress();

      if (wasDrag) {
        event.preventDefault();
        return;
      }

      if (wasClick && action === 'toggle' && !iconOnly) {
        onInteract();
        suppressHandleClickRef.current = true;
        setExpanded((current) => !current);
      }
    };

    const handleWindowPointerCancel = (event) => {
      if (pressRef.current.pointerId !== event.pointerId) {
        return;
      }

      clearPress();
    };

    window.addEventListener('pointermove', handleWindowPointerMove, {
      passive: false,
    });
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerCancel);

    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerCancel);
      window.clearTimeout(pressRef.current.holdTimer);
    };
  }, [expanded, iconOnly, onInteract]);

  const startPress = (event, action, options = {}) => {
    const {
      capture = false,
      preventDefault = false,
      stopPropagation = false,
      holdDelay = 90,
    } = options;

    if (preventDefault) {
      event.preventDefault();
    }

    if (stopPropagation) {
      event.stopPropagation();
    }

    onInteract();
    if (capture) {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    pressRef.current.pointerId = event.pointerId;
    pressRef.current.startX = event.clientX;
    pressRef.current.startY = event.clientY;
    pressRef.current.originX = position.x;
    pressRef.current.originY = position.y;
    pressRef.current.lastX = event.clientX;
    pressRef.current.lastY = event.clientY;
    pressRef.current.pressAt = performance.now();
    pressRef.current.dragStarted = false;
    pressRef.current.action = action;
    pressRef.current.holdTimer =
      Number.isFinite(holdDelay) && holdDelay >= 0
        ? window.setTimeout(beginDrag, holdDelay)
        : null;
  };

  const handleDockPointerDown = (event) => {
    startPress(event, 'toggle', {
      capture: true,
      preventDefault: false,
      stopPropagation: true,
      holdDelay: null,
    });
  };

  const handleDockClick = (event) => {
    event.stopPropagation();

    if (iconOnly || suppressHandleClickRef.current) {
      suppressHandleClickRef.current = false;
      return;
    }

    onInteract();
    setExpanded((current) => !current);
  };

  const handleDockSurfacePointerDown = (event) => {
    startPress(event, 'drag', {
      capture: false,
      preventDefault: false,
      stopPropagation: true,
      holdDelay: 90,
    });
  };

  const panelSide =
    typeof window === 'undefined'
      ? 'right'
      : floatingPanelSideFor(position.x, heatmapDockSizeFor(window.innerWidth), window.innerWidth);

  return (
    <div
      ref={dockRef}
      className={`heatmap-dock${panelSide === 'left' ? ' is-flipped' : ''}${expanded ? ' is-expanded' : ''}${dragging ? ' is-dragging' : ''}${visible ? '' : ' is-hidden'}`}
      style={{
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        ...layerStyle,
      }}
    >
      <button
        type="button"
        className="heatmap-dock__handle"
        onPointerDown={handleDockPointerDown}
        onClick={handleDockClick}
        aria-expanded={expanded}
        aria-label={iconOnly ? textFor(language).contributionAria : textFor(language).heatmapAria}
      >
        <SketchHeatmapIcon heatmap={heatmap} />
      </button>

      {!iconOnly ? (
        <HeatmapCardView
          heatmap={heatmap}
          language={language}
          className={`heatmap-panel heatmap-panel--floating${expanded ? ' is-open' : ''}`}
          onPointerDown={handleDockSurfacePointerDown}
        />
      ) : null}
    </div>
  );
}

function FloatingToolTrigger({
  anchorRef,
  anchorPosition,
  triggerRef,
  language,
  open,
  resetSignal,
  layerStyle,
  onToggle,
  onResetAlignment,
  onPositionChange,
  onInteract,
}) {
  const dockRef = useRef(null);
  const localTriggerRef = useRef(null);
  const hasUserMovedRef = useRef(false);
  const storageKey = STORAGE_KEYS.toolTriggerPosition;
  const pressRef = useRef({
    pointerId: null,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    lastX: 0,
    lastY: 0,
    pressAt: 0,
    dragStarted: false,
    holdTimer: null,
    longPressTimer: null,
    didLongPress: false,
  });
  const [dragging, setDragging] = useState(false);
  const anchoredPosition = () => {
    if (typeof window === 'undefined') {
      return { x: 0, y: 0 };
    }

    const triggerSize = scoreDockSizeFor(window.innerWidth);
    const inset = uiInsetFor(window.innerWidth);

    return {
      x: clamp(inset, inset, window.innerWidth - triggerSize - inset),
      y: clamp(inset, inset, window.innerHeight - triggerSize - inset),
    };
  };
  const [position, setPosition] = useState(() => {
    const storedPosition = readStoredPosition(storageKey);
    if (storedPosition) {
      hasUserMovedRef.current = true;
      return storedPosition;
    }

    return anchoredPosition();
  });

  const assignTriggerRef = (node) => {
    localTriggerRef.current = node;

    if (!triggerRef) {
      return;
    }

    if (typeof triggerRef === 'function') {
      triggerRef(node);
      return;
    }

    triggerRef.current = node;
  };

  const clampTriggerPosition = (nextX, nextY) => {
    const margin = 18;
    const viewportWidth = window.innerWidth;
    const triggerSize = scoreDockSizeFor(viewportWidth);
    const width = dockRef.current?.offsetWidth ?? triggerSize;
    const height = dockRef.current?.offsetHeight ?? triggerSize;
    const stackReachY = open
      ? triggerSize * 0.5 +
        toolDockStackStepFor(viewportWidth) * 5 +
        twinDockSizeFor(viewportWidth) * 0.5
      : height;

    return {
      x: clamp(nextX, margin, window.innerWidth - width - margin),
      y: clamp(
        nextY,
        margin,
        Math.max(margin, window.innerHeight - margin - stackReachY),
      ),
    };
  };

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const syncPosition = () => {
      setPosition((current) => {
        const next = clampTriggerPosition(current.x, current.y);
        if (hasUserMovedRef.current) {
          return next;
        }

        const anchored = anchoredPosition();
        return clampTriggerPosition(anchored.x, anchored.y);
      });
    };

    const frameId = window.requestAnimationFrame(syncPosition);
    window.addEventListener('resize', syncPosition);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', syncPosition);
    };
  }, [anchorRef, anchorPosition?.x, anchorPosition?.y, open]);

  useEffect(() => {
    onPositionChange?.(position);
  }, [onPositionChange, position]);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      dragging ||
      !hasUserMovedRef.current
    ) {
      return;
    }

    writeStoredPosition(storageKey, position);
  }, [dragging, position, storageKey]);

  useEffect(() => {
    if (!resetSignal) {
      return;
    }

    hasUserMovedRef.current = false;
    clearStoredPosition(storageKey);
    setPosition(clampTriggerPosition(anchoredPosition().x, anchoredPosition().y));
  }, [resetSignal, storageKey]);

  const beginDrag = () => {
    if (pressRef.current.pointerId === null) {
      return;
    }

    window.clearTimeout(pressRef.current.holdTimer);
    pressRef.current.holdTimer = null;
    pressRef.current.dragStarted = true;
    hasUserMovedRef.current = true;
    setDragging(true);
    document.body.style.cursor = 'grabbing';
    setPosition(
      clampTriggerPosition(
        pressRef.current.originX + (pressRef.current.lastX - pressRef.current.startX),
        pressRef.current.originY + (pressRef.current.lastY - pressRef.current.startY),
      ),
    );
  };

  const clearPress = () => {
    window.clearTimeout(pressRef.current.holdTimer);
    window.clearTimeout(pressRef.current.longPressTimer);
    pressRef.current.pointerId = null;
    pressRef.current.dragStarted = false;
    pressRef.current.holdTimer = null;
    pressRef.current.longPressTimer = null;
    pressRef.current.didLongPress = false;
    setDragging(false);
    document.body.style.cursor = '';
  };

  useEffect(() => {
    const handleWindowPointerMove = (event) => {
      if (pressRef.current.pointerId !== event.pointerId) {
        return;
      }

      pressRef.current.lastX = event.clientX;
      pressRef.current.lastY = event.clientY;
      const deltaX = event.clientX - pressRef.current.startX;
      const deltaY = event.clientY - pressRef.current.startY;
      const distanceSquared = deltaX * deltaX + deltaY * deltaY;

      if (!pressRef.current.dragStarted) {
        if (distanceSquared > 9) {
          window.clearTimeout(pressRef.current.longPressTimer);
          pressRef.current.longPressTimer = null;
          beginDrag();
        } else {
          return;
        }
      }

      event.preventDefault();
      onInteract();
      setPosition(
        clampTriggerPosition(
          pressRef.current.originX + deltaX,
          pressRef.current.originY + deltaY,
        ),
      );
    };

    const handleWindowPointerUp = (event) => {
      if (pressRef.current.pointerId !== event.pointerId) {
        return;
      }

      const deltaX = event.clientX - pressRef.current.startX;
      const deltaY = event.clientY - pressRef.current.startY;
      const wasDrag = pressRef.current.dragStarted;
      const wasLongPress = pressRef.current.didLongPress;
      const wasClick = !wasDrag && deltaX * deltaX + deltaY * deltaY < 100;

      clearPress();

      if (wasLongPress) {
        return;
      }

      if (wasClick) {
        onInteract();
        onToggle();
      }
    };

    const handleWindowPointerCancel = (event) => {
      if (pressRef.current.pointerId !== event.pointerId) {
        return;
      }

      clearPress();
    };

    window.addEventListener('pointermove', handleWindowPointerMove, {
      passive: false,
    });
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerCancel);

    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerCancel);
      window.clearTimeout(pressRef.current.holdTimer);
      window.clearTimeout(pressRef.current.longPressTimer);
    };
  }, [onInteract, onResetAlignment, onToggle, open]);

  const handleTriggerPointerDown = (event) => {
    event.preventDefault();
    event.stopPropagation();
    onInteract();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pressRef.current.pointerId = event.pointerId;
    pressRef.current.startX = event.clientX;
    pressRef.current.startY = event.clientY;
    pressRef.current.originX = position.x;
    pressRef.current.originY = position.y;
    pressRef.current.lastX = event.clientX;
    pressRef.current.lastY = event.clientY;
    pressRef.current.pressAt = performance.now();
    pressRef.current.dragStarted = false;
    pressRef.current.didLongPress = false;
    if (open) {
      pressRef.current.longPressTimer = window.setTimeout(() => {
        pressRef.current.didLongPress = true;
        onInteract();
        onResetAlignment?.();
      }, 320);
    }
  };

  return (
    <div
      ref={dockRef}
      className={`tool-menu tool-menu--floating${open ? ' is-open' : ''}${dragging ? ' is-dragging' : ''}`}
      style={{
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        ...layerStyle,
      }}
    >
      <button
        ref={assignTriggerRef}
        className={`tool-menu__trigger${open ? ' is-open' : ''}`}
        type="button"
        onPointerDown={handleTriggerPointerDown}
        aria-label={textFor(language).toolMenuAria}
        aria-expanded={open}
      >
        <SketchPlusIcon />
      </button>
    </div>
  );
}

function FloatingRadarDock({
  anchorRef,
  anchorPosition,
  anchorSize,
  externalDockRef,
  scorecard,
  axes,
  language,
  spawn,
  resetSignal,
  visible = true,
  layerStyle,
  onPositionChange,
  onInteract,
}) {
  const dockRef = useRef(null);
  const hasUserMovedRef = useRef(false);
  const storageKey = STORAGE_KEYS.scoreDockPosition;
  const pressRef = useRef({
    pointerId: null,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    lastX: 0,
    lastY: 0,
    pressAt: 0,
    dragStarted: false,
    action: 'toggle',
    holdTimer: null,
  });
  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const anchoredPosition = () => {
    if (typeof window === 'undefined') {
      return { x: 0, y: 202 };
    }

    const scoreSize = scoreDockSizeFor(window.innerWidth);
    const previousDockSize = anchorSize ?? groupDockSizeFor(window.innerWidth);
    const triggerSize = toolTriggerSizeFor(window.innerWidth);
    if (anchorPosition) {
      return stackDockBelow(
        anchorPosition.x,
        anchorPosition.y,
        previousDockSize,
        scoreSize,
        window.innerWidth,
        window.innerHeight,
      );
    }

    const rect = anchorRef?.current?.getBoundingClientRect();

    if (!rect) {
      const inset = uiInsetFor(window.innerWidth);
      return stackDockBelow(
        inset,
        inset,
        triggerSize,
        scoreSize,
        window.innerWidth,
        window.innerHeight,
        3,
      );
    }

    return stackDockBelowRect(
      rect,
      triggerSize,
      scoreSize,
      window.innerWidth,
      window.innerHeight,
      3,
    );
  };
  const [position, setPosition] = useState(() => {
    const storedPosition = readStoredPosition(storageKey);
    if (storedPosition) {
      hasUserMovedRef.current = true;
      return storedPosition;
    }

    return anchoredPosition();
  });

  const assignDockRef = (node) => {
    dockRef.current = node;

    if (!externalDockRef) {
      return;
    }

    if (typeof externalDockRef === 'function') {
      externalDockRef(node);
      return;
    }

    externalDockRef.current = node;
  };

  const clampDockPosition = (nextX, nextY, options = {}) => {
    const margin = 18;
    const dockSize = scoreDockSizeFor(window.innerWidth);
    const panel = dockRef.current?.querySelector('.score-panel--floating');
    const shouldIncludePanel = options.expanded ?? expanded;
    const panelWidth = shouldIncludePanel ? panel?.offsetWidth ?? 308 : 0;
    const panelSide = shouldIncludePanel
      ? floatingPanelSideFor(nextX, dockSize, window.innerWidth)
      : 'right';
    const panelReachX = shouldIncludePanel ? Math.max(0, panelWidth - 11.2) : 0;
    const width = dockSize + panelReachX;
    const height = shouldIncludePanel ? Math.max(panel?.offsetHeight ?? dockSize, 308) : dockSize;
    const offsetX = panelSide === 'left' ? -panelReachX : 0;

    return {
      x: clamp(
        nextX,
        margin - offsetX,
        Math.max(margin - offsetX, window.innerWidth - width - margin - offsetX),
      ),
      y: clamp(nextY, margin, window.innerHeight - height - margin),
    };
  };

  const commitPosition = (nextPosition) => {
    setPosition((current) => {
      const resolved =
        typeof nextPosition === 'function' ? nextPosition(current) : nextPosition;
      onPositionChange?.(resolved);
      return resolved;
    });
  };

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const syncPosition = () => {
      commitPosition((current) => {
        const next = clampDockPosition(current.x, current.y);
        if (hasUserMovedRef.current) {
          return next;
        }

        const anchored = anchoredPosition();
        return clampDockPosition(anchored.x, anchored.y);
      });
    };

    const frameId = window.requestAnimationFrame(syncPosition);
    window.addEventListener('resize', syncPosition);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', syncPosition);
    };
  }, [anchorRef, anchorPosition?.x, anchorPosition?.y, anchorSize, expanded]);

  useEffect(() => {
    if (!spawn) {
      return;
    }

    hasUserMovedRef.current = true;
    setExpanded(true);
    commitPosition((current) => clampDockPosition(spawn.x ?? current.x, spawn.y ?? current.y));
  }, [spawn?.session]);

  useEffect(() => {
    if (!resetSignal) {
      return;
    }

    hasUserMovedRef.current = false;
    clearStoredPosition(storageKey);
    setExpanded(false);
    const anchored = anchoredPosition();
    commitPosition(clampDockPosition(anchored.x, anchored.y));
  }, [resetSignal, storageKey]);

  useEffect(() => {
    onPositionChange?.(position);
  }, [onPositionChange, position]);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      dragging ||
      !hasUserMovedRef.current
    ) {
      return;
    }

    writeStoredPosition(storageKey, position);
  }, [dragging, position, storageKey]);

  const beginDrag = () => {
    if (pressRef.current.pointerId === null) {
      return;
    }

    window.clearTimeout(pressRef.current.holdTimer);
    pressRef.current.holdTimer = null;
    pressRef.current.dragStarted = true;
    hasUserMovedRef.current = true;
    setDragging(true);
    document.body.style.cursor = 'grabbing';
    commitPosition(
      clampDockPosition(
        pressRef.current.originX + (pressRef.current.lastX - pressRef.current.startX),
        pressRef.current.originY + (pressRef.current.lastY - pressRef.current.startY),
      ),
    );
  };

  const clearPress = () => {
    window.clearTimeout(pressRef.current.holdTimer);
    pressRef.current.pointerId = null;
    pressRef.current.dragStarted = false;
    pressRef.current.action = 'toggle';
    pressRef.current.holdTimer = null;
    setDragging(false);
    document.body.style.cursor = '';
  };

  useEffect(() => {
    const handleWindowPointerMove = (event) => {
      if (pressRef.current.pointerId !== event.pointerId) {
        return;
      }

      pressRef.current.lastX = event.clientX;
      pressRef.current.lastY = event.clientY;
      const deltaX = event.clientX - pressRef.current.startX;
      const deltaY = event.clientY - pressRef.current.startY;
      const distanceSquared = deltaX * deltaX + deltaY * deltaY;
      const action = pressRef.current.action;
      const dragDistanceThreshold = action === 'toggle' ? 36 : 9;
      const shouldStartDrag =
        distanceSquared > dragDistanceThreshold ||
        (action !== 'toggle' && performance.now() - pressRef.current.pressAt > 90);

      if (!pressRef.current.dragStarted) {
        if (shouldStartDrag) {
          beginDrag();
        } else {
          return;
        }
      }

      event.preventDefault();
      onInteract();
      commitPosition(
        clampDockPosition(
          pressRef.current.originX + deltaX,
          pressRef.current.originY + deltaY,
        ),
      );
    };

    const handleWindowPointerUp = (event) => {
      if (pressRef.current.pointerId !== event.pointerId) {
        return;
      }

      const deltaX = event.clientX - pressRef.current.startX;
      const deltaY = event.clientY - pressRef.current.startY;
      const wasDrag = pressRef.current.dragStarted;
      const wasClick = !wasDrag && deltaX * deltaX + deltaY * deltaY < 100;
      const action = pressRef.current.action;

      clearPress();

      if (wasDrag) {
        event.preventDefault();
        return;
      }

      if (wasClick && action === 'toggle') {
        onInteract();
        setExpanded((current) => !current);
      }
    };

    const handleWindowPointerCancel = (event) => {
      if (pressRef.current.pointerId !== event.pointerId) {
        return;
      }

      clearPress();
    };

    window.addEventListener('pointermove', handleWindowPointerMove, {
      passive: false,
    });
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerCancel);

    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerCancel);
      window.clearTimeout(pressRef.current.holdTimer);
    };
  }, [anchorPosition?.x, anchorPosition?.y, anchorSize, expanded, onInteract]);

  const startPress = (event, action, options = {}) => {
    const {
      capture = false,
      preventDefault = false,
      stopPropagation = false,
      holdDelay = 90,
    } = options;

    if (preventDefault) {
      event.preventDefault();
    }

    if (stopPropagation) {
      event.stopPropagation();
    }

    onInteract();
    if (capture) {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    pressRef.current.pointerId = event.pointerId;
    pressRef.current.startX = event.clientX;
    pressRef.current.startY = event.clientY;
    pressRef.current.originX = position.x;
    pressRef.current.originY = position.y;
    pressRef.current.lastX = event.clientX;
    pressRef.current.lastY = event.clientY;
    pressRef.current.pressAt = performance.now();
    pressRef.current.dragStarted = false;
    pressRef.current.action = action;
    pressRef.current.holdTimer =
      Number.isFinite(holdDelay) && holdDelay >= 0
        ? window.setTimeout(beginDrag, holdDelay)
        : null;
  };

  const handleDockPointerDown = (event) => {
    startPress(event, 'toggle', {
      capture: true,
      preventDefault: true,
      stopPropagation: true,
      holdDelay: null,
    });
  };

  const handleDockSurfacePointerDown = (event) => {
    startPress(event, 'drag', {
      capture: false,
      preventDefault: false,
      stopPropagation: true,
      holdDelay: 90,
    });
  };

  const panelSide =
    typeof window === 'undefined'
      ? 'right'
      : floatingPanelSideFor(position.x, scoreDockSizeFor(window.innerWidth), window.innerWidth);

  return (
    <div
      ref={assignDockRef}
      className={`score-dock${panelSide === 'left' ? ' is-flipped' : ''}${expanded ? ' is-expanded' : ''}${dragging ? ' is-dragging' : ''}${visible ? '' : ' is-hidden'}`}
      style={{
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        ...layerStyle,
      }}
    >
      <button
        type="button"
        className="score-dock__handle"
        onPointerDown={handleDockPointerDown}
        aria-expanded={expanded}
      >
        <SketchRadarIcon scorecard={scorecard} axes={axes} />
      </button>

      <PortfolioScoreCardView
        scorecard={scorecard}
        axes={axes}
        language={language}
        className={`score-panel score-panel--floating${expanded ? ' is-open' : ''}`}
        onPointerDown={handleDockSurfacePointerDown}
      />
    </div>
  );
}

function AtomSketch({
  atoms,
  pulse,
  centerMotion,
  centerClickBurst,
  standalone,
  svgRef,
  ariaLabel,
  highlightActive,
  centerFocusActive,
  onCenterClick,
  onPointerDown,
  onPointerEnter,
  onPointerMove,
  onPointerLeave,
}) {
  const phase = pulse * Math.PI * 2;
  const useDetailFilters = atoms.length <= LARGE_SCENE_ATOM_THRESHOLD;
  const backAtoms = atoms
    .filter((atom) => atom.position.z < 0)
    .sort((left, right) => left.position.z - right.position.z);
  const frontAtoms = atoms
    .filter((atom) => atom.position.z >= 0)
    .sort((left, right) => left.position.z - right.position.z);
  const centerGlowDrift = standalone ? (Math.sin(centerMotion * 0.56 - 0.6) * 0.5 + 0.5) : 0;
  const centerBlinkWave = standalone ? (Math.sin(centerMotion * 1.74 - 0.85) * 0.5 + 0.5) : 0;
  const centerFocusWave = centerFocusActive ? Math.sin(phase * 0.72 + 0.4) * 0.5 + 0.5 : 0;
  const centerScale = standalone
    ? 1.4 + centerClickBurst * 0.22
    : centerFocusActive
      ? 1.08 + centerFocusWave * 0.03
      : 0.985 + Math.sin(phase * 0.5) * 0.012;
  const centerBlink = standalone
    ? 0.34 + centerBlinkWave * 0.88 + centerClickBurst * 0.2
    : centerFocusActive
      ? 0.76 + centerFocusWave * 0.24
      : 1;
  const centerAuraOpacity = standalone
    ? 0.04 + centerBlink * 0.92
    : centerFocusActive
      ? 0.32 + centerFocusWave * 0.18
      : 0;
  const centerCoreOpacity = standalone
    ? 0.08 + centerBlink * 0.72
    : centerFocusActive
      ? 0.36 + centerFocusWave * 0.18
      : 0;
  const centerHighlightOpacity = standalone
    ? 0.06 + centerBlink * 0.62
    : centerFocusActive
      ? 0.28 + centerFocusWave * 0.28
      : 0;
  const centerAuraScale = standalone
    ? 1 + centerClickBurst * 0.24 + centerGlowDrift * 0.04 + centerBlinkWave * 0.015
    : centerFocusActive
      ? 1.12 + centerFocusWave * 0.05
      : 1;
  const centerCoreScale = standalone
    ? 1 + centerClickBurst * 0.1 + centerGlowDrift * 0.02
    : centerFocusActive
      ? 1.04 + centerFocusWave * 0.025
      : 1;

  return (
    <svg
      ref={svgRef}
      className="sketch-svg"
      viewBox="-320 -320 640 640"
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        <filter id="smudge" x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation="0.52" />
        </filter>
        <filter id="glow" x="-35%" y="-35%" width="170%" height="170%">
          <feGaussianBlur stdDeviation="4.8" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g className="aura-layer" filter={useDetailFilters ? 'url(#glow)' : undefined}>
        {standalone || centerFocusActive ? (
          <g
            className="center-aura"
            opacity={centerAuraOpacity}
            transform={`scale(${format(centerAuraScale)} ${format(
              0.95 + centerClickBurst * 0.08 + centerGlowDrift * 0.04 + centerBlinkWave * 0.02,
            )})`}
          >
            <ellipse
              className="center-glow-outer"
              cx="0"
              cy="0"
              rx="31"
              ry="24"
              transform="rotate(-18)"
            />
            <ellipse
              className="center-glow-mid"
              cx="3"
              cy="-2"
              rx="22"
              ry="17"
              transform="rotate(11)"
              opacity="0.92"
            />
            <ellipse
              className="center-glow-core"
              cx="-4"
              cy="-7"
              rx="9"
              ry="6"
              transform="rotate(-24)"
              opacity={centerHighlightOpacity}
            />
          </g>
        ) : null}

        {backAtoms.map((atom) => (
          <SketchAura key={`back-aura-${atom.id}`} atom={atom} phase={phase} />
        ))}
        {frontAtoms.map((atom) => (
          <SketchAura key={`front-aura-${atom.id}`} atom={atom} phase={phase} />
        ))}
      </g>

      <g className="sketch-core" filter={useDetailFilters ? 'url(#smudge)' : undefined}>
        {backAtoms.map((atom) => (
          <SketchAtom
            key={`back-${atom.id}`}
            atom={atom}
            phase={phase}
            onPointerDown={(event) => onPointerDown(atom.id, event)}
            onPointerEnter={(event) => onPointerEnter(atom.id, event)}
            onPointerMove={(event) => onPointerMove(atom.id, event)}
            onPointerLeave={() => onPointerLeave(atom.id)}
          />
        ))}

        <g
          transform={`rotate(-12) scale(${format(centerScale * centerCoreScale)} ${format(
            centerScale * (0.98 + centerClickBurst * 0.04 + centerGlowDrift * 0.02),
          )})`}
        >
          {standalone || centerFocusActive ? (
            <g opacity={centerCoreOpacity}>
              <ellipse
                className="center-shell-shadow"
                cx="1"
                cy="2"
                rx="14.8"
                ry="12.3"
                transform="rotate(9)"
              />
              <ellipse
                className="center-shell-rim"
                cx="-1"
                cy="-1"
                rx="13.2"
                ry="10.9"
                transform="rotate(-13)"
              />
              <ellipse
                className="center-shell-highlight"
                cx="-5"
                cy="-7"
                rx="5.8"
                ry="4.1"
                transform="rotate(-26)"
                opacity={centerHighlightOpacity}
              />
            </g>
          ) : null}

          {standalone || centerFocusActive ? (
            <g
              opacity={0.08 + centerBlink * 0.68}
              transform={`scale(${format(1 + centerClickBurst * 0.06)} ${format(
                1.01 + centerClickBurst * 0.03 + centerGlowDrift * 0.02,
              )})`}
            >
              <path
                className="center-orbit"
                d={CENTER_SPIN_LOOPS[0]}
                transform="rotate(8) scale(0.72 1.06)"
              />
              <path
                className="center-orbit"
                d={CENTER_SPIN_LOOPS[1]}
                transform="rotate(-21) scale(1.08 0.52)"
                opacity="0.78"
              />
            </g>
          ) : null}

          <g transform={standalone ? `scale(${format(1 + centerClickBurst * 0.05)})` : undefined}>
            {CENTER_BLOTS.map((path, index) => (
              <path
                key={`blot-${index}`}
                className="center-blot"
                d={path}
                opacity={
                  (standalone
                    ? 0.46 + centerBlink * 0.78 + index * 0.02
                    : highlightActive || centerFocusActive
                      ? 0.86 + pulse * 0.08 + index * 0.015
                      : 0.68 + pulse * 0.08) * centerBlink
                }
              />
            ))}

            {DUST.map((dot, index) => (
              <circle
                key={`dust-${index}`}
                className="graphite-dust"
                cx={dot.x}
                cy={dot.y}
                r={dot.r}
                opacity={(dot.opacity + pulse * 0.04) * (standalone ? 0.34 + centerBlink * 1.18 : 1)}
              />
            ))}
          </g>

          {onCenterClick ? (
            <circle
              className="center-hit"
              cx="0"
              cy="0"
              r={standalone ? 60 : 56}
              onPointerDown={(event) => {
                event.stopPropagation();
                event.preventDefault();
                event.currentTarget.setPointerCapture?.(event.pointerId);
              }}
              onPointerUp={(event) => {
                event.stopPropagation();
                event.preventDefault();
                onCenterClick?.();
              }}
            />
          ) : null}
        </g>

        {frontAtoms.map((atom) => (
          <SketchAtom
            key={`front-${atom.id}`}
            atom={atom}
            phase={phase}
            onPointerDown={(event) => onPointerDown(atom.id, event)}
            onPointerEnter={(event) => onPointerEnter(atom.id, event)}
            onPointerMove={(event) => onPointerMove(atom.id, event)}
            onPointerLeave={() => onPointerLeave(atom.id)}
          />
        ))}
      </g>

      <g className="label-layer">
        {atoms.map((atom) => (
          <AtomLabel key={`label-${atom.id}`} atom={atom} />
        ))}
      </g>
    </svg>
  );
}

export default function App() {
  const shellRef = useRef(null);
  const svgRef = useRef(null);
  const fileInputRef = useRef(null);
  const uploadPlusWrapRef = useRef(null);
  const toolTriggerRef = useRef(null);
  const scoreDockRef = useRef(null);
  const settingsRef = useRef(null);
  const atomsRef = useRef(generateAtomLayout([]).map(createAtomState));
  const cameraRef = useRef(createSceneCameraRig());
  const rotationRef = useRef({
    current: new THREE.Quaternion(),
    target: new THREE.Quaternion(),
    lastTrack: new THREE.Vector3(0, 0, 1),
    spinAxis: new THREE.Vector3(0, 1, 0),
    spinVelocity: 0,
    lastDragAt: 0,
  });
  const spreadRef = useRef({ current: 0, target: 0, timeoutId: null });
  const dragRef = useRef({ atomId: null, moved: false, startX: 0, startY: 0 });
  const interactionRef = useRef({
    lastInputAt: typeof performance !== 'undefined' ? performance.now() : 0,
    hoveringAtomId: null,
    selectedAtomId: null,
  });
  const motionPreferenceRef = useRef({
    reduced: readPrefersReducedMotion(),
    visible: typeof document === 'undefined' || document.visibilityState !== 'hidden',
  });
  const frameCommitRef = useRef(0);
  const targetTiltRef = useRef({ x: 0, y: 0 });
  const currentTiltRef = useRef({ x: 0, y: 0 });
  const pendingHoverInfoRef = useRef(null);
  const restoredPortfolioStateRef = useRef(null);
  const portfolioSyncTimerRef = useRef(0);
  const portfolioAutoEnrichmentRef = useRef(new Set());
  if (restoredPortfolioStateRef.current === null) {
    restoredPortfolioStateRef.current = readStoredPortfolioState();
  }
  const restoredPortfolioState = restoredPortfolioStateRef.current;
  const portfolioLastSavedAtRef = useRef(restoredPortfolioState.savedAt);
  const [portfolioEntries, setPortfolioEntries] = useState(() => restoredPortfolioState.entries);
  const portfolioEntriesRef = useRef(restoredPortfolioState.entries);
  const [activePortfolioId, setActivePortfolioId] = useState(
    () => restoredPortfolioState.activePortfolioId,
  );
  const [portfolioError, setPortfolioError] = useState('');
  const [portfolioErrorClosing, setPortfolioErrorClosing] = useState(false);
  const [hoveredFileEntryId, setHoveredFileEntryId] = useState(null);
  const [hoveredFileAnchorRect, setHoveredFileAnchorRect] = useState(null);
  const [toolTrayOpen, setToolTrayOpen] = useState(false);
  const [activeDrawerTool, setActiveDrawerTool] = useState(null);
  const [toolDrawerWidth, setToolDrawerWidth] = useState(TOOL_DRAWER_DEFAULT_WIDTH);
  const [groupDockPosition, setGroupDockPosition] = useState(() =>
    readStoredPosition(STORAGE_KEYS.groupDockPosition),
  );
  const [heatmapDockPosition, setHeatmapDockPosition] = useState(() =>
    readStoredPosition(STORAGE_KEYS.heatmapDockPosition),
  );
  const [scoreDockPosition, setScoreDockPosition] = useState(() =>
    readStoredPosition(STORAGE_KEYS.scoreDockPosition),
  );
  const [showGroupDock, setShowGroupDock] = useState(() => restoredPortfolioState.entries.length > 0);
  const [showScoreDock, setShowScoreDock] = useState(() => restoredPortfolioState.entries.length > 0);
  const [groupDockSpawn, setGroupDockSpawn] = useState(null);
  const [scoreDockSpawn, setScoreDockSpawn] = useState(null);
  const [activeGroupKey, setActiveGroupKey] = useState(null);
  const [selectedAtomId, setSelectedAtomId] = useState(null);
  const [hoverInfo, setHoverInfo] = useState(null);
  const [frameTime, setFrameTime] = useState(0);
  const [shootingStar, setShootingStar] = useState(null);
  const [fileDragActive, setFileDragActive] = useState(false);
  const fileDragCounterRef = useRef(0);
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [introCenterBurstAt, setIntroCenterBurstAt] = useState(-1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeFloatingTool, setActiveFloatingTool] = useState(null);
  const [language, setLanguage] = useState(() => {
    if (typeof window === 'undefined') {
      return 'ko';
    }

    return readStoredOption(STORAGE_KEYS.language, LANGUAGE_OPTIONS, 'ko');
  });
  const text = textFor(language);
  const [baseCurrency, setBaseCurrency] = useState(() =>
    readStoredOption(STORAGE_KEYS.baseCurrency, BASE_CURRENCY_OPTIONS, 'KRW'),
  );
  const [usdKrwRate, setUsdKrwRate] = useState(DEFAULT_USD_KRW_RATE);
  const [dateBasis, setDateBasis] = useState(() =>
    readStoredOption(STORAGE_KEYS.dateBasis, DATE_BASIS_OPTIONS, 'kst'),
  );
  const [autoSaveMode, setAutoSaveMode] = useState(() =>
    readStoredOption(STORAGE_KEYS.autoSave, SETTING_TOGGLE_OPTIONS, 'on'),
  );
  const [dailySnapshotMode, setDailySnapshotMode] = useState(() =>
    readStoredOption(STORAGE_KEYS.dailySnapshots, SETTING_TOGGLE_OPTIONS, 'on'),
  );
  const [, setPortfolioSavedAt] = useState(() => restoredPortfolioState.savedAt);
  const [portfolioSyncStatus, setPortfolioSyncStatus] = useState('idle');
  const [assetClassMode, setAssetClassMode] = useState(() =>
    readStoredOption(STORAGE_KEYS.assetClassMode, ASSET_CLASS_MODE_OPTIONS, 'auto'),
  );
  const [allocationWeightMode, setAllocationWeightMode] = useState(() =>
    readStoredOption(STORAGE_KEYS.allocationWeightMode, ALLOCATION_WEIGHT_MODE_OPTIONS, 'auto'),
  );
  const [scoreWeightPreset, setScoreWeightPreset] = useState(() =>
    readStoredOption(STORAGE_KEYS.scoreWeightPreset, SCORE_WEIGHT_PRESET_OPTIONS, 'balanced'),
  );
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState(() => getPortfolioWorkspaceId());
  const [workspaceSession, setWorkspaceSession] = useState(null);
  const [workspaceClaimStatus, setWorkspaceClaimStatus] = useState('idle');
  const [workspaceClaimError, setWorkspaceClaimError] = useState('');

  portfolioEntriesRef.current = portfolioEntries;

  const noteInteraction = () => {
    interactionRef.current.lastInputAt = performance.now();
  };

  const interactWithFloatingTool = useCallback((toolKey) => {
    noteInteraction();
    setActiveFloatingTool((current) => (current === toolKey ? current : toolKey));
  }, []);

  const floatingLayerStyleFor = useCallback(
    (toolKey) => ({
      zIndex:
        activeFloatingTool === toolKey
          ? ACTIVE_FLOATING_TOOL_Z_INDEX
          : FLOATING_TOOL_Z_INDEX[toolKey],
    }),
    [activeFloatingTool],
  );
  const interactWithSettingsTool = useCallback(
    () => interactWithFloatingTool('settings'),
    [interactWithFloatingTool],
  );
  const interactWithGroupTool = useCallback(
    () => interactWithFloatingTool('group'),
    [interactWithFloatingTool],
  );
  const interactWithHeatmapTool = useCallback(
    () => interactWithFloatingTool('heatmap'),
    [interactWithFloatingTool],
  );
  const interactWithScoreTool = useCallback(
    () => interactWithFloatingTool('score'),
    [interactWithFloatingTool],
  );
  const interactWithToolMenu = useCallback(
    () => interactWithFloatingTool('tool-menu'),
    [interactWithFloatingTool],
  );
  const interactWithAllocationTool = useCallback(
    () => interactWithFloatingTool('allocation'),
    [interactWithFloatingTool],
  );
  const interactWithTwinTool = useCallback(
    () => interactWithFloatingTool('twin'),
    [interactWithFloatingTool],
  );
  const interactWithDrawerTool = useCallback(
    () => interactWithFloatingTool('tool-drawer'),
    [interactWithFloatingTool],
  );
  const handleDrawerToolSelect = useCallback(
    (toolKey) => {
      setActiveDrawerTool(toolKey);
      setToolTrayOpen((currentOpen) => {
        if (currentOpen && activeDrawerTool === toolKey) {
          return false;
        }

        return true;
      });
    },
    [activeDrawerTool],
  );

  const openPortfolioPicker = () => {
    noteInteraction();
    fileInputRef.current?.click();
  };

  const loadWorkspaceSession = useCallback(async () => {
    try {
      const workspaceId = getPortfolioWorkspaceId();
      const session = await fetchWorkspaceSession(workspaceId);
      setCurrentWorkspaceId(workspaceId);
      setWorkspaceSession(session);
    } catch {
      setCurrentWorkspaceId(getPortfolioWorkspaceId());
      setWorkspaceSession(null);
    }
  }, []);

  useEffect(() => {
    void loadWorkspaceSession();
  }, [loadWorkspaceSession]);

  const handleClaimGuestWorkspace = useCallback(async () => {
    const guestWorkspaceId = getPortfolioWorkspaceId();

    if (!isGuestPortfolioWorkspaceId(guestWorkspaceId)) {
      setWorkspaceClaimStatus('done');
      setWorkspaceClaimError('');
      return;
    }

    setWorkspaceClaimStatus('pending');
    setWorkspaceClaimError('');

    try {
      const payload = await claimGuestWorkspace({ guestWorkspaceId });
      if (!payload?.ok || !payload?.targetWorkspaceId) {
        throw new Error(payload?.error ?? text.workspaceClaimFailed);
      }

      const nextWorkspaceId = setPortfolioWorkspaceId(payload.targetWorkspaceId);
      setCurrentWorkspaceId(nextWorkspaceId);

      const safeEntries = Array.isArray(portfolioEntries)
        ? portfolioEntries
            .slice(0, MAX_PORTFOLIOS)
            .map(serializePortfolioEntryForStorage)
            .filter((entry) => entry.id)
        : [];

      if (safeEntries.length) {
        const syncResults = await Promise.allSettled(
          safeEntries.map((entry) => createServerPortfolio(entry, nextWorkspaceId)),
        );
        setPortfolioSyncStatus(
          syncResults.every((result) => result.status === 'fulfilled') ? 'saved' : 'offline',
        );
      }

      const copiedCount =
        Number(payload?.copied?.portfolios ?? 0) +
        Number(payload?.copied?.imports ?? 0) +
        Number(payload?.copied?.analyses ?? 0) +
        Number(payload?.copied?.snapshots ?? 0);
      setWorkspaceClaimStatus(copiedCount > 0 || safeEntries.length ? 'done' : 'empty');
      await loadWorkspaceSession();
    } catch (error) {
      setWorkspaceClaimStatus('failed');
      setWorkspaceClaimError(
        error instanceof Error && error.message ? error.message : text.workspaceClaimFailed,
      );
    }
  }, [loadWorkspaceSession, portfolioEntries, text.workspaceClaimFailed]);

  const handleAuthPanelSuccess = useCallback(() => {
    void handleClaimGuestWorkspace().then(() => loadWorkspaceSession());
  }, [handleClaimGuestWorkspace, loadWorkspaceSession]);

  const showPortfolioError = (message) => {
    setPortfolioErrorClosing(false);
    setPortfolioError(message);
  };

  const clearPortfolioError = () => {
    setPortfolioErrorClosing(false);
    setPortfolioError('');
  };

  const rollForwardSavedPortfolioHistory = useCallback(() => {
    if (dailySnapshotMode !== 'on') {
      return;
    }

    const savedAt = portfolioLastSavedAtRef.current;

    setPortfolioEntries((current) => {
      const nextEntries = rollForwardPortfolioEntriesSince(current, savedAt, dateBasis);

      if (nextEntries !== current) {
        portfolioLastSavedAtRef.current = new Date().toISOString();
      }

      return nextEntries;
    });
  }, [dailySnapshotMode, dateBasis]);

  const clearHoveredFileTooltip = useCallback(() => {
    setHoveredFileEntryId(null);
    setHoveredFileAnchorRect(null);
  }, []);

  const openHoveredFileTooltip = useCallback(
    (entry, anchorElement) => {
      if (!entry || !anchorElement) {
        clearHoveredFileTooltip();
        return;
      }

      const bounds = anchorElement.getBoundingClientRect();
      const nextAnchorRect = {
        left: Math.round(bounds.left * 100) / 100,
        top: Math.round(bounds.top * 100) / 100,
        width: Math.round(bounds.width * 100) / 100,
        height: Math.round(bounds.height * 100) / 100,
      };

      setHoveredFileEntryId(entry.id);
      setHoveredFileAnchorRect((current) => {
        if (
          current &&
          current.left === nextAnchorRect.left &&
          current.top === nextAnchorRect.top &&
          current.width === nextAnchorRect.width &&
          current.height === nextAnchorRect.height
        ) {
          return current;
        }

        return nextAnchorRect;
      });
    },
    [clearHoveredFileTooltip],
  );

  const scheduleLiveQuoteEnrichment = useCallback((entryId, seedItems) => {
    if (!entryId || !Array.isArray(seedItems) || !seedItems.length) {
      return;
    }

    void (async () => {
      try {
        const enrichedItems = await enrichPortfolioItemsWithLiveQuotes(seedItems);

        setPortfolioEntries((current) =>
          current.map((entry) => {
            if (entry.id !== entryId) {
              return entry;
            }

            const hasMatchingTimeline =
              Array.isArray(entry.timelineItems) &&
              entry.timelineItems.length === enrichedItems.length;
            const timelineItems = hasMatchingTimeline
              ? mergePortfolioItemUpdates(entry.timelineItems, enrichedItems)
              : entry.timelineItems;
            const displaySource = hasMatchingTimeline
              ? timelineItems
              : mergePortfolioItemUpdates(entry.items, enrichedItems);

            return {
              ...entry,
              items: collapsePortfolioItemsForDisplayShared(displaySource),
              timelineItems,
            };
          }),
        );
      } catch {
        // Keep uploaded portfolio data when live quote normalization fails.
      }
    })();
  }, []);

  const scheduleSecurityMetadataEnrichment = useCallback((entryId, seedItems) => {
    if (!entryId || !Array.isArray(seedItems) || !seedItems.some(hasMissingCoreMetadata)) {
      return;
    }

    void (async () => {
      let workingItems = seedItems;

      for (const delayMs of SECURITY_ENRICHMENT_RETRY_DELAYS_MS) {
        if (delayMs > 0) {
          await wait(delayMs);
        }

        try {
          const enrichment = await enrichSecurityItemsViaApi(workingItems, { force: true });
          if (!Array.isArray(enrichment?.items) || !enrichment.items.length) {
            continue;
          }

          workingItems = enrichment.items;

          setPortfolioEntries((current) =>
            current.map((entry) =>
              entry.id === entryId
                ? {
                    ...entry,
                    items: mergeSecurityMetadataItems(entry.items, enrichment.items),
                    timelineItems:
                      Array.isArray(entry.timelineItems) &&
                      entry.timelineItems.length === enrichment.items.length
                        ? mergeSecurityMetadataItems(entry.timelineItems, enrichment.items)
                        : entry.timelineItems,
                  }
                : entry,
            ),
          );

          if (!workingItems.some(hasMissingCoreMetadata)) {
            return;
          }
        } catch {
          // Keep the best available local or server-derived metadata and retry later.
        }
      }
    })();
  }, []);

  useEffect(() => {
    if (!portfolioEntries.length) {
      portfolioAutoEnrichmentRef.current.clear();
      return;
    }

    portfolioEntries.forEach((entry) => {
      const sourceItems =
        (Array.isArray(entry.timelineItems) && entry.timelineItems.length
          ? entry.timelineItems
          : entry.items) ?? [];

      if (!entry?.id || !sourceItems.length) {
        return;
      }

      const identifierKey =
        sourceItems.map(metadataMergeKey).filter(Boolean).join('|') ||
        `${entry.fileName ?? entry.id}:${sourceItems.length}`;

      if (sourceItems.some(hasMissingLiveQuote)) {
        const quoteKey = `${entry.id}:quote:${identifierKey}`;
        if (!portfolioAutoEnrichmentRef.current.has(quoteKey)) {
          portfolioAutoEnrichmentRef.current.add(quoteKey);
          scheduleLiveQuoteEnrichment(entry.id, sourceItems);
        }
      }

      if (sourceItems.some(hasMissingCoreMetadata)) {
        const metadataKey = `${entry.id}:metadata:${identifierKey}`;
        if (!portfolioAutoEnrichmentRef.current.has(metadataKey)) {
          portfolioAutoEnrichmentRef.current.add(metadataKey);
          const locallyEnrichedItems = sourceItems.map((item) => enrichPortfolioItem(item));

          setPortfolioEntries((current) =>
            current.map((currentEntry) =>
              currentEntry.id === entry.id
                ? {
                    ...currentEntry,
                    items: mergeSecurityMetadataItems(currentEntry.items, locallyEnrichedItems),
                    timelineItems:
                      Array.isArray(currentEntry.timelineItems) && currentEntry.timelineItems.length
                        ? mergeSecurityMetadataItems(currentEntry.timelineItems, locallyEnrichedItems)
                        : currentEntry.timelineItems,
                  }
                : currentEntry,
            ),
          );
          scheduleSecurityMetadataEnrichment(entry.id, locallyEnrichedItems);
        }
      }
    });
  }, [portfolioEntries, scheduleLiveQuoteEnrichment, scheduleSecurityMetadataEnrichment]);

  const settingsDock = useFloatingHandle({
    initialPosition: (win) => {
      const inset = uiInsetFor(win.innerWidth);
      const size = gearSizeFor(win.innerWidth);
      return {
        x: win.innerWidth - size - inset,
        y: inset,
      };
    },
    fallbackSize: (width) => {
      const size = gearSizeFor(width);
      return { width: size, height: size };
    },
    onInteract: interactWithSettingsTool,
    onPress: () => {
      setSettingsOpen((current) => !current);
    },
  });

  const createDockSpawn = (rect, size) => ({
    x: rect.left + rect.width * 0.5 - size * 0.5,
    y: rect.top + rect.height * 0.5 - size * 0.5,
    session: performance.now(),
  });

  const handleSelectGroupDock = (rect) => {
    noteInteraction();
    setShowGroupDock(true);
    setGroupDockSpawn(createDockSpawn(rect, groupDockSizeFor(window.innerWidth)));
  };

  const handleSelectScoreDock = (rect) => {
    noteInteraction();
    setShowScoreDock(true);
    setScoreDockSpawn(createDockSpawn(rect, scoreDockSizeFor(window.innerWidth)));
  };

  const updateHoverInfo = (atomId, clientX, clientY) => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    pendingHoverInfoRef.current = {
      atomId,
      x: Math.round(clamp(clientX + 18, 16, viewportWidth - TOOLTIP_WIDTH - 16)),
      y: Math.round(clamp(clientY + 18, 16, viewportHeight - TOOLTIP_HEIGHT - 16)),
    };
  };

  const clientToLocalPoint = (clientX, clientY) => {
    const svg = svgRef.current;

    if (!svg) {
      return null;
    }

    const bounds = svg.getBoundingClientRect();

    if (!bounds.width || !bounds.height) {
      return null;
    }

    return {
      x: ((clientX - bounds.left) / bounds.width) * VIEWBOX_SIZE - VIEWBOX_HALF,
      y: ((clientY - bounds.top) / bounds.height) * VIEWBOX_SIZE - VIEWBOX_HALF,
    };
  };

  useEffect(() => {
    interactionRef.current.selectedAtomId = selectedAtomId;
  }, [selectedAtomId]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const motionQuery =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;

    const syncMotionPreference = () => {
      motionPreferenceRef.current.reduced = Boolean(motionQuery?.matches);
      document.documentElement.dataset.motion = motionPreferenceRef.current.reduced
        ? 'reduced'
        : 'full';
      frameCommitRef.current = 0;
    };

    const syncVisibility = () => {
      motionPreferenceRef.current.visible = document.visibilityState !== 'hidden';
      frameCommitRef.current = 0;
    };

    syncMotionPreference();
    syncVisibility();
    document.addEventListener('visibilitychange', syncVisibility);
    if (motionQuery?.addEventListener) {
      motionQuery.addEventListener('change', syncMotionPreference);
    } else {
      motionQuery?.addListener?.(syncMotionPreference);
    }

    return () => {
      document.removeEventListener('visibilitychange', syncVisibility);
      if (motionQuery?.removeEventListener) {
        motionQuery.removeEventListener('change', syncMotionPreference);
      } else {
        motionQuery?.removeListener?.(syncMotionPreference);
      }
      delete document.documentElement.dataset.motion;
    };
  }, []);

  useEffect(() => {
    let frameId = 0;
    let last = performance.now();
    const autoRotateY = new THREE.Quaternion();
    const autoRotateX = new THREE.Quaternion();
    const spinQuaternion = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const xAxis = new THREE.Vector3(1, 0, 0);

    const animate = (now) => {
      const delta = Math.min((now - last) / 1000, 0.05);
      last = now;
      const motionPreference = motionPreferenceRef.current;
      const isDraggingStructure = Boolean(dragRef.current.atomId);
      const hasDragSpin = rotationRef.current.spinVelocity > 0.01;

      if (!motionPreference.visible) {
        frameId = window.requestAnimationFrame(animate);
        return;
      }

      currentTiltRef.current.x = damp(
        currentTiltRef.current.x,
        targetTiltRef.current.x,
        7,
        delta,
      );
      currentTiltRef.current.y = damp(
        currentTiltRef.current.y,
        targetTiltRef.current.y,
        7,
        delta,
      );

      if (shellRef.current) {
        shellRef.current.style.setProperty(
          '--drift-x',
          `${(motionPreference.reduced ? 0 : currentTiltRef.current.x * 4).toFixed(2)}px`,
        );
        shellRef.current.style.setProperty(
          '--drift-y',
          `${(motionPreference.reduced ? 0 : currentTiltRef.current.y * 4).toFixed(2)}px`,
        );
      }

      for (const atom of atomsRef.current) {
        atom.hoverMix = damp(atom.hoverMix, atom.hovered ? 1 : 0, 10, delta);
        atom.dragMix = damp(atom.dragMix, atom.dragging ? 1 : 0, 12, delta);
      }

      spreadRef.current.current = damp(
        spreadRef.current.current,
        spreadRef.current.target,
        spreadRef.current.target > spreadRef.current.current ? 12 : 18,
        delta,
      );

      const shouldAutoRotate =
        !motionPreference.reduced &&
        !isDraggingStructure;

      if (!motionPreference.reduced && !isDraggingStructure && hasDragSpin) {
        spinQuaternion.setFromAxisAngle(
          rotationRef.current.spinAxis,
          Math.min(rotationRef.current.spinVelocity * delta, 0.04),
        );
        rotationRef.current.target.premultiply(spinQuaternion).normalize();
        rotationRef.current.spinVelocity *= Math.exp(-DRAG_SPIN_DECAY * delta);
        if (rotationRef.current.spinVelocity < 0.01) {
          rotationRef.current.spinVelocity = 0;
        }
      }

      if (shouldAutoRotate) {
        autoRotateY.setFromAxisAngle(yAxis, delta * AUTO_ROTATE_SPEED);
        autoRotateX.setFromAxisAngle(xAxis, Math.sin(now * 0.00012) * delta * 0.0038);
        rotationRef.current.target
          .premultiply(autoRotateY)
          .premultiply(autoRotateX)
          .normalize();
      }

      rotationRef.current.current.slerp(
        rotationRef.current.target,
        1 - Math.exp(-(isDraggingStructure ? DRAG_ROTATION_RESPONSE : IDLE_ROTATION_RESPONSE) * delta),
      );
      rotationRef.current.current.normalize();
      const idleDriftX =
        motionPreference.reduced
          ? 0
          : Math.sin(now * 0.00018) * 8.2 +
            Math.cos(now * 0.000071 + currentTiltRef.current.x * 0.8) * 2.0;
      const idleDriftY =
        motionPreference.reduced
          ? 0
          : Math.cos(now * 0.00015) * 6.4 +
            Math.sin(now * 0.000096 + currentTiltRef.current.y * 0.9) * 1.8;

      cameraRef.current.target.focus = 0;
      cameraRef.current.target.panX = 0;
      cameraRef.current.target.panY = 0;
      cameraRef.current.target.dolly = 0;
      cameraRef.current.target.zoom = 1;
      cameraRef.current.target.roll =
        motionPreference.reduced
          ? 0
          : Math.sin(now * 0.00009) * 0.64 + currentTiltRef.current.x * 0.42;
      cameraRef.current.target.driftX = idleDriftX;
      cameraRef.current.target.driftY = idleDriftY;

      cameraRef.current.current.panX = damp(
        cameraRef.current.current.panX,
        cameraRef.current.target.panX,
        5.8,
        delta,
      );
      cameraRef.current.current.panY = damp(
        cameraRef.current.current.panY,
        cameraRef.current.target.panY,
        5.8,
        delta,
      );
      cameraRef.current.current.dolly = damp(
        cameraRef.current.current.dolly,
        cameraRef.current.target.dolly,
        6.4,
        delta,
      );
      cameraRef.current.current.zoom = damp(
        cameraRef.current.current.zoom,
        cameraRef.current.target.zoom,
        6.2,
        delta,
      );
      cameraRef.current.current.roll = damp(
        cameraRef.current.current.roll,
        cameraRef.current.target.roll,
        5.4,
        delta,
      );
      cameraRef.current.current.driftX = damp(
        cameraRef.current.current.driftX,
        cameraRef.current.target.driftX,
        3.8,
        delta,
      );
      cameraRef.current.current.driftY = damp(
        cameraRef.current.current.driftY,
        cameraRef.current.target.driftY,
        3.8,
        delta,
      );
      cameraRef.current.current.focus = damp(
        cameraRef.current.current.focus,
        cameraRef.current.target.focus,
        6.8,
        delta,
      );

      if (
        now - frameCommitRef.current >=
        sceneFrameIntervalFor(
          atomsRef.current.length,
          motionPreference.reduced,
          isDraggingStructure || hasDragSpin,
        )
      ) {
        frameCommitRef.current = now;
        setFrameTime(now);
        if (pendingHoverInfoRef.current !== null) {
          const pending = pendingHoverInfoRef.current;
          pendingHoverInfoRef.current = null;
          setHoverInfo((current) => {
            if (
              current?.atomId === pending.atomId &&
              current.x === pending.x &&
              current.y === pending.y
            ) {
              return current;
            }
            return pending;
          });
        }
      }
      frameId = window.requestAnimationFrame(animate);
    };

    frameId = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(spreadRef.current.timeoutId);
      document.body.style.cursor = '';
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(STORAGE_KEYS.language, language);
    document.documentElement.lang = language === 'en' ? 'en' : 'ko';
    window.localStorage.removeItem('atom-sketch-theme');
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = 'dark';
  }, [language]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(STORAGE_KEYS.baseCurrency, baseCurrency);
  }, [baseCurrency]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const controller = new AbortController();
    let active = true;

    const loadUsdKrwRate = async () => {
      try {
        const rateData = await fetchLiveMarketData({
          ticker: 'USDKRW=X',
          name: 'USD/KRW',
          signal: controller.signal,
        });
        const nextRate = Number(rateData?.latestPrice);

        if (!active || controller.signal.aborted || !Number.isFinite(nextRate) || nextRate <= 0) {
          return;
        }

        setUsdKrwRate(nextRate);
      } catch {
        // Keep the fallback exchange rate when the live FX lookup is unavailable.
      }
    };

    loadUsdKrwRate();
    const intervalId = window.setInterval(loadUsdKrwRate, 15 * 60 * 1000);

    return () => {
      active = false;
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(STORAGE_KEYS.dateBasis, dateBasis);
  }, [dateBasis]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(STORAGE_KEYS.autoSave, autoSaveMode);
  }, [autoSaveMode]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(STORAGE_KEYS.dailySnapshots, dailySnapshotMode);
  }, [dailySnapshotMode]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const motionQuery =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;

    let clearId = 0;

    const triggerShootingStar = () => {
      if (motionQuery?.matches || document.visibilityState === 'hidden') {
        return;
      }

      const nextShootingStar = createShootingStar();
      setShootingStar(nextShootingStar);
      window.clearTimeout(clearId);
      clearId = window.setTimeout(() => {
        setShootingStar((current) =>
          current?.id === nextShootingStar.id ? null : current,
        );
      }, nextShootingStar.duration + SHOOTING_STAR_CLEAR_BUFFER_MS);
    };

    const clearActiveShootingStar = () => {
      if (!motionQuery?.matches && document.visibilityState !== 'hidden') {
        return;
      }

      window.clearTimeout(clearId);
      setShootingStar(null);
    };

    const intervalId = window.setInterval(triggerShootingStar, SHOOTING_STAR_INTERVAL_MS);
    document.addEventListener('visibilitychange', clearActiveShootingStar);
    if (motionQuery?.addEventListener) {
      motionQuery.addEventListener('change', clearActiveShootingStar);
    } else {
      motionQuery?.addListener?.(clearActiveShootingStar);
    }

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(clearId);
      document.removeEventListener('visibilitychange', clearActiveShootingStar);
      if (motionQuery?.removeEventListener) {
        motionQuery.removeEventListener('change', clearActiveShootingStar);
      } else {
        motionQuery?.removeListener?.(clearActiveShootingStar);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(STORAGE_KEYS.assetClassMode, assetClassMode);
  }, [assetClassMode]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(STORAGE_KEYS.allocationWeightMode, allocationWeightMode);
  }, [allocationWeightMode]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(STORAGE_KEYS.scoreWeightPreset, scoreWeightPreset);
  }, [scoreWeightPreset]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    if (dailySnapshotMode !== 'on') {
      return undefined;
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        rollForwardSavedPortfolioHistory();
      }
    };

    const intervalId = window.setInterval(
      rollForwardSavedPortfolioHistory,
      DAILY_SNAPSHOT_CHECK_INTERVAL_MS,
    );

    window.addEventListener('focus', rollForwardSavedPortfolioHistory);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', rollForwardSavedPortfolioHistory);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [dailySnapshotMode, rollForwardSavedPortfolioHistory]);

  useEffect(() => {
    if (dailySnapshotMode !== 'on') {
      return;
    }

    rollForwardSavedPortfolioHistory();
  }, [dailySnapshotMode, dateBasis, rollForwardSavedPortfolioHistory]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    let cancelled = false;

    void listServerPortfolios()
      .then((payload) => {
        if (cancelled) {
          return;
        }

        const serverEntries = Array.isArray(payload?.portfolios)
          ? payload.portfolios
              .slice(0, MAX_PORTFOLIOS)
              .map((portfolio) => {
                const entry = createPortfolioEntryFromPayload(portfolio, portfolio?.id);
                return dailySnapshotMode === 'on'
                  ? rollForwardPortfolioEntry(
                      entry,
                      portfolio?.updatedAt ?? portfolio?.createdAt,
                      dateBasis,
                    )
                  : entry;
              })
              .filter((entry) => entry.id)
          : [];

        if (!serverEntries.length) {
          return;
        }

        const { entries: mergedEntries, summary } = mergePortfolioEntriesWithServer(
          portfolioEntriesRef.current,
          serverEntries,
        );
        const hasServerUpdates = summary.addedFromServer > 0 || summary.updatedFromServer > 0;

        if (hasServerUpdates) {
          portfolioEntriesRef.current = mergedEntries;
          setPortfolioEntries(mergedEntries);
          setActivePortfolioId((current) =>
            mergedEntries.some((entry) => entry.id === current)
              ? current
              : mergedEntries[0]?.id ?? null,
          );
          setPortfolioSyncStatus('server-merged');
          setShowGroupDock(true);
          setShowScoreDock(true);
          return;
        }

        if (summary.localNewer > 0) {
          setPortfolioSyncStatus('conflict');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPortfolioSyncStatus('offline');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [dailySnapshotMode, dateBasis]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    window.clearTimeout(portfolioSyncTimerRef.current);
    let cancelled = false;

    if (autoSaveMode !== 'on') {
      setPortfolioSyncStatus('paused');
      return undefined;
    }

    const persistedAt = writeStoredPortfolioState(portfolioEntries, activePortfolioId);
    const localPersistFailed = portfolioEntries.length > 0 && !persistedAt;
    portfolioLastSavedAtRef.current = persistedAt;
    setPortfolioSavedAt(persistedAt);

    const safeEntries = Array.isArray(portfolioEntries)
      ? portfolioEntries
          .slice(0, MAX_PORTFOLIOS)
          .map(serializePortfolioEntryForStorage)
          .filter((entry) => entry.id)
      : [];

    if (!safeEntries.length) {
      setPortfolioSyncStatus('idle');
      return undefined;
    }

    setPortfolioSyncStatus(localPersistFailed ? 'local-failed' : 'pending');
    portfolioSyncTimerRef.current = window.setTimeout(() => {
      void Promise.allSettled(safeEntries.map((entry) => createServerPortfolio(entry)))
        .then((results) => {
          if (cancelled) {
            return;
          }

          const allSaved = results.every((result) => result.status === 'fulfilled');
          setPortfolioSyncStatus(allSaved ? (localPersistFailed ? 'local-failed' : 'saved') : 'offline');
        })
        .catch(() => {
          if (!cancelled) {
            setPortfolioSyncStatus('offline');
          }
        });
    }, SERVER_SYNC_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(portfolioSyncTimerRef.current);
    };
  }, [activePortfolioId, autoSaveMode, portfolioEntries]);

  useEffect(() => {
    if (!settingsOpen) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (settingsRef.current?.contains(event.target)) {
        return;
      }

      setSettingsOpen(false);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [settingsOpen]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement ||
        event.target.isContentEditable
      ) {
        return;
      }

      if (event.key === 'Escape') {
        if (settingsOpen) {
          setSettingsOpen(false);
        }
        return;
      }

      if ((event.key === 'u' || event.key === 'U') && !event.metaKey && !event.ctrlKey && !event.altKey) {
        openPortfolioPicker();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [settingsOpen]);

  useEffect(() => {
    if (!portfolioError) {
      setPortfolioErrorClosing(false);
      return undefined;
    }

    const fadeId = window.setTimeout(() => {
      setPortfolioErrorClosing(true);
    }, 3000);
    const clearId = window.setTimeout(() => {
      clearPortfolioError();
    }, 3600);

    return () => {
      window.clearTimeout(fadeId);
      window.clearTimeout(clearId);
    };
  }, [portfolioError]);

  const activePortfolio =
    portfolioEntries.find((entry) => entry.id === activePortfolioId) ?? portfolioEntries[0] ?? null;
  const portfolioItems = activePortfolio?.items ?? [];
  const portfolioTimelineItems = activePortfolio?.timelineItems ?? portfolioItems;
  const allPortfolioItems = useMemo(
    () =>
      portfolioEntries.flatMap((entry) =>
        Array.isArray(entry.items) ? entry.items : [],
      ),
    [portfolioEntries],
  );

  useEffect(() => {
    atomsRef.current = generateAtomLayout(portfolioItems).map(createAtomState);
    dragRef.current.atomId = null;
    dragRef.current.moved = false;
    rotationRef.current.spinVelocity = 0;
    interactionRef.current.hoveringAtomId = null;
    interactionRef.current.selectedAtomId = null;
    interactionRef.current.lastInputAt = performance.now();
    pendingHoverInfoRef.current = null;
    document.body.style.cursor = '';
    setSelectedAtomId(null);
    setHoverInfo(null);
  }, [portfolioItems]);

  useEffect(() => {
    if (!portfolioEntries.length) {
      if (activePortfolioId) {
        setActivePortfolioId(null);
      }
      return;
    }

    if (!portfolioEntries.some((entry) => entry.id === activePortfolioId)) {
      setActivePortfolioId(portfolioEntries[0].id);
    }
  }, [activePortfolioId, portfolioEntries]);

  useEffect(() => {
    const deltaQuaternion = new THREE.Quaternion();
    const appliedDeltaQuaternion = new THREE.Quaternion();
    const dragSpinAxis = new THREE.Vector3();

    const updateDraggedStructure = (event) => {
      if (!dragRef.current.atomId) {
        return;
      }

      event.preventDefault();
      noteInteraction();

      if (!dragRef.current.moved) {
        const moveX = event.clientX - dragRef.current.startX;
        const moveY = event.clientY - dragRef.current.startY;
        if (moveX * moveX + moveY * moveY > 36) {
          dragRef.current.moved = true;
        }
      }

      const point = clientToLocalPoint(event.clientX, event.clientY);
      if (!point) {
        return;
      }

      const nextTrack = trackballVector(point);
      deltaQuaternion.setFromUnitVectors(rotationRef.current.lastTrack, nextTrack);
      appliedDeltaQuaternion.identity().slerp(deltaQuaternion, DRAG_ROTATION_SENSITIVITY);
      rotationRef.current.target.premultiply(appliedDeltaQuaternion).normalize();
      const now = performance.now();
      const elapsed = rotationRef.current.lastDragAt
        ? Math.max((now - rotationRef.current.lastDragAt) / 1000, 0.001)
        : 0;
      const quaternionW = clamp(appliedDeltaQuaternion.w, -1, 1);
      const angle = 2 * Math.acos(quaternionW);
      const sinHalfAngle = Math.sqrt(Math.max(0, 1 - quaternionW * quaternionW));

      if (elapsed > 0 && angle > 0.0001 && sinHalfAngle > 0.0001) {
        dragSpinAxis
          .set(
            appliedDeltaQuaternion.x / sinHalfAngle,
            appliedDeltaQuaternion.y / sinHalfAngle,
            appliedDeltaQuaternion.z / sinHalfAngle,
          )
          .normalize();
        rotationRef.current.spinAxis.lerp(dragSpinAxis, 0.42).normalize();
        rotationRef.current.spinVelocity =
          rotationRef.current.spinVelocity * 0.52 +
          clamp(angle / elapsed, 0, MAX_DRAG_SPIN_VELOCITY) * 0.48;
      }

      rotationRef.current.lastDragAt = now;
      rotationRef.current.lastTrack.copy(nextTrack);
    };

    const endDrag = () => {
      if (!dragRef.current.atomId) {
        return;
      }

      const clickedAtomId = dragRef.current.atomId;
      const wasMoved = dragRef.current.moved;
      const atom = atomsRef.current.find((item) => item.id === clickedAtomId);
      if (atom) {
        atom.dragging = false;
      }

      dragRef.current.atomId = null;
      dragRef.current.moved = false;
      if (!wasMoved) {
        rotationRef.current.spinVelocity = 0;
      } else {
        interactionRef.current.hoveringAtomId = null;
      }
      interactionRef.current.lastInputAt = performance.now();
      pendingHoverInfoRef.current = null;
      document.body.style.cursor = '';
      setHoverInfo(null);

      if (!wasMoved) {
        setSelectedAtomId((current) => (current === clickedAtomId ? null : clickedAtomId));
      }
    };

    window.addEventListener('pointermove', updateDraggedStructure, {
      passive: false,
    });
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);

    return () => {
      window.removeEventListener('pointermove', updateDraggedStructure);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    };
  }, []);

  const handleNodePointerDown = (atomId, event) => {
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);

    if (dragRef.current.atomId) {
      const previousAtom = atomsRef.current.find(
        (item) => item.id === dragRef.current.atomId,
      );

      if (previousAtom) {
        previousAtom.dragging = false;
      }
    }

    const atom = atomsRef.current.find((item) => item.id === atomId);
    const point = clientToLocalPoint(event.clientX, event.clientY);

    if (!atom || !point) {
      return;
    }

    dragRef.current.atomId = atomId;
    dragRef.current.moved = false;
    dragRef.current.startX = event.clientX;
    dragRef.current.startY = event.clientY;
    interactionRef.current.hoveringAtomId = atomId;
    noteInteraction();
    atom.dragging = true;
    rotationRef.current.lastTrack.copy(trackballVector(point));
    rotationRef.current.lastDragAt = performance.now();
    rotationRef.current.spinVelocity = 0;
    frameCommitRef.current = 0;
    pendingHoverInfoRef.current = null;
    document.body.style.cursor = 'grabbing';
    setHoverInfo(null);
  };

  const handleNodeEnter = (atomId, event) => {
    const atom = atomsRef.current.find((item) => item.id === atomId);

    if (!atom) {
      return;
    }

    atom.hovered = true;
    interactionRef.current.hoveringAtomId = atomId;
    noteInteraction();
    updateHoverInfo(atomId, event.clientX, event.clientY);
    targetTiltRef.current.x = 0;
    targetTiltRef.current.y = 0;

    if (!atom.dragging) {
      document.body.style.cursor = 'grab';
    }
  };

  const handleNodeMove = (atomId, event) => {
    noteInteraction();

    if (dragRef.current.atomId) {
      return;
    }

    updateHoverInfo(atomId, event.clientX, event.clientY);
  };

  const handleNodeLeave = (atomId) => {
    const atom = atomsRef.current.find((item) => item.id === atomId);

    if (!atom) {
      if (pendingHoverInfoRef.current?.atomId === atomId) {
        pendingHoverInfoRef.current = null;
      }
      return;
    }

    atom.hovered = false;
    if (interactionRef.current.hoveringAtomId === atomId) {
      interactionRef.current.hoveringAtomId = null;
    }
    if (pendingHoverInfoRef.current?.atomId === atomId) {
      pendingHoverInfoRef.current = null;
    }
    noteInteraction();
    setHoverInfo((current) => (current?.atomId === atomId ? null : current));

    if (!atom.dragging) {
      document.body.style.cursor = '';
    }
  };

  const handleNodeKeyboardSelect = useCallback((atomId) => {
    const atom = atomsRef.current.find((item) => item.id === atomId);

    if (!atom) {
      return;
    }

    noteInteraction();
    setHoverInfo(null);
    setActiveGroupKey(null);
    setSelectedAtomId((current) => (current === atomId ? null : atomId));
  }, []);

  const handlePointerMove = () => {
    noteInteraction();
    targetTiltRef.current.x = 0;
    targetTiltRef.current.y = 0;
  };

  const handlePointerLeave = () => {
    noteInteraction();
    targetTiltRef.current.x = 0;
    targetTiltRef.current.y = 0;
  };

  const handleWheel = (event) => {
    event.preventDefault();
    noteInteraction();
    window.clearTimeout(spreadRef.current.timeoutId);
    spreadRef.current.target = 0;
    spreadRef.current.current = 0;
  };

  const handlePortfolioFileChange = async (event) => {
    const files = Array.from(event.target.files ?? []);
    const currentText = textFor(language);

    if (!files.length) {
      return;
    }

    noteInteraction();

    const remainingSlots = Math.max(0, MAX_PORTFOLIOS - portfolioEntries.length);
    if (!remainingSlots) {
      showPortfolioError(currentText.maxFilesError);
      event.target.value = '';
      return;
    }

    setPortfolioLoading(true);

    try {
      const nextPreparedEntries = [];

      for (const file of files.slice(0, remainingSlots)) {
        const text = await readPortfolioFile(file);
        const { items: localItems, diagnostics: localParserDiagnostics } =
          parsePortfolioTextDetailedShared(text);

        if (!localItems.length) {
          throw new Error(`${file.name}: ${currentText.parseError}`);
        }

        const entryId =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `portfolio-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

        nextPreparedEntries.push({
          entryId,
          fileName: file.name,
          text,
          localItems,
          localParserDiagnostics,
          localEntry: createPortfolioEntryFromPayload(
            buildLocalPortfolioPayload(file.name, localItems, localParserDiagnostics),
            entryId,
          ),
        });
      }

      clearPortfolioError();
      setSelectedAtomId(null);
      setActiveGroupKey(null);
      setShowGroupDock(true);
      setShowScoreDock(true);
      setGroupDockSpawn(null);
      setScoreDockSpawn(null);
      setPortfolioEntries((current) =>
        [...current, ...nextPreparedEntries.map((entry) => entry.localEntry)].slice(0, MAX_PORTFOLIOS),
      );
      setActivePortfolioId((current) => current ?? nextPreparedEntries[0]?.entryId ?? null);
      setPortfolioLoading(false);

      nextPreparedEntries.forEach(
        ({ entryId, fileName, text, localItems, localParserDiagnostics }) => {
          void (async () => {
            let payload;

            try {
              payload = await ingestPortfolioTextViaApi(fileName, text);

              if (shouldFallbackToLocalTimelineShared(payload, localItems)) {
                payload = {
                  ...buildLocalPortfolioPayload(fileName, localItems, localParserDiagnostics, {
                    agentReview: {
                      ...(payload.agentReview ?? {}),
                      status:
                        payload.agentReview?.status === 'blocked' ? 'blocked' : 'needs-review',
                      summary:
                        payload.agentReview?.summary ??
                        '서버 결과를 받았지만 시계열 데이터는 로컬 파서를 우선 적용했습니다.',
                      warnings: [
                        ...(payload.agentReview?.warnings ?? []),
                        {
                          code: 'local-timeline-override',
                          severity: 'warning',
                          message:
                            '서버 시계열 결과가 너무 짧아 로컬 파서의 timeline 데이터를 표시합니다.',
                          source: 'client-fallback',
                        },
                      ],
                    },
                    ingestSource: 'server-with-local-timeline',
                  }),
                };
              } else {
                payload = {
                  ...payload,
                  ingestSource: 'server',
                };
              }
            } catch (error) {
              payload = buildLocalPortfolioPayload(fileName, localItems, localParserDiagnostics, {
                agentReview: {
                  mode: 'client-local-fallback',
                  status: localItems.length ? 'needs-review' : 'blocked',
                  summary: '서버 ingest에 실패해 브라우저 로컬 파서 결과를 유지합니다.',
                  warnings: [
                    {
                      code: 'server-ingest-failed',
                      severity: 'warning',
                      message:
                        error instanceof Error
                          ? error.message
                          : 'Server ingest failed. Showing the local parser result instead.',
                      source: 'client-fallback',
                    },
                  ],
                  agents: [],
                },
                ingestSource: 'client-local-fallback',
              });
            }

            const nextEntry = createPortfolioEntryFromPayload(payload, entryId);
            setPortfolioEntries((current) =>
              current.map((entry) => (entry.id === entryId ? nextEntry : entry)),
            );
            queueImportHistorySync(nextEntry);
            scheduleLiveQuoteEnrichment(entryId, nextEntry.items);
            scheduleSecurityMetadataEnrichment(entryId, payload?.items);
          })();
        },
      );
    } catch (error) {
      showPortfolioError(error instanceof Error ? error.message : currentText.readError);
      setPortfolioLoading(false);
    } finally {
      event.target.value = '';
    }
  };

  const processPortfolioFiles = async (files) => {
    const currentText = textFor(language);

    if (!files.length) {
      return;
    }

    noteInteraction();

    const remainingSlots = Math.max(0, MAX_PORTFOLIOS - portfolioEntries.length);
    if (!remainingSlots) {
      showPortfolioError(currentText.maxFilesError);
      return;
    }

    setPortfolioLoading(true);

    try {
      const nextPreparedEntries = [];

      for (const file of files.slice(0, remainingSlots)) {
        const text = await readPortfolioFile(file);
        const { items: localItems, diagnostics: localParserDiagnostics } =
          parsePortfolioTextDetailedShared(text);

        if (!localItems.length) {
          throw new Error(`${file.name}: ${currentText.parseError}`);
        }

        const entryId =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `portfolio-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

        nextPreparedEntries.push({
          entryId,
          fileName: file.name,
          text,
          localItems,
          localParserDiagnostics,
          localEntry: createPortfolioEntryFromPayload(
            buildLocalPortfolioPayload(file.name, localItems, localParserDiagnostics),
            entryId,
          ),
        });
      }

      clearPortfolioError();
      setSelectedAtomId(null);
      setActiveGroupKey(null);
      setShowGroupDock(true);
      setShowScoreDock(true);
      setGroupDockSpawn(null);
      setScoreDockSpawn(null);
      setPortfolioEntries((current) =>
        [...current, ...nextPreparedEntries.map((entry) => entry.localEntry)].slice(0, MAX_PORTFOLIOS),
      );
      setActivePortfolioId((current) => current ?? nextPreparedEntries[0]?.entryId ?? null);
      setPortfolioLoading(false);

      nextPreparedEntries.forEach(
        ({ entryId, fileName, text, localItems, localParserDiagnostics }) => {
          void (async () => {
            let payload;

            try {
              payload = await ingestPortfolioTextViaApi(fileName, text);

              if (shouldFallbackToLocalTimelineShared(payload, localItems)) {
                payload = {
                  ...buildLocalPortfolioPayload(fileName, localItems, localParserDiagnostics, {
                    agentReview: {
                      ...(payload.agentReview ?? {}),
                      status:
                        payload.agentReview?.status === 'blocked' ? 'blocked' : 'needs-review',
                      summary:
                        payload.agentReview?.summary ??
                        '서버 결과를 받았지만 시계열 데이터는 로컬 파서를 우선 적용했습니다.',
                      warnings: [
                        ...(payload.agentReview?.warnings ?? []),
                        {
                          code: 'local-timeline-override',
                          severity: 'warning',
                          message:
                            '서버 시계열 결과가 너무 짧아 로컬 파서의 timeline 데이터를 표시합니다.',
                          source: 'client-fallback',
                        },
                      ],
                    },
                    ingestSource: 'server-with-local-timeline',
                  }),
                };
              } else {
                payload = {
                  ...payload,
                  ingestSource: 'server',
                };
              }
            } catch {
              payload = buildLocalPortfolioPayload(fileName, localItems, localParserDiagnostics, {
                agentReview: {
                  mode: 'client-local-fallback',
                  status: localItems.length ? 'needs-review' : 'blocked',
                  summary: '서버 ingest에 실패해 브라우저 로컬 파서 결과를 유지합니다.',
                  warnings: [
                    {
                      code: 'server-ingest-failed',
                      severity: 'warning',
                      message: 'Server ingest failed. Showing the local parser result instead.',
                      source: 'client-fallback',
                    },
                  ],
                  agents: [],
                },
                ingestSource: 'client-local-fallback',
              });
            }

            const nextEntry = createPortfolioEntryFromPayload(payload, entryId);
            setPortfolioEntries((current) =>
              current.map((entry) => (entry.id === entryId ? nextEntry : entry)),
            );
            queueImportHistorySync(nextEntry);
            scheduleLiveQuoteEnrichment(entryId, nextEntry.items);
            scheduleSecurityMetadataEnrichment(entryId, payload?.items);
          })();
        },
      );
    } catch (error) {
      showPortfolioError(error instanceof Error ? error.message : currentText.readError);
      setPortfolioLoading(false);
    }
  };

  const handleFileDragEnter = (event) => {
    if (!event.dataTransfer?.types?.includes('Files')) {
      return;
    }

    event.preventDefault();
    fileDragCounterRef.current += 1;
    setFileDragActive(true);
  };

  const handleFileDragOver = (event) => {
    if (!event.dataTransfer?.types?.includes('Files')) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleFileDragLeave = (event) => {
    fileDragCounterRef.current -= 1;
    if (fileDragCounterRef.current <= 0) {
      fileDragCounterRef.current = 0;
      setFileDragActive(false);
    }
  };

  const handleFileDrop = async (event) => {
    event.preventDefault();
    fileDragCounterRef.current = 0;
    setFileDragActive(false);

    const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => {
      const name = file.name.toLowerCase();
      return name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt') ||
        file.type === 'text/csv' || file.type === 'text/tab-separated-values' || file.type === 'text/plain';
    });

    await processPortfolioFiles(files);
  };

  const handleClearPortfolio = (entryId) => {
    noteInteraction();
    clearHoveredFileTooltip();
    const nextEntries = portfolioEntries.filter((entry) => entry.id !== entryId);
    const nextActiveId =
      activePortfolioId === entryId ? nextEntries[0]?.id ?? null : activePortfolioId;

    setPortfolioEntries(nextEntries);
    setActivePortfolioId(nextActiveId);
    void deleteServerPortfolio(entryId).catch(() => {});
    clearPortfolioError();
    if (!nextEntries.length) {
      setShowGroupDock(false);
      setShowScoreDock(false);
      setGroupDockSpawn(null);
      setScoreDockSpawn(null);
      setActiveGroupKey(null);
      setSelectedAtomId(null);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleCreateManualAtom = ({ accountName }) => {
    const safeAccountName = String(accountName ?? '').trim();

    if (!safeAccountName) {
      return;
    }

    if (portfolioEntries.length >= MAX_PORTFOLIOS) {
      showPortfolioError(textFor(language).maxFilesError);
      return;
    }

    noteInteraction();
    clearPortfolioError();

    const entryId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `manual-atom-${Date.now()}`;
    const payload = buildLocalPortfolioPayload(
      `${safeAccountName}.manual.csv`,
      [],
      {
        reviewStatus: 'ok',
        warnings: [],
      },
      {
        agentReview: {
          status: 'ok',
          summary: '사용자가 직접 생성한 포트폴리오입니다.',
          warnings: [],
          agents: [],
        },
        ingestSource: 'manual-entry',
      },
    );
    const entry = createPortfolioEntryFromPayload(payload, entryId);

    setPortfolioEntries((current) => [...current, entry].slice(0, MAX_PORTFOLIOS));
    setActivePortfolioId(entryId);
    setToolTrayOpen(true);
    setActiveDrawerTool('accounts');
  };

  const handleCreateManualPortfolio = ({ accountName, rows }) => {
    const cleanedRows = Array.isArray(rows)
      ? rows.filter((row) => String(row?.stockName ?? row?.ticker ?? '').trim())
      : [];

    if (!cleanedRows.length) {
      return;
    }

    if (portfolioEntries.length >= MAX_PORTFOLIOS) {
      showPortfolioError(textFor(language).maxFilesError);
      return;
    }

    noteInteraction();
    clearPortfolioError();

    const entryId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `manual-portfolio-${Date.now()}`;
    const safeAccountName = String(accountName ?? '').trim() || '직접 입력 포트폴리오';
    const manualItems = cleanedRows.map((row, index) =>
      createManualPortfolioItem(
        {
          ...row,
          accountName: String(row?.accountName ?? '').trim() || safeAccountName,
        },
        index,
      ),
    );
    const payload = buildLocalPortfolioPayload(
      `${safeAccountName}.manual.csv`,
      manualItems,
      {
        reviewStatus: 'ok',
        warnings: [],
      },
      {
        agentReview: {
          status: 'ok',
          summary: '사용자가 직접 입력한 포트폴리오별 종목입니다.',
          warnings: [],
          agents: [],
        },
        ingestSource: 'manual-entry',
      },
    );
    const entry = createPortfolioEntryFromPayload(payload, entryId);

    setPortfolioEntries((current) => [...current, entry].slice(0, MAX_PORTFOLIOS));
    setActivePortfolioId(entryId);
    setToolTrayOpen(true);
    setActiveDrawerTool('accounts');
  };

  const handleAppendManualHoldings = ({ entryId, accountName, rows }) => {
    const cleanedRows = Array.isArray(rows)
      ? rows.filter((row) => String(row?.stockName ?? row?.ticker ?? '').trim())
      : [];

    if (!entryId || !cleanedRows.length) {
      return;
    }

    noteInteraction();
    clearPortfolioError();

    setPortfolioEntries((current) =>
      current.map((entry) => {
        if (entry.id !== entryId) {
          return entry;
        }

        const safeAccountName =
          String(accountName ?? '').trim() ||
          summarizePortfolioEntryAccounts(entry, language).accountText ||
          '직접 입력 포트폴리오';
        const sourceItems = (entry.timelineItems?.length ? entry.timelineItems : entry.items) ?? [];
        const nextItems = [
          ...sourceItems,
          ...cleanedRows.map((row, index) =>
            createManualPortfolioItem(
              {
                ...row,
                accountName: String(row?.accountName ?? '').trim() || safeAccountName,
              },
              sourceItems.length + index,
            ),
          ),
        ];

        return {
          ...entry,
          items: collapsePortfolioItemsForDisplayShared(nextItems),
          timelineItems: nextItems,
          parserDiagnostics: {
            ...(entry.parserDiagnostics ?? {}),
            reviewStatus: entry.parserDiagnostics?.reviewStatus ?? 'ok',
          },
        };
      }),
    );
    setActivePortfolioId(entryId);
  };

  const handleUpdatePortfolioHolding = ({ entryId, itemId, itemIndex, accountName, row }) => {
    if (!entryId || !row) {
      return;
    }

    noteInteraction();
    clearPortfolioError();

    setPortfolioEntries((current) =>
      current.map((entry) => {
        if (entry.id !== entryId) {
          return entry;
        }

        const sourceItems = (entry.timelineItems?.length ? entry.timelineItems : entry.items) ?? [];
        const targetIndex = sourceItems.findIndex((item, index) =>
          itemId ? item.id === itemId : index === itemIndex,
        );

        if (targetIndex < 0) {
          return entry;
        }

        const previousItem = sourceItems[targetIndex];
        const nextItem = createManualPortfolioItem(
          {
            ...row,
            id: previousItem.id ?? itemId,
            accountName:
              String(row?.accountName ?? '').trim() ||
              String(accountName ?? '').trim() ||
              resolveHoldingAccount(previousItem),
          },
          targetIndex,
        );
        const nextItems = sourceItems.map((item, index) =>
          index === targetIndex ? nextItem : item,
        );

        return {
          ...entry,
          items: collapsePortfolioItemsForDisplayShared(nextItems),
          timelineItems: nextItems,
          parserDiagnostics: {
            ...(entry.parserDiagnostics ?? {}),
            reviewStatus: entry.parserDiagnostics?.reviewStatus ?? 'ok',
          },
        };
      }),
    );
    setActivePortfolioId(entryId);
  };

  const handleRemovePortfolioHolding = ({ entryId, itemId, itemIds, itemIndex, itemIndexes }) => {
    if (!entryId) {
      return;
    }

    noteInteraction();
    clearPortfolioError();

    setPortfolioEntries((current) =>
      current.map((entry) => {
        if (entry.id !== entryId) {
          return entry;
        }

        const sourceItems = (entry.timelineItems?.length ? entry.timelineItems : entry.items) ?? [];
        const groupedIds = new Set(
          (Array.isArray(itemIds) && itemIds.length ? itemIds : [itemId])
            .map((id) => String(id ?? '').trim())
            .filter(Boolean),
        );
        const groupedIndexes = new Set(
          (Array.isArray(itemIndexes) && itemIndexes.length ? itemIndexes : [itemIndex])
            .map((index) => Number(index))
            .filter((index) => Number.isInteger(index) && index >= 0),
        );
        const nextItems = sourceItems.filter((item, index) => {
          const sourceId = String(item?.id ?? '').trim();

          if (sourceId && groupedIds.has(sourceId)) {
            return false;
          }

          if (!groupedIds.size && groupedIndexes.has(index)) {
            return false;
          }

          return true;
        });

        return {
          ...entry,
          items: collapsePortfolioItemsForDisplayShared(nextItems),
          timelineItems: nextItems,
        };
      }),
    );
    setActivePortfolioId(entryId);
  };

  const hasPortfolio = portfolioEntries.length > 0;
  const hasPortfolioItems = portfolioItems.length > 0;
  const showPortfolioChrome = hasPortfolio;
  const showToolDrawer = true;
  const hoveredFileEntry = useMemo(
    () => portfolioEntries.find((entry) => entry.id === hoveredFileEntryId) ?? null,
    [hoveredFileEntryId, portfolioEntries],
  );
  const hoveredFileTooltipStyle = useMemo(() => {
    if (
      !hoveredFileEntry ||
      !hoveredFileAnchorRect ||
      !uploadPlusWrapRef.current ||
      typeof window === 'undefined'
    ) {
      return null;
    }

    const containerRect = uploadPlusWrapRef.current.getBoundingClientRect();
    const maxWidth = clamp(
      window.innerWidth - REVIEW_TOOLTIP_VIEWPORT_INSET * 2,
      160,
      REVIEW_TOOLTIP_MAX_WIDTH,
    );
    const anchorCenter = hoveredFileAnchorRect.left + hoveredFileAnchorRect.width * 0.5;
    const clampedCenter = clamp(
      anchorCenter,
      REVIEW_TOOLTIP_VIEWPORT_INSET + maxWidth * 0.5,
      window.innerWidth - REVIEW_TOOLTIP_VIEWPORT_INSET - maxWidth * 0.5,
    );

    return {
      left: `${clampedCenter - containerRect.left}px`,
      top: `${hoveredFileAnchorRect.top - containerRect.top - REVIEW_TOOLTIP_VERTICAL_GAP}px`,
      maxWidth: `${maxWidth}px`,
    };
  }, [hoveredFileAnchorRect, hoveredFileEntry]);
  useEffect(() => {
    if (hoveredFileEntryId && !hoveredFileEntry) {
      clearHoveredFileTooltip();
    }
  }, [clearHoveredFileTooltip, hoveredFileEntry, hoveredFileEntryId]);
  const groupOptions = groupOptionsFor(language);
  const scoreAxes = scoreAxesFor(language);
  const displayFxRates = useMemo(() => buildDisplayFxRates(usdKrwRate), [usdKrwRate]);
  const settingsSections = [
    {
      key: 'language',
      title: text.settingsSectionLanguage,
      options: LANGUAGE_OPTIONS.map((option) => ({
        key: option,
        label: option === 'ko' ? text.korean : text.english,
        active: language === option,
        onSelect: () => setLanguage(option),
      })),
    },
    {
      key: 'base-currency',
      title: text.settingsSectionBaseCurrency,
      options: BASE_CURRENCY_OPTIONS.map((option) => ({
        key: option,
        label: option === 'KRW' ? text.settingsCurrencyKrw : text.settingsCurrencyUsd,
        active: baseCurrency === option,
        onSelect: () => setBaseCurrency(option),
      })),
    },
    {
      key: 'date-basis',
      title: text.settingsSectionDateBasis,
      options: DATE_BASIS_OPTIONS.map((option) => ({
        key: option,
        label: option === 'kst' ? text.settingsDateBasisKst : text.settingsDateBasisLocal,
        active: dateBasis === option,
        onSelect: () => setDateBasis(option),
      })),
    },
    {
      key: 'auto-save',
      title: text.settingsSectionAutoSave,
      options: SETTING_TOGGLE_OPTIONS.map((option) => ({
        key: option,
        label: option === 'on' ? text.settingsAutoSaveOn : text.settingsAutoSaveOff,
        active: autoSaveMode === option,
        onSelect: () => setAutoSaveMode(option),
      })),
    },
    {
      key: 'daily-snapshots',
      title: text.settingsSectionDailySnapshots,
      options: SETTING_TOGGLE_OPTIONS.map((option) => ({
        key: option,
        label: option === 'on' ? text.settingsDailySnapshotsOn : text.settingsDailySnapshotsOff,
        active: dailySnapshotMode === option,
        onSelect: () => setDailySnapshotMode(option),
      })),
    },
  ];
  const currentWorkspaceIsGuest = isGuestPortfolioWorkspaceId(currentWorkspaceId);
  const workspaceAuthenticated = Boolean(workspaceSession?.authenticated);
  const workspaceUserLabel =
    workspaceSession?.user?.displayName ||
    workspaceSession?.user?.email ||
    workspaceSession?.user?.id ||
    '-';
  const workspaceClaimDisabled =
    !workspaceAuthenticated ||
    !currentWorkspaceIsGuest ||
    workspaceClaimStatus === 'pending';
  const workspaceClaimStatusText =
    workspaceClaimStatus === 'pending'
      ? text.workspaceClaimPending
      : workspaceClaimStatus === 'done'
        ? text.workspaceClaimDone
        : workspaceClaimStatus === 'empty'
          ? text.workspaceClaimEmpty
          : workspaceClaimStatus === 'failed'
            ? workspaceClaimError || text.workspaceClaimFailed
            : workspaceAuthenticated && currentWorkspaceIsGuest
              ? text.workspaceClaimButton
              : text.workspaceClaimReady;
  const portfolioSyncStatusText =
    {
      idle: text.workspaceSyncIdle,
      pending: text.workspaceSyncPending,
      saved: text.workspaceSyncSaved,
      offline: text.workspaceSyncOffline,
      paused: text.workspaceSyncPaused,
      'server-merged': text.workspaceSyncServerMerged,
      conflict: text.workspaceSyncConflict,
      'local-failed': text.workspaceSyncLocalFailed,
    }[portfolioSyncStatus] ?? text.workspaceSyncIdle;
  const contributionPreview = useMemo(
    () => createContributionPreview(portfolioItems),
    [portfolioItems],
  );
  const portfolioAllocation = useMemo(
    () =>
      createPortfolioAllocation(portfolioItems, {
        classificationMode: assetClassMode,
        weightMode: allocationWeightMode,
      }),
    [allocationWeightMode, assetClassMode, portfolioItems],
  );
  const portfolioAnalyticsSummary = useMemo(() => {
    if (!hasPortfolio) {
      return null;
    }

    return createPortfolioAnalyticsSummary(portfolioItems, portfolioTimelineItems, {
      period: 'month',
      topN: 5,
      targetBucketWeights: DEFAULT_REBALANCE_TARGET_WEIGHTS,
    });
  }, [hasPortfolio, portfolioItems, portfolioTimelineItems]);
  const portfolioHeatmap = useMemo(
    () => createPortfolioHeatmap(portfolioTimelineItems, { weeks: 24 }),
    [portfolioTimelineItems],
  );
  const selectedAtom = atomsRef.current.find((atom) => atom.id === selectedAtomId) ?? null;
  const activeGroupValue =
    selectedAtom &&
    activeGroupKey &&
    canHighlightGroupField(selectedAtom, activeGroupKey) &&
    typeof selectedAtom[activeGroupKey] === 'string'
      ? selectedAtom[activeGroupKey].trim()
      : '';
  const normalizedActiveGroupValue = normalizeDisplayKey(activeGroupValue);
  const highlightActive = Boolean(selectedAtom && activeGroupKey && normalizedActiveGroupValue);
  const selectedAtomFocusActive = Boolean(selectedAtomId && !highlightActive);
  const portfolioScorecard = useMemo(() => {
    if (!hasPortfolio) {
      return null;
    }

    return createPortfolioScorecard(portfolioItems, language, {
      weightPreset: scoreWeightPreset,
    });
  }, [hasPortfolio, language, portfolioItems, scoreWeightPreset]);
  const overallPortfolioScorecard = useMemo(() => {
    if (!allPortfolioItems.length) {
      return null;
    }

    return createPortfolioScorecard(allPortfolioItems, language, {
      weightPreset: scoreWeightPreset,
    });
  }, [allPortfolioItems, language, scoreWeightPreset]);
  const showCenterClearHit = Boolean(selectedAtomId || activeGroupKey);
  const clearCenterSelection = () => {
    noteInteraction();
    setSelectedAtomId(null);
    setActiveGroupKey(null);
  };
  const handleFocusPortfolioHolding = useCallback(
    ({ entryId, item, itemIndex }) => {
      noteInteraction();
      if (entryId && entryId !== activePortfolioId) {
        setActivePortfolioId(entryId);
      }

      const atomId = resolveHoldingAtomId(atomsRef.current, item, itemIndex);
      if (atomId) {
        setSelectedAtomId(atomId);
        setActiveGroupKey(null);
      }
    },
    [activePortfolioId],
  );
  const triggerIntroCenterBurst = () => {
    noteInteraction();
    setIntroCenterBurstAt(performance.now());
  };
  const introCenterBurst =
    !hasPortfolioItems && introCenterBurstAt >= 0
      ? Math.sin(clamp((frameTime - introCenterBurstAt) / 420, 0, 1) * Math.PI)
      : 0;
  const settingsPanelSide =
    typeof window === 'undefined'
      ? 'left'
      : floatingPanelSideFor(
          settingsDock.position.x,
          gearSizeFor(window.innerWidth),
          window.innerWidth,
        );

  const pulse = 0.5 + Math.sin(frameTime * 0.00042) * 0.5;
  const centerMotion = frameTime * 0.00112;
  const spreadScale = 1;
  const nodeShrink = 1;
  const cameraMotion = cameraRef.current.current;
  const stageCameraX = cameraMotion.panX * 0.2 + cameraMotion.driftX * 0.84;
  const stageCameraY = cameraMotion.panY * 0.17 + cameraMotion.driftY * 0.9;
  const sceneStyle = {
    '--space-pan-x': `${format(cameraMotion.panX * -0.26 + cameraMotion.driftX * 1.18)}px`,
    '--space-pan-y': `${format(cameraMotion.panY * -0.22 + cameraMotion.driftY * 1.12)}px`,
    '--space-pan-stage-x': `${format(stageCameraX)}px`,
    '--space-pan-stage-y': `${format(stageCameraY)}px`,
    '--space-depth': format(cameraMotion.dolly * 0.012 + cameraMotion.focus * 0.38),
    '--camera-focus': format(cameraMotion.focus),
    '--camera-stage-zoom': format(
      1 + (cameraMotion.zoom - 1) * 0.42 + cameraMotion.focus * 0.025,
    ),
    '--camera-stage-roll': `${format(cameraMotion.roll * 0.46)}deg`,
    '--camera-glow': format(0.28 + cameraMotion.focus * 0.5),
    '--tool-drawer-current-width': toolTrayOpen ? `${toolDrawerWidth}px` : '0px',
  };
  const shootingStarStyle = useMemo(() => {
    if (!shootingStar) {
      return null;
    }

    return {
      '--shooting-star-left': `${format(shootingStar.startX)}%`,
      '--shooting-star-top': `${format(shootingStar.startY)}%`,
      '--shooting-star-travel-x': `${format(shootingStar.travelX)}px`,
      '--shooting-star-travel-y': `${format(shootingStar.travelY)}px`,
      '--shooting-star-angle': `${format(shootingStar.angle)}deg`,
      '--shooting-star-length': `${format(shootingStar.length)}px`,
      '--shooting-star-duration': `${format(shootingStar.duration)}ms`,
      '--shooting-star-scale': format(shootingStar.scale),
      '--shooting-star-opacity': format(shootingStar.opacity),
    };
  }, [shootingStar]);
  const atoms = useMemo(
    () =>
      atomsRef.current.map((atom) => {
        const position = atom.baseDirection
          .clone()
          .applyQuaternion(rotationRef.current.current)
          .multiplyScalar(BOND_LENGTH);
        const projection = projectPoint(position, cameraMotion);
        const matchesActiveGroup =
          highlightActive &&
          canHighlightGroupField(atom, activeGroupKey) &&
          normalizeDisplayKey(atom[activeGroupKey]) === normalizedActiveGroupValue;

        return {
          ...atom,
          ...projection,
          x: projection.x * spreadScale,
          y: projection.y * spreadScale,
          scale: projection.scale * nodeShrink,
          isSelected: atom.id === selectedAtomId,
          isGroupMatch: matchesActiveGroup,
          dimmed: selectedAtomFocusActive
            ? atom.id !== selectedAtomId
            : highlightActive
              ? !matchesActiveGroup
              : false,
          position,
        };
      }),
    [
      activeGroupKey,
      cameraMotion,
      frameTime,
      highlightActive,
      nodeShrink,
      normalizedActiveGroupValue,
      selectedAtomFocusActive,
      selectedAtomId,
      spreadScale,
    ],
  );
  const hoveredAtom = atoms.find((atom) => atom.id === hoverInfo?.atomId) ?? null;

  return (
    <main
      ref={shellRef}
      className={`app-shell${fileDragActive ? ' is-file-drag' : ''}${toolTrayOpen ? ' is-tool-drawer-open' : ''}`}
      style={sceneStyle}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onWheel={handleWheel}
      onDragEnter={handleFileDragEnter}
      onDragOver={handleFileDragOver}
      onDragLeave={handleFileDragLeave}
      onDrop={handleFileDrop}
    >
      {fileDragActive ? (
        <div className="file-drop-overlay" aria-hidden="true">
          <div className="file-drop-overlay__inner">
            <div className="file-drop-overlay__icon">
              <SketchUploadArrowIcon />
            </div>
            <p className="file-drop-overlay__label">{text.uploadDragHint}</p>
          </div>
        </div>
      ) : null}
      <div className="space-depth" aria-hidden="true">
        <div className="space-depth__nebula space-depth__nebula--far" />
        <div className="space-depth__stars space-depth__stars--far" />
        <div className="space-depth__stars space-depth__stars--mid" />
        <div className="space-depth__stars space-depth__stars--near" />
        <div className="space-depth__meteor-field">
          {shootingStarStyle ? (
            <div
              key={shootingStar.id}
              className="space-depth__meteor"
              style={shootingStarStyle}
            />
          ) : null}
        </div>
        <div className="space-depth__halo" />
      </div>

      <div className="floating-ui-layer">
        {showToolDrawer ? (
          <ToolSideDrawer
            open={toolTrayOpen}
            activeTool={activeDrawerTool}
            onSelectTool={handleDrawerToolSelect}
            groupOptions={groupOptions}
            activeGroupKey={activeGroupKey}
            onGroupChange={setActiveGroupKey}
            heatmap={
              portfolioHeatmap
                ? {
                    ...portfolioHeatmap,
                    columns: contributionPreview.columns,
                    rows: contributionPreview.rows,
                  }
                : null
            }
            allocation={portfolioAllocation}
            analyticsSummary={portfolioAnalyticsSummary}
            scorecard={portfolioScorecard}
            overallScorecard={overallPortfolioScorecard}
            scoreAxes={scoreAxes}
            scoreWeightPreset={scoreWeightPreset}
            onScoreWeightPresetChange={setScoreWeightPreset}
            items={portfolioItems}
            timelineItems={portfolioTimelineItems}
            portfolioEntries={portfolioEntries}
            activePortfolio={activePortfolio}
            activePortfolioId={activePortfolio?.id ?? activePortfolioId}
            onSelectPortfolio={setActivePortfolioId}
            onFocusHolding={handleFocusPortfolioHolding}
            onClearHoldingFocus={clearCenterSelection}
            onClearPortfolio={handleClearPortfolio}
            onOpenPortfolioPicker={openPortfolioPicker}
            onCreateManualAtom={handleCreateManualAtom}
            onCreateManualPortfolio={handleCreateManualPortfolio}
            onAppendManualHoldings={handleAppendManualHoldings}
            onUpdatePortfolioHolding={handleUpdatePortfolioHolding}
            onRemovePortfolioHolding={handleRemovePortfolioHolding}
            drawerWidth={toolDrawerWidth}
            onDrawerWidthChange={setToolDrawerWidth}
            language={language}
            baseCurrency={baseCurrency}
            fxRates={displayFxRates}
            layerStyle={floatingLayerStyleFor('tool-drawer')}
            onInteract={interactWithDrawerTool}
          />
        ) : null}

        <div
          ref={settingsDock.containerRef}
          className={`settings-anchor${settingsPanelSide === 'right' ? ' is-flipped' : ''}${settingsDock.dragging ? ' is-dragging' : ''}`}
          style={{
            transform: `translate3d(${settingsDock.position.x}px, ${settingsDock.position.y}px, 0)`,
            ...floatingLayerStyleFor('settings'),
          }}
        >
          <div ref={settingsRef} className={`settings-wrap${settingsOpen ? ' is-open' : ''}`}>
            <button
              className="settings-gear"
              type="button"
              onClick={() => {
                interactWithSettingsTool();
                setSettingsOpen((current) => !current);
              }}
              aria-label={text.settingsAria}
              aria-expanded={settingsOpen}
            >
              <SketchGearIcon />
            </button>

            {settingsOpen ? (
              <div
                className="settings-panel"
                onPointerDown={(event) => {
                  event.stopPropagation();
                }}
              >
                {settingsSections.map((section) => (
                  <section key={section.key} className="settings-panel__section">
                    <p className="settings-panel__title">{section.title}</p>
                    <div className="settings-panel__options">
                      {section.options.map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          className={`settings-option${option.active ? ' is-active' : ''}`}
                          onClick={() => {
                            noteInteraction();
                            option.onSelect();
                          }}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
                <section className="settings-panel__section settings-panel__section--workspace">
                  <p className="settings-panel__title">{text.settingsSectionWorkspace}</p>
                  <dl className="settings-workspace">
                    <div className="settings-workspace__row">
                      <dt>{text.workspaceStatusLabel}</dt>
                      <dd>{workspaceAuthenticated ? text.workspaceStatusSignedIn : text.workspaceStatusGuest}</dd>
                    </div>
                    <div className="settings-workspace__row">
                      <dt>{text.workspaceIdLabel}</dt>
                      <dd title={currentWorkspaceId}>{currentWorkspaceId}</dd>
                    </div>
                    <div className="settings-workspace__row">
                      <dt>{text.workspaceSyncLabel}</dt>
                      <dd>{portfolioSyncStatusText}</dd>
                    </div>
                    {workspaceAuthenticated ? (
                      <div className="settings-workspace__row">
                        <dt>{text.workspaceUserLabel}</dt>
                        <dd title={workspaceUserLabel}>{workspaceUserLabel}</dd>
                      </div>
                    ) : null}
                  </dl>
                  {CLERK_PUBLISHABLE_KEY ? (
                    <AuthPanel text={text} onAuthenticated={handleAuthPanelSuccess} />
                  ) : null}
                  <button
                    type="button"
                    className="settings-action"
                    disabled={workspaceClaimDisabled}
                    onClick={() => {
                      noteInteraction();
                      void handleClaimGuestWorkspace();
                    }}
                  >
                    {workspaceClaimStatus === 'pending'
                      ? text.workspaceClaimPending
                      : text.workspaceClaimButton}
                  </button>
                  <p
                    className={`settings-workspace__hint${
                      workspaceClaimStatus === 'failed' ? ' is-error' : ''
                    }`}
                  >
                    {workspaceClaimStatusText}
                  </p>
                </section>
              </div>
            ) : null}
          </div>
        </div>

        <div className="upload-anchor">
          <input
            ref={fileInputRef}
            className="file-input"
            type="file"
            multiple
            accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
            onChange={handlePortfolioFileChange}
          />
          {portfolioError ? (
            <p className={`upload-error${portfolioErrorClosing ? ' is-fading' : ''}`}>
              {portfolioError}
            </p>
          ) : null}
        </div>
      </div>

      <div className="stage-frame">
        <div className="stage-tilt">
          <div className="stage-reveal">
              <div className={`stage-breath${!hasPortfolioItems ? ' is-intro' : ''}`}>
              <div className="stage-camera">
                <AtomSketchView
                  atoms={atoms}
                  pulse={pulse}
                  centerMotion={centerMotion}
                  centerClickBurst={introCenterBurst}
                  standalone={!hasPortfolioItems}
                  svgRef={svgRef}
                  ariaLabel={text.atomAria}
                  highlightActive={highlightActive}
                  centerFocusActive={Boolean(selectedAtomId)}
                  onCenterClick={hasPortfolioItems ? clearCenterSelection : triggerIntroCenterBurst}
                  onPointerDown={handleNodePointerDown}
                  onPointerEnter={handleNodeEnter}
                  onPointerMove={handleNodeMove}
                  onPointerLeave={handleNodeLeave}
                  onKeyboardSelect={handleNodeKeyboardSelect}
                />
                {portfolioEntries.length ? (
                  <div className="portfolio-preview-layer">
                    {portfolioEntries
                      .slice(0, PORTFOLIO_PREVIEW_SLOTS.length)
                      .map((entry, index) => (
                        <PortfolioPreviewAtomView
                          key={entry.id}
                          entry={entry}
                          slot={PORTFOLIO_PREVIEW_SLOTS[index]}
                        />
                      ))}
                  </div>
                ) : null}
              </div>
              {showCenterClearHit ? (
                <button
                  className="center-clear-hit"
                  type="button"
                  aria-label={text.clearCenterAria}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    event.preventDefault();
                  }}
                  onClick={clearCenterSelection}
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <HoverCard atom={hoveredAtom} position={hoverInfo} language={language} />
    </main>
  );
}
