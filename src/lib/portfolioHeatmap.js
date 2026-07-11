function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\ufeff/, '')
    .replace(/[\s_.\-/%()[\]]+/g, '');
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseNumericValue(value) {
  const trimmed = String(value ?? '').trim().replace(/[−–—]/g, '-');
  if (!trimmed) {
    return null;
  }

  const numeric = Number.parseFloat(trimmed.replace(/[^0-9.+-]/g, ''));
  const shouldNegate = /^\(.*\)$/.test(trimmed) || /(?:손실|loss|▼|↓)/i.test(trimmed);
  return Number.isFinite(numeric) ? (shouldNegate && numeric > 0 ? -numeric : numeric) : null;
}

function parsePercentValue(value, options = {}) {
  const trimmed = String(value ?? '').trim().replace(/[−–—]/g, '-');
  if (!trimmed) {
    return null;
  }

  const { explicitPercent = false } = options;
  const numeric = Number.parseFloat(trimmed.replace(/[^0-9.+-]/g, ''));
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const signedNumeric =
    (/^\(.*\)$/.test(trimmed) || /(?:손실|loss|▼|↓)/i.test(trimmed)) && numeric > 0
      ? -numeric
      : numeric;

  return explicitPercent || trimmed.includes('%') || Math.abs(signedNumeric) > 1
    ? signedNumeric
    : signedNumeric * 100;
}

function createStrictDate(yearValue, monthValue, dayValue) {
  const year = Number.parseInt(String(yearValue), 10);
  const month = Number.parseInt(String(monthValue), 10);
  const day = Number.parseInt(String(dayValue), 10);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return startOfDay(parsed);
}

function parseDateValue(value, options = {}) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return null;
  }

  const normalizedInput = trimmed
    .replace(/^\ufeff/, '')
    .replace(/\s+/g, ' ')
    .replace(/[.]\s*$/g, '')
    .trim();
  const localizedDateMatch = normalizedInput.match(
    /^(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?/,
  );
  if (localizedDateMatch) {
    return createStrictDate(localizedDateMatch[1], localizedDateMatch[2], localizedDateMatch[3]);
  }

  const compact = normalizedInput.replace(/[.\-/]/g, '');
  if (/^\d{8}$/.test(compact)) {
    const compactDate = createStrictDate(compact.slice(0, 4), compact.slice(4, 6), compact.slice(6, 8));
    if (compactDate) {
      return compactDate;
    }
  }

  if (options.allowExcelSerial && /^\d{5}(?:\.0+)?$/.test(normalizedInput)) {
    const serial = Number.parseInt(normalizedInput, 10);
    if (serial >= 25569 && serial <= 73050) {
      const excelEpoch = Date.UTC(1899, 11, 30);
      const parsed = new Date(excelEpoch + serial * 86400000);
      return createStrictDate(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate());
    }
  }

  if (!/[-/.T:\s]/.test(normalizedInput) && !/[A-Za-z]{3,}/.test(normalizedInput)) {
    return null;
  }

  const normalized = normalizedInput
    .replace(/[./]/g, '-')
    .replace(
      /^(\d{4}-\d{1,2}-\d{1,2})\s+(?:오전|오후|AM|PM)?\s*(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*(Z|[+-]\d{2}:?\d{2}))?$/i,
      (_, datePart, timePart, zonePart = '') => `${datePart}T${timePart}${zonePart}`,
    );
  const isoDateTimeMatch = normalized.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:T(\d{1,2}):(\d{2})(?::(\d{2}))?)?(Z|[+-]\d{2}:?\d{2})?$/,
  );
  if (isoDateTimeMatch) {
    const [, year, month, day] = isoDateTimeMatch;
    return createStrictDate(year, month, day);
  }

  const shortDateTimeMatch = normalized.match(
    /^(\d{1,2})-(\d{1,2})-(\d{2,4})(?:[T\s](?:오전|오후|AM|PM)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/i,
  );
  if (shortDateTimeMatch) {
    const [, first, second, rawYear] = shortDateTimeMatch;
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
    const firstNumber = Number.parseInt(first, 10);
    const secondNumber = Number.parseInt(second, 10);
    const dayFirst = firstNumber > 12 && secondNumber <= 12;
    return dayFirst
      ? createStrictDate(year, second, first)
      : createStrictDate(year, first, second);
  }

  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? startOfDay(parsed) : null;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return startOfDay(next);
}

function startOfWeek(date, weekStartsOn = 1) {
  const next = startOfDay(date);
  const delta = (next.getDay() - weekStartsOn + 7) % 7;
  next.setDate(next.getDate() - delta);
  return next;
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function findFieldEntry(fields, candidates) {
  const normalizedCandidates = candidates.map(normalizeText);

  for (const field of fields ?? []) {
    const label = normalizeText(field.label);
    if (normalizedCandidates.some((candidate) => label.includes(candidate))) {
      return field;
    }
  }

  return null;
}

function isExplicitDateLabel(label) {
  return /date|day|datetime|timestamp|tradedate|tradingdate|executiondate|settlementdate|orderdate|recorddate|valuedate|valuationdate|snapshotdate|asofdate|날짜|일자|기준일|거래일|매매일|체결일|약정일|주문일|평가일|조회일|매수일|매입일|취득일/.test(
    normalizeText(label),
  );
}

function findFallbackDateEntry(fields) {
  return (fields ?? []).find((field) => {
    const label = normalizeText(field.label);
    if (
      /(stockcode|ticker|symbol|종목코드|종목티커|티커|stockname|securityname|assetname|productname|종목명|자산명|상품명|account|계좌|return|손익|수익률|buyprice|currentprice|price|매수가|현재가|가격|shares|수량)/.test(
        label,
      )
    ) {
      return false;
    }

    return Boolean(parseDateValue(field.value, { allowExcelSerial: isExplicitDateLabel(field.label) }));
  }) ?? null;
}

function extractDateEntry(fields) {
  return (
    findFieldEntry(fields, [
      'date',
      'day',
      'tradingdate',
      'trade date',
      'tradedate',
      'executiondate',
      'settlementdate',
      'orderdate',
      'valuationdate',
      'recorddate',
      'snapshotdate',
      'asofdate',
      'datetime',
      'timestamp',
      'valuetime',
      '체결시간',
      '기준시각',
      '일자',
      '날짜',
      '기준일',
      '기준일자',
      '거래일',
      '거래일자',
      '거래일시',
      '매매일',
      '매매일자',
      '체결일',
      '체결일시',
      '약정일',
      '주문일',
      '평가일',
      '조회일',
      '조회일자',
    ]) ??
    findFieldEntry(fields, [
      'buydate',
      'purchasedate',
      'entrydate',
      'acquisitiondate',
      '매수일',
      '매입일',
      '취득일',
    ])
  );
}

function extractValueEntry(fields) {
  return (
    findFieldEntry(fields, [
      'dailyreturn',
      'return',
      'returns',
      'performance',
      'change',
      'yield',
      'profitrate',
      'dailypnlrate',
      'dailypnlpercent',
      'totalreturn',
      'returnpct',
      '수익률',
      '수익율',
      '등락률',
      '변동률',
      '손익률',
      '손익율',
      '평가손익률',
      '총수익률',
      '일간수익률',
      '일별수익률',
      '일일수익률',
      '누적수익률',
    ]) ??
    findFieldEntry(fields, [
      'profitloss',
      'gainloss',
      'pnl',
      'profitandloss',
      'realizedpnl',
      'unrealizedpnl',
      'profit',
      'gain',
      '손익',
      '수익',
      '수익금',
      '손익금',
      '평가손익',
      '실현손익',
      '손익금액',
      '손익액',
      '일손익',
      '일별손익',
      '일수익',
      '일별수익',
    ])
  );
}

function isPercentLikeValueLabel(label) {
  return /%|pct|percent|dailyreturn|return|returns|performance|change|yield|profitrate|dailypnlrate|totalreturn|returnpct|수익률|수익율|등락률|변동률|손익률|손익율|평가손익률|총수익률|일간수익률|일별수익률|일일수익률|누적수익률/.test(
    normalizeText(label),
  );
}

function isAbsoluteValueLabel(label) {
  return /profitloss|gainloss|pnl|profitandloss|realizedpnl|unrealizedpnl|profit|gain|평가손익|실현손익|손익금액|손익액|손익금|수익금|수익|일손익|일별손익|일수익|일별수익/.test(
    normalizeText(label),
  );
}

function readValueFromEntry(entry) {
  if (!entry) {
    return null;
  }

  const label = normalizeText(entry.label);
  if (isPercentLikeValueLabel(label)) {
    const value = parsePercentValue(entry.value, {
      explicitPercent: true,
    });
    return Number.isFinite(value) ? { value, mode: 'percent' } : null;
  }

  if (isAbsoluteValueLabel(label)) {
    const value = parseNumericValue(entry.value);
    return Number.isFinite(value) ? { value, mode: 'absolute' } : null;
  }

  const value = parsePercentValue(entry.value, {
    explicitPercent:
      /%|pct|percent|return|yield|change|rate|수익률|등락률|변동률|손익률/.test(label),
  });
  return Number.isFinite(value) ? { value, mode: 'percent' } : null;
}

function extractTimelineEntries(items) {
  const directEntries = [];

  items.forEach((item) => {
    const fields = item.fields ?? [];
    const dateEntry = extractDateEntry(fields) ?? findFallbackDateEntry(fields);
    const valueEntry = extractValueEntry(fields);
    const date = parseDateValue(dateEntry?.value, {
      allowExcelSerial: isExplicitDateLabel(dateEntry?.label),
    });
    const valueResult =
      readValueFromEntry(valueEntry) ??
      (() => {
        const detailValue = parsePercentValue(item.detail);
        return Number.isFinite(detailValue)
          ? { value: detailValue, mode: 'percent' }
          : null;
      })();

    if (date && valueResult && Number.isFinite(valueResult.value)) {
      directEntries.push({
        date,
        value: valueResult.value,
        mode: valueResult.mode,
      });
    }
  });

  if (directEntries.length) {
    return directEntries;
  }

  return items
    .map((item) => {
      const fields = item.fields ?? [];
      const dateEntry =
        findFieldEntry(fields, [
          'buydate',
          'purchasedate',
          'entrydate',
          'acquisitiondate',
          '매수일',
          '매입일',
          '취득일',
        ]) ??
        extractDateEntry(fields) ??
        findFallbackDateEntry(fields);
      const date = parseDateValue(dateEntry?.value, {
        allowExcelSerial: isExplicitDateLabel(dateEntry?.label),
      });
      const value = parsePercentValue(item.detail);

      if (!date || !Number.isFinite(value)) {
        return null;
      }

      return {
        date,
        value,
        mode: 'percent',
      };
    })
    .filter(Boolean);
}

function buildMonthLabels(gridStart, weeks) {
  const labels = [];
  let previousMonth = -1;

  for (let weekIndex = 0; weekIndex < weeks; weekIndex += 1) {
    const current = addDays(gridStart, weekIndex * 7);
    const month = current.getMonth();

    if (weekIndex === 0 || month !== previousMonth) {
      labels.push({
        index: weekIndex,
        date: current,
      });
      previousMonth = month;
    }
  }

  return labels;
}

export function createPortfolioHeatmap(items, options = {}) {
  const weeks = options.weeks ?? 18;
  const today = startOfDay(options.today ?? new Date());
  const entries = extractTimelineEntries(items);
  const aggregate = new Map();

  entries.forEach((entry) => {
    const key = dateKey(entry.date);
    aggregate.set(key, (aggregate.get(key) ?? 0) + entry.value);
  });

  const latestDate = entries.length
    ? entries.reduce(
        (latest, entry) => (entry.date.getTime() > latest.getTime() ? entry.date : latest),
        entries[0].date,
      )
    : today;
  const endDate = entries.length ? latestDate : today;
  const totalDays = weeks * 7;
  const gridEnd = addDays(startOfWeek(endDate, 1), 6);
  const gridStart = addDays(gridEnd, -(totalDays - 1));
  const positiveValues = [...aggregate.values()].filter((value) => value > 0);
  const negativeValues = [...aggregate.values()]
    .filter((value) => value < 0)
    .map((value) => Math.abs(value));
  const percentCount = entries.filter((entry) => entry.mode === 'percent').length;
  const absoluteCount = entries.filter((entry) => entry.mode === 'absolute').length;
  const maxPositive = positiveValues.length
    ? positiveValues.reduce((max, value) => (value > max ? value : max), positiveValues[0])
    : 0;
  const maxNegative = negativeValues.length
    ? negativeValues.reduce((max, value) => (value > max ? value : max), negativeValues[0])
    : 0;
  const cells = Array.from({ length: totalDays }, (_, index) => {
    const date = addDays(gridStart, index);
    const key = dateKey(date);
    const value = aggregate.get(key) ?? 0;
    const positive = value > 0;
    const negative = value < 0;
    const positiveIntensity =
      positive && maxPositive > 0 ? clamp(value / maxPositive, 0.12, 1) : 0;
    const negativeIntensity =
      negative && maxNegative > 0 ? clamp(Math.abs(value) / maxNegative, 0.12, 1) : 0;

    return {
      key,
      date,
      value,
      positive,
      negative,
      intensity: positive ? positiveIntensity : negativeIntensity,
      positiveIntensity,
      negativeIntensity,
      hasData: aggregate.has(key),
    };
  });

  return {
    weeks,
    cells,
    entriesCount: entries.length,
    monthLabels: buildMonthLabels(gridStart, weeks),
    maxPositive,
    maxNegative,
    valueMode: percentCount >= absoluteCount ? 'percent' : 'absolute',
    warnings:
      percentCount > 0 && absoluteCount > 0
        ? [
            {
              code: 'mixed-return-and-pnl-values',
              severity: 'info',
              message: '수익률과 절대 손익 값이 함께 감지되어 날짜별 합산 해석에 주의가 필요합니다.',
            },
          ]
        : [],
  };
}
