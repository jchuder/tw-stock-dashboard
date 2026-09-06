# TODO — Nice to Have (not in Dashboard V2 scope)

These items are explicitly out of the Dashboard V2 mandatory scope. Do not
implement them opportunistically — each needs its own design and review.

## Nice to Have

### Stock Search

* 股票代號/名稱 autocomplete / suggestions
* 未來需要ticker directory/search source

### Market Overview

* TAIEX / OTC market trading volume
  * confirm official source and unit semantics before extending contract
* TAIEX / OTC sparkline
* 需要index history資料

### Watchlist

* 即時price/change
* mini sparkline
* 實作前應設計bulk snapshot API，避免N+1 quote/history requests

### Trading Table

* server-side cursor pagination
* 僅在table未來成為獨立history browsing surface時實作
* 不應為展示pagination而重複下載chart已取得的dataset
