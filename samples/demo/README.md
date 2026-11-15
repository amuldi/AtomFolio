# 시연용 예시 포트폴리오

AtomFolio를 처음 보여줄 때 쓰는 예시 CSV 8개(각 10~12종목)와, 입력 오류를 고치는 기능을 보여주는 연습용 CSV 1개입니다. 실제 계좌가 아니라 시연용으로 만든 가상 데이터입니다.

- 모든 종목에 `종목코드`, `매수가`, `보유수량`, `통화`가 있어 "⚠ 수량 없음" 같은 경고 없이 표시됩니다.
- 2026-06-30부터 매월 말일과 2026-11-14의 기록이 있어, 요약 탭의 **이번 달 변화**(지난달 대비)와 월말 수익률 막대가 바로 채워집니다.
- 종목코드가 실제 티커라서 배포 사이트에서는 실시간 시세로 수익률이 다시 계산됩니다. 그래서 화면 수익률은 CSV에 적힌 값과 다를 수 있습니다.

| 파일 | 구성 | 보기 좋은 점 |
| --- | --- | --- |
| `미국 빅테크.csv` | Apple, Microsoft, NVIDIA, Alphabet, Amazon, Meta, Broadcom, Netflix, Oracle, Adobe, Salesforce | 큰 수익 종목이 밝게 빛나는 모습 |
| `한국 대표주.csv` | 삼성전자, SK하이닉스, NAVER, 현대차, KB금융, LG에너지솔루션, 셀트리온, 삼성바이오로직스, 기아, POSCO홀딩스, 카카오, 신한지주 | 원화 종목, 수익과 손실이 섞임 |
| `미국 배당주.csv` | SCHD, VYM, JEPI, Realty Income, Coca-Cola, P&G, J&J, PepsiCo, Verizon, AbbVie, Exxon Mobil | 손익이 작아 차분한 원자 |
| `ISA 국내상장 ETF.csv` | TIGER 미국S&P500, TIGER 미국나스닥100, KODEX 200, TIGER 미국배당다우존스, ACE KRX금현물, KODEX 반도체, TIGER 200, KODEX 2차전지산업, TIGER 200 IT, KODEX 레버리지 | ETF 위주 계좌 |
| `연금저축 장기투자.csv` | KODEX 미국S&P500TR, TIGER 미국테크TOP10, KODEX 200TR, TIGER 리츠부동산인프라, KOSEF 국고채10년, ACE 미국S&P500, TIGER 미국채10년선물, KODEX 골드선물(H), PLUS 고배당주, KODEX 200 | 주식·리츠·채권 분산 |
| `성장주 공격형.csv` | Tesla, Palantir, AMD, ARKK, Coinbase, Shopify, CrowdStrike, Snowflake, Cloudflare, Roblox, Unity, Block | 손익 폭이 커서 빨강·파랑 빛이 모두 강함 |
| `글로벌 자산배분.csv` | VOO, VEA, VWO, BND, GLD, 삼성전자, VNQ, TLT, EWJ, INDA, TIGER 미국S&P500 | 원화·달러 혼합, 높은 분산 점수 |
| `손실 회복 대기.csv` | Intel, Nike, Pfizer, Boeing, 엔씨소프트, LG생활건강, Disney, PayPal, Starbucks, 아모레퍼시픽, 롯데케미칼, 호텔신라 | 손실 종목이 파랗게 빛나는 모습 |

## 입력 오류 연습: `입력 오류 예시.csv`

일부러 잘못 넣은 값 3개가 있어 원자에 주황 점선 테와 "확인 필요 3종목"이 뜹니다. 각 종목을 눌러 상세 카드의 버튼을 누르면 바로 고쳐집니다.

| 종목 | 잘못된 점 | 버튼이 하는 일 |
| --- | --- | --- |
| QQQI | 매수가에 QQQ 가격(690.38)을 넣음, 기록된 수익률은 +3.3% | 매수가 = 현재가 ÷ 1.033 |
| Microsoft | 달러 종목인데 매수가를 원화(560,000)로 넣음 | 환율로 나눠 달러로 변환 |
| 삼성전자 | 수량이 비어 있음 | 수량 = 평가금액 ÷ 현재가 |

## 형식

```csv
평가일,계좌,종목명,종목코드,매수가,보유수량,평가금액,수익률,통화
2026-11-14,해외주식,Apple,AAPL,195,18,4155.84,18.4%,USD
```

`평가금액`은 해당 통화 기준(달러 종목은 달러)입니다. 8개 예시 파일은 `node scripts/generate-demo-portfolios.mjs samples/demo`로 다시 만들 수 있습니다.
