import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { createPortfolioHeatmap } from './lib/portfolioHeatmap.js';
import { createPortfolioAllocation } from './lib/portfolioAllocation.js';
import {
  collapsePortfolioItemsForDisplay as collapsePortfolioItemsForDisplayShared,
  parsePortfolioTextDetailed as parsePortfolioTextDetailedShared,
  shouldFallbackToLocalTimeline as shouldFallbackToLocalTimelineShared,
} from './lib/portfolioIngestionCore.js';
import { createPortfolioScorecard } from './lib/portfolioScoring.js';
import { createPortfolioAnalyticsSummary, resolveHoldingPosition } from './lib/portfolioAnalyticsSummary.js';
import { enrichPortfolioItem, resolveExactSecurityReferenceCode } from './lib/securityKnowledge.js';
import { useAtomTransition } from './utils/useAtomTransition.js';
import {
  normalizeDisplayKey,
  getItemFieldValue,
  resolveHoldingName,
  resolveHoldingTicker,
  resolveHoldingAccount,
  buildGroupedHoldingItems,
  formatHoldingListMeta,
  resolveHoldingAtomId,
  resolveHoldingMetric,
} from './utils/holdings.js';
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
import {
  createServerPortfolio,
  createDesktopDeviceToken,
  deleteServerPortfolio,
  claimGuestWorkspace,
  fetchWorkspaceSession,
  getPortfolioWorkspaceId,
  isGuestPortfolioWorkspaceId,
  listServerPortfolios,
  readStoredOption,
  revokeDesktopDeviceTokens,
  setPortfolioWorkspaceId,
  saveServerImportHistory,
} from './utils/storage.js';
import {
  createAtomState,
  createSceneCameraRig,
  generateAtomLayout,
  projectPoint,
  trackballVector,
} from './utils/scene.js';
import { isPortfolioAtomItem, explainExcludedPortfolioAtomItem } from './utils/portfolioItems.js';
import {
  DEFAULT_USD_KRW_RATE,
  buildFxRates,
  convertCurrencyAmount,
  formatCurrencyAmount,
  inferHoldingCurrency,
  normalizeCurrencyCode as normalizeCurrencyCodeShared,
} from './utils/currency.js';
import {
  AtomSketch as AtomSketchView,
  PortfolioPreviewAtom as PortfolioPreviewAtomView,
} from './components/atom/index.jsx';
import { HeatmapCard as HeatmapCardView } from './components/cards/HeatmapCard.jsx';
import { PortfolioScoreCard as PortfolioScoreCardView } from './components/cards/PortfolioScoreCard.jsx';
import { PortfolioAllocationCard as PortfolioAllocationCardView } from './components/allocation/index.jsx';
import DigitalTwinPanel from './components/panels/DigitalTwinPanel.jsx';
import { AuthPanel } from './components/auth/AuthPanel.jsx';
import { AtomDetailPanel } from './components/panels/AtomDetailPanel.jsx';
import { CommandPalette } from './components/command-palette/CommandPalette.jsx';
import { AtomCanvas } from './scene/index.js';

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? '';
// Stage A dev-only preview of the WebGL scene migration (see plan at
// .claude/plans/binary-leaping-wind.md). Off by default; append ?webglScene=1 to compare against
// the SVG scene. Removed once Stage B lands and the WebGL path becomes the real renderer.
const ENABLE_WEBGL_SCENE_PREVIEW =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('webglScene') === '1';

const VIEWBOX_SIZE = 640;
const VIEWBOX_HALF = VIEWBOX_SIZE / 2;
const MAX_PORTFOLIOS = 20;
const BOND_LENGTH = 214;
const AUTO_ROTATE_SPEED = 0.018;
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
// DEFAULT_USD_KRW_RATE now comes from utils/currency.js — the one shared constant every currency
// conversion in the app (this file's own display formatting and
// lib/portfolioAnalyticsSummary.js's totals math) is built on top of.
const DEFAULT_DISPLAY_FX_RATES = buildFxRates(DEFAULT_USD_KRW_RATE);
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
  toolTriggerPosition: 'atom-sketch-tool-trigger-position',
  groupDockPosition: 'atom-sketch-group-dock-position',
  heatmapDockPosition: 'atom-sketch-heatmap-dock-position',
  scoreDockPosition: 'atom-sketch-score-dock-position-v2',
  allocationDockPosition: 'atom-sketch-allocation-dock-position',
  twinDockPosition: 'atom-sketch-twin-dock-position',
  atomHintDismissed: 'atom-sketch-atom-hint-dismissed',
  toolDrawerDock: 'atom-sketch-tool-drawer-dock',
};
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
// Bottom used to be a third dock option (its own height-based resize numbers lived here) — dropped
// in favor of left/right only, see .tool-drawer's CSS for why a transform-based slide can't cleanly
// support a third axis the way the old clip-path box could.
const TOOL_DRAWER_DOCK_OPTIONS = ['left', 'right'];
// How close the cursor has to get to a screen edge, while dragging the drawer's dock handle,
// before that edge highlights as the drop target. Top is deliberately never a candidate — there's
// nothing at the top of this app worth docking under (the 탐색/관리 toggle lives there).
const DOCK_EDGE_HOVER_THRESHOLD_PX = 80;
// Drag-to-dock release snap duration range — see settlePanel's durationMs formula in
// handleDockDragPointerDown for how release velocity scales between these two.
const DOCK_DRAG_SNAP_DURATION_MS = 320;
const DOCK_DRAG_SNAP_MIN_DURATION_MS = 140;
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
    commandPaletteHint: '빠른 검색',
    commandPaletteHintAria: '빠른 검색 열기 (⌘K)',
    settingsSectionLanguage: '언어',
    settingsSectionBaseCurrency: '기준 통화',
    settingsCurrencyKrw: 'KRW',
    settingsCurrencyUsd: 'USD',
    settingsSectionDateBasis: '날짜 기준',
    settingsDateBasisKst: '한국 시간',
    settingsDateBasisLocal: '기기 시간',
    settingsSectionAutoSave: '자동 저장',
    settingsAutoSaveOn: '켜짐',
    settingsAutoSaveOff: '꺼짐',
    settingsSectionDailySnapshots: '일별 손익 누적',
    settingsDailySnapshotsOn: '켜짐',
    settingsDailySnapshotsOff: '꺼짐',
    settingsSectionWorkspace: '계정',
    desktopConnectGenerateButton: '데스크톱 연결 코드 생성',
    desktopConnectRegenerateButton: '연결 코드 재발급',
    desktopConnectPending: '처리 중',
    desktopConnectRevealHint: '이 코드는 다시 표시되지 않습니다. 지금 복사해 메뉴바 앱에 붙여넣으세요.',
    desktopConnectRevokeButton: '모든 데스크톱 연결 해제',
    desktopConnectError: '연결 코드를 처리하지 못했습니다.',
    workspaceStatusLabel: '상태',
    workspaceStatusGuest: '게스트',
    workspaceStatusSignedIn: '로그인됨',
    workspaceIdLabel: 'Workspace',
    workspaceIdCopyHint: '클릭하여 복사',
    workspaceIdCopied: '복사됨',
    workspaceIdCopyFailed: '복사 실패 — 직접 선택해 복사해 주세요',
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
    authForgotPasswordLink: '비밀번호를 잊으셨나요?',
    authForgotPasswordHint: '가입한 이메일로 비밀번호 재설정 코드를 보내드려요.',
    authSendResetCodeButton: '재설정 코드 받기',
    authResetCodeSentHint: '이메일로 받은 코드와 새 비밀번호를 입력하세요.',
    authNewPasswordPlaceholder: '새 비밀번호',
    authResetPasswordButton: '비밀번호 재설정',
    authBackToSignIn: '로그인으로 돌아가기',
    authDeleteAccountTitle: '계정 및 데이터 삭제',
    authDeleteAccountHint: '계정과 저장된 포트폴리오 데이터 삭제를 요청할 수 있습니다. 요청 확인 후 처리됩니다.',
    authDeleteAccountButton: '삭제 요청 보내기',
    authDeleteAccountUnavailable: '문의처가 아직 설정되지 않았습니다.',
    authDeleteAccountEmailSubject: 'AtomFolio 계정 및 데이터 삭제 요청',
    authDeleteAccountEmailBody: '아래 계정/워크스페이스의 데이터 삭제를 요청합니다.',
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
    atomDetailCloseAria: '종목 상세 닫기',
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
    atomHint: '원자를 눌러 자세히 보기',
    emptyStateHint: '포트폴리오 추가',
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
    commandPaletteHint: 'Quick search',
    commandPaletteHintAria: 'Open quick search (⌘K)',
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
    settingsSectionWorkspace: 'Account',
    desktopConnectGenerateButton: 'Generate desktop connection code',
    desktopConnectRegenerateButton: 'Regenerate connection code',
    desktopConnectPending: 'Working',
    desktopConnectRevealHint: "This code won't be shown again — copy it now and paste it into the menu bar app.",
    desktopConnectRevokeButton: 'Disconnect all desktop devices',
    desktopConnectError: 'Could not process the connection code.',
    workspaceStatusLabel: 'Status',
    workspaceStatusGuest: 'Guest',
    workspaceStatusSignedIn: 'Signed in',
    workspaceIdLabel: 'Workspace',
    workspaceIdCopyHint: 'Click to copy',
    workspaceIdCopied: 'Copied',
    workspaceIdCopyFailed: 'Copy failed — select and copy manually',
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
    authForgotPasswordLink: 'Forgot your password?',
    authForgotPasswordHint: "We'll email a reset code to your account address.",
    authSendResetCodeButton: 'Send reset code',
    authResetCodeSentHint: 'Enter the code we emailed you and a new password.',
    authNewPasswordPlaceholder: 'New password',
    authResetPasswordButton: 'Reset password',
    authBackToSignIn: 'Back to sign in',
    authDeleteAccountTitle: 'Delete account & data',
    authDeleteAccountHint: 'Request deletion of your account and stored portfolio data. Handled after we confirm the request.',
    authDeleteAccountButton: 'Send deletion request',
    authDeleteAccountUnavailable: 'No contact channel is configured yet.',
    authDeleteAccountEmailSubject: 'AtomFolio account & data deletion request',
    authDeleteAccountEmailBody: 'Requesting deletion of data for the account/workspace below.',
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
    atomDetailCloseAria: 'Close security detail',
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
    atomHint: 'Tap an atom to see details',
    emptyStateHint: 'Add portfolio',
    scorePointUnit: 'pts',
    parseError: 'Could not find portfolio rows. Upload a CSV with ticker or name columns.',
    readError: 'Could not read the file.',
    maxFilesError: 'You can upload up to 20 portfolios.',
  },
};
const TOOLTIP_WIDTH = 320;
const TOOLTIP_HEIGHT = 260;
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

// A Date object whose *local* getters (getFullYear/getMonth/getDate/...) read back as the KST
// wall-clock time, for callers (like the heatmap's day-bucketing) that need an actual Date to do
// local-time day math with, not just a formatted string.
function nowForDateBasis(dateBasis = 'kst') {
  const now = new Date();
  if (dateBasis !== 'kst') {
    return now;
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return new Date(
    Number(byType.year),
    Number(byType.month) - 1,
    Number(byType.day),
    Number(byType.hour),
    Number(byType.minute),
    Number(byType.second),
  );
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

// Same-currency case only (buyPriceValue and latestPrice already denominated the same way) — the
// return% is then completely exchange-rate-independent, since the currency unit cancels out of
// the ratio. Kept as its own function (rather than folded into
// calculateManualReturnRatePreview below) because it's still exactly right on its own whenever
// there's no cross-currency question to begin with — e.g. every domestic holding.
function calculateReturnRateFromBuyPrice(buyPriceValue, latestPrice) {
  const buyPrice = parseManualPriceValue(buyPriceValue);
  const currentPrice = Number(latestPrice);

  if (!Number.isFinite(buyPrice) || buyPrice <= 0 || !Number.isFinite(currentPrice)) {
    return '';
  }

  return formatMarketChangePercent(((currentPrice - buyPrice) / buyPrice) * 100);
}

// Mirrors resolvePosition's own same-currency-vs-cross-currency split (portfolioAnalyticsSummary.js)
// so the manual-entry form's live 수익률 preview can never disagree with what actually gets
// computed once the holding is saved. shares deliberately isn't a parameter — it's a common
// multiplicative factor on both the buy and market amount, so it cancels out of the ratio
// regardless of what it is, the same way calculateReturnRateFromBuyPrice above never needed it.
function calculateManualReturnRate(buyPriceValue, purchaseCurrency, latestPrice, nativeCurrency, fxRates) {
  if (!purchaseCurrency || !nativeCurrency || purchaseCurrency === nativeCurrency) {
    return calculateReturnRateFromBuyPrice(buyPriceValue, latestPrice);
  }

  const buyPrice = parseManualPriceValue(buyPriceValue);
  const currentPrice = Number(latestPrice);

  if (!Number.isFinite(buyPrice) || buyPrice <= 0 || !Number.isFinite(currentPrice)) {
    return '';
  }

  const buyPriceKrw = convertCurrencyAmount(buyPrice, purchaseCurrency, 'KRW', fxRates);
  const currentPriceKrw = convertCurrencyAmount(currentPrice, nativeCurrency, 'KRW', fxRates);

  if (!Number.isFinite(buyPriceKrw) || buyPriceKrw <= 0 || !Number.isFinite(currentPriceKrw)) {
    return '';
  }

  return formatMarketChangePercent(((currentPriceKrw - buyPriceKrw) / buyPriceKrw) * 100);
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

const LIVE_QUOTE_FETCH_CONCURRENCY = 6;
const LIVE_QUOTE_REFRESH_MS = 90 * 1000;
// Bounds each background refresh burst well under the server's 30-requests/60s market-live rate
// limit (see server/apiHandlers.mjs RATE_LIMITS) even with the concurrency above, leaving headroom
// for whatever else (manual ticker search, financials lookups) shares that same per-user budget.
const LIVE_QUOTE_REFRESH_MAX_ITEMS = 20;

// Runs `worker` over `items` with at most `limit` requests in flight at once — a portfolio's
// worth of quote lookups used to go out one at a time (a 20-holding portfolio meant 20 sequential
// round-trips, each waiting on the last), which is what made live-quote backfill and refresh feel
// slow. A shared cursor lets `limit` workers keep pulling the next item until the list is drained.
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => runWorker()),
  );

  return results;
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

  await mapWithConcurrency(lookups.slice(0, 80), LIVE_QUOTE_FETCH_CONCURRENCY, async (lookup) => {
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
  });

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
  const items = entry?.items ?? [];
  const securityCount = items.length;
  const atomVisibleItems = items.filter((item) => isPortfolioAtomItem(item));
  const atomVisibleCount = atomVisibleItems.length;
  // Only populated when something was actually excluded — summarizePortfolioEntryAccounts runs on
  // every render of every account-list card, so skip building the reason list on the (common) path
  // where every parsed item made it into the atom scene.
  const excludedItems =
    atomVisibleCount < securityCount
      ? items
          .filter((item) => !isPortfolioAtomItem(item))
          .map((item) => ({
            label: item?.label || item?.stockName || item?.name || '(이름 없음)',
            reason: explainExcludedPortfolioAtomItem(item),
          }))
      : [];

  return {
    accountText,
    rowCount,
    securityCount,
    atomVisibleCount,
    excludedItems,
  };
}

function excludedAtomReasonLabel(reason, language) {
  if (language === 'en') {
    switch (reason) {
      case 'non-stock-asset-class':
        return 'not a stock/ETF asset class';
      case 'invalid-item':
        return 'unreadable row';
      default:
        return 'no recognizable name, ticker, or holding data';
    }
  }

  switch (reason) {
    case 'non-stock-asset-class':
      return '주식/ETF 자산군이 아님';
    case 'invalid-item':
      return '읽을 수 없는 행';
    default:
      return '알아볼 수 있는 이름·티커·보유 데이터 없음';
  }
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
  // Which currency buyPrice was actually typed/toggled in at entry time — kept as its own field,
  // deliberately never pre-converted into the security's own trading currency. Storing a
  // synthetic converted number instead of this was the root of a real bug: a real 370,000원 cost
  // basis got permanently rewritten into a fabricated "370,000 USD" (or a stale conversion of it)
  // depending on which side of the toggle the user happened to be on, instead of just remembering
  // "this was 원" and letting resolvePosition (portfolioAnalyticsSummary.js) compare like-for-like
  // amounts at read time, with today's live rate, every time.
  const purchaseCurrency = normalizeCurrencyCode(row?.purchaseCurrency) || '';
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
    { label: '매수통화', value: purchaseCurrency },
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
    purchaseCurrency,
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

// Thin wrappers kept under their original names (used all over this file) so every existing call
// site stays untouched — the actual currency logic now lives in utils/currency.js, the one shared
// standard both this file and lib/portfolioAnalyticsSummary.js build on, instead of each keeping
// its own slightly-different copy.
function normalizeCurrencyCode(value) {
  return normalizeCurrencyCodeShared(value);
}

// Resolves which currency the manual-entry "매수가" (buy price) field should be treated/labeled
// as, so the input can show an explicit "USD"/"원" unit instead of leaving it ambiguous (the root
// UX cause of the buy-price/live-price currency mismatch: a plain number field with no unit lets a
// user type a KRW-scale number for a US stock without any signal that it should be USD). A resolved
// live quote's own currency wins when available; otherwise falls back to the same ticker-shape
// inference used for portfolio totals, so the label is already correct before a quote even loads.
function resolveManualBuyPriceCurrency(ticker, marketData) {
  return normalizeCurrencyCode(marketData?.currency) || inferHoldingCurrency({ ticker }) || 'KRW';
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
  return buildFxRates(normalizeUsdKrwRate(usdKrwRate));
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

  return { value: convertCurrencyAmount(numeric, source, target, fxRates), currency: target };
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
  // 평가금액/평가손익 — the two figures requirement 5 asks this card to always show. Uses the same
  // resolveHoldingPosition the holdings list row and the 요약 totals are built from, so this card
  // can never disagree with either of them about what a holding is worth.
  const position = resolveHoldingPosition(item, { baseCurrency, fxRates });
  // 매수가's own currency (position.purchaseCurrency) is *not* necessarily the same as the live
  // quote's currency (data?.currency below) — that's the whole point of purchaseCurrency being its
  // own field now (see resolvePosition's own comment in portfolioAnalyticsSummary.js). Converting
  // 매수가 for display using the quote's currency instead would silently reintroduce the same
  // currency-mixing bug just for this one card.
  const currentPriceText = data
    ? formatMarketPriceForBase(data.latestPrice, data.currency, baseCurrency, fxRates)
    : '-';
  const yesterdayChange = data
    ? `${formatMarketChangeForBase(data.change, data.currency, baseCurrency, fxRates)} ${formatMarketChangePercent(data.changePercent)}`
    : '-';
  const buyPriceText = formatMoneyMetricForBase(buyPrice, position.purchaseCurrency, baseCurrency, fxRates);
  const yesterdayChangeToneClass = getSignedValueToneClass(data?.changePercent);
  const marketValueText = position.marketValue != null ? formatCurrencyAmount(position.marketValue, baseCurrency) : '-';
  const profitAmountText =
    position.profitAmount != null
      ? `${position.profitAmount > 0 ? '+' : ''}${formatCurrencyAmount(position.profitAmount, baseCurrency)}`
      : '-';
  const nativeProfitAmountText =
    position.nativeProfitAmount != null
      ? `${position.nativeProfitAmount > 0 ? '+' : ''}${formatCurrencyAmount(position.nativeProfitAmount, position.nativeCurrency)}`
      : null;
  const profitToneClass = getSignedValueToneClass(position.profitAmount);
  const isForeignHolding = position.nativeCurrency !== baseCurrency;

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
        <div>
          <span>
            {language === 'en' ? 'Market value' : '평가금액'}
            {isForeignHolding ? ` (${baseCurrency})` : ''}
          </span>
          <strong>{marketValueText}</strong>
        </div>
        <div>
          <span>{language === 'en' ? 'Unrealized P/L' : '평가손익'}</span>
          <strong className={profitToneClass}>
            {profitAmountText}
            {isForeignHolding && nativeProfitAmountText ? (
              <small className="tool-drawer__holding-metrics-native">{nativeProfitAmountText}</small>
            ) : null}
          </strong>
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

// How long a freshly-arrived article keeps its "NEW" badge before it fades back to a normal row
// — a UX timing choice, independent of the design system's 100-150ms Contextual Duration rule
// (that rule governs the badge's own enter/exit transition, defined in CSS, not how long it stays).
const NEWS_AUTO_REFRESH_MS = 90 * 1000;
const NEWS_NEW_BADGE_VISIBLE_MS = 8000;
const NEWS_PAGE_SIZE = 20;

// MarketNewsPanel unmounts every time the drawer switches to a different tool tab (see
// ToolSideDrawer's resolvedTool.key === 'news' gate) — plain useState would lose everything on
// that unmount, so tabbing back to 뉴스 always looked like a fresh reload even seconds later. This
// module-level object survives across mounts (reset on a full page reload, which is fine/expected)
// so a remount can restore what was already loaded instead of starting over.
const newsPanelCache = {
  hasLoadedOnce: false,
  language: null,
  query: '',
  submittedQuery: '',
  news: null,
  seenArticleIds: new Set(),
};

const MarketNewsPanel = memo(function MarketNewsPanel({ language, dateBasis }) {
  const requestIdRef = useRef(0);
  const activeNewsAbortRef = useRef(null);
  const seenArticleIdsRef = useRef(newsPanelCache.seenArticleIds);
  const newBadgeTimeoutRef = useRef(null);
  const rootRef = useRef(null);
  const [query, setQuery] = useState(newsPanelCache.query);
  const [submittedQuery, setSubmittedQuery] = useState(newsPanelCache.submittedQuery);
  const [news, setNews] = useState(newsPanelCache.news);
  const [status, setStatus] = useState(newsPanelCache.news ? 'ready' : 'idle');
  const [error, setError] = useState('');
  const [newArticleIds, setNewArticleIds] = useState(() => new Set());

  // Keep the cross-mount cache in sync with whatever's currently on screen — a plain effect per
  // field rather than threading cache writes through every setQuery/setSubmittedQuery/setNews
  // call site.
  useEffect(() => {
    newsPanelCache.query = query;
  }, [query]);
  useEffect(() => {
    newsPanelCache.submittedQuery = submittedQuery;
  }, [submittedQuery]);
  useEffect(() => {
    newsPanelCache.news = news;
  }, [news]);

  const loadNews = useCallback(
    async (
      nextQuery = '',
      { silent = false, page = 1, pageSize = NEWS_PAGE_SIZE, forceRefresh = false } = {},
    ) => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;

      activeNewsAbortRef.current?.abort();

      const controller = new AbortController();
      activeNewsAbortRef.current = controller;
      const cleanQuery = String(nextQuery ?? '').trim();

      if (!silent) {
        setStatus('loading');
        setError('');
      }

      try {
        const payload = await fetchMarketNews({
          query: cleanQuery,
          language,
          mode: cleanQuery ? 'search' : 'today',
          // Only an explicit refresh bypasses the server's cached pool — page navigation and the
          // 90s auto-refresh tick reuse it, which is what keeps those near-instant instead of
          // re-triggering a ~3.5s full Naver/Bing/OG-image scrape on every click or tick.
          refreshKey: forceRefresh ? `${Date.now()}-${requestId}` : undefined,
          page,
          pageSize,
          signal: controller.signal,
        });

        if (requestIdRef.current !== requestId || controller.signal.aborted) {
          return;
        }

        // NEW badges only make sense on a background auto-refresh of a page that already has a
        // prior snapshot to compare against — a page the reader is navigating to for the first
        // time isn't "new content arriving", it's just content they haven't looked at yet. The
        // `seenIds.size` check additionally guards against React StrictMode's double-invoked
        // mount effect: the second invocation can see the cache's `hasLoadedOnce` flag already
        // set (from the first invocation's synchronous portion) and take the silent-refresh
        // branch before any response has actually populated seenIds yet, which would otherwise
        // badge the very first load's entire list as "new".
        const seenIds = seenArticleIdsRef.current;
        const freshIds = silent && seenIds.size > 0
          ? new Set(
              (payload.items ?? [])
                .filter((article) => article.id && !seenIds.has(article.id))
                .map((article) => article.id),
            )
          : new Set();
        for (const article of payload.items ?? []) {
          if (article.id) {
            seenIds.add(article.id);
          }
        }

        setNews(payload);
        setStatus('ready');
        setError('');

        if (freshIds.size) {
          window.clearTimeout(newBadgeTimeoutRef.current);
          setNewArticleIds(freshIds);
          newBadgeTimeoutRef.current = window.setTimeout(() => {
            setNewArticleIds(new Set());
          }, NEWS_NEW_BADGE_VISIBLE_MS);
        }
      } catch {
        if (requestIdRef.current !== requestId || controller.signal.aborted) {
          return;
        }

        // A silent (background poll) failure keeps whatever's already on screen rather than
        // blanking the panel over a single missed 90s tick.
        if (silent) {
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
    // First-ever mount, or the UI language changed since the cache was built (cached articles
    // would be in the wrong language) — do the original full reset + fresh load. Otherwise this
    // is a remount after tabbing away and back: the cached state above already restored what was
    // on screen, so just refresh it quietly in the background instead of blanking the panel.
    const needsFreshLoad = !newsPanelCache.hasLoadedOnce || newsPanelCache.language !== language;

    if (needsFreshLoad) {
      newsPanelCache.hasLoadedOnce = true;
      newsPanelCache.language = language;
      setQuery('');
      setSubmittedQuery('');
      seenArticleIdsRef.current = new Set();
      newsPanelCache.seenArticleIds = seenArticleIdsRef.current;
      setNewArticleIds(new Set());
      loadNews('');
    } else {
      // Re-fetch whichever page was already showing (a cache-served slice, not a fresh scrape)
      // so tabbing back in doesn't reset pagination back to page 1.
      void loadNews(newsPanelCache.submittedQuery, {
        silent: true,
        page: newsPanelCache.news?.page ?? 1,
      });
    }

    return () => {
      requestIdRef.current += 1;
      activeNewsAbortRef.current?.abort();
      window.clearTimeout(newBadgeTimeoutRef.current);
    };
  }, [language, loadNews]);

  // Auto-refresh: only while this panel is mounted (i.e. actually open — see ToolSideDrawer's
  // resolvedTool.key === 'news' gate) and the tab is in the foreground. Background tabs pause
  // entirely rather than firing polls that'll just be wasted work. Re-fetches whichever page is
  // currently on screen — silent, so no refreshKey, so this reads the server's cached pool
  // instead of re-triggering a full scrape every 90s.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') {
        void loadNews(submittedQuery, { silent: true, page: news?.page ?? 1 });
      }
    };

    const intervalId = window.setInterval(tick, NEWS_AUTO_REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [loadNews, submittedQuery, news?.page]);

  const handleSearch = useCallback(
    (event) => {
      event.preventDefault();
      const cleanQuery = query.trim();
      setSubmittedQuery(cleanQuery);
      seenArticleIdsRef.current = new Set();
      setNewArticleIds(new Set());
      loadNews(cleanQuery);
    },
    [loadNews, query],
  );

  const handleRefresh = useCallback(() => {
    loadNews(submittedQuery, { page: news?.page ?? 1, forceRefresh: true });
  }, [loadNews, submittedQuery, news?.page]);

  const handleGoToPage = useCallback(
    (pageNumber) => {
      const totalPages = Math.max(1, Math.ceil((news?.totalCount ?? 0) / (news?.pageSize ?? NEWS_PAGE_SIZE)));
      const clampedPage = Math.min(Math.max(1, pageNumber), totalPages);
      if (clampedPage === (news?.page ?? 1)) {
        return;
      }
      loadNews(submittedQuery, { page: clampedPage });
      rootRef.current?.closest('.tool-drawer__body')?.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [loadNews, news?.page, news?.pageSize, news?.totalCount, submittedQuery],
  );

  const newsItems = news?.items ?? [];
  const isSearchMode = Boolean(submittedQuery || news?.mode === 'search');
  const metaLabel =
    news?.source ??
    (isSearchMode ? (language === 'en' ? 'Search results' : '검색 결과') : language === 'en' ? 'Latest stock news' : '최신 주식 뉴스');
  const emptyCopy = isSearchMode
    ? language === 'en' ? 'No matching news.' : '검색 결과가 없습니다.'
    : language === 'en' ? 'No recent stock news found.' : '최신 주식 뉴스를 찾지 못했습니다.';
  const currentPage = news?.page ?? 1;
  const pageSize = news?.pageSize ?? NEWS_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil((news?.totalCount ?? 0) / pageSize));
  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1);

  return (
    <div className="tool-drawer__news" ref={rootRef}>
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
              ? formatNewsTime(news.fetchedAt, language, dateBasis)
              : ''}
        </em>
      </div>

      {error ? <p className="tool-drawer__empty">{error}</p> : null}
      {!error && status !== 'loading' && newsItems.length === 0 ? (
        <p className="tool-drawer__empty">{emptyCopy}</p>
      ) : null}

      <div className={`tool-drawer__news-list${status === 'loading' ? ' is-loading' : ''}`}>
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
              <div className="tool-drawer__news-thumb">
                {article.thumbnailUrl ? (
                  <img
                    src={article.thumbnailUrl}
                    alt=""
                    loading="lazy"
                    onError={(event) => {
                      event.currentTarget.style.display = 'none';
                    }}
                  />
                ) : null}
              </div>
              <div className="tool-drawer__news-body">
                <div className="tool-drawer__news-title-row">
                  <strong>{article.title}</strong>
                  {newArticleIds.has(article.id) ? (
                    <span className="tool-drawer__news-badge">NEW</span>
                  ) : null}
                </div>
                <span>
                  {sourceLabel}
                  {article.publishedAt
                    ? ` · ${formatNewsTime(article.publishedAt, language, dateBasis)}`
                    : ''}
                </span>
              </div>
            </a>
          );
        })}
      </div>

      {totalPages > 1 ? (
        <nav className="tool-drawer__news-pagination" aria-label={language === 'en' ? 'News pages' : '뉴스 페이지'}>
          <button
            type="button"
            className="tool-drawer__news-page tool-drawer__news-page--nav"
            onClick={() => handleGoToPage(currentPage - 1)}
            disabled={currentPage <= 1 || status === 'loading'}
            aria-label={language === 'en' ? 'Previous page' : '이전 페이지'}
          >
            ‹
          </button>
          {pageNumbers.map((pageNumber) => (
            <button
              key={pageNumber}
              type="button"
              className={`tool-drawer__news-page${pageNumber === currentPage ? ' is-active' : ''}`}
              onClick={() => handleGoToPage(pageNumber)}
              disabled={status === 'loading'}
              aria-current={pageNumber === currentPage ? 'page' : undefined}
            >
              {pageNumber}
            </button>
          ))}
          <button
            type="button"
            className="tool-drawer__news-page tool-drawer__news-page--nav"
            onClick={() => handleGoToPage(currentPage + 1)}
            disabled={currentPage >= totalPages || status === 'loading'}
            aria-label={language === 'en' ? 'Next page' : '다음 페이지'}
          >
            ›
          </button>
        </nav>
      ) : null}
    </div>
  );
});
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
  pendingManualTicker = null,
  drawerWidth = TOOL_DRAWER_DEFAULT_WIDTH,
  onDrawerWidthChange,
  dock = 'left',
  onDockChange,
  onDockDragHoverEdgeChange,
  language,
  baseCurrency = 'KRW',
  fxRates = DEFAULT_DISPLAY_FX_RATES,
  dateBasis = 'kst',
  layerStyle,
  onInteract,
  renderSettingsPanel,
}) {
  const text = textFor(language);
  // Imperative target for the drag-to-dock gesture's live follow + release settle (see
  // handleDockDragPointerDown) — mutated directly via style.transform on every pointermove/on
  // release, never through React state, so a 60fps drag doesn't mean 60fps of re-renders.
  const panelRef = useRef(null);
  const [resizing, setResizing] = useState(false);
  const [manualAccountName, setManualAccountName] = useState('');
  const [manualStockName, setManualStockName] = useState('');
  const [manualTicker, setManualTicker] = useState('');
  const [manualBuyPrice, setManualBuyPrice] = useState('');
  // Which currency the *user* means by whatever's typed into 매수가 — null follows the resolved
  // security's own currency (resolveManualBuyPriceCurrency), 'USD'/'KRW' is an explicit override
  // from the toggle next to the field. Needed because a static "USD" label alone isn't enough:
  // Korean users very commonly think of (and type) a foreign holding's buy price in 원 terms even
  // when the field is labeled USD — see handleManualBuyPriceChange's own comment for the bug this
  // caused (a real QQQM buy price of 370,000원 typed into a USD-labeled field, compared directly
  // against the ~$300 native quote, produced a nonsensical -99.9% return).
  const [manualBuyPriceCurrencyOverride, setManualBuyPriceCurrencyOverride] = useState(null);
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
  const manualSuggestionRef = useRef(null);
  const manualDraftRef = useRef({
    stockName: '',
    ticker: '',
    buyPrice: '',
    returnRate: '',
  });
  // The security's actual trading currency (from a resolved live quote, or ticker-shape inference)
  // vs. whichever currency the user has told the 매수가 field they're typing in right now (the
  // toggle's override, or the same native currency by default). Unlike an earlier version of this
  // form, manualBuyPrice is *never* pre-converted into manualBuyPriceNativeCurrency — it's stored
  // exactly as typed, alongside manualBuyPriceEntryCurrency as its own explicit purchaseCurrency
  // field, and resolvePosition (portfolioAnalyticsSummary.js) does the currency-aware comparison at
  // read time instead, with whatever the live exchange rate is *then*. Converting once at entry
  // time turned a real, fixed cost basis (370,000원, paid once, never changes) into a synthetic
  // USD figure computed off that day's rate — which is itself a source of drift, on top of being
  // exactly the shape of number that caused the original currency-mixing bug in the first place.
  const manualBuyPriceNativeCurrency = resolveManualBuyPriceCurrency(manualTicker, manualMarketData);
  const manualBuyPriceEntryCurrency = manualBuyPriceCurrencyOverride || manualBuyPriceNativeCurrency;
  // Command palette's "add" hands off here rather than reimplementing ticker lookup itself — see
  // App.jsx's openManualToolWithTicker. requestedAt (not just the ticker string) is what the
  // effect keys off of, so asking to add the same ticker twice in a row still seeds the field a
  // second time instead of being a no-op prop change on an unchanged string.
  const lastAppliedManualTickerRequestRef = useRef(null);
  useEffect(() => {
    if (!pendingManualTicker || lastAppliedManualTickerRequestRef.current === pendingManualTicker.requestedAt) {
      return;
    }
    lastAppliedManualTickerRequestRef.current = pendingManualTicker.requestedAt;
    setEditingHolding(null);
    setManualRows([]);
    setManualAccountName('');
    setManualStockName('');
    setManualSuggestionLocked(false);
    setManualTicker(pendingManualTicker.ticker ?? '');
    setManualBuyPriceCurrencyOverride(null);
  }, [pendingManualTicker]);
  const tools = [
    {
      key: 'accounts',
      label: language === 'en' ? 'Portfolios' : '포트폴리오 목록',
      // Short enough to sit under the icon without widening the rail — label is still the full
      // string above for aria-label/title (screen readers and the hover tooltip), this is only
      // ever rendered as small on-rail text (see tool-drawer__button-label in the JSX below).
      shortLabel: language === 'en' ? 'Funds' : '계좌',
      icon: <SketchAccountStackIcon />,
      available: true,
    },
    {
      // No rail button — reachable via the "Add Stock" button inside the accounts panel and via
      // holding-edit flows (onSelectTool('manual')). Kept in `tools` so those still resolve; just
      // not its own top-level icon, since it duplicated the button already in the accounts panel.
      key: 'manual',
      label: language === 'en' ? 'Add Stock' : '종목 추가',
      shortLabel: language === 'en' ? 'Add' : '추가',
      icon: <SketchManualAccountIcon />,
      available: true,
      hidden: true,
    },
    {
      key: 'overview',
      label: language === 'en' ? 'Overview' : '요약',
      shortLabel: language === 'en' ? 'Summary' : '요약',
      icon: <SketchBurstIcon />,
      available: Boolean(analyticsSummary || heatmap || allocation || scorecard || groupOptions.length),
    },
    {
      key: 'compare',
      label: language === 'en' ? 'Compare' : '비교',
      shortLabel: language === 'en' ? 'Compare' : '비교',
      icon: <SketchAccountStackIcon />,
      available: portfolioEntries.length >= 2,
    },
    {
      key: 'twin',
      label: language === 'en' ? 'Investment Simulation' : '투자 시뮬레이션',
      shortLabel: language === 'en' ? 'Sim' : '모의',
      icon: <SketchTwinIcon />,
      available: true,
    },
    {
      key: 'news',
      label: language === 'en' ? 'Market News' : '시장 뉴스',
      shortLabel: language === 'en' ? 'News' : '뉴스',
      icon: <SketchNewsIcon />,
      available: true,
    },
    {
      key: 'settings',
      label: text.settings,
      shortLabel: text.settings,
      icon: <SketchGearIcon />,
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

    const nextReturnRate = calculateManualReturnRate(
      manualBuyPrice,
      manualBuyPriceEntryCurrency,
      manualMarketData?.latestPrice,
      manualBuyPriceNativeCurrency,
      fxRates,
    );

    if (!nextReturnRate) {
      return;
    }

    setManualReturnRate((current) => (current === nextReturnRate ? current : nextReturnRate));
  }, [manualBuyPrice, manualBuyPriceEntryCurrency, manualBuyPriceNativeCurrency, manualMarketData, fxRates]);

  const handleResizePointerDown = useCallback(
    (event) => {
      if (!open || event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onInteract?.();

      const startPos = event.clientX;
      const startSize = drawerWidth;
      // Which physical drag direction grows the panel depends on which edge the resize handle
      // sits on: left dock's handle is on the panel's right edge (drag right to grow, the
      // original/only behavior this used to be); right dock's handle is on the left edge (drag
      // left to grow). Left is the only one where screen-direction and "growing" point the same
      // way.
      const sign = dock === 'left' ? 1 : -1;
      setResizing(true);

      const handlePointerMove = (moveEvent) => {
        moveEvent.preventDefault();
        const nextSize = startSize + sign * (moveEvent.clientX - startPos);
        onDrawerWidthChange?.(clampDrawerWidth(nextSize));
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
    [clampDrawerWidth, dock, drawerWidth, onDrawerWidthChange, onInteract, open],
  );

  const handleResizeKeyDown = useCallback(
    (event) => {
      if (!open) {
        return;
      }

      // Keyboard grow/shrink stays on a fixed pair of keys regardless of which edge the drawer is
      // actually docked to — unlike the drag handle (a direct-manipulation gesture where physical
      // direction has to match the cursor), a keyboard shortcut that flipped meaning depending on
      // dock side would be the opposite of predictable.
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') {
        return;
      }

      event.preventDefault();
      onInteract?.();
      const delta = event.key === 'ArrowRight' ? 24 : -24;
      onDrawerWidthChange?.((current) => clampDrawerWidth(current + delta));
    },
    [clampDrawerWidth, onDrawerWidthChange, onInteract, open],
  );

  // Drag-to-dock: grab the handle at the top of the rail (always present, open or closed —
  // re-docking isn't something you should have to open the drawer first to do) and drag toward
  // whichever screen edge it should snap to. Top is deliberately never a candidate edge.
  const handleDockDragPointerDown = useCallback(
    (event) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      onInteract?.();

      const computeHoverEdge = (clientX) => {
        const distanceToEdge = {
          left: clientX,
          right: window.innerWidth - clientX,
        };
        let nearestEdge = null;
        let nearestDistance = DOCK_EDGE_HOVER_THRESHOLD_PX;
        for (const edge of Object.keys(distanceToEdge)) {
          const distance = distanceToEdge[edge];
          if (distance <= nearestDistance) {
            nearestEdge = edge;
            nearestDistance = distance;
          }
        }
        return nearestEdge;
      };

      const panelEl = panelRef.current;
      const startClientX = event.clientX;
      // A short rolling history of (time, x) samples, not just the last move — a single frame's
      // delta right before release is noisy (whatever the pointer happened to do in that last ~8ms
      // tick), while the last ~60ms gives a steadier read on how fast the hand was actually moving
      // when it let go.
      let recentSamples = [{ t: event.timeStamp, x: startClientX }];

      // Directly mutating style.transform every move (not React state) is the same reason the
      // codebase's other drag loops (rotation drag, resize) skip setState mid-gesture — a state
      // update per pointermove would re-render the whole drawer subtree 60+ times a second for a
      // transform that's purely visual until release.
      const applyDragOffset = (offsetPx) => {
        if (!panelEl) {
          return;
        }
        panelEl.style.transition = 'none';
        panelEl.style.transform = `translateX(${offsetPx}px)`;
      };

      const handlePointerMove = (moveEvent) => {
        moveEvent.preventDefault();
        recentSamples.push({ t: moveEvent.timeStamp, x: moveEvent.clientX });
        if (recentSamples.length > 8) {
          recentSamples.shift();
        }
        // Rubber-band clamped — this is a preview of "which edge is about to grab it", not the
        // drawer actually relocating mid-drag, so the visible travel stays modest even if the
        // pointer keeps going past the clamp.
        const rawOffset = moveEvent.clientX - startClientX;
        applyDragOffset(clamp(rawOffset, -140, 140));
        onDockDragHoverEdgeChange?.(computeHoverEdge(moveEvent.clientX));
      };

      // velocity in px/ms, signed (direction matters for nothing here — only magnitude feeds the
      // snap duration below), measured across the retained sample window rather than just the
      // final two events.
      const releaseVelocityPxMs = () => {
        if (recentSamples.length < 2) {
          return 0;
        }
        const first = recentSamples[0];
        const last = recentSamples[recentSamples.length - 1];
        const dt = last.t - first.t;
        if (dt <= 0) {
          return 0;
        }
        return Math.abs(last.x - first.x) / dt;
      };

      const settlePanel = (velocityPxMs) => {
        if (!panelEl) {
          return;
        }
        // Faster release -> shorter settle, so a deliberate flick doesn't visibly lag behind the
        // hand that threw it; a slow, deliberate drag gets the fuller, more readable ease-out.
        // This is a duration heuristic, not a real spring simulation — cubic-bezier below is what
        // actually supplies the "natural, not linear" feel demanded of it.
        const durationMs = clamp(
          DOCK_DRAG_SNAP_DURATION_MS - velocityPxMs * 250,
          DOCK_DRAG_SNAP_MIN_DURATION_MS,
          DOCK_DRAG_SNAP_DURATION_MS,
        );
        panelEl.style.transition = `transform ${durationMs}ms cubic-bezier(0.16, 1, 0.3, 1)`;
        panelEl.style.transform = 'translateX(0px)';
        window.setTimeout(() => {
          // Hand control back to the stylesheet's own dock/is-open-driven transform once the
          // release animation finishes — an inline style left behind here would silently outrank
          // every future CSS-driven open/close transition for this element.
          panelEl.style.transition = '';
          panelEl.style.transform = '';
        }, durationMs + 30);
      };

      const finishDrag = (finalEdge) => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
        window.removeEventListener('pointercancel', handlePointerCancel);
        settlePanel(releaseVelocityPxMs());
        if (finalEdge && finalEdge !== dock) {
          onDockChange?.(finalEdge);
        }
        onDockDragHoverEdgeChange?.(null);
      };
      // pointerup commits whatever edge was last hovered (null if the cursor never got close
      // enough to any candidate edge — dragging and releasing in the middle of the screen is a
      // no-op, not an accidental dock change). pointercancel aborts without committing anything,
      // same as letting go of a drag that got interrupted should.
      const handlePointerUp = (upEvent) => finishDrag(computeHoverEdge(upEvent.clientX));
      const handlePointerCancel = () => finishDrag(null);

      window.addEventListener('pointermove', handlePointerMove, { passive: false });
      window.addEventListener('pointerup', handlePointerUp);
      window.addEventListener('pointercancel', handlePointerCancel);
    },
    [dock, onDockChange, onDockDragHoverEdgeChange, onInteract],
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
            ? activePortfolio.fileName ||
              summarizePortfolioEntryAccounts(activePortfolio, language).accountText ||
              '직접 입력 포트폴리오'
            : manualAccountName.trim() || '직접 입력 포트폴리오',
        stockName: resolveMarketDisplayName(manualMarketData) || manualStockName.trim() || manualTicker.trim(),
        ticker: manualMarketData?.symbol || manualTicker.trim() || '',
        // The raw typed value, never pre-converted — see the comment on manualBuyPriceNativeCurrency
        // above for why. When the user left 매수가 empty and it's auto-filled from the live quote
        // instead, that fallback value is already in the security's own native currency, not
        // whatever the toggle happens to show (the toggle only applies to what was actually typed).
        buyPrice: manualBuyPrice.trim() || formatMarketInputPrice(manualMarketData?.latestPrice),
        purchaseCurrency: manualBuyPrice.trim() ? manualBuyPriceEntryCurrency : manualBuyPriceNativeCurrency,
        shares: manualShares.trim(),
        returnRate:
          manualReturnRate.trim() ||
          calculateManualReturnRate(
            manualBuyPrice.trim() || formatMarketInputPrice(manualMarketData?.latestPrice),
            manualBuyPrice.trim() ? manualBuyPriceEntryCurrency : manualBuyPriceNativeCurrency,
            manualMarketData?.latestPrice,
            manualBuyPriceNativeCurrency,
            fxRates,
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
      manualBuyPriceEntryCurrency,
      manualBuyPriceNativeCurrency,
      fxRates,
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
    setManualBuyPriceCurrencyOverride(null);
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
        activePortfolio.fileName ||
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
      // Restores the toggle to whatever currency this holding's 매수가 was actually recorded in
      // (falls back to null — "follow the resolved native currency" — for older holdings saved
      // before this field existed, which is exactly what their buyPrice already assumed).
      setManualBuyPriceCurrencyOverride(
        normalizeCurrencyCode(item?.purchaseCurrency) ||
          normalizeCurrencyCode(resolveHoldingMetric(item, ['매수통화', 'purchaseCurrency'])) ||
          null,
      );
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
          // This comparison table is built before the user's live baseCurrency/usdKrwRate state
          // exists in this component's render order, so it uses the same static default rate the
          // rest of the app falls back to (DEFAULT_DISPLAY_FX_RATES) — still correctly converts a
          // foreign holding into KRW before summing, just not live-rate-reactive like the main
          // portfolioAnalyticsSummary memo below.
          baseCurrency: 'KRW',
          fxRates: DEFAULT_DISPLAY_FX_RATES,
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
  // Switching the toggle has to convert whatever's already typed, not just relabel it — leaving a
  // USD-auto-filled "301.77" in place and reinterpreting it as 원 the instant 원 is clicked turns a
  // real ~$300 price into an almost-zero 301.77원 cost basis (a +140,000%+ return). The number in
  // the field should represent one consistent real quantity throughout — only its currency changes
  // when the toggle is clicked, the amount it represents shouldn't.
  const handleManualBuyPriceCurrencyToggle = useCallback(
    (nextCurrency) => {
      if (nextCurrency === manualBuyPriceEntryCurrency) {
        return;
      }

      onInteract?.();
      setManualBuyPriceCurrencyOverride(nextCurrency);

      const typed = parseManualPriceValue(manualBuyPrice);
      if (Number.isFinite(typed) && manualBuyPrice.trim()) {
        const converted = convertCurrencyAmount(typed, manualBuyPriceEntryCurrency, nextCurrency, fxRates);
        if (Number.isFinite(converted)) {
          setManualBuyPrice(nextCurrency === 'USD' ? converted.toFixed(2) : String(Math.round(converted)));
        }
      }
    },
    [fxRates, manualBuyPrice, manualBuyPriceEntryCurrency, onInteract],
  );
  const handleManualBuyPriceChange = useCallback(
    (event) => {
      const nextBuyPrice = event.target.value;
      setManualBuyPrice(nextBuyPrice);

      const nextReturnRate = calculateManualReturnRate(
        nextBuyPrice,
        manualBuyPriceEntryCurrency,
        manualMarketData?.latestPrice,
        manualBuyPriceNativeCurrency,
        fxRates,
      );

      if (nextReturnRate || !nextBuyPrice.trim()) {
        setManualReturnRate(nextReturnRate);
      }
    },
    [fxRates, manualBuyPriceEntryCurrency, manualBuyPriceNativeCurrency, manualMarketData],
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

  // The standalone "종목 조회" (stock lookup) tool/panel that used to live here was removed —
  // it was a second, separate search entry point alongside ⌘K's command palette (which also
  // searches by ticker/name and can add a holding directly), and having two ways to search for a
  // stock was exactly the kind of duplicate entry point this cleanup consolidated down to one.

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
          {/* Explicit, *switchable* unit — a static "USD" label alone wasn't enough: a Korean user
              buying a foreign stock very commonly thinks of (and wants to type) the price in 원
              terms regardless of what the field is labeled, so a bare read-only badge just let the
              same currency mismatch happen with extra steps (real case: 370,000 typed as a QQQM
              buy price against a ~$300 native quote read as -99.9% return, or as a
              -₩3.1 billion "loss" once profit itself started being FX-converted). For a foreign
              holding, this is a real toggle — whichever currency the user picks is stored as its
              own explicit purchaseCurrency field, right alongside the price exactly as typed
              (never pre-converted — see manualBuyPriceNativeCurrency's own comment above), and
              resolvePosition (portfolioAnalyticsSummary.js) does the currency-aware comparison at
              read time. A domestic (원-priced) holding has no such ambiguity, so it stays a plain
              label. */}
          <span className="tool-drawer__manual-field-label-row">
            <span>{language === 'en' ? 'Buy Price' : '매수가'}</span>
            {manualBuyPriceNativeCurrency === 'USD' ? (
              <span
                className="tool-drawer__manual-field-currency-toggle"
                role="group"
                aria-label={language === 'en' ? 'Buy price currency' : '매수가 입력 통화'}
              >
                <button
                  type="button"
                  className={manualBuyPriceEntryCurrency === 'KRW' ? 'is-active' : ''}
                  onClick={() => handleManualBuyPriceCurrencyToggle('KRW')}
                >
                  {language === 'en' ? 'KRW' : '원'}
                </button>
                <button
                  type="button"
                  className={manualBuyPriceEntryCurrency === 'USD' ? 'is-active' : ''}
                  onClick={() => handleManualBuyPriceCurrencyToggle('USD')}
                >
                  USD
                </button>
              </span>
            ) : (
              <em className="tool-drawer__manual-field-currency">{language === 'en' ? 'KRW' : '원'}</em>
            )}
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={manualBuyPrice}
            onChange={handleManualBuyPriceChange}
            placeholder={manualBuyPriceEntryCurrency === 'USD' ? '0.00' : '0'}
          />
          {manualBuyPriceNativeCurrency === 'USD' && manualBuyPriceEntryCurrency === 'KRW' && manualBuyPrice.trim() ? (
            <small className="tool-drawer__manual-field-hint">
              {/* Display-only preview of what the 원 amount is worth today — the actual stored
                  value stays exactly as typed (370,000, not this converted figure); see
                  manualBuyPriceNativeCurrency's own comment for why that distinction matters. */}
              ≈{' '}
              {formatCurrencyAmount(
                convertCurrencyAmount(parseManualPriceValue(manualBuyPrice), 'KRW', 'USD', fxRates),
                'USD',
              )}{' '}
              {language === 'en' ? "(at today's rate)" : '(오늘 환율 기준)'}
            </small>
          ) : null}
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
          <div className="tool-drawer__accounts-header">
            <span className="tool-drawer__accounts-count">
              {language === 'en'
                ? `${portfolioEntries.length} portfolios`
                : `${portfolioEntries.length}개 포트폴리오`}
            </span>
          </div>

          {/* Two equal-weight cards, not a button sharing a line with the count text (old layout)
              and a visually disconnected name+create row below it — reads as "pick one of two ways
              to get a portfolio in here" now, build-it-yourself vs. import-a-file, side by side. */}
          <div className="tool-drawer__account-onboard">
            <div className="tool-drawer__account-onboard-card tool-drawer__overview-card">
              <p>{language === 'en' ? 'Build manually' : '직접 만들기'}</p>
              <label className="tool-drawer__account-create-field">
                <input
                  type="text"
                  value={manualAccountName}
                  onChange={(event) => setManualAccountName(event.target.value)}
                  aria-label={language === 'en' ? 'Portfolio name' : '포트폴리오명'}
                  placeholder={language === 'en' ? 'New portfolio name' : '새 포트폴리오 이름'}
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

            <div className="tool-drawer__account-onboard-card tool-drawer__overview-card">
              <p>{language === 'en' ? 'Import a file' : '파일 가져오기'}</p>
              <span className="tool-drawer__account-onboard-hint">
                {language === 'en' ? 'CSV or broker export' : 'CSV · 증권사 거래내역'}
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
                {language === 'en' ? 'Choose file' : '파일 선택'}
              </button>
            </div>
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
                    {accountSummary.excludedItems.length ? (
                      <details className="tool-drawer__account-review">
                        <summary>
                          {language === 'en'
                            ? `${accountSummary.atomVisibleCount}/${accountSummary.securityCount} shown as atoms`
                            : `${accountSummary.securityCount}개 종목 중 ${accountSummary.atomVisibleCount}개만 원자로 표시됨`}
                        </summary>
                        <ul>
                          {accountSummary.excludedItems.map((excluded, excludedIndex) => (
                            <li key={`${excluded.label}-${excludedIndex}`}>
                              {excluded.label}
                              {' — '}
                              {excludedAtomReasonLabel(excluded.reason, language)}
                            </li>
                          ))}
                        </ul>
                      </details>
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
                    // Same resolveHoldingPosition the totals in the 요약 panel are built from —
                    // this is where 평가금액/평가손익 actually get computed for the holdings list,
                    // not left as "-" the way this row used to render before it showed anything
                    // beyond the return percentage.
                    const position = resolveHoldingPosition(item, { baseCurrency, fxRates });
                    const isForeignHolding = position.nativeCurrency !== baseCurrency;
                    const profitToneClass = getSignedValueToneClass(
                      position.profitAmount,
                      'is-positive',
                      'is-negative',
                    );
                    const marketValueText =
                      position.marketValue != null ? formatCurrencyAmount(position.marketValue, baseCurrency) : '-';
                    const profitText =
                      position.profitAmount != null
                        ? `${position.profitAmount > 0 ? '+' : ''}${formatCurrencyAmount(position.profitAmount, baseCurrency)}`
                        : '-';
                    // Only meaningful for a same-currency purchase (bought and quoted in the same
                    // currency, see resolvePosition's own sameCurrencyPurchase comment) — a
                    // cross-currency one (e.g. a real 원 cost basis for a USD-quoted stock) has no
                    // FX-independent "native profit" to show here.
                    const nativeProfitText =
                      position.nativeProfitAmount != null
                        ? `${position.nativeProfitAmount > 0 ? '+' : ''}${formatCurrencyAmount(position.nativeProfitAmount, position.nativeCurrency)}`
                        : null;

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
                          <span className="tool-drawer__holding-main-row">
                            <span className="tool-drawer__holding-main-name">
                              <strong>{compactLabel(resolveHoldingName(item), 18)}</strong>
                              <em>{formatHoldingListMeta(item, language)}</em>
                            </span>
                            <small>{String(item.detail ?? item.return ?? '').trim() || '-'}</small>
                          </span>
                          <span className="tool-drawer__holding-main-row tool-drawer__holding-main-row--metrics">
                            <span className="tool-drawer__holding-main-metric">
                              {marketValueText}
                              {isForeignHolding && position.nativeMarketValue != null ? (
                                <em className="tool-drawer__holding-main-native">
                                  {formatCurrencyAmount(position.nativeMarketValue, position.nativeCurrency)}
                                </em>
                              ) : null}
                            </span>
                            <span className="tool-drawer__holding-main-profit-group">
                              <strong
                                className={`tool-drawer__holding-main-profit${profitToneClass ? ` ${profitToneClass}` : ''}`}
                              >
                                {profitText}
                              </strong>
                              {isForeignHolding && nativeProfitText ? (
                                <em className="tool-drawer__holding-main-native">{nativeProfitText}</em>
                              ) : null}
                            </span>
                          </span>
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

          {analyticsSummary?.profitFlow?.length ? renderMonthlyReportPanel() : null}
        </div>
      );
    }

    if (resolvedTool.key === 'compare') {
      return renderComparePanel();
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
      return <MarketNewsPanel items={items} language={language} dateBasis={dateBasis} />;
    }

    if (resolvedTool.key === 'settings') {
      return renderSettingsPanel?.();
    }

    return null;
  };

  return (
    <aside
      className={`tool-drawer${open ? ' is-open' : ''}${open && resolvedTool ? ' has-panel' : ''}${resizing ? ' is-resizing' : ''}`}
      data-dock={dock}
      style={{
        ...layerStyle,
        // Always the full expanded size now — open/closed no longer toggles this element's own
        // box size at all (that was the width-transition perf problem); see .tool-drawer's CSS
        // for how the closed state is conveyed instead (a clip-path). Both vars are always set
        // (not just the one the current dock uses) since dock can change while open/mid-drag —
        // no reason the unused axis' value should ever be stale.
        '--tool-drawer-width': `${drawerWidth}px`,
      }}
    >
      <div className="tool-drawer__window">
        <div className="tool-drawer__rail" aria-label={text.toolMenuAria}>
          <div
            className="tool-drawer__dock-handle"
            role="button"
            tabIndex={0}
            aria-label={
              language === 'en' ? 'Drag to move this panel to an edge' : '드래그해서 패널 위치를 옮기기'
            }
            title={language === 'en' ? 'Drag to dock left or right' : '드래그해서 좌/우에 도킹'}
            onPointerDown={handleDockDragPointerDown}
          />
          {tools.filter((tool) => !tool.hidden).map((tool) => (
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
              <span className="tool-drawer__button-icon">{tool.icon}</span>
              {/* Short on-rail label — full `tool.label` still does the aria-label/title job above
                  (screen readers, hover tooltip); this is purely the at-a-glance text so each tool
                  reads without hovering first. */}
              <span className="tool-drawer__button-label">{tool.shortLabel}</span>
            </button>
          ))}
        </div>

        <section className="tool-drawer__panel" aria-live="polite" ref={panelRef}>
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

          <div
            className="tool-drawer__resize-handle"
            role="separator"
            aria-label={language === 'en' ? 'Resize tool panel' : '도구 패널 너비 조절'}
            aria-orientation="vertical"
            tabIndex={open ? 0 : -1}
            onPointerDown={handleResizePointerDown}
            onKeyDown={handleResizeKeyDown}
          />

          {open && resolvedTool?.key === 'accounts' && activeAccountEntry && activeSelectedHolding ? (
            <aside
              className="tool-drawer__detail-popout"
              aria-label={language === 'en' ? 'Stock details' : '종목 정보'}
            >
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
        </section>
      </div>
    </aside>
  );
}

export default function App() {
  const shellRef = useRef(null);
  const svgRef = useRef(null);
  const fileInputRef = useRef(null);
  const atomsRef = useRef(
    generateAtomLayout([], { resolveLabel: resolveAtomStockDisplayName }).map(createAtomState),
  );
  // Layout for the *next* portfolio, computed ahead of time during dissolve instead of at the
  // swap instant — see switchToPortfolio (which fills this in as soon as the target portfolio is
  // known, well before the swap) and the atomsRef-filling effect further down (which reads it
  // instead of calling generateAtomLayout fresh, when it's for the portfolio actually being
  // switched to). entryId doubles as the "is this still valid" check: a live quote refresh
  // on the *current* portfolio also changes portfolioItems without going through this precompute
  // path at all, so its entryId simply won't match and the effect falls back to computing fresh,
  // the same as before this existed.
  const precomputedAtomLayoutRef = useRef({ entryId: null, atoms: null });
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
  // Dissolve/materialize when the main atom's own data changes (a user-initiated portfolio
  // switch) — see switchToPortfolio below (which drives it) and the rAF loop further down (which
  // reads transitionAngularVelocityRef every frame).
  const {
    scale: atomTransitionScale,
    phase: atomTransitionPhase,
    transitionAngularVelocityRef: atomTransitionAngularVelocityRef,
    dissolve: dissolveAtom,
    materialize: materializeAtom,
    advanceTransition: advanceAtomTransition,
  } = useAtomTransition();
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
  const activePortfolioLiveItemsRef = useRef([]);
  const [activePortfolioId, setActivePortfolioId] = useState(
    () => restoredPortfolioState.activePortfolioId,
  );
  // The single dissolve -> swap -> materialize path for every *user-initiated* portfolio switch
  // (preview-atom click, the accounts list / comparison table pickers, command-palette "go to
  // holding" landing on a different portfolio, creating a new portfolio and jumping to it, ...) —
  // originally written just for the preview-atom click, generalized here so every one of those
  // plays the same transition instead of only that one path snapping instantly like the rest used
  // to. Deliberately NOT used for programmatic changes (initial load, delete-fallback, background
  // server-merge reconciliation) — those still call setActivePortfolioId directly further down;
  // animating those would read as a flicker at exactly the moment (delete, load) it'd be most
  // jarring, not as a deliberate transition.
  const switchToPortfolio = useCallback(
    async (entryId) => {
      if (!entryId || entryId === activePortfolioId || atomTransitionPhase !== 'idle') {
        return;
      }
      // Compute the target portfolio's layout now, in parallel with the dissolve that's about to
      // play, instead of leaving it for the swap-effect to compute at the dissolve->materialize
      // handoff (previously the one moment this synchronous work could actually land as a felt
      // hitch — right as the atom needs to start growing back in). ~420ms of dissolve is plenty
      // of headroom for a layout pass over any realistic holdings count.
      const targetEntry = portfolioEntriesRef.current.find((entry) => entry.id === entryId);
      precomputedAtomLayoutRef.current = {
        entryId,
        atoms: generateAtomLayout(targetEntry?.items ?? [], {
          resolveLabel: resolveAtomStockDisplayName,
        }).map(createAtomState),
      };
      await dissolveAtom();
      setActivePortfolioId(entryId);
      await materializeAtom();
    },
    [activePortfolioId, atomTransitionPhase, dissolveAtom, materializeAtom],
  );
  const [portfolioError, setPortfolioError] = useState('');
  const [portfolioErrorClosing, setPortfolioErrorClosing] = useState(false);
  const [hoveredFileEntryId, setHoveredFileEntryId] = useState(null);
  const [, setHoveredFileAnchorRect] = useState(null);
  const [toolTrayOpen, setToolTrayOpen] = useState(false);
  const [activeDrawerTool, setActiveDrawerTool] = useState(null);
  const [toolDrawerWidth, setToolDrawerWidth] = useState(TOOL_DRAWER_DEFAULT_WIDTH);
  const [toolDrawerDock, setToolDrawerDock] = useState(() =>
    readStoredOption(STORAGE_KEYS.toolDrawerDock, TOOL_DRAWER_DOCK_OPTIONS, 'left'),
  );
  // Which screen edge is currently highlighted while dragging the drawer's dock handle — null
  // outside of an active drag. Lifted up here (rather than kept local to ToolSideDrawer) because
  // the highlight itself has to render as a full screen-edge bar *outside* .tool-drawer — that
  // element has its own clip-path now (see Stage 1), which would clip a same-element child down
  // to the rail too, same problem as the light-mode background bleed that turned up there.
  const [dockDragHoverEdge, setDockDragHoverEdge] = useState(null);
  // Cmd+K palette (search/add/move/delete holdings in one place) and the pending-ticker handoff
  // into the existing manual-entry form when the palette's "add" row is chosen — see
  // openManualToolWithTicker below for why this is a prop into ToolSideDrawer rather than lifting
  // its whole manual-form state up here.
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [pendingManualTicker, setPendingManualTicker] = useState(null);
  const [, setShowGroupDock] = useState(() => restoredPortfolioState.entries.length > 0);
  const [, setShowScoreDock] = useState(() => restoredPortfolioState.entries.length > 0);
  const [, setGroupDockSpawn] = useState(null);
  const [, setScoreDockSpawn] = useState(null);
  const [activeGroupKey, setActiveGroupKey] = useState(null);
  const [selectedAtomId, setSelectedAtomId] = useState(null);
  // First-visit-only hint on the atom stage — dismissed on first interaction or after a few
  // seconds either way, then remembered so it never comes back. Same copy/timing as the desktop
  // popover's own atom hint (desktop/src/renderer/atom-view.jsx).
  const [atomHintVisible, setAtomHintVisible] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    try {
      return window.localStorage.getItem(STORAGE_KEYS.atomHintDismissed) !== '1';
    } catch {
      return false;
    }
  });
  const dismissAtomHint = useCallback(() => {
    setAtomHintVisible(false);
    try {
      window.localStorage.setItem(STORAGE_KEYS.atomHintDismissed, '1');
    } catch {
      // Worst case it reappears next visit — not harmful enough to handle further.
    }
  }, []);
  useEffect(() => {
    if (!atomHintVisible) {
      return undefined;
    }
    const timer = setTimeout(dismissAtomHint, 4000);
    return () => clearTimeout(timer);
  }, [atomHintVisible, dismissAtomHint]);
  const [hoverInfo, setHoverInfo] = useState(null);
  const [frameTime, setFrameTime] = useState(0);
  const [shootingStar, setShootingStar] = useState(null);
  const [fileDragActive, setFileDragActive] = useState(false);
  const fileDragCounterRef = useRef(0);
  const [, setPortfolioLoading] = useState(false);
  const [introCenterBurstAt, setIntroCenterBurstAt] = useState(-1);
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
  const [assetClassMode] = useState(() =>
    readStoredOption(STORAGE_KEYS.assetClassMode, ASSET_CLASS_MODE_OPTIONS, 'auto'),
  );
  const [allocationWeightMode] = useState(() =>
    readStoredOption(STORAGE_KEYS.allocationWeightMode, ALLOCATION_WEIGHT_MODE_OPTIONS, 'auto'),
  );
  const [scoreWeightPreset, setScoreWeightPreset] = useState(() =>
    readStoredOption(STORAGE_KEYS.scoreWeightPreset, SCORE_WEIGHT_PRESET_OPTIONS, 'balanced'),
  );
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState(() => getPortfolioWorkspaceId());
  // 'idle' | 'copied' | 'failed' — drives the settings panel's click-to-copy feedback on the
  // workspace ID. A ref alongside the state so the reset timeout can always clear whatever timer
  // it itself started, even across a rapid double-click that fires handleCopyWorkspaceId twice.
  const [workspaceIdCopyStatus, setWorkspaceIdCopyStatus] = useState('idle');
  const workspaceIdCopyResetTimerRef = useRef(null);
  const [workspaceSession, setWorkspaceSession] = useState(null);
  const [workspaceClaimStatus, setWorkspaceClaimStatus] = useState('idle');
  const [workspaceClaimError, setWorkspaceClaimError] = useState('');
  // Desktop connection code (server/deviceTokens.mjs) — 'idle' | 'pending' | 'revealed' | 'failed'.
  // The raw token only ever exists in deviceTokenValue right after a successful generate call;
  // nothing re-fetches it later (the server only ever stores its hash), so navigating away or
  // regenerating is the only way it leaves this state.
  const [deviceTokenStatus, setDeviceTokenStatus] = useState('idle');
  const [deviceTokenValue, setDeviceTokenValue] = useState('');
  const [deviceTokenError, setDeviceTokenError] = useState('');
  const [deviceTokenCopyStatus, setDeviceTokenCopyStatus] = useState('idle');
  const deviceTokenCopyResetTimerRef = useRef(null);

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

  // Global Cmd+K / Ctrl+K toggle. Bound at the window level (not a specific input) so it opens
  // from anywhere — the atom scene, the tool drawer, mid-scroll in the news list — the same way
  // it does in Raycast/Linear/Notion.
  useEffect(() => {
    const handleKeyDown = (event) => {
      const isPaletteShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      if (!isPaletteShortcut) {
        return;
      }
      event.preventDefault();
      noteInteraction();
      setCommandPaletteOpen((current) => !current);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // The manual-entry form's ticker/name/etc. state lives inside ToolSideDrawer, not up here (it's
  // a large, self-contained form with its own market-lookup effects) — rather than lifting all of
  // that just so one new caller can seed one field, ToolSideDrawer takes this as a prop and
  // applies+clears it itself the moment it sees a new value (see its own effect for
  // pendingManualTicker). Bumping a counter alongside the ticker string is what makes re-picking
  // the *same* ticker twice in a row (add "AAPL", cancel, immediately add "AAPL" again) still
  // register as a fresh request instead of a no-op prop change.
  const openManualToolWithTicker = useCallback((ticker) => {
    noteInteraction();
    setPendingManualTicker({ ticker, requestedAt: Date.now() });
    setActiveDrawerTool('manual');
    setToolTrayOpen(true);
  }, []);

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
    const transitionSpinY = new THREE.Quaternion();
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

      // Drives useAtomTransition's own progress — this loop is the only rAF loop either of them
      // runs now, so this is the one place that has to call it. A no-op whenever no
      // dissolve()/materialize() is in flight. Must run before the read below, so that read sees
      // this frame's velocity rather than last frame's.
      advanceAtomTransition(now);

      // Dissolve/materialize's own spin — added on top of (not multiplied into) idle rotation
      // above, and applies regardless of the drag/reduced-motion gating on that idle rotation:
      // this is a transition playing out on its own timeline, not ambient drift.
      // useAtomTransition itself zeroes this out under prefers-reduced-motion, so there's no
      // separate guard needed here for that.
      if (atomTransitionAngularVelocityRef.current !== 0) {
        transitionSpinY.setFromAxisAngle(yAxis, delta * atomTransitionAngularVelocityRef.current);
        rotationRef.current.target.premultiply(transitionSpinY).normalize();
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
  }, [language]);

  // Dark is the only mode this app renders (see styles.css's base :root) — no light/dark toggle,
  // no system-preference detection. This one-time cleanup just erases any 'light'/'dark' choice a
  // now-removed settings toggle may have written to a browser in an earlier build, so a returning
  // visitor's page doesn't carry over a stale data-theme attribute that no longer has any matching
  // CSS rule to key off (harmless either way, but no reason to leave it sitting there).
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = 'dark';
    window.localStorage.removeItem('atom-sketch-theme');
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(STORAGE_KEYS.baseCurrency, baseCurrency);
  }, [baseCurrency]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(STORAGE_KEYS.toolDrawerDock, toolDrawerDock);
  }, [toolDrawerDock]);

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
  }, []);

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
  // Deferred counterparts feed only the side-panel analytics below (heatmap/allocation/scorecard/
  // analytics summary) — never the atom's own geometry (that reads the immediate portfolioItems
  // directly, via the effect that fills atomsRef.current), so the materialize animation always
  // grows into the *correct* new shape right away. Those four memos walk the full timeline —
  // thousands of rows for some accounts — which used to run synchronously in the same commit as
  // switching portfolios, freezing the main thread for a felt beat right in the middle of the
  // dissolve/materialize sequence. useDeferredValue lets that render happen at low priority
  // instead: React keeps showing the previous portfolio's analytics uninterrupted (not blank,
  // not stale-looking — genuinely still valid until the moment it's replaced) while the urgent
  // render (atom shape, scale, rotation) keeps painting every frame, then swaps the panels in
  // once the heavy recompute finishes a few frames later instead of one long blocking one.
  const deferredPortfolioItems = useDeferredValue(portfolioItems);
  const deferredPortfolioTimelineItems = useDeferredValue(portfolioTimelineItems);
  // Read from a ref inside the interval below rather than depending on portfolioItems/
  // portfolioTimelineItems directly — those are fresh array references on every render (the atom
  // scene's RAF loop re-renders far more often than every 90s), so depending on them would reset
  // the interval before it ever got a chance to fire.
  activePortfolioLiveItemsRef.current = portfolioTimelineItems.length ? portfolioTimelineItems : portfolioItems;

  // Keeps the holdings on screen genuinely live rather than a one-time backfill: the effect below
  // (portfolioAutoEnrichmentRef-gated) only ever fetches a quote once per holding, the first time
  // it's missing a price. This ticks in the background — only while the tab is in the foreground,
  // same gating as the news panel's auto-refresh — and re-fetches whichever portfolio is currently
  // on screen, so prices/returns keep moving instead of freezing at import time.
  useEffect(() => {
    const portfolioId = activePortfolio?.id;
    if (!portfolioId) {
      return undefined;
    }

    const tick = () => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      const sourceItems = activePortfolioLiveItemsRef.current.slice(0, LIVE_QUOTE_REFRESH_MAX_ITEMS);
      if (!sourceItems.length) {
        return;
      }
      scheduleLiveQuoteEnrichment(portfolioId, sourceItems);
    };

    const intervalId = window.setInterval(tick, LIVE_QUOTE_REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [activePortfolio?.id, scheduleLiveQuoteEnrichment]);

  const allPortfolioItems = useMemo(
    () =>
      portfolioEntries.flatMap((entry) =>
        Array.isArray(entry.items) ? entry.items : [],
      ),
    [portfolioEntries],
  );

  useEffect(() => {
    // Reuse the layout switchToPortfolio already computed during the dissolve that just played,
    // if this is that same swap landing — entryId mismatch (a live quote refresh on the
    // still-active portfolio, the very first mount, a programmatic switch that never went through
    // switchToPortfolio's precompute path at all) falls back to computing it fresh right here,
    // exactly as before this existed.
    const precomputed = precomputedAtomLayoutRef.current;
    precomputedAtomLayoutRef.current = { entryId: null, atoms: null };
    atomsRef.current =
      precomputed.entryId != null && precomputed.entryId === activePortfolioId
        ? precomputed.atoms
        : generateAtomLayout(portfolioItems, { resolveLabel: resolveAtomStockDisplayName }).map(
            createAtomState,
          );
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
  }, [portfolioItems, activePortfolioId]);

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
    // Dissolving/materializing swaps the atom's underlying data out from under any rotation state
    // that was mid-gesture — ignoring new drags while a transition is in flight (rather than
    // starting one that will immediately reference stale/about-to-change atom data) is simpler and
    // safer than trying to reconcile the two.
    if (atomTransitionPhase !== 'idle') {
      return;
    }
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
      safeAccountName,
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

    // Ref updated synchronously alongside state (not via a functional setPortfolioEntries
    // updater) so switchToPortfolio's own portfolioEntriesRef.current lookup — called right
    // below, before this render has committed — already sees this brand-new entry instead of
    // computing its precomputed layout from a still-stale, entry-less ref.
    const nextEntries = [...portfolioEntries, entry].slice(0, MAX_PORTFOLIOS);
    portfolioEntriesRef.current = nextEntries;
    setPortfolioEntries(nextEntries);
    void switchToPortfolio(entryId);
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
      safeAccountName,
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

    // See handleCreateManualAtom just above for why the ref is updated synchronously here too.
    const nextEntries = [...portfolioEntries, entry].slice(0, MAX_PORTFOLIOS);
    portfolioEntriesRef.current = nextEntries;
    setPortfolioEntries(nextEntries);
    void switchToPortfolio(entryId);
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

    // Computed from the closure's own portfolioEntries (not a functional setPortfolioEntries
    // updater) so the ref can be updated with this exact same value, synchronously — see
    // handleCreateManualAtom above for why switchToPortfolio needs that.
    const nextEntries = portfolioEntries.map((entry) => {
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
    });
    portfolioEntriesRef.current = nextEntries;
    setPortfolioEntries(nextEntries);
    void switchToPortfolio(entryId);
  };

  const handleUpdatePortfolioHolding = ({ entryId, itemId, itemIndex, accountName, row }) => {
    if (!entryId || !row) {
      return;
    }

    noteInteraction();
    clearPortfolioError();

    // Deliberately still plain setActivePortfolioId, not switchToPortfolio — editing one field on
    // one holding (from the management table or a drawer form) isn't a "switch portfolios" moment
    // even on the rare path where entryId isn't already the active one; dissolving/materializing
    // the whole atom over a single-field edit would read as a strange overreaction to it, not a
    // transition. This also keeps handleMoveHolding below race-free: it composes this + append,
    // and only one of the two should actually animate.
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

    // Plain setActivePortfolioId, not switchToPortfolio — same reasoning as
    // handleUpdatePortfolioHolding just above: a single-holding delete isn't a portfolio switch,
    // and handleMoveHolding below relies on this staying instant (it composes this with an append
    // that *does* animate — two animated calls back to back would race each other).

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

  // "이동" in the command palette — there's no dedicated move operation in storage, but remove +
  // append already fully round-trip a holding's data, so composing them here is the whole
  // implementation; no new state-shape or persistence path needed. Defined here (after both
  // pieces it composes) rather than up near the palette's other handlers so its useCallback deps
  // don't reference consts that haven't been declared yet in source order.
  const handleMoveHolding = useCallback(
    ({ sourceEntryId, targetEntryId, item, itemId, itemIds, itemIndex, itemIndexes }) => {
      if (!sourceEntryId || !targetEntryId || sourceEntryId === targetEntryId) {
        return;
      }
      const targetEntry = portfolioEntries.find((entry) => entry.id === targetEntryId);
      const row = {
        stockName: resolveHoldingName(item),
        ticker: resolveHoldingTicker(item),
        buyPrice: resolveHoldingMetric(item, ['매수가', 'buyPrice', 'purchasePrice']),
        shares: resolveHoldingMetric(item, ['보유수량', 'shares', 'quantity']),
        returnRate:
          String(item?.detail ?? item?.return ?? '').trim() ||
          resolveHoldingMetric(item, ['수익률', 'return']),
        assetClass: String(item?.assetClass ?? '').trim() || '주식',
      };
      handleRemovePortfolioHolding({ entryId: sourceEntryId, itemId, itemIds, itemIndex, itemIndexes });
      handleAppendManualHoldings({
        entryId: targetEntryId,
        accountName: targetEntry?.fileName?.replace(/\.csv$/i, '') || '',
        rows: [row],
      });
    },
    [portfolioEntries, handleRemovePortfolioHolding, handleAppendManualHoldings],
  );

  const hasPortfolio = portfolioEntries.length > 0;
  const hasPortfolioItems = portfolioItems.length > 0;
  const showToolDrawer = true;
  const hoveredFileEntry = useMemo(
    () => portfolioEntries.find((entry) => entry.id === hoveredFileEntryId) ?? null,
    [hoveredFileEntryId, portfolioEntries],
  );
  useEffect(() => {
    if (hoveredFileEntryId && !hoveredFileEntry) {
      clearHoveredFileTooltip();
    }
  }, [clearHoveredFileTooltip, hoveredFileEntry, hoveredFileEntryId]);
  const groupOptions = useMemo(() => groupOptionsFor(language), [language]);
  const scoreAxes = useMemo(() => scoreAxesFor(language), [language]);
  const displayFxRates = useMemo(() => buildDisplayFxRates(usdKrwRate), [usdKrwRate]);
  // One flat list, rendered in this order, no sub-grouping — keeps the settings panel to a single
  // quick-glance list rather than reintroducing section headers for five items.
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
  // Click-to-copy for the workspace ID (requirement: no separate "copy" button to hunt for — the
  // ID itself is the click target). navigator.clipboard is the primary path; execCommand('copy')
  // via a throwaway textarea is the fallback for contexts where the Clipboard API is unavailable
  // (e.g. non-HTTPS, some embedded webviews) rather than silently doing nothing.
  //
  // navigator.clipboard.writeText's promise can hang indefinitely rather than reject — observed in
  // an automated/unfocused-document browser context, where it neither resolved nor threw, which
  // without a race would leave this whole handler (and the button's feedback) stuck forever with
  // no error and no fallback ever attempted. Racing it against a short timeout guarantees the
  // execCommand fallback still runs even when the Clipboard API silently never settles.
  const handleCopyWorkspaceId = useCallback(async () => {
    noteInteraction();
    const value = currentWorkspaceId;
    let copied = false;

    try {
      if (navigator?.clipboard?.writeText) {
        await Promise.race([
          navigator.clipboard.writeText(value),
          new Promise((_, reject) => setTimeout(() => reject(new Error('clipboard-write-timeout')), 800)),
        ]);
        copied = true;
      }
    } catch {
      copied = false;
    }

    if (!copied && typeof document !== 'undefined') {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        copied = document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch {
        copied = false;
      }
    }

    clearTimeout(workspaceIdCopyResetTimerRef.current);
    setWorkspaceIdCopyStatus(copied ? 'copied' : 'failed');
    workspaceIdCopyResetTimerRef.current = setTimeout(() => setWorkspaceIdCopyStatus('idle'), 1800);
  }, [currentWorkspaceId, noteInteraction]);
  const handleGenerateDeviceToken = useCallback(async () => {
    noteInteraction();
    setDeviceTokenStatus('pending');
    setDeviceTokenError('');

    try {
      const payload = await createDesktopDeviceToken();
      if (!payload?.ok || !payload?.token) {
        throw new Error(payload?.error ?? text.desktopConnectError);
      }

      setDeviceTokenValue(payload.token);
      setDeviceTokenStatus('revealed');
    } catch (error) {
      setDeviceTokenStatus('failed');
      setDeviceTokenError(error instanceof Error && error.message ? error.message : text.desktopConnectError);
    }
  }, [noteInteraction, text.desktopConnectError]);
  const handleRevokeDeviceTokens = useCallback(async () => {
    noteInteraction();
    setDeviceTokenStatus('pending');
    setDeviceTokenError('');

    try {
      await revokeDesktopDeviceTokens();
      setDeviceTokenValue('');
      setDeviceTokenStatus('idle');
    } catch (error) {
      setDeviceTokenStatus('failed');
      setDeviceTokenError(error instanceof Error && error.message ? error.message : text.desktopConnectError);
    }
  }, [noteInteraction, text.desktopConnectError]);
  // Same click-to-copy pattern as handleCopyWorkspaceId — kept separate rather than
  // parameterizing that one, since this copies from React state (deviceTokenValue) instead of a
  // prop, and the two controls have independent feedback timers.
  const handleCopyDeviceToken = useCallback(async () => {
    noteInteraction();
    let copied = false;

    try {
      if (navigator?.clipboard?.writeText) {
        await Promise.race([
          navigator.clipboard.writeText(deviceTokenValue),
          new Promise((_, reject) => setTimeout(() => reject(new Error('clipboard-write-timeout')), 800)),
        ]);
        copied = true;
      }
    } catch {
      copied = false;
    }

    if (!copied && typeof document !== 'undefined') {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = deviceTokenValue;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        copied = document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch {
        copied = false;
      }
    }

    clearTimeout(deviceTokenCopyResetTimerRef.current);
    setDeviceTokenCopyStatus(copied ? 'copied' : 'failed');
    deviceTokenCopyResetTimerRef.current = setTimeout(() => setDeviceTokenCopyStatus('idle'), 1800);
  }, [deviceTokenValue, noteInteraction]);
  const renderSettingsPanel = () => (
    <div className="tool-drawer__settings">
      <p className="settings-panel__title">{text.settings}</p>

      <div className="settings-panel__rows">
        {settingsSections.map((section) => (
          <div key={section.key} className="settings-panel__row">
            <span className="settings-panel__row-label">{section.title}</span>
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
          </div>
        ))}
      </div>

      <div className="settings-panel__account">
        <p className="settings-panel__account-title">{text.settingsSectionWorkspace}</p>
        <dl className="settings-workspace">
          <div className="settings-workspace__row">
            <dt>{text.workspaceStatusLabel}</dt>
            <dd>
              <span
                className={`settings-status-pill${workspaceAuthenticated ? ' is-signed-in' : ' is-guest'}`}
              >
                {workspaceAuthenticated ? text.workspaceStatusSignedIn : text.workspaceStatusGuest}
              </span>
            </dd>
          </div>
          <div className="settings-workspace__row">
            <dt>{text.workspaceIdLabel}</dt>
            <dd>
              <button
                type="button"
                className={`settings-workspace__copy${workspaceIdCopyStatus !== 'idle' ? ` is-${workspaceIdCopyStatus}` : ''}`}
                onClick={handleCopyWorkspaceId}
                title={workspaceIdCopyStatus === 'idle' ? text.workspaceIdCopyHint : undefined}
              >
                <span className="settings-workspace__copy-value">{currentWorkspaceId}</span>
                {workspaceIdCopyStatus === 'copied' ? (
                  <svg
                    className="settings-workspace__copy-icon"
                    viewBox="0 0 20 20"
                    aria-hidden="true"
                  >
                    <path d="M4 10.5L8 14.5L16 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <svg
                    className="settings-workspace__copy-icon"
                    viewBox="0 0 20 20"
                    aria-hidden="true"
                  >
                    <rect x="7" y="7" width="10" height="10" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M4 13V4.6C4 4.27 4.27 4 4.6 4H13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                )}
                <span className="settings-workspace__copy-feedback" role="status" aria-live="polite">
                  {workspaceIdCopyStatus === 'copied'
                    ? text.workspaceIdCopied
                    : workspaceIdCopyStatus === 'failed'
                      ? text.workspaceIdCopyFailed
                      : ''}
                </span>
              </button>
            </dd>
          </div>
          <div className="settings-workspace__row settings-workspace__row--muted">
            <dt>{text.workspaceSyncLabel}</dt>
            <dd>{portfolioSyncStatusText}</dd>
          </div>
          {workspaceAuthenticated ? (
            <div className="settings-workspace__row settings-workspace__row--muted">
              <dt>{text.workspaceUserLabel}</dt>
              <dd title={workspaceUserLabel}>{workspaceUserLabel}</dd>
            </div>
          ) : null}
        </dl>

        <div className="settings-panel__account-auth">
          {CLERK_PUBLISHABLE_KEY ? (
            <AuthPanel text={text} onAuthenticated={handleAuthPanelSuccess} workspaceId={currentWorkspaceId} />
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
            {workspaceClaimStatus === 'pending' ? text.workspaceClaimPending : text.workspaceClaimButton}
          </button>
          <p className={`settings-workspace__hint${workspaceClaimStatus === 'failed' ? ' is-error' : ''}`}>
            {workspaceClaimStatusText}
          </p>
        </div>

        {workspaceAuthenticated ? (
          <div className="settings-panel__links">
            {deviceTokenStatus === 'revealed' && deviceTokenValue ? (
              <>
                <button
                  type="button"
                  className={`settings-workspace__copy is-block${deviceTokenCopyStatus !== 'idle' ? ` is-${deviceTokenCopyStatus}` : ''}`}
                  onClick={handleCopyDeviceToken}
                  title={deviceTokenCopyStatus === 'idle' ? text.workspaceIdCopyHint : undefined}
                >
                  <span className="settings-workspace__copy-value">{deviceTokenValue}</span>
                  {deviceTokenCopyStatus === 'copied' ? (
                    <svg className="settings-workspace__copy-icon" viewBox="0 0 20 20" aria-hidden="true">
                      <path d="M4 10.5L8 14.5L16 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <svg className="settings-workspace__copy-icon" viewBox="0 0 20 20" aria-hidden="true">
                      <rect x="7" y="7" width="10" height="10" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
                      <path d="M4 13V4.6C4 4.27 4.27 4 4.6 4H13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  )}
                  <span className="settings-workspace__copy-feedback" role="status" aria-live="polite">
                    {deviceTokenCopyStatus === 'copied'
                      ? text.workspaceIdCopied
                      : deviceTokenCopyStatus === 'failed'
                        ? text.workspaceIdCopyFailed
                        : ''}
                  </span>
                </button>
                <p className="settings-workspace__hint">{text.desktopConnectRevealHint}</p>
              </>
            ) : null}
            <button
              type="button"
              className="settings-link"
              disabled={deviceTokenStatus === 'pending'}
              onClick={() => {
                void handleGenerateDeviceToken();
              }}
            >
              {deviceTokenStatus === 'pending'
                ? text.desktopConnectPending
                : deviceTokenValue
                  ? text.desktopConnectRegenerateButton
                  : text.desktopConnectGenerateButton}
            </button>
            <button
              type="button"
              className="settings-link"
              disabled={deviceTokenStatus === 'pending'}
              onClick={() => {
                void handleRevokeDeviceTokens();
              }}
            >
              {text.desktopConnectRevokeButton}
            </button>
            {deviceTokenStatus === 'failed' ? (
              <p className="settings-workspace__hint is-error">{deviceTokenError}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
  const contributionPreview = useMemo(
    () => createContributionPreview(deferredPortfolioItems),
    [deferredPortfolioItems],
  );
  const portfolioAllocation = useMemo(
    () =>
      createPortfolioAllocation(deferredPortfolioItems, {
        classificationMode: assetClassMode,
        weightMode: allocationWeightMode,
      }),
    [allocationWeightMode, assetClassMode, deferredPortfolioItems],
  );
  const portfolioAnalyticsSummary = useMemo(() => {
    if (!hasPortfolio) {
      return null;
    }

    return createPortfolioAnalyticsSummary(deferredPortfolioItems, deferredPortfolioTimelineItems, {
      period: 'month',
      topN: 5,
      targetBucketWeights: DEFAULT_REBALANCE_TARGET_WEIGHTS,
      // Without this, a foreign (USD) holding's buyAmount/marketValue would be summed into the
      // 총 평가금액/총 매입금액/총 평가손익 totals as raw numbers — the exact bug this fixes: see
      // resolvePosition's own comment in portfolioAnalyticsSummary.js.
      baseCurrency,
      fxRates: displayFxRates,
    });
  }, [hasPortfolio, deferredPortfolioItems, deferredPortfolioTimelineItems, baseCurrency, displayFxRates]);
  const portfolioHeatmap = useMemo(
    () =>
      createPortfolioHeatmap(deferredPortfolioTimelineItems, {
        weeks: 24,
        today: nowForDateBasis(dateBasis),
      }),
    [deferredPortfolioTimelineItems, dateBasis],
  );
  const drawerHeatmap = useMemo(
    () =>
      portfolioHeatmap
        ? {
            ...portfolioHeatmap,
            columns: contributionPreview.columns,
            rows: contributionPreview.rows,
          }
        : null,
    [portfolioHeatmap, contributionPreview],
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

    return createPortfolioScorecard(deferredPortfolioItems, language, {
      weightPreset: scoreWeightPreset,
    });
  }, [hasPortfolio, language, deferredPortfolioItems, scoreWeightPreset]);
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
    async ({ entryId, item, itemIndex }) => {
      noteInteraction();
      if (entryId && entryId !== activePortfolioId) {
        // Awaited deliberately: atomsRef.current below is only correct for the *new* portfolio
        // once its materialize has actually run (the effect that repopulates it keys off
        // activePortfolioId/portfolioItems, which only update after switchToPortfolio's own
        // setActivePortfolioId commits) — resolving the atom to select before that would still be
        // looking at the outgoing portfolio's shapes. materializeAtom's own ~420ms is comfortably
        // longer than the render+effect flush it's implicitly waiting on here, so this isn't a
        // race so much as it looks like one at a glance.
        await switchToPortfolio(entryId);
      }

      const atomId = resolveHoldingAtomId(atomsRef.current, item, itemIndex);
      if (atomId) {
        setSelectedAtomId(atomId);
        setActiveGroupKey(null);
      }
    },
    [activePortfolioId, switchToPortfolio],
  );
  const triggerIntroCenterBurst = () => {
    noteInteraction();
    setIntroCenterBurstAt(performance.now());
  };
  const introCenterBurst =
    !hasPortfolioItems && introCenterBurstAt >= 0
      ? Math.sin(clamp((frameTime - introCenterBurstAt) / 420, 0, 1) * Math.PI)
      : 0;

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
    // Which direction to push the atom to keep it visually centered in whatever space the open
    // drawer leaves behind depends on which side it's docked to — left dock pushes the atom
    // right (positive), right dock pushes it left (negative).
    '--stage-panel-shift': toolTrayOpen
      ? `${(toolDrawerDock === 'right' ? -1 : 1) * (toolDrawerWidth / 2)}px`
      : '0px',
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
  const selectedAtomData = atoms.find((atom) => atom.id === selectedAtomId) ?? null;
  const selectedAtomInfoFields = buildAtomInfoFields(selectedAtomData, language);
  const selectedAtomReturnRaw = selectedAtomData?.detail ?? '';
  const selectedAtomReturnToneClass = getSignedValueToneClass(
    selectedAtomReturnRaw,
    'is-positive',
    'is-negative',
  );
  const selectedAtomDisplayFields = (
    selectedAtomReturnRaw
      ? selectedAtomInfoFields.filter((field) => resolveFieldLabelKey(field.label) !== 'return')
      : selectedAtomInfoFields
  ).map((field) => ({
    label: formatFieldLabel(field.label, language),
    value: translateDisplayValue(field.value, language),
  }));

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

      {/* The old 탐색/관리 (Explore/Manage) mode toggle was removed here — it duplicated the
          single "how do I look at/change my holdings" job the holdings list + 수정 button and ⌘K
          already cover, and having three different entry points for that one job was exactly the
          "여러 개 버튼이 있어 헷갈리는" complaint this cleanup was for. Cmd+K/Ctrl+K (the global
          listener above) had zero visible affordance anywhere in the app before this hint —
          genuinely undiscoverable unless a user already had the habit from another app. This is
          deliberately small and out of the way (top-right corner) rather than a modal/tour: a
          persistent low-key reminder, not a one-time popup that can be missed or dismissed and
          then forgotten. */}
      <button
        type="button"
        className="command-palette-hint"
        aria-label={text.commandPaletteHintAria}
        onClick={() => {
          noteInteraction();
          setCommandPaletteOpen(true);
        }}
      >
        <span className="command-palette-hint__label">{text.commandPaletteHint}</span>
        <span className="command-palette-hint__key" aria-hidden="true">
          ⌘K
        </span>
      </button>

      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        portfolioEntries={portfolioEntries}
        language={language}
        onGoToHolding={({ entryId, item, itemIndex }) => {
          handleFocusPortfolioHolding({ entryId, item, itemIndex });
        }}
        onDeleteHolding={handleRemovePortfolioHolding}
        onMoveHolding={handleMoveHolding}
        onAddNew={openManualToolWithTicker}
      />

      <div className="floating-ui-layer">
        {showToolDrawer ? (
          <ToolSideDrawer
            open={toolTrayOpen}
            activeTool={activeDrawerTool}
            onSelectTool={handleDrawerToolSelect}
            groupOptions={groupOptions}
            activeGroupKey={activeGroupKey}
            onGroupChange={setActiveGroupKey}
            heatmap={drawerHeatmap}
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
            onSelectPortfolio={switchToPortfolio}
            onFocusHolding={handleFocusPortfolioHolding}
            onClearHoldingFocus={clearCenterSelection}
            onClearPortfolio={handleClearPortfolio}
            onOpenPortfolioPicker={openPortfolioPicker}
            onCreateManualAtom={handleCreateManualAtom}
            onCreateManualPortfolio={handleCreateManualPortfolio}
            onAppendManualHoldings={handleAppendManualHoldings}
            onUpdatePortfolioHolding={handleUpdatePortfolioHolding}
            onRemovePortfolioHolding={handleRemovePortfolioHolding}
            pendingManualTicker={pendingManualTicker}
            drawerWidth={toolDrawerWidth}
            onDrawerWidthChange={setToolDrawerWidth}
            dock={toolDrawerDock}
            onDockChange={setToolDrawerDock}
            onDockDragHoverEdgeChange={setDockDragHoverEdge}
            language={language}
            baseCurrency={baseCurrency}
            fxRates={displayFxRates}
            dateBasis={dateBasis}
            layerStyle={floatingLayerStyleFor('tool-drawer')}
            onInteract={interactWithDrawerTool}
            renderSettingsPanel={renderSettingsPanel}
          />
        ) : null}

        {dockDragHoverEdge ? (
          // Rendered as .tool-drawer's own sibling, not its child — .tool-drawer carries a
          // clip-path now (Stage 1), which clips its entire subtree down to the rail while
          // closed; a same-element child here would only ever be visible in the same sliver the
          // rail already occupies, never able to paint the full opposite/bottom edge this needs.
          <div className={`dock-edge-hint dock-edge-hint--${dockDragHoverEdge}`} aria-hidden="true" />
        ) : null}

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
              <div className="stage-camera" onPointerDownCapture={dismissAtomHint}>
                {/* Whole-scene dissolve/materialize (useAtomTransition) — scale, not individual
                    node repositioning, so it works identically whichever scene renderer is active
                    below. --materialize defaults to 1 (full size) via the CSS custom property's
                    own fallback in App.css, so this wrapper is a no-op outside a transition. */}
                <div className="atom-materialize-wrapper" style={{ '--materialize': atomTransitionScale }}>
                  {ENABLE_WEBGL_SCENE_PREVIEW ? (
                    <AtomCanvas
                      atoms={atoms}
                      rotationRef={rotationRef}
                      motionPreferenceRef={motionPreferenceRef}
                      bondLength={BOND_LENGTH}
                      onAtomPointerDown={handleNodePointerDown}
                      onAtomPointerEnter={handleNodeEnter}
                      onAtomPointerMove={handleNodeMove}
                      onAtomPointerLeave={handleNodeLeave}
                      onKeyboardSelect={handleNodeKeyboardSelect}
                      onCenterClick={hasPortfolioItems ? clearCenterSelection : triggerIntroCenterBurst}
                    />
                  ) : null}
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
                </div>
                {atomHintVisible && hasPortfolioItems ? (
                  <div className="atom-hint" role="status">
                    {text.atomHint}
                  </div>
                ) : null}
                {/* First-launch gap found during a new-user walkthrough: with zero portfolios, the
                    stage showed nothing but the idle-pulse atom - nothing distinguishing "empty
                    because you haven't added anything" from "broken." Clicking straight through
                    to the accounts drawer (the same handler the rail button itself uses) turns
                    this into a working shortcut, not just a static label. Kept to one quiet line
                    (was a bold headline + an explanatory sentence about CSV/manual entry) — the
                    accounts drawer it opens is where that choice actually gets made, so spelling
                    it out here first was just prose standing between the click and the drawer. */}
                {!hasPortfolio ? (
                  <button
                    type="button"
                    className="atom-hint atom-hint--empty-state"
                    onClick={() => {
                      noteInteraction();
                      handleDrawerToolSelect('accounts');
                    }}
                  >
                    <span className="atom-hint--empty-state-glyph" aria-hidden="true">
                      +
                    </span>
                    {text.emptyStateHint}
                  </button>
                ) : null}
                {portfolioEntries.length ? (
                  <div className="portfolio-preview-layer">
                    {portfolioEntries
                      // The active portfolio is already the atom in the center — showing it a
                      // second time as one of its own orbiting "switch to this" previews was
                      // just a redundant, non-functional button (switchToPortfolio's own
                      // entryId === activePortfolioId guard already no-ops a click on it, but
                      // nothing kept it out of the layer visually). With N total portfolios this
                      // should read as N-1 other-portfolio previews, not N.
                      .filter((entry) => entry.id !== activePortfolioId)
                      .slice(0, PORTFOLIO_PREVIEW_SLOTS.length)
                      .map((entry, index) => (
                        <PortfolioPreviewAtomView
                          key={entry.id}
                          entry={entry}
                          slot={PORTFOLIO_PREVIEW_SLOTS[index]}
                          onSelect={switchToPortfolio}
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
      {selectedAtomData ? (
        <AtomDetailPanel
          atom={selectedAtomData}
          fields={selectedAtomDisplayFields}
          returnValue={selectedAtomReturnRaw}
          returnToneClass={selectedAtomReturnToneClass}
          text={text}
          onClose={() => {
            noteInteraction();
            setSelectedAtomId(null);
          }}
        />
      ) : null}
    </main>
  );
}
