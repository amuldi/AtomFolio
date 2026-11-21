import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SecNotConfiguredError,
  aggregateHoldings,
  diffQuarters,
  groupTrades,
  normalizeCik,
  normalizeCompanyName,
  parseForm4,
  regionFromAddress,
  sectorFromSic,
  parseInfoTable,
  searchSecEntities,
  secUserAgent,
} from '../server/secFilings.mjs';

const INFO_TABLE = `<?xml version="1.0"?>
<informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">
  <infoTable><nameOfIssuer>APPLE INC</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>037833100</cusip>
    <value>600</value><shrsOrPrnAmt><sshPrnamt>3</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt></infoTable>
  <infoTable><nameOfIssuer>ALPHABET INC</nameOfIssuer><titleOfClass>CAP STK CL A</titleOfClass><cusip>02079K305</cusip>
    <value>200</value><shrsOrPrnAmt><sshPrnamt>1</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt></infoTable>
  <infoTable><nameOfIssuer>ALPHABET INC</nameOfIssuer><titleOfClass>CAP STK CL C</titleOfClass><cusip>02079K107</cusip>
    <value>200</value><shrsOrPrnAmt><sshPrnamt>1</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt></infoTable>
  <infoTable><nameOfIssuer>TESLA INC</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>88160R101</cusip>
    <value>999</value><shrsOrPrnAmt><sshPrnamt>9</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt><putCall>Put</putCall></infoTable>
  <infoTable><nameOfIssuer>PG&amp;E CORP</nameOfIssuer><titleOfClass>NOTE 4.25%</titleOfClass><cusip>69331CAL2</cusip>
    <value>500</value><shrsOrPrnAmt><sshPrnamt>500</sshPrnamt><sshPrnamtType>PRN</sshPrnamtType></shrsOrPrnAmt></infoTable>
</informationTable>`;

test('13F information table: share classes merge, options and bond principal are dropped', () => {
  const rows = parseInfoTable(INFO_TABLE);
  assert.equal(rows.length, 5);
  assert.equal(rows[4].issuer, 'PG&E CORP');
  const holdings = aggregateHoldings(rows);
  assert.deepEqual(
    holdings.map((holding) => [holding.issuer, holding.value, holding.shares]),
    [
      ['APPLE INC', 600, 3],
      ['ALPHABET INC', 400, 2],
    ],
  );
});

test('quarter-over-quarter changes are classified by share count, not value', () => {
  const previous = [
    { key: 'AAA', cusip: 'AAA000000', issuer: 'Kept', value: 100, shares: 10 },
    { key: 'BBB', cusip: 'BBB000000', issuer: 'Sold', value: 50, shares: 5 },
    { key: 'CCC', cusip: 'CCC000000', issuer: 'Trimmed', value: 100, shares: 10 },
  ];
  const current = [
    { key: 'AAA', cusip: 'AAA000000', issuer: 'Kept', value: 150, shares: 10 }, // price moved only
    { key: 'CCC', cusip: 'CCC000000', issuer: 'Trimmed', value: 60, shares: 6 },
    { key: 'DDD', cusip: 'DDD000000', issuer: 'New', value: 40, shares: 4 },
  ];
  const changes = diffQuarters(current, previous);
  const kinds = Object.fromEntries(changes.map((change) => [change.issuer, change.kind]));
  assert.deepEqual(kinds, { Sold: 'soldOut', Trimmed: 'trimmed', New: 'new' });
  assert.equal(changes.find((change) => change.issuer === 'Sold').sharesAfter, 0);
});

const FORM4 = `<?xml version="1.0"?>
<ownershipDocument>
  <issuer><issuerCik>0001326801</issuerCik><issuerName>Meta Platforms, Inc.</issuerName><issuerTradingSymbol>META</issuerTradingSymbol></issuer>
  <reportingOwner>
    <reportingOwnerId><rptOwnerCik>0001548760</rptOwnerCik><rptOwnerName>Zuckerberg Mark</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isDirector>1</isDirector><isOfficer>1</isOfficer><officerTitle>COB and CEO</officerTitle><isTenPercentOwner>1</isTenPercentOwner></reportingOwnerRelationship>
  </reportingOwner>
  <aff10b5One>1</aff10b5One>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <securityTitle><value>Class A Common Stock</value></securityTitle>
      <transactionDate><value>2026-09-24</value></transactionDate>
      <transactionCoding><transactionFormType>4</transactionFormType><transactionCode>S</transactionCode></transactionCoding>
      <transactionAmounts><transactionShares><value>100</value></transactionShares><transactionPricePerShare><value>770</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode></transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>5000</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
      <ownershipNature><directOrIndirectOwnership><value>I</value></directOrIndirectOwnership></ownershipNature>
    </nonDerivativeTransaction>
    <nonDerivativeTransaction>
      <securityTitle><value>Class A Common Stock</value></securityTitle>
      <transactionDate><value>2026-09-24</value></transactionDate>
      <transactionCoding><transactionCode>S</transactionCode></transactionCoding>
      <transactionAmounts><transactionShares><value>300</value></transactionShares><transactionPricePerShare><value>780</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode></transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>4700</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
      <ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
</ownershipDocument>`;

test('Form 4: issuer, reporting owner, relationship, 10b5-1 flag and transactions', () => {
  const parsed = parseForm4(FORM4);
  assert.deepEqual(parsed.issuer, { name: 'Meta Platforms, Inc.', ticker: 'META', cik: '1326801' });
  assert.deepEqual(parsed.ownerCiks, ['1548760']);
  assert.equal(parsed.relationship.officerTitle, 'COB and CEO');
  assert.equal(parsed.relationship.tenPercentOwner, true);
  assert.equal(parsed.plan10b5, true);
  assert.equal(parsed.trades.length, 2);
  assert.deepEqual(
    { kind: parsed.trades[0].kind, shares: parsed.trades[0].shares, value: parsed.trades[0].valueUsd, direct: parsed.trades[0].direct },
    { kind: 'sell', shares: 100, value: 77000, direct: false },
  );
});

test('same-day trades merge into one row with a volume-weighted price', () => {
  const parsed = parseForm4(FORM4);
  const grouped = groupTrades(parsed.trades.map((trade) => ({ ...trade, ticker: 'META', issuer: 'Meta', filed: '2026-09-26' })));
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].shares, 400);
  assert.equal(grouped[0].valueUsd, 77000 + 234000);
  assert.equal(grouped[0].averagePrice, 777.5);
  assert.equal(grouped[0].rows, 2);
  assert.equal(grouped[0].ownedAfter, 4700); // direct holding only
});

test('multi-class issuer symbols keep the first class', () => {
  const xml = FORM4.replace('<issuerTradingSymbol>META</issuerTradingSymbol>', '<issuerTradingSymbol>LEN, LEN.B</issuerTradingSymbol>');
  assert.equal(parseForm4(xml).issuer.ticker, 'LEN');
});

test('CIK input is normalized and validated', () => {
  assert.equal(normalizeCik('0001067983'), '1067983');
  assert.equal(normalizeCik('cik 315090'), '315090');
  assert.equal(normalizeCik(''), null);
  assert.equal(normalizeCik('0'), null);
});

test('without a declared contact, lookups refuse instead of hitting sec.gov', async () => {
  const saved = process.env.SEC_CONTACT_EMAIL;
  delete process.env.SEC_CONTACT_EMAIL;
  try {
    assert.equal(secUserAgent(), null);
    await assert.rejects(searchSecEntities('berkshire'), SecNotConfiguredError);
  } finally {
    if (saved !== undefined) process.env.SEC_CONTACT_EMAIL = saved;
  }
});

test('SEC industry codes and addresses map onto the comparison sectors and regions', () => {
  assert.equal(sectorFromSic('3674'), 'tech'); // semiconductors
  assert.equal(sectorFromSic('7372'), 'tech'); // prepackaged software
  assert.equal(sectorFromSic('2834'), 'health'); // pharmaceuticals
  assert.equal(sectorFromSic('6022'), 'financials'); // state banks
  assert.equal(sectorFromSic('6798'), 'realestate'); // REITs
  assert.equal(sectorFromSic('1311'), 'energy'); // crude petroleum
  assert.equal(sectorFromSic('3711'), 'discretionary'); // motor vehicles
  assert.equal(sectorFromSic('4911'), 'utilities');
  assert.equal(sectorFromSic('5331'), 'staples'); // variety stores (Walmart)
  assert.equal(sectorFromSic('', 'SPDR S&P 500 ETF TRUST'), 'etf');
  assert.equal(sectorFromSic(''), 'other');
  assert.equal(regionFromAddress('CA', null), 'us');
  assert.equal(regionFromAddress('M5', 'KOREA, REPUBLIC OF'), 'kr');
  assert.equal(regionFromAddress('F4', 'CHINA'), 'cn');
  assert.equal(regionFromAddress('P7', 'NETHERLANDS'), 'other');
});

test('company names compare without punctuation or legal suffixes', () => {
  assert.equal(normalizeCompanyName('ASML HOLDING N V'), 'ASML');
  assert.equal(normalizeCompanyName('Spotify Technology S.A.'), 'SPOTIFY TECHNOLOGY');
  assert.equal(normalizeCompanyName('JOHNSON CONTROLS INTERNATION'), 'JOHNSON CONTROLS INTERNATION');
  assert.ok(normalizeCompanyName('Johnson Controls International plc').startsWith('JOHNSON CONTROLS INTERNATION'));
});
